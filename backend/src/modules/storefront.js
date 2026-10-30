// Public storefront: a business publishes products; shoppers browse, order and pay through Connectly.
// An order reserves stock, and when payment is confirmed (verified webhook) it becomes a normal POS-style invoice:
// stock is deducted once, revenue/GST/COGS are posted once, and the business dashboard updates.
const express = require('express');
const { tx, audit, int, text, json, today, HttpError } = require('./core');
const { requireBiz } = require('./perms');
const inv = require('./inventory');
const sales = require('./sales');
const { haversineKm } = require('../util');

const ORDER_PAY_WINDOW_MS = 30 * 60 * 1000;
const PAY_AT_STORE_HOLD_MS = 24 * 3600 * 1000;
const STATUS_FLOW = { confirmed: ['preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'], preparing: ['ready', 'out_for_delivery', 'completed', 'cancelled'], ready: ['completed', 'cancelled'], out_for_delivery: ['completed', 'cancelled'] };

function storeBySlug(db, slug) {
  const b = db.prepare('SELECT * FROM businesses WHERE public_slug = ? AND storefront_enabled = 1').get(String(slug));
  if (!b) throw new HttpError(404, 'Store not found');
  return b;
}
const rating = (db, id) => db.prepare('SELECT COALESCE(ROUND(AVG(rating),1),0) AS avg, COUNT(*) AS n FROM store_reviews WHERE business_id = ?').get(id);

function publicProduct(db, p) {
  const s = db.prepare('SELECT COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(reserved),0) AS reserved FROM biz_stock_balance WHERE product_id = ?').get(p.id);
  const available = p.track_stock && !p.is_service ? Math.max(0, s.qty - s.reserved) : null;
  return { id: p.id, name: p.name, description: p.description, category: p.category, unit: p.unit, price_paise: p.selling_price_paise, tax_bps: p.tax_bps, image: p.image, in_stock: available === null ? true : available > 0, available };
}

function buildOrderItems(db, biz, items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Your cart is empty');
  let subtotal = 0, tax = 0;
  const lines = items.slice(0, 50).map((i) => {
    const p = db.prepare('SELECT * FROM biz_products WHERE id = ? AND business_id = ? AND published = 1 AND active = 1').get(Number(i.productId), biz.id);
    if (!p) throw new HttpError(404, 'One of the items is no longer sold here');
    const qty = int(i.qty, 'Quantity', { min: 1, max: 99 });
    const total = qty * p.selling_price_paise; // always priced server-side
    const t = Math.round((total * p.tax_bps) / (10000 + p.tax_bps));
    subtotal += total; tax += t;
    return { product: p, qty };
  });
  return { lines, subtotal, tax };
}

function createDeferredInvoice(db, order, payMethod) {
  const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(order.business_id);
  const items = db.prepare('SELECT * FROM store_order_items WHERE order_id = ?').all(order.id).map((i) => ({ productId: i.product_id, qty: i.qty }));
  if (order.delivery_fee_paise > 0) items.push({ name: 'Delivery fee', qty: 1, unitPricePaise: order.delivery_fee_paise, taxBps: 0 });
  // The shopper becomes (or reuses) a customer record of the business.
  let cust = db.prepare('SELECT * FROM biz_customers WHERE business_id = ? AND user_id = ?').get(order.business_id, order.buyer_user_id);
  if (!cust) {
    const u = db.prepare('SELECT name, phone, email FROM users WHERE id = ?').get(order.buyer_user_id);
    const info = db.prepare('INSERT INTO biz_customers (business_id, user_id, name, phone, email) VALUES (?,?,?,?,?)').run(order.business_id, order.buyer_user_id, u.name || 'Customer', u.phone || '', u.email || '');
    cust = { id: Number(info.lastInsertRowid) };
  }
  const out = sales.createInvoice(db, {
    businessId: order.business_id, branchId: order.branch_id, customerId: cust.id, items, payments: [{ method: payMethod, amountPaise: order.total_paise }],
    idempotencyKey: `store_order:${order.id}`, channel: 'storefront', sourceType: 'store_order', sourceId: order.id, reservation: { type: 'store_order', id: order.id }, by: biz.owner_user_id,
  });
  db.prepare("UPDATE store_orders SET invoice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(out.invoice.id, order.id);
  return out.invoice;
}

function routes(ctx) {
  const { db, notify, jobs, payments, clock } = ctx;
  const r = express.Router();

  /* ---------- payment confirmed (called inside the webhook transaction) ---------- */
  payments.onPaid('store_order', (intent) => {
    const order = db.prepare('SELECT * FROM store_orders WHERE id = ?').get(intent.ref_id);
    if (!order || order.invoice_id) return; // already fulfilled: a retried event must not create a second invoice
    const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(order.business_id);
    try {
      if (order.status !== 'pending_payment') throw new HttpError(409, 'Order is no longer open');
      createDeferredInvoice(db, order, 'online');
      db.prepare("UPDATE store_orders SET status = 'confirmed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
      notify(biz.owner_user_id, { type: 'store_order', title: 'New paid order', body: `Order #${order.id} · ₹${(order.total_paise / 100).toLocaleString('en-IN')}`, data: { businessId: biz.id, orderId: order.id } });
      notify(order.buyer_user_id, { type: 'store_order_update', title: 'Payment received', body: `${biz.name} is preparing your order.`, data: { orderId: order.id } });
    } catch (e) {
      // Paid but we cannot fulfil (expired, stock gone): never keep the money, refund it.
      inv.releaseReservations(db, 'store_order', order.id);
      db.prepare("UPDATE store_orders SET status = 'refund_pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
      payments.requestRefund({ intentId: intent.id, amountPaise: intent.amount_paise, reason: `Order ${order.id} could not be fulfilled: ${e.message}`, dedupeKey: `store_refund:${order.id}` });
      notify(order.buyer_user_id, { type: 'store_order_update', title: 'Order could not be completed', body: 'Your payment will be refunded automatically.', data: { orderId: order.id } });
    }
  });

  jobs.register('store:expire_order', async ({ orderId }) => {
    tx(db, () => {
      const o = db.prepare('SELECT * FROM store_orders WHERE id = ?').get(orderId);
      if (!o || o.invoice_id) return;
      if (o.status === 'pending_payment' || (o.status === 'confirmed' && o.pay_method === 'pay_at_store')) {
        inv.releaseReservations(db, 'store_order', o.id);
        db.prepare("UPDATE store_orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(o.id);
        notify(o.buyer_user_id, { type: 'store_order_update', title: 'Order expired', body: 'The items were released because the order was not completed in time.', data: { orderId: o.id } });
      }
    });
  });

  /* ---------- public browsing ---------- */
  r.get('/stores', ctx.auth.optional, (req, res) => {
    const q = String(req.query.q || '').trim().replace(/[%_]/g, '');
    const rows = db.prepare(`SELECT * FROM businesses WHERE storefront_enabled = 1 ${req.query.city ? 'AND city = ?' : ''} ${req.query.category ? 'AND category = ?' : ''} ${q ? 'AND (name LIKE ? OR description LIKE ?)' : ''} ORDER BY verified DESC, name LIMIT 60`)
      .all(...(req.query.city ? [String(req.query.city)] : []), ...(req.query.category ? [String(req.query.category)] : []), ...(q ? [`%${q}%`, `%${q}%`] : []));
    const out = rows.map((b) => ({
      id: b.id, slug: b.public_slug, name: b.name, category: b.category, city: b.city, description: b.description, verified: !!b.verified, rating: rating(db, b.id),
      pickup: !!b.pickup_enabled, delivery: !!b.delivery_enabled, distanceKm: req.user ? haversineKm(req.user.lat, req.user.lng, b.lat, b.lng) : null,
      productCount: db.prepare('SELECT COUNT(*) n FROM biz_products WHERE business_id = ? AND published = 1 AND active = 1').get(b.id).n,
    }));
    out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    res.json({ stores: out });
  });

  r.get('/stores/:slug', ctx.auth.optional, (req, res) => {
    const b = storeBySlug(db, req.params.slug);
    const products = db.prepare("SELECT * FROM biz_products WHERE business_id = ? AND published = 1 AND active = 1 AND is_service = 0 ORDER BY name LIMIT 300").all(b.id).map((p) => publicProduct(db, p));
    res.json({
      store: { id: b.id, slug: b.public_slug, name: b.name, category: b.category, description: b.description, address: b.address, city: b.city, lat: b.lat, lng: b.lng, phone: b.phone, verified: !!b.verified, hours: json(b.hours, {}), pickup: !!b.pickup_enabled, delivery: !!b.delivery_enabled, deliveryFeePaise: b.delivery_fee_paise, ownerUserId: b.owner_user_id, rating: rating(db, b.id) },
      products,
      services: db.prepare('SELECT id, name, description, duration_min, price_paise FROM biz_services WHERE business_id = ? AND active = 1 ORDER BY name').all(b.id),
      reviews: db.prepare('SELECT r.rating, r.comment, r.created_at, u.name FROM store_reviews r JOIN users u ON u.id = r.user_id WHERE r.business_id = ? ORDER BY r.id DESC LIMIT 20').all(b.id),
    });
  });

  r.post('/stores/:slug/reviews', ctx.auth.required, (req, res) => {
    const b = storeBySlug(db, req.params.slug);
    const bought = db.prepare("SELECT 1 FROM store_orders WHERE business_id = ? AND buyer_user_id = ? AND status = 'completed'").get(b.id, req.user.id)
      || db.prepare("SELECT 1 FROM biz_appointments WHERE business_id = ? AND customer_user_id = ? AND status = 'completed'").get(b.id, req.user.id);
    if (!bought) throw new HttpError(403, 'You can review a shop after a completed order or visit');
    const rate = int(req.body.rating, 'Rating', { min: 1, max: 5 });
    db.prepare('INSERT INTO store_reviews (business_id, user_id, rating, comment) VALUES (?,?,?,?) ON CONFLICT(business_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment').run(b.id, req.user.id, rate, text(req.body.comment, { max: 400 }));
    res.status(201).json({ rating: rating(db, b.id) });
  });

  /* ---------- shopper orders ---------- */
  r.post('/stores/:slug/orders', ctx.auth.required, async (req, res) => {
    const b = storeBySlug(db, req.params.slug);
    const key = text(req.body.idempotencyKey, { min: 6, max: 80, name: 'Idempotency key' });
    const dup = db.prepare('SELECT * FROM store_orders WHERE idempotency_key = ? AND buyer_user_id = ?').get(key, req.user.id);
    if (dup) return res.json({ order: orderView(db, dup), duplicate: true });
    const fulfillment = req.body.fulfillment === 'delivery' ? 'delivery' : 'pickup';
    if (fulfillment === 'delivery' && !b.delivery_enabled) throw new HttpError(400, 'This shop does not deliver');
    if (fulfillment === 'pickup' && !b.pickup_enabled) throw new HttpError(400, 'This shop does not offer pickup');
    const address = text(req.body.address, { max: 300 });
    if (fulfillment === 'delivery' && address.length < 6) throw new HttpError(400, 'Enter your delivery address');
    const payMethod = req.body.payMethod === 'pay_at_store' ? 'pay_at_store' : 'online';

    const order = tx(db, () => {
      const { lines, subtotal, tax } = buildOrderItems(db, b, req.body.items);
      const fee = fulfillment === 'delivery' ? b.delivery_fee_paise : 0;
      const branchId = inv.defaultBranch(db, b.id);
      const info = db.prepare('INSERT INTO store_orders (business_id, branch_id, buyer_user_id, status, fulfillment, address, note, pay_method, subtotal_paise, tax_paise, delivery_fee_paise, total_paise, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(b.id, branchId, req.user.id, payMethod === 'pay_at_store' ? 'confirmed' : 'pending_payment', fulfillment, address, text(req.body.note, { max: 300 }), payMethod, subtotal, tax, fee, subtotal + fee, key);
      const id = Number(info.lastInsertRowid);
      for (const l of lines) {
        db.prepare('INSERT INTO store_order_items (order_id, product_id, name, qty, unit_price_paise, tax_bps) VALUES (?,?,?,?,?,?)').run(id, l.product.id, l.product.name, l.qty, l.product.selling_price_paise, l.product.tax_bps);
        inv.reserve(db, { businessId: b.id, branchId, productId: l.product.id, qty: l.qty, sourceType: 'store_order', sourceId: id, now: clock() }); // throws 409 if short: whole order rolls back
      }
      jobs.schedule({ type: 'store:expire_order', runAt: clock() + (payMethod === 'pay_at_store' ? PAY_AT_STORE_HOLD_MS : ORDER_PAY_WINDOW_MS), payload: { orderId: id }, dedupeKey: `store_expire:${id}` });
      return db.prepare('SELECT * FROM store_orders WHERE id = ?').get(id);
    });

    let payment = null;
    if (payMethod === 'online') {
      payment = await payments.createIntent({ purpose: 'store_order', refId: order.id, userId: req.user.id, amountPaise: order.total_paise });
      db.prepare('UPDATE store_orders SET payment_intent_id = ? WHERE id = ?').run(payment.id, order.id);
    } else {
      notify(b.owner_user_id, { type: 'store_order', title: 'New order (pay at store)', body: `Order #${order.id} · ₹${(order.total_paise / 100).toLocaleString('en-IN')}`, data: { businessId: b.id, orderId: order.id } });
    }
    res.status(201).json({ order: orderView(db, db.prepare('SELECT * FROM store_orders WHERE id = ?').get(order.id)), payment });
  });

  function orderView(dbx, o) {
    const biz = dbx.prepare('SELECT name, public_slug, phone, address FROM businesses WHERE id = ?').get(o.business_id);
    return { ...o, store: biz, items: dbx.prepare('SELECT * FROM store_order_items WHERE order_id = ?').all(o.id) };
  }

  r.get('/me/store-orders', ctx.auth.required, (req, res) => {
    res.json({ orders: db.prepare('SELECT * FROM store_orders WHERE buyer_user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id).map((o) => orderView(db, o)) });
  });
  r.post('/me/store-orders/:id/cancel', ctx.auth.required, (req, res) => {
    const o = db.prepare('SELECT * FROM store_orders WHERE id = ? AND buyer_user_id = ?').get(Number(req.params.id), req.user.id);
    if (!o) throw new HttpError(404, 'Order not found');
    if (!['pending_payment', 'confirmed'].includes(o.status) || o.invoice_id) throw new HttpError(409, 'This order can no longer be cancelled here. Please contact the shop.');
    tx(db, () => { inv.releaseReservations(db, 'store_order', o.id); db.prepare("UPDATE store_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(o.id); });
    res.json({ ok: true });
  });

  /* ---------- business side ---------- */
  r.patch('/businesses/:businessId/storefront', requireBiz(ctx, 'storefront.manage'), (req, res) => {
    const b = req.body, cur = req.biz;
    let slug = cur.public_slug;
    if (b.slug !== undefined) {
      slug = text(b.slug, { min: 3, max: 40, name: 'Store link' }).toLowerCase();
      if (!/^[a-z0-9-]+$/.test(slug)) throw new HttpError(400, 'Use letters, numbers and dashes only');
      if (db.prepare('SELECT 1 FROM businesses WHERE public_slug = ? AND id != ?').get(slug, cur.id)) throw new HttpError(409, 'That store link is taken');
    }
    db.prepare('UPDATE businesses SET storefront_enabled=?, pickup_enabled=?, delivery_enabled=?, delivery_fee_paise=?, public_slug=?, description=?, hours=? WHERE id=?').run(
      b.enabled !== undefined ? (b.enabled ? 1 : 0) : cur.storefront_enabled, b.pickupEnabled !== undefined ? (b.pickupEnabled ? 1 : 0) : cur.pickup_enabled,
      b.deliveryEnabled !== undefined ? (b.deliveryEnabled ? 1 : 0) : cur.delivery_enabled, b.deliveryFeePaise !== undefined ? int(b.deliveryFeePaise, 'Delivery fee', { max: 1e7 }) : cur.delivery_fee_paise,
      slug, b.description !== undefined ? text(b.description, { max: 500 }) : cur.description, b.hours && typeof b.hours === 'object' ? JSON.stringify(b.hours) : cur.hours, cur.id);
    audit(db, { actor: req.user.id, business: cur.id, action: 'storefront.update' });
    const nb = db.prepare('SELECT * FROM businesses WHERE id = ?').get(cur.id);
    res.json({ storefront: { enabled: !!nb.storefront_enabled, slug: nb.public_slug, pickup: !!nb.pickup_enabled, delivery: !!nb.delivery_enabled, deliveryFeePaise: nb.delivery_fee_paise, publishedProducts: db.prepare('SELECT COUNT(*) n FROM biz_products WHERE business_id = ? AND published = 1').get(cur.id).n } });
  });

  r.get('/businesses/:businessId/store-orders', requireBiz(ctx, 'storefront.manage'), (req, res) => {
    const rows = db.prepare(`SELECT o.*, u.name AS buyer_name, u.phone AS buyer_phone FROM store_orders o JOIN users u ON u.id = o.buyer_user_id WHERE o.business_id = ? ${req.query.status ? 'AND o.status = ?' : ''} ORDER BY o.id DESC LIMIT 100`).all(req.biz.id, ...(req.query.status ? [String(req.query.status)] : []));
    res.json({ orders: rows.map((o) => ({ ...o, items: db.prepare('SELECT * FROM store_order_items WHERE order_id = ?').all(o.id) })) });
  });

  r.post('/businesses/:businessId/store-orders/:id/status', requireBiz(ctx, 'storefront.manage'), (req, res) => {
    const o = db.prepare('SELECT * FROM store_orders WHERE id = ? AND business_id = ?').get(Number(req.params.id), req.biz.id);
    if (!o) throw new HttpError(404, 'Order not found');
    const next = String(req.body.status);
    if (!(STATUS_FLOW[o.status] || []).includes(next)) throw new HttpError(409, `An order that is ${o.status} cannot become ${next}`);
    tx(db, () => {
      if (next === 'completed' && !o.invoice_id) createDeferredInvoice(db, o, 'cash'); // pay-at-store: collect and bill now
      if (next === 'cancelled') {
        if (o.invoice_id) {
          const invoice = sales.fullInvoice(db, db.prepare('SELECT * FROM biz_sales_invoices WHERE id = ?').get(o.invoice_id));
          sales.createReturn(db, { businessId: o.business_id, invoiceId: o.invoice_id, items: invoice.items.filter((i) => i.qty - i.returned_qty > 0).map((i) => ({ itemId: i.id, qty: i.qty - i.returned_qty })), refundMethod: 'online', reason: `Order ${o.id} cancelled by shop`, key: `store_cancel:${o.id}`, by: req.user.id });
          if (o.payment_intent_id) payments.requestRefund({ intentId: o.payment_intent_id, amountPaise: o.total_paise, reason: 'Cancelled by shop', dedupeKey: `store_refund:${o.id}` });
        } else inv.releaseReservations(db, 'store_order', o.id);
      }
      db.prepare('UPDATE store_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next, o.id);
    });
    notify(o.buyer_user_id, { type: 'store_order_update', title: `Order ${next.replace(/_/g, ' ')}`, body: `${req.biz.name} updated your order #${o.id}.`, data: { orderId: o.id } });
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'store_order.status', entity: 'store_order', entityId: o.id, meta: { next } });
    res.json({ order: orderView(db, db.prepare('SELECT * FROM store_orders WHERE id = ?').get(o.id)) });
  });
  return r;
}

module.exports = { routes };

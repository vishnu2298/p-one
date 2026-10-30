// Sales, POS invoices, payments, returns and customers.
// Prices are tax-inclusive (retail MRP style); tax is carved out of the line total. Every invoice posts revenue + GST
// and COGS to the ledger, deducts stock exactly once (idempotency key), and supports split, partial and credit payments.
const express = require('express');
const crypto = require('crypto');
const { tx, audit, int, text, today, HttpError } = require('./core');
const { requireBiz } = require('./perms');
const acc = require('./accounting');
const inv = require('./inventory');

const METHODS = ['cash', 'upi', 'card', 'bank', 'online', 'wallet'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inr = (p) => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const taxIn = (total, bps) => Math.round((total * bps) / (10000 + bps));

function ownCustomer(db, businessId, id) {
  const c = db.prepare('SELECT * FROM biz_customers WHERE id = ? AND business_id = ?').get(Number(id), businessId);
  if (!c) throw new HttpError(404, 'Customer not found');
  return c;
}
const customerOutstanding = (db, businessId, customerId) => acc.partyBalances(db, businessId, '1100', 'customer').find((x) => x.party_id === customerId)?.balance_paise || 0;

function fullInvoice(db, inv0) {
  const biz = db.prepare('SELECT name, gstin, address, city, phone FROM businesses WHERE id = ?').get(inv0.business_id);
  return {
    ...inv0, balance_paise: inv0.total_paise - inv0.returned_paise - inv0.paid_paise, business: biz,
    items: db.prepare('SELECT * FROM biz_sales_items WHERE invoice_id = ? ORDER BY id').all(inv0.id),
    payments: db.prepare('SELECT * FROM biz_sales_payments WHERE invoice_id = ? ORDER BY id').all(inv0.id),
  };
}

/**
 * Creates an invoice. Safe to call twice with the same idempotencyKey (offline retries, webhook retries):
 * the second call returns the first invoice and changes nothing.
 */
function createInvoice(db, o) {
  return tx(db, () => {
    const key = o.idempotencyKey || null;
    if (key) { const d = db.prepare('SELECT * FROM biz_sales_invoices WHERE idempotency_key = ?').get(key); if (d) return { invoice: fullInvoice(db, d), duplicate: true }; }
    if (!Array.isArray(o.items) || !o.items.length) throw new HttpError(400, 'Add at least one item');
    const biz = db.prepare('SELECT * FROM businesses WHERE id = ?').get(o.businessId);
    const branchId = o.branchId || inv.defaultBranch(db, o.businessId);
    const customer = o.customerId ? ownCustomer(db, o.businessId, o.customerId) : null;

    let gross = 0, discount = 0, tax = 0;
    const lines = o.items.slice(0, 300).map((i) => {
      const product = i.productId ? inv.ownProduct(db, o.businessId, i.productId) : null;
      if (!product && !i.name) throw new HttpError(400, 'Each line needs a product');
      if (product && !product.active) throw new HttpError(409, `${product.name} is no longer sold`);
      const qty = int(i.qty ?? 1, 'Quantity', { min: 1, max: 1e6 });
      const unit = int(i.unitPricePaise ?? product?.selling_price_paise, 'Price', { max: 1e10 });
      const disc = int(i.discountPaise || 0, 'Discount', { max: qty * unit });
      const lineTotal = qty * unit - disc;
      const bps = product ? product.tax_bps : int(i.taxBps || 0, 'Tax', { max: 4000 });
      const t = taxIn(lineTotal, bps);
      gross += qty * unit; discount += disc; tax += t;
      return { product, name: product?.name || text(i.name, { max: 120 }), qty, unit, disc, lineTotal, bps, tax: t, serials: i.serials };
    });
    const total = gross - discount;

    const payments = (o.payments || []).map((p) => ({ method: METHODS.includes(p.method) ? p.method : 'cash', amount: int(p.amountPaise, 'Payment', { min: 1, max: 1e11 }), reference: text(p.reference, { max: 80 }) }));
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    if (paid > total) throw new HttpError(400, 'Payments add up to more than the bill');
    const balance = total - paid;
    if (balance > 0) {
      if (!customer) throw new HttpError(400, 'Choose a customer to sell on credit or part payment');
      if (customer.credit_limit_paise > 0 && customerOutstanding(db, o.businessId, customer.id) + balance > customer.credit_limit_paise) throw new HttpError(409, 'This would take the customer over their credit limit');
    }

    const no = biz.next_invoice_no;
    db.prepare('UPDATE businesses SET next_invoice_no = next_invoice_no + 1 WHERE id = ?').run(o.businessId);
    const info = db.prepare('INSERT INTO biz_sales_invoices (business_id, branch_id, invoice_no, token, customer_id, customer_name, status, subtotal_paise, discount_paise, tax_paise, total_paise, paid_paise, channel, source_type, source_id, idempotency_key, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(o.businessId, branchId, `INV-${String(no).padStart(5, '0')}`, crypto.randomBytes(12).toString('base64url'), customer?.id ?? null, customer?.name || text(o.customerName, { max: 80 }), balance === 0 ? 'paid' : paid > 0 ? 'partial' : 'credit', gross, discount, tax, total, paid, o.channel || 'pos', o.sourceType || '', String(o.sourceId ?? ''), key, o.by ?? null);
    const invoiceId = Number(info.lastInsertRowid);

    let cogs = 0;
    for (const l of lines) {
      let cost = 0;
      if (l.product) {
        const mv = inv.moveStock(db, { businessId: o.businessId, branchId, product: l.product, qty: -l.qty, kind: 'sale', sourceType: 'invoice', sourceId: invoiceId, by: o.by, consumeReservation: !!o.reservation, reserveSourceType: o.reservation?.type, reserveSourceId: o.reservation?.id });
        cost = mv.costPaise || 0;
        if (l.product.has_serials) {
          const list = Array.isArray(l.serials) ? l.serials : [];
          if (list.length !== l.qty) throw new HttpError(400, `Enter ${l.qty} serial number(s) for ${l.product.name}`);
          for (const sn of list) {
            const s = db.prepare("SELECT * FROM biz_serials WHERE business_id = ? AND product_id = ? AND serial = ? AND status = 'in_stock'").get(o.businessId, l.product.id, String(sn));
            if (!s) throw new HttpError(409, `Serial ${sn} is not in stock`);
            const until = l.product.warranty_months ? today(Date.now() + l.product.warranty_months * 30.4375 * 86400000) : '';
            db.prepare("UPDATE biz_serials SET status = 'sold', sold_invoice_id = ?, warranty_until = ? WHERE id = ?").run(invoiceId, until, s.id);
          }
        }
      }
      cogs += cost;
      db.prepare('INSERT INTO biz_sales_items (invoice_id, product_id, name, qty, unit_price_paise, discount_paise, tax_bps, tax_paise, line_total_paise, cost_paise) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(invoiceId, l.product?.id ?? null, l.name, l.qty, l.unit, l.disc, l.bps, l.tax, l.lineTotal, cost);
    }
    db.prepare('UPDATE biz_sales_invoices SET cogs_paise = ? WHERE id = ?').run(cogs, invoiceId);
    for (const p of payments) db.prepare('INSERT INTO biz_sales_payments (business_id, invoice_id, method, amount_paise, reference, created_by) VALUES (?,?,?,?,?,?)').run(o.businessId, invoiceId, p.method, p.amount, p.reference, o.by ?? null);

    // ledger: cash/bank + receivable = revenue + GST; then COGS against inventory
    const dr = payments.map((p) => ({ code: acc.METHOD_ACCOUNT[p.method], debit: p.amount }));
    if (balance > 0) dr.push({ code: '1100', debit: balance, party: ['customer', customer.id] });
    acc.post(db, { businessId: o.businessId, memo: `Sale INV-${String(no).padStart(5, '0')}`, sourceType: 'sale', sourceId: invoiceId, sourceKey: `sale:${invoiceId}`, by: o.by, lines: [...dr, { code: '4000', credit: total - tax }, { code: '2100', credit: tax }] });
    if (cogs > 0) acc.post(db, { businessId: o.businessId, memo: `COGS INV-${String(no).padStart(5, '0')}`, sourceType: 'sale_cogs', sourceId: invoiceId, sourceKey: `sale:${invoiceId}:cogs`, by: o.by, lines: [{ code: '5000', debit: cogs }, { code: '1200', credit: cogs }] });
    audit(db, { actor: o.by, business: o.businessId, action: 'sale.create', entity: 'invoice', entityId: invoiceId, meta: { total } });
    return { invoice: fullInvoice(db, db.prepare('SELECT * FROM biz_sales_invoices WHERE id = ?').get(invoiceId)) };
  });
}

function receivePayment(db, { businessId, invoiceId, method, amountPaise, key, by, reference = '' }) {
  return tx(db, () => {
    if (key) { const d = db.prepare('SELECT * FROM biz_sales_payments WHERE idempotency_key = ?').get(key); if (d) return { duplicate: true }; }
    const i = db.prepare('SELECT * FROM biz_sales_invoices WHERE id = ? AND business_id = ?').get(invoiceId, businessId);
    if (!i) throw new HttpError(404, 'Invoice not found');
    const balance = i.total_paise - i.returned_paise - i.paid_paise;
    if (amountPaise > balance) throw new HttpError(400, 'That is more than is due on this invoice');
    db.prepare('INSERT INTO biz_sales_payments (business_id, invoice_id, method, amount_paise, reference, idempotency_key, created_by) VALUES (?,?,?,?,?,?,?)').run(businessId, invoiceId, method, amountPaise, reference, key, by);
    db.prepare("UPDATE biz_sales_invoices SET paid_paise = paid_paise + ?, status = CASE WHEN total_paise - returned_paise - paid_paise - ? <= 0 THEN 'paid' ELSE 'partial' END WHERE id = ?").run(amountPaise, amountPaise, invoiceId);
    const payId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    acc.post(db, { businessId, memo: `Receipt ${i.invoice_no}`, sourceType: 'receipt', sourceId: payId, sourceKey: `receipt:${payId}`, by, lines: [{ code: acc.METHOD_ACCOUNT[method], debit: amountPaise }, { code: '1100', credit: amountPaise, party: ['customer', i.customer_id] }] });
    return { ok: true };
  });
}

function createReturn(db, { businessId, invoiceId, items, refundMethod = 'cash', reason = '', key, by }) {
  return tx(db, () => {
    if (key) { const d = db.prepare('SELECT * FROM biz_sales_returns WHERE idempotency_key = ?').get(key); if (d) return { duplicate: true, return: d }; }
    const i = db.prepare('SELECT * FROM biz_sales_invoices WHERE id = ? AND business_id = ?').get(invoiceId, businessId);
    if (!i) throw new HttpError(404, 'Invoice not found');
    let R = 0, taxR = 0, costR = 0;
    const rows = [];
    for (const it of items) {
      const row = db.prepare('SELECT * FROM biz_sales_items WHERE id = ? AND invoice_id = ?').get(Number(it.itemId), invoiceId);
      if (!row) throw new HttpError(404, 'Item not on this invoice');
      const q = int(it.qty, 'Quantity', { min: 1 });
      if (row.returned_qty + q > row.qty) throw new HttpError(409, `Only ${row.qty - row.returned_qty} of ${row.name} can still be returned`);
      // Telescoping rounding: summing partial returns always equals the original line exactly.
      const part = (amt, done, now) => Math.round((amt * now) / row.qty) - Math.round((amt * done) / row.qty);
      const v = part(row.line_total_paise, row.returned_qty, row.returned_qty + q);
      const t = part(row.tax_paise, row.returned_qty, row.returned_qty + q);
      const c = part(row.cost_paise, row.returned_qty, row.returned_qty + q);
      R += v; taxR += t; costR += c;
      rows.push({ row, q, v, t, c });
    }
    const owe = i.total_paise - i.returned_paise - i.paid_paise;
    const refund = Math.max(0, R - owe);
    const arReduce = R - refund;
    const no = `RET-${String(db.prepare('SELECT COUNT(*) n FROM biz_sales_returns WHERE business_id = ?').get(businessId).n + 1).padStart(5, '0')}`;
    const info = db.prepare('INSERT INTO biz_sales_returns (business_id, invoice_id, return_no, subtotal_paise, tax_paise, total_paise, refund_method, reason, idempotency_key, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(businessId, invoiceId, no, R - taxR, taxR, R, refundMethod, reason, key, by);
    const retId = Number(info.lastInsertRowid);
    for (const x of rows) {
      db.prepare('UPDATE biz_sales_items SET returned_qty = returned_qty + ?, returned_cost_paise = returned_cost_paise + ? WHERE id = ?').run(x.q, x.c, x.row.id);
      if (x.row.product_id) inv.moveStock(db, { businessId, branchId: i.branch_id, productId: x.row.product_id, qty: x.q, totalCostPaise: x.c, kind: 'sale_return', sourceType: 'sales_return', sourceId: retId, by });
    }
    db.prepare("UPDATE biz_sales_invoices SET returned_paise = returned_paise + ?, paid_paise = paid_paise - ?, cogs_paise = cogs_paise - ?, status = CASE WHEN total_paise - (returned_paise + ?) <= 0 THEN 'returned' ELSE status END WHERE id = ?").run(R, refund, costR, R, invoiceId);
    const lines = [{ code: '4100', debit: R - taxR }, { code: '2100', debit: taxR }];
    if (refund > 0) lines.push({ code: acc.METHOD_ACCOUNT[refundMethod] || '1000', credit: refund });
    if (arReduce > 0) lines.push({ code: '1100', credit: arReduce, party: ['customer', i.customer_id] });
    acc.post(db, { businessId, memo: `Return ${no} on ${i.invoice_no}`, sourceType: 'sale_return', sourceId: retId, sourceKey: `return:${retId}`, by, lines });
    if (costR > 0) acc.post(db, { businessId, memo: `Return stock ${no}`, sourceType: 'sale_return_cogs', sourceId: retId, sourceKey: `return:${retId}:cogs`, by, lines: [{ code: '1200', debit: costR }, { code: '5000', credit: costR }] });
    audit(db, { actor: by, business: businessId, action: 'sale.return', entity: 'invoice', entityId: invoiceId, meta: { total: R } });
    return { return: db.prepare('SELECT * FROM biz_sales_returns WHERE id = ?').get(retId), refund_paise: refund };
  });
}

function renderInvoiceHtml(inv0) {
  const b = inv0.business;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(inv0.invoice_no)} · ${esc(b.name)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#10121F;font-size:16px}h1{font-size:24px;margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:8px 4px;border-bottom:1px solid #e5e7ef;text-align:left}td.n,th.n{text-align:right}.tot td{font-weight:700;border-bottom:0}small{color:#585D73}@media print{body{padding:0}}</style></head>
<body><h1>${esc(b.name)}</h1><small>${esc(b.address)} ${esc(b.city)} ${b.phone ? '· ' + esc(b.phone) : ''}${b.gstin ? '<br>GSTIN ' + esc(b.gstin) : ''}</small>
<p><strong>Tax invoice ${esc(inv0.invoice_no)}</strong><br><small>${esc(String(inv0.created_at).slice(0, 16))}${inv0.customer_name ? ' · ' + esc(inv0.customer_name) : ''}</small></p>
<table><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr>
${inv0.items.map((i) => `<tr><td>${esc(i.name)}${i.tax_bps ? `<br><small>GST ${(i.tax_bps / 100).toFixed(i.tax_bps % 100 ? 1 : 0)}% incl.</small>` : ''}</td><td class="n">${i.qty}</td><td class="n">${inr(i.unit_price_paise)}</td><td class="n">${inr(i.line_total_paise)}</td></tr>`).join('')}
${inv0.discount_paise ? `<tr><td colspan="3" class="n">Discount</td><td class="n">-${inr(inv0.discount_paise)}</td></tr>` : ''}
<tr><td colspan="3" class="n"><small>GST included</small></td><td class="n"><small>${inr(inv0.tax_paise)}</small></td></tr>
<tr class="tot"><td colspan="3" class="n">Total</td><td class="n">${inr(inv0.total_paise)}</td></tr>
<tr><td colspan="3" class="n">Paid</td><td class="n">${inr(inv0.paid_paise)}</td></tr>
${inv0.balance_paise > 0 ? `<tr class="tot"><td colspan="3" class="n">Balance due</td><td class="n">${inr(inv0.balance_paise)}</td></tr>` : ''}</table>
<small>Thank you for shopping with ${esc(b.name)}.</small></body></html>`;
}

function routes(ctx) {
  const { db } = ctx;
  const r = express.Router();

  r.post('/businesses/:businessId/sales', requireBiz(ctx, 'sales.write'), (req, res) => {
    const key = text(req.get('idempotency-key') || req.body.idempotencyKey, { min: 6, max: 80, name: 'Idempotency key' });
    const out = createInvoice(db, { ...req.body, businessId: req.biz.id, branchId: inv.ownBranch(db, req.biz.id, req.body.branchId), idempotencyKey: key, by: req.user.id, channel: 'pos' });
    res.status(out.duplicate ? 200 : 201).json({ ...out, shareUrl: `${ctx.publicBase(req)}/api/v1/invoices/public/${out.invoice.token}` });
  });
  r.get('/businesses/:businessId/sales', requireBiz(ctx, 'sales.read'), (req, res) => {
    const from = String(req.query.from || '0000-01-01'), to = String(req.query.to || '9999-12-31');
    const rows = db.prepare(`SELECT * FROM biz_sales_invoices WHERE business_id = ? AND substr(created_at,1,10) >= ? AND substr(created_at,1,10) <= ? ${req.query.customerId ? 'AND customer_id = ?' : ''} ORDER BY id DESC LIMIT ?`)
      .all(req.biz.id, from, to, ...(req.query.customerId ? [Number(req.query.customerId)] : []), Math.min(Number(req.query.limit) || 100, 500));
    res.json({ invoices: rows.map((x) => ({ ...x, balance_paise: x.total_paise - x.returned_paise - x.paid_paise })) });
  });
  r.get('/businesses/:businessId/sales/:invoiceId', requireBiz(ctx, 'sales.read'), (req, res) => {
    const i = db.prepare('SELECT * FROM biz_sales_invoices WHERE id = ? AND business_id = ?').get(Number(req.params.invoiceId), req.biz.id);
    if (!i) throw new HttpError(404, 'Invoice not found');
    res.json({ invoice: fullInvoice(db, i), shareUrl: `${ctx.publicBase(req)}/api/v1/invoices/public/${i.token}` });
  });
  r.post('/businesses/:businessId/sales/:invoiceId/payments', requireBiz(ctx, 'sales.write'), (req, res) => {
    const out = receivePayment(db, { businessId: req.biz.id, invoiceId: Number(req.params.invoiceId), method: METHODS.includes(req.body.method) ? req.body.method : 'cash', amountPaise: int(req.body.amountPaise, 'Amount', { min: 1 }), key: text(req.body.idempotencyKey, { max: 80 }) || null, by: req.user.id, reference: text(req.body.reference, { max: 80 }) });
    res.status(out.duplicate ? 200 : 201).json(out);
  });
  r.post('/businesses/:businessId/sales/:invoiceId/returns', requireBiz(ctx, 'sales.refund'), (req, res) => {
    const out = createReturn(db, { businessId: req.biz.id, invoiceId: Number(req.params.invoiceId), items: Array.isArray(req.body.items) ? req.body.items : [], refundMethod: METHODS.includes(req.body.refundMethod) ? req.body.refundMethod : 'cash', reason: text(req.body.reason, { max: 200 }), key: text(req.get('idempotency-key') || req.body.idempotencyKey, { min: 6, max: 80, name: 'Idempotency key' }), by: req.user.id });
    res.status(out.duplicate ? 200 : 201).json(out);
  });

  // Public, shareable invoice (WhatsApp / print to PDF). The token is unguessable and read-only.
  r.get('/invoices/public/:token', (req, res) => {
    const i = db.prepare('SELECT * FROM biz_sales_invoices WHERE token = ?').get(String(req.params.token));
    if (!i) return res.status(404).type('html').send('<h1>Invoice not found</h1>');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").type('html').send(renderInvoiceHtml(fullInvoice(db, i)));
  });

  /* ---- customers ---- */
  r.post('/businesses/:businessId/customers', requireBiz(ctx, 'customers.write'), (req, res) => {
    const b = req.body;
    const info = db.prepare('INSERT INTO biz_customers (business_id, user_id, kind, name, phone, email, gstin, credit_limit_paise, notes) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(req.biz.id, b.userId || null, b.kind === 'patient' ? 'patient' : 'customer', text(b.name, { min: 2, max: 100, name: 'Name' }), text(b.phone, { max: 20 }), text(b.email, { max: 100 }), text(b.gstin, { max: 15 }).toUpperCase(), int(b.creditLimitPaise || 0, 'Credit limit'), text(b.notes, { max: 300 }));
    res.status(201).json({ customer: db.prepare('SELECT * FROM biz_customers WHERE id = ?').get(info.lastInsertRowid) });
  });
  r.get('/businesses/:businessId/customers', requireBiz(ctx, 'customers.read'), (req, res) => {
    const q = String(req.query.q || '').trim().replace(/[%_]/g, '');
    const bal = new Map(acc.partyBalances(db, req.biz.id, '1100', 'customer').map((x) => [x.party_id, x.balance_paise]));
    const rows = db.prepare(`SELECT * FROM biz_customers WHERE business_id = ? ${q ? 'AND (name LIKE ? OR phone LIKE ?)' : ''} ORDER BY name LIMIT 300`).all(req.biz.id, ...(q ? [`%${q}%`, `%${q}%`] : []));
    // Cashiers see names and phones but not credit/financial detail they have no permission for.
    const fin = req.perms.includes('reports.read');
    res.json({ customers: rows.map((c) => {
      const extra = fin ? { outstanding_paise: bal.get(c.id) || 0 } : { credit_limit_paise: undefined };
      return { ...c, ...extra };
    }) });
  });
  r.get('/businesses/:businessId/customers/:id', requireBiz(ctx, 'customers.read'), (req, res) => {
    const c = ownCustomer(db, req.biz.id, req.params.id);
    res.json({
      customer: { ...c, outstanding_paise: customerOutstanding(db, req.biz.id, c.id) },
      invoices: db.prepare('SELECT * FROM biz_sales_invoices WHERE business_id = ? AND customer_id = ? ORDER BY id DESC LIMIT 50').all(req.biz.id, c.id),
      communications: db.prepare("SELECT * FROM biz_comms WHERE business_id = ? AND party_type = 'customer' AND party_id = ? ORDER BY id DESC LIMIT 50").all(req.biz.id, c.id),
    });
  });
  r.post('/businesses/:businessId/customers/:id/notes', requireBiz(ctx, 'customers.write'), (req, res) => {
    const c = ownCustomer(db, req.biz.id, req.params.id);
    db.prepare("INSERT INTO biz_comms (business_id, party_type, party_id, channel, body, created_by) VALUES (?, 'customer', ?, ?, ?, ?)").run(req.biz.id, c.id, text(req.body.channel, { max: 20 }) || 'note', text(req.body.body, { min: 1, max: 500, name: 'Note' }), req.user.id);
    res.status(201).json({ ok: true });
  });
  // Collect an on-account payment: settles the customer's oldest unpaid invoices first.
  r.post('/businesses/:businessId/customers/:id/payments', requireBiz(ctx, 'sales.write'), (req, res) => {
    const c = ownCustomer(db, req.biz.id, req.params.id);
    const amount = int(req.body.amountPaise, 'Amount', { min: 1 });
    const method = METHODS.includes(req.body.method) ? req.body.method : 'cash';
    const key = text(req.body.idempotencyKey, { min: 6, max: 80, name: 'Idempotency key' });
    const out = tx(db, () => {
      if (db.prepare('SELECT 1 FROM biz_sales_payments WHERE idempotency_key LIKE ?').get(`${key}:%`)) return { duplicate: true };
      let left = amount;
      const open = db.prepare("SELECT * FROM biz_sales_invoices WHERE business_id = ? AND customer_id = ? AND status IN ('credit','partial') ORDER BY id").all(req.biz.id, c.id);
      let n = 0;
      for (const i of open) {
        if (!left) break;
        const due = i.total_paise - i.returned_paise - i.paid_paise;
        const take = Math.min(left, due);
        if (take > 0) { receivePayment(db, { businessId: req.biz.id, invoiceId: i.id, method, amountPaise: take, key: `${key}:${n++}`, by: req.user.id }); left -= take; }
      }
      if (left) throw new HttpError(400, 'That is more than this customer owes');
      return { ok: true, applied_paise: amount };
    });
    res.status(out.duplicate ? 200 : 201).json(out);
  });
  return r;
}

module.exports = { routes, createInvoice, createReturn, receivePayment, fullInvoice, customerOutstanding };

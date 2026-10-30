// Inventory: an immutable stock-movement ledger plus a projected balance table. Stock is never changed except
// through moveStock(), which records the movement and updates the projection in one transaction. Costing is
// weighted-average, tracked as exact total value so the stock ledger always reconciles with the accounting ledger.
const express = require('express');
const { tx, audit, int, text, today, json, HttpError } = require('./core');
const { requireBiz } = require('./perms');
const acc = require('./accounting');

function defaultBranch(db, businessId) {
  return db.prepare('SELECT id FROM business_branches WHERE business_id = ? ORDER BY is_default DESC, id LIMIT 1').get(businessId).id;
}
function ownBranch(db, businessId, branchId) {
  const b = branchId ? db.prepare('SELECT id FROM business_branches WHERE id = ? AND business_id = ?').get(Number(branchId), businessId) : null;
  if (branchId && !b) throw new HttpError(404, 'Branch not found');
  return b ? b.id : defaultBranch(db, businessId);
}
function ownProduct(db, businessId, productId) {
  const p = db.prepare('SELECT * FROM biz_products WHERE id = ? AND business_id = ?').get(Number(productId), businessId);
  if (!p) throw new HttpError(404, 'Product not found');
  return p;
}

function balanceRow(db, businessId, branchId, productId) {
  db.prepare('INSERT OR IGNORE INTO biz_stock_balance (business_id, branch_id, product_id) VALUES (?,?,?)').run(businessId, branchId, productId);
  return db.prepare('SELECT * FROM biz_stock_balance WHERE branch_id = ? AND product_id = ?').get(branchId, productId);
}

/**
 * The only way stock changes. qty > 0 is inbound (needs a cost), qty < 0 outbound (cost comes from the average).
 * Idempotent on (sourceType, sourceId, productId, kind, batchNo): replaying returns the first result and changes nothing.
 * Returns { qty, costPaise (total value moved, positive), duplicate? }.
 */
function moveStock(db, o) {
  return tx(db, () => {
    const product = o.product || db.prepare('SELECT * FROM biz_products WHERE id = ?').get(o.productId);
    if (!product) throw new HttpError(404, 'Product not found');
    if (!product.track_stock || product.is_service) return { qty: Math.abs(o.qty), costPaise: 0, skipped: true };
    const q = Math.abs(o.qty);
    if (!Number.isInteger(o.qty) || q === 0) throw new HttpError(400, 'Quantity must be a whole number');
    const batch = product.has_batches ? (o.batchNo || 'DEFAULT') : '';
    const dup = db.prepare('SELECT * FROM biz_stock_movements WHERE source_type = ? AND source_id = ? AND product_id = ? AND kind = ? AND batch_no = ?')
      .get(o.sourceType, String(o.sourceId), product.id, o.kind, batch);
    if (dup) return { qty: q, costPaise: Math.abs(dup.value_delta_paise), duplicate: true };

    const bal = balanceRow(db, o.businessId, o.branchId, product.id);
    const record = (qtyDelta, valueDelta, batchNo, expiry) => {
      db.prepare('INSERT INTO biz_stock_movements (business_id, branch_id, product_id, kind, qty_delta, unit_cost_paise, value_delta_paise, batch_no, expiry, source_type, source_id, reference, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(o.businessId, o.branchId, product.id, o.kind, qtyDelta, Math.round(Math.abs(valueDelta) / Math.abs(qtyDelta)), valueDelta, batchNo, expiry || '', o.sourceType, String(o.sourceId), o.reference || '', o.note || '', o.by ?? null);
    };

    if (o.qty > 0) {
      const total = o.totalCostPaise ?? Math.round((o.unitCostPaise || 0) * q);
      const qty = bal.qty + q, value = bal.value_paise + total;
      db.prepare('UPDATE biz_stock_balance SET qty = ?, value_paise = ?, avg_cost_paise = ? WHERE branch_id = ? AND product_id = ?')
        .run(qty, value, qty > 0 ? Math.round(value / qty) : bal.avg_cost_paise, o.branchId, product.id);
      if (product.has_batches) {
        db.prepare('INSERT INTO biz_batches (business_id, branch_id, product_id, batch_no, expiry, qty_remaining, unit_cost_paise) VALUES (?,?,?,?,?,?,?) ON CONFLICT(branch_id, product_id, batch_no) DO UPDATE SET qty_remaining = qty_remaining + excluded.qty_remaining, expiry = CASE WHEN excluded.expiry != \'\' THEN excluded.expiry ELSE expiry END')
          .run(o.businessId, o.branchId, product.id, batch, o.expiry || '', q, Math.round(total / q));
      }
      record(q, total, batch, o.expiry);
      return { qty: q, costPaise: total };
    }

    // outbound: consume a reservation first when this sale was reserved, then check availability
    const reservedHere = o.consumeReservation ? (db.prepare("SELECT qty FROM biz_reservations WHERE source_type = ? AND source_id = ? AND product_id = ? AND status = 'active'").get(o.reserveSourceType || o.sourceType, String(o.reserveSourceId ?? o.sourceId), product.id)?.qty || 0) : 0;
    const available = bal.qty - (bal.reserved - reservedHere);
    const allowNeg = o.allowNegative ?? db.prepare('SELECT allow_negative_stock FROM businesses WHERE id = ?').get(o.businessId).allow_negative_stock;
    if (q > available && !allowNeg) throw new HttpError(409, `Not enough stock for ${product.name} (only ${Math.max(0, available)} available)`);
    const onHand = Math.max(bal.qty, 0);
    const covered = Math.min(q, onHand);
    const coveredCost = covered === 0 ? 0 : covered === bal.qty ? bal.value_paise : Math.round((bal.value_paise * covered) / bal.qty);
    const cost = coveredCost + (q - covered) * bal.avg_cost_paise;
    const qty = bal.qty - q, value = bal.value_paise - coveredCost;
    db.prepare('UPDATE biz_stock_balance SET qty = ?, value_paise = ?, avg_cost_paise = ?, reserved = reserved - ? WHERE branch_id = ? AND product_id = ?')
      .run(qty, value, qty > 0 ? Math.round(value / qty) : bal.avg_cost_paise, reservedHere, o.branchId, product.id);
    if (reservedHere) db.prepare("UPDATE biz_reservations SET status = 'consumed' WHERE source_type = ? AND source_id = ? AND product_id = ?").run(o.reserveSourceType || o.sourceType, String(o.reserveSourceId ?? o.sourceId), product.id);

    if (product.has_batches) {
      // first-expiry-first-out across batches; one movement row per batch touched
      let left = q;
      const rows = db.prepare("SELECT * FROM biz_batches WHERE branch_id = ? AND product_id = ? AND qty_remaining > 0 ORDER BY CASE WHEN expiry = '' THEN 1 ELSE 0 END, expiry, id").all(o.branchId, product.id);
      let costLeft = cost;
      for (const b of rows) {
        if (!left) break;
        const take = Math.min(left, b.qty_remaining);
        const part = take === q ? costLeft : Math.round((cost * take) / q);
        db.prepare('UPDATE biz_batches SET qty_remaining = qty_remaining - ? WHERE id = ?').run(take, b.id);
        record(-take, -part, b.batch_no, b.expiry);
        left -= take; costLeft -= part;
      }
      if (left) record(-left, -costLeft, batch, ''); // negative-stock remainder
    } else {
      record(-q, -cost, '', '');
    }
    return { qty: q, costPaise: cost };
  });
}

function reserve(db, { businessId, branchId, productId, qty, sourceType, sourceId, now }) {
  return tx(db, () => {
    const p = db.prepare('SELECT * FROM biz_products WHERE id = ?').get(productId);
    if (!p.track_stock || p.is_service) return true;
    const dup = db.prepare('SELECT id FROM biz_reservations WHERE source_type = ? AND source_id = ? AND product_id = ?').get(sourceType, String(sourceId), productId);
    if (dup) return true;
    const bal = balanceRow(db, businessId, branchId, productId);
    if (qty > bal.qty - bal.reserved) throw new HttpError(409, `Not enough stock for ${p.name} (only ${Math.max(0, bal.qty - bal.reserved)} available)`);
    db.prepare('UPDATE biz_stock_balance SET reserved = reserved + ? WHERE branch_id = ? AND product_id = ?').run(qty, branchId, productId);
    db.prepare('INSERT INTO biz_reservations (business_id, branch_id, product_id, qty, source_type, source_id, created_at) VALUES (?,?,?,?,?,?,?)').run(businessId, branchId, productId, qty, sourceType, String(sourceId), now ?? Date.now());
    return true;
  });
}
function releaseReservations(db, sourceType, sourceId) {
  return tx(db, () => {
    const rows = db.prepare("SELECT * FROM biz_reservations WHERE source_type = ? AND source_id = ? AND status = 'active'").all(sourceType, String(sourceId));
    for (const r of rows) {
      db.prepare('UPDATE biz_stock_balance SET reserved = reserved - ? WHERE branch_id = ? AND product_id = ?').run(r.qty, r.branch_id, r.product_id);
      db.prepare("UPDATE biz_reservations SET status = 'released' WHERE id = ?").run(r.id);
    }
    return rows.length;
  });
}

/** Adjustment with matching accounting: opening stock, found/extra stock, damage, loss, recount. */
function adjust(db, { businessId, branchId, productId, qtyDelta, reason, unitCostPaise, batchNo, expiry, by, key, note }) {
  return tx(db, () => {
    const product = ownProduct(db, businessId, productId);
    const kind = { opening: 'opening', damage: 'damage', loss: 'loss', found: 'adjustment', recount: 'reconcile', adjustment: 'adjustment' }[reason] || 'adjustment';
    const sourceId = key || `adj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (qtyDelta === 0) return { qty: 0 };
    const mv = qtyDelta > 0
      ? moveStock(db, { businessId, branchId, product, qty: qtyDelta, unitCostPaise: unitCostPaise ?? product.purchase_price_paise, kind, sourceType: 'adjustment', sourceId, batchNo, expiry, by, note })
      : moveStock(db, { businessId, branchId, product, qty: qtyDelta, kind, sourceType: 'adjustment', sourceId, batchNo, by, note, allowNegative: false });
    if (mv.duplicate || mv.skipped) return mv;
    const v = mv.costPaise;
    if (qtyDelta > 0) acc.post(db, { businessId, memo: `Stock ${reason}: ${product.name}`, sourceType: 'stock_adjustment', sourceId, sourceKey: `adj:${sourceId}:${product.id}`, by, lines: [{ code: '1200', debit: v }, { code: reason === 'opening' ? '3000' : '5100', credit: v }] });
    else acc.post(db, { businessId, memo: `Stock ${reason}: ${product.name}`, sourceType: 'stock_adjustment', sourceId, sourceKey: `adj:${sourceId}:${product.id}`, by, lines: [{ code: '5100', debit: v }, { code: '1200', credit: v }] });
    audit(db, { actor: by, business: businessId, action: `stock.${reason}`, entity: 'product', entityId: product.id, meta: { qtyDelta } });
    return mv;
  });
}

function valuation(db, businessId) {
  const rows = db.prepare(`SELECT p.id, p.sku, p.name, SUM(b.qty) AS qty, SUM(b.value_paise) AS value_paise FROM biz_stock_balance b JOIN biz_products p ON p.id = b.product_id
    WHERE b.business_id = ? GROUP BY p.id HAVING SUM(b.qty) != 0 OR SUM(b.value_paise) != 0 ORDER BY p.name`).all(businessId);
  const total = rows.reduce((s, r) => s + r.value_paise, 0);
  const ledger = acc.balances(db, businessId).find((a) => a.code === '1200')?.balance || 0;
  return { items: rows, total_paise: total, ledger_paise: ledger, difference_paise: total - ledger };
}

function routes(ctx) {
  const { db } = ctx;
  const r = express.Router();

  /* ---- products ---- */
  const readProduct = (b, existing = {}) => {
    const sell = b.sellingPricePaise ?? existing.selling_price_paise;
    return {
      sku: text(b.sku ?? existing.sku, { min: 1, max: 40, name: 'SKU' }),
      barcode: text(b.barcode ?? existing.barcode ?? '', { max: 40 }),
      name: text(b.name ?? existing.name, { min: 2, max: 120, name: 'Name' }),
      description: text(b.description ?? existing.description ?? '', { max: 1000 }),
      category: text(b.category ?? existing.category ?? '', { max: 60 }),
      unit: text(b.unit ?? existing.unit ?? 'pcs', { max: 12 }) || 'pcs',
      purchase_price_paise: int(b.purchasePricePaise ?? existing.purchase_price_paise ?? 0, 'Purchase price', { max: 1e10 }),
      selling_price_paise: int(sell, 'Selling price', { max: 1e10 }),
      tax_bps: int(b.taxBps ?? existing.tax_bps ?? 0, 'Tax', { max: 4000 }),
      hsn: text(b.hsn ?? existing.hsn ?? '', { max: 12 }),
      is_service: b.isService !== undefined ? (b.isService ? 1 : 0) : existing.is_service || 0,
      track_stock: b.trackStock !== undefined ? (b.trackStock ? 1 : 0) : existing.track_stock ?? 1,
      has_batches: b.hasBatches !== undefined ? (b.hasBatches ? 1 : 0) : existing.has_batches || 0,
      has_serials: b.hasSerials !== undefined ? (b.hasSerials ? 1 : 0) : existing.has_serials || 0,
      warranty_months: int(b.warrantyMonths ?? existing.warranty_months ?? 0, 'Warranty', { max: 240 }),
      reorder_level: int(b.reorderLevel ?? existing.reorder_level ?? 0, 'Reorder level', { max: 1e7 }),
      variant_label: text(b.variantLabel ?? existing.variant_label ?? '', { max: 60 }),
      published: b.published !== undefined ? (b.published ? 1 : 0) : existing.published || 0,
      image: text(b.image ?? existing.image ?? '', { max: 300 }),
    };
  };

  r.post('/businesses/:businessId/products', requireBiz(ctx, 'products.write'), (req, res) => {
    const d = readProduct(req.body);
    const out = tx(db, () => {
      if (db.prepare('SELECT 1 FROM biz_products WHERE business_id = ? AND sku = ?').get(req.biz.id, d.sku)) throw new HttpError(409, 'That SKU already exists');
      if (d.barcode && db.prepare('SELECT 1 FROM biz_products WHERE business_id = ? AND barcode = ?').get(req.biz.id, d.barcode)) throw new HttpError(409, 'That barcode is already used');
      const parent = req.body.parentId ? ownProduct(db, req.biz.id, req.body.parentId).id : null;
      const cols = Object.keys(d);
      const info = db.prepare(`INSERT INTO biz_products (business_id, parent_id, ${cols.join(',')}) VALUES (?,?,${cols.map(() => '?').join(',')})`).run(req.biz.id, parent, ...cols.map((c) => d[c]));
      const id = Number(info.lastInsertRowid);
      const opening = Number(req.body.openingQty) || 0;
      if (opening > 0 && !d.is_service && d.track_stock) {
        adjust(db, { businessId: req.biz.id, branchId: ownBranch(db, req.biz.id, req.body.branchId), productId: id, qtyDelta: Math.round(opening), reason: 'opening', unitCostPaise: d.purchase_price_paise, batchNo: req.body.batchNo, expiry: req.body.expiry, by: req.user.id, key: `open-${id}` });
      }
      audit(db, { actor: req.user.id, business: req.biz.id, action: 'product.create', entity: 'product', entityId: id });
      return db.prepare('SELECT * FROM biz_products WHERE id = ?').get(id);
    });
    res.status(201).json({ product: out });
  });

  r.patch('/businesses/:businessId/products/:id', requireBiz(ctx, 'products.write'), (req, res) => {
    const p = ownProduct(db, req.biz.id, req.params.id);
    const d = readProduct(req.body, p);
    const dup = db.prepare('SELECT id FROM biz_products WHERE business_id = ? AND (sku = ? OR (barcode != \'\' AND barcode = ?)) AND id != ?').get(req.biz.id, d.sku, d.barcode, p.id);
    if (dup) throw new HttpError(409, 'SKU or barcode already used by another product');
    const cols = Object.keys(d);
    db.prepare(`UPDATE biz_products SET ${cols.map((c) => `${c} = ?`).join(', ')}, active = ? WHERE id = ?`).run(...cols.map((c) => d[c]), req.body.active === false ? 0 : 1, p.id);
    res.json({ product: db.prepare('SELECT * FROM biz_products WHERE id = ?').get(p.id) });
  });

  r.get('/businesses/:businessId/products', requireBiz(ctx, 'products.read'), (req, res) => {
    const q = String(req.query.q || '').trim();
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const rows = db.prepare(`SELECT p.*, COALESCE(SUM(b.qty),0) AS qty, COALESCE(SUM(b.reserved),0) AS reserved, COALESCE(SUM(b.value_paise),0) AS value_paise
      FROM biz_products p LEFT JOIN biz_stock_balance b ON b.product_id = p.id
      WHERE p.business_id = ? AND p.active = 1 ${q ? 'AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode = ?)' : ''} ${req.query.lowStock ? 'AND p.track_stock = 1' : ''}
      GROUP BY p.id ORDER BY p.name LIMIT ?`).all(req.biz.id, ...(q ? [like, like, q] : []), Math.min(Number(req.query.limit) || 100, 500));
    const out = rows.map((p) => ({ ...p, available: p.qty - p.reserved, low: !!p.track_stock && !p.is_service && p.reorder_level > 0 && p.qty <= p.reorder_level }));
    res.json({ products: req.query.lowStock ? out.filter((p) => p.low) : out });
  });
  r.get('/businesses/:businessId/products/:id/purchase-history', requireBiz(ctx, 'purchases.read'), (req, res) => {
    ownProduct(db, req.biz.id, req.params.id);
    res.json({ history: db.prepare(`SELECT g.id AS grn_id, g.grn_no, g.created_at, s.name AS supplier, i.qty, i.unit_cost_paise FROM biz_grn_items i JOIN biz_goods_receipts g ON g.id = i.grn_id JOIN biz_suppliers s ON s.id = g.supplier_id WHERE g.business_id = ? AND i.product_id = ? ORDER BY g.id DESC LIMIT 50`).all(req.biz.id, req.params.id) });
  });
  r.post('/businesses/:businessId/products/:id/serials', requireBiz(ctx, 'products.write'), (req, res) => {
    const p = ownProduct(db, req.biz.id, req.params.id);
    if (!p.has_serials) throw new HttpError(400, 'This product does not track serial numbers');
    const list = (Array.isArray(req.body.serials) ? req.body.serials : []).map((s) => text(String(s), { max: 60 })).filter(Boolean).slice(0, 500);
    const ins = db.prepare('INSERT OR IGNORE INTO biz_serials (business_id, product_id, serial) VALUES (?,?,?)');
    const added = list.reduce((n, sn) => n + ins.run(req.biz.id, p.id, sn).changes, 0);
    res.status(201).json({ added });
  });

  /* ---- inventory ---- */
  r.get('/businesses/:businessId/inventory', requireBiz(ctx, 'inventory.read'), (req, res) => {
    const branchId = req.query.branchId ? ownBranch(db, req.biz.id, req.query.branchId) : null;
    const rows = db.prepare(`SELECT p.id, p.sku, p.name, p.unit, p.reorder_level, p.has_batches, b.branch_id, b.qty, b.reserved, b.value_paise, b.avg_cost_paise
      FROM biz_stock_balance b JOIN biz_products p ON p.id = b.product_id WHERE b.business_id = ? ${branchId ? 'AND b.branch_id = ?' : ''} AND p.active = 1 ORDER BY p.name`).all(req.biz.id, ...(branchId ? [branchId] : []));
    res.json({ inventory: rows.map((x) => ({ ...x, available: x.qty - x.reserved, low: x.reorder_level > 0 && x.qty <= x.reorder_level })) });
  });
  r.get('/businesses/:businessId/inventory/valuation', requireBiz(ctx, 'reports.read'), (req, res) => res.json(valuation(db, req.biz.id)));
  r.get('/businesses/:businessId/inventory/low-stock', requireBiz(ctx, 'inventory.read'), (req, res) => res.json({ items: lowStock(db, req.biz.id) }));
  r.get('/businesses/:businessId/inventory/expiring', requireBiz(ctx, 'inventory.read'), (req, res) => res.json({ batches: expiring(db, req.biz.id, Number(req.query.days) || 30) }));
  r.get('/businesses/:businessId/inventory/movements', requireBiz(ctx, 'inventory.read'), (req, res) => {
    const pid = Number(req.query.productId) || 0;
    res.json({ movements: db.prepare(`SELECT m.*, p.name FROM biz_stock_movements m JOIN biz_products p ON p.id = m.product_id WHERE m.business_id = ? ${pid ? 'AND m.product_id = ?' : ''} ORDER BY m.id DESC LIMIT 200`).all(req.biz.id, ...(pid ? [pid] : [])) });
  });

  r.post('/businesses/:businessId/inventory/adjust', requireBiz(ctx, 'inventory.write'), (req, res) => {
    const b = req.body;
    const reason = ['opening', 'damage', 'loss', 'found', 'adjustment'].includes(b.reason) ? b.reason : 'adjustment';
    const delta = int(b.qtyDelta, 'Quantity', { min: -1e7, max: 1e7 });
    if (['damage', 'loss'].includes(reason) && delta > 0) throw new HttpError(400, 'Damage and loss must reduce stock');
    const mv = adjust(db, { businessId: req.biz.id, branchId: ownBranch(db, req.biz.id, b.branchId), productId: b.productId, qtyDelta: delta, reason, unitCostPaise: b.unitCostPaise, batchNo: b.batchNo, expiry: b.expiry, by: req.user.id, key: text(b.idempotencyKey, { max: 80 }) || null, note: text(b.note, { max: 200 }) });
    res.status(201).json({ ok: true, movement: mv });
  });

  r.post('/businesses/:businessId/inventory/transfer', requireBiz(ctx, 'inventory.write'), (req, res) => {
    const from = ownBranch(db, req.biz.id, req.body.fromBranchId), to = ownBranch(db, req.biz.id, req.body.toBranchId);
    if (from === to) throw new HttpError(400, 'Choose two different branches');
    const qty = int(req.body.qty, 'Quantity', { min: 1, max: 1e7 });
    const p = ownProduct(db, req.biz.id, req.body.productId);
    const out = tx(db, () => {
      const t = db.prepare('INSERT INTO biz_stock_transfers (business_id, from_branch_id, to_branch_id, product_id, qty, created_by) VALUES (?,?,?,?,?,?)').run(req.biz.id, from, to, p.id, qty, req.user.id);
      const id = Number(t.lastInsertRowid);
      const o = moveStock(db, { businessId: req.biz.id, branchId: from, product: p, qty: -qty, kind: 'transfer_out', sourceType: 'transfer', sourceId: id, by: req.user.id });
      moveStock(db, { businessId: req.biz.id, branchId: to, product: p, qty, totalCostPaise: o.costPaise, kind: 'transfer_in', sourceType: 'transfer', sourceId: id, by: req.user.id });
      audit(db, { actor: req.user.id, business: req.biz.id, action: 'stock.transfer', entity: 'product', entityId: p.id, meta: { from, to, qty } });
      return { id };
    });
    res.status(201).json(out);
  });

  // Physical count: the difference between counted and system stock is posted as recount adjustments.
  r.post('/businesses/:businessId/inventory/reconcile', requireBiz(ctx, 'inventory.write'), (req, res) => {
    const branchId = ownBranch(db, req.biz.id, req.body.branchId);
    const counts = Array.isArray(req.body.counts) ? req.body.counts.slice(0, 1000) : [];
    const stamp = Date.now();
    const result = tx(db, () => counts.map((c) => {
      const p = ownProduct(db, req.biz.id, c.productId);
      const bal = balanceRow(db, req.biz.id, branchId, p.id);
      const diff = int(c.counted, 'Counted', { max: 1e7 }) - bal.qty;
      if (diff) adjust(db, { businessId: req.biz.id, branchId, productId: p.id, qtyDelta: diff, reason: 'recount', unitCostPaise: bal.avg_cost_paise || p.purchase_price_paise, by: req.user.id, key: `recount-${stamp}-${p.id}` });
      return { productId: p.id, system: bal.qty, counted: bal.qty + diff, difference: diff };
    }));
    res.status(201).json({ result });
  });
  return r;
}

function lowStock(db, businessId) {
  return db.prepare(`SELECT p.id, p.sku, p.name, p.reorder_level, COALESCE(SUM(b.qty),0) AS qty FROM biz_products p LEFT JOIN biz_stock_balance b ON b.product_id = p.id
    WHERE p.business_id = ? AND p.active = 1 AND p.track_stock = 1 AND p.is_service = 0 AND p.reorder_level > 0 GROUP BY p.id HAVING qty <= p.reorder_level ORDER BY qty LIMIT 50`).all(businessId);
}
function expiring(db, businessId, days = 30, now = Date.now()) {
  const limit = today(now + days * 86400000);
  return db.prepare(`SELECT b.id, p.name, p.sku, b.batch_no, b.expiry, b.qty_remaining FROM biz_batches b JOIN biz_products p ON p.id = b.product_id
    WHERE b.business_id = ? AND b.qty_remaining > 0 AND b.expiry != '' AND b.expiry <= ? ORDER BY b.expiry LIMIT 100`).all(businessId, limit);
}

module.exports = { routes, moveStock, reserve, releaseReservations, adjust, valuation, defaultBranch, ownBranch, ownProduct, lowStock, expiring, balanceRow };

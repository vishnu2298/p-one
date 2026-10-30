// Suppliers, purchase orders, goods receipts, supplier payments and purchase returns.
// Stock rises only when goods are *received* (GRN), never when an order is merely placed.
const express = require('express');
const { tx, audit, int, text, pct, today, HttpError } = require('./core');
const { requireBiz } = require('./perms');
const acc = require('./accounting');
const inv = require('./inventory');

const nextNo = (db, table, col, prefix, businessId) => {
  const n = db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE business_id = ?`).get(businessId).n + 1;
  return `${prefix}-${String(n).padStart(5, '0')}`;
};
const outstanding = (db, businessId, supplierId) => acc.partyBalances(db, businessId, '2000', 'supplier').find((x) => x.party_id === supplierId)?.balance_paise || 0;

function ownSupplier(db, businessId, id) {
  const s = db.prepare('SELECT * FROM biz_suppliers WHERE id = ? AND business_id = ?').get(Number(id), businessId);
  if (!s) throw new HttpError(404, 'Supplier not found');
  return s;
}

function recordSupplierPayment(db, { businessId, supplierId, amountPaise, method, grnId = null, reference = '', key = null, by }) {
  return tx(db, () => {
    if (key) { const d = db.prepare('SELECT * FROM biz_supplier_payments WHERE idempotency_key = ?').get(key); if (d) return { ...d, duplicate: true }; }
    const due = outstanding(db, businessId, supplierId);
    if (amountPaise > due) throw new HttpError(400, 'That is more than you owe this supplier');
    const info = db.prepare('INSERT INTO biz_supplier_payments (business_id, supplier_id, grn_id, amount_paise, method, reference, idempotency_key, created_by) VALUES (?,?,?,?,?,?,?,?)').run(businessId, supplierId, grnId, amountPaise, method, reference, key, by);
    const id = Number(info.lastInsertRowid);
    acc.post(db, { businessId, memo: 'Supplier payment', sourceType: 'supplier_payment', sourceId: id, sourceKey: `spay:${id}`, by, lines: [{ code: '2000', debit: amountPaise, party: ['supplier', supplierId] }, { code: acc.METHOD_ACCOUNT[method] || '1000', credit: amountPaise }] });
    return db.prepare('SELECT * FROM biz_supplier_payments WHERE id = ?').get(id);
  });
}

function routes(ctx) {
  const { db } = ctx;
  const r = express.Router();

  r.post('/businesses/:businessId/suppliers', requireBiz(ctx, 'suppliers.write'), (req, res) => {
    const b = req.body;
    const info = db.prepare('INSERT INTO biz_suppliers (business_id, name, phone, email, gstin, address, credit_limit_paise, notes) VALUES (?,?,?,?,?,?,?,?)')
      .run(req.biz.id, text(b.name, { min: 2, max: 100, name: 'Name' }), text(b.phone, { max: 20 }), text(b.email, { max: 100 }), text(b.gstin, { max: 15 }).toUpperCase(), text(b.address, { max: 200 }), int(b.creditLimitPaise || 0, 'Credit limit'), text(b.notes, { max: 300 }));
    res.status(201).json({ supplier: db.prepare('SELECT * FROM biz_suppliers WHERE id = ?').get(info.lastInsertRowid) });
  });
  r.get('/businesses/:businessId/suppliers', requireBiz(ctx, 'suppliers.read'), (req, res) => {
    const bal = new Map(acc.partyBalances(db, req.biz.id, '2000', 'supplier').map((x) => [x.party_id, x.balance_paise]));
    res.json({ suppliers: db.prepare('SELECT * FROM biz_suppliers WHERE business_id = ? ORDER BY name').all(req.biz.id).map((s) => ({ ...s, outstanding_paise: bal.get(s.id) || 0 })) });
  });
  r.get('/businesses/:businessId/suppliers/:id', requireBiz(ctx, 'suppliers.read'), (req, res) => {
    const s = ownSupplier(db, req.biz.id, req.params.id);
    res.json({
      supplier: { ...s, outstanding_paise: outstanding(db, req.biz.id, s.id) },
      receipts: db.prepare('SELECT * FROM biz_goods_receipts WHERE business_id = ? AND supplier_id = ? ORDER BY id DESC LIMIT 50').all(req.biz.id, s.id),
      payments: db.prepare('SELECT * FROM biz_supplier_payments WHERE business_id = ? AND supplier_id = ? ORDER BY id DESC LIMIT 50').all(req.biz.id, s.id),
      communications: db.prepare("SELECT * FROM biz_comms WHERE business_id = ? AND party_type = 'supplier' AND party_id = ? ORDER BY id DESC LIMIT 50").all(req.biz.id, s.id),
    });
  });
  r.post('/businesses/:businessId/suppliers/:id/notes', requireBiz(ctx, 'suppliers.write'), (req, res) => {
    const s = ownSupplier(db, req.biz.id, req.params.id);
    db.prepare("INSERT INTO biz_comms (business_id, party_type, party_id, channel, body, created_by) VALUES (?, 'supplier', ?, ?, ?, ?)").run(req.biz.id, s.id, text(req.body.channel, { max: 20 }) || 'note', text(req.body.body, { min: 1, max: 500, name: 'Note' }), req.user.id);
    res.status(201).json({ ok: true });
  });

  r.post('/businesses/:businessId/suppliers/:id/payments', requireBiz(ctx, 'purchases.write'), (req, res) => {
    const s = ownSupplier(db, req.biz.id, req.params.id);
    const p = recordSupplierPayment(db, { businessId: req.biz.id, supplierId: s.id, amountPaise: int(req.body.amountPaise, 'Amount', { min: 1 }), method: ['cash', 'upi', 'bank', 'card'].includes(req.body.method) ? req.body.method : 'cash', reference: text(req.body.reference, { max: 80 }), key: text(req.body.idempotencyKey, { max: 80 }) || null, by: req.user.id });
    res.status(p.duplicate ? 200 : 201).json({ payment: p });
  });

  /* ---- purchase orders ---- */
  const readItems = (items, businessId) => {
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Add at least one item');
    return items.slice(0, 200).map((i) => {
      const p = inv.ownProduct(db, businessId, i.productId);
      return { product: p, qty: int(i.qty, 'Quantity', { min: 1, max: 1e7 }), unitCost: int(i.unitCostPaise ?? p.purchase_price_paise, 'Cost', { max: 1e10 }), taxBps: int(i.taxBps ?? p.tax_bps, 'Tax', { max: 4000 }), batchNo: text(i.batchNo, { max: 40 }), expiry: /^\d{4}-\d{2}-\d{2}$/.test(i.expiry || '') ? i.expiry : '' };
    });
  };

  r.post('/businesses/:businessId/purchase-orders', requireBiz(ctx, 'purchases.write'), (req, res) => {
    const s = ownSupplier(db, req.biz.id, req.body.supplierId);
    const items = readItems(req.body.items, req.biz.id);
    const po = tx(db, () => {
      const info = db.prepare('INSERT INTO biz_purchase_orders (business_id, supplier_id, branch_id, po_no, notes, created_by) VALUES (?,?,?,?,?,?)')
        .run(req.biz.id, s.id, inv.ownBranch(db, req.biz.id, req.body.branchId), nextNo(db, 'biz_purchase_orders', 'po_no', 'PO', req.biz.id), text(req.body.notes, { max: 300 }), req.user.id);
      const ins = db.prepare('INSERT INTO biz_po_items (po_id, product_id, qty_ordered, unit_cost_paise, tax_bps) VALUES (?,?,?,?,?)');
      for (const i of items) ins.run(info.lastInsertRowid, i.product.id, i.qty, i.unitCost, i.taxBps);
      return db.prepare('SELECT * FROM biz_purchase_orders WHERE id = ?').get(info.lastInsertRowid);
    });
    res.status(201).json({ purchaseOrder: po });
  });
  r.get('/businesses/:businessId/purchase-orders', requireBiz(ctx, 'purchases.read'), (req, res) => {
    const rows = db.prepare('SELECT o.*, s.name AS supplier FROM biz_purchase_orders o JOIN biz_suppliers s ON s.id = o.supplier_id WHERE o.business_id = ? ORDER BY o.id DESC LIMIT 100').all(req.biz.id);
    res.json({ purchaseOrders: rows.map((o) => ({ ...o, items: db.prepare('SELECT i.*, p.name FROM biz_po_items i JOIN biz_products p ON p.id = i.product_id WHERE po_id = ?').all(o.id) })) });
  });
  r.post('/businesses/:businessId/purchase-orders/:id/cancel', requireBiz(ctx, 'purchases.write'), (req, res) => {
    const po = db.prepare('SELECT * FROM biz_purchase_orders WHERE id = ? AND business_id = ?').get(Number(req.params.id), req.biz.id);
    if (!po) throw new HttpError(404, 'Order not found');
    if (po.status !== 'ordered') throw new HttpError(409, 'Only orders with nothing received can be cancelled');
    db.prepare("UPDATE biz_purchase_orders SET status = 'cancelled' WHERE id = ?").run(po.id);
    res.json({ ok: true });
  });

  /* ---- goods receipt: stock in + payable ---- */
  r.post('/businesses/:businessId/goods-receipts', requireBiz(ctx, 'purchases.write'), (req, res) => {
    const b = req.body;
    const key = text(b.idempotencyKey, { min: 6, max: 80, name: 'Idempotency key' });
    const dup = db.prepare('SELECT * FROM biz_goods_receipts WHERE idempotency_key = ?').get(key);
    if (dup) return res.json({ receipt: dup, duplicate: true });
    const supplier = ownSupplier(db, req.biz.id, b.supplierId);
    const items = readItems(b.items, req.biz.id);
    const po = b.poId ? db.prepare('SELECT * FROM biz_purchase_orders WHERE id = ? AND business_id = ?').get(Number(b.poId), req.biz.id) : null;
    if (b.poId && (!po || po.supplier_id !== supplier.id)) throw new HttpError(404, 'Purchase order not found for this supplier');
    if (po && ['cancelled', 'received'].includes(po.status)) throw new HttpError(409, 'This purchase order is closed');
    const branchId = po ? po.branch_id : inv.ownBranch(db, req.biz.id, b.branchId);

    const receipt = tx(db, () => {
      let subtotal = 0, tax = 0;
      const lines = items.map((i) => { const net = i.qty * i.unitCost; const t = pct(net, i.taxBps); subtotal += net; tax += t; return { ...i, net }; });
      const total = subtotal + tax;
      const grnNo = nextNo(db, 'biz_goods_receipts', 'grn_no', 'GRN', req.biz.id);
      const info = db.prepare('INSERT INTO biz_goods_receipts (business_id, po_id, supplier_id, branch_id, grn_no, invoice_no, subtotal_paise, tax_paise, total_paise, idempotency_key, received_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(req.biz.id, po?.id ?? null, supplier.id, branchId, grnNo, text(b.invoiceNo, { max: 40 }), subtotal, tax, total, key, req.user.id);
      const grnId = Number(info.lastInsertRowid);
      for (const l of lines) {
        db.prepare('INSERT INTO biz_grn_items (grn_id, product_id, qty, unit_cost_paise, tax_bps, batch_no, expiry) VALUES (?,?,?,?,?,?,?)').run(grnId, l.product.id, l.qty, l.unitCost, l.taxBps, l.batchNo, l.expiry);
        if (po) {
          const pi = db.prepare('SELECT * FROM biz_po_items WHERE po_id = ? AND product_id = ?').get(po.id, l.product.id);
          if (!pi) throw new HttpError(400, `${l.product.name} is not on that purchase order`);
          if (pi.qty_received + l.qty > pi.qty_ordered) throw new HttpError(409, `More ${l.product.name} received than ordered`);
          db.prepare('UPDATE biz_po_items SET qty_received = qty_received + ? WHERE id = ?').run(l.qty, pi.id);
        }
        inv.moveStock(db, { businessId: req.biz.id, branchId, product: l.product, qty: l.qty, totalCostPaise: l.net, kind: 'purchase_receipt', sourceType: 'grn', sourceId: grnId, batchNo: l.batchNo, expiry: l.expiry, by: req.user.id, reference: grnNo });
        db.prepare('UPDATE biz_products SET purchase_price_paise = ? WHERE id = ?').run(l.unitCost, l.product.id);
      }
      if (po) {
        const left = db.prepare('SELECT COUNT(*) n FROM biz_po_items WHERE po_id = ? AND qty_received < qty_ordered').get(po.id).n;
        db.prepare('UPDATE biz_purchase_orders SET status = ? WHERE id = ?').run(left ? 'partially_received' : 'received', po.id);
      }
      acc.post(db, { businessId: req.biz.id, memo: `Goods received ${grnNo}`, sourceType: 'grn', sourceId: grnId, sourceKey: `grn:${grnId}`, by: req.user.id,
        lines: [{ code: '1200', debit: subtotal }, { code: '1300', debit: tax }, { code: '2000', credit: total, party: ['supplier', supplier.id] }] });
      const paid = int(b.paidPaise || 0, 'Paid', { max: total });
      if (paid > 0) {
        recordSupplierPayment(db, { businessId: req.biz.id, supplierId: supplier.id, amountPaise: paid, method: ['cash', 'upi', 'bank', 'card'].includes(b.method) ? b.method : 'cash', grnId, key: `${key}:pay`, by: req.user.id });
        db.prepare('UPDATE biz_goods_receipts SET paid_paise = ? WHERE id = ?').run(paid, grnId);
      }
      audit(db, { actor: req.user.id, business: req.biz.id, action: 'purchase.receive', entity: 'grn', entityId: grnId, meta: { total } });
      return db.prepare('SELECT * FROM biz_goods_receipts WHERE id = ?').get(grnId);
    });
    res.status(201).json({ receipt });
  });
  r.get('/businesses/:businessId/goods-receipts', requireBiz(ctx, 'purchases.read'), (req, res) => {
    res.json({ receipts: db.prepare('SELECT g.*, s.name AS supplier FROM biz_goods_receipts g JOIN biz_suppliers s ON s.id = g.supplier_id WHERE g.business_id = ? ORDER BY g.id DESC LIMIT 100').all(req.biz.id) });
  });

  /* ---- return goods to a supplier: credit note ---- */
  r.post('/businesses/:businessId/purchase-returns', requireBiz(ctx, 'purchases.write'), (req, res) => {
    const b = req.body;
    const key = text(b.idempotencyKey, { min: 6, max: 80, name: 'Idempotency key' });
    const dup = db.prepare('SELECT * FROM biz_purchase_returns WHERE idempotency_key = ?').get(key);
    if (dup) return res.json({ purchaseReturn: dup, duplicate: true });
    const supplier = ownSupplier(db, req.biz.id, b.supplierId);
    const items = readItems(b.items, req.biz.id);
    const branchId = inv.ownBranch(db, req.biz.id, b.branchId);
    const out = tx(db, () => {
      let credit = 0, taxTotal = 0, stockValue = 0;
      const info0 = db.prepare('INSERT INTO biz_purchase_returns (business_id, supplier_id, branch_id, grn_id, total_paise, note, idempotency_key) VALUES (?,?,?,?,?,?,?)').run(req.biz.id, supplier.id, branchId, b.grnId || null, 0, text(b.note, { max: 200 }), key);
      const id = Number(info0.lastInsertRowid);
      for (const i of items) {
        const mv = inv.moveStock(db, { businessId: req.biz.id, branchId, product: i.product, qty: -i.qty, kind: 'purchase_return', sourceType: 'purchase_return', sourceId: id, batchNo: i.batchNo, by: req.user.id });
        const net = i.qty * i.unitCost;
        credit += net; taxTotal += pct(net, i.taxBps); stockValue += mv.costPaise;
      }
      const total = credit + taxTotal;
      db.prepare('UPDATE biz_purchase_returns SET total_paise = ? WHERE id = ?').run(total, id);
      // supplier credit note: DR payable, CR inventory (at our cost) and GST input; any price/cost difference goes to inventory adjustments
      const diff = credit - stockValue;
      acc.post(db, { businessId: req.biz.id, memo: 'Purchase return', sourceType: 'purchase_return', sourceId: id, sourceKey: `pret:${id}`, by: req.user.id,
        lines: [{ code: '2000', debit: total, party: ['supplier', supplier.id] }, { code: '1200', credit: stockValue }, { code: '1300', credit: taxTotal }, diff > 0 ? { code: '5100', credit: diff } : { code: '5100', debit: -diff }] });
      return db.prepare('SELECT * FROM biz_purchase_returns WHERE id = ?').get(id);
    });
    res.status(201).json({ purchaseReturn: out });
  });
  return r;
}

module.exports = { routes, recordSupplierPayment, outstanding };

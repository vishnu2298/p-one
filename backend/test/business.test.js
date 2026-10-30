const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, rupees } = require('./helpers');

let h, owner, bizId, supplierId, products = [];
const J = (p) => `/api/v1${p}`;
const B = (p) => J(`/businesses/${bizId}${p}`);

before(async () => {
  h = await boot();
  owner = await h.user('Lakshmi Owner');
});
after(() => h.close());

const post = (path, body, t = owner) => h.call(path, { method: 'POST', body, token: t.token });
const get = (path, t = owner) => h.call(path, { token: t.token });

test('C1: owner creates a business with a chart of accounts and default branch', async () => {
  assert.equal((await post(J('/businesses'), { name: 'X', category: 'retail' })).status, 400); // name too short
  assert.equal((await post(J('/businesses'), { name: 'Sri Lakshmi Stores', category: 'nope' })).status, 400);
  assert.equal((await post(J('/businesses'), { name: 'Sri Lakshmi Stores', category: 'retail', gstin: 'BAD' })).status, 400);
  const r = await post(J('/businesses'), { name: 'Sri Lakshmi Stores', category: 'retail', city: 'Chennai', address: '12 Usman Road', gstin: '33ABCDE1234F1Z5' });
  assert.equal(r.status, 201);
  bizId = r.data.business.id;
  assert.match(r.data.business.public_slug, /^sri-lakshmi-stores/);
  const mine = (await get(J('/me/businesses'))).data.businesses;
  assert.equal(mine[0].role, 'owner');
  assert.ok(mine[0].permissions.includes('accounting.read'));
  assert.ok((await get(B('/accounts'))).data.accounts.length >= 20);
  assert.equal((await get(B('/branches'))).data.branches.length, 1);
});

test('C2: add 100 products and receive a supplier purchase: stock increases only on receipt', async () => {
  for (let i = 1; i <= 100; i++) {
    const r = await post(B('/products'), { sku: `P${String(i).padStart(3, '0')}`, barcode: `890000${String(i).padStart(4, '0')}`, name: `Product ${i}`, sellingPricePaise: rupees(100), purchasePricePaise: rupees(60), taxBps: 1800, reorderLevel: 10 });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    products.push(r.data.product);
  }
  assert.equal((await post(B('/products'), { sku: 'P001', name: 'Dup', sellingPricePaise: 100 })).status, 409);
  assert.equal((await get(B('/products?limit=500'))).data.products.length, 100);
  assert.equal((await get(B('/products?q=890000' + '0007'))).data.products[0].sku, 'P007'); // barcode search

  supplierId = (await post(B('/suppliers'), { name: 'Chennai Wholesale', phone: '+919800011111' })).data.supplier.id;
  const po = await post(B('/purchase-orders'), { supplierId, items: [{ productId: products[0].id, qty: 50, unitCostPaise: rupees(60), taxBps: 1800 }, { productId: products[1].id, qty: 50, unitCostPaise: rupees(60), taxBps: 1800 }] });
  assert.equal(po.status, 201);
  // placing the order does not add stock
  assert.equal((await get(B('/inventory'))).data.inventory.length, 0);

  const grn = await post(B('/goods-receipts'), { supplierId, poId: po.data.purchaseOrder.id, invoiceNo: 'SUP-77', idempotencyKey: 'grn-c-0001', paidPaise: rupees(1000), method: 'bank',
    items: [{ productId: products[0].id, qty: 50, unitCostPaise: rupees(60), taxBps: 1800 }, { productId: products[1].id, qty: 50, unitCostPaise: rupees(60), taxBps: 1800 }] });
  assert.equal(grn.status, 201, JSON.stringify(grn.data));
  assert.equal(grn.data.receipt.subtotal_paise, rupees(6000));
  assert.equal(grn.data.receipt.tax_paise, rupees(1080));
  assert.equal(grn.data.receipt.total_paise, rupees(7080));

  const inv = (await get(B('/inventory'))).data.inventory;
  assert.deepEqual(inv.map((i) => i.qty).sort(), [50, 50]);
  assert.equal((await get(B('/inventory/valuation'))).data.total_paise, rupees(6000));

  // retried delivery does not double-receive
  const again = await post(B('/goods-receipts'), { supplierId, idempotencyKey: 'grn-c-0001', items: [{ productId: products[0].id, qty: 50 }] });
  assert.equal(again.data.duplicate, true);
  assert.equal((await get(B('/inventory'))).data.inventory[0].qty, 50);
  assert.equal((await post(B('/goods-receipts'), { supplierId, poId: po.data.purchaseOrder.id, idempotencyKey: 'grn-c-0002', items: [{ productId: products[0].id, qty: 1 }] })).status, 409); // PO already fully received

  // supplier balance: 7080 owed - 1000 paid
  const sup = (await get(B(`/suppliers/${supplierId}`))).data.supplier;
  assert.equal(sup.outstanding_paise, rupees(6080));
  assert.equal((await post(B(`/suppliers/${supplierId}/payments`), { amountPaise: rupees(7000), method: 'bank', idempotencyKey: 'sp-over-1' })).status, 400);
});

test('C3: POS sale: invoice, GST split, payment, stock down, ledger balanced, P&L reflects it', async () => {
  const sale = await post(B('/sales'), { idempotencyKey: 'sale-c-0001', items: [{ productId: products[0].id, qty: 1 }, { productId: products[1].id, qty: 1 }], payments: [{ method: 'cash', amountPaise: rupees(200) }] });
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  const i = sale.data.invoice;
  assert.equal(i.total_paise, rupees(200));
  assert.equal(i.tax_paise, 3050); // 2 x round(10000*1800/11800)
  assert.equal(i.cogs_paise, rupees(120));
  assert.equal(i.status, 'paid');
  assert.match(i.invoice_no, /^INV-\d{5}$/);
  assert.ok(sale.data.shareUrl.includes('/api/v1/invoices/public/'));
  assert.deepEqual((await get(B('/inventory'))).data.inventory.map((x) => x.qty), [49, 49]);

  const html = await h.call(sale.data.shareUrl.replace(/^https?:\/\/[^/]+/, ''));
  assert.equal(html.status, 200);
  assert.ok(html.data.includes('Sri Lakshmi Stores') && html.data.includes('₹200.00'));

  const pl = (await get(B('/reports/profit-loss'))).data;
  assert.equal(pl.net_revenue_paise, rupees(200) - 3050);
  assert.equal(pl.cogs_paise, rupees(120));
  assert.equal(pl.gross_profit_paise, rupees(200) - 3050 - rupees(120));
  assert.equal(pl.net_profit_paise, pl.gross_profit_paise);

  await post(B('/expenses'), { accountCode: '6000', amountPaise: rupees(50), method: 'cash', payee: 'Landlord', idempotencyKey: 'exp-1' });
  const pl2 = (await get(B('/reports/profit-loss'))).data;
  assert.equal(pl2.net_profit_paise, pl.gross_profit_paise - rupees(50)); // not sales minus expenses: COGS is in there
});

test('C4: idempotency: a retried sale never double-invoices or double-deducts stock', async () => {
  const body = { idempotencyKey: 'sale-c-0002', items: [{ productId: products[0].id, qty: 3 }], payments: [{ method: 'upi', amountPaise: rupees(300) }] };
  const a = await post(B('/sales'), body);
  const b = await post(B('/sales'), body);
  const c = await h.call(B('/sales'), { method: 'POST', token: owner.token, headers: { 'idempotency-key': 'sale-c-0002' }, body: { items: [{ productId: products[0].id, qty: 3 }] } });
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(b.data.duplicate, true);
  assert.equal(c.data.invoice.id, a.data.invoice.id);
  assert.equal((await get(B('/inventory'))).data.inventory.find((x) => x.sku === 'P001').qty, 46);
  assert.equal((await get(B('/sales'))).data.invoices.length, 2);
  // missing key is rejected: offline queues must always send one
  assert.equal((await post(B('/sales'), { items: [{ productId: products[0].id, qty: 1 }], payments: [{ method: 'cash', amountPaise: rupees(100) }] })).status, 400);
});

test('C5: insufficient stock, overpayment and credit rules', async () => {
  const over = await post(B('/sales'), { idempotencyKey: 'sale-c-0003', items: [{ productId: products[1].id, qty: 500 }], payments: [{ method: 'cash', amountPaise: rupees(50000) }] });
  assert.equal(over.status, 409); assert.match(over.data.error, /Not enough stock/);
  assert.equal((await post(B('/sales'), { idempotencyKey: 'sale-c-0004', items: [{ productId: products[1].id, qty: 1 }], payments: [{ method: 'cash', amountPaise: rupees(500) }] })).status, 400);
  assert.equal((await post(B('/sales'), { idempotencyKey: 'sale-c-0005', items: [{ productId: products[1].id, qty: 1 }], payments: [] })).status, 400); // credit needs a customer
  assert.equal((await get(B('/inventory'))).data.inventory.find((x) => x.sku === 'P002').qty, 49); // failed sales changed nothing
  assert.equal((await get(B('/sales'))).data.invoices.length, 2);
});

test('C6: credit sale, customer balance, on-account payment and sales return', async () => {
  const cust = (await post(B('/customers'), { name: 'Ravi Kumar', phone: '+919800022222', creditLimitPaise: rupees(1000) })).data.customer;
  const credit = await post(B('/sales'), { idempotencyKey: 'sale-c-0006', customerId: cust.id, items: [{ productId: products[1].id, qty: 4 }], payments: [{ method: 'cash', amountPaise: rupees(100) }] });
  assert.equal(credit.status, 201);
  assert.equal(credit.data.invoice.status, 'partial');
  assert.equal(credit.data.invoice.balance_paise, rupees(300));
  assert.equal((await post(B('/sales'), { idempotencyKey: 'sale-c-0007', customerId: cust.id, items: [{ productId: products[1].id, qty: 10 }], payments: [] })).status, 409); // over credit limit
  let out = (await get(B('/reports/outstanding'))).data;
  assert.equal(out.customers.find((x) => x.party_id === cust.id).balance_paise, rupees(300));
  assert.equal((await get(B(`/customers/${cust.id}`))).data.customer.outstanding_paise, rupees(300));

  const pay = await post(B(`/customers/${cust.id}/payments`), { amountPaise: rupees(300), method: 'upi', idempotencyKey: 'cpay-0001' });
  assert.equal(pay.status, 201);
  assert.equal((await post(B(`/customers/${cust.id}/payments`), { amountPaise: rupees(300), method: 'upi', idempotencyKey: 'cpay-0001' })).data.duplicate, true);
  assert.equal((await post(B(`/customers/${cust.id}/payments`), { amountPaise: rupees(1), method: 'upi', idempotencyKey: 'cpay-0002' })).status, 400); // nothing owed
  out = (await get(B('/reports/outstanding'))).data;
  assert.equal(out.customers.find((x) => x.party_id === cust.id), undefined);

  // return 1 of 4 on a fully paid invoice: cash refund, stock restored at original cost
  const inv = credit.data.invoice;
  const before = (await get(B('/inventory'))).data.inventory.find((x) => x.sku === 'P002').qty;
  const ret = await h.call(B(`/sales/${inv.id}/returns`), { method: 'POST', token: owner.token, headers: { 'idempotency-key': 'ret-c-0001' }, body: { items: [{ itemId: inv.items[0].id, qty: 1 }], refundMethod: 'cash' } });
  assert.equal(ret.status, 201, JSON.stringify(ret.data));
  assert.equal(ret.data.refund_paise, rupees(100));
  assert.equal((await get(B('/inventory'))).data.inventory.find((x) => x.sku === 'P002').qty, before + 1);
  assert.equal((await h.call(B(`/sales/${inv.id}/returns`), { method: 'POST', token: owner.token, headers: { 'idempotency-key': 'ret-c-0001' }, body: { items: [{ itemId: inv.items[0].id, qty: 1 }] } })).data.duplicate, true);
  assert.equal((await post(B(`/sales/${inv.id}/returns`), { idempotencyKey: 'ret-c-0002', items: [{ itemId: inv.items[0].id, qty: 4 }] })).status, 409); // more than sold
});

test('C7: books always balance and stock value always equals the inventory ledger', async () => {
  // damage + loss + recount all flow through the ledger
  await post(B('/inventory/adjust'), { productId: products[0].id, qtyDelta: -2, reason: 'damage', idempotencyKey: 'adj-d-1' });
  await post(B('/inventory/adjust'), { productId: products[1].id, qtyDelta: -1, reason: 'loss', idempotencyKey: 'adj-l-1' });
  await post(B('/inventory/reconcile'), { counts: [{ productId: products[0].id, counted: 40 }] });
  const tb = (await get(B('/reports/trial-balance'))).data;
  assert.equal(tb.balanced, true);
  assert.equal(tb.totals_paise.debit, tb.totals_paise.credit);
  const bs = (await get(B('/reports/balance-sheet'))).data;
  assert.equal(bs.balanced, true, JSON.stringify(bs.totals_paise));
  const val = (await get(B('/inventory/valuation'))).data;
  assert.equal(val.difference_paise, 0, 'stock ledger and accounting ledger must agree exactly');
  assert.equal((await get(B('/inventory'))).data.inventory.find((x) => x.sku === 'P001').qty, 40);
  const cf = (await get(B('/reports/cash-flow'))).data;
  assert.equal(cf.closing_paise, cf.opening_paise + cf.net_change_paise);
  const tax = (await get(B('/reports/tax'))).data;
  assert.ok(tax.output_tax_paise > 0 && tax.input_credit_paise === rupees(1080));
  assert.equal(tax.net_payable_paise, tax.output_tax_paise - tax.input_credit_paise);
  const gl = (await get(B('/reports/general-ledger?account=1200'))).data;
  assert.equal(gl.closing_paise, val.total_paise);
  // movements are an immutable audit trail
  const mv = (await get(B('/inventory/movements?productId=' + products[0].id))).data.movements;
  assert.ok(mv.length >= 4 && mv.every((m) => m.source_type));
});

test('C8: posted entries are corrected by reversal, closed periods reject new postings', async () => {
  const entries = (await get(B('/journal-entries'))).data.entries;
  const exp = entries.find((e) => e.source_type === 'expense');
  const rev = await post(B(`/journal-entries/${exp.id}/reverse`), { reason: 'Entered by mistake' });
  assert.equal(rev.status, 201);
  assert.equal((await post(B(`/journal-entries/${exp.id}/reverse`), {})).data.entryId, rev.data.entryId); // idempotent
  const after = (await get(B('/journal-entries'))).data.entries;
  assert.equal(after.find((e) => e.id === rev.data.entryId).reversal_of, exp.id);
  assert.equal(after.find((e) => e.id === exp.id).lines.length, exp.lines.length); // original untouched
  assert.equal((await post(B(`/journal-entries/${rev.data.entryId}/reverse`), {})).status, 400);
  assert.equal((await get(B('/reports/trial-balance'))).data.balanced, true);

  const period = new Date().toISOString().slice(0, 7);
  assert.equal((await post(B(`/periods/${period}/close`), {})).status, 200);
  const blocked = await post(B('/expenses'), { accountCode: '6020', amountPaise: 100, method: 'cash', idempotencyKey: 'exp-late' });
  assert.equal(blocked.status, 409); assert.match(blocked.data.error, /closed/);
  assert.equal((await post(B('/sales'), { idempotencyKey: 'sale-late-1', items: [{ productId: products[0].id, qty: 1 }], payments: [{ method: 'cash', amountPaise: rupees(100) }] })).status, 409);
  assert.equal((await get(B('/inventory'))).data.inventory.find((x) => x.sku === 'P001').qty, 40); // blocked sale rolled back stock too
});

test('F: multi-employee business: roles, tenant isolation, invites', async () => {
  const h2 = await boot();
  try {
    const o = await h2.user('Owner Two');
    const cashier = await h2.user('Cashier Kavi', { phone: '+919811100001' });
    const stock = await h2.user('Stock Sam');
    const stranger = await h2.user('Other Shop Owner');
    const p = (path, body, t) => h2.call(path, { method: 'POST', body, token: t.token });
    const g = (path, t) => h2.call(path, { token: t.token });

    const biz = (await p('/api/v1/businesses', { name: 'Team Store', category: 'grocery' }, o)).data.business;
    const other = (await p('/api/v1/businesses', { name: 'Rival Store', category: 'grocery' }, stranger)).data.business;
    const T = (path) => `/api/v1/businesses/${biz.id}${path}`;

    assert.equal((await p(T('/members'), { phone: '+919811100001', role: 'owner' }, o)).status, 400);
    assert.equal((await p(T('/members'), { phone: '+919811100001', role: 'cashier' }, o)).data.added, true);
    assert.equal((await p(T('/members'), { email: stock.email, role: 'inventory' }, o)).data.added, true);
    assert.equal((await p(T('/members'), { email: stock.email, role: 'inventory' }, o)).status, 409);
    assert.equal((await p(T('/members'), { email: 'new.hire@t.example', role: 'manager' }, o)).data.invited, true); // not registered yet

    // inventory manager adds product + stock
    const prod = (await p(T('/products'), { sku: 'RICE', name: 'Rice 1kg', sellingPricePaise: 6000, purchasePricePaise: 4000, taxBps: 500, openingQty: 20 }, stock)).data.product;
    assert.ok(prod.id);
    assert.equal((await p(T('/inventory/adjust'), { productId: prod.id, qtyDelta: 5, reason: 'found' }, stock)).status, 201);
    assert.equal((await p(T('/sales'), { idempotencyKey: 'f-sale-001', items: [{ productId: prod.id, qty: 1 }], payments: [{ method: 'cash', amountPaise: 6000 }] }, stock)).status, 403);
    assert.equal((await g(T('/reports/profit-loss'), stock)).status, 403);

    // cashier sells, but cannot see accounting, owner settings, team, or create/edit products
    const s = await p(T('/sales'), { idempotencyKey: 'f-sale-002', items: [{ productId: prod.id, qty: 2 }], payments: [{ method: 'upi', amountPaise: 12000 }] }, cashier);
    assert.equal(s.status, 201);
    for (const path of ['/reports/profit-loss', '/reports/balance-sheet', '/accounts', '/dashboard', '/members', '/journal-entries', '/inventory/valuation', '/audit']) assert.equal((await g(T(path), cashier)).status, 403, `cashier should not read ${path}`);
    assert.equal((await p(T('/products'), { sku: 'X', name: 'Xyz', sellingPricePaise: 100 }, cashier)).status, 403);
    assert.equal((await p(T('/expenses'), { amountPaise: 100, method: 'cash' }, cashier)).status, 403);
    assert.equal((await g(T('/products'), cashier)).status, 200);
    assert.equal((await g(T('/sales'), cashier)).status, 200);

    // owner sees the consolidated picture, including the cashier's sale and the stock manager's stock
    const dash = (await g(T('/dashboard'), o)).data;
    assert.equal(dash.today.sales_count, 1);
    assert.ok(dash.revenue_paise > 0 && 'net_profit_paise' in dash && dash.inventory_value_paise > 0);
    assert.equal((await g(T('/dashboard'), stock)).data.revenue_paise, undefined); // financial fields hidden from non-finance roles
    assert.equal((await g(T('/reports/profit-loss'), o)).status, 200);

    // tenant isolation: nobody outside the business can read it, and its ids don't leak across tenants
    for (const t of [stranger]) for (const path of ['', '/products', '/sales', '/dashboard', '/reports/profit-loss', '/customers', '/inventory']) assert.equal((await g(T(path), t)).status, 404, `stranger must not see ${path}`);
    assert.equal((await g(`/api/v1/businesses/${other.id}/products`, o)).status, 404);
    assert.equal((await g(T(`/products?q=RICE`), stranger)).status, 404);
    const rivalProd = (await p(`/api/v1/businesses/${other.id}/products`, { sku: 'RICE', name: 'Their rice', sellingPricePaise: 1 }, stranger)).data.product; // same SKU in another tenant is fine
    assert.ok(rivalProd.id !== prod.id);
    assert.equal((await p(T('/sales'), { idempotencyKey: 'f-sale-003', items: [{ productId: rivalProd.id, qty: 1 }], payments: [{ method: 'cash', amountPaise: 1 }] }, o)).status, 404); // cannot sell another tenant's product

    // invited-but-unregistered person gets access when they sign up
    const hire = await h2.user('New Hire', { email: 'new.hire@t.example' });
    const mine = (await g('/api/v1/me/businesses', hire)).data.businesses;
    assert.equal(mine[0].id, biz.id); assert.equal(mine[0].role, 'manager');
    assert.equal((await g(T('/reports/profit-loss'), hire)).status, 200);
    assert.equal((await p(T('/members'), { email: 'x@t.example', role: 'cashier' }, hire)).status, 403); // managers cannot manage the team

    // owner removes the cashier: access ends immediately
    const members = (await g(T('/members'), o)).data.members;
    const cm = members.find((m) => m.user_id === cashier.id);
    assert.equal((await h2.call(T(`/members/${cm.id}`), { method: 'DELETE', token: o.token })).status, 200);
    assert.equal((await g(T('/sales'), cashier)).status, 404);
    assert.equal((await h2.call(T(`/members/${members[0].id}`), { method: 'DELETE', token: o.token })).status, 403); // owner is protected

    const ev = (await g(T('/audit'), o)).data.events;
    assert.ok(ev.some((e) => e.action === 'team.add') && ev.some((e) => e.action === 'sale.create'));
  } finally { h2.close(); }
});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('../src/config');
const { boot, rupees } = require('./helpers');

let h, owner, shopper, biz, product, T;
const post = (path, body, t) => h.call(path, { method: 'POST', body, token: t.token });
const get = (path, t) => h.call(path, { token: t.token });
const signed = (evt) => { const body = JSON.stringify(evt); const secret = crypto.createHash('sha256').update(`test-webhook:${config.jwtSecret}`).digest('hex'); return { body, sig: crypto.createHmac('sha256', secret).update(body).digest('hex') }; };
const stockOf = async () => (await get(T('/inventory'), owner)).data.inventory.find((x) => x.sku === 'MILK');

before(async () => {
  h = await boot();
  owner = await h.user('Shop Owner');
  shopper = await h.user('Shopper Sita');
  biz = (await post('/api/v1/businesses', { name: 'Annai Dairy', category: 'grocery', city: 'Chennai' }, owner)).data.business;
  T = (p) => `/api/v1/businesses/${biz.id}${p}`;
  product = (await post(T('/products'), { sku: 'MILK', name: 'Milk 1L', sellingPricePaise: rupees(60), purchasePricePaise: rupees(45), taxBps: 500, openingQty: 10, published: true }, owner)).data.product;
  await post(T('/products'), { sku: 'SECRET', name: 'Unpublished item', sellingPricePaise: 100, published: false }, owner);
});
after(() => h.close());

test('D1: shop publishes a storefront; public pages show only published items and never costs', async () => {
  assert.equal((await h.call(`/api/v1/stores/${biz.public_slug}`)).status, 404); // storefront off by default
  assert.equal((await post(T('/storefront'), { enabled: true, deliveryEnabled: true, deliveryFeePaise: rupees(30), description: 'Fresh milk daily' }, shopper)).status, 404); // not a member
  const s = await h.call(T('/storefront'), { method: 'PATCH', token: owner.token, body: { enabled: true, deliveryEnabled: true, deliveryFeePaise: rupees(30), description: 'Fresh milk daily' } });
  assert.equal(s.data.storefront.publishedProducts, 1);
  const list = (await h.call('/api/v1/stores?city=Chennai')).data.stores;
  assert.equal(list[0].name, 'Annai Dairy');
  const page = (await h.call(`/api/v1/stores/${biz.public_slug}`)).data;
  assert.equal(page.products.length, 1);
  assert.equal(page.products[0].available, 10);
  assert.ok(!('purchase_price_paise' in page.products[0]) && !('value_paise' in page.products[0]));
  assert.equal(page.store.ownerUserId, owner.id); // for "chat with business"
});

test('D2: order reserves stock; verified payment webhook confirms it, deducts stock once and posts the sale once', async () => {
  const body = { idempotencyKey: 'order-d-0001', items: [{ productId: product.id, qty: 4 }], fulfillment: 'delivery', address: '5 Gandhi Street, Adyar', payMethod: 'online' };
  const o = await post(`/api/v1/stores/${biz.public_slug}/orders`, body, shopper);
  assert.equal(o.status, 201, JSON.stringify(o.data));
  assert.equal(o.data.order.status, 'pending_payment');
  assert.equal(o.data.order.total_paise, rupees(60) * 4 + rupees(30));
  let s = await stockOf();
  assert.equal(s.qty, 10); assert.equal(s.reserved, 4); assert.equal(s.available, 6); // reserved, not yet sold
  assert.equal((await post(`/api/v1/stores/${biz.public_slug}/orders`, body, shopper)).data.duplicate, true); // retried request
  assert.equal((await stockOf()).reserved, 4);

  // a different shopper cannot oversell what is reserved
  const rival = await h.user('Rival Shopper');
  const tooMany = await post(`/api/v1/stores/${biz.public_slug}/orders`, { idempotencyKey: 'order-d-0002', items: [{ productId: product.id, qty: 7 }], fulfillment: 'pickup', payMethod: 'online' }, rival);
  assert.equal(tooMany.status, 409); assert.match(tooMany.data.error, /Not enough stock/);

  // frontend-reported success is not a thing: forged / tampered webhooks are rejected
  const intent = o.data.payment;
  assert.equal(intent.provider, 'test');
  const evt = { id: 'evt_forged_1', event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: intent.providerOrderId, amount: intent.amountPaise, fee: 0 } } } };
  const forged = await h.call('/api/v1/webhooks/test', { method: 'POST', headers: { 'x-test-signature': 'deadbeef' }, body: evt });
  assert.equal(forged.status, 401);
  assert.equal((await h.call('/api/v1/webhooks/test', { method: 'POST', body: evt })).status, 401); // no signature
  const short = signed({ ...evt, id: 'evt_short', payload: { payment: { entity: { ...evt.payload.payment.entity, amount: 100 } } } });
  assert.equal((await h.call('/api/v1/webhooks/test', { method: 'POST', headers: { 'x-test-signature': short.sig, 'content-type': 'application/json' }, body: JSON.parse(short.body) })).status, 409); // short payment refused
  assert.equal((await get(`/api/v1/payments/${intent.id}`, shopper)).data.payment.status, 'created');
  assert.equal((await stockOf()).qty, 10);

  // genuine signed webhook through the real verification path
  assert.equal((await post(`/api/v1/payments/${intent.id}/simulate`, {}, shopper)).status, 200);
  assert.equal((await get(`/api/v1/payments/${intent.id}`, shopper)).data.payment.status, 'paid');
  s = await stockOf();
  assert.equal(s.qty, 6); assert.equal(s.reserved, 0);

  // retries and replays change nothing: same event id, and a fresh event id for the same payment
  const good = signed({ id: 'evt_replay_1', event: 'payment.captured', payload: { payment: { entity: { id: 'pay_r', order_id: intent.providerOrderId, amount: intent.amountPaise, fee: 0 } } } });
  for (let i = 0; i < 2; i++) assert.equal((await h.call('/api/v1/webhooks/test', { method: 'POST', headers: { 'x-test-signature': good.sig }, body: JSON.parse(good.body) })).status, 200);
  await post(`/api/v1/payments/${intent.id}/simulate`, {}, shopper);
  assert.equal((await stockOf()).qty, 6);
  const invoices = (await get(T('/sales'), owner)).data.invoices;
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].channel, 'storefront');
  assert.equal(invoices[0].total_paise, rupees(270));
  const entries = (await get(T('/journal-entries'), owner)).data.entries.filter((e) => e.source_type === 'sale');
  assert.equal(entries.length, 1);

  // business dashboard + books reflect it
  const dash = (await get(T('/dashboard'), owner)).data;
  assert.equal(dash.today.sales_count, 1);
  assert.equal(dash.sales_paise, rupees(270));
  const pl = (await get(T('/reports/profit-loss'), owner)).data;
  assert.equal(pl.cogs_paise, 4 * rupees(45));
  assert.equal((await get(T('/reports/trial-balance'), owner)).data.balanced, true);
  assert.equal((await get(T('/inventory/valuation'), owner)).data.difference_paise, 0);
  const mine = (await get('/api/v1/me/store-orders', shopper)).data.orders[0];
  assert.equal(mine.status, 'confirmed');
  const inbox = (await get('/notifications', owner)).data.notifications;
  assert.ok(inbox.some((n) => n.type === 'store_order'));
});

test('D3: staff move the order along, completion works once, shopper can then review', async () => {
  const order = (await get(T('/store-orders'), owner)).data.orders[0];
  assert.equal((await post(T(`/store-orders/${order.id}/status`), { status: 'pending_payment' }, owner)).status, 409);
  for (const st of ['preparing', 'out_for_delivery', 'completed']) assert.equal((await post(T(`/store-orders/${order.id}/status`), { status: st }, owner)).status, 200);
  assert.equal((await post(T(`/store-orders/${order.id}/status`), { status: 'cancelled' }, owner)).status, 409); // completed is final
  assert.equal((await post(`/api/v1/stores/${biz.public_slug}/reviews`, { rating: 5, comment: 'Fresh!' }, shopper)).status, 201);
  const rival = await h.user('No Purchase');
  assert.equal((await post(`/api/v1/stores/${biz.public_slug}/reviews`, { rating: 1 }, rival)).status, 403); // must have bought something
  assert.equal((await h.call(`/api/v1/stores/${biz.public_slug}`)).data.store.rating.avg, 5);
});

test('D4: unpaid online orders expire and release stock; late payment is refunded, never kept', async () => {
  const o = await post(`/api/v1/stores/${biz.public_slug}/orders`, { idempotencyKey: 'order-d-0003', items: [{ productId: product.id, qty: 2 }], fulfillment: 'pickup', payMethod: 'online' }, shopper);
  assert.equal((await stockOf()).reserved, 2);
  h.clock.advance(31 * 60 * 1000);
  await h.ctx.jobs.runDue(h.clock.t);
  assert.equal((await stockOf()).reserved, 0);
  assert.equal((await get('/api/v1/me/store-orders', shopper)).data.orders[0].status, 'expired');
  // the shopper's payment arrives after expiry
  await post(`/api/v1/payments/${o.data.payment.id}/simulate`, {}, shopper);
  assert.equal((await get('/api/v1/me/store-orders', shopper)).data.orders[0].status, 'refund_pending');
  assert.equal((await stockOf()).qty, 6); // nothing sold
  const refund = h.db.prepare('SELECT * FROM refunds').all();
  assert.equal(refund.length, 1); assert.equal(refund[0].amount_paise, rupees(120));
  await h.ctx.jobs.runDue(h.clock.t + 20000);
  assert.equal(h.db.prepare('SELECT status FROM refunds').get().status, 'processed');
});

test('D5: pay-at-store orders: reserved, billed in POS when handed over; staff cancellation restocks', async () => {
  const o = await post(`/api/v1/stores/${biz.public_slug}/orders`, { idempotencyKey: 'order-d-0004', items: [{ productId: product.id, qty: 2 }], fulfillment: 'pickup', payMethod: 'pay_at_store' }, shopper);
  assert.equal(o.data.order.status, 'confirmed'); assert.equal(o.data.payment, null);
  assert.equal((await stockOf()).reserved, 2);
  assert.equal((await post(T(`/store-orders/${o.data.order.id}/status`), { status: 'completed' }, owner)).status, 200);
  assert.equal((await stockOf()).qty, 4); assert.equal((await stockOf()).reserved, 0);
  assert.equal((await get(T('/sales'), owner)).data.invoices.length, 2);

  const o2 = await post(`/api/v1/stores/${biz.public_slug}/orders`, { idempotencyKey: 'order-d-0005', items: [{ productId: product.id, qty: 1 }], fulfillment: 'pickup', payMethod: 'pay_at_store' }, shopper);
  assert.equal((await post(T(`/store-orders/${o2.data.order.id}/status`), { status: 'cancelled' }, owner)).status, 200);
  assert.equal((await stockOf()).reserved, 0); assert.equal((await stockOf()).qty, 4);
  assert.equal((await get(T('/reports/trial-balance'), owner)).data.balanced, true);
});

test('D6: paid order cancelled by the shop: stock returns, return posted, gateway refund queued', async () => {
  const o = await post(`/api/v1/stores/${biz.public_slug}/orders`, { idempotencyKey: 'order-d-0006', items: [{ productId: product.id, qty: 1 }], fulfillment: 'pickup', payMethod: 'online' }, shopper);
  await post(`/api/v1/payments/${o.data.payment.id}/simulate`, {}, shopper);
  assert.equal((await stockOf()).qty, 3);
  assert.equal((await post(T(`/store-orders/${o.data.order.id}/status`), { status: 'cancelled' }, owner)).status, 200);
  assert.equal((await stockOf()).qty, 4);
  assert.ok(h.db.prepare("SELECT 1 FROM refunds WHERE reason LIKE 'Cancelled by shop%'").get());
  const bs = (await get(T('/reports/balance-sheet'), owner)).data;
  assert.equal(bs.balanced, true);
  assert.equal((await get(T('/inventory/valuation'), owner)).data.difference_paise, 0);
});

/* ---------------- Scenario E: clinic ---------------- */
test('E: clinic: doctors, availability, booking, confirmation, billing, isolated clinical notes, reports', async () => {
  const clinicOwner = await h.user('Dr Owner');
  const doctor = await h.user('Dr Meena', { phone: '+919822200001' });
  const patient = await h.user('Patient Arun');
  const patient2 = await h.user('Patient Bala');
  const manager = await h.user('Manager Mani');
  const c = (await post('/api/v1/businesses', { name: 'Care Clinic', category: 'clinic', city: 'Chennai' }, clinicOwner)).data.business;
  const C = (p) => `/api/v1/businesses/${c.id}${p}`;
  await post(C('/members'), { phone: '+919822200001', role: 'doctor' }, clinicOwner);
  await post(C('/members'), { email: manager.email, role: 'manager' }, clinicOwner);
  await h.call(C('/storefront'), { method: 'PATCH', token: clinicOwner.token, body: { enabled: true } });
  const members = (await get(C('/members'), clinicOwner)).data.members;
  const docMember = members.find((m) => m.user_id === doctor.id);
  const svc = (await post(C('/services'), { name: 'General consultation', durationMin: 30, pricePaise: rupees(500), taxBps: 0 }, clinicOwner)).data.service;
  assert.equal((await post(C('/services'), { name: 'Hacked', pricePaise: 1 }, patient)).status, 404);
  await h.call(C(`/staff-availability/${docMember.id}`), { method: 'PUT', token: clinicOwner.token, body: { windows: [{ weekday: 1, startMin: 600, endMin: 780 }] } }); // Mondays 10:00-13:00 IST
  assert.equal((await h.call(C(`/staff-availability/${docMember.id}`), { method: 'PUT', token: clinicOwner.token, body: { windows: [{ weekday: 1, startMin: 700, endMin: 600 }] } })).status, 400);

  const IST = 5.5 * 3600 * 1000;
  let d = new Date(h.clock.t + IST + 86400000);
  while (d.getUTCDay() !== 1) d = new Date(d.getTime() + 86400000);
  const date = d.toISOString().slice(0, 10);
  const slots = (await h.call(`/api/v1/stores/${c.public_slug}/slots?serviceId=${svc.id}&date=${date}`)).data.slots;
  assert.equal(slots.length, 6); // 3 hours / 30 min
  const first = slots[0];

  const book = await post(`/api/v1/stores/${c.public_slug}/appointments`, { serviceId: svc.id, startTs: first.startTs, note: 'Fever for two days' }, patient);
  assert.equal(book.status, 201); assert.equal(book.data.appointment.status, 'requested');
  assert.equal((await post(`/api/v1/stores/${c.public_slug}/appointments`, { serviceId: svc.id, startTs: first.startTs }, patient2)).status, 409); // slot taken
  assert.equal((await h.call(`/api/v1/stores/${c.public_slug}/slots?serviceId=${svc.id}&date=${date}`)).data.slots.length, 5);
  assert.equal((await post(`/api/v1/stores/${c.public_slug}/appointments`, { serviceId: svc.id, startTs: first.startTs + 7 * 60000 }, patient2)).status, 409); // not an offered slot

  const aId = book.data.appointment.id;
  assert.equal((await h.call(C(`/appointments/${aId}`), { method: 'PATCH', token: clinicOwner.token, body: { status: 'confirmed' } })).status, 200);
  assert.equal((await h.call(C(`/appointments/${aId}`), { method: 'PATCH', token: patient.token, body: { status: 'confirmed' } })).status, 404);
  const patientInbox = (await get('/notifications', patient)).data.notifications;
  assert.ok(patientInbox.some((n) => n.type === 'appointment_update'));
  h.clock.t = first.startTs - 2 * 3600 * 1000 + 1000;
  await h.ctx.jobs.runDue(h.clock.t);
  assert.ok((await get('/notifications', patient)).data.notifications.some((n) => n.type === 'appointment_reminder'));

  // consumable stock and completion/billing
  const syringe = (await post(C('/products'), { sku: 'SYR', name: 'Syringe', sellingPricePaise: rupees(20), purchasePricePaise: rupees(8), openingQty: 100 }, clinicOwner)).data.product;
  const done = await post(C(`/appointments/${aId}/complete`), { payments: [{ method: 'upi', amountPaise: rupees(500) }], consumables: [{ productId: syringe.id, qty: 2 }] }, clinicOwner);
  assert.equal(done.status, 201, JSON.stringify(done.data));
  assert.equal(done.data.invoice.total_paise, rupees(500));
  assert.equal((await post(C(`/appointments/${aId}/complete`), {}, clinicOwner)).data.duplicate, true); // no second invoice
  assert.equal((await get(C('/inventory'), clinicOwner)).data.inventory.find((x) => x.sku === 'SYR').qty, 98);
  const pl = (await get(C('/reports/profit-loss'), clinicOwner)).data;
  assert.equal(pl.net_revenue_paise, rupees(500));
  assert.equal(pl.net_profit_paise, rupees(500) - 2 * rupees(8)); // consumables hit the P&L
  assert.equal((await get(C('/reports/trial-balance'), clinicOwner)).data.balanced, true);
  assert.equal((await get(C('/inventory/valuation'), clinicOwner)).data.difference_paise, 0);

  // clinical notes: consent required, encrypted at rest, doctor/owner only, every read audited
  const cust = db0(h).prepare('SELECT id FROM biz_customers WHERE business_id = ? AND user_id = ?').get(c.id, patient.id);
  assert.equal((await post(C(`/customers/${cust.id}/clinical-notes`), { text: 'Viral fever. Rest and fluids.' }, doctor)).status, 400); // no consent
  assert.equal((await post(C(`/customers/${cust.id}/clinical-notes`), { text: 'Viral fever. Rest and fluids.', consent: true, appointmentId: aId }, doctor)).status, 201);
  assert.ok(!JSON.stringify(h.db.prepare('SELECT ciphertext FROM biz_clinical_notes').all()).includes('Viral fever'));
  assert.equal((await get(C(`/customers/${cust.id}/clinical-notes`), doctor)).data.notes[0].text, 'Viral fever. Rest and fluids.');
  assert.equal((await get(C(`/customers/${cust.id}/clinical-notes`), clinicOwner)).status, 200);
  for (const t of [manager, patient, patient2]) assert.equal((await get(C(`/customers/${cust.id}/clinical-notes`), t)).status, t === manager ? 403 : 404);
  assert.equal((await post(C(`/customers/${cust.id}/clinical-notes`), { text: 'x', consent: true }, manager)).status, 403);
  const reads = (await get(C('/audit'), clinicOwner)).data.events.filter((e) => e.action === 'clinical.read');
  assert.equal(reads.length, 2);
  for (const path of [`/api/v1/stores/${c.public_slug}`, '/api/v1/stores', '/me/store-orders']) assert.ok(!JSON.stringify((await h.call(path, { token: patient.token })).data).includes('Viral fever'));

  // doctors only see their own patients' appointments; the patient sees theirs
  assert.equal((await get(C('/appointments'), doctor)).data.appointments.length, 1);
  assert.equal((await get('/api/v1/me/appointments', patient)).data.appointments[0].status, 'completed');
  assert.equal((await post(`/api/v1/stores/${c.public_slug}/reviews`, { rating: 5 }, patient)).status, 201);
});
const db0 = (hh) => hh.db;

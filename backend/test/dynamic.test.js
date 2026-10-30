const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('./helpers');

let h, owner, cashier, outsider;
const J = (p) => `/api/v1${p}`;
const post = (p, body, t = owner) => h.call(J(p), { method: 'POST', body, token: t.token });
const get = (p, t = owner) => h.call(J(p), { token: t.token });
const patch = (p, body, t = owner) => h.call(J(p), { method: 'PATCH', body, token: t.token });
const put = (p, body, t = owner) => h.call(J(p), { method: 'PUT', body, token: t.token });
const del = (p, t = owner) => h.call(J(p), { method: 'DELETE', token: t.token });

before(async () => { h = await boot(); owner = await h.user('Gym Owner'); cashier = await h.user('Front Desk', { phone: '9876501234' }); outsider = await h.user('Other Owner'); });
after(() => h.close());

test('G1: a gym gets member and enquiry modules automatically; a grocery does not', async () => {
  const gym = (await post('/businesses', { name: 'Iron Works Gym', category: 'gym' })).data.business;
  const m = (await get(`/businesses/${gym.id}/modules`)).data;
  assert.deepEqual(m.entities.map((e) => e.key).sort(), ['lead', 'member']);
  assert.equal(m.modules.find((x) => x.key === 'pos').enabled, true);
  assert.equal(m.modules.find((x) => x.key === 'inventory').enabled, false); // a gym does not need stock
  const shop = (await post('/businesses', { name: 'Kirana Hub', category: 'grocery' })).data.business;
  const s = (await get(`/businesses/${shop.id}/modules`)).data;
  assert.equal(s.entities.length, 0);
  assert.equal(s.modules.find((x) => x.key === 'inventory').enabled, true);
  h.gym = gym;
});

test('G2: records are validated against the definition and searchable', async () => {
  const B = `/businesses/${h.gym.id}/entities/member/records`;
  assert.equal((await post(B, { phone: '9876543210' })).status, 400); // name required
  assert.equal((await post(B, { name: 'Ravi', plan: 'Lifetime' })).status, 400); // not an option
  assert.equal((await post(B, { name: 'Ravi', phone: 'abc' })).status, 400);
  assert.equal((await post(B, { name: 'Ravi', status: 'Active', expires: '31-12-2026' })).status, 400);
  const ok = await post(B, { name: 'Ravi Kumar', phone: '9876543210', plan: 'Yearly', fee: 600000, expires: '2027-01-31', status: 'Active', evil: '<script>' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.record.evil, undefined);
  await post(B, { name: 'Meena', status: 'Expired' });
  assert.equal((await get(`${B}?q=ravi`)).data.records.length, 1);
  assert.equal((await get(`${B}?status=Expired`)).data.records.length, 1);
  const sum = (await get(`/businesses/${h.gym.id}/entities/member/summary`)).data;
  assert.equal(sum.count, 2); assert.equal(sum.byStatus.Active, 1); assert.equal(sum.totals.fee, 600000);
  const id = ok.data.record.id;
  const up = await patch(`${B}/${id}`, { status: 'Paused' });
  assert.equal(up.data.record.status, 'Paused'); assert.equal(up.data.record.name, 'Ravi Kumar'); // partial update keeps other fields
  assert.equal((await del(`${B}/${id}`)).status, 200);
  assert.equal((await get(`${B}/${id}`)).status, 404);
  assert.equal((await get(B)).data.total, 1);
});

test('G3: tenants are isolated and roles are enforced', async () => {
  const B = `/businesses/${h.gym.id}`;
  assert.equal((await get(`${B}/entities/member/records`, outsider)).status, 404);
  assert.equal((await get(`${B}/modules`, outsider)).status, 404);
  const add = await post(`${B}/members`, { role: 'cashier', phone: '9876501234' });
  assert.equal(add.status, 201);
  assert.equal((await post(`${B}/entities/member/records`, { name: 'Walk-in', status: 'Active' }, cashier)).status, 201); // staff can add records
  assert.equal((await post(`${B}/entities`, { label: 'Hack', fields: [{ key: 'a', label: 'A', type: 'text' }] }, cashier)).status, 403); // but not change the structure
  assert.equal((await put(`${B}/modules/pos`, { enabled: false }, cashier)).status, 403);
  assert.equal((await get(`${B}/modules`, cashier)).data.canManage, false);
});

test('G4: owner defines a new record type by hand; bad definitions are cleaned or refused', async () => {
  const B = `/businesses/${h.gym.id}`;
  assert.equal((await post(`${B}/entities`, { label: 'Empty', fields: [] })).status, 400);
  const r = await post(`${B}/entities`, { label: 'Locker', plural: 'Lockers', fields: [{ label: 'Locker number', type: 'text', required: true }, { key: 'status', label: 'Status', type: 'select', options: ['Free', 'Taken'] }, { key: 'bad', label: 'Bad', type: 'select', options: [] }, { label: 'Locker number', type: 'number' }] });
  assert.equal(r.status, 201);
  const def = r.data.entities[0];
  assert.equal(def.key, 'locker'); assert.equal(def.fields.length, 2); assert.equal(def.statusField, 'status'); assert.equal(def.titleField, 'locker_number');
  assert.equal((await post(`${B}/entities`, { label: 'Locker', fields: [{ label: 'Code', type: 'text' }] })).status, 409);
  assert.equal((await post(`${B}/entities/locker/records`, { locker_number: 'A-12', status: 'Free' })).status, 201);
  assert.equal((await del(`${B}/entities/locker`)).status, 200);
  assert.equal((await get(`${B}/entities/locker/records`)).status, 404);
  assert.equal((await post(`${B}/entities`, { label: 'Locker', fields: [{ label: 'Locker number', type: 'text' }] })).status, 201); // re-adding brings records back
  assert.equal((await get(`${B}/entities/locker/records`)).data.total, 1);
});

test('G5: describing a business proposes modules (templates without an AI key) and the owner can switch built-ins', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const biz = (await post('/businesses', { name: 'Fix It Fast', category: 'other' })).data.business;
  const B = `/businesses/${biz.id}`;
  const s = (await post(`${B}/modules/suggest`, { description: 'We repair mobile phones and laptops and track each job' })).data;
  assert.equal(s.source, 'templates');
  assert.ok(s.entities.some((e) => e.key === 'job'));
  assert.equal((await get(`${B}/entities/job/records`)).status, 404); // a suggestion creates nothing until applied
  assert.equal((await post(`${B}/entities`, { entities: s.entities.filter((e) => e.key === 'job') })).status, 201);
  assert.equal((await post(`${B}/entities/job/records`, { item: 'Redmi Note', customer: 'Anil', status: 'Received' })).status, 201);
  assert.equal((await put(`${B}/modules/inventory`, { enabled: true })).status, 200);
  assert.equal((await get(`${B}/modules`)).data.modules.find((m) => m.key === 'inventory').enabled, true);
  assert.equal((await put(`${B}/modules/team`, { enabled: false })).status, 400);
});

test('G6: model output is untrusted: it is cleaned like any other definition', async () => {
  const { cleanEntity } = require('../src/modules/dynamic');
  const d = cleanEntity({ label: 'Pet <b>', key: 'DROP TABLE', icon: '../x', fields: [{ key: 'name', label: 'Name', type: 'script' }, { key: 'kind', label: 'Kind', type: 'select', options: ['Dog', 'Cat', ''] }] });
  assert.match(d.key, /^[a-z][a-z0-9_]*$/); assert.equal(d.icon, 'albums');
  assert.equal(d.fields[0].type, 'text'); assert.deepEqual(d.fields[1].options, ['Dog', 'Cat']);
});

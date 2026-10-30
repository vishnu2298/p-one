process.env.NODE_ENV = 'test';
process.env.INSIGHTS_URL = 'http://127.0.0.1:1'; // Python service down: local rules must still protect
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'connectly-test-uploads');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { seed } = require('../src/seed');

let server, base, db;
before(() => {
  config.affiliateSecret = 'sekret';
  db = open(':memory:');
  seed(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json() : await res.text() };
}
const login = async (e) => (await api('/auth/login', { method: 'POST', body: { email: `${e}@connectly.app`, password: 'demo1234' } })).data.token;
const admin = { 'x-postback-key': 'sekret' };

test('DPDP consent is required to create an account and is recorded', async () => {
  const no = await api('/auth/register', { method: 'POST', body: { name: 'No Consent', email: 'nc@x.com', password: 'secret1' } });
  assert.equal(no.status, 400);
  assert.match(no.data.error, /Terms and Privacy/);
  const ok = await api('/auth/register', { method: 'POST', body: { consent: true, name: 'Has Consent', email: 'hc@x.com', password: 'secret1', language: 'hi' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.language, 'hi');
  const row = db.prepare('SELECT consent_at, consent_version FROM users WHERE email = ?').get('hc@x.com');
  assert.ok(row.consent_at && row.consent_version);
});

test('legal pages: Terms, Privacy and Grievance Officer (HTML and JSON), escaped', async () => {
  for (const doc of ['terms', 'privacy', 'grievance']) {
    const j = await api(`/legal/${doc}?format=json`);
    assert.equal(j.status, 200);
    assert.ok(j.data.sections.length >= 2 && j.data.version);
    const h = await api(`/legal/${doc}`);
    assert.ok(h.data.includes('<h1>'));
  }
  assert.ok((await api('/legal/grievance?format=json')).data.sections.some((s) => /Grievance Officer/.test(s.heading)));
  assert.equal((await api('/legal/nope')).status, 404);
});

test('data export (DPDP right of access) excludes secrets', async () => {
  const t = await login('demo');
  const r = await api('/me/export', { token: t });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.equal(r.data.profile.email, 'demo@connectly.app');
  assert.ok(r.data.listings.length > 0 && Array.isArray(r.data.messagesSent));
  assert.ok(!('password_hash' in r.data.profile) && !('firebase_uid' in r.data.profile));
  assert.equal((await api('/me/export')).status, 401);
});

test('offers, contact reveal and UPI pay details appear only after the seller accepts', async () => {
  const buyer = await login('arun');
  const seller = await login('demo'); // has phone + UPI in seed
  const item = (await api('/me/listings', { token: seller })).data.listings.find((l) => l.title.startsWith('Dell'));
  // offer bounds
  assert.equal((await api('/orders', { method: 'POST', token: buyer, body: { listingId: item.id, offer: 100 } })).status, 400);
  assert.equal((await api('/orders', { method: 'POST', token: buyer, body: { listingId: item.id, offer: item.price + 1 } })).status, 400);
  const placed = await api('/orders', { method: 'POST', token: buyer, body: { listingId: item.id, offer: 20000 } });
  assert.equal(placed.status, 201);
  const o = placed.data.order;
  assert.equal(o.price, 20000);
  assert.equal(o.listPrice, item.price);
  assert.equal(o.contactPhone, null);
  assert.equal(o.pay, null);
  const sellerView = (await api('/orders?role=selling', { token: seller })).data.orders.find((x) => x.id === o.id);
  assert.equal(sellerView.contactPhone, null);
  const notes = (await api('/notifications', { token: seller })).data.notifications;
  assert.match(notes[0].body, /offered ₹20,000/);

  const acc = (await api(`/orders/${o.id}/accept`, { method: 'POST', token: seller })).data.order;
  assert.equal(acc.contactPhone, '+919876500003'); // seller now sees the buyer's phone
  const buyerView = (await api('/orders?role=buying', { token: buyer })).data.orders.find((x) => x.id === o.id);
  assert.equal(buyerView.contactPhone, '+919876500000');
  assert.deepEqual(buyerView.pay, { upiId: 'demo.user@okhdfcbank', payeeName: 'Demo User', amount: 20000 });
  assert.equal(acc.pay, null, 'seller never gets pay details');

  // price used for completion is the agreed offer
  const done = (await api(`/orders/${o.id}/complete`, { method: 'POST', token: seller })).data.order;
  assert.equal(done.price, 20000);
  assert.equal((await api(`/orders?role=buying`, { token: buyer })).data.orders.find((x) => x.id === o.id).pay, null, 'pay hidden once completed');
});

test('UPI id validation and language preference', async () => {
  const t = await login('rohit');
  assert.equal((await api('/me', { method: 'PATCH', token: t, body: { upiId: 'not a upi' } })).status, 400);
  const ok = await api('/me', { method: 'PATCH', token: t, body: { upiId: 'rohit.k@okaxis', language: 'ta' } });
  assert.equal(ok.data.user.upiId, 'rohit.k@okaxis');
  assert.equal(ok.data.user.language, 'ta');
  const bad = await api('/me', { method: 'PATCH', token: t, body: { language: 'xx' } });
  assert.equal(bad.data.user.language, 'ta');
});

test('prohibited items are blocked locally even if the Python service is down', async () => {
  const t = await login('demo');
  const r = await api('/listings', { method: 'POST', token: t, body: { title: 'Country made pistol with bullets', category: 'others', price: 5000 } });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /not allowed/);
  assert.equal((await api('/listings', { method: 'POST', token: t, body: { title: 'Fake aadhaar card service', category: 'services', price: 500 } })).status, 422);
  assert.equal((await api('/listings', { method: 'POST', token: t, body: { title: 'Weed killer sprayer for garden', category: 'others', price: 500 } })).status, 201);
  const conv = (await api('/conversations', { token: t })).data.conversations[0];
  assert.equal((await api(`/conversations/${conv.id}/messages`, { method: 'POST', token: t, body: { body: 'I can get you ganja' } })).status, 422);
});

test('chat accepts photo messages only from our upload path', async () => {
  const t = await login('demo');
  const conv = (await api('/conversations', { token: t })).data.conversations[0];
  assert.equal((await api(`/conversations/${conv.id}/messages`, { method: 'POST', token: t, body: { type: 'image', body: 'https://evil.example/x.jpg' } })).status, 400);
  const ok = await api(`/conversations/${conv.id}/messages`, { method: 'POST', token: t, body: { type: 'image', body: '/uploads/123e4567-e89b-12d3-a456-426614174000.jpg' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.message.type, 'image');
});

test('groups: browse, join, chat (members only), leave, create, delete', async () => {
  const t = await login('demo');
  const arun = await login('arun');
  const all = (await api('/groups', { token: t })).data.groups;
  assert.ok(all.length >= 4);
  const tech = all.find((g) => g.name.startsWith('Senior'));
  assert.equal(tech.isMember, true);
  const bikes = all.find((g) => g.name === 'Chennai Bike Riders');
  assert.equal((await api(`/groups/${bikes.id}/messages`, { token: arun })).status, 403); // not a member yet
  assert.equal((await api(`/groups/${bikes.id}/join`, { method: 'POST', token: arun })).data.group.isMember, true);
  const msgs = (await api(`/groups/${bikes.id}/messages`, { token: arun })).data.messages;
  assert.equal(msgs.length, 2);
  const sent = await api(`/groups/${bikes.id}/messages`, { method: 'POST', token: arun, body: { body: 'Hello riders' } });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.message.sender.name, 'Arun Prakash');
  assert.equal((await api(`/groups/${bikes.id}/messages?after=${msgs.at(-1).id}`, { token: t })).data.messages.length, 1);
  assert.equal((await api(`/groups/${bikes.id}/messages`, { method: 'POST', token: arun, body: { body: 'buy cocaine here' } })).status, 422);
  assert.equal((await api(`/groups/${bikes.id}/leave`, { method: 'POST', token: arun })).data.group.isMember, false);

  const mine = (await api('/groups?mine=1', { token: t })).data.groups;
  assert.ok(mine.every((g) => g.isMember));
  const created = await api('/groups', { method: 'POST', token: t, body: { name: 'Madurai Foodies', description: 'Best idli spots', city: 'Madurai', interest: 'Food' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.group.memberCount, 1);
  assert.equal((await api(`/groups/${created.data.group.id}/leave`, { method: 'POST', token: t })).status, 400); // owner must delete
  assert.equal((await api(`/groups/${created.data.group.id}`, { method: 'DELETE', token: arun })).status, 404);
  assert.equal((await api(`/groups/${created.data.group.id}`, { method: 'DELETE', token: t })).status, 200);
});

test('operator takedown: review reports, remove a listing, suspend a user', async () => {
  const reporter = await login('arun');
  const seller = await login('priya');
  const item = (await api('/me/listings', { token: seller })).data.listings.find((l) => l.status === 'active');
  await api('/reports', { method: 'POST', token: reporter, body: { targetType: 'listing', targetId: item.id, reason: 'Fake or misleading item' } });
  assert.equal((await api('/admin/reports')).status, 401);
  const open = (await api('/admin/reports', { headers: admin })).data.reports;
  const rep = open.find((x) => x.targetId === item.id);
  assert.equal(rep.target.title, item.title);
  assert.equal((await api(`/admin/reports/${rep.id}/resolve`, { method: 'POST', headers: admin, body: { action: 'bogus' } })).status, 400);
  assert.equal((await api(`/admin/reports/${rep.id}/resolve`, { method: 'POST', headers: admin, body: { action: 'remove_listing', note: 'misleading' } })).status, 200);
  assert.equal((await api(`/listings/${item.id}`, { token: reporter })).status, 404);
  assert.ok(!(await api('/listings?limit=50', { token: reporter })).data.listings.some((l) => l.id === item.id));
  assert.equal((await api(`/listings/${item.id}`, { token: seller })).status, 200); // owner can still see why
  assert.equal((await api('/admin/reports?status=resolved', { headers: admin })).data.reports[0].resolution.startsWith('remove_listing'), true);
  assert.equal((await api('/notifications', { token: seller })).data.notifications[0].type, 'moderation');

  // suspension
  const victim = await login('karthik');
  const kid = (await api('/me', { token: victim })).data.user.id;
  await api('/reports', { method: 'POST', token: reporter, body: { targetType: 'user', targetId: kid, reason: 'Looks like a scam' } });
  const r2 = (await api('/admin/reports', { headers: admin })).data.reports.find((x) => x.targetType === 'user' && x.targetId === kid);
  await api(`/admin/reports/${r2.id}/resolve`, { method: 'POST', headers: admin, body: { action: 'suspend_user' } });
  assert.equal((await api('/me', { token: victim })).status, 403);
  assert.equal((await api('/auth/login', { method: 'POST', body: { email: 'karthik@connectly.app', password: 'demo1234' } })).status, 403);
});

test('WhatsApp share page has Open Graph tags and escapes content', async () => {
  const t = await login('demo');
  const created = (await api('/listings', { method: 'POST', token: t, body: { title: 'Table <script>alert(1)</script>', category: 'home', price: 4500, description: 'Solid "teak" wood' } })).data.listing;
  const page = await api(`/l/${created.id}`);
  assert.equal(page.status, 200);
  assert.ok(page.data.includes('og:title'));
  assert.ok(page.data.includes('₹4,500'));
  assert.ok(!page.data.includes('<script>alert'));
  assert.ok(page.data.includes(`connectly://item/${created.id}`));
  assert.equal((await api('/l/99999')).status, 404);
});

test('cities list covers India with states', async () => {
  const c = (await api('/cities')).data;
  assert.ok(c.cities.length >= 30);
  assert.ok(c.details.every((x) => x.state && typeof x.lat === 'number'));
  assert.ok(c.cities.includes('Ahmedabad') && c.cities.includes('Guwahati'));
});

test('brand GSTIN validation and 18% GST on brand invoices', async () => {
  const t = await login('arun');
  assert.equal((await api('/me/brand', { method: 'POST', token: t, body: { brandName: 'Arun Tech', gstin: 'BADGSTIN' } })).status, 400);
  const ok = await api('/me/brand', { method: 'POST', token: t, body: { brandName: 'Arun Tech', gstin: '33ABCDE1234F1Z5' } });
  assert.equal(ok.status, 200);
  const s = (await api('/brand/summary', { token: t })).data;
  assert.equal(s.gstin, '33ABCDE1234F1Z5');
  assert.equal(s.gstRate, 0.18);
  assert.equal(s.totalDue, Math.round((s.subtotal + s.gst) * 100) / 100);
});

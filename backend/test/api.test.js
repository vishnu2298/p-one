process.env.NODE_ENV = 'test';
process.env.INSIGHTS_URL = 'http://127.0.0.1:1'; // service down: API must degrade gracefully
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'connectly-test-uploads');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { seed } = require('../src/seed');

let server, base;
before(async () => {
  const db = open(':memory:');
  seed(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const login = async (email) => (await api('/auth/login', { method: 'POST', body: { email, password: 'demo1234' } })).data.token;

test('register, validation and login', async () => {
  const bad = await api('/auth/register', { method: 'POST', body: { name: 'A', email: 'x', password: '1' } });
  assert.equal(bad.status, 400);
  const ok = await api('/auth/register', { method: 'POST', body: { name: 'New Person', email: 'new@x.com', password: 'secret1', city: 'Pune' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.city, 'Pune');
  const dup = await api('/auth/register', { method: 'POST', body: { name: 'New Person', email: 'NEW@x.com', password: 'secret1' } });
  assert.equal(dup.status, 409);
  assert.equal((await api('/auth/login', { method: 'POST', body: { email: 'new@x.com', password: 'wrong' } })).status, 401);
  assert.equal((await api('/me')).status, 401);
});

test('browse, search, filter and sort listings', async () => {
  const token = await login('demo@connectly.app');
  const all = await api('/listings', { token });
  assert.ok(all.data.total >= 15);
  const phones = await api('/listings?q=iphone', { token });
  assert.equal(phones.data.listings[0].title, 'iPhone 15 (128 GB)');
  const veh = await api('/listings?category=vehicles&sort=price_asc', { token });
  const prices = veh.data.listings.map((l) => l.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  const near = await api('/listings?sort=nearest', { token });
  assert.ok(near.data.listings[0].distanceKm != null);
  const s = await api('/search?q=Rohit', { token });
  assert.equal(s.data.people[0].name, 'Rohit Kumar');
});

test('sell flow: create, edit, favorite, delete, ownership rules', async () => {
  const token = await login('demo@connectly.app');
  const other = await login('rohit@connectly.app');
  const created = await api('/listings', { method: 'POST', token, body: { title: 'Test Table', category: 'home', price: 1500, description: 'Nice' } });
  assert.equal(created.status, 201);
  const id = created.data.listing.id;
  assert.equal((await api(`/listings/${id}`, { method: 'PATCH', token: other, body: { price: 1 } })).status, 403);
  const edited = await api(`/listings/${id}`, { method: 'PATCH', token, body: { price: 1400 } });
  assert.equal(edited.data.listing.price, 1400);
  assert.equal((await api(`/listings/${id}/favorite`, { method: 'POST', token: other })).data.isFavorite, true);
  assert.equal((await api('/favorites', { token: other })).data.listings.length, 1);
  assert.equal((await api('/listings', { method: 'POST', token, body: { title: 'x', category: 'nope', price: 5 } })).status, 400);
  assert.equal((await api(`/listings/${id}`, { method: 'DELETE', token })).status, 200);
  assert.equal((await api(`/listings/${id}`)).status, 404);
});

test('buy flow: request -> accept -> complete -> review', async () => {
  const buyer = await login('arun@connectly.app'); // Dell laptop belongs to the demo user
  const seller = await login('demo@connectly.app');
  const listing = (await api('/listings?q=Dell', { token: buyer })).data.listings[0];
  assert.equal((await api('/orders', { method: 'POST', token: seller, body: { listingId: listing.id } })).status, 400); // own item
  const order = (await api('/orders', { method: 'POST', token: buyer, body: { listingId: listing.id, note: 'Can pick up Sat' } })).data.order;
  assert.equal(order.status, 'requested');
  assert.equal((await api('/orders', { method: 'POST', token: buyer, body: { listingId: listing.id } })).status, 409);
  assert.equal((await api(`/orders/${order.id}/complete`, { method: 'POST', token: seller })).status, 400); // must accept first
  assert.equal((await api(`/orders/${order.id}/accept`, { method: 'POST', token: seller })).data.order.status, 'accepted');
  assert.equal((await api(`/orders/${order.id}/complete`, { method: 'POST', token: seller })).data.order.status, 'completed');
  assert.equal((await api(`/listings/${listing.id}`, { token: buyer })).data.listing.status, 'sold');
  assert.equal((await api(`/orders/${order.id}/review`, { method: 'POST', token: buyer, body: { rating: 5, comment: 'Great' } })).status, 201);
  assert.equal((await api(`/orders/${order.id}/review`, { method: 'POST', token: buyer, body: { rating: 4 } })).status, 409);
  assert.equal((await api('/orders?role=selling', { token: seller })).data.orders[0].status, 'completed');
});

test('chat: conversation, messages, unread, blocking', async () => {
  const demo = await login('demo@connectly.app');
  const rohit = await login('rohit@connectly.app');
  const convs = await api('/conversations', { token: demo });
  assert.ok(convs.data.conversations.length >= 2);
  const c = convs.data.conversations.find((x) => x.other.name === 'Rohit Kumar');
  assert.equal(c.unread, 2);
  const before = (await api('/unread-count', { token: demo })).data;
  assert.ok(before.messages >= 3 && before.requests === 2);
  const thread = await api(`/conversations/${c.id}/messages`, { token: demo });
  assert.equal(thread.data.messages.length, 3);
  assert.equal((await api('/unread-count', { token: demo })).data.messages, before.messages - 2);
  const sent = await api(`/conversations/${c.id}/messages`, { method: 'POST', token: demo, body: { body: 'Sure, I am in Chennai.' } });
  assert.equal(sent.status, 201);
  const since = await api(`/conversations/${c.id}/messages?after=${sent.data.message.id - 1}`, { token: rohit });
  assert.equal(since.data.messages.length, 1);
  assert.equal((await api(`/conversations/${c.id}/messages`, { token: await login('divya@connectly.app') })).status, 404);
  const start = await api('/conversations', { method: 'POST', token: rohit, body: { userId: 4 } });
  assert.equal(start.status, 201);
  await api(`/blocks/${thread.data.other.id}`, { method: 'POST', token: demo });
  assert.equal((await api(`/conversations/${c.id}/messages`, { method: 'POST', token: demo, body: { body: 'hi' } })).status, 403);
  await api(`/blocks/${thread.data.other.id}`, { method: 'DELETE', token: demo });
});

test('connections: request, accept, list', async () => {
  const demo = await login('demo@connectly.app');
  const people = (await api('/people', { token: demo })).data.people;
  const divya = people.find((p) => p.name === 'Divya S');
  assert.equal(divya.connection.status, 'none');
  const sent = await api('/connections', { method: 'POST', token: demo, body: { userId: divya.id } });
  assert.equal(sent.data.connection.status, 'sent');
  const dtoken = await login('divya@connectly.app');
  const reqs = (await api('/connections/requests', { token: dtoken })).data.requests;
  assert.equal(reqs.length, 1);
  await api(`/connections/${reqs[0].id}/respond`, { method: 'POST', token: dtoken, body: { accept: true } });
  assert.ok((await api('/connections', { token: demo })).data.connections.some((c) => c.user.name === 'Divya S'));
  const profile = await api(`/users/${divya.id}`, { token: demo });
  assert.equal(profile.data.connection.status, 'connected');
});

test('safety: reports and moderation fallback', async () => {
  const demo = await login('demo@connectly.app');
  assert.equal((await api('/reports', { method: 'POST', token: demo, body: { targetType: 'user', targetId: 2, reason: 'Spam' } })).status, 201);
  assert.equal((await api('/reports', { method: 'POST', token: demo, body: { targetType: 'bad', targetId: 2, reason: 'x' } })).status, 400);
  // insights service is unreachable here -> still works
  assert.equal((await api('/listings', { method: 'POST', token: demo, body: { title: 'Anything', category: 'others', price: 10 } })).status, 201);
});

test('profile update and account deletion', async () => {
  const token = (await api('/auth/register', { method: 'POST', body: { name: 'Temp User', email: 'temp@x.com', password: 'secret1' } })).data.token;
  const upd = await api('/me', { method: 'PATCH', token, body: { bio: 'Hello', interests: ['Bikes', 'Tech'], city: 'Kochi' } });
  assert.equal(upd.data.user.city, 'Kochi');
  assert.deepEqual(upd.data.user.interests, ['Bikes', 'Tech']);
  assert.equal((await api('/me', { method: 'DELETE', token, body: { password: 'nope' } })).status, 400);
  assert.equal((await api('/me', { method: 'DELETE', token, body: { password: 'secret1' } })).status, 200);
  assert.equal((await api('/me', { token })).status, 401);
});

test('deleting a listing or account with completed orders and reviews works', async () => {
  const seller = await login('priya@connectly.app'); // seed: completed order + review exist with demo as buyer
  const mine = (await api('/me/listings', { token: seller })).data.listings;
  const textbooks = mine.find((l) => l.title.startsWith('Maths'));
  assert.equal((await api(`/listings/${textbooks.id}`, { method: 'DELETE', token: seller })).status, 200);
  const demo = await login('demo@connectly.app');
  assert.equal((await api('/me', { method: 'DELETE', token: demo, body: { password: 'demo1234' } })).status, 200);
  assert.equal((await api('/auth/login', { method: 'POST', body: { email: 'demo@connectly.app', password: 'demo1234' } })).status, 401);
});

test('uploads accept real images only', async () => {
  const token = await login('demo2@connectly.app').catch(() => null);
  const t = token || (await api('/auth/register', { method: 'POST', body: { name: 'Uploader', email: 'up@x.com', password: 'secret1' } })).data.token;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==', 'base64').toString('base64');
  const good = await api('/uploads', { method: 'POST', token: t, body: { data: png, mime: 'image/png' } });
  assert.equal(good.status, 201);
  const file = await fetch(base + good.data.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');
  const fake = await api('/uploads', { method: 'POST', token: t, body: { data: Buffer.from('<html>hi</html>').toString('base64'), mime: 'image/png' } });
  assert.equal(fake.status, 400);
  assert.equal((await api('/uploads', { method: 'POST', token: t, body: { data: png, mime: 'text/html' } })).status, 400);
});

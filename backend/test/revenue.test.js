process.env.NODE_ENV = 'test';
process.env.INSIGHTS_URL = 'http://127.0.0.1:1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { seed } = require('../src/seed');

let server, base;
before(() => {
  config.affiliateSecret = 'sekret';
  const db = open(':memory:');
  seed(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}
const login = async (e) => (await api('/auth/login', { method: 'POST', body: { email: e, password: 'demo1234' } })).data.token;
const admin = { 'x-postback-key': 'sekret' };

test('individuals cannot run ads; upgrading to a brand is free', async () => {
  const demo = await login('demo@connectly.app');
  assert.equal((await api('/brand/ads', { method: 'POST', token: demo, body: { title: 'Hello there', targetUrl: 'https://x.com' } })).status, 403);
  const up = await api('/me/brand', { method: 'POST', token: demo, body: { brandName: 'Demo Gadgets' } });
  assert.equal(up.data.user.isBrand, true);
  assert.equal(up.data.user.brandName, 'Demo Gadgets');
});

test('ad lifecycle: create, serve, click billing with dedupe and budget cap', async () => {
  const demo = await login('demo@connectly.app');
  const mine = (await api('/me/listings', { token: demo })).data.listings[0];
  assert.equal((await api('/brand/ads', { method: 'POST', token: demo, body: { title: 'x' } })).status, 400);
  assert.equal((await api('/brand/ads', { method: 'POST', token: demo, body: { title: 'Bad link', targetUrl: 'http://insecure.com' } })).status, 400);
  const other = (await api('/listings?q=Cricket', { token: demo })).data.listings[0];
  assert.equal((await api('/brand/ads', { method: 'POST', token: demo, body: { title: 'Not mine', listingId: other.id } })).status, 400);
  const created = await api('/brand/ads', { method: 'POST', token: demo, body: { title: 'Fresh gadget deals', body: 'Great prices', listingId: mine.id, costPerClick: 10, dailyBudget: 50, placement: 'home' } });
  assert.equal(created.status, 201);
  const adId = created.data.ad.id;

  const served = (await api('/ads?placement=home')).data.ads;
  assert.ok(served.some((a) => a.id === adId && a.sponsored === true && a.brand.name === 'Demo Gadgets'));
  assert.ok(!(await api('/ads?placement=deals')).data.ads.some((a) => a.id === adId), 'home-only ad must not appear on deals');

  const viewer = await login('arun@connectly.app');
  const c1 = await api(`/ads/${adId}/click`, { method: 'POST', token: viewer });
  assert.equal(c1.data.listingId, mine.id);
  await api(`/ads/${adId}/click`, { method: 'POST', token: viewer }); // repeat within 10 min: free
  await api(`/ads/${adId}/click`, { method: 'POST', token: demo }); // brand clicking own ad: free
  const stats = (await api('/brand/ads', { token: demo })).data.ads.find((a) => a.id === adId);
  assert.equal(stats.clicks, 1);
  assert.equal(stats.spend, 10);
  assert.ok(stats.impressions >= 1);

  // daily budget (50) caps delivery: 4 more distinct people -> spend 50, ad stops serving
  for (const e of ['rohit', 'divya', 'priya', 'karthik']) await api(`/ads/${adId}/click`, { method: 'POST', token: await login(`${e}@connectly.app`) });
  assert.ok(!(await api('/ads?placement=home')).data.ads.some((a) => a.id === adId));

  await api(`/brand/ads/${adId}/status`, { method: 'POST', token: demo, body: { status: 'paused' } });
  assert.equal((await api(`/ads/${adId}/click`, { method: 'POST', token: viewer })).status, 404);
  const sum = (await api('/brand/summary', { token: demo })).data;
  assert.equal(sum.ads.spend, 50);
});

test('brokerage commission applies to brand sellers only, never individuals', async () => {
  const buyer = await login('arun@connectly.app');
  const sneha = await login('sneha@connectly.app'); // seeded brand partner (5%)
  const brandItem = (await api('/me/listings', { token: sneha })).data.listings.find((l) => l.status === 'active');
  const o1 = (await api('/orders', { method: 'POST', token: buyer, body: { listingId: brandItem.id } })).data.order;
  await api(`/orders/${o1.id}/accept`, { method: 'POST', token: sneha });
  const done = (await api(`/orders/${o1.id}/complete`, { method: 'POST', token: sneha })).data.order;
  assert.equal(done.commission, Math.round(brandItem.price * 0.05));

  const priya = await login('priya@connectly.app'); // individual
  const item = (await api('/me/listings', { token: priya })).data.listings.find((l) => l.status === 'active');
  const o2 = (await api('/orders', { method: 'POST', token: buyer, body: { listingId: item.id } })).data.order;
  await api(`/orders/${o2.id}/accept`, { method: 'POST', token: priya });
  assert.equal((await api(`/orders/${o2.id}/complete`, { method: 'POST', token: priya })).data.order.commission, 0);

  const rep = (await api('/admin/revenue', { headers: admin })).data;
  assert.equal(rep.byKind.find((k) => k.kind === 'brokerage').amount, done.commission);
  assert.equal(rep.byKind.find((k) => k.kind === 'brokerage').events, 1);
  assert.equal(rep.individualsCharged, 0);
  assert.ok(rep.byKind.some((k) => k.kind === 'ad_click'));
  assert.equal((await api('/admin/revenue')).status, 401);
});

test('affiliate commission is mirrored into the revenue ledger and reversible', async () => {
  const p = (await api('/products?category=home')).data.products[0];
  const click = (await api('/affiliate/click', { method: 'POST', body: { productId: p.id } })).data.clickId;
  const pb = (status) => api(`/affiliate/postback?key=sekret&click_id=${click}&order_id=A1&amount=1000&commission=45&status=${status}`);
  await pb('approved');
  const kind = async () => (await api('/admin/revenue', { headers: admin })).data.byKind.find((k) => k.kind === 'affiliate');
  assert.equal((await kind()).amount, 45);
  await pb('rejected');
  assert.equal(await kind(), undefined);
});

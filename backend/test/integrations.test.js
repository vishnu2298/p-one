process.env.NODE_ENV = 'test';
process.env.INSIGHTS_URL = 'http://127.0.0.1:1';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'connectly-test-uploads');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const config = require('../src/config');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { seed } = require('../src/seed');

let server, base, stub, stubCalls = 0, db;
const pushed = [];
let deadTokens = [];

before(async () => {
  config.firebaseDevMode = true;
  config.affiliateSecret = 'sekret';
  config.amazonTag = 'connectly-21';
  stub = http.createServer((req, res) => {
    stubCalls++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      shopping_results: [
        { title: 'Acme Phone 5G', price: '₹18,999.00', extracted_price: 18999, link: 'https://www.amazon.in/dp/B0TEST1', source: 'Amazon.in', thumbnail: 'https://img/1.jpg', rating: 4.4, reviews: 120 },
        { title: 'Acme Buds', price: '₹1,299', link: 'https://www.flipkart.com/acme-buds/p/itm1', source: 'Flipkart' },
        { title: 'No price item', link: 'https://x.com/a' },
        { title: 'Bad scheme', price: '₹5', link: 'javascript:alert(1)' },
      ],
    }));
  }).listen(0);
  config.searchApiBase = `http://127.0.0.1:${stub.address().port}/api/v1/search`;
  config.searchApiKey = 'test-key';
  db = open(':memory:');
  seed(db);
  server = createApp(db, { push: { enabled: true, async send(tokens, payload) { pushed.push({ tokens, payload }); return deadTokens; } } }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); stub.close(); });

async function api(path, { method = 'GET', body, token, headers = {}, redirect } = {}) {
  const res = await fetch(base + path, {
    method, redirect,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json() : await res.text() };
}
const login = async (email) => (await api('/auth/login', { method: 'POST', body: { email, password: 'demo1234' } })).data.token;
const tick = () => new Promise((r) => setTimeout(r, 30));

test('phone OTP sign-in via Firebase (dev mode): wrong code, new user, returning user, profile completion', async () => {
  const bad = await api('/auth/firebase', { method: 'POST', body: { idToken: 'dev:phone:+919876500001:000000' } });
  assert.equal(bad.status, 401);
  assert.equal((await api('/auth/firebase', { method: 'POST', body: { idToken: 'dev:phone:12345:123456' } })).status, 400);
  const first = await api('/auth/firebase', { method: 'POST', body: { idToken: 'dev:phone:+919876500001:123456', city: 'Madurai' } });
  assert.equal(first.status, 201);
  assert.equal(first.data.isNew, true);
  assert.equal(first.data.needsProfile, true);
  assert.equal(first.data.user.phone, '+919876500001');
  assert.equal(first.data.user.hasPassword, false);
  const patched = await api('/me', { method: 'PATCH', token: first.data.token, body: { name: 'Phone Person' } });
  assert.equal(patched.data.user.needsProfile, false);
  const again = await api('/auth/firebase', { method: 'POST', body: { idToken: 'dev:phone:+919876500001:123456' } });
  assert.equal(again.status, 200);
  assert.equal(again.data.isNew, false);
  assert.equal(again.data.user.id, first.data.user.id);
  // passwordless account can't log in with the password form
  assert.equal((await api('/auth/login', { method: 'POST', body: { email: '', password: '' } })).status, 400);
});

test('Google sign-in links to an existing verified email, else creates an account', async () => {
  const linked = await api('/auth/firebase', { method: 'POST', body: { idToken: 'dev:google:rohit@connectly.app:Rohit K' } });
  assert.equal(linked.data.isNew, false);
  assert.equal(linked.data.user.name, 'Rohit Kumar');
  const created = await api('/auth/firebase', { method: 'POST', body: { idToken: 'dev:google:fresh@gmail.com:Fresh Gmail' } });
  assert.equal(created.data.isNew, true);
  assert.equal(created.data.user.name, 'Fresh Gmail');
  assert.equal(created.data.needsProfile, false);
  // delete a passwordless account by typing DELETE
  assert.equal((await api('/me', { method: 'DELETE', token: created.data.token, body: {} })).status, 400);
  assert.equal((await api('/me', { method: 'DELETE', token: created.data.token, body: { confirm: 'DELETE' } })).status, 200);
});

test('dev tokens and unconfigured Firebase are rejected safely', async () => {
  config.firebaseDevMode = false;
  try {
    assert.equal((await api('/auth/firebase', { method: 'POST', body: { idToken: 'dev:phone:+919876500002:123456' } })).status, 401);
    const cfg = (await api('/auth/config')).data;
    assert.equal(cfg.devMode, false);
    assert.equal((await api('/auth/firebase', { method: 'POST', body: { idToken: 'eyJhbGciOi.fake.token' } })).status, 503); // no project configured
  } finally { config.firebaseDevMode = true; }
});

test('invites: code, link, referral signup auto-connects and notifies the inviter', async () => {
  const demo = await login('demo@connectly.app');
  const inv = (await api('/invites', { token: demo })).data;
  assert.match(inv.code, /^[A-Z0-9]{8}$/);
  assert.ok(inv.link.endsWith(`/i/${inv.code}`));
  assert.ok(inv.message.includes(inv.link));
  assert.equal((await api('/invites', { method: 'POST', token: demo, body: { channel: 'sms', count: 3 } })).status, 201);
  assert.equal((await api('/invites', { token: demo })).data.sent, 3);

  const reg = await api('/auth/register', { method: 'POST', body: { name: 'Mother In Law', email: 'mil@x.com', password: 'secret1', referralCode: inv.code.toLowerCase() } });
  assert.equal(reg.status, 201);
  const after = (await api('/invites', { token: demo })).data;
  assert.deepEqual(after.joined.map((j) => j.name), ['Mother In Law']);
  assert.ok((await api('/connections', { token: demo })).data.connections.some((c) => c.user.name === 'Mother In Law'));
  const notes = (await api('/notifications', { token: demo })).data.notifications;
  assert.equal(notes[0].type, 'invite_joined');
  // bad / self codes are ignored silently
  assert.equal((await api('/auth/register', { method: 'POST', body: { name: 'Other One', email: 'o1@x.com', password: 'secret1', referralCode: 'NOPE' } })).status, 201);

  const page = await api(`/i/${inv.code}`);
  assert.equal(page.status, 200);
  assert.ok(page.data.includes('Demo User invited you'));
  assert.ok(page.data.includes(`connectly://invite/${inv.code}`));
  const xss = await api('/i/<script>');
  assert.ok(!xss.data.includes('<script>'));
});

test('notifications: inbox, push delivery, token cleanup, opt-out', async () => {
  const demo = await login('demo@connectly.app');
  const rohit = await login('rohit@connectly.app');
  assert.equal((await api('/devices', { method: 'POST', token: demo, body: { token: 'tok-demo-aaaaaaaaaaaaaaaaaaaa', platform: 'android' } })).status, 201);
  assert.equal((await api('/devices', { method: 'POST', token: demo, body: { token: 'short' } })).status, 400);

  // a chat message pushes but does not clutter the inbox
  const convs = (await api('/conversations', { token: rohit })).data.conversations;
  const before = (await api('/notifications', { token: demo })).data.notifications.length;
  pushed.length = 0;
  await api(`/conversations/${convs[0].id}/messages`, { method: 'POST', token: rohit, body: { body: 'Hello there' } });
  await tick();
  assert.equal(pushed.length, 1);
  assert.deepEqual(pushed[0].tokens, ['tok-demo-aaaaaaaaaaaaaaaaaaaa']);
  assert.equal(pushed[0].payload.title, 'Rohit Kumar');
  assert.equal(pushed[0].payload.data.type, 'message');
  assert.equal((await api('/notifications', { token: demo })).data.notifications.length, before);

  // an order request lands in the inbox and the unread count
  const listing = (await api('/listings?q=Dell', { token: rohit })).data.listings[0];
  await api('/orders', { method: 'POST', token: rohit, body: { listingId: listing.id } });
  await tick();
  const inbox = (await api('/notifications', { token: demo })).data.notifications;
  assert.equal(inbox[0].type, 'order_request');
  assert.ok((await api('/unread-count', { token: demo })).data.notifications >= 1);
  await api('/notifications/read-all', { method: 'POST', token: demo });
  assert.equal((await api('/unread-count', { token: demo })).data.notifications, 0);

  // invalid tokens reported by FCM are removed
  deadTokens = ['tok-demo-aaaaaaaaaaaaaaaaaaaa'];
  await api('/connections', { method: 'POST', token: rohit, body: { userId: 1 } }).catch(() => {});
  await api(`/conversations/${convs[0].id}/messages`, { method: 'POST', token: rohit, body: { body: 'again' } });
  await tick();
  deadTokens = [];
  pushed.length = 0;
  await api(`/conversations/${convs[0].id}/messages`, { method: 'POST', token: rohit, body: { body: 'third' } });
  await tick();
  assert.equal(pushed.length, 0, 'dead token should have been deleted');

  // opt-out suppresses push but keeps the inbox
  await api('/devices', { method: 'POST', token: demo, body: { token: 'tok-demo-bbbbbbbbbbbbbbbbbbbb' } });
  await api('/me', { method: 'PATCH', token: demo, body: { pushEnabled: false } });
  await api(`/conversations/${convs[0].id}/messages`, { method: 'POST', token: rohit, body: { body: 'quiet' } });
  await tick();
  assert.equal(pushed.length, 0);
  await api('/me', { method: 'PATCH', token: demo, body: { pushEnabled: true } });
});

test('affiliate products: SearchAPI normalisation, caching, no merchant URLs leaked', async () => {
  stubCalls = 0;
  const r1 = await api('/products?q=acme');
  assert.equal(r1.status, 200);
  assert.equal(r1.data.products.length, 2); // item without price and non-http link are dropped
  assert.equal(r1.data.products[0].title, 'Acme Phone 5G');
  assert.equal(r1.data.products[0].price, 18999);
  assert.equal(r1.data.products[0].merchant, 'Amazon.in');
  assert.ok(!('url' in r1.data.products[0]));
  assert.ok(r1.data.disclosure.includes('commission'));
  assert.equal(r1.data.sample, false);
  await api('/products?q=ACME');
  assert.equal(stubCalls, 1, 'second request served from cache');
  const feed = await api('/products'); // default feed, no auth, no query
  assert.equal(feed.status, 200);
  assert.ok(feed.data.products.length > 0);
});

test('affiliate tracking: click -> redirect with tag + sub id -> postback conversion -> report', async () => {
  const demo = await login('demo@connectly.app');
  const p = (await api('/products?q=acme')).data.products[0];
  assert.equal((await api('/affiliate/click', { method: 'POST', body: { productId: 'nope' } })).status, 404);
  const click = await api('/affiliate/click', { method: 'POST', token: demo, body: { productId: p.id } });
  assert.equal(click.status, 201);
  const go = await api(new URL(click.data.url).pathname, { redirect: 'manual' });
  assert.equal(go.status, 302);
  const dest = new URL(go.headers.get('location'));
  assert.equal(dest.hostname, 'www.amazon.in');
  assert.equal(dest.searchParams.get('tag'), 'connectly-21');
  assert.equal(dest.searchParams.get('ascsubtag'), click.data.clickId);

  const pb = (extra = {}) => `/affiliate/postback?click_id=${click.data.clickId}&order_id=ORD1&amount=18999&commission=380&status=approved${extra.key === null ? '' : `&key=${extra.key || 'sekret'}`}`;
  assert.equal((await api(pb({ key: 'wrong' }))).status, 401);
  assert.equal((await api(pb({ key: null }))).status, 401);
  assert.equal((await api('/affiliate/postback?click_id=zzz&order_id=1&key=sekret')).status, 404);
  assert.equal((await api(pb())).status, 200);
  assert.equal((await api(pb())).status, 200); // idempotent
  const mine = (await api('/affiliate/my-clicks', { token: demo })).data.clicks;
  assert.equal(mine[0].purchaseStatus, 'approved');
  const rep = await api('/affiliate/report', { headers: { 'x-postback-key': 'sekret' } });
  assert.equal(rep.data.totals.conversions, 1);
  assert.equal(rep.data.totals.commission, 380);
  assert.equal(rep.data.totals.clicks, 1);
  assert.equal(rep.data.totals.conversionRate, 1);
  assert.equal((await api('/affiliate/report')).status, 401);
});

test('deep-link wrapper templates for networks that need them', () => {
  const { decorate } = require('../src/affiliate');
  const prev = config.affiliateNetworks;
  config.affiliateNetworks = JSON.stringify([{ match: 'myntra.com', template: 'https://wrap.example/r?u={url}&s={click}' }]);
  try {
    assert.equal(decorate('https://www.myntra.com/shoes?a=1', 'C1'), 'https://wrap.example/r?u=https%3A%2F%2Fwww.myntra.com%2Fshoes%3Fa%3D1&s=C1');
    assert.equal(decorate('https://other.com/x', 'C1'), 'https://other.com/x');
  } finally { config.affiliateNetworks = prev; }
});

test('without a SearchAPI key (non-production) sample products are served and flagged', async () => {
  const key = config.searchApiKey;
  config.searchApiKey = '';
  try {
    const r = await api('/products?category=home');
    assert.equal(r.data.sample, true);
    assert.ok(r.data.products.every((x) => x.demo));
  } finally { config.searchApiKey = key; }
});

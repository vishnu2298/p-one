// Shared test harness: in-memory app on a random port, with a controllable clock.
const { open } = require('../src/db');
const { createApp } = require('../src/app');

async function boot({ seedData = false, deps = {} } = {}) {
  process.env.NODE_ENV = 'test';
  process.env.INSIGHTS_URL = 'http://127.0.0.1:1';
  const db = open(':memory:');
  if (seedData) require('../src/seed').seed(db);
  const clock = { t: Date.now(), now() { return this.t; }, advance(ms) { this.t += ms; } };
  const app = createApp(db, { clock: () => clock.t, ...deps });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  }
  let n = 0;
  async function user(name, extra = {}) {
    n++;
    const email = extra.email || `${name.toLowerCase().replace(/\W/g, '')}${n}@t.example`;
    const r = await call('/auth/register', { method: 'POST', body: { consent: true, name, email, password: 'secret12', city: 'Chennai', phone: extra.phone } });
    if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.data)}`);
    db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(r.data.user.id);
    return { token: r.data.token, id: r.data.user.id, email, name };
  }
  return { db, app, ctx: app.ctx, clock, call, user, server, close: () => { server.close(); app.ctx.jobs.stop(); } };
}

const rupees = (n) => Math.round(n * 100);
module.exports = { boot, rupees };

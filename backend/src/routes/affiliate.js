const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { HttpError } = require('../util');
const { decorate, CATEGORY_KEYS } = require('../affiliate');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

module.exports = ({ db, auth, affiliate }) => {
  const r = express.Router();
  const getProduct = db.prepare('SELECT * FROM affiliate_products WHERE id = ?');
  const getClick = db.prepare('SELECT * FROM affiliate_clicks WHERE id = ?');

  // Default feed: anyone (even before logging in) can browse deals.
  r.get('/products', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const category = CATEGORY_KEYS.includes(req.query.category) ? req.query.category : undefined;
    const items = await affiliate.feed({ q, category });
    const limit = Math.min(Number(req.query.limit) || 24, 60);
    res.json({
      products: items.slice(0, limit),
      sample: items.some((p) => p.demo),
      disclosure: 'Connectly may earn a commission when you buy through these links. It does not change the price you pay.',
    });
  });

  // Creates a tracked click and returns the link the app should open.
  r.post('/affiliate/click', auth.optional, (req, res) => {
    const p = getProduct.get(String(req.body.productId || ''));
    if (!p) throw new HttpError(404, 'This deal is no longer available');
    const id = crypto.randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO affiliate_clicks (id, user_id, product_id, title, merchant, price, dest_url) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.user?.id ?? null, p.id, p.title, p.merchant, p.price, p.url);
    const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ clickId: id, url: `${base}/go/${id}` });
  });

  // Public redirect: records the redirect and sends the shopper to the merchant with our affiliate tag.
  r.get('/go/:clickId', (req, res) => {
    const c = getClick.get(req.params.clickId);
    if (!c) return res.status(404).send('Link not found');
    db.prepare('UPDATE affiliate_clicks SET redirected = redirected + 1 WHERE id = ?').run(c.id);
    res.set('Cache-Control', 'no-store').redirect(302, decorate(c.dest_url, c.id));
  });

  // Server-to-server conversion postback (Prosper202 / network style). {click_id} is the sub id we passed.
  //   /affiliate/postback?key=SECRET&click_id=..&order_id=..&amount=..&commission=..&status=approved|pending|rejected
  const postback = (req, res) => {
    const q = { ...req.query, ...(req.body || {}) };
    if (!config.affiliateSecret) throw new HttpError(503, 'Postbacks are not enabled');
    const key = req.get('x-postback-key') || q.key;
    if (!key || !safeEqual(key, config.affiliateSecret)) throw new HttpError(401, 'Invalid key');
    const click = getClick.get(String(q.click_id || ''));
    if (!click) throw new HttpError(404, 'Unknown click');
    const orderRef = String(q.order_id || '').slice(0, 80);
    if (!orderRef) throw new HttpError(400, 'order_id required');
    const status = ['approved', 'pending', 'rejected'].includes(q.status) ? q.status : 'pending';
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
    db.prepare(`INSERT INTO affiliate_conversions (click_id, order_ref, amount, commission, status) VALUES (?,?,?,?,?)
                ON CONFLICT(click_id, order_ref) DO UPDATE SET amount = excluded.amount, commission = excluded.commission, status = excluded.status, updated_at = CURRENT_TIMESTAMP`)
      .run(click.id, orderRef, num(q.amount), num(q.commission), status);
    // Mirror into the revenue ledger (approved/pending count; a rejection removes it).
    const ref = `aff:${click.id}:${orderRef}`;
    if (status === 'rejected') db.prepare("DELETE FROM revenue_events WHERE kind = 'affiliate' AND ref = ?").run(ref);
    else db.prepare("INSERT INTO revenue_events (kind, amount, ref) VALUES ('affiliate', ?, ?) ON CONFLICT(kind, ref) DO UPDATE SET amount = excluded.amount").run(num(q.commission), ref);
    res.json({ ok: true });
  };
  r.get('/affiliate/postback', postback);
  r.post('/affiliate/postback', postback);

  // Operator report (same secret): totals and per-merchant conversion rates.
  r.get('/affiliate/report', (req, res) => {
    const key = req.get('x-postback-key') || req.query.key;
    if (!config.affiliateSecret || !key || !safeEqual(key, config.affiliateSecret)) throw new HttpError(401, 'Invalid key');
    const rows = db.prepare(`
      SELECT COALESCE(NULLIF(c.merchant,''),'Unknown') AS merchant, COUNT(DISTINCT c.id) AS clicks,
             COUNT(v.id) AS conversions, COALESCE(SUM(CASE WHEN v.status != 'rejected' THEN v.commission END),0) AS commission,
             COALESCE(SUM(CASE WHEN v.status != 'rejected' THEN v.amount END),0) AS sales
      FROM affiliate_clicks c LEFT JOIN affiliate_conversions v ON v.click_id = c.id GROUP BY merchant ORDER BY clicks DESC`).all();
    const sum = (k) => rows.reduce((a, x) => a + x[k], 0);
    res.json({
      totals: { clicks: sum('clicks'), conversions: sum('conversions'), commission: sum('commission'), sales: sum('sales'), conversionRate: sum('clicks') ? sum('conversions') / sum('clicks') : 0 },
      merchants: rows,
    });
  });

  // A shopper's own history.
  r.get('/affiliate/my-clicks', auth.required, (req, res) => {
    const rows = db.prepare(`SELECT c.id, c.title, c.merchant, c.price, c.created_at,
        (SELECT status FROM affiliate_conversions v WHERE v.click_id = c.id ORDER BY v.id DESC LIMIT 1) AS status
        FROM affiliate_clicks c WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 30`).all(req.user.id);
    res.json({ clicks: rows.map((x) => ({ id: x.id, title: x.title, merchant: x.merchant, price: x.price, createdAt: x.created_at, purchaseStatus: x.status || null })) });
  });
  return r;
};

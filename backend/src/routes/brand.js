const express = require('express');
const config = require('../config');
const { HttpError, str } = require('../util');
const insights = require('../insights');
const crypto = require('crypto');

const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Business model: free for individuals. Brands pay through
 *   - sponsored placements (cost per click, with a daily budget cap)
 *   - brokerage commission on deals they complete (see orders.js)
 * Affiliate commissions are tracked in affiliate.js. All three land in revenue_events.
 */
module.exports = ({ db, ser, auth }) => {
  const r = express.Router();
  const getAd = db.prepare('SELECT * FROM ads WHERE id = ?');
  const recentClicks = new Map(); // dedupe repeat clicks so a brand is not charged for double taps

  const shapeAd = (a, brand) => ({
    id: a.id, title: a.title, body: a.body, ctaLabel: a.cta_label, image: a.image,
    listingId: a.target_listing_id, hasLink: !!a.target_url, brand: { id: brand.id, name: brand.brand_name || brand.name }, sponsored: true,
  });

  // Individuals can upgrade to a brand partner for free; billing only starts when they run ads or sell as a brand.
  r.post('/me/brand', auth.required, (req, res) => {
    const brandName = str(req.body.brandName, { min: 2, max: 60, name: 'Brand name' });
    db.prepare("UPDATE users SET account_type = 'brand', brand_name = ? WHERE id = ?").run(brandName, req.user.id);
    res.json({ user: ser.me(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });
  r.delete('/me/brand', auth.required, (req, res) => {
    db.prepare("UPDATE ads SET status = 'paused' WHERE brand_id = ?").run(req.user.id);
    db.prepare("UPDATE users SET account_type = 'individual' WHERE id = ?").run(req.user.id);
    res.json({ user: ser.me(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  const brandOnly = (req, _res, next) => (req.user.account_type === 'brand' ? next() : next(new HttpError(403, 'Ads are for brand partners. You can switch to a brand account from your profile.')));

  r.post('/brand/ads', auth.required, brandOnly, async (req, res) => {
    const b = req.body;
    const title = str(b.title, { min: 3, max: 80, name: 'Headline' });
    const body = str(b.body, { max: 160 });
    const targetUrl = str(b.targetUrl, { max: 500 });
    if (targetUrl && !/^https:\/\//i.test(targetUrl)) throw new HttpError(400, 'Link must start with https://');
    let listingId = null;
    if (b.listingId) {
      const l = db.prepare('SELECT seller_id FROM listings WHERE id = ?').get(Number(b.listingId));
      if (!l || l.seller_id !== req.user.id) throw new HttpError(400, 'You can only promote your own listings');
      listingId = Number(b.listingId);
    }
    if (!listingId && !targetUrl) throw new HttpError(400, 'Choose a listing to promote or add a link');
    const mod = await insights.moderate(`${title}\n${body}`);
    if (!mod.allowed) throw new HttpError(422, mod.reason || 'This ad was rejected for safety reasons.');
    const cpc = Math.min(Math.max(Number(b.costPerClick) || 2, 1), 100);
    const budget = Math.min(Math.max(Number(b.dailyBudget) || 200, 50), 100000);
    const placement = ['home', 'deals', 'all'].includes(b.placement) ? b.placement : 'all';
    const info = db.prepare('INSERT INTO ads (brand_id,title,body,cta_label,target_listing_id,target_url,placement,cost_per_click,daily_budget) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(req.user.id, title, body, str(b.ctaLabel, { max: 24 }) || 'Learn more', listingId, targetUrl, placement, cpc, budget);
    res.status(201).json({ ad: db.prepare('SELECT * FROM ads WHERE id = ?').get(info.lastInsertRowid) });
  });

  r.get('/brand/ads', auth.required, brandOnly, (req, res) => {
    const rows = db.prepare('SELECT * FROM ads WHERE brand_id = ? ORDER BY id DESC').all(req.user.id);
    res.json({
      ads: rows.map((a) => ({ id: a.id, title: a.title, body: a.body, status: a.status, placement: a.placement, costPerClick: a.cost_per_click, dailyBudget: a.daily_budget, impressions: a.impressions, clicks: a.clicks, spend: a.spend, listingId: a.target_listing_id, ctr: a.impressions ? a.clicks / a.impressions : 0 })),
    });
  });
  r.post('/brand/ads/:id/status', auth.required, brandOnly, (req, res) => {
    const a = getAd.get(req.params.id);
    if (!a || a.brand_id !== req.user.id) throw new HttpError(404, 'Ad not found');
    if (!['active', 'paused'].includes(req.body.status)) throw new HttpError(400, 'Invalid status');
    db.prepare('UPDATE ads SET status = ? WHERE id = ?').run(req.body.status, a.id);
    res.json({ ok: true });
  });
  r.delete('/brand/ads/:id', auth.required, brandOnly, (req, res) => {
    const a = getAd.get(req.params.id);
    if (!a || a.brand_id !== req.user.id) throw new HttpError(404, 'Ad not found');
    db.prepare('DELETE FROM ads WHERE id = ?').run(a.id);
    res.json({ ok: true });
  });
  r.get('/brand/summary', auth.required, brandOnly, (req, res) => {
    const ads = db.prepare('SELECT COALESCE(SUM(spend),0) spend, COALESCE(SUM(clicks),0) clicks, COALESCE(SUM(impressions),0) impressions FROM ads WHERE brand_id = ?').get(req.user.id);
    const brokerage = db.prepare("SELECT COALESCE(SUM(amount),0) fees, COUNT(*) deals FROM revenue_events WHERE kind = 'brokerage' AND brand_id = ?").get(req.user.id);
    res.json({ brandName: req.user.brand_name, commissionRate: req.user.commission_rate, ads, brokerage: { fees: brokerage.fees, deals: brokerage.deals }, totalDue: ads.spend + brokerage.fees });
  });

  // Serves sponsored cards. Each is clearly labelled "Sponsored" in the app.
  r.get('/ads', auth.optional, (req, res) => {
    const placement = ['home', 'deals'].includes(req.query.placement) ? req.query.placement : 'home';
    const day = today();
    const rows = db.prepare(`
      SELECT a.*, COALESCE(d.spend, 0) AS spent_today FROM ads a
      LEFT JOIN ad_daily d ON d.ad_id = a.id AND d.day = ?
      JOIN users u ON u.id = a.brand_id AND u.account_type = 'brand'
      WHERE a.status = 'active' AND (a.placement = 'all' OR a.placement = ?)
        AND COALESCE(d.spend, 0) + a.cost_per_click <= a.daily_budget
        AND (a.target_listing_id IS NULL OR EXISTS (SELECT 1 FROM listings l WHERE l.id = a.target_listing_id AND l.status = 'active'))
      ORDER BY a.cost_per_click DESC, RANDOM() LIMIT 3`).all(day, placement);
    const bump = db.prepare('UPDATE ads SET impressions = impressions + 1 WHERE id = ?');
    const brand = db.prepare('SELECT id, name, brand_name FROM users WHERE id = ?');
    rows.forEach((a) => bump.run(a.id));
    res.json({ ads: rows.map((a) => shapeAd(a, brand.get(a.brand_id))) });
  });

  r.post('/ads/:id/click', auth.optional, (req, res) => {
    const a = getAd.get(req.params.id);
    if (!a || a.status !== 'active') throw new HttpError(404, 'This offer has ended');
    const who = req.user?.id ?? req.ip;
    const key = `${a.id}:${who}`;
    const last = recentClicks.get(key) || 0;
    const billable = Date.now() - last > 10 * 60 * 1000 && !(req.user && req.user.id === a.brand_id);
    if (billable) {
      recentClicks.set(key, Date.now());
      if (recentClicks.size > 5000) recentClicks.clear();
      db.prepare('UPDATE ads SET clicks = clicks + 1, spend = spend + ? WHERE id = ?').run(a.cost_per_click, a.id);
      db.prepare('INSERT INTO ad_daily (ad_id, day, spend) VALUES (?,?,?) ON CONFLICT(ad_id, day) DO UPDATE SET spend = spend + excluded.spend').run(a.id, today(), a.cost_per_click);
      db.prepare('INSERT INTO revenue_events (kind, amount, ref, brand_id) VALUES (?,?,?,?)').run('ad_click', a.cost_per_click, `ad:${a.id}:${crypto.randomUUID()}`, a.brand_id);
    }
    res.json({ listingId: a.target_listing_id, url: a.target_listing_id ? null : a.target_url });
  });

  // Operator revenue report (same secret as the affiliate report).
  r.get('/admin/revenue', (req, res) => {
    const key = req.get('x-postback-key') || req.query.key;
    if (!config.affiliateSecret || !key || !safeEqual(key, config.affiliateSecret)) throw new HttpError(401, 'Invalid key');
    const byKind = db.prepare('SELECT kind, COUNT(*) events, COALESCE(SUM(amount),0) amount FROM revenue_events GROUP BY kind').all();
    const byMonth = db.prepare("SELECT substr(created_at,1,7) month, kind, COALESCE(SUM(amount),0) amount FROM revenue_events GROUP BY month, kind ORDER BY month DESC").all();
    res.json({ total: byKind.reduce((s, x) => s + x.amount, 0), byKind, byMonth, individualsCharged: 0 });
  });

  return r;
};

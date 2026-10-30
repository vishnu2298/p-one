const express = require('express');
const { features, HttpError } = require('./core');
const crypto = require('crypto');
const config = require('../config');

/** Mounts every domain module under /api/v1. Domains are toggled with FEATURES (business,auctions,storefront,services). */
function mountModules(app, ctx) {
  const f = features();
  const api = express.Router();
  const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const adminOnly = (req, _res, next) => {
    const key = req.get('x-postback-key') || req.query.key;
    if (!config.affiliateSecret || !key || !safeEq(key, config.affiliateSecret)) return next(new HttpError(401, 'Invalid key'));
    next();
  };
  ctx.adminOnly = adminOnly;

  api.get('/features', (_req, res) => res.json({ features: [...f], paymentsProvider: ctx.payments.provider }));

  /* ---- payments (shared by auctions and storefront) ---- */
  api.post('/webhooks/:provider', (req, res) => {
    const which = req.params.provider === 'razorpay' ? 'razorpay' : 'test';
    const sig = req.get(which === 'razorpay' ? 'x-razorpay-signature' : 'x-test-signature');
    const evt = ctx.payments.processWebhook(req.rawBody || Buffer.from(''), sig, which);
    res.json(evt);
  });
  api.get('/payments/:id', ctx.auth.required, (req, res) => {
    const p = ctx.payments.get(req.params.id);
    if (!p || p.user_id !== req.user.id) throw new HttpError(404, 'Payment not found');
    res.json({ payment: { id: p.id, status: p.status, amountPaise: p.amount_paise, purpose: p.purpose, provider: p.provider } });
  });
  // Test provider only: pushes a *signed webhook* for this payment through the real verification path.
  api.post('/payments/:id/simulate', ctx.auth.required, (req, res) => {
    const p = ctx.payments.get(req.params.id);
    if (!p || p.user_id !== req.user.id) throw new HttpError(404, 'Payment not found');
    res.json(ctx.payments.simulateTestPayment(p.id, { fail: req.body.fail === true }));
  });
  api.get('/admin/jobs', adminOnly, (_req, res) => res.json({ stats: ctx.jobs.stats(), failed: ctx.jobs.failed() }));

  const mods = [];
  if (f.has('business')) mods.push('business', 'accounting', 'inventory', 'purchasing', 'sales', 'dynamic');
  if (f.has('storefront')) mods.push('storefront');
  if (f.has('services')) mods.push('services');
  if (f.has('auctions')) mods.push('auctions');
  for (const m of mods) {
    try { api.use(require(`./${m}`).routes(ctx)); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  try { require('./ops').register(ctx); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  app.use('/api/v1', api);
}

module.exports = { mountModules };

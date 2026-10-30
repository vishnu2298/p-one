require('express-async-errors');
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { open } = require('./db');
const { authMiddleware } = require('./auth');
const { makeSerializers } = require('./serialize');
const { createPush } = require('./firebase');
const { makeNotifier } = require('./notify');
const { createAffiliate } = require('./affiliate');
const { createJobs } = require('./modules/jobs');
const { createPayments } = require('./modules/payments');
const { mountModules } = require('./modules');

function createApp(db = open(), deps = {}) {
  const app = express();
  const auth = authMiddleware(db);
  const ser = makeSerializers(db);
  const push = deps.push || createPush();
  const notify = makeNotifier(db, push);
  const affiliate = createAffiliate(db, deps.fetch);
  // Anti-spam limits per signed-in user (skipped in tests).
  const per = (limit, windowMs) => (process.env.NODE_ENV === 'test' ? (_q, _r, n) => n() : rateLimit({
    windowMs, limit, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => (req.user ? `u${req.user.id}` : req.ip),
    message: { error: 'You are doing that a lot. Please wait a moment and try again.' },
  }));
  const limits = { create: per(20, 60 * 60 * 1000), chat: per(60, 60 * 1000) };
  const clock = deps.clock || Date.now;
  const jobs = createJobs(db, { clock });
  const payments = createPayments(db, { clock, config });
  const publicBase = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;
  const ctx = { db, ser, auth, notify, push, affiliate, limits, clock, jobs, payments, publicBase };

  app.set('trust proxy', 1);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // The bundled web app shows product photos from other https hosts and talks to Firebase when configured.
    contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'img-src': ["'self'", 'data:', 'blob:', 'https:'], 'connect-src': ["'self'", 'https:'] } },
  }));
  app.use(cors());
  app.use(express.json({ limit: '9mb', verify: (req, _res, buf) => { req.rawBody = buf; } })); // raw body is needed to verify payment-webhook signatures
  if (process.env.NODE_ENV !== 'test') {
    app.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));
  }

  app.get('/health', (_req, res) => res.json({ ok: true, name: 'connectly-api' }));
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));

  for (const mod of ['auth', 'listings', 'orders', 'chat', 'people', 'safety', 'notifications', 'affiliate', 'invites', 'brand', 'legal', 'groups', 'admin', 'share']) {
    app.use(require(`./routes/${mod}`)(ctx));
  }

  mountModules(app, ctx);

  // Serve the prebuilt web app (backend/web) so the whole product runs from one process: `npm run demo`.
  const webDir = process.env.WEB_DIR || path.join(__dirname, '..', 'web');
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir, { maxAge: '1h' }));
    app.get('*', (req, res, next) => ((req.get('accept') || '').includes('text/html') ? res.sendFile(path.join(webDir, 'index.html')) : next()));
  }

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  app.ctx = ctx; // exposed for tests and the job worker
  return app;
}

module.exports = { createApp };

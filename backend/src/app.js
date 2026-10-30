require('express-async-errors');
const express = require('express');
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

function createApp(db = open(), deps = {}) {
  const app = express();
  const auth = authMiddleware(db);
  const ser = makeSerializers(db);
  const push = deps.push || createPush();
  const notify = makeNotifier(db, push);
  const affiliate = createAffiliate(db, deps.fetch);
  const ctx = { db, ser, auth, notify, push, affiliate };

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors());
  app.use(express.json({ limit: '9mb' }));
  if (process.env.NODE_ENV !== 'test') {
    app.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));
  }

  app.get('/health', (_req, res) => res.json({ ok: true, name: 'connectly-api' }));
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));

  for (const mod of ['auth', 'listings', 'orders', 'chat', 'people', 'safety', 'notifications', 'affiliate', 'invites', 'brand']) {
    app.use(require(`./routes/${mod}`)(ctx));
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
  return app;
}

module.exports = { createApp };

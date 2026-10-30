const express = require('express');
const config = require('../config');
const { ensureCode } = require('../referral');


const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = ({ db, auth }) => {
  const r = express.Router();
  const baseUrl = (req) => config.inviteBaseUrl || config.publicUrl || `${req.protocol}://${req.get('host')}`;

  r.get('/invites', auth.required, (req, res) => {
    const code = ensureCode(db, req.user.id);
    const link = `${baseUrl(req)}/i/${code}`;
    const joined = db.prepare('SELECT id, name, created_at FROM users WHERE referred_by = ? ORDER BY id DESC').all(req.user.id);
    const sent = db.prepare('SELECT COUNT(*) n FROM invites WHERE inviter_id = ?').get(req.user.id).n;
    const first = (req.user.name || 'A friend').split(' ')[0];
    res.json({
      code,
      link,
      message: `Hi! ${first} here. I am using Connectly to buy, sell and meet people nearby. Join me: ${link} (invite code ${code})`,
      sent,
      joined: joined.map((u) => ({ id: u.id, name: u.name || 'New member', joinedAt: u.created_at })),
    });
  });

  // Records that the user shared their invite (count only; we never store contact details).
  r.post('/invites', auth.required, (req, res) => {
    const channel = ['sms', 'whatsapp', 'share', 'copy'].includes(req.body.channel) ? req.body.channel : 'share';
    const n = Math.max(1, Math.min(Number(req.body.count) || 1, 50));
    const ins = db.prepare('INSERT INTO invites (inviter_id, channel) VALUES (?,?)');
    for (let i = 0; i < n; i++) ins.run(req.user.id, channel);
    res.status(201).json({ ok: true });
  });

  // Public landing page that opens the app (or the store) with the invite code attached.
  r.get('/i/:code', (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const inviter = /^[A-Z0-9]{6,12}$/.test(code) ? db.prepare('SELECT name FROM users WHERE referral_code = ?').get(code) : null;
    const who = esc(inviter?.name || 'A friend');
    const deep = `connectly://invite/${esc(code)}`;
    const store = config.androidStoreUrl || config.iosStoreUrl || '#';
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'").type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join Connectly</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#F5F7FA;color:#0B1B2B;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.c{background:#fff;border-radius:22px;padding:28px;max-width:420px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.08)}h1{font-size:28px;margin:8px 0}p{font-size:18px;line-height:1.4}
a.b{display:block;margin-top:14px;padding:18px;border-radius:16px;font-size:20px;font-weight:700;text-decoration:none;color:#fff;background:#1747C6}a.s{background:#fff;color:#1747C6;border:2px solid #1747C6}
.code{font-size:26px;letter-spacing:4px;font-weight:700;background:#E6EDFC;border-radius:12px;padding:10px;margin-top:10px}</style></head>
<body><div class="c"><h1>${who} invited you to Connectly</h1><p>Buy, sell and connect with people nearby. Simple and safe.</p><div class="code">${esc(code)}</div>
<a class="b" href="${deep}">Open the app</a><a class="b s" href="${esc(store)}">Get the app</a><p style="font-size:15px;color:#475467">Enter the code above when you sign up.</p></div></body></html>`);
  });
  return r;
};

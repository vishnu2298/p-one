const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { HttpError } = require('../util');

const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Operator tools for takedowns (IT Rules 2021). Protected by the same secret as the revenue report.
module.exports = ({ db, notify }) => {
  const r = express.Router();
  r.use('/admin/reports', (req, _res, next) => {
    const key = req.get('x-postback-key') || req.query.key;
    if (!config.affiliateSecret || !key || !safeEqual(key, config.affiliateSecret)) return next(new HttpError(401, 'Invalid key'));
    next();
  });

  r.get('/admin/reports', (req, res) => {
    const status = req.query.status === 'resolved' ? 'resolved' : 'open';
    const rows = db.prepare('SELECT * FROM reports WHERE status = ? ORDER BY id DESC LIMIT 100').all(status);
    res.json({
      reports: rows.map((x) => {
        const target = x.target_type === 'listing' ? db.prepare('SELECT id, title, seller_id, status FROM listings WHERE id = ?').get(x.target_id)
          : x.target_type === 'user' ? db.prepare('SELECT id, name, suspended FROM users WHERE id = ?').get(x.target_id) : null;
        return { id: x.id, targetType: x.target_type, targetId: x.target_id, target, reason: x.reason, details: x.details, reporterId: x.reporter_id, createdAt: x.created_at, status: x.status, resolution: x.resolution };
      }),
    });
  });

  r.post('/admin/reports/:id/resolve', (req, res) => {
    const rep = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    if (!rep) throw new HttpError(404, 'Report not found');
    const action = req.body.action;
    if (!['dismiss', 'remove_listing', 'suspend_user'].includes(action)) throw new HttpError(400, 'action must be dismiss, remove_listing or suspend_user');
    if (action === 'remove_listing') {
      if (rep.target_type !== 'listing') throw new HttpError(400, 'This report is not about a listing');
      const l = db.prepare('SELECT seller_id, title FROM listings WHERE id = ?').get(rep.target_id);
      if (l) {
        db.prepare("UPDATE listings SET status = 'removed' WHERE id = ?").run(rep.target_id);
        db.prepare("UPDATE orders SET status = 'cancelled' WHERE listing_id = ? AND status IN ('requested','accepted')").run(rep.target_id);
        notify(l.seller_id, { type: 'moderation', title: 'Your listing was removed', body: `"${l.title}" broke our rules. See Trust and safety for details.`, data: {} });
      }
    }
    if (action === 'suspend_user') {
      const uid = rep.target_type === 'user' ? rep.target_id : db.prepare('SELECT seller_id FROM listings WHERE id = ?').get(rep.target_id)?.seller_id;
      if (!uid) throw new HttpError(400, 'No user to suspend for this report');
      db.prepare('UPDATE users SET suspended = 1 WHERE id = ?').run(uid);
      db.prepare('DELETE FROM device_tokens WHERE user_id = ?').run(uid);
      db.prepare("UPDATE listings SET status = 'removed' WHERE seller_id = ? AND status = 'active'").run(uid);
    }
    db.prepare("UPDATE reports SET status = 'resolved', resolution = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(`${action}${req.body.note ? ': ' + String(req.body.note).slice(0, 200) : ''}`, rep.id);
    res.json({ ok: true });
  });
  return r;
};

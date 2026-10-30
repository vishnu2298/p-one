const express = require('express');
const { HttpError, str } = require('../util');

module.exports = ({ db, auth }) => {
  const r = express.Router();
  r.use(['/notifications', '/devices'], auth.required);

  const shape = (n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, data: JSON.parse(n.data || '{}'), read: !!n.read_at, createdAt: n.created_at });

  r.get('/notifications', (req, res) => {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60').all(req.user.id);
    res.json({ notifications: rows.map(shape) });
  });
  r.post('/notifications/read-all', (req, res) => {
    db.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL').run(req.user.id);
    res.json({ ok: true });
  });
  r.post('/notifications/:id/read', (req, res) => {
    db.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  // FCM device tokens. A token belongs to whoever registered it last (shared phones, re-logins).
  r.post('/devices', (req, res) => {
    const token = str(req.body.token, { min: 20, max: 4096, name: 'Token' });
    db.prepare('INSERT INTO device_tokens (user_id, token, platform) VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform')
      .run(req.user.id, token, str(req.body.platform, { max: 20 }));
    res.status(201).json({ ok: true });
  });
  r.delete('/devices', (req, res) => {
    if (typeof req.body.token !== 'string') throw new HttpError(400, 'Token required');
    db.prepare('DELETE FROM device_tokens WHERE token = ? AND user_id = ?').run(req.body.token, req.user.id);
    res.json({ ok: true });
  });
  return r;
};

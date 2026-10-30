const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HttpError, str } = require('../util');
const config = require('../config');

module.exports = ({ db, auth }) => {
  const r = express.Router();

  r.post('/reports', auth.required, (req, res) => {
    const type = ['listing', 'user', 'message'].includes(req.body.targetType) ? req.body.targetType : null;
    if (!type || !Number(req.body.targetId)) throw new HttpError(400, 'Nothing to report');
    const reason = str(req.body.reason, { min: 1, max: 80, name: 'Reason' });
    db.prepare('INSERT INTO reports (reporter_id,target_type,target_id,reason,details) VALUES (?,?,?,?,?)')
      .run(req.user.id, type, Number(req.body.targetId), reason, str(req.body.details, { max: 500 }));
    res.status(201).json({ ok: true, message: 'Thank you. Our team will review this report.' });
  });

  r.post('/blocks/:userId', auth.required, (req, res) => {
    const id = Number(req.params.userId);
    if (id === req.user.id) throw new HttpError(400, 'You cannot block yourself');
    db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?,?)').run(req.user.id, id);
    db.prepare('DELETE FROM connections WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)').run(req.user.id, id, id, req.user.id);
    res.json({ ok: true });
  });
  r.delete('/blocks/:userId', auth.required, (req, res) => {
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, req.params.userId);
    res.json({ ok: true });
  });

  // Image upload (base64 JSON keeps the mobile client simple and works on web too).
  r.post('/uploads', auth.required, (req, res) => {
    const { data, mime } = req.body;
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
    if (!ext || typeof data !== 'string') throw new HttpError(400, 'Please upload a JPG, PNG or WebP image');
    const buf = Buffer.from(data, 'base64');
    if (buf.length === 0 || buf.length > 6 * 1024 * 1024) throw new HttpError(400, 'Image must be under 6 MB');
    const magic = { jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] }[ext];
    if (!magic.every((b, i) => buf[i] === b)) throw new HttpError(400, 'That file is not a valid image');
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const name = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(config.uploadDir, name), buf);
    res.status(201).json({ url: `/uploads/${name}` });
  });

  return r;
};

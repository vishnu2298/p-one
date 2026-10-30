const express = require('express');
const { HttpError, str, CITIES } = require('../util');
const insights = require('../insights');

module.exports = ({ db, ser, auth, limits }) => {
  const r = express.Router();
  const getGroup = db.prepare('SELECT * FROM groups WHERE id = ?');
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
  const isMember = (gid, uid) => !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(gid, uid);

  const shape = (g, me) => ({
    id: g.id, name: g.name, description: g.description, city: g.city, interest: g.interest,
    memberCount: db.prepare('SELECT COUNT(*) n FROM group_members WHERE group_id = ?').get(g.id).n,
    isMember: isMember(g.id, me.id), isOwner: g.owner_id === me.id,
  });

  r.get('/groups', auth.required, (req, res) => {
    const q = String(req.query.q || '').trim().replace(/[%_]/g, '');
    const like = `%${q}%`;
    const where = ['1=1']; const params = [];
    if (q) { where.push('(name LIKE ? OR description LIKE ? OR interest LIKE ?)'); params.push(like, like, like); }
    if (req.query.city && CITIES[req.query.city]) { where.push('(city = ? OR city = \'\')'); params.push(req.query.city); }
    if (req.query.mine === '1') { where.push('id IN (SELECT group_id FROM group_members WHERE user_id = ?)'); params.push(req.user.id); }
    const rows = db.prepare(`SELECT * FROM groups WHERE ${where.join(' AND ')} ORDER BY (SELECT COUNT(*) FROM group_members m WHERE m.group_id = groups.id) DESC, id DESC LIMIT 50`).all(...params);
    res.json({ groups: rows.map((g) => shape(g, req.user)) });
  });

  r.post('/groups', auth.required, limits.create, async (req, res) => {
    const name = str(req.body.name, { min: 3, max: 60, name: 'Group name' });
    const description = str(req.body.description, { max: 300 });
    const city = CITIES[req.body.city] ? req.body.city : '';
    const interest = str(req.body.interest, { max: 40 });
    const mod = await insights.moderate(`${name}\n${description}`);
    if (!mod.allowed) throw new HttpError(422, mod.reason);
    if (db.prepare('SELECT COUNT(*) n FROM groups WHERE owner_id = ?').get(req.user.id).n >= 5) throw new HttpError(400, 'You can create up to 5 groups');
    const info = db.prepare('INSERT INTO groups (name, description, city, interest, owner_id) VALUES (?,?,?,?,?)').run(name, description, city, interest, req.user.id);
    db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?,?)').run(info.lastInsertRowid, req.user.id);
    res.status(201).json({ group: shape(getGroup.get(info.lastInsertRowid), req.user) });
  });

  r.get('/groups/:id', auth.required, (req, res) => {
    const g = getGroup.get(req.params.id);
    if (!g) throw new HttpError(404, 'Group not found');
    const members = db.prepare('SELECT u.* FROM users u JOIN group_members m ON m.user_id = u.id WHERE m.group_id = ? ORDER BY m.joined_at LIMIT 30').all(g.id).map((u) => ser.user(u));
    res.json({ group: shape(g, req.user), members });
  });

  r.post('/groups/:id/join', auth.required, (req, res) => {
    const g = getGroup.get(req.params.id);
    if (!g) throw new HttpError(404, 'Group not found');
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?,?)').run(g.id, req.user.id);
    res.json({ group: shape(g, req.user) });
  });
  r.post('/groups/:id/leave', auth.required, (req, res) => {
    const g = getGroup.get(req.params.id);
    if (!g) throw new HttpError(404, 'Group not found');
    if (g.owner_id === req.user.id) throw new HttpError(400, 'You started this group, so you can delete it instead of leaving');
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(g.id, req.user.id);
    res.json({ group: shape(g, req.user) });
  });
  r.delete('/groups/:id', auth.required, (req, res) => {
    const g = getGroup.get(req.params.id);
    if (!g || g.owner_id !== req.user.id) throw new HttpError(404, 'Group not found');
    db.prepare('DELETE FROM groups WHERE id = ?').run(g.id);
    res.json({ ok: true });
  });

  const shapeMsg = (m) => ({ id: m.id, groupId: m.group_id, senderId: m.sender_id, sender: ser.user(getUser.get(m.sender_id)), body: m.body, type: m.type, createdAt: m.created_at });

  r.get('/groups/:id/messages', auth.required, (req, res) => {
    const g = getGroup.get(req.params.id);
    if (!g) throw new HttpError(404, 'Group not found');
    if (!isMember(g.id, req.user.id)) throw new HttpError(403, 'Join this group to read and write messages');
    const after = Number(req.query.after) || 0;
    const rows = db.prepare('SELECT * FROM group_messages WHERE group_id = ? AND id > ? ORDER BY id ASC LIMIT 100').all(g.id, after);
    const blocked = new Set(db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?').all(req.user.id).map((b) => b.blocked_id));
    res.json({ messages: rows.filter((m) => !blocked.has(m.sender_id)).map(shapeMsg) });
  });

  r.post('/groups/:id/messages', auth.required, limits.chat, async (req, res) => {
    const g = getGroup.get(req.params.id);
    if (!g) throw new HttpError(404, 'Group not found');
    if (!isMember(g.id, req.user.id)) throw new HttpError(403, 'Join this group to write messages');
    const type = req.body.type === 'image' ? 'image' : 'text';
    const body = str(req.body.body, { min: 1, max: 1000, name: 'Message' });
    if (type === 'image' && !/^\/uploads\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(body)) throw new HttpError(400, 'Invalid photo');
    if (type === 'text') {
      const mod = await insights.moderate(body);
      if (!mod.allowed) throw new HttpError(422, mod.reason);
    }
    const info = db.prepare('INSERT INTO group_messages (group_id, sender_id, body, type) VALUES (?,?,?,?)').run(g.id, req.user.id, body, type);
    res.status(201).json({ message: shapeMsg(db.prepare('SELECT * FROM group_messages WHERE id = ?').get(info.lastInsertRowid)) });
  });
  return r;
};

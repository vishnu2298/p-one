const express = require('express');
const { HttpError, str } = require('../util');
const insights = require('../insights');

module.exports = ({ db, ser, auth, notify }) => {
  const r = express.Router();
  r.use(['/conversations', '/unread-count'], auth.required);
  const getConv = db.prepare('SELECT * FROM conversations WHERE id = ?');
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
  const getListing = db.prepare('SELECT * FROM listings WHERE id = ?');

  const isBlocked = (a, b) =>
    !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a);

  const msg = (m) => ({ id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, body: m.body, type: m.type, createdAt: m.created_at, readAt: m.read_at });

  function mine(req) {
    const c = getConv.get(req.params.id);
    if (!c || (c.user_a !== req.user.id && c.user_b !== req.user.id)) throw new HttpError(404, 'Conversation not found');
    return c;
  }

  r.get('/conversations', (req, res) => {
    const me = req.user.id;
    const rows = db
      .prepare(
        `SELECT c.* FROM conversations c
         WHERE (c.user_a = ? OR c.user_b = ?)
           AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
         ORDER BY c.updated_at DESC, c.id DESC`,
      )
      .all(me, me);
    const out = rows
      .filter((c) => !isBlocked(me, c.user_a === me ? c.user_b : c.user_a))
      .map((c) => {
        const otherId = c.user_a === me ? c.user_b : c.user_a;
        const last = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(c.id);
        const unread = db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL').get(c.id, me).n;
        const l = c.listing_id ? getListing.get(c.listing_id) : null;
        return {
          id: c.id,
          other: ser.user(getUser.get(otherId)),
          listing: l ? { id: l.id, title: l.title, price: l.price } : null,
          lastMessage: last ? { ...msg(last), mine: last.sender_id === me } : null,
          unread,
          updatedAt: c.updated_at,
        };
      });
    res.json({ conversations: out });
  });

  r.get('/unread-count', (req, res) => {
    const n = db
      .prepare(
        `SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE (c.user_a = ? OR c.user_b = ?) AND m.sender_id != ? AND m.read_at IS NULL`,
      )
      .get(req.user.id, req.user.id, req.user.id).n;
    const requests = db.prepare("SELECT COUNT(*) n FROM connections WHERE addressee_id = ? AND status = 'pending'").get(req.user.id).n;
    const notifications = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
    res.json({ messages: n, requests, notifications });
  });

  // Find or create a conversation with another user (optionally about a listing).
  r.post('/conversations', (req, res) => {
    const other = Number(req.body.userId);
    if (!other || other === req.user.id || !getUser.get(other)) throw new HttpError(400, 'Cannot start this chat');
    if (isBlocked(req.user.id, other)) throw new HttpError(403, 'You cannot message this person');
    const listingId = req.body.listingId ? Number(req.body.listingId) : null;
    let c = db
      .prepare('SELECT * FROM conversations WHERE ((user_a=? AND user_b=?) OR (user_a=? AND user_b=?)) AND COALESCE(listing_id,0) = ?')
      .get(req.user.id, other, other, req.user.id, listingId || 0);
    if (!c) {
      const info = db.prepare('INSERT INTO conversations (user_a,user_b,listing_id) VALUES (?,?,?)').run(req.user.id, other, listingId);
      c = getConv.get(info.lastInsertRowid);
    }
    res.status(201).json({
      conversation: {
        id: c.id,
        other: ser.user(getUser.get(other)),
        listing: listingId && getListing.get(listingId) ? (({ id, title, price }) => ({ id, title, price }))(getListing.get(listingId)) : null,
      },
    });
  });

  r.get('/conversations/:id/messages', (req, res) => {
    const c = mine(req);
    const after = Number(req.query.after) || 0;
    const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT 200').all(c.id, after);
    db.prepare('UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL').run(c.id, req.user.id);
    const otherId = c.user_a === req.user.id ? c.user_b : c.user_a;
    const l = c.listing_id ? getListing.get(c.listing_id) : null;
    res.json({
      messages: rows.map(msg),
      other: ser.user(getUser.get(otherId)),
      listing: l ? { id: l.id, title: l.title, price: l.price } : null,
    });
  });

  r.post('/conversations/:id/messages', async (req, res) => {
    const c = mine(req);
    const otherId = c.user_a === req.user.id ? c.user_b : c.user_a;
    if (isBlocked(req.user.id, otherId)) throw new HttpError(403, 'You cannot message this person');
    const type = req.body.type === 'location' ? 'location' : 'text';
    const body = str(req.body.body, { min: 1, max: 1000, name: 'Message' });
    const mod = type === 'text' ? await insights.moderate(body) : { allowed: true, flags: [] };
    const info = db.prepare('INSERT INTO messages (conversation_id, sender_id, body, type) VALUES (?,?,?,?)').run(c.id, req.user.id, body, type);
    db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(c.id);
    notify(otherId, { type: 'message', title: req.user.name || 'New message', body: type === 'location' ? 'Shared a location' : body.slice(0, 140), data: { conversationId: c.id } }, { inbox: false });
    res.status(201).json({
      message: msg(db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid)),
      safetyTip: mod.flags?.length ? 'Stay safe: never pay in advance or share OTPs, card details or passwords. Meet in a public place.' : null,
    });
  });

  return r;
};

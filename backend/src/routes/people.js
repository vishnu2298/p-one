const express = require('express');
const { HttpError, haversineKm } = require('../util');

module.exports = ({ db, ser, auth, notify }) => {
  const r = express.Router();
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');

  function statusWith(meId, otherId) {
    const c = db
      .prepare('SELECT * FROM connections WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)')
      .get(meId, otherId, otherId, meId);
    if (!c) return { status: 'none' };
    if (c.status === 'accepted') return { status: 'connected', connectionId: c.id };
    return { status: c.requester_id === meId ? 'sent' : 'received', connectionId: c.id };
  }

  r.get('/people', auth.required, (req, res) => {
    const me = req.user;
    const q = String(req.query.q || '').trim();
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const rows = db
      .prepare(
        `SELECT * FROM users WHERE id != ?
         AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
         AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
         ${q ? 'AND (name LIKE ? OR interests LIKE ? OR bio LIKE ? OR city LIKE ?)' : ''}`,
      )
      .all(...[me.id, me.id, me.id, ...(q ? [like, like, like, like] : [])]);
    let people = rows.map((u) => ({
      ...ser.user(u, { full: true }),
      distanceKm: haversineKm(me.lat, me.lng, u.lat, u.lng),
      connection: statusWith(me.id, u.id),
    }));
    if (req.query.interest) people = people.filter((p) => p.interests.some((i) => i.toLowerCase() === String(req.query.interest).toLowerCase()));
    people.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    res.json({ people: people.slice(0, 50) });
  });

  r.get('/interests', auth.required, (_req, res) => {
    const counts = {};
    for (const { interests } of db.prepare("SELECT interests FROM users WHERE interests != ''").all()) {
      interests.split(',').map((s) => s.trim()).filter(Boolean).forEach((i) => (counts[i] = (counts[i] || 0) + 1));
    }
    res.json({ interests: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })) });
  });

  r.get('/users/:id', auth.optional, (req, res) => {
    const u = getUser.get(req.params.id);
    if (!u) throw new HttpError(404, 'Profile not found');
    const reviews = db
      .prepare('SELECT r.*, u.name AS reviewer_name FROM reviews r JOIN users u ON u.id = r.reviewer_id WHERE reviewee_id = ? ORDER BY r.id DESC LIMIT 20')
      .all(u.id)
      .map((x) => ({ id: x.id, rating: x.rating, comment: x.comment, reviewer: x.reviewer_name, createdAt: x.created_at }));
    const listings = db.prepare("SELECT * FROM listings WHERE seller_id = ? AND status = 'active' ORDER BY id DESC LIMIT 20").all(u.id);
    res.json({
      user: ser.user(u, { full: true }),
      listings: listings.map((l) => ser.listing(l, req.user)),
      reviews,
      distanceKm: req.user ? haversineKm(req.user.lat, req.user.lng, u.lat, u.lng) : null,
      connection: req.user && req.user.id !== u.id ? statusWith(req.user.id, u.id) : { status: 'none' },
      blocked: req.user ? !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.user.id, u.id) : false,
    });
  });

  r.post('/connections', auth.required, (req, res) => {
    const other = Number(req.body.userId);
    if (!other || other === req.user.id || !getUser.get(other)) throw new HttpError(400, 'Cannot connect with this person');
    const existing = statusWith(req.user.id, other);
    if (existing.status === 'received') {
      db.prepare("UPDATE connections SET status = 'accepted' WHERE id = ?").run(existing.connectionId);
      notify(other, { type: 'connection_accepted', title: 'You are now connected', body: `${req.user.name || 'Someone'} accepted your request`, data: { userId: req.user.id } });
      return res.json({ connection: { status: 'connected' } });
    }
    if (existing.status !== 'none') return res.json({ connection: existing });
    db.prepare('INSERT INTO connections (requester_id, addressee_id) VALUES (?,?)').run(req.user.id, other);
    notify(other, { type: 'connection_request', title: 'New connection request', body: `${req.user.name || 'Someone'} wants to connect with you`, data: { userId: req.user.id } });
    res.status(201).json({ connection: { status: 'sent' } });
  });

  r.get('/connections', auth.required, (req, res) => {
    const rows = db
      .prepare("SELECT * FROM connections WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?) ORDER BY id DESC")
      .all(req.user.id, req.user.id);
    res.json({
      connections: rows.map((c) => ({
        id: c.id,
        user: ser.user(getUser.get(c.requester_id === req.user.id ? c.addressee_id : c.requester_id), { full: true }),
      })),
    });
  });

  r.get('/connections/requests', auth.required, (req, res) => {
    const rows = db.prepare("SELECT * FROM connections WHERE addressee_id = ? AND status = 'pending' ORDER BY id DESC").all(req.user.id);
    res.json({
      requests: rows.map((c) => ({
        id: c.id,
        createdAt: c.created_at,
        user: ser.user(getUser.get(c.requester_id), { full: true }),
        distanceKm: (({ lat, lng }) => haversineKm(req.user.lat, req.user.lng, lat, lng))(getUser.get(c.requester_id)),
      })),
    });
  });

  r.post('/connections/:id/respond', auth.required, (req, res) => {
    const c = db.prepare("SELECT * FROM connections WHERE id = ? AND addressee_id = ? AND status = 'pending'").get(req.params.id, req.user.id);
    if (!c) throw new HttpError(404, 'Request not found');
    if (req.body.accept) {
      db.prepare("UPDATE connections SET status = 'accepted' WHERE id = ?").run(c.id);
      notify(c.requester_id, { type: 'connection_accepted', title: 'Connection accepted', body: `${req.user.name || 'Someone'} accepted your request`, data: { userId: req.user.id } });
    }
    else db.prepare('DELETE FROM connections WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  r.delete('/connections/user/:userId', auth.required, (req, res) => {
    db.prepare('DELETE FROM connections WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)')
      .run(req.user.id, req.params.userId, req.params.userId, req.user.id);
    res.json({ ok: true });
  });

  return r;
};

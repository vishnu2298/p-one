// Creates in-app notifications and (when Firebase is configured) pushes them to the user's devices.
function makeNotifier(db, push) {
  const insert = db.prepare('INSERT INTO notifications (user_id, type, title, body, data) VALUES (?,?,?,?,?)');
  const tokens = db.prepare('SELECT token FROM device_tokens WHERE user_id = ?');
  const dropToken = db.prepare('DELETE FROM device_tokens WHERE token = ?');
  const pushOn = db.prepare('SELECT push_enabled FROM users WHERE id = ?');

  /** opts.inbox=false keeps it push-only (e.g. chat messages already live in Messages). */
  function notify(userId, { type, title, body = '', data = {} }, { inbox = true } = {}) {
    try {
      if (inbox) insert.run(userId, type, title, body, JSON.stringify(data));
      const u = pushOn.get(userId);
      if (!u || !u.push_enabled) return;
      const list = tokens.all(userId).map((t) => t.token);
      if (!list.length) return;
      Promise.resolve(push.send(list, { title, body, data: { type, ...data } }))
        .then((dead) => (dead || []).forEach((t) => dropToken.run(t)))
        .catch((e) => console.error('push failed:', e.message));
    } catch (e) {
      console.error('notify failed:', e.message); // notifications must never break the main action
    }
  }
  return notify;
}

module.exports = { makeNotifier };

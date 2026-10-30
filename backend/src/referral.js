const { newReferralCode } = require('./db');

const CODE_RE = /^[A-Z0-9]{6,12}$/;

function ensureCode(db, userId) {
  const row = db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId);
  if (row?.referral_code) return row.referral_code;
  const code = newReferralCode();
  db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').run(code, userId);
  return code;
}

/** Links a brand-new user to whoever invited them, connects them, and tells the inviter. Silent no-op for bad codes. */
function applyReferral(db, notify, newUser, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) return null;
  const inviter = db.prepare('SELECT id, name FROM users WHERE referral_code = ?').get(code);
  if (!inviter || inviter.id === newUser.id) return null;
  db.prepare('UPDATE users SET referred_by = ? WHERE id = ? AND referred_by IS NULL').run(inviter.id, newUser.id);
  db.prepare("INSERT OR IGNORE INTO connections (requester_id, addressee_id, status) VALUES (?,?, 'accepted')").run(inviter.id, newUser.id);
  notify(inviter.id, {
    type: 'invite_joined',
    title: 'Your invite worked!',
    body: `${newUser.name || 'Someone'} joined Connectly and is now connected with you.`,
    data: { userId: newUser.id },
  });
  return inviter.id;
}

module.exports = { ensureCode, applyReferral };

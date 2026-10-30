// Shared helpers for the business/auction modules: transactions, audit, money math, errors.
const { HttpError } = require('../util');

const depth = new WeakMap();

/** Runs fn inside a write transaction. Nested calls become savepoints, so services can compose safely. */
function tx(db, fn) {
  const d = depth.get(db) || 0;
  const sp = `sp_${d}`;
  db.exec(d === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const out = fn();
    depth.set(db, d);
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return out;
  } catch (e) {
    depth.set(db, d);
    try { db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`); } catch { /* already rolled back */ }
    throw e;
  }
}

function audit(db, { actor, business, action, entity = '', entityId = '', meta = {} }) {
  db.prepare('INSERT INTO audit_log (actor_user_id, business_id, action, entity, entity_id, meta) VALUES (?,?,?,?,?,?)')
    .run(actor ?? null, business ?? null, action, entity, String(entityId), JSON.stringify(meta));
}

const int = (v, name = 'Value', { min = 0, max = 1e12 } = {}) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} is not valid`);
  return n;
};
const text = (v, { max = 200, min = 0, name = 'Field' } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw new HttpError(400, `${name} is required`);
  if (s.length > max) throw new HttpError(400, `${name} is too long`);
  return s;
};
/** Rounds a*bps/10000 to the nearest paisa. */
const pct = (amountPaise, bps) => Math.round((amountPaise * bps) / 10000);
const json = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };
const today = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

const features = () => new Set((process.env.FEATURES || 'business,auctions,storefront,services').split(',').map((s) => s.trim()));

module.exports = { tx, audit, int, text, pct, json, today, features, HttpError };

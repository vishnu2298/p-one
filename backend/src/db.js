const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const USERS_DDL = (name) => `
  CREATE TABLE IF NOT EXISTS ${name} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    email TEXT UNIQUE,
    password_hash TEXT,
    phone TEXT DEFAULT '',
    firebase_uid TEXT UNIQUE,
    auth_provider TEXT DEFAULT 'password',
    city TEXT DEFAULT 'Chennai',
    lat REAL, lng REAL,
    bio TEXT DEFAULT '',
    interests TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    verified INTEGER DEFAULT 0,
    referral_code TEXT UNIQUE,
    referred_by INTEGER,
    push_enabled INTEGER DEFAULT 1,
    account_type TEXT DEFAULT 'individual',
    brand_name TEXT DEFAULT '',
    commission_rate REAL DEFAULT 0.05,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_seen TEXT DEFAULT CURRENT_TIMESTAMP
  );`;

// Databases created before phone/Google sign-in have email + password NOT NULL; rebuild the table once.
function migrateUsers(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (cols.includes('firebase_uid')) return;
  const keep = ['id', 'name', 'email', 'password_hash', 'phone', 'city', 'lat', 'lng', 'bio', 'interests', 'avatar', 'verified', 'created_at', 'last_seen'].filter((c) => cols.includes(c));
  db.exec('PRAGMA foreign_keys = OFF; BEGIN;');
  try {
    db.exec(USERS_DDL('users_new'));
    db.exec(`INSERT INTO users_new (${keep.join(',')}) SELECT ${keep.join(',')} FROM users;`);
    db.exec('DROP TABLE users; ALTER TABLE users_new RENAME TO users; COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function addColumns(db, table, cols) {
  const have = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const [name, ddl] of Object.entries(cols)) if (!have.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

function open(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get()) migrateUsers(db);
  db.exec(`
  ${USERS_DDL('users')}
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT NOT NULL,
    price INTEGER NOT NULL,
    condition TEXT DEFAULT 'Good',
    brand TEXT DEFAULT '',
    warranty TEXT DEFAULT 'No',
    city TEXT DEFAULT 'Chennai',
    lat REAL, lng REAL,
    images TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    views INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_listings_cat ON listings(category, status);
  CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id);
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, listing_id)
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    type TEXT DEFAULT 'text',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);
  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (requester_id, addressee_id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES listings(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    price INTEGER NOT NULL,
    status TEXT DEFAULT 'requested',
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id),
    reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    comment TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (order_id, reviewer_id)
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    details TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (blocker_id, blocked_id)
  );
  CREATE TABLE IF NOT EXISTS device_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    platform TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    data TEXT DEFAULT '{}',
    read_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);
  CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT DEFAULT 'share',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS affiliate_products (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    merchant TEXT DEFAULT '',
    price INTEGER,
    url TEXT NOT NULL,
    seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS affiliate_clicks (
    id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    product_id TEXT NOT NULL,
    title TEXT NOT NULL,
    merchant TEXT DEFAULT '',
    price INTEGER,
    dest_url TEXT NOT NULL,
    redirected INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS affiliate_conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    click_id TEXT NOT NULL REFERENCES affiliate_clicks(id) ON DELETE CASCADE,
    order_ref TEXT NOT NULL,
    amount REAL DEFAULT 0,
    commission REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (click_id, order_ref)
  );
  `);
  db.exec(`
  CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    cta_label TEXT DEFAULT 'Learn more',
    target_listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
    target_url TEXT DEFAULT '',
    image TEXT DEFAULT '',
    placement TEXT DEFAULT 'all',
    cost_per_click REAL NOT NULL DEFAULT 2,
    daily_budget REAL NOT NULL DEFAULT 200,
    status TEXT DEFAULT 'active',
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    spend REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS ad_daily (
    ad_id INTEGER NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    spend REAL DEFAULT 0,
    PRIMARY KEY (ad_id, day)
  );
  CREATE TABLE IF NOT EXISTS revenue_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    amount REAL NOT NULL,
    ref TEXT NOT NULL,
    brand_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (kind, ref)
  );
  `);
  // Columns added after first release (CREATE TABLE IF NOT EXISTS does not alter existing tables).
  addColumns(db, 'users', { account_type: "TEXT DEFAULT 'individual'", brand_name: "TEXT DEFAULT ''", commission_rate: 'REAL DEFAULT 0.05' });
  addColumns(db, 'orders', { commission: 'INTEGER DEFAULT 0' });
  backfillReferralCodes(db);
  return db;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newReferralCode() {
  const bytes = require('crypto').randomBytes(8);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
function backfillReferralCodes(db) {
  const upd = db.prepare('UPDATE users SET referral_code = ? WHERE id = ?');
  for (const { id } of db.prepare('SELECT id FROM users WHERE referral_code IS NULL').all()) upd.run(newReferralCode(), id);
}

module.exports = { open, newReferralCode };

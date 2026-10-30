const express = require('express');
const { HttpError, str, CATEGORIES, CATEGORY_IDS, CITIES, jitter } = require('../util');
const insights = require('../insights');

const CONDITIONS = ['Like New', 'Good', 'Fair', 'Needs Repair'];

module.exports = ({ db, ser, auth }) => {
  const r = express.Router();
  const getListing = db.prepare('SELECT * FROM listings WHERE id = ?');

  r.get('/categories', (req, res) => {
    const counts = Object.fromEntries(
      db.prepare("SELECT category, COUNT(*) n FROM listings WHERE status='active' GROUP BY category").all().map((x) => [x.category, x.n]),
    );
    res.json({ categories: CATEGORIES.map((c) => ({ ...c, count: counts[c.id] || 0 })) });
  });
  r.get('/cities', (req, res) => res.json({ cities: Object.keys(CITIES) }));

  function query(req, forcedWhere = [], forcedParams = []) {
    const q = req.query;
    const where = [...forcedWhere];
    const params = [...forcedParams];
    if (q.status !== 'all' && !q.sellerId) where.push("l.status = 'active'");
    if (q.q) {
      const like = `%${String(q.q).trim().replace(/[%_]/g, '')}%`;
      where.push('(l.title LIKE ? OR l.description LIKE ? OR l.brand LIKE ?)');
      params.push(like, like, like);
    }
    if (q.category && CATEGORY_IDS.includes(q.category)) { where.push('l.category = ?'); params.push(q.category); }
    if (q.city && CITIES[q.city]) { where.push('l.city = ?'); params.push(q.city); }
    if (q.minPrice) { where.push('l.price >= ?'); params.push(Number(q.minPrice) || 0); }
    if (q.maxPrice) { where.push('l.price <= ?'); params.push(Number(q.maxPrice) || 0); }
    if (q.sellerId) { where.push('l.seller_id = ?'); params.push(Number(q.sellerId)); }
    if (req.user) {
      where.push('l.seller_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)');
      params.push(req.user.id);
    }
    const limit = Math.min(Number(q.limit) || 20, 50);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const sort = { price_asc: 'l.price ASC', price_desc: 'l.price DESC', newest: 'l.id DESC' }[q.sort] || 'l.id DESC';
    const sql = `SELECT l.* FROM listings l ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
    let rows;
    if (q.sort === 'nearest' && req.user) {
      rows = db.prepare(sql).all(...params).map((l) => ser.listing(l, req.user));
      rows.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
      return { rows: rows.slice(offset, offset + limit), total: rows.length };
    }
    const total = db.prepare(`SELECT COUNT(*) n FROM listings l ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...params).n;
    rows = db.prepare(`${sql} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...params, limit, offset).map((l) => ser.listing(l, req.user));
    return { rows, total };
  }

  r.get('/listings', auth.optional, (req, res) => {
    const { rows, total } = query(req);
    res.json({ listings: rows, total });
  });

  r.get('/me/listings', auth.required, (req, res) => {
    const rows = db.prepare('SELECT * FROM listings WHERE seller_id = ? ORDER BY id DESC').all(req.user.id);
    res.json({ listings: rows.map((l) => ser.listing(l, req.user)) });
  });

  r.get('/favorites', auth.required, (req, res) => {
    const rows = db
      .prepare('SELECT l.* FROM listings l JOIN favorites f ON f.listing_id = l.id WHERE f.user_id = ? ORDER BY l.id DESC')
      .all(req.user.id);
    res.json({ listings: rows.map((l) => ser.listing(l, req.user)) });
  });

  r.get('/listings/:id', auth.optional, (req, res) => {
    const l = getListing.get(req.params.id);
    if (!l) throw new HttpError(404, 'This item is no longer available');
    if (!req.user || req.user.id !== l.seller_id) db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(l.id);
    res.json({ listing: ser.listing(getListing.get(l.id), req.user) });
  });

  async function readBody(b, existing) {
    const title = b.title !== undefined || !existing ? str(b.title, { min: 3, max: 100, name: 'Title' }) : existing.title;
    const description = b.description !== undefined ? str(b.description, { max: 2000 }) : existing?.description || '';
    const category = b.category ?? existing?.category;
    if (!CATEGORY_IDS.includes(category)) throw new HttpError(400, 'Please choose a category');
    const price = b.price !== undefined ? Math.round(Number(b.price)) : existing?.price;
    if (!Number.isFinite(price) || price < 0 || price > 1e9) throw new HttpError(400, 'Please enter a valid price');
    const condition = b.condition !== undefined ? (CONDITIONS.includes(b.condition) ? b.condition : 'Good') : existing?.condition || 'Good';
    const images = b.images !== undefined ? (Array.isArray(b.images) ? b.images.filter((x) => typeof x === 'string').slice(0, 5) : []) : JSON.parse(existing?.images || '[]');
    const city = CITIES[b.city] ? b.city : existing?.city || 'Chennai';
    const mod = await insights.moderate(`${title}\n${description}`);
    if (!mod.allowed) throw new HttpError(422, mod.reason || 'This listing looks unsafe and cannot be posted. Please remove requests for advance payment or personal codes.');
    return {
      title, description, category, price, condition, images, city,
      brand: b.brand !== undefined ? str(b.brand, { max: 60 }) : existing?.brand || '',
      warranty: b.warranty !== undefined ? str(b.warranty, { max: 40 }) : existing?.warranty || 'No',
    };
  }

  r.post('/listings', auth.required, async (req, res) => {
    const d = await readBody(req.body);
    const [clat, clng] = CITIES[d.city];
    const sameCity = d.city === req.user.city && req.user.lat != null;
    const info = db
      .prepare('INSERT INTO listings (seller_id,title,description,category,price,condition,brand,warranty,city,lat,lng,images) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(req.user.id, d.title, d.description, d.category, d.price, d.condition, d.brand, d.warranty, d.city,
        sameCity ? req.user.lat : jitter(clat), sameCity ? req.user.lng : jitter(clng), JSON.stringify(d.images));
    res.status(201).json({ listing: ser.listing(getListing.get(info.lastInsertRowid), req.user) });
  });

  function ownListing(req) {
    const l = getListing.get(req.params.id);
    if (!l) throw new HttpError(404, 'Item not found');
    if (l.seller_id !== req.user.id) throw new HttpError(403, 'This is not your listing');
    return l;
  }

  r.patch('/listings/:id', auth.required, async (req, res) => {
    const l = ownListing(req);
    const d = await readBody(req.body, l);
    db.prepare('UPDATE listings SET title=?,description=?,category=?,price=?,condition=?,brand=?,warranty=?,city=?,images=? WHERE id=?')
      .run(d.title, d.description, d.category, d.price, d.condition, d.brand, d.warranty, d.city, JSON.stringify(d.images), l.id);
    res.json({ listing: ser.listing(getListing.get(l.id), req.user) });
  });

  r.post('/listings/:id/status', auth.required, (req, res) => {
    const l = ownListing(req);
    if (!['active', 'sold'].includes(req.body.status)) throw new HttpError(400, 'Invalid status');
    db.prepare('UPDATE listings SET status = ? WHERE id = ?').run(req.body.status, l.id);
    res.json({ listing: ser.listing(getListing.get(l.id), req.user) });
  });

  r.delete('/listings/:id', auth.required, (req, res) => {
    const l = ownListing(req);
    if (db.prepare("SELECT 1 FROM orders WHERE listing_id = ? AND status IN ('requested','accepted')").get(l.id)) {
      throw new HttpError(409, 'There is an open order on this item. Please complete or decline it first.');
    }
    db.prepare('UPDATE conversations SET listing_id = NULL WHERE listing_id = ?').run(l.id);
    // Keep reviews (they belong to people, not the item); detach them from the orders being removed.
    db.prepare('UPDATE reviews SET order_id = NULL WHERE order_id IN (SELECT id FROM orders WHERE listing_id = ?)').run(l.id);
    db.prepare('DELETE FROM orders WHERE listing_id = ?').run(l.id);
    db.prepare('DELETE FROM listings WHERE id = ?').run(l.id);
    res.json({ ok: true });
  });

  r.post('/listings/:id/favorite', auth.required, (req, res) => {
    if (!getListing.get(req.params.id)) throw new HttpError(404, 'Item not found');
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, listing_id) VALUES (?,?)').run(req.user.id, req.params.id);
    res.json({ isFavorite: true });
  });
  r.delete('/listings/:id/favorite', auth.required, (req, res) => {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND listing_id = ?').run(req.user.id, req.params.id);
    res.json({ isFavorite: false });
  });

  // Price guidance from the Python insights service, computed from comparable active/sold listings.
  r.get('/listings-price-hint', auth.required, async (req, res) => {
    const { category, title = '' } = req.query;
    if (!CATEGORY_IDS.includes(category)) throw new HttpError(400, 'Choose a category first');
    const prices = db.prepare('SELECT price FROM listings WHERE category = ? ORDER BY id DESC LIMIT 200').all(category).map((x) => x.price);
    res.json(await insights.priceHint({ category, title, prices }));
  });

  r.get('/search', auth.optional, (req, res) => {
    const text = String(req.query.q || '').trim();
    if (!text) return res.json({ listings: [], people: [] });
    const { rows } = query({ ...req, query: { q: text, limit: 20 }, user: req.user });
    const like = `%${text.replace(/[%_]/g, '')}%`;
    const people = db
      .prepare('SELECT * FROM users WHERE (name LIKE ? OR interests LIKE ? OR bio LIKE ?) AND id != ? LIMIT 10')
      .all(like, like, like, req.user?.id ?? 0)
      .map((u) => ser.user(u));
    res.json({ listings: rows, people });
  });

  return r;
};

// Business workspaces: onboarding, membership + roles, branches, settings and the dashboard.
const express = require('express');
const crypto = require('crypto');
const { tx, audit, int, text, today, json, HttpError } = require('./core');
const { ROLES, requireBiz } = require('./perms');
const acc = require('./accounting');
const inv = require('./inventory');
const { CITIES } = require('../util');

const CATEGORIES = [
  ['retail', 'Retail shop'], ['grocery', 'Grocery and supermarket'], ['electronics', 'Electronics'], ['fashion', 'Fashion and apparel'],
  ['pharmacy', 'Pharmacy'], ['clinic', 'Clinic'], ['hospital', 'Hospital'], ['restaurant', 'Restaurant and cafe'], ['salon', 'Salon and spa'],
  ['wholesaler', 'Wholesaler'], ['distributor', 'Distributor'], ['service', 'Service provider'],
];
const INVITABLE = ['manager', 'cashier', 'inventory', 'accountant', 'doctor', 'receptionist'];
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'shop';

function shapeBusiness(b) {
  const { next_invoice_no, next_entry_no, ...rest } = b;
  return { ...rest, hours: json(b.hours, {}) };
}

/** Links pending invitations (by phone or email) to a user who has just signed up or logged in. */
function claimInvites(db, user) {
  if (!user) return 0;
  const rows = db.prepare("SELECT * FROM business_members WHERE status = 'invited' AND ((invite_phone != '' AND invite_phone = ?) OR (invite_email != '' AND invite_email = ?))").all(user.phone || '', user.email || '');
  let n = 0;
  for (const m of rows) {
    if (db.prepare('SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ?').get(m.business_id, user.id)) { db.prepare('DELETE FROM business_members WHERE id = ?').run(m.id); continue; }
    db.prepare("UPDATE business_members SET user_id = ?, status = 'active' WHERE id = ?").run(user.id, m.id); n++;
  }
  return n;
}

function dashboard(db, businessId, perms, from, to) {
  const out = { range: { from, to } };
  const sales = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_paise - returned_paise),0) AS total FROM biz_sales_invoices WHERE business_id = ? AND substr(created_at,1,10) >= ? AND substr(created_at,1,10) <= ?").get(businessId, from, to);
  out.sales_count = sales.n; out.sales_paise = sales.total;
  const todayRow = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total_paise - returned_paise),0) AS total FROM biz_sales_invoices WHERE business_id = ? AND substr(created_at,1,10) = ?").get(businessId, today());
  out.today = { sales_count: todayRow.n, sales_paise: todayRow.total };
  out.trend = db.prepare("SELECT substr(created_at,1,10) AS day, SUM(total_paise - returned_paise) AS sales_paise, COUNT(*) AS invoices FROM biz_sales_invoices WHERE business_id = ? AND substr(created_at,1,10) >= ? GROUP BY day ORDER BY day").all(businessId, today(Date.now() - 13 * 86400000));
  out.recent = db.prepare('SELECT id, invoice_no, customer_name, total_paise, status, created_at FROM biz_sales_invoices WHERE business_id = ? ORDER BY id DESC LIMIT 6').all(businessId);
  out.low_stock = inv.lowStock(db, businessId);
  out.expiring = inv.expiring(db, businessId, 30);
  if (perms.includes('reports.read')) {
    const pl = acc.profitLoss(db, businessId, from, to);
    const rec = acc.partyBalances(db, businessId, '1100', 'customer').reduce((s, x) => s + x.balance_paise, 0);
    const pay = acc.partyBalances(db, businessId, '2000', 'supplier').reduce((s, x) => s + x.balance_paise, 0);
    const bal = acc.balances(db, businessId);
    const cash = bal.filter((a) => a.code === '1000' || a.code === '1010').reduce((s, a) => s + a.balance, 0);
    Object.assign(out, {
      revenue_paise: pl.net_revenue_paise, gross_profit_paise: pl.gross_profit_paise, net_profit_paise: pl.net_profit_paise, expenses_paise: pl.operating_expenses_paise,
      cogs_paise: pl.cogs_paise, inventory_value_paise: inv.valuation(db, businessId).total_paise, receivable_paise: rec, payable_paise: pay, cash_paise: cash,
    });
  }
  return out;
}

function routes(ctx) {
  const { db } = ctx;
  const r = express.Router();

  r.get('/business-categories', (_req, res) => res.json({ categories: CATEGORIES.map(([id, name]) => ({ id, name })) }));

  r.post('/businesses', ctx.auth.required, (req, res) => {
    const b = req.body;
    const name = text(b.name, { min: 2, max: 100, name: 'Business name' });
    const category = CATEGORIES.some(([id]) => id === b.category) ? b.category : null;
    if (!category) throw new HttpError(400, 'Choose a business category');
    const gstin = text(b.gstin, { max: 15 }).toUpperCase();
    if (gstin && !GSTIN.test(gstin)) throw new HttpError(400, 'That GSTIN does not look right. It has 15 characters, like 33ABCDE1234F1Z5');
    if (db.prepare("SELECT COUNT(*) n FROM business_members WHERE user_id = ? AND role = 'owner' AND status = 'active'").get(req.user.id).n >= 5) throw new HttpError(400, 'You can own up to 5 businesses');
    const id = tx(db, () => {
      let slug = slugify(name);
      if (db.prepare('SELECT 1 FROM businesses WHERE public_slug = ?').get(slug)) slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
      const city = CITIES[b.city] ? b.city : req.user.city;
      const [lat, lng] = CITIES[city] || [null, null];
      const info = db.prepare('INSERT INTO businesses (owner_user_id, name, category, description, address, city, lat, lng, phone, email, gstin, hours, public_slug) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(req.user.id, name, category, text(b.description, { max: 500 }), text(b.address, { max: 200 }), city, lat, lng, text(b.phone, { max: 20 }) || req.user.phone || '', text(b.email, { max: 100 }), gstin, JSON.stringify(b.hours && typeof b.hours === 'object' ? b.hours : {}), slug);
      const bid = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO business_members (business_id, user_id, role) VALUES (?,?,?)').run(bid, req.user.id, 'owner');
      db.prepare('INSERT INTO business_branches (business_id, name, address, is_default) VALUES (?,?,?,1)').run(bid, 'Main branch', text(b.address, { max: 200 }));
      acc.seedChart(db, bid);
      audit(db, { actor: req.user.id, business: bid, action: 'business.create', entity: 'business', entityId: bid });
      return bid;
    });
    res.status(201).json({ business: shapeBusiness(db.prepare('SELECT * FROM businesses WHERE id = ?').get(id)) });
  });

  // Every workspace the signed-in person owns or works in, with their role and permissions (drives the app's business switcher).
  r.get('/me/businesses', ctx.auth.required, (req, res) => {
    const rows = db.prepare("SELECT b.*, m.role FROM business_members m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ? AND m.status = 'active' ORDER BY b.name").all(req.user.id);
    res.json({ businesses: rows.map((b) => ({ ...shapeBusiness(b), role: b.role, permissions: ROLES[b.role] || [] })) });
  });

  r.get('/businesses/:businessId', requireBiz(ctx), (req, res) => res.json({ business: shapeBusiness(req.biz), role: req.member.role, permissions: req.perms }));

  r.patch('/businesses/:businessId', requireBiz(ctx, 'business.manage'), (req, res) => {
    const b = req.body, cur = req.biz;
    const gstin = b.gstin !== undefined ? text(b.gstin, { max: 15 }).toUpperCase() : cur.gstin;
    if (gstin && !GSTIN.test(gstin)) throw new HttpError(400, 'That GSTIN does not look right');
    db.prepare('UPDATE businesses SET name=?, description=?, address=?, city=?, phone=?, email=?, gstin=?, hours=?, allow_negative_stock=? WHERE id=?').run(
      b.name !== undefined ? text(b.name, { min: 2, max: 100, name: 'Name' }) : cur.name, b.description !== undefined ? text(b.description, { max: 500 }) : cur.description,
      b.address !== undefined ? text(b.address, { max: 200 }) : cur.address, CITIES[b.city] ? b.city : cur.city, b.phone !== undefined ? text(b.phone, { max: 20 }) : cur.phone,
      b.email !== undefined ? text(b.email, { max: 100 }) : cur.email, gstin, b.hours && typeof b.hours === 'object' ? JSON.stringify(b.hours) : cur.hours,
      b.allowNegativeStock !== undefined ? (b.allowNegativeStock ? 1 : 0) : cur.allow_negative_stock, cur.id);
    audit(db, { actor: req.user.id, business: cur.id, action: 'business.update' });
    res.json({ business: shapeBusiness(db.prepare('SELECT * FROM businesses WHERE id = ?').get(cur.id)) });
  });

  /* ---- team ---- */
  r.get('/businesses/:businessId/members', requireBiz(ctx, 'team.manage'), (req, res) => {
    res.json({ members: db.prepare("SELECT m.id, m.role, m.status, m.invite_phone, m.invite_email, m.branch_id, u.id AS user_id, u.name, u.phone FROM business_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.business_id = ? AND m.status != 'removed' ORDER BY m.id").all(req.biz.id), roles: INVITABLE });
  });
  r.post('/businesses/:businessId/members', requireBiz(ctx, 'team.manage'), (req, res) => {
    const role = INVITABLE.includes(req.body.role) ? req.body.role : null;
    if (!role) throw new HttpError(400, `Role must be one of ${INVITABLE.join(', ')}`);
    const phone = text(req.body.phone, { max: 20 }), email = text(req.body.email, { max: 100 }).toLowerCase();
    if (!phone && !email) throw new HttpError(400, 'Enter a phone number or email');
    const user = (phone && db.prepare("SELECT * FROM users WHERE phone = ? AND phone != ''").get(phone)) || (email && db.prepare('SELECT * FROM users WHERE email = ?').get(email)) || null;
    const out = tx(db, () => {
      if (user) {
        const exists = db.prepare('SELECT * FROM business_members WHERE business_id = ? AND user_id = ?').get(req.biz.id, user.id);
        if (exists && exists.status === 'active') throw new HttpError(409, 'That person is already in your team');
        if (exists) db.prepare("UPDATE business_members SET role = ?, status = 'active' WHERE id = ?").run(role, exists.id);
        else db.prepare('INSERT INTO business_members (business_id, user_id, role, branch_id) VALUES (?,?,?,?)').run(req.biz.id, user.id, role, req.body.branchId ? inv.ownBranch(db, req.biz.id, req.body.branchId) : null);
        ctx.notify(user.id, { type: 'business_invite', title: `You joined ${req.biz.name}`, body: `You are now ${role} at ${req.biz.name}.`, data: { businessId: req.biz.id } });
      } else {
        db.prepare("INSERT INTO business_members (business_id, role, status, invite_phone, invite_email) VALUES (?,?, 'invited', ?, ?)").run(req.biz.id, role, phone, email);
      }
      audit(db, { actor: req.user.id, business: req.biz.id, action: 'team.add', entity: 'member', entityId: user?.id ?? 'invited', meta: { role } });
      return { added: !!user, invited: !user };
    });
    res.status(201).json(out);
  });
  r.patch('/businesses/:businessId/members/:id', requireBiz(ctx, 'team.manage'), (req, res) => {
    const m = db.prepare('SELECT * FROM business_members WHERE id = ? AND business_id = ?').get(Number(req.params.id), req.biz.id);
    if (!m) throw new HttpError(404, 'Member not found');
    if (m.role === 'owner') throw new HttpError(403, 'The owner role cannot be changed');
    if (!INVITABLE.includes(req.body.role)) throw new HttpError(400, 'Invalid role');
    db.prepare('UPDATE business_members SET role = ? WHERE id = ?').run(req.body.role, m.id);
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'team.role', entity: 'member', entityId: m.id, meta: { role: req.body.role } });
    res.json({ ok: true });
  });
  r.delete('/businesses/:businessId/members/:id', requireBiz(ctx, 'team.manage'), (req, res) => {
    const m = db.prepare('SELECT * FROM business_members WHERE id = ? AND business_id = ?').get(Number(req.params.id), req.biz.id);
    if (!m) throw new HttpError(404, 'Member not found');
    if (m.role === 'owner') throw new HttpError(403, 'The owner cannot be removed');
    db.prepare("UPDATE business_members SET status = 'removed' WHERE id = ?").run(m.id);
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'team.remove', entity: 'member', entityId: m.id });
    res.json({ ok: true });
  });

  /* ---- branches ---- */
  r.get('/businesses/:businessId/branches', requireBiz(ctx), (req, res) => res.json({ branches: db.prepare('SELECT * FROM business_branches WHERE business_id = ? ORDER BY is_default DESC, id').all(req.biz.id) }));
  r.post('/businesses/:businessId/branches', requireBiz(ctx, 'business.manage'), (req, res) => {
    const info = db.prepare('INSERT INTO business_branches (business_id, name, address) VALUES (?,?,?)').run(req.biz.id, text(req.body.name, { min: 2, max: 80, name: 'Branch name' }), text(req.body.address, { max: 200 }));
    res.status(201).json({ branch: db.prepare('SELECT * FROM business_branches WHERE id = ?').get(info.lastInsertRowid) });
  });

  r.get('/businesses/:businessId/dashboard', requireBiz(ctx, 'dashboard.read'), (req, res) => {
    const to = String(req.query.to || today()), from = String(req.query.from || today(Date.now() - 29 * 86400000));
    res.json(dashboard(db, req.biz.id, req.perms, from, to));
  });

  r.get('/businesses/:businessId/audit', requireBiz(ctx, 'business.manage'), (req, res) => {
    res.json({ events: db.prepare('SELECT a.*, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id WHERE a.business_id = ? ORDER BY a.id DESC LIMIT 200').all(req.biz.id) });
  });
  return r;
}

module.exports = { routes, claimInvites, CATEGORIES, shapeBusiness };

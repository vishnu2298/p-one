// Dynamic modules: every business gets the modules (and custom record types) that fit it, created from templates,
// from a plain-language description (AI when a key is configured, templates otherwise), or by hand.
// Custom record types are data, not code: the apps render lists and forms from the definition.
const express = require('express');
const { requireBiz } = require('./perms');
const { tx, audit, text, int, json, HttpError } = require('./core');

/** Built-in modules. `route` is what the apps open; `perm` decides who sees it. */
const BUILTIN = {
  pos: { label: 'Billing', icon: 'calculator', perm: 'sales.write', group: 'Sell' },
  sales: { label: 'Sales', icon: 'receipt', perm: 'sales.read', group: 'Sell' },
  storefront: { label: 'Online shop', icon: 'storefront', perm: 'storefront.manage', group: 'Sell' },
  appointments: { label: 'Appointments', icon: 'calendar', perm: 'appointments.manage', group: 'Sell' },
  products: { label: 'Products and services', icon: 'cube', perm: 'products.read', group: 'Stock' },
  inventory: { label: 'Stock', icon: 'layers', perm: 'inventory.read', group: 'Stock' },
  purchases: { label: 'Purchases', icon: 'download', perm: 'purchases.read', group: 'Stock' },
  customers: { label: 'Customers', icon: 'people', perm: 'customers.read', group: 'People' },
  team: { label: 'Team', icon: 'person-add', perm: 'team.manage', group: 'People' },
  reports: { label: 'Reports', icon: 'stats-chart', perm: 'reports.read', group: 'Money' },
  expenses: { label: 'Expenses', icon: 'wallet', perm: 'accounting.read', group: 'Money' },
};
const BASE = ['customers', 'reports', 'expenses', 'team'];
const RETAIL = ['pos', 'sales', 'products', 'inventory', 'purchases', 'storefront'];
const SERVICE = ['pos', 'sales', 'products', 'appointments', 'storefront'];

const F = (key, label, type, extra = {}) => ({ key, label, type, ...extra });
const STATUS = (...o) => F('status', 'Status', 'select', { options: o, required: true });
const ENT = {
  lead: { key: 'lead', label: 'Enquiry', plural: 'Enquiries', icon: 'chatbubbles', titleField: 'name', statusField: 'status', fields: [F('name', 'Name', 'text', { required: true }), F('phone', 'Phone', 'phone'), F('interest', 'Interested in', 'text'), F('followup', 'Follow up on', 'date'), STATUS('New', 'Contacted', 'Won', 'Lost')] },
  member: { key: 'member', label: 'Member', plural: 'Members', icon: 'barbell', titleField: 'name', statusField: 'status', fields: [F('name', 'Name', 'text', { required: true }), F('phone', 'Phone', 'phone'), F('plan', 'Plan', 'select', { options: ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'] }), F('joined', 'Joined on', 'date'), F('expires', 'Expires on', 'date'), F('fee', 'Fee', 'money'), STATUS('Active', 'Expired', 'Paused')] },
  student: { key: 'student', label: 'Student', plural: 'Students', icon: 'school', titleField: 'name', statusField: 'status', fields: [F('name', 'Name', 'text', { required: true }), F('batch', 'Class or batch', 'text'), F('guardian', 'Parent phone', 'phone'), F('monthly_fee', 'Monthly fee', 'money'), F('fee_due', 'Fee due', 'money'), STATUS('Active', 'Left')] },
  job: { key: 'job', label: 'Job card', plural: 'Job cards', icon: 'construct', titleField: 'item', statusField: 'status', fields: [F('item', 'Item or device', 'text', { required: true }), F('customer', 'Customer', 'text', { required: true }), F('phone', 'Phone', 'phone'), F('issue', 'Problem', 'longtext'), F('estimate', 'Estimate', 'money'), F('promised', 'Promised by', 'date'), STATUS('Received', 'Diagnosing', 'Waiting for parts', 'Ready', 'Delivered')] },
  rental_item: { key: 'rental_item', label: 'Rental item', plural: 'Rental items', icon: 'cube', titleField: 'name', statusField: 'status', fields: [F('name', 'Item', 'text', { required: true }), F('daily_rate', 'Rate per day', 'money'), F('deposit', 'Deposit', 'money'), STATUS('Available', 'Rented', 'Maintenance')] },
  rental_booking: { key: 'rental_booking', label: 'Booking', plural: 'Bookings', icon: 'calendar', titleField: 'customer', statusField: 'status', fields: [F('customer', 'Customer', 'text', { required: true }), F('phone', 'Phone', 'phone'), F('item', 'Item', 'text', { required: true }), F('from', 'From', 'date', { required: true }), F('to', 'To', 'date', { required: true }), F('amount', 'Amount', 'money'), STATUS('Booked', 'Out', 'Returned', 'Cancelled')] },
  project: { key: 'project', label: 'Project', plural: 'Projects', icon: 'hammer', titleField: 'name', statusField: 'status', fields: [F('name', 'Project', 'text', { required: true }), F('client', 'Client', 'text'), F('site', 'Site', 'text'), F('start', 'Start', 'date'), F('end', 'Due', 'date'), F('budget', 'Budget', 'money'), F('received', 'Received so far', 'money'), STATUS('Planned', 'Ongoing', 'Done', 'On hold')] },
  table: { key: 'table', label: 'Table', plural: 'Tables', icon: 'restaurant', titleField: 'name', statusField: 'status', fields: [F('name', 'Table', 'text', { required: true }), F('seats', 'Seats', 'number'), STATUS('Free', 'Occupied', 'Reserved')] },
  reservation: { key: 'reservation', label: 'Reservation', plural: 'Reservations', icon: 'bookmarks', titleField: 'name', statusField: 'status', fields: [F('name', 'Name', 'text', { required: true }), F('phone', 'Phone', 'phone'), F('date', 'Date', 'date', { required: true }), F('guests', 'Guests', 'number'), STATUS('Booked', 'Seated', 'Done', 'Cancelled')] },
  prescription: { key: 'prescription', label: 'Prescription log', plural: 'Prescription log', icon: 'medkit', titleField: 'patient', fields: [F('patient', 'Patient', 'text', { required: true }), F('doctor', 'Doctor', 'text'), F('date', 'Date', 'date'), F('notes', 'Medicines', 'longtext')] },
  task: { key: 'task', label: 'Task', plural: 'Tasks', icon: 'checkbox', titleField: 'title', statusField: 'status', fields: [F('title', 'Task', 'text', { required: true }), F('due', 'Due', 'date'), F('owner', 'Assigned to', 'text'), STATUS('To do', 'Doing', 'Done')] },
};
const TEMPLATES = {
  retail: { modules: [...BASE, ...RETAIL], entities: [] }, grocery: { modules: [...BASE, ...RETAIL], entities: [] }, electronics: { modules: [...BASE, ...RETAIL], entities: ['job'] },
  fashion: { modules: [...BASE, ...RETAIL], entities: [] }, wholesaler: { modules: [...BASE, ...RETAIL], entities: ['lead'] }, distributor: { modules: [...BASE, ...RETAIL], entities: ['lead'] },
  pharmacy: { modules: [...BASE, ...RETAIL], entities: ['prescription'] }, restaurant: { modules: [...BASE, 'pos', 'sales', 'products', 'inventory', 'purchases', 'storefront'], entities: ['table', 'reservation'] },
  clinic: { modules: [...BASE, 'appointments', 'products', 'storefront'], entities: [] }, hospital: { modules: [...BASE, 'appointments', 'products', 'inventory', 'purchases'], entities: ['prescription'] },
  salon: { modules: [...BASE, ...SERVICE], entities: ['lead'] }, service: { modules: [...BASE, ...SERVICE], entities: ['lead', 'task'] },
  gym: { modules: [...BASE, 'pos', 'sales', 'products'], entities: ['member', 'lead'] }, education: { modules: [...BASE, 'pos', 'sales'], entities: ['student', 'lead'] },
  repair: { modules: [...BASE, 'pos', 'sales', 'products', 'inventory', 'purchases'], entities: ['job'] }, rental: { modules: [...BASE, 'pos', 'sales'], entities: ['rental_item', 'rental_booking'] },
  contractor: { modules: [...BASE, 'sales', 'purchases'], entities: ['project', 'task'] }, other: { modules: [...BASE, 'pos', 'sales', 'products'], entities: ['lead', 'task'] },
};
// Words in a description that point to a template, for the no-AI path.
const HINTS = [[/gym|fitness|yoga|zumba/, 'gym'], [/tuition|coaching|school|class|student/, 'education'], [/repair|workshop|garage|service centre|mobile shop/, 'repair'], [/rent|hire|lease/, 'rental'],
  [/contract|construction|interior|builder|project/, 'contractor'], [/restaurant|cafe|hotel|bakery|food/, 'restaurant'], [/salon|spa|parlour|beauty/, 'salon'], [/clinic|doctor|dental/, 'clinic'], [/pharmacy|medical store/, 'pharmacy'],
  [/grocery|kirana|supermarket/, 'grocery'], [/wholesale|distribut/, 'wholesaler']];

const TYPES = ['text', 'longtext', 'number', 'money', 'date', 'select', 'checkbox', 'phone', 'email'];
const KEY = /^[a-z][a-z0-9_]{1,29}$/;
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 30);

/** Normalises an untrusted definition (from a user or from a model) into the only shape the apps will render. */
function cleanEntity(raw) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Describe the record type');
  const label = text(raw.label, { min: 2, max: 40, name: 'Name' });
  const key = KEY.test(raw.key || '') ? raw.key : slug(raw.key || label);
  if (!KEY.test(key)) throw new HttpError(400, 'Choose a simpler name for this record type');
  const seen = new Set();
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).slice(0, 30).map((f) => {
    const fk = KEY.test(f?.key || '') ? f.key : slug(f?.key || f?.label);
    if (!KEY.test(fk) || seen.has(fk)) return null;
    seen.add(fk);
    const type = TYPES.includes(f.type) ? f.type : 'text';
    const options = type === 'select' ? (Array.isArray(f.options) ? f.options : []).map((o) => String(o).trim().slice(0, 40)).filter(Boolean).slice(0, 20) : undefined;
    if (type === 'select' && !options.length) return null;
    return { key: fk, label: text(f.label || fk, { max: 40 }) || fk, type, ...(f.required ? { required: true } : {}), ...(options ? { options } : {}) };
  }).filter(Boolean);
  if (!fields.length) throw new HttpError(400, 'Add at least one field');
  const titleField = fields.some((f) => f.key === raw.titleField) ? raw.titleField : fields[0].key;
  const wanted = raw.statusField || 'status'; // a select called "status" is the workflow field by convention
  const statusField = fields.some((f) => f.key === wanted && f.type === 'select') ? wanted : undefined;
  return { key, label, plural: text(raw.plural || `${label}s`, { max: 40 }) || `${label}s`, icon: /^[a-z0-9-]{2,30}$/.test(raw.icon || '') ? raw.icon : 'albums', titleField, ...(statusField ? { statusField } : {}), fields };
}

function addEntity(db, businessId, def) {
  const d = cleanEntity(def);
  if (db.prepare('SELECT COUNT(*) n FROM biz_entities WHERE business_id = ? AND active = 1').get(businessId).n >= 20) throw new HttpError(400, 'You can have up to 20 record types');
  const dup = db.prepare('SELECT * FROM biz_entities WHERE business_id = ? AND key = ?').get(businessId, d.key);
  if (dup && dup.active) throw new HttpError(409, `You already have "${dup.label}"`);
  if (dup) { db.prepare('UPDATE biz_entities SET label=?, plural=?, icon=?, def=?, active=1 WHERE id=?').run(d.label, d.plural, d.icon, JSON.stringify(d), dup.id); return dup.id; }
  return Number(db.prepare('INSERT INTO biz_entities (business_id, key, label, plural, icon, def) VALUES (?,?,?,?,?,?)').run(businessId, d.key, d.label, d.plural, d.icon, JSON.stringify(d)).lastInsertRowid);
}

/** Gives a business the modules and record types that suit its category. Safe to call again: it never overwrites a choice. */
function applyTemplate(db, businessId, category) {
  const t = TEMPLATES[category] || TEMPLATES.other;
  for (const m of t.modules) db.prepare('INSERT OR IGNORE INTO biz_modules (business_id, key, enabled) VALUES (?,?,1)').run(businessId, m);
  for (const k of t.entities) { try { addEntity(db, businessId, ENT[k]); } catch (e) { if (e.status !== 409) throw e; } }
}

const searchText = (def, data) => def.fields.filter((f) => ['text', 'longtext', 'phone', 'email', 'select'].includes(f.type)).map((f) => data[f.key] || '').join(' ').toLowerCase();

/** Validates a record against its definition; unknown keys are dropped, money and numbers are stored as numbers (money in paise). */
function cleanRecord(def, body, current = {}) {
  const out = {};
  for (const f of def.fields) {
    let v = body[f.key] !== undefined ? body[f.key] : current[f.key];
    const empty = v === undefined || v === null || v === '';
    if (empty) { if (f.required) throw new HttpError(400, `${f.label} is required`); continue; }
    if (f.type === 'number' || f.type === 'money') { v = Number(v); if (!Number.isFinite(v) || Math.abs(v) > 1e13) throw new HttpError(400, `${f.label} must be a number`); v = f.type === 'money' ? Math.round(v) : v; }
    else if (f.type === 'checkbox') v = !!v;
    else if (f.type === 'date') { v = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${f.label} must be a date`); }
    else if (f.type === 'select') { v = String(v); if (!f.options.includes(v)) throw new HttpError(400, `Choose a valid ${f.label}`); }
    else if (f.type === 'email') { v = String(v).trim().slice(0, 120); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new HttpError(400, `${f.label} does not look right`); }
    else if (f.type === 'phone') { v = String(v).trim().slice(0, 20); if (!/^[+\d][\d\s-]{5,18}$/.test(v)) throw new HttpError(400, `${f.label} does not look right`); }
    else v = String(v).slice(0, f.type === 'longtext' ? 4000 : 200);
    out[f.key] = v;
  }
  return out;
}

/** Asks Claude to design record types for a business. Output is untrusted: it only ever passes through cleanEntity. */
async function aiPropose(description, apiKey) {
  const system = 'You design simple record types for a small-business app. Reply with JSON only: {"entities":[{"label":"","plural":"","icon":"","titleField":"","statusField":"","fields":[{"key":"","label":"","type":"text|longtext|number|money|date|select|checkbox|phone|email","required":false,"options":[]}]}]}. At most 3 entities, 4-8 fields each, snake_case keys, select fields need options, put a select field called status on anything with a workflow. Do not include built-in things like customers, billing, stock, appointments or expenses.';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ model: process.env.AI_MODULE_MODEL || 'claude-haiku-5-5', max_tokens: 1500, system, messages: [{ role: 'user', content: `Business: ${description}` }] }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}`);
  const j = await r.json();
  const raw = (j.content || []).map((c) => c.text || '').join('');
  const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  return (parsed.entities || []).slice(0, 3);
}

function routes(ctx) {
  const { db } = ctx;
  const r = express.Router();
  const B = '/businesses/:businessId';

  const ensure = (biz) => { if (!db.prepare('SELECT 1 FROM biz_modules WHERE business_id = ?').get(biz.id)) applyTemplate(db, biz.id, biz.category); };
  const defOf = (row) => ({ id: row.id, ...json(row.def, {}), key: row.key });
  const entity = (req) => {
    const e = db.prepare('SELECT * FROM biz_entities WHERE business_id = ? AND key = ? AND active = 1').get(req.biz.id, req.params.ekey);
    if (!e) throw new HttpError(404, 'Record type not found');
    return { row: e, def: defOf(e) };
  };
  const shape = (e, row) => ({ id: row.id, ...json(row.data, {}), _status: row.status, _created: row.created_at, _updated: row.updated_at, _title: json(row.data, {})[e.def.titleField] ?? `#${row.id}` });

  /** What this person's workspace is made of: built-in modules they may use, plus custom record types. Drives the sidebar. */
  r.get(`${B}/modules`, requireBiz(ctx), (req, res) => {
    ensure(req.biz);
    const rows = db.prepare('SELECT key, enabled FROM biz_modules WHERE business_id = ?').all(req.biz.id);
    const on = new Map(rows.map((x) => [x.key, !!x.enabled]));
    const modules = Object.entries(BUILTIN).map(([key, m]) => ({ key, label: m.label, icon: m.icon, group: m.group, enabled: on.get(key) ?? false, allowed: req.perms.includes(m.perm) }));
    const canRead = req.perms.includes('records.read');
    const entities = canRead ? db.prepare('SELECT * FROM biz_entities WHERE business_id = ? AND active = 1 ORDER BY id').all(req.biz.id).map(defOf) : [];
    res.json({ modules, entities, canWriteRecords: req.perms.includes('records.write'), canManage: req.perms.includes('modules.manage') });
  });

  r.put(`${B}/modules/:key`, requireBiz(ctx, 'modules.manage'), (req, res) => {
    if (!BUILTIN[req.params.key]) throw new HttpError(404, 'Unknown module');
    if (req.params.key === 'team' && !req.body.enabled) throw new HttpError(400, 'Team stays on so you can always manage access');
    db.prepare('INSERT INTO biz_modules (business_id, key, enabled) VALUES (?,?,?) ON CONFLICT(business_id, key) DO UPDATE SET enabled = excluded.enabled').run(req.biz.id, req.params.key, req.body.enabled ? 1 : 0);
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'module.toggle', entity: 'module', entityId: req.params.key, meta: { enabled: !!req.body.enabled } });
    res.json({ ok: true });
  });

  /** Proposes modules for a description. Nothing is created until the owner applies it. */
  r.post(`${B}/modules/suggest`, requireBiz(ctx, 'modules.manage'), async (req, res) => {
    const description = text(req.body.description, { min: 4, max: 500, name: 'Description' });
    let entities = [], source = 'templates';
    const key = process.env.ANTHROPIC_API_KEY;
    if (key) { try { entities = (await aiPropose(description, key)).map((e) => { try { return cleanEntity(e); } catch { return null; } }).filter(Boolean); source = 'ai'; } catch { entities = []; } }
    let modules = [];
    if (!entities.length) {
      const hit = HINTS.find(([re]) => re.test(description.toLowerCase()));
      const t = TEMPLATES[hit ? hit[1] : 'other'];
      entities = t.entities.map((k) => ENT[k]); modules = t.modules; source = 'templates';
    }
    const taken = new Set(db.prepare('SELECT key FROM biz_entities WHERE business_id = ? AND active = 1').all(req.biz.id).map((x) => x.key));
    res.json({ source, modules, entities: entities.filter((e) => !taken.has(e.key)) });
  });

  r.post(`${B}/entities`, requireBiz(ctx, 'modules.manage'), (req, res) => {
    const list = Array.isArray(req.body.entities) ? req.body.entities.slice(0, 5) : [req.body];
    const ids = tx(db, () => list.map((e) => addEntity(db, req.biz.id, e)));
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'entity.create', entity: 'entity', entityId: ids.join(',') });
    res.status(201).json({ entities: ids.map((id) => defOf(db.prepare('SELECT * FROM biz_entities WHERE id = ?').get(id))) });
  });
  r.patch(`${B}/entities/:ekey`, requireBiz(ctx, 'modules.manage'), (req, res) => {
    const { row, def } = entity(req);
    const next = cleanEntity({ ...def, ...req.body, key: def.key });
    db.prepare('UPDATE biz_entities SET label=?, plural=?, icon=?, def=? WHERE id=?').run(next.label, next.plural, next.icon, JSON.stringify(next), row.id);
    res.json({ entity: { id: row.id, ...next } });
  });
  r.delete(`${B}/entities/:ekey`, requireBiz(ctx, 'modules.manage'), (req, res) => {
    const { row } = entity(req);
    db.prepare('UPDATE biz_entities SET active = 0 WHERE id = ?').run(row.id); // records are kept; re-adding the same name brings them back
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'entity.archive', entity: 'entity', entityId: row.key });
    res.json({ ok: true });
  });

  r.get(`${B}/entities/:ekey/records`, requireBiz(ctx, 'records.read'), (req, res) => {
    const e = entity(req);
    const q = String(req.query.q || '').trim().toLowerCase().replace(/[%_]/g, '');
    const st = String(req.query.status || '');
    const limit = Math.min(Number(req.query.limit) || 100, 500), offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = `entity_id = ? AND deleted_at IS NULL ${q ? 'AND search LIKE ?' : ''} ${st ? 'AND status = ?' : ''}`;
    const args = [e.row.id, ...(q ? [`%${q}%`] : []), ...(st ? [st] : [])];
    const rows = db.prepare(`SELECT * FROM biz_records WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) n FROM biz_records WHERE ${where}`).get(...args).n;
    res.json({ entity: e.def, records: rows.map((x) => shape(e, x)), total });
  });
  /** Counts by status and totals of every money/number field: the dashboard cards for a custom module. */
  r.get(`${B}/entities/:ekey/summary`, requireBiz(ctx, 'records.read'), (req, res) => {
    const e = entity(req);
    const rows = db.prepare('SELECT status, data FROM biz_records WHERE entity_id = ? AND deleted_at IS NULL').all(e.row.id);
    const byStatus = {}; const totals = {};
    for (const x of rows) {
      byStatus[x.status || '—'] = (byStatus[x.status || '—'] || 0) + 1;
      const d = json(x.data, {});
      for (const f of e.def.fields) if ((f.type === 'money' || f.type === 'number') && typeof d[f.key] === 'number') totals[f.key] = (totals[f.key] || 0) + d[f.key];
    }
    res.json({ count: rows.length, byStatus, totals });
  });
  r.post(`${B}/entities/:ekey/records`, requireBiz(ctx, 'records.write'), (req, res) => {
    const e = entity(req);
    if (db.prepare('SELECT COUNT(*) n FROM biz_records WHERE business_id = ? AND deleted_at IS NULL').get(req.biz.id).n >= 100000) throw new HttpError(400, 'Record limit reached');
    const data = cleanRecord(e.def, req.body);
    const info = db.prepare('INSERT INTO biz_records (business_id, entity_id, data, status, search, created_by) VALUES (?,?,?,?,?,?)').run(req.biz.id, e.row.id, JSON.stringify(data), data[e.def.statusField] || '', searchText(e.def, data), req.user.id);
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'record.create', entity: e.def.key, entityId: info.lastInsertRowid });
    res.status(201).json({ record: shape(e, db.prepare('SELECT * FROM biz_records WHERE id = ?').get(info.lastInsertRowid)) });
  });
  const own = (req, e) => {
    const row = db.prepare('SELECT * FROM biz_records WHERE id = ? AND entity_id = ? AND business_id = ? AND deleted_at IS NULL').get(Number(req.params.rid), e.row.id, req.biz.id);
    if (!row) throw new HttpError(404, 'Record not found');
    return row;
  };
  r.get(`${B}/entities/:ekey/records/:rid`, requireBiz(ctx, 'records.read'), (req, res) => { const e = entity(req); res.json({ record: shape(e, own(req, e)) }); });
  r.patch(`${B}/entities/:ekey/records/:rid`, requireBiz(ctx, 'records.write'), (req, res) => {
    const e = entity(req); const row = own(req, e);
    const data = cleanRecord(e.def, req.body, json(row.data, {}));
    db.prepare("UPDATE biz_records SET data=?, status=?, search=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(JSON.stringify(data), data[e.def.statusField] || '', searchText(e.def, data), row.id);
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'record.update', entity: e.def.key, entityId: row.id });
    res.json({ record: shape(e, db.prepare('SELECT * FROM biz_records WHERE id = ?').get(row.id)) });
  });
  r.delete(`${B}/entities/:ekey/records/:rid`, requireBiz(ctx, 'records.write'), (req, res) => {
    const e = entity(req); const row = own(req, e);
    db.prepare("UPDATE biz_records SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'record.delete', entity: e.def.key, entityId: row.id });
    res.json({ ok: true });
  });
  return r;
}

module.exports = { routes, applyTemplate, addEntity, cleanEntity, cleanRecord, BUILTIN, TEMPLATES, ENT };

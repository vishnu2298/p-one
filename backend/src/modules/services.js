// Services, staff availability, appointments and clinic billing.
// Clinical notes are isolated from every marketplace/storefront API: encrypted at rest (AES-256-GCM), recorded with
// patient consent, readable only by roles holding clinical.read, and every read is audit-logged.
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { tx, audit, int, text, HttpError } = require('./core');
const { requireBiz } = require('./perms');
const inv = require('./inventory');
const sales = require('./sales');
const acc = require('./accounting');

const IST_MS = 5.5 * 3600 * 1000; // appointments are scheduled in Indian Standard Time
const key = () => crypto.createHash('sha256').update(process.env.CLINICAL_KEY || `${config.jwtSecret}:clinical`).digest();
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

function istMidnightUtc(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - IST_MS;
}
function ownService(db, businessId, id) {
  const s = db.prepare('SELECT * FROM biz_services WHERE id = ? AND business_id = ? AND active = 1').get(Number(id), businessId);
  if (!s) throw new HttpError(404, 'Service not found');
  return s;
}

/** Free slots for a service on a date (YYYY-MM-DD, IST), across staff who offer it. */
function freeSlots(db, biz, service, dateStr, nowMs) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new HttpError(400, 'Choose a date');
  const base = istMidnightUtc(dateStr);
  const weekday = new Date(base + IST_MS).getUTCDay();
  const avail = db.prepare("SELECT a.*, m.user_id FROM biz_staff_availability a JOIN business_members m ON m.id = a.staff_member_id WHERE a.business_id = ? AND a.weekday = ? AND m.status = 'active'").all(biz.id, weekday);
  const dur = service.duration_min * 60000;
  const slots = [];
  for (const a of avail) {
    for (let t = base + a.start_min * 60000; t + dur <= base + a.end_min * 60000; t += dur) {
      if (t < nowMs) continue;
      const clash = db.prepare("SELECT 1 FROM biz_appointments WHERE staff_member_id = ? AND status IN ('requested','confirmed') AND start_ts < ? AND end_ts > ?").get(a.staff_member_id, t + dur, t);
      if (!clash) slots.push({ startTs: t, endTs: t + dur, staffMemberId: a.staff_member_id });
    }
  }
  return slots.sort((x, y) => x.startTs - y.startTs);
}

function routes(ctx) {
  const { db, notify, jobs, clock } = ctx;
  const r = express.Router();

  /* ---- catalog ---- */
  r.post('/businesses/:businessId/services', requireBiz(ctx, 'services.manage'), (req, res) => {
    const b = req.body;
    const info = db.prepare('INSERT INTO biz_services (business_id, name, description, duration_min, price_paise, tax_bps) VALUES (?,?,?,?,?,?)')
      .run(req.biz.id, text(b.name, { min: 2, max: 100, name: 'Name' }), text(b.description, { max: 300 }), int(b.durationMin ?? 30, 'Duration', { min: 5, max: 600 }), int(b.pricePaise, 'Price', { max: 1e9 }), int(b.taxBps || 0, 'Tax', { max: 4000 }));
    res.status(201).json({ service: db.prepare('SELECT * FROM biz_services WHERE id = ?').get(info.lastInsertRowid) });
  });
  r.get('/businesses/:businessId/services', requireBiz(ctx, 'appointments.manage'), (req, res) => res.json({ services: db.prepare('SELECT * FROM biz_services WHERE business_id = ? AND active = 1 ORDER BY name').all(req.biz.id) }));
  r.patch('/businesses/:businessId/services/:id', requireBiz(ctx, 'services.manage'), (req, res) => {
    const s = ownService(db, req.biz.id, req.params.id), b = req.body;
    db.prepare('UPDATE biz_services SET name=?, description=?, duration_min=?, price_paise=?, tax_bps=?, active=? WHERE id=?').run(
      b.name !== undefined ? text(b.name, { min: 2, max: 100 }) : s.name, b.description !== undefined ? text(b.description, { max: 300 }) : s.description,
      b.durationMin !== undefined ? int(b.durationMin, 'Duration', { min: 5, max: 600 }) : s.duration_min, b.pricePaise !== undefined ? int(b.pricePaise, 'Price') : s.price_paise,
      b.taxBps !== undefined ? int(b.taxBps, 'Tax', { max: 4000 }) : s.tax_bps, b.active === false ? 0 : 1, s.id);
    res.json({ ok: true });
  });

  /* ---- availability (per staff member, weekly, in IST) ---- */
  r.put('/businesses/:businessId/staff-availability/:memberId', requireBiz(ctx, 'services.manage'), (req, res) => {
    const m = db.prepare("SELECT * FROM business_members WHERE id = ? AND business_id = ? AND status = 'active'").get(Number(req.params.memberId), req.biz.id);
    if (!m) throw new HttpError(404, 'Staff member not found');
    const windows = (Array.isArray(req.body.windows) ? req.body.windows : []).slice(0, 30).map((w) => ({ weekday: int(w.weekday, 'Weekday', { max: 6 }), start: int(w.startMin, 'Start', { max: 1439 }), end: int(w.endMin, 'End', { max: 1440 }) }));
    if (windows.some((w) => w.end <= w.start)) throw new HttpError(400, 'End time must be after start time');
    tx(db, () => {
      db.prepare('DELETE FROM biz_staff_availability WHERE business_id = ? AND staff_member_id = ?').run(req.biz.id, m.id);
      for (const w of windows) db.prepare('INSERT INTO biz_staff_availability (business_id, staff_member_id, weekday, start_min, end_min) VALUES (?,?,?,?,?)').run(req.biz.id, m.id, w.weekday, w.start, w.end);
    });
    res.json({ ok: true, windows: windows.length });
  });
  r.get('/businesses/:businessId/staff-availability', requireBiz(ctx, 'appointments.manage'), (req, res) => {
    res.json({ availability: db.prepare('SELECT a.*, u.name FROM biz_staff_availability a JOIN business_members m ON m.id = a.staff_member_id LEFT JOIN users u ON u.id = m.user_id WHERE a.business_id = ? ORDER BY a.staff_member_id, a.weekday, a.start_min').all(req.biz.id) });
  });

  /* ---- patient / customer booking (public store) ---- */
  const store = (slug) => { const b = db.prepare('SELECT * FROM businesses WHERE public_slug = ? AND storefront_enabled = 1').get(String(slug)); if (!b) throw new HttpError(404, 'Store not found'); return b; };
  r.get('/stores/:slug/slots', (req, res) => {
    const b = store(req.params.slug);
    res.json({ slots: freeSlots(db, b, ownService(db, b.id, req.query.serviceId), String(req.query.date || ''), clock()) });
  });
  r.post('/stores/:slug/appointments', ctx.auth.required, (req, res) => {
    const b = store(req.params.slug);
    const s = ownService(db, b.id, req.body.serviceId);
    const startTs = int(req.body.startTs, 'Time', { max: 4e12 });
    const out = tx(db, () => { // the transaction serialises two people grabbing the same slot
      const slot = freeSlots(db, b, s, new Date(startTs + IST_MS).toISOString().slice(0, 10), clock()).find((x) => x.startTs === startTs && (!req.body.staffMemberId || x.staffMemberId === Number(req.body.staffMemberId)));
      if (!slot) throw new HttpError(409, 'That time is no longer available. Please pick another.');
      const info = db.prepare('INSERT INTO biz_appointments (business_id, service_id, staff_member_id, customer_user_id, customer_name, start_ts, end_ts, note) VALUES (?,?,?,?,?,?,?,?)')
        .run(b.id, s.id, slot.staffMemberId, req.user.id, req.user.name || '', startTs, slot.endTs, text(req.body.note, { max: 300 }));
      return db.prepare('SELECT * FROM biz_appointments WHERE id = ?').get(info.lastInsertRowid);
    });
    notify(b.owner_user_id, { type: 'appointment', title: 'New appointment request', body: `${req.user.name} · ${s.name}`, data: { businessId: b.id, appointmentId: out.id } });
    res.status(201).json({ appointment: out });
  });
  r.get('/me/appointments', ctx.auth.required, (req, res) => {
    res.json({ appointments: db.prepare('SELECT a.*, s.name AS service, b.name AS business FROM biz_appointments a JOIN biz_services s ON s.id = a.service_id JOIN businesses b ON b.id = a.business_id WHERE a.customer_user_id = ? ORDER BY a.start_ts DESC LIMIT 50').all(req.user.id) });
  });
  r.post('/me/appointments/:id/cancel', ctx.auth.required, (req, res) => {
    const a = db.prepare('SELECT * FROM biz_appointments WHERE id = ? AND customer_user_id = ?').get(Number(req.params.id), req.user.id);
    if (!a) throw new HttpError(404, 'Appointment not found');
    if (!['requested', 'confirmed'].includes(a.status)) throw new HttpError(409, 'This appointment can no longer be cancelled');
    db.prepare("UPDATE biz_appointments SET status = 'cancelled' WHERE id = ?").run(a.id);
    res.json({ ok: true });
  });

  /* ---- reception / doctor side ---- */
  r.get('/businesses/:businessId/appointments', requireBiz(ctx, 'appointments.manage'), (req, res) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
    const from = day ? istMidnightUtc(day) : 0, to = day ? from + 86400000 : 9e15;
    // Doctors see their own patients; reception and owner see the whole book.
    const mine = req.member.role === 'doctor' ? 'AND a.staff_member_id = ?' : '';
    res.json({ appointments: db.prepare(`SELECT a.*, s.name AS service, s.price_paise FROM biz_appointments a JOIN biz_services s ON s.id = a.service_id WHERE a.business_id = ? AND a.start_ts >= ? AND a.start_ts < ? ${mine} ORDER BY a.start_ts LIMIT 200`).all(req.biz.id, from, to, ...(mine ? [req.member.id] : [])) });
  });
  r.patch('/businesses/:businessId/appointments/:id', requireBiz(ctx, 'appointments.manage'), (req, res) => {
    const a = db.prepare('SELECT * FROM biz_appointments WHERE id = ? AND business_id = ?').get(Number(req.params.id), req.biz.id);
    if (!a) throw new HttpError(404, 'Appointment not found');
    const next = req.body.status;
    const allowed = { requested: ['confirmed', 'cancelled'], confirmed: ['cancelled', 'no_show'] };
    if (!(allowed[a.status] || []).includes(next)) throw new HttpError(409, `An appointment that is ${a.status} cannot become ${next}`);
    db.prepare('UPDATE biz_appointments SET status = ? WHERE id = ?').run(next, a.id);
    if (a.customer_user_id) {
      notify(a.customer_user_id, { type: 'appointment_update', title: `Appointment ${next.replace('_', ' ')}`, body: `${req.biz.name} ${next === 'confirmed' ? 'confirmed your booking' : 'updated your booking'}.`, data: { appointmentId: a.id } });
      if (next === 'confirmed') jobs.schedule({ type: 'appt:remind', runAt: Math.max(clock(), a.start_ts - 2 * 3600 * 1000), payload: { appointmentId: a.id }, dedupeKey: `appt_remind:${a.id}:${a.start_ts}` });
    }
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'appointment.status', entity: 'appointment', entityId: a.id, meta: { next } });
    res.json({ ok: true });
  });
  jobs.register('appt:remind', async ({ appointmentId }) => {
    const a = db.prepare("SELECT a.*, b.name AS business FROM biz_appointments a JOIN businesses b ON b.id = a.business_id WHERE a.id = ? AND a.status = 'confirmed'").get(appointmentId);
    if (a?.customer_user_id) notify(a.customer_user_id, { type: 'appointment_reminder', title: 'Appointment reminder', body: `${a.business} at ${new Date(a.start_ts + IST_MS).toISOString().slice(11, 16)} today.`, data: { appointmentId } });
  });

  // Completing a visit bills it: service line + GST, optional consumables drawn from stock (cost, not billed).
  r.post('/businesses/:businessId/appointments/:id/complete', requireBiz(ctx, 'appointments.manage'), (req, res) => {
    const a = db.prepare('SELECT * FROM biz_appointments WHERE id = ? AND business_id = ?').get(Number(req.params.id), req.biz.id);
    if (!a) throw new HttpError(404, 'Appointment not found');
    if (a.invoice_id) return res.json({ appointment: a, invoiceId: a.invoice_id, duplicate: true });
    if (!['requested', 'confirmed'].includes(a.status)) throw new HttpError(409, `A ${a.status} appointment cannot be completed`);
    const s = db.prepare('SELECT * FROM biz_services WHERE id = ?').get(a.service_id);
    const out = tx(db, () => {
      let cust = a.customer_id ? { id: a.customer_id } : db.prepare('SELECT id FROM biz_customers WHERE business_id = ? AND user_id = ?').get(req.biz.id, a.customer_user_id ?? -1);
      if (!cust) {
        const info = db.prepare("INSERT INTO biz_customers (business_id, user_id, kind, name) VALUES (?,?,?,?)").run(req.biz.id, a.customer_user_id, req.biz.category === 'clinic' || req.biz.category === 'hospital' ? 'patient' : 'customer', a.customer_name || 'Customer');
        cust = { id: Number(info.lastInsertRowid) };
      }
      const payments = (Array.isArray(req.body.payments) ? req.body.payments : []).map((p) => ({ method: ['cash', 'upi', 'card', 'bank'].includes(p.method) ? p.method : 'cash', amountPaise: int(p.amountPaise, 'Payment', { min: 1 }) }));
      const inv0 = sales.createInvoice(db, { businessId: req.biz.id, customerId: cust.id, items: [{ name: s.name, qty: 1, unitPricePaise: s.price_paise, taxBps: s.tax_bps }], payments, idempotencyKey: `appt:${a.id}`, channel: 'appointment', sourceType: 'appointment', sourceId: a.id, by: req.user.id });
      const branchId = inv.defaultBranch(db, req.biz.id);
      for (const c of (Array.isArray(req.body.consumables) ? req.body.consumables : []).slice(0, 30)) {
        const p = inv.ownProduct(db, req.biz.id, c.productId);
        const mv = inv.moveStock(db, { businessId: req.biz.id, branchId, product: p, qty: -int(c.qty, 'Quantity', { min: 1, max: 1e5 }), kind: 'adjustment', sourceType: 'appointment', sourceId: a.id, by: req.user.id, note: 'Clinic consumable' });
        if (mv.costPaise > 0) acc.post(db, { businessId: req.biz.id, memo: `Consumable used: ${p.name}`, sourceType: 'consumable', sourceId: a.id, sourceKey: `consumable:${a.id}:${p.id}`, by: req.user.id, lines: [{ code: '6060', debit: mv.costPaise }, { code: '1200', credit: mv.costPaise }] });
      }
      db.prepare("UPDATE biz_appointments SET status = 'completed', invoice_id = ?, customer_id = ? WHERE id = ?").run(inv0.invoice.id, cust.id, a.id);
      audit(db, { actor: req.user.id, business: req.biz.id, action: 'appointment.complete', entity: 'appointment', entityId: a.id });
      return inv0.invoice;
    });
    res.status(201).json({ invoiceId: out.id, invoice: out });
  });

  /* ---- clinical notes: isolated, encrypted, consented, audited ---- */
  r.post('/businesses/:businessId/customers/:customerId/clinical-notes', requireBiz(ctx, 'clinical.write'), (req, res) => {
    const c = db.prepare('SELECT * FROM biz_customers WHERE id = ? AND business_id = ?').get(Number(req.params.customerId), req.biz.id);
    if (!c) throw new HttpError(404, 'Patient not found');
    if (req.body.consent !== true) throw new HttpError(400, 'Record the patient\'s consent before saving clinical notes');
    const info = db.prepare('INSERT INTO biz_clinical_notes (business_id, customer_id, appointment_id, consent, ciphertext, author_member_id) VALUES (?,?,?,?,?,?)')
      .run(req.biz.id, c.id, req.body.appointmentId || null, 1, encrypt(text(req.body.text, { min: 1, max: 5000, name: 'Note' })), req.member.id);
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'clinical.write', entity: 'patient', entityId: c.id });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.get('/businesses/:businessId/customers/:customerId/clinical-notes', requireBiz(ctx, 'clinical.read'), (req, res) => {
    const c = db.prepare('SELECT * FROM biz_customers WHERE id = ? AND business_id = ?').get(Number(req.params.customerId), req.biz.id);
    if (!c) throw new HttpError(404, 'Patient not found');
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'clinical.read', entity: 'patient', entityId: c.id });
    res.json({ notes: db.prepare('SELECT id, appointment_id, ciphertext, created_at FROM biz_clinical_notes WHERE business_id = ? AND customer_id = ? ORDER BY id DESC LIMIT 100').all(req.biz.id, c.id).map((n) => ({ id: n.id, appointmentId: n.appointment_id, createdAt: n.created_at, text: decrypt(n.ciphertext) })) });
  });
  return r;
}

module.exports = { routes, freeSlots, encrypt, decrypt };

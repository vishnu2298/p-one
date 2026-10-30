// Double-entry accounting. Every financial event posts a balanced journal entry. Posted entries are never edited or
// deleted: mistakes are fixed with a reversing entry. Reports are derived purely from journal lines.
const express = require('express');
const { tx, audit, int, text, today, HttpError } = require('./core');
const { requireBiz } = require('./perms');

const CHART = [
  ['1000', 'Cash in hand', 'asset'], ['1010', 'Bank and UPI', 'asset'], ['1100', 'Accounts receivable', 'asset'],
  ['1200', 'Inventory', 'asset'], ['1300', 'GST input credit', 'asset'],
  ['2000', 'Accounts payable', 'liability'], ['2100', 'GST output payable', 'liability'], ['2200', 'Customer advances', 'liability'],
  ['3000', "Owner's equity", 'equity'],
  ['4000', 'Sales revenue', 'income'], ['4100', 'Sales returns', 'income'], ['4900', 'Other income', 'income'],
  ['5000', 'Cost of goods sold', 'expense'], ['5100', 'Inventory loss and adjustments', 'expense'],
  ['6000', 'Rent', 'expense'], ['6010', 'Salaries and wages', 'expense'], ['6020', 'Utilities', 'expense'],
  ['6030', 'Marketing', 'expense'], ['6040', 'Transport', 'expense'], ['6050', 'Payment gateway fees', 'expense'], ['6060', 'Consumables used', 'expense'], ['6090', 'Other expenses', 'expense'],
];
const EXPENSE_CODES = CHART.filter((c) => c[0].startsWith('6')).map((c) => c[0]);
const METHOD_ACCOUNT = { cash: '1000', upi: '1010', card: '1010', bank: '1010', online: '1010', wallet: '1010' };
const normalDebit = (type) => type === 'asset' || type === 'expense';

function seedChart(db, businessId) {
  const ins = db.prepare('INSERT OR IGNORE INTO biz_accounts (business_id, code, name, type, system) VALUES (?,?,?,?,1)');
  for (const [code, name, type] of CHART) ins.run(businessId, code, name, type);
}

const acctCache = new WeakMap();
function accountId(db, businessId, code) {
  let m = acctCache.get(db); if (!m) { m = new Map(); acctCache.set(db, m); }
  const key = `${businessId}:${code}`;
  if (!m.has(key)) {
    let a = db.prepare('SELECT id FROM biz_accounts WHERE business_id = ? AND code = ?').get(businessId, code);
    if (!a) {
      // Charts grow over time: add a standard account lazily so existing businesses keep working.
      const std = CHART.find((c) => c[0] === code);
      if (!std) throw new HttpError(400, `Unknown account ${code}`);
      db.prepare('INSERT OR IGNORE INTO biz_accounts (business_id, code, name, type, system) VALUES (?,?,?,?,1)').run(businessId, std[0], std[1], std[2]);
      a = db.prepare('SELECT id FROM biz_accounts WHERE business_id = ? AND code = ?').get(businessId, code);
    }
    m.set(key, a.id);
  }
  return m.get(key);
}

/**
 * Posts one balanced entry. `lines`: [{ code, debit, credit, party?: ['customer'|'supplier', id] }] in paise.
 * Idempotent on sourceKey: replaying the same business event never double-posts.
 */
function post(db, { businessId, date = today(), memo = '', sourceType = '', sourceId = '', sourceKey = null, lines, by = null, reversalOf = null }) {
  return tx(db, () => {
    if (sourceKey) {
      const dup = db.prepare('SELECT id FROM biz_journal_entries WHERE business_id = ? AND source_key = ?').get(businessId, sourceKey);
      if (dup) return dup.id;
    }
    const clean = lines.filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0);
    const dr = clean.reduce((s, l) => s + (l.debit || 0), 0);
    const cr = clean.reduce((s, l) => s + (l.credit || 0), 0);
    if (!clean.length || dr !== cr) throw new HttpError(500, `Unbalanced journal entry (${dr} vs ${cr})`);
    if (db.prepare('SELECT 1 FROM biz_financial_periods WHERE business_id = ? AND period = ?').get(businessId, String(date).slice(0, 7))) {
      throw new HttpError(409, `The period ${String(date).slice(0, 7)} is closed. Post a correction in an open period.`);
    }
    const biz = db.prepare('SELECT next_entry_no FROM businesses WHERE id = ?').get(businessId);
    db.prepare('UPDATE businesses SET next_entry_no = next_entry_no + 1 WHERE id = ?').run(businessId);
    const e = db.prepare('INSERT INTO biz_journal_entries (business_id, entry_no, date, memo, source_type, source_id, source_key, reversal_of, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(businessId, biz.next_entry_no, date, memo, sourceType, String(sourceId), sourceKey, reversalOf, by);
    const ins = db.prepare('INSERT INTO biz_journal_lines (entry_id, account_id, debit_paise, credit_paise, memo, party_type, party_id) VALUES (?,?,?,?,?,?,?)');
    for (const l of clean) ins.run(e.lastInsertRowid, accountId(db, businessId, l.code), l.debit || 0, l.credit || 0, l.memo || '', l.party?.[0] || '', l.party?.[1] ?? null);
    return Number(e.lastInsertRowid);
  });
}

function reverse(db, businessId, entryId, by, memo = 'Reversal') {
  return tx(db, () => {
    const e = db.prepare('SELECT * FROM biz_journal_entries WHERE id = ? AND business_id = ?').get(entryId, businessId);
    if (!e) throw new HttpError(404, 'Entry not found');
    if (e.reversal_of) throw new HttpError(400, 'A reversing entry cannot itself be reversed');
    const lines = db.prepare('SELECT l.*, a.code FROM biz_journal_lines l JOIN biz_accounts a ON a.id = l.account_id WHERE entry_id = ?').all(entryId);
    return post(db, {
      businessId, date: today(), memo: `${memo}: entry #${e.entry_no}`, sourceType: 'reversal', sourceId: entryId, sourceKey: `reversal:${entryId}`, by, reversalOf: entryId,
      lines: lines.map((l) => ({ code: l.code, debit: l.credit_paise, credit: l.debit_paise, party: l.party_type ? [l.party_type, l.party_id] : undefined })),
    });
  });
}

/* ---------------- reports ---------------- */
function balances(db, businessId, { from = '0000-01-01', to = '9999-12-31' } = {}) {
  return db.prepare(`
    SELECT a.id, a.code, a.name, a.type, COALESCE(SUM(l.debit_paise),0) AS debit, COALESCE(SUM(l.credit_paise),0) AS credit
    FROM biz_accounts a
    LEFT JOIN biz_journal_lines l ON l.account_id = a.id
    LEFT JOIN biz_journal_entries e ON e.id = l.entry_id AND e.date >= ? AND e.date <= ?
    WHERE a.business_id = ? AND (l.id IS NULL OR e.id IS NOT NULL)
    GROUP BY a.id ORDER BY a.code`).all(from, to, businessId)
    .map((r) => ({ ...r, balance: normalDebit(r.type) ? r.debit - r.credit : r.credit - r.debit }));
}

function trialBalance(db, businessId, asOf = '9999-12-31') {
  const rows = balances(db, businessId, { to: asOf }).filter((r) => r.debit || r.credit);
  const totals = rows.reduce((t, r) => ({ debit: t.debit + r.debit, credit: t.credit + r.credit }), { debit: 0, credit: 0 });
  return { asOf, rows: rows.map((r) => ({ code: r.code, name: r.name, type: r.type, debit_paise: r.debit, credit_paise: r.credit })), totals_paise: totals, balanced: totals.debit === totals.credit };
}

function profitLoss(db, businessId, from, to) {
  const rows = balances(db, businessId, { from, to });
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.balance, 0);
  const revenueGross = sum((r) => r.code === '4000');
  const returns = -sum((r) => r.code === '4100'); // contra-revenue, positive number
  const otherIncome = sum((r) => r.code === '4900');
  const cogs = sum((r) => r.code === '5000');
  const shrink = sum((r) => r.code === '5100');
  const opex = rows.filter((r) => r.code.startsWith('6') && r.balance).map((r) => ({ code: r.code, name: r.name, amount_paise: r.balance }));
  const opexTotal = opex.reduce((s, r) => s + r.amount_paise, 0);
  const netRevenue = revenueGross - returns;
  const grossProfit = netRevenue - cogs;
  return {
    from, to, revenue_paise: revenueGross, returns_paise: returns, net_revenue_paise: netRevenue, cogs_paise: cogs,
    gross_profit_paise: grossProfit, inventory_loss_paise: shrink, other_income_paise: otherIncome,
    operating_expenses: opex, operating_expenses_paise: opexTotal,
    net_profit_paise: grossProfit + otherIncome - shrink - opexTotal,
  };
}

function balanceSheet(db, businessId, asOf = today()) {
  const rows = balances(db, businessId, { to: asOf });
  const pick = (type) => rows.filter((r) => r.type === type && r.balance).map((r) => ({ code: r.code, name: r.name, amount_paise: r.balance }));
  const total = (list) => list.reduce((s, r) => s + r.amount_paise, 0);
  const assets = pick('asset'), liabilities = pick('liability'), equity = pick('equity');
  const income = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.balance, 0);
  const expense = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.balance, 0);
  const currentEarnings = income - expense;
  const eq = total(equity) + currentEarnings;
  return { asOf, assets, liabilities, equity, current_earnings_paise: currentEarnings, totals_paise: { assets: total(assets), liabilities: total(liabilities), equity: eq }, balanced: total(assets) === total(liabilities) + eq };
}

function cashFlow(db, businessId, from, to) {
  const cashIds = ['1000', '1010'].map((c) => accountId(db, businessId, c));
  const q = (where, ...a) => db.prepare(`SELECT COALESCE(SUM(l.debit_paise - l.credit_paise),0) AS n FROM biz_journal_lines l JOIN biz_journal_entries e ON e.id = l.entry_id WHERE l.account_id IN (${cashIds.join(',')}) AND e.business_id = ? ${where}`).get(businessId, ...a).n;
  const opening = q('AND e.date < ?', from);
  const byType = db.prepare(`SELECT e.source_type AS source, SUM(l.debit_paise - l.credit_paise) AS net FROM biz_journal_lines l JOIN biz_journal_entries e ON e.id = l.entry_id
    WHERE l.account_id IN (${cashIds.join(',')}) AND e.business_id = ? AND e.date >= ? AND e.date <= ? GROUP BY e.source_type ORDER BY net DESC`).all(businessId, from, to);
  const net = byType.reduce((s, r) => s + r.net, 0);
  return { from, to, opening_paise: opening, movements: byType.map((r) => ({ source: r.source || 'other', net_paise: r.net })), net_change_paise: net, closing_paise: opening + net };
}

function generalLedger(db, businessId, code, from = '0000-01-01', to = '9999-12-31') {
  const id = accountId(db, businessId, code);
  const acct = db.prepare('SELECT * FROM biz_accounts WHERE id = ?').get(id);
  const lines = db.prepare(`SELECT e.id AS entry_id, e.entry_no, e.date, e.memo, e.source_type, l.debit_paise, l.credit_paise FROM biz_journal_lines l JOIN biz_journal_entries e ON e.id = l.entry_id
    WHERE l.account_id = ? AND e.date >= ? AND e.date <= ? ORDER BY e.date, e.id, l.id`).all(id, from, to);
  let run = 0;
  return { account: { code, name: acct.name, type: acct.type }, lines: lines.map((l) => { run += normalDebit(acct.type) ? l.debit_paise - l.credit_paise : l.credit_paise - l.debit_paise; return { ...l, balance_paise: run }; }), closing_paise: run };
}

function partyBalances(db, businessId, code, partyType) {
  const id = accountId(db, businessId, code);
  const rows = db.prepare('SELECT party_id, SUM(debit_paise) AS d, SUM(credit_paise) AS c FROM biz_journal_lines WHERE account_id = ? AND party_type = ? GROUP BY party_id').all(id, partyType);
  return rows.map((r) => ({ party_id: r.party_id, balance_paise: code === '1100' ? r.d - r.c : r.c - r.d })).filter((r) => r.balance_paise !== 0);
}

function taxSummary(db, businessId, from, to) {
  const rows = balances(db, businessId, { from, to });
  const output = rows.find((r) => r.code === '2100')?.credit - rows.find((r) => r.code === '2100')?.debit || 0;
  const input = rows.find((r) => r.code === '1300')?.debit - rows.find((r) => r.code === '1300')?.credit || 0;
  const bySlab = db.prepare(`SELECT i.tax_bps AS rate_bps, SUM(i.line_total_paise - i.tax_paise) AS taxable_paise, SUM(i.tax_paise) AS tax_paise
    FROM biz_sales_items i JOIN biz_sales_invoices v ON v.id = i.invoice_id WHERE v.business_id = ? AND substr(v.created_at,1,10) >= ? AND substr(v.created_at,1,10) <= ? GROUP BY i.tax_bps ORDER BY i.tax_bps`).all(businessId, from, to);
  return { from, to, output_tax_paise: output, input_credit_paise: input, net_payable_paise: output - input, sales_by_rate: bySlab };
}

/* ---------------- router ---------------- */
function routes(ctx) {
  const { db } = ctx;
  const r = express.Router();
  const range = (q) => ({ from: String(q.from || today(Date.now() - 29 * 86400000)), to: String(q.to || today()) });

  r.get('/businesses/:businessId/accounts', requireBiz(ctx, 'accounting.read'), (req, res) => {
    res.json({ accounts: balances(db, req.biz.id).map((a) => ({ code: a.code, name: a.name, type: a.type, balance_paise: a.balance })) });
  });
  r.get('/businesses/:businessId/reports/trial-balance', requireBiz(ctx, 'reports.read'), (req, res) => res.json(trialBalance(db, req.biz.id, req.query.asOf)));
  r.get('/businesses/:businessId/reports/profit-loss', requireBiz(ctx, 'reports.read'), (req, res) => { const { from, to } = range(req.query); res.json(profitLoss(db, req.biz.id, from, to)); });
  r.get('/businesses/:businessId/reports/balance-sheet', requireBiz(ctx, 'reports.read'), (req, res) => res.json(balanceSheet(db, req.biz.id, req.query.asOf)));
  r.get('/businesses/:businessId/reports/cash-flow', requireBiz(ctx, 'reports.read'), (req, res) => { const { from, to } = range(req.query); res.json(cashFlow(db, req.biz.id, from, to)); });
  r.get('/businesses/:businessId/reports/tax', requireBiz(ctx, 'reports.read'), (req, res) => { const { from, to } = range(req.query); res.json(taxSummary(db, req.biz.id, from, to)); });
  r.get('/businesses/:businessId/reports/general-ledger', requireBiz(ctx, 'accounting.read'), (req, res) => {
    const { from, to } = range(req.query); res.json(generalLedger(db, req.biz.id, String(req.query.account || '1000'), from, to));
  });
  r.get('/businesses/:businessId/reports/outstanding', requireBiz(ctx, 'reports.read'), (req, res) => {
    const nameOf = (table) => (id) => db.prepare(`SELECT name FROM ${table} WHERE id = ? AND business_id = ?`).get(id, req.biz.id)?.name || `#${id}`;
    res.json({
      customers: partyBalances(db, req.biz.id, '1100', 'customer').map((x) => ({ ...x, name: nameOf('biz_customers')(x.party_id) })),
      suppliers: partyBalances(db, req.biz.id, '2000', 'supplier').map((x) => ({ ...x, name: nameOf('biz_suppliers')(x.party_id) })),
    });
  });

  r.post('/businesses/:businessId/expenses', requireBiz(ctx, 'expenses.write'), (req, res) => {
    const b = req.body;
    const code = EXPENSE_CODES.includes(b.accountCode) ? b.accountCode : '6090';
    const amount = int(b.amountPaise, 'Amount', { min: 1 });
    const tax = int(b.taxPaise || 0, 'Tax', { min: 0, max: amount });
    const method = ['cash', 'upi', 'card', 'bank', 'credit'].includes(b.method) ? b.method : 'cash';
    const key = text(b.idempotencyKey, { max: 80 }) || null;
    const out = tx(db, () => {
      if (key) { const d = db.prepare('SELECT * FROM biz_expenses WHERE idempotency_key = ?').get(key); if (d) return d; }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : today();
      const info = db.prepare('INSERT INTO biz_expenses (business_id, account_code, amount_paise, tax_paise, method, payee, note, date, idempotency_key, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(req.biz.id, code, amount, tax, method, text(b.payee, { max: 80 }), text(b.note, { max: 200 }), date, key, req.user.id);
      const id = Number(info.lastInsertRowid);
      post(db, {
        businessId: req.biz.id, date, memo: `Expense: ${b.payee || code}`, sourceType: 'expense', sourceId: id, sourceKey: `expense:${id}`, by: req.user.id,
        lines: [{ code, debit: amount - tax }, { code: '1300', debit: tax }, method === 'credit' ? { code: '2000', credit: amount } : { code: METHOD_ACCOUNT[method], credit: amount }],
      });
      audit(db, { actor: req.user.id, business: req.biz.id, action: 'expense.create', entity: 'expense', entityId: id });
      return db.prepare('SELECT * FROM biz_expenses WHERE id = ?').get(id);
    });
    res.status(201).json({ expense: out });
  });
  r.get('/businesses/:businessId/expenses', requireBiz(ctx, 'accounting.read'), (req, res) => {
    res.json({ expenses: db.prepare('SELECT * FROM biz_expenses WHERE business_id = ? ORDER BY date DESC, id DESC LIMIT 200').all(req.biz.id) });
  });

  // Owner puts in opening capital (DR cash/bank, CR equity).
  r.post('/businesses/:businessId/capital', requireBiz(ctx, 'accounting.write'), (req, res) => {
    const amount = int(req.body.amountPaise, 'Amount', { min: 1 });
    const method = req.body.method === 'bank' ? 'bank' : 'cash';
    const id = post(db, { businessId: req.biz.id, memo: 'Owner capital', sourceType: 'capital', sourceId: Date.now(), sourceKey: req.body.idempotencyKey ? `capital:${req.body.idempotencyKey}` : null, by: req.user.id, lines: [{ code: METHOD_ACCOUNT[method], debit: amount }, { code: '3000', credit: amount }] });
    res.status(201).json({ entryId: id });
  });

  r.post('/businesses/:businessId/journal-entries/:entryId/reverse', requireBiz(ctx, 'accounting.write'), (req, res) => {
    const id = reverse(db, req.biz.id, Number(req.params.entryId), req.user.id, text(req.body.reason, { max: 100 }) || 'Reversal');
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'journal.reverse', entity: 'journal', entityId: req.params.entryId });
    res.status(201).json({ entryId: id });
  });
  r.get('/businesses/:businessId/journal-entries', requireBiz(ctx, 'accounting.read'), (req, res) => {
    const rows = db.prepare('SELECT * FROM biz_journal_entries WHERE business_id = ? ORDER BY id DESC LIMIT 100').all(req.biz.id);
    const lines = db.prepare('SELECT a.code, l.debit_paise, l.credit_paise FROM biz_journal_lines l JOIN biz_accounts a ON a.id = l.account_id WHERE l.entry_id = ?');
    res.json({ entries: rows.map((e) => ({ ...e, lines: lines.all(e.id) })) });
  });
  r.post('/businesses/:businessId/periods/:period/close', requireBiz(ctx, 'accounting.write'), (req, res) => {
    if (!/^\d{4}-\d{2}$/.test(req.params.period)) throw new HttpError(400, 'Period must look like 2026-10');
    db.prepare('INSERT OR IGNORE INTO biz_financial_periods (business_id, period, closed_by) VALUES (?,?,?)').run(req.biz.id, req.params.period, req.user.id);
    audit(db, { actor: req.user.id, business: req.biz.id, action: 'period.close', entity: 'period', entityId: req.params.period });
    res.json({ ok: true });
  });
  return r;
}

module.exports = { seedChart, post, reverse, accountId, trialBalance, profitLoss, balanceSheet, cashFlow, generalLedger, partyBalances, taxSummary, balances, routes, METHOD_ACCOUNT, EXPENSE_CODES };

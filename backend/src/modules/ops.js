// Recurring operational jobs: refunds, low-stock and expiry alerts, daily report aggregation, appointment reminders.
const { today } = require('./core');
const inv = require('./inventory');

function register(ctx) {
  const { db, jobs, payments, notify, clock } = ctx;
  const day = (ms) => today(ms);

  jobs.register('refund:process', async () => { await payments.processRefunds(); });
  jobs.register('payments:reconcile', async () => { await payments.reconcile(); });

  jobs.register('biz:low_stock_scan', async ({ day: d }) => {
    for (const b of db.prepare('SELECT id, name, owner_user_id FROM businesses').all()) {
      const low = inv.lowStock(db, b.id);
      if (low.length) notify(b.owner_user_id, { type: 'low_stock', title: `${low.length} item${low.length > 1 ? 's' : ''} low on stock`, body: low.slice(0, 3).map((x) => x.name).join(', '), data: { businessId: b.id, day: d } });
    }
  });
  jobs.register('biz:expiry_scan', async ({ day: d }) => {
    for (const b of db.prepare('SELECT id, name, owner_user_id FROM businesses').all()) {
      const ex = inv.expiring(db, b.id, 30, clock());
      if (ex.length) notify(b.owner_user_id, { type: 'expiring', title: `${ex.length} batch${ex.length > 1 ? 'es' : ''} expiring soon`, body: ex.slice(0, 3).map((x) => `${x.name} (${x.expiry})`).join(', '), data: { businessId: b.id, day: d } });
    }
  });
  jobs.register('report:aggregate', async ({ day: d }) => {
    db.prepare(`INSERT INTO biz_daily_stats (business_id, day, sales_paise, invoices)
      SELECT business_id, ?, COALESCE(SUM(total_paise - returned_paise),0), COUNT(*) FROM biz_sales_invoices WHERE substr(created_at,1,10) = ? GROUP BY business_id
      ON CONFLICT(business_id, day) DO UPDATE SET sales_paise = excluded.sales_paise, invoices = excluded.invoices`).run(d, d);
  });

  // Sweeper: make sure today's recurring jobs exist (dedupe keys make this idempotent) and refunds keep draining.
  jobs.sweeper(() => {
    const now = clock(), d = day(now);
    jobs.schedule({ type: 'biz:low_stock_scan', runAt: now, payload: { day: d }, dedupeKey: `low_stock:${d}` });
    jobs.schedule({ type: 'biz:expiry_scan', runAt: now, payload: { day: d }, dedupeKey: `expiry:${d}` });
    jobs.schedule({ type: 'report:aggregate', runAt: now, payload: { day: day(now - 86400000) }, dedupeKey: `aggregate:${day(now - 86400000)}` });
    if (db.prepare("SELECT 1 FROM refunds WHERE status = 'pending' LIMIT 1").get()) jobs.schedule({ type: 'refund:process', runAt: now, dedupeKey: `refund:${Math.floor(now / 10000)}` });
    jobs.schedule({ type: 'payments:reconcile', runAt: now, dedupeKey: `reconcile:${Math.floor(now / 300000)}` });
  });
}

module.exports = { register };

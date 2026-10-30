// Durable background jobs: a table of due-dated work claimed atomically by an in-process worker.
// Handlers must be idempotent. Failures retry with exponential backoff; stuck jobs are recovered on start.
const { json } = require('./core');

function createJobs(db, { clock = Date.now } = {}) {
  const handlers = new Map();
  const sweepers = [];
  let timer = null;
  const ins = db.prepare('INSERT INTO jobs (type, run_at, payload, dedupe_key, created_at) VALUES (?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING');

  const api = {
    register(type, fn) { handlers.set(type, fn); },
    /** Sweepers re-derive overdue work from source-of-truth tables, so a lost job heals itself. */
    sweeper(fn) { sweepers.push(fn); },
    schedule({ type, runAt, payload = {}, dedupeKey = null }) {
      ins.run(type, Math.round(runAt), JSON.stringify(payload), dedupeKey, clock());
    },
    async runDue(now = clock()) {
      let ran = 0;
      for (const fn of sweepers) { try { await fn(now); } catch (e) { console.error('sweeper failed:', e.message); } }
      for (;;) {
        const due = db.prepare("SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at, id LIMIT 50").all(now);
        if (!due.length) break;
        for (const job of due) {
          const claim = db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ? AND status = 'pending'").run(job.id);
          if (claim.changes !== 1) continue; // another worker took it
          try {
            const h = handlers.get(job.type);
            if (!h) throw new Error(`no handler for ${job.type}`);
            await h(json(job.payload, {}), { now, job });
            db.prepare("UPDATE jobs SET status = 'done', done_at = ?, last_error = NULL WHERE id = ?").run(now, job.id);
          } catch (e) {
            const failed = job.attempts + 1 >= 5;
            db.prepare('UPDATE jobs SET status = ?, run_at = ?, last_error = ? WHERE id = ?')
              .run(failed ? 'failed' : 'pending', now + 5000 * 2 ** job.attempts, String(e.message).slice(0, 300), job.id);
          }
          ran++;
        }
      }
      return ran;
    },
    recover() { db.prepare("UPDATE jobs SET status = 'pending' WHERE status = 'running'").run(); },
    start(intervalMs = 1000) {
      api.recover();
      timer = setInterval(() => { api.runDue().catch((e) => console.error('job loop failed:', e.message)); }, intervalMs);
      timer.unref?.();
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    stats() { return db.prepare('SELECT status, COUNT(*) n FROM jobs GROUP BY status').all(); },
    failed() { return db.prepare("SELECT id, type, attempts, last_error FROM jobs WHERE status = 'failed' ORDER BY id DESC LIMIT 50").all(); },
  };
  return api;
}

module.exports = { createJobs };

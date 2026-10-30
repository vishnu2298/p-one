// Payment intents, verified webhooks, refunds and reconciliation.
// Provider "razorpay" talks to Razorpay (orders, signed webhooks, refunds). Provider "test" needs no account: its
// "success" is delivered as a *signed webhook* through exactly the same verification and processing path,
// so frontend-reported success is never trusted in either mode.
const crypto = require('crypto');
const { tx, json, HttpError } = require('./core');

function createPayments(db, { clock = Date.now, config }) {
  const provider = config.razorpayKeyId && config.razorpayKeySecret ? 'razorpay' : 'test';
  const testSecret = crypto.createHash('sha256').update(`test-webhook:${config.jwtSecret}`).digest('hex');
  const hooks = new Map();
  const hmac = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('hex');
  const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  async function rzp(path, body) {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64') },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.description || `Razorpay ${res.status}`);
    return data;
  }

  const api = {
    provider,
    /** Called when an intent becomes paid (inside the webhook transaction). */
    onPaid(purpose, fn) { hooks.set(purpose, fn); },

    async createIntent({ purpose, refId, userId, amountPaise }) {
      if (!(amountPaise > 0)) throw new HttpError(400, 'Nothing to pay');
      const id = crypto.randomUUID();
      let orderId = `test_order_${id}`;
      if (provider === 'razorpay') orderId = (await rzp('/orders', { amount: amountPaise, currency: 'INR', receipt: id.slice(0, 40) })).id;
      db.prepare('INSERT INTO payment_intents (id, purpose, ref_id, user_id, amount_paise, provider, provider_order_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, purpose, refId, userId ?? null, amountPaise, provider, orderId, clock(), clock());
      return { id, amountPaise, provider, providerOrderId: orderId, keyId: provider === 'razorpay' ? config.razorpayKeyId : null, status: 'created' };
    },

    get(id) { return db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(id); },

    /** Verifies the signature, then processes the event once (idempotent on the event id). */
    processWebhook(rawBody, signature, which = provider) {
      const secret = which === 'razorpay' ? config.razorpayWebhookSecret : testSecret;
      if (!secret || !signature || !safeEq(hmac(secret, rawBody), signature)) throw new HttpError(401, 'Invalid signature');
      const evt = json(rawBody.toString(), null);
      if (!evt || !evt.id || !evt.event) throw new HttpError(400, 'Malformed event');
      return api.applyEvent(which, evt);
    },

    applyEvent(which, evt) {
      return tx(db, () => {
        const seen = db.prepare('INSERT INTO webhook_events (id, provider, payload) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').run(`${which}:${evt.id}`, which, JSON.stringify(evt));
        if (seen.changes === 0) return { duplicate: true }; // retried delivery: already handled
        const pay = evt.payload?.payment?.entity;
        if (evt.event === 'payment.captured' && pay) {
          const intent = db.prepare('SELECT * FROM payment_intents WHERE provider_order_id = ?').get(pay.order_id);
          if (!intent) return { ignored: 'unknown order' };
          if (Number(pay.amount) !== intent.amount_paise) throw new HttpError(409, 'Amount mismatch'); // never accept a short payment
          if (intent.status === 'paid') return { duplicate: true };
          db.prepare("UPDATE payment_intents SET status = 'paid', provider_payment_id = ?, gateway_fee_paise = ?, updated_at = ? WHERE id = ?").run(pay.id, Number(pay.fee) || 0, clock(), intent.id);
          const hook = hooks.get(intent.purpose);
          if (hook) hook({ ...intent, status: 'paid', provider_payment_id: pay.id, gateway_fee_paise: Number(pay.fee) || 0 });
        } else if (evt.event === 'payment.failed' && pay) {
          db.prepare("UPDATE payment_intents SET status = 'failed', updated_at = ? WHERE provider_order_id = ? AND status = 'created'").run(clock(), pay.order_id);
        }
        db.prepare('UPDATE webhook_events SET processed_at = ? WHERE id = ?').run(clock(), `${which}:${evt.id}`);
        return { ok: true };
      });
    },

    /** Test provider only: produce a correctly signed "payment.captured" webhook and run it through the real path. */
    simulateTestPayment(intentId, { fail = false } = {}) {
      if (provider !== 'test') throw new HttpError(404, 'Not available');
      const intent = api.get(intentId);
      if (!intent) throw new HttpError(404, 'Payment not found');
      const body = JSON.stringify({
        id: `evt_${crypto.randomUUID()}`, event: fail ? 'payment.failed' : 'payment.captured',
        payload: { payment: { entity: { id: `pay_${crypto.randomUUID()}`, order_id: intent.provider_order_id, amount: intent.amount_paise, fee: Math.round(intent.amount_paise * (config.auctionGatewayFeeBps / 10000)) } } },
      });
      return api.processWebhook(Buffer.from(body), hmac(testSecret, body), 'test');
    },

    /** Queue a refund (processed by the refund job so a provider outage never blocks business logic). */
    requestRefund({ intentId, amountPaise, reason = '', dedupeKey }) {
      const r = db.prepare('INSERT INTO refunds (payment_intent_id, amount_paise, reason, dedupe_key, created_at) VALUES (?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING').run(intentId, amountPaise, reason, dedupeKey, clock());
      return r.changes === 1;
    },

    async processRefunds() {
      const pending = db.prepare("SELECT r.*, p.provider, p.provider_payment_id FROM refunds r JOIN payment_intents p ON p.id = r.payment_intent_id WHERE r.status = 'pending' ORDER BY r.id LIMIT 50").all();
      for (const r of pending) {
        try {
          let ref = `test_refund_${r.id}`;
          if (r.provider === 'razorpay') ref = (await rzp(`/payments/${r.provider_payment_id}/refund`, { amount: r.amount_paise, notes: { reason: r.reason } })).id;
          db.prepare("UPDATE refunds SET status = 'processed', provider_refund_id = ?, processed_at = ? WHERE id = ?").run(ref, clock(), r.id);
        } catch (e) { console.error('refund failed:', e.message); }
      }
      return pending.length;
    },

    /** Safety net for lost webhooks: ask Razorpay what happened to old unpaid orders. */
    async reconcile(olderThanMs = 15 * 60 * 1000) {
      if (provider !== 'razorpay') return 0;
      const stale = db.prepare("SELECT * FROM payment_intents WHERE status = 'created' AND provider = 'razorpay' AND created_at < ?").all(clock() - olderThanMs);
      let fixed = 0;
      for (const i of stale) {
        try {
          const res = await fetch(`https://api.razorpay.com/v1/orders/${i.provider_order_id}/payments`, { headers: { authorization: 'Basic ' + Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString('base64') } });
          const data = await res.json();
          const cap = (data.items || []).find((p) => p.status === 'captured');
          if (cap) { api.applyEvent('razorpay', { id: `recon_${cap.id}`, event: 'payment.captured', payload: { payment: { entity: { ...cap, order_id: i.provider_order_id } } } }); fixed++; }
        } catch { /* try again next run */ }
      }
      return fixed;
    },
  };
  return api;
}

module.exports = { createPayments };

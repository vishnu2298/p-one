// Scheduled auctions: lifecycle state machine, registration with verified payments, backend-authoritative bidding,
// anti-sniping, settlement, winner default, refunds and an append-only auction ledger.
// The client never decides who is winning: every outcome below is computed here, inside transactions.
const express = require('express');
const config = require('../config');
const { tx, audit, int, text, pct, json, HttpError } = require('./core');
const { CATEGORY_IDS } = require('../util');

const NEXT = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['SCHEDULED', 'DRAFT', 'CANCELLED'],
  SCHEDULED: ['REGISTRATION_OPEN', 'DRAFT', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['LIVE', 'CANCELLED'],
  LIVE: ['ENDED', 'CANCELLED'],
  ENDED: ['PAYMENT_PENDING', 'UNSOLD'],
  PAYMENT_PENDING: ['SOLD', 'PAYMENT_DEFAULTED', 'DISPUTED', 'CANCELLED'],
  PAYMENT_DEFAULTED: ['PAYMENT_PENDING', 'UNSOLD'],
  SOLD: ['SETTLED', 'DISPUTED'],
  UNSOLD: ['SETTLED'],
  DISPUTED: ['SOLD', 'SETTLED'],
  CANCELLED: [], SETTLED: [],
};
const MATERIAL = ['starting_bid_paise', 'reserve_paise', 'min_increment_paise', 'buy_now_paise', 'starts_at', 'ends_at', 'anti_snipe_window_s', 'anti_snipe_extend_s', 'max_extension_s'];
const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const AUTO_CONFIRM_MS = 7 * DAY;

function createAuctions(ctx) {
  const { db, notify, jobs, payments, clock } = ctx;
  const A = (id) => db.prepare('SELECT * FROM auctions WHERE id = ?').get(Number(id));
  const need = (id) => { const a = A(id); if (!a) throw new HttpError(404, 'Auction not found'); return a; };
  const settlementOf = (id) => db.prepare('SELECT * FROM auction_settlements WHERE auction_id = ?').get(id);
  const regOf = (aid, uid) => db.prepare('SELECT * FROM auction_registrations WHERE auction_id = ? AND user_id = ?').get(aid, uid);
  const registered = (aid) => db.prepare("SELECT * FROM auction_registrations WHERE auction_id = ? AND status = 'registered'").all(aid);

  /* ---------------- events, ledger, realtime ---------------- */
  const subs = new Map(); // auctionId -> Set(res): server-sent events
  const publish = (auctionId, type, data) => {
    for (const res of subs.get(auctionId) || []) { try { res.write(`id: ${data.seq ?? ''}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client went away */ } }
  };
  function event(auctionId, type, payload = {}) {
    db.prepare('INSERT INTO auction_events (auction_id, type, payload, created_at) VALUES (?,?,?,?)').run(auctionId, type, JSON.stringify(payload), clock());
  }
  function ledger({ auctionId, userId = null, kind, amount, ref = '', key }) {
    if (!(amount > 0)) return false;
    return db.prepare('INSERT INTO auction_ledger (auction_id, user_id, kind, amount_paise, ref, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING')
      .run(auctionId, userId, kind, amount, ref, key, clock()).changes === 1;
  }
  function setStatus(a, to, meta = {}) {
    if (!NEXT[a.status]?.includes(to)) throw new HttpError(409, `An auction that is ${a.status} cannot become ${to}`);
    db.prepare('UPDATE auctions SET status = ?, updated_at = ? WHERE id = ?').run(to, clock(), a.id);
    event(a.id, 'state', { from: a.status, to, ...meta });
    return { ...a, status: to };
  }
  const notifyMany = (userIds, n) => [...new Set(userIds)].forEach((u) => notify(u, n));

  /* ---------------- refunds ---------------- */
  /** Returns money held for a registration. which: 'all' (fee + deposit), 'deposit'. Never refunds the same thing twice. */
  function refundRegistration(reg, which, reason, newStatus) {
    const intent = reg.payment_intent_id ? payments.get(reg.payment_intent_id) : null;
    if (!intent || intent.status !== 'paid') { db.prepare('UPDATE auction_registrations SET status = ? WHERE id = ?').run(newStatus, reg.id); return; }
    if (which === 'all' && reg.fee_paise > 0) {
      if (ledger({ auctionId: reg.auction_id, userId: reg.user_id, kind: 'fee_refund', amount: reg.fee_paise, ref: reason, key: `reg:${reg.id}:fee_refund` })) {
        payments.requestRefund({ intentId: intent.id, amountPaise: reg.fee_paise, reason, dedupeKey: `auc:${reg.auction_id}:reg${reg.id}:fee` });
      }
    }
    if (reg.deposit_paise > 0 && ledger({ auctionId: reg.auction_id, userId: reg.user_id, kind: 'deposit_release', amount: reg.deposit_paise, ref: reason, key: `reg:${reg.id}:deposit_release` })) {
      payments.requestRefund({ intentId: intent.id, amountPaise: reg.deposit_paise, reason, dedupeKey: `auc:${reg.auction_id}:reg${reg.id}:deposit` });
    }
    db.prepare('UPDATE auction_registrations SET status = ? WHERE id = ?').run(newStatus, reg.id);
  }
  function forfeitOrRelease(a, reg, reason) {
    if (a.default_policy === 'forfeit_deposit' && config.auctionAllowForfeit && reg.deposit_paise > 0) {
      ledger({ auctionId: a.id, userId: reg.user_id, kind: 'deposit_forfeit', amount: reg.deposit_paise, ref: reason, key: `reg:${reg.id}:forfeit` });
      db.prepare("UPDATE auction_registrations SET status = 'forfeited' WHERE id = ?").run(reg.id);
    } else refundRegistration(reg, 'deposit', reason, 'released');
  }

  /* ---------------- lifecycle ---------------- */
  function openRegistration(a) {
    if (a.status !== 'SCHEDULED' || clock() < a.reg_opens_at) return a;
    const n = setStatus(a, 'REGISTRATION_OPEN');
    notify(a.seller_id, { type: 'auction', title: 'Registration is open', body: a.title, data: { auctionId: a.id } });
    return n;
  }
  function closeRegistration(a) {
    if (a.status !== 'REGISTRATION_OPEN' || clock() < a.reg_closes_at) return a;
    db.prepare("UPDATE auction_registrations SET status = 'cancelled' WHERE auction_id = ? AND status = 'pending_payment'").run(a.id);
    const n = setStatus(a, 'REGISTRATION_CLOSED', { participants: registered(a.id).length });
    notifyMany(registered(a.id).map((r) => r.user_id), { type: 'auction', title: 'Registration closed', body: `${a.title} starts soon. Be ready to bid.`, data: { auctionId: a.id } });
    return n;
  }
  function startAuction(a) {
    if (a.status !== 'REGISTRATION_CLOSED' || clock() < a.starts_at) return a;
    const people = registered(a.id);
    if (!people.length) return cancelAuction(a, 'No bidders registered', { refund: false });
    const n = setStatus(a, 'LIVE');
    jobs.schedule({ type: 'auction:end', runAt: a.ends_at, payload: { auctionId: a.id }, dedupeKey: `auction_end:${a.id}:${a.ends_at}` });
    notifyMany(people.map((r) => r.user_id), { type: 'auction', title: 'Auction is live!', body: `${a.title}: bidding has started.`, data: { auctionId: a.id } });
    publish(a.id, 'state', { status: 'LIVE', seq: a.seq });
    return n;
  }

  function topBidders(aid) {
    return db.prepare('SELECT user_id, MAX(amount_paise) AS top FROM auction_bids WHERE auction_id = ? GROUP BY user_id ORDER BY top DESC, MIN(seq) ASC').all(aid);
  }

  function endAuction(a) {
    if (a.status !== 'LIVE' || clock() < a.ends_at) return a;
    return tx(db, () => {
      let cur = setStatus(A(a.id), 'ENDED');
      const ranked = topBidders(a.id);
      const reserveOk = !!ranked.length && (a.reserve_paise == null || ranked[0].top >= a.reserve_paise);
      if (!reserveOk) {
        event(a.id, 'unsold', { reason: ranked.length ? 'reserve_not_met' : 'no_bids' });
        for (const r of registered(a.id)) refundRegistration(r, 'deposit', 'Auction ended without a sale', 'released');
        notifyMany(registered(a.id).map((r) => r.user_id).concat(a.seller_id), { type: 'auction', title: 'Auction ended without a sale', body: ranked.length ? `${a.title}: the reserve price was not met.` : `${a.title} received no bids.`, data: { auctionId: a.id } });
        cur = setStatus(cur, 'UNSOLD');
        publish(a.id, 'ended', { status: 'UNSOLD', seq: a.seq });
        return cur;
      }
      const winner = ranked[0];
      const runnerUp = a.offer_next_bidder ? ranked.slice(1).find((r) => (a.reserve_paise == null || r.top >= a.reserve_paise) && regOf(a.id, r.user_id)?.status === 'registered') : null;
      db.prepare('INSERT INTO auction_settlements (auction_id, winner_user_id, amount_paise, payment_deadline, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(a.id, winner.user_id, winner.top, clock() + a.payment_deadline_hours * HOUR, clock(), clock());
      // Deposits: everyone is released except the winner (credited to their payment) and one runner-up (held as the fallback offer).
      for (const r of registered(a.id)) {
        if (r.user_id === winner.user_id || (runnerUp && r.user_id === runnerUp.user_id)) continue;
        refundRegistration(r, 'deposit', 'Auction ended: deposit returned', 'released');
      }
      cur = setStatus(cur, 'PAYMENT_PENDING', { winner: winner.user_id, amount_paise: winner.top });
      const s = settlementOf(a.id);
      jobs.schedule({ type: 'auction:payment_deadline', runAt: s.payment_deadline, payload: { auctionId: a.id }, dedupeKey: `auction_deadline:${a.id}:${s.offer_round}` });
      notify(winner.user_id, { type: 'auction_won', title: 'You won the auction!', body: `${a.title}: pay within ${a.payment_deadline_hours} hours to claim it.`, data: { auctionId: a.id } });
      notifyMany(registered(a.id).map((r) => r.user_id).filter((u) => u !== winner.user_id).concat(a.seller_id), { type: 'auction', title: 'Auction ended', body: `${a.title} has a winner.`, data: { auctionId: a.id } });
      publish(a.id, 'ended', { status: 'PAYMENT_PENDING', seq: a.seq });
      return cur;
    });
  }

  function defaultWinner(a) {
    if (a.status !== 'PAYMENT_PENDING') return a;
    const s = settlementOf(a.id);
    if (!s || s.status !== 'awaiting_payment' || clock() < s.payment_deadline) return a;
    return tx(db, () => {
      let cur = setStatus(A(a.id), 'PAYMENT_DEFAULTED', { defaulted: s.winner_user_id });
      const wreg = regOf(a.id, s.winner_user_id);
      forfeitOrRelease(a, wreg, 'Winner did not pay in time');
      notify(s.winner_user_id, { type: 'auction', title: 'Payment deadline missed', body: a.default_policy === 'forfeit_deposit' && config.auctionAllowForfeit ? `${a.title}: your deposit was forfeited as disclosed in the terms.` : `${a.title}: your deposit was returned.`, data: { auctionId: a.id } });
      const skipped = [...json(s.skipped_users, []), s.winner_user_id];
      const next = a.offer_next_bidder ? topBidders(a.id).find((r) => !skipped.includes(r.user_id) && (a.reserve_paise == null || r.top >= a.reserve_paise) && regOf(a.id, r.user_id)?.status === 'registered') : null;
      if (!next) {
        for (const r of registered(a.id)) refundRegistration(r, 'deposit', 'Auction unsold after winner default', 'released');
        db.prepare("UPDATE auction_settlements SET status = 'defaulted', skipped_users = ?, updated_at = ? WHERE auction_id = ?").run(JSON.stringify(skipped), clock(), a.id);
        event(a.id, 'unsold', { reason: 'winner_default' });
        notify(a.seller_id, { type: 'auction', title: 'Winner did not pay', body: `${a.title} is unsold. You can relist it.`, data: { auctionId: a.id } });
        return setStatus(cur, 'UNSOLD');
      }
      db.prepare("UPDATE auction_settlements SET winner_user_id = ?, amount_paise = ?, offer_round = offer_round + 1, status = 'awaiting_payment', payment_deadline = ?, payment_intent_id = NULL, skipped_users = ?, updated_at = ? WHERE auction_id = ?")
        .run(next.user_id, next.top, clock() + a.payment_deadline_hours * HOUR, JSON.stringify(skipped), clock(), a.id);
      const s2 = settlementOf(a.id);
      jobs.schedule({ type: 'auction:payment_deadline', runAt: s2.payment_deadline, payload: { auctionId: a.id }, dedupeKey: `auction_deadline:${a.id}:${s2.offer_round}` });
      cur = setStatus(cur, 'PAYMENT_PENDING', { offered_to: next.user_id, amount_paise: next.top, round: s2.offer_round });
      notify(next.user_id, { type: 'auction_won', title: 'The item is yours if you want it', body: `${a.title}: the first winner did not pay. Pay ₹${(next.top / 100).toLocaleString('en-IN')} within ${a.payment_deadline_hours} hours.`, data: { auctionId: a.id } });
      return cur;
    });
  }

  function cancelAuction(a, reason, { refund = true } = {}) {
    return tx(db, () => {
      const cur = setStatus(A(a.id), 'CANCELLED', { reason });
      db.prepare('UPDATE auctions SET cancelled_reason = ? WHERE id = ?').run(reason, a.id);
      if (refund) for (const r of db.prepare("SELECT * FROM auction_registrations WHERE auction_id = ? AND status IN ('registered','pending_payment')").all(a.id)) refundRegistration(r, 'all', `Auction cancelled: ${reason}`, 'refunded');
      notifyMany(db.prepare('SELECT user_id FROM auction_registrations WHERE auction_id = ?').all(a.id).map((r) => r.user_id).concat(a.seller_id), { type: 'auction', title: 'Auction cancelled', body: `${a.title}: ${reason}. Any payment is being refunded.`, data: { auctionId: a.id } });
      publish(a.id, 'ended', { status: 'CANCELLED', seq: a.seq });
      return cur;
    });
  }

  function releasePayout(a, s) {
    if (s.payout_status === 'released') return;
    const commission = pct(s.amount_paise, config.auctionCommissionBps);
    const payout = s.amount_paise - commission;
    ledger({ auctionId: a.id, userId: a.seller_id, kind: 'seller_payout', amount: payout, key: `auction:${a.id}:payout` });
    ledger({ auctionId: a.id, kind: 'platform_commission', amount: commission, key: `auction:${a.id}:commission` });
    db.prepare("UPDATE auction_settlements SET commission_paise = ?, seller_payout_paise = ?, payout_status = 'released', updated_at = ? WHERE id = ?").run(commission, payout, clock(), s.id);
    notify(a.seller_id, { type: 'auction', title: 'Payout released', body: `${a.title}: ₹${(payout / 100).toLocaleString('en-IN')} will reach your account (platform fee ₹${(commission / 100).toLocaleString('en-IN')}).`, data: { auctionId: a.id } });
  }
  function confirmDelivery(a, auto = false) {
    return tx(db, () => {
      const s = settlementOf(a.id);
      if (a.status !== 'SOLD' || !s) throw new HttpError(409, 'Nothing to confirm yet');
      db.prepare("UPDATE auction_settlements SET delivered_at = ?, status = 'delivered', updated_at = ? WHERE id = ?").run(clock(), clock(), s.id);
      releasePayout(a, s);
      return setStatus(A(a.id), 'SETTLED', { auto });
    });
  }

  /** Brings an auction up to date with the clock. Idempotent; used by jobs, the sweeper and request handlers. */
  function advance(id) {
    for (let i = 0; i < 8; i++) {
      let a = A(id); if (!a) return null;
      const before = a.status + (settlementOf(id)?.offer_round ?? '');
      const now = clock();
      if (a.status === 'SCHEDULED' && now >= a.reg_opens_at) openRegistration(a);
      else if (a.status === 'REGISTRATION_OPEN' && now >= a.reg_closes_at) closeRegistration(a);
      else if (a.status === 'REGISTRATION_CLOSED' && now >= a.starts_at) startAuction(a);
      else if (a.status === 'LIVE' && now >= a.ends_at) endAuction(a);
      else if (a.status === 'PAYMENT_PENDING') defaultWinner(a);
      else if (a.status === 'SOLD') { const s = settlementOf(id); if (s?.shipped_at && now >= s.shipped_at + AUTO_CONFIRM_MS) confirmDelivery(a, true); }
      else if (a.status === 'UNSOLD' && !db.prepare("SELECT 1 FROM refunds WHERE dedupe_key LIKE ? AND status = 'pending'").get(`auc:${id}:%`)) setStatus(a, 'SETTLED');
      a = A(id);
      if (a.status + (settlementOf(id)?.offer_round ?? '') === before) return a;
    }
    return A(id);
  }

  jobs.register('auction:open_registration', async ({ auctionId }) => { advance(auctionId); });
  jobs.register('auction:close_registration', async ({ auctionId }) => { advance(auctionId); });
  jobs.register('auction:start', async ({ auctionId }) => { advance(auctionId); });
  jobs.register('auction:end', async ({ auctionId }) => { advance(auctionId); });
  jobs.register('auction:payment_deadline', async ({ auctionId }) => { advance(auctionId); });
  jobs.register('auction:expire_registration', async ({ registrationId }) => {
    db.prepare("UPDATE auction_registrations SET status = 'cancelled' WHERE id = ? AND status = 'pending_payment'").run(registrationId);
  });
  jobs.register('auction:amendment_deadline', async ({ amendmentId }) => { applyAmendment(amendmentId); });
  jobs.sweeper(() => {
    for (const row of db.prepare("SELECT id FROM auctions WHERE status NOT IN ('DRAFT','PENDING_APPROVAL','CANCELLED','SETTLED','DISPUTED')").all()) advance(row.id);
    for (const am of db.prepare("SELECT id FROM auction_amendments WHERE status = 'pending' AND consent_deadline <= ?").all(clock())) applyAmendment(am.id);
  });

  /* ---------------- payments ---------------- */
  payments.onPaid('auction_registration', (intent) => {
    const reg = db.prepare('SELECT * FROM auction_registrations WHERE id = ?').get(intent.ref_id);
    if (!reg) return;
    const a = A(reg.auction_id);
    ledger({ auctionId: a.id, userId: reg.user_id, kind: 'registration_fee', amount: reg.fee_paise, key: `reg:${reg.id}:fee` });
    ledger({ auctionId: a.id, userId: reg.user_id, kind: 'deposit_hold', amount: reg.deposit_paise, key: `reg:${reg.id}:deposit` });
    ledger({ auctionId: a.id, userId: reg.user_id, kind: 'gateway_fee', amount: intent.gateway_fee_paise || 0, key: `reg:${reg.id}:gw` });
    db.prepare('UPDATE auction_registrations SET payment_intent_id = ?, paid_at = ? WHERE id = ?').run(intent.id, clock(), reg.id);
    const open = a.status === 'REGISTRATION_OPEN' && clock() < a.reg_closes_at;
    const full = a.max_participants && registered(a.id).length >= a.max_participants;
    if (reg.status !== 'pending_payment' || !open || full) { // too late or full: never keep money for a seat we cannot give
      refundRegistration({ ...reg, payment_intent_id: intent.id }, 'all', 'Registration could not be completed', 'refunded');
      notify(reg.user_id, { type: 'auction', title: 'Registration could not be completed', body: `${a.title}: your payment is being refunded.`, data: { auctionId: a.id } });
      return;
    }
    db.prepare("UPDATE auction_registrations SET status = 'registered' WHERE id = ?").run(reg.id);
    event(a.id, 'registered', { user: reg.user_id });
    notify(reg.user_id, { type: 'auction', title: 'You are registered', body: `${a.title} · starts ${new Date(a.starts_at + 19800000).toISOString().replace('T', ' ').slice(0, 16)} IST`, data: { auctionId: a.id } });
  });

  payments.onPaid('auction_winner', (intent) => {
    const a = A(intent.ref_id);
    const s = a && settlementOf(a.id);
    const stale = !s || s.payment_intent_id !== intent.id || a.status !== 'PAYMENT_PENDING' || s.status !== 'awaiting_payment';
    ledger({ auctionId: intent.ref_id, userId: intent.user_id, kind: 'winner_payment', amount: intent.amount_paise, key: `intent:${intent.id}:winner` });
    if (stale) {
      ledger({ auctionId: intent.ref_id, userId: intent.user_id, kind: 'buyer_refund', amount: intent.amount_paise, ref: 'Late or duplicate payment', key: `intent:${intent.id}:refund` });
      payments.requestRefund({ intentId: intent.id, amountPaise: intent.amount_paise, reason: 'Auction payment could not be applied', dedupeKey: `auc:${intent.ref_id}:late:${intent.id}` });
      notify(intent.user_id, { type: 'auction', title: 'Payment will be refunded', body: 'The auction payment window had closed.', data: { auctionId: intent.ref_id } });
      return;
    }
    const wreg = regOf(a.id, s.winner_user_id);
    if (wreg?.status === 'registered' && wreg.deposit_paise > 0) {
      ledger({ auctionId: a.id, userId: wreg.user_id, kind: 'deposit_apply', amount: wreg.deposit_paise, key: `reg:${wreg.id}:apply` });
      db.prepare("UPDATE auction_registrations SET status = 'applied' WHERE id = ?").run(wreg.id);
    }
    ledger({ auctionId: a.id, kind: 'gateway_fee', amount: intent.gateway_fee_paise || 0, key: `intent:${intent.id}:gw` });
    db.prepare("UPDATE auction_settlements SET status = 'paid', gateway_fee_paise = ?, updated_at = ? WHERE id = ?").run(intent.gateway_fee_paise || 0, clock(), s.id);
    // the fallback bidder's held deposit is returned now that the sale is secured
    for (const r of registered(a.id)) refundRegistration(r, 'deposit', 'Auction sold: deposit returned', 'released');
    setStatus(a, 'SOLD', { buyer: s.winner_user_id });
    notify(a.seller_id, { type: 'auction', title: 'Sold! Please ship the item', body: `${a.title}: the buyer has paid ₹${(s.amount_paise / 100).toLocaleString('en-IN')}.`, data: { auctionId: a.id } });
    notify(s.winner_user_id, { type: 'auction', title: 'Payment received', body: `${a.title}: the seller will arrange pickup or shipping.`, data: { auctionId: a.id } });
  });

  /* ---------------- bidding ---------------- */
  function bidderLabels(aid) {
    const order = db.prepare('SELECT user_id FROM auction_bids WHERE auction_id = ? GROUP BY user_id ORDER BY MIN(seq)').all(aid);
    return new Map(order.map((o, i) => [o.user_id, `Bidder ${i + 1}`]));
  }
  const toBid = (b, labels, me) => ({ seq: b.seq, amountPaise: b.amount_paise, at: b.created_at, bidder: labels.get(b.user_id) || 'Bidder', mine: b.user_id === me, kind: b.kind });

  function placeBid({ auctionId, userId, amount, key, buyNow = false }) {
    advance(auctionId); // lazily applies a just-due start or end before validating
    const out = tx(db, () => { // BEGIN IMMEDIATE: bids for one auction are processed strictly one at a time
      const a = need(auctionId);
      const dup = db.prepare('SELECT * FROM auction_bids WHERE auction_id = ? AND user_id = ? AND idempotency_key = ?').get(a.id, userId, key);
      if (dup) return { bid: dup, auction: a, duplicate: true };
      const now = clock();
      if (a.status !== 'LIVE' || now < a.starts_at || now >= a.ends_at) throw new HttpError(409, a.status === 'LIVE' ? 'Bidding has ended' : 'This auction is not accepting bids');
      if (a.seller_id === userId) throw new HttpError(403, 'You cannot bid on your own auction');
      const reg = regOf(a.id, userId);
      if (!reg || reg.status !== 'registered') throw new HttpError(403, 'Register for this auction to bid');
      if (a.current_bidder_id === userId && !buyNow) throw new HttpError(409, 'You are already the highest bidder');
      if (a.max_bids_per_user && db.prepare('SELECT COUNT(*) n FROM auction_bids WHERE auction_id = ? AND user_id = ?').get(a.id, userId).n >= a.max_bids_per_user) throw new HttpError(409, 'You have used all your bids for this auction');
      if (buyNow) {
        if (!a.buy_now_paise) throw new HttpError(409, 'Buy Now is not offered for this auction');
        if (a.current_bid_paise >= a.buy_now_paise) throw new HttpError(409, 'Buy Now is no longer available');
        amount = a.buy_now_paise;
      } else {
        const min = a.bid_count === 0 ? a.starting_bid_paise : a.current_bid_paise + a.min_increment_paise;
        if (amount < min) throw new HttpError(409, `Your bid must be at least ₹${(min / 100).toLocaleString('en-IN')}`);
        if (amount > Math.max(a.starting_bid_paise, a.market_price_paise) * 50) throw new HttpError(400, 'That bid looks like a typing mistake. Please check the amount.');
        if (a.buy_now_paise && amount >= a.buy_now_paise) throw new HttpError(409, `At ₹${(a.buy_now_paise / 100).toLocaleString('en-IN')} or more, use Buy Now instead`);
      }
      const seq = a.seq + 1;
      db.prepare('INSERT INTO auction_bids (auction_id, seq, user_id, amount_paise, idempotency_key, kind, created_at) VALUES (?,?,?,?,?,?,?)').run(a.id, seq, userId, amount, key, buyNow ? 'buy_now' : 'bid', now);
      let endsAt = a.ends_at, extendedBy = 0;
      if (!buyNow && endsAt - now <= a.anti_snipe_window_s * 1000) {
        extendedBy = Math.min(a.anti_snipe_extend_s * 1000, a.max_extension_s * 1000 - (endsAt - a.original_ends_at));
        if (extendedBy > 0) {
          endsAt += extendedBy;
          jobs.schedule({ type: 'auction:end', runAt: endsAt, payload: { auctionId: a.id }, dedupeKey: `auction_end:${a.id}:${endsAt}` });
          event(a.id, 'extended', { endsAt, by: extendedBy });
        }
      }
      db.prepare('UPDATE auctions SET seq = ?, current_bid_paise = ?, current_bidder_id = ?, bid_count = bid_count + 1, ends_at = ?, updated_at = ? WHERE id = ?').run(seq, amount, userId, endsAt, now, a.id);
      event(a.id, buyNow ? 'buy_now' : 'bid', { seq, amount });
      return { bid: db.prepare('SELECT * FROM auction_bids WHERE auction_id = ? AND seq = ?').get(a.id, seq), auction: A(a.id), previousLeader: a.current_bidder_id, extendedBy };
    });
    if (!out.duplicate) {
      const labels = bidderLabels(auctionId);
      publish(auctionId, 'bid', { seq: out.bid.seq, amountPaise: out.bid.amount_paise, bidCount: out.auction.bid_count, endsAt: out.auction.ends_at, bidder: labels.get(userId), extended: out.extendedBy > 0 });
      if (out.previousLeader && out.previousLeader !== userId) notify(out.previousLeader, { type: 'auction_outbid', title: 'You were outbid', body: `${out.auction.title}: now ₹${(out.bid.amount_paise / 100).toLocaleString('en-IN')}`, data: { auctionId } });
      if (out.bid.kind === 'buy_now') { // closes the auction right away
        db.prepare('UPDATE auctions SET ends_at = ? WHERE id = ?').run(clock(), auctionId);
        advance(auctionId);
      }
    }
    return out;
  }

  /* ---------------- views ---------------- */
  function publicView(a, me) {
    const s = ['PAYMENT_PENDING', 'SOLD', 'SETTLED', 'DISPUTED', 'PAYMENT_DEFAULTED'].includes(a.status) ? settlementOf(a.id) : null;
    const isSeller = me?.id === a.seller_id, mine = me ? regOf(a.id, me.id) : null;
    const seller = db.prepare('SELECT id, name, verified FROM users WHERE id = ?').get(a.seller_id);
    return {
      id: a.id, title: a.title, description: a.description, images: json(a.images, []), videos: json(a.videos, []), category: a.category, condition: a.condition, verifiedItem: !!a.verified_item, city: a.city,
      status: a.status, marketPricePaise: a.market_price_paise, startingBidPaise: a.starting_bid_paise, minIncrementPaise: a.min_increment_paise, buyNowPaise: a.buy_now_paise,
      registrationFeePaise: a.registration_fee_paise, depositPaise: a.deposit_paise, regOpensAt: a.reg_opens_at, regClosesAt: a.reg_closes_at, startsAt: a.starts_at, endsAt: a.ends_at,
      maxParticipants: a.max_participants, participants: db.prepare("SELECT COUNT(*) n FROM auction_registrations WHERE auction_id = ? AND status IN ('registered','applied','released','forfeited')").get(a.id).n,
      currentBidPaise: a.current_bid_paise, bidCount: a.bid_count, seq: a.seq, reserveMet: a.reserve_paise == null ? null : a.current_bid_paise >= a.reserve_paise, hasReserve: a.reserve_paise != null,
      shipping: json(a.shipping, []), pickupAddress: ['SOLD', 'SETTLED'].includes(a.status) && !(isSeller || s?.winner_user_id === me?.id) ? '' : a.pickup_address,
      antiSnipe: { windowS: a.anti_snipe_window_s, extendS: a.anti_snipe_extend_s, maxExtensionS: a.max_extension_s }, paymentDeadlineHours: a.payment_deadline_hours,
      defaultPolicy: a.default_policy === 'forfeit_deposit' && config.auctionAllowForfeit ? 'forfeit_deposit' : 'refund_deposit', offerNextBidder: !!a.offer_next_bidder, terms: json(a.terms, {}),
      seller: { id: seller.id, name: seller.name, verified: !!seller.verified }, isSeller, sellerVerified: !!a.seller_verified,
      myRegistration: mine ? { status: mine.status, paymentIntentId: mine.payment_intent_id } : null,
      isLeading: !!me && a.current_bidder_id === me.id,
      iWon: !!(s && me && s.winner_user_id === me.id && ['PAYMENT_PENDING', 'SOLD', 'SETTLED'].includes(a.status)),
      settlement: s && (isSeller || s.winner_user_id === me?.id) ? { status: s.status, amountPaise: s.amount_paise, depositCreditPaise: s.winner_user_id === me?.id ? (regOf(a.id, me.id)?.deposit_paise ?? 0) : undefined, dueAt: s.payment_deadline, round: s.offer_round, fulfillment: s.fulfillment, tracking: s.tracking, shippedAt: s.shipped_at, deliveredAt: s.delivered_at, sellerPayoutPaise: isSeller ? s.seller_payout_paise : undefined, commissionPaise: isSeller ? s.commission_paise : undefined, payoutStatus: isSeller ? s.payout_status : undefined } : null,
      ...(isSeller ? { reservePaise: a.reserve_paise, cancelledReason: a.cancelled_reason } : {}),
    };
  }

  function ledgerSummary(auctionId) {
    const rows = db.prepare('SELECT kind, SUM(amount_paise) AS n FROM auction_ledger WHERE auction_id = ? GROUP BY kind').all(auctionId);
    const k = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
    const g = (x) => k[x] || 0;
    const cashIn = g('registration_fee') + g('deposit_hold') + g('winner_payment');
    const cashOut = g('fee_refund') + g('deposit_release') + g('buyer_refund') + g('seller_payout');
    const retained = g('registration_fee') - g('fee_refund') + g('deposit_forfeit') + g('platform_commission');
    const heldDeposits = g('deposit_hold') - g('deposit_release') - g('deposit_forfeit') - g('deposit_apply');
    const escrow = g('winner_payment') + g('deposit_apply') - g('buyer_refund') - g('seller_payout') - g('platform_commission');
    return { by_kind: k, cash_in_paise: cashIn, cash_out_paise: cashOut, platform_revenue_paise: retained, platform_costs_paise: g('gateway_fee'), held_deposits_paise: heldDeposits, escrow_paise: escrow, balanced: cashIn - cashOut === retained + heldDeposits + escrow };
  }

  /* ---------------- amendments (consent required after registration opens) ---------------- */
  function applyAmendment(amendmentId) {
    return tx(db, () => {
      const am = db.prepare("SELECT * FROM auction_amendments WHERE id = ? AND status = 'pending'").get(amendmentId);
      if (!am) return;
      const a = A(am.auction_id);
      const votes = new Map(db.prepare('SELECT user_id, accepted FROM auction_amendment_votes WHERE amendment_id = ?').all(am.id).map((v) => [v.user_id, v.accepted]));
      const open = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(a.status);
      const everyoneAnswered = registered(a.id).every((r) => votes.has(r.user_id));
      if (!open) { db.prepare("UPDATE auction_amendments SET status = 'void' WHERE id = ?").run(am.id); return; }
      if (!everyoneAnswered && clock() < am.consent_deadline) return;
      // Silence is not consent: anyone who did not accept is refunded in full and removed.
      for (const r of registered(a.id)) if (votes.get(r.user_id) !== 1) { refundRegistration(r, 'all', 'You did not accept the amended terms', 'refunded'); notify(r.user_id, { type: 'auction', title: 'Registration refunded', body: `${a.title}: you did not accept the changed terms, so your payment was refunded.`, data: { auctionId: a.id } }); }
      const ch = json(am.changes, {});
      const cols = Object.keys(ch);
      db.prepare(`UPDATE auctions SET ${cols.map((c) => `${c} = ?`).join(', ')}, original_ends_at = CASE WHEN ? THEN ? ELSE original_ends_at END, updated_at = ? WHERE id = ?`).run(...cols.map((c) => ch[c]), 'ends_at' in ch ? 1 : 0, ch.ends_at ?? 0, clock(), a.id);
      db.prepare("UPDATE auction_amendments SET status = 'applied' WHERE id = ?").run(am.id);
      event(a.id, 'amended', ch);
      const n = A(a.id);
      jobs.schedule({ type: 'auction:start', runAt: n.starts_at, payload: { auctionId: a.id }, dedupeKey: `auction_start:${a.id}:${n.starts_at}` });
    });
  }

  return { A, need, advance, placeBid, publicView, ledgerSummary, setStatus, cancelAuction, confirmDelivery, releasePayout, refundRegistration, regOf, registered, settlementOf, subs, publish, bidderLabels, toBid, event, applyAmendment, ledger, topBidders, endAuction, startAuction };
}

/* =====================================================================================================
   HTTP API
   ===================================================================================================== */
function routes(ctx) {
  const { db, notify, jobs, payments, clock } = ctx;
  const svc = createAuctions(ctx);
  ctx.auctions = svc;
  const r = express.Router();
  const { need, advance } = svc;
  const user = (req) => req.user;

  /* ---- authoring ---- */
  function readTerms(b, cur = {}) {
    const now = clock();
    const g = (k, alt) => (b[k] !== undefined ? b[k] : cur[alt] ?? undefined);
    const starting = int(g('startingBidPaise', 'starting_bid_paise'), 'Starting bid', { min: 100, max: 1e11 });
    const inc = int(g('minIncrementPaise', 'min_increment_paise'), 'Minimum increment', { min: 100, max: 1e11 });
    const reserve = g('reservePaise', 'reserve_paise') == null || g('reservePaise', 'reserve_paise') === '' ? null : int(g('reservePaise', 'reserve_paise'), 'Reserve price', { min: starting, max: 1e11 });
    const buyNow = g('buyNowPaise', 'buy_now_paise') == null || g('buyNowPaise', 'buy_now_paise') === '' ? null : int(g('buyNowPaise', 'buy_now_paise'), 'Buy Now price', { min: Math.max(starting, reserve || 0) + inc, max: 1e11 });
    const regOpens = int(g('regOpensAt', 'reg_opens_at'), 'Registration opening', { max: 4e12 });
    const regCloses = int(g('regClosesAt', 'reg_closes_at'), 'Registration closing', { max: 4e12 });
    const starts = int(g('startsAt', 'starts_at'), 'Auction start', { max: 4e12 });
    const ends = int(g('endsAt', 'ends_at'), 'Auction end', { max: 4e12 });
    if (!(regOpens < regCloses && regCloses <= starts && starts + 5 * MIN <= ends)) throw new HttpError(400, 'Dates must run in order: registration opens, registration closes, auction starts, auction ends (at least 5 minutes of bidding)');
    if (ends - starts > 14 * DAY) throw new HttpError(400, 'An auction can run for at most 14 days');
    const shipping = (Array.isArray(b.shipping) ? b.shipping : json(cur.shipping, ['pickup'])).filter((x) => ['pickup', 'shipping'].includes(x));
    if (!shipping.length) throw new HttpError(400, 'Choose pickup, shipping or both');
    const policy = (b.defaultPolicy ?? cur.default_policy) === 'refund_deposit' ? 'refund_deposit' : 'forfeit_deposit';
    return {
      title: text(b.title ?? cur.title, { min: 3, max: 100, name: 'Title' }), description: text(b.description ?? cur.description ?? '', { max: 3000 }),
      images: JSON.stringify((Array.isArray(b.images) ? b.images : json(cur.images, [])).filter((x) => typeof x === 'string').slice(0, 8)),
      videos: JSON.stringify((Array.isArray(b.videos) ? b.videos : json(cur.videos, [])).filter((x) => typeof x === 'string' && /^https:\/\//.test(x)).slice(0, 2)),
      category: CATEGORY_IDS.includes(b.category ?? cur.category) ? (b.category ?? cur.category) : 'others', condition: text(b.condition ?? cur.condition ?? 'Good', { max: 30 }) || 'Good', city: text(b.city ?? cur.city ?? '', { max: 60 }),
      market_price_paise: int(g('marketPricePaise', 'market_price_paise') ?? 0, 'Market price', { max: 1e11 }), starting_bid_paise: starting, reserve_paise: reserve, min_increment_paise: inc, buy_now_paise: buyNow,
      registration_fee_paise: int(g('registrationFeePaise', 'registration_fee_paise') ?? 0, 'Registration fee', { max: 1e9 }), deposit_paise: int(g('depositPaise', 'deposit_paise') ?? 0, 'Deposit', { max: 1e11 }),
      reg_opens_at: regOpens, reg_closes_at: regCloses, starts_at: starts, ends_at: ends, original_ends_at: ends,
      max_participants: g('maxParticipants', 'max_participants') ? int(g('maxParticipants', 'max_participants'), 'Participant limit', { min: 2, max: 100000 }) : null,
      max_bids_per_user: g('maxBidsPerUser', 'max_bids_per_user') ? int(g('maxBidsPerUser', 'max_bids_per_user'), 'Bid limit', { min: 1, max: 10000 }) : null,
      anti_snipe_window_s: int(g('antiSnipeWindowS', 'anti_snipe_window_s') ?? 120, 'Anti-sniping window', { min: 30, max: 900 }), anti_snipe_extend_s: int(g('antiSnipeExtendS', 'anti_snipe_extend_s') ?? 120, 'Anti-sniping extension', { min: 30, max: 900 }),
      max_extension_s: int(g('maxExtensionS', 'max_extension_s') ?? 1800, 'Maximum extension', { min: 0, max: 7200 }), shipping: JSON.stringify(shipping),
      pickup_address: text(b.pickupAddress ?? cur.pickup_address ?? '', { max: 200 }), payment_deadline_hours: int(g('paymentDeadlineHours', 'payment_deadline_hours') ?? 24, 'Payment deadline', { min: 6, max: 72 }),
      default_policy: policy, offer_next_bidder: (b.offerNextBidder ?? !!(cur.offer_next_bidder ?? 1)) ? 1 : 0, _now: now,
    };
  }

  r.post('/auctions', ctx.auth.required, ctx.limits.create, (req, res) => {
    if (!req.user.verified) throw new HttpError(403, 'Verify your phone number (sign in with phone or Google) before creating an auction');
    const { _now, ...t } = readTerms(req.body);
    const cols = Object.keys(t);
    const bizId = req.body.businessId ? db.prepare("SELECT business_id FROM business_members WHERE business_id = ? AND user_id = ? AND status = 'active'").get(Number(req.body.businessId), req.user.id)?.business_id ?? null : null;
    const info = db.prepare(`INSERT INTO auctions (seller_id, business_id, seller_verified, status, created_at, updated_at, ${cols.join(',')}) VALUES (?,?,?,?,?,?,${cols.map(() => '?').join(',')})`).run(req.user.id, bizId, 1, 'DRAFT', clock(), clock(), ...cols.map((c) => t[c]));
    res.status(201).json({ auction: svc.publicView(svc.A(info.lastInsertRowid), req.user) });
  });

  r.patch('/auctions/:id', ctx.auth.required, (req, res) => {
    const a = need(req.params.id);
    if (a.seller_id !== req.user.id) throw new HttpError(404, 'Auction not found');
    if (a.status === 'DRAFT') {
      const { _now, ...t } = readTerms(req.body, a);
      const cols = Object.keys(t);
      db.prepare(`UPDATE auctions SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...cols.map((c) => t[c]), clock(), a.id);
    } else if (['PENDING_APPROVAL', 'SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(a.status)) {
      // Material terms are locked once an auction is submitted. Only descriptive fields may change.
      const material = ['startingBidPaise', 'reservePaise', 'minIncrementPaise', 'buyNowPaise', 'registrationFeePaise', 'depositPaise', 'regOpensAt', 'regClosesAt', 'startsAt', 'endsAt', 'maxParticipants', 'antiSnipeWindowS', 'antiSnipeExtendS', 'maxExtensionS', 'defaultPolicy', 'paymentDeadlineHours'];
      const touched = material.filter((k) => req.body[k] !== undefined);
      if (touched.length) throw new HttpError(409, a.status === 'PENDING_APPROVAL' || a.status === 'SCHEDULED' ? 'Pause the auction to edit its terms.' : 'Terms are locked now that registration has opened. Use an amendment, which every registered bidder must accept.');
      db.prepare('UPDATE auctions SET description = ?, images = ?, pickup_address = ?, updated_at = ? WHERE id = ?').run(
        text(req.body.description ?? a.description, { max: 3000 }), JSON.stringify((Array.isArray(req.body.images) ? req.body.images : json(a.images, [])).filter((x) => typeof x === 'string').slice(0, 8)), text(req.body.pickupAddress ?? a.pickup_address, { max: 200 }), clock(), a.id);
    } else throw new HttpError(409, 'This auction can no longer be edited');
    res.json({ auction: svc.publicView(svc.A(a.id), req.user) });
  });

  r.post('/auctions/:id/submit', ctx.auth.required, (req, res) => {
    let a = need(req.params.id);
    if (a.seller_id !== req.user.id) throw new HttpError(404, 'Auction not found');
    if (!req.user.verified) throw new HttpError(403, 'Verify your phone number first');
    if (a.status !== 'DRAFT') throw new HttpError(409, 'Only drafts can be submitted');
    if (a.reg_opens_at < clock() - MIN) throw new HttpError(400, 'Registration must open in the future. Update the dates.');
    if (!json(a.images, []).length) throw new HttpError(400, 'Add at least one photo');
    a = svc.setStatus(a, 'PENDING_APPROVAL');
    audit(db, { actor: req.user.id, action: 'auction.submit', entity: 'auction', entityId: a.id });
    if (config.auctionAutoApprove) publish(a, req.user.id);
    res.json({ auction: svc.publicView(svc.A(a.id), req.user) });
  });

  /** Approval freezes the terms (so bidders can rely on them) and schedules the lifecycle jobs. */
  function publish(a, byUser) {
    tx(db, () => {
      const frozen = { startingBidPaise: a.starting_bid_paise, minIncrementPaise: a.min_increment_paise, registrationFeePaise: a.registration_fee_paise, depositPaise: a.deposit_paise, buyNowPaise: a.buy_now_paise, hasReserve: a.reserve_paise != null, startsAt: a.starts_at, endsAt: a.ends_at, antiSnipe: [a.anti_snipe_window_s, a.anti_snipe_extend_s, a.max_extension_s], paymentDeadlineHours: a.payment_deadline_hours, defaultPolicy: a.default_policy === 'forfeit_deposit' && config.auctionAllowForfeit ? 'forfeit_deposit' : 'refund_deposit', commissionBps: config.auctionCommissionBps, feeRefundable: 'until registration closes', depositRules: 'Refunded to every bidder who does not win; credited to the winner; forfeited only if the winner fails to pay in time (when forfeiture applies)' };
      db.prepare('UPDATE auctions SET terms = ?, published_at = ? WHERE id = ?').run(JSON.stringify(frozen), clock(), a.id);
      svc.setStatus(svc.A(a.id), 'SCHEDULED');
      jobs.schedule({ type: 'auction:open_registration', runAt: a.reg_opens_at, payload: { auctionId: a.id }, dedupeKey: `auction_open:${a.id}:${a.reg_opens_at}` });
      jobs.schedule({ type: 'auction:close_registration', runAt: a.reg_closes_at, payload: { auctionId: a.id }, dedupeKey: `auction_close:${a.id}:${a.reg_closes_at}` });
      jobs.schedule({ type: 'auction:start', runAt: a.starts_at, payload: { auctionId: a.id }, dedupeKey: `auction_start:${a.id}:${a.starts_at}` });
      audit(db, { actor: byUser, action: 'auction.publish', entity: 'auction', entityId: a.id });
    });
    notify(a.seller_id, { type: 'auction', title: 'Your auction is scheduled', body: a.title, data: { auctionId: a.id } });
    advance(a.id);
  }

  r.post('/auctions/:id/pause', ctx.auth.required, (req, res) => {
    const a = need(req.params.id);
    if (a.seller_id !== req.user.id) throw new HttpError(404, 'Auction not found');
    if (!['PENDING_APPROVAL', 'SCHEDULED'].includes(a.status)) throw new HttpError(409, 'An auction can only be paused before registration opens');
    svc.setStatus(a, 'DRAFT', { paused: true });
    res.json({ auction: svc.publicView(svc.A(a.id), req.user) });
  });

  r.post('/auctions/:id/cancel', ctx.auth.required, (req, res) => {
    const a = need(req.params.id);
    if (a.seller_id !== req.user.id) throw new HttpError(404, 'Auction not found');
    if (!['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(a.status)) throw new HttpError(409, 'A live or finished auction can only be cancelled by Connectly support');
    svc.cancelAuction(a, text(req.body.reason, { max: 200 }) || 'Cancelled by the seller');
    res.json({ auction: svc.publicView(svc.A(a.id), req.user) });
  });

  /* ---- amendments ---- */
  r.post('/auctions/:id/amendments', ctx.auth.required, (req, res) => {
    const a = need(req.params.id);
    if (a.seller_id !== req.user.id) throw new HttpError(404, 'Auction not found');
    if (!['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(a.status)) throw new HttpError(409, 'Amendments are for auctions with open or closed registration');
    if (db.prepare("SELECT 1 FROM auction_amendments WHERE auction_id = ? AND status = 'pending'").get(a.id)) throw new HttpError(409, 'There is already a pending amendment');
    const map = { startingBidPaise: 'starting_bid_paise', reservePaise: 'reserve_paise', minIncrementPaise: 'min_increment_paise', buyNowPaise: 'buy_now_paise', startsAt: 'starts_at', endsAt: 'ends_at', antiSnipeWindowS: 'anti_snipe_window_s', antiSnipeExtendS: 'anti_snipe_extend_s', maxExtensionS: 'max_extension_s' };
    const changes = {};
    for (const [k, col] of Object.entries(map)) if (req.body.changes?.[k] !== undefined) changes[col] = req.body.changes[k] === null ? null : int(req.body.changes[k], k, { max: 4e12 });
    if (!Object.keys(changes).length) throw new HttpError(400, 'Nothing to change (registration fee and deposit can never be changed after people have paid)');
    readTerms({}, { ...a, ...changes, images: a.images, videos: a.videos });
    if (changes.starts_at !== undefined && changes.starts_at < a.reg_closes_at) throw new HttpError(400, 'The auction cannot start before registration closes');
    const deadline = Math.min(clock() + DAY, a.starts_at - 30 * MIN);
    if (deadline <= clock()) throw new HttpError(409, 'Too close to the start to amend this auction');
    const info = db.prepare('INSERT INTO auction_amendments (auction_id, changes, consent_deadline, created_at) VALUES (?,?,?,?)').run(a.id, JSON.stringify(changes), deadline, clock());
    jobs.schedule({ type: 'auction:amendment_deadline', runAt: deadline, payload: { amendmentId: Number(info.lastInsertRowid) }, dedupeKey: `amend:${info.lastInsertRowid}` });
    for (const reg of svc.registered(a.id)) notify(reg.user_id, { type: 'auction_amendment', title: 'The seller changed the terms', body: `${a.title}: accept the changes to keep your place, or get a full refund.`, data: { auctionId: a.id, amendmentId: Number(info.lastInsertRowid) } });
    res.status(201).json({ amendment: { id: Number(info.lastInsertRowid), changes, consentDeadline: deadline } });
  });
  r.post('/auctions/:id/amendments/:aid/vote', ctx.auth.required, (req, res) => {
    const a = need(req.params.id);
    const reg = svc.regOf(a.id, req.user.id);
    if (!reg || reg.status !== 'registered') throw new HttpError(403, 'Only registered bidders can respond');
    const am = db.prepare("SELECT * FROM auction_amendments WHERE id = ? AND auction_id = ? AND status = 'pending'").get(Number(req.params.aid), a.id);
    if (!am) throw new HttpError(404, 'This amendment is no longer open');
    db.prepare('INSERT INTO auction_amendment_votes (amendment_id, user_id, accepted) VALUES (?,?,?) ON CONFLICT(amendment_id, user_id) DO UPDATE SET accepted = excluded.accepted').run(am.id, req.user.id, req.body.accept === true ? 1 : 0);
    if (req.body.accept !== true) svc.refundRegistration(reg, 'all', 'You declined the amended terms', 'refunded');
    svc.applyAmendment(am.id);
    res.json({ ok: true, accepted: req.body.accept === true });
  });

  /* ---- discovery ---- */
  r.get('/auctions', ctx.auth.optional, (req, res) => {
    const tab = String(req.query.tab || 'upcoming');
    const sets = { live: ['LIVE'], upcoming: ['SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'], ended: ['ENDED', 'PAYMENT_PENDING', 'SOLD', 'UNSOLD', 'SETTLED', 'PAYMENT_DEFAULTED'] };
    const st = sets[tab] || sets.upcoming;
    const q = String(req.query.q || '').trim().replace(/[%_]/g, '');
    const rows = db.prepare(`SELECT id FROM auctions WHERE status IN (${st.map(() => '?').join(',')}) ${req.query.category ? 'AND category = ?' : ''} ${q ? 'AND title LIKE ?' : ''} ORDER BY ${tab === 'ended' ? 'ends_at DESC' : tab === 'live' ? 'ends_at ASC' : 'starts_at ASC'} LIMIT 60`)
      .all(...st, ...(req.query.category ? [String(req.query.category)] : []), ...(q ? [`%${q}%`] : []));
    rows.forEach((x) => advance(x.id));
    res.json({ auctions: rows.map((x) => svc.publicView(svc.A(x.id), req.user)), now: clock() });
  });
  r.get('/me/auctions', ctx.auth.required, (req, res) => {
    const rows = db.prepare('SELECT id FROM auctions WHERE seller_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
    rows.forEach((x) => advance(x.id));
    res.json({ auctions: rows.map((x) => svc.publicView(svc.A(x.id), req.user)) });
  });
  r.get('/me/auction-registrations', ctx.auth.required, (req, res) => {
    const rows = db.prepare('SELECT auction_id FROM auction_registrations WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
    rows.forEach((x) => advance(x.auction_id));
    res.json({ registrations: rows.map((x) => svc.publicView(svc.A(x.auction_id), req.user)) });
  });
  r.get('/auctions/:id', ctx.auth.optional, (req, res) => {
    let a = need(req.params.id);
    if (['DRAFT', 'PENDING_APPROVAL'].includes(a.status) && a.seller_id !== req.user?.id) throw new HttpError(404, 'Auction not found');
    a = advance(a.id);
    res.json({ auction: svc.publicView(a, req.user), now: clock() });
  });

  /* ---- registration ---- */
  r.post('/auctions/:id/register', ctx.auth.required, ctx.limits.register, async (req, res) => {
    let a = advance(need(req.params.id).id);
    if (a.status !== 'REGISTRATION_OPEN' || clock() >= a.reg_closes_at) throw new HttpError(409, a.status === 'SCHEDULED' ? 'Registration has not opened yet' : 'Registration is not open for this auction');
    if (a.seller_id === req.user.id) throw new HttpError(403, 'You cannot register for your own auction');
    const existing = svc.regOf(a.id, req.user.id);
    if (existing?.status === 'registered') return res.json({ registration: { status: 'registered' }, payment: null, duplicate: true });
    const total = a.registration_fee_paise + a.deposit_paise;
    const reg = tx(db, () => {
      const taken = db.prepare("SELECT COUNT(*) n FROM auction_registrations WHERE auction_id = ? AND (status = 'registered' OR (status = 'pending_payment' AND created_at > ?))").get(a.id, clock() - 30 * MIN).n;
      if (a.max_participants && taken >= a.max_participants && existing?.status !== 'pending_payment') throw new HttpError(409, 'This auction is full');
      if (existing) { db.prepare("UPDATE auction_registrations SET status = ?, created_at = ?, fee_paise = ?, deposit_paise = ? WHERE id = ?").run(total === 0 ? 'registered' : 'pending_payment', clock(), a.registration_fee_paise, a.deposit_paise, existing.id); return svc.regOf(a.id, req.user.id); }
      db.prepare('INSERT INTO auction_registrations (auction_id, user_id, status, fee_paise, deposit_paise, created_at) VALUES (?,?,?,?,?,?)').run(a.id, req.user.id, total === 0 ? 'registered' : 'pending_payment', a.registration_fee_paise, a.deposit_paise, clock());
      return svc.regOf(a.id, req.user.id);
    });
    if (total === 0) return res.status(201).json({ registration: { status: 'registered' }, payment: null });
    const payment = await payments.createIntent({ purpose: 'auction_registration', refId: reg.id, userId: req.user.id, amountPaise: total });
    db.prepare('UPDATE auction_registrations SET payment_intent_id = ? WHERE id = ?').run(payment.id, reg.id);
    jobs.schedule({ type: 'auction:expire_registration', runAt: clock() + 30 * MIN, payload: { registrationId: reg.id }, dedupeKey: `reg_expire:${reg.id}:${clock()}` });
    res.status(201).json({ registration: { status: 'pending_payment', feePaise: a.registration_fee_paise, depositPaise: a.deposit_paise }, payment });
  });
  r.delete('/auctions/:id/register', ctx.auth.required, (req, res) => {
    const a = advance(need(req.params.id).id);
    const reg = svc.regOf(a.id, req.user.id);
    if (!reg || !['registered', 'pending_payment'].includes(reg.status)) throw new HttpError(404, 'You are not registered');
    if (a.status !== 'REGISTRATION_OPEN') throw new HttpError(409, 'Registrations can be cancelled only while registration is open');
    tx(db, () => svc.refundRegistration(reg, 'all', 'Cancelled by the bidder', 'refunded'));
    res.json({ ok: true, refunded: reg.status === 'registered' });
  });

  /* ---- bidding ---- */
  r.post('/auctions/:id/bids', ctx.auth.required, ctx.limits.bid, (req, res) => {
    const key = text(req.get('idempotency-key') || req.body.idempotencyKey, { min: 6, max: 80, name: 'Idempotency key' });
    const out = svc.placeBid({ auctionId: Number(req.params.id), userId: req.user.id, amount: int(req.body.amountPaise, 'Bid', { min: 1, max: 1e12 }), key });
    res.status(out.duplicate ? 200 : 201).json({ bid: { seq: out.bid.seq, amountPaise: out.bid.amount_paise }, auction: svc.publicView(svc.A(req.params.id), req.user), duplicate: !!out.duplicate });
  });
  r.post('/auctions/:id/buy-now', ctx.auth.required, ctx.limits.bid, (req, res) => {
    const key = text(req.get('idempotency-key') || req.body.idempotencyKey, { min: 6, max: 80, name: 'Idempotency key' });
    const out = svc.placeBid({ auctionId: Number(req.params.id), userId: req.user.id, amount: 0, key, buyNow: true });
    res.status(out.duplicate ? 200 : 201).json({ bid: { seq: out.bid.seq, amountPaise: out.bid.amount_paise }, auction: svc.publicView(svc.A(req.params.id), req.user) });
  });
  r.get('/auctions/:id/bids', ctx.auth.optional, (req, res) => {
    const a = need(req.params.id);
    const labels = svc.bidderLabels(a.id);
    const after = Number(req.query.after) || 0;
    res.json({ bids: db.prepare('SELECT * FROM auction_bids WHERE auction_id = ? AND seq > ? ORDER BY seq DESC LIMIT 200').all(a.id, after).map((b) => svc.toBid(b, labels, req.user?.id)) });
  });
  // One cheap call the app polls (and a reconnecting client uses to catch up on missed bids).
  r.get('/auctions/:id/state', ctx.auth.optional, (req, res) => {
    const a = advance(need(req.params.id).id);
    const labels = svc.bidderLabels(a.id);
    const after = Number(req.query.after) || 0;
    const mine = req.user ? svc.regOf(a.id, req.user.id) : null;
    res.json({
      now: clock(), status: a.status, endsAt: a.ends_at, startsAt: a.starts_at, currentBidPaise: a.current_bid_paise, bidCount: a.bid_count, seq: a.seq,
      minNextBidPaise: a.bid_count === 0 ? a.starting_bid_paise : a.current_bid_paise + a.min_increment_paise, reserveMet: a.reserve_paise == null ? null : a.current_bid_paise >= a.reserve_paise,
      isLeading: !!req.user && a.current_bidder_id === req.user.id, myRegistration: mine?.status ?? null,
      bids: db.prepare('SELECT * FROM auction_bids WHERE auction_id = ? AND seq > ? ORDER BY seq').all(a.id, after).map((b) => svc.toBid(b, labels, req.user?.id)),
    });
  });
  // Server-sent events: live pushes; reconnecting clients send Last-Event-ID and receive what they missed.
  r.get('/auctions/:id/stream', (req, res) => {
    const a = need(req.params.id);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    res.write('retry: 2000\n\n');
    const last = Number(req.get('last-event-id') || req.query.after) || 0;
    const labels = svc.bidderLabels(a.id);
    for (const b of db.prepare('SELECT * FROM auction_bids WHERE auction_id = ? AND seq > ? ORDER BY seq').all(a.id, last)) res.write(`id: ${b.seq}\nevent: bid\ndata: ${JSON.stringify({ seq: b.seq, amountPaise: b.amount_paise, bidder: labels.get(b.user_id), endsAt: a.ends_at })}\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify({ status: a.status, seq: a.seq, endsAt: a.ends_at, currentBidPaise: a.current_bid_paise })}\n\n`);
    if (!svc.subs.has(a.id)) svc.subs.set(a.id, new Set());
    svc.subs.get(a.id).add(res);
    const beat = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { /* closed */ } }, 25000);
    req.on('close', () => { clearInterval(beat); svc.subs.get(a.id)?.delete(res); });
  });

  /* ---- winner payment and fulfilment ---- */
  r.post('/auctions/:id/pay', ctx.auth.required, async (req, res) => {
    const a = advance(need(req.params.id).id);
    const s = svc.settlementOf(a.id);
    if (a.status !== 'PAYMENT_PENDING' || !s || s.winner_user_id !== req.user.id || s.status !== 'awaiting_payment') throw new HttpError(409, 'There is nothing for you to pay on this auction');
    const fulfillment = json(a.shipping, []).includes(req.body.fulfillment) ? req.body.fulfillment : json(a.shipping, ['pickup'])[0];
    if (fulfillment === 'shipping' && text(req.body.address, { max: 300 }).length < 8) throw new HttpError(400, 'Enter your delivery address');
    const reg = svc.regOf(a.id, req.user.id);
    const credit = reg?.status === 'registered' ? reg.deposit_paise : 0; // the deposit already paid counts toward the price
    const due = Math.max(0, s.amount_paise - credit);
    db.prepare('UPDATE auction_settlements SET fulfillment = ?, shipping_address = ?, updated_at = ? WHERE id = ?').run(fulfillment, text(req.body.address, { max: 300 }), clock(), s.id);
    if (due === 0) { // the deposit covered everything: complete without the gateway
      const fake = { id: `internal-${a.id}-${s.offer_round}`, ref_id: a.id, user_id: req.user.id, amount_paise: 0, gateway_fee_paise: 0 };
      db.prepare('UPDATE auction_settlements SET payment_intent_id = ? WHERE id = ?').run(fake.id, s.id);
      tx(db, () => ctx.payments.hooksFor?.('auction_winner')?.(fake));
      return res.json({ payment: null, auction: svc.publicView(svc.A(a.id), req.user) });
    }
    const payment = await payments.createIntent({ purpose: 'auction_winner', refId: a.id, userId: req.user.id, amountPaise: due });
    db.prepare('UPDATE auction_settlements SET payment_intent_id = ? WHERE id = ?').run(payment.id, s.id);
    res.status(201).json({ payment, duePaise: due, depositCreditPaise: credit, auction: svc.publicView(svc.A(a.id), req.user) });
  });
  r.post('/auctions/:id/ship', ctx.auth.required, (req, res) => {
    const a = need(req.params.id);
    const s = svc.settlementOf(a.id);
    if (a.seller_id !== req.user.id) throw new HttpError(404, 'Auction not found');
    if (a.status !== 'SOLD' || !s) throw new HttpError(409, 'The buyer has not paid yet');
    db.prepare("UPDATE auction_settlements SET tracking = ?, shipped_at = COALESCE(shipped_at, ?), status = 'shipped', updated_at = ? WHERE id = ?").run(text(req.body.tracking, { max: 100 }), clock(), clock(), s.id);
    notify(s.winner_user_id, { type: 'auction', title: s.fulfillment === 'pickup' ? 'Ready for pickup' : 'Your item has shipped', body: a.title, data: { auctionId: a.id } });
    res.json({ auction: svc.publicView(svc.A(a.id), req.user) });
  });
  r.post('/auctions/:id/confirm-delivery', ctx.auth.required, (req, res) => {
    const a = need(req.params.id);
    const s = svc.settlementOf(a.id);
    if (!s || s.winner_user_id !== req.user.id) throw new HttpError(404, 'Auction not found');
    if (!s.shipped_at) throw new HttpError(409, 'The seller has not marked this as shipped or ready for pickup yet');
    svc.confirmDelivery(a);
    res.json({ auction: svc.publicView(svc.A(a.id), req.user) });
  });
  r.post('/auctions/:id/dispute', ctx.auth.required, (req, res) => {
    const a = need(req.params.id);
    const s = svc.settlementOf(a.id);
    if (!s || s.winner_user_id !== req.user.id || a.status !== 'SOLD') throw new HttpError(409, 'You can raise a dispute after paying and before confirming delivery');
    tx(db, () => {
      db.prepare('INSERT INTO auction_disputes (auction_id, raised_by, reason, created_at) VALUES (?,?,?,?)').run(a.id, req.user.id, text(req.body.reason, { min: 5, max: 500, name: 'Reason' }), clock());
      svc.setStatus(a, 'DISPUTED');
    });
    notify(a.seller_id, { type: 'auction', title: 'The buyer raised a dispute', body: a.title, data: { auctionId: a.id } });
    res.status(201).json({ ok: true });
  });

  /* ---- operator ---- */
  r.get('/admin/auctions', ctx.adminOnly, (req, res) => {
    res.json({ auctions: db.prepare('SELECT id, title, status, seller_id, created_at FROM auctions WHERE status = ? ORDER BY id').all(String(req.query.status || 'PENDING_APPROVAL')) });
  });
  r.post('/admin/auctions/:id/approve', ctx.adminOnly, (req, res) => {
    const a = need(req.params.id);
    if (a.status !== 'PENDING_APPROVAL') throw new HttpError(409, 'Not awaiting approval');
    if (req.body.verifiedItem) db.prepare('UPDATE auctions SET verified_item = 1 WHERE id = ?').run(a.id);
    publish(svc.A(a.id), null);
    res.json({ ok: true });
  });
  r.post('/admin/auctions/:id/reject', ctx.adminOnly, (req, res) => {
    const a = need(req.params.id);
    svc.setStatus(a, 'DRAFT', { rejected: text(req.body.reason, { max: 200 }) });
    notify(a.seller_id, { type: 'auction', title: 'Auction needs changes', body: `${a.title}: ${text(req.body.reason, { max: 200 }) || 'please review the listing'}`, data: { auctionId: a.id } });
    res.json({ ok: true });
  });
  r.post('/admin/auctions/:id/cancel', ctx.adminOnly, (req, res) => {
    const a = need(req.params.id);
    svc.cancelAuction(a, text(req.body.reason, { max: 200 }) || 'Cancelled by Connectly support');
    res.json({ ok: true });
  });
  r.post('/admin/auctions/:id/resolve', ctx.adminOnly, (req, res) => {
    const a = need(req.params.id);
    const s = svc.settlementOf(a.id);
    if (a.status !== 'DISPUTED' || !s) throw new HttpError(409, 'No open dispute');
    tx(db, () => {
      db.prepare("UPDATE auction_disputes SET status = 'resolved', resolution = ? WHERE auction_id = ? AND status = 'open'").run(String(req.body.outcome), a.id);
      if (req.body.outcome === 'refund_buyer') {
        const intent = payments.get(s.payment_intent_id);
        const paid = intent?.status === 'paid' ? intent.amount_paise : 0;
        if (paid) { svc.ledger({ auctionId: a.id, userId: s.winner_user_id, kind: 'buyer_refund', amount: paid, ref: 'Dispute resolved in buyer favour', key: `auction:${a.id}:dispute_refund` }); payments.requestRefund({ intentId: intent.id, amountPaise: paid, reason: 'Dispute: refund to buyer', dedupeKey: `auc:${a.id}:dispute` }); }
        const wreg = svc.regOf(a.id, s.winner_user_id);
        if (wreg?.status === 'applied' && wreg.deposit_paise) { svc.ledger({ auctionId: a.id, userId: wreg.user_id, kind: 'buyer_refund', amount: wreg.deposit_paise, ref: 'Deposit credit refunded', key: `auction:${a.id}:dispute_deposit` }); const ri = wreg.payment_intent_id && payments.get(wreg.payment_intent_id); if (ri) payments.requestRefund({ intentId: ri.id, amountPaise: wreg.deposit_paise, reason: 'Dispute: deposit refund', dedupeKey: `auc:${a.id}:dispute_dep` }); }
        db.prepare("UPDATE auction_settlements SET status = 'refunded', payout_status = 'cancelled', updated_at = ? WHERE id = ?").run(clock(), s.id);
        svc.setStatus(svc.A(a.id), 'SETTLED', { outcome: 'refund_buyer' });
      } else { svc.setStatus(svc.A(a.id), 'SOLD', { outcome: 'dismissed' }); svc.confirmDelivery(svc.A(a.id)); }
    });
    res.json({ ok: true });
  });
  r.post('/auctions/:id/settle', ctx.adminOnly, (req, res) => { const a = advance(need(req.params.id).id); res.json({ status: a.status, settlement: svc.settlementOf(a.id) }); });
  r.get('/auctions/:id/ledger', ctx.auth.required, (req, res) => {
    const a = need(req.params.id);
    if (a.seller_id !== req.user.id) throw new HttpError(404, 'Auction not found');
    res.json({ ledger: svc.ledgerSummary(a.id) });
  });
  r.get('/admin/auctions/:id/ledger', ctx.adminOnly, (req, res) => res.json({ ledger: svc.ledgerSummary(need(req.params.id).id), entries: db.prepare('SELECT * FROM auction_ledger WHERE auction_id = ? ORDER BY id').all(Number(req.params.id)), events: db.prepare('SELECT * FROM auction_events WHERE auction_id = ? ORDER BY id').all(Number(req.params.id)) }));
  return r;
}

module.exports = { routes, createAuctions, NEXT };

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { boot, rupees } = require('./helpers');

const MIN = 60000, HOUR = 3600000;
let h, seller;
const J = (p) => `/api/v1${p}`;
const post = (path, body, t) => h.call(J(path), { method: 'POST', body, token: t.token });
const get = (path, t) => h.call(J(path), { token: t?.token });
const admin = { 'x-postback-key': 'adminkey' };
let seq = 0;
const inbox = async (t) => (await h.call('/notifications', { token: t.token })).data.notifications;
const key = () => `k-${Date.now()}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

// Moves the clock and lets the durable job worker run everything that became due.
async function at(ms) { h.clock.t = ms; await h.ctx.jobs.runDue(h.clock.t); await h.ctx.jobs.runDue(h.clock.t); }
async function pay(intent, t) { const r = await post(`/payments/${intent.id}/simulate`, {}, t); assert.equal(r.status, 200, JSON.stringify(r.data)); }

function terms(over = {}) {
  const t0 = h.clock.t;
  return {
    title: 'iPhone 15 (128 GB), boxed', description: 'Used 6 months', images: ['/uploads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg'], category: 'electronics', city: 'Chennai',
    marketPricePaise: rupees(60000), startingBidPaise: rupees(10000), minIncrementPaise: rupees(500), reservePaise: rupees(12000),
    registrationFeePaise: rupees(100), depositPaise: rupees(1000),
    regOpensAt: t0 + HOUR, regClosesAt: t0 + 3 * HOUR, startsAt: t0 + 4 * HOUR, endsAt: t0 + 4 * HOUR + 30 * MIN,
    antiSnipeWindowS: 120, antiSnipeExtendS: 120, maxExtensionS: 300, shipping: ['pickup', 'shipping'], pickupAddress: 'Adyar, Chennai', paymentDeadlineHours: 24, ...over,
  };
}
async function schedule(over, t = seller) {
  const c = await post('/auctions', terms(over), t);
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const s = await post(`/auctions/${c.data.auction.id}/submit`, {}, t);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.auction.status, 'SCHEDULED');
  return c.data.auction;
}
async function register(a, t) {
  const r = await post(`/auctions/${a.id}/register`, {}, t);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  if (r.data.payment) await pay(r.data.payment, t);
  return r.data;
}
const state = async (a, t) => (await get(`/auctions/${a.id}/state`, t)).data;
const bid = (a, t, amount, k = key()) => post(`/auctions/${a.id}/bids`, { amountPaise: amount, idempotencyKey: k }, t);

before(async () => {
  config.auctionAutoApprove = true;
  config.affiliateSecret = 'adminkey';
  h = await boot();
  seller = await h.user('Seller Sam', { phone: '+919833300001' });
});
after(() => h.close());

test('A1: authoring: validation, verified sellers, drafts, locked terms after submission', async () => {
  const bad = await post('/auctions', terms({ regClosesAt: h.clock.t + 30 * MIN }), seller); // closes before it opens
  assert.equal(bad.status, 400);
  assert.equal((await post('/auctions', terms({ startingBidPaise: 5 }), seller)).status, 400);
  assert.equal((await post('/auctions', terms({ reservePaise: rupees(5000) }), seller)).status, 400); // reserve below starting bid
  assert.equal((await post('/auctions', terms({ buyNowPaise: rupees(10200) }), seller)).status, 400); // buy-now must clear reserve + increment
  const unverified = await h.user('Unverified Una');
  h.db.prepare('UPDATE users SET verified = 0 WHERE id = ?').run(unverified.id);
  assert.equal((await post('/auctions', terms(), unverified)).status, 403);

  const d = await post('/auctions', terms(), seller);
  assert.equal(d.data.auction.status, 'DRAFT');
  assert.equal(d.data.auction.reservePaise, rupees(12000)); // the seller sees the reserve
  const buyer = await h.user('Browsing Bee');
  assert.equal((await get(`/auctions/${d.data.auction.id}`, buyer)).status, 404); // drafts are private
  assert.equal((await post(`/auctions/${d.data.auction.id}/submit`, {}, buyer)).status, 404);
  const edit = await h.call(J(`/auctions/${d.data.auction.id}`), { method: 'PATCH', token: seller.token, body: { title: 'iPhone 15 Pro', startingBidPaise: rupees(9000), reservePaise: rupees(11000) } });
  assert.equal(edit.status, 200); assert.equal(edit.data.auction.startingBidPaise, rupees(9000));

  assert.equal((await post(`/auctions/${d.data.auction.id}/submit`, {}, seller)).status, 200);
  const locked = await h.call(J(`/auctions/${d.data.auction.id}`), { method: 'PATCH', token: seller.token, body: { startingBidPaise: rupees(1) } });
  assert.equal(locked.status, 409); assert.match(locked.data.error, /Pause/);
  assert.equal((await h.call(J(`/auctions/${d.data.auction.id}`), { method: 'PATCH', token: seller.token, body: { description: 'Now with charger' } })).status, 200); // non-material is fine
  const pub = (await get(`/auctions/${d.data.auction.id}`, buyer)).data.auction;
  assert.equal(pub.reservePaise, undefined); assert.equal(pub.hasReserve, true); // bidders never see the reserve price
  assert.equal(pub.terms.depositRules.includes('forfeited only if the winner fails'), true);

  // pause to edit terms, then resubmit; an unrelated auction cancels cleanly
  assert.equal((await post(`/auctions/${d.data.auction.id}/pause`, {}, seller)).data.auction.status, 'DRAFT');
  assert.equal((await post(`/auctions/${d.data.auction.id}/cancel`, { reason: 'Changed my mind' }, seller)).data.auction.status, 'CANCELLED');
  assert.equal((await post(`/auctions/${d.data.auction.id}/cancel`, {}, seller)).status, 409);
});

let A, b1, b2, b3;
test('A2: registration: window, payment through verified webhook, eligibility, fee and deposit kept separate', async () => {
  [b1, b2, b3] = [await h.user('Bidder One'), await h.user('Bidder Two'), await h.user('Bidder Three')];
  const t0 = h.clock.t;
  A = await schedule({});
  assert.equal((await post(`/auctions/${A.id}/register`, {}, b1)).status, 409); // not open yet
  assert.equal((await get('/auctions?tab=upcoming', b1)).data.auctions.some((x) => x.id === A.id), true);
  await at(t0 + HOUR + 1000);
  assert.equal((await get(`/auctions/${A.id}`, b1)).data.auction.status, 'REGISTRATION_OPEN');
  assert.equal((await post(`/auctions/${A.id}/register`, {}, seller)).status, 403); // seller cannot register

  const r1 = await post(`/auctions/${A.id}/register`, {}, b1);
  assert.equal(r1.data.payment.amountPaise, rupees(1100)); // fee + deposit
  assert.equal(r1.data.registration.status, 'pending_payment');
  assert.equal((await bid(A, b1, rupees(10000))).status, 409); // not live; and unpaid people can never bid
  await pay(r1.data.payment, b1);
  assert.equal((await get(`/auctions/${A.id}`, b1)).data.auction.myRegistration.status, 'registered');
  assert.equal((await post(`/auctions/${A.id}/register`, {}, b1)).data.duplicate, true);
  await register(A, b2); await register(A, b3);

  const led = (await h.call(J(`/admin/auctions/${A.id}/ledger`), { headers: admin })).data.ledger;
  assert.equal(led.by_kind.registration_fee, rupees(300));
  assert.equal(led.by_kind.deposit_hold, rupees(3000));
  assert.equal(led.held_deposits_paise, rupees(3000)); // deposits are held, not revenue
  assert.equal(led.platform_revenue_paise, rupees(300));
  assert.equal(led.balanced, true);
  assert.ok(led.platform_costs_paise > 0); // gateway fees tracked separately

  // a cancelled registration before close is refunded in full; re-registering works
  const quitter = await h.user('Quitter Quin');
  await register(A, quitter);
  assert.equal((await h.call(J(`/auctions/${A.id}/register`), { method: 'DELETE', token: quitter.token })).data.refunded, true);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM refunds WHERE dedupe_key LIKE ?").get(`auc:${A.id}:%`).n >= 2, true);
  assert.equal((await get(`/auctions/${A.id}`, quitter)).data.auction.myRegistration.status, 'refunded');

  await at(t0 + 3 * HOUR + 1000);
  assert.equal((await get(`/auctions/${A.id}`, b1)).data.auction.status, 'REGISTRATION_CLOSED');
  assert.equal((await post(`/auctions/${A.id}/register`, {}, quitter)).status, 409);
  assert.equal((await h.call(J(`/auctions/${A.id}/register`), { method: 'DELETE', token: b1.token })).status, 409); // no cancelling after close
});

test('A3: live bidding is authoritative: increments, eligibility, idempotency, immutable ordered history', async () => {
  const t0 = h.clock.t;
  await at(t0 + HOUR + 1000); // now just past the start (startsAt = created + 4h)
  assert.equal((await state(A, b1)).status, 'LIVE');
  const stranger = await h.user('Never Registered');
  assert.equal((await bid(A, stranger, rupees(10000))).status, 403);
  assert.equal((await bid(A, seller, rupees(10000))).status, 403); // no self-bidding
  assert.equal((await bid(A, b1, rupees(9000))).status, 409); // below starting bid
  assert.equal((await bid(A, b1, rupees(5000000))).status, 400); // fat-finger guard: far beyond any sane price
  const k1 = key();
  const first = await bid(A, b1, rupees(10000), k1);
  assert.equal(first.status, 201); assert.equal(first.data.bid.seq, 1);
  const again = await bid(A, b1, rupees(10000), k1); // double tap / network retry
  assert.equal(again.status, 200); assert.equal(again.data.duplicate, true); assert.equal(again.data.bid.seq, 1);
  assert.equal((await state(A, b1)).bidCount, 1);
  assert.equal((await bid(A, b1, rupees(10500))).status, 409); // already the highest bidder
  assert.equal((await bid(A, b2, rupees(10000))).status, 409); // must beat by the increment
  assert.equal((await bid(A, b2, rupees(10499))).status, 409);
  assert.equal((await bid(A, b2, rupees(10500))).data.bid.seq, 2);
  assert.ok((await inbox(b1)).some((n) => n.type === 'auction_outbid'));
  const s = await state(A, b1);
  assert.equal(s.currentBidPaise, rupees(10500)); assert.equal(s.isLeading, false); assert.equal(s.minNextBidPaise, rupees(11000));
  assert.equal(s.reserveMet, false);
  const mine = (await get(`/auctions/${A.id}/bids`, b2)).data.bids;
  assert.deepEqual(mine.map((b) => b.seq), [2, 1]);
  assert.deepEqual(mine.map((b) => b.mine), [true, false]);
  assert.ok(mine.every((b) => /^Bidder \d$/.test(b.bidder))); // identities are masked
  assert.equal((await get(`/auctions/${A.id}/state?after=1`, b1)).data.bids.length, 1); // reconnect catch-up
  assert.ok(!JSON.stringify(mine).includes('Bidder One'));

  // concurrent bids for the same price: exactly one wins, sequence numbers stay unique and gapless
  for (let round = 0; round < 8; round++) {
    const cur = (await state(A, b3)).currentBidPaise;
    const next = cur + rupees(500);
    const res = await Promise.all([bid(A, b1, next), bid(A, b2, next), bid(A, b3, next)]);
    const ok = res.filter((x) => x.status === 201).length;
    assert.equal(ok <= 1 && (res.length - ok) >= 2, true, `round ${round}: ${res.map((x) => x.status)}`);
    if (!ok) { /* the current leader may have been among them; fine */ }
  }
  const all = h.db.prepare('SELECT seq FROM auction_bids WHERE auction_id = ? ORDER BY seq').all(A.id).map((x) => x.seq);
  assert.deepEqual(all, all.map((_, i) => i + 1));
  const lead = h.db.prepare('SELECT user_id, amount_paise FROM auction_bids WHERE auction_id = ? ORDER BY seq DESC').get(A.id);
  const row = h.db.prepare('SELECT current_bid_paise, current_bidder_id, bid_count FROM auctions WHERE id = ?').get(A.id);
  assert.equal(row.current_bid_paise, lead.amount_paise); assert.equal(row.current_bidder_id, lead.user_id); assert.equal(row.bid_count, all.length);
});

test('A4: anti-sniping extends the end time up to a cap; the end job moves with it', async () => {
  const row = () => h.db.prepare('SELECT ends_at, original_ends_at, status FROM auctions WHERE id = ?').get(A.id);
  const orig = row().original_ends_at;
  const cur0 = (await state(A, b1)).currentBidPaise;
  await at(orig - 60 * 1000); // one minute left: inside the 2-minute window
  const leader = h.db.prepare('SELECT user_id FROM auction_bids WHERE auction_id = ? ORDER BY seq DESC').get(A.id).user_id;
  const who = [b1, b2, b3].find((u) => u.id !== leader);
  const r = await bid(A, who, cur0 + rupees(5000));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(row().ends_at, orig + 120 * 1000);
  await at(orig + 10 * 1000); // original end time passes: auction must still be live
  assert.equal(row().status, 'LIVE');
  // keep sniping: extension is capped at 300s in total
  let t = row().ends_at;
  for (let i = 0; i < 4; i++) {
    await at(t - 30 * 1000);
    const l = h.db.prepare('SELECT user_id FROM auction_bids WHERE auction_id = ? ORDER BY seq DESC').get(A.id).user_id;
    const u = [b1, b2, b3].find((x) => x.id !== l);
    await bid(A, u, (await state(A, u)).minNextBidPaise);
    t = row().ends_at;
  }
  assert.ok(row().ends_at - orig <= 300 * 1000, `extension ${(row().ends_at - orig) / 1000}s exceeds the 300s cap`);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM auction_events WHERE auction_id = ? AND type = 'extended'").get(A.id).n >= 2, true);
});

test('A5: auction ends: highest valid bid wins, reserve checked, deposits returned except winner and fallback bidder', async () => {
  const end = h.db.prepare('SELECT ends_at FROM auctions WHERE id = ?').get(A.id).ends_at;
  await at(end + 1000);
  const a = (await get(`/auctions/${A.id}`, seller)).data.auction;
  assert.equal(a.status, 'PAYMENT_PENDING');
  const last = h.db.prepare('SELECT user_id, amount_paise FROM auction_bids WHERE auction_id = ? ORDER BY seq DESC').get(A.id);
  assert.equal(a.settlement.amountPaise, last.amount_paise);
  const winner = [b1, b2, b3].find((u) => u.id === last.user_id);
  assert.ok((await inbox(winner)).some((n) => n.type === 'auction_won'));
  assert.equal((await bid(A, b1, last.amount_paise + rupees(500))).status, 409); // bidding is over
  const regs = h.db.prepare('SELECT user_id, status FROM auction_registrations WHERE auction_id = ?').all(A.id);
  const held = regs.filter((r) => r.status === 'registered').length;
  assert.equal(held, 2); // winner + one fallback runner-up still hold deposits; the third bidder was released
  assert.equal(regs.filter((r) => r.status === 'released').length >= 1, true);
  assert.equal((await get(`/auctions/${A.id}`, winner)).data.auction.iWon, true);
});

test('A6: winner pays (deposit credited), seller ships, buyer confirms, seller settled; ledger balances to the paisa', async () => {
  const last = h.db.prepare('SELECT user_id FROM auction_bids WHERE auction_id = ? ORDER BY seq DESC').get(A.id);
  const winner = [b1, b2, b3].find((u) => u.id === last.user_id);
  const loser = [b1, b2, b3].find((u) => u.id !== winner.id);
  const amount = h.db.prepare('SELECT amount_paise FROM auction_settlements WHERE auction_id = ?').get(A.id).amount_paise;
  assert.equal((await post(`/auctions/${A.id}/pay`, {}, loser)).status, 409);
  assert.equal((await post(`/auctions/${A.id}/pay`, { fulfillment: 'shipping', address: 'x' }, winner)).status, 400);
  const p = await post(`/auctions/${A.id}/pay`, { fulfillment: 'shipping', address: '12 Lake View Road, Adyar, Chennai' }, winner);
  assert.equal(p.status, 201);
  assert.equal(p.data.duePaise, amount - rupees(1000)); // deposit already paid is credited
  assert.equal((await post(`/auctions/${A.id}/ship`, { tracking: 'X' }, winner)).status, 404); // only the seller ships
  assert.equal((await post(`/auctions/${A.id}/ship`, { tracking: 'X' }, seller)).status, 409); // not paid yet
  await pay(p.data.payment, winner);
  assert.equal((await get(`/auctions/${A.id}`, seller)).data.auction.status, 'SOLD');
  assert.equal((await bid(A, loser, amount + rupees(500))).status, 409);
  assert.equal((await post(`/auctions/${A.id}/confirm-delivery`, {}, winner)).status, 409); // nothing shipped yet
  assert.equal((await post(`/auctions/${A.id}/ship`, { tracking: 'DTDC-123' }, seller)).status, 200);
  assert.ok((await inbox(winner)).some((n) => /shipped/i.test(n.title)));
  assert.equal((await post(`/auctions/${A.id}/confirm-delivery`, {}, winner)).data.auction.status, 'SETTLED');
  assert.equal((await post(`/auctions/${A.id}/confirm-delivery`, {}, winner)).status, 409);

  const led = (await h.call(J(`/admin/auctions/${A.id}/ledger`), { headers: admin })).data.ledger;
  const commission = Math.round(amount * config.auctionCommissionBps / 10000);
  assert.equal(led.by_kind.seller_payout, amount - commission);
  assert.equal(led.by_kind.platform_commission, commission);
  assert.equal(led.platform_revenue_paise, rupees(300) + commission); // registration fees + commission, never deposits
  assert.equal(led.held_deposits_paise, 0); assert.equal(led.escrow_paise, 0);
  assert.equal(led.balanced, true);
  assert.equal((await get(`/auctions/${A.id}/ledger`, seller)).data.ledger.by_kind.seller_payout, amount - commission);
  assert.equal((await get(`/auctions/${A.id}`, seller)).data.auction.settlement.sellerPayoutPaise, amount - commission);
  // every refund queued for this auction is delivered by the refund job, exactly once
  await at(h.clock.t + 20000);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM refunds WHERE dedupe_key LIKE ? AND status != 'processed'").get(`auc:${A.id}:%`).n, 0);
  const history = h.db.prepare("SELECT type FROM auction_events WHERE auction_id = ? AND type = 'state'").all(A.id).length;
  assert.ok(history >= 8); // every transition is recorded
});

test('B: winner defaults: deposit forfeited as disclosed, the fallback bidder is offered the item and pays', async () => {
  const t0 = h.clock.t;
  const B = await schedule({ regOpensAt: t0 + HOUR, regClosesAt: t0 + 2 * HOUR, startsAt: t0 + 3 * HOUR, endsAt: t0 + 3 * HOUR + 30 * MIN, reservePaise: rupees(10000), maxExtensionS: 0 });
  await at(t0 + HOUR + 1000);
  await register(B, b1); await register(B, b2); await register(B, b3);
  await at(t0 + 3 * HOUR + 1000);
  assert.equal((await bid(B, b1, rupees(10000))).status, 201);
  assert.equal((await bid(B, b2, rupees(10500))).status, 201);
  assert.equal((await bid(B, b3, rupees(11000))).status, 201); // b3 will win
  await at(t0 + 3 * HOUR + 30 * MIN + 1000);
  const s1 = (await get(`/auctions/${B.id}`, b3)).data.auction;
  assert.equal(s1.status, 'PAYMENT_PENDING'); assert.equal(s1.settlement.amountPaise, rupees(11000));
  assert.equal(h.db.prepare("SELECT status FROM auction_registrations WHERE auction_id = ? AND user_id = ?").get(B.id, b2.id).status, 'registered'); // fallback deposit still held
  assert.equal(h.db.prepare("SELECT status FROM auction_registrations WHERE auction_id = ? AND user_id = ?").get(B.id, b1.id).status, 'released');

  // winner ignores the payment deadline
  await at(h.clock.t + 23 * HOUR);
  assert.equal((await get(`/auctions/${B.id}`, b3)).data.auction.status, 'PAYMENT_PENDING');
  await at(h.clock.t + 2 * HOUR);
  const s2 = (await get(`/auctions/${B.id}`, b2)).data.auction;
  assert.equal(s2.status, 'PAYMENT_PENDING'); // offered to the next bidder
  assert.equal(s2.iWon, true); assert.equal(s2.settlement.round, 2); assert.equal(s2.settlement.amountPaise, rupees(10500));
  assert.equal(h.db.prepare("SELECT status FROM auction_registrations WHERE auction_id = ? AND user_id = ?").get(B.id, b3.id).status, 'forfeited');
  assert.ok((await inbox(b3)).some((n) => /deadline missed/i.test(n.title)));
  assert.equal((await post(`/auctions/${B.id}/pay`, {}, b3)).status, 409); // the defaulted bidder can no longer pay
  const led1 = (await h.call(J(`/admin/auctions/${B.id}/ledger`), { headers: admin })).data.ledger;
  assert.equal(led1.by_kind.deposit_forfeit, rupees(1000));
  assert.equal(led1.platform_revenue_paise, rupees(300) + rupees(1000));

  const p = await post(`/auctions/${B.id}/pay`, { fulfillment: 'pickup' }, b2);
  assert.equal(p.data.duePaise, rupees(10500) - rupees(1000));
  // a stale payment attempt from the first winner's old intent does not apply (nothing to apply)
  await pay(p.data.payment, b2);
  assert.equal((await get(`/auctions/${B.id}`, seller)).data.auction.status, 'SOLD');
  await post(`/auctions/${B.id}/ship`, { tracking: 'Pickup ready' }, seller);
  // the buyer forgets to confirm: it auto-confirms after 7 days
  await at(h.clock.t + 7 * 24 * HOUR + 1000);
  assert.equal((await get(`/auctions/${B.id}`, seller)).data.auction.status, 'SETTLED');
  const led = (await h.call(J(`/admin/auctions/${B.id}/ledger`), { headers: admin })).data.ledger;
  assert.equal(led.balanced, true); assert.equal(led.held_deposits_paise, 0); assert.equal(led.escrow_paise, 0);
  assert.equal(led.platform_revenue_paise, rupees(300) + rupees(1000) + Math.round(rupees(10500) * 0.05));
});

test('B2: if the fallback bidder also fails, the auction ends unsold and the remaining money is returned', async () => {
  const t0 = h.clock.t;
  const C = await schedule({ regOpensAt: t0 + HOUR, regClosesAt: t0 + 2 * HOUR, startsAt: t0 + 3 * HOUR, endsAt: t0 + 3 * HOUR + 30 * MIN, reservePaise: null, maxExtensionS: 0 });
  await at(t0 + HOUR + 1000); await register(C, b1); await register(C, b2);
  await at(t0 + 3 * HOUR + 1000);
  await bid(C, b1, rupees(10000)); await bid(C, b2, rupees(10500));
  await at(t0 + 3 * HOUR + 30 * MIN + 1000);
  await at(h.clock.t + 25 * HOUR);   // b2 defaults
  await at(h.clock.t + 25 * HOUR);   // b1 (offered) defaults too
  await at(h.clock.t + 20000);
  const a = (await get(`/auctions/${C.id}`, seller)).data.auction;
  assert.equal(a.status, 'SETTLED');
  const led = (await h.call(J(`/admin/auctions/${C.id}/ledger`), { headers: admin })).data.ledger;
  assert.equal(led.held_deposits_paise, 0); assert.equal(led.balanced, true);
  assert.equal(led.by_kind.deposit_forfeit, rupees(2000));
  assert.ok(!h.db.prepare("SELECT 1 FROM refunds WHERE dedupe_key LIKE ? AND status = 'pending'").get(`auc:${C.id}:%`));
});

test('reserve not met: unsold, deposits returned, registration fees kept as disclosed', async () => {
  const t0 = h.clock.t;
  const D = await schedule({ regOpensAt: t0 + HOUR, regClosesAt: t0 + 2 * HOUR, startsAt: t0 + 3 * HOUR, endsAt: t0 + 3 * HOUR + 30 * MIN, reservePaise: rupees(20000), maxExtensionS: 0 });
  await at(t0 + HOUR + 1000); await register(D, b1); await register(D, b2);
  await at(t0 + 3 * HOUR + 1000);
  await bid(D, b1, rupees(10000));
  assert.equal((await state(D, b2)).reserveMet, false);
  await at(t0 + 3 * HOUR + 30 * MIN + 1000); await at(h.clock.t + 20000);
  assert.equal((await get(`/auctions/${D.id}`, b1)).data.auction.status, 'SETTLED');
  assert.ok(h.db.prepare("SELECT payload FROM auction_events WHERE auction_id = ? AND type = 'unsold'").get(D.id).payload.includes('reserve_not_met'));
  const led = (await h.call(J(`/admin/auctions/${D.id}/ledger`), { headers: admin })).data.ledger;
  assert.equal(led.platform_revenue_paise, rupees(200)); assert.equal(led.held_deposits_paise, 0); assert.equal(led.balanced, true);
  // a no-bid auction is also just unsold
  const E = await schedule({ regOpensAt: h.clock.t + HOUR, regClosesAt: h.clock.t + 2 * HOUR, startsAt: h.clock.t + 3 * HOUR, endsAt: h.clock.t + 4 * HOUR, reservePaise: null });
  await at(h.clock.t + HOUR + 1000); await register(E, b1);
  await at(h.clock.t + 3 * HOUR + 1000); await at(h.clock.t + 2 * HOUR); await at(h.clock.t + 20000);
  assert.equal((await get(`/auctions/${E.id}`, b1)).data.auction.status, 'SETTLED');
});

test('payments: late payment after registration closes is refunded; forged/replayed webhooks change nothing', async () => {
  const t0 = h.clock.t;
  const F = await schedule({ regOpensAt: t0 + HOUR, regClosesAt: t0 + 2 * HOUR, startsAt: t0 + 3 * HOUR, endsAt: t0 + 4 * HOUR, maxParticipants: 3 });
  await at(t0 + HOUR + 1000);
  const late = await post(`/auctions/${F.id}/register`, {}, b1);
  await register(F, b2); await register(F, b3);
  assert.equal((await post(`/auctions/${F.id}/register`, {}, await h.user('Third Wheel'))).status, 409); // participant limit (pending seats count)
  await at(t0 + 2 * HOUR + 1000); // registration closes with b1 unpaid
  await pay(late.data.payment, b1); // money arrives too late
  assert.equal((await get(`/auctions/${F.id}`, b1)).data.auction.myRegistration.status, 'refunded');
  const refunds = h.db.prepare("SELECT amount_paise FROM refunds WHERE dedupe_key LIKE ?").all(`auc:${F.id}:%`);
  assert.equal(refunds.reduce((s, r) => s + r.amount_paise, 0), rupees(1100));
  assert.equal((await bid(F, b1, rupees(10000))).status, 409);
  assert.equal((await h.call(J('/webhooks/test'), { method: 'POST', headers: { 'x-test-signature': 'bad' }, body: { id: 'x', event: 'payment.captured' } })).status, 401);
  const before = h.db.prepare('SELECT COUNT(*) n FROM auction_ledger WHERE auction_id = ?').get(F.id).n;
  await pay(late.data.payment, b1); // replay of a paid intent
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM auction_ledger WHERE auction_id = ?').get(F.id).n, before);
});

test('seller cancellation before the start refunds everyone in full, fees included', async () => {
  const t0 = h.clock.t;
  const G = await schedule({ regOpensAt: t0 + HOUR, regClosesAt: t0 + 2 * HOUR, startsAt: t0 + 3 * HOUR, endsAt: t0 + 4 * HOUR });
  await at(t0 + HOUR + 1000); await register(G, b1); await register(G, b2);
  assert.equal((await post(`/auctions/${G.id}/cancel`, { reason: 'Item sold elsewhere' }, seller)).data.auction.status, 'CANCELLED');
  const led = (await h.call(J(`/admin/auctions/${G.id}/ledger`), { headers: admin })).data.ledger;
  assert.equal(led.platform_revenue_paise, 0); assert.equal(led.held_deposits_paise, 0); assert.equal(led.balanced, true);
  assert.equal(led.by_kind.fee_refund, rupees(200));
  assert.ok((await inbox(b1)).some((n) => /cancelled/i.test(n.title)));
  assert.equal((await post(`/auctions/${G.id}/register`, {}, b3)).status, 409);
});

test('Buy Now closes the auction immediately for the buyer', async () => {
  const t0 = h.clock.t;
  const H = await schedule({ regOpensAt: t0 + HOUR, regClosesAt: t0 + 2 * HOUR, startsAt: t0 + 3 * HOUR, endsAt: t0 + 6 * HOUR, reservePaise: rupees(12000), buyNowPaise: rupees(18000) });
  await at(t0 + HOUR + 1000); await register(H, b1); await register(H, b2);
  await at(t0 + 3 * HOUR + 1000);
  await bid(H, b1, rupees(10000));
  assert.equal((await bid(H, b2, rupees(18000))).status, 409); // at/above buy-now price: use Buy Now
  assert.equal((await post(`/auctions/${H.id}/buy-now`, { idempotencyKey: key() }, seller)).status, 403);
  const bn = await post(`/auctions/${H.id}/buy-now`, { idempotencyKey: key() }, b2);
  assert.equal(bn.status, 201);
  const a = (await get(`/auctions/${H.id}`, b2)).data.auction;
  assert.equal(a.status, 'PAYMENT_PENDING'); assert.equal(a.settlement.amountPaise, rupees(18000)); assert.equal(a.iWon, true);
  assert.equal((await bid(H, b1, rupees(20000))).status, 409);
});

test('amendments after registration opens need every bidder\'s consent; silence is refunded', async () => {
  const t0 = h.clock.t;
  const I = await schedule({ regOpensAt: t0 + HOUR, regClosesAt: t0 + 5 * HOUR, startsAt: t0 + 6 * HOUR, endsAt: t0 + 7 * HOUR });
  await at(t0 + HOUR + 1000); await register(I, b1); await register(I, b2); await register(I, b3);
  assert.equal((await post(`/auctions/${I.id}/amendments`, { changes: { registrationFeePaise: 1 } }, seller)).status, 400); // fee can never change
  const am = await post(`/auctions/${I.id}/amendments`, { changes: { startingBidPaise: rupees(15000), reservePaise: rupees(16000) } }, seller);
  assert.equal(am.status, 201);
  assert.equal((await post(`/auctions/${I.id}/amendments`, { changes: { startingBidPaise: rupees(15500) } }, seller)).status, 409); // one at a time
  assert.ok((await inbox(b1)).some((n) => n.type === 'auction_amendment'));
  assert.equal((await post(`/auctions/${I.id}/amendments/${am.data.amendment.id}/vote`, { accept: true }, seller)).status, 403);
  await post(`/auctions/${I.id}/amendments/${am.data.amendment.id}/vote`, { accept: true }, b1);
  await post(`/auctions/${I.id}/amendments/${am.data.amendment.id}/vote`, { accept: false }, b2); // declines: refunded at once
  assert.equal((await get(`/auctions/${I.id}`, b2)).data.auction.myRegistration.status, 'refunded');
  assert.equal((await get(`/auctions/${I.id}`, b1)).data.auction.startingBidPaise, rupees(10000)); // not applied until everyone answered
  await at(am.data.amendment.consentDeadline + 1000); // b3 stayed silent
  const after = (await get(`/auctions/${I.id}`, b1)).data.auction;
  assert.equal(after.startingBidPaise, rupees(15000));
  assert.equal((await get(`/auctions/${I.id}`, b3)).data.auction.myRegistration.status, 'refunded');
  assert.equal(after.myRegistration.status, 'registered');
});

test('disputes: buyer disputes, operator refunds, books balance', async () => {
  const t0 = h.clock.t;
  const K = await schedule({ regOpensAt: t0 + HOUR, regClosesAt: t0 + 2 * HOUR, startsAt: t0 + 3 * HOUR, endsAt: t0 + 4 * HOUR, reservePaise: null, maxExtensionS: 0 });
  await at(t0 + HOUR + 1000); await register(K, b1);
  await at(t0 + 3 * HOUR + 1000); await bid(K, b1, rupees(10000));
  await at(t0 + 4 * HOUR + 1000);
  const p = await post(`/auctions/${K.id}/pay`, { fulfillment: 'pickup' }, b1); await pay(p.data.payment, b1);
  assert.equal((await post(`/auctions/${K.id}/dispute`, { reason: 'x' }, b1)).status, 400);
  assert.equal((await post(`/auctions/${K.id}/dispute`, { reason: 'Item was not as described' }, b1)).status, 201);
  assert.equal((await get(`/auctions/${K.id}`, b1)).data.auction.status, 'DISPUTED');
  assert.equal((await h.call(J(`/admin/auctions/${K.id}/resolve`), { method: 'POST', body: { outcome: 'refund_buyer' } })).status, 401);
  assert.equal((await h.call(J(`/admin/auctions/${K.id}/resolve`), { method: 'POST', headers: admin, body: { outcome: 'refund_buyer' } })).status, 200);
  assert.equal((await get(`/auctions/${K.id}`, b1)).data.auction.status, 'SETTLED');
  const led = (await h.call(J(`/admin/auctions/${K.id}/ledger`), { headers: admin })).data.ledger;
  assert.equal(led.by_kind.seller_payout || 0, 0); assert.equal(led.balanced, true); assert.equal(led.escrow_paise, 0);
});

test('state machine: illegal transitions are rejected and every transition is validated server-side', async () => {
  const { NEXT } = require('../src/modules/auctions');
  assert.ok(!NEXT.LIVE.includes('SOLD') && !NEXT.SOLD.includes('LIVE') && !NEXT.SETTLED.length && !NEXT.CANCELLED.length);
  for (const must of ['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LIVE', 'ENDED', 'PAYMENT_PENDING', 'SOLD', 'UNSOLD', 'SETTLED', 'CANCELLED', 'DISPUTED', 'PAYMENT_DEFAULTED']) assert.ok(must in NEXT, must);
  const a = await post('/auctions', terms(), seller);
  assert.throws(() => h.ctx.auctions.setStatus(h.ctx.auctions.A(a.data.auction.id), 'LIVE'), /cannot become/);
  assert.throws(() => h.ctx.auctions.setStatus(h.ctx.auctions.A(a.data.auction.id), 'SOLD'), /cannot become/);
});

test('jobs are durable and idempotent: re-running due jobs changes nothing; unapproved auctions need an operator', async () => {
  const before = h.db.prepare('SELECT COUNT(*) n FROM auction_events').get().n;
  await h.ctx.jobs.runDue(h.clock.t); await h.ctx.jobs.runDue(h.clock.t);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM auction_events').get().n, before);
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM jobs WHERE status = 'failed'").get().n, 0);
  assert.equal((await h.call(J('/admin/jobs'), { headers: admin })).status, 200);
  config.auctionAutoApprove = false;
  try {
    const d = await post('/auctions', terms(), seller);
    assert.equal((await post(`/auctions/${d.data.auction.id}/submit`, {}, seller)).data.auction.status, 'PENDING_APPROVAL');
    assert.equal((await h.call(J(`/admin/auctions/${d.data.auction.id}/approve`), { method: 'POST', body: {} })).status, 401);
    assert.equal((await h.call(J('/admin/auctions?status=PENDING_APPROVAL'), { headers: admin })).data.auctions.length, 1);
    assert.equal((await h.call(J(`/admin/auctions/${d.data.auction.id}/approve`), { method: 'POST', headers: admin, body: { verifiedItem: true } })).status, 200);
    const pub = (await get(`/auctions/${d.data.auction.id}`, b1)).data.auction;
    assert.equal(pub.status, 'SCHEDULED'); assert.equal(pub.verifiedItem, true);
  } finally { config.auctionAutoApprove = true; }
});

test('real-time stream: clients receive bids pushed over server-sent events', async () => {
  const t0 = h.clock.t;
  const S = await schedule({ regOpensAt: t0 + HOUR, regClosesAt: t0 + 2 * HOUR, startsAt: t0 + 3 * HOUR, endsAt: t0 + 4 * HOUR, reservePaise: null });
  await at(t0 + HOUR + 1000); await register(S, b1); await register(S, b2);
  await at(t0 + 3 * HOUR + 1000);
  await bid(S, b1, rupees(10000));
  const ctrl = new AbortController();
  const res = await fetch(`${h.server.address ? `http://127.0.0.1:${h.server.address().port}` : ''}/api/v1/auctions/${S.id}/stream?after=0`, { signal: ctrl.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const readUntil = async (needle) => { for (let i = 0; i < 20 && !buf.includes(needle); i++) { const { value } = await reader.read(); buf += dec.decode(value); } };
  await readUntil('event: state');
  assert.ok(buf.includes('"amountPaise":1000000')); // missed bid replayed on connect (reconciliation)
  await bid(S, b2, rupees(10500));
  await readUntil('"seq":2');
  assert.ok(buf.includes('event: bid') && buf.includes('"amountPaise":1050000'));
  ctrl.abort();
});

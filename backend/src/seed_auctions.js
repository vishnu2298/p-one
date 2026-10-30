// Seeds a few realistic auctions directly in their stored states; the sweeper/jobs take over from there.
const R = (n) => Math.round(n * 100);
const HOUR = 3600000, MIN = 60000;

function seed(db, { now, rohit, sneha, arun, divya, demo }) {
  const mk = (o) => {
    const terms = JSON.stringify({ startingBidPaise: o.starting, minIncrementPaise: o.inc, registrationFeePaise: o.fee, depositPaise: o.deposit, hasReserve: o.reserve != null, startsAt: o.starts, endsAt: o.ends, antiSnipe: [120, 120, 1800], paymentDeadlineHours: 24, defaultPolicy: 'forfeit_deposit', commissionBps: 500, feeRefundable: 'until registration closes', depositRules: 'Refunded to every bidder who does not win; credited to the winner; forfeited only if the winner fails to pay in time (when forfeiture applies)' });
    const id = Number(db.prepare(`INSERT INTO auctions (seller_id, title, description, images, category, condition, verified_item, city, market_price_paise, starting_bid_paise, reserve_paise, min_increment_paise, buy_now_paise, registration_fee_paise, deposit_paise, reg_opens_at, reg_closes_at, starts_at, ends_at, original_ends_at, shipping, pickup_address, seller_verified, status, terms, created_at, updated_at, published_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`).run(o.seller, o.title, o.desc, '[]', o.category, o.condition, o.verified ? 1 : 0, 'Chennai', o.market, o.starting, o.reserve ?? null, o.inc, o.buyNow ?? null, o.fee, o.deposit, o.regOpens, o.regCloses, o.starts, o.ends, o.ends, '["pickup","shipping"]', 'Chennai (pickup in Adyar)', o.status, terms, now, now, now).lastInsertRowid);
    return id;
  };
  const register = (aid, uid, fee, deposit) => {
    const reg = Number(db.prepare("INSERT INTO auction_registrations (auction_id, user_id, status, fee_paise, deposit_paise, paid_at, created_at) VALUES (?,?,'registered',?,?,?,?)").run(aid, uid, fee, deposit, Date.now(), Date.now()).lastInsertRowid);
    db.prepare('INSERT INTO auction_ledger (auction_id, user_id, kind, amount_paise, dedupe_key, created_at) VALUES (?,?,?,?,?,?)').run(aid, uid, 'registration_fee', fee, `reg:${reg}:fee`, Date.now());
    db.prepare('INSERT INTO auction_ledger (auction_id, user_id, kind, amount_paise, dedupe_key, created_at) VALUES (?,?,?,?,?,?)').run(aid, uid, 'deposit_hold', deposit, `reg:${reg}:deposit`, Date.now());
  };
  const bids = (aid, list) => {
    let seq = 0, last;
    for (const [uid, amt] of list) { seq++; last = [uid, amt]; db.prepare("INSERT INTO auction_bids (auction_id, seq, user_id, amount_paise, idempotency_key, created_at) VALUES (?,?,?,?,?,?)").run(aid, seq, uid, amt, `seed-${aid}-${seq}`, now - (list.length - seq) * 4 * MIN); }
    db.prepare('UPDATE auctions SET seq = ?, bid_count = ?, current_bid_paise = ?, current_bidder_id = ? WHERE id = ?').run(seq, seq, last[1], last[0], aid);
  };
  const job = (type, at, aid, key) => db.prepare('INSERT OR IGNORE INTO jobs (type, run_at, payload, dedupe_key, created_at) VALUES (?,?,?,?,?)').run(type, at, JSON.stringify({ auctionId: aid }), key, now);

  // 1. LIVE: demo user is registered and can bid right now
  const live = mk({ seller: rohit, title: 'Canon EOS 1500D DSLR with 18-55 mm lens', desc: 'Barely used, shutter count under 4,000. Original box, two batteries, 32 GB card and a padded bag.', category: 'electronics', condition: 'Like New', verified: true, market: R(34000), starting: R(12000), reserve: R(15000), inc: R(500), buyNow: R(22000), fee: R(50), deposit: R(1000), regOpens: now - 30 * HOUR, regCloses: now - 2 * HOUR, starts: now - HOUR, ends: now + 90 * MIN, status: 'LIVE' });
  for (const u of [sneha, arun, divya, demo]) register(live, u, R(50), R(1000));
  bids(live, [[sneha, R(12000)], [arun, R(12500)], [divya, R(13000)], [sneha, R(13500)], [arun, R(14000)]]);
  job('auction:end', now + 90 * MIN, live, `auction_end:${live}:${now + 90 * MIN}`);

  // 2. Registration open: starts tomorrow
  const up = mk({ seller: sneha, title: 'Vintage teak study table with drawers', desc: 'Solid teak, 4 ft wide, two drawers. Pickup from Adyar. A real classic.', category: 'home', condition: 'Good', verified: false, market: R(18000), starting: R(5000), reserve: R(7000), inc: R(250), fee: R(30), deposit: R(500), regOpens: now - HOUR, regCloses: now + 20 * HOUR, starts: now + 22 * HOUR, ends: now + 25 * HOUR, status: 'REGISTRATION_OPEN' });
  register(up, arun, R(30), R(500));
  job('auction:close_registration', now + 20 * HOUR, up, `auction_close:${up}:${now + 20 * HOUR}`);
  job('auction:start', now + 22 * HOUR, up, `auction_start:${up}:${now + 22 * HOUR}`);

  // 3. Scheduled: registration opens soon
  const soon = mk({ seller: rohit, title: 'Hero Splendor Plus 2019, single owner', desc: '28,000 km, all papers clear, recently serviced. Test ride allowed for registered bidders.', category: 'vehicles', condition: 'Good', verified: true, market: R(45000), starting: R(30000), reserve: R(36000), inc: R(1000), fee: R(100), deposit: R(2500), regOpens: now + 3 * HOUR, regCloses: now + 46 * HOUR, starts: now + 48 * HOUR, ends: now + 52 * HOUR, status: 'SCHEDULED' });
  job('auction:open_registration', now + 3 * HOUR, soon, `auction_open:${soon}:${now + 3 * HOUR}`);
  job('auction:close_registration', now + 46 * HOUR, soon, `auction_close:${soon}:${now + 46 * HOUR}`);
  job('auction:start', now + 48 * HOUR, soon, `auction_start:${soon}:${now + 48 * HOUR}`);
}

module.exports = { seed };

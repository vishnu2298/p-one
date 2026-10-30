import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../api';
import { useLoad } from '../hooks';
import { Button, Card, Chip, Empty, ErrorState, Header, Input, Pill, Screen, SectionTitle, SkeletonRows, Txt, confirmDialog, notify, toast } from '../ui';
import { Segmented, haptic } from '../motion';
import { colors } from '../theme';
import { ListingImage } from '../components/ListingCard';
import { fmtDate, fmtLeft, newKey, rs, toPaise } from '../biz';

const STATUS: Record<string, [string, string, string]> = {
  DRAFT: ['Draft', colors.sub, colors.line], PENDING_APPROVAL: ['In review', colors.warn, colors.warnSoft], SCHEDULED: ['Scheduled', colors.primary, colors.primarySoft],
  REGISTRATION_OPEN: ['Registration open', colors.buy, colors.buySoft], REGISTRATION_CLOSED: ['Starting soon', colors.primary, colors.primarySoft], LIVE: ['Live now', colors.danger, colors.dangerSoft],
  ENDED: ['Ended', colors.sub, colors.line], PAYMENT_PENDING: ['Awaiting payment', colors.warn, colors.warnSoft], SOLD: ['Sold', colors.buy, colors.buySoft], UNSOLD: ['Unsold', colors.sub, colors.line],
  SETTLED: ['Completed', colors.buy, colors.buySoft], CANCELLED: ['Cancelled', colors.sub, colors.line], DISPUTED: ['In dispute', colors.danger, colors.dangerSoft], PAYMENT_DEFAULTED: ['Not paid', colors.danger, colors.dangerSoft],
};
const StatusPill = ({ s }: { s: string }) => { const [t, c, bg] = STATUS[s] || [s, colors.sub, colors.line]; return <Pill text={t} color={c} bg={bg} />; };

/** Counts down against the server clock (offset measured once), so a wrong phone clock cannot show the wrong time. */
function useServerNow(serverNow?: number) {
  const offset = useRef(0);
  useEffect(() => { if (serverNow) offset.current = serverNow - Date.now(); }, [serverNow]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  return Date.now() + offset.current;
}

function AuctionCard({ a, onPress, now }: { a: any; onPress: () => void; now: number }) {
  const live = a.status === 'LIVE';
  const target = live ? a.endsAt : a.status === 'REGISTRATION_OPEN' ? a.regClosesAt : a.startsAt;
  return (
    <Card onPress={onPress} style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
      <ListingImage listing={{ images: a.images, category: a.category, title: a.title }} height={150} />
      <View style={{ padding: 14, gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><StatusPill s={a.status} />{['LIVE', 'REGISTRATION_OPEN', 'SCHEDULED', 'REGISTRATION_CLOSED'].includes(a.status) ? <Txt variant="small" bold color={live ? colors.danger : colors.sub}>{live ? 'Ends in ' : a.status === 'REGISTRATION_OPEN' ? 'Registration closes in ' : 'Starts in '}{fmtLeft(target - now)}</Txt> : null}</View>
        <Txt bold numberOfLines={2}>{a.title}</Txt>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt color={colors.primary} bold variant="h2">{rs(a.bidCount ? a.currentBidPaise : a.startingBidPaise)}</Txt>
          <Txt variant="small" color={colors.sub}>{a.bidCount ? `${a.bidCount} bids` : 'Starting bid'} · {a.participants} registered</Txt>
        </View>
      </View>
    </Card>
  );
}

export function Auctions() {
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<'live' | 'upcoming' | 'mine'>('live');
  const res = useLoad(async () => {
    if (tab !== 'mine') return api<any>(`/api/v1/auctions?tab=${tab}`);
    const r = await api<any>('/api/v1/me/auction-registrations');
    return { auctions: r.registrations, now: Date.now() };
  }, [tab]);
  const now = useServerNow(res.data?.now);
  const items: any[] = res.data?.auctions || [];
  return (
    <Screen header={<Header title="Auctions" subtitle="Bid fairly. Win honestly." right={<Button compact title="Sell" variant="light" icon="hammer" onPress={() => nav.navigate('AuctionCreate')} />} />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      <Segmented options={[{ id: 'live', label: 'Live' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'mine', label: 'My bids' }]} value={tab} onChange={setTab} />
      {res.loading && !res.data ? <SkeletonRows /> : res.error ? <ErrorState message={res.error} retry={() => res.reload()} /> : !items.length ? <Empty icon="hammer" title={tab === 'mine' ? 'You have not joined an auction' : tab === 'live' ? 'Nothing is live right now' : 'No upcoming auctions'} text="Check back soon, or list something of your own." action={{ title: 'Create an auction', onPress: () => nav.navigate('AuctionCreate') }} /> :
        items.map((a) => <AuctionCard key={a.id} a={a} now={now} onPress={() => nav.navigate('AuctionDetail', { id: a.id })} />)}
      <Button title="My auctions (selling)" variant="light" icon="albums" onPress={() => nav.navigate('MyAuctions')} />
    </Screen>
  );
}

export function AuctionDetail() {
  const { params } = useRoute<any>(); const id = params.id;
  const res = useLoad(() => api<{ auction: any; now: number }>(`/api/v1/auctions/${id}`), [id]);
  const [live, setLive] = useState<any>(null); const [bids, setBids] = useState<any[]>([]);
  const a = res.data?.auction;
  const now = useServerNow(live?.now ?? res.data?.now);
  const seq = useRef(0);

  // Poll cheaply for the live state; the server returns only bids newer than what we hold.
  const status = live?.status ?? a?.status;
  useEffect(() => {
    if (!a) return;
    let stop = false;
    const poll = async () => {
      try {
        const s = await api<any>(`/api/v1/auctions/${id}/state?after=${seq.current}`);
        if (stop) return;
        if (s.bids.length) { seq.current = Math.max(seq.current, ...s.bids.map((b: any) => b.seq)); setBids((old) => [...s.bids.slice().reverse(), ...old].slice(0, 100)); }
        setLive((old: any) => { if (old && old.status !== s.status) void res.reload(true); return s; });
      } catch { /* the banner tells the user when offline */ }
    };
    void poll();
    const t = setInterval(poll, ['LIVE', 'REGISTRATION_CLOSED'].includes(status || a.status) ? 1500 : 6000);
    return () => { stop = true; clearInterval(t); };
  }, [id, !!a]); // eslint-disable-line react-hooks/exhaustive-deps

  if (res.loading && !a) return <Screen header={<Header title="Auction" />}><SkeletonRows /></Screen>;
  if (res.error || !a) return <Screen header={<Header title="Auction" />}><ErrorState message={res.error || 'Not found'} retry={() => res.reload()} /></Screen>;
  const cur = live ? { ...a, status: live.status, currentBidPaise: live.currentBidPaise, bidCount: live.bidCount, endsAt: live.endsAt, isLeading: live.isLeading, reserveMet: live.reserveMet } : a;
  const reg = live?.myRegistration ?? a.myRegistration?.status ?? null;
  return (
    <Screen header={<Header title="Auction" />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <ListingImage listing={{ images: a.images, category: a.category, title: a.title }} height={200} />
        <View style={{ padding: 16, gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><StatusPill s={cur.status} />{a.verifiedItem ? <Pill text="Verified item" icon="shield-checkmark" color={colors.buy} bg={colors.buySoft} /> : null}{a.hasReserve ? <Pill text={cur.reserveMet ? 'Reserve met' : 'Reserve not met'} color={cur.reserveMet ? colors.buy : colors.warn} bg={cur.reserveMet ? colors.buySoft : colors.warnSoft} /> : null}</View>
          <Txt variant="title">{a.title}</Txt>
          <Txt color={colors.sub}>{a.condition} · {a.city} · Sold by {a.seller.name}</Txt>
          {a.marketPricePaise ? <Txt variant="small" color={colors.sub}>Market price about {rs(a.marketPricePaise)}</Txt> : null}
        </View>
      </Card>
      {cur.status === 'LIVE' ? <Live a={cur} id={id} now={now} live={live} reg={reg} onDone={() => res.reload(true)} /> : null}
      {['SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(cur.status) ? <Register a={cur} id={id} now={now} reg={reg} onDone={() => res.reload(true)} /> : null}
      {['PAYMENT_PENDING', 'SOLD', 'SETTLED', 'DISPUTED'].includes(cur.status) ? <Settlement a={cur} id={id} onDone={() => res.reload(true)} /> : null}
      {['ENDED', 'UNSOLD', 'PAYMENT_DEFAULTED', 'CANCELLED'].includes(cur.status) ? <Card style={{ marginTop: 12 }}><Txt bold>{cur.status === 'UNSOLD' ? 'This auction ended without a sale.' : cur.status === 'CANCELLED' ? 'This auction was cancelled. Fees and deposits were refunded.' : cur.status === 'PAYMENT_DEFAULTED' ? 'The winner did not pay in time.' : 'Bidding has ended.'}</Txt><Txt color={colors.sub}>Final bid {rs(cur.currentBidPaise)}</Txt></Card> : null}
      {a.description ? <><SectionTitle title="About this item" /><Card><Txt>{a.description}</Txt></Card></> : null}
      <SectionTitle title="Rules" />
      <Card style={{ gap: 4 }}>
        <Txt variant="small" color={colors.sub}>• Registration fee {rs(a.registrationFeePaise)} (not refundable once bidding starts), plus a refundable deposit of {rs(a.depositPaise)}.</Txt>
        <Txt variant="small" color={colors.sub}>• A bid in the last {a.antiSnipe.windowS}s extends the auction by {a.antiSnipe.extendS}s, up to {Math.round(a.antiSnipe.maxExtensionS / 60)} min.</Txt>
        <Txt variant="small" color={colors.sub}>• The winner pays within {a.paymentDeadlineHours} hours. {a.defaultPolicy === 'forfeit_deposit' ? 'The deposit is forfeited if they do not pay.' : 'The deposit is returned if they do not pay.'}</Txt>
        <Txt variant="small" color={colors.sub}>• Deposits of everyone except the winner (and the next in line) are returned right after the auction ends.</Txt>
      </Card>
      {bids.length ? <><SectionTitle title="Bids" />{bids.slice(0, 15).map((b) => <Card key={b.seq} style={{ marginBottom: 6, flexDirection: 'row', justifyContent: 'space-between' }}><Txt bold={b.mine}>{b.mine ? 'You' : b.bidder || b.label}</Txt><Txt bold>{rs(b.amountPaise ?? b.amount_paise)}</Txt></Card>)}</> : null}
    </Screen>
  );
}

function Register({ a, id, now, reg, onDone }: { a: any; id: number; now: number; reg: string | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false); const [pay, setPay] = useState<any>(null);
  const total = a.registrationFeePaise + a.depositPaise;
  const start = async () => {
    setBusy(true);
    try { const r = await api<any>(`/api/v1/auctions/${id}/register`, { method: 'POST', body: {} }); if (r.payment) setPay(r.payment); else { toast('You are registered'); onDone(); } }
    catch (e: any) { notify('Could not register', e.message); } finally { setBusy(false); }
  };
  const pay_ = async (fail = false) => {
    setBusy(true);
    try { await api(`/api/v1/payments/${pay.id}/simulate`, { method: 'POST', body: { fail } }); setPay(null); toast(fail ? 'Payment failed' : 'Registered. Good luck!'); onDone(); }
    catch (e: any) { notify('Payment problem', e.message); } finally { setBusy(false); }
  };
  const cancel = async () => { if (!(await confirmDialog('Cancel registration?', 'Your fee and deposit are refunded while registration is open.', 'Cancel registration', true))) return; try { await api(`/api/v1/auctions/${id}/register`, { method: 'DELETE' }); toast('Refund started'); onDone(); } catch (e: any) { notify('Could not cancel', e.message); } };
  return (
    <Card style={{ marginTop: 12, gap: 6 }}>
      <Txt variant="h2">{a.status === 'REGISTRATION_OPEN' ? 'Register to bid' : 'Starts ' + fmtDate(a.startsAt)}</Txt>
      <Txt color={colors.sub}>Starts in {fmtLeft(a.startsAt - now)} · {a.participants}{a.maxParticipants ? `/${a.maxParticipants}` : ''} registered</Txt>
      {reg === 'registered' ? <><Pill text="You are registered" icon="checkmark-circle" color={colors.buy} bg={colors.buySoft} />{a.status === 'REGISTRATION_OPEN' ? <Button title="Cancel registration" variant="light" onPress={cancel} /> : null}</> :
        a.status === 'REGISTRATION_OPEN' && !a.isSeller ? (
          pay ? (
            <><Txt>Pay {rs(pay.amountPaise)} to complete registration.</Txt>
              {pay.provider === 'test' ? <><Txt variant="small" color={colors.warn}>Test mode: no real money moves.</Txt><Button title={`Pay ${rs(pay.amountPaise)} (test)`} onPress={() => pay_(false)} loading={busy} /><Button title="Simulate failed payment" variant="light" onPress={() => pay_(true)} /></> : <Txt color={colors.sub}>Complete the payment in the payment window.</Txt>}</>
          ) : <><Txt>Fee {rs(a.registrationFeePaise)} + refundable deposit {rs(a.depositPaise)} = <Txt bold>{rs(total)}</Txt></Txt><Button title={total ? `Register · ${rs(total)}` : 'Register for free'} icon="ticket" onPress={start} loading={busy} /></>
        ) : a.isSeller ? <Txt color={colors.sub}>This is your auction.</Txt> : <Txt color={colors.sub}>{a.status === 'SCHEDULED' ? 'Registration opens ' + fmtDate(a.regOpensAt) : 'Registration is closed.'}</Txt>}
    </Card>
  );
}

function Live({ a, id, now, live, reg, onDone }: { a: any; id: number; now: number; live: any; reg: string | null; onDone: () => void }) {
  const [custom, setCustom] = useState(''); const [busy, setBusy] = useState(false);
  const attempt = useRef<{ amt: number; key: string } | null>(null);
  const min = live?.minNextBidPaise ?? (a.bidCount ? a.currentBidPaise + a.minIncrementPaise : a.startingBidPaise);
  const left = a.endsAt - now;
  const place = useCallback(async (amt: number) => {
    if (attempt.current?.amt !== amt) attempt.current = { amt, key: newKey('bid') }; // retry of the same tap is idempotent
    setBusy(true);
    try { await api(`/api/v1/auctions/${id}/bids`, { method: 'POST', body: { amountPaise: amt, idempotencyKey: attempt.current.key } }); attempt.current = null; haptic.success?.(); toast(`Bid of ${rs(amt)} placed`); setCustom(''); onDone(); }
    catch (e: any) { attempt.current = null; notify('Bid not placed', e.message); } finally { setBusy(false); }
  }, [id, onDone]);
  const buyNow = async () => {
    if (!(await confirmDialog('Buy it now?', `You will win this auction at ${rs(a.buyNowPaise)}.`, 'Buy now'))) return;
    try { await api(`/api/v1/auctions/${id}/buy-now`, { method: 'POST', body: { idempotencyKey: newKey('bn') } }); toast('It is yours! Complete payment next.'); onDone(); } catch (e: any) { notify('Could not buy', e.message); }
  };
  return (
    <Card style={{ marginTop: 12, gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View><Txt variant="small" color={colors.sub}>{a.bidCount ? 'Current bid' : 'Starting bid'}</Txt><Txt variant="title" color={colors.primary}>{rs(a.bidCount ? a.currentBidPaise : a.startingBidPaise)}</Txt></View>
        <View style={{ alignItems: 'flex-end' }}><Txt variant="small" color={colors.sub}>Ends in</Txt><Txt variant="title" color={left < 60000 ? colors.danger : colors.text}>{fmtLeft(left)}</Txt></View>
      </View>
      {a.isLeading ? <Pill text="You are the highest bidder" icon="trophy" color={colors.buy} bg={colors.buySoft} /> : null}
      {reg !== 'registered' ? <Txt color={colors.sub}>{a.isSeller ? 'You cannot bid on your own auction.' : 'Registration is closed. You can watch this auction live.'}</Txt> : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[0, 1, 5, 10].map((n) => { const amt = min + n * a.minIncrementPaise; return <Chip key={n} label={rs(amt)} onPress={() => place(amt)} />; })}</View>
          <Input label="Your own amount ₹" value={custom} onChangeText={setCustom} keyboardType="decimal-pad" hint={`At least ${rs(min)}`} />
          <Button title="Place bid" icon="hammer" onPress={() => place(toPaise(custom))} loading={busy} disabled={!(toPaise(custom) >= min) || a.isLeading} />
          {a.buyNowPaise && a.currentBidPaise < a.buyNowPaise ? <Button title={`Buy now · ${rs(a.buyNowPaise)}`} variant="sell" onPress={buyNow} /> : null}
        </>
      )}
    </Card>
  );
}

function Settlement({ a, id, onDone }: { a: any; id: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false); const [addr, setAddr] = useState(''); const [pay, setPay] = useState<any>(null); const [tracking, setTracking] = useState('');
  const s = a.settlement; const ship = a.shipping || [];
  const [method, setMethod] = useState<string>(ship[0] || 'pickup');
  const doPay = async () => {
    setBusy(true);
    try { const r = await api<any>(`/api/v1/auctions/${id}/pay`, { method: 'POST', body: { fulfillment: method, address: addr } }); if (r.payment) setPay(r.payment); else { toast('Paid with your deposit'); onDone(); } }
    catch (e: any) { notify('Could not start payment', e.message); } finally { setBusy(false); }
  };
  const confirmPay = async () => { setBusy(true); try { await api(`/api/v1/payments/${pay.id}/simulate`, { method: 'POST', body: {} }); setPay(null); toast('Payment received'); onDone(); } catch (e: any) { notify('Payment problem', e.message); } finally { setBusy(false); } };
  const call = async (path: string, body: any, msg: string) => { try { await api(`/api/v1/auctions/${id}/${path}`, { method: 'POST', body }); toast(msg); onDone(); } catch (e: any) { notify('Could not update', e.message); } };
  return (
    <Card style={{ marginTop: 12, gap: 8 }}>
      {a.iWon ? <Txt variant="h2" color={colors.buy}>You won at {rs(s?.amountPaise ?? a.currentBidPaise)} 🎉</Txt> : <Txt variant="h2">Sale price {rs(s?.amountPaise ?? a.currentBidPaise)}</Txt>}
      {s ? <Pill text={s.status.replace(/_/g, ' ')} /> : null}
      {a.status === 'PAYMENT_PENDING' && a.iWon ? (
        <>
          <Txt color={colors.sub}>Your deposit of {rs(s?.depositCreditPaise)} counts toward the price. Pay before {fmtDate(s?.dueAt)}.</Txt>
          {ship.length > 1 ? <View style={{ flexDirection: 'row', gap: 8 }}>{ship.map((x: string) => <Chip key={x} label={x === 'pickup' ? 'Pick up' : 'Ship to me'} selected={method === x} onPress={() => setMethod(x)} />)}</View> : null}
          {method === 'shipping' ? <Input label="Delivery address" value={addr} onChangeText={setAddr} multiline /> : <Txt variant="small" color={colors.sub}>Pickup: {a.pickupAddress}</Txt>}
          {pay ? <Button title={`Pay ${rs(pay.amountPaise)} (test)`} onPress={confirmPay} loading={busy} /> : <Button title="Pay now" icon="card" onPress={doPay} loading={busy} />}
        </>
      ) : null}
      {a.status === 'SOLD' && a.isSeller ? <><Input label="Courier / tracking note (optional)" value={tracking} onChangeText={setTracking} /><Button title="Mark as handed over / shipped" onPress={() => call('ship', { tracking }, 'Buyer notified')} /></> : null}
      {a.status === 'SOLD' && a.iWon ? <><Txt color={colors.sub}>Got your item? Confirm so the seller is paid. It is confirmed automatically after 7 days.</Txt><Button title="I received it" icon="checkmark-circle" onPress={() => call('confirm-delivery', {}, 'Thank you! Seller paid.')} /><Button title="Something is wrong" variant="light" onPress={() => call('dispute', { reason: 'Item not as described or not received' }, 'Dispute opened. We will review.')} /></> : null}
    </Card>
  );
}

export function MyAuctions() {
  const nav = useNavigation<any>();
  const res = useLoad(() => api<{ auctions: any[] }>('/api/v1/me/auctions'), []);
  const now = useServerNow();
  const act = async (a: any, path: string, msg: string) => { try { await api(`/api/v1/auctions/${a.id}/${path}`, { method: 'POST', body: {} }); toast(msg); void res.reload(true); } catch (e: any) { notify('Could not update', e.message); } };
  return (
    <Screen header={<Header title="My auctions" />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }} footer={<Button title="Create an auction" icon="add-circle" onPress={() => nav.navigate('AuctionCreate')} />}>
      {res.loading && !res.data ? <SkeletonRows /> : res.error ? <ErrorState message={res.error} retry={() => res.reload()} /> : !res.data?.auctions.length ? <Empty icon="hammer" title="You have not created an auction" text="Auction something valuable to many verified bidders." /> :
        res.data.auctions.map((a) => (
          <View key={a.id}>
            <AuctionCard a={a} now={now} onPress={() => nav.navigate('AuctionDetail', { id: a.id })} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: -4, marginBottom: 14 }}>
              {a.status === 'DRAFT' ? <Button compact title="Submit for review" onPress={() => act(a, 'submit', 'Submitted')} style={{ flex: 1 }} /> : null}
              {['DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'REGISTRATION_OPEN'].includes(a.status) ? <Button compact variant="light" title="Cancel" onPress={async () => { if (await confirmDialog('Cancel this auction?', 'Everyone registered is refunded in full.', 'Cancel auction', true)) void act(a, 'cancel', 'Cancelled'); }} style={{ flex: 1 }} /> : null}
            </View>
          </View>
        ))}
    </Screen>
  );
}

export function AuctionCreate() {
  const nav = useNavigation<any>();
  const [f, setF] = useState<Record<string, string>>({ startsIn: '60', duration: '120', fee: '100', deposit: '1000', inc: '100' });
  const set = (k: string) => (t: string) => setF((x) => ({ ...x, [k]: t }));
  const [busy, setBusy] = useState(false); const [ship, setShip] = useState<string[]>(['pickup']);
  const submit = async () => {
    const starting = toPaise(f.start || ''), inc = toPaise(f.inc || '');
    if (!f.title || !(starting >= 100) || !(inc >= 100)) return notify('Add a title, starting bid and increment');
    const m = 60000, t = Date.now(), startsAt = t + Number(f.startsIn) * m, endsAt = startsAt + Number(f.duration) * m;
    setBusy(true);
    try {
      const r = await api<{ auction: any }>('/api/v1/auctions', { method: 'POST', body: {
        title: f.title, description: f.desc || '', category: 'electronics', condition: f.cond || 'Good', startingBidPaise: starting, minIncrementPaise: inc, reservePaise: f.reserve ? toPaise(f.reserve) : null, buyNowPaise: f.buy ? toPaise(f.buy) : null,
        marketPricePaise: f.market ? toPaise(f.market) : 0, registrationFeePaise: toPaise(f.fee || '0') || 0, depositPaise: toPaise(f.deposit || '0') || 0, regOpensAt: t + 60000, regClosesAt: startsAt - m, startsAt, endsAt, shipping: ship, pickupAddress: f.pickup || '', defaultPolicy: 'refund_deposit' } });
      await api(`/api/v1/auctions/${r.auction.id}/submit`, { method: 'POST', body: {} });
      toast('Submitted. It goes live after review.'); nav.replace('MyAuctions');
    } catch (e: any) { notify('Could not create', e.message); } finally { setBusy(false); }
  };
  return (
    <Screen header={<Header title="Create an auction" />} footer={<Button title="Submit for review" onPress={submit} loading={busy} />}>
      <Txt color={colors.sub} style={{ marginBottom: 14 }}>Bidders pay a small registration fee and a refundable deposit, so only serious buyers join. Terms are locked once you submit.</Txt>
      <Input label="What are you auctioning?" value={f.title || ''} onChangeText={set('title')} />
      <Input label="Description" value={f.desc || ''} onChangeText={set('desc')} multiline />
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Input label="Starting bid ₹" value={f.start || ''} onChangeText={set('start')} keyboardType="decimal-pad" /></View><View style={{ flex: 1 }}><Input label="Bid step ₹" value={f.inc || ''} onChangeText={set('inc')} keyboardType="decimal-pad" /></View></View>
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Input label="Reserve ₹ (hidden)" value={f.reserve || ''} onChangeText={set('reserve')} keyboardType="decimal-pad" /></View><View style={{ flex: 1 }}><Input label="Buy now ₹" value={f.buy || ''} onChangeText={set('buy')} keyboardType="decimal-pad" /></View></View>
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Input label="Registration fee ₹" value={f.fee || ''} onChangeText={set('fee')} keyboardType="decimal-pad" /></View><View style={{ flex: 1 }}><Input label="Refundable deposit ₹" value={f.deposit || ''} onChangeText={set('deposit')} keyboardType="decimal-pad" /></View></View>
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Input label="Starts in (minutes)" value={f.startsIn || ''} onChangeText={set('startsIn')} keyboardType="number-pad" /></View><View style={{ flex: 1 }}><Input label="Runs for (minutes)" value={f.duration || ''} onChangeText={set('duration')} keyboardType="number-pad" /></View></View>
      <Txt variant="small" bold color={colors.sub} style={{ marginLeft: 4, marginBottom: 8 }}>Handover</Txt>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>{(['pickup', 'shipping'] as const).map((x) => <Chip key={x} label={x === 'pickup' ? 'Pickup' : 'Shipping'} selected={ship.includes(x)} onPress={() => setShip((s) => (s.includes(x) ? s.filter((y) => y !== x) || s : [...s, x]))} />)}</View>
      <Input label="Pickup address" value={f.pickup || ''} onChangeText={set('pickup')} />
    </Screen>
  );
}

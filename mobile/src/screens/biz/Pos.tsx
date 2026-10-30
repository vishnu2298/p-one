import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ApiError, api, isOnline, onNetChange, storage } from '../../api';
import { useDebounced, useLoad } from '../../hooks';
import { Button, Card, Chip, Empty, ErrorState, Input, Pill, SkeletonRows, Txt, confirmDialog, notify, toast } from '../../ui';
import { colors } from '../../theme';
import { BizScreen, Line, bizPath, newKey, rs, toPaise } from '../../biz';

type CartLine = { id: number; name: string; price: number; qty: number; stock: number | null };
type Queued = { key: string; bizId: number; body: any; label: string; at: number };
const QKEY = 'pos.queue';
const loadQ = async (): Promise<Queued[]> => { try { return JSON.parse((await storage.get(QKEY)) || '[]'); } catch { return []; } };

/** Sends queued offline bills. The idempotency key makes a retry after a flaky response harmless. */
async function flushQueue(): Promise<number> {
  const q = await loadQ(); const left: Queued[] = []; let sent = 0;
  for (const x of q) {
    try { await api(bizPath(x.bizId, '/sales'), { method: 'POST', body: { ...x.body, idempotencyKey: x.key } }); sent++; }
    catch (e: any) { if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) { sent += 0; continue; } left.push(x); }
  }
  await storage.set(QKEY, JSON.stringify(left));
  return sent;
}

export function BizPos() { return <BizScreen title="Billing" need="sales.write">{(b) => <Pos bizId={b.id} />}</BizScreen>; }

function Pos({ bizId }: { bizId: number }) {
  const nav = useNavigation<any>();
  const [q, setQ] = useState(''); const dq = useDebounced(q, 250);
  const prods = useLoad(() => api<{ products: any[] }>(bizPath(bizId, `/products?q=${encodeURIComponent(dq)}&limit=40`)), [bizId, dq]);
  const custs = useLoad(() => api<{ customers: any[] }>(bizPath(bizId, '/customers')).catch(() => ({ customers: [] as any[] })), [bizId]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [method, setMethod] = useState<'cash' | 'upi' | 'card' | 'credit'>('cash');
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  const attempt = useRef<{ sig: string; key: string } | null>(null);

  const refreshPending = useCallback(async () => setPending((await loadQ()).length), []);
  useEffect(() => {
    void refreshPending();
    const run = async () => { const n = await flushQueue(); if (n) toast(`${n} offline bill${n > 1 ? 's' : ''} synced`); void refreshPending(); };
    if (isOnline()) void run();
    return onNetChange((on) => { if (on) void run(); });
  }, [refreshPending]);

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const add = (p: any) => setCart((c) => {
    const i = c.findIndex((x) => x.id === p.id);
    if (i >= 0) return c.map((x, n) => (n === i ? { ...x, qty: x.qty + 1 } : x));
    return [...c, { id: p.id, name: p.name, price: p.selling_price_paise, qty: 1, stock: p.is_service ? null : p.available }];
  });
  const bump = (id: number, d: number) => setCart((c) => c.map((x) => (x.id === id ? { ...x, qty: x.qty + d } : x)).filter((x) => x.qty > 0));
  const tendered = method === 'credit' ? Math.max(0, paid.trim() === '' ? 0 : toPaise(paid) || 0) : paid.trim() === '' ? total : Math.min(total, toPaise(paid) || 0);

  const checkout = async () => {
    if (!cart.length) return;
    if ((method === 'credit' || tendered < total) && !customer) return notify('Choose a customer', 'Pick who will pay the rest later.');
    const body = { customerId: customer?.id, items: cart.map((l) => ({ productId: l.id, qty: l.qty })), payments: tendered > 0 ? [{ method: method === 'credit' ? 'cash' : method, amountPaise: tendered }] : [] };
    // A retry of the same bill reuses its key so it can never be billed twice.
    const sig = JSON.stringify(body);
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: newKey('pos') };
    const key = attempt.current.key;
    setBusy(true);
    try {
      const r = await api<{ invoice: any; shareUrl: string }>(bizPath(bizId, '/sales'), { method: 'POST', body: { ...body, idempotencyKey: key } });
      attempt.current = null; setCart([]); setPaid(''); setCustomer(null); void prods.reload(true);
      toast(`Bill ${r.invoice.invoice_no} saved`); nav.navigate('BizInvoice', { id: r.invoice.id });
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 0) {
        const q = await loadQ(); q.push({ key, bizId, body, label: `${cart.length} items · ${rs(total)}`, at: Date.now() });
        await storage.set(QKEY, JSON.stringify(q)); attempt.current = null; setCart([]); setPaid(''); void refreshPending();
        notify('Saved on this phone', 'You are offline. The bill will be sent automatically when the internet is back.');
      } else notify('Could not save the bill', e.message);
    } finally { setBusy(false); }
  };

  const items = prods.data?.products || [];
  return (
    <>
      {pending ? <Card style={{ backgroundColor: colors.warnSoft, marginBottom: 12 }}><Txt color={colors.warn} bold>{pending} bill{pending > 1 ? 's' : ''} waiting to sync</Txt><Txt variant="small" color={colors.warn}>They will go through as soon as you are online.</Txt></Card> : null}
      <Input placeholder="Search item, SKU or scan barcode" value={q} onChangeText={setQ} autoCapitalize="none"
        onSubmitEditing={() => { const hit = items.find((p) => p.barcode === q.trim() || p.sku === q.trim()); if (hit) { add(hit); setQ(''); } }} />
      {prods.loading && !prods.data ? <SkeletonRows count={3} avatar={false} /> : prods.error ? <ErrorState message={prods.error} retry={() => prods.reload()} /> :
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {items.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Add ${p.name}`} onPress={() => add(p)} style={{ width: '48%', padding: 12, borderRadius: 16, backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.glassBorder, opacity: !p.is_service && p.available <= 0 ? 0.5 : 1 }}>
              <Txt bold numberOfLines={2}>{p.name}</Txt><Txt color={colors.primary} bold>{rs(p.selling_price_paise)}</Txt>
              <Txt variant="tiny" color={p.low ? colors.danger : colors.sub}>{p.is_service ? 'Service' : `${p.available} in stock`}</Txt>
            </Pressable>
          ))}
        </View>}
      <Card style={{ gap: 4 }}>
        <Txt variant="h2">Current bill</Txt>
        {!cart.length ? <Txt color={colors.sub}>Tap an item to add it.</Txt> : cart.map((l) => (
          <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
            <Txt style={{ flex: 1 }} numberOfLines={1}>{l.name}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={`Less ${l.name}`} onPress={() => bump(l.id, -1)}><Ionicons name="remove-circle" size={30} color={colors.sub} /></Pressable>
            <Txt bold>{l.qty}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={`More ${l.name}`} onPress={() => bump(l.id, 1)}><Ionicons name="add-circle" size={30} color={colors.primary} /></Pressable>
            <Txt bold style={{ width: 74, textAlign: 'right' }}>{rs(l.price * l.qty)}</Txt>
          </View>
        ))}
        {cart.length ? <Line label="Total (incl. GST)" value={rs(total)} bold /> : null}
      </Card>
      {cart.length ? (
        <>
          <Txt variant="small" bold color={colors.sub} style={{ margin: 8, marginTop: 14 }}>Customer</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Walk-in" selected={!customer} onPress={() => setCustomer(null)} />
            {(custs.data?.customers || []).slice(0, 12).map((c) => <Chip key={c.id} label={c.name} selected={customer?.id === c.id} onPress={() => setCustomer(c)} />)}
          </View>
          <Txt variant="small" bold color={colors.sub} style={{ margin: 8, marginTop: 14 }}>Payment</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {([['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['credit', 'On credit (khata)']] as const).map(([id, l]) => <Chip key={id} label={l} selected={method === id} onPress={() => { setMethod(id); setPaid(''); }} />)}
          </View>
          <Input label={method === 'credit' ? 'Paid now ₹ (rest goes to khata)' : 'Amount received ₹'} value={paid} onChangeText={setPaid} keyboardType="decimal-pad" placeholder={method === 'credit' ? '0' : String(total / 100)} />
          {tendered < total ? <Txt color={colors.warn} style={{ marginBottom: 10 }}>{rs(total - tendered)} will be added to {customer?.name || 'the customer'}'s khata.</Txt> : null}
          <Button title={`Charge ${rs(total)}`} icon="checkmark-circle" onPress={checkout} loading={busy} />
        </>
      ) : null}
    </>
  );
}

export function BizSales() {
  const nav = useNavigation<any>();
  return <BizScreen title="Sales" need="sales.read">{(b) => <SalesList bizId={b.id} nav={nav} />}</BizScreen>;
}
function SalesList({ bizId, nav }: { bizId: number; nav: any }) {
  const res = useLoad(() => api<{ invoices: any[] }>(bizPath(bizId, '/sales?limit=100')), [bizId]);
  const items = res.data?.invoices || [];
  if (res.loading && !res.data) return <SkeletonRows />;
  if (res.error) return <ErrorState message={res.error} retry={() => res.reload()} />;
  if (!items.length) return <Empty icon="receipt" title="No bills yet" text="Your invoices will show up here." />;
  return <>{items.map((x) => (
    <Card key={x.id} onPress={() => nav.navigate('BizInvoice', { id: x.id })} style={{ marginBottom: 8, gap: 2 }}>
      <Line label={`${x.invoice_no} · ${x.customer_name || 'Walk-in'}`} value={rs(x.total_paise - x.returned_paise)} bold />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Txt variant="small" color={colors.sub}>{String(x.created_at).slice(0, 10)}</Txt>
        <Pill text={x.status.replace('_', ' ')} color={x.balance_paise > 0 ? colors.warn : colors.buy} bg={x.balance_paise > 0 ? colors.warnSoft : colors.buySoft} />
      </View>
    </Card>
  ))}</>;
}

export function BizInvoice() {
  const { params } = useRoute<any>();
  return <BizScreen title="Invoice">{(b, can) => <InvoiceView bizId={b.id} id={params.id} can={can} />}</BizScreen>;
}
function InvoiceView({ bizId, id, can }: { bizId: number; id: number; can: (p: string) => boolean }) {
  const res = useLoad(() => api<{ invoice: any; shareUrl: string }>(bizPath(bizId, `/sales/${id}`)), [bizId, id]);
  const [amt, setAmt] = useState(''); const [busy, setBusy] = useState(false);
  if (res.loading && !res.data) return <SkeletonRows />;
  if (res.error || !res.data) return <ErrorState message={res.error || 'Not found'} retry={() => res.reload()} />;
  const i = res.data.invoice;
  const receive = async () => {
    const a = toPaise(amt); if (!(a > 0)) return;
    setBusy(true);
    try { await api(bizPath(bizId, `/sales/${id}/payments`), { method: 'POST', body: { amountPaise: Math.min(a, i.balance_paise), method: 'cash', idempotencyKey: newKey('rcpt') } }); setAmt(''); toast('Payment recorded'); void res.reload(true); }
    catch (e: any) { notify('Could not record', e.message); } finally { setBusy(false); }
  };
  const refund = async (it: any) => {
    if (!(await confirmDialog('Return this item?', `${it.name} ×1 will go back into stock and be refunded.`, 'Return'))) return;
    try { await api(bizPath(bizId, `/sales/${id}/returns`), { method: 'POST', body: { items: [{ itemId: it.id, qty: 1 }], refundMethod: 'cash', reason: 'Customer return', idempotencyKey: newKey('ret') } }); toast('Return recorded'); void res.reload(true); }
    catch (e: any) { notify('Could not return', e.message); }
  };
  const share = () => Linking.openURL(`https://wa.me/?text=${encodeURIComponent(`Your bill from ${i.business.name}: ${res.data!.shareUrl}`)}`);
  return (
    <>
      <Card style={{ gap: 4 }}>
        <Txt variant="title">{i.invoice_no}</Txt><Txt color={colors.sub}>{i.business.name} · {String(i.created_at).slice(0, 10)}</Txt>
        <Txt color={colors.sub}>{i.customer_name || 'Walk-in customer'}</Txt>
        <View style={{ height: 8 }} />
        {i.items.map((it: any) => (
          <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt style={{ flex: 1 }}>{it.name} × {it.qty}{it.returned_qty ? ` (−${it.returned_qty})` : ''}</Txt><Txt>{rs(it.line_total_paise ?? it.total_paise)}</Txt>
            {can('sales.refund') ? <Pressable accessibilityRole="button" accessibilityLabel={`Return ${it.name}`} onPress={() => refund(it)}><Ionicons name="return-down-back" size={22} color={colors.sub} /></Pressable> : null}
          </View>
        ))}
        <View style={{ height: 8 }} />
        <Line label="GST included" value={rs(i.tax_paise)} /><Line label="Total" value={rs(i.total_paise)} bold />
        {i.returned_paise ? <Line label="Returned" value={`− ${rs(i.returned_paise)}`} /> : null}
        <Line label="Paid" value={rs(i.paid_paise)} color={colors.buy} />
        {i.balance_paise > 0 ? <Line label="Balance due" value={rs(i.balance_paise)} bold color={colors.danger} /> : null}
      </Card>
      {i.balance_paise > 0 && can('sales.write') ? <Card style={{ marginTop: 12 }}><Input label="Receive payment ₹" value={amt} onChangeText={setAmt} keyboardType="decimal-pad" /><Button title="Record payment" onPress={receive} loading={busy} disabled={!amt} /></Card> : null}
      <Button title="Share on WhatsApp" icon="logo-whatsapp" variant="secondary" onPress={share} style={{ marginTop: 12 }} />
    </>
  );
}

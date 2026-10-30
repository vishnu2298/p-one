import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { api } from '../api';
import { useDebounced, useLoad } from '../hooks';
import { Button, Card, Chip, Empty, ErrorState, Header, Input, Pill, Screen, SectionTitle, SkeletonRows, Txt, confirmDialog, notify, toast } from '../ui';
import { Segmented } from '../motion';
import { colors } from '../theme';
import { fmtDate, newKey, rs } from '../biz';

export function Stores() {
  const nav = useNavigation<any>();
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const res = useLoad(() => api<{ stores: any[] }>(`/api/v1/stores?q=${encodeURIComponent(dq)}`), [dq]);
  return (
    <Screen header={<Header title="Shops near you" right={<Button compact variant="light" title="Orders" icon="bag" onPress={() => nav.navigate('MyStoreOrders')} />} />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      <Input placeholder="Search shops and clinics" value={q} onChangeText={setQ} />
      {res.loading && !res.data ? <SkeletonRows /> : res.error ? <ErrorState message={res.error} retry={() => res.reload()} /> : !res.data?.stores.length ? <Empty icon="storefront" title="No shops found" text="Local businesses that open an online shop will show up here." /> :
        res.data.stores.map((s) => (
          <Card key={s.id} onPress={() => nav.navigate('StoreDetail', { slug: s.slug })} style={{ marginBottom: 10, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt bold variant="h2" style={{ flex: 1 }}>{s.name}</Txt>{s.verified ? <Ionicons name="shield-checkmark" size={20} color={colors.buy} /> : null}</View>
            <Txt color={colors.sub} numberOfLines={2}>{s.description || s.category.replace(/_/g, ' ')}</Txt>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {s.distanceKm != null ? <Pill text={`${s.distanceKm.toFixed(1)} km`} icon="location" /> : <Pill text={s.city} icon="location" />}
              {s.pickup ? <Pill text="Pickup" /> : null}{s.delivery ? <Pill text="Delivery" icon="bicycle" /> : null}{s.productCount ? <Pill text={`${s.productCount} items`} /> : null}
            </View>
          </Card>
        ))}
    </Screen>
  );
}

export function StoreDetail() {
  const { params } = useRoute<any>(); const slug = params.slug;
  const nav = useNavigation<any>();
  const res = useLoad(() => api<any>(`/api/v1/stores/${slug}`), [slug]);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [fulfil, setFulfil] = useState<'pickup' | 'delivery'>('pickup'); const [payMethod, setPay] = useState<'online' | 'pay_at_store'>('online');
  const [addr, setAddr] = useState(''); const [busy, setBusy] = useState(false); const [pay, setPayIntent] = useState<any>(null);
  const [book, setBook] = useState<any>(null);
  const key = React.useRef(newKey('so'));
  const d = res.data;
  if (res.loading && !d) return <Screen header={<Header title="Shop" />}><SkeletonRows /></Screen>;
  if (res.error || !d) return <Screen header={<Header title="Shop" />}><ErrorState message={res.error || 'Not found'} retry={() => res.reload()} /></Screen>;
  const st = d.store;
  const lines = d.products.filter((p: any) => cart[p.id]);
  const subtotal = lines.reduce((s: number, p: any) => s + p.price_paise * cart[p.id], 0);
  const fee = fulfil === 'delivery' ? st.deliveryFeePaise : 0;
  const change = (id: number, n: number, max: number | null) => setCart((c) => { const v = Math.max(0, Math.min(max ?? 99, (c[id] || 0) + n)); const o = { ...c }; if (v) o[id] = v; else delete o[id]; return o; });
  const order = async () => {
    setBusy(true);
    try {
      const r = await api<any>(`/api/v1/stores/${slug}/orders`, { method: 'POST', body: { items: lines.map((p: any) => ({ productId: p.id, qty: cart[p.id] })), fulfillment: fulfil, address: addr, payMethod, idempotencyKey: key.current } });
      if (r.payment) setPayIntent({ ...r.payment, orderId: r.order.id }); else { toast('Order placed. Pay at the shop.'); setCart({}); key.current = newKey('so'); nav.navigate('MyStoreOrders'); }
    } catch (e: any) { notify('Could not place order', e.message); } finally { setBusy(false); }
  };
  const payNow = async () => { setBusy(true); try { await api(`/api/v1/payments/${pay.id}/simulate`, { method: 'POST', body: {} }); toast('Paid. The shop has your order.'); setPayIntent(null); setCart({}); key.current = newKey('so'); nav.navigate('MyStoreOrders'); } catch (e: any) { notify('Payment problem', e.message); } finally { setBusy(false); } };
  return (
    <Screen header={<Header title={st.name} subtitle={st.city} />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      <Card style={{ gap: 4 }}>
        <Txt color={colors.sub}>{st.description}</Txt><Txt variant="small" color={colors.sub}>{st.address}</Txt>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{st.verified ? <Pill text="Verified" icon="shield-checkmark" color={colors.buy} bg={colors.buySoft} /> : null}{st.rating?.n ? <Pill text={`${st.rating.avg} ★ (${st.rating.n})`} /> : null}</View>
      </Card>
      {d.services.length ? <><SectionTitle title="Book an appointment" />{d.services.map((s: any) => <Card key={s.id} onPress={() => setBook(book?.id === s.id ? null : s)} style={{ marginBottom: 8 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><View style={{ flex: 1 }}><Txt bold>{s.name}</Txt><Txt variant="small" color={colors.sub}>{s.duration_min} min</Txt></View><Txt bold color={colors.primary}>{rs(s.price_paise)}</Txt></View>{book?.id === s.id ? <Booking slug={slug} service={s} onDone={() => { setBook(null); nav.navigate('MyStoreOrders'); }} /> : null}</Card>)}</> : null}
      {d.products.length ? <SectionTitle title="Shop" /> : null}
      {d.products.map((p: any) => (
        <Card key={p.id} style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: p.in_stock ? 1 : 0.5 }}>
          <View style={{ flex: 1 }}><Txt bold>{p.name}</Txt><Txt color={colors.primary} bold>{rs(p.price_paise)}<Txt variant="small" color={colors.sub}> / {p.unit}</Txt></Txt>{!p.in_stock ? <Txt variant="small" color={colors.danger}>Out of stock</Txt> : null}</View>
          {p.in_stock ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {cart[p.id] ? <><Pressable accessibilityRole="button" accessibilityLabel={`Less ${p.name}`} onPress={() => change(p.id, -1, p.available)}><Ionicons name="remove-circle" size={32} color={colors.sub} /></Pressable><Txt bold>{cart[p.id]}</Txt></> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`Add ${p.name}`} onPress={() => change(p.id, 1, p.available)}><Ionicons name="add-circle" size={32} color={colors.primary} /></Pressable></View> : null}
        </Card>
      ))}
      {lines.length ? (
        <Card style={{ marginTop: 10, gap: 8 }}>
          <Txt variant="h2">Your order</Txt>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{st.pickup ? <Chip label="Pick up" selected={fulfil === 'pickup'} onPress={() => setFulfil('pickup')} /> : null}{st.delivery ? <Chip label={`Delivery (${rs(st.deliveryFeePaise)})`} selected={fulfil === 'delivery'} onPress={() => setFulfil('delivery')} /> : null}</View>
          {fulfil === 'delivery' ? <Input label="Delivery address" value={addr} onChangeText={setAddr} multiline /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}><Chip label="Pay now" selected={payMethod === 'online'} onPress={() => setPay('online')} /><Chip label="Pay at the shop" selected={payMethod === 'pay_at_store'} onPress={() => setPay('pay_at_store')} /></View>
          {pay ? <><Txt color={colors.warn} variant="small">Test mode: no real money moves.</Txt><Button title={`Pay ${rs(pay.amountPaise)}`} onPress={payNow} loading={busy} /></> : <Button title={`Place order · ${rs(subtotal + fee)}`} icon="bag-check" onPress={order} loading={busy} />}
        </Card>
      ) : null}
      {d.reviews.length ? <><SectionTitle title="Reviews" />{d.reviews.slice(0, 5).map((r: any, i: number) => <Card key={i} style={{ marginBottom: 6 }}><Txt bold>{r.name} · {r.rating} ★</Txt><Txt color={colors.sub}>{r.comment}</Txt></Card>)}</> : null}
    </Screen>
  );
}

function Booking({ slug, service, onDone }: { slug: string; service: any; onDone: () => void }) {
  const days = Array.from({ length: 5 }, (_, i) => { const t = new Date(Date.now() + i * 86400000 + 19800000); return t.toISOString().slice(0, 10); });
  const [date, setDate] = useState(days[0]); const [busy, setBusy] = useState(false);
  const slots = useLoad(() => api<{ slots: any[] }>(`/api/v1/stores/${slug}/slots?serviceId=${service.id}&date=${date}`), [date]);
  const go = async (s: any) => {
    setBusy(true);
    try { await api(`/api/v1/stores/${slug}/appointments`, { method: 'POST', body: { serviceId: service.id, startTs: s.startTs, staffMemberId: s.staffMemberId } }); toast('Appointment requested'); onDone(); }
    catch (e: any) { notify('Could not book', e.message); void slots.reload(true); } finally { setBusy(false); }
  };
  return (
    <View style={{ marginTop: 10, gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{days.map((x) => <Chip key={x} label={new Date(x).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })} selected={x === date} onPress={() => setDate(x)} />)}</View>
      {slots.loading && !slots.data ? <SkeletonRows count={1} avatar={false} /> : !slots.data?.slots.length ? <Txt color={colors.sub}>No free times that day.</Txt> :
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{slots.data.slots.slice(0, 24).map((s) => <Chip key={`${s.startTs}-${s.staffMemberId}`} label={new Date(s.startTs + 19800000).toISOString().slice(11, 16)} onPress={() => !busy && go(s)} />)}</View>}
    </View>
  );
}

export function MyStoreOrders() {
  const [tab, setTab] = useState<'orders' | 'appts'>('orders');
  const orders = useLoad(() => api<{ orders: any[] }>('/api/v1/me/store-orders'), []);
  const appts = useLoad(() => api<{ appointments: any[] }>('/api/v1/me/appointments'), []);
  const cancel = async (kind: 'store-orders' | 'appointments', id: number) => {
    if (!(await confirmDialog('Cancel?', 'This cannot be undone.', 'Cancel it', true))) return;
    try { await api(`/api/v1/me/${kind}/${id}/cancel`, { method: 'POST', body: {} }); toast('Cancelled'); void orders.reload(true); void appts.reload(true); } catch (e: any) { notify('Could not cancel', e.message); }
  };
  const r = tab === 'orders' ? orders : appts;
  return (
    <Screen header={<Header title="My shop orders" />} refresh={{ refreshing: r.refreshing, onRefresh: r.refresh }}>
      <Segmented options={[{ id: 'orders', label: 'Orders' }, { id: 'appts', label: 'Appointments' }]} value={tab} onChange={setTab} />
      {r.loading && !r.data ? <SkeletonRows /> : r.error ? <ErrorState message={r.error} retry={() => r.reload()} /> : tab === 'orders' ? (!orders.data?.orders.length ? <Empty icon="bag" title="No orders yet" text="Orders from local shops show up here." /> :
        orders.data.orders.map((o) => (
          <Card key={o.id} style={{ marginBottom: 8, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt bold>{o.store.name}</Txt><Txt bold>{rs(o.total_paise)}</Txt></View>
            <Txt variant="small" color={colors.sub}>{o.items.map((i: any) => `${i.qty}× ${i.name}`).join(', ')}</Txt>
            <View style={{ flexDirection: 'row', gap: 6 }}><Pill text={o.status.replace(/_/g, ' ')} /><Pill text={o.fulfillment} /></View>
            {['pending_payment', 'confirmed'].includes(o.status) ? <Button compact variant="light" title="Cancel order" onPress={() => cancel('store-orders', o.id)} /> : null}
          </Card>
        )))
        : (!appts.data?.appointments.length ? <Empty icon="calendar" title="No appointments" text="Book a clinic or service from a shop page." /> :
          appts.data.appointments.map((a: any) => (
            <Card key={a.id} style={{ marginBottom: 8, gap: 4 }}>
              <Txt bold>{a.service} · {a.business || a.store_name || ''}</Txt><Txt variant="small" color={colors.sub}>{fmtDate(a.start_ts)}</Txt><Pill text={a.status.replace('_', ' ')} />
              {['requested', 'confirmed'].includes(a.status) ? <Button compact variant="light" title="Cancel" onPress={() => cancel('appointments', a.id)} /> : null}
            </Card>
          )))}
    </Screen>
  );
}

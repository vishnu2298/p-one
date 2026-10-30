import React, { useState } from 'react';
import { Linking, Switch, View } from 'react-native';
import { api } from '../../api';
import { useLoad } from '../../hooks';
import { Button, Card, Chip, Empty, ErrorState, Input, Pill, SectionTitle, SkeletonRows, Txt, confirmDialog, notify, toast } from '../../ui';
import { Segmented } from '../../motion';
import { colors } from '../../theme';
import { BizScreen, Line, bizPath, fmtDate, rs, toPaise } from '../../biz';

const ROLE_HELP: Record<string, string> = { manager: 'Everything except owner settings', cashier: 'Billing and customers only', inventory: 'Stock and purchases', accountant: 'Books and reports', doctor: 'Appointments and clinical notes', receptionist: 'Appointments and customers' };

export function BizTeam() { return <BizScreen title="Team" need="team.manage">{(b) => <Team bizId={b.id} />}</BizScreen>; }
function Team({ bizId }: { bizId: number }) {
  const res = useLoad(() => api<{ members: any[] }>(bizPath(bizId, '/members')), [bizId]);
  const [role, setRole] = useState('cashier'); const [phone, setPhone] = useState(''); const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try { const r = await api<{ added: boolean }>(bizPath(bizId, '/members'), { method: 'POST', body: { role, phone } }); setPhone(''); toast(r.added ? 'Added to your team' : 'Invite saved. They join when they sign up'); void res.reload(true); }
    catch (e: any) { notify('Could not add', e.message); } finally { setBusy(false); }
  };
  const remove = async (m: any) => {
    if (!(await confirmDialog('Remove from team?', m.name || m.invite_phone || 'This person', 'Remove', true))) return;
    try { await api(bizPath(bizId, `/members/${m.id}`), { method: 'DELETE' }); void res.reload(true); } catch (e: any) { notify('Could not remove', e.message); }
  };
  return (
    <>
      <Card style={{ marginBottom: 14 }}>
        <Txt variant="h2" style={{ marginBottom: 8 }}>Add someone</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>{Object.keys(ROLE_HELP).map((r) => <Chip key={r} label={r} selected={role === r} onPress={() => setRole(r)} />)}</View>
        <Txt variant="small" color={colors.sub} style={{ marginBottom: 12 }}>{ROLE_HELP[role]}</Txt>
        <Input label="Their phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Button title="Add to team" onPress={add} loading={busy} disabled={phone.trim().length < 8} />
      </Card>
      {res.loading && !res.data ? <SkeletonRows /> : res.error ? <ErrorState message={res.error} retry={() => res.reload()} /> :
        res.data?.members.map((m) => (
          <Card key={m.id} style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}><Txt bold>{m.name || m.invite_phone || m.invite_email}</Txt><View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}><Pill text={m.role} />{m.status === 'invited' ? <Pill text="Invited" color={colors.warn} bg={colors.warnSoft} /> : null}</View></View>
            {m.role !== 'owner' ? <Button compact title="Remove" variant="light" onPress={() => remove(m)} /> : null}
          </Card>
        ))}
    </>
  );
}

export function BizStore() { return <BizScreen title="Online shop" need="storefront.manage">{(b) => <Store bizId={b.id} />}</BizScreen>; }
const FLOW: Record<string, string[]> = { confirmed: ['preparing', 'cancelled'], preparing: ['ready', 'out_for_delivery'], ready: ['completed'], out_for_delivery: ['completed'] };
function Store({ bizId }: { bizId: number }) {
  const [tab, setTab] = useState<'orders' | 'settings'>('orders');
  const orders = useLoad(() => api<{ orders: any[] }>(bizPath(bizId, '/store-orders')), [bizId]);
  const biz = useLoad(() => api<{ business: any }>(bizPath(bizId, '')), [bizId]);
  const [form, setForm] = useState<any>({});
  const b = biz.data?.business;
  const v = (k: string, d: any) => (form[k] !== undefined ? form[k] : d);
  const save = async () => {
    try { await api(bizPath(bizId, '/storefront'), { method: 'PATCH', body: form }); setForm({}); toast('Shop updated'); void biz.reload(true); } catch (e: any) { notify('Could not save', e.message); }
  };
  const move = async (o: any, status: string) => {
    try { await api(bizPath(bizId, `/store-orders/${o.id}/status`), { method: 'POST', body: { status } }); void orders.reload(true); } catch (e: any) { notify('Could not update', e.message); }
  };
  return (
    <>
      <Segmented options={[{ id: 'orders', label: 'Orders' }, { id: 'settings', label: 'Settings' }]} value={tab} onChange={setTab} />
      {tab === 'orders' ? (orders.loading && !orders.data ? <SkeletonRows /> : orders.error ? <ErrorState message={orders.error} retry={() => orders.reload()} /> : !orders.data?.orders.length ? <Empty icon="bag" title="No online orders yet" text="Share your shop link and orders will land here." /> :
        orders.data.orders.map((o) => (
          <Card key={o.id} style={{ marginBottom: 8, gap: 4 }}>
            <Line label={`#${o.id} · ${o.buyer_name}`} value={rs(o.total_paise)} bold />
            <Txt variant="small" color={colors.sub}>{o.items.map((i: any) => `${i.qty}× ${i.name}`).join(', ')}</Txt>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Pill text={o.status.replace(/_/g, ' ')} /><Pill text={o.fulfillment} icon={o.fulfillment === 'delivery' ? 'bicycle' : 'storefront'} />{o.pay_method === 'online' ? <Pill text="Paid online" color={colors.buy} bg={colors.buySoft} /> : o.pay_method === 'pay_at_store' ? <Pill text="Pay at store" color={colors.warn} bg={colors.warnSoft} /> : null}</View>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{(FLOW[o.status] || []).map((s) => <Button key={s} compact variant={s === 'cancelled' ? 'light' : 'primary'} title={({ preparing: 'Start preparing', ready: 'Mark ready', out_for_delivery: 'Out for delivery', completed: 'Hand over', cancelled: 'Cancel' } as any)[s]} onPress={() => move(o, s)} />)}</View>
          </Card>
        ))) : !b ? <SkeletonRows /> : (
        <Card>
          <Row2 label="Shop is open to the public" value={v('enabled', !!b.storefront_enabled)} on={(x) => setForm({ ...form, enabled: x })} />
          <Row2 label="Customers can pick up" value={v('pickupEnabled', !!b.pickup_enabled)} on={(x) => setForm({ ...form, pickupEnabled: x })} />
          <Row2 label="Home delivery" value={v('deliveryEnabled', !!b.delivery_enabled)} on={(x) => setForm({ ...form, deliveryEnabled: x })} />
          <Input label="Delivery fee ₹" value={form.fee ?? String((b.delivery_fee_paise || 0) / 100)} onChangeText={(t) => setForm({ ...form, fee: t, deliveryFeePaise: toPaise(t) || 0 })} keyboardType="decimal-pad" />
          <Input label="Shop link" value={v('slug', b.public_slug)} onChangeText={(t) => setForm({ ...form, slug: t.toLowerCase() })} autoCapitalize="none" hint="Mark products as 'Show in my online shop' from the Products screen." />
          <Button title="Save" onPress={save} disabled={!Object.keys(form).length} />
        </Card>
      )}
    </>
  );
}
const Row2 = ({ label, value, on }: { label: string; value: boolean; on: (v: boolean) => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 }}><Txt bold style={{ flex: 1 }}>{label}</Txt><Switch value={value} onValueChange={on} trackColor={{ true: colors.primary }} /></View>
);

export function BizAppointments() { return <BizScreen title="Appointments" need="appointments.manage">{(b, can) => <Appts bizId={b.id} can={can} />}</BizScreen>; }
function Appts({ bizId, can }: { bizId: number; can: (p: string) => boolean }) {
  const res = useLoad(() => api<{ appointments: any[] }>(bizPath(bizId, '/appointments')), [bizId]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const set = async (a: any, status: string) => { try { await api(bizPath(bizId, `/appointments/${a.id}`), { method: 'PATCH', body: { status } }); void res.reload(true); } catch (e: any) { notify('Could not update', e.message); } };
  const complete = async (a: any) => {
    try { await api(bizPath(bizId, `/appointments/${a.id}/complete`), { method: 'POST', body: {} }); toast('Visit billed'); void res.reload(true); } catch (e: any) { notify('Could not complete', e.message); }
  };
  const note = async (a: any) => {
    if (!a.customer_id) return notify('No patient record', 'Complete the visit first so a patient record exists.');
    try { await api(bizPath(bizId, `/customers/${a.customer_id}/clinical-notes`), { method: 'POST', body: { text: notes[a.id], consent: true, appointmentId: a.id } }); setNotes((x) => ({ ...x, [a.id]: '' })); toast('Note saved securely'); } catch (e: any) { notify('Could not save note', e.message); }
  };
  if (res.loading && !res.data) return <SkeletonRows />;
  if (res.error) return <ErrorState message={res.error} retry={() => res.reload()} />;
  if (!res.data?.appointments.length) return <Empty icon="calendar" title="No appointments" text="Bookings from your public page appear here." />;
  return <>{res.data.appointments.map((a) => (
    <Card key={a.id} style={{ marginBottom: 8, gap: 4 }}>
      <Line label={`${a.service} · ${a.customer_name || 'Patient'}`} value={rs(a.price_paise)} bold />
      <Txt variant="small" color={colors.sub}>{fmtDate(a.start_ts)}</Txt>
      <Pill text={a.status.replace('_', ' ')} />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {a.status === 'requested' ? <Button compact title="Confirm" onPress={() => set(a, 'confirmed')} /> : null}
        {['requested', 'confirmed'].includes(a.status) ? <Button compact variant="light" title="Cancel" onPress={() => set(a, 'cancelled')} /> : null}
        {a.status === 'confirmed' ? <Button compact variant="sell" title="Complete and bill" onPress={() => complete(a)} /> : null}
      </View>
      {can('clinical.write') && a.status === 'completed' ? <><Input label="Private clinical note (encrypted)" value={notes[a.id] || ''} onChangeText={(t) => setNotes((x) => ({ ...x, [a.id]: t }))} multiline /><Button compact title="Save note" onPress={() => note(a)} disabled={!notes[a.id]} /></> : null}
    </Card>
  ))}</>;
}

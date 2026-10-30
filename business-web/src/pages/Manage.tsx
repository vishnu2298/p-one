import { useState } from 'react';
import { useWs } from '../App';
import { api, bp, rs, toPaise } from '../api';
import { Async, Btn, Card, Chips, Empty, Field, Head, Pill, useLoad, useToast } from '../ui';

const ROLE_HELP: Record<string, string> = { manager: 'Everything except owner settings', cashier: 'Billing and customers only', inventory: 'Stock and purchases', accountant: 'Books and reports', doctor: 'Appointments and clinical notes', receptionist: 'Appointments and customers' };
export function Team() {
  const { biz } = useWs(); const toast = useToast(); const [role, setRole] = useState('cashier'); const [phone, setPhone] = useState('');
  const res = useLoad(() => api<{ members: any[] }>(bp(biz.id, '/members')), [biz.id]);
  const add = async () => { try { const r = await api(bp(biz.id, '/members'), { method: 'POST', body: { role, phone } }); setPhone(''); toast(r.added ? 'Added to your team' : 'Invite saved. They join when they sign up'); res.reload(); } catch (e: any) { toast(e.message); } };
  const remove = async (m: any) => { if (!confirm('Remove this person?')) return; try { await api(bp(biz.id, `/members/${m.id}`), { method: 'DELETE' }); res.reload(); } catch (e: any) { toast(e.message); } };
  return (
    <>
      <Head title="Team" sub="Who can do what" />
      <Card><h2>Add someone</h2><Chips options={Object.keys(ROLE_HELP).map((r) => [r, r] as [string, string])} value={role as any} onChange={setRole} /><p className="small sub">{ROLE_HELP[role]}</p>
        <div className="row"><input style={{ maxWidth: 260 }} placeholder="Their phone number" value={phone} onChange={(e) => setPhone(e.target.value)} /><Btn p onClick={add} disabled={phone.trim().length < 8}>Add to team</Btn></div></Card>
      <Card><Async res={res}>{(d) => <table><tbody>{d.members.map((m) => <tr key={m.id}><td className="bold">{m.name || m.invite_phone || m.invite_email}</td><td><Pill>{m.role}</Pill> {m.status === 'invited' ? <Pill tone="warn">Invited</Pill> : null}</td><td className="right">{m.role !== 'owner' ? <Btn s d onClick={() => remove(m)}>Remove</Btn> : null}</td></tr>)}</tbody></table>}</Async></Card>
    </>
  );
}

const FLOW: Record<string, [string, string][]> = { confirmed: [['preparing', 'Start preparing'], ['cancelled', 'Cancel']], preparing: [['ready', 'Mark ready'], ['out_for_delivery', 'Out for delivery']], ready: [['completed', 'Hand over']], out_for_delivery: [['completed', 'Delivered']] };
export function Shop() {
  const { biz } = useWs(); const toast = useToast(); const [form, setForm] = useState<any>({});
  const orders = useLoad(() => api<{ orders: any[] }>(bp(biz.id, '/store-orders')), [biz.id]);
  const info = useLoad(() => api<{ business: any }>(bp(biz.id, '')), [biz.id]);
  const move = async (o: any, status: string) => { try { await api(bp(biz.id, `/store-orders/${o.id}/status`), { method: 'POST', body: { status } }); orders.reload(); } catch (e: any) { toast(e.message); } };
  const save = async () => { try { await api(bp(biz.id, '/storefront'), { method: 'PATCH', body: form }); setForm({}); toast('Shop updated'); info.reload(); } catch (e: any) { toast(e.message); } };
  const b = info.data?.business; const v = (k: string, d: any) => (form[k] !== undefined ? form[k] : d);
  const link = b ? b.public_slug : "";
  return (
    <>
      <Head title="Online shop" sub="Orders from customers and how your shop works" />
      <div className="grid two" style={{ alignItems: 'start' }}>
        <Card><h2>Orders</h2><Async res={orders}>{(d) => !d.orders.length ? <Empty title="No online orders yet" text="Turn on products with “Show in my online shop”, then share your link." /> : d.orders.map((o) => <div key={o.id} className="card" style={{ marginBottom: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><b>#{o.id} · {o.buyer_name}</b><b>{rs(o.total_paise)}</b></div>
          <div className="small sub">{o.items.map((i: any) => `${i.qty}× ${i.name}`).join(', ')}</div>
          <div className="row" style={{ marginTop: 8 }}><Pill>{o.status.replace(/_/g, ' ')}</Pill><Pill>{o.fulfillment}</Pill>{o.pay_method === 'online' ? <Pill tone="good">Paid online</Pill> : <Pill tone="warn">Pay at shop</Pill>}
            {(FLOW[o.status] || []).map(([s, l]) => <Btn key={s} s d={s === 'cancelled'} onClick={() => move(o, s)}>{l}</Btn>)}</div></div>)}</Async></Card>
        <Card><h2>Settings</h2>{!b ? null : <>
          <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" style={{ width: 20 }} checked={v('enabled', !!b.storefront_enabled)} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Shop is open to the public</label>
          <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" style={{ width: 20 }} checked={v('pickupEnabled', !!b.pickup_enabled)} onChange={(e) => setForm({ ...form, pickupEnabled: e.target.checked })} />Customers can pick up</label>
          <label className="row" style={{ marginBottom: 10 }}><input type="checkbox" style={{ width: 20 }} checked={v('deliveryEnabled', !!b.delivery_enabled)} onChange={(e) => setForm({ ...form, deliveryEnabled: e.target.checked })} />Home delivery</label>
          <Field label="Delivery fee (₹)"><input type="number" value={form.fee ?? String((b.delivery_fee_paise || 0) / 100)} onChange={(e) => setForm({ ...form, fee: e.target.value, deliveryFeePaise: toPaise(e.target.value) || 0 })} /></Field>
          <Field label="Shop link name" hint={`Customers find you in the Connectly app under Local shops as "${link}"`}><input value={v('slug', b.public_slug)} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} /></Field>
          <Btn p onClick={save} disabled={!Object.keys(form).length}>Save</Btn></>}</Card>
      </div>
    </>
  );
}

export function Appointments() {
  const { biz, can } = useWs(); const toast = useToast(); const [notes, setNotes] = useState<Record<number, string>>({});
  const res = useLoad(() => api<{ appointments: any[] }>(bp(biz.id, '/appointments')), [biz.id]);
  const act = async (fn: () => Promise<any>, msg?: string) => { try { await fn(); if (msg) toast(msg); res.reload(); } catch (e: any) { toast(e.message); } };
  return (
    <>
      <Head title="Appointments" />
      <Card><Async res={res}>{(d) => !d.appointments.length ? <Empty title="No appointments" text="Bookings from your shop page appear here." /> : <table><thead><tr><th>When</th><th>Service</th><th>Patient or customer</th><th>Status</th><th /></tr></thead><tbody>{d.appointments.map((a) => <tr key={a.id}>
        <td>{new Date(a.start_ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td><td className="bold">{a.service} <span className="sub small">{rs(a.price_paise)}</span></td><td>{a.customer_name}</td><td><Pill>{a.status.replace('_', ' ')}</Pill></td>
        <td className="right"><div className="row" style={{ justifyContent: 'flex-end' }}>
          {a.status === 'requested' ? <Btn s onClick={() => act(() => api(bp(biz.id, `/appointments/${a.id}`), { method: 'PATCH', body: { status: 'confirmed' } }))}>Confirm</Btn> : null}
          {['requested', 'confirmed'].includes(a.status) ? <Btn s d onClick={() => act(() => api(bp(biz.id, `/appointments/${a.id}`), { method: 'PATCH', body: { status: 'cancelled' } }))}>Cancel</Btn> : null}
          {a.status === 'confirmed' ? <Btn s p onClick={() => act(() => api(bp(biz.id, `/appointments/${a.id}/complete`), { method: 'POST', body: {} }), 'Visit billed')}>Complete and bill</Btn> : null}
          {can('clinical.write') && a.status === 'completed' && a.customer_id ? <><input style={{ width: 180 }} placeholder="Private note" value={notes[a.id] || ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} /><Btn s onClick={() => act(() => api(bp(biz.id, `/customers/${a.customer_id}/clinical-notes`), { method: 'POST', body: { text: notes[a.id], consent: true, appointmentId: a.id } }).then(() => setNotes({ ...notes, [a.id]: '' })), 'Note saved securely')} disabled={!notes[a.id]}>Save</Btn></> : null}</div></td></tr>)}</tbody></table>}</Async></Card>
    </>
  );
}

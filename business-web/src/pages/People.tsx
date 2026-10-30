import { useState } from 'react';
import { useWs } from '../App';
import { api, bp, newKey, rs, toPaise, day } from '../api';
import { Async, Btn, Card, Chips, Empty, Field, Head, Modal, Pill, Line, useLoad, useToast } from '../ui';

export function Customers() {
  const { biz, can } = useWs(); const toast = useToast(); const [add, setAdd] = useState(false); const [sel, setSel] = useState<number | null>(null); const [f, setF] = useState({ name: '', phone: '' }); const [pay, setPay] = useState('');
  const res = useLoad(() => api<{ customers: any[] }>(bp(biz.id, '/customers')), [biz.id]);
  const det = useLoad(async () => (sel ? api<any>(bp(biz.id, `/customers/${sel}`)) : null), [biz.id, sel]);
  const save = async () => { try { await api(bp(biz.id, '/customers'), { method: 'POST', body: f }); setAdd(false); setF({ name: '', phone: '' }); toast('Customer added'); res.reload(); } catch (e: any) { toast(e.message); } };
  const settle = async () => { try { await api(bp(biz.id, `/customers/${sel}/payments`), { method: 'POST', body: { amountPaise: toPaise(pay), method: 'cash', idempotencyKey: newKey('khata') } }); setPay(''); toast('Payment received'); res.reload(); det.reload(); } catch (e: any) { toast(e.message); } };
  return (
    <>
      <Head title="Customers" right={can('customers.write') ? <Btn p onClick={() => setAdd(true)}>+ Add customer</Btn> : null} />
      <div className="grid two" style={{ alignItems: 'start' }}>
        <Card><Async res={res}>{(d) => !d.customers.length ? <Empty title="No customers yet" text="Add regulars to keep their bills and khata together." /> : (
          <table><thead><tr><th>Name</th><th>Phone</th><th className="right">Owes</th></tr></thead><tbody>{d.customers.map((c) => <tr key={c.id} className="click" onClick={() => setSel(c.id)}><td className="bold">{c.name}</td><td>{c.phone}</td><td className="right">{c.outstanding_paise ? <Pill tone="warn">{rs(c.outstanding_paise)}</Pill> : '—'}</td></tr>)}</tbody></table>)}</Async></Card>
        {sel ? <Card><Async res={det}>{(d) => d ? <>
          <h2>{d.customer.name}</h2><div className="sub small">{d.customer.phone}</div>
          {d.customer.outstanding_paise > 0 ? <p><Pill tone="warn">{rs(d.customer.outstanding_paise)} due</Pill></p> : null}
          {d.customer.outstanding_paise > 0 && can('sales.write') ? <div className="row"><input style={{ width: 140 }} type="number" placeholder="₹ received" value={pay} onChange={(e) => setPay(e.target.value)} /><Btn p onClick={settle} disabled={!(toPaise(pay) > 0)}>Record payment</Btn></div> : null}
          <h2 style={{ marginTop: 14 }}>Bills</h2>{d.invoices.length ? d.invoices.slice(0, 10).map((i: any) => <Line key={i.id} label={`${i.invoice_no} · ${day(i.created_at)}`} value={rs(i.total_paise)} />) : <span className="sub">No bills yet.</span>}</> : null}</Async></Card> : null}
      </div>
      {add ? <Modal title="New customer" onClose={() => setAdd(false)}><Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field><Field label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field><div className="row"><Btn p onClick={save} disabled={f.name.trim().length < 2}>Save</Btn><Btn onClick={() => setAdd(false)}>Cancel</Btn></div></Modal> : null}
    </>
  );
}

export function Purchases() {
  const { biz, can } = useWs(); const toast = useToast(); const [recv, setRecv] = useState(false); const [name, setName] = useState(''); const [pay, setPay] = useState<Record<number, string>>({});
  const sup = useLoad(() => api<{ suppliers: any[] }>(bp(biz.id, '/suppliers')), [biz.id]);
  const grn = useLoad(() => api<{ receipts: any[] }>(bp(biz.id, '/goods-receipts')).catch(() => ({ receipts: [] as any[] })), [biz.id]);
  const addSup = async () => { try { await api(bp(biz.id, '/suppliers'), { method: 'POST', body: { name } }); setName(''); sup.reload(); } catch (e: any) { toast(e.message); } };
  const paySup = async (s: any) => { try { await api(bp(biz.id, `/suppliers/${s.id}/payments`), { method: 'POST', body: { amountPaise: toPaise(pay[s.id] || ''), method: 'bank', idempotencyKey: newKey('sp') } }); setPay({ ...pay, [s.id]: '' }); toast('Payment recorded'); sup.reload(); } catch (e: any) { toast(e.message); } };
  return (
    <>
      <Head title="Purchases" sub="Suppliers and goods coming in" right={can('purchases.write') ? <Btn p onClick={() => setRecv(true)}>Receive goods</Btn> : null} />
      <Card><h2>Suppliers</h2>
        <Async res={sup}>{(d) => !d.suppliers.length ? <Empty title="No suppliers yet" /> : <table><thead><tr><th>Supplier</th><th className="right">You owe</th><th className="no-print" /></tr></thead><tbody>{d.suppliers.map((s) => <tr key={s.id}><td className="bold">{s.name}</td><td className="right">{s.outstanding_paise ? <Pill tone="warn">{rs(s.outstanding_paise)}</Pill> : <Pill tone="good">Settled</Pill>}</td>
          <td className="right">{s.outstanding_paise > 0 && can('purchases.write') ? <div className="row" style={{ justifyContent: 'flex-end' }}><input style={{ width: 110 }} type="number" placeholder="₹" value={pay[s.id] || ''} onChange={(e) => setPay({ ...pay, [s.id]: e.target.value })} /><Btn s onClick={() => paySup(s)} disabled={!(toPaise(pay[s.id] || '') > 0)}>Pay</Btn></div> : null}</td></tr>)}</tbody></table>}</Async>
        {can('suppliers.write') ? <div className="row" style={{ marginTop: 12 }}><input style={{ maxWidth: 260 }} placeholder="New supplier name" value={name} onChange={(e) => setName(e.target.value)} /><Btn onClick={addSup} disabled={name.trim().length < 2}>Add supplier</Btn></div> : null}
      </Card>
      <Card><h2>Recent goods received</h2><Async res={grn}>{(d) => d.receipts.length ? <table><tbody>{d.receipts.slice(0, 10).map((g: any) => <tr key={g.id}><td className="bold">{g.grn_no}</td><td>{day(g.created_at)}</td><td className="right">{rs(g.total_paise)}</td></tr>)}</tbody></table> : <span className="sub">Nothing received yet.</span>}</Async></Card>
      {recv ? <Receive suppliers={sup.data?.suppliers || []} onClose={() => setRecv(false)} onDone={() => { setRecv(false); sup.reload(); grn.reload(); toast('Stock received'); }} /> : null}
    </>
  );
}
function Receive({ suppliers, onClose, onDone }: { suppliers: any[]; onClose: () => void; onDone: () => void }) {
  const { biz } = useWs(); const [sid, setSid] = useState<number | ''>(''); const [lines, setLines] = useState<Record<number, string>>({}); const [paid, setPaid] = useState(''); const [err, setErr] = useState(''); const [key] = useState(newKey('grn'));
  const prods = useLoad(() => api<{ products: any[] }>(bp(biz.id, '/products?limit=300')), [biz.id]);
  const save = async () => {
    const items = Object.entries(lines).filter(([, q]) => Number(q) > 0).map(([id, q]) => ({ productId: Number(id), qty: Number(q) }));
    try { await api(bp(biz.id, '/goods-receipts'), { method: 'POST', body: { supplierId: sid, items, idempotencyKey: key, ...(toPaise(paid) > 0 ? { paidPaise: toPaise(paid), method: 'cash' } : {}) } }); onDone(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal title="Receive goods" onClose={onClose}>
      <Field label="Supplier"><select value={sid} onChange={(e) => setSid(Number(e.target.value))}><option value="">Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <div style={{ maxHeight: 280, overflowY: 'auto' }}><table><tbody>{(prods.data?.products || []).filter((p) => !p.is_service).map((p) => <tr key={p.id}><td>{p.name}<div className="small sub">have {p.qty} · cost {rs(p.purchase_price_paise)}</div></td><td style={{ width: 100 }}><input type="number" placeholder="Qty" value={lines[p.id] || ''} onChange={(e) => setLines({ ...lines, [p.id]: e.target.value })} /></td></tr>)}</tbody></table></div>
      <Field label="Paid to supplier now (₹, optional)"><input type="number" value={paid} onChange={(e) => setPaid(e.target.value)} /></Field>
      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
      <div className="row"><Btn p onClick={save} disabled={!sid || !Object.values(lines).some((q) => Number(q) > 0)}>Receive</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

const EXP: [string, string][] = [['6000', 'Rent'], ['6010', 'Salaries'], ['6020', 'Utilities'], ['6030', 'Marketing'], ['6040', 'Transport'], ['6090', 'Other']];
export function Expenses() {
  const { biz, can } = useWs(); const toast = useToast(); const [code, setCode] = useState('6000'); const [amt, setAmt] = useState(''); const [memo, setMemo] = useState('');
  const res = useLoad(() => api<{ expenses: any[] }>(bp(biz.id, '/expenses')), [biz.id]);
  const add = async () => { try { await api(bp(biz.id, '/expenses'), { method: 'POST', body: { accountCode: code, amountPaise: toPaise(amt), memo, method: 'cash', idempotencyKey: newKey('exp') } }); setAmt(''); setMemo(''); toast('Expense saved'); res.reload(); } catch (e: any) { toast(e.message); } };
  return (
    <>
      <Head title="Expenses" />
      {can('expenses.write') ? <Card><h2>Add an expense</h2><Chips options={EXP} value={code as any} onChange={setCode} /><div className="row" style={{ marginTop: 12 }}><input style={{ width: 150 }} type="number" placeholder="Amount ₹" value={amt} onChange={(e) => setAmt(e.target.value)} /><input className="grow" placeholder="Note" value={memo} onChange={(e) => setMemo(e.target.value)} /><Btn p onClick={add} disabled={!(toPaise(amt) > 0)}>Add</Btn></div></Card> : null}
      <Card><Async res={res}>{(d) => d.expenses.length ? <table><thead><tr><th>Date</th><th>What</th><th className="right">Amount</th></tr></thead><tbody>{d.expenses.map((e: any) => <tr key={e.id}><td>{day(e.date || e.created_at)}</td><td>{e.note || e.payee || e.account_code}</td><td className="right">{rs(e.amount_paise)}</td></tr>)}</tbody></table> : <Empty title="No expenses yet" />}</Async></Card>
    </>
  );
}

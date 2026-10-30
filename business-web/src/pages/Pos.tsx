import { useCallback, useEffect, useRef, useState } from 'react';
import { useWs, go } from '../App';
import { ApiError, api, bp, newKey, rs, toPaise } from '../api';
import { Btn, Card, Chips, Field, Head, Line, useDebounced, useLoad, useToast } from '../ui';

type CartLine = { id: number; name: string; price: number; qty: number };
type Queued = { key: string; bizId: number; body: any };
const QK = 'cb.queue';
const loadQ = (): Queued[] => { try { return JSON.parse(localStorage.getItem(QK) || '[]'); } catch { return []; } };
const saveQ = (q: Queued[]) => localStorage.setItem(QK, JSON.stringify(q));

async function flush(): Promise<number> {
  const left: Queued[] = []; let sent = 0;
  for (const x of loadQ()) {
    try { await api(bp(x.bizId, '/sales'), { method: 'POST', body: { ...x.body, idempotencyKey: x.key } }); sent++; }
    catch (e: any) { if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) continue; left.push(x); }
  }
  saveQ(left); return sent;
}

export function Pos() {
  const { biz } = useWs(); const toast = useToast();
  const [q, setQ] = useState(''); const dq = useDebounced(q, 200);
  const prods = useLoad(() => api<{ products: any[] }>(bp(biz.id, `/products?q=${encodeURIComponent(dq)}&limit=60`)), [biz.id, dq]);
  const custs = useLoad(() => api<{ customers: any[] }>(bp(biz.id, '/customers')).catch(() => ({ customers: [] as any[] })), [biz.id]);
  const [cart, setCart] = useState<CartLine[]>([]); const [cust, setCust] = useState<number | ''>(''); const [method, setMethod] = useState('cash'); const [paid, setPaid] = useState(''); const [busy, setBusy] = useState(false); const [pending, setPending] = useState(loadQ().length);
  const attempt = useRef<{ sig: string; key: string } | null>(null); const search = useRef<HTMLInputElement>(null);

  const sync = useCallback(async () => { const n = await flush(); if (n) toast(`${n} offline bill${n > 1 ? 's' : ''} sent`); setPending(loadQ().length); }, [toast]);
  useEffect(() => { void sync(); window.addEventListener('online', sync); return () => window.removeEventListener('online', sync); }, [sync]);
  useEffect(() => { search.current?.focus(); }, []);

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const add = (p: any) => setCart((c) => { const i = c.findIndex((x) => x.id === p.id); return i >= 0 ? c.map((x, n) => (n === i ? { ...x, qty: x.qty + 1 } : x)) : [...c, { id: p.id, name: p.name, price: p.selling_price_paise, qty: 1 }]; });
  const bump = (id: number, d: number) => setCart((c) => c.map((x) => (x.id === id ? { ...x, qty: x.qty + d } : x)).filter((x) => x.qty > 0));
  const tendered = method === 'credit' ? (paid === '' ? 0 : Math.min(total, toPaise(paid) || 0)) : paid === '' ? total : Math.min(total, toPaise(paid) || 0);
  const items = prods.data?.products || [];

  // Scanner or Enter on an exact SKU/barcode adds the item straight away.
  const onEnter = () => { const hit = items.find((p) => p.barcode === q.trim() || p.sku.toLowerCase() === q.trim().toLowerCase()) || (items.length === 1 ? items[0] : null); if (hit) { add(hit); setQ(''); } };

  const checkout = async () => {
    if (!cart.length) return;
    if (tendered < total && !cust) return toast('Choose a customer for the part you are not collecting now');
    const body = { customerId: cust || undefined, items: cart.map((l) => ({ productId: l.id, qty: l.qty })), payments: tendered > 0 ? [{ method: method === 'credit' ? 'cash' : method, amountPaise: tendered }] : [] };
    const sig = JSON.stringify(body); if (attempt.current?.sig !== sig) attempt.current = { sig, key: newKey('pos') };
    const key = attempt.current.key; setBusy(true);
    try {
      const r = await api(bp(biz.id, '/sales'), { method: 'POST', body: { ...body, idempotencyKey: key } });
      attempt.current = null; setCart([]); setPaid(''); setCust(''); toast(`Bill ${r.invoice.invoice_no} saved`); go(`/sales/${r.invoice.id}`);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 0) { saveQ([...loadQ(), { key, bizId: biz.id, body }]); attempt.current = null; setCart([]); setPaid(''); setPending(loadQ().length); toast('Offline: saved on this computer and will be sent automatically'); }
      else toast(e.message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Head title="Billing" sub={pending ? `${pending} offline bill${pending > 1 ? 's' : ''} waiting to send` : 'Scan or search, then charge'} />
      <div className="pos">
        <div>
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter()} placeholder="Search item, SKU or scan barcode, then press Enter" aria-label="Search items" style={{ marginBottom: 12 }} />
          <div className="products">{items.map((p) => <button key={p.id} className="tile" disabled={!p.is_service && p.available <= 0} onClick={() => add(p)}><div className="bold">{p.name}</div><div style={{ color: 'var(--primary)' }} className="bold">{rs(p.selling_price_paise)}</div><div className="small sub">{p.is_service ? 'Service' : `${p.available} in stock`}</div></button>)}</div>
          {!items.length && !prods.loading ? <p className="sub">No items found.</p> : null}
        </div>
        <Card>
          <h2>Current bill</h2>
          {!cart.length ? <p className="sub">Click an item to add it.</p> : cart.map((l) => <div key={l.id} className="row" style={{ padding: '4px 0' }}>
            <span className="grow">{l.name}</span><Btn s onClick={() => bump(l.id, -1)} aria-label={`Less ${l.name}`}>−</Btn><b>{l.qty}</b><Btn s onClick={() => bump(l.id, 1)} aria-label={`More ${l.name}`}>+</Btn><span className="right bold" style={{ width: 80 }}>{rs(l.price * l.qty)}</span></div>)}
          {cart.length ? <>
            <hr style={{ border: 0, borderTop: '1px solid var(--line)' }} />
            <Line label="Total (GST included)" value={rs(total)} bold />
            <Field label="Customer"><select value={cust} onChange={(e) => setCust(e.target.value ? Number(e.target.value) : '')}><option value="">Walk-in</option>{(custs.data?.customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Payment"><Chips options={[['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['credit', 'On credit']]} value={method as any} onChange={(v) => { setMethod(v); setPaid(''); }} /></Field>
            <Field label={method === 'credit' ? 'Paid now (₹), rest goes to khata' : 'Amount received (₹)'}><input type="number" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={method === 'credit' ? '0' : String(total / 100)} /></Field>
            {tendered < total ? <p className="small" style={{ color: 'var(--warn)' }}>{rs(total - tendered)} will be added to the customer's khata.</p> : null}
            <Btn p onClick={checkout} disabled={busy} style={{ width: '100%', padding: 14 }}>Charge {rs(total)}</Btn></> : null}
        </Card>
      </div>
    </>
  );
}

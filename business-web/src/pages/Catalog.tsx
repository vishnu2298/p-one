import { useState } from 'react';
import { useWs } from '../App';
import { api, bp, rs, toPaise } from '../api';
import { Async, Btn, Card, Chips, Empty, Field, Head, Modal, Pill, useDebounced, useLoad, useToast } from '../ui';

export function Products() {
  const { biz, can } = useWs(); const toast = useToast(); const [q, setQ] = useState(''); const dq = useDebounced(q); const [edit, setEdit] = useState<any | null>(null);
  const res = useLoad(() => api<{ products: any[] }>(bp(biz.id, `/products?q=${encodeURIComponent(dq)}&limit=300`)), [biz.id, dq]);
  return (
    <>
      <Head title="Products and services" right={can('products.write') ? <Btn p onClick={() => setEdit({})}>+ Add</Btn> : null} />
      <Card>
        <input placeholder="Search name, SKU or barcode" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 340, marginBottom: 12 }} />
        <Async res={res}>{(d) => !d.products.length ? <Empty title="No products yet" text="Add what you sell to start billing." /> : (
          <div className="tablewrap"><table><thead><tr><th>Name</th><th>SKU</th><th className="right">Price</th><th className="right">GST</th><th className="right">Stock</th><th>Online</th></tr></thead><tbody>
            {d.products.map((p) => <tr key={p.id} className={can('products.write') ? 'click' : ''} onClick={() => can('products.write') && setEdit(p)}><td className="bold">{p.name}</td><td>{p.sku}</td><td className="right">{rs(p.selling_price_paise)}</td><td className="right">{p.tax_bps / 100}%</td>
              <td className="right">{p.is_service ? <span className="sub">Service</span> : <Pill tone={p.low ? 'bad' : 'good'}>{p.qty} {p.unit}</Pill>}</td><td>{p.published ? <Pill>Online</Pill> : ''}</td></tr>)}
          </tbody></table></div>)}</Async>
      </Card>
      {edit ? <ProductForm p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); res.reload(); toast('Saved'); }} /> : null}
    </>
  );
}
function ProductForm({ p, onClose, onSaved }: { p: any; onClose: () => void; onSaved: () => void }) {
  const { biz } = useWs();
  const [f, setF] = useState({ name: p.name || '', sku: p.sku || '', barcode: p.barcode || '', price: p.id ? String(p.selling_price_paise / 100) : '', cost: p.id ? String(p.purchase_price_paise / 100) : '', gst: p.id ? String(p.tax_bps / 100) : '0', unit: p.unit || 'pcs', reorder: String(p.reorder_level || ''), opening: '', published: !!p.published, isService: !!p.is_service });
  const [err, setErr] = useState('');
  const save = async () => {
    try {
      const body: any = { name: f.name, sku: f.sku, barcode: f.barcode, sellingPricePaise: toPaise(f.price), purchasePricePaise: toPaise(f.cost) || 0, taxBps: Math.round(Number(f.gst) * 100), unit: f.unit, reorderLevel: Number(f.reorder) || 0, published: f.published, isService: f.isService };
      if (!p.id && f.opening) body.openingQty = Number(f.opening);
      await api(bp(biz.id, p.id ? `/products/${p.id}` : '/products'), { method: p.id ? 'PATCH' : 'POST', body }); onSaved();
    } catch (e: any) { setErr(e.message); }
  };
  const s = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={p.id ? 'Edit product' : 'New product'} onClose={onClose}>
      <Field label="Name"><input value={f.name} onChange={s('name')} /></Field>
      <div className="row"><div className="grow"><Field label="SKU"><input value={f.sku} onChange={s('sku')} /></Field></div><div className="grow"><Field label="Barcode"><input value={f.barcode} onChange={s('barcode')} /></Field></div></div>
      <div className="row"><div className="grow"><Field label="Selling price (₹, GST included)"><input type="number" value={f.price} onChange={s('price')} /></Field></div><div className="grow"><Field label="Cost (₹)"><input type="number" value={f.cost} onChange={s('cost')} /></Field></div></div>
      <div className="row"><div className="grow"><Field label="GST %"><input type="number" value={f.gst} onChange={s('gst')} /></Field></div><div className="grow"><Field label="Unit"><input value={f.unit} onChange={s('unit')} /></Field></div><div className="grow"><Field label="Low-stock alert at"><input type="number" value={f.reorder} onChange={s('reorder')} /></Field></div></div>
      {!p.id ? <Field label="Opening stock"><input type="number" value={f.opening} onChange={s('opening')} /></Field> : null}
      <label className="row" style={{ marginBottom: 8 }}><input type="checkbox" style={{ width: 20 }} checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} />Show in my online shop</label>
      <label className="row" style={{ marginBottom: 14 }}><input type="checkbox" style={{ width: 20 }} checked={f.isService} onChange={(e) => setF({ ...f, isService: e.target.checked })} />This is a service (no stock)</label>
      {err ? <div className="err" style={{ marginBottom: 10 }}>{err}</div> : null}
      <div className="row"><Btn p onClick={save} disabled={!f.name || !f.sku || !(toPaise(f.price) >= 0)}>Save</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

export function Stock() {
  const { biz, can } = useWs(); const toast = useToast(); const [sel, setSel] = useState<any>(null); const [qty, setQty] = useState(''); const [reason, setReason] = useState('found');
  const res = useLoad(() => api<{ inventory: any[] }>(bp(biz.id, '/inventory')), [biz.id]);
  const val = useLoad(() => api<any>(bp(biz.id, '/inventory/valuation')).catch(() => null), [biz.id]);
  const adjust = async () => {
    const n = Number(qty); if (!n) return;
    const delta = reason === 'adjustment' ? n : ['damage', 'loss'].includes(reason) ? -Math.abs(n) : Math.abs(n);
    try { await api(bp(biz.id, '/inventory/adjust'), { method: 'POST', body: { productId: sel.id, branchId: sel.branch_id, qtyDelta: delta, reason, idempotencyKey: `adj-${Date.now()}-${sel.id}` } }); toast('Stock updated'); setSel(null); setQty(''); res.reload(); } catch (e: any) { toast(e.message); }
  };
  return (
    <>
      <Head title="Stock" sub={val.data ? `Worth ${rs(val.data.total_paise)} at cost` : undefined} />
      <Card><Async res={res}>{(d) => !d.inventory.length ? <Empty title="No stock yet" text="Receive goods from a supplier or add opening stock on a product." /> : (
        <div className="tablewrap"><table><thead><tr><th>Item</th><th className="right">In stock</th><th className="right">Reserved</th><th className="right">Avg cost</th><th className="right">Value</th></tr></thead><tbody>
          {d.inventory.map((x) => <tr key={`${x.id}-${x.branch_id}`} className={can('inventory.write') ? 'click' : ''} onClick={() => can('inventory.write') && setSel(x)}><td className="bold">{x.name}</td><td className="right"><Pill tone={x.low ? 'bad' : 'good'}>{x.qty} {x.unit}</Pill></td><td className="right">{x.reserved || '—'}</td><td className="right">{rs(x.avg_cost_paise)}</td><td className="right">{rs(x.value_paise)}</td></tr>)}
        </tbody></table></div>)}</Async></Card>
      {sel ? <Modal title={`Adjust ${sel.name}`} onClose={() => setSel(null)}>
        <p className="sub small">Every change is written to the stock ledger and the books.</p>
        <Chips options={[['found', 'Add found'], ['damage', 'Damaged'], ['loss', 'Lost'], ['adjustment', '+/− Count']]} value={reason as any} onChange={setReason} />
        <Field label="Quantity"><input type="number" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
        <div className="row"><Btn p onClick={adjust} disabled={!Number(qty)}>Update</Btn><Btn onClick={() => setSel(null)}>Cancel</Btn></div></Modal> : null}
    </>
  );
}

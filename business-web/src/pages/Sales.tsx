import { useState } from 'react';
import { useWs, go } from '../App';
import { api, bp, newKey, rs, toPaise, day } from '../api';
import { Async, Btn, Card, Empty, Field, Head, Line, Pill, useLoad, useToast } from '../ui';

export function Sales() {
  const id = Number(location.hash.split('/')[2]) || 0;
  return id ? <Invoice id={id} /> : <SalesList />;
}
function SalesList() {
  const { biz } = useWs();
  const res = useLoad(() => api<{ invoices: any[] }>(bp(biz.id, '/sales?limit=200')), [biz.id]);
  return (
    <>
      <Head title="Sales" sub="Every bill you have made" />
      <Card><Async res={res}>{(d) => !d.invoices.length ? <Empty title="No bills yet" text="Bills from Billing and your online shop appear here." /> : (
        <div className="tablewrap"><table><thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th className="right">Total</th><th>Status</th></tr></thead><tbody>
          {d.invoices.map((x) => <tr key={x.id} className="click" onClick={() => go(`/sales/${x.id}`)}><td className="bold">{x.invoice_no}</td><td>{day(x.created_at)}</td><td>{x.customer_name || 'Walk-in'}</td><td className="right">{rs(x.total_paise - x.returned_paise)}</td><td><Pill tone={x.balance_paise > 0 ? 'warn' : 'good'}>{x.balance_paise > 0 ? `${rs(x.balance_paise)} due` : 'Paid'}</Pill></td></tr>)}
        </tbody></table></div>)}</Async></Card>
    </>
  );
}
function Invoice({ id }: { id: number }) {
  const { biz, can } = useWs(); const toast = useToast(); const [amt, setAmt] = useState('');
  const res = useLoad(() => api<any>(bp(biz.id, `/sales/${id}`)), [biz.id, id]);
  const act = async (fn: () => Promise<any>, msg: string) => { try { await fn(); toast(msg); res.reload(); } catch (e: any) { toast(e.message); } };
  return (
    <Async res={res}>{({ invoice: i, shareUrl }) => (
      <>
        <Head title={i.invoice_no} sub={`${i.business.name} · ${day(i.created_at)}`} right={<><Btn onClick={() => go('/sales')}>All bills</Btn><Btn onClick={() => window.print()}>Print</Btn><Btn p onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Your bill from ${i.business.name}: ${shareUrl}`)}`)}>Share on WhatsApp</Btn></>} />
        <Card style={{ maxWidth: 720 }}>
          <div className="bold">{i.customer_name || 'Walk-in customer'}</div>
          <table style={{ margin: '12px 0' }}><thead><tr><th>Item</th><th className="right">Qty</th><th className="right">Price</th><th className="right">Total</th><th className="no-print" /></tr></thead><tbody>
            {i.items.map((it: any) => <tr key={it.id}><td>{it.name}{it.returned_qty ? <span className="sub small"> (−{it.returned_qty} returned)</span> : null}</td><td className="right">{it.qty}</td><td className="right">{rs(it.unit_price_paise)}</td><td className="right">{rs(it.line_total_paise)}</td>
              <td className="right no-print">{can('sales.refund') && it.returned_qty < it.qty ? <Btn s onClick={() => act(() => api(bp(biz.id, `/sales/${id}/returns`), { method: 'POST', body: { items: [{ itemId: it.id, qty: 1 }], refundMethod: 'cash', reason: 'Customer return', idempotencyKey: newKey('ret') } }), 'Return recorded')}>Return 1</Btn> : null}</td></tr>)}
          </tbody></table>
          <Line label="GST included" value={rs(i.tax_paise)} /><Line label="Total" value={rs(i.total_paise)} bold />
          {i.returned_paise ? <Line label="Returned" value={`− ${rs(i.returned_paise)}`} /> : null}
          <Line label="Paid" value={rs(i.paid_paise)} color="var(--good)" />
          {i.balance_paise > 0 ? <Line label="Balance due" value={rs(i.balance_paise)} bold color="var(--bad)" /> : null}
        </Card>
        {i.balance_paise > 0 && can('sales.write') ? <Card style={{ maxWidth: 720 }} ><h2>Receive payment</h2><div className="row"><div className="grow"><Field label="Amount (₹)"><input type="number" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field></div><Btn p disabled={!(toPaise(amt) > 0)} onClick={() => act(() => api(bp(biz.id, `/sales/${id}/payments`), { method: 'POST', body: { amountPaise: Math.min(toPaise(amt), i.balance_paise), method: 'cash', idempotencyKey: newKey('rcpt') } }).then(() => setAmt('')), 'Payment recorded')}>Record</Btn></div></Card> : null}
      </>
    )}</Async>
  );
}

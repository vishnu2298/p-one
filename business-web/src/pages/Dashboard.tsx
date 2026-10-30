import { useWs, go } from '../App';
import { api, bp, rs, day } from '../api';
import { Async, Card, Head, Kpi, Line, useLoad, Btn, Empty, Pill } from '../ui';

export function Dashboard() {
  const { biz, can, entities } = useWs();
  const res = useLoad(() => api<any>(bp(biz.id, '/dashboard')), [biz.id]);
  return (
    <>
      <Head title={biz.name} sub="How the business is doing" right={can('sales.write') ? <Btn p onClick={() => go('/pos')}>New bill</Btn> : null} />
      <Async res={res}>{(d) => (
        <>
          <div className="grid kpis">
            <Kpi label="Today's sales" value={rs(d.today.sales_paise)} /><Kpi label="Bills today" value={String(d.today.sales_count)} />
            {d.net_profit_paise !== undefined ? <>
              <Kpi label="Sales (30 days)" value={rs(d.sales_paise)} /><Kpi label="Profit (30 days)" value={rs(d.net_profit_paise)} tone={d.net_profit_paise < 0 ? 'bad' : 'good'} />
              <Kpi label="Customers owe you" value={rs(d.receivable_paise)} /><Kpi label="You owe suppliers" value={rs(d.payable_paise)} /><Kpi label="Cash and bank" value={rs(d.cash_paise)} /><Kpi label="Stock value" value={rs(d.inventory_value_paise)} /></> : null}
          </div>
          <div className="grid two" style={{ marginTop: 14 }}>
            <Card><h2>Sales, last 30 days</h2>
              {d.trend.length ? <Bars data={d.trend.map((t: any) => ({ k: day(t.day), v: t.sales_paise }))} /> : <Empty title="No sales yet" text="Your first bill will appear here." />}</Card>
            <Card><h2>Recent bills</h2>{d.recent.length ? d.recent.map((x: any) => <Line key={x.id} label={`${x.invoice_no} · ${x.customer_name || 'Walk-in'}`} value={rs(x.total_paise)} />) : <span className="sub">Nothing yet.</span>}</Card>
          </div>
          <div className="grid two" style={{ marginTop: 14 }}>
            <Card><h2>Running low</h2>{d.low_stock.length ? d.low_stock.slice(0, 8).map((x: any, i: number) => <Line key={i} label={x.name} value={`${x.qty} left`} color="var(--bad)" />) : <span className="sub">Nothing is running low.</span>}</Card>
            <Card><h2>Expiring in 30 days</h2>{d.expiring.length ? d.expiring.slice(0, 8).map((x: any, i: number) => <Line key={i} label={`${x.name} ${x.batch_no || ''}`} value={String(x.expiry)} />) : <span className="sub">Nothing is expiring soon.</span>}</Card>
          </div>
          {entities.length ? <div className="grid three" style={{ marginTop: 14 }}>{entities.map((e) => <EntityCard key={e.key} def={e} />)}</div> : null}
        </>
      )}</Async>
    </>
  );
}

function EntityCard({ def }: { def: { key: string; plural: string } }) {
  const { biz } = useWs();
  const res = useLoad(() => api<any>(bp(biz.id, `/entities/${def.key}/summary`)), [biz.id, def.key]);
  const d = res.data;
  return <Card><div className="row" style={{ justifyContent: 'space-between' }}><h2>{def.plural}</h2><Btn s onClick={() => go(`/r/${def.key}`)}>Open</Btn></div>{d ? <><div className="kpi"><div className="v">{d.count}</div></div><div className="chips" style={{ marginTop: 8 }}>{Object.entries(d.byStatus as Record<string, number>).map(([k, n]) => <Pill key={k}>{k}: {n}</Pill>)}</div></> : <span className="sub">Loading…</span>}</Card>;
}

export function Bars({ data }: { data: { k: string; v: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.v));
  return <div className="bars" role="img" aria-label="Sales by day">{data.map((d) => <div key={d.k} title={`${d.k}: ${rs(d.v)}`} style={{ height: `${Math.max(2, (d.v / max) * 100)}%` }} />)}</div>;
}

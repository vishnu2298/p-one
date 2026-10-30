import { useState } from 'react';
import { useWs } from '../App';
import { api, bp, rs } from '../api';
import { Async, Btn, Card, Chips, Head, Line, Pill, useLoad } from '../ui';

type Tab = 'pl' | 'bs' | 'tb' | 'cf' | 'tax' | 'out';
const PATH: Record<Tab, string> = { pl: 'profit-loss', bs: 'balance-sheet', tb: 'trial-balance', cf: 'cash-flow', tax: 'tax', out: 'outstanding' };

export function Reports() {
  const { biz } = useWs(); const [tab, setTab] = useState<Tab>('pl'); const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)); const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const res = useLoad(async () => ({ ...(await api<any>(bp(biz.id, `/reports/${PATH[tab]}?from=${from}&to=${to}&asOf=${to}`))), _tab: tab }), [biz.id, tab, from, to]);
  const d = res.data?._tab === tab ? res.data : null;
  return (
    <>
      <Head title="Reports" sub={tab === 'bs' || tab === 'tb' ? `As of ${to}` : `${from} to ${to}`} right={<Btn onClick={() => window.print()}>Print</Btn>} />
      <Card><div className="row no-print"><Chips options={[['pl', 'Profit and loss'], ['bs', 'Balance sheet'], ['tb', 'Trial balance'], ['cf', 'Cash flow'], ['tax', 'GST'], ['out', 'Dues']]} value={tab} onChange={setTab} />
        <span className="grow" /><input type="date" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><input type="date" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></div></Card>
      <Card>
        <Async res={{ ...res, data: d }}>{(r) => tab === 'pl' ? <div style={{ maxWidth: 560 }}>
          <Line label="Sales" value={rs(r.revenue_paise)} /><Line label="Returns" value={`− ${rs(r.returns_paise)}`} /><Line label="Cost of goods sold" value={`− ${rs(r.cogs_paise)}`} /><Line label="Gross profit" value={rs(r.gross_profit_paise)} bold />
          {r.operating_expenses.map((e: any) => <Line key={e.code} label={e.name} value={`− ${rs(e.amount_paise)}`} />)}
          <Line label="Net profit" value={rs(r.net_profit_paise)} bold color={r.net_profit_paise < 0 ? 'var(--bad)' : 'var(--good)'} /></div>
        : tab === 'bs' ? <div className="grid two">
          <div><h2>What you own {r.balanced ? <Pill tone="good">Balanced</Pill> : <Pill tone="bad">Out of balance</Pill>}</h2>{r.assets.map((a: any) => <Line key={a.code} label={a.name} value={rs(a.amount_paise)} />)}<Line label="Total" value={rs(r.totals_paise.assets)} bold /></div>
          <div><h2>What you owe and owner's money</h2>{r.liabilities.map((a: any) => <Line key={a.code} label={a.name} value={rs(a.amount_paise)} />)}{r.equity.map((a: any) => <Line key={a.code} label={a.name} value={rs(a.amount_paise)} />)}<Line label="Profit this year" value={rs(r.current_earnings_paise)} /><Line label="Total" value={rs(r.totals_paise.liabilities + r.totals_paise.equity)} bold /></div></div>
        : tab === 'tb' ? <><div className="tablewrap"><table><thead><tr><th>Code</th><th>Account</th><th className="right">Debit</th><th className="right">Credit</th></tr></thead><tbody>{r.rows.filter((x: any) => x.debit_paise || x.credit_paise).map((x: any) => <tr key={x.code}><td>{x.code}</td><td>{x.name}</td><td className="right">{x.debit_paise ? rs(x.debit_paise) : ''}</td><td className="right">{x.credit_paise ? rs(x.credit_paise) : ''}</td></tr>)}<tr><td /><td className="bold">Total {r.balanced ? <Pill tone="good">Balanced</Pill> : null}</td><td className="right bold">{rs(r.totals_paise.debit)}</td><td className="right bold">{rs(r.totals_paise.credit)}</td></tr></tbody></table></div></>
        : tab === 'cf' ? <div style={{ maxWidth: 560 }}><Line label="Opening cash and bank" value={rs(r.opening_paise)} />{r.movements.map((m: any) => <Line key={m.source} label={String(m.source).replace(/_/g, ' ')} value={rs(m.net_paise)} />)}<Line label="Closing cash and bank" value={rs(r.closing_paise)} bold /></div>
        : tab === 'tax' ? <div style={{ maxWidth: 560 }}><Line label="GST collected on sales" value={rs(r.output_tax_paise)} /><Line label="GST paid on purchases" value={`− ${rs(r.input_credit_paise)}`} /><Line label="GST payable" value={rs(r.net_payable_paise)} bold />
          <h2 style={{ marginTop: 16 }}>Sales by rate</h2>{r.sales_by_rate.map((s: any, i: number) => <Line key={i} label={`${s.rate_bps / 100}%  (taxable ${rs(s.taxable_paise)})`} value={rs(s.tax_paise)} />)}</div>
        : <div className="grid two"><div><h2>Customers owe you</h2>{r.customers.length ? r.customers.map((x: any) => <Line key={x.party_id} label={x.name} value={rs(x.balance_paise)} />) : <span className="sub">Nobody owes you.</span>}</div><div><h2>You owe suppliers</h2>{r.suppliers.length ? r.suppliers.map((x: any) => <Line key={x.party_id} label={x.name} value={rs(x.balance_paise)} />) : <span className="sub">You are settled.</span>}</div></div>}</Async>
      </Card>
    </>
  );
}

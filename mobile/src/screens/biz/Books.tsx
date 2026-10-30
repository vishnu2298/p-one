import React, { useState } from 'react';
import { View } from 'react-native';
import { api } from '../../api';
import { useLoad } from '../../hooks';
import { Button, Card, Chip, Empty, ErrorState, Input, Pill, SectionTitle, SkeletonRows, Txt, notify, toast } from '../../ui';
import { Segmented } from '../../motion';
import { colors } from '../../theme';
import { BizScreen, Line, bizPath, day, newKey, rs, toPaise } from '../../biz';

export function BizCustomers() { return <BizScreen title="Customers" need="customers.read">{(b, can) => <Customers bizId={b.id} can={can} />}</BizScreen>; }
function Customers({ bizId, can }: { bizId: number; can: (p: string) => boolean }) {
  const res = useLoad(() => api<{ customers: any[] }>(bizPath(bizId, '/customers')), [bizId]);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const detail = useLoad(async () => (sel ? api<any>(bizPath(bizId, `/customers/${sel}`)) : null), [bizId, sel]);
  const [pay, setPay] = useState('');
  const add = async () => {
    setBusy(true);
    try { await api(bizPath(bizId, '/customers'), { method: 'POST', body: { name, phone } }); setName(''); setPhone(''); setOpen(false); toast('Customer added'); void res.reload(true); }
    catch (e: any) { notify('Could not add', e.message); } finally { setBusy(false); }
  };
  const settle = async () => {
    const a = toPaise(pay); if (!(a > 0)) return;
    try { await api(bizPath(bizId, `/customers/${sel}/payments`), { method: 'POST', body: { amountPaise: a, method: 'cash', idempotencyKey: newKey('khata') } }); setPay(''); toast('Payment received'); void detail.reload(true); void res.reload(true); }
    catch (e: any) { notify('Could not record', e.message); }
  };
  const items = res.data?.customers || [];
  return (
    <>
      {can('customers.write') ? (open ? <Card style={{ marginBottom: 12 }}><Input label="Name" value={name} onChangeText={setName} /><Input label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /><Button title="Save customer" onPress={add} loading={busy} disabled={name.trim().length < 2} /></Card> : <Button title="Add a customer" icon="person-add" onPress={() => setOpen(true)} style={{ marginBottom: 12 }} />) : null}
      {res.loading && !res.data ? <SkeletonRows /> : res.error ? <ErrorState message={res.error} retry={() => res.reload()} /> : !items.length ? <Empty icon="people" title="No customers yet" text="Add regulars to keep their khata and bills together." /> :
        items.map((c) => (
          <Card key={c.id} onPress={() => setSel(sel === c.id ? null : c.id)} style={{ marginBottom: 8, gap: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt bold>{c.name}</Txt>{c.outstanding_paise ? <Txt bold color={colors.danger}>{rs(c.outstanding_paise)} due</Txt> : null}</View>
            <Txt variant="small" color={colors.sub}>{c.phone || 'No phone'}</Txt>
            {sel === c.id && detail.data ? (
              <View style={{ marginTop: 8 }}>
                {detail.data.invoices.slice(0, 5).map((i: any) => <Line key={i.id} label={`${i.invoice_no} · ${day(i.created_at)}`} value={rs(i.total_paise)} />)}
                {can('sales.write') && detail.data.customer.outstanding_paise > 0 ? <><Input label="Receive payment ₹" value={pay} onChangeText={setPay} keyboardType="decimal-pad" /><Button compact title="Record payment" onPress={settle} disabled={!pay} /></> : null}
              </View>
            ) : null}
          </Card>
        ))}
    </>
  );
}

export function BizPurchases() { return <BizScreen title="Purchases" need="purchases.read">{(b, can) => <Purchases bizId={b.id} can={can} />}</BizScreen>; }
function Purchases({ bizId, can }: { bizId: number; can: (p: string) => boolean }) {
  const sup = useLoad(() => api<{ suppliers: any[] }>(bizPath(bizId, '/suppliers')), [bizId]);
  const prods = useLoad(() => api<{ products: any[] }>(bizPath(bizId, '/products?limit=200')), [bizId]);
  const [mode, setMode] = useState<'list' | 'receive' | 'add'>('list');
  const [supplier, setSupplier] = useState<any>(null); const [lines, setLines] = useState<Record<number, string>>({}); const [paid, setPaid] = useState(''); const [busy, setBusy] = useState(false);
  const [name, setName] = useState(''); const [pay, setPay] = useState<Record<number, string>>({});
  const attempt = React.useRef(newKey('grn'));
  const items = prods.data?.products.filter((p) => !p.is_service) || [];
  const receive = async () => {
    const rows = Object.entries(lines).filter(([, q]) => Number(q) > 0).map(([id, q]) => ({ productId: Number(id), qty: Number(q) }));
    if (!supplier || !rows.length) return notify('Choose a supplier and quantities');
    setBusy(true);
    try {
      await api(bizPath(bizId, '/goods-receipts'), { method: 'POST', body: { supplierId: supplier.id, items: rows, idempotencyKey: attempt.current, ...(toPaise(paid) > 0 ? { paidPaise: toPaise(paid), method: 'cash' } : {}) } });
      attempt.current = newKey('grn'); setLines({}); setPaid(''); setMode('list'); toast('Stock received'); void sup.reload(true); void prods.reload(true);
    } catch (e: any) { notify('Could not receive', e.message); } finally { setBusy(false); }
  };
  const addSupplier = async () => { try { await api(bizPath(bizId, '/suppliers'), { method: 'POST', body: { name } }); setName(''); setMode('list'); void sup.reload(true); } catch (e: any) { notify('Could not add', e.message); } };
  const paySupplier = async (s: any) => {
    const a = toPaise(pay[s.id] || ''); if (!(a > 0)) return;
    try { await api(bizPath(bizId, `/suppliers/${s.id}/payments`), { method: 'POST', body: { amountPaise: a, method: 'bank', idempotencyKey: newKey('sp') } }); setPay((x) => ({ ...x, [s.id]: '' })); toast('Payment recorded'); void sup.reload(true); }
    catch (e: any) { notify('Could not record', e.message); }
  };
  return (
    <>
      <Segmented options={[{ id: 'list', label: 'Suppliers' }, ...(can('purchases.write') ? [{ id: 'receive' as const, label: 'Receive stock' }, { id: 'add' as const, label: 'New supplier' }] : [])]} value={mode} onChange={setMode} />
      {mode === 'add' ? <Card><Input label="Supplier name" value={name} onChangeText={setName} /><Button title="Save supplier" onPress={addSupplier} disabled={name.trim().length < 2} /></Card> : null}
      {mode === 'receive' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>{(sup.data?.suppliers || []).map((s) => <Chip key={s.id} label={s.name} selected={supplier?.id === s.id} onPress={() => setSupplier(s)} />)}</View>
          {items.map((p) => <Card key={p.id} style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={{ flex: 1 }}><Txt bold numberOfLines={1}>{p.name}</Txt><Txt variant="small" color={colors.sub}>Have {p.qty} · cost {rs(p.purchase_price_paise)}</Txt></View><View style={{ width: 90 }}><Input value={lines[p.id] || ''} onChangeText={(t) => setLines((x) => ({ ...x, [p.id]: t.replace(/\D/g, '') }))} keyboardType="number-pad" placeholder="Qty" style={{ minHeight: 48 }} /></View></Card>)}
          <Input label="Paid to supplier now ₹ (optional)" value={paid} onChangeText={setPaid} keyboardType="decimal-pad" />
          <Button title="Receive goods" icon="download" onPress={receive} loading={busy} />
        </>
      ) : null}
      {mode === 'list' ? (sup.loading && !sup.data ? <SkeletonRows /> : sup.error ? <ErrorState message={sup.error} retry={() => sup.reload()} /> : !sup.data?.suppliers.length ? <Empty icon="download" title="No suppliers yet" text="Add a supplier, then receive stock against them." /> :
        sup.data.suppliers.map((s) => (
          <Card key={s.id} style={{ marginBottom: 8, gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt bold>{s.name}</Txt>{s.outstanding_paise ? <Pill text={`${rs(s.outstanding_paise)} payable`} color={colors.warn} bg={colors.warnSoft} /> : <Pill text="Settled" color={colors.buy} bg={colors.buySoft} />}</View>
            {s.outstanding_paise > 0 && can('purchases.write') ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}><View style={{ flex: 1 }}><Input placeholder="Pay ₹" value={pay[s.id] || ''} onChangeText={(t) => setPay((x) => ({ ...x, [s.id]: t }))} keyboardType="decimal-pad" style={{ minHeight: 48 }} /></View><Button compact title="Pay" onPress={() => paySupplier(s)} style={{ marginBottom: 12 }} /></View> : null}
          </Card>
        ))) : null}
    </>
  );
}

type Rep = 'pl' | 'bs' | 'tax' | 'out';
export function BizReports() { return <BizScreen title="Reports" need="reports.read">{(b) => <Reports bizId={b.id} />}</BizScreen>; }
function Reports({ bizId }: { bizId: number }) {
  const [tab, setTab] = useState<Rep>('pl');
  const path = { pl: 'profit-loss', bs: 'balance-sheet', tax: 'tax', out: 'outstanding' }[tab];
  const res = useLoad(async () => ({ ...(await api<any>(bizPath(bizId, `/reports/${path}`))), _tab: tab }), [bizId, path]);
  const d = res.data?._tab === tab ? res.data : null; // never render one report with another tab's data
  return (
    <>
      <Segmented options={[{ id: 'pl', label: 'Profit' }, { id: 'bs', label: 'Balance' }, { id: 'tax', label: 'GST' }, { id: 'out', label: 'Dues' }]} value={tab} onChange={setTab} />
      {res.loading && !d ? <SkeletonRows /> : res.error ? <ErrorState message={res.error} retry={() => res.reload()} /> : !d ? null : tab === 'pl' ? (
        <Card><Txt variant="h2">Profit and loss</Txt><Txt variant="small" color={colors.sub} style={{ marginBottom: 8 }}>{d.from} to {d.to}</Txt>
          <Line label="Sales" value={rs(d.revenue_paise)} /><Line label="Returns" value={`− ${rs(d.returns_paise)}`} /><Line label="Cost of goods" value={`− ${rs(d.cogs_paise)}`} /><Line label="Gross profit" value={rs(d.gross_profit_paise)} bold />
          {d.operating_expenses.map((e: any) => <Line key={e.code} label={e.name} value={`− ${rs(e.amount_paise)}`} />)}
          <Line label="Net profit" value={rs(d.net_profit_paise)} bold color={d.net_profit_paise < 0 ? colors.danger : colors.buy} /></Card>
      ) : tab === 'bs' ? (
        <Card><Txt variant="h2">Balance sheet</Txt>{d.balanced ? <Pill text="Balanced" color={colors.buy} bg={colors.buySoft} icon="checkmark-circle" /> : <Pill text="Out of balance" color={colors.danger} bg={colors.dangerSoft} />}
          <SectionTitle title="What you own" />{d.assets.map((a: any) => <Line key={a.code} label={a.name} value={rs(a.amount_paise)} />)}<Line label="Total" value={rs(d.totals_paise.assets)} bold />
          <SectionTitle title="What you owe" />{d.liabilities.map((a: any) => <Line key={a.code} label={a.name} value={rs(a.amount_paise)} />)}
          <SectionTitle title="Owner's money" />{d.equity.map((a: any) => <Line key={a.code} label={a.name} value={rs(a.amount_paise)} />)}<Line label="Profit this year" value={rs(d.current_earnings_paise)} /></Card>
      ) : tab === 'tax' ? (
        <Card><Txt variant="h2">GST summary</Txt><Line label="Collected on sales" value={rs(d.output_tax_paise)} /><Line label="Paid on purchases" value={`− ${rs(d.input_credit_paise)}`} /><Line label="Payable" value={rs(d.net_payable_paise)} bold />
          {d.sales_by_rate?.map((r: any, i: number) => <Line key={i} label={`Sales at ${(r.rate_bps ?? 0) / 100}%`} value={rs(r.taxable_paise ?? 0)} />)}</Card>
      ) : (
        <>
          <SectionTitle title="Customers owe you" />{d.customers.length ? d.customers.map((x: any) => <Card key={x.party_id} style={{ marginBottom: 8 }}><Line label={x.name} value={rs(x.balance_paise)} /></Card>) : <Txt color={colors.sub}>Nobody owes you anything.</Txt>}
          <SectionTitle title="You owe suppliers" />{d.suppliers.length ? d.suppliers.map((x: any) => <Card key={x.party_id} style={{ marginBottom: 8 }}><Line label={x.name} value={rs(x.balance_paise)} /></Card>) : <Txt color={colors.sub}>You are all settled.</Txt>}
        </>
      )}
    </>
  );
}

const EXP: [string, string][] = [['6000', 'Rent'], ['6010', 'Salaries'], ['6020', 'Utilities'], ['6030', 'Marketing'], ['6040', 'Transport'], ['6090', 'Other']];
export function BizExpenses() { return <BizScreen title="Expenses" need="accounting.read">{(b, can) => <Expenses bizId={b.id} can={can} />}</BizScreen>; }
function Expenses({ bizId, can }: { bizId: number; can: (p: string) => boolean }) {
  const res = useLoad(() => api<{ expenses: any[] }>(bizPath(bizId, '/expenses')), [bizId]);
  const [code, setCode] = useState('6000'); const [amt, setAmt] = useState(''); const [memo, setMemo] = useState(''); const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try { await api(bizPath(bizId, '/expenses'), { method: 'POST', body: { accountCode: code, amountPaise: toPaise(amt), memo, method: 'cash', idempotencyKey: newKey('exp') } }); setAmt(''); setMemo(''); toast('Expense saved'); void res.reload(true); }
    catch (e: any) { notify('Could not save', e.message); } finally { setBusy(false); }
  };
  return (
    <>
      {can('expenses.write') ? <Card style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>{EXP.map(([c, l]) => <Chip key={c} label={l} selected={code === c} onPress={() => setCode(c)} />)}</View>
        <Input label="Amount ₹" value={amt} onChangeText={setAmt} keyboardType="decimal-pad" /><Input label="Note" value={memo} onChangeText={setMemo} />
        <Button title="Add expense" onPress={add} loading={busy} disabled={!(toPaise(amt) > 0)} /></Card> : null}
      {res.loading && !res.data ? <SkeletonRows /> : res.error ? <ErrorState message={res.error} retry={() => res.reload()} /> : !res.data?.expenses.length ? <Empty icon="wallet" title="No expenses yet" /> :
        res.data.expenses.map((e: any) => <Card key={e.id} style={{ marginBottom: 8 }}><Line label={`${e.memo || e.account_code || 'Expense'} · ${day(e.date || e.created_at)}`} value={rs(e.amount_paise)} /></Card>)}
    </>
  );
}

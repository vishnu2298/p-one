import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../api';
import { useLoad } from '../../hooks';
import { Button, Card, Chip, Empty, ErrorState, Header, Input, Pill, Row, Screen, SectionTitle, SkeletonRows, Txt, notify, toast } from '../../ui';
import { colors } from '../../theme';
import { Business, Kpi, Line, bizPath, rs, selectBusiness, useBiz } from '../../biz';

export function BizCreate() {
  const nav = useNavigation<any>();
  const cats = useLoad(() => api<{ categories: { id: string; name: string }[] }>('/api/v1/business-categories'), []);
  const [name, setName] = useState(''); const [category, setCategory] = useState(''); const [gstin, setGstin] = useState(''); const [address, setAddress] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ business: Business }>('/api/v1/businesses', { method: 'POST', body: { name, category, gstin, address } });
      selectBusiness(r.business.id); toast('Your business is ready'); nav.replace('BizHub');
    } catch (e: any) { notify('Could not create', e.message); } finally { setBusy(false); }
  };
  return (
    <Screen header={<Header title="Start your business" />} footer={<Button title="Create business" onPress={submit} loading={busy} disabled={name.trim().length < 2 || !category} />}>
      <Txt color={colors.sub} style={{ marginBottom: 16 }}>Billing, stock, books and your online shop in one place. You can add GST details later.</Txt>
      <Input label="Business name" value={name} onChangeText={setName} placeholder="e.g. Lakshmi Provision Stores" />
      <Txt variant="small" bold color={colors.sub} style={{ marginLeft: 4, marginBottom: 8 }}>What do you do?</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {(cats.data?.categories || []).map((c) => <Chip key={c.id} label={c.name} selected={category === c.id} onPress={() => setCategory(c.id)} />)}
      </View>
      <Input label="Address (optional)" value={address} onChangeText={setAddress} />
      <Input label="GSTIN (optional)" value={gstin} onChangeText={(t) => setGstin(t.toUpperCase())} autoCapitalize="characters" maxLength={15} hint="15 characters, like 33ABCDE1234F1Z5" />
    </Screen>
  );
}

export function BizHub() {
  const nav = useNavigation<any>();
  const biz = useBiz();
  const b = biz.current;
  const dash = useLoad(async () => (b && biz.can('dashboard.read') ? api<any>(bizPath(b.id, '/dashboard')) : null), [b?.id]);
  if (biz.loading) return <Screen header={<Header title="My business" />}><SkeletonRows /></Screen>;
  if (biz.error && !b) return <Screen header={<Header title="My business" />}><ErrorState message={biz.error} retry={biz.reload} /></Screen>;
  if (!b) return <Screen header={<Header title="My business" />}><Empty icon="storefront" title="Run your business on Connectly" text="Bill customers, track stock, keep your books and open an online shop." action={{ title: 'Create a business', onPress: () => nav.navigate('BizCreate') }} /></Screen>;
  const d = dash.data;
  const tiles: [string, string, string, string, string][] = [
    ['sales.write', 'Billing (POS)', 'calculator', 'BizPos', 'Make a bill'], ['sales.read', 'Sales', 'receipt', 'BizSales', 'Invoices and returns'],
    ['products.read', 'Products', 'cube', 'BizProducts', 'Items and prices'], ['inventory.read', 'Stock', 'layers', 'BizStock', 'Counts and low stock'],
    ['purchases.read', 'Purchases', 'download', 'BizPurchases', 'Suppliers and stock in'], ['customers.read', 'Customers', 'people', 'BizCustomers', 'Khata and history'],
    ['reports.read', 'Reports', 'stats-chart', 'BizReports', 'Profit, tax, balance'], ['expenses.write', 'Expenses', 'wallet', 'BizExpenses', 'Rent, salary, bills'],
    ['appointments.manage', 'Appointments', 'calendar', 'BizAppointments', 'Bookings and visits'], ['storefront.manage', 'Online shop', 'storefront', 'BizStore', 'Orders and settings'],
    ['team.manage', 'Team', 'person-add', 'BizTeam', 'Staff and roles'],
  ];
  return (
    <Screen header={<Header title="My business" subtitle={b.name} />} refresh={{ refreshing: dash.refreshing, onRefresh: () => { dash.refresh(); void biz.reload(); } }}>
      {biz.list && biz.list.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {biz.list.map((x) => <Chip key={x.id} label={x.name} selected={x.id === b.id} onPress={() => selectBusiness(x.id)} />)}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <Pill text={b.role} icon="shield-checkmark" />{b.verified ? <Pill text="Verified" color={colors.buy} bg={colors.buySoft} icon="checkmark-circle" /> : null}
      </View>
      {dash.loading && !d ? <SkeletonRows count={2} avatar={false} /> : d ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Kpi label="Today's sales" value={rs(d.today.sales_paise)} />
            <Kpi label="Bills today" value={String(d.today.sales_count)} />
            {d.net_profit_paise !== undefined ? <><Kpi label="Profit (30 days)" value={rs(d.net_profit_paise)} tone={d.net_profit_paise < 0 ? 'bad' : 'good'} /><Kpi label="Customers owe you" value={rs(d.receivable_paise)} /><Kpi label="You owe suppliers" value={rs(d.payable_paise)} /><Kpi label="Stock value" value={rs(d.inventory_value_paise)} /></> : null}
          </View>
          {d.low_stock?.length ? <Card style={{ marginTop: 12, backgroundColor: colors.warnSoft }}><Txt bold color={colors.warn}>Running low</Txt>{d.low_stock.slice(0, 4).map((x: any) => <Line key={x.product_id ?? x.id} label={x.name} value={`${x.qty} left`} />)}</Card> : null}
          {d.expiring?.length ? <Card style={{ marginTop: 12, backgroundColor: colors.dangerSoft }}><Txt bold color={colors.danger}>Expiring soon</Txt>{d.expiring.slice(0, 4).map((x: any, i: number) => <Line key={i} label={`${x.name} ${x.batch_no || ''}`} value={String(x.expiry)} />)}</Card> : null}
          {d.recent?.length ? <><SectionTitle title="Recent bills" />{d.recent.map((x: any) => <Card key={x.id} onPress={() => nav.navigate('BizInvoice', { id: x.id })} style={{ marginBottom: 8 }}><Line label={`${x.invoice_no} · ${x.customer_name || 'Walk-in'}`} value={rs(x.total_paise)} /></Card>)}</> : null}
        </>
      ) : null}
      <SectionTitle title="Manage" />
      <Card style={{ paddingVertical: 6 }}>
        {tiles.filter(([p]) => biz.can(p)).map(([, label, icon, route, sub]) => <Row key={route} icon={icon as any} label={label} value={sub} onPress={() => nav.navigate(route)} />)}
        <Row icon="add-circle" label="Add another business" onPress={() => nav.navigate('BizCreate')} />
      </Card>
    </Screen>
  );
}

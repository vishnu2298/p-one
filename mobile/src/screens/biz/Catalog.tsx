import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../../api';
import { useDebounced, useLoad } from '../../hooks';
import { Button, Card, Chip, Empty, ErrorState, Input, Pill, SkeletonRows, Txt, notify, toast } from '../../ui';
import { colors } from '../../theme';
import { BizScreen, Line, bizPath, rs, toPaise } from '../../biz';

export function BizProducts() {
  const nav = useNavigation<any>();
  return <BizScreen title="Products" need="products.read" footer={null}>{(b, can) => <List bizId={b.id} can={can} nav={nav} />}</BizScreen>;
}
function List({ bizId, can, nav }: { bizId: number; can: (p: string) => boolean; nav: any }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const res = useLoad(() => api<{ products: any[] }>(bizPath(bizId, `/products?q=${encodeURIComponent(dq)}`)), [bizId, dq]);
  const items = res.data?.products || [];
  return (
    <>
      <Input placeholder="Search name, SKU or barcode" value={q} onChangeText={setQ} />
      {can('products.write') ? <Button title="Add a product" icon="add-circle" onPress={() => nav.navigate('BizProductEdit', {})} style={{ marginBottom: 14 }} /> : null}
      {res.loading && !res.data ? <SkeletonRows /> : res.error ? <ErrorState message={res.error} retry={() => res.reload()} /> : !items.length ? <Empty icon="cube" title="No products yet" text="Add your first item to start billing." /> :
        items.map((p) => (
          <Card key={p.id} onPress={can('products.write') ? () => nav.navigate('BizProductEdit', { id: p.id }) : undefined} style={{ marginBottom: 8, gap: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Txt bold style={{ flex: 1 }}>{p.name}</Txt><Txt bold color={colors.primary}>{rs(p.selling_price_paise)}</Txt></View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Txt variant="small" color={colors.sub}>{p.sku}{p.tax_bps ? ` · GST ${p.tax_bps / 100}%` : ''}</Txt>
              {p.is_service ? <Pill text="Service" /> : <Pill text={`${p.qty} ${p.unit}`} color={p.low ? colors.danger : colors.buy} bg={p.low ? colors.dangerSoft : colors.buySoft} />}
              {p.published ? <Pill text="Online" icon="globe" /> : null}
            </View>
          </Card>
        ))}
    </>
  );
}

export function BizProductEdit() {
  const nav = useNavigation<any>(); const { params } = useRoute<any>();
  const id: number | undefined = params?.id;
  return <BizScreen title={id ? 'Edit product' : 'New product'} need="products.write">{(b) => <Form bizId={b.id} id={id} nav={nav} />}</BizScreen>;
}
function Form({ bizId, id, nav }: { bizId: number; id?: number; nav: any }) {
  const cur = useLoad(async () => (id ? (await api<{ products: any[] }>(bizPath(bizId, '/products?limit=500'))).products.find((p) => p.id === id) : null), [bizId, id]);
  const [f, setF] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<{ published?: boolean; isService?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const p = cur.data;
  const val = (k: string, dflt = '') => (f[k] !== undefined ? f[k] : p ? String(({ name: p.name, sku: p.sku, barcode: p.barcode, category: p.category, unit: p.unit, price: p.selling_price_paise / 100, cost: p.purchase_price_paise / 100, gst: p.tax_bps / 100, reorder: p.reorder_level } as any)[k] ?? '') : dflt);
  const set = (k: string) => (t: string) => setF((x) => ({ ...x, [k]: t }));
  const save = async () => {
    const price = toPaise(val('price')); if (Number.isNaN(price)) return notify('Add a selling price');
    setBusy(true);
    try {
      const body: any = { name: val('name'), sku: val('sku'), barcode: val('barcode'), category: val('category'), unit: val('unit', 'pcs'), sellingPricePaise: price, purchasePricePaise: toPaise(val('cost', '0')) || 0, taxBps: Math.round(Number(val('gst', '0')) * 100), reorderLevel: Number(val('reorder', '0')) || 0,
        published: flags.published ?? !!p?.published, isService: flags.isService ?? !!p?.is_service };
      if (!id && f.opening) body.openingQty = Number(f.opening);
      await api(bizPath(bizId, id ? `/products/${id}` : '/products'), { method: id ? 'PATCH' : 'POST', body });
      toast('Saved'); nav.goBack();
    } catch (e: any) { notify('Could not save', e.message); } finally { setBusy(false); }
  };
  if (id && cur.loading && !p) return <SkeletonRows />;
  return (
    <>
      <Input label="Name" value={val('name')} onChangeText={set('name')} />
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Input label="SKU" value={val('sku')} onChangeText={set('sku')} autoCapitalize="characters" /></View><View style={{ flex: 1 }}><Input label="Barcode" value={val('barcode')} onChangeText={set('barcode')} /></View></View>
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Input label="Selling price ₹ (incl. GST)" value={val('price')} onChangeText={set('price')} keyboardType="decimal-pad" /></View><View style={{ flex: 1 }}><Input label="Cost ₹" value={val('cost')} onChangeText={set('cost')} keyboardType="decimal-pad" /></View></View>
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Input label="GST %" value={val('gst')} onChangeText={set('gst')} keyboardType="decimal-pad" /></View><View style={{ flex: 1 }}><Input label="Unit" value={val('unit', 'pcs')} onChangeText={set('unit')} /></View></View>
      <Input label="Category" value={val('category')} onChangeText={set('category')} />
      <Input label="Alert me when stock is at or below" value={val('reorder')} onChangeText={set('reorder')} keyboardType="number-pad" />
      {!id ? <Input label="Opening stock" value={f.opening || ''} onChangeText={set('opening')} keyboardType="number-pad" /> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
        <Chip label="Show in my online shop" selected={flags.published ?? !!p?.published} onPress={() => setFlags((x) => ({ ...x, published: !(x.published ?? !!p?.published) }))} />
        <Chip label="Service (no stock)" selected={flags.isService ?? !!p?.is_service} onPress={() => setFlags((x) => ({ ...x, isService: !(x.isService ?? !!p?.is_service) }))} />
      </View>
      <Button title="Save product" onPress={save} loading={busy} disabled={!val('name') || !val('sku')} />
    </>
  );
}

export function BizStock() {
  return <BizScreen title="Stock" need="inventory.read">{(b, can) => <Stock bizId={b.id} can={can} />}</BizScreen>;
}
function Stock({ bizId, can }: { bizId: number; can: (p: string) => boolean }) {
  const res = useLoad(() => api<{ inventory: any[] }>(bizPath(bizId, '/inventory')), [bizId]);
  const [sel, setSel] = useState<any>(null); const [qty, setQty] = useState(''); const [reason, setReason] = useState('found'); const [busy, setBusy] = useState(false);
  const adjust = async () => {
    const n = Number(qty); if (!n) return;
    setBusy(true);
    try {
      const delta = ['damage', 'loss'].includes(reason) ? -Math.abs(n) : Math.abs(n) * (reason === 'adjustment' ? Math.sign(n) : 1);
      await api(bizPath(bizId, '/inventory/adjust'), { method: 'POST', body: { productId: sel.id, branchId: sel.branch_id, qtyDelta: reason === 'adjustment' ? n : delta, reason, idempotencyKey: `adj-${Date.now()}-${sel.id}` } });
      toast('Stock updated'); setSel(null); setQty(''); void res.reload(true);
    } catch (e: any) { notify('Could not adjust', e.message); } finally { setBusy(false); }
  };
  const items = res.data?.inventory || [];
  return (
    <>
      {res.loading && !res.data ? <SkeletonRows /> : res.error ? <ErrorState message={res.error} retry={() => res.reload()} /> : !items.length ? <Empty icon="layers" title="No stock yet" text="Receive goods from a supplier or add opening stock on a product." /> :
        items.map((x) => (
          <Card key={`${x.id}-${x.branch_id}`} onPress={can('inventory.write') ? () => setSel(x) : undefined} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Txt bold style={{ flex: 1 }}>{x.name}</Txt><Txt bold color={x.low ? colors.danger : colors.text}>{x.qty} {x.unit}</Txt></View>
            <Txt variant="small" color={colors.sub}>Value {rs(x.value_paise)}{x.reserved ? ` · ${x.reserved} reserved` : ''}</Txt>
          </Card>
        ))}
      {sel ? (
        <Card style={{ marginTop: 10, borderColor: colors.primary, borderWidth: 1 }}>
          <Txt variant="h2">Adjust {sel.name}</Txt><Txt color={colors.sub} style={{ marginBottom: 10 }}>Every change is recorded in the stock ledger.</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>{[['found', 'Add found'], ['damage', 'Damaged'], ['loss', 'Lost'], ['adjustment', '+/− Count']].map(([id, l]) => <Chip key={id} label={l} selected={reason === id} onPress={() => setReason(id)} />)}</View>
          <Input label="Quantity" value={qty} onChangeText={setQty} keyboardType="numbers-and-punctuation" />
          <View style={{ flexDirection: 'row', gap: 10 }}><Button title="Cancel" variant="light" onPress={() => setSel(null)} style={{ flex: 1 }} /><Button title="Update" onPress={adjust} loading={busy} style={{ flex: 1 }} /></View>
        </Card>
      ) : null}
    </>
  );
}

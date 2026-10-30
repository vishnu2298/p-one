import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, money } from '../api';
import { useAuth } from '../context';
import { useLoad } from '../hooks';
import { Button, Card, Chip, Empty, FadeIn, Header, Input, Pill, Screen, SectionTitle, SkeletonRows, Txt, confirmDialog, notify, toast } from '../ui';
import { colors, space } from '../theme';
import { Listing, Me } from '../types';

type Summary = { brandName: string; commissionRate: number; ads: { spend: number; clicks: number; impressions: number }; brokerage: { fees: number; deals: number }; totalDue: number };
type AdRow = { id: number; title: string; status: string; placement: string; costPerClick: number; dailyBudget: number; impressions: number; clicks: number; spend: number; ctr: number };

const Tile = ({ label, value, color = colors.text }: { label: string; value: string; color?: string }) => (
  <Card style={{ flex: 1, minWidth: 140, alignItems: 'center', padding: 14 }}><Txt variant="h2" color={color}>{value}</Txt><Txt variant="tiny" color={colors.sub} center>{label}</Txt></Card>
);

/** Brand partners: sponsored ads (pay per click) and brokerage on completed deals. Individuals never pay. */
export function BrandHub() {
  const { user, setUser } = useAuth();
  const [brandName, setBrandName] = useState('');
  const [busy, setBusy] = useState(false);
  const isBrand = !!user?.isBrand;

  const become = async () => {
    setBusy(true);
    try { setUser((await api<{ user: Me }>('/me/brand', { method: 'POST', body: { brandName } })).user); toast('You are now a brand partner'); } catch (e: any) { notify('Could not continue', e.message); } finally { setBusy(false); }
  };

  if (!isBrand) {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen header={<Header title="Brand partners" />}>
          <FadeIn>
            <Card style={{ gap: 10, backgroundColor: colors.buySoft }}>
              <Ionicons name="storefront" size={44} color={colors.buy} />
              <Txt variant="title">Free for people. Fair for brands.</Txt>
              <Txt>Connectly is free for everyone who buys, sells or connects. Brands and shops support the app in two simple ways:</Txt>
            </Card>
            <Card style={{ marginTop: 12, gap: 14 }}>
              <Perk icon="megaphone" title="Sponsored placements" text="Your offer appears, clearly marked, on Home and Deals. You pay a small amount only when someone taps it, and you set a daily limit." />
              <Perk icon="handshake" title="Brokerage on completed deals" text="When you sell through Connectly, a small commission applies only after the deal is completed. No sale, no fee." />
              <Perk icon="shield-checkmark" title="Trust badge" text="A Brand label so customers know who they are buying from." />
            </Card>
            <View style={{ marginTop: space.lg }}>
              <Input label="Your brand or shop name" value={brandName} onChangeText={setBrandName} placeholder="e.g. Nair Home Studio" maxLength={60} />
              <Button title="Become a brand partner" icon="storefront" variant="buy" onPress={become} loading={busy} disabled={brandName.trim().length < 2} />
              <Txt variant="small" color={colors.sub} center style={{ marginTop: 12 }}>Joining is free. You can switch back to a personal account any time.</Txt>
            </View>
          </FadeIn>
        </Screen>
      </KeyboardAvoidingView>
    );
  }
  return <BrandDashboard />;
}

const Perk = ({ icon, title, text }: { icon: any; title: string; text: string }) => (
  <View style={{ flexDirection: 'row', gap: 12 }}>
    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon === 'handshake' ? 'ribbon' : icon} size={24} color={colors.primary} /></View>
    <View style={{ flex: 1 }}><Txt bold>{title}</Txt><Txt variant="small" color={colors.sub}>{text}</Txt></View>
  </View>
);

function BrandDashboard() {
  const { user, setUser } = useAuth();
  const summary = useLoad(() => api<Summary>('/brand/summary'), []);
  const ads = useLoad(() => api<{ ads: AdRow[] }>('/brand/ads'), []);
  const mine = useLoad(() => api<{ listings: Listing[] }>('/me/listings'), []);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ title: '', body: '', listingId: 0, budget: 200, cpc: 3, placement: 'all' });
  const [busy, setBusy] = useState(false);
  const active = (mine.data?.listings || []).filter((l) => l.status === 'active');
  const s = summary.data;

  const reloadAll = () => { void summary.reload(true); void ads.reload(true); };
  const create = async () => {
    setBusy(true);
    try {
      await api('/brand/ads', { method: 'POST', body: { title: f.title, body: f.body, listingId: f.listingId || undefined, dailyBudget: f.budget, costPerClick: f.cpc, placement: f.placement } });
      setCreating(false); setF({ title: '', body: '', listingId: 0, budget: 200, cpc: 3, placement: 'all' }); reloadAll(); toast('Your ad is live');
    } catch (e: any) { notify('Could not create the ad', e.message); } finally { setBusy(false); }
  };
  const toggle = async (a: AdRow) => { await api(`/brand/ads/${a.id}/status`, { method: 'POST', body: { status: a.status === 'active' ? 'paused' : 'active' } }); reloadAll(); };
  const remove = async (a: AdRow) => { if (await confirmDialog('Delete this ad?', a.title, 'Delete', true)) { await api(`/brand/ads/${a.id}`, { method: 'DELETE' }); reloadAll(); } };
  const leave = async () => {
    if (!(await confirmDialog('Switch to a personal account?', 'Your ads will be paused. Nothing else changes.', 'Switch'))) return;
    setUser((await api<{ user: Me }>('/me/brand', { method: 'DELETE' })).user);
  };

  return (
    <Screen header={<Header title={user?.brandName || 'Brand hub'} subtitle="Brand partner" />} refresh={{ refreshing: summary.refreshing, onRefresh: () => { summary.refresh(); void ads.reload(true); } }}>
      {summary.loading && !s ? <SkeletonRows count={2} avatar={false} /> : s ? <FadeIn>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <Tile label="Ad clicks" value={String(s.ads.clicks)} color={colors.primary} />
          <Tile label="Ad spend" value={money(s.ads.spend)} />
          <Tile label={`Brokerage (${Math.round(s.commissionRate * 100)}% on ${s.brokerage.deals} deals)`} value={money(s.brokerage.fees)} />
          <Tile label="Total due" value={money(s.totalDue)} color={colors.sell} />
        </View>
        <Txt variant="tiny" color={colors.sub} style={{ marginTop: 8 }}>Billed as an invoice. Individuals using Connectly are never charged.</Txt>
      </FadeIn> : null}

      <SectionTitle title="Your ads" action={creating ? undefined : 'New ad'} onAction={() => setCreating(true)} />
      {creating ? (
        <Card style={{ gap: 4, marginBottom: 12 }}>
          <Input label="Headline" value={f.title} onChangeText={(v) => setF({ ...f, title: v })} placeholder="e.g. Comfort for your home office" maxLength={80} />
          <Input label="Short message (optional)" value={f.body} onChangeText={(v) => setF({ ...f, body: v })} maxLength={160} />
          <Txt bold style={{ marginBottom: 8 }}>Promote one of your items</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {active.length ? active.map((l) => <Chip key={l.id} label={l.title.length > 24 ? l.title.slice(0, 22) + '…' : l.title} selected={f.listingId === l.id} onPress={() => setF({ ...f, listingId: l.id })} />) : <Txt color={colors.sub}>List an item first to promote it.</Txt>}
          </View>
          <Txt bold style={{ marginVertical: 8 }}>Daily limit</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[100, 200, 500, 1000].map((b) => <Chip key={b} label={money(b)} selected={f.budget === b} onPress={() => setF({ ...f, budget: b })} />)}</View>
          <Txt bold style={{ marginVertical: 8 }}>Pay per tap</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[2, 3, 5, 8].map((c) => <Chip key={c} label={`₹${c}`} selected={f.cpc === c} onPress={() => setF({ ...f, cpc: c })} />)}</View>
          <Txt variant="small" color={colors.sub}>A higher amount is shown more often. You never spend more than your daily limit.</Txt>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setCreating(false)} />
            <Button title="Start ad" variant="sell" style={{ flex: 1 }} onPress={create} loading={busy} disabled={f.title.trim().length < 3 || !f.listingId} />
          </View>
        </Card>
      ) : null}
      {ads.loading && !ads.data ? <SkeletonRows count={2} avatar={false} /> : !ads.data?.ads.length && !creating ? <Empty icon="megaphone" title="No ads yet" text="Promote an item to reach more people nearby." action={{ title: 'Create an ad', onPress: () => setCreating(true) }} /> :
        <View style={{ gap: 10 }}>
          {ads.data?.ads.map((a, i) => (
            <FadeIn key={a.id} index={i}>
              <Card style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Txt bold style={{ flex: 1 }} numberOfLines={2}>{a.title}</Txt><Pill text={a.status === 'active' ? 'Live' : 'Paused'} color={a.status === 'active' ? colors.buy : colors.sub} bg={a.status === 'active' ? colors.buySoft : colors.line} /></View>
                <Txt variant="small" color={colors.sub}>{a.impressions} views · {a.clicks} taps · {money(a.spend)} spent · limit {money(a.dailyBudget)}/day</Txt>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button compact variant="light" title={a.status === 'active' ? 'Pause' : 'Resume'} style={{ flex: 1 }} onPress={() => toggle(a)} />
                  <Button compact variant="light" title="" icon="trash" style={{ width: 52, paddingHorizontal: 0 }} onPress={() => remove(a)} />
                </View>
              </Card>
            </FadeIn>
          ))}
        </View>}
      <Button title="Switch to a personal account" variant="ghost" onPress={leave} style={{ marginTop: 24 }} />
    </Screen>
  );
}

import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api';
import { useDebounced, useLoad } from '../hooks';
import { Chip, Empty, ErrorState, FadeIn, Header, Screen, Txt, SkeletonCardGrid } from '../ui';
import { colors, radius } from '../theme';
import { Product } from '../types';
import { DISCLOSURE, DealCard } from '../components/DealCard';
import { useSettings } from '../context';
import { SponsoredCard, useAds } from '../components/Sponsored';

const TOPICS = [
  { id: '', label: 'Trending' }, { id: 'electronics', label: 'Electronics' }, { id: 'fashion', label: 'Fashion' },
  { id: 'home', label: 'Home' }, { id: 'vehicles', label: 'Vehicles' }, { id: 'others', label: 'More' },
];

/** Affiliate deals from Google Shopping (via SearchAPI). Anyone can browse these by default. */
export function Deals() {
  const { scale } = useSettings();
  const [topic, setTopic] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const qs = new URLSearchParams({ limit: '30' });
  if (dq.trim()) qs.set('q', dq.trim()); else if (topic) qs.set('category', topic);
  const res = useLoad(() => api<{ products: Product[]; sample: boolean; disclosure: string }>(`/products?${qs}`), [qs.toString()]);
  const items = res.data?.products || [];
  const ads = useAds('deals');

  return (
    <Screen header={<Header title="Deals" subtitle="Top offers from online stores" />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.pill, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 16, minHeight: 56, gap: 10 }}>
        <Ionicons name="search" size={24} color={colors.primary} />
        <TextInput accessibilityLabel="Search deals" value={q} onChangeText={setQ} placeholder="Search products…" placeholderTextColor="#7A8794" style={{ flex: 1, fontSize: 18 * scale, color: colors.text, minHeight: 52 }} returnKeyType="search" />
        {q ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')} hitSlop={10}><Ionicons name="close-circle" size={26} color={colors.sub} /></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 14, flexGrow: 0 }}>
        {TOPICS.map((t) => <Chip key={t.id} label={t.label} selected={!dq.trim() && topic === t.id} onPress={() => { setQ(''); setTopic(t.id); }} />)}
      </ScrollView>
      {res.data?.sample ? <View style={{ backgroundColor: colors.warnSoft, padding: 12, borderRadius: 12, marginBottom: 12 }}><Txt variant="small" color={colors.warn}>Sample products shown. Live prices appear once the server has a SearchAPI key.</Txt></View> : null}
      {res.loading && !res.data ? <SkeletonCardGrid /> : res.error && !res.data ? <ErrorState message={res.error} retry={() => res.reload()} /> :
        !items.length ? <Empty icon="pricetags" title="No deals found" text="Try a simpler search word." /> :
          <>
            {ads[0] ? <View style={{ marginBottom: 12 }}><SponsoredCard ad={ads[0]} /></View> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {items.map((p, i) => <FadeIn key={p.id} index={i} style={{ width: '47.5%', flexGrow: 1, flexBasis: '45%' }}><DealCard p={p} /></FadeIn>)}
            </View>
          </>}
      <Txt variant="tiny" color={colors.sub} center style={{ marginTop: 20 }}>{res.data?.disclosure || DISCLOSURE}</Txt>
    </Screen>
  );
}

import React, { useState } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { useAuth, useSettings } from '../context';
import { useLoad } from '../hooks';
import { Empty, ErrorState, FadeIn, IconName, Screen, SectionTitle, Skeleton, SkeletonCardGrid, Txt } from '../ui';
import { DealCard } from '../components/DealCard';
import { SponsoredCard, useAds } from '../components/Sponsored';
import { ListingGrid, toggleFavorite } from '../components/ListingCard';
import { Hero, HeroSlide, haptic, useRotating } from '../motion';
import { colors, radius, shadow, space } from '../theme';
import { Listing, Product } from '../types';

const EXAMPLES = ['iPhone', 'sofa set', 'bicycle', 'tuition', 'sarees'];

function Quick({ icon, label, tint, onPress }: { icon: IconName; label: string; tint: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { haptic.tap(); onPress(); }}
      style={({ pressed }) => ({ flex: 1, minHeight: 108, borderRadius: radius.lg, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder, alignItems: 'center', justifyContent: 'center', gap: 10, transform: [{ scale: pressed ? 0.96 : 1 }], ...shadow })}>
      <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: tint + '1F', alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={28} color={tint} /></View>
      <Txt bold>{label}</Txt>
    </Pressable>
  );
}

export function Home() {
  const nav = useNavigation<any>();
  const { user } = useAuth();
  const { scale } = useSettings();
  const insets = useSafeAreaInsets();
  const feed = useLoad(() => api<{ listings: Listing[] }>('/listings?limit=6&sort=nearest'), []);
  const unread = useLoad(() => api<{ messages: number; requests: number; notifications: number }>('/unread-count'), []);
  const deals = useLoad(() => api<{ products: Product[] }>('/products?limit=8'), []);
  const ads = useAds('home');
  const hint = useRotating(EXAMPLES);
  const [, force] = useState(0);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const badge = unread.data?.notifications || 0;

  const slides: HeroSlide[] = [
    { id: 'sell', title: "Sell what you don't need", text: 'Add photos, set a price, done in a minute.', icon: 'pricetag', colors: ['#4F46E5', '#7C3AED'], cta: 'Start selling', onPress: () => nav.navigate('SellItem') },
    { id: 'deals', title: "Today's deals", text: 'Top offers from online stores, updated daily.', icon: 'flash', colors: ['#0E8A5F', '#14B8A6'], cta: 'See deals', onPress: () => nav.navigate('Deals') },
    { id: 'invite', title: 'Bring your people', text: 'Invite friends and family to Connectly.', icon: 'gift', colors: ['#D9480F', '#F59E0B'], cta: 'Invite', onPress: () => nav.navigate('Invite') },
  ];
  const items = feed.data?.listings || [];

  return (
    <Screen refresh={{ refreshing: feed.refreshing, onRefresh: () => { feed.refresh(); void unread.reload(true); void deals.reload(true); } }} contentStyle={{ paddingTop: insets.top + 14 }}>
      <FadeIn style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <View>
          <Txt variant="small" color={colors.sub}>{hello}</Txt>
          <Txt variant="title" numberOfLines={1}>{user?.name.split(' ')[0]}</Txt>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Notifications${badge ? `, ${badge} new` : ''}`} onPress={() => nav.navigate('Notifications')}
          style={({ pressed }) => ({ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1, ...shadow })}>
          <Ionicons name="notifications-outline" size={26} color={colors.text} />
          {badge ? <View style={{ position: 'absolute', top: 10, right: 11, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.danger, borderWidth: 2, borderColor: '#fff' }} /> : null}
        </Pressable>
      </FadeIn>

      <Pressable accessibilityRole="search" accessibilityLabel="Search products, services or people" onPress={() => nav.navigate('Search')}
        style={{ minHeight: 60, borderRadius: radius.pill, backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.glassBorder, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12, ...shadow }}>
        <Ionicons name="search" size={22} color={colors.sub} />
        <Animated.Text numberOfLines={1} style={[{ fontSize: 18 * scale, color: colors.sub, flex: 1 }, hint.style as any]}>Search “{hint.text}”</Animated.Text>
      </Pressable>

      <FadeIn index={1} style={{ flexDirection: 'row', gap: 12, marginTop: space.lg }}>
        <Quick icon="bag-handle-outline" label="Buy" tint={colors.buy} onPress={() => nav.navigate('Listings', {})} />
        <Quick icon="pricetag-outline" label="Sell" tint={colors.sell} onPress={() => nav.navigate('SellItem')} />
        <Quick icon="people-outline" label="Connect" tint={colors.primary} onPress={() => nav.navigate('Connect')} />
      </FadeIn>

      <View style={{ marginTop: space.lg }}><Hero slides={slides} /></View>

      <SectionTitle title="Today's deals" action="See all" onAction={() => nav.navigate('Deals')} />
      {deals.loading && !deals.data ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>{[0, 1].map((i) => <Skeleton key={i} width={190} height={290} radius={28} />)}</View>
      ) : deals.data?.products.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 8, paddingBottom: 12 }} style={{ marginHorizontal: -space.lg, paddingHorizontal: space.lg }}>
          {deals.data.products.map((p, i) => <FadeIn key={p.id} index={i}><DealCard p={p} width={190} /></FadeIn>)}
        </ScrollView>
      ) : <Txt color={colors.sub}>Deals will appear here shortly.</Txt>}
      {ads.length ? <View style={{ marginTop: space.md }}>{ads.slice(0, 1).map((a) => <SponsoredCard key={a.id} ad={a} />)}</View> : null}

      <SectionTitle title="Near you" action="See all" onAction={() => nav.navigate('Listings', { sort: 'nearest' })} />
      {feed.loading && !feed.data ? <SkeletonCardGrid /> : feed.error && !feed.data ? <ErrorState message={feed.error} retry={() => feed.reload()} /> :
        items.length === 0 ? <Empty icon="pricetag-outline" title="Nothing listed yet" text="Be the first to sell something in your area." action={{ title: 'Sell an item', onPress: () => nav.navigate('SellItem') }} /> :
          <ListingGrid items={items} onOpen={(l) => nav.navigate('ItemDetails', { id: l.id })}
            onToggleFav={(l) => toggleFavorite(l, (next) => { feed.setData({ listings: items.map((x) => (x.id === next.id ? next : x)) }); force((n) => n + 1); })} />}
    </Screen>
  );
}

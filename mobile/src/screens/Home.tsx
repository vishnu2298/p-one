import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api';
import { useAuth } from '../context';
import { useLoad } from '../hooks';
import { Card, Empty, ErrorState, FadeIn, Screen, SectionTitle, SkeletonCardGrid, Skeleton, Txt, IconName } from '../ui';
import { ScrollView } from 'react-native';
import { DealCard } from '../components/DealCard';
import { SponsoredCard, useAds } from '../components/Sponsored';
import { Product } from '../types';
import { colors, radius, shadow, space } from '../theme';
import { CATEGORIES } from '../categories';
import { Listing } from '../types';
import { ListingGrid, toggleFavorite } from '../components/ListingCard';
import { Logo } from '../components/Logo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function BigAction({ icon, title, hint, color, bg, onPress }: { icon: IconName; title: string; hint: string; color: string; bg: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${hint}`} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, minHeight: 92, borderLeftWidth: 8, borderLeftColor: color, opacity: pressed ? 0.9 : 1, ...shadow })}>
      <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={32} color={color} /></View>
      <View style={{ flex: 1 }}>
        <Txt variant="h2" color={color}>{title}</Txt>
        <Txt variant="small" color={colors.sub}>{hint}</Txt>
      </View>
      <Ionicons name="chevron-forward" size={28} color={color} />
    </Pressable>
  );
}

export function Home() {
  const nav = useNavigation<any>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const feed = useLoad(() => api<{ listings: Listing[] }>('/listings?limit=6&sort=nearest'), []);
  const unread = useLoad(() => api<{ messages: number; requests: number; notifications: number }>('/unread-count'), []);
  const deals = useLoad(() => api<{ products: Product[] }>('/products?limit=8'), []);
  const ads = useAds('home');
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const [, force] = useState(0);
  const badge = unread.data?.notifications || 0;

  const header = (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: space.lg, paddingBottom: 12, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Logo size={44} />
      <View style={{ flex: 1 }}>
        <Txt variant="small" color={colors.sub}>{hello} 👋</Txt>
        <Txt variant="h2" numberOfLines={1}>{user?.name.split(' ')[0]}</Txt>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Notifications${badge ? `, ${badge} new` : ''}`} onPress={() => nav.navigate('Notifications')} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="notifications" size={26} color={colors.primary} />
        {badge ? <View style={{ position: 'absolute', top: 4, right: 4, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Txt variant="tiny" bold color="#fff" style={{ lineHeight: 16 }}>{badge}</Txt></View> : null}
      </Pressable>
    </View>
  );

  const items = feed.data?.listings || [];
  return (
    <Screen header={header} refresh={{ refreshing: feed.refreshing, onRefresh: () => { feed.refresh(); void unread.reload(true); void deals.reload(true); } }}>
      <Pressable accessibilityRole="search" accessibilityLabel="Search products, services or people" onPress={() => nav.navigate('Search')}
        style={{ minHeight: 60, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 2, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12 }}>
        <Ionicons name="search" size={26} color={colors.primary} />
        <Txt color={colors.sub}>Search for anything…</Txt>
      </Pressable>

      <View style={{ gap: 12, marginTop: space.lg }}>
        <BigAction icon="cart" title="Buy" hint="Find what you need nearby" color={colors.buy} bg={colors.buySoft} onPress={() => nav.navigate('Listings', {})} />
        <BigAction icon="pricetag" title="Sell" hint="List your items" color={colors.sell} bg={colors.sellSoft} onPress={() => nav.navigate('SellItem')} />
        <BigAction icon="people" title="Connect" hint="Meet people nearby" color={colors.connect} bg={colors.connectSoft} onPress={() => nav.navigate('Connect')} />
      </View>

      <SectionTitle title="Today's deals" action="See all" onAction={() => nav.navigate('Deals')} />
      {deals.loading && !deals.data ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>{[0, 1].map((i) => <Skeleton key={i} width={190} height={290} radius={24} />)}</View>
      ) : deals.data?.products.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 8 }}>
          {deals.data.products.map((p, i) => <FadeIn key={p.id} index={i}><DealCard p={p} width={190} /></FadeIn>)}
        </ScrollView>
      ) : <Txt color={colors.sub}>Deals will appear here shortly.</Txt>}
      {ads.length ? <View style={{ marginTop: space.lg, gap: 10 }}>{ads.slice(0, 1).map((a) => <SponsoredCard key={a.id} ad={a} />)}</View> : null}

      <SectionTitle title="Popular categories" action="See all" onAction={() => nav.navigate('Explore')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {CATEGORIES.slice(0, 8).map((c) => (
          <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.name} onPress={() => nav.navigate('Listings', { category: c.id })}
            style={{ width: '23%', flexGrow: 1, minWidth: 74, alignItems: 'center', gap: 6, paddingVertical: 8 }}>
            <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={c.icon as any} size={32} color={c.color} /></View>
            <Txt variant="tiny" bold center numberOfLines={2}>{c.name}</Txt>
          </Pressable>
        ))}
      </View>

      <SectionTitle title="Near you" action="See all" onAction={() => nav.navigate('Listings', { sort: 'nearest' })} />
      {feed.loading && !feed.data ? <SkeletonCardGrid /> : feed.error && !feed.data ? <ErrorState message={feed.error} retry={() => feed.reload()} /> :
        items.length === 0 ? <Empty icon="pricetag" title="Nothing listed yet" text="Be the first to sell something in your area." action={{ title: 'Sell an item', onPress: () => nav.navigate('SellItem') }} /> :
          <ListingGrid items={items} onOpen={(l) => nav.navigate('ItemDetails', { id: l.id })}
            onToggleFav={(l) => toggleFavorite(l, (next) => { feed.setData({ listings: items.map((x) => (x.id === next.id ? next : x)) }); force((n) => n + 1); })} />}

      <Card style={{ marginTop: space.xl, backgroundColor: colors.buySoft, flexDirection: 'row', gap: 12, alignItems: 'center' }} onPress={() => nav.navigate('Safety')}>
        <Ionicons name="shield-checkmark" size={40} color={colors.buy} />
        <View style={{ flex: 1 }}>
          <Txt bold color={colors.buy}>Trusted. Safe. Simple.</Txt>
          <Txt variant="small" color={colors.text}>Read our safety tips before you meet or pay anyone.</Txt>
        </View>
      </Card>
    </Screen>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, storage } from '../api';
import { useLoad, useDebounced } from '../hooks';
import { Avatar, Button, Card, Chip, Empty, ErrorState, Header, Loading, Pill, Screen, Stars, Txt, Row, SkeletonCardGrid, SkeletonRows } from '../ui';
import { colors, radius, space } from '../theme';
import { CATEGORIES, CITIES, catById } from '../categories';
import { Listing, Category, UserBrief } from '../types';
import { ListingGrid, toggleFavorite } from '../components/ListingCard';
import { useSettings } from '../context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SORTS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'nearest', label: 'Nearest to me' },
  { id: 'price_asc', label: 'Price: low to high' },
  { id: 'price_desc', label: 'Price: high to low' },
];
const PRICES = [
  { label: 'Any price' }, { label: 'Under ₹5,000', max: 5000 }, { label: '₹5,000 – ₹25,000', min: 5000, max: 25000 }, { label: 'Over ₹25,000', min: 25000 },
] as { label: string; min?: number; max?: number }[];
const PAGE = 20;

/** "Buy" screen: product listings with category, city, price and sort filters. */
export function Listings() {
  const nav = useNavigation<any>();
  const params = (useRoute().params || {}) as { category?: string; sort?: string; q?: string };
  const [category, setCategory] = useState<string | undefined>(params.category);
  const [sort, setSort] = useState(params.sort || 'newest');
  const [city, setCity] = useState<string | undefined>();
  const [price, setPrice] = useState(0);
  const [q, setQ] = useState(params.q || '');
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const dq = useDebounced(q);
  const { scale } = useSettings();

  const qs = new URLSearchParams({ limit: String(limit), sort });
  if (category) qs.set('category', category);
  if (city) qs.set('city', city);
  if (dq.trim()) qs.set('q', dq.trim());
  if (PRICES[price].min) qs.set('minPrice', String(PRICES[price].min));
  if (PRICES[price].max) qs.set('maxPrice', String(PRICES[price].max));
  const key = qs.toString();
  const res = useLoad(() => api<{ listings: Listing[]; total: number }>(`/listings?${key}`), [key]);
  const items = res.data?.listings || [];
  const active = (city ? 1 : 0) + (price ? 1 : 0) + (sort !== 'newest' ? 1 : 0);
  const title = category ? catById(category).name : 'Buy';

  return (
    <Screen
      header={<Header title={title} right={
        <Pressable accessibilityRole="button" accessibilityLabel="Filters and sorting" onPress={() => setShowFilters(true)} style={{ minHeight: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 24, backgroundColor: colors.primarySoft }}>
          <Ionicons name="options" size={22} color={colors.primary} /><Txt bold color={colors.primary}>Filter{active ? ` (${active})` : ''}</Txt>
        </Pressable>} />}
      refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.pill, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 16, minHeight: 56, gap: 10 }}>
        <Ionicons name="search" size={24} color={colors.primary} />
        <TextInput accessibilityLabel="Search items" value={q} onChangeText={(v) => { setQ(v); setLimit(PAGE); }} placeholder="Search items…" placeholderTextColor="#7A8794" style={{ flex: 1, fontSize: 18 * scale, color: colors.text, minHeight: 52 }} returnKeyType="search" />
        {q ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')} hitSlop={10}><Ionicons name="close-circle" size={26} color={colors.sub} /></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14, flexGrow: 0 }}>
        <Chip label="All" selected={!category} onPress={() => { setCategory(undefined); setLimit(PAGE); }} />
        {CATEGORIES.map((c) => <Chip key={c.id} label={c.name} icon={c.icon as any} selected={category === c.id} onPress={() => { setCategory(c.id); setLimit(PAGE); }} />)}
      </ScrollView>
      {city ? <View style={{ flexDirection: 'row', marginBottom: 8 }}><Pill text={`In ${city}`} icon="location" /></View> : null}

      {res.loading && !res.data ? <SkeletonCardGrid /> : res.error && !res.data ? <ErrorState message={res.error} retry={() => res.reload()} /> :
        items.length === 0 ? <Empty icon="search" title="No items found" text="Try a different word, category or filter." action={{ title: 'Clear everything', onPress: () => { setQ(''); setCategory(undefined); setCity(undefined); setPrice(0); setSort('newest'); } }} /> : <>
          <Txt variant="small" color={colors.sub} style={{ marginVertical: 8 }}>{res.data?.total} item{res.data?.total === 1 ? '' : 's'} found</Txt>
          <ListingGrid items={items} onOpen={(l) => nav.navigate('ItemDetails', { id: l.id })}
            onToggleFav={(l) => toggleFavorite(l, (n) => res.setData({ ...res.data!, listings: items.map((x) => (x.id === n.id ? n : x)) }))} />
          {(res.data?.total || 0) > items.length ? <Button title="Show more items" variant="secondary" style={{ marginTop: 16 }} onPress={() => setLimit(limit + PAGE)} /> : null}
        </>}

      <FilterSheet visible={showFilters} onClose={() => setShowFilters(false)} sort={sort} setSort={setSort} city={city} setCity={setCity} price={price} setPrice={setPrice} />
    </Screen>
  );
}

function FilterSheet({ visible, onClose, sort, setSort, city, setCity, price, setPrice }: any) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close filters" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: space.lg, paddingBottom: insets.bottom + 16, maxHeight: '88%', width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <ScrollView>
            <Txt variant="title" style={{ marginBottom: 12 }}>Filter and sort</Txt>
            <Txt bold style={{ marginBottom: 8 }}>Sort by</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{SORTS.map((s) => <Chip key={s.id} label={s.label} selected={sort === s.id} onPress={() => setSort(s.id)} />)}</View>
            <Txt bold style={{ marginVertical: 8 }}>Price</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{PRICES.map((p, i) => <Chip key={p.label} label={p.label} selected={price === i} onPress={() => setPrice(i)} />)}</View>
            <Txt bold style={{ marginVertical: 8 }}>City</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Chip label="Anywhere" selected={!city} onPress={() => setCity(undefined)} />
              {CITIES.map((c) => <Chip key={c} label={c} selected={city === c} onPress={() => setCity(c)} />)}
            </View>
          </ScrollView>
          <Button title="Show results" onPress={onClose} style={{ marginTop: 12 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Explore: category browser. */
export function Explore() {
  const nav = useNavigation<any>();
  const cats = useLoad(() => api<{ categories: Category[] }>('/categories'), []);
  const counts = Object.fromEntries((cats.data?.categories || []).map((c) => [c.id, c.count]));
  return (
    <Screen header={<Header title="Explore" back={false} />} refresh={{ refreshing: cats.refreshing, onRefresh: cats.refresh }}>
      <Pressable accessibilityRole="search" onPress={() => nav.navigate('Search')} style={{ minHeight: 60, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 2, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12, marginBottom: space.lg }}>
        <Ionicons name="search" size={26} color={colors.primary} /><Txt color={colors.sub}>Search categories or items…</Txt>
      </Pressable>
      <Row icon="pricetags" label="Deals from online stores" value="Top offers, updated daily" onPress={() => nav.navigate('Deals')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        {CATEGORIES.map((c) => (
          <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.name}. ${c.hint}`} onPress={() => nav.navigate('Listings', { category: c.id })}
            style={({ pressed }) => ({ width: '47.5%', flexGrow: 1, flexBasis: '45%', backgroundColor: c.bg, borderRadius: radius.lg, padding: 16, minHeight: 150, gap: 6, opacity: pressed ? 0.9 : 1 })}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><Ionicons name={c.icon as any} size={30} color={c.color} /></View>
            <Txt bold color={c.color} style={{ fontSize: undefined }}>{c.name}</Txt>
            <Txt variant="tiny" color={colors.text}>{c.hint}</Txt>
            {counts[c.id] ? <Txt variant="tiny" bold color={c.color}>{counts[c.id]} listed</Txt> : null}
          </Pressable>
        ))}
      </View>
      <Row icon="people" label="People nearby" value="Meet and connect with neighbours" onPress={() => nav.navigate('Connect')} />
    </Screen>
  );
}

/** Search across items and people, with remembered recent searches. */
export function Search() {
  const nav = useNavigation<any>();
  const { scale } = useSettings();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [recent, setRecent] = useState<string[]>([]);
  const [results, setResults] = useState<{ listings: Listing[]; people: UserBrief[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { storage.get('recentSearches').then((v) => { try { setRecent(v ? JSON.parse(v) : []); } catch { /* ignore */ } }); }, []);
  useEffect(() => {
    const t = dq.trim();
    if (!t) { setResults(null); return; }
    let live = true;
    setBusy(true);
    api<{ listings: Listing[]; people: UserBrief[] }>(`/search?q=${encodeURIComponent(t)}`)
      .then((r) => { if (live) { setResults(r); setError(null); } })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [dq]);

  const remember = useCallback((t: string) => {
    const next = [t, ...recent.filter((x) => x !== t)].slice(0, 6);
    setRecent(next); void storage.set('recentSearches', JSON.stringify(next));
  }, [recent]);

  return (
    <Screen header={<Header title="Search" />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.pill, borderWidth: 2, borderColor: colors.primary, paddingHorizontal: 16, minHeight: 58, gap: 10 }}>
        <Ionicons name="search" size={24} color={colors.primary} />
        <TextInput autoFocus accessibilityLabel="Search" value={q} onChangeText={setQ} placeholder="Items, services or people…" placeholderTextColor="#7A8794" style={{ flex: 1, fontSize: 18 * scale, color: colors.text, minHeight: 52 }} returnKeyType="search" onSubmitEditing={() => q.trim() && remember(q.trim())} />
        {q ? <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => setQ('')} hitSlop={10}><Ionicons name="close-circle" size={26} color={colors.sub} /></Pressable> : null}
      </View>
      {!q.trim() ? (
        <View style={{ marginTop: 16 }}>
          {recent.length ? <><Txt bold style={{ marginBottom: 8 }}>Recent searches</Txt><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{recent.map((r) => <Chip key={r} icon="time" label={r} onPress={() => setQ(r)} />)}</View></> : null}
          <Txt bold style={{ marginVertical: 8 }}>Try a category</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{CATEGORIES.map((c) => <Chip key={c.id} icon={c.icon as any} label={c.name} onPress={() => nav.replace('Listings', { category: c.id })} />)}</View>
        </View>
      ) : busy && !results ? <SkeletonRows count={3} /> : error ? <ErrorState message={error} /> : results && results.listings.length + results.people.length === 0 ? (
        <Empty icon="search" title="Nothing found" text={`We couldn't find anything for "${q.trim()}". Try a simpler word.`} />
      ) : results ? (
        <View style={{ marginTop: 16, gap: 8 }}>
          {results.people.length ? <>
            <Txt variant="h2">People</Txt>
            {results.people.map((p) => (
              <Card key={p.id} onPress={() => { remember(q.trim()); nav.navigate('UserProfile', { id: p.id }); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar name={p.name} uri={p.avatar} />
                <View style={{ flex: 1 }}><Txt bold>{p.name}</Txt><Txt variant="small" color={colors.sub}>{p.city}</Txt></View>
                {p.reviewCount ? <Stars rating={p.rating} size={16} /> : null}
              </Card>
            ))}
          </> : null}
          {results.listings.length ? <>
            <Txt variant="h2" style={{ marginTop: 8 }}>Items</Txt>
            <ListingGrid items={results.listings} onOpen={(l) => { remember(q.trim()); nav.navigate('ItemDetails', { id: l.id }); }} />
          </> : null}
        </View>
      ) : null}
    </Screen>
  );
}

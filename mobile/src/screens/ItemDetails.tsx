import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ApiError, api, money, timeAgo } from '../api';
import { useLoad } from '../hooks';
import { Avatar, Button, Card, ErrorState, Header, Input, Loading, Pill, Screen, Stars, Txt, confirmDialog, notify, Skeleton } from '../ui';
import { colors, radius, space } from '../theme';
import { catById } from '../categories';
import { Listing } from '../types';
import { ListingImage } from '../components/ListingCard';
import { imageUrl } from '../api';
import { Image } from 'react-native';

export function ItemDetails() {
  const nav = useNavigation<any>();
  const { id } = useRoute<any>().params;
  const res = useLoad(() => api<{ listing: Listing }>(`/listings/${id}`), [id]);
  const { width } = useWindowDimensions();
  const gw = Math.min(width, 480);
  const [page, setPage] = useState(0);
  const [buyOpen, setBuyOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const scroller = useRef<any>(null);

  if (res.loading && !res.data) return <Screen header={<Header title="Item details" />}><Skeleton height={240} radius={20} /><Skeleton width="70%" height={28} style={{ marginTop: 16 }} /><Skeleton width="40%" height={34} style={{ marginTop: 12 }} /><Skeleton height={80} style={{ marginTop: 16 }} /></Screen>;
  if (!res.data) return <Screen scroll={false} header={<Header title="Item details" />}><ErrorState message={res.error || 'This item is no longer available'} retry={() => res.reload()} /></Screen>;
  const l = res.data.listing;
  const cat = catById(l.category);
  const set = (n: Listing) => res.setData({ listing: n });

  const toggleFav = async () => {
    set({ ...l, isFavorite: !l.isFavorite });
    try { await api(`/listings/${l.id}/favorite`, { method: l.isFavorite ? 'DELETE' : 'POST' }); } catch { set(l); }
  };
  const chat = async () => {
    try {
      const r = await api<{ conversation: { id: number } }>('/conversations', { method: 'POST', body: { userId: l.seller.id, listingId: l.id } });
      nav.navigate('Chat', { id: r.conversation.id });
    } catch (e: any) { notify('Could not open chat', e.message); }
  };
  const buy = async () => {
    setBusy(true);
    try {
      await api('/orders', { method: 'POST', body: { listingId: l.id, note } });
      setRequested(true);
    } catch (e: any) {
      setBuyOpen(false);
      notify('Could not send request', e.message);
    } finally { setBusy(false); }
  };
  const setStatus = async (status: 'active' | 'sold') => {
    try { set((await api<{ listing: Listing }>(`/listings/${l.id}/status`, { method: 'POST', body: { status } })).listing); } catch (e: any) { notify('Error', e.message); }
  };
  const remove = async () => {
    if (!(await confirmDialog('Delete this item?', 'This cannot be undone.', 'Delete', true))) return;
    try { await api(`/listings/${l.id}`, { method: 'DELETE' }); nav.goBack(); } catch (e: any) { notify('Could not delete', e instanceof ApiError ? e.message : 'Try again'); }
  };

  const footer = l.isMine ? (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Edit" icon="create" variant="secondary" style={{ flex: 1 }} onPress={() => nav.navigate('SellItem', { id: l.id })} />
        <Button title={l.status === 'sold' ? 'Relist' : 'Mark sold'} icon={l.status === 'sold' ? 'refresh' : 'checkmark-circle'} variant="buy" style={{ flex: 1 }} onPress={() => setStatus(l.status === 'sold' ? 'active' : 'sold')} />
      </View>
      <Button title="Delete item" variant="ghost" onPress={remove} />
    </View>
  ) : l.status === 'sold' ? (
    <View style={{ backgroundColor: colors.warnSoft, borderRadius: 12, padding: 14 }}><Txt bold color={colors.warn} center>This item has been sold</Txt></View>
  ) : (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Button title="Chat" icon="chatbubble-ellipses" variant="secondary" style={{ flex: 1 }} onPress={chat} />
      <Button title="Buy Now" icon="cart" variant="buy" style={{ flex: 1.2 }} onPress={() => { setRequested(false); setBuyOpen(true); }} />
    </View>
  );

  return (
    <Screen
      scroll={false}
      header={<Header title="Item details" right={
        <View style={{ flexDirection: 'row' }}>
          <IconBtn icon="share-social" label="Share" onPress={() => Share.share({ message: `${l.title} - ${money(l.price)} on Connectly` }).catch(() => {})} />
          {!l.isMine ? <IconBtn icon={l.isFavorite ? 'heart' : 'heart-outline'} label={l.isFavorite ? 'Remove from saved' : 'Save'} color={l.isFavorite ? colors.danger : colors.text} onPress={toggleFav} /> : null}
        </View>} />}
      footer={footer}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View>
          {l.images.length ? (
            <ScrollView ref={scroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / gw))}>
              {l.images.map((u) => <Image key={u} source={{ uri: imageUrl(u) }} accessibilityLabel={l.title} style={{ width: gw, height: 280, backgroundColor: cat.bg }} resizeMode="cover" />)}
            </ScrollView>
          ) : <ListingImage listing={l} height={240} iconSize={96} />}
          {l.images.length > 1 ? <View style={{ position: 'absolute', right: 12, bottom: 12, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 }}><Txt variant="small" bold color="#fff">{page + 1}/{l.images.length}</Txt></View> : null}
          {l.status === 'sold' ? <View style={{ position: 'absolute', left: 12, top: 12, backgroundColor: colors.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 6 }}><Txt bold color="#fff">SOLD</Txt></View> : null}
        </View>

        <View style={{ padding: space.lg, gap: 10 }}>
          <Txt variant="title">{l.title}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="hero" color={colors.primary}>{money(l.price)}</Txt>
            {l.seller.verified ? <Pill text="Verified seller" icon="shield-checkmark" color={colors.buy} bg={colors.buySoft} /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Ionicons name="location" size={20} color={colors.sub} />
            <Txt color={colors.sub}>{l.city}{l.distanceKm != null ? ` · ${l.distanceKm} km away` : ''} · {timeAgo(l.createdAt)}</Txt>
          </View>
          {l.seller.reviewCount ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Stars rating={l.seller.rating} /><Txt bold>{l.seller.rating}</Txt><Txt color={colors.sub}>({l.seller.reviewCount} reviews)</Txt></View> : null}

          <Txt variant="h2" style={{ marginTop: 12 }}>Description</Txt>
          <Txt>{l.description || 'The seller has not added a description.'}</Txt>

          <Card style={{ flexDirection: 'row', marginTop: 8 }}>
            <Spec icon="pricetag" label="Brand" value={l.brand || '—'} />
            <Spec icon="sparkles" label="Condition" value={l.condition} />
            <Spec icon="shield" label="Warranty" value={l.warranty || 'No'} />
          </Card>

          <Txt variant="h2" style={{ marginTop: 12 }}>Seller</Txt>
          <Card onPress={() => nav.navigate('UserProfile', { id: l.seller.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }} accessibilityLabel={`Seller ${l.seller.name}. View profile`}>
            <Avatar name={l.seller.name} uri={l.seller.avatar} size={60} />
            <View style={{ flex: 1 }}>
              <Txt bold>{l.seller.name}{l.isMine ? ' (you)' : ''}</Txt>
              <Txt variant="small" color={colors.sub}>{l.seller.online ? 'Active now' : l.seller.city}</Txt>
              {l.seller.isBrand ? <View style={{ marginTop: 4 }}><Pill text={`Brand · ${l.seller.brandName}`} icon="storefront" /></View> : null}
            </View>
            <Ionicons name="chevron-forward" size={26} color={colors.sub} />
          </Card>

          <View style={{ backgroundColor: colors.warnSoft, borderRadius: radius.md, padding: 14, marginTop: 12, flexDirection: 'row', gap: 10 }}>
            <Ionicons name="shield-checkmark" size={26} color={colors.warn} />
            <View style={{ flex: 1 }}>
              <Txt bold color={colors.warn}>Stay safe</Txt>
              <Txt variant="small" color={colors.text}>Meet in a public place. Check the item before you pay. Never send money in advance or share OTPs.</Txt>
            </View>
          </View>
          {!l.isMine ? <Button title="Report this item" icon="flag" variant="ghost" onPress={() => nav.navigate('Report', { targetType: 'listing', targetId: l.id })} /> : <Txt variant="small" color={colors.sub}>{l.views} views</Txt>}
        </View>
      </ScrollView>

      <Modal visible={buyOpen} transparent animationType="fade" onRequestClose={() => setBuyOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: space.lg }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 20, gap: 12, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
            {requested ? <>
              <View style={{ alignItems: 'center', gap: 10 }}>
                <Ionicons name="checkmark-circle" size={72} color={colors.buy} />
                <Txt variant="title" center>Request sent!</Txt>
                <Txt center color={colors.sub}>{l.seller.name} will confirm shortly. You can follow this in My Orders, and chat to arrange a safe meeting.</Txt>
              </View>
              <Button title="Chat with seller" icon="chatbubble-ellipses" onPress={() => { setBuyOpen(false); void chat(); }} />
              <Button title="View my orders" variant="secondary" onPress={() => { setBuyOpen(false); nav.navigate('Orders'); }} />
              <Button title="Close" variant="ghost" onPress={() => setBuyOpen(false)} />
            </> : <>
              <Txt variant="title">Buy this item?</Txt>
              <Txt>{l.title}</Txt>
              <Txt variant="h2" color={colors.primary}>{money(l.price)}</Txt>
              <View style={{ backgroundColor: colors.buySoft, borderRadius: 12, padding: 12 }}>
                <Txt variant="small">You will pay <Txt variant="small" bold>{l.seller.name}</Txt> in person when you collect the item. Nothing is charged now.</Txt>
              </View>
              <Input label="Message to seller (optional)" value={note} onChangeText={setNote} placeholder="e.g. I can come on Saturday morning" multiline style={{ minHeight: 80 }} />
              <Button title="Send buy request" variant="buy" icon="cart" onPress={buy} loading={busy} />
              <Button title="Cancel" variant="ghost" onPress={() => setBuyOpen(false)} />
            </>}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const IconBtn = ({ icon, label, onPress, color = colors.text }: { icon: any; label: string; onPress: () => void; color?: string }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={28} color={color} /></Pressable>
);
const Spec = ({ icon, label, value }: { icon: any; label: string; value: string }) => (
  <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
    <Ionicons name={icon} size={24} color={colors.primary} />
    <Txt variant="tiny" color={colors.sub}>{label}</Txt>
    <Txt variant="small" bold center>{value}</Txt>
  </View>
);

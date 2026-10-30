import React, { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { api, money, timeAgo } from '../api';
import { useLoad } from '../hooks';
import { Avatar, Button, Card, Empty, ErrorState, Header, Input, Loading, Pill, Screen, Stars, Txt, confirmDialog, notify, SkeletonCardGrid, SkeletonRows, toast } from '../ui';
import { colors, space } from '../theme';
import { Listing, Order } from '../types';
import { ListingGrid, ListingImage, toggleFavorite } from '../components/ListingCard';

export function Favorites() {
  const nav = useNavigation<any>();
  const res = useLoad(() => api<{ listings: Listing[] }>('/favorites'), []);
  const items = res.data?.listings || [];
  return (
    <Screen header={<Header title="Saved items" />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      {res.loading && !res.data ? <SkeletonCardGrid /> : res.error && !res.data ? <ErrorState message={res.error} retry={() => res.reload()} /> :
        !items.length ? <Empty icon="heart" title="Nothing saved yet" text="Tap the heart on any item to keep it here." action={{ title: 'Browse items', onPress: () => nav.navigate('Listings', {}) }} /> :
          <ListingGrid items={items} onOpen={(l) => nav.navigate('ItemDetails', { id: l.id })}
            onToggleFav={(l) => toggleFavorite(l, (n) => res.setData({ listings: n.isFavorite ? items.map((x) => (x.id === n.id ? n : x)) : items.filter((x) => x.id !== n.id) }))} />}
    </Screen>
  );
}

export function MyListings() {
  const nav = useNavigation<any>();
  const res = useLoad(() => api<{ listings: Listing[] }>('/me/listings'), []);
  const items = res.data?.listings || [];
  const setStatus = async (l: Listing, status: 'active' | 'sold') => { try { await api(`/listings/${l.id}/status`, { method: 'POST', body: { status } }); void res.reload(true); } catch (e: any) { notify('Error', e.message); } };
  const remove = async (l: Listing) => {
    if (!(await confirmDialog('Delete this item?', l.title, 'Delete', true))) return;
    try { await api(`/listings/${l.id}`, { method: 'DELETE' }); void res.reload(true); } catch (e: any) { notify('Could not delete', e.message); }
  };
  return (
    <Screen header={<Header title="My listings" />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }} footer={<Button title="Sell a new item" icon="add-circle" variant="sell" onPress={() => nav.navigate('SellItem')} />}>
      {res.loading && !res.data ? <SkeletonRows /> : res.error && !res.data ? <ErrorState message={res.error} retry={() => res.reload()} /> :
        !items.length ? <Empty icon="pricetag" title="You have not listed anything" text="Selling takes about a minute." /> :
          <View style={{ gap: 12 }}>
            {items.map((l) => (
              <Card key={l.id} style={{ padding: 0, overflow: 'hidden' }}>
                <Pressable accessibilityRole="button" onPress={() => nav.navigate('ItemDetails', { id: l.id })} style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ width: 110 }}><ListingImage listing={l} height={110} iconSize={36} /></View>
                  <View style={{ flex: 1, paddingVertical: 12, paddingRight: 12, gap: 2 }}>
                    <Txt bold numberOfLines={2}>{l.title}</Txt>
                    <Txt variant="h2" color={colors.primary}>{money(l.price)}</Txt>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Pill text={l.status === 'sold' ? 'Sold' : 'Live'} color={l.status === 'sold' ? colors.text : colors.buy} bg={l.status === 'sold' ? colors.line : colors.buySoft} />
                      <Txt variant="tiny" color={colors.sub}>{l.views} views</Txt>
                    </View>
                  </View>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 8, padding: 12, paddingTop: 0 }}>
                  <Button compact title="Edit" icon="create" variant="light" style={{ flex: 1 }} onPress={() => nav.navigate('SellItem', { id: l.id })} />
                  <Button compact title={l.status === 'sold' ? 'Relist' : 'Mark sold'} variant="light" style={{ flex: 1 }} onPress={() => setStatus(l, l.status === 'sold' ? 'active' : 'sold')} />
                  <Button compact title="" icon="trash" variant="light" style={{ width: 52, paddingHorizontal: 0 }} onPress={() => remove(l)} />
                </View>
              </Card>
            ))}
          </View>}
    </Screen>
  );
}

const STATUS: Record<Order['status'], { label: string; color: string; bg: string }> = {
  requested: { label: 'Waiting for seller', color: colors.warn, bg: colors.warnSoft },
  accepted: { label: 'Accepted · arrange handover', color: colors.primary, bg: colors.primarySoft },
  completed: { label: 'Completed', color: colors.buy, bg: colors.buySoft },
  declined: { label: 'Declined', color: colors.danger, bg: colors.dangerSoft },
  cancelled: { label: 'Cancelled', color: colors.sub, bg: colors.line },
};

export function Orders() {
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<'buying' | 'selling'>('buying');
  const res = useLoad(() => api<{ orders: Order[] }>(`/orders?role=${tab}`), [tab]);
  const [rate, setRate] = useState<Order | null>(null);
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const orders = res.data?.orders || [];

  const act = async (o: Order, action: string, ask?: [string, string]) => {
    if (ask && !(await confirmDialog(ask[0], ask[1], 'Yes'))) return;
    try { await api(`/orders/${o.id}/${action}`, { method: 'POST' }); void res.reload(true); } catch (e: any) { notify('Could not update order', e.message); }
  };
  const chat = async (o: Order) => {
    const other = o.role === 'buyer' ? o.seller : o.buyer;
    try { const r = await api<{ conversation: { id: number } }>('/conversations', { method: 'POST', body: { userId: other.id, listingId: o.listing.id } }); nav.navigate('Chat', { id: r.conversation.id }); } catch (e: any) { notify('Error', e.message); }
  };
  const submitReview = async () => {
    if (!rate) return;
    setBusy(true);
    try { await api(`/orders/${rate.id}/review`, { method: 'POST', body: { rating: stars, comment } }); setRate(null); setComment(''); setStars(5); void res.reload(true); toast('Thank you! Your review helps others.'); } catch (e: any) { notify('Could not save review', e.message); } finally { setBusy(false); }
  };

  return (
    <Screen header={<Header title="My orders" />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      <View style={{ flexDirection: 'row', backgroundColor: colors.primarySoft, borderRadius: 16, padding: 4, marginBottom: 14 }}>
        {(['buying', 'selling'] as const).map((t) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={{ flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === t ? '#fff' : 'transparent' }}>
            <Txt bold color={tab === t ? colors.primary : colors.sub}>{t === 'buying' ? 'I am buying' : 'I am selling'}</Txt>
          </Pressable>
        ))}
      </View>
      {res.loading && !res.data ? <SkeletonRows /> : res.error && !res.data ? <ErrorState message={res.error} retry={() => res.reload()} /> :
        !orders.length ? <Empty icon="receipt" title={tab === 'buying' ? 'No purchases yet' : 'No buyer requests yet'} text={tab === 'buying' ? 'Tap "Buy Now" on an item to send a request.' : 'When someone wants your item, it appears here.'} /> :
          <View style={{ gap: 12 }}>
            {orders.map((o) => {
              const s = STATUS[o.status]; const other = o.role === 'buyer' ? o.seller : o.buyer;
              return (
                <Card key={o.id} style={{ gap: 10 }}>
                  <Pressable accessibilityRole="button" onPress={() => nav.navigate('ItemDetails', { id: o.listing.id })} style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ width: 84, borderRadius: 14, overflow: 'hidden' }}><ListingImage listing={o.listing} height={84} iconSize={32} /></View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Txt bold numberOfLines={2}>{o.listing.title}</Txt>
                      <Txt variant="h2" color={colors.primary}>{money(o.price)}</Txt>
                      <Txt variant="tiny" color={colors.sub}>{timeAgo(o.createdAt)}</Txt>
                    </View>
                  </Pressable>
                  <Pill text={s.label} color={s.color} bg={s.bg} />
                  <Pressable accessibilityRole="button" onPress={() => nav.navigate('UserProfile', { id: other.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Avatar name={other.name} size={36} /><Txt variant="small">{o.role === 'buyer' ? 'Seller' : 'Buyer'}: <Txt variant="small" bold>{other.name}</Txt></Txt>
                  </Pressable>
                  {o.note ? <Txt variant="small" color={colors.sub}>“{o.note}”</Txt> : null}
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {o.status !== 'declined' && o.status !== 'cancelled' ? <Button compact title="Chat" icon="chatbubble" variant="light" style={{ flexGrow: 1 }} onPress={() => chat(o)} /> : null}
                    {o.role === 'seller' && o.status === 'requested' ? <>
                      <Button compact title="Accept" variant="buy" style={{ flexGrow: 1 }} onPress={() => act(o, 'accept')} />
                      <Button compact title="Decline" variant="secondary" style={{ flexGrow: 1 }} onPress={() => act(o, 'decline', ['Decline this request?', 'The buyer will be told.'])} />
                    </> : null}
                    {o.role === 'seller' && o.status === 'accepted' ? <Button compact title="Item handed over" icon="checkmark-circle" variant="buy" style={{ flexGrow: 1 }} onPress={() => act(o, 'complete', ['Mark as sold?', 'Do this once you have given the item and received payment.'])} /> : null}
                    {o.role === 'buyer' && ['requested', 'accepted'].includes(o.status) ? <Button compact title="Cancel" variant="secondary" style={{ flexGrow: 1 }} onPress={() => act(o, 'cancel', ['Cancel this request?', 'The seller will be told.'])} /> : null}
                    {o.status === 'completed' && !o.reviewed ? <Button compact title="Leave a review" icon="star" variant="sell" style={{ flexGrow: 1 }} onPress={() => setRate(o)} /> : null}
                  </View>
                </Card>
              );
            })}
          </View>}

      <Modal visible={!!rate} transparent animationType="fade" onRequestClose={() => setRate(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: space.lg }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 20, gap: 12, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
            <Txt variant="title">How was it?</Txt>
            <Txt color={colors.sub}>Rate your experience with {rate ? (rate.role === 'buyer' ? rate.seller.name : rate.buyer.name) : ''}</Txt>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
              {[1, 2, 3, 4, 5].map((i) => <Pressable key={i} accessibilityRole="button" accessibilityLabel={`${i} star${i > 1 ? 's' : ''}`} onPress={() => setStars(i)} style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={stars >= i ? 'star' : 'star-outline'} size={44} color={colors.star} /></Pressable>)}
            </View>
            <Input label="Comment (optional)" value={comment} onChangeText={setComment} multiline style={{ minHeight: 80 }} placeholder="Was it a smooth deal?" />
            <Button title="Submit review" onPress={submitReview} loading={busy} />
            <Button title="Not now" variant="ghost" onPress={() => setRate(null)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

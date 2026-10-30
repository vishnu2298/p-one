import React from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, timeAgo } from '../api';
import { useAuth } from '../context';
import { useLoad } from '../hooks';
import { Avatar, Button, Card, ErrorState, Header, Loading, Pill, Screen, SectionTitle, Stars, Txt, confirmDialog, notify, SkeletonRows, SkeletonCardGrid } from '../ui';
import { colors } from '../theme';
import { ConnectionState, Listing, UserFull } from '../types';
import { ListingGrid } from '../components/ListingCard';

type Resp = { user: UserFull; listings: Listing[]; reviews: { id: number; rating: number; comment: string; reviewer: string; createdAt: string }[]; distanceKm: number | null; connection: ConnectionState; blocked: boolean };

export function UserProfile() {
  const nav = useNavigation<any>();
  const { id } = useRoute<any>().params;
  const { user: me } = useAuth();
  const res = useLoad(() => api<Resp>(`/users/${id}`), [id]);
  if (res.loading && !res.data) return <Screen header={<Header title="Profile" />}><SkeletonRows count={1} /><View style={{ height: 16 }} /><SkeletonCardGrid count={2} /></Screen>;
  if (!res.data) return <Screen scroll={false} header={<Header title="Profile" />}><ErrorState message={res.error || 'Profile not found'} retry={() => res.reload()} /></Screen>;
  const { user: u, listings, reviews, connection, blocked, distanceKm } = res.data;
  const isMe = me?.id === u.id;

  const connect = async () => {
    try { const r = await api<{ connection: ConnectionState }>('/connections', { method: 'POST', body: { userId: u.id } }); res.setData({ ...res.data!, connection: r.connection }); } catch (e: any) { notify('Could not connect', e.message); }
  };
  const message = async () => {
    try { const r = await api<{ conversation: { id: number } }>('/conversations', { method: 'POST', body: { userId: u.id } }); nav.navigate('Chat', { id: r.conversation.id }); } catch (e: any) { notify('Cannot message', e.message); }
  };
  const disconnect = async () => {
    if (!(await confirmDialog('Remove connection?', `You will no longer be connected with ${u.name}.`, 'Remove', true))) return;
    await api(`/connections/user/${u.id}`, { method: 'DELETE' }); void res.reload(true);
  };
  const toggleBlock = async () => {
    const msg = blocked ? `${u.name} will be able to message you again.` : `${u.name} will not be able to message you or see your items.`;
    if (!(await confirmDialog(blocked ? 'Unblock?' : 'Block this person?', msg, blocked ? 'Unblock' : 'Block', !blocked))) return;
    await api(`/blocks/${u.id}`, { method: blocked ? 'DELETE' : 'POST' }); void res.reload(true);
  };

  return (
    <Screen header={<Header title={u.name} />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      <Card style={{ alignItems: 'center', gap: 8 }}>
        <Avatar name={u.name} uri={u.avatar} size={92} />
        <Txt variant="title" center>{u.name}</Txt>
        <Txt color={colors.sub}>{u.city}{distanceKm != null && !isMe ? ` · ${distanceKm} km away` : ''}</Txt>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {u.verified ? <Pill text="Verified" icon="shield-checkmark" color={colors.buy} bg={colors.buySoft} /> : null}
          {u.online ? <Pill text="Active now" icon="ellipse" color={colors.buy} bg={colors.buySoft} /> : null}
          <Pill text={`Member since ${new Date(u.memberSince.replace(' ', 'T') + 'Z').getFullYear()}`} />
        </View>
        {u.reviewCount ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Stars rating={u.rating} /><Txt bold>{u.rating}</Txt><Txt color={colors.sub}>({u.reviewCount})</Txt></View> : <Txt variant="small" color={colors.sub}>No reviews yet</Txt>}
        {u.bio ? <Txt center style={{ marginTop: 4 }}>{u.bio}</Txt> : null}
        {u.interests.length ? <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>{u.interests.map((i) => <Pill key={i} text={i} />)}</View> : null}
        {!isMe ? (
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 8 }}>
            {connection.status === 'connected' ? <Button title="Message" icon="chatbubble-ellipses" onPress={message} /> : <>
              <Button title={connection.status === 'sent' ? 'Request sent' : connection.status === 'received' ? 'Accept request' : 'Connect'} icon={connection.status === 'sent' ? 'time' : 'person-add'} disabled={connection.status === 'sent'} variant={connection.status === 'received' ? 'buy' : 'primary'} onPress={connect} />
              <Button title="Message" icon="chatbubble-ellipses" variant="secondary" onPress={message} />
            </>}
            {connection.status === 'connected' ? <Button title="Remove connection" variant="ghost" onPress={disconnect} /> : null}
          </View>
        ) : <Button title="Edit my profile" variant="secondary" style={{ alignSelf: 'stretch', marginTop: 8 }} onPress={() => nav.navigate('EditProfile')} />}
      </Card>

      <SectionTitle title={`Items for sale (${listings.length})`} />
      {listings.length ? <ListingGrid items={listings} onOpen={(l) => nav.navigate('ItemDetails', { id: l.id })} /> : <Txt color={colors.sub}>Nothing for sale right now.</Txt>}

      <SectionTitle title={`Reviews (${reviews.length})`} />
      {reviews.length ? <View style={{ gap: 10 }}>{reviews.map((r) => (
        <Card key={r.id} style={{ gap: 4 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Txt bold>{r.reviewer}</Txt><Stars rating={r.rating} size={16} /></View>{r.comment ? <Txt>{r.comment}</Txt> : null}<Txt variant="tiny" color={colors.sub}>{timeAgo(r.createdAt)}</Txt></Card>
      ))}</View> : <Txt color={colors.sub}>No reviews yet.</Txt>}

      {!isMe ? (
        <View style={{ marginTop: 24, gap: 4 }}>
          <Button title="Report this person" icon="flag" variant="ghost" onPress={() => nav.navigate('Report', { targetType: 'user', targetId: u.id })} />
          <Button title={blocked ? 'Unblock this person' : 'Block this person'} icon="ban" variant="ghost" onPress={toggleBlock} />
        </View>
      ) : null}
    </Screen>
  );
}

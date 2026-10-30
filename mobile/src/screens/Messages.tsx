import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, timeAgo } from '../api';
import { useLoad } from '../hooks';
import { Avatar, Button, Card, Empty, ErrorState, Header, Loading, Screen, Txt, notify, SkeletonRows, toast } from '../ui';
import { colors, space } from '../theme';
import { Conversation } from '../types';
import { useEffect } from 'react';

type Req = { id: number; createdAt: string; distanceKm: number | null; user: { id: number; name: string; city: string; avatar: string; interests: string[] } };

export function Messages() {
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<'chats' | 'requests'>('chats');
  const chats = useLoad(() => api<{ conversations: Conversation[] }>('/conversations'), []);
  const reqs = useLoad(() => api<{ requests: Req[] }>('/connections/requests'), []);

  // Light polling so new messages show up while this tab is open.
  useEffect(() => { const t = setInterval(() => { void chats.reload(true); void reqs.reload(true); }, 8000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const respond = async (r: Req, accept: boolean) => {
    try { await api(`/connections/${r.id}/respond`, { method: 'POST', body: { accept } }); void reqs.reload(true); if (accept) toast(`You and ${r.user.name.split(' ')[0]} are now connected`); } catch (e: any) { notify('Error', e.message); }
  };
  const nReq = reqs.data?.requests.length || 0;

  return (
    <Screen header={<Header title="Messages" back={false} />} refresh={{ refreshing: chats.refreshing, onRefresh: () => { chats.refresh(); void reqs.reload(true); } }}>
      <View style={{ flexDirection: 'row', backgroundColor: colors.primarySoft, borderRadius: 16, padding: 4, marginBottom: space.lg }}>
        {(['chats', 'requests'] as const).map((t) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={{ flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === t ? '#fff' : 'transparent' }}>
            <Txt bold color={tab === t ? colors.primary : colors.sub}>{t === 'chats' ? 'Chats' : `Requests${nReq ? ` (${nReq})` : ''}`}</Txt>
          </Pressable>
        ))}
      </View>

      {tab === 'chats' ? (
        chats.loading && !chats.data ? <SkeletonRows /> : chats.error && !chats.data ? <ErrorState message={chats.error} retry={() => chats.reload()} /> :
          !chats.data?.conversations.length ? <Empty icon="chatbubbles" title="No messages yet" text="When you chat with a buyer or seller, it shows up here." action={{ title: 'Browse items', onPress: () => nav.navigate('Listings', {}) }} /> :
            <View style={{ gap: 10 }}>
              {chats.data.conversations.map((c) => (
                <Card key={c.id} onPress={() => nav.navigate('Chat', { id: c.id })} accessibilityLabel={`Chat with ${c.other.name}${c.unread ? `, ${c.unread} new` : ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
                  <View><Avatar name={c.other.name} uri={c.other.avatar} size={56} />{c.other.online ? <View style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.buy, borderWidth: 2, borderColor: '#fff' }} /> : null}</View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Txt bold numberOfLines={1} style={{ flex: 1 }}>{c.other.name}</Txt>
                      <Txt variant="tiny" color={colors.sub}>{timeAgo(c.updatedAt)}</Txt>
                    </View>
                    <Txt variant="small" color={c.unread ? colors.text : colors.sub} bold={!!c.unread} numberOfLines={1}>
                      {c.lastMessage ? `${c.lastMessage.mine ? 'You: ' : ''}${c.lastMessage.type === 'location' ? 'Shared a location' : c.lastMessage.body}` : ''}
                    </Txt>
                    {c.listing ? <Txt variant="tiny" color={colors.primary} numberOfLines={1}>About: {c.listing.title}</Txt> : null}
                  </View>
                  {c.unread ? <View style={{ minWidth: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}><Txt variant="tiny" bold color="#fff" style={{ lineHeight: 18 }}>{c.unread}</Txt></View> : null}
                </Card>
              ))}
            </View>
      ) : (
        reqs.loading && !reqs.data ? <SkeletonRows count={2} /> : !nReq ? <Empty icon="person-add" title="No requests" text="When someone wants to connect with you, you will see it here." action={{ title: 'Find people nearby', onPress: () => nav.navigate('Connect') }} /> :
          <View style={{ gap: 12 }}>
            {reqs.data!.requests.map((r) => (
              <Card key={r.id} style={{ gap: 12 }}>
                <Pressable accessibilityRole="button" onPress={() => nav.navigate('UserProfile', { id: r.user.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar name={r.user.name} uri={r.user.avatar} size={56} />
                  <View style={{ flex: 1 }}>
                    <Txt bold>{r.user.name}</Txt>
                    <Txt variant="small" color={colors.sub}>Wants to connect · {r.user.city}{r.distanceKm != null ? ` · ${r.distanceKm} km` : ''}</Txt>
                  </View>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button title="Accept" variant="buy" style={{ flex: 1 }} compact onPress={() => respond(r, true)} />
                  <Button title="Not now" variant="secondary" style={{ flex: 1 }} compact onPress={() => respond(r, false)} />
                </View>
              </Card>
            ))}
          </View>
      )}
    </Screen>
  );
}

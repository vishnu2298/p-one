import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, timeAgo } from '../api';
import { useLoad } from '../hooks';
import { Button, Card, Empty, ErrorState, Header, IconName, Loading, Screen, Txt, SkeletonRows } from '../ui';
import { colors } from '../theme';
import { AppNotification } from '../types';
import { Ionicons } from '@expo/vector-icons';

const ICONS: Record<string, [IconName, string]> = {
  order_request: ['cart', colors.buy], order_update: ['receipt', colors.primary], review: ['star', colors.star],
  connection_request: ['person-add', colors.connect], connection_accepted: ['people', colors.buy], invite_joined: ['gift', colors.sell], message: ['chatbubble', colors.primary],
};

/** Where a notification should take you. Shared with push-notification taps. */
export function routeFor(data: Record<string, any>, type?: string): [string, any?] | null {
  const t = type || data.type;
  if (t === 'message' && data.conversationId) return ['Chat', { id: Number(data.conversationId) }];
  if (t === 'order_request') return ['Orders', {}];
  if (t === 'order_update') return ['Orders', {}];
  if (t === 'connection_request') return ['Main', { screen: 'Messages' }];
  if (t === 'connection_accepted' && data.userId) return ['UserProfile', { id: Number(data.userId) }];
  if (t === 'invite_joined') return ['Invite', {}];
  if (t === 'review' && data.userId) return ['UserProfile', { id: Number(data.userId) }];
  return null;
}

export function Notifications() {
  const nav = useNavigation<any>();
  const res = useLoad(() => api<{ notifications: AppNotification[] }>('/notifications'), []);
  const items = res.data?.notifications || [];
  const unread = items.filter((n) => !n.read).length;
  // Leaving the screen marks everything as read, so the red badge clears but you can still see what was new.
  useEffect(() => () => { void api('/notifications/read-all', { method: 'POST' }).catch(() => {}); }, []);

  return (
    <Screen header={<Header title="Notifications" />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      {res.loading && !res.data ? <SkeletonRows /> : res.error && !res.data ? <ErrorState message={res.error} retry={() => res.reload()} /> :
        !items.length ? <Empty icon="notifications" title="Nothing new" text="Buy requests, connection requests and invites show up here." /> : <>
          {unread ? <Button compact variant="light" title={`Mark ${unread} as read`} onPress={async () => { await api('/notifications/read-all', { method: 'POST' }); void res.reload(true); }} style={{ marginBottom: 12 }} /> : null}
          <View style={{ gap: 10 }}>
            {items.map((n) => {
              const [icon, color] = ICONS[n.type] || ['notifications', colors.primary];
              const target = routeFor(n.data, n.type);
              return (
                <Card key={n.id} onPress={target ? () => nav.navigate(target[0], target[1]) : undefined} accessibilityLabel={`${n.title}. ${n.body}`} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', borderLeftWidth: 6, borderLeftColor: n.read ? 'transparent' : colors.primary }}>
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={26} color={color} /></View>
                  <View style={{ flex: 1 }}>
                    <Txt bold>{n.title}</Txt>
                    {n.body ? <Txt variant="small" color={colors.sub}>{n.body}</Txt> : null}
                    <Txt variant="tiny" color={colors.sub}>{timeAgo(n.createdAt)}</Txt>
                  </View>
                </Card>
              );
            })}
          </View>
        </>}
    </Screen>
  );
}

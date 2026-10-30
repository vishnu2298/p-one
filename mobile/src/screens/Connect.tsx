import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api';
import { useDebounced, useLoad } from '../hooks';
import { Avatar, Button, Card, Chip, Empty, ErrorState, Header, Loading, Pill, Screen, Txt, notify, SkeletonRows, toast } from '../ui';
import { colors, radius } from '../theme';
import { Person } from '../types';
import { useSettings } from '../context';

/** Connect: people nearby (sorted by distance) and my connections. */
export function Connect() {
  const nav = useNavigation<any>();
  const { scale } = useSettings();
  const [tab, setTab] = useState<'nearby' | 'mine'>('nearby');
  const [q, setQ] = useState('');
  const [interest, setInterest] = useState<string | null>(null);
  const dq = useDebounced(q);
  const qs = new URLSearchParams(); if (dq.trim()) qs.set('q', dq.trim()); if (interest) qs.set('interest', interest);
  const people = useLoad(() => api<{ people: Person[] }>(`/people?${qs}`), [qs.toString()]);
  const interests = useLoad(() => api<{ interests: { name: string; count: number }[] }>('/interests'), []);
  const mine = useLoad(() => api<{ connections: { id: number; user: Person }[] }>('/connections'), []);

  const connect = async (p: Person) => {
    try {
      const r = await api<{ connection: { status: Person['connection']['status'] } }>('/connections', { method: 'POST', body: { userId: p.id } });
      people.setData({ people: people.data!.people.map((x) => (x.id === p.id ? { ...x, connection: r.connection } : x)) });
      if (r.connection.status === 'sent') toast(`Request sent to ${p.name.split(' ')[0]}`);
      void mine.reload(true);
    } catch (e: any) { notify('Could not connect', e.message); }
  };
  const message = async (userId: number) => {
    try { const r = await api<{ conversation: { id: number } }>('/conversations', { method: 'POST', body: { userId } }); nav.navigate('Chat', { id: r.conversation.id }); } catch (e: any) { notify('Error', e.message); }
  };

  const PersonRow = ({ p }: { p: Person }) => (
    <Card style={{ padding: 14, gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.city}. View profile`} onPress={() => nav.navigate('UserProfile', { id: p.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={p.name} uri={p.avatar} size={60} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Txt bold style={{ flexShrink: 1 }}>{p.name}</Txt>{p.verified ? <Ionicons name="shield-checkmark" size={18} color={colors.buy} /> : null}</View>
          <Txt variant="small" color={colors.sub}>{p.city}{p.distanceKm != null ? ` · ${p.distanceKm} km away` : ''}</Txt>
          {p.interests.length ? <Txt variant="tiny" color={colors.sub}>Interested in {p.interests.slice(0, 3).join(', ')}</Txt> : null}
        </View>
      </Pressable>
      {p.connection.status === 'connected' ? <Button compact title="Message" icon="chatbubble" variant="light" onPress={() => message(p.id)} />
        : p.connection.status === 'sent' ? <Pill text="Request sent · waiting for reply" icon="time" color={colors.warn} bg={colors.warnSoft} />
          : p.connection.status === 'received' ? <Button compact title="Accept request" variant="buy" onPress={() => connect(p)} />
            : <Button compact title="Connect" icon="person-add" onPress={() => connect(p)} />}
    </Card>
  );

  return (
    <Screen header={<Header title="Connect" subtitle="Meet people nearby" />} refresh={{ refreshing: people.refreshing, onRefresh: () => { people.refresh(); void mine.reload(true); } }}>
      <View style={{ flexDirection: 'row', backgroundColor: colors.primarySoft, borderRadius: 16, padding: 4, marginBottom: 14 }}>
        {([['nearby', 'People nearby'], ['mine', `My connections${mine.data?.connections.length ? ` (${mine.data.connections.length})` : ''}`]] as const).map(([t, label]) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={{ flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === t ? '#fff' : 'transparent' }}>
            <Txt bold color={tab === t ? colors.primary : colors.sub} center>{label}</Txt>
          </Pressable>
        ))}
      </View>

      {tab === 'nearby' ? <>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.pill, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 16, minHeight: 56, gap: 10 }}>
          <Ionicons name="search" size={24} color={colors.primary} />
          <TextInput accessibilityLabel="Search people, skills or interests" value={q} onChangeText={setQ} placeholder="Search people or interests…" placeholderTextColor="#7A8794" style={{ flex: 1, fontSize: 18 * scale, color: colors.text, minHeight: 52 }} />
        </View>
        {interests.data?.interests.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 14, flexGrow: 0 }}>
            <Chip label="Everyone" selected={!interest} onPress={() => setInterest(null)} />
            {interests.data.interests.slice(0, 12).map((i) => <Chip key={i.name} label={i.name} selected={interest === i.name} onPress={() => setInterest(interest === i.name ? null : i.name)} />)}
          </ScrollView>
        ) : <View style={{ height: 14 }} />}
        {people.loading && !people.data ? <SkeletonRows /> : people.error && !people.data ? <ErrorState message={people.error} retry={() => people.reload()} /> :
          !people.data?.people.length ? <Empty icon="people" title="No one found" text="Try a different search, or clear the interest filter." /> :
            <View style={{ gap: 10 }}>{people.data.people.map((p) => <PersonRow key={p.id} p={p} />)}</View>}
      </> : (
        mine.loading && !mine.data ? <SkeletonRows /> : !mine.data?.connections.length ? <Empty icon="person-add" title="No connections yet" text="Connect with people nearby to chat and build trust." action={{ title: 'Find people nearby', onPress: () => setTab('nearby') }} /> :
          <View style={{ gap: 10 }}>{mine.data.connections.map((c) => <PersonRow key={c.id} p={{ ...c.user, distanceKm: null, connection: { status: 'connected' } }} />)}</View>
      )}
    </Screen>
  );
}

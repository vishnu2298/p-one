import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, clock, imageUrl } from '../api';
import { useAuth, useSettings } from '../context';
import { useLoad, useDebounced } from '../hooks';
import { Avatar, Button, Card, Chip, Empty, ErrorState, FadeIn, Header, Input, Loading, Pill, Screen, SkeletonRows, Txt, confirmDialog, notify, toast } from '../ui';
import { colors, radius, space } from '../theme';
import { CityField } from '../components/CityPicker';
import { haptic } from '../motion';
import { translate } from '../i18n';
import { UserBrief } from '../types';

type Group = { id: number; name: string; description: string; city: string; interest: string; memberCount: number; isMember: boolean; isOwner: boolean };
type GMsg = { id: number; groupId: number; senderId: number; sender: UserBrief; body: string; type: 'text' | 'image'; createdAt: string };

/** Groups tab inside Connect: browse, search, join and create. */
export function GroupsTab() {
  const nav = useNavigation<any>();
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(false);
  const { scale } = useSettings();
  const dq = useDebounced(q);
  const qs = new URLSearchParams(); if (dq.trim()) qs.set('q', dq.trim()); if (mine) qs.set('mine', '1');
  const res = useLoad(() => api<{ groups: Group[] }>(`/groups?${qs}`), [qs.toString()]);

  const join = async (g: Group) => {
    try { haptic.success(); await api(`/groups/${g.id}/join`, { method: 'POST' }); toast(`You joined ${g.name}`); nav.navigate('Group', { id: g.id }); void res.reload(true); } catch (e: any) { notify('Could not join', e.message); }
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.pill, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 16, minHeight: 56, gap: 10 }}>
        <Ionicons name="search" size={24} color={colors.primary} />
        <TextInput accessibilityLabel="Search groups" value={q} onChangeText={setQ} placeholder={translate('Search groups…')} placeholderTextColor="#7A8794" style={{ flex: 1, fontSize: 18 * scale, color: colors.text, minHeight: 52 }} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 12 }}>
        <Chip label="All" selected={!mine} onPress={() => setMine(false)} />
        <Chip label="My groups" selected={mine} onPress={() => setMine(true)} />
      </View>
      <Button title="Start a group" icon="add-circle" variant="light" onPress={() => setCreating(true)} style={{ marginBottom: 12 }} />

      {res.loading && !res.data ? <SkeletonRows count={3} /> : res.error && !res.data ? <ErrorState message={res.error} retry={() => res.reload()} /> :
        !res.data?.groups.length ? <Empty icon="people-circle" title="No groups found" text="Start one and invite your friends." /> : (
          <View style={{ gap: 10 }}>
            {res.data.groups.map((g, i) => (
              <FadeIn key={g.id} index={i}>
                <Card style={{ gap: 10 }}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`${g.name}, ${g.memberCount} members`} onPress={() => (g.isMember ? nav.navigate('Group', { id: g.id }) : join(g))} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="people" size={30} color={colors.primary} /></View>
                    <View style={{ flex: 1 }}>
                      <Txt bold numberOfLines={2}>{g.name}</Txt>
                      <Txt variant="small" color={colors.sub}>{g.memberCount} members{g.city ? ` · ${g.city}` : ''}</Txt>
                    </View>
                  </Pressable>
                  {g.description ? <Txt variant="small" color={colors.sub} numberOfLines={2}>{g.description}</Txt> : null}
                  {g.isMember ? <Button compact title="Chat" icon="chatbubbles" variant="light" onPress={() => nav.navigate('Group', { id: g.id })} /> : <Button compact title="Join" icon="person-add" onPress={() => join(g)} />}
                </Card>
              </FadeIn>
            ))}
          </View>
        )}
      <CreateGroup visible={creating} onClose={() => setCreating(false)} onCreated={(g) => { setCreating(false); void res.reload(true); nav.navigate('Group', { id: g.id }); }} />
    </View>
  );
}

function CreateGroup({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (g: Group) => void }) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [f, setF] = useState({ name: '', description: '', interest: '', city: user?.city || '' });
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try { const r = await api<{ group: Group }>('/groups', { method: 'POST', body: f }); setF({ name: '', description: '', interest: '', city: user?.city || '' }); haptic.success(); onCreated(r.group); } catch (e: any) { notify('Could not create the group', e.message); } finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: space.lg }}>
            <Txt variant="h2" style={{ flex: 1 }}>Create a group</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={30} color={colors.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
            <Input label="Group name" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} placeholder="e.g. Madurai Foodies" maxLength={60} />
            <Input label="About this group" value={f.description} onChangeText={(v) => setF({ ...f, description: v })} multiline maxLength={300} style={{ minHeight: 90 }} />
            <Input label="Topic (optional)" value={f.interest} onChangeText={(v) => setF({ ...f, interest: v })} placeholder="e.g. Cooking" maxLength={40} />
            <CityField label="City" anywhere value={f.city || undefined} onChange={(c) => setF({ ...f, city: c || '' })} />
          </ScrollView>
          <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line }}>
            <Button title="Create a group" icon="checkmark-circle" onPress={create} loading={busy} disabled={f.name.trim().length < 3} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** One group: chat with members, member list, leave or delete. */
export function GroupScreen() {
  const nav = useNavigation<any>();
  const { id } = useRoute<any>().params as { id: number };
  const { user } = useAuth();
  const { scale } = useSettings();
  const insets = useSafeAreaInsets();
  const info = useLoad(() => api<{ group: Group; members: UserBrief[] }>(`/groups/${id}`), [id]);
  const [msgs, setMsgs] = useState<GMsg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const lastId = useRef(0);
  const scroller = useRef<any>(null);
  const member = info.data?.group.isMember;

  const poll = useCallback(async () => {
    if (!member) return;
    try {
      const r = await api<{ messages: GMsg[] }>(`/groups/${id}/messages?after=${lastId.current}`);
      if (r.messages.length) {
        lastId.current = r.messages[r.messages.length - 1].id;
        setMsgs((p) => { const seen = new Set(p.map((m) => m.id)); return [...p, ...r.messages.filter((m) => !seen.has(m.id))]; });
      }
    } catch { /* retried on the next tick */ }
  }, [id, member]);
  useEffect(() => { void poll(); const t = setInterval(poll, 3000); return () => clearInterval(t); }, [poll]);
  useEffect(() => { setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60); }, [msgs.length]);

  const send = async (body: string, type: 'text' | 'image' = 'text') => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const r = await api<{ message: GMsg }>(`/groups/${id}/messages`, { method: 'POST', body: { body, type } });
      lastId.current = Math.max(lastId.current, r.message.id);
      setMsgs((p) => (p.some((m) => m.id === r.message.id) ? p : [...p, r.message]));
      if (type === 'text') setText('');
      haptic.tap();
    } catch (e: any) { notify('Message not sent', e.message); } finally { setSending(false); }
  };
  const sendPhoto = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.5 });
      if (r.canceled || !r.assets[0]?.base64) return;
      const up = await api<{ url: string }>('/uploads', { method: 'POST', body: { data: r.assets[0].base64, mime: r.assets[0].mimeType || 'image/jpeg' } });
      await send(up.url, 'image');
    } catch (e: any) { notify('Photo not sent', e.message); }
  };
  const join = async () => { try { await api(`/groups/${id}/join`, { method: 'POST' }); haptic.success(); void info.reload(true); } catch (e: any) { notify('Could not join', e.message); } };
  const leave = async () => {
    if (!(await confirmDialog('Leave this group?', 'You can join again any time.', 'Leave'))) return;
    try { await api(`/groups/${id}/leave`, { method: 'POST' }); nav.goBack(); } catch (e: any) { notify('Could not leave', e.message); }
  };
  const remove = async () => {
    if (!(await confirmDialog('Delete this group?', 'All messages will be removed for everyone.', 'Delete', true))) return;
    try { await api(`/groups/${id}`, { method: 'DELETE' }); nav.goBack(); } catch (e: any) { notify('Could not delete', e.message); }
  };

  if (info.loading && !info.data) return <Screen header={<Header title="Group" />}><SkeletonRows count={3} /></Screen>;
  if (!info.data) return <Screen scroll={false} header={<Header title="Group" />}><ErrorState message={info.error || 'Group not found'} retry={() => info.reload()} /></Screen>;
  const g = info.data.group;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll={false}
        header={<Header title={g.name} subtitle={`${g.memberCount} members${g.city ? ` · ${g.city}` : ''}`}
          right={<Pressable accessibilityRole="button" accessibilityLabel="Members and options" onPress={() => setShowMembers(true)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="information-circle" size={30} color={colors.primary} /></Pressable>} />}>
        {!g.isMember ? (
          <View style={{ flex: 1, padding: space.lg, gap: 12, justifyContent: 'center' }}>
            <Empty icon="people-circle" title={g.name} text={g.description || 'Join to read and write messages'} />
            <Button title="Join" icon="person-add" onPress={join} />
          </View>
        ) : <>
          <ScrollView ref={scroller} contentContainerStyle={{ padding: space.lg, gap: 10 }} keyboardShouldPersistTaps="handled">
            {g.description ? <Card style={{ backgroundColor: colors.primarySoft }}><Txt variant="small" color={colors.primary}>{g.description}</Txt></Card> : null}
            {msgs.length === 0 ? <Txt color={colors.sub} center style={{ marginTop: 24 }}>Be the first to say hello 👋</Txt> : null}
            {msgs.map((m) => {
              const mine = m.senderId === user?.id;
              return (
                <View key={m.id} style={{ flexDirection: 'row', gap: 8, alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
                  {!mine ? <Pressable accessibilityRole="button" onPress={() => nav.navigate('UserProfile', { id: m.senderId })}><Avatar name={m.sender.name} uri={m.sender.avatar} size={36} /></Pressable> : null}
                  <View style={{ flexShrink: 1 }}>
                    {!mine ? <Txt variant="tiny" bold color={colors.sub} style={{ marginBottom: 2 }}>{m.sender.name}</Txt> : null}
                    <View style={{ backgroundColor: mine ? colors.primary : '#fff', borderRadius: 18, padding: 12, borderWidth: mine ? 0 : 1, borderColor: colors.line }}>
                      {m.type === 'image' ? <Image source={{ uri: imageUrl(m.body) }} accessibilityLabel="Photo" style={{ width: 200, height: 200, borderRadius: 12 }} /> : <Txt color={mine ? '#fff' : colors.text}>{m.body}</Txt>}
                    </View>
                    <Txt variant="tiny" color={colors.sub} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', marginTop: 2 }}>{clock(m.createdAt)}</Txt>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line, padding: 10, paddingBottom: insets.bottom + 8, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Send a photo" onPress={sendPhoto} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="image" size={26} color={colors.primary} /></Pressable>
            <TextInput accessibilityLabel="Type a message" value={text} onChangeText={setText} placeholder={translate('Type a message…')} placeholderTextColor="#7A8794" multiline maxLength={1000} style={{ flex: 1, minHeight: 52, maxHeight: 120, borderRadius: 26, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 18, paddingVertical: 12, fontSize: 18 * scale, color: colors.text }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Send message" onPress={() => send(text)} disabled={!text.trim() || sending} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || sending ? 0.4 : 1 }}><Ionicons name="send" size={24} color="#fff" /></Pressable>
          </View>
        </>}
      </Screen>

      <Modal visible={showMembers} transparent animationType="slide" onRequestClose={() => setShowMembers(false)}>
        <Pressable accessibilityLabel="Close" onPress={() => setShowMembers(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: space.lg, paddingBottom: insets.bottom + 16, maxHeight: '80%', width: '100%', maxWidth: 640, alignSelf: 'center' }}>
            <Txt variant="title" style={{ marginBottom: 8 }}>Members</Txt>
            <ScrollView>
              {info.data.members.map((m) => (
                <Pressable key={m.id} accessibilityRole="button" onPress={() => { setShowMembers(false); nav.navigate('UserProfile', { id: m.id }); }} style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar name={m.name} uri={m.avatar} size={44} /><Txt bold style={{ flex: 1 }}>{m.name}</Txt>{m.id === (g.isOwner ? user?.id : -1) ? <Pill text="Owner" /> : null}
                </Pressable>
              ))}
            </ScrollView>
            <View style={{ gap: 8, marginTop: 12 }}>
              {g.isMember && !g.isOwner ? <Button title="Leave group" icon="exit" variant="secondary" onPress={() => { setShowMembers(false); void leave(); }} /> : null}
              {g.isOwner ? <Button title="Delete this group" icon="trash" variant="danger" onPress={() => { setShowMembers(false); void remove(); }} /> : null}
              <Button title="Report" icon="flag" variant="ghost" onPress={() => { setShowMembers(false); nav.navigate('Report', { targetType: 'group', targetId: g.id }); }} />
              <Button title="Close" variant="light" onPress={() => setShowMembers(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}
void Loading;

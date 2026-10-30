import React, { useMemo, useState } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, Share, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Contacts from 'expo-contacts';
import * as SMS from 'expo-sms';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, timeAgo } from '../api';
import { useLoad } from '../hooks';
import { Avatar, Button, Card, Empty, ErrorState, Header, Loading, Screen, SectionTitle, Txt, notify, SkeletonRows, toast } from '../ui';
import { colors, radius, space } from '../theme';
import { InviteInfo } from '../types';
import { useSettings } from '../context';

type Contact = { id: string; name: string; phone: string };

/** Invite friends and family: share link/code, WhatsApp, SMS to chosen contacts. Contacts stay on the phone. */
export function Invite() {
  const res = useLoad(() => api<InviteInfo>('/invites'), []);
  const [picker, setPicker] = useState(false);
  const info = res.data;
  const record = (channel: string, count = 1) => { void api('/invites', { method: 'POST', body: { channel, count } }).then(() => res.reload(true)).catch(() => {}); };

  const share = async () => {
    if (!info) return;
    try { const r = await Share.share({ message: info.message }); if (r.action !== Share.dismissedAction) record('share'); } catch { /* cancelled */ }
  };
  const whatsapp = async () => { if (!info) return; await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(info.message)}`).catch(() => notify('Could not open WhatsApp')); record('whatsapp'); };
  const copy = async () => { if (!info) return; await Clipboard.setStringAsync(info.message); record('copy'); toast('Invite message copied. Paste it anywhere.'); };

  return (
    <Screen header={<Header title="Invite friends and family" />} refresh={{ refreshing: res.refreshing, onRefresh: res.refresh }}>
      {res.loading && !info ? <SkeletonRows count={3} avatar={false} /> : res.error && !info ? <ErrorState message={res.error} retry={() => res.reload()} /> : info ? <>
        <Card style={{ alignItems: 'center', gap: 8, backgroundColor: colors.primarySoft }}>
          <Ionicons name="gift" size={52} color={colors.primary} />
          <Txt variant="title" center>Bring your people</Txt>
          <Txt center color={colors.sub}>Invite family and friends. When they join with your code, you are connected right away.</Txt>
          <View style={{ backgroundColor: '#fff', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24, marginTop: 6 }}>
            <Txt variant="tiny" color={colors.sub} center>Your invite code</Txt>
            <Txt selectable style={{ fontSize: 32, letterSpacing: 4, fontWeight: '800', color: colors.primary }}>{info.code}</Txt>
          </View>
        </Card>

        <View style={{ gap: 10, marginTop: space.lg }}>
          <Button title="Share invite" icon="share-social" onPress={share} />
          <Button title="Send on WhatsApp" icon="logo-whatsapp" variant="buy" onPress={whatsapp} />
          {Platform.OS !== 'web' ? <Button title="Pick contacts and send SMS" icon="people" variant="secondary" onPress={() => setPicker(true)} /> : null}
          <Button title="Copy invite message" icon="copy" variant="light" onPress={copy} />
        </View>

        <SectionTitle title="Your invites" />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Card style={{ flex: 1, alignItems: 'center' }}><Txt variant="title">{info.sent}</Txt><Txt variant="small" color={colors.sub}>Sent</Txt></Card>
          <Card style={{ flex: 1, alignItems: 'center' }}><Txt variant="title" color={colors.buy}>{info.joined.length}</Txt><Txt variant="small" color={colors.sub}>Joined</Txt></Card>
        </View>
        {info.joined.length ? <View style={{ gap: 10, marginTop: 12 }}>
          {info.joined.map((j) => (
            <Card key={j.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={j.name} /><View style={{ flex: 1 }}><Txt bold>{j.name}</Txt><Txt variant="small" color={colors.sub}>Joined {timeAgo(j.joinedAt)}</Txt></View>
              <Ionicons name="checkmark-circle" size={28} color={colors.buy} />
            </Card>
          ))}
        </View> : <Empty icon="people" title="No one has joined yet" text="Share your invite and they will show up here." />}
        <Txt variant="tiny" color={colors.sub} center style={{ marginTop: 16 }}>We never upload or store your contacts. Names and numbers stay on your phone.</Txt>
      </> : null}
      {info ? <ContactPicker visible={picker} onClose={() => setPicker(false)} message={info.message} onSent={(n) => { record('sms', n); }} /> : null}
    </Screen>
  );
}

function ContactPicker({ visible, onClose, message, onSent }: { visible: boolean; onClose: () => void; message: string; onSent: (n: number) => void }) {
  const insets = useSafeAreaInsets();
  const { scale } = useSettings();
  const [list, setList] = useState<Contact[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const perm = await Contacts.requestPermissionsAsync();
    if (!perm.granted) { setError('Please allow contacts access in your phone settings to pick people.'); setList([]); return; }
    const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name], sort: Contacts.SortTypes.FirstName });
    const seen = new Set<string>();
    const out: Contact[] = [];
    for (const c of data) {
      const phone = c.phoneNumbers?.[0]?.number?.replace(/[^\d+]/g, '');
      if (!c.name || !phone || phone.length < 7 || seen.has(phone)) continue;
      seen.add(phone); out.push({ id: c.id || phone, name: c.name, phone });
    }
    setList(out);
  };
  const shown = useMemo(() => (list || []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 200), [list, q]);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else if (n.size < 30) n.add(id); return n; });

  const send = async () => {
    if (!(await SMS.isAvailableAsync())) { notify('SMS is not available on this device'); return; }
    const numbers = (list || []).filter((c) => picked.has(c.id)).map((c) => c.phone);
    const r = await SMS.sendSMSAsync(numbers, message);
    if (r.result !== 'cancelled') onSent(numbers.length);
    setPicked(new Set()); onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => { if (!list) void load(); }}>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: 8 }}>
          <Txt variant="h2" style={{ flex: 1 }}>Choose contacts</Txt>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="close" size={30} color={colors.text} /></Pressable>
        </View>
        <View style={{ paddingHorizontal: space.lg }}>
          <TextInput accessibilityLabel="Search contacts" value={q} onChangeText={setQ} placeholder="Search by name…" placeholderTextColor="#7A8794" style={{ minHeight: 56, borderWidth: 2, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 18, fontSize: 18 * scale, backgroundColor: '#fff', color: colors.text }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: 8 }}>
          {list === null ? <Loading /> : error ? <Txt color={colors.danger}>{error}</Txt> : !shown.length ? <Txt color={colors.sub}>No contacts found.</Txt> : shown.map((c) => {
            const on = picked.has(c.id);
            return (
              <Pressable key={c.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(c.id)} style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: radius.md, paddingHorizontal: 14, borderWidth: 2, borderColor: on ? colors.primary : 'transparent' }}>
                <Avatar name={c.name} size={44} /><View style={{ flex: 1 }}><Txt bold numberOfLines={1}>{c.name}</Txt><Txt variant="small" color={colors.sub}>{c.phone}</Txt></View>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={30} color={on ? colors.primary : colors.sub} />
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ padding: space.lg, paddingBottom: insets.bottom + space.md, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line }}>
          <Button title={picked.size ? `Send to ${picked.size} ${picked.size === 1 ? 'person' : 'people'}` : 'Select people to invite'} icon="send" disabled={!picked.size} onPress={send} />
        </View>
      </View>
    </Modal>
  );
}

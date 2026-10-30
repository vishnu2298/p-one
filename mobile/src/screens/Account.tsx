import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../api';
import { useAuth, useSettings } from '../context';
import { Avatar, Button, Card, Chip, Header, Input, Row, Screen, Txt, confirmDialog, notify, toast } from '../ui';
import { colors, TextSize } from '../theme';
import { CITIES } from '../categories';
import { Me } from '../types';

const SUGGESTED = ['Tech', 'Gadgets', 'Bikes', 'Home decor', 'Fashion', 'Books', 'Fitness', 'Travel', 'Cooking', 'Business', 'Music', 'Gardening'];

export function EditProfile() {
  const nav = useNavigation<any>();
  const { user, setUser } = useAuth();
  const [f, setF] = useState({ name: user?.name || '', phone: user?.phone || '', city: user?.city || 'Chennai', bio: user?.bio || '', avatar: user?.avatar || '' });
  const [interests, setInterests] = useState<string[]>(user?.interests || []);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const pickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], base64: true, quality: 0.4 });
    if (r.canceled || !r.assets[0]?.base64) return;
    setPhotoBusy(true);
    try { const up = await api<{ url: string }>('/uploads', { method: 'POST', body: { data: r.assets[0].base64, mime: r.assets[0].mimeType || 'image/jpeg' } }); set('avatar')(up.url); } catch (e: any) { notify('Photo not saved', e.message); } finally { setPhotoBusy(false); }
  };
  const save = async () => {
    if (f.name.trim().length < 2) { notify('Name needed', 'Please enter your name.'); return; }
    setBusy(true);
    try { const r = await api<{ user: Me }>('/me', { method: 'PATCH', body: { ...f, name: f.name.trim(), interests } }); setUser(r.user); nav.goBack(); } catch (e: any) { notify('Could not save', e.message); } finally { setBusy(false); }
  };
  const toggle = (i: string) => setInterests((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i].slice(0, 8)));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<Header title="Edit profile" />} footer={<Button title="Save" icon="checkmark" onPress={save} loading={busy} />}>
        <View style={{ alignItems: 'center', marginBottom: 20, gap: 8 }}>
          <Avatar name={f.name || '?'} uri={f.avatar} size={104} />
          <Button compact title={photoBusy ? 'Uploading…' : 'Change photo'} icon="camera" variant="light" onPress={pickPhoto} disabled={photoBusy} />
        </View>
        <Input label="Full name" value={f.name} onChangeText={set('name')} />
        <Input label="Phone (optional)" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" hint="Never shown to other people" />
        <Input label="About me" value={f.bio} onChangeText={set('bio')} multiline maxLength={300} placeholder="A few words about you" style={{ minHeight: 90 }} />
        <Txt bold style={{ marginBottom: 8 }}>My city</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{CITIES.map((c) => <Chip key={c} label={c} selected={f.city === c} onPress={() => set('city')(c)} />)}</View>
        <Txt bold style={{ marginVertical: 8 }}>My interests</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{SUGGESTED.map((i) => <Chip key={i} label={i} selected={interests.includes(i)} onPress={() => toggle(i)} />)}</View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const SIZES: { id: TextSize; label: string }[] = [{ id: 'normal', label: 'Normal' }, { id: 'large', label: 'Large' }, { id: 'xlarge', label: 'Extra large' }];

export function Settings() {
  const nav = useNavigation<any>();
  const { textSize, setTextSize } = useSettings();
  const { signOut, user, setUser } = useAuth();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [showPw, setShowPw] = useState(false);
  const [del, setDel] = useState('');
  const [showDel, setShowDel] = useState(false);

  const changePw = async () => {
    try { await api('/me/password', { method: 'POST', body: pw }); setPw({ currentPassword: '', newPassword: '' }); setShowPw(false); toast('Password changed'); } catch (e: any) { notify('Could not change password', e.message); }
  };
  const deleteAccount = async () => {
    if (!(await confirmDialog('Delete your account?', 'All your listings, chats and connections will be permanently removed.', 'Delete forever', true))) return;
    try { await api('/me', { method: 'DELETE', body: { password: del, confirm: del } }); await signOut(); } catch (e: any) { notify('Could not delete account', e.message); }
  };

  return (
    <Screen header={<Header title="Settings" />}>
      <Card style={{ gap: 12 }}>
        <Txt variant="h2">Text size</Txt>
        <Txt color={colors.sub}>Make everything easier to read.</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {SIZES.map((s) => (
            <Pressable key={s.id} accessibilityRole="radio" accessibilityState={{ selected: textSize === s.id }} onPress={() => setTextSize(s.id)}
              style={{ flex: 1, minHeight: 64, borderRadius: 14, borderWidth: 2, borderColor: textSize === s.id ? colors.primary : colors.line, backgroundColor: textSize === s.id ? colors.primarySoft : '#fff', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              <Text2 size={s.id}>Aa</Text2><Txt variant="tiny" bold color={textSize === s.id ? colors.primary : colors.text}>{s.label}</Txt>
            </Pressable>
          ))}
        </View>
        <View style={{ backgroundColor: colors.bg, borderRadius: 12, padding: 12 }}><Txt>This is how your text will look. Easy to read, easy to use.</Txt></View>
      </Card>

      <Card style={{ marginTop: 16, gap: 8 }}>
        <Row icon="notifications" label="Notifications" value={user?.pushEnabled ? 'On: messages, requests and updates' : 'Off: you will still see them in the app'} onPress={async () => { try { setUser((await api<{ user: Me }>('/me', { method: 'PATCH', body: { pushEnabled: !user?.pushEnabled } })).user); toast(user?.pushEnabled ? 'Notifications turned off' : 'Notifications turned on'); } catch (e: any) { notify('Could not change', e.message); } }} />
      </Card>

      <Card style={{ marginTop: 16, paddingVertical: 6 }}>
        <Row icon="person" label="Edit profile" onPress={() => nav.navigate('EditProfile')} />
        <Row icon="gift" label="Invite friends and family" onPress={() => nav.navigate('Invite')} />
        {user?.hasPassword ? <Row icon="key" label="Change password" onPress={() => setShowPw(!showPw)} /> : null}
        {showPw ? <View style={{ paddingBottom: 12 }}>
          <Input label="Current password" value={pw.currentPassword} onChangeText={(v) => setPw({ ...pw, currentPassword: v })} secureTextEntry />
          <Input label="New password" value={pw.newPassword} onChangeText={(v) => setPw({ ...pw, newPassword: v })} secureTextEntry hint="At least 6 characters" />
          <Button title="Save new password" onPress={changePw} />
        </View> : null}
        <Row icon="shield-checkmark" label="Trust and safety" onPress={() => nav.navigate('Safety')} />
        <Row icon="log-out" label="Log out" onPress={async () => { if (await confirmDialog('Log out?', 'You can log back in any time.', 'Log out')) await signOut(); }} />
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Row icon="trash" label="Delete my account" danger onPress={() => setShowDel(!showDel)} />
        {showDel ? <View>
          <Input label={user?.hasPassword ? 'Enter your password to confirm' : 'Type DELETE to confirm'} value={del} onChangeText={setDel} secureTextEntry={!!user?.hasPassword} autoCapitalize="characters" />
          <Button title="Delete account permanently" variant="danger" onPress={deleteAccount} disabled={!del} />
        </View> : null}
      </Card>
      <Txt variant="small" color={colors.sub} center style={{ marginTop: 20 }}>Connectly 1.0 · Buy • Sell • Connect</Txt>
    </Screen>
  );
}
const Text2 = ({ size, children }: { size: TextSize; children: string }) => <Txt bold style={{ fontSize: size === 'normal' ? 20 : size === 'large' ? 25 : 31, lineHeight: 36 }}>{children}</Txt>;

const POINTS = [
  { icon: 'shield-checkmark', color: colors.primary, title: 'Verified profiles', text: 'Real people, real details. Look for the green shield.' },
  { icon: 'cash', color: colors.buy, title: 'Safe payments', text: 'Pay only when you hold the item. Never pay in advance.' },
  { icon: 'star', color: colors.sell, title: 'Ratings and reviews', text: 'Check a seller\'s reviews before you meet.' },
  { icon: 'flag', color: colors.danger, title: 'Report and support', text: 'See something wrong? Report it and we will review it.' },
] as const;
const TIPS = [
  'Meet in a busy public place, in daylight, and bring a friend if you can.',
  'Check the item carefully before you pay.',
  'Never share OTPs, PINs, passwords or card numbers with anyone.',
  'Be careful if someone asks for money first or to chat outside the app.',
  'If a deal feels too good to be true, it usually is.',
];
export function Safety() {
  return (
    <Screen header={<Header title="Trust and safety" />}>
      <View style={{ alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.buySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="shield-checkmark" size={56} color={colors.buy} /></View>
        <Txt variant="title" center>Trusted. Safe. Simple.</Txt>
      </View>
      <View style={{ gap: 12 }}>
        {POINTS.map((p) => (
          <Card key={p.title} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <Ionicons name={p.icon} size={36} color={p.color} />
            <View style={{ flex: 1 }}><Txt bold>{p.title}</Txt><Txt variant="small" color={colors.sub}>{p.text}</Txt></View>
          </Card>
        ))}
      </View>
      <Txt variant="h2" style={{ marginTop: 24, marginBottom: 8 }}>Safety tips</Txt>
      <Card style={{ gap: 10 }}>
        {TIPS.map((t) => <View key={t} style={{ flexDirection: 'row', gap: 10 }}><Ionicons name="checkmark-circle" size={24} color={colors.buy} /><Txt style={{ flex: 1 }}>{t}</Txt></View>)}
      </Card>
      <Txt color={colors.sub} center style={{ marginTop: 20 }}>A safer community for everyone.</Txt>
    </Screen>
  );
}

const REASONS = ['Looks like a scam', 'Asking for money in advance', 'Fake or misleading item', 'Rude or abusive', 'Spam', 'Something else'];
export function Report() {
  const nav = useNavigation<any>();
  const { targetType, targetId } = useRoute<any>().params;
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason) { notify('Please choose a reason'); return; }
    setBusy(true);
    try { await api('/reports', { method: 'POST', body: { targetType, targetId, reason, details } }); nav.goBack(); toast('Report sent. Thank you for keeping Connectly safe.'); } catch (e: any) { notify('Could not send report', e.message); } finally { setBusy(false); }
  };
  return (
    <Screen header={<Header title="Report" />} footer={<Button title="Send report" icon="flag" variant="danger" onPress={submit} loading={busy} />}>
      <Txt variant="h2" style={{ marginBottom: 12 }}>What is wrong?</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 }}>{REASONS.map((r) => <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />)}</View>
      <Input label="More details (optional)" value={details} onChangeText={setDetails} multiline maxLength={500} placeholder="Tell us what happened" />
      <Txt variant="small" color={colors.sub}>Reports are private. The other person will not know who reported them.</Txt>
    </Screen>
  );
}

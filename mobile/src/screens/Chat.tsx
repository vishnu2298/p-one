import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, clock, money } from '../api';
import { Avatar, Header, Loading, Screen, Txt, notify, ErrorState } from '../ui';
import { colors, radius, space } from '../theme';
import { useAuth, useSettings } from '../context';
import { ChatMessage, UserBrief } from '../types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const QUICK = ['Is this still available?', 'What is your best price?', 'Where can we meet?', 'Thank you!'];

type LocBody = { label: string; lat?: number; lng?: number };
const parseLoc = (b: string): LocBody => { try { return JSON.parse(b); } catch { return { label: b }; } };

export function Chat() {
  const nav = useNavigation<any>();
  const { id } = useRoute<any>().params as { id: number };
  const { user } = useAuth();
  const { scale } = useSettings();
  const insets = useSafeAreaInsets();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [other, setOther] = useState<UserBrief | null>(null);
  const [listing, setListing] = useState<{ id: number; title: string; price: number } | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const lastId = useRef(0);
  const scroller = useRef<any>(null);

  const poll = useCallback(async () => {
    try {
      const r = await api<{ messages: ChatMessage[]; other: UserBrief; listing: any }>(`/conversations/${id}/messages?after=${lastId.current}`);
      setOther(r.other); setListing(r.listing); setError(null);
      if (r.messages.length) {
        lastId.current = r.messages[r.messages.length - 1].id;
        setMsgs((p) => { const seen = new Set(p.map((m) => m.id)); return [...p, ...r.messages.filter((m) => !seen.has(m.id))]; });
      }
    } catch (e: any) { if (!loaded) setError(e.message); } finally { setLoaded(true); }
  }, [id, loaded]);

  useEffect(() => { void poll(); const t = setInterval(poll, 3000); return () => clearInterval(t); }, [poll]);
  useEffect(() => { setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50); }, [msgs.length]);

  const send = async (body: string, type: 'text' | 'location' = 'text', fromComposer = false) => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const r = await api<{ message: ChatMessage; safetyTip: string | null }>(`/conversations/${id}/messages`, { method: 'POST', body: { body, type } });
      lastId.current = Math.max(lastId.current, r.message.id);
      setMsgs((p) => (p.some((m) => m.id === r.message.id) ? p : [...p, r.message]));
      if (fromComposer) setText('');
      if (r.safetyTip) setTip(r.safetyTip);
    } catch (e: any) { notify('Message not sent', e.message); } finally { setSending(false); }
  };

  const shareLocation = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { notify('Location not allowed', 'Please allow location access to share where you are.'); return; }
      const pos = await Location.getCurrentPositionAsync({});
      let label = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      try {
        const [p] = await Location.reverseGeocodeAsync(pos.coords);
        if (p) label = [p.name || p.street, p.city || p.district, p.region].filter(Boolean).join(', ') || label;
      } catch { /* label stays as coordinates */ }
      await send(JSON.stringify({ label, lat: pos.coords.latitude, lng: pos.coords.longitude }), 'location');
    } catch { notify('Could not get your location', 'Please try again, or type where you are.'); }
  };

  if (error && !other) return <Screen scroll={false} header={<Header title="Chat" />}><ErrorState message={error} retry={() => { setError(null); void poll(); }} /></Screen>;
  if (!loaded) return <Screen scroll={false} header={<Header title="Chat" />}><Loading /></Screen>;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll={false}
        header={<Header title={other?.name || 'Chat'} subtitle={other?.online ? 'Active now' : other?.city}
          right={other ? <Pressable accessibilityRole="button" accessibilityLabel={`View ${other.name}'s profile`} onPress={() => nav.navigate('UserProfile', { id: other.id })} style={{ padding: 4 }}><Avatar name={other.name} uri={other.avatar} size={44} /></Pressable> : null} />}>
        {listing ? (
          <Pressable accessibilityRole="button" onPress={() => nav.navigate('ItemDetails', { id: listing.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primarySoft, padding: 12 }}>
            <Ionicons name="pricetag" size={22} color={colors.primary} />
            <Txt variant="small" bold style={{ flex: 1 }} numberOfLines={1}>{listing.title}</Txt>
            <Txt variant="small" bold color={colors.primary}>{money(listing.price)}</Txt>
          </Pressable>
        ) : null}
        {tip ? (
          <View style={{ flexDirection: 'row', gap: 8, backgroundColor: colors.warnSoft, padding: 12, alignItems: 'center' }}>
            <Ionicons name="warning" size={22} color={colors.warn} /><Txt variant="small" color={colors.warn} style={{ flex: 1 }}>{tip}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setTip(null)} hitSlop={10}><Ionicons name="close" size={24} color={colors.warn} /></Pressable>
          </View>
        ) : null}
        <ScrollView ref={scroller} contentContainerStyle={{ padding: space.lg, gap: 10 }} keyboardShouldPersistTaps="handled">
          {msgs.length === 0 ? <Txt color={colors.sub} center style={{ marginTop: 24 }}>Say hello to {other?.name.split(' ')[0]}. Tap a quick message below to start.</Txt> : null}
          {msgs.map((m) => {
            const mine = m.senderId === user?.id;
            const loc = m.type === 'location' ? parseLoc(m.body) : null;
            return (
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                <View style={{ backgroundColor: mine ? colors.primary : '#fff', borderRadius: 20, borderBottomRightRadius: mine ? 4 : 20, borderBottomLeftRadius: mine ? 20 : 4, padding: 14, borderWidth: mine ? 0 : 1, borderColor: colors.line }}>
                  {loc ? (
                    <Pressable accessibilityRole="link" accessibilityLabel={`Location: ${loc.label}. Open map`} disabled={loc.lat == null} onPress={() => Linking.openURL(`https://www.google.com/maps?q=${loc.lat},${loc.lng}`)} style={{ gap: 6 }}>
                      <View style={{ height: 70, borderRadius: 12, backgroundColor: mine ? 'rgba(255,255,255,0.2)' : colors.primarySoft, alignItems: 'center', justifyContent: 'center', minWidth: 200 }}><Ionicons name="location" size={34} color={mine ? '#fff' : colors.primary} /></View>
                      <Txt color={mine ? '#fff' : colors.text}>{loc.label}</Txt>
                      {loc.lat != null ? <Txt variant="tiny" bold color={mine ? '#fff' : colors.primary}>Tap to open map</Txt> : null}
                    </Pressable>
                  ) : <Txt color={mine ? '#fff' : colors.text}>{m.body}</Txt>}
                </View>
                <Txt variant="tiny" color={colors.sub} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', marginTop: 2 }}>{clock(m.createdAt)}{mine && m.readAt ? ' · Seen' : ''}</Txt>
              </View>
            );
          })}
        </ScrollView>
        <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line, paddingBottom: insets.bottom + 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 10, gap: 8 }} keyboardShouldPersistTaps="handled">
            {QUICK.map((q) => (
              <Pressable key={q} accessibilityRole="button" onPress={() => send(q)} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.primarySoft, justifyContent: 'center' }}><Txt variant="small" bold color={colors.primary}>{q}</Txt></Pressable>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Share my location" onPress={shareLocation} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.buySoft, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="location" size={26} color={colors.buy} /></Pressable>
            <TextInput accessibilityLabel="Type a message" value={text} onChangeText={setText} placeholder="Type a message…" placeholderTextColor="#7A8794" multiline maxLength={1000}
              style={{ flex: 1, minHeight: 52, maxHeight: 120, borderRadius: 26, borderWidth: 2, borderColor: colors.line, paddingHorizontal: 18, paddingVertical: 12, fontSize: 18 * scale, color: colors.text }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Send message" onPress={() => send(text, 'text', true)} disabled={!text.trim() || sending} style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || sending ? 0.4 : 1 }}><Ionicons name="send" size={24} color="#fff" /></Pressable>
          </View>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

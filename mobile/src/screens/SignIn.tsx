import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api';
import { useAuth, useSettings } from '../context';
import { Button, Chip, Header, Input, Screen, Txt, notify } from '../ui';
import { colors, radius, space } from '../theme';
import { CITIES } from '../categories';
import { Me } from '../types';
import { firebaseConfigured, friendlyAuthError, googleSignIn, startPhone, PhoneSession } from '../firebaseAuth';

/** 'firebase' = real Firebase; 'dev' = server demo mode (phone code is always 123456); 'none' = not available. */
export function useAuthMode() {
  const [mode, setMode] = useState<'loading' | 'firebase' | 'dev' | 'none'>('loading');
  useEffect(() => {
    if (firebaseConfigured) { setMode('firebase'); return; }
    api<{ devMode: boolean }>('/auth/config').then((c) => setMode(c.devMode ? 'dev' : 'none')).catch(() => setMode('none'));
  }, []);
  return mode;
}

export function DemoBanner({ text }: { text: string }) {
  return <View style={{ backgroundColor: colors.warnSoft, padding: 12, borderRadius: 12, marginBottom: 16 }}><Txt variant="small" color={colors.warn}>{text}</Txt></View>;
}

/** Phone number + one-time code. */
export function PhoneSignIn() {
  const { signInWithFirebase, referralCode } = useAuth();
  const { scale } = useSettings();
  const mode = useAuthMode();
  const [prefix, setPrefix] = useState('+91');
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [invite, setInvite] = useState(referralCode);
  const [step, setStep] = useState<'number' | 'code'>('number');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const session = useRef<PhoneSession | null>(null);

  useEffect(() => { setInvite(referralCode); }, [referralCode]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const full = `${prefix.startsWith('+') ? prefix : '+' + prefix}${number.replace(/\D/g, '')}`;

  const send = async () => {
    if (number.replace(/\D/g, '').length < 6) { setError('Please enter your phone number'); return; }
    setBusy(true); setError(null);
    try {
      session.current = mode === 'dev'
        ? { confirm: async (c) => `dev:phone:${full}:${c}` }
        : await startPhone(full);
      setStep('code'); setCode(''); setWait(30);
    } catch (e: any) { setError(friendlyAuthError(e)); } finally { setBusy(false); }
  };
  const verify = async () => {
    if (code.length < 6) { setError('Please enter the 6-digit code'); return; }
    setBusy(true); setError(null);
    try {
      const idToken = await session.current!.confirm(code);
      await signInWithFirebase(idToken, { referralCode: invite.trim() || undefined });
    } catch (e: any) { setError(friendlyAuthError(e)); setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<Header title="Phone number" />}>
        {mode === 'none' ? <Txt color={colors.danger}>Phone sign-in is not available right now. Please use email instead.</Txt> : <>
          {mode === 'dev' ? <DemoBanner text="Demo mode: no real SMS is sent. Use the code 123456." /> : null}
          {step === 'number' ? <>
            <Txt variant="h2" style={{ marginBottom: 6 }}>What is your phone number?</Txt>
            <Txt color={colors.sub} style={{ marginBottom: 16 }}>We will send you a 6-digit code to confirm it is you.</Txt>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 92 }}><Input label="Country" value={prefix} onChangeText={setPrefix} keyboardType="phone-pad" maxLength={5} /></View>
              <View style={{ flex: 1 }}><Input label="Phone number" value={number} onChangeText={setNumber} keyboardType="phone-pad" placeholder="98765 43210" maxLength={15} autoFocus onSubmitEditing={send} /></View>
            </View>
            <Input label="Invite code (optional)" value={invite} onChangeText={(v) => setInvite(v.toUpperCase())} autoCapitalize="characters" placeholder="From a friend or family member" maxLength={12} />
            {error ? <Txt color={colors.danger} bold style={{ marginBottom: 12 }}>{error}</Txt> : null}
            <Button title="Send code" icon="chatbubble-ellipses" onPress={send} loading={busy} />
          </> : <>
            <Txt variant="h2" style={{ marginBottom: 6 }}>Enter the code</Txt>
            <Txt color={colors.sub} style={{ marginBottom: 16 }}>We sent a 6-digit code to {full}.</Txt>
            <TextInput accessibilityLabel="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} autoFocus autoComplete="sms-otp" textContentType="oneTimeCode"
              onSubmitEditing={verify} placeholder="······" placeholderTextColor="#B8C2CC"
              style={{ minHeight: 72, borderWidth: 2, borderColor: error ? colors.danger : colors.primary, borderRadius: radius.md, textAlign: 'center', fontSize: 34 * scale, letterSpacing: 10, fontWeight: '700', color: colors.text, backgroundColor: '#fff', marginBottom: 12 }} />
            {error ? <Txt color={colors.danger} bold style={{ marginBottom: 12 }}>{error}</Txt> : null}
            <Button title="Verify and continue" icon="checkmark-circle" onPress={verify} loading={busy} />
            <Button title={wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'} variant="ghost" disabled={wait > 0 || busy} onPress={send} />
            <Button title="Change phone number" variant="ghost" onPress={() => { setStep('number'); setError(null); }} />
          </>}
        </>}
      </Screen>
    </KeyboardAvoidingView>
  );
}

/** Demo-mode stand-in for the Google account picker (only reachable when the server is in dev mode). */
export function GoogleDevSignIn() {
  const { signInWithFirebase } = useAuth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await signInWithFirebase(`dev:google:${email.trim()}:${name.trim()}`); } catch (e: any) { notify('Could not sign in', e.message); setBusy(false); }
  };
  return (
    <Screen header={<Header title="Google (demo)" />}>
      <DemoBanner text="Demo mode: this stands in for the Google account picker. Real Google sign-in needs a Firebase project (see README)." />
      <Input label="Google email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@gmail.com" />
      <Input label="Name" value={name} onChangeText={setName} placeholder="Your name" />
      <Button title="Continue" onPress={go} loading={busy} />
    </Screen>
  );
}

/** Runs the Google flow, or sends the person to the demo screen. */
export function useGoogle() {
  const nav = useNavigation<any>();
  const { signInWithFirebase } = useAuth();
  const mode = useAuthMode();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (mode === 'dev') { nav.navigate('GoogleDev'); return; }
    setBusy(true);
    try { await signInWithFirebase(await googleSignIn()); } catch (e: any) {
      const m = friendlyAuthError(e);
      if (m !== 'Sign-in was cancelled.') notify('Google sign-in failed', m);
      setBusy(false);
    }
  };
  return { run, busy, available: mode === 'firebase' || mode === 'dev', mode };
}

/** Shown once after the first phone or Google sign-in when we still need a name. */
export function CompleteProfile() {
  const { user, setUser, signOut } = useAuth();
  const [name, setName] = useState(user?.name === 'New member' ? '' : user?.name || '');
  const [city, setCity] = useState(user?.city || 'Chennai');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (name.trim().length < 2) { setError('Please enter your name'); return; }
    setBusy(true);
    try { setUser((await api<{ user: Me }>('/me', { method: 'PATCH', body: { name: name.trim(), city } })).user); } catch (e: any) { setError(e.message); setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<Header title="Welcome!" back={false} />} footer={<Button title="Continue" onPress={save} loading={busy} />}>
        <View style={{ alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Ionicons name="happy" size={64} color={colors.primary} />
          <Txt variant="title" center>Tell us about you</Txt>
          <Txt color={colors.sub} center>This is how others will see you.</Txt>
        </View>
        <Input label="Your name" value={name} onChangeText={(v) => { setName(v); setError(null); }} error={error} placeholder="e.g. Ravi Kumar" autoComplete="name" />
        <Txt bold style={{ marginBottom: 8 }}>Your city</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{CITIES.map((c) => <Chip key={c} label={c} selected={city === c} onPress={() => setCity(c)} />)}</View>
        <Pressable accessibilityRole="button" onPress={() => void signOut()} style={{ minHeight: 56, alignItems: 'center', justifyContent: 'center' }}><Txt color={colors.sub}>Use a different account</Txt></Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}

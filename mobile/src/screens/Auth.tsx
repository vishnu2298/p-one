import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Button, Chip, Header, Input, Screen, Txt, notify } from '../ui';
import { Logo } from '../components/Logo';
import { colors, space } from '../theme';
import { useAuth, useSettings } from '../context';
import { LANGUAGES } from '../i18n';
import { FadeIn } from '../ui';
import { haptic } from '../motion';
import { CITIES } from '../categories';
import { useGoogle } from './SignIn';
import { CityField } from '../components/CityPicker';
import { ConsentCheck } from '../components/Consent';
import { toast } from '../ui';

/** Quick onboarding: one screen. Agree, pick a way in, done. */
export function Welcome() {
  const nav = useNavigation<any>();
  const google = useGoogle();
  const { referralCode, consent } = useAuth();
  const [tried, setTried] = useState(false);
  const guard = (fn: () => void) => () => { if (!consent) { setTried(true); haptic.warn(); toast('Please tick the box to agree before continuing', 'info'); return; } fn(); };
  return (
    <Screen scroll={false} contentStyle={{ padding: space.xl, justifyContent: 'space-between' }}>
      <FadeIn style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <Logo size={92} />
        <Txt variant="hero">Connectly</Txt>
        <Txt color={colors.sub} center style={{ maxWidth: 280 }}>Buy, sell and meet people near you. Simple and safe.</Txt>
        {referralCode ? <View style={{ backgroundColor: colors.buySoft, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, marginTop: 6 }}><Txt variant="small" bold color={colors.buy}>You were invited · code {referralCode}</Txt></View> : null}
      </FadeIn>
      <FadeIn index={2} style={{ gap: 12, backgroundColor: colors.glass, borderRadius: 32, padding: 18, borderWidth: 1, borderColor: colors.glassBorder, boxShadow: '0px 18px 50px rgba(40,44,120,0.14)' } as any}>
        <ConsentCheck error={tried} />
        <Button title="Continue with phone" icon="call" onPress={guard(() => nav.navigate('PhoneSignIn'))} />
        {google.available ? <Button title="Continue with Google" icon="logo-google" variant="secondary" loading={google.busy} onPress={guard(google.run)} /> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 22 }}>
          <Pressable accessibilityRole="button" onPress={guard(() => nav.navigate('Register'))} style={{ minHeight: 48, justifyContent: 'center' }}><Txt bold color={colors.primary}>Use email</Txt></Pressable>
          <Pressable accessibilityRole="button" onPress={() => nav.navigate('Login')} style={{ minHeight: 48, justifyContent: 'center' }}><Txt bold color={colors.sub}>Log in</Txt></Pressable>
        </View>
      </FadeIn>
    </Screen>
  );
}

export function Login() {
  const nav = useNavigation<any>();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) { setError('Please enter your email and password'); return; }
    setBusy(true); setError(null);
    try { await signIn(email.trim(), password); } catch (e: any) { setError(e.message); setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<Header title="Log in" />} contentStyle={{ gap: 4 }}>
        <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
        <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} autoComplete="password" placeholder="Your password" onSubmitEditing={submit} />
        <Pressable accessibilityRole="button" onPress={() => setShow(!show)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -8, marginBottom: 12 }}>
          <Ionicons name={show ? 'eye-off' : 'eye'} size={22} color={colors.primary} /><Txt color={colors.primary} bold>{show ? 'Hide password' : 'Show password'}</Txt>
        </Pressable>
        {error ? <View accessibilityLiveRegion="polite" style={{ backgroundColor: colors.dangerSoft, padding: 12, borderRadius: 12, marginBottom: 12 }}><Txt color={colors.danger} bold>{error}</Txt></View> : null}
        <Button title="Log in" onPress={submit} loading={busy} />
        <Pressable accessibilityRole="button" onPress={() => nav.replace('Register')} style={{ minHeight: 56, alignItems: 'center', justifyContent: 'center' }}>
          <Txt>New here? <Txt bold color={colors.primary}>Create an account</Txt></Txt>
        </Pressable>
        <View style={{ backgroundColor: colors.warnSoft, padding: 12, borderRadius: 12, marginTop: 8 }}>
          <Txt variant="small" color={colors.warn}>Want to look around first? Use the demo account:{'\n'}demo@connectly.app  /  demo1234</Txt>
          <Button compact variant="light" title="Fill in demo account" onPress={() => { setEmail('demo@connectly.app'); setPassword('demo1234'); }} style={{ marginTop: 8 }} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

export function Register() {
  const nav = useNavigation<any>();
  const { signUp } = useAuth();
  const { referralCode, consent } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '', city: 'Chennai', referralCode: referralCode || '' });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = 'Please enter your full name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'Please enter a valid email address';
    if (f.password.length < 6) e.password = 'Password must be at least 6 characters';
    if (!consent) { toast('Please tick the box to agree before continuing', 'info'); }
    setErrors(e);
    if (Object.keys(e).length || !consent) return;
    setBusy(true);
    try { await signUp({ ...f, name: f.name.trim(), email: f.email.trim(), referralCode: f.referralCode.trim() || undefined }); } catch (err: any) { notify('Could not create account', err.message); setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<Header title="Create account" />}>
        <Input label="Full name" value={f.name} onChangeText={set('name')} error={errors.name} autoComplete="name" placeholder="e.g. Ravi Kumar" />
        <Input label="Email" value={f.email} onChangeText={set('email')} error={errors.email} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
        <Input label="Password" value={f.password} onChangeText={set('password')} error={errors.password} secureTextEntry hint="At least 6 characters" placeholder="Choose a password" />
        <Input label="Phone (optional)" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="Only shared if you choose" />
        <Input label="Invite code (optional)" value={f.referralCode} onChangeText={(v) => set('referralCode')(v.toUpperCase())} autoCapitalize="characters" placeholder="From a friend or family member" maxLength={12} />
        <CityField label="Your city" value={f.city} onChange={(c) => set('city')(c || 'Chennai')} />
        <ConsentCheck />
        <View style={{ height: 12 }} />
        <Button title="Create my account" onPress={submit} loading={busy} />
        <Pressable accessibilityRole="button" onPress={() => nav.replace('Login')} style={{ minHeight: 56, alignItems: 'center', justifyContent: 'center' }}>
          <Txt>Already have an account? <Txt bold color={colors.primary}>Log in</Txt></Txt>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}

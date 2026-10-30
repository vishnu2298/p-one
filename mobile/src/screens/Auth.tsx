import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Button, Chip, Header, Input, Screen, Txt, notify } from '../ui';
import { Logo } from '../components/Logo';
import { colors, space } from '../theme';
import { useAuth } from '../context';
import { CITIES } from '../categories';
import { useGoogle } from './SignIn';

const SLIDES = [
  { icon: 'cart', color: colors.buy, bg: colors.buySoft, title: 'Buy what you need', text: 'Find phones, furniture, bikes and more from people near you.' },
  { icon: 'pricetag', color: colors.sell, bg: colors.sellSoft, title: 'Sell what you don\'t', text: 'Add photos, set a price and your item is live in a minute.' },
  { icon: 'people', color: colors.connect, bg: colors.connectSoft, title: 'Connect with people nearby', text: 'Chat safely, make friends and build trust with ratings and reviews.' },
];

export function Onboarding() {
  const { finishOnboarding } = useAuth();
  const [i, setI] = useState(0);
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <Screen scroll={false} contentStyle={{ padding: space.xl, justifyContent: 'space-between' }}>
      <View style={{ alignItems: 'flex-end', minHeight: 48 }}>
        {!last ? <Pressable accessibilityRole="button" onPress={finishOnboarding} style={{ minHeight: 48, justifyContent: 'center' }}><Txt bold color={colors.sub}>Skip</Txt></Pressable> : null}
      </View>
      <View style={{ alignItems: 'center', gap: 20 }}>
        <View style={{ width: 200, height: 200, borderRadius: 100, backgroundColor: s.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={s.icon as any} size={96} color={s.color} />
        </View>
        <Txt variant="title" center>{s.title}</Txt>
        <Txt color={colors.sub} center style={{ maxWidth: 360 }}>{s.text}</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {SLIDES.map((_, k) => <View key={k} style={{ width: k === i ? 28 : 10, height: 10, borderRadius: 5, backgroundColor: k === i ? colors.primary : colors.line }} />)}
        </View>
      </View>
      <Button title={last ? 'Get Started' : 'Next'} onPress={() => (last ? finishOnboarding() : setI(i + 1))} />
    </Screen>
  );
}

export function Welcome() {
  const nav = useNavigation<any>();
  const google = useGoogle();
  const { referralCode } = useAuth();
  return (
    <Screen contentStyle={{ padding: space.xl, justifyContent: 'center', gap: 16, flexGrow: 1 }}>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Logo size={96} />
        <Txt variant="hero" color={colors.primary}>Connectly</Txt>
        <Txt color={colors.sub} center>Buy  •  Sell  •  Connect</Txt>
      </View>
      <Txt variant="h2" center style={{ marginVertical: 8 }}>Everything you need, in one place.</Txt>
      {referralCode ? <View style={{ backgroundColor: colors.buySoft, borderRadius: 14, padding: 12 }}><Txt bold color={colors.buy} center>You were invited! Code {referralCode} will be added when you sign up.</Txt></View> : null}
      <Button title="Continue with phone" icon="call" onPress={() => nav.navigate('PhoneSignIn')} />
      {google.available ? <Button title="Continue with Google" icon="logo-google" variant="secondary" loading={google.busy} onPress={google.run} /> : null}
      <Button title="Use email instead" icon="mail" variant="light" onPress={() => nav.navigate('Register')} />
      <Pressable accessibilityRole="button" onPress={() => nav.navigate('Login')} style={{ minHeight: 56, alignItems: 'center', justifyContent: 'center' }}>
        <Txt>Already have an email account? <Txt bold color={colors.primary}>Log in</Txt></Txt>
      </Pressable>
      <Txt variant="small" color={colors.sub} center>Simple. Safe. For everyone.</Txt>
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
  const { referralCode } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '', city: 'Chennai', referralCode: referralCode || '' });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = 'Please enter your full name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'Please enter a valid email address';
    if (f.password.length < 6) e.password = 'Password must be at least 6 characters';
    setErrors(e);
    if (Object.keys(e).length) return;
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
        <Txt bold style={{ marginBottom: 8 }}>Your city</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 }}>
          {CITIES.map((c) => <Chip key={c} label={c} selected={f.city === c} onPress={() => set('city')(c)} />)}
        </View>
        <Button title="Create my account" onPress={submit} loading={busy} />
        <Txt variant="small" color={colors.sub} center style={{ marginTop: 12 }}>By continuing you agree to keep Connectly safe and friendly for everyone.</Txt>
        <Pressable accessibilityRole="button" onPress={() => nav.replace('Login')} style={{ minHeight: 56, alignItems: 'center', justifyContent: 'center' }}>
          <Txt>Already have an account? <Txt bold color={colors.primary}>Log in</Txt></Txt>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setToken, setUnauthorizedHandler, storage } from './api';
import { Me } from './types';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { firebaseSignOut } from './firebaseAuth';
import { registerForPush, unregisterPush } from './push';
import { TEXT_SCALE, TextSize } from './theme';

type AuthCtx = {
  ready: boolean;
  user: Me | null;
  seenOnboarding: boolean;
  finishOnboarding: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (v: { name: string; email: string; password: string; city: string; phone?: string; referralCode?: string }) => Promise<void>;
  signInWithFirebase: (idToken: string, extra?: { referralCode?: string; city?: string }) => Promise<{ isNew: boolean }>;
  referralCode: string;
  clearReferral: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: Me) => void;
};
const Auth = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Auth);

type SettingsCtx = { textSize: TextSize; scale: number; setTextSize: (t: TextSize) => void };
const Settings = createContext<SettingsCtx>({ textSize: 'normal', scale: 1, setTextSize: () => {} });
export const useSettings = () => useContext(Settings);

export function Providers({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<Me | null>(null);
  const [seenOnboarding, setSeen] = useState(false);
  const [textSize, setTextSizeState] = useState<TextSize>('large');
  const [referralCode, setReferral] = useState('');

  const signOut = useCallback(async () => {
    await unregisterPush(); // needs the token, so do it first
    void firebaseSignOut();
    setToken(null);
    setUser(null);
    await storage.del('token');
  }, []);

  // Invite links: connectly://invite/CODE (or ?ref=CODE on web) are remembered until the person signs up.
  useEffect(() => {
    const take = (url: string | null) => {
      const m = url && (/invite\/([A-Za-z0-9]{6,12})/.exec(url) || /[?&]ref=([A-Za-z0-9]{6,12})/.exec(url));
      if (m) { const code = m[1].toUpperCase(); setReferral(code); void storage.set('referralCode', code); }
    };
    void storage.get('referralCode').then((c) => c && setReferral(c));
    void Linking.getInitialURL().then(take);
    const sub = Linking.addEventListener('url', (e) => take(e.url));
    return () => sub.remove();
  }, []);

  // Once signed in, register this device for push (native only; the OS asks for permission).
  useEffect(() => {
    if (user && Platform.OS !== 'web' && user.pushEnabled) void registerForPush();
  }, [user?.id, user?.pushEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setUnauthorizedHandler(() => { void signOut(); });
    (async () => {
      const [t, seen, size] = await Promise.all([storage.get('token'), storage.get('seenOnboarding'), storage.get('textSize')]);
      if (seen) setSeen(true);
      if (size === 'normal' || size === 'large' || size === 'xlarge') setTextSizeState(size);
      if (t) {
        setToken(t);
        try { setUser((await api<{ user: Me }>('/me')).user); } catch { setToken(null); await storage.del('token'); }
      }
      setReady(true);
    })();
  }, [signOut]);

  const accept = async (r: { token: string; user: Me }) => {
    setToken(r.token);
    await storage.set('token', r.token);
    setUser(r.user);
  };

  const auth = useMemo<AuthCtx>(() => ({
    ready, user, seenOnboarding, setUser,
    finishOnboarding: () => { setSeen(true); void storage.set('seenOnboarding', '1'); },
    signIn: async (email, password) => accept(await api('/auth/login', { method: 'POST', body: { email, password } })),
    signUp: async (v) => { await accept(await api('/auth/register', { method: 'POST', body: { referralCode, ...v } })); setReferral(''); void storage.del('referralCode'); },
    signInWithFirebase: async (idToken, extra) => {
      const r = await api<{ token: string; user: Me; isNew: boolean }>('/auth/firebase', { method: 'POST', body: { idToken, referralCode, ...extra } });
      await accept(r);
      if (r.isNew) { setReferral(''); void storage.del('referralCode'); }
      return { isNew: r.isNew };
    },
    referralCode,
    clearReferral: () => { setReferral(''); void storage.del('referralCode'); },
    signOut,
    refresh: async () => { try { setUser((await api<{ user: Me }>('/me')).user); } catch { /* handled by 401 */ } },
  }), [ready, user, seenOnboarding, signOut, referralCode]);

  const settings = useMemo<SettingsCtx>(() => ({
    textSize, scale: TEXT_SCALE[textSize],
    setTextSize: (t) => { setTextSizeState(t); void storage.set('textSize', t); },
  }), [textSize]);

  return <Settings.Provider value={settings}><Auth.Provider value={auth}>{children}</Auth.Provider></Settings.Provider>;
}

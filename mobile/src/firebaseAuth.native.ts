// Firebase sign-in, native implementation (iOS/Android).
// The native Firebase modules are loaded lazily: in Expo Go they do not exist, so phone/Google sign-in is simply
// reported as unavailable (the app falls back to the server's demo mode or email) instead of crashing.
export type PhoneSession = { confirm: (code: string) => Promise<string> };

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

type Native = { auth: any; gsi: any };
let cached: Native | null | undefined;
function native(): Native | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = { auth: require('@react-native-firebase/auth'), gsi: require('@react-native-google-signin/google-signin') };
  } catch { cached = null; }
  return cached;
}

/** True only in a development/production build that includes the native Firebase modules and a Google client id. */
export const firebaseConfigured = !!webClientId && !!native();

export async function startPhone(phone: string): Promise<PhoneSession> {
  const n = native();
  if (!n) throw new Error('Phone sign-in needs the full app build (not Expo Go).');
  const conf = await n.auth.signInWithPhoneNumber(n.auth.getAuth(), phone);
  return {
    confirm: async (code) => {
      const cred = await conf.confirm(code);
      if (!cred?.user) throw new Error('Could not verify the code');
      return n.auth.getIdToken(cred.user);
    },
  };
}

export async function googleSignIn(): Promise<string> {
  const n = native();
  if (!n) throw new Error('Google sign-in needs the full app build (not Expo Go).');
  const { GoogleSignin } = n.gsi;
  GoogleSignin.configure({ webClientId });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res: any = await GoogleSignin.signIn();
  const idToken = res?.data?.idToken ?? res?.idToken;
  if (!idToken) throw Object.assign(new Error('Sign-in was cancelled.'), { code: 'SIGN_IN_CANCELLED' });
  const cred = await n.auth.signInWithCredential(n.auth.getAuth(), n.auth.GoogleAuthProvider.credential(idToken));
  return n.auth.getIdToken(cred.user);
}

export async function firebaseSignOut() {
  const n = native();
  if (!n) return;
  try { await n.auth.signOut(n.auth.getAuth()); await n.gsi.GoogleSignin.signOut(); } catch { /* already signed out */ }
}

export function friendlyAuthError(e: any): string {
  const code = String(e?.code || '');
  if (code.includes('invalid-phone-number')) return 'That phone number does not look right. Please include the country code.';
  if (code.includes('invalid-verification-code') || code.includes('session-expired')) return 'That code is not correct or has expired. Please try again.';
  if (code.includes('too-many-requests')) return 'Too many tries. Please wait a few minutes and try again.';
  if (code.includes('CANCELLED') || code.includes('cancelled')) return 'Sign-in was cancelled.';
  if (code.includes('network')) return 'No internet connection. Please check and try again.';
  return e?.message || 'Sign-in failed. Please try again.';
}

// Firebase sign-in, native implementation (iOS/Android). Requires a development build, not Expo Go.
import { getAuth, getIdToken, GoogleAuthProvider, signInWithCredential, signInWithPhoneNumber, signOut } from '@react-native-firebase/auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

export type PhoneSession = { confirm: (code: string) => Promise<string> };

// Native config comes from google-services.json / GoogleService-Info.plist (see README), so a Google web client id is the only runtime setting.
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
export const firebaseConfigured = !!webClientId;

export async function startPhone(phone: string): Promise<PhoneSession> {
  const conf = await signInWithPhoneNumber(getAuth(), phone);
  return {
    confirm: async (code) => {
      const cred = await conf.confirm(code);
      if (!cred?.user) throw new Error('Could not verify the code');
      return getIdToken(cred.user);
    },
  };
}

export async function googleSignIn(): Promise<string> {
  GoogleSignin.configure({ webClientId });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res: any = await GoogleSignin.signIn();
  const idToken = res?.data?.idToken ?? res?.idToken;
  if (!idToken) throw Object.assign(new Error('Sign-in was cancelled.'), { code: 'SIGN_IN_CANCELLED' });
  const cred = await signInWithCredential(getAuth(), GoogleAuthProvider.credential(idToken));
  return getIdToken(cred.user);
}

export async function firebaseSignOut() {
  try { await signOut(getAuth()); await GoogleSignin.signOut(); } catch { /* already signed out */ }
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

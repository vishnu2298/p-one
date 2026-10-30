// Firebase sign-in, web implementation (also the type source). Native uses firebaseAuth.native.ts.
import { initializeApp, getApps } from 'firebase/app';
import { GoogleAuthProvider, RecaptchaVerifier, getAuth, signInWithPhoneNumber, signInWithPopup, signOut } from 'firebase/auth';

export type PhoneSession = { confirm: (code: string) => Promise<string> };

const cfg = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};
export const firebaseConfigured = !!(cfg.apiKey && cfg.projectId && cfg.appId);

const auth = () => getAuth(getApps()[0] || initializeApp(cfg as Record<string, string>));
let verifier: RecaptchaVerifier | null = null;

export async function startPhone(phone: string): Promise<PhoneSession> {
  const a = auth();
  if (!verifier) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    verifier = new RecaptchaVerifier(a, el, { size: 'invisible' });
  }
  try {
    const conf = await signInWithPhoneNumber(a, phone, verifier);
    return { confirm: async (code) => (await conf.confirm(code)).user.getIdToken() };
  } catch (e) {
    verifier.clear(); verifier = null;
    throw e;
  }
}

export async function googleSignIn(): Promise<string> {
  const res = await signInWithPopup(auth(), new GoogleAuthProvider());
  return res.user.getIdToken();
}

export async function firebaseSignOut() {
  if (firebaseConfigured) await signOut(auth()).catch(() => {});
}

/** Turns Firebase error codes into plain-language messages. */
export function friendlyAuthError(e: any): string {
  const code = String(e?.code || '');
  if (code.includes('invalid-phone-number')) return 'That phone number does not look right. Please include the country code.';
  if (code.includes('invalid-verification-code') || code.includes('code-expired')) return 'That code is not correct or has expired. Please try again.';
  if (code.includes('too-many-requests')) return 'Too many tries. Please wait a few minutes and try again.';
  if (code.includes('popup-closed') || code.includes('cancelled') || code.includes('SIGN_IN_CANCELLED')) return 'Sign-in was cancelled.';
  if (code.includes('network')) return 'No internet connection. Please check and try again.';
  return e?.message || 'Sign-in failed. Please try again.';
}

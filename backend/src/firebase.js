// Firebase Admin wrapper: verifies phone/Google ID tokens and sends FCM push.
const config = require('./config');
const { HttpError } = require('./util');

let adminApp = null;
let initTried = false;

function getAdmin() {
  if (initTried) return adminApp;
  initTried = true;
  if (!config.firebaseProjectId && !config.firebaseServiceAccountJson && !process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
  const admin = require('firebase-admin');
  if (config.firebaseServiceAccountJson) {
    const sa = JSON.parse(config.firebaseServiceAccountJson);
    adminApp = admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    adminApp = admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: config.firebaseProjectId || undefined });
  } else {
    adminApp = admin.initializeApp({ projectId: config.firebaseProjectId }); // enough to verify ID tokens
  }
  return adminApp;
}

const E164 = /^\+[1-9]\d{7,14}$/;
const DEV_CODE = '123456';

// Dev tokens (only when FIREBASE_DEV_MODE=1):
//   dev:phone:+919876543210:123456      dev:google:someone@example.com:Some Name
function verifyDevToken(token) {
  const [, kind, ...rest] = token.split(':');
  if (kind === 'phone') {
    const [phone, code] = rest;
    if (!E164.test(phone || '')) throw new HttpError(400, 'Enter a valid phone number with country code');
    if (code !== DEV_CODE) throw new HttpError(401, 'That code is not correct. Please try again.');
    return { uid: `dev-phone-${phone}`, phone, email: null, emailVerified: false, name: '', picture: '', provider: 'phone' };
  }
  if (kind === 'google') {
    const email = (rest[0] || '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid Google email address');
    return { uid: `dev-google-${email}`, phone: '', email, emailVerified: true, name: rest.slice(1).join(':'), picture: '', provider: 'google' };
  }
  throw new HttpError(401, 'Invalid sign-in token');
}

async function verifyIdToken(idToken) {
  if (typeof idToken !== 'string' || !idToken) throw new HttpError(400, 'Missing sign-in token');
  if (idToken.startsWith('dev:')) {
    if (!config.firebaseDevMode) throw new HttpError(401, 'Invalid sign-in token');
    return verifyDevToken(idToken);
  }
  const app = getAdmin();
  if (!app) throw new HttpError(503, 'Phone and Google sign-in are not set up on this server yet');
  let d;
  try {
    d = await require('firebase-admin').auth(app).verifyIdToken(idToken);
  } catch {
    throw new HttpError(401, 'Your sign-in expired. Please try again.');
  }
  const provider = d.firebase?.sign_in_provider === 'phone' ? 'phone' : d.firebase?.sign_in_provider === 'google.com' ? 'google' : null;
  if (!provider) throw new HttpError(400, 'This sign-in method is not supported');
  return { uid: d.uid, phone: d.phone_number || '', email: d.email ? d.email.toLowerCase() : null, emailVerified: !!d.email_verified, name: d.name || '', picture: d.picture || '', provider };
}

// Push sender. `send(tokens, payload)` resolves to the list of tokens that are no longer valid.
function createPush() {
  return {
    get enabled() { return !!(config.firebaseServiceAccountJson || process.env.GOOGLE_APPLICATION_CREDENTIALS); },
    async send(tokens, { title, body, data = {} }) {
      const app = getAdmin();
      if (!app || !tokens.length) return [];
      const res = await require('firebase-admin').messaging(app).sendEachForMulticast({
        tokens,
        notification: { title, body },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
        android: { priority: 'high', notification: { channelId: 'default' } },
      });
      const dead = [];
      res.responses.forEach((r, i) => {
        const code = r.error?.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.push(tokens[i]);
      });
      return dead;
    },
  };
}

module.exports = { verifyIdToken, createPush, E164, DEV_CODE };

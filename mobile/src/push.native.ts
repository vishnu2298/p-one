// Push notifications on iOS/Android: FCM token via React Native Firebase, display/permissions/channels via expo-notifications.
// Native Firebase is loaded lazily so the app still runs in Expo Go (where push is simply unavailable).
import { Platform } from 'react-native';
import { api, storage } from './api';

let unsubs: Array<() => void> = [];

function load() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fb = require('@react-native-firebase/messaging');
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
    return { Notifications, fb };
  } catch { return null; }
}

async function upload(token: string) {
  await api('/devices', { method: 'POST', body: { token, platform: Platform.OS } });
  await storage.set('fcmToken', token);
}

/** Asks permission and registers this device for push. Returns the token or null (never throws). */
export async function registerForPush(): Promise<string | null> {
  const m = load();
  if (!m) return null;
  const { Notifications, fb } = m;
  try {
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Messages and updates', importance: Notifications.AndroidImportance.HIGH });
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return null;
    const msg = fb.getMessaging();
    await fb.requestPermission(msg); // iOS: registers for remote notifications
    const token = await fb.getToken(msg);
    if (!token) return null;
    await upload(token);
    unsubs.forEach((u) => u());
    unsubs = [
      fb.onTokenRefresh(msg, (t: string) => { void upload(t).catch(() => {}); }),
      // FCM does not draw a banner while the app is open, so show one ourselves.
      fb.onMessage(msg, async (r: any) => {
        await Notifications.scheduleNotificationAsync({ content: { title: r.notification?.title ?? 'Connectly', body: r.notification?.body ?? '', data: r.data ?? {} }, trigger: null });
      }),
    ];
    return token;
  } catch { return null; }
}

export async function unregisterPush() {
  unsubs.forEach((u) => u()); unsubs = [];
  const token = await storage.get('fcmToken');
  if (token) { await api('/devices', { method: 'DELETE', body: { token } }).catch(() => {}); await storage.del('fcmToken'); }
}

/** Calls back with the notification's data when the user taps it (background, closed, or foreground banner). */
export function listenForNotificationTaps(onTap: (data: Record<string, string>) => void) {
  const m = load();
  if (!m) return () => {};
  const { Notifications, fb } = m;
  try {
    const msg = fb.getMessaging();
    const subs: Array<() => void> = [
      fb.onNotificationOpenedApp(msg, (r: any) => onTap(r.data || {})),
      (() => { const s = Notifications.addNotificationResponseReceivedListener((r: any) => onTap(r.notification.request.content.data || {})); return () => s.remove(); })(),
    ];
    void fb.getInitialNotification(msg).then((r: any) => { if (r) onTap(r.data || {}); }).catch(() => {});
    return () => subs.forEach((u) => u());
  } catch { return () => {}; }
}

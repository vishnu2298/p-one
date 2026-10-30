// Push notifications on iOS/Android: FCM token via React Native Firebase, display/permissions/channels via expo-notifications.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { getMessaging, getToken, onMessage, onNotificationOpenedApp, getInitialNotification, onTokenRefresh, requestPermission } from '@react-native-firebase/messaging';
import { api, storage } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let unsubs: Array<() => void> = [];

async function upload(token: string) {
  await api('/devices', { method: 'POST', body: { token, platform: Platform.OS } });
  await storage.set('fcmToken', token);
}

/** Asks permission (with a clear reason shown first by the caller) and registers this device. Returns the token or null. */
export async function registerForPush(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Messages and updates', importance: Notifications.AndroidImportance.HIGH });
    }
    const perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return null;
    const m = getMessaging();
    await requestPermission(m); // iOS: registers for remote notifications
    const token = await getToken(m);
    if (!token) return null;
    await upload(token);
    unsubs.forEach((u) => u());
    unsubs = [
      onTokenRefresh(m, (t) => { void upload(t).catch(() => {}); }),
      // FCM does not draw a banner while the app is open, so show one ourselves.
      onMessage(m, async (msg) => {
        await Notifications.scheduleNotificationAsync({ content: { title: msg.notification?.title ?? 'Connectly', body: msg.notification?.body ?? '', data: (msg.data as any) ?? {} }, trigger: null });
      }),
    ];
    return token;
  } catch {
    return null; // push is a nice-to-have; never block the app
  }
}

export async function unregisterPush() {
  unsubs.forEach((u) => u()); unsubs = [];
  const token = await storage.get('fcmToken');
  if (token) { await api('/devices', { method: 'DELETE', body: { token } }).catch(() => {}); await storage.del('fcmToken'); }
}

/** Calls back with the notification's data when the user taps it (app in background, closed, or foreground banner). */
export function listenForNotificationTaps(onTap: (data: Record<string, string>) => void) {
  const m = getMessaging();
  const subs = [
    onNotificationOpenedApp(m, (msg) => onTap((msg.data as any) || {})),
    Notifications.addNotificationResponseReceivedListener((r) => onTap((r.notification.request.content.data as any) || {})),
  ];
  void getInitialNotification(m).then((msg) => { if (msg) onTap((msg.data as any) || {}); });
  return () => subs.forEach((s) => ('remove' in s ? s.remove() : s()));
}

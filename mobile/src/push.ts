// Push notifications, web/default: not supported on web in this build (the in-app inbox still works).
export async function registerForPush(): Promise<string | null> { return null; }
export async function unregisterPush(): Promise<void> {}
export function listenForNotificationTaps(_onTap: (data: Record<string, string>) => void): () => void { return () => {}; }

import { api, unwrap } from '@/lib/api';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function pushSupported(): Promise<boolean> {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function pushPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!(await pushSupported())) return 'unsupported';
  return Notification.permission;
}

export async function subscribePush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!(await pushSupported())) return { ok: false, reason: 'Push is not supported in this browser.' };

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'Notification permission was denied.' };

  const { public_key } = await unwrap<{ public_key: string }>(api.get('/notifications/push/vapid-public'));
  const reg = await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key) as BufferSource,
    });
  }

  const json = sub.toJSON();
  await unwrap(
    api.post('/notifications/push/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  );
  return { ok: true };
}

export async function unsubscribePush(): Promise<void> {
  if (!(await pushSupported())) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const json = sub.toJSON();
  await unwrap(
    api.delete('/notifications/push/subscribe', {
      data: { endpoint: json.endpoint, keys: json.keys ?? {} },
    }),
  );
  await sub.unsubscribe();
}

/** Re-register with the backend when permission is already granted (e.g. after login). */
export async function syncPushIfGranted(): Promise<void> {
  if (!(await pushSupported())) return;
  if (Notification.permission !== 'granted') return;
  try {
    await subscribePush();
  } catch {
    // VAPID may be unset on local dev — in-app notifications still work.
  }
}

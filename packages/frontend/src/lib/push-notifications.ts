import { api } from './api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const data = await api<{ publicKey: string }>('/web-push/vapid-key');
    return data.publicKey;
  } catch {
    return null;
  }
}

export function isWebPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/sw-push.js');
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<boolean> {
  if (!isWebPushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const vapidKey = await getVapidPublicKey();
  if (!vapidKey) return false;

  // Register service worker
  const registration = await navigator.serviceWorker.register('/sw-push.js');
  await navigator.serviceWorker.ready;

  // Subscribe
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
  });

  const subJson = subscription.toJSON();

  // Send subscription to backend
  await api('/web-push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys?.p256dh ?? '',
        auth: subJson.keys?.auth ?? '',
      },
    }),
  });

  return true;
}

export async function unsubscribeFromPush(): Promise<boolean> {
  const subscription = await getExistingSubscription();
  if (!subscription) return false;

  // Unsubscribe from browser
  await subscription.unsubscribe();

  // Remove from backend
  try {
    await api('/web-push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } catch {
    // Backend cleanup is best-effort
  }

  // Unregister service worker
  const registration = await navigator.serviceWorker.getRegistration('/sw-push.js');
  if (registration) {
    await registration.unregister();
  }

  return true;
}

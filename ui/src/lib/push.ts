// src/lib/push.ts
// ============================================================
// Web Push Helper — Subscribe/Unsubscribe + State-Lookup
//
// Frontend-Pendant zum Backend-Modul api/notification-engine.js.
// Kommuniziert mit /api/push/* Endpoints.
// ============================================================

const API = process.env.NEXT_PUBLIC_API_URL;

export type PushState =
  | 'loading'      // initialer Zustand bevor Browser geprüft wurde
  | 'unsupported'  // Browser kann kein Web Push (z.B. iOS Safari < 16.4)
  | 'denied'       // User hat Permission verweigert (Browser-Setting)
  | 'default'      // Permission noch nicht entschieden
  | 'granted'      // Permission da, aber noch keine aktive Subscription
  | 'subscribed';  // Permission + aktive Subscription auf diesem Gerät

// ── Capability-Check ────────────────────────────────────────
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// ── State-Lookup ────────────────────────────────────────────
export async function getPushState(): Promise<PushState> {
  if (!isPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';

  // permission === 'granted' — schauen ob lokale Subscription da
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'granted';
  } catch {
    return 'granted';
  }
}

// ── VAPID Public Key holen + konvertieren ───────────────────
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function fetchVapidKey(): Promise<string> {
  const token = localStorage.getItem('crumb_token');
  const res = await fetch(`${API}/push/vapid-key`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('VAPID-Key konnte nicht geladen werden');
  const data = await res.json();
  if (!data.publicKey) throw new Error('Server hat keinen VAPID-Key konfiguriert');
  return data.publicKey;
}

// ── Subscribe ───────────────────────────────────────────────
// MUSS aus einem User-Gesture aufgerufen werden (Click-Handler),
// weil sonst manche Browser den Permission-Prompt blockieren.
export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) throw new Error('Browser unterstützt keine Push-Benachrichtigungen');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Benachrichtigungen wurden nicht erlaubt');
  }

  const vapidPublicKey = await fetchVapidKey();
  const reg = await navigator.serviceWorker.ready;

  // Falls schon eine Subscription da ist, wiederverwenden — sonst neu anlegen
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const subJson = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
    throw new Error('Subscription unvollständig');
  }

  const token = localStorage.getItem('crumb_token');
  const res = await fetch(`${API}/push/subscribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
      userAgent: navigator.userAgent,
    }),
  });
  if (!res.ok) throw new Error(`Subscribe fehlgeschlagen (${res.status})`);
}

// ── Unsubscribe ─────────────────────────────────────────────
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  // Erst lokal abmelden, dann Backend informieren (Reihenfolge unkritisch,
  // aber so vermeiden wir orphan-Subs falls das DELETE fehlschlägt)
  await sub.unsubscribe();

  try {
    const token = localStorage.getItem('crumb_token');
    await fetch(`${API}/push/unsubscribe`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint }),
    });
  } catch (err) {
    // Best-effort — bei expired Subs räumt das Backend eh selbst auf
    console.warn('Unsubscribe-DELETE fehlgeschlagen, ignoriert:', err);
  }
}

// ── Test-Push triggern (optional, fürs Debugging) ───────────
export async function sendTestPush(): Promise<void> {
  const token = localStorage.getItem('crumb_token');
  const res = await fetch(`${API}/push/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Test-Push fehlgeschlagen (${res.status})`);
}
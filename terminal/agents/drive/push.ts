import { proveWallet } from '@/city/lib/trade/proof';
import { useWallet } from '@/city/lib/trade/wallet';

/**
 * This device's push for the agent's moves: the browser's own Web Push, with Ryntra's service worker
 * (`/ryntra-push-sw.js`) — an empty push wakes it and it reads the newest note from Ryntra itself, so no words travel
 * through the push service. Turning it on asks the browser's permission, subscribes and hands Ryntra the subscription's
 * address under the wallet's proof; off unsubscribes. Nothing here signs a transaction or moves money.
 */

export type PushHere = 'on' | 'off' | 'blocked' | 'none';

const WORKER = '/ryntra-push-sw.js';
const API = '/api/v1/assistant/push';

type PushState = Readonly<{ configured: boolean; publicKey: string | null; thisBrowser: boolean | null }>;

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameKey(held: PushSubscription, key: Uint8Array): boolean {
  const own = held.options.applicationServerKey;
  if (!own) return false;
  const bytes = new Uint8Array(own);
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}

async function subscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/').catch(() => undefined);
  return (await registration?.pushManager.getSubscription().catch(() => null)) ?? null;
}

async function state(endpoint: string | null): Promise<PushState | 'proof' | null> {
  const response = await fetch(API, { cache: 'no-store', credentials: 'same-origin', headers: endpoint ? { 'x-ryntra-push-endpoint': endpoint } : {} }).catch(() => null);
  if (!response) return null;
  if (response.status === 401) return 'proof';
  return response.ok ? ((await response.json().catch(() => null)) as PushState | null) : null;
}

/** Whether this browser hears the wallet's notes; `none` — no push here, or none on this deployment. */
export async function readPushHere(): Promise<PushHere | null> {
  if (!pushSupported()) return 'none';
  if (Notification.permission === 'denied') return 'blocked';
  const held = await subscription();
  const read = await state(held?.endpoint ?? null);
  if (read === 'proof' || read === null) return null;
  if (!read.configured) return 'none';
  return read.thisBrowser ? 'on' : 'off';
}

async function prove(): Promise<boolean> {
  const connection = useWallet.getState().connection;
  if (!connection) return false;
  return (await proveWallet(connection)).ok;
}

async function send(method: 'POST' | 'DELETE', endpoint: string): Promise<Response | null> {
  const call = () => fetch(API, { method, cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint }) }).catch(() => null);
  let response = await call();
  if (response?.status === 401 && (await prove())) response = await call();
  return response;
}

/** Turns this browser's push on or off; what it is after. */
export async function turnPush(on: boolean): Promise<PushHere> {
  if (!pushSupported()) return 'none';
  if (!on) {
    const held = await subscription();
    if (held) {
      await send('DELETE', held.endpoint);
      await held.unsubscribe().catch(() => false);
    }
    return 'off';
  }
  const permission = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  let read = await state(null);
  if (read === 'proof') read = (await prove()) ? await state(null) : null;
  if (!read || read === 'proof' || !read.configured || !read.publicKey) return 'none';
  const registration = await navigator.serviceWorker.register(WORKER, { scope: '/' });
  await navigator.serviceWorker.ready;
  const key = keyBytes(read.publicKey);
  let held = await registration.pushManager.getSubscription();
  /* A subscription made under a key since replaced hears nothing: it is made anew. */
  if (held && !sameKey(held, key)) {
    await held.unsubscribe().catch(() => false);
    held = null;
  }
  const subscribed = held ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  const answer = await send('POST', subscribed.endpoint);
  return answer?.ok ? 'on' : 'off';
}

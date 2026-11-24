/**
 * Where the private balance's secrets live.
 *
 * Keys from the wallet — the only keys a new private balance gets. The wallet's signature over the key request
 * is turned into the viewing and nullifier keys at once and dropped; the keys stay in this tab's memory only, never in
 * IndexedDB, `localStorage`, a log or analytics. A reload, another wallet or another tab asks the wallet once again: the
 * same wallet gives the same keys on any device, so there is nothing to keep and nothing to lose.
 *
 * In this browser, encrypted: IndexedDB holds an AES-GCM key that cannot be exported (the browser keeps its bytes to
 * itself) and, beside it, each secret sealed with that key — the seeds of links the person made, kept until the link is
 * taken so its sender can take it back, and the older keys of the test network (made at random in the browser
 * and registered before this rule). Those older keys are only read and copied out now, so test money is not lost; no
 * new keys are made or sealed. Nothing here goes to a server; clearing the site's data removes it all.
 */

const DB = 'ryntra-private';
const WRAP = 'wrap';
const ITEMS = 'items';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(WRAP);
      request.result.createObjectStore(ITEMS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(store: string, mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = act(tx.objectStore(store));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

let wrapKey: Promise<CryptoKey> | null = null;

function key(): Promise<CryptoKey> {
  wrapKey ??= (async () => {
    const held = await run<CryptoKey | undefined>(WRAP, 'readonly', (s) => s.get('k'));
    if (held) return held;
    const made = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await run(WRAP, 'readwrite', (s) => s.put(made, 'k'));
    return made;
  })();
  wrapKey.catch(() => {
    wrapKey = null;
  });
  return wrapKey;
}

type Sealed = Readonly<{ iv: Uint8Array; data: ArrayBuffer }>;

export async function seal(id: string, value: unknown): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, await key(), plain);
  plain.fill(0);
  await run(ITEMS, 'readwrite', (s) => s.put({ iv, data } satisfies Sealed, id));
}

export async function unseal<T>(id: string): Promise<T | null> {
  const sealed = await run<Sealed | undefined>(ITEMS, 'readonly', (s) => s.get(id));
  if (!sealed) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv), additionalData: new TextEncoder().encode(id) }, await key(), sealed.data);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

export async function forget(id: string): Promise<void> {
  await run(ITEMS, 'readwrite', (s) => s.delete(id));
}

export async function ids(prefix: string): Promise<readonly string[]> {
  const all = await run<IDBValidKey[]>(ITEMS, 'readonly', (s) => s.getAllKeys());
  return all.map(String).filter((id) => id.startsWith(prefix));
}

/* The sealed secrets, by id. */

export const keysId = (network: string, owner: string) => `keys:${network}:${owner}`;
export const linkId = (network: string, owner: string, link: string) => `link:${network}:${owner}:${link}`;
/** Whether the key copy was saved since the keys or the links last changed — older keys only. */
export const copiedId = (network: string, owner: string) => `copied:${network}:${owner}`;

/** Older keys of the test network, sealed before keys came from the wallet; read, never written anew. */
export type StoredKeys = Readonly<{ viewing: number[]; nullifier: number[]; from: 'own' }>;
/** `funded` — the private transfer into the link landed; until then the link is half made and is finished, not listed. */
export type StoredLink = Readonly<{ seed: number[]; lamports: string; at: number; address: string; fragment: string; funded: boolean }>;

/* Keys from the wallet: this tab's memory, one wallet at a time. */

type Destroyable = Readonly<{ destroy?: () => void }>;

let inTab: Readonly<{ id: string; keys: unknown }> | null = null;

/** Holds the keys the wallet gave for this address; the keys held before, for any address, are destroyed. */
export function holdKeys(network: string, owner: string, keys: unknown): void {
  const id = keysId(network, owner);
  if (inTab && inTab.keys !== keys) (inTab.keys as Destroyable).destroy?.();
  inTab = { id, keys };
}

/** The keys the wallet gave for this address in this tab, or null. */
export function heldKeys<T>(network: string, owner: string): T | null {
  return inTab?.id === keysId(network, owner) ? (inTab.keys as T) : null;
}

/** Drops the keys held in this tab — another wallet, or the registry holds other keys. */
export function dropKeys(): void {
  (inTab?.keys as Destroyable | undefined)?.destroy?.();
  inTab = null;
}

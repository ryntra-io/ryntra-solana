/**
 * Where the private balance's secrets live: in this browser only, encrypted. IndexedDB holds an AES-GCM key that cannot
 * be exported (the browser keeps its bytes to itself) and, beside it, each secret sealed with that key — the viewing and
 * nullifier keys of a wallet, and the seeds of links the person made. Nothing here goes to a server.
 *
 * Clearing the site's data removes it all; the person's way back is the key copy they saved (`codes.ts`). A link's
 * seed is kept until the link is taken, so its sender can take it back.
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

/* The two kinds of secret, by id. */

export const keysId = (network: string, owner: string) => `keys:${network}:${owner}`;
export const linkId = (network: string, owner: string, link: string) => `link:${network}:${owner}:${link}`;
/** Whether the key copy was saved since the keys or the links last changed. */
export const copiedId = (network: string, owner: string) => `copied:${network}:${owner}`;

export type StoredKeys = Readonly<{ viewing: number[]; nullifier: number[]; from: 'own' | 'wallet' }>;
/** `funded` — the private transfer into the link landed; until then the link is half made and is finished, not listed. */
export type StoredLink = Readonly<{ seed: number[]; lamports: string; at: number; address: string; fragment: string; funded: boolean }>;

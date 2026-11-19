/**
 * Two short texts that carry secrets the person holds, and nothing else:
 *
 * - the **key copy** — the private balance's viewing key (32 bytes) and nullifier secret (31 bytes) for one wallet on one
 *   network. It shows that wallet's private amounts and history; spending still needs the wallet's own signature. It is
 *   the only way back to the private balance on a new browser, so the person saves it as a file.
 * - the **link secret** — a one-time 32-byte seed in the link's `#fragment`, which browsers never send to a server.
 *   Whoever holds the link holds the money inside, until someone takes it.
 *
 * Both carry a 4-byte SHA-256 checksum so a cut or mistyped text is refused before anything is signed. Base64url, no
 * padding. Pure: Web Crypto's `subtle.digest` only.
 */

const KEY_PREFIX = 'rpk1';
const LINK_PREFIX = 'k=';

function toB64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function check4(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))).slice(0, 4);
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export type KeyCopy = Readonly<{ network: string; owner: string; viewing: Uint8Array; nullifier: Uint8Array }>;

/** `rpk1.<network>.<owner>.<keys+checksum>` — the network and wallet in the clear, so a wrong copy is named. */
export async function encodeKeyCopy(copy: KeyCopy): Promise<string> {
  if (copy.viewing.length !== 32 || copy.nullifier.length !== 31) throw new Error('key copy: wrong key length');
  const head = new TextEncoder().encode(`${copy.network}.${copy.owner}`);
  const keys = new Uint8Array([...copy.viewing, ...copy.nullifier]);
  const sum = await check4(new Uint8Array([...head, ...keys]));
  return `${KEY_PREFIX}.${copy.network}.${copy.owner}.${toB64url(new Uint8Array([...keys, ...sum]))}`;
}

/** Finds the copy anywhere in a text (the saved file has a title line around it); null when none is whole. */
export async function decodeKeyCopy(text: string): Promise<KeyCopy | null> {
  const match = /rpk1\.([a-z]+)\.([1-9A-HJ-NP-Za-km-z]{32,44})\.([A-Za-z0-9_-]+)/.exec(text);
  if (!match) return null;
  const [, network, owner, body] = match;
  const bytes = fromB64url(body);
  if (!bytes || bytes.length !== 67) return null;
  const keys = bytes.slice(0, 63);
  const head = new TextEncoder().encode(`${network}.${owner}`);
  if (!same(bytes.slice(63), await check4(new Uint8Array([...head, ...keys])))) return null;
  return { network, owner, viewing: keys.slice(0, 32), nullifier: keys.slice(32) };
}

/**
 * The file the person saves: a title line, the copy, and the links they made that nobody has taken yet — a link's key
 * lives nowhere else, so without it a link could not be taken back once the site's data is cleared. Plain text on the
 * person's own device: enough for the test network; before mainnet it needs a passphrase.
 */
export function keyCopyFile(code: string, title: string, links: readonly string[] = []): string {
  return `${title}\n\n${code}\n${links.length ? `\n${links.join('\n')}\n` : ''}`;
}

/** Every link secret (`k=…`) in a text, as the part after `#`; whether each is whole is `decodeLinkSecret`'s to say. */
export function linkFragmentsIn(text: string): readonly string[] {
  return [...new Set([...text.matchAll(/#(k=[A-Za-z0-9_-]{40,60})/g)].map((m) => m[1]))];
}

/** `#k=<seed+checksum>` — the part of a link after `#`. */
export async function encodeLinkSecret(seed: Uint8Array): Promise<string> {
  if (seed.length !== 32) throw new Error('link: wrong seed length');
  return `${LINK_PREFIX}${toB64url(new Uint8Array([...seed, ...(await check4(seed))]))}`;
}

/** The seed from a link's hash (with or without `#`), or null when the link is cut or changed. */
export async function decodeLinkSecret(hash: string): Promise<Uint8Array | null> {
  const text = hash.replace(/^#/, '');
  if (!text.startsWith(LINK_PREFIX)) return null;
  const bytes = fromB64url(text.slice(LINK_PREFIX.length));
  if (!bytes || bytes.length !== 36) return null;
  const seed = bytes.slice(0, 32);
  return same(bytes.slice(32), await check4(seed)) ? seed : null;
}

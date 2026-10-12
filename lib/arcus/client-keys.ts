// Client-side Arcus trading keys.
// The Ed25519 PRIVATE key is generated in the browser and stored ONLY in IndexedDB —
// it never touches Ryntra servers (non-custodial by construction). Arcus enforces that
// API keys are trade-only: withdrawals require a separate wallet signature.
//
// Hardening (2026-07-10): where the browser supports WebCrypto Ed25519 the private key is a
// NON-EXTRACTABLE CryptoKey — script (including any future XSS) can ask it to sign but can
// never read the key material out. Older browsers fall back to a raw seed via @noble/ed25519
// (the pre-hardening behavior). "Forget" now also revokes the key ON Arcus (wallet-signed,
// works even if the key itself is lost — see revokeApiKeyMessage).

import * as ed from "@noble/ed25519";

export type StoredKey = {
  /** storage schema: absent = v1 (raw seed only), 2 = credential-or-seed */
  v?: 2;
  /** lowercase 0x owner wallet */
  address: string;
  /** apiWalletName as registered on Arcus */
  name: string;
  /** 64-hex Ed25519 public key (no 0x) — this IS the Arcus apiKey */
  publicKey: string;
  /** non-extractable WebCrypto private key (preferred; survives IndexedDB structured clone) */
  credential?: CryptoKey;
  /** 64-hex raw private seed — legacy/fallback path only; never leaves this browser */
  privateKey?: string;
  /** epoch ms */
  validUntil: number;
  createdAt: number;
};

const DB_NAME = "ryntra";
const STORE = "arcusKeys";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = op(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

export function saveKey(k: StoredKey): Promise<IDBValidKey> {
  return tx("readwrite", (s) => s.put(k, k.address.toLowerCase()));
}

export async function loadKey(address: string): Promise<StoredKey | null> {
  try {
    const v = await tx<StoredKey | undefined>("readonly", (s) => s.get(address.toLowerCase()) as IDBRequest<StoredKey | undefined>);
    if (!v) return null;
    return v.validUntil > Date.now() ? v : null; // expired keys are useless — treat as absent
  } catch {
    return null;
  }
}

export function forgetKey(address: string): Promise<undefined> {
  return tx("readwrite", (s) => s.delete(address.toLowerCase()) as IDBRequest<undefined>);
}

const toHex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

export type GeneratedKey = {
  publicKey: string;
  /** exactly one of the two is set */
  credential?: CryptoKey;
  privateKey?: string;
  /** true when the private key is a non-extractable WebCrypto key (software key the browser
      refuses to export to script — NOT hardware-backed). */
  nonExtractable: boolean;
};

/**
 * Generate an Ed25519 keypair. Prefers WebCrypto with a NON-EXTRACTABLE private key
 * (key material cannot be read out by any script); falls back to @noble/ed25519 raw seed
 * where the browser doesn't support Ed25519 in SubtleCrypto.
 */
export async function generateKeypair(): Promise<GeneratedKey> {
  try {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, /* extractable */ false, ["sign"])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    if (raw.length !== 32) throw new Error("unexpected public key length");
    return { publicKey: toHex(raw), credential: pair.privateKey, nonExtractable: true };
  } catch (e) {
    // visible downgrade: the raw-seed fallback is strictly weaker than a non-extractable key
    console.warn("WebCrypto Ed25519 unavailable — falling back to raw-seed key:", e);
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    return { publicKey: toHex(pub), privateKey: toHex(priv), nonExtractable: false };
  }
}

/** Sign raw bytes with a stored key (WebCrypto credential or legacy raw seed). 128-hex output. */
export async function signWithKey(key: StoredKey, data: Uint8Array): Promise<string> {
  if (key.credential) {
    const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key.credential, data as BufferSource));
    return toHex(sig);
  }
  if (key.privateKey) return toHex(await ed.signAsync(data, key.privateKey));
  throw new Error("stored key has no signing material");
}

/** The EXACT string Arcus expects under EIP-191 personal_sign (key order, no whitespace — verified live, see ARCUS-API.md). */
export function createApiKeyMessage(name: string, publicKeyHex: string, validUntil: number): string {
  return `{"apiWalletName":"${name}","apiWalletPublicKey":"${publicKeyHex}","validUntil":${validUntil}}`;
}

/** Canonical revoke message — same shape WITHOUT validUntil (revoke applies regardless of remaining
    lifetime; works even when the key itself is lost — only the owner wallet signs). Vendor doc:
    docs.arcus.xyz/api-reference/onboarding/revoke-api-key. */
export function revokeApiKeyMessage(name: string, publicKeyHex: string): string {
  return `{"apiWalletName":"${name}","apiWalletPublicKey":"${publicKeyHex}"}`;
}

/** Split a 65-byte personal_sign signature into Arcus's {r,s,v} — v is a HEX STRING ("0x1b"/"0x1c") per their docs. */
export function splitSignature(sig: string): { r: string; s: string; v: string } {
  const h = sig.startsWith("0x") ? sig.slice(2) : sig;
  let v = parseInt(h.slice(128, 130), 16);
  if (v < 27) v += 27;
  return { r: `0x${h.slice(0, 64)}`, s: `0x${h.slice(64, 128)}`, v: `0x${v.toString(16)}` };
}

export const utf8ToHex = (s: string) => `0x${toHex(new TextEncoder().encode(s))}`;

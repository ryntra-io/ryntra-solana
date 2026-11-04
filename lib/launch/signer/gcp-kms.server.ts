/**
 * CITY-162 — the `kms` adapter: Ryntra Launch's keys in Google Cloud KMS.
 *
 * Each key is a KMS key of purpose `ASYMMETRIC_SIGN`, algorithm `EC_SIGN_ED25519` — Solana's own key type. The private
 * key never leaves KMS; the server asks KMS's REST API for each signature and checks what comes back:
 * - the public key (`GET …/cryptoKeyVersions/N/publicKey`): its algorithm, its PEM's CRC32C, and the address it makes —
 *   which must be the address the deployment names for the role, or the key signs nothing;
 * - the signature (`POST …/cryptoKeyVersions/N:asymmetricSign`, the message itself in `data` — Ed25519 signs the data,
 *   not a digest): the key version that answered, KMS's word that it received the data intact (`verifiedDataCrc32c`),
 *   the signature's own CRC32C and its length. The signer above verifies it against the address again.
 *
 * Credentials: no long-lived secret. On Vercel the deployment proves who it is with its own OIDC token (Production
 * only, by the provider's condition), Google's STS exchanges it, and the service account — whose only right is to sign
 * with these keys — is impersonated for a quarter of an hour. On a local devnet pass a short-lived token from
 * `gcloud auth print-access-token` stands in (`RYNTRA_LAUNCH_KMS_ACCESS_TOKEN`). Nothing here prints a token.
 */

import { readFile } from "node:fs/promises";
import { createPublicKey } from "node:crypto";

import { getBase58Decoder } from "@solana/kit";

import type { KeySigner } from "./signer.server.ts";

export type Fetch = typeof fetch;
export type TokenSource = () => Promise<string>;

export const KMS_ENDPOINT = "https://cloudkms.googleapis.com";
const STS_URL = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts";
const KMS_SCOPE = "https://www.googleapis.com/auth/cloudkms";
const PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
/** How long one answer of Google's may take; past it the signature is not made this time. */
const REQUEST_MS = 10_000;
/** A token is renewed this long before it ends. */
const RENEW_MS = 60_000;

/** A key version's full resource name, as KMS names it. */
export const KMS_KEY_VERSION = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,9}$/;
/** A workload identity pool provider, as IAM names it. */
export const WIF_PROVIDER = /^projects\/[0-9]{1,20}\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,32}\/providers\/[a-z0-9-]{4,32}$/;
/** A service account's address. */
export const SERVICE_ACCOUNT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;

/* ------------------------------------------------------------------ CRC32C (Castagnoli), as KMS checks it */

const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32C_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** An int64 of a JSON answer — a string in proto3's mapping, a number from a lenient emulator. */
const int64 = (value: unknown): number | null => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : typeof value === "number" && Number.isInteger(value) ? value : null);

/* ------------------------------------------------------------------ the endpoint */

/**
 * KMS's endpoint: Google's own, or — for an emulator or a test on this machine — a loopback address. Any other host is
 * refused: a token must never be handed to a server that is not Google's.
 */
export function kmsEndpoint(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text) return KMS_ENDPOINT;
  try {
    const url = new URL(text);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    if (!loopback || (url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/" || url.search || url.username) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ requests */

class KmsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmsError";
  }
}

async function call(fetcher: Fetch, url: string, init: RequestInit, what: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_MS) });
  } catch (error) {
    throw new KmsError(`${what}: no answer (${error instanceof Error ? error.name : "error"})`);
  }
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* Not JSON: said by its status alone. */
  }
  if (!response.ok) {
    /* Google's own status word (PERMISSION_DENIED, NOT_FOUND, FAILED_PRECONDITION…) — never the body, never a token. */
    const status = (json as { error?: { status?: unknown } } | null)?.error?.status;
    throw new KmsError(`${what}: ${response.status}${typeof status === "string" && /^[A-Z_]{1,40}$/.test(status) ? ` ${status}` : ""}`);
  }
  if (!json || typeof json !== "object") throw new KmsError(`${what}: an answer that is not JSON`);
  return json as Record<string, unknown>;
}

/** The Solana address of an ed25519 public key in a PEM (SPKI), or null for any other key. */
export function addressOfPem(pem: string): string | null {
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") return null;
    return getBase58Decoder().decode(Buffer.from(key.export({ format: "der", type: "spki" })).subarray(-32));
  } catch {
    return null;
  }
}

export type KmsAccess = Readonly<{ keyVersion: string; endpoint?: string; token: TokenSource; fetch?: Fetch }>;

/** The address of a KMS key version, read from KMS and checked: an `EC_SIGN_ED25519` key, its PEM intact. */
export async function kmsPublicAddress(access: KmsAccess): Promise<string> {
  if (!KMS_KEY_VERSION.test(access.keyVersion)) throw new KmsError("not a KMS key version's name");
  const fetcher = access.fetch ?? fetch;
  const answer = await call(fetcher, `${access.endpoint ?? KMS_ENDPOINT}/v1/${access.keyVersion}/publicKey`, { headers: { authorization: `Bearer ${await access.token()}` } }, "KMS public key");
  if (answer.name !== undefined && answer.name !== access.keyVersion) throw new KmsError("KMS public key: another key version answered");
  if (answer.algorithm !== "EC_SIGN_ED25519") throw new KmsError(`KMS public key: algorithm ${typeof answer.algorithm === "string" ? answer.algorithm : "unknown"}, not EC_SIGN_ED25519`);
  const pem = answer.pem;
  if (typeof pem !== "string") throw new KmsError("KMS public key: no PEM");
  const expected = int64(answer.pemCrc32c);
  if (expected === null || expected !== crc32c(Buffer.from(pem, "utf8"))) throw new KmsError("KMS public key: the PEM did not arrive intact");
  const address = addressOfPem(pem);
  if (!address) throw new KmsError("KMS public key: not an ed25519 key");
  return address;
}

/* Each key version's address as read from KMS: once per process; a failed read is asked again next time. */
const ADDRESSES = new Map<string, Promise<string>>();

/**
 * The adapter: a KMS key version that signs only while its address — read from KMS — is `address`, the one the
 * deployment names for the role.
 */
export function kmsKeySigner(access: KmsAccess & Readonly<{ address: string }>): KeySigner {
  const fetcher = access.fetch ?? fetch;
  const endpoint = access.endpoint ?? KMS_ENDPOINT;
  const cacheKey = `${endpoint}|${access.keyVersion}`;
  const verified = async () => {
    let read = ADDRESSES.get(cacheKey);
    if (!read) {
      read = kmsPublicAddress({ ...access, endpoint, fetch: fetcher });
      ADDRESSES.set(cacheKey, read);
      read.catch(() => ADDRESSES.delete(cacheKey));
    }
    const address = await read;
    if (address !== access.address) throw new KmsError(`the KMS key version is ${address}, not ${access.address} the deployment names`);
  };
  return {
    mode: "kms",
    keyRef: access.keyVersion,
    async sign(message) {
      await verified();
      const data = Buffer.from(message);
      const answer = await call(
        fetcher,
        `${endpoint}/v1/${access.keyVersion}:asymmetricSign`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${await access.token()}`, "content-type": "application/json" },
          body: JSON.stringify({ data: data.toString("base64"), dataCrc32c: String(crc32c(data)) }),
        },
        "KMS signature",
      );
      if (answer.name !== access.keyVersion) throw new KmsError("KMS signature: another key version answered");
      if (answer.verifiedDataCrc32c !== true) throw new KmsError("KMS signature: KMS did not confirm the message arrived intact");
      if (typeof answer.signature !== "string") throw new KmsError("KMS signature: no signature");
      const signature = Buffer.from(answer.signature, "base64");
      if (int64(answer.signatureCrc32c) !== crc32c(signature)) throw new KmsError("KMS signature: the signature did not arrive intact");
      if (signature.length !== 64) throw new KmsError("KMS signature: not an ed25519 signature");
      return Uint8Array.from(signature);
    },
  };
}

/** Forget the addresses read from KMS — a test's fresh start. */
export function forgetKmsAddresses(): void {
  ADDRESSES.clear();
}

/* ------------------------------------------------------------------ credentials */

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The deployment's own OIDC token on Vercel, where Vercel puts it: the request's `x-vercel-oidc-token` header, then the
 * file `VERCEL_OIDC_TOKEN_FILE` names, then `VERCEL_OIDC_TOKEN` — the order of Vercel's own `getVercelOidcToken()`.
 */
export async function vercelOidcToken(env: Env): Promise<string | null> {
  const context = (globalThis as Record<symbol, { get?: () => { headers?: Record<string, unknown> } | undefined } | undefined>)[Symbol.for("@vercel/request-context")]?.get?.();
  const header = context?.headers?.["x-vercel-oidc-token"];
  if (typeof header === "string" && header.trim()) return header.trim();
  if (env.VERCEL_OIDC_TOKEN_FILE) {
    const text = (await readFile(env.VERCEL_OIDC_TOKEN_FILE, "utf8")).trim();
    if (!text) throw new KmsError("the OIDC token file is empty");
    return text;
  }
  return env.VERCEL_OIDC_TOKEN?.trim() || null;
}

/* Google access tokens of the federated identity, by provider and service account: kept until a minute before they end. */
const TOKENS = new Map<string, Readonly<{ token: string; until: number }>>();
const PENDING = new Map<string, Promise<string>>();

/** Forget the tokens kept — a test's fresh start. */
export function forgetKmsTokens(): void {
  TOKENS.clear();
  PENDING.clear();
}

/**
 * Where a KMS request's token comes from, or null when none is configured (and then the `kms` adapter is not here):
 * - `RYNTRA_LAUNCH_KMS_ACCESS_TOKEN` — a short-lived token handed in (a local devnet pass, `gcloud auth print-access-token`);
 * - `RYNTRA_LAUNCH_KMS_WIF_PROVIDER` and `RYNTRA_LAUNCH_KMS_SERVICE_ACCOUNT` — Vercel's OIDC token exchanged at Google's
 *   STS for the workload identity provider, then the service account impersonated with the KMS scope only.
 */
export function kmsTokenSource(env: Env, options: Readonly<{ fetch?: Fetch; now?: () => number; oidcToken?: () => Promise<string | null> }> = {}): TokenSource | null {
  const handed = env.RYNTRA_LAUNCH_KMS_ACCESS_TOKEN?.trim();
  if (handed) return async () => handed;
  const provider = env.RYNTRA_LAUNCH_KMS_WIF_PROVIDER?.trim();
  const account = env.RYNTRA_LAUNCH_KMS_SERVICE_ACCOUNT?.trim();
  if (!provider || !account || !WIF_PROVIDER.test(provider) || !SERVICE_ACCOUNT.test(account)) return null;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const oidc = options.oidcToken ?? (() => vercelOidcToken(env));
  const key = `${provider}|${account}`;
  const fresh = async (): Promise<string> => {
    const subject = await oidc();
    if (!subject) throw new KmsError("no OIDC token of the deployment here");
    const federated = await call(
      fetcher,
      STS_URL,
      {
        /* OAuth 2.0 token exchange (RFC 8693), form-encoded — as Google's own example and client send it. */
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          audience: `//iam.googleapis.com/${provider}`,
          scope: PLATFORM_SCOPE,
          requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
          subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
          subject_token: subject,
        }).toString(),
      },
      "Google STS",
    );
    if (typeof federated.access_token !== "string") throw new KmsError("Google STS: no token");
    const impersonated = await call(
      fetcher,
      `${IAM_CREDENTIALS}/${encodeURIComponent(account)}:generateAccessToken`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${federated.access_token}`, "content-type": "application/json" },
        body: JSON.stringify({ scope: [KMS_SCOPE], lifetime: "900s" }),
      },
      "Google IAM",
    );
    const token = impersonated.accessToken;
    const until = typeof impersonated.expireTime === "string" ? Date.parse(impersonated.expireTime) : Number.NaN;
    if (typeof token !== "string" || !Number.isFinite(until)) throw new KmsError("Google IAM: no token");
    TOKENS.set(key, { token, until });
    return token;
  };
  return async () => {
    const kept = TOKENS.get(key);
    if (kept && kept.until - RENEW_MS > now()) return kept.token;
    let pending = PENDING.get(key);
    if (!pending) {
      pending = fresh().finally(() => PENDING.delete(key));
      PENDING.set(key, pending);
    }
    return pending;
  };
}

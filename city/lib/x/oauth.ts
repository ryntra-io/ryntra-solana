import { createHmac, randomBytes } from 'node:crypto';

/**
 * OAuth 1.0a user context (HMAC-SHA1) for the one Ryntra account on X. It is the key pair that does not expire, so
 * a cron can post without a refresh token to rotate and store. The signature covers the method, the URL without its
 * query, the query and the `oauth_*` fields; a JSON or multipart body is never part of it.
 */

export type XKeys = Readonly<{
  /** The app's API key and secret (Developer Console → the app → Keys and tokens → Consumer keys). */
  apiKey: string;
  apiSecret: string;
  /** The Ryntra account's access token and secret, with Read and write. */
  accessToken: string;
  accessSecret: string;
}>;

/** RFC 3986 encoding, as OAuth asks: `encodeURIComponent` leaves `!'()*` alone. */
export const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export type SignInput = {
  method: string;
  url: string;
  keys: XKeys;
  /** Form fields of an `application/x-www-form-urlencoded` body; never a JSON or multipart one. */
  form?: Record<string, string>;
  /** Fixed in tests; fresh on every request otherwise. */
  nonce?: string;
  timestamp?: number;
};

export function signature(input: SignInput & { nonce: string; timestamp: number }): { params: Record<string, string>; signature: string } {
  const u = new URL(input.url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: input.keys.apiKey,
    oauth_nonce: input.nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(input.timestamp),
    oauth_token: input.keys.accessToken,
    oauth_version: '1.0',
  };
  const pairs: [string, string][] = [...u.searchParams.entries(), ...Object.entries(input.form ?? {}), ...Object.entries(oauth)].map(([k, v]) => [pct(k), pct(v)]);
  pairs.sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
  const base = [input.method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(pairs.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const key = `${pct(input.keys.apiSecret)}&${pct(input.keys.accessSecret)}`;
  return { params: oauth, signature: createHmac('sha1', key).update(base).digest('base64') };
}

/** The `Authorization` header of one request. */
export function authorization(input: SignInput): string {
  const nonce = input.nonce ?? randomBytes(16).toString('hex');
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const { params, signature: sig } = signature({ ...input, nonce, timestamp });
  const fields = { ...params, oauth_signature: sig };
  return `OAuth ${Object.keys(fields).sort().map((k) => `${pct(k)}="${pct(fields[k as keyof typeof fields])}"`).join(', ')}`;
}

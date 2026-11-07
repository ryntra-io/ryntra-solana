/**
 * The words the city and the Ryntra app say to each other (`docs/city/APP-BRIDGE.md`, CITY-6b / CITY-6c). Both sides
 * read every message through a parser here and drop what they do not know: a message that is not one of these, a field
 * of the wrong shape, an unknown `type` or `code`. Only the fields named below are kept; anything else in a message is
 * left behind, never passed on.
 *
 * Nothing here can move value. The page asks, the app opens its wallet, the person signs there; the engine checks the
 * signed bytes against what it built.
 */

export const BRIDGE_VERSION = 1;
/** How long the page waits for an answer: the wallet's own window may stay open this long. */
export const REQUEST_TIMEOUT_MS = 120_000;
export const MAX_ID_LENGTH = 64;
export const MAX_TRANSACTIONS = 4;
/** The largest file `share.file` carries, in bytes before base64. */
export const MAX_SHARE_BYTES = 8 * 1024 * 1024;
export const SHARE_MIMES = ['video/mp4', 'video/webm', 'image/png'] as const;
/** The words beside a shared file, at most: the app's share sheet takes no more. */
export const MAX_SHARE_TEXT = 500;
/** A shared file's name: ASCII letters, digits, `._-` and spaces, up to 80, never a path — as the app reads it. */
const SHARE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9 ._-]{0,79}$/;
/**
 * The page's hello (no `id`, no answer): its bridge is listening now. The app answers it with `app.ready` — the one
 * it sent when the page finished loading may have come before the page's code was there to hear it.
 */
export const PAGE_READY = 'page.ready';
export const ERROR_CODES = ['declined', 'failed', 'busy', 'unsupported', 'invalid'] as const;
export const REQUEST_TYPES = ['wallet.connect', 'wallet.disconnect', 'wallet.signMessage', 'wallet.signTransactions', 'share.file', 'open.external'] as const;
/** The requests that open the wallet: one at a time. */
export const WALLET_REQUESTS: ReadonlySet<RequestType> = new Set(['wallet.connect', 'wallet.disconnect', 'wallet.signMessage', 'wallet.signTransactions']);

export type ShareMime = (typeof SHARE_MIMES)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];
export type RequestType = (typeof REQUEST_TYPES)[number];

export type AppWallet = Readonly<{ address: string; name: string }>;

export type AppEvent =
  | Readonly<{ kind: 'event'; type: 'app.ready'; version: string; platform: 'android'; wallet: AppWallet | null }>
  | Readonly<{ kind: 'event'; type: 'wallet.changed'; wallet: AppWallet | null }>;

export type AppResponse =
  | Readonly<{ kind: 'response'; id: string; ok: true; result: unknown }>
  | Readonly<{ kind: 'response'; id: string; ok: false; error: Readonly<{ code: ErrorCode; message: string }> }>;

export type AppMessage = AppEvent | AppResponse;

/** What each request carries, without `v` and `id`. */
export type RequestFields = {
  'wallet.connect': Readonly<Record<string, never>>;
  'wallet.disconnect': Readonly<Record<string, never>>;
  'wallet.signMessage': Readonly<{ message: string }>;
  'wallet.signTransactions': Readonly<{ transactions: readonly string[] }>;
  'share.file': Readonly<{ name: string; mime: ShareMime; data: string; text?: string }>;
  'open.external': Readonly<{ url: string }>;
};

/** What each answer carries in `result`. */
export type ResultOf = {
  'wallet.connect': AppWallet;
  'wallet.disconnect': Readonly<Record<string, never>>;
  'wallet.signMessage': Readonly<{ signature: string; signedMessage: string }>;
  'wallet.signTransactions': Readonly<{ signed: readonly string[] }>;
  'share.file': Readonly<{ shared: boolean }>;
  'open.external': Readonly<Record<string, never>>;
};

export type PageRequest = { [T in RequestType]: Readonly<{ v: 1; id: string; type: T } & RequestFields[T]> }[RequestType];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown, max = 4096): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/** The base64 length of the largest share file. */
const MAX_SHARE_BASE64 = Math.ceil(MAX_SHARE_BYTES / 3) * 4;
/** One transaction at most, as the app reads it: a v1 transaction's 4096 bytes; legacy and v0 stop at 1232. */
const MAX_TRANSACTION_BASE64 = Math.ceil(4096 / 3) * 4;
/** A sign-in message is a few hundred bytes; this leaves room and no more. */
const MAX_MESSAGE_BASE64 = 8192;

export function isAddress(value: unknown): value is string {
  return typeof value === 'string' && BASE58_ADDRESS.test(value);
}

export function isBase64(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && BASE64.test(value);
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

/** Only `https://` with a host; never `javascript:`, `intent:`, `file:` or a bare path. */
export function isExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isShareName(value: unknown): value is string {
  return typeof value === 'string' && SHARE_NAME.test(value) && !value.includes('..');
}

/**
 * A file's name as the bridge carries it: a coin's symbol may be Cyrillic, an emoji or `$`, which the app's share sheet
 * does not take, so each run of anything else becomes one dash; the extension stays. Never empty, never a path.
 */
export function shareNameOf(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && /^\.[A-Za-z0-9]{1,5}$/.test(name.slice(dot)) ? name.slice(dot).toLowerCase() : '';
  const stem = (ext ? name.slice(0, dot) : name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 80 - ext.length)
    .replace(/[-_]+$/g, '');
  const safe = `${stem || 'ryntra'}${ext}`;
  return isShareName(safe) ? safe : 'ryntra';
}

/** The page's hello as the wire carries it. */
export function encodePageReady(): string {
  return JSON.stringify({ v: BRIDGE_VERSION, type: PAGE_READY });
}

/** The app (and the fake app) reads the page's hello: a version-1 message of that type with no `id`. */
export function isPageReady(data: unknown): boolean {
  const m = decode(data);
  return m !== null && m.type === PAGE_READY && !('id' in m);
}

function walletOf(value: unknown): AppWallet | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || !isAddress(value.address) || !isString(value.name, 64)) return undefined;
  return { address: value.address, name: value.name };
}

function decode(data: unknown): Json | null {
  // The bridge speaks JSON strings and nothing else.
  if (typeof data !== 'string' || data.length > MAX_SHARE_BASE64 + 4096) return null;
  try {
    const value: unknown = JSON.parse(data);
    return isObject(value) && value.v === BRIDGE_VERSION ? value : null;
  } catch {
    return null;
  }
}

/** The page reads what the app says: one of its two events, or an answer to a request. Anything else is null. */
export function parseAppMessage(data: unknown): AppMessage | null {
  const m = decode(data);
  if (!m) return null;
  if ('id' in m) {
    if (!isId(m.id)) return null;
    if (m.ok === true) return 'result' in m ? { kind: 'response', id: m.id, ok: true, result: m.result } : null;
    if (m.ok !== false || !isObject(m.error)) return null;
    const { code, message } = m.error;
    if (!(ERROR_CODES as readonly unknown[]).includes(code)) return null;
    return { kind: 'response', id: m.id, ok: false, error: { code: code as ErrorCode, message: typeof message === 'string' ? message.slice(0, 500) : '' } };
  }
  if (m.type === 'app.ready') {
    const wallet = walletOf(m.wallet);
    if (!isString(m.version, 64) || m.platform !== 'android' || wallet === undefined) return null;
    return { kind: 'event', type: 'app.ready', version: m.version, platform: 'android', wallet };
  }
  if (m.type === 'wallet.changed') {
    const wallet = walletOf(m.wallet);
    return wallet === undefined ? null : { kind: 'event', type: 'wallet.changed', wallet };
  }
  return null;
}

/** The `result` of an answer, read for the request it answers; null when it is not what that request returns. */
export function parseResult<T extends RequestType>(type: T, result: unknown, asked?: RequestFields[T]): ResultOf[T] | null {
  return readResult(type, result, asked) as ResultOf[T] | null;
}

function readResult(type: RequestType, result: unknown, asked: unknown): unknown {
  if (!isObject(result)) return null;
  switch (type) {
    case 'wallet.connect': {
      const wallet = walletOf(result);
      return wallet ?? null;
    }
    case 'wallet.signMessage':
      return isBase64(result.signature, 128) && isBase64(result.signedMessage, MAX_MESSAGE_BASE64 + 128)
        ? { signature: result.signature, signedMessage: result.signedMessage }
        : null;
    case 'wallet.signTransactions': {
      const signed = result.signed;
      const wanted = (asked as RequestFields['wallet.signTransactions'] | undefined)?.transactions.length;
      if (!Array.isArray(signed) || signed.length === 0 || signed.length > MAX_TRANSACTIONS) return null;
      // As many as were given, in the same order: fewer is nothing usable.
      if (wanted !== undefined && signed.length !== wanted) return null;
      if (!signed.every((wire) => isBase64(wire, MAX_TRANSACTION_BASE64))) return null;
      return { signed: [...signed] };
    }
    case 'share.file':
      return typeof result.shared === 'boolean' ? { shared: result.shared } : null;
    case 'wallet.disconnect':
    case 'open.external':
      return {};
    default:
      return null;
  }
}

/** The fields of a request, checked for its type; null when they are not what the contract says. */
export function parseFields<T extends RequestType>(type: T, m: Json): RequestFields[T] | null {
  return readFields(type, m) as RequestFields[T] | null;
}

function readFields(type: RequestType, m: Json): unknown {
  switch (type) {
    case 'wallet.connect':
    case 'wallet.disconnect':
      return {};
    case 'wallet.signMessage':
      return isBase64(m.message, MAX_MESSAGE_BASE64) ? { message: m.message } : null;
    case 'wallet.signTransactions': {
      const list = m.transactions;
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TRANSACTIONS) return null;
      if (!list.every((wire) => isBase64(wire, MAX_TRANSACTION_BASE64))) return null;
      return { transactions: [...list] };
    }
    case 'share.file': {
      if (!isShareName(m.name)) return null;
      if (!(SHARE_MIMES as readonly unknown[]).includes(m.mime) || !isBase64(m.data, MAX_SHARE_BASE64)) return null;
      if (m.text !== undefined && !(typeof m.text === 'string' && m.text.length <= MAX_SHARE_TEXT)) return null;
      return { name: m.name, mime: m.mime as ShareMime, data: m.data, ...(typeof m.text === 'string' ? { text: m.text } : {}) };
    }
    case 'open.external':
      return isExternalUrl(m.url) ? { url: m.url } : null;
    default:
      return null;
  }
}

/**
 * The app reads what the page asks (CITY-6c, and the fake app of the tests and the stand). The answer to null is
 * `invalid` when the message still carried an id, nothing otherwise.
 */
export function parsePageRequest(data: unknown): PageRequest | null {
  const m = decode(data);
  if (!m || !isId(m.id) || !(REQUEST_TYPES as readonly unknown[]).includes(m.type)) return null;
  const type = m.type as RequestType;
  const fields = parseFields(type, m);
  return fields ? ({ v: BRIDGE_VERSION, id: m.id, type, ...fields } as PageRequest) : null;
}

/** The id of a message that failed the parser, so the app can still answer `invalid`. */
export function requestIdOf(data: unknown): string | null {
  const m = decode(data);
  return m && isId(m.id) ? m.id : null;
}

export function encodeRequest<T extends RequestType>(id: string, type: T, fields: RequestFields[T]): string {
  return JSON.stringify({ ...fields, v: BRIDGE_VERSION, id, type });
}

/** An event or an answer of the app, as the wire carries it: the parser's `kind` stays behind. */
export function encodeAppMessage(message: AppMessage): string {
  const wire: Record<string, unknown> = { ...message, v: BRIDGE_VERSION };
  delete wire.kind;
  return JSON.stringify(wire);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

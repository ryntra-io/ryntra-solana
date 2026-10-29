/**
 * The city's bridge (CITY-6c, `docs/city/APP-BRIDGE.md`): the page `https://ryntra.io` in the City tab's WebView and
 * the app speak only these messages, JSON on both sides. The page asks; the app answers each request by its `id` and
 * tells the page two things of its own — that it is the app (`app.ready`) and which wallet it holds (`wallet.changed`).
 *
 * The page signs nothing itself: its wallet on the phone is the app's (Mobile Wallet Adapter), and every signature
 * opens the wallet's own window. No message moves funds without the person's signature in their wallet.
 *
 * Both sides read with the parsers below and drop anything else: the app answers a request it cannot read with
 * `invalid`, one it does not know with `unsupported`, and says nothing to a message without an `id` it could answer.
 */

import { base64Bytes } from '../launch/picture-bytes.ts'

export const BRIDGE_VERSION = 1

/** What the user agent carries, so the page knows it runs inside the app: `RyntraApp/<version>`. */
export const USER_AGENT_MARK = 'RyntraApp'

export const userAgentNameOf = (version: string): string => `${USER_AGENT_MARK}/${version}`

/** The wallet the app holds, as the page sees it. */
export type BridgeWallet = Readonly<{ address: string; name: string }>

export type ShareMime = 'video/mp4' | 'video/webm' | 'image/png'
export const SHARE_MIMES: readonly ShareMime[] = ['video/mp4', 'video/webm', 'image/png']

/** The file `share.file` hands to the system's share sheet. */
export type ShareFile = Readonly<{ name: string; mime: ShareMime; data: string; text: string | null }>

export type PageRequest =
  | Readonly<{ v: typeof BRIDGE_VERSION; id: string; type: 'wallet.connect' }>
  | Readonly<{ v: typeof BRIDGE_VERSION; id: string; type: 'wallet.disconnect' }>
  | Readonly<{ v: typeof BRIDGE_VERSION; id: string; type: 'wallet.signMessage'; message: string }>
  | Readonly<{ v: typeof BRIDGE_VERSION; id: string; type: 'wallet.signTransactions'; transactions: readonly string[] }>
  | Readonly<{ v: typeof BRIDGE_VERSION; id: string; type: 'share.file'; file: ShareFile }>
  | Readonly<{ v: typeof BRIDGE_VERSION; id: string; type: 'open.external'; url: string }>

export type RequestType = PageRequest['type']

export const REQUEST_TYPES: readonly RequestType[] = [
  'wallet.connect',
  'wallet.disconnect',
  'wallet.signMessage',
  'wallet.signTransactions',
  'share.file',
  'open.external',
]

/** The five refusals of the contract; `declined` is the person's answer, not a fault. */
export type ErrorCode = 'declined' | 'failed' | 'busy' | 'unsupported' | 'invalid'
export const ERROR_CODES: readonly ErrorCode[] = ['declined', 'failed', 'busy', 'unsupported', 'invalid']

export type AppEvent =
  | Readonly<{
      v: typeof BRIDGE_VERSION
      type: 'app.ready'
      version: string
      platform: 'android'
      wallet: BridgeWallet | null
    }>
  | Readonly<{ v: typeof BRIDGE_VERSION; type: 'wallet.changed'; wallet: BridgeWallet | null }>

export type AppResponse =
  | Readonly<{ v: typeof BRIDGE_VERSION; id: string; ok: true; result: Readonly<Record<string, unknown>> }>
  | Readonly<{
      v: typeof BRIDGE_VERSION
      id: string
      ok: false
      error: Readonly<{ code: ErrorCode; message: string }>
    }>

export type AppMessage = AppEvent | AppResponse

/** The most transactions one `wallet.signTransactions` carries. */
export const MAX_TRANSACTIONS = 4
/** One transaction's bytes at most: a v1 transaction's limit; the legacy and v0 ones are far smaller (1232). */
export const MAX_TRANSACTION_BYTES = 4096
/** The bytes of a message to sign at most: a sign-in's text is a few hundred. */
export const MAX_MESSAGE_BYTES = 16 * 1024
/** The bytes of a shared file at most. */
export const MAX_SHARE_BYTES = 8 * 1024 * 1024
const MAX_ID = 64
const MAX_URL = 2048
const MAX_SHARE_TEXT = 500
const MAX_ERROR_TEXT = 200
/** What a JSON text from the page may weigh at most: the largest file in base64 and room for its fields. */
export const MAX_RAW = Math.ceil(MAX_SHARE_BYTES / 3) * 4 + 4096

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
/** A file's name the share sheet shows: letters, digits, dots, dashes, underscores and spaces; never a path. */
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9 ._-]{0,79}$/
/**
 * An address `open.external` opens: `https://`, a host of letters, digits, dots and dashes (no `user@`), an optional
 * port, then anything without whitespace.
 */
const HTTPS_URL = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::\d{1,5})?(?:[/?#]\S*)?$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A base64 alphabet character: A–Z, a–z, 0–9, `+`, `/`. */
const inAlphabet = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47

/**
 * Standard padded base64, checked in one pass — a regular expression over a file of megabytes would run out of stack
 * in some engines.
 */
function isPaddedBase64(text: string): boolean {
  if (text.length % 4 !== 0) return false
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const body = text.length - padding
  for (let i = 0; i < body; i += 1) if (!inAlphabet(text.charCodeAt(i))) return false
  return true
}

/** Exact base64 of at least one and at most `max` bytes. */
function base64Of(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(max / 3) * 4) return null
  if (!isPaddedBase64(value)) return null
  const bytes = base64Bytes(value)
  return bytes > 0 && bytes <= max ? value : null
}

/** Whether `open.external` may open this address: only `https://`, nothing else. */
export function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_URL && HTTPS_URL.test(value)
}

const idOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID ? value : null

/** JSON text as a record of this bridge's version, else null — never a throw. */
function envelope(raw: unknown, max: number): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > max) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  return isRecord(value) && value.v === BRIDGE_VERSION ? value : null
}

/** The file of a `share.file`, or null when any part of it is not as the contract says. */
function shareFileOf(message: Record<string, unknown>): ShareFile | null {
  const { name, mime, data, text } = message
  if (typeof name !== 'string' || !FILE_NAME.test(name) || name.includes('..')) return null
  if (typeof mime !== 'string' || !(SHARE_MIMES as readonly string[]).includes(mime)) return null
  const bytes = base64Of(data, MAX_SHARE_BYTES)
  if (bytes === null) return null
  if (text !== undefined && text !== null && (typeof text !== 'string' || text.length > MAX_SHARE_TEXT)) return null
  return { name, mime: mime as ShareMime, data: bytes, text: typeof text === 'string' && text.length > 0 ? text : null }
}

/** The request's own fields read, or null when they are not as the contract says. */
function requestOf(id: string, type: RequestType, message: Record<string, unknown>): PageRequest | null {
  switch (type) {
    case 'wallet.connect':
    case 'wallet.disconnect':
      return { v: BRIDGE_VERSION, id, type }
    case 'wallet.signMessage': {
      const bytes = base64Of(message.message, MAX_MESSAGE_BYTES)
      return bytes === null ? null : { v: BRIDGE_VERSION, id, type, message: bytes }
    }
    case 'wallet.signTransactions': {
      const { transactions } = message
      if (!Array.isArray(transactions) || transactions.length === 0 || transactions.length > MAX_TRANSACTIONS)
        return null
      const read = transactions.map((entry) => base64Of(entry, MAX_TRANSACTION_BYTES))
      if (read.some((entry) => entry === null)) return null
      return { v: BRIDGE_VERSION, id, type, transactions: read as string[] }
    }
    case 'share.file': {
      const file = shareFileOf(message)
      return file === null ? null : { v: BRIDGE_VERSION, id, type, file }
    }
    case 'open.external':
      return isHttpsUrl(message.url) ? { v: BRIDGE_VERSION, id, type, url: message.url } : null
  }
}

/**
 * The page's hello (`docs/city/APP-BRIDGE.md`): its bridge listens now. It has no `id` and gets no answer of its own —
 * the app says `app.ready` to it, since the one said when the page finished loading may have come before the page's
 * code was there to hear it.
 */
export const PAGE_READY = 'page.ready'

/** What the app makes of one message from the page. */
export type PageRead =
  | Readonly<{ kind: 'hello' }>
  | Readonly<{ kind: 'request'; request: PageRequest }>
  /** A message with an `id` the app answers with a refusal: unreadable fields, or a request it does not know. */
  | Readonly<{ kind: 'refuse'; id: string; code: 'invalid' | 'unsupported' }>

/**
 * What the page said, read by the app: its hello, a request, a refusal to send back, or null — a message the app
 * cannot even answer (not JSON, another version, no `id`), which it drops.
 */
export function parsePageMessage(raw: unknown): PageRead | null {
  const message = envelope(raw, MAX_RAW)
  if (!message) return null
  if (message.type === PAGE_READY && !('id' in message)) return { kind: 'hello' }
  const id = idOf(message.id)
  if (id === null) return null
  if (typeof message.type !== 'string') return { kind: 'refuse', id, code: 'invalid' }
  if (!(REQUEST_TYPES as readonly string[]).includes(message.type)) return { kind: 'refuse', id, code: 'unsupported' }
  const request = requestOf(id, message.type as RequestType, message)
  return request ? { kind: 'request', request } : { kind: 'refuse', id, code: 'invalid' }
}

const walletOf = (value: unknown): BridgeWallet | null | undefined => {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const { address, name } = value
  if (typeof address !== 'string' || !ADDRESS.test(address)) return undefined
  if (typeof name !== 'string' || name.length === 0 || name.length > 120) return undefined
  return { address, name }
}

/**
 * What the app said, read as the page reads it: an event or a response, or null for anything else. The page's own
 * reader lives with the page (CITY-6b); this one holds the app to the same contract in its tests.
 */
export function parseAppMessage(raw: unknown): AppMessage | null {
  const message = envelope(raw, MAX_RAW)
  if (!message) return null
  if (message.type === 'app.ready') {
    const wallet = walletOf(message.wallet)
    if (wallet === undefined || typeof message.version !== 'string' || message.version.length === 0) return null
    if (message.platform !== 'android') return null
    return { v: BRIDGE_VERSION, type: 'app.ready', version: message.version, platform: 'android', wallet }
  }
  if (message.type === 'wallet.changed') {
    const wallet = walletOf(message.wallet)
    return wallet === undefined ? null : { v: BRIDGE_VERSION, type: 'wallet.changed', wallet }
  }
  const id = idOf(message.id)
  if (id === null) return null
  if (message.ok === true && isRecord(message.result))
    return { v: BRIDGE_VERSION, id, ok: true, result: message.result }
  if (message.ok === false && isRecord(message.error)) {
    const { code, message: text } = message.error
    if (typeof code !== 'string' || !(ERROR_CODES as readonly string[]).includes(code)) return null
    return {
      v: BRIDGE_VERSION,
      id,
      ok: false,
      error: { code: code as ErrorCode, message: typeof text === 'string' ? text : '' },
    }
  }
  return null
}

export const readyEvent = (version: string, wallet: BridgeWallet | null): AppEvent => ({
  v: BRIDGE_VERSION,
  type: 'app.ready',
  version,
  platform: 'android',
  wallet,
})

export const walletChangedEvent = (wallet: BridgeWallet | null): AppEvent => ({
  v: BRIDGE_VERSION,
  type: 'wallet.changed',
  wallet,
})

export const okResponse = (id: string, result: Readonly<Record<string, unknown>>): AppResponse => ({
  v: BRIDGE_VERSION,
  id,
  ok: true,
  result,
})

export const errorResponse = (id: string, code: ErrorCode, message: string): AppResponse => ({
  v: BRIDGE_VERSION,
  id,
  ok: false,
  error: { code, message: message.slice(0, MAX_ERROR_TEXT) },
})

const EXTENSION: Readonly<Record<ShareMime, string>> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'image/png': '.png',
}

/** The file's name as it is written for the share sheet: the page's name, with the extension its type says. */
export function shareFileName(file: Pick<ShareFile, 'name' | 'mime'>): string {
  const extension = EXTENSION[file.mime]
  return file.name.toLowerCase().endsWith(extension) ? file.name : `${file.name}${extension}`
}

/** A message as the text `webview.postMessage` carries. */
export const serialize = (message: AppMessage): string => JSON.stringify(message)

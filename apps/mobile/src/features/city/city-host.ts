/**
 * The app's half of the city's bridge (CITY-6c): it reads what the page asks, does it with the app's own wallet, the
 * system's share sheet and browser, and answers by the request's `id`. Pure — the wallet, the sheet, the browser, the
 * WebView and the clock are handed in, so the same host runs under the app and under a test with doubles.
 *
 * - One wallet request at a time: a second one while the wallet is out is answered `busy`, never queued.
 * - Every signature opens the wallet's own window (Mobile Wallet Adapter); nothing is signed without it, and nothing
 *   is signed for an account other than the one the app holds — the wallet hook refuses that itself.
 * - A wallet that does not answer within `WALLET_WAIT_MS` is answered `failed`, a little before the page's own 120 s,
 *   and its late answer is dropped.
 * - The page is there once it finished loading or said its hello (`page.ready`): either one gets `app.ready`. A move of
 *   the page's address inside the same document (`history.replaceState`) changes nothing — the bridge lives as long
 *   as the document does.
 * - An answer belongs to the page that asked: once the page is gone (`detach` — the WebView remounts or fails),
 *   answers owed to it are dropped.
 */

import { walletErrorKind } from '../session/session-client.ts'
import { base64ToBytes, bytesToBase64 } from '../session/siws.ts'

import {
  errorResponse,
  okResponse,
  parsePageMessage,
  readyEvent,
  serialize,
  walletChangedEvent,
  type AppMessage,
  type BridgeWallet,
  type ErrorCode,
  type PageRequest,
  type ShareFile,
} from './bridge.ts'

/** The app's wallet as the host uses it — `useWallet` under the app, a double under a test. */
export type HostWallet = Readonly<{
  /** The wallet the app holds this moment, or null. */
  current: () => BridgeWallet | null
  /** Connect through the wallet's window; the account it chose, or a throw. */
  connect: () => Promise<BridgeWallet>
  disconnect: () => Promise<void>
  /** The exact bytes signed in the wallet's window, as the account the app holds; the signature (or the signed payload). */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
  /** Exact transactions (base64 wire) signed in one window, handed back signed in the same order; never sent. */
  signTransactions: (transactions: readonly string[]) => Promise<readonly string[]>
}>

export type Timers = Readonly<{
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}>

export type HostDeps = Readonly<{
  version: string
  /** The wallet the host starts with; `setWallet` hands it the wallet of the moment after. */
  wallet: HostWallet
  /** The system's share sheet on the file; whether it opened. */
  share: (file: ShareFile) => Promise<boolean>
  /** The system's browser on an `https://` address. */
  openExternal: (url: string) => Promise<void>
  /** One message to the page, as text (`webview.postMessage`). */
  post: (text: string) => void
  timers?: Timers
  waitMs?: number
}>

/** How long the host waits for the wallet: a little under the page's own 120 s, so the page hears it from the app. */
export const WALLET_WAIT_MS = 115_000

const SIGNATURE_BYTES = 64

const WORDS = {
  busy: 'Another wallet request is still open.',
  noWallet: 'Connect a wallet first.',
  declined: 'The request was declined in the wallet.',
  noWalletApp: 'No Solana wallet is installed on this device.',
  failed: 'The wallet did not complete the request.',
  timeout: 'The wallet did not answer in time.',
  shareFailed: 'The file could not be shared.',
  openFailed: 'The address could not be opened.',
  invalid: 'The request is not one the app can read.',
  unsupported: 'This version of the app does not do that.',
} as const

/**
 * The signature out of what the wallet handed back for a message: the 64 bytes themselves, or the signed payload —
 * the message with its signature appended — as some wallets return it. Null for anything else.
 */
export function signatureOf(signed: Uint8Array, message: Uint8Array): Uint8Array | null {
  if (signed.length === SIGNATURE_BYTES) return signed
  if (signed.length !== message.length + SIGNATURE_BYTES) return null
  for (let i = 0; i < message.length; i += 1) if (signed[i] !== message[i]) return null
  return signed.subarray(message.length)
}

/** A wallet's error as the contract's code: the person's «no» is `declined`, everything else `failed`. */
export function codeOfWalletError(error: unknown): Readonly<{ code: ErrorCode; message: string }> {
  const kind = walletErrorKind(error)
  if (kind === 'cancelled') return { code: 'declined', message: WORDS.declined }
  if (kind === 'no-wallet') return { code: 'failed', message: WORDS.noWalletApp }
  return { code: 'failed', message: WORDS.failed }
}

class Timeout extends Error {}
/** A request the host itself refuses before any wallet is asked: said as it is, `failed`. */
class Refusal extends Error {}

const sameWallet = (a: BridgeWallet | null, b: BridgeWallet | null): boolean =>
  a === b || (a !== null && b !== null && a.address === b.address && a.name === b.name)

const WALLET_REQUESTS: ReadonlySet<PageRequest['type']> = new Set([
  'wallet.connect',
  'wallet.disconnect',
  'wallet.signMessage',
  'wallet.signTransactions',
])

export type CityHost = Readonly<{
  /** One message from the page, as its text; settles once it is answered. */
  receive: (raw: unknown) => Promise<void>
  /** The page loaded or said its hello: `app.ready` with the wallet held now. Answers still owed to it stay owed. */
  ready: () => void
  /** The app's wallet changed: `wallet.changed`, once per change, to a page that has heard `app.ready`. */
  walletChanged: (wallet: BridgeWallet | null) => void
  /** The page went away (the tab closed, the WebView remounts): nothing more is said to it. */
  detach: () => void
  /** The app's wallet of the moment — the hook's, renewed each render; requests from now on use it. */
  setWallet: (next: HostWallet) => void
}>

export function createCityHost(deps: HostDeps): CityHost {
  const timers: Timers = deps.timers ?? {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
  const waitMs = deps.waitMs ?? WALLET_WAIT_MS
  /** Which page load the host speaks to; an answer carries the one it was asked in. */
  let page = 0
  let attached = false
  let walletOut = false
  let sharing = false
  let told: BridgeWallet | null = null
  let wallet = deps.wallet

  const send = (load: number, message: AppMessage) => {
    if (attached && load === page) deps.post(serialize(message))
  }

  /** The wallet's work, raced with the clock: the late answer of a wallet that timed out goes nowhere. */
  const withinWait = <T>(work: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = timers.set(() => reject(new Timeout()), waitMs)
      work.then(
        (value) => {
          timers.clear(timer)
          resolve(value)
        },
        (error: unknown) => {
          timers.clear(timer)
          reject(error)
        },
      )
    })

  async function walletWork(request: PageRequest): Promise<Readonly<Record<string, unknown>>> {
    switch (request.type) {
      case 'wallet.connect': {
        // Already held: the address is the page's at once, with no wallet window for nothing.
        const held = wallet.current()
        return held ?? (await withinWait(wallet.connect()))
      }
      case 'wallet.disconnect':
        if (wallet.current()) await withinWait(wallet.disconnect())
        return {}
      case 'wallet.signMessage': {
        if (!wallet.current()) throw new Refusal(WORDS.noWallet)
        const message = base64ToBytes(request.message)
        if (!message) throw new Refusal(WORDS.invalid)
        const signed = await withinWait(wallet.signMessage(message))
        const signature = signatureOf(signed, message)
        if (!signature) throw new Error(WORDS.failed)
        return { signature: bytesToBase64(signature), signedMessage: bytesToBase64(message) }
      }
      case 'wallet.signTransactions': {
        if (!wallet.current()) throw new Refusal(WORDS.noWallet)
        const signed = await withinWait(wallet.signTransactions(request.transactions))
        if (signed.length !== request.transactions.length || signed.some((entry) => typeof entry !== 'string'))
          throw new Error(WORDS.failed)
        return { signed: [...signed] }
      }
      default:
        throw new Error(WORDS.unsupported)
    }
  }

  async function answerWallet(load: number, request: PageRequest) {
    if (walletOut) {
      send(load, errorResponse(request.id, 'busy', WORDS.busy))
      return
    }
    walletOut = true
    try {
      send(load, okResponse(request.id, await walletWork(request)))
    } catch (error) {
      if (error instanceof Timeout) send(load, errorResponse(request.id, 'failed', WORDS.timeout))
      else if (error instanceof Refusal) send(load, errorResponse(request.id, 'failed', error.message))
      else {
        const { code, message } = codeOfWalletError(error)
        send(load, errorResponse(request.id, code, message))
      }
    } finally {
      walletOut = false
    }
  }

  async function answerShare(load: number, request: Extract<PageRequest, { type: 'share.file' }>) {
    if (sharing) {
      send(load, errorResponse(request.id, 'busy', WORDS.busy))
      return
    }
    sharing = true
    try {
      send(load, okResponse(request.id, { shared: await deps.share(request.file) }))
    } catch {
      send(load, errorResponse(request.id, 'failed', WORDS.shareFailed))
    } finally {
      sharing = false
    }
  }

  async function answerOpen(load: number, request: Extract<PageRequest, { type: 'open.external' }>) {
    try {
      await deps.openExternal(request.url)
      send(load, okResponse(request.id, {}))
    } catch {
      send(load, errorResponse(request.id, 'failed', WORDS.openFailed))
    }
  }

  const ready = () => {
    attached = true
    told = wallet.current()
    send(page, readyEvent(deps.version, told))
  }

  return {
    async receive(raw) {
      const load = page
      const read = parsePageMessage(raw)
      if (!read) return
      // The page's hello: its bridge listens now, whether or not the app has seen the load end.
      if (read.kind === 'hello') return ready()
      if (!attached) return
      if (read.kind === 'refuse') {
        send(load, errorResponse(read.id, read.code, WORDS[read.code]))
        return
      }
      const { request } = read
      if (WALLET_REQUESTS.has(request.type)) await answerWallet(load, request)
      else if (request.type === 'share.file') await answerShare(load, request)
      else if (request.type === 'open.external') await answerOpen(load, request)
    },
    ready,
    walletChanged(wallet) {
      if (!attached || sameWallet(wallet, told)) return
      told = wallet
      send(page, walletChangedEvent(wallet))
    },
    detach() {
      attached = false
      page += 1
    },
    setWallet(next) {
      wallet = next
    },
  }
}

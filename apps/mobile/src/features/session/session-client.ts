/**
 * Sign in with the wallet, sign out, keep the session honest — the flows,
 * with their dependencies handed in so they run the same under the app and
 * under a test with doubles. Sign-in: the server builds the challenge → the
 * wallet signs it → the server verifies → a short-lived bearer session is
 * kept in the secure store. Any other order, any other message, any other
 * address: no session. The launch check asks the server whether the stored
 * session still stands and refreshes one held three hours or near its end; a
 * session the server no longer knows is dropped on the device the same moment.
 */

import { ApiError, isNetworkError, needsSignIn, type Session, type SessionApi } from '../../lib/api.ts'

import { noteReplaced } from '../../lib/session-bearer.ts'
import { ledgerBlindSigning } from '../wallet/wallet-wait.ts'

import { sessionAlive, sessionFromGrant } from './session-model.ts'
import {
  signInPayloadFrom,
  signedWhatWasIssued,
  siwsMessageText,
  textBytes,
  verifyBodyFrom,
  walletBytes,
} from './siws.ts'

export type SignInStep = 'challenge' | 'sign' | 'verify'

export type SignInFailure = Readonly<{
  kind: 'cancelled' | 'no-wallet' | 'network' | 'refused' | 'outdated' | 'failed'
  step: SignInStep
  /** One plain line for the screen. */
  message: string
  /**
   * The wallet failed to sign the sign-in — not a plain decline — or said a Ledger was behind it: a Ledger may refuse
   * the message (M45), said in one sentence. A person declining in the wallet never gets it.
   */
  hint?: 'ledger'
}>

export type SignInOutcome = Readonly<{ ok: true; session: Session }> | Readonly<{ ok: false; failure: SignInFailure }>

/** What the flow needs from the wallet: the address it will sign for and the two ways to sign. */
export type SignInWallet = Readonly<{
  address: string
  /** `solana:signIn` through Mobile Wallet Adapter — the wallet rebuilds the text from the fields and signs it. */
  signIn: (
    payload: ReturnType<typeof signInPayloadFrom>,
  ) => Promise<Readonly<{ signedMessage: Uint8Array; signature: Uint8Array; account: Readonly<{ address: string }> }>>
  /** A plain message signature over the exact text, for a wallet without sign-in support. */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
}>

export type WalletErrorKind = 'cancelled' | 'no-wallet' | 'unsupported' | 'failed'

/**
 * A wallet error's kind from its Mobile Wallet Adapter code or text — the
 * words a screen may use. Association errors carry string codes
 * (`ERROR_WALLET_NOT_FOUND`, `ERROR_ASSOCIATION_CANCELLED`,
 * `ERROR_SESSION_CLOSED`); the wallet's own refusals are JSON-RPC codes
 * (`-1` authorization declined, `-3` not signed).
 */
export function walletErrorKind(error: unknown): WalletErrorKind {
  const text = error instanceof Error ? error.message : String(error ?? '')
  const code =
    error !== null && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
  if (code === 'ERROR_WALLET_NOT_FOUND' || /no installed wallet|NoWallet/i.test(text)) return 'no-wallet'
  if (
    code === 'ERROR_ASSOCIATION_CANCELLED' ||
    code === 'ERROR_SESSION_CLOSED' ||
    code === '-1' ||
    code === '-3' ||
    /cancel|declin|rejected/i.test(text)
  )
    return 'cancelled'
  if (/sign in result not retrieved|not supported|unsupported/i.test(text)) return 'unsupported'
  return 'failed'
}

/** True when the wallet itself refused the request (declined the authorization or did not sign). */
export function walletDeclined(error: unknown): boolean {
  const code =
    error !== null && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
  const text = error instanceof Error ? error.message : ''
  return code === '-1' || code === '-3' || /declin|rejected/i.test(text)
}

/** The sign-in the wallet failed to sign: a Ledger may refuse the message, so the sentence says what to do (M45). */
const NOT_SIGNED =
  'The wallet did not sign the sign-in — on a Ledger, update the Solana app on the device or sign in with another wallet.'

/** The person said no in the wallet: nothing about a Ledger, which was never involved. */
const DECLINED = 'You declined the sign-in in your wallet.'

/** The wallet came back without a signature and without an error — it flashed and returned: said, never silence. */
const NO_ANSWER = 'The wallet did not answer — try again.'

/** Anything the flow did not foresee still ends in a line, so the button is never left without a word. */
const NOT_FINISHED = 'The sign-in did not finish. Try again.'

/** The wallet's refusal names a Ledger: its status word or its name in the wallet's message. */
function ledgerSaid(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '')
  return ledgerBlindSigning(error) || /ledger/i.test(text)
}

/**
 * The person's decline, the person closing the sheet and a Ledger's refusal are three different lines: a decline
 * says only that it was declined; the Ledger's advice comes when the wallet's own answer names a Ledger.
 */
function closedOrDeclined(error: unknown): SignInOutcome {
  if (!walletDeclined(error)) return fail('cancelled', 'sign', 'The wallet closed before it signed.')
  return ledgerSaid(error) ? fail('failed', 'sign', NOT_SIGNED, 'ledger') : fail('cancelled', 'sign', DECLINED)
}

/** Bytes the wallet handed back, or null when it handed back nothing usable. */
function bytesOrNull(value: unknown): Uint8Array | null {
  if (!ArrayBuffer.isView(value) || value.byteLength === 0) return null
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return walletBytes(bytes)
}

function fail(kind: SignInFailure['kind'], step: SignInStep, message: string, hint?: 'ledger'): SignInOutcome {
  return { ok: false, failure: hint ? { kind, step, message, hint } : { kind, step, message } }
}

/** The server's refusal, by its stable code, into the one line a screen says. */
function serverFailure(error: unknown, step: SignInStep): SignInOutcome {
  if (isNetworkError(error))
    return fail('network', step, 'Sign-in needs the network. Try again when you are back online.')
  if (error instanceof ApiError) {
    if (error.code === 'UNSUPPORTED_CLIENT') {
      const needs = error.minimumAppVersion ? `version ${error.minimumAppVersion} or later` : 'a newer version'
      return fail('outdated', step, `Update Ryntra to sign in — the server needs ${needs}.`)
    }
    if (error.code === 'RATE_LIMITED' || error.status === 429)
      return fail('refused', step, 'Too many sign-in attempts. Wait a minute and try again.')
    if (error.code === 'NONCE_INVALID')
      return fail('refused', step, 'The sign-in took too long or was already used. Try again.')
    if (error.code === 'SIGNATURE_INVALID' || error.status === 401 || error.status === 403)
      return fail('refused', step, 'The server did not accept the signature. Try signing in again.')
  }
  return fail('failed', step, 'The server did not answer the sign-in.')
}

/** How long the phone waits before sending the same signed body once more after the network failed it. */
export const VERIFY_RETRY_MS = 1200

/**
 * Back from the wallet, the app's first request can fail before Android has
 * given the resumed app its network again (seen on the emulator as an
 * `UnknownHostException` three times running, right after the wallet's
 * round trip). The signed body is the same and its nonce is spent only by a
 * verify that succeeded, so on a network failure it is sent once more after
 * a short wait; a server's refusal is never retried.
 */
async function verifyOnceMore(
  api: SessionApi,
  body: NonNullable<ReturnType<typeof verifyBodyFrom>>,
  wait: (ms: number) => Promise<void>,
) {
  try {
    return await api.verify(body)
  } catch (error) {
    if (!isNetworkError(error)) throw error
    await wait(VERIFY_RETRY_MS)
    return api.verify(body)
  }
}

type SignInInput = Readonly<{
  wallet: SignInWallet
  api: SessionApi
  save: (session: Session) => Promise<void>
  now?: () => number
  /** The pause before the one retry of a verify the network failed; a test passes its own. */
  wait?: (ms: number) => Promise<void>
}>

/** The sign-in, which always ends in an outcome: a throw nobody foresaw is a failure said in one line, never silence. */
export async function signInWithWallet(input: SignInInput): Promise<SignInOutcome> {
  try {
    return await signInFlow(input)
  } catch {
    return fail('failed', 'sign', NOT_FINISHED)
  }
}

async function signInFlow(input: SignInInput): Promise<SignInOutcome> {
  const { wallet, api } = input

  let challenge
  try {
    challenge = await api.challenge(wallet.address)
  } catch (error) {
    return serverFailure(error, 'challenge')
  }
  const issued = challenge.input
  if (issued.address !== wallet.address || siwsMessageText(issued) !== challenge.message) {
    return fail('failed', 'challenge', 'The sign-in message did not match this wallet.')
  }

  let signedMessage: Uint8Array | null
  let signature: Uint8Array | null
  try {
    const output = await wallet.signIn(signInPayloadFrom(issued))
    // Back from the wallet with nothing in hand: the wallet did not answer, and the person may try again.
    if (!output) return fail('cancelled', 'sign', NO_ANSWER)
    if (output.account?.address !== wallet.address) {
      return fail('failed', 'sign', 'The wallet signed with a different account. Switch wallet and try again.')
    }
    signedMessage = bytesOrNull(output.signedMessage)
    signature = bytesOrNull(output.signature)
  } catch (error) {
    const kind = walletErrorKind(error)
    if (kind === 'cancelled') return closedOrDeclined(error)
    if (kind === 'no-wallet') return fail('no-wallet', 'sign', 'No Solana wallet is installed on this device.')
    if (kind !== 'unsupported') return fail('failed', 'sign', NOT_SIGNED, 'ledger')
    // The wallet has no sign-in feature: it signs the exact text instead.
    try {
      signedMessage = textBytes(challenge.message)
      signature = bytesOrNull(await wallet.signMessage(signedMessage))
    } catch (inner) {
      const innerKind = walletErrorKind(inner)
      if (innerKind === 'cancelled') return closedOrDeclined(inner)
      if (innerKind === 'no-wallet') return fail('no-wallet', 'sign', 'No Solana wallet is installed on this device.')
      return fail('failed', 'sign', NOT_SIGNED, 'ledger')
    }
  }
  if (signedMessage === null || signature === null) return fail('cancelled', 'sign', NO_ANSWER)
  if (!signedWhatWasIssued(signedMessage, issued)) {
    // A development build says what differed, for the engineer; a person sees the one line below.
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[siws] the wallet signed:', JSON.stringify(new TextDecoder().decode(signedMessage)))
      console.warn('[siws] the server issued:', JSON.stringify(challenge.message))
    }
    return fail('failed', 'sign', 'The wallet signed a different message than the server issued.')
  }
  const body = verifyBodyFrom({ address: wallet.address, signedMessage, signature })
  if (!body) return fail('failed', 'sign', 'The wallet returned no usable signature.')

  let grant
  try {
    grant = await verifyOnceMore(api, body, input.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))
  } catch (error) {
    return serverFailure(error, 'verify')
  }
  const session = sessionFromGrant(grant, wallet.address, (input.now ?? Date.now)())
  if (!session) return fail('failed', 'verify', 'The server answered with a session for another wallet.')
  await input.save(session)
  return { ok: true, session }
}

/**
 * End the session: tell the server (best effort — a revoked or expired token
 * is already gone), then forget it on the device. The caller drops every
 * private cache of that wallet in the same breath.
 */
export async function signOut(
  input: Readonly<{ session: Session | null; api: SessionApi; clear: () => Promise<void> }>,
): Promise<void> {
  if (input.session) {
    try {
      await input.api.revoke(input.session)
    } catch {
      // The server may be unreachable or the token already dead; the device forgets it regardless.
    }
  }
  await input.clear()
}

/** A session with this much or less left is refreshed at the check instead of asked about. */
export const REFRESH_WHEN_LEFT_MS = 6 * 60 * 60 * 1000

/**
 * A session held this long is refreshed at the next check, so its life runs
 * from the person's recent visits, not from the sign-in: with the server's
 * day, a visit within 21 hours of the last one keeps the wallet signed in
 * (ST-2; before, only a visit in the last six hours of the day did). Not
 * more often: each refresh replaces the bearer, and a refresh whose answer
 * the network loses leaves the phone a revoked one (request 59 b).
 */
export const REFRESH_AFTER_MS = 3 * 60 * 60 * 1000

export type SessionCheckPlan = 'none' | 'resolve' | 'refresh'

/**
 * What the check does with a stored session: nothing for a dead one; a
 * refresh near its end or three hours after it was issued — unless it already
 * outlives the time the person chose to stay connected (`keepUntil`), when
 * a fresh one would add nothing; a look otherwise.
 */
export function sessionCheckPlan(
  session: Session | null,
  now: number,
  keepUntil: number | null = null,
): SessionCheckPlan {
  if (!sessionAlive(session, now)) return 'none'
  const expires = Date.parse(session.expiresAt)
  if (keepUntil !== null && expires >= keepUntil) return 'resolve'
  const issued = Date.parse(session.issuedAt)
  const held = Number.isFinite(issued) ? now - issued : 0
  return expires - now <= REFRESH_WHEN_LEFT_MS || held >= REFRESH_AFTER_MS ? 'refresh' : 'resolve'
}

/**
 * When the check should run again while the app stays open — the moment the
 * session becomes due for a refresh — or null when no refresh is due before
 * it ends or before the chosen time runs out (that end is the keep binder's).
 */
export function nextRefreshAt(session: Session | null, now: number, keepUntil: number | null = null): number | null {
  if (!sessionAlive(session, now)) return null
  const expires = Date.parse(session.expiresAt)
  if (keepUntil !== null && expires >= keepUntil) return null
  const issued = Date.parse(session.issuedAt)
  const at = Math.min(expires - REFRESH_WHEN_LEFT_MS, Number.isFinite(issued) ? issued + REFRESH_AFTER_MS : Infinity)
  return keepUntil !== null && at >= keepUntil ? null : at
}

export type SessionCheck = Readonly<{
  status: 'kept' | 'refreshed' | 'ended' | 'offline'
  /** The session the device holds after the check — the refreshed one, the kept one, or none. */
  session: Session | null
}>

/**
 * The launch (and foreground) check: does the server still hold this
 * session? Revoked, expired or unknown there → forgotten here, with the
 * private caches, so the app never acts on a bearer the server will refuse.
 * Three hours old or near its end, while the chosen time lasts → refreshed for
 * the same wallet (the old one revoked as replaced). No network → kept as it
 * is; the server decides on the next private request. Any other server
 * trouble keeps it too.
 */
export async function checkSession(
  input: Readonly<{
    session: Session | null
    api: SessionApi
    save: (session: Session) => Promise<void>
    clear: () => Promise<void>
    now?: () => number
    /** The end of the time the person chose to stay connected, or null for «поки не вийду». */
    keepUntil?: number | null
    /** False while a refresh must wait — a wallet request out or just back, no network: the session is only looked at. */
    mayRefresh?: boolean
  }>,
): Promise<SessionCheck> {
  const now = (input.now ?? Date.now)()
  const planned = sessionCheckPlan(input.session, now, input.keepUntil ?? null)
  const plan = planned === 'refresh' && input.mayRefresh === false ? 'resolve' : planned
  if (plan === 'none' || !input.session) {
    if (input.session) await input.clear()
    return { status: 'ended', session: null }
  }
  const session = input.session
  try {
    if (plan === 'refresh') {
      const next = sessionFromGrant(await input.api.refresh(session), session.address, now)
      if (!next) return { status: 'kept', session }
      // Whatever still holds the replaced session sends the new bearer from now on.
      noteReplaced(session, next)
      await input.save(next)
      return { status: 'refreshed', session: next }
    }
    const held = await input.api.resolve(session)
    if (held.address !== session.address) {
      await input.clear()
      return { status: 'ended', session: null }
    }
    if (held.expiresAt !== session.expiresAt || held.id !== session.sessionId) {
      const kept = { ...session, expiresAt: held.expiresAt, sessionId: held.id }
      await input.save(kept)
      return { status: 'kept', session: kept }
    }
    return { status: 'kept', session }
  } catch (error) {
    if (needsSignIn(error)) {
      await input.clear()
      return { status: 'ended', session: null }
    }
    return { status: isNetworkError(error) ? 'offline' : 'kept', session }
  }
}

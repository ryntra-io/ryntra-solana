/**
 * Sign in with the wallet, sign out, keep the session honest — the flows,
 * with their dependencies handed in so they run the same under the app and
 * under a test with doubles. Sign-in: the server builds the challenge → the
 * wallet signs it → the server verifies → a short-lived bearer session is
 * kept in the secure store. Any other order, any other message, any other
 * address: no session. The launch check asks the server whether the stored
 * session still stands and refreshes one that is near its end; a session the
 * server no longer knows is dropped on the device the same moment.
 */

import { ApiError, isNetworkError, needsSignIn, type Session, type SessionApi } from '../../lib/api.ts'

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

/** The wallet's own refusal and the person closing the sheet are two different lines. */
function closedOrDeclined(error: unknown): string {
  return walletDeclined(error) ? 'The wallet declined to sign.' : 'The wallet closed before it signed.'
}

function fail(kind: SignInFailure['kind'], step: SignInStep, message: string): SignInOutcome {
  return { ok: false, failure: { kind, step, message } }
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

export async function signInWithWallet(
  input: Readonly<{
    wallet: SignInWallet
    api: SessionApi
    save: (session: Session) => Promise<void>
    now?: () => number
    /** The pause before the one retry of a verify the network failed; a test passes its own. */
    wait?: (ms: number) => Promise<void>
  }>,
): Promise<SignInOutcome> {
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

  let signedMessage: Uint8Array
  let signature: Uint8Array
  try {
    const output = await wallet.signIn(signInPayloadFrom(issued))
    if (output.account.address !== wallet.address) {
      return fail('failed', 'sign', 'The wallet signed with a different account. Switch wallet and try again.')
    }
    signedMessage = walletBytes(output.signedMessage)
    signature = walletBytes(output.signature)
  } catch (error) {
    const kind = walletErrorKind(error)
    if (kind === 'cancelled') return fail('cancelled', 'sign', closedOrDeclined(error))
    if (kind === 'no-wallet') return fail('no-wallet', 'sign', 'No Solana wallet is installed on this device.')
    if (kind !== 'unsupported') return fail('failed', 'sign', 'The wallet did not sign the message.')
    // The wallet has no sign-in feature: it signs the exact text instead.
    try {
      signedMessage = textBytes(challenge.message)
      signature = walletBytes(await wallet.signMessage(signedMessage))
    } catch (inner) {
      const innerKind = walletErrorKind(inner)
      if (innerKind === 'cancelled') return fail('cancelled', 'sign', closedOrDeclined(inner))
      if (innerKind === 'no-wallet') return fail('no-wallet', 'sign', 'No Solana wallet is installed on this device.')
      return fail('failed', 'sign', 'The wallet did not sign the message.')
    }
  }
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

export type SessionCheckPlan = 'none' | 'resolve' | 'refresh'

/** What the launch check does with a stored session: nothing for a dead one, a refresh near the end, a look otherwise. */
export function sessionCheckPlan(session: Session | null, now: number): SessionCheckPlan {
  if (!sessionAlive(session, now)) return 'none'
  return Date.parse(session.expiresAt) - now <= REFRESH_WHEN_LEFT_MS ? 'refresh' : 'resolve'
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
 * Near its end → refreshed for the same wallet (the old one revoked as
 * replaced). No network → kept as it is; the server decides on the next
 * private request. Any other server trouble keeps it too.
 */
export async function checkSession(
  input: Readonly<{
    session: Session | null
    api: SessionApi
    save: (session: Session) => Promise<void>
    clear: () => Promise<void>
    now?: () => number
  }>,
): Promise<SessionCheck> {
  const now = (input.now ?? Date.now)()
  const plan = sessionCheckPlan(input.session, now)
  if (plan === 'none' || !input.session) {
    if (input.session) await input.clear()
    return { status: 'ended', session: null }
  }
  const session = input.session
  try {
    if (plan === 'refresh') {
      const next = sessionFromGrant(await input.api.refresh(session), session.address, now)
      if (!next) return { status: 'kept', session }
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

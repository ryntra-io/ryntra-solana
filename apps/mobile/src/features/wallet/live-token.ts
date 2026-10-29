/**
 * The wallet's authorization token kept alive (SKR-2). A wallet may reissue the token while it authorizes — the
 * reference wallet does — and revoke the one it was given; when the step after that fails (the person closes the
 * sign-in), the new token never reaches the phone and the old one is dead. A token is also dead once the person
 * removes Ryntra from the wallet's connected apps. The wallet then refuses every `authorize` that carries it
 * (`ERROR_AUTHORIZATION_FAILED`, -1), at once and with nothing on its screen.
 *
 * `@wallet-ui/react-native-kit` asks again without the token on exactly that refusal, but Mobile Wallet Adapter 2.3.0
 * (and 3.0.1) on React Native hands the refusal on untyped — its `invoke` returns the native promise without awaiting
 * it — so the kit never sees it and every press fails the same way until the person switches wallet. This module
 * makes the same decision on the untyped refusal, and tells the token's refusal from the person's by time: a wallet
 * that refuses within `HUMAN_ANSWER_MS` refused the token, and the phone asks again without it in the same session; a
 * slower refusal is the person's, and is not asked again now — the next press goes without the token, so nothing stays
 * stuck. A person who cancels a sign-in window within that time is asked once more, in a fresh consent window: the
 * price of never leaving a dead token in place.
 */

/** No person reads a wallet's screen and declines in less: an answer this fast is the wallet's own. */
export const HUMAN_ANSWER_MS = 1_500

/** The wallet's `ERROR_AUTHORIZATION_FAILED`, typed by the protocol or untyped from the native module. */
export function tokenRefused(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const { code, userInfo } = error as { code?: unknown; userInfo?: { jsonRpcErrorCode?: unknown } | null }
  if (code === -1 || code === '-1') return true
  return code === 'JSON_RPC_ERROR' && Number(userInfo?.jsonRpcErrorCode) === -1
}

/**
 * A refusal handed on as the native module hands it: untyped, so the kit's own «ask without the token» never runs on
 * top of this module's decision — a person who declined is never asked twice by the two of them. The session's own
 * error handling types it on the way out, as before.
 */
function untyped(error: unknown): unknown {
  if (!tokenRefused(error)) return error
  const message = error instanceof Error ? error.message : 'The wallet declined authorization'
  return Object.assign(new Error(message), { code: 'JSON_RPC_ERROR', userInfo: { jsonRpcErrorCode: -1 } })
}

type Authorize<P, R> = (params: P) => Promise<R>
type WithToken = { auth_token?: string }

export type LiveToken = Readonly<{
  /** `authorize`, asked again without the token when the wallet refused the token rather than the person. */
  authorize: <P extends WithToken, R>(authorize: Authorize<P, R>, params: P) => Promise<R>
  /** Whether the next `authorize` goes without the token (its refusal came back, and no fresh one followed). */
  suspect: () => boolean
  /** Forget the suspicion: the wallet was switched or forgotten, the next token is a new one. */
  reset: () => void
}>

function withoutToken<P extends WithToken>(params: P): P {
  const { auth_token: _dropped, ...rest } = params
  return rest as P
}

/** A clock for intervals that never runs backwards; the wall clock only where there is none. */
function monotonic(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function createLiveToken(now: () => number = monotonic): LiveToken {
  let suspect = false
  return {
    async authorize(authorize, params) {
      const asked = suspect && params.auth_token ? withoutToken(params) : params
      const started = now()
      try {
        const result = await authorize(asked)
        suspect = false
        return result
      } catch (error) {
        if (!asked.auth_token || !tokenRefused(error)) throw untyped(error)
        // The token was refused: until a fresh authorization comes back, no request carries it again.
        suspect = true
        if (now() - started >= HUMAN_ANSWER_MS) throw untyped(error)
        try {
          const result = await authorize(withoutToken(params))
          suspect = false
          return result
        } catch (retried) {
          throw untyped(retried)
        }
      }
    },
    suspect: () => suspect,
    reset: () => {
      suspect = false
    },
  }
}

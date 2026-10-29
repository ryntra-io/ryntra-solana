/**
 * Whether the person is in the wallet right now, or just came back from it
 * (ST-2). A session refresh replaces the bearer on the server; a flow that
 * opened the wallet holding the old one sends it the moment the wallet
 * answers — a Review's submit, a send, a limit, a launch. So the session is
 * never refreshed while a wallet request is out, nor in the minute after it
 * came back: the flow finishes on the bearer it started with.
 */

import { WALLET_WAIT_MS } from './wallet-wait.ts'

/** After the wallet answers, the flow's own requests go out; the refresh waits this long behind them. */
export const WALLET_QUIET_MS = 60_000

/**
 * A request out longer than the flows wait for a wallet (and a minute more)
 * counts as back: the flow has given up on it, and a wallet session left
 * open forever must not hold every refresh back with it.
 */
export const WALLET_OUT_LONGEST_MS = WALLET_WAIT_MS + WALLET_QUIET_MS

const out = new Map<number, number>()
let next = 0
let backAt = Number.NEGATIVE_INFINITY

/** A wallet request, counted while it is out and stamped when it comes back — answered, refused or failed. */
export async function inWallet<T>(work: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const id = next++
  out.set(id, now())
  try {
    return await work()
  } finally {
    out.delete(id)
    backAt = now()
  }
}

/** The moment a refresh may run again: now when the wallet is quiet, later while a request is out or just back. */
export function walletQuietAt(now: number): number {
  let at = Math.max(now, backAt + WALLET_QUIET_MS)
  for (const since of out.values()) {
    const givenUp = since + WALLET_OUT_LONGEST_MS
    if (givenUp > now) at = Math.max(at, Math.min(now + WALLET_QUIET_MS, givenUp))
  }
  return at
}

/** For a test: the counters back to a phone that never opened a wallet. */
export function resetWalletAway() {
  out.clear()
  backAt = Number.NEGATIVE_INFINITY
}

/**
 * What the phone keeps for the moment the network is gone, and how it tells
 * that moment — pure, so a test can hold it.
 *
 * The reads kept on the device are the ones a person looks back at: the
 * wallet's positions (a public read by its address), the markets' lists and
 * a market's figures, a company's issuer read, «Популярні компанії» as the
 * server lists them. Each keeps the time the server
 * gave it, and a screen shows that time beside it. The companies' shelf keeps
 * its own copy (\`use-shelf\`). Never kept: anything read behind the wallet's
 * session — its history, rules, plans, notes and rewards stay in memory only,
 * so an ended session leaves nothing private on the device — nor an estimate
 * or a quote (a price to act on is only ever today's), a search, a chart, a
 * conversation with Ryntra.
 */

/** The query keys whose answers are kept on the device, matched from the start of the key. */
export const KEPT_QUERY_PREFIXES: readonly (readonly string[])[] = [
  ['trade', 'holdings'],
  ['markets'],
  ['market'],
  ['stocks', 'asset'],
  ['stocks', 'popular'],
  ['capabilities'],
]

/** Kept answers older than this are not brought back: a week-old position is no longer worth showing. */
export const KEPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function startsWith(key: readonly unknown[], prefix: readonly string[]): boolean {
  return prefix.every((part, index) => key[index] === part)
}

/** Whether an answer under this key is kept on the device. A search is never kept, even under a kept key. */
export function keepsQuery(key: readonly unknown[]): boolean {
  if (key[0] === 'markets' && key[1] === 'search') return false
  return KEPT_QUERY_PREFIXES.some((prefix) => startsWith(key, prefix))
}

/** Whether a kept answer is young enough to come back on the next start. */
export function freshEnough(updatedAt: number, now: number): boolean {
  return Number.isFinite(updatedAt) && updatedAt > 0 && now - updatedAt <= KEPT_MAX_AGE_MS
}

/** The parts of the network state the phone reports (`expo-network`); either may be unknown. */
export type NetworkReading = Readonly<{ isConnected?: boolean | null; isInternetReachable?: boolean | null }>

/**
 * No network: the phone says it is connected to none. A network Android has
 * not validated (a blocked connectivity check, some VPNs, a failing private
 * DNS) may still reach Ryntra, so it is not called offline; a read that fails
 * there says so on its own screen. Unknown is not offline either — a screen
 * never says «no network» on a guess.
 */
export function offlineFrom(reading: NetworkReading): boolean {
  return reading.isConnected === false
}

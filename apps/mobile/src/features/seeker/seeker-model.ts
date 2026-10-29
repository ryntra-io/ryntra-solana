/**
 * «Перевірено Seeker» and `.skr` names as values — pure (M41.2). The reads are
 * the server's (contract 1.66.0 `GET /api/v1/auth/seeker`, 1.65.0
 * `GET /api/v1/research/skr-name`); this file only decides what an answer
 * means, in the web's own rules (`lib/solana/skr-name.ts`,
 * `lib/solana/skr.client.ts`):
 *
 * - A name's address is where money goes: read every time, never kept, and
 *   read again right before the signature. An answer about another name, or
 *   an address that is not one, answers nothing.
 * - An address's name is a label: the primary one, the one that wallet chose
 *   (for the person's own wallet the server may give the first one it holds).
 * - «The chain did not answer» is never «no Seeker» and never «no name»: the
 *   phone then shows nothing new, keeps what it showed, and asks again.
 * - The mark is not a permission: it opens and pays nothing.
 *
 * Nothing here talks to the network or holds a key.
 */

import type { SeekerCheckResponse, SkrNameRead } from '../../lib/api/v1/types.ts'

/** A Solana address as written: base58, 32 to 44 characters. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function isAddress(value: unknown): value is string {
  return typeof value === 'string' && BASE58.test(value)
}

/* ---- `.skr` names ---- */

/**
 * A `.skr` name as typed: one label of ASCII letters, digits, `-` and `_`, then `.skr`. Narrower than the package on
 * purpose — a homograph such as `аlice.skr` with a Cyrillic «а» is never read as `alice.skr` and never resolved.
 */
const SKR_LABEL = /^[a-z0-9_-]{1,63}$/
const SKR_SUFFIX = '.skr'

/** The name in its one form (`alice.skr`), or `null` when what was typed is not a `.skr` name. */
export function skrNameOf(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const value = input.trim().toLowerCase()
  if (!value.endsWith(SKR_SUFFIX)) return null
  const label = value.slice(0, -SKR_SUFFIX.length)
  return SKR_LABEL.test(label) ? `${label}${SKR_SUFFIX}` : null
}

/** What a name points to now — or that it points nowhere, or that the chain did not answer. */
export type SkrResolve =
  | Readonly<{ state: 'FOUND'; name: string; address: string }>
  | Readonly<{ state: 'NOT_FOUND'; name: string }>
  | Readonly<{ state: 'UNAVAILABLE'; name: string }>

/** The server's answer for `?name=` read against the name that was asked; anything off is UNAVAILABLE. */
export function resolveOf(name: string, read: SkrNameRead | null | undefined): SkrResolve {
  if (!read || read.direction !== 'name' || skrNameOf(read.name) !== name) return { state: 'UNAVAILABLE', name }
  if (read.state === 'FOUND' && isAddress(read.address)) return { state: 'FOUND', name, address: read.address }
  if (read.state === 'NOT_FOUND') return { state: 'NOT_FOUND', name }
  return { state: 'UNAVAILABLE', name }
}

/** A name's answer only while it is about the name now typed — an answer for the previous name answers nothing. */
export function nameAnswerFor(name: string | null, answer: SkrResolve | null | undefined): SkrResolve | null {
  return name !== null && answer?.name === name ? answer : null
}

/**
 * The name the address on screen came from: only while the check's address is exactly the one the name's answer
 * gave. The Review names an address only when the name points there, or — for a pasted address — when its own
 * name, read forward right before the Review, pointed to exactly that address.
 */
export function shownNameOf(
  input: Readonly<{ name: string | null; answer: SkrResolve | null; address: string | null }>,
): string | null {
  return input.name && input.answer?.state === 'FOUND' && input.address === input.answer.address ? input.name : null
}

export function reviewNameOf(
  input: Readonly<{
    reviewAddress: string | null
    name: string | null
    address: string | null
    forward: Readonly<{ address: string; name: string }> | null
  }>,
): string | null {
  if (!input.reviewAddress) return null
  if (input.name && input.reviewAddress === input.address) return input.name
  return input.forward?.address === input.reviewAddress ? input.forward.name : null
}

/** «Unread» — the chain did not answer: never shown as «no name», never kept. */
export const UNREAD = 'unread' as const

/** The server's answer for `?address=`: the name to show, `null` for none, or `unread`. */
export function addressNameOf(address: string, read: SkrNameRead | null | undefined): string | null | typeof UNREAD {
  if (!read || read.direction !== 'address' || read.address !== address) return UNREAD
  if (read.state === 'UNAVAILABLE') return UNREAD
  if (read.state === 'NOT_FOUND') return null
  return skrNameOf(read.name)
}

/** Why a name read again stops a transfer: it is gone, it moved, or it could not be read. */
export type NameStop = 'SKR_GONE' | 'SKR_CHANGED' | 'SKR_UNREAD'

/**
 * How long a name read after the signature may take (send-flow): the signature is taken up to five seconds before the
 * bytes' ~30 s run out, and the read runs beside the read-back — two seconds keeps it inside that margin.
 */
export const NAME_READ_AFTER_SIGNING_MS = 2_000

/**
 * A name read again right before a step (the Review, the wallet, the send) against the address the transfer pays:
 * `null` when it still points there; else why the step stops. Never taken from the copy on screen.
 */
export function nameStopOf(again: SkrResolve, expected: string): NameStop | null {
  if (again.state === 'NOT_FOUND') return 'SKR_GONE'
  if (again.state === 'UNAVAILABLE') return 'SKR_UNREAD'
  return again.address === expected ? null : 'SKR_CHANGED'
}

/** A whole address in groups of four, as the eye checks it — Review shows every character. */
export function addressGroups(value: string): readonly string[] {
  return value.match(/.{1,4}/g) ?? []
}

/* ---- «Перевірено Seeker» ---- */

/** What the phone shows for the signed-in wallet: the mark, nothing, or — the chain did not answer — what it showed. */
export type SeekerMark = 'verified' | 'none' | typeof UNREAD

/**
 * The server's answer for the wallet the session proved. Only an answer about exactly that wallet counts; a 503 or a
 * failed read is `unread`, never `none`.
 */
export function seekerMarkOf(address: string | null, answer: SeekerCheckResponse | null | undefined): SeekerMark {
  if (!address || !answer || answer.address !== address || answer.network !== 'solana:mainnet') return UNREAD
  return answer.verified === true ? 'verified' : 'none'
}

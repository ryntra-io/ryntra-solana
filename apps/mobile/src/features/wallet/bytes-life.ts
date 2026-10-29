/**
 * How long a transaction the wallet is handed may still be signed (AG-1 on the web, AG-2 here).
 *
 * Solana's slots are 200 ms now, and a recent blockhash is valid for 150 blocks: bytes built a moment ago live about
 * thirty seconds. The server measures their life on the chain when it builds them and says how long, from the
 * answer's arrival, the wallet may still be asked: `signableMs` (that life less a margin to send and land). This module
 * is the phone's half of that rule — pure, so the flows and their tests share it.
 *
 * Two promises, as on the web:
 * - the wallet is opened only on bytes with enough life left for a person (and a Ledger) to confirm, and a signature
 *   that comes back after the window is never sent — the Review is built again, once; a second late answer in a row
 *   tells the person plainly that the device must confirm within ~20 s;
 * - nothing here decides that bytes already sent will not land. That is the chain's word; the 120, 150 and 180-second
 *   clocks that wait for it stay as they are.
 */

/** 150 blocks × 200 ms. */
export const BYTES_LIFE_MS = 30_000
/** Room left at the end of the life for the signed bytes to be sent and land. */
export const SUBMIT_MARGIN_MS = 5_000
/** The window when a server sent none (a server from before AG-1): one life less the margin. */
export const MAX_SIGNABLE_MS = BYTES_LIFE_MS - SUBMIT_MARGIN_MS
/** The least of a window worth opening a wallet on: a wallet raises its prompt, a person (or a Ledger) confirms. */
export const MIN_WALLET_WINDOW_MS = 10_000
/** What the person is told after a second late answer: confirm on the device within this many seconds. */
export const DEVICE_CONFIRM_SECONDS = 20

/** The server's `signableMs`, or one life less the margin when it sent none. */
export function signableMsOf(given: unknown): number {
  return typeof given === 'number' && Number.isFinite(given) && given >= 0 ? given : MAX_SIGNABLE_MS
}

/** May a wallet open on bytes that arrived at `receivedAtMs` with `signableMs`? Relative, so the phone's clock cannot stretch it. */
export function mayOpenWallet(
  args: Readonly<{ receivedAtMs: number; signableMs: number; nowMs: number; minWindowMs?: number }>,
): boolean {
  if (![args.receivedAtMs, args.signableMs, args.nowMs].every(Number.isFinite)) return false
  return args.receivedAtMs + args.signableMs - args.nowMs >= (args.minWindowMs ?? MIN_WALLET_WINDOW_MS)
}

/** Are the bytes past their signable window — would a signature now be refused by the network? */
export function signableWindowClosed(
  args: Readonly<{ receivedAtMs: number; signableMs: number; nowMs: number }>,
): boolean {
  if (![args.receivedAtMs, args.signableMs].every(Number.isFinite)) return true
  return args.nowMs >= args.receivedAtMs + args.signableMs
}

/** How long until the bytes are dead on the chain: the window plus the margin it kept. Asking the chain sooner only spends requests. */
export function msUntilBytesDie(args: Readonly<{ receivedAtMs: number; signableMs: number; nowMs: number }>): number {
  if (![args.receivedAtMs, args.signableMs, args.nowMs].every(Number.isFinite)) return 0
  return Math.max(0, args.receivedAtMs + args.signableMs + SUBMIT_MARGIN_MS - args.nowMs)
}

/**
 * After a late answer: the first time in a row the Review is built again by itself; from the second, the person is
 * told the device has to confirm within ~20 s — a Ledger may take longer than the bytes live.
 */
export function afterLateAnswer(lateInARow: number): 'rebuild' | 'tell' {
  return lateInARow <= 1 ? 'rebuild' : 'tell'
}

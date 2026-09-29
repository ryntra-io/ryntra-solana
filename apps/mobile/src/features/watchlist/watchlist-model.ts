/**
 * The watchlist as a value: an ordered list of mints, no duplicates, capped
 * at the same limit the web keeps. Pure, so the storage layer stays thin.
 *
 * Two kinds of list exist. The device list is the guest's, kept on the
 * phone. A wallet list is the wallet's own on the server, mirrored on the
 * phone while that wallet's session lives, together with what the phone
 * changed since it last agreed with the server — the removals, the server's
 * row version and its mark — so the next write names the version it read
 * and the next merge names the removals to honour. When a wallet signs in,
 * the device list is merged into the wallet's list once, by the server (its
 * order first, the device's additions after), and the device list is
 * emptied, so nothing is merged twice and a mint the person later removes
 * on the web cannot come back from an old copy. Two wallets never share a
 * list.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** The web's `SPOT_WATCHLIST_LIMIT`; the server refuses a longer list. */
export const WATCHLIST_LIMIT = 200

export const DEVICE_SCOPE = 'device'
export type WatchlistScope = typeof DEVICE_SCOPE | `wallet:${string}`

/** The list a session address owns, or the device's when no wallet is signed in. */
export function scopeFor(address: string | null | undefined): WatchlistScope {
  return address && BASE58.test(address) ? `wallet:${address}` : DEVICE_SCOPE
}

/** A clean list out of anything: valid mints, no duplicates, under the limit. */
export function cleanMints(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && BASE58.test(item) && !out.includes(item)) out.push(item)
    if (out.length >= WATCHLIST_LIMIT) break
  }
  return out
}

/** Whatever was stored, back into a clean list — anything else is an empty watchlist, never a crash. */
export function parseWatchlist(stored: string | undefined | null): readonly string[] {
  if (!stored) return []
  try {
    return cleanMints(JSON.parse(stored))
  } catch {
    return []
  }
}

export type WatchlistToggle = Readonly<{ mints: readonly string[]; added: boolean; refused: boolean }>

/**
 * Add a mint that is absent, remove one that is present. A full list refuses
 * an addition and says so rather than dropping an older entry silently.
 */
export function toggleMint(mints: readonly string[], mint: string): WatchlistToggle {
  if (mints.includes(mint)) return { mints: mints.filter((item) => item !== mint), added: false, refused: false }
  if (!BASE58.test(mint) || mints.length >= WATCHLIST_LIMIT) return { mints, added: false, refused: true }
  return { mints: [...mints, mint], added: true, refused: false }
}

/** Same members in the same order. */
export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((mint, index) => mint === b[index])
}

/* ---- a wallet's list on this device ---- */

export type WalletList = Readonly<{
  /** The mirror of the server's list, plus what the phone changed since. */
  mints: readonly string[]
  /** Removed on the phone since the last agreement — the next merge honours them. */
  removed: readonly string[]
  /** The server's row version the mirror was read at: `ifVersion` on the next write. */
  version: number | null
  /** The server's mark of the last agreement: `syncedAt` on the next merge; null before the first. */
  mark: string | null
  /** When the phone last agreed with the server, on its own clock — for the screen. */
  syncedAt: string | null
  /** True while a change made on the phone has not reached the server. */
  pending: boolean
}>

/** Whatever was stored for a wallet, back into its list — or null, never a crash. */
export function parseWalletList(stored: string | undefined | null): WalletList | null {
  if (!stored) return null
  try {
    const value: unknown = JSON.parse(stored)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const raw = value as Record<string, unknown>
    return {
      mints: cleanMints(raw.mints),
      removed: cleanMints(raw.removed),
      version: typeof raw.version === 'number' && Number.isInteger(raw.version) ? raw.version : null,
      mark: typeof raw.mark === 'string' ? raw.mark : null,
      syncedAt: typeof raw.syncedAt === 'string' ? raw.syncedAt : null,
      pending: raw.pending === true,
    }
  } catch {
    return null
  }
}

/** A star tapped on a wallet's list: the mirror changes now, the server hears next; a removal is remembered for the merge. */
export function toggleInWallet(
  list: WalletList,
  mint: string,
): Readonly<{ list: WalletList; toggle: WatchlistToggle }> {
  const toggle = toggleMint(list.mints, mint)
  if (toggle.refused || toggle.mints === list.mints) return { list, toggle }
  const removed = toggle.added
    ? list.removed.filter((item) => item !== mint)
    : list.removed.includes(mint)
      ? list.removed
      : [...list.removed, mint]
  return { list: { ...list, mints: toggle.mints, removed, pending: true }, toggle }
}

export type ServerList = Readonly<{ mints: readonly string[]; version: number; mark: string | null }>

/** The server's answer becomes the wallet's list: nothing pending, nothing removed, the version and the mark it came with. */
export function walletListFromServer(answer: ServerList, syncedAt: string): WalletList {
  return {
    mints: cleanMints(answer.mints),
    removed: [],
    version: answer.version,
    mark: answer.mark,
    syncedAt,
    pending: false,
  }
}

/**
 * After the server answered a write or a merge of `sent`: the answer is the
 * list — unless a newer tap changed the phone's list meanwhile, in which
 * case the phone keeps its own and takes only the version and the mark; the
 * newer change is already queued behind this one.
 */
export function walletListAfterWrite(
  current: WalletList,
  sent: readonly string[],
  answer: ServerList,
  syncedAt: string,
): WalletList {
  if (sameList(current.mints, sent)) return walletListFromServer(answer, syncedAt)
  return { ...current, version: answer.version, mark: answer.mark }
}

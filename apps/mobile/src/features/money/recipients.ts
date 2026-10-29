/**
 * «Нещодавні» — the addresses this phone sent to, newest first, and what a new
 * recipient is measured against (NEW-LOOK §3 «Платежі»), pure. The ledger keeps
 * no counterparty (`WalletAction`), so the list is the phone's own: written
 * when a transfer is sent, kept per wallet. A look-alike — the same first and
 * last four characters, another middle — is the poisoning trick a
 * transaction history invites: it stops «Далі» until the address is put in
 * again on purpose.
 */

export type RecentRecipient = Readonly<{ address: string; at: string }>

/** How many recipients the list keeps — the place draws the first of them as circles. */
export const RECENT_LIMIT = 8

/** The edges a look-alike copies. */
const EDGE = 4

/** The list after a transfer to `address`: it moves to the front once, the oldest falls off past the limit. */
export function addRecent(list: readonly RecentRecipient[], address: string, at: string): readonly RecentRecipient[] {
  return [{ address, at }, ...list.filter((entry) => entry.address !== address)].slice(0, RECENT_LIMIT)
}

/** No transfer from this phone went to it yet. */
export function isNewRecipient(list: readonly RecentRecipient[], address: string): boolean {
  return !list.some((entry) => entry.address === address)
}

/** A recent address this one imitates: the same first and last four characters, a different middle; null when none. */
export function lookalikeOf(list: readonly RecentRecipient[], address: string): RecentRecipient | null {
  if (address.length <= EDGE * 2) return null
  const head = address.slice(0, EDGE)
  const tail = address.slice(-EDGE)
  return (
    list.find(
      (entry) =>
        entry.address !== address && entry.address.slice(0, EDGE) === head && entry.address.slice(-EDGE) === tail,
    ) ?? null
  )
}

/** A stored list read leniently: anything but well-formed entries is dropped. */
export function parseRecents(stored: string | null | undefined): readonly RecentRecipient[] {
  if (!stored) return []
  try {
    const value: unknown = JSON.parse(stored)
    if (!Array.isArray(value)) return []
    return value
      .filter(
        (entry): entry is RecentRecipient =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as RecentRecipient).address === 'string' &&
          /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((entry as RecentRecipient).address) &&
          typeof (entry as RecentRecipient).at === 'string',
      )
      .slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

/**
 * The desk's one-time addresses. Each quote gets an address of its own, made in advance, registered for a
 * private balance and stocked by a private transfer from the desk's ring (the chain shows only that the desk sent; the
 * amount and the coin stay hidden — devnet, PROBE.md «Переказ»). After one fill the address is swept back into the desk's
 * ring and never quoted again.
 *
 * Pure bookkeeping, no keys: the keys of these addresses live with whoever runs the desk (today — the devnet probe, in
 * memory only), never in this repository and never in the browser.
 */

export type SlotState = 'ready' | 'held' | 'used';

export type Slot = Readonly<{
  address: string;
  /** What the address holds in its private balance, by coin, in smallest units. */
  holds: Readonly<Record<string, bigint>>;
  state: SlotState;
  /** The quote holding it; null while ready. */
  quote: string | null;
  /** Until when the hold stands (ms); a hold past it is free again. */
  until: number;
}>;

export function readySlot(address: string, holds: Readonly<Record<string, bigint>>): Slot {
  return { address, holds, state: 'ready', quote: null, until: 0 };
}

const free = (slot: Slot, now: number) => slot.state === 'ready' || (slot.state === 'held' && slot.until < now);

/**
 * The address for a quote paying `outRaw` of `outMint`: a free one that holds enough, the smallest of those — the big
 * ones stay for big quotes. Null when none holds enough: the desk says «no stock», never quotes from two addresses.
 */
export function pickSlot(slots: readonly Slot[], outMint: string, outRaw: bigint, now: number): Slot | null {
  let best: Slot | null = null;
  for (const slot of slots) {
    const has = slot.holds[outMint] ?? 0n;
    if (!free(slot, now) || has < outRaw) continue;
    if (!best || has < (best.holds[outMint] ?? 0n)) best = slot;
  }
  return best;
}

/** The slot is held for this quote until `until`. */
export function holdSlot(slots: readonly Slot[], address: string, quote: string, until: number): readonly Slot[] {
  return slots.map((s) => (s.address === address ? { ...s, state: 'held', quote, until } : s));
}

/** Takes the hold off a quote that was not filled: the address may be quoted again. */
export function releaseSlot(slots: readonly Slot[], quote: string): readonly Slot[] {
  return slots.map((s) => (s.quote === quote && s.state === 'held' ? { ...s, state: 'ready', quote: null, until: 0 } : s));
}

/** The quote was filled: its address is done and waits for the sweep back into the desk's ring. */
export function spendSlot(slots: readonly Slot[], quote: string): readonly Slot[] {
  return slots.map((s) => (s.quote === quote ? { ...s, state: 'used' } : s));
}

/** The slot holding a quote, if any. */
export function slotOf(slots: readonly Slot[], quote: string): Slot | null {
  return slots.find((s) => s.quote === quote) ?? null;
}

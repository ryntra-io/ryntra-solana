/**
 * Where the coins of a private swap are, read from the chain — never from what the tab remembers. A tab closed, a
 * wallet that froze, a network that dropped one transaction: the answer comes from the three signatures' status on
 * chain and the person's own wallet balance there, so a page opened again later says the same.
 *
 * The one transaction (`plan.ts`, kind `one`) cannot stop half way: it lands whole or not at all. Only the pack can,
 * and only on the person's own wallet — the out step pays the wallet itself, never another address (no mixer here):
 * - out not landed, and it can no longer land → nothing moved, the coins are still in the private balance;
 * - out landed, the swap not → the coin paid with sits on the person's wallet;
 * - the swap landed, the in step not → the coin bought sits on the person's wallet;
 * - all three landed → done; what the route gave above its minimum stays on the wallet (`surplus`).
 * A step still able to land is waited for — a signed transaction is never sent a second time; once its blockhash has
 * expired it never lands, and the person gets one action: «Return to private balance».
 */

/** A signature's state on chain: landed, landed and failed, or not found (yet, or ever once `expired`). */
export type OnChain = 'landed' | 'failed' | 'missing';

export type StepRead = Readonly<{ status: OnChain }>;

/** What the chain says now. `expired` — the pack's blockhash can no longer land anything not yet landed. */
export type ChainRead = Readonly<{
  kind: 'one' | 'pack';
  /** For `one`: only `out` (the one transaction). For `pack`: out, swap, in. */
  out: StepRead;
  swap?: StepRead;
  in?: StepRead;
  expired: boolean;
  /** The person's own wallet now, in the two coins' smallest units (SOL in lamports). */
  wallet: Readonly<{ inMint: bigint; outMint: bigint }>;
  /** What the swap paid the wallet, read from its own transaction on chain; null until it landed or when unreadable. */
  received: bigint | null;
}>;

/** What the pack moved, as built before the signature. Amounts here only cap what the chain says; they never stand in. */
export type PackFacts = Readonly<{
  inMint: string;
  outMint: string;
  /** Paid out of the ring into the wallet, the route's input. */
  outAmount: bigint;
  /** The route's minimum, the in step's amount. */
  inAmount: bigint;
  /** SOL is kept on the wallet for the network's fees when the coin to return is SOL itself. */
  solMint: string;
}>;

/** Kept on the wallet when SOL goes back into the ring: the next steps' network fees. */
export const SOL_FEE_KEEP = 2_000_000n;

export type Where =
  /** Still landing: wait, read again. */
  | Readonly<{ place: 'landing' }>
  /** Nothing left the private balance. */
  | Readonly<{ place: 'private'; done: false }>
  /** Done: the new coin is in the private balance; `surplus` above the minimum stays on the wallet. */
  | Readonly<{ place: 'private'; done: true; surplus: bigint }>
  /** On the person's own wallet: one action — back into the private balance. */
  | Readonly<{ place: 'wallet'; mint: string; amount: bigint }>;

function capped(held: bigint, most: bigint, mint: string, facts: PackFacts): bigint {
  const usable = mint === facts.solMint ? (held > SOL_FEE_KEEP ? held - SOL_FEE_KEEP : 0n) : held;
  return usable < most ? usable : most;
}

const gone = (step: StepRead | undefined, expired: boolean) => step?.status === 'failed' || (step?.status === 'missing' && expired);
const waiting = (step: StepRead | undefined, expired: boolean) => step === undefined || (step.status === 'missing' && !expired);

/** Where the coins are now. */
export function whereAreCoins(read: ChainRead, facts: PackFacts): Where {
  if (read.kind === 'one') {
    if (read.out.status === 'landed') return { place: 'private', done: true, surplus: surplusOf(read, facts) };
    if (gone(read.out, read.expired)) return { place: 'private', done: false };
    return { place: 'landing' };
  }
  if (waiting(read.out, read.expired)) return { place: 'landing' };
  if (gone(read.out, read.expired)) return { place: 'private', done: false };
  // Out landed: the coin paid with is on the wallet until the swap takes it.
  if (waiting(read.swap, read.expired)) return { place: 'landing' };
  if (gone(read.swap, read.expired)) {
    const amount = capped(read.wallet.inMint, facts.outAmount, facts.inMint, facts);
    return amount > 0n ? { place: 'wallet', mint: facts.inMint, amount } : { place: 'private', done: false };
  }
  // The swap landed: the coin bought is on the wallet until the in step takes it.
  if (waiting(read.in, read.expired)) return { place: 'landing' };
  if (gone(read.in, read.expired)) {
    const most = read.received ?? facts.inAmount;
    const amount = capped(read.wallet.outMint, most, facts.outMint, facts);
    return amount > 0n ? { place: 'wallet', mint: facts.outMint, amount } : { place: 'private', done: false };
  }
  return { place: 'private', done: true, surplus: surplusOf(read, facts) };
}

/** What the route gave above the minimum that went back into the ring, still on the wallet. */
export function surplusOf(read: ChainRead, facts: PackFacts): bigint {
  if (read.received === null || read.received <= facts.inAmount) return 0n;
  return capped(read.wallet.outMint, read.received - facts.inAmount, facts.outMint, facts);
}

/** The one action a place offers: nothing, wait, or put this amount of this coin back into the private balance. */
export type Next = Readonly<{ does: 'none' }> | Readonly<{ does: 'wait' }> | Readonly<{ does: 'return'; mint: string; amount: bigint }>;

export function nextOf(where: Where): Next {
  if (where.place === 'landing') return { does: 'wait' };
  if (where.place === 'wallet') return { does: 'return', mint: where.mint, amount: where.amount };
  return { does: 'none' };
}

/**
 * A signature's status as the chain's `getSignatureStatuses` worded it: null — not found; `err` set — landed and
 * failed; anything confirmed or finalized — landed. A status seen only as `processed` is not landed yet.
 */
export function onChainOf(status: Readonly<{ err?: unknown; confirmationStatus?: string | null }> | null | undefined): OnChain {
  if (!status) return 'missing';
  if (status.err !== null && status.err !== undefined) return 'failed';
  return status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized' ? 'landed' : 'missing';
}

/** The pack's record a tab may keep to find its way back — signatures and coins only, nothing the answer trusts. */
export type PackRecord = Readonly<{
  v: 1;
  kind: 'one' | 'pack';
  owner: string;
  signatures: readonly string[];
  lastValidBlockHeight: string;
  facts: Readonly<{ inMint: string; outMint: string; outAmount: string; inAmount: string; solMint: string }>;
}>;

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AMOUNT = /^\d{1,30}$/;

/** A kept record as it was written, or null for anything that does not read as one. */
export function readRecord(text: string | null | undefined): PackRecord | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = raw as Partial<PackRecord> | null;
  if (!r || r.v !== 1 || (r.kind !== 'one' && r.kind !== 'pack')) return null;
  if (typeof r.owner !== 'string' || !ADDRESS.test(r.owner)) return null;
  const wanted = r.kind === 'one' ? 1 : 3;
  if (!Array.isArray(r.signatures) || r.signatures.length !== wanted || !r.signatures.every((s) => typeof s === 'string' && SIGNATURE.test(s))) return null;
  if (typeof r.lastValidBlockHeight !== 'string' || !AMOUNT.test(r.lastValidBlockHeight)) return null;
  const f = r.facts as PackRecord['facts'] | undefined;
  if (!f || ![f.inMint, f.outMint, f.solMint].every((m) => typeof m === 'string' && ADDRESS.test(m)) || ![f.outAmount, f.inAmount].every((a) => typeof a === 'string' && AMOUNT.test(a))) return null;
  return { v: 1, kind: r.kind, owner: r.owner, signatures: [...r.signatures], lastValidBlockHeight: r.lastValidBlockHeight, facts: { ...f } };
}

export function factsOf(record: PackRecord): PackFacts {
  const f = record.facts;
  return { inMint: f.inMint, outMint: f.outMint, outAmount: BigInt(f.outAmount), inAmount: BigInt(f.inAmount), solMint: f.solMint };
}

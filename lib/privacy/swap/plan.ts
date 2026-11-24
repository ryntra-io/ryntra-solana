/**
 * A swap from the private balance — which way it goes. One pure decision, before anything is proved or signed:
 *
 * - **one** — one version 1 transaction: out of the ring → the market route → back into the ring. Either all of it
 *   lands or none of it does; nothing can stop half way. Needs the route without lookup tables (a v1 transaction has
 *   none), all its addresses under v1's 64 beside the ring's own, the bytes under 4 096, the compute under 1 400 000,
 *   and an SDK bundle that can compile such a transaction (`canOne`).
 * - **pack** — three transactions under one wallet approval: out of the ring (v1), the open swap's own exact order
 *   (v0, with its lookup tables, the same bytes and fee as a swap in the open), back into the ring (v1). Sent one after
 *   another; a break between them leaves the coins on the person's own wallet, never anywhere else (`recover.ts`).
 * - **refuse** — said before anything is signed: this pair cannot be swapped privately yet, and why.
 *
 * The facts the numbers stand on — the offline run of the SDK (`docs/research/private-payments-2026-11-19/PROBE-2.md`,
 * point 6; `scripts/privacy/size.mjs` S2, `scripts/privacy/swap-offline.mjs`): out + in together are 1 166 bytes and 11
 * addresses (with a sponsor paying the fee — 1 324 and 12); the SDK sets 450 000 units for a withdrawal and 200 000 for
 * a deposit. The route's own count comes from the open swap's exact bytes (`route.ts`). Whatever this estimates, the
 * compiled transaction is measured again before the wallet sees it; a transaction the SDK refuses as too large goes the
 * pack's way.
 */

/** A version 1 transaction's ceilings (SIMD-0385, as the ring's SDK enforces them). */
export const V1_MAX_BYTES = 4_096;
export const V1_MAX_ADDRESSES = 64;
export const COMPUTE_MAX = 1_400_000;

/** What the SDK sets for each side of the ring's edge (offline run, PROBE-2 point 6). */
export const WITHDRAW_COMPUTE = 450_000;
export const DEPOSIT_COMPUTE = 200_000;
/** A route whose bytes name no compute limit is counted at this until the wallet's simulation says otherwise. */
export const ROUTE_COMPUTE_UNKNOWN = 400_000;

/** Kept free under the byte ceiling: the estimate below is coarse and the compiled bytes are measured again anyway. */
export const BYTES_SPARE = 96;

/** The ring's two sides as built by the SDK for this swap, without the route: their addresses and their bytes. */
export type EdgeShape = Readonly<{ addresses: readonly string[]; bytes: number }>;

/** The market route as the open swap's exact order names it (`route.ts`), compute-budget instructions left out. */
export type RouteShape = Readonly<{
  /** Every static address the route's instructions name, their programs included. */
  addresses: readonly string[];
  /** The route reads accounts from address lookup tables: it cannot stand in a version 1 transaction. */
  tables: boolean;
  /** Each instruction's account count and data length, for the byte estimate. */
  instructions: readonly Readonly<{ accounts: number; data: number }>[];
  /** Every address the route needs a signature from. */
  signers: readonly string[];
  /** The compute limit the open order set (its simulation × 1.2); null when it named none. */
  computeUnits: number | null;
}>;

/** How a coin is held on chain: plain SOL, the classic token program, or Token-2022. */
export type Holding = 'native' | 'classic' | 'token2022';

export type PathInput = Readonly<{
  owner: string;
  inMint: string;
  outMint: string;
  inHolding: Holding;
  outHolding: Holding;
  /** The route's network and the private balance's: a swap never crosses networks. */
  routeChain: string;
  ringChain: string;
  edge: EdgeShape;
  route: RouteShape;
  /** The SDK bundle in this build can compile one transaction of the three parts. */
  canOne: boolean;
  /** The connected wallet signs several transactions in one approval. */
  canPack: boolean;
}>;

export type PackWhy = 'TABLES' | 'ADDRESSES' | 'BYTES' | 'COMPUTE' | 'NO_ONE';

/**
 * Why a pair is refused — each has one line for the person (`terminal/swap/private-words.ts`):
 * - `SAME` — the same coin on both sides;
 * - `ELSEWHERE` — the route is on another network than the private balance (today: the ring is on the test network,
 *   the market's routes on the main one);
 * - `PAIR` — a coin the ring is not yet checked to take back (Token-2022 until the test network says so), or a route
 *   that fits neither way;
 * - `SIGNER` — the route asks a signature from someone other than the person;
 * - `ONE_PROMPT` — the route needs the pack and the wallet cannot sign three transactions in one approval.
 */
export type RefuseCode = 'SAME' | 'ELSEWHERE' | 'PAIR' | 'SIGNER' | 'ONE_PROMPT';

export type Path =
  | Readonly<{ kind: 'one'; computeUnits: number; addresses: number; bytes: number }>
  | Readonly<{ kind: 'pack'; why: PackWhy }>
  | Readonly<{ kind: 'refuse'; code: RefuseCode; why?: PackWhy }>;

/** The addresses of the one transaction: the ring's sides and the route, each counted once. */
export function unionAddresses(edge: EdgeShape, route: RouteShape): number {
  return new Set([...edge.addresses, ...route.addresses]).size;
}

/**
 * The bytes of the one transaction, estimated from above: the ring's sides as compiled, 32 for each address the route
 * adds, and for each route instruction its program index, its account indices with their length, and its data with
 * its length. The compiled transaction is measured again before it is signed.
 */
export function estimateBytes(edge: EdgeShape, route: RouteShape): number {
  const known = new Set(edge.addresses);
  const added = new Set(route.addresses.filter((a) => !known.has(a))).size;
  const instructions = route.instructions.reduce((sum, ix) => sum + 1 + 2 + ix.accounts + 4 + ix.data, 0);
  return edge.bytes + added * 32 + instructions;
}

/** The compute the one transaction asks for: the withdrawal, the route, the deposit. */
export function computeOf(route: RouteShape): number {
  return WITHDRAW_COMPUTE + (route.computeUnits ?? ROUTE_COMPUTE_UNKNOWN) + DEPOSIT_COMPUTE;
}

/** Why the route does not fit one transaction, or null when it does (before the bundle is asked). */
export function oneDoesNotFit(edge: EdgeShape, route: RouteShape): Exclude<PackWhy, 'NO_ONE'> | null {
  if (route.tables) return 'TABLES';
  if (unionAddresses(edge, route) > V1_MAX_ADDRESSES) return 'ADDRESSES';
  if (estimateBytes(edge, route) > V1_MAX_BYTES - BYTES_SPARE) return 'BYTES';
  if (computeOf(route) > COMPUTE_MAX) return 'COMPUTE';
  return null;
}

/** The way this swap goes. */
export function choosePath(input: PathInput): Path {
  if (input.inMint === input.outMint) return { kind: 'refuse', code: 'SAME' };
  if (input.routeChain !== input.ringChain) return { kind: 'refuse', code: 'ELSEWHERE' };
  if (input.inHolding === 'token2022' || input.outHolding === 'token2022') return { kind: 'refuse', code: 'PAIR' };
  if (input.route.signers.some((s) => s !== input.owner)) return { kind: 'refuse', code: 'SIGNER' };
  const misfit = oneDoesNotFit(input.edge, input.route);
  if (!misfit && input.canOne) {
    return { kind: 'one', computeUnits: Math.min(COMPUTE_MAX, computeOf(input.route)), addresses: unionAddresses(input.edge, input.route), bytes: estimateBytes(input.edge, input.route) };
  }
  const why: PackWhy = misfit ?? 'NO_ONE';
  if (input.canPack) return { kind: 'pack', why };
  return { kind: 'refuse', code: 'ONE_PROMPT', why };
}

/**
 * How much goes back into the ring: the route's minimum (`otherAmountThreshold`), known before the signature — a
 * deposit names its amount in its own data. What the route gives above it stays on the person's own wallet, said on
 * screen, and can be added with one more press (`recover.ts`, `surplus`).
 */
export function depositAmount(minOutRaw: string | bigint): bigint {
  const min = BigInt(minOutRaw);
  if (min <= 0n) throw new RangeError('the route promises nothing back');
  return min;
}

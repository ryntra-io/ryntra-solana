/**
 * A stock from the private balance, and a stock pool's income back into it — which way each goes. Pure decisions,
 * before anything is proved or signed. They stand on the private swap's own measures (`../swap/plan.ts`: a version 1
 * transaction's ceilings, what the ring's two sides cost) and add only what a stock changes.
 *
 * **Buy.** Out of the ring → the market route into the stock → the stock on the person's own wallet. There is no step
 * back into the ring: the ring does not take a stock token (`ring-admits.ts`). So:
 * - **one** — one version 1 transaction: the withdrawal and the route. It lands whole or not at all.
 * - **pack** — two transactions under one wallet approval: the withdrawal (v1), then the open order's own exact bytes
 *   (v0, with its lookup tables, Ryntra's fee as in the open). A break between them leaves the coin paid with on the
 *   person's own wallet, never anywhere else (`recover.ts`).
 * - **refuse** — said before anything is signed.
 *
 * **Income.** A stock pool's fees, taken from the person's position, back into the private balance — only the side
 * the ring takes (SOL or USDC); the stock side of the fees stays on the wallet, said on screen. The position and the
 * claim are public as they always are; what changes is that the income does not stay on the wallet.
 * - **one** — the claim's own instructions and the deposit in one version 1 transaction (a claim without lookup
 *   tables, that only the person signs, fitting the ceilings).
 * - **pack** — the claim's transactions as the engine built them, then the deposit (v1), in one approval.
 * - **refuse** — said before anything is signed.
 *
 * The amount that goes into the ring is named before the signature (a deposit carries it in its own data): for a buy,
 * the withdrawal is the route's input; for income, the claimed fees the engine's own Review shows — fees only grow
 * until the claim lands, so the deposit never asks for more than arrives.
 */

import { BYTES_SPARE, COMPUTE_MAX, DEPOSIT_COMPUTE, ROUTE_COMPUTE_UNKNOWN, V1_MAX_ADDRESSES, V1_MAX_BYTES, WITHDRAW_COMPUTE, estimateBytes, unionAddresses, type EdgeShape, type Holding, type PackWhy, type RouteShape } from '../swap/plan.ts';

/** Why a transaction does not fit one v1, or null when it does — the same ceilings as the private swap. */
export function misfitOf(edge: EdgeShape, route: RouteShape, compute: number): Exclude<PackWhy, 'NO_ONE'> | null {
  if (route.tables) return 'TABLES';
  if (unionAddresses(edge, route) > V1_MAX_ADDRESSES) return 'ADDRESSES';
  if (estimateBytes(edge, route) > V1_MAX_BYTES - BYTES_SPARE) return 'BYTES';
  if (compute > COMPUTE_MAX) return 'COMPUTE';
  return null;
}

/* ── buy ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** The compute of one buy transaction: the withdrawal and the route — no deposit. */
export function buyCompute(route: RouteShape): number {
  return WITHDRAW_COMPUTE + (route.computeUnits ?? ROUTE_COMPUTE_UNKNOWN);
}

/** What the issuer's mint says now: paused (every transfer fails), or new accounts start frozen (the stock can't land). */
export type IssuerState = Readonly<{ paused: boolean; frozenByDefault: boolean }>;

export type BuyInput = Readonly<{
  owner: string;
  /** The coin paid with, out of the private balance: SOL or a classic token (USDC). */
  payMint: string;
  payHolding: Holding;
  stockMint: string;
  routeChain: string;
  ringChain: string;
  /** The withdrawal as the SDK built it: its addresses and bytes. Empty before the proof — the early check. */
  edge: EdgeShape;
  route: RouteShape;
  issuer: IssuerState;
  canOne: boolean;
  canPack: boolean;
}>;

/**
 * Why a buy is refused — each has one line for the person (`terminal/stocks/private/words.ts`):
 * - `SAME` — the coin paid with is the stock itself;
 * - `ELSEWHERE` — the route is on another network than the private balance (today: the ring is on the test network);
 * - `PAY` — the coin paid with is not one the private balance is checked to pay out (a Token-2022 coin);
 * - `ISSUER` — the issuer has paused the stock, or a new account in it starts frozen: the stock could not land;
 * - `SIGNER` — the route asks a signature from someone other than the person;
 * - `ONE_PROMPT` — the route needs the pack and the wallet cannot sign two transactions in one approval.
 */
export type BuyRefuse = 'SAME' | 'ELSEWHERE' | 'PAY' | 'ISSUER' | 'SIGNER' | 'ONE_PROMPT';

export type BuyPath =
  | Readonly<{ kind: 'one'; computeUnits: number; addresses: number; bytes: number }>
  | Readonly<{ kind: 'pack'; why: PackWhy }>
  | Readonly<{ kind: 'refuse'; code: BuyRefuse; why?: PackWhy }>;

/** The way this buy goes. */
export function chooseBuyPath(input: BuyInput): BuyPath {
  if (input.payMint === input.stockMint) return { kind: 'refuse', code: 'SAME' };
  if (input.routeChain !== input.ringChain) return { kind: 'refuse', code: 'ELSEWHERE' };
  if (input.payHolding === 'token2022') return { kind: 'refuse', code: 'PAY' };
  if (input.issuer.paused || input.issuer.frozenByDefault) return { kind: 'refuse', code: 'ISSUER' };
  if (input.route.signers.some((s) => s !== input.owner)) return { kind: 'refuse', code: 'SIGNER' };
  const compute = buyCompute(input.route);
  const misfit = misfitOf(input.edge, input.route, compute);
  if (!misfit && input.canOne) {
    return { kind: 'one', computeUnits: Math.min(COMPUTE_MAX, compute), addresses: unionAddresses(input.edge, input.route), bytes: estimateBytes(input.edge, input.route) };
  }
  const why: PackWhy = misfit ?? 'NO_ONE';
  if (input.canPack) return { kind: 'pack', why };
  return { kind: 'refuse', code: 'ONE_PROMPT', why };
}

/** What leaves the private balance: the route's own input, exactly — the withdrawal names it. */
export function buyWithdrawal(inAmountRaw: string | bigint): bigint {
  const amount = BigInt(inAmountRaw);
  if (amount <= 0n) throw new RangeError('the route pays nothing in');
  return amount;
}

/* ── income ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** SOL as a pool names it (wrapped), and as the ring and a wallet name it (the system program). */
export const WSOL = 'So11111111111111111111111111111111111111112';
export const NATIVE_SOL = '11111111111111111111111111111111';

/** USDC on mainnet and on devnet (Circle's test mint): the classic token the ring takes. */
export const USDC_MINTS: readonly string[] = Object.freeze(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU']);

/** The coins a stock pool's income may go back into the private balance in. */
export type BackCoin = 'sol' | 'usdc';

/** Which of the ring's coins a mint is, or null — a stock, or any coin the ring is not checked to take back. */
export function backCoinOf(mint: string, usdc: readonly string[] = USDC_MINTS): BackCoin | null {
  if (mint === WSOL || mint === NATIVE_SOL) return 'sol';
  if (usdc.includes(mint)) return 'usdc';
  return null;
}

/** One side of what the claim pays the person, in the coin's smallest units. */
export type IncomeSide = Readonly<{ mint: string; amount: bigint }>;

/** The engine's Review of a claim (`claimed`) or of a leave with its fees (`feesClaimed`), as amounts. */
export type IncomeShown = Readonly<{ x: IncomeSide; y: IncomeSide }>;

export type IncomeSplit = Readonly<{
  /** What goes back into the private balance: the SOL or USDC side; null when there is none, or nothing to take. */
  back: Readonly<{ mint: string; coin: BackCoin; amount: bigint }> | null;
  /** What stays on the wallet: the stock's side of the fees (and any side the ring does not take). */
  stays: readonly IncomeSide[];
}>;

/** The income split: the ring's coin back in, the stock's part on the wallet. */
export function splitIncome(shown: IncomeShown, usdc: readonly string[] = USDC_MINTS): IncomeSplit {
  const sides = [shown.x, shown.y];
  const ringable = sides.filter((side) => backCoinOf(side.mint, usdc) !== null && side.amount > 0n);
  const first = ringable[0] ?? null;
  const back = first ? { mint: first.mint, coin: backCoinOf(first.mint, usdc) as BackCoin, amount: first.amount } : null;
  const stays = sides.filter((side) => side !== first && side.amount > 0n);
  return { back, stays };
}

/** The claim as its bytes name it, for the path: its shape, whether it unwraps SOL, its count of transactions. */
export type ClaimShape = Readonly<{
  /** The claim's one transaction read as a route (`../swap/route.ts`, `routeOf`); for several, the first. */
  route: RouteShape;
  /** How many transactions the engine built for the claim (DLMM may split a wide range). */
  count: number;
  /** Keys that already signed it — a claim needs none; any is a stranger to this flow. */
  presigned: readonly string[];
  /** For SOL income: the claim closes the wrapped-SOL account into the person's wallet, so the SOL arrives as SOL. */
  unwrapsSol: boolean;
}>;

export type IncomeInput = Readonly<{
  owner: string;
  split: IncomeSplit;
  claim: ClaimShape;
  claimChain: string;
  ringChain: string;
  /** The deposit as the SDK built it: its addresses and bytes. Empty before it is built — the early check. */
  edge: EdgeShape;
  canOne: boolean;
  canPack: boolean;
}>;

/**
 * Why income is refused:
 * - `ELSEWHERE` — the pool is on another network than the private balance;
 * - `COIN` — no side of the income is SOL or USDC, or there is nothing to take; or SOL fees that would arrive wrapped;
 * - `SIGNER` — the claim carries someone else's signature or asks one;
 * - `ONE_PROMPT` — the pack is needed and the wallet cannot sign several transactions in one approval.
 */
export type IncomeRefuse = 'ELSEWHERE' | 'COIN' | 'SIGNER' | 'ONE_PROMPT';

/** Why income takes the pack: the swap's reasons, or `SPLIT` — the engine built the claim as several transactions. */
export type IncomeWhy = PackWhy | 'SPLIT';

export type IncomePath =
  | Readonly<{ kind: 'one'; computeUnits: number; addresses: number; bytes: number }>
  | Readonly<{ kind: 'pack'; why: IncomeWhy }>
  | Readonly<{ kind: 'refuse'; code: IncomeRefuse; why?: IncomeWhy }>;

/** The compute of one income transaction: the claim and the deposit. */
export function incomeCompute(route: RouteShape): number {
  return (route.computeUnits ?? ROUTE_COMPUTE_UNKNOWN) + DEPOSIT_COMPUTE;
}

/** The way this income goes. */
export function chooseIncomePath(input: IncomeInput): IncomePath {
  if (input.claimChain !== input.ringChain) return { kind: 'refuse', code: 'ELSEWHERE' };
  const back = input.split.back;
  if (!back || (back.coin === 'sol' && !input.claim.unwrapsSol)) return { kind: 'refuse', code: 'COIN' };
  if (input.claim.presigned.length > 0 || input.claim.route.signers.some((s) => s !== input.owner)) return { kind: 'refuse', code: 'SIGNER' };
  const compute = incomeCompute(input.claim.route);
  const misfit: IncomeWhy | null = input.claim.count > 1 ? 'SPLIT' : misfitOf(input.edge, input.claim.route, compute);
  if (!misfit && input.canOne) {
    return { kind: 'one', computeUnits: Math.min(COMPUTE_MAX, compute), addresses: unionAddresses(input.edge, input.claim.route), bytes: estimateBytes(input.edge, input.claim.route) };
  }
  const why: IncomeWhy = misfit ?? 'NO_ONE';
  if (input.canPack) return { kind: 'pack', why };
  return { kind: 'refuse', code: 'ONE_PROMPT', why };
}

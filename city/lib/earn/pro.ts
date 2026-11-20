import type { EarnProPier, EarnProPosition, EarnProReviewResponse } from '../../../lib/api/v1/contract.ts';
import { GRID_MAX_RANGES, gridFault, gridRanges } from '../../../lib/core/liquidity-grid.ts';
import { earnProCoins } from '../../../lib/earn-pro/coins.ts';
import type { Holdings } from '../trade/wallet.ts';
import { PIER_GOALS, PIER_STYLES, STYLE_HALF, solShort, unitsShort, zapFit, zapMax, type PierGoal, type PierStyle } from './pier.ts';
import { lamportsFromText } from './saver.ts';

/**
 * The piers of Meteora DLMM Pro in the Earn window.
 *
 * A Pro pier is a pool of SOL against a coin Earn knows, read from the chain by the engine (`/api/v1/earn/pro/**`,
 * `lib/earn-pro/`). To a person it is a pier like any other: the same three widths, the same three goals, an amount in
 * SOL and one action. What is new stands behind it — the position is one NFT that holds the whole shape, the pool's
 * own reward is a second line of income, «take and put back» is one transaction, and an agent may look after it with
 * one approval.
 *
 * **Switch:** `NEXT_PUBLIC_RYNTRA_CITY_EARN_PRO=open` (exactly). Closed, the window asks nothing and draws nothing of
 * it. What is served is the server's own gate: a window that
 * asks a closed server is told so, and stays as it was.
 *
 * Pure: no I/O.
 */

export const EARN_PRO_OPEN = process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN_PRO === 'open';

export type ProPier = EarnProPier;
export type ProBoat = EarnProPosition;
export type ProReview = EarnProReviewResponse;
export type ProSummary = EarnProReviewResponse['summary'];
export type ProAction = EarnProReviewResponse['action'];

/**
 * The least one opening takes — the engine's own (`lib/earn-pro/actions.server.ts`), said before the Review. The most is
 * gone: `PRO_MAX_LAMPORTS` stays only for the frozen city window, which never hears it now.
 */
export const PRO_MIN_LAMPORTS = 50_000_000n;
export const PRO_MAX_LAMPORTS = 10n ** 30n;
/** SOL kept aside for the position's rent (it comes back when the position is closed) and the network. */
export const PRO_RESERVE_LAMPORTS = 60_000_000n;
/** The stops a care may be given: how far under the price now the agent takes everything out; 0 — none. */
export const PRO_STOPS = [0, 10, 25] as const;
export type ProStop = (typeof PRO_STOPS)[number];

export { PIER_GOALS as PRO_GOALS, PIER_STYLES as PRO_STYLES };

/**
 * The terminal's switch for a position in any pool of SOL (MET/SOL and the like), not only against the coins
 * Earn checked: `NEXT_PUBLIC_RYNTRA_EARN_PRO_ANY_POOL=open` (exactly). The server's own switch
 * (`RYNTRA_EARN_PRO_ANY_POOL`) decides what it serves; this one, whether a screen offers it.
 */
export const EARN_PRO_ANY_POOL_OPEN = process.env.NEXT_PUBLIC_RYNTRA_EARN_PRO_ANY_POOL === 'open';

/**
 * The terminal's switch for a position in a pool of SOL against a checked stock of the stocks engine's shelf
 * (Anthropic's ANT was the first): `NEXT_PUBLIC_RYNTRA_EARN_PRO_STOCKS=open` (exactly). The server's own switch
 * (`RYNTRA_EARN_PRO_STOCKS`) decides what it serves and marks such a pier (`stock`); this one, whether a screen offers it.
 */
export const EARN_PRO_STOCKS_OPEN = process.env.NEXT_PUBLIC_RYNTRA_EARN_PRO_STOCKS === 'open';

/** Whether a pier's other coin is a checked stock: its issuer's name, or null. */
export const proStock = (pier: ProPier): string | null => pier.stock?.issuer ?? null;

/** Whether a pier's other coin is one Earn checked — USDC, a staked SOL: there an agent may look after a position. */
export function proKnown(pier: ProPier): boolean {
  const other = proOther(pier).mint;
  return earnProCoins('mainnet').some((coin) => coin.mint === other && coin.kind !== 'sol');
}

/**
 * Whether a screen offers a new position in a pier: a pier of a coin Earn checked always; any other where the terminal's
 * switch is open; a pier of a checked stock where the stocks' switch is. Devnet's stand is offered as served.
 * A position already held is shown wherever it is, whatever this says.
 */
export function proOffered(pier: ProPier, network: 'devnet' | 'mainnet', anyOpen: boolean = EARN_PRO_ANY_POOL_OPEN, stocksOpen: boolean = EARN_PRO_STOCKS_OPEN): boolean {
  return network === 'devnet' || anyOpen || proKnown(pier) || (stocksOpen && proStock(pier) !== null);
}

/** The pier's other coin — the one that is not SOL. */
export const proOther = (pier: ProPier) => (pier.solIsX ? pier.y : pier.x);
export const proSol = (pier: ProPier) => (pier.solIsX ? pier.x : pier.y);

const STAKED = new Set(['JupSOL', 'INF', 'JitoSOL']);
/** A staked SOL against SOL moves little; SOL against dollars swings. */
export const proStaked = (pier: ProPier): boolean => STAKED.has(proOther(pier).symbol);

/** A pier's pair as the list names it: a staked SOL against SOL, or SOL against its other coin. */
export function proName(pier: ProPier): string {
  const other = proOther(pier).symbol;
  return proStaked(pier) ? `${other} · SOL` : `SOL · ${other}`;
}

/** Until the person picks: a pair that moves little stands near the price; SOL against dollars, even. */
export const proDefaultGoal = (pier: ProPier): PierGoal => (proStaked(pier) ? 'near' : 'even');

/** How far a style reaches each side of the price, per cent: its steps of the pool's tick spacing, a tick a ten-thousandth. */
export function proReach(pier: ProPier, style: PierStyle): number {
  return (Math.pow(1.0001, STYLE_HALF[style] * pier.tickSpacing) - 1) * 100;
}

/** A pier's depth in SOL as a short figure; null where the reserves did not read. */
export function proDepth(pier: ProPier): string | null {
  if (pier.depthLamports === null) return null;
  const sol = Number(BigInt(pier.depthLamports)) / 1e9;
  if (sol >= 1e6) return `${(sol / 1e6).toFixed(1)}M`;
  if (sol >= 1e4) return `${Math.round(sol / 1e3)}K`;
  if (sol >= 1e3) return `${(sol / 1e3).toFixed(1)}K`;
  return sol >= 10 ? sol.toFixed(0) : sol.toFixed(1);
}

/** The pool's running reward as «12 USDC a day»'s figure and coin; null where none runs or its coin has no name. */
export function proReward(pier: ProPier): Readonly<{ perDay: string; symbol: string }> | null {
  const reward = pier.rewards.find((entry) => entry.running && entry.symbol !== null);
  if (!reward || reward.symbol === null) return null;
  const decimals = reward.mint === pier.x.mint ? pier.x.decimals : reward.mint === pier.y.mint ? pier.y.decimals : null;
  if (decimals === null) return null;
  return { perDay: unitsShort(BigInt(reward.perDayRaw), decimals), symbol: reward.symbol };
}

export type ProProblem = 'format' | 'min' | 'max' | 'sol';

export type ProChoice = Readonly<{
  lamports: bigint | null;
  problem: ProProblem | null;
  /** The most this wallet may put in now, lamports; null while its SOL is not read. */
  max: bigint | null;
  /** The Review's key for this exact choice, or null when it cannot be asked. */
  key: string | null;
}>;

/** How many ranges a grid of one's own takes at a width — the engine's own count (`lib/core/liquidity-grid.ts`). */
export const proShapeRanges = (shape: readonly number[], style: PierStyle): number => gridRanges(shape, STYLE_HALF[style]);

/**
 * Why a grid of one's own is not one the engine builds — `format`: not 32 columns of 0 to 8 cells; `sides`:
 * not painted on both sides of the price; `detail`: more ranges at this width than a position of one's own takes —
 * or null where it is. The engine refuses the same grids, by the same rule.
 */
export function proShapeFault(shape: readonly number[], style: PierStyle): 'format' | 'sides' | 'detail' | null {
  const fault = gridFault(shape);
  if (fault) return fault;
  return proShapeRanges(shape, style) > GRID_MAX_RANGES ? 'detail' : null;
}

export const proShapeBuilds = (shape: readonly number[], style: PierStyle): boolean => proShapeFault(shape, style) === null;

/**
 * What the card stands on for a typed amount of SOL: whether it is one, within the engine's bounds, and held with the
 * SOL kept aside. `shape` — the person's own grid in place of the goal: it names the Review's key, and a grid
 * the engine does not build asks for no Review (the ticket says why).
 */
export function proChoice(pier: ProPier, style: PierStyle, goal: PierGoal, typed: string, holdings: Holdings | null, owner: string | null, shape: readonly number[] | null = null): ProChoice {
  const lamports = lamportsFromText(typed);
  const held = zapMax(holdings, PRO_RESERVE_LAMPORTS);
  const max = held;
  let problem: ProProblem | null = null;
  if (!lamports) problem = 'format';
  else if (lamports < PRO_MIN_LAMPORTS) problem = 'min';
  else if (!zapFit(lamports, holdings, PRO_RESERVE_LAMPORTS)) problem = 'sol';
  const key = owner && lamports && !problem && !(shape && !proShapeBuilds(shape, style)) ? `pro:open:${owner}:${pier.address}:${style}:${shape ? `custom-${shape.join('')}` : goal}:${lamports}` : null;
  return { lamports, problem, max, key };
}

/** A band of the price in the language-neutral short form: 0.2, 0.06. */
export const bandPct = (bps: number): string => String(Number((bps / 100).toFixed(2)));

/** Raw amounts of a pier's two coins as «0.79 SOL + 114.9 USDC», the empty side left out. */
export function proAmounts(pier: ProPier, xRaw: string, yRaw: string): string {
  const parts: string[] = [];
  if (BigInt(xRaw) > 0n) parts.push(`${unitsShort(BigInt(xRaw), pier.x.decimals)} ${pier.x.symbol}`);
  if (BigInt(yRaw) > 0n) parts.push(`${unitsShort(BigInt(yRaw), pier.y.decimals)} ${pier.y.symbol}`);
  return parts.join(' + ');
}

/** Lamports as a short SOL figure. */
export const proSolText = (lamports: string | number | bigint): string => solShort(typeof lamports === 'bigint' ? lamports : BigInt(lamports));

/** A boat's income in two lines as the card says them: the fees in SOL, and each reward in its own coin. */
export function proIncome(pier: ProPier, boat: ProBoat): Readonly<{ feesLamports: bigint; rewards: readonly Readonly<{ text: string; running: boolean }>[] }> {
  const rewards = boat.rewards.flatMap((reward) => {
    const decimals = reward.mint === pier.x.mint ? pier.x.decimals : reward.mint === pier.y.mint ? pier.y.decimals : null;
    if (decimals === null || reward.symbol === null) return [];
    return [{ text: `${unitsShort(BigInt(reward.accruedRaw), decimals)} ${reward.symbol}`, running: reward.running }];
  });
  return { feesLamports: BigInt(boat.fees.lamports), rewards };
}

/** A price with just enough places to tell a range's two ends apart. */
export function proPrice(value: number): string {
  const places = value >= 1000 ? 0 : value >= 100 ? 1 : value >= 1 ? 3 : 5;
  return value.toLocaleString('en-US', { maximumFractionDigits: places, minimumFractionDigits: 0 });
}

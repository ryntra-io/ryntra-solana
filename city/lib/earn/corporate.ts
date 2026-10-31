/**
 * The corporate-action reader for xStocks (CITY-95): an xStock is a Token-2022 mint with the Scaled UI Amount
 * extension, so its raw balance never moves on a corporate event — the issuer moves a multiplier instead, and a
 * dividend (reinvested into more of the same token) and a split both arrive as a step of it. This reads each step
 * for what it is, so a split is never shown as a dividend:
 *
 * - **split / reverse split** — the step is a clean ratio of small whole numbers (2:1, 3:2, 1:10): the holding is the
 *   same company cut differently, worth the same, and nothing was earned;
 * - **dividend** — a small rise that is no clean ratio (a reinvested payout is a fraction of a per cent to a few per
 *   cent): the difference is the payout in the token's own units;
 * - **unknown** — anything else (a fall that is no reverse split, a jump too large for a payout): shown as a change of
 *   units, never as income.
 *
 * Pure. The steps come from the chain (`stocks.server.ts`: the extension keeps the multiplier before and after its
 * last scheduled change) and are kept on the device as they are seen, so the history grows with every visit.
 */

export type MultiplierStep = Readonly<{
  mint: string;
  /** When the new multiplier took effect, ISO. */
  at: string;
  from: number;
  to: number;
}>;

export type ActionKind = 'dividend' | 'split' | 'reverse-split' | 'unknown';

export type CorporateAction = Readonly<{
  step: MultiplierStep;
  kind: ActionKind;
  /** to / from. */
  ratio: number;
  /** For a split: the ratio in whole numbers, `[2, 1]` for 2-for-1, `[1, 10]` for 1-for-10. */
  parts: readonly [number, number] | null;
}>;

/** A split's numbers are small and whole; past this they are no announcement anybody makes. */
const MAX_PART = 20;
/** How exactly a split's ratio is kept: a multiplier is a float, a split is exact. */
const SPLIT_TOLERANCE = 1e-6;
/** The largest one-step rise a reinvested payout can be: 15 %. Above it, no dividend. */
const MAX_DIVIDEND = 0.15;
/** A split moves the units by at least this much either way (6:5 is the smallest anyone announces). */
const MIN_SPLIT = 1.2;

function cleanRatio(ratio: number): readonly [number, number] | null {
  for (let d = 1; d <= MAX_PART; d += 1) {
    const n = Math.round(ratio * d);
    if (n < 1 || n > MAX_PART || n === d) continue;
    if (Math.abs(ratio - n / d) / (n / d) <= SPLIT_TOLERANCE) {
      // The smallest whole numbers: 4/2 is 2/1.
      let a = n;
      let b = d;
      while (b) [a, b] = [b, a % b];
      return [n / a, d / a];
    }
  }
  return null;
}

export function readAction(step: MultiplierStep): CorporateAction {
  const valid = Number.isFinite(step.from) && Number.isFinite(step.to) && step.from > 0 && step.to > 0;
  const ratio = valid ? step.to / step.from : Number.NaN;
  if (!valid || !Number.isFinite(ratio)) return { step, kind: 'unknown', ratio, parts: null };
  const parts = cleanRatio(ratio);
  if (parts && (ratio >= MIN_SPLIT || ratio <= 1 / MIN_SPLIT)) return { step, kind: ratio > 1 ? 'split' : 'reverse-split', ratio, parts };
  if (ratio > 1 && ratio - 1 <= MAX_DIVIDEND) return { step, kind: 'dividend', ratio, parts: null };
  return { step, kind: 'unknown', ratio, parts: null };
}

/**
 * A dividend in the token's own units for a raw balance held through it: the balance's base amount times the rise of
 * the multiplier. Zero for every other kind — a split adds units and no worth.
 */
export function dividendUnits(action: CorporateAction, raw: bigint, decimals: number): number {
  if (action.kind !== 'dividend' || raw <= 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return 0;
  return (Number(raw) / 10 ** decimals) * (action.step.to - action.step.from);
}

export type DividendLine = Readonly<{
  mint: string;
  /** The dividends of the period in the token's own units, for the balance held now. */
  units: number;
  dividends: number;
  /** Splits and reverse splits of the period, read and left out of the sum. */
  splits: number;
  /** Steps that are neither, left out of the sum. */
  unknown: number;
}>;

/**
 * One stock's dividend line for a period: every dividend step since `sinceMs` on the balance held now. The balance
 * is today's; a balance bought after a step did not earn it, which the window's «i» says.
 */
export function dividendLine(mint: string, steps: readonly MultiplierStep[], raw: bigint, decimals: number, sinceMs: number): DividendLine {
  let units = 0;
  let dividends = 0;
  let splits = 0;
  let unknown = 0;
  for (const step of steps) {
    if (step.mint !== mint) continue;
    const at = Date.parse(step.at);
    if (!Number.isFinite(at) || at < sinceMs) continue;
    const action = readAction(step);
    if (action.kind === 'dividend') {
      dividends += 1;
      units += dividendUnits(action, raw, decimals);
    } else if (action.kind === 'split' || action.kind === 'reverse-split') splits += 1;
    else unknown += 1;
  }
  return { mint, units, dividends, splits, unknown };
}

/**
 * The step the chain shows for a mint, from its Scaled UI Amount configuration: the extension keeps the multiplier
 * before the last scheduled change and the new one with its time, so a change whose time has passed is one step of
 * history. A change still ahead is not history yet; a configuration whose two multipliers agree shows none.
 */
export function stepFromConfig(mint: string, config: Readonly<{ multiplier: number; newMultiplier: number; newMultiplierEffectiveAt: string | null }>, nowMs: number): MultiplierStep | null {
  const at = config.newMultiplierEffectiveAt === null ? Number.NaN : Date.parse(config.newMultiplierEffectiveAt);
  if (!Number.isFinite(at) || at > nowMs) return null;
  if (!(config.multiplier > 0) || !(config.newMultiplier > 0) || config.multiplier === config.newMultiplier) return null;
  return { mint, at: new Date(at).toISOString(), from: config.multiplier, to: config.newMultiplier };
}

/** How many steps a mint keeps on the device. */
const KEEP = 64;

/** Steps seen before and steps read now as one history: one step per mint and time, oldest first. */
export function mergeSteps(known: readonly MultiplierStep[], fresh: readonly MultiplierStep[]): MultiplierStep[] {
  const byKey = new Map<string, MultiplierStep>();
  for (const step of [...known, ...fresh]) {
    if (!readStep(step)) continue;
    byKey.set(`${step.mint}:${step.at}`, step);
  }
  const all = [...byKey.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const perMint = new Map<string, number>();
  const kept: MultiplierStep[] = [];
  for (const step of all.reverse()) {
    const count = perMint.get(step.mint) ?? 0;
    if (count >= KEEP) continue;
    perMint.set(step.mint, count + 1);
    kept.push(step);
  }
  return kept.reverse();
}

/** A step as stored, checked field by field; anything else is no step. */
export function readStep(raw: unknown): MultiplierStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.mint)) return null;
  if (typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) return null;
  if (typeof v.from !== 'number' || typeof v.to !== 'number' || !(v.from > 0) || !(v.to > 0) || !Number.isFinite(v.from) || !Number.isFinite(v.to)) return null;
  return { mint: v.mint, at: v.at, from: v.from, to: v.to };
}

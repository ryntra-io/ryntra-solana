import type {
  LaunchCabinetRow,
  LaunchClaimBuildRequest,
  LaunchClaimBuildResponse,
  LaunchClaimReviewResponse,
  LaunchClaimSubmitRequest,
  LaunchClaimSubmitResponse,
  LaunchCreatorCabinetResponse,
  LaunchMarketResponse,
  LaunchPresetView,
} from '../../../lib/api/v1/contract.ts';
import { engineCall, type Answer } from './engine.ts';

/**
 * «Мій причал» — the creator's berth in the city (L4 · CITY-141, `docs/research/ryntra-launch-2026-10-29/SPEC.md`
 * «Кабінет творця»): what the creator's side of each launch earned by its three streams, «Забрати» through the engine's
 * own claim, the days the tower has stood and its two cards. The city reads and shows; it counts no money of its own:
 * every amount is a program's counter or a claim's receipt as the engine reads them, and every rate is the preset the
 * engine serves. Pure, so the tests read it.
 */

/* ---------------------------------------------------------------- the engine's routes the berth reads */

export interface BerthEngine {
  /** `GET /api/v1/launch/creators/{wallet}` — the wallet's launches, each one's earnings by source, its claim receipts. */
  cabinet(wallet: string): Promise<Answer<LaunchCreatorCabinetResponse>>;
  /** `GET /api/v1/launch/{mint}/market` — read for the graduation's mark on the chart. */
  market(token: string): Promise<Answer<LaunchMarketResponse>>;
  /** `GET /api/v1/launch/{mint}/claim/review?wallet=` — what «Забрати» takes now, before the signature. */
  review(token: string, wallet: string): Promise<Answer<LaunchClaimReviewResponse>>;
  build(token: string, body: LaunchClaimBuildRequest): Promise<Answer<LaunchClaimBuildResponse>>;
  submit(token: string, body: LaunchClaimSubmitRequest): Promise<Answer<LaunchClaimSubmitResponse>>;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The engine over HTTP, on the same origin: the routes every Ryntra client calls. Nothing new on the server. */
export function httpBerthEngine(fetcher: typeof fetch = (input, init) => fetch(input, init)): BerthEngine {
  const call = engineCall(fetcher);
  const refused = <T>(): Promise<Answer<T>> => Promise.resolve({ ok: false, code: 'VALIDATION_ERROR', message: '' });
  const post = <T>(token: string, route: string, body: unknown) =>
    BASE58.test(token) ? call<T>(`/api/v1/launch/${token}/claim/${route}`, { method: 'POST', body: JSON.stringify(body) }) : refused<T>();
  return {
    cabinet: (wallet) => (BASE58.test(wallet) ? call(`/api/v1/launch/creators/${wallet}`) : refused()),
    market: (token) => (BASE58.test(token) ? call(`/api/v1/launch/${token}/market`) : refused()),
    review: (token, wallet) => (BASE58.test(token) && BASE58.test(wallet) ? call(`/api/v1/launch/${token}/claim/review?wallet=${wallet}`) : refused()),
    build: (token, body) => post(token, 'build', body),
    submit: (token, body) => post(token, 'submit', body),
  };
}

/* ---------------------------------------------------------------- amounts */

const TEN = 10n;

/** A raw amount as a number of units, for words only — never sent back to the engine. */
export function unitsOf(raw: string, decimals: number): number {
  const value = BigInt(raw);
  const unit = TEN ** BigInt(decimals);
  return Number(value / unit) + Number(value % unit) / Number(unit);
}

const add = (...raws: readonly string[]) => raws.reduce((sum, raw) => sum + BigInt(raw), 0n).toString();

/** The wallet's part of a figure of the creator's side: all of it, or its share when the fees are shared — rounded down. */
const partOf = (raw: string, shareBps: number) => ((BigInt(raw) * BigInt(shareBps)) / 10_000n).toString();

/* ---------------------------------------------------------------- the three streams */

export type StreamId = 'curve' | 'exit' | 'pool';
export const STREAMS: readonly StreamId[] = ['curve', 'exit', 'pool'];

/**
 * `ahead` — the stream opens at the move to the DEX; `live` — it earns as people trade; `done` — it paid what it will
 * (the curve after the move, the exit fee once taken).
 */
export type StreamState = 'ahead' | 'live' | 'done';

export type Stream = Readonly<{
  id: StreamId;
  /**
   * What the creator's side takes from every $1,000 — of the curve's trading, of what the curve raised at the move, of
   * the pool's trading — at the settled fee of the preset the engine serves; null when the engine did not say.
   */
  per1k: number | null;
  /** The creator's share of the fee the stream is cut from (32 %, 40 %), or for the pool its half of the exit position. */
  shareBps: number | null;
  /** What the wallet's part of the stream earned, and what of it waits for «Забрати»; null when the chain was not read. */
  earnedRaw: string | null;
  unclaimedRaw: string | null;
  state: StreamState;
}>;

/**
 * The three streams' rates by the preset's own terms, per $1,000 in the pair currency:
 * - **curve** — the settled curve fee (after the launch fee has fallen) × the creator's share of it;
 * - **exit** — the fee taken from what the curve raised, at the move to the DEX, × the creator's share;
 * - **pool** — the settled pool fee × the creator's locked position's share of it, which is half of the exit position
 *   (Ryntra's is the other half), for as long as the pool trades.
 * Nothing is rounded into a promise: a share the engine did not serve leaves its rate unsaid.
 */
export function streamRates(preset: LaunchPresetView | null): Readonly<Record<StreamId, Readonly<{ per1k: number | null; shareBps: number | null }>>> {
  if (!preset) return { curve: { per1k: null, shareBps: null }, exit: { per1k: null, shareBps: null }, pool: { per1k: null, shareBps: null } };
  const terms = preset.terms ?? null;
  const per1k = (feeBps: number, shareBps: number) => (1000 * feeBps * shareBps) / 100_000_000;
  const curveShare = terms?.curveSplit.creatorBps ?? null;
  const exitFee = terms?.graduation.feeBps ?? preset.graduationFee.pct * 100;
  const exitShare = terms?.graduation.creatorBps ?? preset.graduationFee.creatorPct * 100;
  const pool = terms?.pool ?? null;
  const positions = pool ? pool.creatorPositionBps + pool.ryntraPositionBps : 0;
  return {
    curve: { per1k: curveShare === null ? null : per1k(preset.sniperFee.endBps, curveShare), shareBps: curveShare },
    exit: { per1k: per1k(exitFee, exitShare), shareBps: exitShare },
    pool: pool && pool.creatorPositionBps > 0 ? { per1k: per1k(pool.endFeeBps, pool.creatorPositionBps), shareBps: Math.round((pool.creatorPositionBps * 10_000) / positions) } : { per1k: null, shareBps: null },
  };
}

/** A launch's three streams: the preset's rates, and what the wallet's part of each earned by the programs' counters. */
export function streamsOf(row: Pick<LaunchCabinetRow, 'earnings' | 'migrated'>, preset: LaunchPresetView | null): readonly Stream[] {
  const rates = streamRates(preset);
  const earnings = row.earnings;
  const share = earnings?.mine.shareBps ?? 10_000;
  const part = (...sources: readonly { earnedRaw: string; unclaimedRaw: string }[]) =>
    earnings ? { earnedRaw: partOf(add(...sources.map((s) => s.earnedRaw)), share), unclaimedRaw: partOf(add(...sources.map((s) => s.unclaimedRaw)), share) } : { earnedRaw: null, unclaimedRaw: null };
  const migrated = row.migrated === true;
  const role = earnings?.role;
  return [
    { id: 'curve', ...rates.curve, ...(role ? part(role.curve) : part()), state: migrated ? 'done' : 'live' },
    /* The exit's one payout: the fee taken at the move, and the creator's part of what the last purchase raised above it. */
    { id: 'exit', ...rates.exit, ...(role ? part(role.graduation, role.surplus) : part()), state: migrated ? 'done' : 'ahead' },
    { id: 'pool', ...rates.pool, ...(role ? part(role.lp) : part()), state: migrated ? 'live' : 'ahead' },
  ];
}

/** The berth's headline for a launch: what the wallet's part earned, has taken, and can take now — or null, not read. */
export type Totals = Readonly<{ earnedRaw: string; claimedRaw: string; unclaimedRaw: string }>;

export function totalsOf(row: Pick<LaunchCabinetRow, 'earnings'>): Totals | null {
  const mine = row.earnings?.mine;
  return mine ? { earnedRaw: mine.earnedRaw, claimedRaw: mine.claimedRaw, unclaimedRaw: mine.unclaimedRaw } : null;
}

/** All the wallet's launches together, per pair currency: the strip's sum when there is more than one launch. */
export function earnedAcross(rows: readonly Pick<LaunchCabinetRow, 'earnings' | 'pair'>[]): ReadonlyMap<string, string> {
  const sums = new Map<string, bigint>();
  for (const row of rows) if (row.earnings) sums.set(row.pair.mint, (sums.get(row.pair.mint) ?? 0n) + BigInt(row.earnings.mine.earnedRaw));
  return new Map([...sums].map(([mint, raw]) => [mint, raw.toString()]));
}

/* ---------------------------------------------------------------- which launch the berth opens on */

/**
 * The launch the berth shows first: the one asked for (a tower's own «Мій причал»), else the one with the most waiting
 * for «Забрати», else the newest.
 */
export function pickLaunch(rows: readonly Pick<LaunchCabinetRow, 'token' | 'claimable' | 'earnings'>[], focus: string | null): string | null {
  if (focus && rows.some((row) => row.token === focus)) return focus;
  let best: { token: string; raw: bigint } | null = null;
  for (const row of rows) {
    if (!row.claimable || !row.earnings) continue;
    const raw = BigInt(row.earnings.mine.unclaimedRaw);
    if (raw > 0n && (!best || raw > best.raw)) best = { token: row.token, raw };
  }
  return best?.token ?? rows[0]?.token ?? null;
}

/* ---------------------------------------------------------------- the day counter */

const DAY = 86_400_000;
export const CHECK_DAYS = [7, 30, 90] as const;
export type CheckDay = (typeof CHECK_DAYS)[number];
export type CheckState = 'alive' | 'quiet' | 'young' | 'unread';

export type DayCount = Readonly<{
  /** Whole days since the launch, as the docks count them. */
  days: number;
  /** On its first day: whole hours, then whole minutes, so the ring never reads «0 days». */
  hours: number;
  minutes: number;
  /** The ring's fill, 0 … 1: the way to day 90. */
  fill: number;
  /** The next check ahead; null past day 90. */
  next: CheckDay | null;
  /** Days 7, 30 and 90 as the engine's survival checks read them: passed with proof, quiet, or still ahead. */
  checks: readonly Readonly<{ days: CheckDay; state: CheckState; at: number }>[];
}>;

/** The tower's days, from its launch and the checks the city's feed already read (`LaunchTower.checks`). */
export function dayCount(launchedAt: string, now: number, checks: readonly string[] | null): DayCount | null {
  const at = Date.parse(launchedAt);
  if (!Number.isFinite(at)) return null;
  const elapsed = Math.max(0, now - at);
  const flown = elapsed / DAY;
  const days = Math.floor(flown);
  return {
    days,
    hours: Math.floor(elapsed / 3_600_000),
    minutes: Math.floor(elapsed / 60_000),
    fill: Math.min(1, flown / CHECK_DAYS[2]),
    next: CHECK_DAYS.find((check) => check > days) ?? null,
    checks: CHECK_DAYS.map((check, index) => {
      const read = checks?.[index];
      const state: CheckState = read === 'alive' || read === 'quiet' || read === 'young' ? read : 'unread';
      return { days: check, state, at: check / CHECK_DAYS[2] };
    }),
  };
}

/* ---------------------------------------------------------------- the two cards */

export type CardId = 'born' | 'graduated';

export type BerthCard = Readonly<{
  id: CardId;
  /** When it happened, ms; null — not yet, or the chain's mark was not read. */
  at: number | null;
  reached: boolean;
  /** Before the move: the curve's way to the DEX, whole per cent. */
  pct: number | null;
  /** Where anyone can see it: the token for «Born», the move's transaction for «Graduated». */
  proof: Readonly<{ kind: 'token' | 'tx'; id: string }> | null;
}>;

/** The move to the DEX as the market's chart marks it: the program's time (unix seconds) and its transaction. */
export function graduationOf(market: Pick<LaunchMarketResponse, 'chart'> | null): Readonly<{ at: number; signature: string }> | null {
  const mark = market?.chart.markers.find((marker) => marker.kind === 'graduated');
  return mark ? { at: mark.t * 1000, signature: mark.signature } : null;
}

/** «Народилась» and «Вийшла»: the launch's two moments, each with when and where it rests on the chain. */
export function cardsOf(row: Pick<LaunchCabinetRow, 'token' | 'launchedAt' | 'migrated' | 'progressBps'>, graduation: Readonly<{ at: number; signature: string }> | null): readonly [BerthCard, BerthCard] {
  const born = Date.parse(row.launchedAt);
  const migrated = row.migrated === true;
  return [
    { id: 'born', at: Number.isFinite(born) ? born : null, reached: true, pct: null, proof: { kind: 'token', id: row.token } },
    {
      id: 'graduated',
      at: migrated ? (graduation?.at ?? null) : null,
      reached: migrated,
      pct: migrated || row.progressBps === null ? null : Math.floor(row.progressBps / 100),
      proof: migrated && graduation ? { kind: 'tx', id: graduation.signature } : null,
    },
  ];
}

/** Where anyone can check a figure: Solscan, on the launch's own cluster. */
export function proofUrl(proof: Readonly<{ kind: 'token' | 'tx'; id: string }>, network: 'solana:devnet' | 'solana:mainnet'): string {
  return `https://solscan.io/${proof.kind === 'tx' ? 'tx' : 'token'}/${proof.id}${network === 'solana:devnet' ? '?cluster=devnet' : ''}`;
}

/* ---------------------------------------------------------------- «Забрати» before the signature */

export type ClaimReady =
  | Readonly<{ can: true; expectedRaw: string; networkLamports: string | null; transactions: number }>
  | Readonly<{ can: false; why: 'nothing' | 'moved' | 'unread' }>;

/**
 * Whether «Забрати» may be pressed now, by the engine's Review: something to take, in transactions the wallet can sign —
 * never when the exit position's NFT went to another wallet (the program would refuse the whole transaction). Without a
 * Review, the cabinet's own flag decides and the build says the rest.
 */
export function claimReady(row: Pick<LaunchCabinetRow, 'claimable' | 'earnings'>, review: LaunchClaimReviewResponse | null): ClaimReady {
  if (review) {
    if (review.blockedBy === 'POSITION_MOVED') return { can: false, why: 'moved' };
    if (!review.transactions.length || BigInt(review.expectedRaw) <= 0n) return { can: false, why: 'nothing' };
    return { can: true, expectedRaw: review.expectedRaw, networkLamports: review.networkCostLamports, transactions: review.transactions.length };
  }
  if (!row.earnings) return { can: false, why: 'unread' };
  const waiting = row.earnings.mine.unclaimedRaw;
  return row.claimable && BigInt(waiting) > 0n ? { can: true, expectedRaw: waiting, networkLamports: null, transactions: 1 } : { can: false, why: 'nothing' };
}

/** The pockets of the Review the berth names behind «i»: every one the launch has, but the curve's leftover tokens, which never come to the creator through Ryntra. */
export function pocketsShown(review: LaunchClaimReviewResponse | null): LaunchClaimReviewResponse['pockets'] {
  return (review?.pockets ?? []).filter((pocket) => pocket.state !== 'NONE' && pocket.pocket !== 'leftover');
}

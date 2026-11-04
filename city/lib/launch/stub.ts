import type {
  LaunchBuildRequest,
  LaunchClaimReviewResponse,
  LaunchCrewsResponse,
  LaunchFlowResponse,
  LaunchMarketResponse,
  LaunchMarketRow,
  LaunchMarketsResponse,
  LaunchPresetsResponse,
  LaunchPresetView,
  LaunchSurvivalResponse,
  LaunchTradeQuoteResponse,
} from '../../../lib/api/v1/contract.ts';
import { CLAIM_POCKETS } from '../../../lib/core/launch/claim-review.ts';
import { checkLaunchForm } from '../../../lib/launch/form.ts';
import type { Answer, LaunchEngine } from './engine.ts';
import type { CityWallet, Connection } from './wallet.ts';

/**
 * A stand-in for the Launch engine and a wallet, for development and tests only: every answer in the shape of the v1
 * contract on the devnet stand, the presets the engine's own (held by `stub.test.mjs`), the coins made up and nothing
 * sent anywhere. Opened with `?launch=stub` in a development build; never part of a production bundle.
 */

const DEVNET_USDC = '9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB';
const PAIR = { mint: DEVNET_USDC, symbol: 'USDC', decimals: 6 } as const;

/** Classic and Protected exactly as the engine serves them on the devnet stand. */
export const STUB_PRESETS: readonly LaunchPresetView[] = [
  {
    id: 'classic',
    name: { uk: 'Класичний', en: 'Classic' },
    pair: PAIR,
    startMarketCapUsd: 5000,
    graduationMarketCapUsd: 75000,
    sniperFee: { startBps: 2000, endBps: 100, seconds: 120 },
    creatorTradingFeePct: 40,
    graduationFee: { pct: 2, creatorPct: 40 },
    firstBuyCapBps: 500,
    creatorLockMinDays: null,
    graduationQuote: null,
    technicalValidation: false,
    lpLockedForeverPct: 100,
    terms: {
      curveSplit: { creatorBps: 3200, ryntraBps: 4800, meteoraBps: 2000 },
      curveSplitThroughRyntra: { creatorBps: 3200, ryntraBps: 5200, meteoraBps: 1600 },
      graduation: { feeBps: 200, creatorBps: 4000, ryntraBps: 6000, toBudget: false },
      pool: { startFeeBps: 200, endFeeBps: 50, meteoraBps: 2000, compoundingBps: 4000, creatorPositionBps: 2000, ryntraPositionBps: 2000 },
    },
  },
  {
    id: 'protected',
    name: { uk: 'Захищений', en: 'Protected' },
    pair: PAIR,
    startMarketCapUsd: 5000,
    graduationMarketCapUsd: 75000,
    sniperFee: { startBps: 5000, endBps: 100, seconds: 600 },
    creatorTradingFeePct: 40,
    graduationFee: { pct: 2, creatorPct: 40 },
    firstBuyCapBps: 200,
    creatorLockMinDays: null,
    graduationQuote: null,
    technicalValidation: false,
    lpLockedForeverPct: 100,
    terms: {
      curveSplit: { creatorBps: 3200, ryntraBps: 4800, meteoraBps: 2000 },
      curveSplitThroughRyntra: { creatorBps: 3200, ryntraBps: 5200, meteoraBps: 1600 },
      graduation: { feeBps: 200, creatorBps: 4000, ryntraBps: 6000, toBudget: false },
      pool: { startFeeBps: 200, endFeeBps: 50, meteoraBps: 2000, compoundingBps: 4000, creatorPositionBps: 2000, ryntraPositionBps: 2000 },
    },
  },
];

export const STUB_PRESETS_ANSWER: LaunchPresetsResponse = {
  network: 'solana:devnet',
  presets: [...STUB_PRESETS],
  locks: [
    { id: '1m-3m', cliffDays: 30, vestDays: 90 },
    { id: '3m-6m', cliffDays: 90, vestDays: 180 },
    { id: '6m-12m', cliffDays: 180, vestDays: 365 },
  ],
  limits: { nameMax: 32, symbolMax: 10, descriptionMax: 280, imageMaxBytes: 262144, imageTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], launchesPerDay: 3 },
};

/* ---------------------------------------------------------------- made-up addresses */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Bytes as base58, the way Solana writes addresses and signatures. */
export function base58(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let zeros = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    zeros += '1';
  }
  return zeros + digits.reverse().map((digit) => ALPHABET[digit]).join('');
}

/** `length` bytes that follow from `seed`, the same every time. */
export function seededBytes(seed: string, length: number): Uint8Array {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) + i;
    out[i] = (h >>> 16) & 0xff;
  }
  out[0] = out[0]! | 1;
  return out;
}

export const stubAddress = (seed: string) => base58(seededBytes(`address:${seed}`, 32));
export const stubSignature = (seed: string) => base58(seededBytes(`signature:${seed}`, 64));
const hex = (seed: string, length: number) => Array.from(seededBytes(`hex:${seed}`, length / 2), (byte) => byte.toString(16).padStart(2, '0')).join('');
const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/* ---------------------------------------------------------------- the made-up market of the stand */

const MINUTE = 60_000;
const DAY = 86_400_000;

/** A launch of the stub's stand: what the engine's list and reads would say of it. */
type StubLaunch = Readonly<{ token: string; name: string; symbol: string; launchedAt: number; creator: string; progressBps: (now: number) => number; migrated: boolean; holders: number; checks: readonly ('young' | 'alive' | 'quiet')[]; liquidityUsd: number | null; hidden?: boolean; preset?: 'classic' | 'protected'; locked?: boolean; sold?: boolean }>;

/** The stand's youngest coin is always in the last two minutes of its launch fee's fall, so the fee is seen falling live. */
const YOUNG_CYCLE = 2 * MINUTE;

/** The stand's coins. Spark and Moth are the stub wallet's own, so «Мій причал» (CITY-141) has a test launch on the curve and one in its pool. */
function standLaunches(now: number): StubLaunch[] {
  const at = (ago: number) => now - ago;
  return [
    { token: stubAddress('SPARK'), name: 'Spark', symbol: 'SPARK', launchedAt: now - 8 * MINUTE - (now % YOUNG_CYCLE), creator: STUB_CREATOR, progressBps: () => 4215, migrated: false, holders: 58, checks: ['young', 'young', 'young'], liquidityUsd: null },
    { token: stubAddress('NOVA'), name: 'Nova', symbol: 'NOVA', launchedAt: at(3 * 3600_000), creator: stubAddress('creator:nova'), progressBps: () => 6200, migrated: false, holders: 41, checks: ['young', 'young', 'young'], liquidityUsd: null, preset: 'classic', locked: true },
    { token: stubAddress('KITE'), name: 'Kite', symbol: 'KITE', launchedAt: at(42 * MINUTE), creator: stubAddress('creator:kite'), progressBps: () => 2500, migrated: false, holders: 37, checks: ['young', 'young', 'young'], liquidityUsd: null, preset: 'classic', sold: true },
    { token: stubAddress('MOTH'), name: 'Moth', symbol: 'MOTH', launchedAt: at(12 * DAY), creator: STUB_CREATOR, progressBps: () => 10_000, migrated: true, holders: 214, checks: ['alive', 'young', 'young'], liquidityUsd: 31_200, preset: 'classic', locked: true },
    { token: stubAddress('OWL'), name: 'Night Owl', symbol: 'OWL', launchedAt: at(96 * DAY), creator: stubAddress('creator:owl'), progressBps: () => 10_000, migrated: true, holders: 862, checks: ['alive', 'alive', 'alive'], liquidityUsd: 88_400, sold: true },
    { token: stubAddress('DUSK'), name: 'Dusk', symbol: 'DUSK', launchedAt: at(9 * DAY), creator: stubAddress('creator:dusk'), progressBps: () => 800, migrated: false, holders: 6, checks: ['quiet', 'young', 'young'], liquidityUsd: null, sold: true },
    /* Two graduations below the city's rule (CITY-144): one filled its curve in minutes, one with too few buyers. */
    { token: stubAddress('ZIP'), name: 'Zipline', symbol: 'ZIP', launchedAt: at(2 * DAY), creator: stubAddress('creator:zip'), progressBps: () => 10_000, migrated: true, holders: 64, checks: ['young', 'young', 'young'], liquidityUsd: 22_800, sold: true },
    { token: stubAddress('REEF'), name: 'Reef', symbol: 'REEF', launchedAt: at(10 * DAY), creator: stubAddress('creator:reef'), progressBps: () => 10_000, migrated: true, holders: 140, checks: ['alive', 'young', 'young'], liquidityUsd: 26_500, preset: 'classic', locked: true },
    /* A coin Ryntra took down: its tower stands without its picture, the chain keeps it. */
    { token: stubAddress('GLNT'), name: 'Glint', symbol: 'GLNT', launchedAt: at(5 * 3600_000), creator: stubAddress('creator:glint'), progressBps: () => 3400, migrated: false, holders: 19, checks: ['young', 'young', 'young'], liquidityUsd: null, hidden: true },
  ];
}

const iso = (ms: number) => new Date(ms).toISOString();

/** The curve's market cap at a share of its way, for the stand's made-up reads: from the preset's start to its exit. */
function capAt(bps: number, preset: LaunchPresetView): number {
  return Math.round(preset.startMarketCapUsd + ((preset.graduationMarketCapUsd - preset.startMarketCapUsd) * bps) / 10_000);
}

/** The curve's fee for a buy now: the preset's falling fee for snipers in its first minutes, a straight line on the stand. */
function curveFeeAt(launch: StubLaunch, now: number, preset: LaunchPresetView): NonNullable<LaunchMarketResponse['curveFee']> {
  const { startBps, endBps, seconds } = preset.sniperFee;
  const until = launch.launchedAt + seconds * 1000;
  if (now >= until) return { nowBps: endBps, endBps, sniperUntil: null };
  const gone = Math.max(0, (now - launch.launchedAt) / (seconds * 1000));
  return { nowBps: Math.round(startBps - (startBps - endBps) * gone), endBps, sniperUntil: iso(until) };
}

function rowOf(launch: StubLaunch, now: number): LaunchMarketRow {
  const bps = launch.progressBps(now);
  return {
    token: launch.token,
    name: launch.name,
    symbol: launch.symbol,
    image: null,
    preset: launch.preset ?? 'protected',
    launchedAt: iso(launch.launchedAt),
    creator: launch.creator,
    technicalValidation: false,
    pair: { ...PAIR, dollar: true },
    read: true,
    state: { code: launch.migrated ? 'CORE_MARKET_LIVE' : 'PRICE_DISCOVERY', since: iso(launch.launchedAt) },
    venue: launch.migrated ? 'pool' : 'curve',
    progress: { bps, migrated: launch.migrated },
    poolLiquidity: launch.migrated && launch.liquidityUsd !== null ? { pair: launch.liquidityUsd, usd: launch.liquidityUsd } : null,
    budget: { state: 'NOT_COUNTED', earnedRaw: null, reserveRaw: null, ladder: 'NONE', deployed: null },
    depth5Raw: null,
    daysSinceDex: launch.migrated ? Math.max(0, Math.floor((now - launch.launchedAt) / DAY) - 1) : null,
    traded24h: !launch.checks.includes('quiet'),
    holders: launch.holders,
    holdersAtLeast: false,
    creatorLock: launch.locked ? { escrow: stubAddress(`lock:${launch.token}`), cliffAt: null, endsAt: null } : null,
    creatorSold: launch.sold === true,
    ...(launch.hidden ? { hidden: true as const } : {}),
    observedAt: iso(now),
  };
}

function marketOf(launch: StubLaunch, now: number, preset: LaunchPresetView): LaunchMarketResponse {
  const bps = launch.progressBps(now);
  const cap = launch.migrated ? Math.round(preset.graduationMarketCapUsd * 1.6) : capAt(bps, preset);
  const supply = 1_000_000_000;
  return {
    network: 'solana:devnet',
    token: launch.token,
    venue: launch.migrated ? 'pool' : 'curve',
    pair: { ...PAIR, dollar: true },
    supplyRaw: String(supply * 1_000_000),
    tokenDecimals: 6,
    price: { pair: cap / supply, usd: cap / supply },
    marketCap: { pair: cap, usd: cap },
    sinceLaunchBps: Math.round((cap / preset.startMarketCapUsd - 1) * 10_000),
    liquidity: { pair: launch.liquidityUsd ?? Math.round(cap / 8), usd: launch.liquidityUsd ?? Math.round(cap / 8) },
    volume24h: { pair: 0, usd: 0, complete: true },
    progress: { bps, migrated: launch.migrated, reserveRaw: '0', thresholdRaw: '0' },
    curveFee: launch.migrated ? null : curveFeeAt(launch, now, preset),
    holders: { count: launch.holders, atLeast: false, rows: [], groups: { creatorBps: 0, snipers: null, bundle: null, top10Bps: 0 } },
    trades: standTrades(launch, preset),
    /* The move to the DEX a day after the launch, as the engine marks it on the chart. */
    chart: { points: [], markers: launch.migrated ? [{ t: Math.floor((launch.launchedAt + DAY) / 1000), kind: 'graduated', signature: stubSignature(`graduated:${launch.token}`) }] : [] },
    risk: [],
    creator: { address: launch.creator, curves: null, tradesComplete: true },
    trading: { venue: launch.migrated ? 'pool' : 'curve', pool: stubAddress(`pool:${launch.token}`), referral: true, jupiter: false },
    observedAt: iso(now),
  };
}

/**
 * The stand's made-up trades of a coin, newest first. Night Owl's carry the stub wallet's own buy 42 seconds after its
 * birth, under the launch fee, so the stand can sell it in the pool and show the round trip's card (CITY-145); the
 * other wallets' trades are there so the card is seen to count only the wallet's own.
 */
function standTrades(launch: StubLaunch, preset: LaunchPresetView): LaunchMarketResponse['trades'] {
  if (launch.symbol !== 'OWL') return { rows: [], complete: true, read: 0 };
  const row = (seed: string, at: number, side: 'buy' | 'sell', venue: 'curve' | 'pool', trader: string, pairUsd: number, capUsd: number, feeBps: number): LaunchMarketResponse['trades']['rows'][number] => {
    const net = side === 'buy' ? pairUsd * (1 - feeBps / 10_000) : pairUsd / (1 - feeBps / 10_000);
    return {
      signature: stubSignature(`trade:${launch.token}:${seed}`),
      at: iso(at),
      side,
      venue,
      trader,
      payer: trader,
      traderLabels: [],
      tokensRaw: String(Math.floor((net / (capUsd / 1_000_000_000)) * 1_000_000)),
      pairRaw: String(Math.round(pairUsd * 1_000_000)),
      feeRaw: String(Math.round(Math.abs(net - pairUsd) * 1_000_000)),
      marketCapPair: capUsd,
    };
  };
  const birth = launch.launchedAt + 42_000;
  const fee = curveFeeAt(launch, birth, preset).nowBps ?? preset.sniperFee.endBps;
  const exit = launch.launchedAt + DAY;
  const pool = Math.round(preset.graduationMarketCapUsd * 1.6);
  return {
    rows: [
      row('d', exit + 40 * DAY, 'sell', 'pool', stubAddress('trader:owl:2'), 412.5, pool, 70),
      row('c', exit + 2 * DAY, 'buy', 'pool', stubAddress('trader:owl:3'), 150, pool * 0.9, 70),
      row('b', birth + 9 * 60_000, 'buy', 'curve', stubAddress('trader:owl:2'), 40, preset.startMarketCapUsd * 1.4, 100),
      row('a', birth, 'buy', 'curve', STUB_CREATOR, 25, preset.startMarketCapUsd * 1.02, fee),
    ],
    complete: true,
    read: 4,
  };
}

function survivalOf(launches: readonly StubLaunch[], now: number): LaunchSurvivalResponse {
  const tally = { eligible: 0, alive: 0, quiet: 0, unread: 0 };
  return {
    network: 'solana:devnet',
    windowDays: 7,
    horizons: [
      { days: 7, people: tally, ryntra: tally },
      { days: 30, people: tally, ryntra: tally },
      { days: 90, people: tally, ryntra: tally },
    ],
    markets: launches.map((launch) => ({
      token: launch.token,
      symbol: launch.symbol,
      launchedAt: iso(launch.launchedAt),
      own: false,
      outcomes: ([7, 30, 90] as const).map((days, index) => {
        const state = launch.checks[index] ?? 'young';
        return { days, state, proof: state === 'alive' ? { signature: stubSignature(`${launch.token}:${days}`), at: iso(launch.launchedAt + days * DAY - DAY) } : null };
      }) as LaunchSurvivalResponse['markets'][number]['outcomes'],
    })),
    listedAll: true,
    ownWalletsComplete: true,
    complete: true,
    observedAt: iso(now),
  };
}

/** What the stand's flow says of each made-up launch: the launch slot, the creator's strip, the buyers and the past coins. */
type StubFlow = Readonly<{
  slotBuys: number;
  slotBps: number;
  bundles: number;
  boughtBps: number;
  soldOfBoughtBps: number | null;
  holdsBps: number;
  linked: number;
  buyers: number;
  independent: number;
  /** A graduation on one buy. */
  alone: boolean;
  /** The creator's earlier coins: survived, quiet, too young. */
  past: readonly ('alive' | 'quiet' | 'young')[];
  /** The day-7 proof was a trade of the creator's own party. */
  ownProof: boolean;
  /** Minutes from the creation to the graduation; twenty hours when not said. */
  curveMinutes?: number;
}>;

const STAND_FLOWS: Readonly<Record<string, StubFlow>> = {
  NOVA: { slotBuys: 3, slotBps: 410, bundles: 1, boughtBps: 120, soldOfBoughtBps: null, holdsBps: 120, linked: 2, buyers: 29, independent: 17, alone: false, past: ['alive', 'quiet'], ownProof: false },
  KITE: { slotBuys: 0, slotBps: 0, bundles: 0, boughtBps: 80, soldOfBoughtBps: 5000, holdsBps: 40, linked: 0, buyers: 31, independent: 26, alone: false, past: [], ownProof: false },
  MOTH: { slotBuys: 1, slotBps: 90, bundles: 0, boughtBps: 200, soldOfBoughtBps: null, holdsBps: 200, linked: 0, buyers: 188, independent: 141, alone: false, past: ['alive'], ownProof: false },
  OWL: { slotBuys: 0, slotBps: 0, bundles: 0, boughtBps: 150, soldOfBoughtBps: 10_000, holdsBps: 0, linked: 0, buyers: 702, independent: 515, alone: false, past: ['alive', 'alive', 'young'], ownProof: false },
  DUSK: { slotBuys: 5, slotBps: 1180, bundles: 2, boughtBps: 300, soldOfBoughtBps: 7500, holdsBps: 75, linked: 4, buyers: 6, independent: 2, alone: false, past: ['quiet', 'quiet', 'quiet'], ownProof: true },
  ZIP: { slotBuys: 4, slotBps: 960, bundles: 1, boughtBps: 250, soldOfBoughtBps: 10_000, holdsBps: 0, linked: 3, buyers: 12, independent: 5, alone: true, past: ['quiet'], ownProof: false, curveMinutes: 4 },
  REEF: { slotBuys: 0, slotBps: 0, bundles: 0, boughtBps: 90, soldOfBoughtBps: null, holdsBps: 90, linked: 1, buyers: 47, independent: 31, alone: false, past: [], ownProof: true, curveMinutes: 95 },
};

function flowOf(launch: StubLaunch, now: number): LaunchFlowResponse {
  const f = STAND_FLOWS[launch.symbol] ?? { slotBuys: 0, slotBps: 0, bundles: 0, boughtBps: 0, soldOfBoughtBps: null, holdsBps: 0, linked: 0, buyers: 0, independent: 0, alone: false, past: [], ownProof: false };
  const createdAt = Math.floor(launch.launchedAt / 1000);
  const slot = 300_000_000 + (createdAt % 1_000_000);
  const sigs = (seed: string, count: number) => Array.from({ length: Math.min(count, 20) }, (_, i) => stubSignature(`${launch.token}:${seed}:${i}`));
  const groups = Array.from({ length: f.bundles }, (_, i) => ({
    slot: slot + i * 7,
    at: iso(launch.launchedAt + i * 3_000),
    wallets: i === 0 ? Math.max(2, f.slotBuys) : 2,
    buys: i === 0 ? Math.max(2, f.slotBuys) : 2,
    supplyBps: i === 0 ? f.slotBps : 160,
    why: (i === 0 ? ['launch_slot', 'same_payer'] : ['same_cluster']) as LaunchFlowResponse['bundles']['groups'][number]['why'],
    signatures: sigs(`bundle${i}`, 2),
  }));
  const graduatedAt = launch.migrated ? launch.launchedAt + (f.curveMinutes ?? 20 * 60) * MINUTE : null;
  return {
    network: 'solana:devnet',
    token: launch.token,
    creator: launch.creator,
    rules: { version: 'launch-flow-1.0.0', floorUsd: 1, singleTradeBps: 5000, hops: 2 },
    launchSlot: { slot, at: iso(launch.launchedAt), buys: f.slotBuys, wallets: f.slotBuys, supplyBps: f.slotBps, signatures: sigs('slot', f.slotBuys) },
    bundles: { groups, count: groups.length, wallets: groups.reduce((total, group) => total + group.wallets, 0), supplyBps: groups.reduce((total, group) => total + group.supplyBps, 0), holdsBps: Math.round(f.slotBps / 2), complete: true },
    dev: {
      wallet: launch.creator,
      boughtBps: f.boughtBps,
      soldBps: f.soldOfBoughtBps === null ? 0 : Math.round((f.boughtBps * f.soldOfBoughtBps) / 10_000),
      soldOfBoughtBps: f.soldOfBoughtBps,
      sales: f.soldOfBoughtBps === null ? 0 : 2,
      lastSale: f.soldOfBoughtBps === null ? null : { signature: stubSignature(`${launch.token}:sale`), at: iso(launch.launchedAt + 40 * MINUTE) },
      holdsBps: f.holdsBps,
      linked: { wallets: f.linked, boughtBps: f.linked * 60, holdsBps: f.linked * 40 },
      complete: true,
    },
    buyers: { wallets: f.buyers, independent: f.independent, merged: Math.max(0, f.buyers - f.independent - f.linked - 1), creatorLinked: f.linked, unknown: 1, roundTrips: 0, atLeast: true },
    graduation: {
      graduated: launch.migrated,
      at: graduatedAt === null ? null : iso(graduatedAt),
      signature: graduatedAt === null ? null : stubSignature(`${launch.token}:graduation`),
      buyers: launch.migrated ? { wallets: Math.round(f.buyers * 0.7), independent: Math.round(f.independent * 0.7) } : null,
      largestBuy: { signature: stubSignature(`${launch.token}:largest`), thresholdBps: f.alone ? 6200 : 800 },
      singleTrade: launch.migrated && f.alone,
      complete: true,
    },
    survival: ([7, 30, 90] as const).map((days, index) => {
      const state = launch.checks[index] ?? 'young';
      return { days, state, proof: state === 'alive' ? { signature: stubSignature(`${launch.token}:${days}`), at: iso(launch.launchedAt + days * DAY - DAY) } : null, independent: state === 'alive' ? !(f.ownProof && index === 0) : null };
    }) as LaunchFlowResponse['survival'],
    creatorRecord: {
      launches: f.past.map((state, i) => ({
        token: stubAddress(`past:${launch.symbol}:${i}`),
        symbol: `${launch.symbol.slice(0, 3)}${i + 1}`,
        launchedAt: iso(launch.launchedAt - (i + 1) * 40 * DAY),
        link: i === 1 ? ('same_cluster' as const) : ('same_wallet' as const),
        outcomes: ([7, 30, 90] as const).map((days) => ({ days, state: state === 'young' ? ('young' as const) : days === 7 ? ('alive' as const) : state })),
        survived: state === 'young' ? null : state === 'alive',
      })) as LaunchFlowResponse['creatorRecord']['launches'],
      count: f.past.length,
      judged: f.past.filter((state) => state !== 'young').length,
      survived: f.past.filter((state) => state === 'alive').length,
      complete: true,
    },
    complete: false,
    observedAt: iso(now),
  };
}

/** What the stand's creators find waiting for them: 12.48 USDC of the curve's fees. */
export const STUB_CLAIM_RAW = '12480000';

/**
 * A made-up quote at the curve's price now: a 1 % fee, the price moved by the size of the trade. The figures only look
 * like the engine's; the stand counts nothing that matters.
 */
function quoteOf(launch: StubLaunch, side: 'buy' | 'sell', amountRaw: string, slippageBps: number, now: number): LaunchTradeQuoteResponse {
  const cap = launch.migrated ? 120_000 : capAt(launch.progressBps(now), STUB_PRESETS[1]!);
  /* Raw tokens (6 decimals) per raw USDC (6 decimals): supply over the market cap. */
  const perPair = 1_000_000_000 / cap;
  const amount = BigInt(amountRaw);
  const fee = amount / 100n;
  const net = Number(amount - fee);
  const out = BigInt(Math.floor(side === 'buy' ? net * perPair : net / perPair));
  const minimum = (out * BigInt(10_000 - slippageBps)) / 10_000n;
  return {
    venue: launch.migrated ? 'pool' : 'curve',
    side,
    amountInRaw: amount.toString(),
    amountOutRaw: out.toString(),
    minimumOutRaw: minimum.toString(),
    amountLeftRaw: '0',
    slippageBps,
    feeBps: 100,
    fee: { totalRaw: fee.toString(), creatorRaw: launch.migrated ? null : ((fee * 32n) / 100n).toString(), ryntraRaw: ((fee * 48n) / 100n).toString(), meteoraRaw: ((fee * 20n) / 100n).toString(), liquidityRaw: launch.migrated ? '0' : null },
    priceMoveBps: Math.min(5_000, Math.round(Number(amount) / 10_000)),
    marketCapAfter: { pair: cap, usd: cap },
    referral: true,
    observedAt: iso(now),
    /* The stand has no risk engine: its verdict says nothing was read. */
    tradeRisk: { verdict: 'INCOMPLETE', findings: [] } as unknown as LaunchTradeQuoteResponse['tradeRisk'],
  };
}

function claimReviewOf(launch: StubLaunch, wallet: string, waitingRaw: string, now: number): LaunchClaimReviewResponse {
  const some = waitingRaw !== '0';
  return {
    network: 'solana:devnet',
    token: launch.token,
    wallet,
    pair: { ...PAIR, dollar: true },
    shared: false,
    claimsV2: false,
    pockets: CLAIM_POCKETS.map((pocket) => ({ pocket, state: pocket === 'curve' && some ? 'IN_CLAIM' : 'EMPTY', amountRaw: pocket === 'curve' ? waitingRaw : null, transaction: pocket === 'curve' && some ? 1 : null, holder: null })),
    blockedBy: null,
    transactions: some ? [{ index: 1, sources: ['curve'], payout: false }] : [],
    expectedRaw: waitingRaw,
    networkCostLamports: some ? '5000' : null,
    surplus: null,
    position: null,
    lock: null,
    observedAt: iso(now),
  };
}

/* ---------------------------------------------------------------- the engine */

export type StubOptions = Readonly<{
  /** How long each answer takes, so every step of the flow can be seen. */
  delayMs?: number;
  now?: () => number;
  /** Answers to give instead, by route, once each: `{ build: { ok: false, code: 'LAUNCH_PAUSED', message: '' } }`. */
  refuse?: Partial<Record<keyof LaunchEngine, Answer<never>>>;
}>;

export type StubEngine = LaunchEngine & Readonly<{ calls: string[] }>;

export function stubEngine(options: StubOptions = {}): StubEngine {
  const now = options.now ?? Date.now;
  /* Sending takes as long as Solana takes to confirm, a few seconds; every other answer is quick. */
  const wait = (route: keyof LaunchEngine) => new Promise<void>((resolve) => setTimeout(resolve, (options.delayMs ?? 0) * (route === 'submit' || route === 'tradeSubmit' || route === 'claimSubmit' ? 5 : 1)));
  const refuse = { ...(options.refuse ?? {}) };
  const calls: string[] = [];
  const builds = new Map<string, { request: LaunchBuildRequest; token: string; wire: string; name: string; symbol: string; used: boolean }>();
  /* Trades and claims built on the stand: their bytes, who may send them, what they move. */
  const deals = new Map<string, { token: string; wallet: string; wires: string[]; side: 'buy' | 'sell' | 'claim'; inRaw: string; outRaw: string; used: boolean }>();
  /* What the stub wallet holds of each coin, raw, and what the stand's creators have claimed. */
  const held = new Map<string, bigint>();
  const claimed = new Set<string>();
  const metadata = new Map<string, { name: string; symbol: string }>();
  const made: StubLaunch[] = [];
  const preset = STUB_PRESETS[1]!;
  const all = () => [...made, ...standLaunches(now())];

  async function answer<T>(route: keyof LaunchEngine, make: () => Answer<T>): Promise<Answer<T>> {
    calls.push(route);
    await wait(route);
    const refused = refuse[route];
    if (refused) {
      delete refuse[route];
      return refused;
    }
    return make();
  }

  return {
    calls,
    presets: () => answer('presets', () => ({ ok: true, data: STUB_PRESETS_ANSWER })),
    metadata: (body) =>
      answer('metadata', () => {
        const check = checkLaunchForm(body);
        if (check.hits.length) return { ok: false, code: 'LAUNCH_NAME_BORROWED', message: `The name or ticker reads as ${check.hits.map((hit) => hit.label).join(', ')}.` };
        const problem = Object.entries(check.problems)[0];
        if (problem) return { ok: false, code: 'VALIDATION_ERROR', message: `${problem[0]}: ${problem[1]}` };
        if (!body.imageBase64) return { ok: false, code: 'LAUNCH_IMAGE_INVALID', message: 'The picture is not a PNG, JPEG, WebP or GIF.' };
        const sha = hex(`${body.name}:${body.symbol}:${body.imageBase64.length}`, 64);
        metadata.set(sha, { name: check.clean.name, symbol: check.clean.symbol });
        return { ok: true, data: { metadataUri: `https://stand.example.org/api/launch/metadata/${sha}`, imageUrl: `https://stand.example.org/api/launch/image/${hex(`image:${sha}`, 64)}`, name: check.clean.name, symbol: check.clean.symbol } };
      }),
    build: (body) =>
      answer('build', () => {
        const words = metadata.get(body.metadataUri.split('/').pop() ?? '');
        if (!words) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No metadata by that address.' };
        if (!STUB_PRESETS.some((entry) => entry.id === body.preset)) return { ok: false, code: 'VALIDATION_ERROR', message: 'preset: not on this network' };
        const buildId = hex(`build:${builds.size}:${now()}`, 32);
        const token = stubAddress(`mint:${buildId}`);
        const wire = toBase64(seededBytes(`wire:${buildId}`, 96));
        builds.set(buildId, { request: body, token, wire, name: words.name, symbol: words.symbol, used: false });
        return {
          ok: true,
          data: {
            buildId,
            network: 'solana:devnet',
            unsignedWireBase64: wire,
            lockUnsignedWireBase64: null,
            token,
            firstBuyOutRaw: '0',
            payerCoveredLamports: '7350240',
            creatorCostLamports: '9874320',
            expiresAt: iso(now() + 60_000),
            signableMs: 25_000,
            splitUnsignedWireBase64: null,
            feeVault: null,
          },
        };
      }),
    submit: (body) =>
      answer('submit', () => {
        const build = builds.get(body.buildId);
        if (!build) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No build by that id.' };
        if (build.used) return { ok: false, code: 'LAUNCH_BUILD_USED', message: 'This build was already submitted.' };
        if (body.creator !== build.request.creator) return { ok: false, code: 'WALLET_MISMATCH', message: 'Another wallet.' };
        if (!body.signedWireBase64.startsWith(build.wire.slice(0, 16))) return { ok: false, code: 'LAUNCH_SIGNED_OTHER_BYTES', message: 'The signed bytes are not the built ones.' };
        build.used = true;
        const at = now();
        made.unshift({ token: build.token, name: build.name, symbol: build.symbol, launchedAt: at, creator: body.creator, progressBps: (t) => Math.min(9_900, Math.floor((t - at) / MINUTE) * 300), migrated: false, holders: 1, checks: ['young', 'young', 'young'], liquidityUsd: null });
        return { ok: true, data: { token: build.token, signature: stubSignature(body.buildId), state: 'LAUNCHED', lock: null, feeSharing: null, tokenPath: `/app/launch/${build.token}` } };
      }),
    markets: () => answer('markets', (): Answer<LaunchMarketsResponse> => ({ ok: true, data: { network: 'solana:devnet', markets: all().map((launch) => rowOf(launch, now())), complete: true, observedAt: iso(now()) } })),
    survival: () => answer('survival', () => ({ ok: true, data: survivalOf(all(), now()) })),
    crews: () =>
      answer('crews', (): Answer<LaunchCrewsResponse> => {
        const moth = all().find((launch) => launch.symbol === 'MOTH')!;
        return {
          ok: true,
          data: {
            network: 'solana:devnet',
            crews: [{ token: moth.token, symbol: moth.symbol, creator: moth.creator, creatorBps: 7000, members: [{ wallet: stubAddress('crew:1'), bps: 2000 }, { wallet: stubAddress('crew:2'), bps: 1000 }], window: null, launchedAt: iso(moth.launchedAt) }],
            observedAt: iso(now()),
          },
        };
      }),
    market: (token) =>
      answer('market', () => {
        const launch = all().find((entry) => entry.token === token);
        return launch ? { ok: true, data: marketOf(launch, now(), preset) } : { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch by that mint.' };
      }),
    flow: (token) =>
      answer('flow', () => {
        const launch = all().find((entry) => entry.token === token);
        return launch ? { ok: true, data: flowOf(launch, now()) } : { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch by that mint.' };
      }),
    tradeQuote: (token, body) =>
      answer('tradeQuote', () => {
        const launch = all().find((entry) => entry.token === token);
        return launch ? { ok: true, data: quoteOf(launch, body.side, body.amountRaw, body.slippageBps, now()) } : { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch by that mint.' };
      }),
    tradeBuild: (token, body) =>
      answer('tradeBuild', () => {
        const launch = all().find((entry) => entry.token === token);
        if (!launch) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch by that mint.' };
        if (body.side === 'sell' && (held.get(token) ?? 0n) < BigInt(body.amountRaw)) return { ok: false, code: 'LAUNCH_BALANCE_LOW', message: 'The wallet does not hold that much.' };
        const quote = quoteOf(launch, body.side, body.amountRaw, body.slippageBps, now());
        const buildId = hex(`trade:${deals.size}:${now()}`, 32);
        const wire = toBase64(seededBytes(`trade-wire:${buildId}`, 96));
        deals.set(buildId, { token, wallet: body.wallet, wires: [wire], side: body.side, inRaw: quote.amountInRaw, outRaw: quote.amountOutRaw, used: false });
        return { ok: true, data: { buildId, network: 'solana:devnet', unsignedWireBase64: wire, quote, expiresAt: iso(now() + 60_000), signableMs: 25_000 } };
      }),
    tradeSubmit: (_token, body) =>
      answer('tradeSubmit', () => {
        const deal = sent(body.buildId, body.wallet, [body.signedWireBase64]);
        if (!deal.ok) return deal;
        const { side, inRaw, outRaw, token } = deal.deal;
        held.set(token, (held.get(token) ?? 0n) + (side === 'buy' ? BigInt(outRaw) : -BigInt(inRaw)));
        return { ok: true, data: { signature: stubSignature(body.buildId), state: 'CONFIRMED', filled: side === 'buy' ? { tokensRaw: outRaw, pairRaw: inRaw } : { tokensRaw: inRaw, pairRaw: outRaw }, receiptHash: null, shareLink: null } };
      }),
    holdings: (token, wallet) => answer('holdings', () => ({ ok: true, data: { wallet, token, tokenRaw: (held.get(token) ?? 0n).toString(), pairRaw: '250000000', observedAt: iso(now()) } })),
    claimReview: (token, wallet) =>
      answer('claimReview', () => {
        const launch = all().find((entry) => entry.token === token);
        if (!launch) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch by that mint.' };
        const waiting = launch.creator === wallet && !claimed.has(token) ? STUB_CLAIM_RAW : '0';
        return { ok: true, data: claimReviewOf(launch, wallet, waiting, now()) };
      }),
    claimBuild: (token, wallet) =>
      answer('claimBuild', () => {
        const launch = all().find((entry) => entry.token === token);
        if (!launch) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No launch by that mint.' };
        if (launch.creator !== wallet) return { ok: false, code: 'WALLET_MISMATCH', message: 'Not the creator of this launch.' };
        if (claimed.has(token)) return { ok: false, code: 'LAUNCH_NOTHING_TO_CLAIM', message: 'Nothing to claim now.' };
        const buildId = hex(`claim:${deals.size}:${now()}`, 32);
        const wire = toBase64(seededBytes(`claim-wire:${buildId}`, 96));
        deals.set(buildId, { token, wallet, wires: [wire], side: 'claim', inRaw: '0', outRaw: STUB_CLAIM_RAW, used: false });
        return { ok: true, data: { buildId, network: 'solana:devnet', unsignedWireBase64: [wire], sources: ['curve'], expectedRaw: STUB_CLAIM_RAW, networkCostLamports: '5000', pair: { ...PAIR, dollar: true }, expiresAt: iso(now() + 60_000), signableMs: 25_000 } };
      }),
    claimSubmit: (_token, body) =>
      answer('claimSubmit', () => {
        const deal = sent(body.buildId, body.wallet, body.signedWireBase64);
        if (!deal.ok) return deal;
        claimed.add(deal.deal.token);
        const launch = all().find((entry) => entry.token === deal.deal.token)!;
        return {
          ok: true,
          data: {
            state: 'CONFIRMED',
            receipts: [{ token: launch.token, name: launch.name, symbol: launch.symbol, signature: stubSignature(body.buildId), at: iso(now()), pair: { ...PAIR, dollar: true }, paid: { curve: STUB_CLAIM_RAW, graduation: '0', lp: '0', surplus: '0' }, vaultPaidRaw: null, receivedRaw: STUB_CLAIM_RAW }],
            pending: [],
            failed: [],
          },
        };
      }),
  };

  /** A trade or a claim sent once, by the wallet it was built for, with the built bytes. */
  function sent(buildId: string, wallet: string, signed: readonly string[]): Readonly<{ ok: false; code: string; message: string }> | Readonly<{ ok: true; deal: NonNullable<ReturnType<typeof deals.get>> }> {
    const deal = deals.get(buildId);
    if (!deal) return { ok: false, code: 'LAUNCH_NOT_FOUND', message: 'No build by that id.' };
    if (deal.used) return { ok: false, code: 'LAUNCH_BUILD_USED', message: 'This build was already submitted.' };
    if (wallet !== deal.wallet) return { ok: false, code: 'WALLET_MISMATCH', message: 'Another wallet.' };
    if (signed.length !== deal.wires.length || signed.some((wire, index) => !wire.startsWith(deal.wires[index]!.slice(0, 16)))) return { ok: false, code: 'LAUNCH_SIGNED_OTHER_BYTES', message: 'The signed bytes are not the built ones.' };
    deal.used = true;
    return { ok: true, deal };
  }
}

/* ---------------------------------------------------------------- the wallet */

export const STUB_WALLET = 'Stub wallet';
export const STUB_CREATOR = stubAddress('creator:stub-wallet');

/** A wallet that signs at once by handing the bytes back — for the stub engine only, which checks nothing more. */
export function stubWallet(options: Readonly<{ delayMs?: number; refuse?: boolean }> = {}): CityWallet {
  const connection: Connection = { wallet: STUB_WALLET, address: STUB_CREATOR };
  return {
    options: () => [{ name: STUB_WALLET, icon: null }],
    subscribe: () => () => undefined,
    connect: async () => ({ ok: true, connection }),
    restore: async () => null,
    signer: (connected) => ({
      wallet: connected.wallet,
      address: connected.address,
      sign: async (wires) => {
        await new Promise<void>((resolve) => setTimeout(resolve, options.delayMs ?? 0));
        return options.refuse ? { ok: false, reason: `${STUB_WALLET} was closed before signing.` } : { ok: true, signed: wires };
      },
    }),
  };
}

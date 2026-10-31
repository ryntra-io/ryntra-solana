import type {
  LaunchBuildRequest,
  LaunchCrewsResponse,
  LaunchMarketResponse,
  LaunchMarketRow,
  LaunchMarketsResponse,
  LaunchPresetsResponse,
  LaunchPresetView,
  LaunchSurvivalResponse,
} from '../../../lib/api/v1/contract.ts';
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
type StubLaunch = Readonly<{ token: string; name: string; symbol: string; launchedAt: number; creator: string; progressBps: (now: number) => number; migrated: boolean; holders: number; checks: readonly ('young' | 'alive' | 'quiet')[]; liquidityUsd: number | null }>;

/** The stand's youngest coin is always in the last two minutes of its launch fee's fall, so the fee is seen falling live. */
const YOUNG_CYCLE = 2 * MINUTE;

/** The stand's coins. Spark and Moth are the stub wallet's own, so «Мій причал» (CITY-141) has a test launch on the curve and one in its pool. */
function standLaunches(now: number): StubLaunch[] {
  const at = (ago: number) => now - ago;
  return [
    { token: stubAddress('SPARK'), name: 'Spark', symbol: 'SPARK', launchedAt: now - 8 * MINUTE - (now % YOUNG_CYCLE), creator: STUB_CREATOR, progressBps: () => 4215, migrated: false, holders: 58, checks: ['young', 'young', 'young'], liquidityUsd: null },
    { token: stubAddress('NOVA'), name: 'Nova', symbol: 'NOVA', launchedAt: at(3 * 3600_000), creator: stubAddress('creator:nova'), progressBps: () => 6200, migrated: false, holders: 41, checks: ['young', 'young', 'young'], liquidityUsd: null },
    { token: stubAddress('KITE'), name: 'Kite', symbol: 'KITE', launchedAt: at(42 * MINUTE), creator: stubAddress('creator:kite'), progressBps: () => 2500, migrated: false, holders: 37, checks: ['young', 'young', 'young'], liquidityUsd: null },
    { token: stubAddress('MOTH'), name: 'Moth', symbol: 'MOTH', launchedAt: at(12 * DAY), creator: STUB_CREATOR, progressBps: () => 10_000, migrated: true, holders: 214, checks: ['alive', 'young', 'young'], liquidityUsd: 31_200 },
    { token: stubAddress('OWL'), name: 'Night Owl', symbol: 'OWL', launchedAt: at(96 * DAY), creator: stubAddress('creator:owl'), progressBps: () => 10_000, migrated: true, holders: 862, checks: ['alive', 'alive', 'alive'], liquidityUsd: 88_400 },
    { token: stubAddress('DUSK'), name: 'Dusk', symbol: 'DUSK', launchedAt: at(9 * DAY), creator: stubAddress('creator:dusk'), progressBps: () => 800, migrated: false, holders: 6, checks: ['quiet', 'young', 'young'], liquidityUsd: null },
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
    preset: 'protected',
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
    creatorLock: null,
    creatorSold: false,
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
    trades: { rows: [], complete: true, read: 0 },
    /* The move to the DEX a day after the launch, as the engine marks it on the chart. */
    chart: { points: [], markers: launch.migrated ? [{ t: Math.floor((launch.launchedAt + DAY) / 1000), kind: 'graduated', signature: stubSignature(`graduated:${launch.token}`) }] : [] },
    risk: [],
    creator: { address: launch.creator, curves: null, tradesComplete: true },
    trading: { venue: launch.migrated ? 'pool' : 'curve', pool: stubAddress(`pool:${launch.token}`), referral: true, jupiter: false },
    observedAt: iso(now),
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
  const wait = (route: keyof LaunchEngine) => new Promise<void>((resolve) => setTimeout(resolve, (options.delayMs ?? 0) * (route === 'submit' ? 5 : 1)));
  const refuse = { ...(options.refuse ?? {}) };
  const calls: string[] = [];
  const builds = new Map<string, { request: LaunchBuildRequest; token: string; wire: string; name: string; symbol: string; used: boolean }>();
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
  };
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

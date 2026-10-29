/**
 * Pulse's reads (`pulse.ts` says what a row and a feed are).
 *
 * - **Jupiter Tokens V2** — `/recent` (the newest first pools, thirty at a
 *   time, read every fifteen seconds), the trending, traded and organic lists
 *   by window (a minute), and `/search` by mints for the curves GeckoTerminal
 *   names that the lists do not carry. Every figure of a row is Jupiter's.
 * - **GeckoTerminal** — the curves that traded the most in the day on
 *   pump.fun, Meteora DBC, LaunchLab and bonk.fun: which tokens may be close
 *   to their DEX. Read inside the instance's minute budget outside the
 *   chart's reserve (`getJson(…, "page")`), a minute each.
 * - **The chain** — each candidate curve's own account: how far it is, and
 *   whether it is full. Five accounts a request (a public node refuses more).
 * - **Ryntra** — the markets launched on Ryntra (`readLaunchMarkets`), first
 *   in every feed whose condition their own data meets.
 *
 * A source that does not answer leaves the feed with what the others said and
 * the answer says it is partial; a feed with no source at all is a failure
 * with its reason, never an empty list.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import type { LaunchMarketRow } from "../api/v1/contract.ts";
import { createDbcClient, type DbcClient } from "../core/venues/meteora-dbc/sdk.server.ts";
import { readLaunchMarkets } from "../launch/markets.server.ts";
import { launchHealthDeps } from "../launch/runtime.server.ts";
import { createSolanaRpcHandle, resolveEndpoint } from "../solana/rpc.ts";
import { GECKO_SOLANA_BASE, getJson } from "./candles.server.ts";
import { readJupiterList, type SpotSourceFailure } from "./markets.server.ts";
import {
  dbcCurveOf,
  feedRows,
  graduatedOf,
  launchlabCurveOf,
  mergeRows,
  PUMP_PROGRAM,
  pumpCurveOf,
  pulseRowOf,
  rawLaunchpadOf,
  WATCHLIST_MAX,
  type PulseCurve,
  type PulseFeed,
  type PulseMode,
  type PulseRow,
} from "./pulse.ts";
import type { TokenWindow } from "./token-page.ts";

export type PulseSource = "jupiter" | "geckoterminal" | "chain" | "ryntra";

export type PulseRead = Readonly<{
  ok: true;
  feed: PulseFeed;
  window: TokenWindow;
  /** Meme mode (Market Radar) or every token. */
  mode: PulseMode;
  rows: readonly PulseRow[];
  /** «Рухи» only: the window's largest falls; `rows` holds the rises. */
  down?: readonly PulseRow[];
  /** «Обране» only: the watched mints no source lists as a coin (a company's token, or a mint nobody knows). */
  unlisted?: number;
  observedAt: string;
  /** Some figures are a held copy, read minutes ago. */
  stale: boolean;
  /** DSC-1: when the oldest of Jupiter's lists behind the rows was read — the time a figure is as old as; absent where none was. */
  readAt?: string;
  /** A source did not answer: the feed is drawn from the others and may lack rows — never older figures. */
  partial: boolean;
  sources: readonly PulseSource[];
}>;

const RECENT_TTL_MS = 15_000;
const LIST_TTL_MS = 60_000;
const GECKO_TTL_MS = 60_000;
const CURVE_TTL_MS = 20_000;
const RYNTRA_TTL_MS = 30_000;
/** An answer is assembled once for everyone asking within this span. */
const ANSWER_TTL_MS = 8_000;
/** How long Ryntra's own list is waited for before the feed is answered without it. */
const RYNTRA_WAIT_MS = 8_000;
/** The candidate curves read on the chain in one answer, by kind. */
const PUMP_CANDIDATES = 40;
const LAUNCHLAB_CANDIDATES = 16;
const DBC_CANDIDATES = 12;
const ACCOUNT_CHUNK = 5;
/** A Pulse list is served held at most this long; older, it is read again before the answer (a feed of new tokens an hour old is not a feed). */
const LIST_GRACE_MS = 5 * 60_000;
/** One curve read on the chain waits at most this long. */
const CURVE_WAIT_MS = 8_000;

type Listed = Readonly<{ raw: readonly unknown[]; readAt: number }>;
/** A list older than this is a held copy the answer names; a younger one being read again behind it is simply the list. */
const HELD_MS = 3 * 60_000;

/** Jupiter's lists a feed reads, by window. */
function listsOf(feed: PulseFeed, window: TokenWindow): readonly string[] {
  const span = (value: TokenWindow) => (value === "m5" ? "5m" : value === "h1" ? "1h" : value === "h6" ? "6h" : "24h");
  if (feed === "watchlist") return [];
  if (feed === "new") return ["/recent", "/toptrending/1h?limit=100", "/toptraded/1h?limit=100"];
  /* Tokens an hour to a day old that the hour is trading: the hour's and the six hours' lists carry them. */
  if (feed === "growing") return ["/toptraded/1h?limit=100", "/toptrending/1h?limit=100", "/toptrending/6h?limit=100"];
  if (feed === "soon") return ["/recent", "/toptrending/5m?limit=100", "/toptrending/1h?limit=100", "/toptraded/1h?limit=100"];
  if (feed === "dex") return ["/toptrending/1h?limit=100", "/toptrending/24h?limit=100", "/toptraded/1h?limit=100", "/toptraded/24h?limit=100", "/toporganicscore/24h?limit=100"];
  if (feed === "trending") return [`/toptrending/${span(window)}?limit=100`];
  return [`/toptrending/${span(window)}?limit=100`, `/toptraded/${span(window)}?limit=100`, "/toporganicscore/24h?limit=100"];
}

async function readLists(paths: readonly string[]): Promise<{ lists: Listed[]; failed: number; failure: SpotSourceFailure | null }> {
  const reads = await Promise.all(paths.map((path) => readJupiterList(path, path === "/recent" ? RECENT_TTL_MS : LIST_TTL_MS, LIST_GRACE_MS)));
  const lists: Listed[] = [];
  let failure: SpotSourceFailure | null = null;
  for (const read of reads) {
    if (read.ok) lists.push({ raw: read.raw, readAt: read.readAt });
    else failure = read;
  }
  return { lists, failed: reads.length - lists.length, failure };
}

/* ------------------------------------------------------------ GeckoTerminal */

type GeckoCurve = Readonly<{ mint: string; pool: string; dex: string }>;
const GECKO_DEXES = ["pump-fun", "meteora-dbc", "raydium-launchlab", "letsbonk-fun"] as const;
const geckoCurves = new Map<string, { value: readonly GeckoCurve[]; readAt: number }>();

/** The day's most traded curves on one launchpad: their mint and the curve's account. */
export function geckoCurvesOf(body: unknown, dex: string): GeckoCurve[] {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return [];
  const out: GeckoCurve[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const pool = (item as { attributes?: { address?: unknown } }).attributes?.address;
    const base = (item as { relationships?: { base_token?: { data?: { id?: unknown } } } }).relationships?.base_token?.data?.id;
    if (typeof pool !== "string" || typeof base !== "string" || !base.startsWith("solana_")) continue;
    const mint = base.slice("solana_".length);
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pool)) continue;
    out.push({ mint, pool, dex });
  }
  return out;
}

async function readGeckoCurves(): Promise<{ curves: GeckoCurve[]; stale: boolean }> {
  const now = Date.now();
  let stale = false;
  const all: GeckoCurve[] = [];
  await Promise.all(
    GECKO_DEXES.map(async (dex) => {
      const hit = geckoCurves.get(dex);
      if (hit && now - hit.readAt < GECKO_TTL_MS) {
        all.push(...hit.value);
        return;
      }
      const read = await getJson(`${GECKO_SOLANA_BASE}/dexes/${dex}/pools?sort=h24_volume_usd_desc&page=1`, "page");
      if (read.ok) {
        const value = geckoCurvesOf(read.body, dex);
        geckoCurves.set(dex, { value, readAt: Date.now() });
        all.push(...value);
      } else if (hit) {
        stale = true;
        all.push(...hit.value);
      } else stale = true;
    }),
  );
  return { curves: all, stale };
}

/* ------------------------------------------------------------ the chain */

const curves = new Map<string, { value: PulseCurve | null; readAt: number }>();
const dbcConfigs = new Map<string, Promise<{ threshold: bigint } | null>>();

function decodeBase64(value: unknown): Uint8Array | null {
  if (!Array.isArray(value) || typeof value[0] !== "string") return null;
  return Uint8Array.from(Buffer.from(value[0], "base64"));
}

/** pump.fun's curve account of a mint. */
export function pumpCurveAddress(mint: string): string {
  return PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], new PublicKey(PUMP_PROGRAM))[0].toBase58();
}

/** Accounts read raw, five a request; a curve read in the last twenty seconds is not read again. */
async function readAccounts(addresses: readonly string[]): Promise<{ out: Map<string, Uint8Array | null>; failed: number }> {
  const out = new Map<string, Uint8Array | null>();
  let failed = 0;
  if (addresses.length === 0) return { out, failed };
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 8_000 });
  const chunks: string[][] = [];
  for (let start = 0; start < addresses.length; start += ACCOUNT_CHUNK) chunks.push(addresses.slice(start, start + ACCOUNT_CHUNK));
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const answer = await handle.rpc.getMultipleAccounts(chunk as never, { encoding: "base64", commitment: "confirmed" }).send({ abortSignal: AbortSignal.timeout(8_000) });
        (answer.value as readonly ({ data: unknown } | null)[]).forEach((info, index) => out.set(chunk[index] as string, info ? decodeBase64(info.data) : null));
      } catch {
        /* A chunk the node did not answer stays unread: its curves are not in this answer, and the answer says it is partial. */
        failed += 1;
      }
    }),
  );
  return { out, failed };
}

let dbcClient: DbcClient | null = null;
function dbc(): DbcClient {
  dbcClient ??= createDbcClient(new Connection(resolveEndpoint("mainnet"), "confirmed"));
  return dbcClient;
}

/** A DBC curve read within {@link CURVE_WAIT_MS}: the SDK's own connection carries no deadline. */
function readDbcCurve(pool: string): Promise<PulseCurve | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    readDbcCurveNow(pool),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("DBC curve read timed out")), CURVE_WAIT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function readDbcCurveNow(pool: string): Promise<PulseCurve | null> {
  const client = dbc();
  const virtual = await client.state.getPool(new PublicKey(pool));
  if (!virtual) return null;
  /* The SDK's answer wraps the curve's account in `poolState`; an older shape is the account itself. */
  type CurveAccount = NonNullable<typeof virtual>["poolState"];
  const state: CurveAccount = (virtual as { poolState?: CurveAccount }).poolState ?? (virtual as unknown as CurveAccount);
  const configKey = state.config.toBase58();
  let config = dbcConfigs.get(configKey);
  if (!config) {
    config = client.state.getPoolConfig(state.config).then((read) => (read ? { threshold: BigInt(read.migrationQuoteThreshold.toString()) } : null));
    dbcConfigs.set(configKey, config);
    config.catch(() => dbcConfigs.delete(configKey));
  }
  const read = await config;
  if (!read) return null;
  return dbcCurveOf(BigInt(state.quoteReserve.toString()), read.threshold, state.isMigrated === 1);
}

/**
 * How far each candidate curve is, from its own account: pump.fun's curve by
 * the mint, LaunchLab's and DBC's by the pool GeckoTerminal names. A curve not
 * read is absent — the token is not in «Майже на DEX» rather than guessed in.
 */
async function readCurves(pump: readonly string[], launchlab: readonly GeckoCurve[], meteora: readonly GeckoCurve[]): Promise<{ byMint: Map<string, PulseCurve>; partial: boolean }> {
  const now = Date.now();
  const byMint = new Map<string, PulseCurve>();
  const kept = (key: string) => {
    const hit = curves.get(key);
    return hit && now - hit.readAt < CURVE_TTL_MS ? hit : null;
  };
  const pumpAddresses = new Map<string, string>();
  for (const mint of pump) {
    try {
      pumpAddresses.set(pumpCurveAddress(mint), mint);
    } catch {
      /* Not an address: no curve. */
    }
  }
  const wanted = [...pumpAddresses.keys(), ...launchlab.map((curve) => curve.pool)].filter((address) => !kept(address));
  const { out: accounts, failed } = await readAccounts(wanted);
  let partial = failed > 0;
  for (const [address, mint] of pumpAddresses) {
    const hit = kept(address);
    const value = hit ? hit.value : accounts.has(address) ? (accounts.get(address) ? pumpCurveOf(accounts.get(address)!) : null) : undefined;
    if (value === undefined) continue;
    if (!hit) curves.set(address, { value, readAt: now });
    if (value) byMint.set(mint, value);
  }
  for (const curve of launchlab) {
    const hit = kept(curve.pool);
    const value = hit ? hit.value : accounts.has(curve.pool) ? (accounts.get(curve.pool) ? launchlabCurveOf(accounts.get(curve.pool)!) : null) : undefined;
    if (value === undefined) continue;
    if (!hit) curves.set(curve.pool, { value, readAt: now });
    if (value) byMint.set(curve.mint, value);
  }
  await Promise.all(
    meteora.map(async (curve) => {
      const hit = kept(curve.pool);
      if (hit) {
        if (hit.value) byMint.set(curve.mint, hit.value);
        return;
      }
      try {
        const value = await readDbcCurve(curve.pool);
        curves.set(curve.pool, { value, readAt: Date.now() });
        if (value) byMint.set(curve.mint, value);
      } catch {
        /* Not read: not in the feed, and the answer says it is partial. */
        partial = true;
      }
    }),
  );
  if (curves.size > 4_000) curves.clear();
  return { byMint, partial };
}

/* ------------------------------------------------------------ Ryntra's markets */

let ryntraKept: { rows: readonly LaunchMarketRow[]; readAt: number } | null = null;

/**
 * Ryntra's markets, or «not read» (`late`) when the list did not come within the wait — the answer then says it is
 * partial. A list that comes after the wait is kept for the next answer, never thrown away.
 */
async function readRyntraMarkets(): Promise<{ rows: readonly LaunchMarketRow[]; late: false } | { rows: null; late: boolean }> {
  const now = Date.now();
  if (ryntraKept && now - ryntraKept.readAt < RYNTRA_TTL_MS) return { rows: ryntraKept.rows, late: false };
  const deps = launchHealthDeps();
  if (!deps || deps.network.cluster !== "mainnet") return ryntraKept ? { rows: ryntraKept.rows, late: false } : { rows: null, late: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reading = readLaunchMarkets(deps)
    .then((list) => {
      ryntraKept = { rows: list.markets, readAt: Date.now() };
      return list.markets;
    })
    .catch(() => null);
  const read = await Promise.race([
    reading,
    new Promise<"late">((done) => {
      timer = setTimeout(() => done("late"), RYNTRA_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (read && read !== "late") return { rows: read, late: false };
  if (ryntraKept) return { rows: ryntraKept.rows, late: false };
  return { rows: null, late: read === "late" };
}

/** A market launched on Ryntra as a Pulse row: Jupiter's figures where it lists the token, Ryntra's own read always. */
export function ryntraRowOf(market: LaunchMarketRow, listed: PulseRow | null): PulseRow {
  const curve: PulseCurve | null = market.progress
    ? { venue: "meteora-dbc", progressPct: Math.min(100, market.progress.bps / 100), complete: market.progress.migrated || market.progress.bps >= 10_000 }
    : null;
  const ryntra = { preset: market.preset, technicalValidation: market.technicalValidation, launchedAt: market.launchedAt, traded24h: market.traded24h, daysSinceDex: market.daysSinceDex, dollarPair: market.pair.dollar };
  /* Every launch on Ryntra is a Meteora DBC curve (a Ryntra config), on it or out of it. */
  const graduated = market.progress?.migrated === true || (listed?.graduated ?? false);
  if (listed) {
    const own = listed.holders === null;
    return { ...listed, curve: curve ?? listed.curve, ryntra, holders: own ? market.holders : listed.holders, holdersAtLeast: own && market.holdersAtLeast, launchpad: "Ryntra", venue: "meteora-dbc", graduated };
  }
  const empty = { changePct: null, volumeUsd: null, holdersChangePct: null };
  return {
    mint: market.token,
    symbol: market.symbol,
    name: market.name,
    icon: market.image,
    launchpad: "Ryntra",
    venue: "meteora-dbc",
    graduated,
    price: null,
    marketCapUsd: null,
    liquidityUsd: market.poolLiquidity?.usd ?? null,
    holders: market.holders,
    holdersAtLeast: market.holdersAtLeast,
    windows: { m5: empty, h1: empty, h6: empty, h24: empty },
    firstPoolAt: market.launchedAt,
    graduatedAt: null,
    top10Pct: null,
    devPct: null,
    creatorLaunches: null,
    creatorGraduated: null,
    verified: false,
    organic: null,
    /* Jupiter does not list it: its rights and flags are not read here — never «no fact against it». */
    auditRead: false,
    notices: [],
    curve,
    ryntra,
  };
}

/* ------------------------------------------------------------ the answer */

const answers = new Map<string, { value: Promise<PulseRead | SpotSourceFailure>; at: number }>();

export type PulseAsk = Readonly<{ mode?: PulseMode; mints?: readonly string[] }>;

/**
 * One feed, for everyone asking within a few seconds. `mode: "meme"` is Market Radar's cut (SOL-R1); «Обране» reads
 * the mints it is given, in their order.
 */
export function readPulse(feed: PulseFeed, window: TokenWindow, ask: PulseAsk = {}): Promise<PulseRead | SpotSourceFailure> {
  const mode = ask.mode ?? "all";
  const mints = feed === "watchlist" ? (ask.mints ?? []).slice(0, WATCHLIST_MAX) : [];
  const key = `${feed}:${window}:${mode}${feed === "watchlist" ? `:${mints.join(",")}` : ""}`;
  const now = Date.now();
  const hit = answers.get(key);
  if (hit && now - hit.at < ANSWER_TTL_MS) return hit.value;
  const value = feed === "watchlist" ? assembleWatchlist(window, mode, mints) : assemble(feed, window, mode);
  if (answers.size > 500) answers.clear();
  answers.set(key, { value, at: now });
  value.then((read) => {
    if (!read.ok && answers.get(key)?.value === value) answers.delete(key);
  }, () => answers.delete(key));
  return value;
}

async function assemble(feed: PulseFeed, window: TokenWindow, mode: PulseMode): Promise<PulseRead | SpotSourceFailure> {
  const now = Date.now();
  const [{ lists, failed, failure }, ryntraRead, gecko] = await Promise.all([
    readLists(listsOf(feed, window)),
    readRyntraMarkets(),
    feed === "soon" ? readGeckoCurves() : Promise.resolve(null),
  ]);
  if (lists.length === 0 && failure) return failure;
  const sources: PulseSource[] = ["jupiter"];
  /* Ryntra's own markets not read in time are kept when they come and stand in the next read, seconds later; no figure on screen is older for it. */
  const stale = lists.some((list) => now - list.readAt > HELD_MS);
  let partial = failed > 0;
  const ryntraMarkets = ryntraRead.rows;

  /* Every row Jupiter's lists carry, in the lists' own order (the first list leads: it is the feed's own). */
  const rawByMint = new Map<string, unknown>();
  const rows: PulseRow[] = [];
  for (const list of lists) {
    for (const raw of list.raw) {
      const row = pulseRowOf(raw, now);
      if (!row || rawByMint.has(row.mint)) continue;
      rawByMint.set(row.mint, raw);
      rows.push(row);
    }
  }

  /* Ryntra's own markets, with Jupiter's figures where the lists or a search by mint carry them. */
  const ryntraRows: PulseRow[] = [];
  if (ryntraMarkets && ryntraMarkets.length > 0) {
    sources.push("ryntra");
    const missing = ryntraMarkets.map((market) => market.token).filter((mint) => !rawByMint.has(mint));
    const { out: searched } = await searchByMints(missing);
    for (const [mint, raw] of searched) rawByMint.set(mint, raw);
    for (const market of ryntraMarkets) {
      const raw = rawByMint.get(market.token);
      ryntraRows.push(ryntraRowOf(market, raw ? pulseRowOf(raw, now) : null));
    }
  }

  /* «Майже на DEX»: the candidate curves, and each one's own account. */
  if (feed === "soon" && gecko) {
    sources.push("geckoterminal", "chain");
    if (gecko.stale) partial = true;
    const geckoOnly = [...new Set(gecko.curves.map((curve) => curve.mint))].filter((mint) => !rawByMint.has(mint));
    const { out: searched } = await searchByMints(geckoOnly);
    for (const [mint, raw] of searched) {
      rawByMint.set(mint, raw);
      const row = pulseRowOf(raw, now);
      if (row) rows.push(row);
    }
    const onCurve = rows.filter((row) => !graduatedOf(rawByMint.get(row.mint)));
    const byCap = (a: PulseRow, b: PulseRow) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0);
    const geckoPump = new Set(gecko.curves.filter((curve) => curve.dex === "pump-fun").map((curve) => curve.mint));
    const pump = onCurve
      .filter((row) => rawLaunchpadOf(rawByMint.get(row.mint)) === "pump.fun" || geckoPump.has(row.mint))
      .sort(byCap)
      .slice(0, PUMP_CANDIDATES)
      .map((row) => row.mint);
    const capOf = new Map(rows.map((row) => [row.mint, row.marketCapUsd ?? 0]));
    const pick = (dexes: readonly string[], count: number) =>
      gecko.curves
        .filter((curve) => dexes.includes(curve.dex) && !graduatedOf(rawByMint.get(curve.mint)))
        .sort((a, b) => (capOf.get(b.mint) ?? 0) - (capOf.get(a.mint) ?? 0))
        .slice(0, count);
    const read = await readCurves(pump, pick(["raydium-launchlab", "letsbonk-fun"], LAUNCHLAB_CANDIDATES), pick(["meteora-dbc"], DBC_CANDIDATES));
    if (read.partial) partial = true;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] as PulseRow;
      const curve = read.byMint.get(row.mint);
      if (curve) rows[index] = { ...row, curve };
    }
  }

  /* «Ростуть»: pump.fun curves read by their mint, so a curve already in «Майже на DEX» is not counted here too. */
  if (feed === "growing") {
    const pump = rows
      .filter((row) => row.venue === "pump" && !graduatedOf(rawByMint.get(row.mint)))
      .sort((a, b) => (b.windows.h1.volumeUsd ?? 0) - (a.windows.h1.volumeUsd ?? 0))
      .slice(0, PUMP_CANDIDATES)
      .map((row) => row.mint);
    const read = await readCurves(pump, [], []);
    if (read.partial) partial = true;
    if (read.byMint.size > 0) sources.push("chain");
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] as PulseRow;
      const curve = read.byMint.get(row.mint);
      if (curve) rows[index] = { ...row, curve };
    }
  }

  const merged = mergeRows([...ryntraRows, ...rows]);
  const observedAt = new Date().toISOString();
  const oldest = lists.length > 0 ? Math.min(...lists.map((list) => list.readAt)) : null;
  const readAt = oldest === null ? {} : { readAt: new Date(oldest).toISOString() };
  if (feed === "movers") {
    return { ok: true, feed, window, mode, rows: feedRows(feed, merged, window, now, false, mode), down: feedRows(feed, merged, window, now, true, mode), observedAt, ...readAt, stale, partial, sources };
  }
  return { ok: true, feed, window, mode, rows: feedRows(feed, merged, window, now, false, mode), observedAt, ...readAt, stale, partial, sources };
}

/**
 * «Обране» (Market Radar): the watched mints, each as Jupiter states it today, a launch on Ryntra with Ryntra's own read
 * beside it, in the person's order. A mint no source lists as a coin is counted, not drawn.
 */
async function assembleWatchlist(window: TokenWindow, mode: PulseMode, mints: readonly string[]): Promise<PulseRead | SpotSourceFailure> {
  const now = Date.now();
  const observedAt = new Date().toISOString();
  if (mints.length === 0) return { ok: true, feed: "watchlist", window, mode, rows: [], unlisted: 0, observedAt, stale: false, partial: false, sources: ["jupiter"] };
  const [{ out, failure, readAt, held }, ryntraRead] = await Promise.all([searchByMints(mints), readRyntraMarkets()]);
  if (failure && out.size === 0) return failure;
  const sources: PulseSource[] = ["jupiter"];
  const ryntraBy = new Map((ryntraRead.rows ?? []).map((market) => [market.token, market]));
  const rows: PulseRow[] = [];
  for (const mint of mints) {
    const raw = out.get(mint);
    const listed = raw ? pulseRowOf(raw, now) : null;
    const market = ryntraBy.get(mint);
    if (market) {
      if (!sources.includes("ryntra")) sources.push("ryntra");
      rows.push(ryntraRowOf(market, listed));
    } else if (listed) rows.push(listed);
  }
  const drawn = feedRows("watchlist", rows, window, now, false, mode);
  /* The figures are Jupiter's search, as old as its read: a held copy says so, with its own time. */
  const stale = held && readAt !== null && now - readAt > HELD_MS;
  return { ok: true, feed: "watchlist", window, mode, rows: drawn, unlisted: mints.length - drawn.length, observedAt: readAt === null ? observedAt : new Date(readAt).toISOString(), stale, partial: failure !== null || ryntraRead.late, sources };
}

type Searched = { out: Map<string, unknown>; failure: SpotSourceFailure | null; readAt: number | null; held: boolean };

/**
 * Full Jupiter rows for mints the lists do not carry, a hundred a read, a minute each, held at most as long as a Pulse
 * list ({@link LIST_GRACE_MS}); the failure when the read failed, and when the rows were read.
 */
async function searchByMints(mints: readonly string[]): Promise<Searched> {
  const out = new Map<string, unknown>();
  const unique = [...new Set(mints)].sort().slice(0, 100);
  if (unique.length === 0) return { out, failure: null, readAt: null, held: false };
  const read = await readJupiterList(`/search?query=${encodeURIComponent(unique.join(","))}`, LIST_TTL_MS, LIST_GRACE_MS);
  if (!read.ok) return { out, failure: read, readAt: null, held: false };
  for (const raw of read.raw) {
    const id = raw && typeof raw === "object" ? (raw as { id?: unknown }).id : null;
    if (typeof id === "string" && unique.includes(id) && !out.has(id)) out.set(id, raw);
  }
  return { out, failure: null, readAt: read.readAt, held: read.stale };
}

/** Test seam: forget every cached read. */
export function resetPulseCaches(): void {
  geckoCurves.clear();
  curves.clear();
  dbcConfigs.clear();
  answers.clear();
  ryntraKept = null;
}

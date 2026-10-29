/**
 * «Події ринку» (DSC-1) — the reads behind the one feed of events. Every source is one Ryntra already reads, never a
 * second indexer:
 *
 * - Pulse (`pulse.server.ts`): Jupiter Tokens V2's new tokens, the day's graduations and the hour's trending tokens —
 *   a token born, a token out to a DEX, a pool's liquidity moved by half, a mint or freeze right still on;
 * - the markets launched on Ryntra (`readLaunchMarkets`) and the flight logs (`readLaunchJournal`) of the most active of
 *   them — the launch, the graduation from DBC to DAMM v2, the creator's sales and purchases, the lock, the fee sharing,
 *   MarketOS's steps and claims, each from its confirmed transaction — and a creator's lock opening at the cliff its
 *   escrow names;
 * - early access on Meteora (`listEarlyAccessRecords`) — an Alpha Vault opened, by its own transaction.
 *
 * «Побачено» is when this server first saw a fact (`createSightings`: held in memory while the fact stays on the feed,
 * forgotten two days after its last sighting) — or, for a figure from a held copy of Jupiter's lists, when that list was
 * read — never before the fact happened; a server started anew sees again from its first read. The team's
 * technical validations and names with a hate word are not on a public feed (B15, B2b). A source that did not answer
 * leaves the answer `partial`; flight logs not read for this answer are counted in `logs` — never a missing event passed
 * off as a quiet market. Nothing here signs or trades.
 */

import type { Connection } from "@solana/web3.js";

import type { LaunchJournalResponse, LaunchMarketRow } from "../api/v1/contract.ts";
import { listEarlyAccessRecords } from "../launch/early-access.server.ts";
import { readLaunchJournal } from "../launch/journal.server.ts";
import { readLaunchMarkets } from "../launch/markets.server.ts";
import { launchHealthDeps, launchMarketDeps } from "../launch/runtime.server.ts";
import { isOffensiveName } from "../spot/offensive-names.ts";
import { twinsOf, type PulseRow } from "../spot/pulse.ts";
import { readPulse, ryntraRowOf, type PulseRead } from "../spot/pulse.server.ts";
import {
  authorityEventsOf,
  createdEventsOf,
  journalEventsOf,
  liquidityEventsOf,
  listedEventsOf,
  mergeEvents,
  createSightings,
  orderEvents,
  unlockEventsOf,
  vaultEventOf,
  type EventNetwork,
  type EventSource,
  type MarketEvent,
} from "./market-events.ts";
import { getTransactionAnyVersion } from "../solana/v1-tx.ts";

export type MarketEventsRead = Readonly<{
  ok: true;
  /** Every event of the read, ordered; the route filters, orders again and cuts. */
  events: readonly MarketEvent[];
  observedAt: string;
  /** Some figures are a held copy from an earlier read. */
  stale: boolean;
  /** A source did not answer, or answered in part: the feed may lack events — never older ones in their place. */
  partial: boolean;
  sources: readonly EventSource[];
  /** The flight logs read for this answer against the people's markets launched on Ryntra; null where Launch is not served. */
  logs: Readonly<{ read: number; markets: number }> | null;
}>;
export type MarketEventsFailure = Readonly<{ ok: false; code: "UNAVAILABLE"; reason: string }>;

/** An answer is assembled once for everyone asking within this span. */
const ANSWER_TTL_MS = 10_000;
/** Launch's part — the markets, their logs, the vaults — is read again no oftener than this: a public block must not keep the chain busy. */
const LAUNCH_TTL_MS = 60_000;
/** How long Ryntra's markets, one flight log or the vaults are waited for before the feed is answered without them. */
const LAUNCH_WAIT_MS = 8_000;
/** The longest one build of the feed may take before it is answered as not read. */
const BUILD_DEADLINE_MS = 20_000;
/** The flight logs read for one answer: the markets with a trade in the last day first, then the newest. */
export const JOURNALS_READ = 8;
/** The early accesses whose vault's time is read for one answer, the newest first. */
const VAULTS_READ = 10;
/** First sightings kept: two days, at most this many facts. */
const SEEN_KEPT = 8_000;
const SEEN_MS = 48 * 60 * 60 * 1000;
/** A block time that could not be read is asked again after this. */
const BLOCK_TIME_RETRY_MS = 5 * 60_000;

let answer: Readonly<{ at: number; value: Promise<MarketEventsRead | MarketEventsFailure> }> | null = null;
let launchPart: Readonly<{ at: number; value: Promise<LaunchData> }> | null = null;
/* A confirmed transaction's block time never changes; a failed read is asked again after a while. */
const BLOCK_TIMES = new Map<string, Readonly<{ at: string | null; until: number }>>();
/* When this server first saw each fact, by its merge key. */
const SIGHTINGS = createSightings({ kept: SEEN_KEPT, ms: SEEN_MS });
const firstSeen = (events: readonly MarketEvent[], now: number) => SIGHTINGS.apply(events, now);
/* One build at a time: a build slower than the answer's span is not started twice. */
let building = false;
/* At most this many single-market logs read at once for `?mint=`. */
const ONE_LOG_PARALLEL = 2;
let oneLogs = 0;

/**
 * The feed for everyone asking within a few seconds. `mint`: a market launched on Ryntra outside the most active few has
 * its own flight log read for this ask, so `?mint=` never answers «no events» for a log that simply was not read.
 */
export async function readMarketEvents(ask: Readonly<{ mint?: string | null }> = {}): Promise<MarketEventsRead | MarketEventsFailure> {
  const now = Date.now();
  if (!answer || (now - answer.at >= ANSWER_TTL_MS && !building)) {
    building = true;
    /* A build that hangs never pins the feed: past its deadline the answer is «not read now», and the next ask builds again. */
    const value = within(assemble(), BUILD_DEADLINE_MS).then((read): MarketEventsRead | MarketEventsFailure => (read === "late" ? { ok: false, code: "UNAVAILABLE", reason: "The sources did not answer in time; try again." } : read));
    answer = { at: now, value };
    value.then(
      (read) => {
        if (!read.ok && answer?.value === value) answer = null;
      },
      () => {
        if (answer?.value === value) answer = null;
      },
    ).finally(() => {
      building = false;
    });
  }
  const read = await answer.value;
  if (!read.ok || !ask.mint) return read;
  const extra = await readOneLog(ask.mint, now);
  if (!extra) return read;
  return {
    ...read,
    events: orderEvents(mergeEvents([...read.events, ...extra.events])),
    partial: read.partial || extra.failed,
    logs: read.logs && !extra.failed ? { ...read.logs, read: read.logs.read + 1 } : read.logs,
  };
}

/** Test seam: forget the held answers, the sightings and the block times. */
export function resetMarketEventsCache(): void {
  answer = null;
  launchPart = null;
  BLOCK_TIMES.clear();
  SIGHTINGS.clear();
  building = false;
  oneLogs = 0;
}

function within<T>(promise: Promise<T>, ms: number): Promise<T | "late"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<"late">((done) => (timer = setTimeout(() => done("late"), ms)))]).finally(() => clearTimeout(timer));
}

const networkOf = (cluster: string): EventNetwork => (cluster === "mainnet" ? "mainnet" : "devnet");

async function assemble(): Promise<MarketEventsRead | MarketEventsFailure> {
  const now = Date.now();
  const [fresh, listed, trending, launch] = await Promise.all([
    readPulse("new", "m5").catch(() => null),
    readPulse("dex", "h24").catch(() => null),
    readPulse("trending", "h1").catch(() => null),
    readLaunch(),
  ]);
  const reads = [fresh, listed, trending].filter((read): read is PulseRead => read !== null && read.ok);
  if (reads.length === 0 && !launch.read) return { ok: false, code: "UNAVAILABLE", reason: "Neither Jupiter nor Ryntra's markets answered; try again." };

  /* People's tokens only, and the same rows on Home, in the Radar and here. */
  const people = (rows: readonly PulseRow[]) => rows.filter((row) => !row.ryntra?.technicalValidation && !isOffensiveName(row.name, row.symbol));
  const twins = twinsOf(people(reads.flatMap((read) => read.rows)));
  /* A figure from a held copy of a list is as old as that list's read; seen is clamped to never precede happened. */
  const contextOf = (read: PulseRead) => ({ observedAt: read.stale ? (read.readAt ?? read.observedAt) : read.observedAt, stale: read.stale, now, twins });

  const events: MarketEvent[] = [];
  if (fresh?.ok) events.push(...createdEventsOf(people(fresh.rows), contextOf(fresh)));
  if (listed?.ok) {
    events.push(...listedEventsOf(people(listed.rows), contextOf(listed)));
    events.push(...authorityEventsOf(people(listed.rows), contextOf(listed)));
  }
  if (trending?.ok) {
    events.push(...liquidityEventsOf(people(trending.rows), contextOf(trending)));
    events.push(...authorityEventsOf(people(trending.rows), contextOf(trending)));
  }
  /* A launch's risk from the row Pulse draws for it, where Pulse has one — the same flags on Home, in the Radar and here. */
  const pulseRows = new Map<string, PulseRow>();
  for (const read of reads) for (const row of read.rows) if (row.ryntra && !pulseRows.has(row.mint)) pulseRows.set(row.mint, row);
  events.push(...launchEventsOf(launch, now, pulseRows));

  const sources = new Set<EventSource>();
  if (reads.length > 0) sources.add("jupiter");
  if (reads.some((read) => read.sources.includes("chain"))) sources.add("chain");
  if (launch.read) sources.add("launch").add("chain");
  return {
    ok: true,
    events: orderEvents(firstSeen(mergeEvents(events), now)),
    observedAt: new Date().toISOString(),
    stale: reads.some((read) => read.stale),
    partial: reads.length < 3 || reads.some((read) => read.partial) || launch.partial,
    sources: (["chain", "jupiter", "launch"] as const).filter((source) => sources.has(source)),
    logs: launch.read ? { read: launch.logsRead, markets: launch.markets.length } : null,
  };
}

/* ------------------------------------------------------------ Ryntra's launches */

type VaultRead = Readonly<{ mint: string; symbol: string; name: string; vault: string; signature: string; at: string | null; createdAt: string }>;
type LaunchData = Readonly<{
  read: boolean;
  partial: boolean;
  network: EventNetwork;
  observedAt: string;
  /** People's markets, in the list's own order. */
  markets: readonly LaunchMarketRow[];
  logs: readonly Readonly<{ market: LaunchMarketRow; log: LaunchJournalResponse }>[];
  /** The logs read, a market with no launch record yet counted — it was read and has none. */
  logsRead: number;
  vaults: readonly Readonly<{ vault: VaultRead; market: LaunchMarketRow | null }>[];
}>;

const NOT_SERVED: LaunchData = { read: false, partial: false, network: "mainnet", observedAt: new Date(0).toISOString(), markets: [], logs: [], logsRead: 0, vaults: [] };

function readLaunch(): Promise<LaunchData> {
  const now = Date.now();
  if (launchPart && now - launchPart.at < LAUNCH_TTL_MS) return launchPart.value;
  const value = readLaunchData(now);
  launchPart = { at: now, value };
  value.then(
    (data) => {
      /* An unread part is read again at the next answer, not held for a minute. */
      if (!data.read && launchPart?.value === value) launchPart = null;
    },
    () => {
      if (launchPart?.value === value) launchPart = null;
    },
  );
  return value;
}

/**
 * The markets launched on Ryntra, the flight logs of the most active of them and the early accesses — people's only. Not
 * served on this deployment is no event and no failure; not read in time, or a log whose read failed, is `partial`.
 */
async function readLaunchData(now: number): Promise<LaunchData> {
  const health = launchHealthDeps();
  const deps = launchMarketDeps();
  if (!health || !deps) return NOT_SERVED;
  const network = networkOf(deps.network.cluster);
  const list = await within(readLaunchMarkets(health).catch(() => null), LAUNCH_WAIT_MS);
  if (list === "late" || list === null) return { ...NOT_SERVED, network, partial: true };
  let partial = !list.complete;
  const markets = list.markets.filter((market) => !market.technicalValidation && !isOffensiveName(market.name, market.symbol));

  const [logs, vaults] = await Promise.all([
    /* The list is in the markets' own order: a trade in the last day first, then by state and the newest. */
    Promise.all(
      markets.slice(0, JOURNALS_READ).map(async (market) => {
        const log = await within(
          readLaunchJournal(deps, market.token).then(
            (value) => ({ value }),
            () => "failed" as const,
          ),
          LAUNCH_WAIT_MS,
        );
        return { market, log };
      }),
    ),
    within(readVaults(deps.store, deps.connection, deps.network.cluster, health, now).catch(() => null), LAUNCH_WAIT_MS),
  ]);
  const read: { market: LaunchMarketRow; log: LaunchJournalResponse }[] = [];
  let logsRead = 0;
  for (const { market, log } of logs) {
    /* Late or failed is said; a market with no confirmed launch record yet (`null`) was read and simply has no log. */
    if (log === "late" || log === "failed") {
      partial = true;
      continue;
    }
    logsRead += 1;
    if (!log.value) continue;
    if (!log.value.complete) partial = true;
    read.push({ market, log: log.value });
  }
  const byMint = new Map(list.markets.map((market) => [market.token, market]));
  const vaultRows: { vault: VaultRead; market: LaunchMarketRow | null }[] = [];
  if (vaults === "late" || vaults === null) partial = true;
  else for (const vault of vaults) if (!byMint.get(vault.mint)?.technicalValidation) vaultRows.push({ vault, market: byMint.get(vault.mint) ?? null });
  return { read: true, partial, network, observedAt: list.observedAt, markets, logs: read, logsRead, vaults: vaultRows };
}

/** One market's flight log read for an ask by its mint, when the shared answer did not read it. */
async function readOneLog(mint: string, now: number): Promise<Readonly<{ events: MarketEvent[]; failed: boolean }> | null> {
  const launch = await readLaunch();
  if (!launch.read || launch.logs.some((entry) => entry.market.token === mint)) return null;
  const market = launch.markets.find((row) => row.token === mint);
  const deps = launchMarketDeps();
  if (!market || !deps) return null;
  /* A few at once: more asks wait for the next answer, said as partial. */
  if (oneLogs >= ONE_LOG_PARALLEL) return { events: [], failed: true };
  oneLogs += 1;
  const log = await within(readLaunchJournal(deps, mint).catch(() => "failed" as const), LAUNCH_WAIT_MS).finally(() => {
    oneLogs = Math.max(0, oneLogs - 1);
  });
  if (log === "late" || log === "failed") return { events: [], failed: true };
  /* Read, and the market has no confirmed launch record yet: no events, but the log was read. */
  if (!log) return { events: [], failed: false };
  return { events: firstSeen(launchEventsOf({ ...launch, logs: [{ market, log }], logsRead: 1, vaults: [] }, now, new Map(), false), now), failed: !log.complete };
}

/** Launch's data as events: the logs read, every market's lock opening, the vaults. */
function launchEventsOf(launch: LaunchData, now: number, pulseRows: ReadonlyMap<string, PulseRow>, unlocks = true): MarketEvent[] {
  if (!launch.read) return [];
  const rowOf = (market: LaunchMarketRow) => pulseRows.get(market.token) ?? ryntraRowOf(market, null);
  const base = (market: LaunchMarketRow) => ({ row: rowOf(market), network: launch.network, observedAt: launch.observedAt, now });
  const events: MarketEvent[] = [];
  if (unlocks) for (const market of launch.markets) events.push(...unlockEventsOf(market.creatorLock, { ...base(market), pair: { symbol: market.pair.symbol, decimals: market.pair.decimals }, tokenDecimals: null }));
  for (const { market, log } of launch.logs) {
    events.push(...journalEventsOf(log.events, { ...base(market), observedAt: log.observedAt, pair: { symbol: log.pair.symbol, decimals: log.pair.decimals }, tokenDecimals: log.tokenDecimals }));
  }
  for (const { vault, market } of launch.vaults) {
    events.push(vaultEventOf(vault, { row: market ? rowOf(market) : vaultRowOf(vault), network: launch.network, pair: null, tokenDecimals: null, observedAt: launch.observedAt, now }));
  }
  return events;
}

/** The early accesses whose vault is on the chain, people's only, the newest first, each with its transaction's time. */
async function readVaults(store: Parameters<typeof listEarlyAccessRecords>[0], connection: Connection, cluster: string, health: NonNullable<ReturnType<typeof launchHealthDeps>>, now: number): Promise<VaultRead[]> {
  const records = await listEarlyAccessRecords(store, cluster);
  const open = records.filter((record) => record.steps.VAULT.state === "CONFIRMED" && record.steps.VAULT.signature && now - Date.parse(record.createdAt) <= 30 * 24 * 60 * 60 * 1000);
  if (open.length === 0) return [];
  const own = await health.ryntraWallets();
  const people = open.filter((record) => !own.wallets.has(record.creator) && !isOffensiveName(record.name, record.symbol)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, VAULTS_READ);
  return Promise.all(
    people.map(async (record) => ({
      mint: record.mint,
      symbol: record.symbol,
      name: record.name,
      vault: record.vault,
      signature: record.steps.VAULT.signature as string,
      at: await blockTimeOf(connection, record.steps.VAULT.signature as string, now),
      createdAt: record.createdAt,
    })),
  );
}

async function blockTimeOf(connection: Connection, signature: string, now: number): Promise<string | null> {
  const known = BLOCK_TIMES.get(signature);
  if (known && (known.at !== null || now < known.until)) return known.at;
  const tx = await within(getTransactionAnyVersion(connection, signature).catch(() => null), 4_000);
  const at = tx !== "late" && tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
  if (BLOCK_TIMES.size >= 2_000) BLOCK_TIMES.clear();
  BLOCK_TIMES.set(signature, { at, until: now + BLOCK_TIME_RETRY_MS });
  return at;
}

/** An early access's token as a row for its risk: Jupiter does not list it yet, so nothing is stated — never «no flag». */
function vaultRowOf(vault: VaultRead): PulseRow {
  const empty = { changePct: null, volumeUsd: null, holdersChangePct: null };
  return {
    mint: vault.mint,
    symbol: vault.symbol,
    name: vault.name,
    icon: null,
    launchpad: "Ryntra",
    venue: null,
    graduated: false,
    price: null,
    marketCapUsd: null,
    liquidityUsd: null,
    holders: null,
    holdersAtLeast: false,
    windows: { m5: empty, h1: empty, h6: empty, h24: empty },
    firstPoolAt: vault.createdAt,
    graduatedAt: null,
    top10Pct: null,
    devPct: null,
    creatorLaunches: null,
    creatorGraduated: null,
    verified: false,
    organic: null,
    auditRead: false,
    notices: [],
    curve: null,
    ryntra: { preset: "early-access", technicalValidation: false, launchedAt: vault.createdAt, traded24h: null, daysSinceDex: null, dollarPair: true },
  };
}

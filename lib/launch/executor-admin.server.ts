/**
 * The executor as the operator sees it in the admin — and the switch it flips.
 *
 * The status is reads only: the network, the executor's published address,
 * whether its key is on this server and is that address's, Launch's and the
 * ladder's own stops, the executor's last pass, its SOL, and every market
 * launched on Ryntra here with its stop and the state the executor last wrote
 * down. The switch stops or resumes the executor on one market or on every
 * market, and each flip that changes what holds is a mark in the markets'
 * flight logs (`setExecutorStop`). No key and no secret leaves this server.
 */

import { PublicKey } from "@solana/web3.js";

import type { MarketCycleState } from "../core/launch/market-health.ts";
import type { GuardStore } from "../guard/store.ts";
import { lastAutopilotPass } from "./autopilot.server.ts";
import { readRevenue } from "./budget.server.ts";
import { launchConnection, launchExecutor, launchExecutorAddress, launchFloorOpen, launchOpen, type LaunchNetwork } from "./config.server.ts";
import { readExecutorMarket, readExecutorStops, setExecutorStop, stopOn, type SwitchOutcome } from "./executor.server.ts";
import type { LaunchRecord } from "./flow.server.ts";

export type ExecutorMarketRow = Readonly<{
  token: string;
  name: string;
  symbol: string;
  preset: string;
  launchedAt: string;
  /** The stop that holds here: every market's, this market's own, or none. */
  stopped: "all" | "market" | null;
  /** This market's own stop, whatever holds for every market. */
  ownStop: boolean;
  /** The state the executor last wrote down; null before the first. */
  state: MarketCycleState | null;
  watchedAt: string | null;
  failures: number;
}>;

export type ExecutorStatus = Readonly<{
  network: string;
  /** The executor's published address on this network; null while there is none. */
  executor: string | null;
  /** Its key is on this server — on mainnet only the published address's. */
  keyHere: boolean;
  laneOpen: boolean;
  ladderOpen: boolean;
  lastPassAt: string | null;
  /** The executor's SOL, in lamports; null when not read. */
  lamports: string | null;
  all: Readonly<{ stopped: boolean; at: string | null }>;
  markets: readonly ExecutorMarketRow[];
  /**
   * Ryntra's revenue on the executor's wallet from the markets whose fees it claims (raw USDC): what the claims brought,
   * what of it is still on the wallet beyond the markets' budgets, the budgets themselves, and the last word to the
   * operator; null before the first claim.
   */
  revenue: Readonly<{ claimedRaw: string; onWalletRaw: string; reservesRaw: string; alertedAt: string | null; delivered: boolean | null; at: string }> | null;
  observedAt: string;
}>;

async function launchedRecords(store: GuardStore, cluster: string): Promise<LaunchRecord[]> {
  const records = await store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${cluster}:`);
  return records.filter((record) => record.state !== "PENDING").sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt));
}

export async function executorStatus(network: LaunchNetwork, store: GuardStore, now: Date = new Date()): Promise<ExecutorStatus> {
  const executor = launchExecutorAddress(network);
  const [records, stops, pass, lamports, revenue] = await Promise.all([
    launchedRecords(store, network.cluster),
    readExecutorStops(store, network.cluster),
    lastAutopilotPass(store, network.cluster),
    executor
      ? launchConnection(network)
          .getBalance(new PublicKey(executor), "confirmed")
          .then((value) => String(value))
          .catch(() => null)
      : Promise.resolve(null),
    readRevenue(store, network.cluster),
  ]);
  const markets = await Promise.all(
    records.map(async (record): Promise<ExecutorMarketRow> => {
      const market = await readExecutorMarket(store, network.cluster, record.token).catch(() => null);
      return {
        token: record.token,
        name: record.name,
        symbol: record.symbol,
        preset: record.preset,
        launchedAt: record.launchedAt,
        stopped: stopOn(stops, record.token)?.scope ?? null,
        ownStop: stops.markets.get(record.token)?.stopped === true,
        state: market?.state ?? null,
        watchedAt: market?.watchedAt ?? null,
        failures: market?.failures ?? 0,
      };
    }),
  );
  return {
    network: network.chain,
    executor,
    keyHere: launchExecutor(process.env, network) !== null,
    laneOpen: launchOpen(),
    ladderOpen: launchFloorOpen(),
    lastPassAt: pass?.at ?? null,
    lamports,
    all: { stopped: stops.all?.stopped === true, at: stops.all?.at ?? null },
    markets,
    revenue: revenue ? { claimedRaw: revenue.claimedRaw, onWalletRaw: revenue.onWalletRaw, reservesRaw: revenue.reservesRaw, alertedAt: revenue.alertedAt, delivered: revenue.delivered, at: revenue.at } : null,
    observedAt: now.toISOString(),
  };
}

/** How an admin session answered the freshness of its second factor (`requireFreshMfa`). */
export type SwitchFreshness =
  | Readonly<{ ok: true; admin: Readonly<{ telegramId: number; method?: string | null }>; transitional?: true }>
  | Readonly<{ ok: false; reason: "unauthorized" | "reverify" }>;

/**
 * Who may flip the executor's switch: an admin with a fresh second factor, or the admin session the bot's one-time
 * Telegram link opened — the operator's own door to the admin on production (the decision of 2026-10-09) — when the
 * admin's policy asks it for a second factor it cannot give. A bot path the policy retired stays refused, and so does
 * a request with no admin session at all. Every other admin action keeps its second factor.
 */
export function switchAdmitted(
  fresh: SwitchFreshness,
  session: Readonly<{ telegramId: number; method: string | null; sessionId: string | null }> | null,
): Readonly<{ telegramId: number; door: "second-factor" | "telegram-link" }> | null {
  /* Admitted by the admin's own policy: a fresh second factor — or the Telegram link where the policy leaves it open, said as such. */
  if (fresh.ok) return { telegramId: fresh.admin.telegramId, door: fresh.transitional || fresh.admin.method === "telegram_link" ? "telegram-link" : "second-factor" };
  /*
   * The link's session — recorded (`/api/session` mints a revocable row with this method) or the cookie alone. Only the
   * bot's one-time link opens a session with this method; an account's session keeps its own method and its factor.
   */
  if (fresh.reason === "reverify" && session?.method === "telegram_link") return { telegramId: session.telegramId, door: "telegram-link" };
  return null;
}

/** The operator's flip: a market of this network by its token, or every market (`token` null). A token Ryntra did not launch here is refused. */
export async function flipExecutor(
  network: LaunchNetwork,
  store: GuardStore,
  args: Readonly<{ token: string | null; stopped: boolean; by: string; now?: Date }>,
): Promise<SwitchOutcome | "UNKNOWN_MARKET"> {
  const records = await launchedRecords(store, network.cluster);
  const tokens = records.map((record) => record.token);
  if (args.token !== null && !tokens.includes(args.token)) return "UNKNOWN_MARKET";
  return setExecutorStop(store, { cluster: network.cluster, token: args.token, stopped: args.stopped, by: args.by, now: args.now ?? new Date(), tokens });
}

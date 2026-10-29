/**
 * When an order spends real money, decided by Ryntra before every quote and
 * every fill, never by what the browser asks alone.
 *
 * Three settings of the deployment, all off unless the operator sets them:
 *
 * - `PREDICTIONS_LIVE_FUNDING=on` — money can come in and go out at all
 *   (`funding.ts`); without it nothing below opens.
 * - `PREDICTIONS_LIVE_WALLETS` — the Solana wallets live money is open to,
 *   comma separated; `*` opens it to every proven wallet. Unset, nobody's.
 *   A wallet taken off the list while it holds money no longer sees its
 *   money here: keep it listed until it has withdrawn.
 * - `PREDICTIONS_LIVE_VENUES` — the venues a live order may fill on, comma
 *   separated (`polymarket,limitless`). The route is priced only across
 *   these; a fill anywhere else is refused. Unset, none: every order is
 *   paper.
 * - `PREDICTIONS_LIVE_MAX_USD` — the most one live order may spend, fees
 *   included; $5 when unset, never above $10 000. A value that is not a
 *   number of at least $1 closes live orders rather than guessing.
 *
 * And one fact of the provider: the app's own trading mode
 * (`GET /app/config` → `tradingMode`). A paper app has no real-money path,
 * so a live order is refused there however the settings stand.
 *
 * Pure apart from the provider read in `readLiveAccess`. Server only.
 */

import type { PredictionProvider } from "./provider.ts";

export type TradeMode = "paper" | "live";

export const LIVE_MAX_USD_DEFAULT = 5;
/** The most the price may move against a live order before it stops, in basis points. */
export const LIVE_SLIP_CAP_BPS = 200;
const LIVE_MAX_USD_CEILING = 10_000;
const VENUE = /^[a-z][a-z0-9_.-]{1,31}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type LiveSettings = Readonly<{
  funding: boolean;
  wallets: "all" | ReadonlySet<string>;
  venues: readonly string[];
  maxOrderUsd: number;
}>;

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function readLiveSettings(env: NodeJS.ProcessEnv = process.env): LiveSettings {
  const funding = (env.PREDICTIONS_LIVE_FUNDING ?? "").trim().toLowerCase() === "on";
  const walletList = list(env.PREDICTIONS_LIVE_WALLETS);
  const wallets = walletList.includes("*") ? ("all" as const) : new Set(walletList.filter((w) => BASE58.test(w)));
  const venues = [...new Set(list(env.PREDICTIONS_LIVE_VENUES).map((v) => v.toLowerCase()).filter((v) => VENUE.test(v)))];
  const raw = (env.PREDICTIONS_LIVE_MAX_USD ?? "").trim();
  const asked = Number(raw);
  const maxOrderUsd = raw === "" ? LIVE_MAX_USD_DEFAULT : Number.isFinite(asked) && asked >= 1 ? Math.min(asked, LIVE_MAX_USD_CEILING) : 0;
  return { funding, wallets, venues, maxOrderUsd };
}

/** Whether live money — deposits, withdrawals, live orders — is open to this wallet on this deployment. */
export function liveWalletAllowed(wallet: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const s = readLiveSettings(env);
  if (!s.funding) return false;
  return s.wallets === "all" ? BASE58.test(wallet) : s.wallets.has(wallet);
}

/** The venues a live order of this wallet may fill on; empty when live trading is not open to it. */
export function liveVenuesFor(wallet: string, env: NodeJS.ProcessEnv = process.env): readonly string[] {
  if (!liveWalletAllowed(wallet, env)) return [];
  const s = readLiveSettings(env);
  return s.maxOrderUsd >= 1 ? s.venues : [];
}

/**
 * Where live trading stands for one wallet, as the ticket and the account
 * show it: `off` — not open to this wallet here (or no venue is open);
 * `app_paper` — open here, but the provider's app trades on paper only;
 * `unknown` — the provider's mode could not be read; `open` — a live order
 * may be reviewed.
 */
export type LiveAccess = Readonly<{
  state: "off" | "app_paper" | "unknown" | "open";
  venues: readonly string[];
  maxOrderUsd: number;
  appMode: string | null;
}>;

export async function readLiveAccess(provider: PredictionProvider, wallet: string, env: NodeJS.ProcessEnv = process.env): Promise<LiveAccess> {
  const settings = readLiveSettings(env);
  const venues = liveVenuesFor(wallet, env);
  if (venues.length === 0) return { state: "off", venues: [], maxOrderUsd: settings.maxOrderUsd, appMode: null };
  const mode = await provider.appMode();
  if (!mode.ok) return { state: "unknown", venues, maxOrderUsd: settings.maxOrderUsd, appMode: null };
  return { state: mode.value === "live" ? "open" : "app_paper", venues, maxOrderUsd: settings.maxOrderUsd, appMode: mode.value };
}

/** Venues of a route that are not open to live orders. */
export function venuesOutside(fillVenues: readonly string[], allowed: readonly string[]): readonly string[] {
  const open = new Set(allowed.map((v) => v.toLowerCase()));
  return [...new Set(fillVenues.map((v) => v.toLowerCase()))].filter((v) => !open.has(v));
}

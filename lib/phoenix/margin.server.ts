import "server-only";

import { marginAccountFrom, marketParamsFrom, spotParamsFrom, ticketMargin, type TicketDraft, type TicketMargin } from "./margin.ts";
import { getJson, type PhoenixRead } from "./read.server.ts";

/**
 * The reads behind the ticket's margin (PERP-4): Phoenix's markets and stats a few seconds per process, the collateral
 * assets a few minutes (they change when Phoenix lists one), the wallet's trader state each time — the account is the
 * person's and moves with every fill. Public reads by the wallet's address only; no key.
 */

const MARKETS_TTL_MS = 5_000;
const ASSETS_TTL_MS = 300_000;
/** A wallet's trader state for the ticket: a few seconds, so a person typing costs Phoenix one read, not one a keystroke. */
const STATE_TTL_MS = 3_000;
const STATE_KEEP = 500;
const states = new Map<string, { at: number; value: Promise<PhoenixRead<unknown>> }>();

function stateRead(wallet: string, now: number): Promise<PhoenixRead<unknown>> {
  const kept = states.get(wallet);
  if (kept && now - kept.at < STATE_TTL_MS) return kept.value;
  const value = getJson(`/v1/trader/state/${encodeURIComponent(wallet)}?traderPdaIndex=0`);
  states.delete(wallet);
  states.set(wallet, { at: now, value });
  if (states.size > STATE_KEEP) states.delete(states.keys().next().value as string);
  /* A failed read is not kept: the next ticket asks again. */
  void value.then((read) => {
    if (!read.ok && read.code !== "NOT_FOUND" && states.get(wallet)?.value === value) states.delete(wallet);
  });
  return value;
}

let markets: { at: number; value: Promise<PhoenixRead<readonly [unknown, unknown]>> } | null = null;
let assets: { at: number; value: Promise<unknown> } | null = null;

function marketsRead(now: number): Promise<PhoenixRead<readonly [unknown, unknown]>> {
  if (markets && now - markets.at < MARKETS_TTL_MS) return markets.value;
  const value = Promise.all([getJson("/v1/view/exchange/markets"), getJson("/v1/markets/stats/latest")]).then(([config, stats]): PhoenixRead<readonly [unknown, unknown]> => {
    if (!config.ok) return config;
    /* The calculator needs the mark: stats that failed count nothing. */
    if (!stats.ok) return stats;
    return { ok: true, value: [config.value, stats.value] as const };
  });
  markets = { at: now, value };
  /* A failed read is not kept: the next ticket asks again. */
  void value.then((read) => {
    if (!read.ok && markets?.value === value) markets = null;
  });
  return value;
}

function assetsRead(now: number): Promise<unknown> {
  if (assets && now - assets.at < ASSETS_TTL_MS) return assets.value;
  const value = getJson("/v1/collateral/assets").then((read) => (read.ok ? read.value : null));
  assets = { at: now, value };
  void value.then((read) => {
    if (read === null && assets?.value === value) assets = null;
  });
  return value;
}

/** The ticket's figures for a wallet's draft, by the SDK's margin calculator; not found — a market it cannot count. */
export async function readTicketMargin(wallet: string, draft: TicketDraft, now: () => number = Date.now): Promise<PhoenixRead<TicketMargin & { observedAt: number }>> {
  const at = now();
  const [read, assetList, state] = await Promise.all([marketsRead(at), assetsRead(at), stateRead(wallet, at)]);
  if (!read.ok) return read;
  if (!state.ok && state.code !== "NOT_FOUND") return state;
  const params = marketParamsFrom(read.value[0], read.value[1]);
  const account = state.ok ? marginAccountFrom(state.value, spotParamsFrom(assetList, params)) : null;
  const figures = ticketMargin({ markets: params, account, draft });
  return figures ? { ok: true, value: { ...figures, observedAt: now() } } : { ok: false, code: "NOT_FOUND", status: 404 };
}

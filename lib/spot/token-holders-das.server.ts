/**
 * Every token account of a small coin from Helius DAS `getTokenAccounts`, so the holders tab can list up to
 * a hundred holders instead of the node's twenty largest accounts. Behind a closed switch.
 *
 * - **Closed by default.** Only with `RYNTRA_SPOT_TOKEN_HOLDERS=das` and a mainnet node that is Helius's (its URL
 *   carries the key; nothing new is configured). Otherwise null, and the page lists the twenty largest as before.
 * - **Only a whole list.** DAS lists accounts by page, not by size, so the largest hundred are known only when every
 *   account was read. It is asked only for a coin Jupiter counts at most `DAS_MAX_HOLDERS` holders of, at most
 *   `DAS_PAGES` pages (10 credits each); a list that did not end within them is not used.
 * - **A day's ceiling.** One instance spends at most `RYNTRA_SPOT_TOKEN_HOLDERS_DAILY_CREDITS` credits on it in a
 *   calendar day (UTC; 10 000 unless set). Past it the read is not made: null, as when the switch is closed.
 * - Any failure is null: the node's twenty largest answer instead.
 */

import { parseJsonWithBigInts } from "@solana/rpc-spec-types";

import { resolveEndpoints, type SolanaEndpoint } from "../solana/rpc.ts";
import { dayBudget, dayCeilingOf } from "./day-budget.ts";
import type { HolderAccount } from "./token-page.ts";

export const TOKEN_HOLDERS_ENV = "RYNTRA_SPOT_TOKEN_HOLDERS";
export const TOKEN_HOLDERS_ON = "das";
/** The most credits one instance spends on whole reads of holders in a calendar day (UTC). */
export const TOKEN_HOLDERS_DAILY_ENV = "RYNTRA_SPOT_TOKEN_HOLDERS_DAILY_CREDITS";
export const TOKEN_HOLDERS_DAILY_CREDITS = 10_000;
/** What a page of DAS costs. */
const PAGE_CREDITS = 10;
const day = dayBudget();

/** Test seam: the day of the holders' reads starts over. */
export function resetHoldersDas(): void {
  day.reset();
}
/** Accounts a page lists: DAS's own ceiling. */
export const DAS_PAGE_LIMIT = 1_000;
export const DAS_PAGES = 2;
/** A coin with more holders than this is not read whole: its largest twenty come from the node. */
export const DAS_MAX_HOLDERS = DAS_PAGE_LIMIT * DAS_PAGES;
const CALL_TIMEOUT_MS = 6_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

type Env = Readonly<Record<string, string | undefined>>;
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** The node's URL when the switch is on and the node is Helius's from the environment; null otherwise. */
export function holdersDasEndpoint(env: Env = process.env, endpoints: readonly SolanaEndpoint[] = resolveEndpoints("mainnet")): string | null {
  if (env[TOKEN_HOLDERS_ENV]?.trim().toLowerCase() !== TOKEN_HOLDERS_ON) return null;
  const helius = endpoints.find((endpoint) => endpoint.fromEnv && /(^|\.)helius-rpc\.com$/iu.test(endpoint.host));
  return helius?.url ?? null;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;

/** One DAS page's accounts in the holders' shape; a page that is not the published shape throws. */
export function holderAccountsOfDas(body: unknown, mint: string): Readonly<{ accounts: HolderAccount[]; count: number }> {
  const result = body && typeof body === "object" ? (body as { result?: unknown }).result : null;
  const list = result && typeof result === "object" ? (result as { token_accounts?: unknown }).token_accounts : null;
  if (!Array.isArray(list)) throw new Error("DAS answered without a list of token accounts.");
  const accounts: HolderAccount[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (row.mint !== undefined && row.mint !== mint) continue;
    const account = typeof row.address === "string" && BASE58.test(row.address) ? row.address : null;
    const owner = typeof row.owner === "string" && BASE58.test(row.owner) ? row.owner : null;
    const amount = typeof row.amount === "bigint" ? row.amount.toString() : typeof row.amount === "number" && Number.isInteger(row.amount) && row.amount >= 0 ? BigInt(row.amount).toString() : null;
    if (!account || !owner || amount === null || amount === "0") continue;
    accounts.push({ account, owner, amountRaw: amount });
  }
  return { accounts, count: list.length };
}

/**
 * Every account of the coin, or null: the switch closed, the coin larger than a whole read allows, its holders not
 * counted, or the read not whole or failed.
 */
export async function readHolderAccountsWhole(mint: string, holderCount: number | null, deps: Readonly<{ fetch?: Fetch; endpoint?: string | null; now?: () => number; env?: Env }> = {}): Promise<readonly HolderAccount[] | null> {
  const endpoint = deps.endpoint !== undefined ? deps.endpoint : holdersDasEndpoint();
  if (!endpoint) return null;
  if (holderCount === null || !Number.isFinite(holderCount) || holderCount > DAS_MAX_HOLDERS) return null;
  const now = deps.now ?? Date.now;
  /* The day's ceiling: a whole read's most must fit, or the node's twenty largest answer instead. */
  if (!day.allows(DAS_PAGES * PAGE_CREDITS, dayCeilingOf((deps.env ?? process.env)[TOKEN_HOLDERS_DAILY_ENV], TOKEN_HOLDERS_DAILY_CREDITS), now())) return null;
  const send = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const accounts: HolderAccount[] = [];
  try {
    for (let page = 1; page <= DAS_PAGES; page += 1) {
      day.spend(PAGE_CREDITS, now());
      const response = await send(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: `holders-${page}`, method: "getTokenAccounts", params: { mint, page, limit: DAS_PAGE_LIMIT } }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) return null;
      /* Big integers stay exact: a raw balance past 2^53 is an ordinary memecoin's. */
      const read = holderAccountsOfDas(parseJsonWithBigInts(text), mint);
      accounts.push(...read.accounts);
      /* A short page is the list's end: every account was read. */
      if (read.count < DAS_PAGE_LIMIT) return accounts;
    }
    return null;
  } catch {
    /* The key travels in the URL: nothing of the failure is said. */
    return null;
  }
}

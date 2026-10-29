/**
 * The welcome credits (AI-04, PLAN §9): once after sign-in, with a check
 * against farming them — the wallet has lived and acted (its first
 * transaction at least `welcomeMinAgeDays` ago, at least `welcomeMinTxs`
 * successful ones), and one welcome per wallet and per account, whichever
 * comes first. A new empty wallet gets the free credits of every day, not
 * the welcome ones. Read only: one public JSON-RPC call, nothing signed.
 *
 * The Seeker Genesis Token as a second door is the phone's (AI-13): the
 * maintained checker is days old, and nothing here hand-rolls it.
 */

import type { GuardStore } from "../../guard/store.ts";
import { claimTaken, grantCredits, readBalance } from "./ledger.ts";
import type { CreditsConfig } from "./prices.ts";

/** What a wallet's history says: successful transactions seen, the oldest one's time, and whether the read reached the start. */
/** `full` — the page of the newest thousand was full: a wallet that busy is active enough whatever its first day. */
export type WalletHistory = Readonly<{ txs: number; oldestAt: number | null; full?: boolean }>;
export type WalletHistoryReader = (wallet: string) => Promise<WalletHistory | null>;

const SIGNATURES_LIMIT = 1_000;

/** One `getSignaturesForAddress` page — the newest thousand: a wallet with more is old and active enough by any measure. */
export function rpcWalletHistory(endpoint: string, fetchImpl: typeof fetch = fetch, timeoutMs = 4_000): WalletHistoryReader {
  return async (wallet) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [wallet, { limit: SIGNATURES_LIMIT, commitment: "finalized" }] }), signal: controller.signal });
      if (!response.ok) return null;
      const body = (await response.json()) as { result?: unknown };
      if (!Array.isArray(body.result)) return null;
      const rows = body.result as readonly Readonly<{ err?: unknown; blockTime?: number | null }>[];
      const times = rows.map((row) => row.blockTime).filter((time): time is number => typeof time === "number" && Number.isFinite(time));
      return { txs: rows.filter((row) => row.err === null || row.err === undefined).length, oldestAt: times.length > 0 ? Math.min(...times) * 1000 : null, full: rows.length >= SIGNATURES_LIMIT };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

export type WelcomeResult =
  | Readonly<{ ok: true; credits: number }>
  | Readonly<{ ok: false; code: "WELCOME_TAKEN" | "WELCOME_NOT_ELIGIBLE" | "UNAVAILABLE"; reason: string }>;

export function welcomeEligible(history: WalletHistory, config: CreditsConfig, nowMs: number): boolean {
  if (history.full === true && history.txs >= config.welcomeMinTxs) return true;
  return history.txs >= config.welcomeMinTxs && history.oldestAt !== null && history.oldestAt <= nowMs - config.welcomeMinAgeDays * 86_400_000;
}

/** Grant the welcome credits to `holder` for `wallet`, once per wallet and once per account. */
export async function claimWelcome(store: GuardStore, input: Readonly<{ holder: string; wallet: string; accountId: string | null; history: WalletHistoryReader; config: CreditsConfig; nowMs: number }>): Promise<WelcomeResult> {
  if (input.config.welcome < 1) return { ok: false, code: "WELCOME_NOT_ELIGIBLE", reason: "There are no welcome credits on this deployment." };
  const claims = [`welcome:wallet:${input.wallet}`, ...(input.accountId ? [`welcome:account:${input.accountId}`] : [])];
  try {
    const balance = await readBalance(store, input.holder);
    if (balance?.welcome) return { ok: false, code: "WELCOME_TAKEN", reason: "The welcome credits were already given." };
    for (const claim of claims) if (await claimTaken(store, claim)) return { ok: false, code: "WELCOME_TAKEN", reason: "The welcome credits were already given." };
  } catch {
    return { ok: false, code: "UNAVAILABLE", reason: "The credits store did not answer." };
  }
  const history = await input.history(input.wallet);
  if (history === null) return { ok: false, code: "UNAVAILABLE", reason: "The wallet's history could not be read now; try again later." };
  if (!welcomeEligible(history, input.config, input.nowMs)) return { ok: false, code: "WELCOME_NOT_ELIGIBLE", reason: `The welcome credits are for a wallet at least ${input.config.welcomeMinAgeDays} days old with ${input.config.welcomeMinTxs} transactions or more; the free credits of every day are yours anyway.` };
  const granted = await grantCredits(store, input.holder, { credits: input.config.welcome, bucket: "bonus", reason: "welcome", idem: `welcome:${input.wallet}`, claims, nowMs: input.nowMs });
  /* A second ask at once answers the first grant again: said as taken, so nobody reads «+100» twice. */
  if (granted.ok) return granted.repeat ? { ok: false, code: "WELCOME_TAKEN", reason: "The welcome credits were already given." } : { ok: true, credits: granted.credits };
  return granted.code === "CLAIM_TAKEN" ? { ok: false, code: "WELCOME_TAKEN", reason: granted.reason } : { ok: false, code: "UNAVAILABLE", reason: granted.reason };
}

import "server-only";

import { AGENT_FEE_CEILING_BPS } from "../mandate/fee-rates.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import { storeSupportsConcurrentInstances, type GuardStore } from "../guard/store.ts";
import { readTokenRiskFacts } from "../solana/risk-facts.ts";
import { readJupiterList, readSpotFactsByMint } from "../spot/markets.server.ts";
import { readMintTradeEvents } from "../spot/token-events.server.ts";
import type { TokenHolder } from "../spot/token-page.ts";
import { readTokenHolders } from "../spot/token-page.server.ts";
import { WRAPPED_SOL_MINT } from "../solana/send-kinds.ts";
import { dayUsdOf, scoutModeOf, thesisCallsAllowed } from "./flag.ts";
import { SCOUT_LISTS } from "./feed.ts";
import { scoutPass, type PassDeps, type PassResult } from "./pass.ts";
import { scoutPriceOf, scoutWriterOf } from "./provider.server.ts";
import { SCOUT_PAPER, SCOUT_READS, SCOUT_THESIS } from "./rules.ts";
import { appendJournal, chainReadsLeft, claimPass, countChainReads, loadDesk, saveDesk, scoutThesisMeter, type ScoutNetwork } from "./store.server.ts";
import { thesisRequest, requestTokensBound } from "./thesis.ts";

/**
 * One pass of the Scout on this deployment (the cron, every five minutes): only with the switch on (`RYNTRA_SCOUT=paper`)
 * and a store every instance shares; one instance a slot. The feed is the market's own «New» lists through the shared
 * cache (no read of its own while the market is open); the chain reads are our gateway's facts and the chain's events,
 * each behind its own switch and day ceiling, and the Scout's own (`SCOUT_READS`) — where the gateway gave no holders,
 * the coin page's own holders read stands in; the model is the assistant's provider
 * under the Scout's day ceiling in dollars. Paper only: nothing here signs, sends or reads a key.
 */

const NETWORK: ScoutNetwork = "mainnet";
/** A list a pass reads may be this old; older, it is read again first. */
const LIST_TTL_MS = { recent: 15_000, other: 60_000 } as const;
const LIST_GRACE_MS = 5 * 60_000;

export type ScoutTickAnswer =
  | Readonly<{ ran: false; why: "off" | "no-store" | "taken" | "lost" }>
  | Readonly<{ ran: true; seen: number; screened: number; chained: number; asked: number; took: number; closed: number; open: number; missing: readonly string[] }>;

type Env = Readonly<Record<string, string | undefined>>;

function sharedStore(): GuardStore | null {
  const guard = getGuardRuntime();
  return guard.writes.allowed && storeSupportsConcurrentInstances(guard.store) ? guard.store : null;
}

/** The coin page's largest holders, or null where the node did not list them. */
async function holdersListOf(mint: string): Promise<readonly TokenHolder[] | null> {
  const read = await readTokenHolders(mint).catch(() => null);
  return read && read.ok ? read.holders : null;
}

/** The deployment's pieces of a pass. */
export function passDepsOf(env: Env, store: GuardStore, now: number, solUsd: number | null): PassDeps {
  const writer = scoutWriterOf(env);
  const tokens = requestTokensBound(thesisRequest(writer?.model ?? "model", { probe: "x".repeat(1_200) }));
  const dayCalls = writer ? thesisCallsAllowed({ dayUsd: dayUsdOf(env), price: scoutPriceOf(writer.model, env), inputTokens: tokens, outputTokens: SCOUT_THESIS.maxOutputTokens }) : 0;
  return {
    now,
    async lists() {
      const reads = await Promise.all(SCOUT_LISTS.map((path) => readJupiterList(path, path === "/recent" ? LIST_TTL_MS.recent : LIST_TTL_MS.other, LIST_GRACE_MS)));
      const ok = reads.filter((read): read is Extract<typeof read, { ok: true }> => read.ok);
      return ok.length ? ok.map((read) => read.raw) : null;
    },
    async chain(candidate) {
      const [risk, trades] = await Promise.all([
        readTokenRiskFacts({ mint: candidate.mint, env: env as NodeJS.ProcessEnv, timeoutMs: SCOUT_READS.factsTimeoutMs }),
        readMintTradeEvents(candidate.mint, { capSupply: null, multiplier: null, solPriceUsd: solUsd }).catch(() => null),
      ]);
      /* The gateway gave no holders: the coin page's own read of its largest holders stands in, never a guess. */
      const gatewayHolders = risk.state === "READ" ? risk.facts.holders?.concentration_plain_accounts ?? null : null;
      const holders = gatewayHolders ? null : await holdersListOf(candidate.mint);
      return { risk, trades: trades ? { trades: trades.trades, whole: trades.whole } : null, holders };
    },
    chainBudget: () => chainReadsLeft(store, now, SCOUT_READS.perDay),
    writer,
    meter: writer && dayCalls > 0 ? scoutThesisMeter(store, dayCalls) : null,
    async marks(mints) {
      const read = await readSpotFactsByMint(mints);
      if (!read.ok) return null;
      const out = new Map<string, { price: number | null; volumeH1Usd: number | null; volumeH6Usd: number | null }>();
      for (const mint of mints) {
        const market = read.byMint.get(mint);
        if (!market) continue;
        const facts = read.facts.get(mint);
        out.set(mint, { price: market.price, volumeH1Usd: facts?.windows.h1.volumeUsd ?? market.stats.h1.volumeUsd, volumeH6Usd: facts?.windows.h6.volumeUsd ?? null });
      }
      return out;
    },
    solUsd,
    feeBps: AGENT_FEE_CEILING_BPS,
    budget: { perDayLamports: SCOUT_PAPER.perDayLamports, perTradeLamports: SCOUT_PAPER.perTradeLamports },
  };
}

async function solUsdNow(): Promise<number | null> {
  const read = await readSpotFactsByMint([WRAPPED_SOL_MINT]).catch(() => null);
  const price = read && read.ok ? read.byMint.get(WRAPPED_SOL_MINT)?.price ?? null : null;
  return price !== null && price > 0 ? price : null;
}

export async function scoutTick(env: Env = process.env, now: number = Date.now()): Promise<ScoutTickAnswer> {
  if (scoutModeOf(env) === "off") return { ran: false, why: "off" };
  const store = sharedStore();
  if (!store) return { ran: false, why: "no-store" };
  if (!(await claimPass(store, NETWORK, now))) return { ran: false, why: "taken" };
  const desk = await loadDesk(store, NETWORK);
  const result: PassResult = await scoutPass(desk, passDepsOf(env, store, now, await solUsdNow()));
  if (!(await saveDesk(store, desk, result.desk))) return { ran: false, why: "lost" };
  await countChainReads(store, now, result.stats.chained).catch(() => undefined);
  await appendJournal(store, NETWORK, result.news).catch(() => undefined);
  const s = result.stats;
  return { ran: true, seen: s.seen, screened: s.screened, chained: s.chained, asked: s.asked, took: s.took, closed: s.closed, open: result.desk.open.length, missing: s.missing };
}

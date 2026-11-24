#!/usr/bin/env node
/*
 * The paper week's first passes on live quotes, for a session whose network reaches Jupiter (the cloud's
 * does not). It runs the code the cron runs (`runPaperPass`) and the code a start runs (`startPaper`) on Jupiter's live
 * `/order` quotes, inside paper's own budget (`./quota.ts`, the shared window ledger), over a store in memory: no
 * database, no wallet, no key of a person, no transaction, nothing signed or placed — quotes without a taker.
 *
 *   node lib/mandate/paper/live-check.mjs                 # with RYNTRA_JUPITER_API_KEY in the environment: the keyed lane
 *   node lib/mandate/paper/live-check.mjs --keyless       # without a key: Jupiter's labelled keyless lane (0.5 RPS)
 *   node lib/mandate/paper/live-check.mjs --coin <mint> --symbol <name>   # another coin than JUP
 *   node lib/mandate/paper/live-check.mjs --deployed https://ryntra.io    # and the deployed cron, with CRON_SECRET
 *
 * The key and CRON_SECRET are read from the environment and never printed.
 *
 * Expected output (figures move with the market; the shape and the PASS line do not):
 *
 *   paper live check · Jupiter Swap API V2 · keyed production access · JUP
 *   1 start          ok · 1 paper trade · 0.02 SOL → 41123456 JUP raw · Ryntra 20000 lamports · sale fee 10 bps
 *   2 round trip     the bought coins quote back at 0.9871 of the SOL spent
 *   3 pass +5 h      bought · 2 paper trades
 *   4 pass +5 h      waited · the rhythm holds
 *   5 dip            waited · 1 mark read
 *   6 budget         paper asked Jupiter 3 times · room 116 · window 587 of 600 left · reset in 39 s
 *   PASS — the paper week's start and first passes ran on live quotes, inside paper's own budget
 *
 * With `--deployed`, one more line — while paper is closed on the deployment:
 *   7 deployed       /api/cron/agent-paper → 200 · ran false · why closed
 * open, before the migration is applied:
 *   7 deployed       /api/cron/agent-paper → 200 · ran false · why no-store
 * and once it is open with the migration applied:
 *   7 deployed       /api/cron/agent-paper → 200 · ran true · agents 3 · counts {"waited":2,"bought":1}
 *
 * Any other line ends in FAIL with the reason, exit code 1. `held` on a pass means paper's share of the window was
 * spent (other traffic on the key): run again in a minute. `NO_PRICE` at the start means Jupiter did not quote the coin.
 */

import { randomBytes } from "node:crypto";

import { jupiterBudget } from "../../solana/jupiter-budget.ts";
import { resolveJupiterSwapEndpoint } from "../../solana/quotes.ts";
import { createPaperQuota, createPaperQuoteCache } from "./quota.ts";
import { jupiterPaperReads } from "./reads.server.ts";
import { runPaperPass, startPaper, whoOf } from "./service.server.ts";
import { createMemoryPaperStore } from "./store.ts";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const COIN = option("--coin") ?? "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const SYMBOL = option("--symbol") ?? (option("--coin") ? "COIN" : "JUP");
const DEPLOYED = option("--deployed");
const SOL = 1_000_000_000n;
const HOUR = 3_600_000;

const sol = (lamports) => (Number(lamports) / 1e9).toFixed(4).replace(/\.?0+$/u, "");
let failed = false;
function line(n, label, text, ok = true) {
  console.log(`${n} ${label.padEnd(16)} ${text}${ok ? "" : "  FAIL"}`);
  if (!ok) failed = true;
}

const selection = flag("--keyless") ? resolveJupiterSwapEndpoint({ access: "degraded" }) : resolveJupiterSwapEndpoint();
if (!selection.ok) {
  console.log(`paper live check · ${selection.reason}`);
  console.log("FAIL — no Jupiter lane: set RYNTRA_JUPITER_API_KEY, or pass --keyless");
  process.exit(1);
}
console.log(`paper live check · ${selection.label} · ${SYMBOL}`);

let asks = 0;
const counted = async (input, init) => {
  asks += 1;
  return fetch(input, init);
};
const quota = createPaperQuota();
const cache = createPaperQuoteCache();
const reads = (coin) => jupiterPaperReads(coin, { selection, quota, cache, fetchImpl: counted });

const T = Date.now();
let now = T;
const store = createMemoryPaperStore({ now: () => now });
const deps = { store, quota, reads, now: () => now };
const who = whoOf("live-check", randomBytes(16).toString("hex"));
const keyOf = () => randomBytes(32).toString("base64url");
/* Paper figures only: 0.1 SOL a day in trades of 0.02 — a steady buy every 4.8 hours. */
const budget = { perDay: (SOL / 10n).toString(), perTrade: (SOL / 50n).toString(), days: 7 };

/* 1 — a start: the table's facts, the first buy's quote, its first pass. */
const started = await startPaper({ key: keyOf(), coin: COIN, symbol: SYMBOL, plan: "steady", ...budget, who }, deps);
if (!started.ok) {
  line(1, "start", `refused · ${started.code}`, false);
  console.log("FAIL — the start did not run on live quotes");
  process.exit(1);
}
const first = [...store.rows.values()][0].agent;
const bought = first.trades.find((trade) => trade.status === "ok");
line(1, "start", `ok · ${started.view.trades} paper trade · ${sol(budget.perTrade)} SOL → ${started.view.heldRaw} ${SYMBOL} raw · Ryntra ${started.view.buyFeesRaw} lamports · sale fee ${first.exitBps ?? "?"} bps`, started.view.trades === 1 && Boolean(bought));

/* 2 — the coins it bought, quoted back: a round trip through the route keeps nearly all of it (spread and fees only). */
if (first.worthRaw !== null && bought) {
  const ratio = Number(BigInt(first.worthRaw)) / Number(BigInt(bought.spentRaw));
  line(2, "round trip", `the bought coins quote back at ${ratio.toFixed(4)} of the SOL spent`, ratio > 0.9 && ratio <= 1.0);
} else line(2, "round trip", "the holding was not quoted back", false);

/* 3, 4 — the cron's pass five hours on (a steady buy is due), then again at once (the rhythm waits). */
now = T + 5 * HOUR;
const pass = await runPaperPass(deps);
const after = [...store.rows.values()][0].agent;
line(3, "pass +5 h", `${pass.map((one) => one.did).join(", ")} · ${after.trades.length} paper trades`, pass.length === 1 && (pass[0].did === "bought" || pass[0].did === "waited"));
now = T + 5 * HOUR + 60_000;
const again = await runPaperPass(deps);
line(4, "pass +5 h", `${again.map((one) => one.did).join(", ")} · the rhythm holds`, again.length === 1 && again[0].did === "waited");

/* 5 — a dip plan reads its price mark from a live quote. */
now = T + 6 * HOUR;
const dip = await startPaper({ key: keyOf(), coin: COIN, symbol: SYMBOL, plan: "dip:500", ...budget, who }, deps);
const dipAgent = dip.ok ? [...store.rows.values()].find((row) => row.agent.plan.startsWith("dip"))?.agent : null;
line(5, "dip", dip.ok ? `${dip.view.trades ? "bought" : "waited"} · ${dipAgent?.marks?.length ?? 0} mark read` : `refused · ${dip.code}`, dip.ok && (dipAgent?.marks?.length ?? 0) >= 1);

/* 6 — paper's budget and the shared window as Jupiter stated it. */
const window = jupiterBudget("shared", Date.now());
const windowText = window.remaining === null ? "window not stated by Jupiter (keyless lane)" : `window ${window.remaining} of ${window.limit ?? "?"} left · reset in ${window.resetAt ? Math.max(0, Math.round((window.resetAt - Date.now()) / 1000)) : "?"} s`;
line(6, "budget", `paper asked Jupiter ${asks} times · room ${quota.room()} · ${windowText}`, asks > 0 && asks <= 4 + 2 * 4 + 4 && quota.refusals() === 0);

/* 7 — the deployed cron, when asked. */
if (DEPLOYED) {
  const secret = process.env.CRON_SECRET;
  if (!secret) line(7, "deployed", "CRON_SECRET is not in the environment", false);
  else {
    const url = new URL("/api/cron/agent-paper", DEPLOYED);
    const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` } }).catch((error) => ({ ok: false, status: 0, json: async () => ({ error: String(error?.message ?? error) }) }));
    const body = await response.json().catch(() => ({}));
    const text = body.ran ? `ran true · agents ${body.agents} · counts ${JSON.stringify(body.counts)}` : `ran ${body.ran} · why ${body.why ?? body.error ?? "?"}`;
    line(7, "deployed", `${url.pathname} → ${response.status} · ${text}`, response.status === 200 && body.ok === true);
  }
}

console.log(failed ? "FAIL — see the lines marked FAIL" : "PASS — the paper week's start and first passes ran on live quotes, inside paper's own budget");
process.exit(failed ? 1 : 0);

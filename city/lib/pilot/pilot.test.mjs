/* CITY-204 — the money autopilot in the city: the sentence in both languages, what it never takes from the other readers,
   the line's door, and «Go live · sign once» on a stand-in server and wallet. No network, no key. */
import assert from "node:assert/strict";
import test from "node:test";

import { bookOf, fit, keyOf } from "../command/parse.ts";
import { DOORS, run } from "../command/run.ts";
import { readAsk } from "../autopilot/read.ts";
import { readDollarAsk } from "../earn/dollar-read.ts";
import { readPilotAsk } from "./read.ts";
import { PILOT } from "./words.ts";
import { pierFor } from "./sign.ts";
import { planData, splitOf } from "../../../lib/pilot/plan.ts";

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BOOK = bookOf([
  { id: JUP, symbol: "JUP", name: "Jupiter", icon: null, mcap: 1e9, liquidity: 1e6, verified: true },
  { id: BONK, symbol: "BONK", name: "Bonk", icon: null, mcap: 9e8, liquidity: 1e6, verified: true },
]);

test("the whole budget in one sentence, Ukrainian and English", () => {
  const uk = readPilotAsk("працюй з моїми 2 SOL і 100 USDC: частину в скарбничку, частину торгуй BONK і JUP, частину в пули", BOOK);
  assert.ok(uk);
  assert.equal(uk.solRaw, "2000000000");
  assert.equal(uk.usdcRaw, "100000000");
  assert.deepEqual(uk.named, { save: true, trade: true, pool: true });
  assert.deepEqual(uk.coins.map((c) => c.symbol), ["BONK", "JUP"]);

  const en = readPilotAsk("put my 2 SOL and 100 USDC on autopilot", BOOK);
  assert.ok(en);
  assert.deepEqual(en.named, {});

  const shares = readPilotAsk("розподіли 3 SOL: 40 % у скарбничку, 30 % у пули, решту торгуй", BOOK);
  assert.deepEqual(shares.named, { save: 4_000, pool: 3_000, trade: true });
  assert.equal(shares.usdcRaw, null);

  const twoPlaces = readPilotAsk("1.5 sol into savings and pools", BOOK);
  assert.deepEqual(twoPlaces.named, { save: true, pool: true });

  const exit = readPilotAsk("work with my 1 SOL: trade JUP, take profit 20%, rest into savings", BOOK);
  assert.equal(exit.plan?.exit?.takeBps, 2_000);
  assert.deepEqual(exit.coins.map((c) => c.symbol), ["JUP"]);
  assert.equal(exit.named.save, true);

  const dollars = readPilotAsk("make my $200 and 1 sol work: savings and trading", BOOK);
  assert.equal(dollars.usdcRaw, "200000000");

  /* Said plainly, as a person says it: both monies and a word of work anywhere. */
  for (const said of ["поклади 0,2 SOL і 5 USDC працювати", "запусти 0,2 SOL і 5 USDC заробляти", "put 0.2 SOL and 5 USDC to work", "earn with 0.2 sol and 5 usdc"]) {
    const plain = readPilotAsk(said, BOOK);
    assert.ok(plain, said);
    assert.equal(plain.solRaw, "200000000", said);
    assert.equal(plain.usdcRaw, "5000000", said);
  }
});

test("never the other readers' sentences: a budget a day, one place, a question, a refusal, words with no money", () => {
  for (const said of [
    "торгуй на 1 SOL на день",
    "trade 0.1 SOL a day",
    "поклади мої USDC працювати",
    "поклади 50 USDC під відсоток",
    "put 20 USDC into savings",
    "buy BONK for 1 SOL",
    "should I split my 2 SOL?",
    "не торгуй мої 2 SOL",
    "частину в скарбничку, частину в пули",
    "split 2 SOL and 3 SOL",
    "розподіли 2 EUR",
  ]) {
    assert.equal(readPilotAsk(said, BOOK), null, said);
  }
  /* And the others still read theirs. */
  assert.ok(readAsk("торгуй на 1 SOL на день", BOOK));
  assert.ok(readDollarAsk("поклади 50 USDC під відсоток"));
});

test("the line's door: the autopilot's card opens filled, only where its switch stands", () => {
  const ask = readPilotAsk("put my 2 SOL and 100 USDC on autopilot", BOOK);
  const command = { kind: "pilot", ask };
  assert.equal(fit(command, { trade: true, spot: true, money: true, earn: true, launch: true, instruct: true }), null);
  assert.deepEqual(fit(command, { trade: true, spot: true, money: true, earn: true, launch: true, instruct: true, pilot: true }), command);
  assert.equal(keyOf(command), "pilot");
  assert.ok(DOORS.includes("openPilot"));
  const calls = [];
  const doors = Object.fromEntries(DOORS.map((name) => [name, (...args) => calls.push([name, ...args])]));
  run(command, doors);
  assert.deepEqual(calls, [["openPilot", ask]]);
});

test("the words: both languages, the one honest line before a signature, no promise", () => {
  for (const lang of ["en", "uk"]) {
    const w = PILOT[lang];
    assert.ok(w.risk.length < 70, "one line");
    const all = Object.values(w).filter((v) => typeof v === "string").join(" ");
    assert.doesNotMatch(all, /guarantee|гарант|x1000|profit for sure|100 %/iu);
    assert.doesNotMatch(all, /API|engine|route|endpoint|mandate|policy|receipt|квитанц|мандат|політик/u, "no technical words on the card");
  }
  assert.match(PILOT.uk.risk, /мінусі/u);
});

test("the pier the pool part goes to: the first SOL–USDC pier the Harbor lists", () => {
  const SOL = "So11111111111111111111111111111111111111112";
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
  const pool = (address, x, y) => ({ kind: "dlmm", address, binStepBps: 4, price: 150, x: { mint: x, symbol: "x", decimals: 9 }, y: { mint: y, symbol: "y", decimals: 6 } });
  assert.equal(pierFor([pool("A", JITO, SOL), pool("B", SOL, USDC)])?.pool.address, "B");
  assert.equal(pierFor([pool("A", JITO, SOL)]), null);
});

test("«Go live · sign once»: every part built by its own door, one wallet prompt, each relayed by its own, the plan joined", async () => {
  const { goLive } = await import("./sign.ts");
  const split = splitOf({ solRaw: 2_000_000_000n, usdcRaw: 100_000_000n, named: {} }, "mainnet", 150);
  const plan = planData(split);
  const seen = [];
  const wire = (n) => Buffer.from([1, ...new Array(64).fill(0), n]).toString("base64");
  const fetcher = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    seen.push([url, body]);
    const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
    if (url === "/api/bots/mandate/review") return json({ record: { owner: "OWNER", policy: "POLICY", settings: "S", vault: "V", budget: "B", perTrade: "1", perDay: "1", expiresAt: "1" }, transactions: ["T1"] });
    if (url === "/api/solana/earn/review") return json({ ticket: `t-${body.market.slice(0, 3)}`, transaction: { wireBase64: wire(body.market.startsWith("EPj") ? 2 : 3) } });
    if (url === "/api/city/earn/piers") return json({ pools: [{ kind: "dlmm", address: "PIER", binStepBps: 4, price: 150, x: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 }, y: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 } }] });
    if (url === "/api/city/earn/piers/zap") return json({ ticket: "t-zap", position: "POS", transactions: [{ wireBase64: wire(4) }, { wireBase64: wire(5) }] });
    if (url === "/api/bots/mandate/submit") return json({ signatures: ["s1"] });
    if (url === "/api/solana/earn/submit") return json({ signature: `sig-${body.ticket}`, state: "LANDED" });
    if (url === "/api/liquidity/submit") return json({ results: [{ signature: "z1", state: "LANDED" }, { signature: "z2", state: "LANDED" }], settled: true });
    if (url === "/api/bots/mandate/agent") return json({ status: "working" });
    if (url === "/api/bots/pilot") return json({ status: "working" });
    return json({}, 404);
  };
  const prompts = [];
  const sign = async (args) => {
    prompts.push(args.unsignedWireBase64);
    return { ok: true, signedWireBase64: args.unsignedWireBase64 };
  };
  /* The mandate's own check reads its bytes: a stand-in that reads none is handed in by the mandate's test; here its bytes are a fixture. */
  const check = await import("../bots/mandate-check.ts");
  const result = await goLive({ wallet: "w", owner: "OWNER" }, { split, plan, coin: { mint: JUP, symbol: "JUP", icon: null }, tradePlan: { id: "steady", exit: null, pace: 1 }, said: "put my money to work", network: "mainnet" }, { fetch: fetcher, sign, sleep: async () => undefined, check: { unsigned: () => ({ ok: true }), same: (a, b) => a === b } }).catch((error) => ({ error }));
  void check;
  assert.equal(result.kind, "on", JSON.stringify(result));
  assert.equal(result.partial, false);
  assert.equal(prompts.length, 1, "one wallet prompt");
  assert.equal(prompts[0].length, 5, "the mandate, two savings, two of the Zap");
  const joined = seen.find(([url]) => url === "/api/bots/pilot")[1];
  assert.equal(joined.policy, "POLICY");
  assert.equal(joined.legs.saveUsdc.signature, "sig-t-EPj");
  assert.equal(joined.legs.saveSol.signature, "sig-t-So1");
  assert.equal(joined.legs.pool.position, "POS");
  assert.equal(joined.legs.pool.pool, "PIER");
  assert.deepEqual(joined.plan, plan);
  const order = seen.map(([url]) => url).filter((url) => url.endsWith("submit"));
  assert.deepEqual(order, ["/api/bots/mandate/submit", "/api/solana/earn/submit", "/api/solana/earn/submit", "/api/liquidity/submit"], "the trade first");
});

test("a part that could not be built stays in the wallet; the rest goes, the card says one part did not", async () => {
  const { goLive } = await import("./sign.ts");
  const split = splitOf({ solRaw: 2_000_000_000n, usdcRaw: 100_000_000n, named: {} }, "mainnet", 150);
  const plan = planData(split);
  const fetcher = async (url) => {
    const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
    if (url === "/api/bots/mandate/review") return json({ record: { owner: "OWNER", policy: "POLICY" }, transactions: ["T1"] });
    if (url === "/api/solana/earn/review") return json({ error: { code: "CLOSED" } }, 403);
    if (url === "/api/city/earn/piers") return json({ pools: [] });
    return json({ signatures: ["s"], status: "working" });
  };
  const sign = async (args) => ({ ok: true, signedWireBase64: args.unsignedWireBase64 });
  const result = await goLive({ wallet: "w", owner: "OWNER" }, { split, plan, coin: { mint: JUP, symbol: "JUP", icon: null }, tradePlan: { id: "steady", exit: null }, said: "x", network: "mainnet" }, { fetch: fetcher, sign, sleep: async () => undefined, check: { unsigned: () => ({ ok: true }), same: (a, b) => a === b } });
  assert.equal(result.kind, "on");
  assert.equal(result.partial, true);
  /* The wallet said no: nothing goes. */
  const refused = await goLive({ wallet: "w", owner: "OWNER" }, { split, plan, coin: null, tradePlan: { id: "steady", exit: null }, said: "x", network: "mainnet" }, { fetch: fetcher, sign: async () => ({ ok: false, reason: "no" }), sleep: async () => undefined, check: { unsigned: () => ({ ok: true }), same: (a, b) => a === b } });
  assert.equal(refused.kind, "walletNo");
});

test("the daily report says the autopilot's week — on a day without a trade too — and its hold for the market", async () => {
  const { reportNote } = await import("../autopilot/report-watch.ts");
  const day = { trades: 0, since: 0, until: 1, spentRaw: "0", boughtRaw: "0", worthRaw: null, earnedRaw: null };
  const note = reportNote("OWNER", "city-agent-report:OWNER:2026-11-05", { day, symbol: null, solUsd: 150, pilot: { weekUsd: 1.24, held: "market" } }, "uk", Date.UTC(2026, 10, 5));
  assert.match(note.text.en.title, /Autopilot this week \+\$1\.24/u);
  assert.match(note.text.uk.title, /Автопілот за тиждень \+\$1,24/u);
  assert.match(note.text.en.reason, /trading paused: market fell/u);
  const minus = reportNote("OWNER", "id", { day, symbol: null, solUsd: 150, pilot: { weekUsd: -0.3, held: null } }, "en", 0);
  assert.match(minus.title, /−\$0\.30/u, "a minus is a minus");
});

test("the wallet holds what the plan moves — or the card says which, before the wallet is asked", async () => {
  const { walletShort, movesOf, SETUP_LAMPORTS, USDC_MINT } = await import("./wallet-check.ts");
  const split = splitOf({ solRaw: 2_000_000_000n, usdcRaw: 100_000_000n, named: {} }, "mainnet", 150);
  const moves = movesOf(split.legs, "mainnet");
  assert.equal(moves.solRaw, split.legs.trade.solRaw + split.legs.save.solRaw + split.legs.pool.solRaw + SETUP_LAMPORTS, "the reserve stays in the wallet");
  assert.equal(moves.usdcRaw, 100_000_000n);
  const holdings = (sol, usdc, complete = true) => ({ owner: "o", sol: sol === null ? null : { spendableRaw: String(sol), decimals: 9 }, tokens: new Map(usdc === null ? [] : [[USDC_MINT, { spendableRaw: String(usdc), decimals: 6 }]]), complete, at: 0 });
  assert.equal(walletShort(split.legs, "mainnet", holdings(2_000_000_000, 100_000_000)), null);
  assert.equal(walletShort(split.legs, "mainnet", holdings(100_000_000, 100_000_000)), "SOL");
  assert.equal(walletShort(split.legs, "mainnet", holdings(2_000_000_000, 5_000_000)), "USDC");
  assert.equal(walletShort(split.legs, "mainnet", holdings(2_000_000_000, null)), "USDC", "a complete read without USDC holds none");
  assert.equal(walletShort(split.legs, "mainnet", holdings(2_000_000_000, null, false)), null, "half a read is no refusal");
  assert.equal(walletShort(split.legs, "mainnet", null), null);
  /* Devnet moves only the trade. */
  assert.equal(movesOf(split.legs, "devnet").usdcRaw, 0n);
});

test("how a person pays, before the signature: only a trade the agent made, the engine's table — no credits", () => {
  assert.match(PILOT.en.pay("0.1", "1"), /only when the agent trades · 0\.1–1% a trade/u);
  assert.match(PILOT.uk.pay("0,1", "1"), /лише коли агент торгує · 0,1–1% з угоди/u);
  assert.match(PILOT.uk.noCredits, /кредитів/u);
});

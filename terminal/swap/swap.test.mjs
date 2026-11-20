import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bookOf, fit, parse } from "../../city/lib/command/parse.ts";
import { run } from "../../city/lib/command/run.ts";
import { setMoneyEnv, useMoneyStore } from "../../city/lib/money/store.ts";
import { SOL, USDC } from "../../city/lib/trade/tiles.ts";
import { useWallet } from "../../city/lib/trade/wallet.ts";
import { swapDoors } from "./doors.ts";
import { BRIDGE_PATH, FILL_LIFE_MS, SOL_REF, tradeBusy, useSwapScreen } from "./state.ts";
import { agoOf, bridgeStep, depositStep, leaveOf, pickList, pickPlan, priceFigure, rateOf, recentRows, searchable, unitsOf, usdWorth, withFound } from "./swap-view.ts";

/* The Swap screen's own rules as they are written, and a sentence handed to it: it fills the screen's own fields and
   never orders, builds a transfer, asks the wallet or sends anything. */

const snapshot = JSON.parse(readFileSync(new URL("../../city/lib/market/snapshot.json", import.meta.url), "utf8"));
const BOOK = bookOf(snapshot.towers);
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OPEN = { trade: true, spot: true, money: true, earn: false, launch: false, instruct: false };
const asset = (mint, symbol, decimals = null, name = null) => ({ mint, symbol, decimals, name, icon: null });
const JUP_ASSET = asset(JUP, "JUP", 6, "Jupiter");
const BONK_ASSET = asset(BONK, "BONK", 5, "Bonk");

const flush = async () => {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

test("the rate is one of the ticket's coin in the other, whichever way it is swapped", () => {
  // 100 USDC for 1.3833 SOL: one SOL is 72.29 USDC.
  assert.deepEqual(rateOf({ side: "buy", subject: "SOL", counter: "USDC", inRaw: "100000000", outRaw: "1383300000", inDecimals: 6, outDecimals: 9 }), { one: "SOL", price: "72.29", other: "USDC" });
  // 1 SOL sold for 72.22 USDC: the same way round.
  assert.deepEqual(rateOf({ side: "sell", subject: "SOL", counter: "USDC", inRaw: "1000000000", outRaw: "72220000", inDecimals: 9, outDecimals: 6 }), { one: "SOL", price: "72.22", other: "USDC" });
  assert.equal(rateOf({ side: "buy", subject: "SOL", counter: "USDC", inRaw: "1", outRaw: "1", inDecimals: null, outDecimals: 9 }), null, "a decimal the engine did not say is not guessed");
  assert.equal(rateOf({ side: "buy", subject: "SOL", counter: "USDC", inRaw: "0", outRaw: "5", inDecimals: 6, outDecimals: 9 }), null);
});

test("a price is written the English way with its own places; the screen puts it in its language", () => {
  assert.equal(priceFigure(72.2), "72.20");
  assert.equal(priceFigure(65017.256), "65,017.26");
  assert.equal(priceFigure(0.0029174), "0.002917");
  assert.equal(priceFigure(0.5), "0.5");
  assert.equal(priceFigure(0.00000003194), "0.0₇3194", "a tiny rate folds its zeros as the chart does");
  assert.equal(priceFigure(0.0001234), "0.0001234", "three zeros stay written out");
  assert.equal(priceFigure(0), "—");
});

test("a coin picked from a field: the same one does nothing, the other field's one flips, else it takes its field", () => {
  const buying = { side: "buy", subject: SOL.mint, counter: USDC.mint };
  assert.deepEqual(pickPlan({ ...buying, field: "pay", picked: USDC }), { kind: "none" });
  assert.deepEqual(pickPlan({ ...buying, field: "pay", picked: SOL }), { kind: "flip" });
  assert.deepEqual(pickPlan({ ...buying, field: "get", picked: USDC }), { kind: "flip" });
  assert.deepEqual(pickPlan({ ...buying, field: "pay", picked: BONK_ASSET }), { kind: "counter", asset: BONK_ASSET });
  assert.deepEqual(pickPlan({ ...buying, field: "get", picked: JUP_ASSET }), { kind: "subject", asset: JUP_ASSET, side: "buy" });

  // Selling, «you pay» is the coin sold and «you get» what it is sold into.
  const selling = { side: "sell", subject: JUP, counter: USDC.mint };
  assert.deepEqual(pickPlan({ ...selling, field: "pay", picked: BONK_ASSET }), { kind: "subject", asset: BONK_ASSET, side: "sell" });
  assert.deepEqual(pickPlan({ ...selling, field: "get", picked: SOL }), { kind: "counter", asset: SOL });
  assert.deepEqual(pickPlan({ ...selling, field: "get", picked: JUP_ASSET }), { kind: "flip" });
  assert.deepEqual(pickPlan({ ...selling, field: "pay", picked: USDC }), { kind: "flip" });
});

test("a field lists SOL and USDC first, then what the wallet holds or the market has, each once; a search narrows them", () => {
  const held = [BONK_ASSET, asset(USDC.mint, "USDC", 6)];
  const market = [JUP_ASSET, BONK_ASSET];
  assert.deepEqual(pickList({ field: "pay", held, market, query: "", most: 10 }).map((a) => a.symbol), ["SOL", "USDC", "BONK", "JUP"], "any coin pays: the wallet's first, then the market's");
  assert.deepEqual(pickList({ field: "get", held, market, query: "", most: 10 }).map((a) => a.symbol), ["SOL", "USDC", "JUP", "BONK"]);
  assert.deepEqual(pickList({ field: "get", held, market, query: "jup", most: 10 }).map((a) => a.symbol), ["JUP"]);
  assert.deepEqual(pickList({ field: "get", held, market, query: "bon", most: 10 }).map((a) => a.symbol), ["BONK"]);
  assert.deepEqual(pickList({ field: "get", held, market, query: "jupiter", most: 10 }).map((a) => a.symbol), ["JUP"], "by its name");
  assert.deepEqual(pickList({ field: "get", held, market, query: JUP.toLowerCase(), most: 10 }).map((a) => a.symbol), ["JUP"], "by its address");
  assert.deepEqual(pickList({ field: "get", held, market, query: "zzz", most: 10 }), []);
  assert.equal(pickList({ field: "get", held, market, query: "", most: 2 }).length, 2);
});

test("how long ago, in the screen's steps", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  assert.deepEqual(agoOf(now - 20_000, now), { unit: "now", n: 0 });
  assert.deepEqual(agoOf(now - 5 * 60_000, now), { unit: "minutes", n: 5 });
  assert.deepEqual(agoOf(now - 2 * 3_600_000, now), { unit: "hours", n: 2 });
  assert.deepEqual(agoOf(now - 30 * 3_600_000, now), { unit: "yesterday", n: 1 });
  assert.deepEqual(agoOf(now - 3 * 86_400_000, now), { unit: "days", n: 3 });
  assert.deepEqual(agoOf(now + 60_000, now), { unit: "now", n: 0 }, "a clock ahead is now");
});

const action = (lane, startedAt, out, got, outcome = "DONE", extra = {}) => ({
  schema: "ryntra.solana.wallet-action",
  schemaVersion: "1.0.0",
  version: 1,
  network: "mainnet",
  wallet: TAKER,
  actionId: `${lane}-${startedAt}`,
  lane,
  outcome,
  out,
  in: got,
  destination: null,
  signature: null,
  receiptHash: null,
  sourceTx: null,
  destinationTx: null,
  fee: null,
  origin: null,
  providerRef: null,
  statedUsd: null,
  startedAt,
  updatedAt: startedAt,
  ...extra,
});

test("the ledger's actions as rows: newest first, a swap's coins and what came, a transfer's and a bridge's coin and what left", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const usdc = (raw) => ({ mint: USDC.mint, amountRaw: raw, decimals: 6, symbol: "USDC" });
  const rows = recentRows(
    [
      action("CROSS_SWAP", "2026-11-13T10:00:00Z", usdc("250000000"), null, "DONE", { destination: "ETHEREUM" }),
      action("SWAP", "2026-11-16T11:59:40Z", usdc("100000000"), { mint: null, amountRaw: "1383300000", decimals: 9, symbol: null }),
      action("SWAP", "2026-11-16T10:00:00Z", { mint: null, amountRaw: "1000000000", decimals: 9, symbol: "SOL" }, { mint: JUP, amountRaw: "135600000", decimals: 6, symbol: "$JUP" }),
      action("SEND", "2026-11-15T09:00:00Z", usdc("5000000"), null, "IN_FLIGHT"),
      action("RECEIVE", "2026-11-10T09:00:00Z", null, { mint: BONK, amountRaw: "100", decimals: null, symbol: "BONK" }),
    ],
    now,
    10,
  );
  assert.deepEqual(rows.map((row) => row.kind), ["swap", "swap", "send", "bridge", "receive"]);
  assert.deepEqual([rows[0].from, rows[0].to, rows[0].amount, rows[0].ago.unit], ["USDC", "SOL", "1.383", "now"]);
  assert.equal(rows[0].toMint, SOL.mint, "the native coin is SOL's logo");
  assert.deepEqual([rows[1].from, rows[1].to, rows[1].amount], ["SOL", "JUP", "135.6"], "a ticker carries no $");
  assert.deepEqual([rows[2].from, rows[2].amount, rows[2].outcome], ["USDC", "5", "IN_FLIGHT"]);
  assert.deepEqual([rows[3].from, rows[3].amount, rows[3].toMint, rows[3].network], ["USDC", "250", null, "ethereum"], "the other network has no Solana logo: its own mark");
  assert.equal(rows[0].network, null);
  assert.equal(rows[4].amount, null, "an amount whose decimals the ledger did not know is not guessed");
  assert.equal(recentRows([], now, 4).length, 0);
});

test("the bridge out climbs the money window's ladder, and only a press over the built transfer opens the wallet", () => {
  const ready = { connected: true, walletRead: "ready", read: true, usdc: "250000000", destinationOk: true, amount: "ok", phase: "idle", quoted: true, refused: false, buildable: true, planned: false };
  assert.deepEqual(bridgeStep({ ...ready, connected: false }), { say: "connect", act: "connect", busy: false });
  assert.equal(bridgeStep({ ...ready, read: false, walletRead: "reading" }).say, "reading");
  assert.equal(bridgeStep({ ...ready, read: false, walletRead: "failed" }).say, "unread");
  assert.equal(bridgeStep({ ...ready, usdc: null }).say, "noUsdc");
  assert.equal(bridgeStep({ ...ready, usdc: "0" }).say, "noUsdc");
  assert.equal(bridgeStep({ ...ready, destinationOk: false }).say, "address");
  assert.equal(bridgeStep({ ...ready, amount: "over" }).say, "short");
  assert.equal(bridgeStep({ ...ready, amount: "none" }).say, "amount");
  assert.deepEqual(bridgeStep({ ...ready, quoted: false }), { say: "pricing", act: null, busy: true });
  assert.deepEqual(bridgeStep({ ...ready, quoted: false, refused: true }), { say: "refused", act: null, busy: false }, "a refused price offers nothing to press but a quiet «Try again»");
  assert.equal(bridgeStep({ ...ready, quoted: false, refused: true, phase: "quoting" }).say, "pricing", "asked again, it waits for the price");
  assert.deepEqual(bridgeStep({ ...ready, buildable: false }), { say: "paused", act: null, busy: false }, "a lane the engine keeps shut offers nothing");
  assert.deepEqual(bridgeStep(ready), { say: "move", act: "review", busy: false }, "a price alone builds the transfer first");
  assert.deepEqual(bridgeStep({ ...ready, planned: true }), { say: "confirm", act: "confirm", busy: false });
  for (const phase of ["planning", "wallet", "sending"]) assert.equal(bridgeStep({ ...ready, phase, planned: true }).act, null, `${phase}: nothing to press`);
});

test("into Solana: a wallet, then the engine's address, then the address to copy", () => {
  assert.equal(depositStep({ connected: false, status: "idle", shown: false }), "connect");
  assert.equal(depositStep({ connected: true, status: "idle", shown: false }), "move");
  assert.equal(depositStep({ connected: true, status: "loading", shown: false }), "asking");
  assert.equal(depositStep({ connected: true, status: "failed", shown: false }), "move", "a refused address may be asked again");
  assert.equal(depositStep({ connected: true, status: "idle", shown: true }), "copy");
});

/* ── a sentence handed to the screen ─────────────────────────────────── */

function scene() {
  const fetched = [];
  const signed = [];
  const answer = (url) => {
    fetched.push(String(url));
    if (String(url).includes("/api/solana/holdings")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { tokenRead: "COMPLETE", holdings: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "2410000000", spendableRaw: "2400000000", decimals: 9 }, { kind: "TOKEN", mint: USDC.mint, amountRaw: "84200000", spendableRaw: "84200000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true } }] } }),
      };
    }
    return { ok: false, status: 503, json: async () => ({}) };
  };
  globalThis.fetch = async (url) => answer(url);
  setMoneyEnv({
    fetch: async (url) => answer(url),
    sign: async (_connection, wire) => (signed.push(wire), { ok: false, reason: "no" }),
    connection: () => ({ wallet: "Phantom", address: TAKER }),
    storage: () => null,
    sleep: async () => {},
    refreshCity: () => {},
    open: true,
  });
  useWallet.setState({ connection: { wallet: "Phantom", address: TAKER } });
  useMoneyStore.getState().follow(null);
  useSwapScreen.setState({ subject: SOL_REF, side: "buy", way: "in", network: "ethereum", money: "bridge", fill: null });
  return { fetched, signed };
}

const said = (text) => run(fit(parse(text, BOOK, { subject: null }), OPEN), swapDoors(() => 1_000));
const moved = (fetched) => fetched.filter((url) => /(execute|order|send|transfer|plan|submit|deposit)/i.test(url));

test("«swap 1 SOL to JUP»: the ticket's coin and side, and what pays and the amount waiting for it — nothing ordered", async () => {
  const { fetched, signed } = scene();
  said("обміняй 1 SOL на JUP");
  await flush();
  const screen = useSwapScreen.getState();
  assert.equal(screen.subject.id, JUP);
  assert.equal(screen.side, "buy");
  assert.equal(screen.fill?.pay, "SOL");
  assert.equal(screen.fill?.amount, "1");
  assert.ok(FILL_LIFE_MS >= 30_000, "a fill waits long enough for the ticket to open");
  assert.equal(signed.length, 0);
  assert.deepEqual(moved(fetched), []);
});

test("«swap SOL to USDC» sells SOL into USDC on the same screen", async () => {
  scene();
  said("swap 2 SOL to USDC");
  const screen = useSwapScreen.getState();
  assert.equal(screen.subject.id, SOL.mint);
  assert.equal(screen.side, "sell");
  assert.equal(screen.fill?.pay, "USDC");
  assert.equal(screen.fill?.amount, "2");
});

test("«bridge» and «top up» turn the money panel to the bridge in their direction; «send» to a transfer", async () => {
  const { fetched, signed } = scene();
  said("bridge");
  assert.deepEqual([useSwapScreen.getState().money, useSwapScreen.getState().way], ["bridge", "out"]);
  said("поповнити");
  assert.deepEqual([useSwapScreen.getState().money, useSwapScreen.getState().way], ["bridge", "in"]);
  said("send 0.5 SOL to 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
  await flush();
  assert.equal(useSwapScreen.getState().money, "send");
  const send = useMoneyStore.getState().send;
  assert.equal(send.to, "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
  assert.equal(send.assetId, "native:sol", "the coin said, once the wallet is read");
  assert.equal(send.amount, "0.5");
  assert.equal(send.review, null, "no transfer is built");
  assert.equal(send.phase, "idle");
  assert.equal(signed.length, 0);
  assert.deepEqual(moved(fetched), [], fetched.join(", "));
});

test("while money is mid-way the money panel stays on it: a sentence turns nothing away from a signature", async () => {
  scene();
  const { useMoney } = await import("../../city/lib/money/open.ts");
  // The wallet the money store already follows: a transfer of it is what is mid-way.
  useMoneyStore.getState().follow(TAKER);
  await flush();
  useMoney.getState().setBusy(true);
  try {
    said("send 0.5 SOL to 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    assert.equal(useSwapScreen.getState().money, "bridge");
    said("поповнити");
    assert.equal(useSwapScreen.getState().way, "in");
    useSwapScreen.setState({ way: "out" });
    said("поповнити");
    assert.equal(useSwapScreen.getState().way, "out", "the bridge's direction stays under a signature too");
  } finally {
    useMoney.getState().setBusy(false);
  }
});

test("a limit or a price said aloud belongs to the coin's screen: the swap leaves it", () => {
  scene();
  const doors = swapDoors(() => 1_000);
  doors.openTrade({ mint: JUP, symbol: "JUP", name: "Jupiter", icon: null, tower: true }, "buy", "spot", "limit");
  doors.fillPrice("0.25");
  assert.equal(useSwapScreen.getState().subject.id, SOL.mint);
  assert.equal(useSwapScreen.getState().fill, null);
  for (const name of ["openChart", "openCoin", "openMint", "openEarn", "openLaunch", "askRyntra", "openAutopilot", "openLadder", "openPilot", "openCrew"]) assert.equal(typeof doors[name], "function", name);
});

test("only a signature holds the card: an order built by the card itself, or a result on screen, lets it go", async () => {
  const { useTrade } = await import("../../city/lib/trade/store.ts");
  try {
    for (const phase of ["idle", "preparing", "done", "failed"]) {
      useTrade.setState({ phase, held: false });
      assert.equal(tradeBusy(), false, phase);
    }
    for (const phase of ["wallet", "sending", "checking", "unknown"]) {
      useTrade.setState({ phase, held: false });
      assert.equal(tradeBusy(), true, phase);
    }
    useTrade.setState({ phase: "idle", held: true });
    assert.equal(tradeBusy(), true, "a held signature holds the card");
  } finally {
    useTrade.setState({ phase: "idle", held: false });
  }
});


test("the Swap screen is one form: no tabs, no limit, no chart, no transfer and no bridge drawn on it; beside it the pair and «Recent»", () => {
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const screen = strip(readFileSync(new URL("./SwapScreen.tsx", import.meta.url), "utf8"));
  assert.doesNotMatch(screen, /CoinChart|PairChart|CoinLine|chart\.module/, "a chart on the Swap screen (decision 107)");
  assert.doesNotMatch(screen, /<Tabs|LimitTab|<SendPanel|<BridgePanel|AgentCard/, "the Swap screen draws only its form (decision 109)");
  assert.match(screen, /<SwapTicket /);
  // One page for every section: the page's side column holds the pair's coins and the recent swaps, nothing else.
  assert.match(screen, /side=\{\s*<>\s*<Pair \/>\s*\{owner \? <Recent title=\{w\.recent\} edge \/> : null\}\s*<\/>\s*\}/, "«Recent» only with a wallet: no line of text in its place");
  // «Recent» reads again the moment a swap, a transfer or the top-up's bridge ends on this screen.
  assert.match(screen, /useTrade\.subscribe\(/);
  assert.match(screen, /readActivity\(\)/);
  assert.doesNotMatch(screen, /router\.push\((?!BRIDGE_PATH)/, "the only step the person takes from here is the top-up to the bridge");
});

test("the old tabs' addresses lead on in one step: the limit to the coin, the bridge to its page, a transfer to the Portfolio", () => {
  assert.equal(leaveOf("limit"), "coin");
  assert.equal(leaveOf("bridge"), "bridge");
  assert.equal(leaveOf("send"), "send");
  for (const other of [null, undefined, "", "swap", "chart", "Limit"]) assert.equal(leaveOf(other), null);
  assert.equal(BRIDGE_PATH, "/bridge");
  const page = readFileSync(new URL("../../app/(terminal)/swap/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(leave === "coin" && shelfOn\("market"\)\) redirect\(coinHref\(SOLANA_NATIVE_SOL_MINT, "live"\)\)/);
  assert.match(page, /if \(leave === "bridge" && \(flowLive\("bridge"\) \|\| flowLive\("deposit"\)\)\) redirect\(BRIDGE_PATH\)/, "only while the bridge is open");
  const leave = readFileSync(new URL("./useLeave.ts", import.meta.url), "utf8");
  assert.match(leave, /router\.replace\(BRIDGE_PATH\)/, "replaced, never a step in the history");
  assert.match(leave, /setAct\(\{ kind: 'send' \}\);\n\s*router\.replace\(`\$\{shelfHref\('portfolio', 'live'\)\}\?act=send`\)/, "the address agreed with the menu");
  const bridge = readFileSync(new URL("../../app/(terminal)/bridge/page.tsx", import.meta.url), "utf8");
  assert.match(bridge, /<BridgeScreen \/>/);
});

test("«bridge», «top up» and «send» lead on to their page, once the panel is turned; nothing while money is mid-way", async () => {
  scene();
  const went = [];
  const doors = swapDoors(() => 1_000, (place) => went.push(place));
  const { useMoney } = await import("../../city/lib/money/open.ts");
  doors.openMoney("bridge");
  doors.openMoney("topup");
  doors.openMoney("send");
  assert.deepEqual(went, ["bridge", "bridge", "send"]);
  assert.equal(useSwapScreen.getState().money, "send");
  useMoney.getState().setBusy(true);
  try {
    doors.openMoney("bridge");
    assert.deepEqual(went, ["bridge", "bridge", "send"], "a signature keeps its page");
  } finally {
    useMoney.getState().setBusy(false);
  }
});

test("a search over every coin adds what the list lacks, each once, and asks only for two characters or more", () => {
  const list = [SOL, USDC, JUP_ASSET];
  const found = [JUP_ASSET, BONK_ASSET, asset("So1ana11111111111111111111111111111111111111", ""), BONK_ASSET];
  assert.deepEqual(withFound(list, found, 10).map((a) => a.symbol), ["SOL", "USDC", "JUP", "BONK"], "a found coin without a ticker is not offered");
  assert.equal(withFound(list, found, 3).length, 3);
  assert.equal(searchable("j"), false);
  assert.equal(searchable("$jup"), true);
  assert.equal(searchable(" me "), true);
  assert.equal(searchable("x".repeat(65)), false);
});

test("the dollars under a figure: the market's price, a dollar coin at one dollar, nothing when either is unknown", () => {
  assert.equal(usdWorth(2, 72.5), 145);
  assert.equal(usdWorth(10, null, true), 10);
  assert.equal(usdWorth(10, undefined), null);
  assert.equal(usdWorth(null, 72.5), null);
  assert.equal(usdWorth(0, 72.5), null);
  assert.equal(usdWorth(1, 0), null);
  assert.equal(unitsOf("1383300000", 9), 1.3833);
  assert.equal(unitsOf("100000000", 6), 100);
  assert.equal(unitsOf("12a", 6), null);
  assert.equal(unitsOf("1", null), null);
});

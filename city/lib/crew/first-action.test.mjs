// Run from repo root: node --test city/lib/crew/first-action.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FUNNEL_EVENT_NAMES, FUNNEL_SIDE, FUNNEL_STEPS, FUNNEL_WIDE, funnelDevice, funnelEvent, funnelTrackRow, funnelWord, isFunnelEvent, onceStore } from "./funnel.ts";
import { firstSentences, sayCoin } from "./say.ts";
import { bookOf } from "../command/parse.ts";
import { readAsk } from "../autopilot/read.ts";

/**
 * The first action of a newcomer — the first screen → one sentence → the agent's card → the wallet → «Sign».
 * The funnel counts where people stop without saying who they are; the first sentences are ones the agent takes.
 */

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const BOOK = bookOf(SNAPSHOT.towers);

test("the funnel is nine moments on the agent's path, four on the way to money, three beside it, every name fixed", () => {
  assert.deepEqual([...FUNNEL_STEPS], ["agent_home", "agent_drawn", "agent_hint", "agent_line", "agent_said", "agent_card", "agent_wallet", "agent_sign", "agent_signed"]);
  assert.deepEqual([...FUNNEL_WIDE], ["agent_connect", "agent_signin", "agent_trade", "agent_traded"]);
  assert.deepEqual([...FUNNEL_SIDE], ["agent_sign_no", "agent_wallet_app", "agent_trade_no"]);
  assert.equal(new Set(FUNNEL_EVENT_NAMES).size, FUNNEL_EVENT_NAMES.length);
  for (const name of FUNNEL_EVENT_NAMES) assert.match(name, /^agent_[a-z_]{3,16}$/);
  assert.equal(isFunnelEvent("agent_signed"), true);
  assert.equal(isFunnelEvent("agent_traded"), true);
  assert.equal(isFunnelEvent("agent_wallet:7xKX"), false);
});

test("a moment as the page sends it: the device and one fixed word, never more", () => {
  assert.deepEqual(funnelEvent("agent_home", "phone", "uk"), { name: "agent_home", placement: "agent", locale: "uk", path: "/", ref: "phone" });
  assert.deepEqual(funnelEvent("agent_sign_no", "desk", "en", "walletno"), { name: "agent_sign_no", placement: "agent", locale: "en", path: "/", ref: "desk:walletno" });
  assert.deepEqual(funnelEvent("agent_trade_no", "app", "en", "failed"), { name: "agent_trade_no", placement: "agent", locale: "en", path: "/", ref: "app:failed" });
  assert.equal(funnelDevice(true, true), "app");
  assert.equal(funnelDevice(false, true), "phone");
  assert.equal(funnelDevice(false, false), "desk");
});

test("a robot's visit says `bot` in place of any word, and the route keeps it", () => {
  assert.equal(funnelWord(null, false), null);
  assert.equal(funnelWord("refused", false), "refused");
  assert.equal(funnelWord(null, true), "bot");
  assert.equal(funnelWord("refused", true), "bot");
  assert.equal(funnelTrackRow(funnelEvent("agent_home", "desk", "en", funnelWord(null, true))).ref, "desk:bot");
  assert.equal(funnelTrackRow({ name: "agent_home", locale: "en", ref: "desk:robot" }).ref, "desk", "an unknown word is dropped, the device kept");
});

test("the city's first frame is heard once, by a listener that came before it or after", async () => {
  const { cityDrawn, markDrawn, onDrawn } = await import("../city/drawn.ts");
  assert.equal(cityDrawn(), false);
  let early = 0;
  let gone = 0;
  onDrawn(() => early++);
  const undo = onDrawn(() => gone++);
  undo();
  markDrawn();
  markDrawn();
  assert.equal(cityDrawn(), true);
  assert.equal(early, 1, "once, however many frames follow");
  assert.equal(gone, 0, "an undone listener hears nothing");
  let late = 0;
  onDrawn(() => late++);
  assert.equal(late, 1, "a listener after the frame hears it at once");
});

test("the row stored is held to its shape: an address, an amount or a path sent along is dropped", () => {
  const wallet = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  assert.deepEqual(funnelTrackRow({ name: "agent_wallet", placement: "x", locale: "uk", path: "/c/abc", ref: "phone" }), { name: "agent_wallet", placement: "agent", locale: "uk", path: "/", ref: "phone" });
  assert.equal(funnelTrackRow({ name: "agent_wallet", locale: "en", ref: `desk:${wallet}` }).ref, null);
  assert.equal(funnelTrackRow({ name: "agent_wallet", locale: "en", ref: "desk:7xKX" }).ref, "desk");
  assert.equal(funnelTrackRow({ name: "agent_wallet", locale: "en", ref: wallet }).ref, null);
  assert.equal(funnelTrackRow({ name: "agent_signed", locale: "en", ref: "desk:refused:0.1" }).ref, null);
  assert.equal(funnelTrackRow({ name: "agent_signed", locale: "ru", ref: "app" }).locale, null);
  assert.equal(funnelTrackRow({ name: "telegram_cta_click" }), null);
  for (const name of FUNNEL_EVENT_NAMES) {
    const row = funnelTrackRow(funnelEvent(name, "desk", "en"));
    assert.ok(row && !/[1-9A-HJ-NP-Za-km-z]{32,44}/.test(JSON.stringify(row)), name);
  }
});

test("each moment counts once a visit, a refused store still once a page", () => {
  const kept = new Map();
  const storage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) };
  const once = onceStore(storage);
  assert.equal(once.first("agent_home"), true);
  assert.equal(once.first("agent_home"), false);
  assert.equal(onceStore(storage).first("agent_home"), false, "the same tab after a reload");
  assert.equal(onceStore(storage).first("agent_card"), true);
  const refusing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  const quiet = onceStore(refusing);
  assert.equal(quiet.first("agent_line"), true);
  assert.equal(quiet.first("agent_line"), false);
  assert.equal(onceStore(null).first("agent_line"), true);
});

test("the first sentences are ones the agent takes, in both languages — no sum in any of them (decision 108)", () => {
  for (const lang of ["en", "uk"]) {
    const says = firstSentences(lang, BOOK, { trade: true, launch: true });
    assert.deepEqual(says.map((s) => s.key), ["trade", "dip", "launch"], lang);
    const [trade, dip, launch] = says;
    assert.equal(trade.ask.kind, "trade");
    assert.equal(trade.ask.perDaySol, null, `${trade.text}: the budget is hers to say`);
    for (const say of says) assert.doesNotMatch(say.text, /\d|SOL/u, `${say.text} names no sum`);
    if (BOOK.coins.some((c) => c.symbol === "JUP" && c.tower)) assert.ok(trade.ask.coin, `${trade.text} names a tower`);
    assert.equal(dip.ask.kind, "trade");
    assert.equal(dip.ask.plan?.id, "dip", dip.text);
    assert.equal(launch.ask.kind, "launch", launch.text);
    // The chip is the person saying it: typed by hand, the same words read the same.
    for (const say of says) assert.deepEqual(readAsk(say.text, BOOK), say.ask, say.text);
    for (const say of says) assert.ok(say.text.length <= 44, `${say.text} fits a chip`);
    for (const say of says) assert.doesNotMatch(say.text, /profit|прибут|earn|зароб|x\d|guarant|гарант/i, "no promise of a result");
  }
});

test("a shut door offers no sentence for it; the coin is JUP or MET, never one advertised (decision 108)", () => {
  assert.deepEqual(firstSentences("en", BOOK, { trade: false, launch: true }).map((s) => s.key), ["launch"]);
  assert.deepEqual(firstSentences("uk", BOOK, { trade: true, launch: false }).map((s) => s.key), ["trade", "dip"]);
  assert.deepEqual(firstSentences("en", BOOK, { trade: false, launch: false }), []);
  const coin = sayCoin(BOOK);
  if (coin) assert.ok(["JUP", "MET"].includes(coin.symbol), coin.symbol);
  for (const lang of ["en", "uk"]) for (const say of firstSentences(lang, BOOK, { trade: true, launch: true })) assert.doesNotMatch(say.text, /BONK|PUMP|WIF/u, say.text);
  const named = bookOf([
    { id: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", icon: null, mcap: 2e9, liquidity: 1e7, verified: true },
    { id: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", icon: null, mcap: 1e9, liquidity: 1e7, verified: true },
    { id: "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL", symbol: "MET", name: "Meteora", icon: null, mcap: 5e8, liquidity: 1e6, verified: true },
  ]);
  assert.equal(sayCoin(named)?.symbol, "JUP", "the market's best is not the example's");
  const [trade, dip] = firstSentences("en", named, { trade: true, launch: false });
  assert.equal(trade.text, "Trade JUP for me every day");
  assert.equal(dip.text, "Buy MET on dips for me");
  const empty = bookOf([]);
  assert.equal(sayCoin(empty), null);
  const bare = firstSentences("en", empty, { trade: true, launch: false });
  assert.equal(bare[0]?.text, "Trade for me every day");
  assert.equal(bare[0]?.ask.perDaySol, null);
  assert.equal(firstSentences("uk", empty, { trade: true, launch: false })[0]?.text, "Торгуй за мене щодня");
});

test("the track route takes the funnel through its own row; the page sends nothing but `funnelEvent`", async () => {
  const route = readFileSync(new URL("../../../app/api/track/route.ts", import.meta.url), "utf8");
  assert.match(route, /FUNNEL_EVENT_NAMES/);
  assert.match(route, /funnelTrackRow\(/);
  const say = readFileSync(new URL("./funnel-say.ts", import.meta.url), "utf8");
  assert.match(say, /sendEvent\(funnelEvent\(/);
  assert.equal((say.match(/sendEvent\(/g) ?? []).length, 1, "one way out");
  assert.match(say, /navigator\.webdriver === true/, "a robot's visit is marked");
  const watch = readFileSync(new URL("./funnel-watch.ts", import.meta.url), "utf8");
  assert.doesNotMatch(watch, /sendEvent\(/, "the watcher sends through `funnelSay` only");
  // The watcher and the callers read whether a wallet is connected and a card is open — never send an address or an amount.
  const callers = [
    watch,
    readFileSync(new URL("../trade/proof.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../components/command/CommandLayer.tsx", import.meta.url), "utf8"),
  ];
  for (const source of callers) {
    // Only fixed names and words in quotes; no value read from the page goes along.
    for (const call of source.matchAll(/funnelSay\(([^)]*)\)/g)) assert.doesNotMatch(call[1].replace(/'[a-z_]+'/g, ""), /owner|address|connection|lamports|amount|record|text|said|signed/, call[0]);
  }
  const { FIRST_PARTY_EVENT_CATALOG } = await import("../../../lib/admin/insights.ts");
  for (const name of FUNNEL_EVENT_NAMES) assert.ok(FIRST_PARTY_EVENT_CATALOG.includes(name), `the admin reads ${name}`);
  const { FUNNEL_LABEL, FUNNEL_ORDER } = await import("../../../lib/admin/funnel.ts");
  assert.deepEqual([...FUNNEL_ORDER].sort(), [...FUNNEL_EVENT_NAMES].sort(), "the admin's table has every moment, once");
  for (const name of FUNNEL_EVENT_NAMES) assert.ok(FUNNEL_LABEL[name], `a label for ${name}`);
});

test("a card left for a wallet waits two hours in this browser, then the city opens it again", async () => {
  const { keepPending, takePending, forgetPending, cardReturnUrl, PENDING_MS } = await import("./resume.ts");
  const kept = new Map();
  const storage = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v), removeItem: (k) => kept.delete(k) };
  const coin = { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", icon: "/api/icon/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" };
  keepPending({ said: "Trade BONK for me, 0.1 SOL a day", coin }, 1_000, storage);
  assert.deepEqual(takePending(1_000 + 60_000, storage), { said: "Trade BONK for me, 0.1 SOL a day", coin, at: 1_000 });
  assert.equal(takePending(1_000 + 60_000, storage), null, "taken once");
  keepPending({ said: "", coin: null }, 1_000, storage);
  assert.equal(takePending(1_000 + PENDING_MS + 1, storage), null, "too old");
  kept.set("ryntra.city.agentPending.v1", JSON.stringify({ said: "x", at: 5, coin: { mint: "not a mint", symbol: "<b>", icon: "https://evil.example/x.png" } }));
  assert.deepEqual(takePending(10, storage), { said: "x", coin: null, at: 5 });
  kept.set("ryntra.city.agentPending.v1", "{broken");
  assert.equal(takePending(10, storage), null);
  keepPending({ said: "x", coin: null }, 1, storage);
  forgetPending(storage);
  assert.equal(takePending(2, storage), null);
  const throwing = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
  keepPending({ said: "x", coin: null }, 1, throwing);
  assert.equal(takePending(2, throwing), null);
  assert.equal(cardReturnUrl("https://ryntra.io"), "https://ryntra.io/?open=agent");
  assert.equal(cardReturnUrl("https://ryntra.io/"), "https://ryntra.io/?open=agent");
});

test("«Add SOL» only when the wallet certainly cannot hold the budget and the agent's fees", async () => {
  const { fundsFor, shortOfFunds, solAbout } = await import("./funds.ts");
  /* Her budget — 0.1 SOL a day, 0.05 a trade, 3 days: 0.3 into the vault, 0.01 for the agent's fees, ~0.02 the accounts. */
  const hers = { perDay: 100_000_000n, perTrade: 50_000_000n, days: 3 };
  assert.deepEqual(fundsFor(hers), { floor: 330_000_000n, about: 330_000_000n });
  assert.equal(solAbout(fundsFor(hers).about), "0.33");
  assert.equal(solAbout(fundsFor({ ...hers, days: 30 }).about), "3.03");
  assert.equal(solAbout(105_000_001n), "0.11", "rounded up");
  assert.equal(shortOfFunds("40000000", hers), true);
  assert.equal(shortOfFunds("329999999", hers), true, "the accounts the signature opens count");
  assert.equal(shortOfFunds("330000000", hers), false, "at the floor the wallet decides");
  assert.equal(shortOfFunds("405000000", hers), false);
  assert.equal(shortOfFunds(null, hers), false, "an unread balance is never short");
  assert.equal(shortOfFunds("abc", hers), false);
  assert.equal(shortOfFunds("40000000", null), false);
});

test("the agent's own address opens its card: the way back from a phone's wallet app", () => {
  const address = readFileSync(new URL("../open/address.ts", import.meta.url), "utf8");
  assert.match(address, /OWN_WINDOWS = \[[^\]]*'agent'/);
  const parts = readFileSync(new URL("../../components/trade/WalletParts.tsx", import.meta.url), "utf8");
  assert.match(parts, /const here = back \?\?/);
  const card = readFileSync(new URL("../../components/crew/CardWallet.tsx", import.meta.url), "utf8");
  assert.match(card, /back=\{[^}]*cardReturnUrl\(window\.location\.origin\)/);
});

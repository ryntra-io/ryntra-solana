// Run from repo root: node --test city/lib/crew/first-action.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FUNNEL_EVENT_NAMES, FUNNEL_STEPS, funnelDevice, funnelEvent, funnelTrackRow, isFunnelEvent, onceStore } from "./funnel.ts";
import { firstSentences, sayCoin } from "./say.ts";
import { bookOf } from "../command/parse.ts";
import { readAsk } from "../autopilot/read.ts";

/**
 * CITY-222: the first action of a newcomer — the first screen → one sentence → the agent's card → the wallet → «Sign».
 * The funnel counts where people stop without saying who they are; the first sentences are ones the agent takes.
 */

const SNAPSHOT = JSON.parse(readFileSync(new URL("../market/snapshot.json", import.meta.url), "utf8"));
const BOOK = bookOf(SNAPSHOT.towers);

test("the funnel is seven moments on the path and two beside it, every name fixed", () => {
  assert.deepEqual([...FUNNEL_STEPS], ["agent_home", "agent_hint", "agent_line", "agent_card", "agent_wallet", "agent_sign", "agent_signed"]);
  assert.equal(new Set(FUNNEL_EVENT_NAMES).size, FUNNEL_EVENT_NAMES.length);
  for (const name of FUNNEL_EVENT_NAMES) assert.match(name, /^agent_[a-z_]{3,16}$/);
  assert.equal(isFunnelEvent("agent_signed"), true);
  assert.equal(isFunnelEvent("agent_wallet:7xKX"), false);
});

test("a moment as the page sends it: the device and one fixed word, never more", () => {
  assert.deepEqual(funnelEvent("agent_home", "phone", "uk"), { name: "agent_home", placement: "agent", locale: "uk", path: "/", ref: "phone" });
  assert.deepEqual(funnelEvent("agent_sign_no", "desk", "en", "walletno"), { name: "agent_sign_no", placement: "agent", locale: "en", path: "/", ref: "desk:walletno" });
  assert.equal(funnelDevice(true, true), "app");
  assert.equal(funnelDevice(false, true), "phone");
  assert.equal(funnelDevice(false, false), "desk");
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

test("the first sentences are ones the agent takes, in both languages, the budget a new agent starts with", () => {
  for (const lang of ["en", "uk"]) {
    const says = firstSentences(lang, BOOK, { trade: true, launch: true });
    assert.deepEqual(says.map((s) => s.key), ["trade", "dip", "launch"], lang);
    const [trade, dip, launch] = says;
    assert.equal(trade.ask.kind, "trade");
    assert.equal(trade.ask.perDaySol, "0.1", trade.text);
    assert.ok(trade.ask.coin, `${trade.text} names a tower`);
    assert.equal(dip.ask.kind, "trade");
    assert.equal(dip.ask.plan?.id, "dip", dip.text);
    assert.equal(launch.ask.kind, "launch", launch.text);
    // The chip is the person saying it: typed by hand, the same words read the same.
    for (const say of says) assert.deepEqual(readAsk(say.text, BOOK), say.ask, say.text);
    for (const say of says) assert.ok(say.text.length <= 44, `${say.text} fits a chip`);
    for (const say of says) assert.doesNotMatch(say.text, /profit|прибут|earn|зароб|x\d|guarant|гарант/i, "no promise of a result");
  }
});

test("a shut door offers no sentence for it; the coin is a tower the agent may buy", () => {
  assert.deepEqual(firstSentences("en", BOOK, { trade: false, launch: true }).map((s) => s.key), ["launch"]);
  assert.deepEqual(firstSentences("uk", BOOK, { trade: true, launch: false }).map((s) => s.key), ["trade", "dip"]);
  assert.deepEqual(firstSentences("en", BOOK, { trade: false, launch: false }), []);
  const coin = sayCoin(BOOK);
  assert.ok(coin && coin.tower && !/SOL$|^USD/.test(coin.symbol));
  if (BOOK.coins.some((c) => c.symbol === "BONK" && c.tower)) assert.equal(coin.symbol, "BONK");
  const empty = bookOf([]);
  assert.equal(sayCoin(empty), null);
  const bare = firstSentences("en", empty, { trade: true, launch: false });
  assert.equal(bare[0]?.text, "Trade for me, 0.1 SOL a day");
  assert.equal(bare[0]?.ask.perDaySol, "0.1");
});

test("the track route takes the funnel through its own row; the page sends nothing but `funnelEvent`", async () => {
  const route = readFileSync(new URL("../../../app/api/track/route.ts", import.meta.url), "utf8");
  assert.match(route, /FUNNEL_EVENT_NAMES/);
  assert.match(route, /funnelTrackRow\(/);
  const watch = readFileSync(new URL("./funnel-watch.ts", import.meta.url), "utf8");
  assert.match(watch, /sendEvent\(funnelEvent\(/);
  assert.equal((watch.match(/sendEvent\(/g) ?? []).length, 1, "one way out");
  // The watcher reads whether a wallet is connected and a card is open — never sends an address or an amount.
  for (const call of watch.matchAll(/funnelSay\(([^)]*)\)/g)) assert.doesNotMatch(call[1], /owner|address|connection|lamports|amount|record/, call[0]);
  const { FIRST_PARTY_EVENT_CATALOG } = await import("../../../lib/admin/insights.ts");
  for (const name of FUNNEL_EVENT_NAMES) assert.ok(FIRST_PARTY_EVENT_CATALOG.includes(name), `the admin reads ${name}`);
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
  assert.deepEqual(fundsFor("small"), { floor: 110_000_000n, about: 120_000_000n });
  assert.equal(solAbout(fundsFor("small").about), "0.12");
  assert.equal(solAbout(fundsFor("medium").about), "0.27");
  assert.equal(solAbout(105_000_001n), "0.11", "rounded up");
  assert.equal(shortOfFunds("40000000", "small"), true);
  assert.equal(shortOfFunds("109999999", "small"), true);
  assert.equal(shortOfFunds("110000000", "small"), false, "at the floor the wallet decides");
  assert.equal(shortOfFunds("405000000", "small"), false);
  assert.equal(shortOfFunds(null, "small"), false, "an unread balance is never short");
  assert.equal(shortOfFunds("abc", "small"), false);
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

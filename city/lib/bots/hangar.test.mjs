import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultDraft } from "./draft.ts";
import { controlsOf, lastFill, pause, runOf, sortBots, start, statusOf, stop } from "./hangar.ts";
import { AGE_BUCKETS, ageBucket, closeStrategy, COPY_MIN_DAYS, copyDraft, copyGate, groupByAge, sortStrategies } from "./strategies.ts";
import { addVersion, forkStrategy, saveStrategy } from "./lineage.ts";
import { receiptsCsv, receiptsOf } from "./receipts.ts";
import { KIND_FACTS, BOT_KINDS, NEXT_KINDS, GOALS, CATALOGUE } from "./kinds.ts";
import { WORDS } from "./words.ts";
import { createBotsStore, STORAGE } from "./store.ts";
import { closeBots, openBots, PAPER_KEY, runningIn, useBotsWindow } from "./open.ts";
import { chainUrl, readAnswer, sortChain } from "./chain.ts";
import { botsDemo, GONE, sampleBars } from "./demo.ts";
import { straightBars, WEEK_BARS } from "./path.ts";
import { signedUsd, usd, pct, price } from "./format.ts";
import { readFileSync } from "node:fs";

const SOL = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL" };
const H = 3_600_000;
const D = 24 * H;
const T0 = 1_800_000_000_000;
const uuid = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

const bot = (over = {}) => ({ id: "b1", draft: defaultDraft("grid", SOL, 100, null, 100), createdAt: T0, spans: [[T0, null]], stoppedAt: null, strategyId: null, mode: "paper", ...over });
const ctx = { mints: new Set([SOL.mint]), strategies: new Set() };

test("a bot's status: running, paused, stopped, not finished, orphaned", () => {
  assert.equal(statusOf(bot(), ctx), "running");
  assert.equal(statusOf(pause(bot(), T0 + H), ctx), "paused");
  assert.equal(statusOf(start(pause(bot(), T0 + H), T0 + 2 * H), ctx), "running");
  assert.equal(statusOf(stop(bot(), T0 + H), ctx), "stopped");
  assert.equal(statusOf(bot({ spans: [] }), ctx), "incomplete");
  assert.equal(statusOf(bot({ draft: { ...bot().draft, amountUsd: 1 } }), ctx), "incomplete");
  assert.equal(statusOf(bot(), { mints: new Set(["other"]), strategies: new Set() }), "orphaned", "its coin left the city");
  assert.equal(statusOf(bot({ strategyId: "gone" }), ctx), "orphaned", "its strategy was deleted");
  assert.equal(statusOf(bot(), { mints: null, strategies: new Set() }), "running", "before the city is read, nothing is orphaned");
  assert.equal(stop(stop(bot(), T0 + H), T0 + 2 * H).stoppedAt, T0 + H);
  assert.equal(start(bot({ stoppedAt: T0 }), T0 + H).spans.length, 1, "a stopped bot does not start again");
});

test("on paper the money controls are there and say they are off; pause works", () => {
  const ids = (list) => list.map((c) => `${c.id}:${c.enabled}`);
  assert.deepEqual(ids(controlsOf(bot(), "running")), ["pause:true", "cancelOrders:false", "withdrawAll:false", "stop:true"]);
  assert.deepEqual(ids(controlsOf(pause(bot(), T0 + H), "paused")), ["resume:true", "cancelOrders:false", "withdrawAll:false", "stop:true"]);
  const reminder = bot({ draft: defaultDraft("recurring", SOL, 100, null) });
  assert.deepEqual(ids(controlsOf(reminder, "running")), ["pause:true", "withdrawAll:false", "stop:true"], "a reminder has no orders to cancel");
  assert.deepEqual(ids(controlsOf(bot({ spans: [] }), "incomplete")), ["finish:true", "stop:true"]);
  assert.deepEqual(controlsOf(bot(), "stopped"), []);
});

test("a paper bot's run is the market since its start, with paused hours left out", () => {
  const bars = straightBars(100, 80, T0 - 10 * H, 60);
  const draft = { ...defaultDraft("buyLadder", SOL, 100, null, 100), steps: 4, firstPct: 2, lastPct: 12 };
  const run = runOf(bot({ draft, spans: [[T0, null]] }), bars);
  assert.ok(run.startPrice < 100, "the start is the price when the bot started, not the window's first");
  assert.ok(lastFill(run));
  const paused = runOf(bot({ draft, spans: [[T0, T0 + 2 * H]] }), bars);
  assert.ok(paused.fills.length < run.fills.length);
  assert.equal(runOf(bot({ spans: [] }), bars), null);
  const rows = sortBots([
    { bot: bot({ id: "a", createdAt: 1 }), status: "stopped" },
    { bot: bot({ id: "b", createdAt: 2 }), status: "running" },
    { bot: bot({ id: "c", createdAt: 3 }), status: "orphaned" },
    { bot: bot({ id: "d", createdAt: 4 }), status: "running" },
  ]);
  assert.deepEqual(rows.map((r) => r.bot.id), ["c", "d", "b", "a"]);
});

test("strategies keep versions on Strategy Lab's lineage, fork with their parent named, and stay when closed", () => {
  const draft = defaultDraft("grid", SOL, 100, null);
  const s = saveStrategy({ id: uuid(1), versionId: uuid(2), name: "  SOL grid ", draft, now: T0 });
  assert.equal(s.name, "SOL grid");
  assert.equal(s.versions[0].lineage.iterationNumber, 1);
  assert.equal(addVersion(s, { versionId: uuid(3), draft, note: "", now: T0 + H }), s, "nothing changed — no new version");
  const v2 = addVersion(s, { versionId: uuid(3), draft: { ...draft, levels: 16 }, note: "Tighter", now: T0 + H });
  assert.equal(v2.versions.length, 2);
  assert.deepEqual([v2.versions[1].lineage.parentRunId, v2.versions[1].lineage.iterationNumber, v2.versions[1].lineage.changedFields], [uuid(2), 2, ["levels"]]);
  const fork = forkStrategy(v2, { id: uuid(4), versionId: uuid(5), now: T0 + 2 * H });
  assert.deepEqual(fork.forkOf, { strategyId: uuid(1), versionId: uuid(3), name: "SOL grid" });
  assert.equal(fork.versions[0].draft.levels, 16);
  assert.deepEqual(copyDraft(v2).copiedFrom, { strategyId: uuid(1), versionId: uuid(3) });
  const closed = closeStrategy(v2, T0 + 3 * H);
  assert.equal(closed.closedAt, T0 + 3 * H);
  assert.equal(closed.versions.length, 2, "a closed strategy keeps everything");
});

test("another's settings copy only after enough history; age buckets sort the oldest first, closed and losing kept", () => {
  const { strategies } = botsDemo({ sol: { ...SOL, price: 100 }, jup: { mint: "jup", symbol: "JUP", price: 0.8 }, bonk: { mint: "bonk", symbol: "BONK", price: 0.00002 } }, T0);
  const young = strategies.find((s) => s.name === "BONK exit steps");
  const gate = copyGate(young, T0);
  assert.equal(gate.ok, false);
  assert.equal(gate.daysLeft, COPY_MIN_DAYS - 9);
  assert.equal(copyGate(strategies.find((s) => s.name === "Slow SOL grid"), T0).ok, true);
  assert.equal(copyGate(strategies.find((s) => s.owner === "me"), T0).ok, true, "your own always copies");
  const groups = groupByAge(strategies, T0);
  assert.deepEqual(groups.map((g) => g.bucket), ["older", "quarter", "month", "week"].filter((b) => groups.some((g) => g.bucket === b)));
  const all = groups.flatMap((g) => g.strategies);
  assert.equal(all.length, strategies.length, "nothing is hidden — closed and losing included");
  assert.ok(all.some((s) => s.closedAt !== null && s.record.returnPct < 0));
  assert.deepEqual(AGE_BUCKETS.map((b, i) => ageBucket([1, 10, 40, 200][i])), ["week", "month", "quarter", "older"]);
  const quarter = sortStrategies(strategies, T0).filter((s) => ageBucket((T0 - s.createdAt) / D) === "quarter");
  assert.equal(quarter.at(-1).closedAt !== null, true, "inside a bucket a closed strategy comes after the open ones");
});

test("receipts list every fill newest first and the CSV is plain, safe and complete", () => {
  const bars = straightBars(100, 80, T0, 48);
  const draft = { ...defaultDraft("buyLadder", { mint: SOL.mint, symbol: "=SOL" }, 100, null, 100), steps: 3, firstPct: 2, lastPct: 10 };
  const b = bot({ draft, spans: [[T0, null]] });
  const receipts = receiptsOf([{ bot: b, run: runOf(b, bars) }, { bot: bot({ id: "x", spans: [] }), run: null }]);
  assert.equal(receipts.length, 3);
  assert.ok(receipts.every((r, i) => i === 0 || receipts[i - 1].t >= r.t));
  const csv = receiptsCsv(receipts);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "time_utc,bot,kind,pair,side,price_usd,amount,value_usd,mode");
  assert.equal(lines.length, 4);
  assert.ok(lines[1].includes(",'=SOL/USDC,"), "a cell never starts a formula");
  assert.ok(lines.slice(1).every((l) => l.endsWith(",paper") && l.split(",").length === 9));
  assert.equal(receiptsCsv([]), "time_utc,bot,kind,pair,side,price_usd,amount,value_usd,mode\r\n");
});

test("one assistant in the city: the window keeps no second one of its own", () => {
  // The bots' assistant tools are the assistant line's (CITY-133); the window has no ask box, no answer and no draft-in.
  const window = readFileSync(new URL("../../components/bots/BotsWindow.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(window, /Assistant|AskButton/);
  const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(store, /assistant/i);
  for (const lang of ["en", "uk"]) for (const key of ["ask", "askPlaceholder", "openDraft", "advises"]) assert.equal(WORDS[lang][key], undefined, `${lang}.${key}`);
});

test("every bot and goal has its words in both languages, and time DCA is never called automatic", () => {
  for (const lang of ["en", "uk"]) {
    const w = WORDS[lang];
    for (const k of BOT_KINDS) assert.ok(w.kind[k] && w.tag[k], `${lang} ${k}`);
    for (const k of NEXT_KINDS) assert.ok(w.next[k] && w.nextTag[k]);
    for (const g of GOALS) assert.ok(w.goal[g] && w.goalBots[g]);
    for (const k of ["recurring", "smartDca"]) assert.doesNotMatch(`${w.kind[k]} ${w.tag[k]}`, /automat|автомат/i);
  }
  assert.equal(WORDS.uk.goal.swings, "Заробляти на коливаннях");
  assert.equal(WORDS.uk.tag.recurring, "Нагадування · 1 дотик");
  assert.equal(WORDS.uk.tag.priceAlert, "Не захищає, доки ти не підтвердиш");
  // «Hangar» on the Deck is the agent's home (CITY-50): the bots' own place says «My bots», never a second «Hangar».
  assert.equal(WORDS.en.tabs.hangar, "My bots");
  assert.equal(WORDS.uk.tabs.hangar, "Мої боти");
  for (const lang of ["en", "uk"]) assert.doesNotMatch(JSON.stringify(WORDS[lang].tabs), /Hangar|Ангар/);
  // No bot puts money in a custodial vault (Trigger V2 is out by the spec).
  assert.ok(Object.values(KIND_FACTS).every((f) => f.custody !== "vault"));
  for (const lang of ["en", "uk"]) assert.doesNotMatch(JSON.stringify(WORDS[lang].custody), /custodial|кастодіал/i);
  const text = JSON.stringify(WORDS, (_, v) => (typeof v === "function" ? v(1, "x", "y", "z", "w") : v));
  assert.doesNotMatch(text, /\bsoon\b|скоро/i, "«Next», never «Soon»");
  assert.equal(CATALOGUE.length, BOT_KINDS.length);
  assert.ok(Object.values(KIND_FACTS).filter((f) => f.drive === "tap").every((f) => !f.standalone), "a bot that waits for a tap never says it works without Ryntra");
});

test("numbers in both languages", () => {
  assert.equal(usd(1234.5), "$1,234.50");
  assert.equal(signedUsd(-1.1), "−$1.10");
  assert.equal(signedUsd(3.2), "+$3.20");
  assert.equal(pct(4.25, "en", true), "+4.3%");
  assert.equal(price(0.00002134), "$0.00002134");
  assert.match(usd(1234.5, "uk"), /^\$1\s234,50$/);
});

function memory() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data };
}

/** The engine's candles for a coin: the review's sample week, as `/api/spot/candles` answers. */
const candles = (price) => async () => ({
  status: 200,
  json: async () => ({
    timeframe: "1h",
    candles: sampleBars(SOL.mint, price, 2, T0).map((b) => ({ time: b.t / 1000, open: b.o, high: b.h, low: b.l, close: b.c })),
    observedAt: new Date(T0).toISOString(),
    source: { label: "fixture" },
  }),
});

test("the store: three taps start a paper bot, the hangar keeps it in this browser, nothing signs", async () => {
  const mem = memory();
  const store = createBotsStore({ storage: () => mem, now: () => T0, fetch: candles(100) });
  const coin = { mint: SOL.mint, symbol: "SOL", price: 100 };
  useBotsWindow.setState({ open: false, tab: "launch", running: 0, counted: false });
  openBots();
  await store.getState().loadPath(coin);
  assert.equal(store.getState().paths[SOL.mint].bars.length, WEEK_BARS);
  assert.ok(store.getState().paths[SOL.mint].weather, "the engine reads the week's weather");
  // Tap 1: the goal. Tap 2: the recommended bot. Tap 3: start.
  store.getState().startFlow("swings");
  store.getState().useRecommended(coin);
  assert.equal(store.getState().page.step, "confirm");
  assert.equal(store.getState().draft.kind, "grid");
  const started = store.getState().startPaper();
  assert.equal(started.mode, "paper");
  assert.equal(useBotsWindow.getState().tab, "hangar", "the window turns to «My bots» on the bot it started");
  assert.equal(useBotsWindow.getState().running, 1, "the drones count it");
  assert.equal(JSON.parse(mem.data.get(STORAGE.bots)).length, 1);
  assert.equal(STORAGE.bots, PAPER_KEY);
  // A new store on the same storage finds the bot again.
  const again = createBotsStore({ storage: () => mem, now: () => T0 });
  again.getState().hydrate();
  assert.equal(again.getState().bots[0].id, started.id);
  // Pause, save as a strategy, a version, copy.
  store.getState().pauseBot(started.id, T0 + H);
  assert.equal(store.getState().bots[0].spans[0][1], T0 + H);
  const s = await store.getState().saveAsStrategy("Mine");
  store.getState().setDraft({ ...store.getState().draft, levels: 16 });
  await store.getState().saveVersion("Tighter");
  assert.equal(store.getState().strategies.find((x) => x.id === s.id).versions.length, 2);
  assert.equal(store.getState().copySettings(s.id), true);
  assert.equal(store.getState().page.kind, "detail");
  const keys = Object.keys(store.getState());
  for (const forbidden of ["sign", "send", "withdraw", "execute"]) assert.ok(!keys.some((k) => k.toLowerCase().includes(forbidden)), forbidden);
});

test("storage that refuses or holds junk means a fresh hangar, never a broken window", () => {
  const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("full"); } };
  const store = createBotsStore({ storage: () => broken, now: () => T0 });
  store.getState().hydrate();
  assert.deepEqual(store.getState().bots, []);
  store.getState().setDraft(defaultDraft("grid", SOL, 100, null));
  assert.ok(store.getState().startPaper());
  const junk = memory();
  junk.setItem(STORAGE.bots, JSON.stringify([{ id: 1 }, "x", bot()]));
  junk.setItem(STORAGE.strategies, "{not json");
  const s2 = createBotsStore({ storage: () => junk });
  s2.getState().hydrate();
  assert.equal(s2.getState().bots.length, 1);
  assert.deepEqual(s2.getState().strategies, []);
});

test("openBots opens on the tab asked for, and only on a real tab", () => {
  useBotsWindow.setState({ open: false, tab: "launch" });
  openBots("hangar");
  assert.deepEqual([useBotsWindow.getState().open, useBotsWindow.getState().tab], [true, "hangar"]);
  openBots("nowhere");
  assert.equal(useBotsWindow.getState().tab, "hangar");
  openBots();
  assert.equal(useBotsWindow.getState().tab, "hangar");
  closeBots();
  assert.equal(useBotsWindow.getState().open, false);
});

test("the Deck's Agents tray: «Bots» opens and closes this window, and the old bots addresses open it too", () => {
  const deck = readFileSync(new URL("../../components/deck/Deck.tsx", import.meta.url), "utf8");
  assert.match(deck, /case 'bots':\s*\n\s*return useBotsWindow\.getState\(\)\.open \? closeBots\(\) : openBots\(\);/);
  assert.match(deck, /agents: botsWindow \|\| scouting \|\| tray === 'agents'/, "the diamond lights while the window is open");
  assert.match(deck, /import \{ closeBots, openBots, useBotsWindow \} from '@\/city\/lib\/bots\/open';/, "the Deck loads only the light store");
  assert.doesNotMatch(deck, /onAgent/);
  const address = readFileSync(new URL("../../components/open/OpenFromAddress.tsx", import.meta.url), "utf8");
  assert.match(address, /case 'agents':[^]*?if \(AGENTS_OPEN\) openBots\(\);/);
  // The window is mounted once in the city; its contents load the first time it opens.
  const app = readFileSync(new URL("../../components/CityApp.tsx", import.meta.url), "utf8");
  assert.match(app, /<BotsLayer \/>/);
  const layer = readFileSync(new URL("../../components/bots/BotsLayer.tsx", import.meta.url), "utf8");
  assert.match(layer, /dynamic\(\(\) => import\('\.\/BotsWindow'\)/);
  assert.doesNotMatch(layer, /lib\/bots\/store/, "the frame's layer never pulls the hub's store into the first frame");
});

test("the drones count the running paper bots kept in this browser; anything broken counts none", () => {
  const b = bot();
  assert.equal(runningIn(JSON.stringify([b, pause(b, T0 + H), stop(b, T0 + H), { ...b, spans: [] }, start(pause(b, T0 + H), T0 + 2 * H)])), 2);
  assert.equal(runningIn(null), 0);
  assert.equal(runningIn("{oops"), 0);
  assert.equal(runningIn('{"a":1}'), 0);
  assert.equal(runningIn('[1,null,"x"]'), 0);
});

test("the wallet's own bots: the engine's Hangar read as it answers, checked, sorted, and never acted on", async () => {
  const W = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  assert.equal(chainUrl(W), `/api/bots/hangar?wallet=${W}`);
  const answer = {
    wallet: W,
    at: T0,
    bots: [
      { id: "a", kind: "grid", venue: "meteora_dlmm", name: "SOL/USDC", status: "working", detail: null, vsHold: { usd: 3.2, pct: 1.6, from: "x", to: "y" }, feesUsd: 1, lastFill: null, filler: "pool_swaps", noRyntraSignature: true, legs: null, refs: {} },
      { id: "b", kind: "ladder", venue: "jupiter_trigger_v1", name: "JUP/USDC", status: "needs_you", detail: null, vsHold: null, feesUsd: null, lastFill: null, filler: "jupiter_keeper", noRyntraSignature: true, legs: { total: 4, filled: 1, pending: 3, closed: 0 }, refs: {} },
      { id: "c", kind: "limit", venue: "meteora_dlmm", name: "BONK/SOL", status: "closed", detail: null, vsHold: null, feesUsd: null, lastFill: null, filler: "pool_swaps", noRyntraSignature: true, legs: null, refs: {} },
      { id: 4 },
    ],
    issues: [{ kind: "orphan", venue: "trigger", order: "o1", reason: "expired_open" }, { kind: "else" }],
    sunset: null,
    read: { positions: true, orders: true, rules: false },
  };
  const read = readAnswer(answer, W);
  assert.equal(read.bots.length, 3, "a row that is not a bot is left out, never guessed");
  assert.equal(read.issues.length, 1);
  assert.deepEqual(sortChain(read.bots).map((x) => x.id), ["b", "a", "c"], "what needs the person first, closed last");
  assert.equal(readAnswer({ ...answer, wallet: "other" }, W), null, "another wallet's answer is not this wallet's");
  assert.equal(readAnswer(null, W), null);
  // The store reads it for the connected wallet only, and forgets it when the wallet leaves.
  const store = createBotsStore({ storage: () => null, now: () => T0, chainFetch: async () => ({ ok: true, json: async () => answer }) });
  await store.getState().loadChain(W);
  assert.equal(store.getState().chain.status, "ready");
  assert.equal(store.getState().chain.answer.bots.length, 3);
  await store.getState().loadChain(null);
  assert.equal(store.getState().chain.status, "idle");
  const failing = createBotsStore({ storage: () => null, now: () => T0, chainFetch: async () => ({ ok: false, json: async () => ({}) }) });
  await failing.getState().loadChain(W);
  assert.equal(failing.getState().chain.status, "error");
  // A read: the chain module builds, signs and sends nothing.
  const code = readFileSync(new URL("./chain.ts", import.meta.url), "utf8");
  assert.doesNotMatch(code, /^import (?!type)/m, "only types from the engine");
  assert.doesNotMatch(code, /method:\s*['"]POST|signTransaction|sendTransaction|signer|keypair/i);
});

test("the review's sample week ends at the tower's price, is the same every run and differs between coins", () => {
  const a = sampleBars("mint-a", 196.4, 3.2, T0);
  const b = sampleBars("mint-a", 196.4, 3.2, T0);
  const c = sampleBars("mint-b", 196.4, 3.2, T0);
  assert.equal(a.length, WEEK_BARS);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(Math.abs(a.at(-1).c - 196.4) < 1e-9);
  assert.equal(a.at(-1).t, T0);
  assert.ok(Math.abs((196.4 / a.at(-25).c - 1) * 100 - 3.2) < 0.01, "the last day carries today's move");
  for (const bar of a) assert.ok(bar.l <= Math.min(bar.o, bar.c) && bar.h >= Math.max(bar.o, bar.c));
  assert.deepEqual(sampleBars("x", 0, 1, T0), []);
});

test("the review stand shows every hangar state", () => {
  const coins = { sol: { ...SOL, price: 100 }, jup: { mint: "jup", symbol: "JUP", price: 0.8 }, bonk: { mint: "bonk", symbol: "BONK", price: 0.00002 } };
  const { bots, strategies } = botsDemo(coins, T0);
  const context = { mints: new Set([SOL.mint, "jup", "bonk"]), strategies: new Set(strategies.map((s) => s.id)) };
  const states = new Set(bots.map((b) => statusOf(b, context)));
  assert.deepEqual([...states].sort(), ["incomplete", "orphaned", "paused", "running", "stopped"]);
  assert.ok(bots.some((b) => b.draft.pair.mint === GONE.mint));
});

test("the window's first load carries no schemas: Strategy Lab's lineage comes in only when a strategy is saved", () => {
  for (const file of ["store.ts", "open.ts", "chain.ts", "strategies.ts", "hangar.ts", "sim.ts", "kinds.ts", "words.ts", "weather.ts"]) {
    const code = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(code, /^import (?!type)[^;]*(strategy-lab|zod|\.\/lineage|\.\/demo)/m, file);
  }
  assert.match(readFileSync(new URL("./store.ts", import.meta.url), "utf8"), /await import\('\.\/lineage\.ts'\)/);
});

test("candles that never come do not hold the hub, and no week is ever made up in their place", async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  const store = createBotsStore({ storage: () => null, fetch: hang, now: () => T0 });
  const started = Date.now();
  await store.getState().loadPath({ mint: SOL.mint, symbol: "SOL", price: 100 });
  assert.equal(store.getState().paths[SOL.mint].status, "ready");
  assert.deepEqual(store.getState().paths[SOL.mint].bars, [], "a coin without candles has no week, said as such");
  assert.equal(store.getState().paths[SOL.mint].weather, null);
  assert.ok(Date.now() - started < 15_000);
  const missing = createBotsStore({ storage: () => null, fetch: async () => ({ status: 404, json: async () => ({ error: { code: "CANDLES_NO_POOL" } }) }), now: () => T0 });
  await missing.getState().loadPath({ mint: SOL.mint, symbol: "SOL", price: 100 });
  assert.deepEqual(missing.getState().paths[SOL.mint].bars, []);
  // The product's code never reaches for the review's sample week.
  for (const file of ["store.ts", "path.ts", "weather.ts"]) assert.doesNotMatch(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"), /sampleBars/, file);
});

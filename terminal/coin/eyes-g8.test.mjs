import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { QUIET_MISSES, saysUnavailable } from "../../city/lib/chart/candles.ts";
import { STUCK_MS, YOUNG_BARS, stuckOf, tooYoungFor } from "./chart-wait.ts";
import { answered, answeredReads } from "./coin-view.ts";


const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const reply = (status) => Promise.resolve(new Response("{}", { status }));

test("flaw 64: only an answered «no» is «not found» — a silent source is «couldn't read»", async () => {
  assert.equal(answered(200), true);
  assert.equal(answered(404), true, "the launch read's 404: not a Ryntra launch — an answer");
  assert.equal(answered(400), true);
  assert.equal(answered(429), false, "the engine's limit says nothing of the coin");
  assert.equal(answered(503), false);

  const clean = answeredReads(() => reply(404));
  await clean.fetch("/api/v1/launch/x");
  assert.equal(clean.failed(), false);

  const limited = answeredReads((url) => reply(url.includes("market") ? 429 : 200));
  await limited.fetch("/api/v1/launch/x");
  await limited.fetch("/api/spot/market?mint=x");
  assert.equal(limited.failed(), true);

  const offline = answeredReads(() => Promise.reject(new TypeError("network")));
  await assert.rejects(offline.fetch("/api/spot/market?mint=x"));
  assert.equal(offline.failed(), true, "a read that never reached the engine");

  const gone = new AbortController();
  gone.abort();
  const aborted = answeredReads(() => Promise.reject(new DOMException("aborted", "AbortError")));
  await assert.rejects(aborted.fetch("/api/spot/market?mint=x", { signal: gone.signal }));
  assert.equal(aborted.failed(), false, "the screen's own abort is not the source's failure");
});

test("flaw 64: the screen draws «not found» and «couldn't read» apart, each with its ways on", () => {
  const screen = read("./CoinScreen.tsx");
  assert.match(screen, /status: reads\.failed\(\) \? 'failed' : 'none'/);
  assert.match(screen, /\.catch\(\(\) => \{\s*if \(!controller\.signal\.aborted\) setLook\(\{ mint, status: 'failed' \}\);/);
  assert.match(screen, /if \(!coin\) return <CoinLost /);
  const lost = read("./CoinLost.tsx");
  assert.match(lost, /<Quiet onClick=\{onRetry\}/, "«Try again» is quiet and only asks again");
  assert.match(lost, /side=\{<LostDoors \/>\}/, "the sections as quiet doors beside");
  assert.match(lost, /<CoinSearch lang=\{lang\} \/>/, "«not found» offers the coin search");
  assert.equal((lost.match(/ui\.act\b/g) ?? []).length, 1, "one amber way: back to the market");
});

test("the young coin's chart: a wait the source keeps going is said, never «Chart in a moment» for ever", () => {
  const base = { mint: "m", timeframe: "1h", status: "unavailable", last: null, code: null, misses: 1, busy: true };
  assert.equal(saysUnavailable(stuckOf(base, 0)), false, "the first refusal only waits");
  assert.equal(saysUnavailable(stuckOf(base, STUCK_MS)), true, "past the wait it is unavailable, its limit or not");
  assert.equal(saysUnavailable(stuckOf({ ...base, misses: QUIET_MISSES }, 0)), true);
  const held = { ...base, last: { status: "ready" } };
  assert.equal(stuckOf(held, STUCK_MS), held, "bars on screen stay on screen");
  const none = { ...base, status: "none", code: "NO_POOL", misses: 0, busy: false };
  assert.equal(stuckOf(none, STUCK_MS), none);

  const chart = read("./CoinChart.tsx");
  assert.match(chart, /<ChartRound key=\{`\$\{props\.coin\.id\}:\$\{round\}`\}/, "«Try again» starts the chart afresh");
  assert.match(chart, /<Quiet size="s" onClick=\{onRetry\} data-coin="chart-retry">/, "no chart — one line and a quiet «Try again»");
  assert.match(chart, /\(data\.status === 'none' \|\| saysUnavailable\(data\)\) && !shown/);
});

test("flaw 68: a coin younger than its interval opens on a minute's bars", () => {
  const now = Date.UTC(2026, 10, 20, 19, 30);
  const age = (minutes) => [{ time: Math.floor(now / 1000) - minutes * 60 }];
  assert.equal(tooYoungFor(age(40), "1h", now), true, "forty minutes on «1h» — one candle at the edge");
  assert.equal(tooYoungFor(age(YOUNG_BARS * 60 + 1), "1h", now), false, "a life longer than the interval can show");
  assert.equal(tooYoungFor(age(5), "1m", now), false, "a minute's bars are the finest");
  assert.equal(tooYoungFor([], "1h", now), false);
});

test("flaws 65, 66, 67: no words over the candles, no «no volume», a state that is no interval", () => {
  const chart = read("./CoinChart.tsx");
  assert.doesNotMatch(chart, /line\.tag\)\s*\{\s*rules\.push\(`\$\{row\}:not\(\[data-off\]\)::after/, "the pool's strips carry no name over the bars");
  assert.match(chart, /<LayerItem on=\{poolLayer\.on\} onChange=\{poolLayer\.setOn\} coin="pool-layer" swatch>/, "the strips are named in the layers' menu");
  assert.doesNotMatch(read("./usePoolLayer.ts"), /liquidityTag/);
  assert.match(chart, /figure\.toggleAttribute\('data-coin-empty', value === none\)/);
  assert.match(read("./chart.module.css"), /\.ryntra-chart__figure\[data-coin-empty\]\) \{\s*display: none;/);
  assert.match(chart, /d\.lastTradeShort\(agoText\(ago, d\)\)/, "a trade's age says «ago» on a narrow chart");
  const desk = read("./desk-words.ts");
  assert.match(desk, /lastTradeShort: \(ago: string\) => `\$\{ago\} ago`/);
  assert.match(desk, /lastTradeShort: \(ago: string\) => `\$\{ago\} тому`/);
});

test("flaws 80, 81, 123: the trades without an empty column, in plain Ukrainian, their signs explained", () => {
  const tabs = read("./MarketTabs.tsx");
  // The cap's column only where the desk's columns with it fit the box; a narrow box has the phone's columns.
  assert.match(tabs, /const narrow = useCompact\(TRADE_COLS_NO_CAP\);/);
  assert.match(tabs, /const capRoom = !useCompact\(TRADE_COLS\);/);
  assert.match(tabs, /const capKnown = capRoom && rows\.some\(\(trade\) => trade\.capUsd !== null\);/);
  assert.match(tabs, /<MarksInfo marks=\{signs\} \/>/);
  assert.match(read("./Tape.tsx"), /<MarksInfo marks=\{signsOf\(tape\.trades\)\} \/>/, "on a desk the «i» stands over the column, where it opens whole");
  const desk = read("./desk-words.ts");
  assert.match(desk, /colSide: 'Угода'/);
  assert.match(desk, /buy: 'Купив'/);
  assert.match(desk, /sell: 'Продав'/);
  assert.doesNotMatch(desk, /Обіг/, "one word for the volume");
});

test("flaws 74–79, 124: a stock's facts once, the head's controls in one place, the facts without a repeated sentence", () => {
  const screen = read("./CoinScreen.tsx");
  assert.match(screen, /<StockCoinFacts mint=\{mint\} headSays=\{!narrow\} \/>/);
  assert.match(screen, /aria-pressed=\{held !== null && Number\(held\) === Number\(sum\)\}/, "the sum the ticket holds stands chosen");
  assert.match(read("./head.module.css"), /\.stock \{\s*display: none;/, "a phone's head leaves the stock's line to «About»");
  assert.doesNotMatch(read("./CoinFacts.tsx"), /about\.sentence/);
});

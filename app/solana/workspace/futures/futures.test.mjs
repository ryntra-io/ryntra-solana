// Run from repo root: node --test app/solana/workspace/futures/futures.test.mjs
//
// B7 — «Торгівля → Perps» (PERP-1): the core chart's source on Phoenix's bars, the page's words in both languages, and the
// page itself: in Solana's frame on the core's chart, book and tables, a view with no order and no signature.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FuturesChartFeed, LAST_BASIS, MARK_BASIS, decimalOf, onTick, readFreshMs, resolutionOf, stepFor, timeframeOf } from "./futures-chart-source.ts";
import { FUTURES_WORDS, futuresWord, phoenixWord } from "./futures-words.ts";
import { PolledBookFeed, ageOf, retryAfterOf } from "./use-futures-data.ts";
import { REFUSED_BEFORE_SENDING, relayAfterSigning } from "../../../../lib/phoenix/collateral-model.ts";
import { ORDERS_REFUSED_BEFORE_SENDING, orderRelayAfterSigning } from "../../../../lib/phoenix/orders-model.ts";
import { ORDER_WORDS, orderFailure, orderWord } from "./order-words.ts";
import { shareLots, unitsOf } from "./perp-ticket.ts";
import { PERPS_WORDS, perpsWord as perpsWordOf } from "./perps-words.ts";

const T = 1_792_000_800_000;
const H = 3_600_000;
const bar = (t, c, extra = {}) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 2, final: true, ...extra });
const read = (bars, at, timeframe = "1h") => ({ symbol: "SOL", timeframe, last: bars, mark: bars.map((b) => ({ ...b, c: b.c + 0.5, v: null })), observedAt: at });
const init = (resolution, basis = LAST_BASIS) => ({ instrument: "SOL", resolution, basis, load: "init", limit: 300 });

test("the instrument is Phoenix's perpetual on Solana, on the traded price and the mark price", async () => {
  const feed = new FuturesChartFeed("SOL", { tick: 0.01, lot: 0.001, price: 180.25 }, () => T);
  const instrument = await feed.source.instrument("SOL");
  assert.equal(instrument.kind, "perp");
  assert.equal(instrument.network, "solana");
  assert.equal(instrument.venue, "phoenix");
  assert.equal(instrument.symbol, "SOL-PERP");
  assert.equal(instrument.tick, "0.01", "Phoenix's own step");
  assert.equal(instrument.lot, "0.001", "Phoenix's own lot");
  assert.equal(decimalOf(1), "1");
  assert.equal(decimalOf(100), "100");
  assert.equal(decimalOf(0.00001), "0.00001");
  assert.equal(decimalOf(0), null);
  assert.deepEqual(instrument.bases, [LAST_BASIS, MARK_BASIS]);
  await assert.rejects(feed.source.instrument("BTC"));
  assert.equal(stepFor(0.000012345), "0.000000001");
  assert.equal(stepFor(64_000), "1");
  assert.equal(onTick(180.256, "0.01"), "180.26");
  assert.equal(timeframeOf(resolutionOf("4h")), "4h");
  assert.equal(timeframeOf({ kind: "tick", count: 100 }), null);
});

test("history waits for the page's read, then pages back; the mark price is its own basis", async () => {
  let now = T + 3 * H;
  const feed = new FuturesChartFeed("SOL", { tick: null, lot: null, price: 180 }, () => now);
  const pending = feed.source.history(init(resolutionOf("1h")));
  feed.put(read([bar(T, 180), bar(T + H, 181), bar(T + 2 * H, 182)], now));
  const page = await pending;
  assert.deepEqual(page.bars.map((b) => b.t), [T, T + H, T + 2 * H]);
  assert.equal(page.bars[2].c, "182.00");
  assert.equal(page.status.state, "delayed");
  assert.equal(page.status.source.id, "phoenix");
  const mark = await feed.source.history(init(resolutionOf("1h"), MARK_BASIS));
  assert.equal(mark.bars[2].c, "182.50");
  assert.equal(mark.bars[2].v, null);
  const older = await feed.source.history({ ...init(resolutionOf("1h")), load: "forward", timestamp: T + 2 * H, limit: 1 });
  assert.deepEqual(older.bars.map((b) => b.t), [T + H]);
  assert.equal(older.more.forward, true);
  await assert.rejects(feed.source.history(init({ kind: "time", unit: "minute", span: 3 })));
  /* A copy as old as the edge may serve is still fresh; past that and two polls the numbers are stale. */
  assert.equal(readFreshMs("1h"), 80_000);
  assert.equal(readFreshMs("1m"), 30_000);
  now += 70_000;
  assert.equal((await feed.source.history(init(resolutionOf("1h")))).status.state, "delayed");
  now += 20_000;
  assert.equal((await feed.source.history(init(resolutionOf("1h")))).status.state, "stale");
});

test("a new read replaces the newest bar, opens new ones in order and corrects an older one that changed", async () => {
  const now = T + 3 * H;
  const feed = new FuturesChartFeed("SOL", { tick: null, lot: null, price: 180 }, () => now);
  feed.put(read([bar(T, 180), bar(T + H, 181)], now));
  await feed.source.history(init(resolutionOf("1h")));
  const events = [];
  const stop = feed.source.subscribe({ instrument: "SOL", resolution: resolutionOf("1h"), basis: LAST_BASIS }, (event) => events.push(event));
  feed.put(read([bar(T, 179), bar(T + H, 181.5), bar(T + 2 * H, 183)], now));
  assert.deepEqual(events.map((event) => event.type), ["corrected", "bar", "bar"]);
  assert.equal(events[0].correction.from, T);
  assert.deepEqual(events.slice(1).map((event) => [event.bar.t, event.bar.c]), [[T + H, "181.50"], [T + 2 * H, "183.00"]]);
  /* The same read again sends no bar — only how fresh the numbers are. */
  events.length = 0;
  feed.put(read([bar(T, 179), bar(T + H, 181.5), bar(T + 2 * H, 183)], now));
  assert.deepEqual(events.map((event) => event.type), ["status"]);
  assert.equal(events[0].status.state, "delayed");
  /* A failed read keeps the bars and says they are stale. */
  feed.fail("1h");
  assert.equal(events.at(-1).type, "status");
  assert.equal(events.at(-1).status.state, "stale");
  const heard = events.length;
  stop();
  feed.put(read([bar(T + 3 * H, 184)], now));
  assert.equal(events.length, heard, "an unsubscribed chart hears nothing");
  feed.dispose();
});

test("a chart that listened before the first read starts from its newest bar", () => {
  const feed = new FuturesChartFeed("SOL", { tick: null, lot: null, price: null }, () => T);
  const events = [];
  feed.source.subscribe({ instrument: "SOL", resolution: resolutionOf("15m"), basis: LAST_BASIS }, (event) => events.push(event));
  feed.put(read([bar(T, 1), bar(T + 900_000, 2)], T, "15m"));
  assert.deepEqual(events.map((event) => [event.type, event.bar?.t]), [["bar", T + 900_000]]);
});

test("ages come from the cache's Age and the page's own clock, never the server's time against the visitor's", async () => {
  const headers = (entries) => new Headers(entries);
  assert.equal(ageOf(headers({ age: "3" })), 3000);
  assert.equal(ageOf(headers({})), 0);
  assert.equal(retryAfterOf(headers({ "retry-after": "12" }), 2000), 12_000);
  assert.equal(retryAfterOf(headers({ "retry-after": "9999" }), 2000), 60_000);
  assert.equal(retryAfterOf(headers({}), 2000), 8000);
  let clock = 1_000;
  const book = new PolledBookFeed(() => clock);
  const heard = [];
  book.subscribe((message) => heard.push(message));
  /* The server's time is far from the page's: it never enters the age. */
  book.put({ symbol: "SOL", slot: 1, bids: [{ price: 1, size: 1 }], asks: [], observedAt: 9_999_999_999_999 }, { ageMs: 2000, receivedAt: 1_000 });
  assert.equal(heard[0].age_ms, 2000);
  clock = 4_000;
  assert.equal(book.current().age_ms, 5000);
  /* The chart: a read 4 s old in the cache is 4 s old under the chart. */
  const feed = new FuturesChartFeed("SOL", { tick: 0.01, lot: null, price: 1 }, () => T);
  feed.put(read([bar(T - H, 1)], 123), 4000);
  const page = await feed.source.history(init(resolutionOf("1h")));
  assert.equal(page.status.age_ms, 4000);
});

test("both languages carry every word of the page, and fill their blanks", () => {
  assert.deepEqual(Object.keys(FUTURES_WORDS.uk).sort(), Object.keys(FUTURES_WORDS.en).sort());
  for (const [key, value] of Object.entries(FUTURES_WORDS.uk)) {
    assert.ok(value.length > 0, key);
    assert.equal((value.match(/\{\w+\}/g) ?? []).join(), (FUTURES_WORDS.en[key].match(/\{\w+\}/g) ?? []).join(), `${key} has other blanks in Ukrainian`);
  }
  /* «Perps» in both languages, as Jupiter, Drift and Phoenix name the place: the
     title, the Review and the receipt name it; what perps are is said once, in the page's «?». */
  for (const locale of ["en", "uk"]) {
    assert.equal(futuresWord(locale, "title"), "Perps");
    for (const key of ["reviewDeposit", "reviewWithdraw", "receiptDeposit", "receiptWithdraw", "whatDeposit", "help"]) assert.match(futuresWord(locale, key), /\bPerps\b/, `${locale} ${key}`);
    const said = Object.entries(FUTURES_WORDS[locale]).filter(([, value]) => /perpetual futures|безстрокові ф'ючерси/i.test(value)).map(([key]) => key);
    assert.deepEqual(said, ["help"], `${locale}: what perps are is said once, in «?»`);
    for (const [key, value] of Object.entries(FUTURES_WORDS[locale])) {
      if (key !== "help") assert.doesNotMatch(value, /futures|ф'ючерс/i, `${locale} ${key} still says futures`);
    }
  }
  assert.match(futuresWord("uk", "help"), /^Perps — безстрокові ф'ючерси:/);
  assert.match(futuresWord("en", "help"), /^Perps are perpetual futures:/);
  assert.equal(futuresWord("uk", "reviewDeposit", { x: "10" }), "Внести заставу в Perps на Phoenix: 10 USDC");
  assert.equal(futuresWord("en", "receiptWithdraw"), "Perps withdrawal from Phoenix");
  assert.equal(futuresWord("en", "upTo", { x: "20" }), "up to 20×");
  assert.equal(phoenixWord("uk", "postOnly"), "Лише мейкер");
  assert.equal(phoenixWord("uk", "closed"), "закрита");
  assert.equal(phoenixWord("uk", "active"), "торгується", "Phoenix's «active» session is never shown raw");
  assert.equal(phoenixWord("uk", "somethingNew"), "somethingNew");
  /* No promise words and no names of tasks where a person reads. */
  for (const value of [...Object.values(FUTURES_WORDS.en), ...Object.values(FUTURES_WORDS.uk)]) {
    assert.doesNotMatch(value, /\b(soon|coming|B6|B7|Hyperliquid)\b|скоро|незабаром/i, value);
    /* No verdict of safety beside an account with leverage. */
    assert.doesNotMatch(value, /\bsafe\b|безпечн/i, value);
  }
  /* «Ризик ліквідації: низький · до межі N %». */
  assert.equal(`${futuresWord("uk", "risk")}: ${futuresWord("uk", "risk.safe")} · ${futuresWord("uk", "riskRoom", { x: "83 %" })}`, "Ризик ліквідації: низький · до межі 83 %");
  assert.equal(`${futuresWord("en", "risk")}: ${futuresWord("en", "risk.safe")} · ${futuresWord("en", "riskRoom", { x: "83%" })}`, "Liquidation risk: low · 83% to the limit");
  assert.equal(futuresWord("uk", "bookSize", { coin: "SOL" }), "Розмір, SOL");
});

test("the page is Solana's terminal (PERP-2): the core's terminal and chart, the perpetual's own book and ticket; the page builds and signs nothing", () => {
  const page = readFileSync(new URL("./futures-workspace.tsx", import.meta.url), "utf8");
  const terminal = readFileSync(new URL("./perps-terminal.tsx", import.meta.url), "utf8");
  const head = readFileSync(new URL("./perps-header.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("./perp-ticket-form.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("./order-panel.tsx", import.meta.url), "utf8");
  assert.match(page, /from "@ryntra\/core\/chart"/);
  assert.match(page, /<RyntraChart/);
  /* The core's terminal: panels dragged, resized, split, put away and brought back, the arrangement kept; the page's own «Стандарт». */
  assert.match(terminal, /from "@ryntra\/core\/terminal"/);
  /* PERP-6: each width keeps its own layout under its own page, starting from its own «Стандарт», through the store that moves `v2`. */
  assert.match(terminal, /<Terminal key=\{page\} page=\{page\}[^>]*standard=\{PERPS_STANDARDS\[width\]\} store=\{store\}/);
  assert.match(page, /<PerpsTerminal\b/);
  assert.match(page, /<PerpBook\b/);
  assert.match(page, /<Table\b/);
  /* What can be done now stands in the head, one chip — trading open, a view, or a market Phoenix paused. */
  assert.match(head, /data-perps-mode=\{trade === "open" \? "trade" : "view"\}/);
  /* The one ticket lives in its own node: a preset or a panel brought back never drops what is typed or a Review. */
  assert.match(page, /createPortal\(\s*<OrderPanel\b/);
  assert.match(panel, /<PerpTicketForm\b/);
  assert.match(form, /data-perp-leverage\b/, "the leverage is the ticket's own control");
  assert.match(page, /id: `tp-\$\{position\.subaccount\}`/);
  assert.match(page, /id: "draft-limit"/);
  /* A terminal is never capped into a middle column: it takes what the first screen leaves. */
  const css = readFileSync(new URL("./perps.module.css", import.meta.url), "utf8");
  assert.match(css, /\.terminal \{[^}]*height: var\(--perps-terminal-h/);
  assert.doesNotMatch(/\.page \{([^}]*)\}/.exec(css)[1], /max-width|margin-inline:\s*auto/);
  /* A guest has one way to a wallet in each place that needs one — the shared control (B14). */
  assert.match(page, /<WalletGate title=\{pw\("acc\.connect"\)\} \/>/);
  assert.match(form, /<ConnectWalletButton block \/>/);
  for (const source of [page, panel, form, terminal, head]) assert.doesNotMatch(source, /openSolanaConnection/);
  /* Each position shows its leverage and where Phoenix liquidates it, and the chart draws that line (UX-354). */
  assert.match(page, /key: "leverage"/);
  assert.match(page, /key: "liquidation"/);
  assert.match(page, /w\("liquidationLine"\)/);
  for (const source of [page, head, terminal, readFileSync(new URL("./perp-book.tsx", import.meta.url), "utf8"), readFileSync(new URL("./use-futures-data.ts", import.meta.url), "utf8")]) {
    assert.doesNotMatch(source, /signTransaction|signMessage|sendTransaction|method:\s*"POST"|lightweight-charts|tradingview/i);
  }
  /* A page of public market data: a blink of the sign-in store never swaps it for the sign-in gate. */
  assert.match(readFileSync(new URL("../../../app/account/account-context.tsx", import.meta.url), "utf8"), /PUBLIC_PAGES = new Set\(\[[^\]]*"\/app\/perps"/);
  /* The person's account is read by the connected wallet's address, never by a typed one. */
  assert.match(page, /const wallet = connection\?\.address \?\? null;/);
});

test("the Perps standard (PERP-2): the chart with the book beside it, positions and orders under both, the ticket with the account under it", async () => {
  const { PERPS_PANELS, perpsStandardDock, perpsStandardLayout } = await import("./perps-layout.ts");
  const layout = perpsStandardLayout(5);
  assert.equal(layout.preset, "clean");
  assert.equal(layout.updatedAt, 5);
  assert.deepEqual(layout.blocks.filter((block) => !block.hidden).map((block) => block.id), ["chart", "ticket", "positions", "orders", "trades", "funding", "history", "account", "book"]);
  const dock = perpsStandardDock();
  const [left, right] = dock.grid.root.data;
  /* The ticket with the account under it: deposit and withdraw beside the order, never a tab away. */
  assert.deepEqual(right.data.map((leaf) => leaf.data.views), [["ticket"], ["account"]]);
  const [top, tabs] = left.data;
  assert.deepEqual(top.data.map((leaf) => leaf.data.views), [["chart"], ["book"]]);
  /* The bottom dock as the spec names it (PERP-5, spec §11.1): the positions, the orders, the trades, the funding, the history. */
  assert.deepEqual(tabs.data.views, ["positions", "orders", "trades", "funding", "history"]);
  /* Every panel the dock names is a panel of the page with its kind, and «Торгівля» keeps the four the core asks for. */
  for (const id of Object.keys(dock.panels)) assert.ok(PERPS_PANELS.some((spec) => spec.id === id));
  assert.deepEqual(PERPS_PANELS.filter((spec) => spec.kind).map((spec) => spec.kind).sort(), ["book", "chart", "positions", "ticket"]);
  /* The core compares arrangements by each share in fiftieths: no share of the start sits on a half. */
  const halves = (node) => (node.type === "branch" ? [...node.data.map((child) => (child.size / node.data.reduce((sum, item) => sum + item.size, 0)) * 50), ...node.data.flatMap(halves)] : []);
  for (const share of halves(dock.grid.root)) assert.ok(Math.abs((share % 1) - 0.5) > 0.1, `a share of ${share.toFixed(2)} fiftieths`);
});

test("«Застава» (B6): one Review and the wallet's own signature per move, a receipt after, and nothing of Ryntra's in the costs", () => {
  const panel = readFileSync(new URL("./collateral-panel.tsx", import.meta.url), "utf8");
  const carrier = readFileSync(new URL("./collateral-api.ts", import.meta.url), "utf8");
  assert.match(panel, /<Review\b/);
  assert.match(panel, /<Receipt\b/);
  assert.match(panel, /label: w\("costRyntra"\), value: w\("costNone"\)/);
  /* The wallet signs; the relay sends. The page never sends a transaction itself, nor signs a message. */
  assert.match(carrier, /signTransactions\(/);
  assert.match(carrier, /chain: "solana:mainnet"/);
  assert.doesNotMatch(panel + carrier, /sendTransaction|signMessage|signAndSend/);
  /* A closed gate keeps the action grey with its reason, never hidden. */
  assert.match(panel, /disabled=\{!ready\}/);
  assert.match(panel, /w\("closedNote"\)/);
});

test("«Застава» after the wallet signed: the relay's own refusals stand; any other answer, a code this page does not know among them, waits on the chain", () => {
  const signatures = ["5ig"];
  for (const code of ["RELAY_REFUSED", "CANARY_LIMIT", "ACTIONS_CLOSED", "WALLET_MISMATCH", "TICKET_EXPIRED", "SIGNED_MISMATCH"]) {
    assert.deepEqual(relayAfterSigning({ ok: false, code }, signatures), { ok: false, code }, code);
    assert.ok(REFUSED_BEFORE_SENDING.has(code), code);
  }
  for (const code of ["HTTP_502", "NETWORK", "INTERNAL", "SOMETHING_NEW"]) {
    assert.deepEqual(relayAfterSigning({ ok: false, code }, signatures), { ok: true, value: { results: [{ signature: "5ig", state: "UNKNOWN", reason: null }], settled: false } }, code);
  }
  const landed = { ok: true, value: { results: [{ signature: "5ig", state: "LANDED", reason: null, usdcMoved: "-2500000" }], settled: true } };
  assert.equal(relayAfterSigning(landed, signatures), landed);
  /* The carrier hands its answer to this decision, not to a list of its own. */
  assert.match(readFileSync(new URL("./collateral-api.ts", import.meta.url), "utf8"), /return relayAfterSigning\(relayed, /);
});

test("orders (B6b, PERP-2): the perpetual's ticket for a new position, one Review and the wallet's signature per order, a receipt with Phoenix's fills", () => {
  const panel = readFileSync(new URL("./order-panel.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("./perp-ticket-form.tsx", import.meta.url), "utf8");
  const carrier = readFileSync(new URL("./orders-api.ts", import.meta.url), "utf8");
  assert.match(panel, /<PerpTicketForm\b/);
  /* The ticket is the core's parts — one look across Ryntra — with the perpetual's own fields. */
  assert.match(form, /className=\{`ryntra-ticket /);
  assert.match(panel, /<Review\b/);
  assert.match(panel, /<Receipt\b/);
  /* Review states the leverage, the liquidation price, the collateral, the fees and the funding — from the server's answer. */
  for (const row of ["row.leverageAfter", "row.liquidation", "row.collateralAfter", "row.funding", "cost.phoenix", "cost.ryntra"]) assert.match(panel, new RegExp(`w\\("${row.replace(".", "\\.")}"`), row);
  /* The wallet signs; the relay sends. The page never sends a transaction itself, nor signs a message. */
  assert.match(carrier, /signTransactions\(/);
  assert.match(carrier, /chain: "solana:mainnet"/);
  assert.doesNotMatch(panel + carrier, /sendTransaction|signMessage|signAndSend/);
  assert.match(carrier, /return orderRelayAfterSigning\(relayed, /);
  /* A closed gate keeps the ticket on screen and its action says why; nothing is built until the draft is an order. */
  assert.match(panel, /!states\.open \? "closed"/);
  assert.match(form, /disabled=\{gate !== null \|\| busy \|\| order === null\}/);
  assert.match(form, /w\("action\.closed"\)/);
  /* Before any Review the ticket shows the liquidation estimate and the margin by Phoenix's SDK (PERP-4) and the fees — Ryntra's included. */
  assert.match(form, /useTicketMargin\(/);
  assert.match(form, /figures\?\.liquidation/);
  assert.match(form, /w\("feesRates"/);
});

test("the orders' words: both languages, every blank, no promise, no verdict of safety; every refusal has its line", () => {
  assert.deepEqual(Object.keys(ORDER_WORDS.uk).sort(), Object.keys(ORDER_WORDS.en).sort());
  for (const [key, value] of Object.entries(ORDER_WORDS.uk)) {
    assert.ok(value.length > 0, key);
    assert.equal((value.match(/\{\w+\}/g) ?? []).sort().join(), (ORDER_WORDS.en[key].match(/\{\w+\}/g) ?? []).sort().join(), `${key} has other blanks in Ukrainian`);
  }
  for (const value of [...Object.values(ORDER_WORDS.en), ...Object.values(ORDER_WORDS.uk)]) {
    assert.doesNotMatch(value, /\b(soon|coming|B6b?|B7|Hyperliquid|canary)\b|скоро|незабаром|канарк/i, value);
    assert.doesNotMatch(value, /\bsafe\b|безпечн|guarantee|гарант/i, value);
  }
  for (const code of ["ORDERS_CLOSED", "CANARY_LIMIT", "NOT_FILLABLE", "TP_SIDE", "ISOLATED_ONLY", "SIMULATION_FAILED", "WALLET_REFUSED"]) assert.notEqual(orderFailure("uk", code), orderFailure("uk", "general"), code);
  assert.equal(orderFailure("en", "SOMETHING_NEW"), orderWord("en", "fail.general"));
  assert.equal(orderWord("uk", "row.fundingLongs", { x: "+0,0125 %" }), "+0,0125 % · лонги платять шортам");
});

test("orders after the wallet signed: the relay's own refusals stand; any other answer waits on the chain", () => {
  for (const code of ["ORDERS_CLOSED", "CANARY_LIMIT", "SIGNED_MISMATCH", "TICKET_EXPIRED", "WALLET_MISMATCH"]) {
    assert.deepEqual(orderRelayAfterSigning({ ok: false, code }, ["s"]), { ok: false, code });
    assert.ok(ORDERS_REFUSED_BEFORE_SENDING.has(code), code);
  }
  assert.deepEqual(orderRelayAfterSigning({ ok: false, code: "HTTP_502" }, ["s"]), { ok: true, value: { results: [{ signature: "s", state: "UNKNOWN", reason: null }], settled: false } });
});

const SOL_MARKET = { symbol: "SOL", status: "active", calendar: false, session: null, maxLeverage: 20, isolatedOnly: false, tickSize: 100, baseLotsDecimals: 2, markPrice: 150, oraclePrice: 149.9, prevDayMarkPrice: 148, dayVolumeUsd: 1e6, takerRate: 0.00035, makerRate: 0.00005 };

test("the perpetual's units: Phoenix's own step and lot, a share of a position in lots", () => {
  const units = unitsOf(SOL_MARKET);
  assert.deepEqual(units, { tickSize: 100, baseLotsDecimals: 2 });
  assert.equal(unitsOf({ tickSize: null, baseLotsDecimals: 2 }), null);
  assert.equal(shareLots(0.3, 50, units), 15n);
  assert.equal(shareLots(0.01, 25, units), 1n, "at least one lot");
});

test("the terminal's words (PERP-2): both languages, every blank on both sides, every block of the ticket has its line", async () => {
  assert.deepEqual(Object.keys(PERPS_WORDS.uk).sort(), Object.keys(PERPS_WORDS.en).sort());
  for (const [key, value] of Object.entries(PERPS_WORDS.uk)) {
    const blanks = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");
    assert.equal(blanks(value), blanks(PERPS_WORDS.en[key]), key);
    assert.doesNotMatch(value, /безпечн|гарант/i, key);
  }
  for (const block of ["SIDE", "SIZE", "PRICE", "MINIMUM", "OVER_MAX", "TP", "SL", "TP_SIDE", "SL_SIDE", "POST_ONLY_CROSS", "REDUCE_LIMIT", "REDUCE_SIDE", "REDUCE_NONE", "REDUCE_OVER", "thin"]) assert.ok(PERPS_WORDS.en[`block.${block}`], block);
  /* Each time in force has its name and its one sentence, in both languages (PERP-5, spec §9). */
  for (const tif of ["gtc", "post_only", "ioc", "fok"]) {
    assert.ok(PERPS_WORDS.en[`tif.${tif}`] && PERPS_WORDS.uk[`tif.${tif}`], tif);
    assert.ok(PERPS_WORDS.en[`tifNote.${tif}`].endsWith("."), `${tif} explains itself in one sentence`);
    assert.ok(PERPS_WORDS.uk[`tifNote.${tif}`].endsWith("."), tif);
  }
});

test("«Дані не оновлюються» (PERP-4): the head and the ticket say it with the last update's time; new risk waits, a cut goes on", async () => {
  const header = readFileSync(new URL("./perps-header.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("./perp-ticket-form.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("./futures-workspace.tsx", import.meta.url), "utf8");
  const data = readFileSync(new URL("./use-futures-data.ts", import.meta.url), "utf8");
  /* A failed `/markets` no longer leaves the old mark standing as live (REVIEW §6.2): every read and failure feeds the life. */
  assert.match(data, /step\(\{ kind: "snapshot"/);
  assert.match(data, /step\(\{ kind: "fail" \}\)/);
  assert.match(data, /kind: "tick", now: pageClock\(\), maxAgeMs: MARKETS_MAX_AGE_MS/);
  assert.match(page, /const stale = feedStale\(markets\.feed\)/);
  /* The head: the chip with the time, the mark greyed. */
  assert.match(header, /w\("head\.staleAt", \{ at: staleAt \}\)/);
  assert.match(header, /data-stale=\{stale \? "" : undefined\}/);
  /* The ticket: new risk is blocked with the time; a cut (reduce-only, or an order that only reduces) is not. */
  assert.match(form, /const staleBlock = stale !== null && !reduces;/);
  assert.match(form, /w\(staleSince \? "block\.STALE_AT" : "block\.STALE", \{ at: staleSince \?\? "" \}\)/);
  /* New risk goes to Review only on the SDK's fresh check of this very size: not before it came, not after it failed (critic, PERP-4). */
  assert.match(form, /const check = sdkCheck\(\{ addsRisk: !reduces && made !== null && "order" in made,/);
  assert.match(form, /const sdkAge = sdk\.figuresAt === null \? null : pageClock\(\) - sdk\.figuresAt;/, "the answer's age on the page's own clock, never the server's against the visitor's");
  assert.match(form, /carried && !staleBlock && unchecked === null \? made\.order : null/);
  assert.match(form, /const figures = sdkFresh \?/, "an old or failed answer is never shown as now");
  assert.match(form, /fillTicks: null,/, "the book's every move does not ask again");
  /* Flapping states are sent at most once per market and kind in five minutes. */
  const telemetry = readFileSync(new URL("./perps-telemetry.ts", import.meta.url), "utf8");
  assert.match(telemetry, /QUIET_NAMES[^;]*"market_stream_stale", "risk_warning_shown"/);
  /* The core chart is told too: its trading layer is not tradable while the data is stale. */
  assert.match(page, /tradable: !stale, not_tradable_reason: stale \? pw\("head\.stale"\) : null/);
  /* The words: both languages, the time in each. */
  assert.match(PERPS_WORDS.uk["head.staleAt"], /Дані не оновлюються.*\{at\}/);
  assert.match(PERPS_WORDS.uk["block.STALE_AT"], /\{at\}/);
  assert.match(PERPS_WORDS.uk["block.STALE"], /зменшити чи закрити позицію можна/);
  assert.match(PERPS_WORDS.en["block.STALE"], /reducing or closing a position still works/);
});

test("the ticket asks the SDK's calculator its own question: the most without the size, the figures with it", async () => {
  const { ticketUrl, maxKeyOf } = await import("./use-futures-data.ts");
  const question = { wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", symbol: "SOL", side: "long", type: "market", leverage: 7.9, slippageBps: 50, feeBps: 5.5, sizeLots: "1200", limitTicks: null, reduceOnly: false, fillTicks: "180100" };
  const url = ticketUrl(question);
  assert.match(url, /^\/api\/solana\/futures\/ticket\?/);
  const query = new URL(url, "http://x").searchParams;
  assert.equal(query.get("leverage"), "7", "a whole leverage");
  assert.equal(query.get("size"), "1200");
  assert.equal(query.get("fill"), "180100");
  assert.equal(query.get("price"), null);
  assert.equal(maxKeyOf(url), maxKeyOf(ticketUrl({ ...question, sizeLots: "5", fillTicks: null })), "the most stands while only the size changes");
  assert.notEqual(maxKeyOf(url), maxKeyOf(ticketUrl({ ...question, leverage: 3 })), "another leverage is another most");
});

test("PERP-5 — the deal's core on the page: the step between the signature and the receipt, the fees apart, no imposed side", () => {
  const panel = readFileSync(new URL("./order-panel.tsx", import.meta.url), "utf8");
  const form = readFileSync(new URL("./perp-ticket-form.tsx", import.meta.url), "utf8");
  const carrier = readFileSync(new URL("./orders-api.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("./futures-workspace.tsx", import.meta.url), "utf8");

  /* Spec §10: Review → the wallet → the step with the signature while the relay sends → the chain's own word. */
  assert.match(panel, /kind: "signed";/);
  assert.match(panel, /function OrderSigned\(/);
  assert.match(panel, /w\("sent\.title"\)/);
  assert.match(carrier, /onSigned\?: \(signature: string\) => void/);
  /* The signature is known the moment the wallet signs — before the relay has answered. */
  assert.match(carrier, /if \(signatures\[0\]\) onSigned\?\.\(signatures\[0\]\);/);
  /*
   * And it claims no more than that: the relay may still refuse before sending (an aged ticket, a closed gate, a rate
   * limit), so this step offers no explorer link for a transaction that may never exist, and its words say «signed»
   * and «on their way», never that Solana has it.
   */
  const signedStep = panel.slice(panel.indexOf("function OrderSigned("), panel.indexOf("/** The word of the outcome"));
  assert.ok(signedStep.length > 200, "the step's own source");
  assert.doesNotMatch(signedStep, /explorerTxUrl/);
  assert.match(ORDER_WORDS.en["sent.note"], /signed and the bytes are on their way/);
  assert.doesNotMatch(ORDER_WORDS.en["sent.title"], /^Sent to/);
  /* The impact row tells the book's silence from its answer, and a resting order from one that may cross. */
  for (const state of ["quiet", "thin", "resting", "unsure"]) assert.ok(ORDER_WORDS.en[`row.impact.${state}`] && ORDER_WORDS.uk[`row.impact.${state}`], state);
  assert.match(panel, /row\.impact\.\$\{review\.book/);
  /* «The position is open» is never said on the signature: the receipt's words come from the outcome. */
  assert.match(panel, /orderOutcomeOf\(\{ state, kind: review\.kind/);
  assert.doesNotMatch(panel, /receipt\.filled.*signing|signing.*receipt\.filled/);

  /* The receipt's costs stand apart: Phoenix, Ryntra, the network, the impact — and the split is from the fills. */
  assert.match(panel, /feeSplitOf\(fills, \{ takerRate: review\.fees\.takerRate/);
  for (const line of ['w\\("cost\\.phoenix"\\)', 'w\\("cost\\.ryntra"\\)', 'w\\("cost\\.network"\\)', 'w\\("row\\.impact"\\)']) assert.match(panel, new RegExp(line));
  /* A split the chain's own total contradicts is said, not hidden. */
  assert.match(panel, /receipt\.feeDisagrees/);

  /*
   * Any change to the ticket makes a standing Review stale (spec §9), by construction and by a backstop: under a
   * Review or a signature the ticket is not on screen at all, while a Review is being prepared its fields are frozen,
   * and a draft that changed under a standing Review drops it with its own word.
   */
  assert.match(panel, /if \(phase\.kind === "review" \|\| phase\.kind === "signing"\) \{/);
  assert.match(panel, /onDraft=\{busy \? \(\) => undefined : setDraft\}/);
  assert.match(panel, /reviewedDraft\.current === draft/);
  assert.match(panel, /w\("reviewStale"\)/);

  /* Pro: post-only, IOC and FOK, each with its one sentence; Best bid and Best ask on the limit's price. */
  assert.match(form, /name="perp-tif"/);
  assert.match(form, /tifNote\.\$\{tif\}/);
  assert.match(form, /data-perp-best="bid"/);
  assert.match(form, /data-perp-best="ask"/);
  /* TP/SL in three units, the price following from whichever was typed — and the chart drawing that price, not the figure. */
  assert.match(form, /name="perp-leg-unit"/);
  assert.match(form, /legPriceOf\(/);
  assert.match(form, /onLegs\?\.\(drawnLegs\)/);
  assert.match(form, /legEntryUsd, legLeverage/);
  assert.match(panel, /tp: own \? legLevels\.tp : null/);
  /* A price is quantised by the price step and a size by the lot — never one by the other. */
  assert.match(page, /const atSize = onStep\(feed\.instrument\.lot\);/);
  /* No side is chosen for the person, and a careful leverage greets a first order. */
  assert.match(form, /data-perp-sides=\{draft\.side \?\? "none"\}/);
  assert.match(panel, /const DEFAULT_LEVERAGE = CAREFUL_LEVERAGE;/);

  /* The bottom dock's five tabs, «cancel all» with its count, and the five numbers kept apart. */
  for (const panelId of ["trades", "funding", "history"]) assert.match(page, new RegExp(`\\n    ${panelId}: \\{`));
  assert.match(page, /data-futures-act="cancel-all"/);
  assert.match(page, /ord\.cancelAllOn/);
  for (const sum of ["sum.unrealised", "sum.realised", "sum.fees", "sum.fundingPaid", "sum.fundingGot"]) assert.match(page, new RegExp(sum.replace(".", "\\.")));
  /* A conditional order of the position is lifted by its index; a stop Phoenix gives no index for says so. */
  assert.match(page, /data-futures-act="cancel-leg"/);
  assert.match(page, /ord\.cancelStopNote/);
  /* The position's own lines are the core chart's `PositionLines`, never a line of Perps' own. */
  assert.match(page, /position: chartPosition/);
  assert.match(page, /break_even:/);
  assert.match(page, /percent_of: \(margin !== null \? "margin" : "notional"\)/);
  /* The page still builds and signs nothing itself. */
  assert.doesNotMatch(page, /sendTransaction|signMessage|signAndSend/);
});

test("PERP-7 — Risk Guardian on the page: the five states, their words, their actions and the Pro help", () => {
  const panel = readFileSync(new URL("./collateral-panel.tsx", import.meta.url), "utf8");
  const guardian = readFileSync(new URL("./risk-guardian.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("./futures-workspace.tsx", import.meta.url), "utf8");

  /* Every state of the scale has its word and its one sentence, in both languages. */
  for (const locale of ["uk", "en"]) {
    for (const state of ["healthy", "raised", "critical", "stale", "liquidation"]) {
      assert.ok(FUTURES_WORDS[locale][`guard.${state}`], `${locale} ${state}`);
      const what = FUTURES_WORDS[locale][`guard.what${state[0].toUpperCase()}${state.slice(1)}`];
      assert.ok(what?.endsWith("."), `${locale} ${state} explains itself in sentences`);
    }
    for (const act of ["reduce", "close", "deposit", "cancelAll"]) assert.ok(FUTURES_WORDS[locale][`guard.${act}`], `${locale} ${act}`);
  }
  assert.equal(futuresWord("uk", "guard.healthy"), "Здоровий");
  assert.equal(futuresWord("uk", "guard.raised"), "Підвищений ризик");
  assert.equal(futuresWord("uk", "guard.critical"), "Критичний");
  assert.equal(futuresWord("uk", "guard.stale"), "Дані застаріли");
  assert.equal(futuresWord("uk", "guard.liquidation"), "Ліквідація");
  assert.equal(futuresWord("uk", "guard.what"), "Що це означає?");

  /* The scale stands in the account block, over Phoenix's own margin views, and says when the figures are old. */
  assert.match(panel, /<RiskGuardian/);
  assert.match(panel, /margins=\{\[margin, \.\.\.\(account\.subaccountMargins \?\? \[\]\)\]\}/);
  assert.match(panel, /stale=\{stale\}/);
  assert.match(page, /<CollateralPanel[^>]*stale=\{stale\}[^>]*pro=\{settings\.mode === "pro"\}[^>]*onRiskAct=\{riskAct\}/);
  /* «Зменшити» and «Закрити» reach the same Review and signature as the table's own actions. */
  assert.match(page, /actOn\(\{ kind: action, position: riskiest \}, riskiest\)/);
  assert.match(page, /setIntent\(\{ kind: "cancelAll", symbol: resting\.symbol \}\)/);
  /* «Поповнити» is the account panel's own form, not a trip out and back. */
  assert.match(panel, /if \(action === "deposit"\)/);

  /* A grade Phoenix did not name is not turned into «Здоровий»: the scale stays away until the protocol says something. */
  assert.match(guardian, /if \(view\.tier === null && !view\.stale\) return null;/);
  /* The state is never carried by colour alone: a word always, and the warning sign on the three that matter. */
  assert.match(guardian, /MARKED: ReadonlySet<GuardianState> = new Set\(\["raised", "critical", "liquidation"\]\)/);
  assert.match(guardian, /data-futures-guardian=\{view\.state\}/);
  /* Pro opens what Phoenix's grades, liquidations and ADL actually do (spec §12). */
  assert.match(guardian, /pro \? \(/);
  for (const key of ["guard.helpTiers", "guard.helpLiquidation", "guard.helpAdl"]) assert.match(guardian, new RegExp(key.replace(".", "\\.")));
  assert.match(futuresWord("uk", "guard.helpAdl"), /ADL/);
  assert.match(futuresWord("en", "guard.helpAdl"), /ADL/);
  assert.match(futuresWord("uk", "guard.helpLiquidation"), /backstop/i);
  assert.match(futuresWord("uk", "guard.help"), /ступен/i);
});

test("PERP-7 — Scalp Check beside the spread in Pro, counted on the levels drawn right above it", () => {
  const book = readFileSync(new URL("./perp-book.tsx", import.meta.url), "utf8");
  const scalp = readFileSync(new URL("./scalp-check-panel.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("./futures-workspace.tsx", import.meta.url), "utf8");

  /* Beside the spread, inside the book's middle row, and only in Pro. */
  assert.match(book, /\{pro && rates \? <ScalpCheckPanel book=\{book\} stale=\{stale\}[^>]*\/> : null\}/);
  assert.match(book, /w\("book\.spread"[\s\S]{0,400}?<ScalpCheckPanel/, "the panel follows the spread it belongs to");
  assert.match(page, /pro=\{settings\.mode === "pro"\} rates=\{scalpRates\}/);
  /* Phoenix's two rates from its catalogue, Ryntra's from the gate — never a rate assumed on the page. */
  assert.match(page, /takerRate: market\?\.takerRate \?\? null, makerRate: market\?\.makerRate \?\? null, builderBps: orderStates\.builder \? \(orderStates\.builderBps \?\? null\) : 0/);
  /* The numbers are a walk of the book, through the one walk the ticket and the Review also use. */
  assert.match(scalp, /scalpCheck\(\{ side, sizeUnits: scalpUnits\(dollars\(text\), reference \?\? null\) \?\? 0, book, rates, stale \}\)/);
  const model = readFileSync(new URL("./scalp-check.ts", import.meta.url), "utf8");
  assert.match(model, /import \{[^}]*bookFill[^}]*\} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/phoenix\/orders-model\.ts"/);
  assert.doesNotMatch(model, /0\.0005|ASSUMED|assumedImpact/, "no impact assumed in place of the book");

  /* The chain the panel shows, in the order the specification names it. */
  const order = ["scalp.size", "scalp.spread", "scalp.feePhoenix", "scalp.feeRyntra", "scalp.slipIn", "scalp.slipOut", "scalp.breakEven"];
  let at = -1;
  for (const key of order) {
    const next = scalp.indexOf(key);
    assert.ok(next > at, `${key} stands after what comes before it`);
    at = next;
  }
  /* A book that cannot carry the size says so with what it can carry, rather than rounding the order down. */
  assert.equal(perpsWordOf("uk", "scalp.thin"), "Для такого ордера книга недостатньо глибока");
  assert.match(scalp, /check\.kind === "thin"/);
  assert.match(scalp, /depthLine\(check\.depth\.entryUnits, check\.depth\.entryNotionalUsd\)/);
  assert.match(scalp, /depthLine\(check\.depth\.exitUnits, check\.depth\.exitNotionalUsd\)/);
  /* Old figures are said, not quietly used as fresh. */
  assert.match(scalp, /\{stale \? <p className=\{styles\.scalpStale\} role="status">\{w\("scalp\.stale"\)\}<\/p> : null\}/);
});

test("PERP-7 — the words of the scale and the check promise nothing: no «безпечно», no «заробиш»", () => {
  /* The guard of the forbidden words, over every word either feature prints. */
  const promises = /безпечн|\bsafe\b|гарант|guarantee|заробиш|заробите|заробля|ви заробите|you(?:'ll| will) (?:earn|make)|profitable trade|вигідн/i;
  for (const locale of ["uk", "en"]) {
    for (const [key, value] of Object.entries(FUTURES_WORDS[locale])) {
      if (key.startsWith("guard.")) assert.doesNotMatch(value, promises, `${locale} ${key}`);
    }
    for (const [key, value] of Object.entries(PERPS_WORDS[locale])) {
      if (key.startsWith("scalp.")) assert.doesNotMatch(value, promises, `${locale} ${key}`);
    }
  }
  /* What the check does say it is: an estimate of cost on this second's book. */
  assert.match(perpsWordOf("uk", "scalp.note"), /оцінка, а не обіцянка/);
  assert.match(perpsWordOf("en", "scalp.note"), /an estimate, not a promise/);
});

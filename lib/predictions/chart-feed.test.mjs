// Run from repo root: node --test lib/predictions/chart-feed.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { POLL_MS, predictionChartFeed } from "../../app/app/predictions/[eventId]/chart-source.ts";
import { AGG_DELAY_MS, aggPage, aggStatus, barsFromAgg, complementOf, complementPage, isHistoryPage, keyOfResolution, NO_BASIS, outcomePair, percentOf, resolutionOfKey, YES_BASIS } from "./chart-feed.ts";
import { telemetryLine } from "./chart-telemetry.ts";
import { forgetGatewayInstruments, gatewayHistory, gatewayOutcome, readGatewayEnv } from "./gateway.ts";

/** The gateway's own answers over its record of AGG's trades (24.10.2026 09:44 UTC): `/v1/instruments` and a 1 m page of «yes». */
const GATEWAY = JSON.parse(readFileSync(new URL("./fixtures/gateway-agg-2026-10-24.json", import.meta.url), "utf8"));
const YES = GATEWAY.source.outcome;
const NOW = Date.parse("2026-10-24T12:00:00.000Z");

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("resolutions as the chart, the gateway and the aggregator write them", () => {
  assert.deepEqual(resolutionOfKey("1m"), { kind: "time", unit: "minute", span: 1 });
  assert.deepEqual(resolutionOfKey("5s"), { kind: "time", unit: "second", span: 5 });
  assert.deepEqual(resolutionOfKey("1M"), { kind: "time", unit: "month", span: 1 });
  assert.equal(resolutionOfKey("tick:100"), null);
  for (const key of ["1s", "1m", "5m", "1h", "1d", "1w", "1M"]) assert.equal(keyOfResolution(resolutionOfKey(key)), key);
  assert.equal(keyOfResolution({ kind: "tick", trades: 10 }), null);
});

test("the aggregator's bars on the probability scale: a percent of the payout, one bar per open, oldest first", () => {
  assert.equal(percentOf(0.535), "53.50");
  assert.equal(percentOf(1.2), "100.00", "never past the payout");
  assert.equal(percentOf(-0.1), "0.00");
  const bars = barsFromAgg([
    { t: 2000, o: 0.5, h: 0.52, l: 0.49, c: 0.51, v: 10 },
    { t: 1000, o: 0.4, h: 0.45, l: 0.39, c: 0.5, v: null },
    { t: 2000, o: 0.5, h: 0.6, l: 0.48, c: 0.55, v: 12 },
    { t: 3000, o: Number.NaN, h: 0.6, l: 0.48, c: 0.55, v: 12 },
  ]);
  assert.deepEqual(
    bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]),
    [
      [1000, "40.00", "50.00", "39.00", "50.00", null],
      [2000, "50.00", "60.00", "48.00", "55.00", "12"],
    ],
    "a repeated open keeps the later bar; a high under the close is the close; a broken bar is dropped, never drawn",
  );
});

test("a page of the aggregator's bars names its source and its delay, and an empty one is a gap — no bar made up", () => {
  // The newest hourly bar opened 50 min before the aggregator's read: the current bar, as fresh as the read.
  const chart = { outcomeId: "o", venue: "polymarket", resolution: "1h", bars: [{ t: NOW - 3_000_000, o: 0.6, h: 0.62, l: 0.6, c: 0.62, v: 5 }], staleSeconds: 3000 - 10, lastBarAt: NOW - 3_000_000 };
  const page = aggPage(chart, { load: "init", from: NOW - 10 * 3_600_000, to: NOW, limit: 300 }, NOW);
  assert.ok(isHistoryPage(page));
  assert.equal(page.status.source.label, "AGG · Polymarket");
  assert.equal(page.status.state, "delayed");
  assert.equal(page.status.delay_ms, AGG_DELAY_MS);
  assert.equal(page.status.at, NOW - 10_000, "aged from the aggregator's read, not from the bar's open");
  assert.equal(page.status.age_ms, 10_000);
  assert.equal(page.display_step, "0.1");
  assert.deepEqual(page.gaps, []);
  assert.equal(page.bars[0].c, "62.00");

  const empty = aggPage({ ...chart, bars: [], lastBarAt: null, staleSeconds: null }, { load: "init", from: NOW - 1000, to: NOW, limit: 300 }, NOW);
  assert.deepEqual(empty.bars, []);
  assert.deepEqual(empty.gaps, [{ from: NOW - 1000, to: NOW, reason: "no_data" }]);
  assert.equal(empty.more.forward, false, "an empty page never says there is more");

  const stopped = aggStatus({ venue: "polymarket", resolution: "1h", staleSeconds: 4 * 3600, lastBarAt: NOW - 4 * 3_600_000 }, null, NOW);
  assert.equal(stopped.state, "stale", "a market whose newest hourly bar opened four hours ago is not said to be fresh");
  assert.equal(stopped.age_ms, 3 * 3_600_000, "aged from the end of its last bar");
  const day = aggStatus({ venue: "polymarket", resolution: "1d", staleSeconds: 20 * 3600, lastBarAt: NOW - 20 * 3_600_000 }, null, NOW);
  assert.equal(day.state, "delayed", "a day bar that opened this morning is today's bar");
  const minute = aggStatus({ venue: "polymarket", resolution: "1m", staleSeconds: 30 * 60, lastBarAt: NOW - 30 * 60_000 }, null, NOW);
  assert.equal(minute.state, "stale", "no minute bar for half an hour: stale");

  // Older pages while the aggregator filled the page asked for; none past a short one.
  const full = { ...chart, bars: Array.from({ length: 120 }, (_, i) => ({ t: NOW - (120 - i) * 3_600_000, o: 0.5, h: 0.5, l: 0.5, c: 0.5, v: 1 })) };
  assert.equal(aggPage(full, { load: "init", from: 0, to: NOW, limit: 120 }, NOW).more.forward, true);
  assert.equal(aggPage(full, { load: "init", from: 0, to: NOW, limit: 300 }, NOW).more.forward, false);
});

test("«no» is 100 − «yes» on the gateway's own page: high and low swap, the numbers are ours", () => {
  const yes = GATEWAY.history;
  assert.ok(isHistoryPage(yes), "the gateway's page is the contract's");
  assert.ok(yes.bars.length > 0);
  const no = complementPage(yes);
  for (let k = 0; k < yes.bars.length; k += 1) {
    const [y, n] = [yes.bars[k], no.bars[k]];
    assert.equal(Number(y.c) + Number(n.c), 100);
    assert.equal(Number(y.o) + Number(n.o), 100);
    assert.equal(Number(y.h) + Number(n.l), 100, "the high of «yes» is the low of «no»");
    assert.equal(Number(y.l) + Number(n.h), 100);
    assert.equal(n.v, y.v);
    assert.equal(n.turnover, null, "the «yes» side's money is not the «no» side's");
  }
  assert.equal(no.status.derived, true);
  assert.equal(complementOf("23.45"), "76.55");
  assert.equal(complementOf("0"), "100.00");
});

test("what the gateway sends is read, not trusted", () => {
  assert.equal(isHistoryPage(null), false);
  assert.equal(isHistoryPage({ bars: [{ t: 1, o: 1, h: 1, l: 1, c: 1 }], more: { forward: false, backward: false }, gaps: [], display_step: "0.01", status: { state: "live", source: { label: "x" } } }), false, "numbers as floats are no contract");
  assert.equal(isHistoryPage({ ...GATEWAY.history, status: null }), false);
});

test("«yes» and «no» of a market: the outcome named yes and the other; more outcomes chart the chosen one alone", () => {
  const pair = outcomePair([{ id: "n", label: "No" }, { id: "y", label: "Yes" }], "n");
  assert.equal(pair.yes.id, "y");
  assert.equal(pair.no.id, "n");
  const teams = outcomePair([{ id: "a", label: "Knicks" }, { id: "b", label: "76ers" }], "b");
  assert.equal(teams.yes.id, "a");
  assert.equal(teams.no.id, "b");
  const three = outcomePair([{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }], "c");
  assert.equal(three.yes.id, "c");
  assert.equal(three.no, null);
  assert.equal(outcomePair([], "x"), null);
});

test("the gateway: read only where the deployment names it, its market list kept a minute, an unknown market said as such", async () => {
  assert.equal(readGatewayEnv({}), null);
  assert.equal(readGatewayEnv({ MD_GATEWAY_URL: "ftp://x" }), null);
  assert.equal(readGatewayEnv({ MD_GATEWAY_URL: "not a url" }), null);
  const env = readGatewayEnv({ MD_GATEWAY_URL: "http://127.0.0.1:3911/" });
  assert.deepEqual(env, { baseUrl: "http://127.0.0.1:3911" });

  forgetGatewayInstruments();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/v1/instruments")) return json(200, GATEWAY.instruments);
    const q = new URL(url).searchParams;
    if (q.get("instrument") === `agg:${YES}`) return json(200, GATEWAY.history);
    if (q.get("instrument") === "agg:broken") return json(200, { bars: "no" });
    if (q.get("instrument") === "agg:down") return json(503, { error: "x" });
    return json(404, { error: "not_found" });
  };
  const known = await gatewayOutcome(env, YES, fetchImpl, NOW);
  assert.equal(known.instrument, `agg:${YES}`);
  assert.equal(known.defaultResolution, "1m");
  assert.ok(known.resolutions.includes("1s") && known.resolutions.includes("1d"));
  assert.ok(known.volume.uk.length > 0);
  assert.equal(await gatewayOutcome(env, "someone-else", fetchImpl, NOW + 1000), null);
  assert.equal(calls.filter((u) => u.endsWith("/v1/instruments")).length, 1, "the list is read once a minute");
  await gatewayOutcome(env, YES, fetchImpl, NOW + 61_000);
  assert.equal(calls.filter((u) => u.endsWith("/v1/instruments")).length, 2);
  assert.equal(await gatewayOutcome(null, YES, fetchImpl, NOW), null, "no gateway, no read");

  const page = await gatewayHistory(env, YES, { resolution: "1m", load: "init", timestamp: null, limit: 300 }, fetchImpl);
  assert.equal(page.kind, "page");
  assert.equal(page.page.status.source.label, "AGG");
  assert.match(calls.at(-1), /instrument=agg%3A.*resolution=1m&load=init&limit=300$/);
  await gatewayHistory(env, YES, { resolution: "1m", load: "forward", timestamp: 1792835040000, limit: 300 }, fetchImpl);
  assert.match(calls.at(-1), /timestamp=1792835040000/);
  assert.deepEqual(await gatewayHistory(env, "unknown", { resolution: "1m", load: "init", timestamp: null, limit: 10 }, fetchImpl), { kind: "unknown" });
  assert.equal(await gatewayHistory(env, "broken", { resolution: "1m", load: "init", timestamp: null, limit: 10 }, fetchImpl), null);
  assert.equal(await gatewayHistory(env, "down", { resolution: "1m", load: "init", timestamp: null, limit: 10 }, fetchImpl), null);
  assert.equal(await gatewayHistory(env, YES, { resolution: "1m", load: "init", timestamp: null, limit: 10 }, async () => { throw new Error("timeout"); }), null);

  forgetGatewayInstruments();
  assert.equal(await gatewayOutcome(env, YES, async () => { throw new Error("down"); }, NOW), null);
  assert.equal(await gatewayOutcome(env, YES, fetchImpl, NOW + 10), null, "a gateway that failed is not asked on every page");
  assert.ok(await gatewayOutcome(env, YES, fetchImpl, NOW + 31_000), "and is asked again after half a minute");
});

test("the browser's chart source: the instrument on the probability scale, one source per view, «no» from «yes», a poll never live", async (t) => {
  const asked = [];
  const original = globalThis.fetch;
  const originalSet = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  t.after(() => {
    globalThis.fetch = original;
    globalThis.setInterval = originalSet;
    globalThis.clearInterval = originalClear;
  });
  let pages = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const q = new URL(String(url), "http://x").searchParams;
    if (q.get("part") === "instrument") return json(200, { via: "gateway", resolutions: ["1s", "5s", "1m", "1h"], opening: "1m", volume: null });
    return json(200, { via: "gateway", page: pages.shift() ?? GATEWAY.history });
  };
  const now = () => GATEWAY.history.status.gateway_at + 1000;
  const { source, opening } = predictionChartFeed({ yesId: YES, symbol: GATEWAY.source.question, venue: "polymarket", withNo: true, market: "open" }, now);
  const instrument = await source.instrument(YES);
  assert.equal(instrument.scale, "probability");
  assert.equal(instrument.kind, "prediction");
  assert.deepEqual(instrument.outcomes, ["yes", "no"]);
  assert.deepEqual(instrument.bases, [YES_BASIS, NO_BASIS]);
  assert.deepEqual(instrument.resolutions.map(keyOfResolution), ["1m", "1h"], "no bar shorter than the poll that would miss it");
  assert.deepEqual(await opening(), { kind: "time", unit: "minute", span: 1 });
  await assert.rejects(source.instrument("other"));

  const m1 = { kind: "time", unit: "minute", span: 1 };
  const yes = await source.history({ instrument: YES, resolution: m1, basis: YES_BASIS, load: "init", timestamp: null, limit: 300 });
  assert.deepEqual(yes.bars, GATEWAY.history.bars);
  assert.equal(yes.status.state, "delayed", "the gateway's live numbers reach this page by a poll: delayed");
  assert.equal(yes.status.delay_ms, POLL_MS);
  assert.equal(yes.status.market, "open");
  assert.match(asked.at(-1), /part=history&via=gateway&resolution=1m&load=init&limit=300/, "the view keeps the source it opened on");
  const no = await source.history({ instrument: YES, resolution: m1, basis: NO_BASIS, load: "init", timestamp: null, limit: 300 });
  assert.equal(Number(no.bars[0].c) + Number(yes.bars[0].c), 100);
  assert.equal(no.status.derived, true);
  const newer = await source.history({ instrument: YES, resolution: m1, basis: YES_BASIS, load: "backward", timestamp: 1, limit: 300 });
  assert.deepEqual(newer.bars, []);
  assert.equal(newer.more.backward, false);

  // The poll: every POLL_MS the newest bars, from the opening page's newest; a bar seen once is not sent twice; a break
  // longer than a bar makes the chart read the bars again, never a line across it.
  let tick = null;
  globalThis.setInterval = (run, ms) => {
    assert.equal(ms, POLL_MS);
    tick = run;
    return 1;
  };
  globalThis.clearInterval = () => {
    tick = null;
  };
  const events = [];
  const [b1, b2] = GATEWAY.history.bars;
  const later = { ...b2, t: b2.t + 5 * 60_000, c: "30" };
  const changed = { ...b2, c: "24" };
  pages = [{ ...GATEWAY.history, bars: [b1, b2] }, { ...GATEWAY.history, bars: [b1, changed] }, { ...GATEWAY.history, bars: [later] }];
  const stop = source.subscribe({ instrument: YES, resolution: m1, basis: NO_BASIS }, (event) => events.push(event));
  const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
  for (let k = 0; k < 3; k += 1) {
    tick();
    await flush();
  }
  // The chart reads its view again on the correction; the poll goes on from that page's newest bar.
  pages = [{ ...GATEWAY.history, bars: [b2, later] }, { ...GATEWAY.history, bars: [later, { ...later, t: later.t + 60_000, c: "31" }] }];
  await source.history({ instrument: YES, resolution: m1, basis: NO_BASIS, load: "init", timestamp: null, limit: 300 });
  for (let k = 0; k < 1; k += 1) {
    tick();
    await flush();
  }
  assert.deepEqual(
    events.filter((e) => e.type === "bar").map((e) => [e.bar.t, e.bar.c]),
    [
      [b2.t, "76.00"],
      [later.t + 60_000, "69.00"],
    ],
    "«no» bars from the opening page on: the opening's newest bar again only once it changed",
  );
  const corrected = events.find((e) => e.type === "corrected");
  assert.deepEqual({ ...corrected.correction, at: 0 }, { instrument: YES, from: b2.t, to: later.t, reason: "backfill", at: 0 });
  assert.ok(events.every((e) => !e.status || e.status.state !== "live"), "never said to be live");
  stop();
  assert.equal(tick, null, "the poll stops with the subscription");

  // A market that no longer trades is not polled; a market of more outcomes charts «yes» alone.
  const settled = predictionChartFeed({ yesId: YES, symbol: "q", venue: "polymarket", withNo: false, market: "resolved" }, now);
  const one = await settled.source.instrument(YES);
  assert.deepEqual(one.outcomes, ["yes"]);
  assert.equal((await settled.source.history({ instrument: YES, resolution: m1, basis: YES_BASIS, load: "init", timestamp: null, limit: 10 })).status.market, "resolved");
  settled.source.subscribe({ instrument: YES, resolution: m1, basis: YES_BASIS }, () => {});
  assert.equal(tick, null);
});

test("the chart's health reaches the log with the schema's fields only", () => {
  const event = { schema: "ryntra.chart.telemetry/1", type: "alert", at: NOW, surface: "predictions-market", view: { instrument: YES, kind: "prediction", venue: "polymarket", resolution: "1m" }, rule: "age", on: true, value: 70_000, threshold: 60_000, wallet: "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY", page: "https://ryntra.io/app/predictions/x?token=secret" };
  const line = telemetryLine(JSON.stringify(event));
  assert.ok(line);
  assert.doesNotMatch(line, /HSxcfw|token|secret|https/);
  assert.deepEqual(JSON.parse(line), { type: "alert", at: NOW, surface: "predictions-market", view: { instrument: YES, kind: "prediction", venue: "polymarket", resolution: "1m" }, rule: "age", on: true, value: 70_000, threshold: 60_000 });
  assert.equal(telemetryLine(JSON.stringify({ ...event, schema: "other/1" })), null);
  assert.equal(telemetryLine(JSON.stringify({ ...event, type: "click" })), null);
  assert.equal(telemetryLine("not json"), null);
  assert.equal(telemetryLine("x".repeat(9000)), null);
  const health = JSON.parse(telemetryLine(JSON.stringify({ schema: "ryntra.chart.telemetry/1", type: "health", at: NOW, surface: "s", view: null, fps: 60, state: "delayed", market: "open", alerts: ["age", "<script>"] })));
  assert.deepEqual(health.alerts, ["age"]);
  assert.equal(health.state, "delayed");
});

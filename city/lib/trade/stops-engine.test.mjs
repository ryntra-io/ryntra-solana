import { test } from "node:test";
import assert from "node:assert/strict";

import { offeredKey, setSpotEnv, useSpot } from "./spot-store.ts";
import { createStopsApi } from "./stops-api.ts";
import { isEngineStop, makeStop, stopsKey } from "./stops.ts";
import { setTradeEnv, useTrade } from "./store.ts";
import { OWNER, scriptedLimits, stubWallet, USDC_MINT, WIF } from "./limit-fixtures.mjs";
import { memoryAttempts, QUOTE, scriptedEngine } from "./test-fixtures.mjs";

// CITY-149 — the city's stops in the engine, end to end over stubs: the engine's stop routes answer from a script, the
// wallet's proof is a stand-in, the device's storage is a map. A new stop is the engine's once the wallet proved
// itself; a stop the engine reached opens its sale once on this device — a note's own stop (`?stop=`) first; a cancel
// and a settled sale reach the engine. Nothing here touches a network or a real wallet.

const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const PHANTOM = { wallet: "Phantom", address: OWNER };
const HOLDINGS = { owner: OWNER, sol: { spendableRaw: "2400000000", decimals: 9 }, tokens: new Map([[WIF, { spendableRaw: "5000000", decimals: 6 }], [USDC_MINT, { spendableRaw: "84200000", decimals: 6 }]]), complete: true, at: NOW };
const BASE = { mint: WIF, symbol: "WIF", name: "dogwifhat", decimals: 6 };
const QUOTE_COIN = { mint: USDC_MINT, symbol: "USDC", decimals: 6 };
const INPUT = { side: "sell", base: BASE, quote: QUOTE_COIN, amountRaw: "5000000", price: "2", expiry: "7d" };

const view = (id, over = {}) => ({ id, side: "sell", base: BASE, quote: QUOTE_COIN, amountRaw: "5000000", price: "2", thresholdRaw: "10000000", createdAt: NOW, expiresAt: NOW + 7 * 86_400_000, state: "watching", reachedAt: null, ...over });

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** The engine's stop routes from a script: each route answers its next scripted reply. */
function scriptedStops(script) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(script).map(([key, list]) => [key, [...list]]));
  const api = createStopsApi(async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, headers: init.headers, credentials: init.credentials });
    const key = `${init.method} ${url.replace(/stp_[0-9a-f]{20}/, ":id")}`;
    const reply = queues[key]?.shift() ?? { status: 503, body: { error: { code: "UNAVAILABLE" } } };
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
  return { api, calls };
}

function scene(script = {}, { proof = { ok: true }, asked = null, engineStops = true, quote = [{ status: 200, body: QUOTE }] } = {}) {
  const map = new Map();
  const storage = { map, read: (key) => map.get(key) ?? null, write: (key, value) => map.set(key, value) };
  const stops = scriptedStops(script);
  const proofs = [];
  let n = 0;
  let now = NOW;
  const swap = scriptedEngine({ quote });
  const limits = scriptedLimits({});
  setSpotEnv({
    api: limits.api,
    engine: swap.engine,
    sign: (_c, wire) => stubWallet().sign(wire),
    now: () => now,
    open: true,
    storage,
    wallet: () => ({ connection: PHANTOM }),
    refreshHoldings: () => {},
    later: () => {},
    id: () => `id-${++n}`,
    stops: stops.api,
    prove: async (connection) => {
      proofs.push(connection.address);
      return proof;
    },
    engineStops,
    locale: () => "uk",
    askedStop: () => asked,
  });
  setTradeEnv({ engine: swap.engine, attempts: memoryAttempts().store, now: () => now, sleep: async () => {}, wallet: () => ({ connection: PHANTOM, holdings: HOLDINGS }), refreshHoldings: () => {} });
  useTrade.setState({ open: false, tower: null, phase: "idle", pay: "SOL", other: null, mode: "market", held: false, typed: "", review: null, done: null, notice: null });
  useSpot.getState().reset();
  useSpot.setState({ orders: null, cancelling: null, ordersNotice: null, stops: [], stopsOwner: null, expiry: "7d" });
  return { storage, stops, proofs, swap, tick: (ms) => (now += ms) };
}

test("a new stop is the engine's: the wallet proves itself, the stop is sent with the city's language, the engine's id kept", async () => {
  const { stops, proofs, storage } = scene({ "POST /api/v1/stops": [{ status: 201, body: { stop: view("stp_00000000000000000001") } }] });
  await useSpot.getState().setStop(INPUT, "12000000");
  assert.deepEqual(proofs, [OWNER]);
  assert.equal(stops.calls.length, 1);
  assert.equal(stops.calls[0].credentials, "include");
  assert.equal(stops.calls[0].headers["X-Ryntra-API"], "1");
  assert.deepEqual(stops.calls[0].body, { side: "sell", base: BASE, quote: QUOTE_COIN, amountRaw: "5000000", price: "2", expiry: "7d", locale: "uk" });
  const state = useSpot.getState();
  assert.equal(state.phase, "set");
  assert.equal(state.placed.stop.id, "stp_00000000000000000001");
  assert.equal(isEngineStop(state.placed.stop), true);
  assert.equal(JSON.parse(storage.map.get(stopsKey(OWNER)))[0].id, "stp_00000000000000000001", "the device keeps a copy for «My orders»");
});

test("a stop the wallet would not prove, or the engine refused, is not set: the card says why in its own words", async () => {
  scene({}, { proof: { ok: false, state: "declined", message: "x" } });
  await useSpot.getState().setStop(INPUT, "12000000");
  assert.equal(useSpot.getState().phase, "idle");
  assert.match(useSpot.getState().notice.text, /Not signed|Не підписано/);

  const { storage } = scene({ "POST /api/v1/stops": [{ status: 409, body: { error: { code: "STOP_LIMIT" } } }] });
  await useSpot.getState().setStop(INPUT, "12000000");
  assert.equal(useSpot.getState().phase, "idle");
  assert.match(useSpot.getState().notice.text, /20/);
  assert.equal(storage.map.size, 0);

  scene({ "POST /api/v1/stops": [{ status: 409, body: { error: { code: "STOP_REACHED" } } }] });
  await useSpot.getState().setStop(INPUT, null);
  assert.match(useSpot.getState().notice.text, /set it lower|постав нижче/);
});

test("with the engine's switch shut the stop stays on this device, as before: no proof, no request", async () => {
  const { stops, proofs, storage } = scene({}, { engineStops: false });
  await useSpot.getState().setStop(INPUT, "12000000");
  assert.equal(useSpot.getState().phase, "set");
  assert.deepEqual([stops.calls.length, proofs.length], [0, 0]);
  assert.equal(isEngineStop(JSON.parse(storage.map.get(stopsKey(OWNER)))[0]), false);
});

test("a stop the engine reached opens its sale once on this device; the next watch offers nothing again", async () => {
  const reached = view("stp_00000000000000000002", { state: "reached", reachedAt: NOW - 60_000 });
  const { storage, tick } = scene({ "GET /api/v1/stops": [{ status: 200, body: { stops: [view("stp_00000000000000000002")] } }, { status: 200, body: { stops: [reached] } }, { status: 200, body: { stops: [reached] } }] }, { quote: [{ status: 200, body: QUOTE }, { status: 200, body: QUOTE }] });
  assert.deepEqual(await useSpot.getState().watchStops(), [], "watching: nothing to offer");
  tick(31_000);
  const first = await useSpot.getState().watchStops();
  assert.deepEqual(first.map((stop) => stop.id), ["stp_00000000000000000002"]);
  assert.deepEqual(JSON.parse(storage.map.get(offeredKey(OWNER))), ["stp_00000000000000000002"]);
  tick(31_000);
  assert.deepEqual(await useSpot.getState().watchStops(), [], "offered once");
  assert.equal(useSpot.getState().stops[0].state, "reached");
});

test("a tap on the note: the city opens with `?stop=` and that stop's sale is offered first, though this device never saw it reached", async () => {
  const other = view("stp_00000000000000000004", { state: "reached", reachedAt: NOW - 1_000 });
  scene({ "GET /api/v1/stops": [{ status: 200, body: { stops: [other, view("stp_00000000000000000003")] } }] }, { asked: "stp_00000000000000000003", quote: [{ status: 200, body: QUOTE }] });
  const offered = await useSpot.getState().watchStops();
  assert.deepEqual(offered.map((stop) => stop.id), ["stp_00000000000000000003", "stp_00000000000000000004"]);
  // The sale opens on the card at the market price for the person to read and sign.
  useSpot.getState().openSale(offered[0]);
  await flush();
  const trade = useTrade.getState();
  assert.equal(trade.open, true);
  assert.equal(trade.side, "sell");
  assert.equal(trade.mode, "market");
  assert.equal(trade.typed, "5");
});

test("a phone's tap lands on the coin without `?stop=`: the newest stop the engine reached is still offered — once", async () => {
  const reached = view("stp_00000000000000000005", { state: "reached", reachedAt: NOW - 5_000 });
  scene({ "GET /api/v1/stops": [{ status: 200, body: { stops: [reached] } }] });
  useSpot.getState().loadStops();
  await flush();
  assert.equal(useSpot.getState().stops[0].id, "stp_00000000000000000005");
  assert.deepEqual((await useSpot.getState().watchStops()).map((stop) => stop.id), ["stp_00000000000000000005"]);
  assert.deepEqual(await useSpot.getState().watchStops(), []);
});

test("an engine that does not answer, or a wallet without its proof, leaves the device's copy as it was", async () => {
  const { storage } = scene({ "GET /api/v1/stops": [{ status: 401, body: { error: { code: "UNAUTHORIZED" } } }] });
  const mine = makeStop({ ...INPUT, owner: OWNER }, NOW, null, "stp_00000000000000000006").stop;
  storage.map.set(stopsKey(OWNER), JSON.stringify([mine]));
  await useSpot.getState().readEngineStops(true);
  assert.deepEqual(JSON.parse(storage.map.get(stopsKey(OWNER))).map((stop) => stop.id), ["stp_00000000000000000006"]);
});

test("cancel reaches the engine on the wallet's word; a settled sale tells the engine the stop is done", async () => {
  const { storage, stops, proofs } = scene({
    "DELETE /api/v1/stops/:id": [{ status: 200, body: { stop: view("stp_00000000000000000007", { state: "cancelled" }) } }],
    "PATCH /api/v1/stops/:id": [{ status: 200, body: { stop: view("stp_00000000000000000008", { state: "done" }) } }],
  });
  const live = makeStop({ ...INPUT, owner: OWNER }, NOW, null, "stp_00000000000000000007").stop;
  const reached = { ...makeStop({ ...INPUT, owner: OWNER }, NOW, null, "stp_00000000000000000008").stop, state: "reached", reachedAt: NOW };
  storage.map.set(stopsKey(OWNER), JSON.stringify([live, reached]));
  useSpot.getState().loadStops();
  await useSpot.getState().cancelStop("stp_00000000000000000007");
  assert.deepEqual(proofs, [OWNER]);
  assert.equal(stops.calls.find((call) => call.method === "DELETE").url, "/api/v1/stops/stp_00000000000000000007");
  assert.deepEqual(useSpot.getState().stops.map((stop) => stop.id), ["stp_00000000000000000008"]);

  useTrade.setState({ done: { trade: { signature: "s", inputMint: WIF, outputMint: USDC_MINT, inputRaw: "5000000", outputRaw: "9000000" }, side: "sell", tower: null, pay: QUOTE_COIN, decimals: {} } });
  await flush();
  const patch = stops.calls.find((call) => call.method === "PATCH");
  assert.equal(patch.url, "/api/v1/stops/stp_00000000000000000008");
  assert.deepEqual(patch.body, { state: "done" });
  assert.equal(useSpot.getState().stops[0].state, "done");
});

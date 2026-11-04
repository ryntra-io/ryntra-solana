import assert from "node:assert/strict";
import test from "node:test";

import { MIN_WALLET_WINDOW_MS } from "../../../lib/solana/blockhash-life.ts";
import { runLaunch } from "./flow.ts";
import { BACKGROUND_STORES, FIELDS_REFUSED, PREBUILT_SLACK_MS, createPrep, fieldsKey, freshPrebuilt, launchRequest } from "./prepare.ts";
import { STUB_CREATOR, STUB_PRESETS, STUB_WALLET, stubEngine, stubWallet } from "./stub.ts";

/* CITY-143: the launch sheet stores the picture while the creator types and has the engine simulate the launch before
   the press — the same routes, earlier — and the flow takes what was made ahead only while it is this very launch. */

const PROTECTED = STUB_PRESETS.find((preset) => preset.id === "protected");
const CLASSIC = STUB_PRESETS.find((preset) => preset.id === "classic");
const BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PICTURE = { base64: BASE64, url: `data:image/png;base64,${BASE64}` };
const FIELDS = { name: "Kite", symbol: "KITE", picture: PICTURE };
const signer = () => stubWallet().signer({ wallet: STUB_WALLET, address: STUB_CREATOR });

function setup(options = {}) {
  let clock = options.now ?? 1_000_000;
  const engine = options.engine ?? stubEngine();
  const changes = [];
  const prep = createPrep({ engine: () => engine, now: () => clock, onChange: (state) => changes.push(state) });
  return { engine, prep, changes, tick: (ms) => (clock += ms), now: () => clock };
}

const simulate = (prep, extra = {}) => prep.simulate({ fields: FIELDS, creator: STUB_CREATOR, preset: PROTECTED, network: "solana:devnet", switchOpen: true, ...extra });

test("the same name, ticker and picture are one key; a byte of another picture is another", () => {
  assert.equal(fieldsKey(FIELDS), fieldsKey({ ...FIELDS }));
  assert.notEqual(fieldsKey(FIELDS), fieldsKey({ ...FIELDS, name: "Kites" }));
  assert.notEqual(fieldsKey(FIELDS), fieldsKey({ ...FIELDS, symbol: "KITES" }));
  assert.notEqual(fieldsKey(FIELDS), fieldsKey({ ...FIELDS, picture: { base64: `${BASE64.slice(0, -3)}A==` } }));
});

test("the fields go to the store once; the answer is the sheet's to read", async () => {
  const { engine, prep, changes } = setup();
  const first = prep.store(FIELDS, { background: true });
  const again = prep.store(FIELDS);
  assert.equal(first, again);
  const answer = await first;
  assert.equal(answer.ok, true);
  assert.deepEqual(engine.calls, ["metadata"]);
  const last = changes.at(-1);
  assert.equal(last.stored.key, fieldsKey(FIELDS));
  assert.equal(last.stored.answer.ok, true);
});

test("the background is bounded; a press always stores", async () => {
  const { engine, prep } = setup();
  for (let i = 0; i < BACKGROUND_STORES; i += 1) assert.ok(prep.store({ ...FIELDS, name: `Kite${i}` }, { background: true }));
  assert.equal(prep.store({ ...FIELDS, name: "Late" }, { background: true }), null);
  assert.ok(prep.store({ ...FIELDS, name: "Late" }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(engine.calls.filter((call) => call === "metadata").length, BACKGROUND_STORES + 1);
});

test("a refusal of the picture stands for those fields; a busy store is asked again at the press, never in the background", async () => {
  const refused = setup({ engine: stubEngine({ refuse: { metadata: { ok: false, code: "LAUNCH_IMAGE_REFUSED", message: "The picture reads as violence/graphic; choose another." } } }) });
  const first = await refused.prep.store(FIELDS, { background: true });
  assert.equal(first.code, "LAUNCH_IMAGE_REFUSED");
  assert.ok(FIELDS_REFUSED.has(first.code));
  assert.equal(await refused.prep.store(FIELDS), first);
  assert.deepEqual(refused.engine.calls, ["metadata"]);

  const busy = setup({ engine: stubEngine({ refuse: { metadata: { ok: false, code: "RATE_LIMITED", message: "" } } }) });
  assert.equal((await busy.prep.store(FIELDS, { background: true })).code, "RATE_LIMITED");
  assert.equal((await busy.prep.store(FIELDS, { background: true })).code, "RATE_LIMITED");
  assert.deepEqual(busy.engine.calls, ["metadata"]);
  assert.equal((await busy.prep.store(FIELDS)).ok, true);
  assert.deepEqual(busy.engine.calls, ["metadata", "metadata"]);
});

test("with the fields stored and a wallet there, the engine simulates the launch once and the cost line has its figure", async () => {
  const { engine, prep, changes } = setup();
  await simulate(prep);
  assert.deepEqual(engine.calls, [], "nothing is built before the fields are stored");
  await prep.store(FIELDS);
  await simulate(prep);
  await simulate(prep);
  assert.deepEqual(engine.calls, ["metadata", "build"]);
  assert.equal(changes.at(-1).costLamports, "9874320");
  /* Another preset is another launch: one more build, the cost kept. */
  await simulate(prep, { preset: CLASSIC });
  assert.deepEqual(engine.calls, ["metadata", "build", "build"]);
});

test("nothing is built ahead where the city may not launch: mainnet before Launch opens there, or the switch shut", async () => {
  const { engine, prep } = setup();
  await prep.store(FIELDS);
  await simulate(prep, { network: "solana:mainnet", ownerWord: false });
  await simulate(prep, { switchOpen: false });
  assert.deepEqual(engine.calls, ["metadata"]);
});

test("a build that is more than the launch, or for another network, is never kept", async () => {
  const stub = stubEngine();
  const engine = { ...stub, build: async (body) => {
    const built = await stub.build(body);
    return built.ok ? { ok: true, data: { ...built.data, lockUnsignedWireBase64: "AAAA" } } : built;
  } };
  const { prep, changes } = setup({ engine });
  await prep.store(FIELDS);
  await simulate(prep);
  assert.equal(changes.at(-1).costLamports, null);
  assert.equal(prep.take(launchRequest(STUB_CREATOR, "protected", (await prep.store(FIELDS)).data.metadataUri), "solana:devnet"), null);
});

test("a prebuilt is handed over once, for exactly its launch, and only while a wallet may still open on it", async () => {
  const { prep, tick, now } = setup();
  const stored = await prep.store(FIELDS);
  await simulate(prep);
  const request = launchRequest(STUB_CREATOR, "protected", stored.data.metadataUri);
  assert.equal(prep.take(launchRequest(STUB_CREATOR, "classic", stored.data.metadataUri), "solana:devnet"), null);
  assert.equal(prep.take(request, "solana:mainnet"), null);
  const handed = prep.take(request, "solana:devnet");
  assert.ok(handed);
  assert.equal(prep.take(request, "solana:devnet"), null, "once");

  /* The stand's bytes may be signed for 25 s: with 8 s gone, 17 s are the window; past the least, none. */
  tick(8_000);
  assert.equal(freshPrebuilt(handed, request, "solana:devnet", now()).signableMs, 17_000);
  const edge = 25_000 - MIN_WALLET_WINDOW_MS - PREBUILT_SLACK_MS;
  assert.ok(freshPrebuilt(handed, request, "solana:devnet", handed.receivedAt + edge));
  assert.equal(freshPrebuilt(handed, request, "solana:devnet", handed.receivedAt + edge + 1), null);
  assert.equal(freshPrebuilt(handed, { ...request, firstBuyRaw: "1" }, "solana:devnet", handed.receivedAt), null);
  assert.equal(freshPrebuilt(null, request, "solana:devnet", now()), null);
});

test("the press takes the stored fields and the fresh prebuilt: the wallet opens at once, one build in all", async () => {
  const { engine, prep, now } = setup();
  await prep.store(FIELDS);
  await simulate(prep);
  const phases = [];
  const result = await runLaunch({ engine, signer: signer(), fields: FIELDS, preset: PROTECTED, network: "solana:devnet", onPhase: (phase) => phases.push(phase.step), switchOpen: true, now, stored: prep.store(FIELDS), takePrebuilt: prep.take });
  assert.equal(result.step, "done");
  assert.deepEqual(engine.calls, ["metadata", "build", "submit"]);
  assert.deepEqual(phases, ["upload", "sign", "send", "done"]);
});

test("a prebuilt whose window has passed is let go: the press builds fresh bytes", async () => {
  const { engine, prep, tick, now } = setup();
  await prep.store(FIELDS);
  await simulate(prep);
  tick(20_000);
  const phases = [];
  const result = await runLaunch({ engine, signer: signer(), fields: FIELDS, preset: PROTECTED, network: "solana:devnet", onPhase: (phase) => phases.push(phase.step), switchOpen: true, now, stored: prep.store(FIELDS), takePrebuilt: prep.take });
  assert.equal(result.step, "done");
  assert.deepEqual(engine.calls, ["metadata", "build", "build", "submit"]);
  assert.deepEqual(phases, ["upload", "build", "sign", "send", "done"]);
});

test("the press stores again when the sheet's store was busy, and stops on a refusal of the fields", async () => {
  const busy = stubEngine({ refuse: { metadata: { ok: false, code: "LAUNCH_BUSY", message: "" } } });
  const first = await busy.metadata({ name: "Kite", symbol: "KITE", description: "", website: "", x: "", telegram: "", imageBase64: BASE64 });
  const done = await runLaunch({ engine: busy, signer: signer(), fields: FIELDS, preset: PROTECTED, network: "solana:devnet", onPhase: () => {}, switchOpen: true, stored: Promise.resolve(first) });
  assert.equal(done.step, "done");
  assert.deepEqual(busy.calls, ["metadata", "metadata", "build", "submit"]);

  const engine = stubEngine();
  const refused = { ok: false, code: "LAUNCH_IMAGE_REFUSED", message: "The picture reads as sexual; choose another." };
  const stopped = await runLaunch({ engine, signer: signer(), fields: FIELDS, preset: PROTECTED, network: "solana:devnet", onPhase: () => {}, switchOpen: true, stored: Promise.resolve(refused) });
  assert.equal(stopped.step, "failed");
  assert.equal(stopped.failure.code, "LAUNCH_IMAGE_REFUSED");
  assert.deepEqual(engine.calls, []);
});

test("a stored answer for other words is not this launch's", async () => {
  const engine = stubEngine();
  const other = await engine.metadata({ name: "Moth", symbol: "MOTH", description: "", website: "", x: "", telegram: "", imageBase64: BASE64 });
  const phases = [];
  const result = await runLaunch({ engine, signer: signer(), fields: FIELDS, preset: PROTECTED, network: "solana:devnet", onPhase: (phase) => phases.push(phase), switchOpen: true, stored: Promise.resolve(other) });
  assert.equal(result.step, "done");
  assert.equal(result.liftoff.symbol, "KITE");
  assert.deepEqual(engine.calls, ["metadata", "metadata", "build", "submit"]);
});

test("after a launch nothing is kept for the next but the cost", async () => {
  const { prep } = setup();
  await prep.store(FIELDS);
  await simulate(prep);
  prep.reset();
  assert.deepEqual(prep.state(), { stored: null, costLamports: "9874320" });
});

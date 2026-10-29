import assert from "node:assert/strict";
import test from "node:test";

import { LaunchBuildRequestSchema, LaunchMetadataRequestSchema, LaunchSubmitRequestSchema } from "../../../lib/api/v1/contract.ts";
import { API_HEADERS, httpEngine } from "./engine.ts";
import { BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED, failureWords, runLaunch } from "./flow.ts";
import { STUB_CREATOR, STUB_PRESETS, STUB_WALLET, stubEngine, stubWallet } from "./stub.ts";

const PROTECTED = STUB_PRESETS.find((preset) => preset.id === "protected");
const BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FIELDS = { name: "Kite", symbol: "KITE", picture: { base64: BASE64, url: `data:image/png;base64,${BASE64}` } };
const signer = (options) => stubWallet(options).signer({ wallet: STUB_WALLET, address: STUB_CREATOR });

/** Runs one launch and keeps every step it showed. */
async function launch(overrides = {}) {
  const phases = [];
  const engine = overrides.engine ?? stubEngine();
  const result = await runLaunch({ engine, signer: signer(), fields: FIELDS, preset: PROTECTED, network: "solana:devnet", onPhase: (phase) => phases.push(phase), switchOpen: true, ...overrides });
  return { result, phases, steps: phases.map((phase) => phase.step), engine };
}

test("a launch goes picture and words → build → one signature → send, and the coin lifts off", async () => {
  const { result, steps, engine } = await launch();
  assert.deepEqual(steps, ["upload", "build", "sign", "send", "done"]);
  assert.deepEqual(engine.calls, ["metadata", "build", "submit"]);
  assert.equal(result.step, "done");
  assert.equal(result.liftoff.symbol, "KITE");
  assert.equal(result.liftoff.name, "Kite");
  assert.equal(result.liftoff.state, "LAUNCHED");
  assert.equal(result.liftoff.network, "solana:devnet");
  assert.equal(result.liftoff.creator, STUB_CREATOR);
  assert.match(result.liftoff.token, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});

test("the wallet is shown the engine's simulated cost before it signs", async () => {
  const { phases } = await launch();
  const sign = phases.find((phase) => phase.step === "sign");
  assert.equal(sign.wallet, STUB_WALLET);
  assert.equal(sign.costLamports, "9874320");
  assert.equal(sign.again, false);
});

test("over HTTP the city speaks the v1 contract: the routes, the headers, the bodies the engine validates", async () => {
  const stub = stubEngine();
  const seen = [];
  const fetcher = async (path, init) => {
    seen.push({ path, method: init?.method ?? "GET" });
    assert.equal(init.headers["X-Ryntra-API"], "1");
    assert.equal(init.headers["X-Ryntra-API-Version"], API_HEADERS["X-Ryntra-API-Version"]);
    const body = init.body ? JSON.parse(init.body) : null;
    const answer =
      path === "/api/v1/launch/metadata"
        ? await stub.metadata(LaunchMetadataRequestSchema.parse(body))
        : path === "/api/v1/launch/build"
          ? await stub.build(LaunchBuildRequestSchema.parse(body))
          : path === "/api/v1/launch/submit"
            ? await stub.submit(LaunchSubmitRequestSchema.parse(body))
            : { ok: false, code: "LAUNCH_NOT_FOUND", message: "" };
    return answer.ok ? Response.json(answer.data) : Response.json({ error: { code: answer.code, message: answer.message } }, { status: 400 });
  };
  const { result } = await launch({ engine: httpEngine(fetcher) });
  assert.equal(result.step, "done");
  assert.deepEqual(seen, [
    { path: "/api/v1/launch/metadata", method: "POST" },
    { path: "/api/v1/launch/build", method: "POST" },
    { path: "/api/v1/launch/submit", method: "POST" },
  ]);
});

test("the build asks for the launch alone: no first purchase, no lock, the city's preset", async () => {
  const stub = stubEngine();
  const asked = [];
  const engine = { ...stub, build: (body) => (asked.push(body), stub.build(body)) };
  await launch({ engine });
  assert.equal(asked.length, 1);
  LaunchBuildRequestSchema.parse(asked[0]);
  assert.equal(asked[0].firstBuyRaw, "0");
  assert.equal(asked[0].lock, null);
  assert.equal(asked[0].preset, "protected");
  assert.equal(asked[0].creator, STUB_CREATOR);
  assert.equal("partner" in asked[0], false, "no partner the review did not show is bound");
});

test("on mainnet the city launches nothing, and asks the engine nothing", async () => {
  const { result, engine } = await launch({ network: "solana:mainnet" });
  assert.equal(result.step, "failed");
  assert.equal(result.failure.code, CITY_CLOSED);
  assert.deepEqual(engine.calls, []);
  const opened = await launch({ network: "solana:mainnet", ownerWord: true });
  assert.equal(opened.engine.calls[0], "metadata");
});

test("without the deployment's switch open, the city launches nothing on any network and asks the engine nothing", async () => {
  for (const network of ["solana:devnet", "solana:mainnet"]) {
    const { result, engine } = await launch({ network, ownerWord: true, switchOpen: false });
    assert.equal(result.step, "failed");
    assert.equal(result.failure.code, CITY_CLOSED);
    assert.deepEqual(engine.calls, [], network);
  }
});

test("a wallet that does not sign stops the launch before anything is sent", async () => {
  const engine = stubEngine();
  const phases = [];
  const result = await runLaunch({ engine, signer: signer({ refuse: true }), fields: FIELDS, preset: PROTECTED, network: "solana:devnet", onPhase: (phase) => phases.push(phase), switchOpen: true });
  assert.equal(result.step, "failed");
  assert.equal(result.failure.code, WALLET_REFUSED);
  assert.equal(result.failure.stage, "before");
  assert.deepEqual(engine.calls, ["metadata", "build"]);
  assert.equal(failureWords(result.failure, STUB_WALLET), `${STUB_WALLET} did not sign. Nothing was sent.`);
});

test("the engine's refusals come back in its own codes, with the city's words", async () => {
  for (const [route, code, words] of [
    ["metadata", "LAUNCH_IMAGE_REFUSED", /picture can’t be used/],
    ["build", "LAUNCH_PAUSED", /paused/],
    ["build", "LAUNCH_LIMIT", /as many coins today/],
    ["build", "LAUNCH_BUSY", /this hour/],
  ]) {
    const { result, engine } = await launch({ engine: stubEngine({ refuse: { [route]: { ok: false, code, message: "" } } }) });
    assert.equal(result.step, "failed", code);
    assert.equal(result.failure.code, code);
    assert.equal(result.failure.stage, "before");
    assert.ok(!engine.calls.includes("submit"), `${code}: nothing sent`);
    assert.match(failureWords(result.failure), words);
  }
});

test("a borrowed name is refused by the engine's own rule", async () => {
  const { result } = await launch({ fields: { ...FIELDS, name: "Tesla Coin", symbol: "TSLA" } });
  assert.equal(result.failure.code, "LAUNCH_NAME_BORROWED");
  assert.match(failureWords(result.failure), /Tesla/);
});

test("a signature that comes back after the bytes aged is never sent: the engine builds again, the wallet is asked once more", async () => {
  let clock = 1_000_000;
  let signs = 0;
  const engine = stubEngine({ now: () => clock });
  const slow = {
    wallet: STUB_WALLET,
    address: STUB_CREATOR,
    sign: async (wires) => {
      signs += 1;
      /* The first time the person takes longer than the bytes live. */
      if (signs === 1) clock += 40_000;
      return { ok: true, signed: wires };
    },
  };
  const phases = [];
  const result = await runLaunch({ engine, signer: slow, fields: FIELDS, preset: PROTECTED, network: "solana:devnet", onPhase: (phase) => phases.push(phase), now: () => clock, switchOpen: true });
  assert.equal(result.step, "done");
  assert.equal(signs, 2);
  assert.deepEqual(engine.calls, ["metadata", "build", "build", "submit"]);
  assert.deepEqual(
    phases.filter((phase) => phase.step === "sign").map((phase) => phase.again),
    [false, true],
  );
});

test("bytes for another network, or with more than the launch in them, never reach the wallet", async () => {
  for (const change of [{ network: "solana:mainnet" }, { lockUnsignedWireBase64: "AAAA" }, { splitUnsignedWireBase64: "AAAA" }]) {
    const stub = stubEngine();
    const engine = { ...stub, build: async (body) => {
      const built = await stub.build(body);
      return built.ok ? { ok: true, data: { ...built.data, ...change } } : built;
    } };
    let signed = false;
    const watching = { wallet: STUB_WALLET, address: STUB_CREATOR, sign: async (wires) => ((signed = true), { ok: true, signed: wires }) };
    const result = await runLaunch({ engine, signer: watching, fields: FIELDS, preset: PROTECTED, network: "solana:devnet", onPhase: () => {}, switchOpen: true });
    assert.equal(result.failure.code, BUILD_UNEXPECTED, JSON.stringify(change));
    assert.equal(signed, false);
  }
});

test("a send the network did not confirm names the coin, and says what landed may still show", async () => {
  const { result } = await launch({ engine: stubEngine({ refuse: { submit: { ok: false, code: "UNAVAILABLE", message: "" } } }) });
  assert.equal(result.failure.stage, "send");
  assert.match(result.failure.token, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.match(failureWords(result.failure), /If the launch landed, your tower appears/);
});

test("every failure reads in at most two short sentences", () => {
  const codes = [CITY_CLOSED, WALLET_REFUSED, "LAUNCH_BUILD_EXPIRED", BUILD_UNEXPECTED, "LAUNCH_NAME_BORROWED", "VALIDATION_ERROR", "LAUNCH_IMAGE_INVALID", "LAUNCH_IMAGE_REFUSED", "LAUNCH_IMAGE_CHECK_UNAVAILABLE", "LAUNCH_LIMIT", "LAUNCH_PAUSED", "LAUNCH_QUOTE_PAUSED", "LAUNCH_BUSY", "LAUNCH_UNAVAILABLE", "RATE_LIMITED", "WALLET_MISMATCH", "LAUNCH_SIGNED_OTHER_BYTES", "LAUNCH_BUILD_USED", "LAUNCH_SUBMIT_FAILED", "UNAVAILABLE"];
  for (const code of codes) {
    for (const stage of ["before", "send"]) {
      const words = failureWords({ code, stage, message: "", token: null });
      assert.ok(words.length > 0 && words.length <= 140, `${code}: ${words}`);
      assert.ok((words.match(/[.!?](\s|$)/g) ?? []).length <= 2, `${code}: ${words}`);
    }
  }
});

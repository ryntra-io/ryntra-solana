import assert from "node:assert/strict";
import test from "node:test";

import {
  LaunchBuildResponseSchema,
  LaunchCrewsResponseSchema,
  LaunchMarketResponseSchema,
  LaunchMarketsResponseSchema,
  LaunchMetadataResponseSchema,
  LaunchPresetsResponseSchema,
  LaunchSubmitResponseSchema,
  LaunchSurvivalResponseSchema,
} from "../../../lib/api/v1/contract.ts";
import { launchNetwork } from "../../../lib/launch/config.server.ts";
import { launchPresetsView } from "../../../lib/launch/runtime.server.ts";
import { STUB_CREATOR, STUB_PRESETS, STUB_PRESETS_ANSWER, base58, stubEngine } from "./stub.ts";

/* The engine's own answer on the devnet stand, as a local server with `RYNTRA_LAUNCH_STAND=devnet` serves it. */
const DEVNET = launchPresetsView(launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://stand.example.org" }));
const PICTURE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("the stub's presets are the engine's own on the devnet stand, figure for figure", () => {
  assert.equal(DEVNET.network, STUB_PRESETS_ANSWER.network);
  for (const preset of STUB_PRESETS) {
    assert.deepEqual(preset, DEVNET.presets.find((entry) => entry.id === preset.id), preset.id);
  }
  assert.deepEqual(STUB_PRESETS_ANSWER.locks, DEVNET.locks);
  assert.deepEqual(STUB_PRESETS_ANSWER.limits, DEVNET.limits);
});

test("every answer of the stub has the v1 contract's shape", async () => {
  const engine = stubEngine({ now: () => Date.parse("2026-10-26T12:00:00Z") });
  const presets = await engine.presets();
  assert.ok(presets.ok);
  LaunchPresetsResponseSchema.parse(presets.data);

  const stored = await engine.metadata({ name: "Kite", symbol: "KITE", description: "", website: "", x: "", telegram: "", imageBase64: PICTURE });
  assert.ok(stored.ok);
  LaunchMetadataResponseSchema.parse(stored.data);

  const built = await engine.build({ creator: STUB_CREATOR, preset: "protected", metadataUri: stored.data.metadataUri, firstBuyRaw: "0", lock: null });
  assert.ok(built.ok);
  LaunchBuildResponseSchema.parse(built.data);
  assert.equal(built.data.network, "solana:devnet");

  const sent = await engine.submit({ buildId: built.data.buildId, creator: STUB_CREATOR, signedWireBase64: built.data.unsignedWireBase64, signedLockWireBase64: null });
  assert.ok(sent.ok);
  LaunchSubmitResponseSchema.parse(sent.data);

  const markets = await engine.markets();
  assert.ok(markets.ok);
  LaunchMarketsResponseSchema.parse(markets.data);
  assert.equal(markets.data.markets[0].token, sent.data.token, "a coin launched through the stub joins its list first");

  const survival = await engine.survival();
  assert.ok(survival.ok);
  LaunchSurvivalResponseSchema.parse(survival.data);

  const crews = await engine.crews();
  assert.ok(crews.ok);
  LaunchCrewsResponseSchema.parse(crews.data);

  for (const row of markets.data.markets) {
    const market = await engine.market(row.token);
    assert.ok(market.ok, row.symbol);
    LaunchMarketResponseSchema.parse(market.data);
  }
});

test("the stub refuses as the engine does: a borrowed name, a build sent twice, other bytes", async () => {
  const engine = stubEngine();
  const borrowed = await engine.metadata({ name: "Elon Rocket", symbol: "ELON", description: "", website: "", x: "", telegram: "", imageBase64: PICTURE });
  assert.equal(borrowed.ok, false);
  assert.equal(borrowed.code, "LAUNCH_NAME_BORROWED");

  const stored = await engine.metadata({ name: "Kite", symbol: "KITE", description: "", website: "", x: "", telegram: "", imageBase64: PICTURE });
  const built = await engine.build({ creator: STUB_CREATOR, preset: "protected", metadataUri: stored.data.metadataUri, firstBuyRaw: "0", lock: null });
  const other = await engine.submit({ buildId: built.data.buildId, creator: STUB_CREATOR, signedWireBase64: "AAAA", signedLockWireBase64: null });
  assert.equal(other.code, "LAUNCH_SIGNED_OTHER_BYTES");
  const sent = await engine.submit({ buildId: built.data.buildId, creator: STUB_CREATOR, signedWireBase64: built.data.unsignedWireBase64, signedLockWireBase64: null });
  assert.ok(sent.ok);
  const again = await engine.submit({ buildId: built.data.buildId, creator: STUB_CREATOR, signedWireBase64: built.data.unsignedWireBase64, signedLockWireBase64: null });
  assert.equal(again.code, "LAUNCH_BUILD_USED");
});

test("made-up addresses are base58 the way Solana writes them", () => {
  assert.equal(base58(new Uint8Array([0, 0, 1])), "112");
  assert.equal(base58(new Uint8Array([255])), "5Q");
  assert.match(STUB_CREATOR, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});

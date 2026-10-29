import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, Transaction } from "@solana/web3.js";

import { ADVANCED_DEFAULT_CHOICE, DEVNET_ADVANCED_BOUNDS } from "../core/launch/advanced.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { prepareAdvancedConfig, advancedConfigFor, markAdvancedConfigUsed, returnAdvancedConfig, takeAdvancedConfig } from "./advanced.server.ts";
import { COMMUNITY_REGISTRY_PREFIX, communityPairs, configsOfRecord, launchNetwork, launchPair } from "./config.server.ts";
import { earlyAccessQuote } from "./early-access.server.ts";
import { prepareLaunch } from "./flow.server.ts";
import { storeLaunchMetadata } from "./metadata.server.ts";
import { launchPresetsView } from "./runtime.server.ts";

const STAND = { RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://ryntra.io" };
const SECRET = { BETA_TOKEN_SECRET: "a-secret-of-thirty-two-characters!" };
const address = () => Keypair.generate().publicKey.toBase58();

/* A node that answers what a config's build asks and nothing more. */
const node = () => ({
  getLatestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1_000 }),
  getBalance: async () => 1_000_000_000,
  simulateTransaction: async () => ({ value: { err: null, accounts: [{ lamports: 1_000_000_000 - 7_000_000 }] } }),
  getEpochInfo: async () => ({ blockHeight: 900, absoluteSlot: 9_000 }),
  getRecentPerformanceSamples: async () => [{ numSlots: 150, samplePeriodSecs: 60 }],
  getAccountInfo: async () => ({ owner: Keypair.generate().publicKey, data: Buffer.alloc(0) }),
});

test("SOL-L5: mainnet offers «Спільнота» and «Розширений» only by the configs and bounds configured", () => {
  const plain = launchNetwork({});
  assert.equal(plain.cluster, "mainnet");
  assert.deepEqual(plain.communities, []);
  assert.equal(plain.advanced, null);
  assert.equal(plain.configs.community, undefined);
  /* A community config the registry does not list is never offered on mainnet, whatever the deployment names. */
  const named = JSON.stringify([{ config: address(), mint: address(), symbol: "BONK", decimals: 5, usdPrice: 0.00002 }]);
  assert.deepEqual(communityPairs({ RYNTRA_LAUNCH_COMMUNITY_CONFIGS: named }, "mainnet"), []);
  assert.equal(launchNetwork({ RYNTRA_LAUNCH_COMMUNITY_CONFIGS: named }).communities.length, 0);
  /* The operator's bounds open «Розширений» with the registry's partner vault as its fee claimer. */
  const bounded = launchNetwork({ RYNTRA_LAUNCH_ADVANCED_BOUNDS: JSON.stringify(DEVNET_ADVANCED_BOUNDS) });
  assert.deepEqual(bounded.advanced?.bounds, DEVNET_ADVANCED_BOUNDS);
  assert.equal(bounded.advanced?.feeClaimer, bounded.referralOwner);
  assert.equal(launchNetwork({ RYNTRA_LAUNCH_ADVANCED_BOUNDS: "{}" }).advanced, null);
  assert.equal(launchPresetsView(plain).formats?.advanced, null);
  assert.equal(launchPresetsView(plain).formats?.boost, null);
  assert.equal(launchPresetsView(plain).formats?.earlyAccess, null);
});

test("SOL-L5: the stand names its community tokens; each has its config and its pair", () => {
  const extra = { config: address(), mint: address(), symbol: "HIVE", decimals: 6, usdPrice: 0.5 };
  const network = launchNetwork({ ...STAND, RYNTRA_LAUNCH_COMMUNITY_CONFIGS: JSON.stringify([extra, { config: "nope", mint: address(), symbol: "X", decimals: 6, usdPrice: 1 }]) });
  assert.equal(network.communities.length, 2);
  assert.deepEqual([...network.configs.community], network.communities.map((pair) => pair.config));
  assert.equal(launchPair(network, "community", extra.mint).symbol, "HIVE");
  assert.equal(launchPair(network, "community").symbol, "COMM", "absent a mint, the preset's first community");
  assert.throws(() => launchPair(network, "community", address()));
  assert.equal(launchPair(network, "advanced").symbol, "USDC");
  assert.deepEqual(launchPresetsView(network).communities?.map((pair) => pair.symbol), ["COMM", "HIVE"]);
  assert.ok(launchPresetsView(network).formats?.advanced);
  assert.ok(launchPresetsView(network).formats?.boost);
  assert.ok(launchPresetsView(network).formats?.earlyAccess);
});

test("SOL-L5: the stand names Класичний on its own test USDC; Захищений leaves, «Розширений» and early access trade that USDC", () => {
  const usdc = address();
  const classic = address();
  const network = launchNetwork({ ...STAND, RYNTRA_LAUNCH_DEVNET_CLASSIC_CONFIG: classic, RYNTRA_LAUNCH_DEVNET_CLASSIC_PAIR: usdc });
  assert.equal(network.configs.classic, classic);
  assert.equal(launchPair(network, "classic").mint, usdc);
  assert.equal(network.configs.protected, undefined, "Захищений's config is on the old USDC");
  assert.equal(network.pairs.protected, undefined);
  assert.equal(launchPair(network, "advanced").mint, usdc);
  assert.equal(earlyAccessQuote(network).mint, usdc);
  assert.deepEqual(launchPresetsView(network).presets.map((preset) => preset.id).includes("protected"), false);
  /* Half of it names nothing: the stand stays the rehearsal's. */
  const half = launchNetwork({ ...STAND, RYNTRA_LAUNCH_DEVNET_CLASSIC_CONFIG: classic });
  assert.notEqual(half.configs.classic, classic);
  assert.ok(half.configs.protected);
  /* Production never reads it. */
  assert.equal(launchNetwork({ ...STAND, VERCEL_ENV: "production", RYNTRA_LAUNCH_DEVNET_CLASSIC_CONFIG: classic, RYNTRA_LAUNCH_DEVNET_CLASSIC_PAIR: usdc }).cluster, "mainnet");
});

test("SOL-L5: a mainnet community is offered once its config is listed in the attribution registry for that very token", () => {
  const row = { id: `${COMMUNITY_REGISTRY_PREFIX}test`, network: "solana", products: ["launch"], role: "LAUNCH_CONFIG", kind: "DBC_CONFIG", parent: null, mint: address(), address: address(), end: null, countedAs: "FEES" };
  const env = { RYNTRA_LAUNCH_COMMUNITY_CONFIGS: JSON.stringify([{ config: row.address, mint: row.mint, symbol: "TEST", decimals: 6, usdPrice: 1 }]) };
  assert.equal(communityPairs(env, "mainnet", [row]).length, 1);
  const otherMint = { RYNTRA_LAUNCH_COMMUNITY_CONFIGS: JSON.stringify([{ config: row.address, mint: address(), symbol: "TEST", decimals: 6, usdPrice: 1 }]) };
  assert.equal(communityPairs(otherMint, "mainnet", [row]).length, 0, "the registry's row names another token");
  assert.equal(communityPairs(env, "mainnet", [{ ...row, end: { block: 1, time: "2026-10-20T00:00:00Z" } }]).length, 0, "a retired row");
  assert.equal(communityPairs(env, "mainnet", [{ ...row, id: "solana-launch-config-classic" }]).length, 0, "not one of «Спільнота»'s rows");
});

test("SOL-L5: «Розширений»'s config is built only within the bounds, for the creator to pay and sign first", async () => {
  const store = createMemoryGuardStore();
  const network = launchNetwork(STAND);
  const deps = { network, connection: node(), store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => new Date("2026-10-20T10:00:00.000Z"), env: SECRET };
  const creator = address();
  assert.equal((await prepareAdvancedConfig(deps, { creator, choice: { ...ADVANCED_DEFAULT_CHOICE, creatorTradingFeePct: 90 } })).code, "ADVANCED_INVALID");
  assert.equal((await prepareAdvancedConfig(deps, { creator, choice: { ...ADVANCED_DEFAULT_CHOICE, sniper: "none" } })).code, "ADVANCED_INVALID");
  assert.equal((await prepareAdvancedConfig({ ...deps, network: launchNetwork({}) }, { creator, choice: ADVANCED_DEFAULT_CHOICE })).code, "PRESET_UNAVAILABLE");
  assert.equal((await prepareAdvancedConfig({ ...deps, env: {} }, { creator, choice: ADVANCED_DEFAULT_CHOICE })).code, "BUILD_FAILED");
  const built = await prepareAdvancedConfig(deps, { creator, choice: { ...ADVANCED_DEFAULT_CHOICE, supply: 10_000_000_000 } });
  assert.equal(built.ok, true, built.message);
  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  assert.equal(tx.feePayer?.toBase58(), creator, "the creator pays the config's rent");
  /* The config's own key has not signed: it signs after the creator, at submit. */
  const signers = tx.signatures.map((entry) => ({ key: entry.publicKey.toBase58(), signed: Boolean(entry.signature && entry.signature.some((byte) => byte !== 0)) }));
  assert.deepEqual(signers.find((entry) => entry.key === built.config)?.signed, false);
  assert.equal(built.terms.supply, 10_000_000_000);
  assert.deepEqual(built.terms.graduationFee, DEVNET_ADVANCED_BOUNDS.graduationFee);
  assert.equal(built.creatorCostLamports, "7000000");
});

test("SOL-L5: a launch on «Розширений» names a config made here for its creator, and one config carries one launch", async () => {
  const store = createMemoryGuardStore();
  const network = launchNetwork(STAND);
  const deps = { network, connection: node(), store, poolPayer: Keypair.generate(), origin: "https://ryntra.io", now: () => new Date("2026-10-20T10:00:00.000Z"), env: SECRET };
  const creator = address();
  const metadataUri = `https://ryntra.io/api/launch/metadata/${(await storeLaunchMetadata(store, { name: "Wide Owl", symbol: "WOWL", description: "", image: "https://ryntra.io/api/launch/image/x", createdOn: "https://ryntra.io" }, "t")).sha256}`;
  const base = { creator, metadataUri, firstBuyRaw: "0", lock: null };
  assert.equal((await prepareLaunch(deps, { ...base, preset: "advanced" })).code, "PRESET_UNAVAILABLE", "always with its own config");
  assert.equal((await prepareLaunch(deps, { ...base, preset: "protected", advancedConfig: address() })).code, "PRESET_UNAVAILABLE", "only «Розширений» names one");
  assert.equal((await prepareLaunch(deps, { ...base, preset: "protected", pairMint: address() })).code, "PRESET_UNAVAILABLE", "only «Спільнота» names its pair");
  assert.equal((await prepareLaunch(deps, { ...base, preset: "community", pairMint: address() })).code, "PRESET_UNAVAILABLE", "a community not offered");
  const config = address();
  assert.equal((await prepareLaunch(deps, { ...base, preset: "advanced", advancedConfig: config })).code, "ADVANCED_CONFIG_UNUSABLE", "not made here");
  const terms = { ...ADVANCED_DEFAULT_CHOICE, graduationFee: DEVNET_ADVANCED_BOUNDS.graduationFee, firstBuyCapBps: DEVNET_ADVANCED_BOUNDS.firstBuyCapBps };
  await store.collection("launchAdvancedConfigs").set(`devnet:${config}`, { cluster: "devnet", config, creator: address(), terms, signature: "s", state: "CREATED", token: null, createdAt: "2026-10-20T09:00:00.000Z" });
  assert.equal((await prepareLaunch(deps, { ...base, preset: "advanced", advancedConfig: config })).code, "ADVANCED_CONFIG_UNUSABLE", "another creator's");
  await store.collection("launchAdvancedConfigs").set(`devnet:${config}`, { cluster: "devnet", config, creator, terms, signature: "s", state: "CREATED", token: null, createdAt: "2026-10-20T09:00:00.000Z" });
  assert.equal((await advancedConfigFor(deps, creator, config)).config, config);
  assert.equal((await advancedConfigFor(deps, null, config)).config, config, "a quote reads any creator's");
  await markAdvancedConfigUsed(deps, config, address());
  assert.equal((await prepareLaunch(deps, { ...base, preset: "advanced", advancedConfig: config })).code, "ADVANCED_CONFIG_UNUSABLE", "used");
  assert.deepEqual(configsOfRecord(network, { preset: "advanced", config }).advanced, config);
  assert.equal(configsOfRecord(network, { preset: "protected", config }), network.configs);
});

test("SOL-L5: a «Розширений» config is taken once before the send; a refused launch gives it back", async () => {
  const store = createMemoryGuardStore();
  const deps = { store, network: launchNetwork(STAND) };
  const config = address();
  assert.equal(await takeAdvancedConfig(deps, config, "a"), true);
  assert.equal(await takeAdvancedConfig(deps, config, "b"), false, "a second launch on it is refused");
  await returnAdvancedConfig(deps, config);
  assert.equal(await takeAdvancedConfig(deps, config, "c"), true);
});

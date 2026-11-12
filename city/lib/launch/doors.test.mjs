import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { DYNAMIC_FEE_SHARING_PROGRAM_ID } from "@meteora-ag/dynamic-fee-sharing-sdk";
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID } from "@meteora-ag/dynamic-bonding-curve-sdk";

import { LaunchBuildRequestSchema, LaunchEarlyAccessBuildRequestSchema, LaunchSubmitRequestSchema } from "../../../lib/api/v1/contract.ts";
import { DEVNET_EARLY_ACCESS_BOUNDS, earlyAccessSchedule } from "../../../lib/core/launch/early-access.ts";
import { TYPED_SHARES_OWNER_WORD, typedSharesOpenOn } from "../../../lib/core/launch/fee-shares.ts";
import { feeSharingSplitInstructions, feeSharingVaultOf } from "../../../lib/core/venues/meteora-dbc/fee-sharing.server.ts";
import { CITY_EARLY_ACCESS_MAINNET, CITY_EARLY_ACCESS_SWITCH, EARLY_CAPS_USD, earlyCaps, earlyDoorOpen, earlyRules } from "./early.ts";
import { checkEarly } from "./early-check.ts";
import { runEarlyAccess } from "./early-flow.ts";
import { BUILD_UNEXPECTED, CITY_CLOSED, WALLET_REFUSED, readRefusal, runLaunch } from "./flow.ts";
import { asReviewed, createPrep, freshPrebuilt, launchRequest } from "./prepare.ts";
import { EARLY_PARTIAL } from "./refusal.ts";
import { CITY_SHARE_SWITCH, SHARE_MAX_OTHERS, keptPercent, nextRow, othersOf, sameShares, shareOpen, shareProblem, sharesOf } from "./share.ts";
import { BONDING_CURVE_PROGRAM, FEE_SHARING_PROGRAM, checkSplit } from "./split-check.ts";
import { STUB_CREATOR, STUB_PRESETS, STUB_WALLET, stubAddress, stubEngine, stubWallet } from "./stub.ts";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const PROTECTED = STUB_PRESETS.find((preset) => preset.id === "protected");
const BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FIELDS = { name: "Kite", symbol: "KITE", picture: { base64: BASE64, url: `data:image/png;base64,${BASE64}` } };
const A = stubAddress("share:a");
const B = stubAddress("share:b");
const wire = (tx) => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");

/* ---------------------------------------------------------------- «Share earnings»: the rules */

test("the share door opens behind its switch where the engine shares typed wallets: the stand, mainnet only on typed shares", () => {
  assert.equal(CITY_SHARE_SWITCH, false, "the city's switch is closed unless a deployment opens it");
  assert.equal(shareOpen("solana:devnet"), false, "closed by default");
  assert.equal(shareOpen("solana:devnet", undefined, true), true);
  assert.equal(shareOpen("solana:mainnet", undefined, true), true, "open on mainnet by the opening word of 9.11");
  assert.equal(shareOpen("solana:mainnet", false, true), false, "without the word, shut on mainnet");
  assert.equal(shareOpen("solana:mainnet", true, true), true);
  assert.equal(shareOpen("solana:mainnet", true, false), false, "the switch shuts it on mainnet too");
  assert.equal(shareOpen(null, true, true), false);
  assert.equal(TYPED_SHARES_OWNER_WORD, true, "the opening word of 9.11, after the fork and devnet passes (CITY-234)");
  assert.match(read("city/lib/launch/share.ts"), /ownerWord: boolean = TYPED_SHARES_OWNER_WORD/, "the door reads the engine's own word");
  assert.doesNotMatch(read("city/lib/launch/share.ts"), /CREW_OWNER_WORD/, "the crews' word is not the door's");
});

test("a split asked where its door is shut is refused before anything is stored", async () => {
  for (const [why, overrides] of [
    ["the switch closed", { shareSwitch: false }],
    ["mainnet without the opening word", { network: "solana:mainnet", ownerWord: true, shareWord: false }],
  ]) {
    const { result, engine } = await sharedLaunch(overrides);
    assert.equal(result.failure.code, CITY_CLOSED, why);
    assert.deepEqual(engine.calls ?? [], [], `${why}: nothing stored or built`);
  }
  const open = await sharedLaunch({ network: "solana:mainnet", ownerWord: true, shareWord: true });
  assert.notEqual(open.result.failure?.code, CITY_CLOSED, "the opening word and the switch open it on mainnet");
});

test("the creator keeps what the others do not take; the split is the engine's own rule", () => {
  const rows = [{ address: A, percent: 20 }, { address: B, percent: 10 }];
  assert.equal(keptPercent(rows), 70);
  assert.deepEqual(othersOf(rows), [{ address: A, bps: 2_000 }, { address: B, bps: 1_000 }]);
  assert.deepEqual(sharesOf(STUB_CREATOR, rows), [{ address: STUB_CREATOR, bps: 7_000 }, { address: A, bps: 2_000 }, { address: B, bps: 1_000 }]);
  assert.equal(sharesOf(STUB_CREATOR, []), null, "nothing shared");
  assert.equal(shareProblem(rows, STUB_CREATOR), null);
  assert.equal(shareProblem([], STUB_CREATOR), null);
  assert.equal(shareProblem([{ address: "", percent: 10 }], null), "address");
  assert.equal(shareProblem([{ address: "not-an-address", percent: 10 }], null), "address");
  assert.equal(shareProblem([{ address: A, percent: 10 }, { address: A, percent: 10 }], null), "repeated");
  assert.equal(shareProblem([{ address: STUB_CREATOR, percent: 10 }], STUB_CREATOR), "self");
  assert.equal(shareProblem([{ address: A, percent: 0 }], null), "small");
  assert.equal(shareProblem([{ address: A, percent: 1.5 }], null), "whole");
  assert.equal(shareProblem([{ address: A, percent: 60 }, { address: B, percent: 40 }], null), "tooMuch", "the creator keeps at least 1%");
  const five = [1, 2, 3, 4, 5].map((i) => ({ address: stubAddress(`share:${i}`), percent: 5 }));
  assert.equal(shareProblem(five, null), "tooMany");
  assert.equal(SHARE_MAX_OTHERS, 4, "the program's two to five wallets");
  assert.deepEqual(nextRow([{ address: A, percent: 95 }]), { address: "", percent: 4 }, "a new row takes what is left above the creator's least");
  assert.equal(sameShares([{ address: A, bps: 1 }], [{ address: A, bps: 1 }]), true);
  assert.equal(sameShares([{ address: A, bps: 1 }], [{ address: A, bps: 2 }]), false);
  assert.equal(sameShares(undefined, []), true);
});

test("the city asks the engine for the split it showed, the creator first; a request without one names none", () => {
  const shares = sharesOf(STUB_CREATOR, [{ address: A, percent: 30 }]);
  const asked = launchRequest(STUB_CREATOR, "protected", "https://stand.example.org/m", shares);
  LaunchBuildRequestSchema.parse(asked);
  assert.deepEqual(asked.feeShares, [{ address: STUB_CREATOR, bps: 7_000 }, { address: A, bps: 3_000 }]);
  assert.equal("feeShares" in launchRequest(STUB_CREATOR, "protected", "https://stand.example.org/m"), false);
});

/* ---------------------------------------------------------------- the bytes read back */

/** The engine's own instructions for a split, as `launch.server.ts` lays them, beside a creation in the same window. */
async function engineSplit(shares, overrides = {}) {
  const connection = new Connection("http://127.0.0.1:1");
  const creator = new PublicKey(overrides.creator ?? STUB_CREATOR);
  const mint = Keypair.generate();
  const pair = "So11111111111111111111111111111111111111112";
  const instructions = await feeSharingSplitInstructions({
    connection,
    token: mint.publicKey.toBase58(),
    pairMint: pair,
    pairProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    creator: creator.toBase58(),
    pool: Keypair.generate().publicKey.toBase58(),
    config: Keypair.generate().publicKey.toBase58(),
    shares: overrides.builtShares ?? shares,
  });
  const blockhash = Keypair.generate().publicKey.toBase58();
  const creation = new Transaction({ feePayer: creator, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: creator, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  const split = new Transaction({ feePayer: creator, recentBlockhash: overrides.blockhash ?? blockhash }).add(...(overrides.instructions ? overrides.instructions(instructions) : instructions));
  split.partialSign(mint);
  return { creationWire: wire(creation), splitWire: wire(split), creator: creator.toBase58(), token: mint.publicKey.toBase58(), feeVault: feeSharingVaultOf(mint.publicKey.toBase58(), pair), shares };
}

test("the reader of the sharing knows the programs the engine calls", () => {
  assert.equal(FEE_SHARING_PROGRAM, DYNAMIC_FEE_SHARING_PROGRAM_ID.toBase58());
  assert.equal(BONDING_CURVE_PROGRAM, DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58());
});

test("the engine's own sharing bytes read back as exactly the shares the review showed", async () => {
  const shares = [{ address: STUB_CREATOR, bps: 6_000 }, { address: A, bps: 3_000 }, { address: B, bps: 1_000 }];
  assert.deepEqual(checkSplit(await engineSplit(shares)), { ok: true });
});

test("a sharing other than the one shown is never put before the wallet", async () => {
  const shares = [{ address: STUB_CREATOR, bps: 7_000 }, { address: A, bps: 3_000 }];
  const good = await engineSplit(shares);
  const no = (args, why) => assert.equal(checkSplit(args).ok, false, why);
  no({ ...good, shares: [{ address: STUB_CREATOR, bps: 6_000 }, { address: A, bps: 4_000 }] }, "other parts");
  no({ ...good, shares: [{ address: A, bps: 3_000 }, { address: STUB_CREATOR, bps: 7_000 }] }, "another order");
  no({ ...good, shares: [...shares, { address: B, bps: 0 }] }, "another number of wallets");
  no(await engineSplit(shares, { builtShares: [{ address: STUB_CREATOR, bps: 7_000 }, { address: B, bps: 3_000 }] }), "a wallet the review did not show");
  no({ ...good, feeVault: stubAddress("vault:other") }, "another vault");
  no({ ...good, feeVault: null }, "no vault named");
  no({ ...good, token: stubAddress("mint:other") }, "another launch's mint");
  no({ ...good, creator: STUB_WALLET === good.creator ? A : stubAddress("creator:other") }, "another payer");
  no(await engineSplit(shares, { blockhash: Keypair.generate().publicKey.toBase58() }), "another window than the creation's");
  no(await engineSplit(shares, { instructions: (ixs) => [ixs[0]] }), "the vault without the handover");
  no(await engineSplit(shares, { instructions: (ixs) => [...ixs, SystemProgram.transfer({ fromPubkey: new PublicKey(STUB_CREATOR), toPubkey: new PublicKey(A), lamports: 1 })] }), "anything more");
  no(await engineSplit(shares, { instructions: (ixs) => [ixs[1], ixs[0]] }), "another order of steps");
  no({ ...good, splitWire: "AAAA" }, "unreadable bytes");
});

/* ---------------------------------------------------------------- the launch with its fees shared */

const signerOf = (options) => stubWallet(options).signer({ wallet: STUB_WALLET, address: STUB_CREATOR });

async function sharedLaunch(overrides = {}) {
  const phases = [];
  const engine = overrides.engine ?? stubEngine();
  const result = await runLaunch({ engine, signer: overrides.signer ?? signerOf(), fields: FIELDS, preset: PROTECTED, network: "solana:devnet", onPhase: (phase) => phases.push(phase), switchOpen: true, shareSwitch: true, others: [{ address: A, bps: 2_000 }, { address: B, bps: 1_000 }], ...overrides });
  return { result, phases, steps: phases.map((phase) => phase.step), engine };
}

test("a shared launch: the split asked, read back, two transactions in one prompt, both sent, the sharing kept on the liftoff", async () => {
  const stub = stubEngine();
  const asked = [];
  const submitted = [];
  const signed = [];
  const engine = { ...stub, build: (body) => (asked.push(body), stub.build(body)), submit: (body) => (submitted.push(body), stub.submit(body)) };
  const base = signerOf();
  const signer = { ...base, sign: (wires, chain) => (signed.push(wires), base.sign(wires, chain)) };
  const { result, steps, phases } = await sharedLaunch({ engine, signer });
  assert.deepEqual(steps, ["upload", "build", "sign", "send", "done"]);
  assert.deepEqual(asked[0].feeShares, [{ address: STUB_CREATOR, bps: 7_000 }, { address: A, bps: 2_000 }, { address: B, bps: 1_000 }]);
  assert.equal(signed[0].length, 2, "the creation and the sharing, one prompt");
  assert.equal(phases.find((phase) => phase.step === "sign").shared, true);
  LaunchSubmitRequestSchema.parse(submitted[0]);
  assert.equal(submitted[0].signedSplitWireBase64, signed[0][1]);
  assert.equal(result.liftoff.sharing.state, "SHARED");
  assert.equal(result.liftoff.sharing.shares.length, 3);
});

test("a split the engine would refuse is refused before anything is built", async () => {
  const { result, engine } = await sharedLaunch({ others: [{ address: STUB_CREATOR, bps: 2_000 }] });
  assert.equal(result.failure.code, "LAUNCH_SHARES_INVALID");
  assert.equal(result.failure.stage, "before");
  assert.deepEqual(engine.calls, ["metadata"], "nothing built");
  const refusal = readRefusal(result.failure);
  assert.equal(refusal.kind, "shares");
  assert.equal(refusal.action, "edit");
});

test("bytes without the sharing, or with another one, never reach the wallet", async () => {
  for (const [why, change] of [
    ["no sharing built", (data) => ({ ...data, splitUnsignedWireBase64: null, feeVault: null })],
    ["another vault", (data) => ({ ...data, feeVault: stubAddress("vault:elsewhere") })],
    ["a lock nobody asked for", (data) => ({ ...data, lockUnsignedWireBase64: "AAAA" })],
  ]) {
    const stub = stubEngine();
    let opened = 0;
    const base = signerOf();
    const signer = { ...base, sign: (wires, chain) => ((opened += 1), base.sign(wires, chain)) };
    const engine = { ...stub, build: async (body) => { const built = await stub.build(body); return built.ok ? { ok: true, data: change(built.data) } : built; } };
    const { result } = await sharedLaunch({ engine, signer });
    assert.equal(result.failure.code, BUILD_UNEXPECTED, why);
    assert.equal(opened, 0, `${why}: the wallet was never opened`);
  }
  /* And a launch that shares nothing never signs a sharing the engine slipped in. */
  const stub = stubEngine();
  const engine = { ...stub, build: async (body) => { const built = await stub.build({ ...body, feeShares: [{ address: STUB_CREATOR, bps: 9_000 }, { address: A, bps: 1_000 }] }); return built; } };
  const { result } = await sharedLaunch({ engine, others: undefined });
  assert.equal(result.failure.code, BUILD_UNEXPECTED);
});

test("a wallet that hands back one signature for two is not sent", async () => {
  const base = signerOf();
  const signer = { ...base, sign: async (wires, chain) => { const answer = await base.sign(wires, chain); return answer.ok ? { ok: true, signed: answer.signed.slice(0, 1) } : answer; } };
  const { result, engine } = await sharedLaunch({ signer });
  assert.equal(result.failure.code, WALLET_REFUSED);
  assert.equal(engine.calls.includes("submit"), false);
});

test("the sheet's prebuilt bytes are handed over only for exactly the same split", async () => {
  const stub = stubEngine();
  const prep = createPrep({ engine: () => stub, now: () => 1_000 });
  const fields = { name: "Kite", symbol: "KITE", picture: { base64: BASE64 } };
  await prep.store(fields);
  const shares = sharesOf(STUB_CREATOR, [{ address: A, percent: 25 }]);
  await prep.simulate({ fields, creator: STUB_CREATOR, preset: PROTECTED, network: "solana:devnet", switchOpen: true, shares });
  assert.equal(prep.state().costLamports, "13064320", "the cost counts the sharing too");
  const metadataUri = prep.state().stored.answer.data.metadataUri;
  const other = launchRequest(STUB_CREATOR, "protected", metadataUri, sharesOf(STUB_CREATOR, [{ address: A, percent: 20 }]));
  assert.equal(prep.take(other, "solana:devnet"), null, "another split is another launch");
  const same = launchRequest(STUB_CREATOR, "protected", metadataUri, shares);
  const handed = prep.take(same, "solana:devnet");
  assert.ok(handed);
  assert.ok(freshPrebuilt(handed, same, "solana:devnet", 1_000));
  assert.equal(freshPrebuilt(handed, launchRequest(STUB_CREATOR, "protected", metadataUri), "solana:devnet", 1_000), null, "never for the launch alone");
  assert.equal(asReviewed(handed.built, "solana:devnet", true), true);
  assert.equal(asReviewed(handed.built, "solana:devnet", false), false);
});

test("the engine shares typed wallets on Classic and Protected only by its own word, apart from the crews'", () => {
  const flow = read("lib/launch/flow.server.ts");
  assert.match(flow, /if \(preset\.id !== "community" && !\(isCrewPreset\(preset\.id\) && typedSharesOpenOn\(deps\.network\.cluster\)\)\) return fail\("SHARES_INVALID"/);
  assert.doesNotMatch(flow, /crewOpenOn/, "opening crews on mainnet does not open typed shares, nor the other way");
  assert.equal(typedSharesOpenOn("devnet"), true);
  assert.equal(typedSharesOpenOn("mainnet"), true, "the opening word of 9.11");
  assert.equal(typedSharesOpenOn("mainnet", false), false);
  assert.equal(typedSharesOpenOn("mainnet", true), true);
  /* The vault, its shares and the handover are the engine's, untouched. */
  assert.match(read("lib/core/venues/meteora-dbc/launch.server.ts"), /const sharer = preset\.id === "community" \|\| \(options\.crew === true && \(preset\.id === "classic" \|\| preset\.id === "protected"\)\);/);
});

/* ---------------------------------------------------------------- «Your people first» */

const NOW = Math.floor(Date.parse("2026-11-06T12:00:00Z") / 1000);

test("the early door stays shut by default, and on mainnet whatever the engine says", () => {
  assert.equal(CITY_EARLY_ACCESS_SWITCH, false, "the city's switch is closed unless a deployment opens it");
  assert.equal(CITY_EARLY_ACCESS_MAINNET, true, "the opening word of 9.11, after the fork and devnet passes (CITY-234)");
  assert.equal(earlyDoorOpen("solana:devnet", DEVNET_EARLY_ACCESS_BOUNDS), false, "closed by default");
  assert.equal(earlyDoorOpen("solana:devnet", DEVNET_EARLY_ACCESS_BOUNDS, true), true);
  assert.equal(earlyDoorOpen("solana:devnet", null, true), false, "the engine names no bounds");
  assert.equal(earlyDoorOpen("solana:mainnet", DEVNET_EARLY_ACCESS_BOUNDS, true), true, "open on mainnet by the word, behind its switch and the bounds");
  assert.equal(earlyDoorOpen("solana:mainnet", DEVNET_EARLY_ACCESS_BOUNDS, true, false), false, "without the word, shut on mainnet");
  assert.equal(earlyDoorOpen("solana:mainnet", DEVNET_EARLY_ACCESS_BOUNDS, false), false, "the switch shuts it on mainnet too");
  assert.match(read("lib/launch/early-access.server.ts"), /export const EARLY_ACCESS_OWNER_WORD = true;/, "the engine's word on mainnet — given 9.11; the bounds still come from the deployment");
});

test("the goal becomes rules inside the engine's bounds: Pro Rata, opening in five minutes, an hour for the creator's people", () => {
  const rules = earlyRules({ capUsd: 5_000 }, DEVNET_EARLY_ACCESS_BOUNDS, NOW);
  assert.ok(rules);
  assert.equal(rules.mode, "PRO_RATA");
  assert.equal(rules.individualCapRaw, null);
  assert.equal(rules.maxCapRaw, "5000000000");
  assert.equal(rules.depositStartsAt, NOW + 300);
  assert.equal(rules.depositEndsAt - rules.depositStartsAt, 3_600);
  LaunchEarlyAccessBuildRequestSchema.parse({ creator: STUB_CREATOR, metadataUri: "https://stand.example.org/m", rules });
  const fcfs = earlyRules({ capUsd: 5_000 }, { ...DEVNET_EARLY_ACCESS_BOUNDS, modes: ["FCFS"] }, NOW);
  assert.equal(fcfs.mode, "FCFS");
  assert.equal(fcfs.individualCapRaw, "500000000", "a tenth of the cap per wallet");
  assert.deepEqual(earlyCaps(DEVNET_EARLY_ACCESS_BOUNDS, NOW), EARLY_CAPS_USD);
  /* A tight cap on the share of the supply leaves only the goals that fit it. */
  assert.deepEqual(earlyCaps({ ...DEVNET_EARLY_ACCESS_BOUNDS, maxPresaleBps: 1_000 }, NOW), [1_000, 5_000]);
  assert.equal(earlyRules({ capUsd: 5_000 }, { ...DEVNET_EARLY_ACCESS_BOUNDS, modes: [] }, NOW), null);
});

const EARLY_SIGNER = () => stubWallet().signer({ wallet: STUB_WALLET, address: STUB_CREATOR });

async function earlyLaunch(overrides = {}) {
  const phases = [];
  const engine = overrides.engine ?? stubEngine({ now: () => NOW * 1000 });
  const result = await runEarlyAccess({
    engine,
    signer: overrides.signer ?? EARLY_SIGNER(),
    fields: FIELDS,
    network: "solana:devnet",
    bounds: DEVNET_EARLY_ACCESS_BOUNDS,
    rulesAt: (now) => earlyRules({ capUsd: 5_000 }, DEVNET_EARLY_ACCESS_BOUNDS, now),
    onPhase: (phase) => phases.push(phase),
    now: () => NOW * 1000,
    switchOpen: true,
    earlySwitch: true,
    ...overrides,
  });
  return { result, phases, steps: phases.map((phase) => phase.step), engine };
}

test("an early launch: stored, built, read back, three transactions in one prompt, sent, and its two moments said", async () => {
  const { result, steps, engine, phases } = await earlyLaunch();
  assert.deepEqual(steps, ["upload", "build", "sign", "send", "opened"]);
  assert.deepEqual(engine.calls, ["metadata", "earlyBuild", "earlySubmit"]);
  assert.equal(phases.find((phase) => phase.step === "sign").early, true);
  assert.equal(result.opened.opensAt, NOW + 300);
  assert.equal(result.opened.publicAt, NOW + 300 + 3_600 + 3_900);
  assert.equal(result.opened.symbol, "KITE");
});

test("the early door's flow refuses where it is shut, before anything is stored", async () => {
  for (const shut of [{ earlySwitch: false }, { bounds: null }, { network: "solana:mainnet", ownerWord: true, earlySwitch: false }]) {
    const { result, engine } = await earlyLaunch(shut);
    assert.equal(result.failure.code, CITY_CLOSED, JSON.stringify(shut));
    assert.deepEqual(engine.calls, []);
  }
});

test("early bytes for another schedule, another network or another payer never reach the wallet", async () => {
  for (const [why, change] of [
    ["another schedule", (data) => ({ ...data, schedule: { ...data.schedule, activatesAt: data.schedule.activatesAt + 60 } })],
    ["another share for the vault", (data) => ({ ...data, presaleBps: data.presaleBps + 1 })],
    ["another network", (data) => ({ ...data, network: "solana:mainnet" })],
    ["two transactions", (data) => ({ ...data, unsignedWireBase64: data.unsignedWireBase64.slice(0, 2) })],
    ["the steps out of order", (data) => ({ ...data, unsignedWireBase64: [data.unsignedWireBase64[1], data.unsignedWireBase64[0], data.unsignedWireBase64[2]] })],
  ]) {
    const stub = stubEngine({ now: () => NOW * 1000 });
    let opened = 0;
    const base = EARLY_SIGNER();
    const signer = { ...base, sign: (wires, chain) => ((opened += 1), base.sign(wires, chain)) };
    const engine = { ...stub, earlyBuild: async (body) => { const built = await stub.earlyBuild(body); return built.ok ? { ok: true, data: change(built.data) } : built; } };
    const { result } = await earlyLaunch({ engine, signer });
    assert.equal(result.failure.code, BUILD_UNEXPECTED, why);
    assert.equal(opened, 0, `${why}: the wallet was never opened`);
  }
  const rules = earlyRules({ capUsd: 1_000 }, DEVNET_EARLY_ACCESS_BOUNDS, NOW);
  const other = stubAddress("creator:other");
  const built = await stubEngine({ now: () => NOW * 1000 });
  await built.metadata({ name: "Kite", symbol: "KITE", description: "", website: "", x: "", telegram: "", imageBase64: BASE64 });
  assert.equal(earlyAccessSchedule(rules).activatesAt, rules.depositEndsAt + 3_900);
  const answer = await built.earlyBuild({ creator: other, metadataUri: `https://stand.example.org/api/launch/metadata/x`, rules });
  assert.equal(answer.ok, false, "the stand builds nothing on unknown metadata");
  assert.equal(checkEarly({ network: "solana:devnet", unsignedWireBase64: [], schedule: earlyAccessSchedule(rules), presaleBps: 0 }, { network: "solana:devnet", creator: STUB_CREATOR, rules }).ok, false);
});

test("an early creation that landed only in part is said as it is, never as a launch", async () => {
  const stub = stubEngine({ now: () => NOW * 1000 });
  const engine = { ...stub, earlySubmit: async (body) => { const sent = await stub.earlySubmit(body); return sent.ok ? { ok: true, data: { ...sent.data, state: "PARTIAL" } } : sent; } };
  const { result } = await earlyLaunch({ engine });
  assert.equal(result.failure.code, EARLY_PARTIAL);
  assert.equal(result.failure.stage, "send");
  const refusal = readRefusal(result.failure);
  assert.equal(refusal.kind, "partial");
  assert.equal(refusal.moneyKind, "partLanded");
  assert.equal(refusal.action, "close");
});

test("a wallet that signs two of the three early transactions sends nothing", async () => {
  const base = EARLY_SIGNER();
  const signer = { ...base, sign: async (wires, chain) => { const answer = await base.sign(wires, chain); return answer.ok ? { ok: true, signed: answer.signed.slice(0, 2) } : answer; } };
  const { result, engine } = await earlyLaunch({ signer });
  assert.equal(result.failure.code, WALLET_REFUSED);
  assert.equal(engine.calls.includes("earlySubmit"), false);
});

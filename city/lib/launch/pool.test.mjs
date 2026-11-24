/**
 * «Straight to a pool» in the city, with no network: what a sentence says of it, the door's two locks, the
 * time a choice opens at, the city's own read of a step's bytes, the three steps from the press to the set launch —
 * and a launch taken up half-way — and the towers the launches stand as.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

const { poolAskOf, withoutPoolWords } = await import("./pool-ask.ts");
const { CITY_POOL_MAINNET, CITY_POOL_SWITCH, POOL_AFTER, POOL_DEFAULT, countdown, phaseAt, poolChoiceOf, poolDoorOpen, poolOpensAt, shieldLeft } = await import("./pool.ts");
const { checkPoolStep, MAX_PROOF_LAMPORTS } = await import("./pool-check.ts");
const { POOL_HALF_WAY, runPoolLaunch } = await import("./pool-flow.ts");
const { stubPoolEngine } = await import("./pool-stub.ts");
const { poolTowerOf, shownPools, withPoolLaunches, poolTowersKey } = await import("./pool-towers.ts");
const { bookOf, parse } = await import("../command/parse.ts");
const { readAsk } = await import("../autopilot/read.ts");
const { DLMM_PRO_PROGRAM_ID } = await import("../../../lib/core/launch/dlmm-pro.ts");

/* ------------------------------------------------------------------ the sentence */

const NOON = new Date(2026, 10, 15, 12, 0, 0);
const unix = (date) => Math.floor(date.getTime() / 1000);

test("a sentence says whether it asks for a pool, when it opens and the pair — and nothing is guessed", () => {
  assert.deepEqual(poolAskOf("запусти мені токен Moon Cat $MOON в пул через 20 хвилин", NOON), { asked: true, opensAt: unix(NOON) + 1_200, pair: null, ladder: false });
  assert.deepEqual(poolAskOf("launch Solar Dog $SDOG into a pool for USDC in 2 hours", NOON), { asked: true, opensAt: unix(NOON) + 7_200, pair: "USDC", ladder: false });
  assert.deepEqual(poolAskOf("запусти токен Night Owl $OWL в пул за USDC о 23:30", NOON), { asked: true, opensAt: unix(new Date(2026, 10, 15, 23, 30)), pair: "USDC", ladder: false });
  /* The creator's take-profit ladder is asked for in words, never assumed. */
  assert.equal(poolAskOf("запусти мені токен Moon Cat $MOON в пул з драбиною", NOON).ladder, true);
  assert.equal(poolAskOf("launch $SDOG into a pool with a ladder", NOON).ladder, true);
  assert.equal(poolAskOf("запусти токен в пул і постав фіксацію прибутку", NOON).ladder, true);
  assert.equal(poolAskOf("launch $SDOG into a pool with take-profit", NOON).ladder, true);
  assert.equal(poolAskOf("launch $LADDERS into a pool", NOON).ladder, false, "a ticker that only begins like the word is not the word");
  assert.equal(poolAskOf("запусти токен Take Profit $TP в пул", NOON).ladder, false, "a coin's name is not the ask");
  assert.equal(poolAskOf("launch Ladder Cat $LCAT into a pool", NOON).ladder, false);
  assert.equal(withoutPoolWords("запусти токен Take Profit $TP в пул"), "запусти токен Take Profit $TP");
  /* A time that has passed today is tomorrow's. */
  assert.equal(poolAskOf("launch $A into a pool at 09:15", NOON).opensAt, unix(new Date(2026, 10, 16, 9, 15)));
  assert.deepEqual(poolAskOf("запусти токен без кривої за SOL", NOON), { asked: true, opensAt: null, pair: "SOL", ladder: false });
  assert.deepEqual(poolAskOf("запусти мені токен", NOON), { asked: false, opensAt: null, pair: null, ladder: false });
  assert.deepEqual(poolAskOf("launch $POOLS", NOON).asked, false, "a ticker that only begins like the word is not the word");
  assert.equal(poolAskOf("launch a coin into a pool at 25:99", NOON).opensAt, null, "not a time: left out, never rounded into one");
  assert.equal(poolAskOf("launch a coin into a pool in 0 minutes", NOON).opensAt, null);
});

test("the pool's own words are not the coin's name: the command line reads the name and the ticker without them", () => {
  const book = bookOf([]);
  for (const [sentence, name, symbol] of [
    ["запусти мені токен Moon Cat $MOON в пул через 20 хвилин", "Moon Cat", "MOON"],
    ["launch Solar Dog $SDOG into a pool for USDC in 2 hours", "Solar Dog", "SDOG"],
    ["запусти токен Night Owl $OWL в пул за USDC о 23:30", "Night Owl", "OWL"],
    ["запусти мені токен Moon Cat $MOON в пул з драбиною", "Moon Cat", "MOON"],
  ]) {
    const command = parse(sentence, book, { subject: null, pools: true });
    assert.deepEqual({ kind: command.kind, name: command.name, symbol: command.symbol, pool: command.pool }, { kind: "launch", name, symbol, pool: sentence });
    assert.equal(/пул|pool|usdc|хвилин|hours|23:30|драбин/i.test(withoutPoolWords(sentence)), false);
  }
  /* A launch that names no pool is the launch it always was. */
  assert.deepEqual(parse("launch Moon $MOON", book, { subject: null, pools: true }), { kind: "launch", symbol: "MOON", name: "Moon" });
  /* The pool's door shut — the default —, the line reads every sentence as it always did: nothing of the format. */
  for (const sentence of ["запусти мені токен Moon Cat $MOON в пул через 20 хвилин", "launch Solar Dog $SDOG into a pool for USDC in 2 hours"]) {
    assert.equal(parse(sentence, book).pool, undefined, sentence);
    assert.equal(parse(sentence, book, { subject: null, pools: false }).pool, undefined, sentence);
  }
  /* A sentence about a pool that is not a launch stays what it was: the pool's words alone make no launch. */
  assert.notEqual(parse("pools", book).kind, "launch");
  /* The agent's ask keeps the sentence, and the coin's name is clean. */
  const ask = readAsk("запусти мені токен Moon Cat $MOON в пул через 20 хвилин", book, true);
  assert.deepEqual({ kind: ask.kind, name: ask.name, symbol: ask.symbol }, { kind: "launch", name: "Moon Cat", symbol: "MOON" });
  assert.equal(poolAskOf(ask.said, NOON).asked, true);
  assert.deepEqual(poolChoiceOf("launch $A into a pool for USDC in 2 hours", NOON), { after: POOL_DEFAULT.after, at: unix(NOON) + 7_200, pair: "USDC", ladder: false });
  assert.equal(poolChoiceOf("launch $A into a pool with a ladder", NOON).ladder, true);
  assert.deepEqual(poolChoiceOf("launch $A into a pool", NOON), POOL_DEFAULT);
});

/* ------------------------------------------------------------------ the door */

test("the door is behind two locks, both shut by default: the deployment's switch, and mainnet's own constant", () => {
  assert.equal(CITY_POOL_SWITCH, false, "no deployment opened it here");
  assert.equal(CITY_POOL_MAINNET, true, "mainnet is opened in code");
  assert.equal(poolDoorOpen("solana:mainnet"), false, "the deployment's switch is still shut");
  assert.equal(poolDoorOpen("solana:mainnet", true), true, "the switch over the constant opens mainnet");
  assert.equal(poolDoorOpen("solana:devnet"), false, "the switch is shut");
  assert.equal(poolDoorOpen("solana:devnet", true), true);
  assert.equal(poolDoorOpen("solana:mainnet", true, false), false, "the switch alone does not open mainnet");
  assert.equal(poolDoorOpen("solana:mainnet", true, true), true);
  assert.equal(poolDoorOpen(null, true, true), false);
});

test("a choice opens at its wait, or at the moment a sentence named while that is still far enough ahead", () => {
  const now = 1_800_000_000;
  assert.deepEqual([...POOL_AFTER], [900, 3_600, 21_600]);
  assert.equal(poolOpensAt(POOL_DEFAULT, now), now + 900);
  assert.equal(poolOpensAt({ after: 3_600, at: null, pair: "SOL" }, now), now + 3_600);
  assert.equal(poolOpensAt({ after: 900, at: now + 7_200, pair: "SOL" }, now), now + 7_200);
  /* A named moment the three steps no longer fit before falls back to the wait — the review shows that time. */
  assert.equal(poolOpensAt({ after: 900, at: now + 100, pair: "SOL" }, now), now + 900);
  assert.equal(poolOpensAt({ after: 900, at: now + 40 * 86_400, pair: "SOL" }, now), now + 900);
  assert.equal(poolOpensAt({ after: 10, at: null, pair: "SOL" }, now), now + 300, "never closer than the format's least");
});

test("a countdown reads as a clock, and the shield as what is left of the fee", () => {
  assert.equal(countdown(724), "12:04");
  assert.equal(countdown(59), "0:59");
  assert.equal(countdown(3_723), "1:02:03");
  assert.equal(countdown(2 * 86_400 + 5), "2 d");
  assert.equal(countdown(-5), "0:00");
  assert.equal(shieldLeft({ startBps: 5_000, endBps: 100.13, nowBps: 5_000 }), 1);
  assert.equal(shieldLeft({ startBps: 5_000, endBps: 100.13, nowBps: 100.13 }), 0);
  assert.ok(Math.abs(shieldLeft({ startBps: 5_000, endBps: 100.13, nowBps: 1_292 }) - 0.2432) < 0.001);
  assert.equal(shieldLeft({ startBps: 5_000, endBps: 100.13, nowBps: null }), null, "not read is not zero");
  assert.equal(shieldLeft({ startBps: 5_000, endBps: null, nowBps: 5_000 }), 1);
  assert.equal(phaseAt({ phase: "BUILDING", opensAt: 10 }, 99), "BUILDING");
  assert.equal(phaseAt({ phase: "COUNTDOWN", opensAt: 100 }, 99), "COUNTDOWN");
  assert.equal(phaseAt({ phase: "COUNTDOWN", opensAt: 100 }, 100), "OPEN", "the list is read every half a minute; the clock opens the tower on time");
});

/* ------------------------------------------------------------------ the bytes */

const creator = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const pool = Keypair.generate().publicKey;
const nft = Keypair.generate().publicKey;
const DLMM = new PublicKey(DLMM_PRO_PROGRAM_ID);
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const wire = (instructions, payer = creator) => {
  const tx = new Transaction({ feePayer: payer, recentBlockhash: mint.toBase58() }).add(...instructions);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
};
const coinIx = () => SystemProgram.createAccount({ fromPubkey: creator, newAccountPubkey: mint, lamports: 4_000_000, space: 300, programId: TOKEN_2022 });
const poolIx = (signer = null) => new TransactionInstruction({ programId: DLMM, data: Buffer.from([1, 2, 3]), keys: [{ pubkey: pool, isSigner: false, isWritable: true }, { pubkey: creator, isSigner: true, isWritable: true }, ...(signer ? [{ pubkey: signer, isSigner: true, isWritable: true }] : [])] });
const args = (stage, wires) => ({ wires, stage, creator: creator.toBase58(), mint: mint.toBase58(), pool: pool.toBase58() });

test("the city's own read lets through a step that is the launch's, in its own shape", () => {
  assert.deepEqual(checkPoolStep(args("COIN", [wire([coinIx()])])), { ok: true });
  assert.deepEqual(checkPoolStep(args("POOL", [wire([SystemProgram.transfer({ fromPubkey: creator, toPubkey: pool, lamports: 1 }), poolIx()])])), { ok: true });
  assert.deepEqual(checkPoolStep(args("SUPPLY", [wire([poolIx(nft)]), wire([poolIx(nft)]), wire([poolIx()])])), { ok: true });
  /* The coin gives its authorities up; the supply hands one NFT over. */
  const up = new TransactionInstruction({ programId: TOKEN_2022, data: Buffer.from([6, 0, 0]), keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: creator, isSigner: true, isWritable: false }] });
  assert.deepEqual(checkPoolStep(args("COIN", [wire([coinIx(), up])])), { ok: true });
  const one = Buffer.alloc(10);
  one[0] = 12;
  one.writeBigUInt64LE(1n, 1);
  const handOver = new TransactionInstruction({ programId: TOKEN_2022, data: one, keys: [{ pubkey: creator, isSigner: true, isWritable: true }] });
  const split = (wires) => ({ ...args("SUPPLY", wires), handOvers: 1 });
  assert.deepEqual(checkPoolStep(split([wire([poolIx(nft)]), wire([poolIx(nft)]), wire([handOver, poolIx()])])), { ok: true });
  /* The supply's last transaction alone — the hand-over — calls no pool, and is the supply's all the same. */
  const back = new TransactionInstruction({ programId: TOKEN_2022, data: Buffer.from([9]), keys: [{ pubkey: nft, isSigner: false, isWritable: true }, { pubkey: creator, isSigner: false, isWritable: true }, { pubkey: creator, isSigner: true, isWritable: false }] });
  assert.deepEqual(checkPoolStep(split([wire([handOver, back])])), { ok: true });
  /* One hand-over, and only where the launch has the split: a second NFT handed out — the ladder's — is not Ryntra's position. */
  assert.equal(checkPoolStep(split([wire([poolIx(nft)]), wire([handOver, poolIx()]), wire([handOver, poolIx()])])).ok, false);
  assert.equal(checkPoolStep(args("SUPPLY", [wire([poolIx(nft)]), wire([handOver, poolIx()])])).ok, false, "no split, no hand-over");
  assert.equal(checkPoolStep({ ...args("POOL", [wire([handOver, poolIx()])]), handOvers: 1 }).ok, false, "never in the pool's step");
  assert.equal(checkPoolStep({ ...split([wire([handOver, back])]), handOvers: 5 }).ok, true, "and never more than one, whatever is asked");
  assert.equal(checkPoolStep({ ...split([wire([handOver, handOver])]), handOvers: 5 }).ok, false);
});

test("and stops whatever is not: another payer, another signer, another program, SOL that leaves, another launch", () => {
  const stranger = Keypair.generate().publicKey;
  const refuses = (stage, wires) => assert.equal(checkPoolStep(args(stage, wires)).ok, false, `${stage}`);
  refuses("COIN", []);
  refuses("COIN", ["not base64 of a transaction"]);
  refuses("COIN", [wire([coinIx()], stranger)]);
  /* The first step makes another coin's account, or moves SOL beside it. */
  refuses("COIN", [wire([SystemProgram.createAccount({ fromPubkey: creator, newAccountPubkey: nft, lamports: 4_000_000, space: 300, programId: TOKEN_2022 })])]);
  refuses("COIN", [wire([coinIx(), SystemProgram.transfer({ fromPubkey: creator, toPubkey: stranger, lamports: 5_000_000_000 })])]);
  refuses("COIN", [wire([coinIx(), poolIx()])]);
  /* The coin's account given more SOL than a mint's rent, or made for another program. */
  refuses("COIN", [wire([SystemProgram.createAccount({ fromPubkey: creator, newAccountPubkey: mint, lamports: 2_000_000_000, space: 300, programId: TOKEN_2022 })])]);
  refuses("COIN", [wire([SystemProgram.createAccount({ fromPubkey: creator, newAccountPubkey: mint, lamports: 4_000_000, space: 300, programId: stranger })])]);
  /* Token instructions that move or hand out the creator's tokens, at the top level of any step. */
  const token = (data, program = TOKEN_2022) => new TransactionInstruction({ programId: program, data: Buffer.from(data), keys: [{ pubkey: creator, isSigner: true, isWritable: true }, { pubkey: pool, isSigner: false, isWritable: true }] });
  const u64 = (value) => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(value);
    return [...bytes];
  };
  const LEGACY = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  refuses("POOL", [wire([poolIx(), token([3, ...u64(1_000_000n)], LEGACY)])]);
  refuses("POOL", [wire([poolIx(), token([4, ...u64(1_000_000n)], LEGACY)])]);
  refuses("SUPPLY", [wire([poolIx(), token([13, ...u64(5n), 6])])]);
  refuses("SUPPLY", [wire([poolIx(), token([12, ...u64(5_000_000n), 6])])]);
  refuses("COIN", [wire([coinIx(), token([6, 0, 1, ...stranger.toBytes()])])]);
  refuses("SUPPLY", [wire([poolIx(), token([26, 1, ...u64(5n), 6, ...u64(0n)])])]);
  /* An account closed into another wallet, a burn. */
  refuses("POOL", [wire([poolIx(), new TransactionInstruction({ programId: LEGACY, data: Buffer.from([9]), keys: [{ pubkey: pool, isSigner: false, isWritable: true }, { pubkey: stranger, isSigner: false, isWritable: true }, { pubkey: creator, isSigner: true, isWritable: false }] })])]);
  refuses("SUPPLY", [wire([poolIx(), token([8, ...u64(5n)])])]);
  /* A second signer on the pool's creation is only ever the config's own wallet, where one is named. */
  refuses("POOL", [wire([poolIx(stranger)])]);
  assert.deepEqual(checkPoolStep({ ...args("POOL", [wire([poolIx(stranger)])]), poolSigner: stranger.toBase58() }), { ok: true });
  /* The pool's creation asks for a second signature, or drains SOL, or calls something else. */
  refuses("POOL", [wire([poolIx(nft)])]);
  refuses("POOL", [wire([poolIx(), SystemProgram.transfer({ fromPubkey: creator, toPubkey: stranger, lamports: Number(MAX_PROOF_LAMPORTS) + 1 })])]);
  refuses("POOL", [wire([poolIx(), new TransactionInstruction({ programId: stranger, data: Buffer.alloc(1), keys: [{ pubkey: creator, isSigner: true, isWritable: true }] })])]);
  /* A call of DLMM Pro that does not name the launch's pool is not this launch's; a pool step that makes no pool neither. */
  refuses("SUPPLY", [wire([new TransactionInstruction({ programId: DLMM, data: Buffer.alloc(1), keys: [{ pubkey: creator, isSigner: true, isWritable: true }] })])]);
  refuses("POOL", [wire([SystemProgram.transfer({ fromPubkey: creator, toPubkey: pool, lamports: 1 })])]);
  refuses("SUPPLY", [wire([poolIx()]), wire([poolIx()]), wire([poolIx()]), wire([poolIx()]), wire([poolIx()])]);
});

/* ------------------------------------------------------------------ the flow */

const CREATOR = Keypair.generate().publicKey.toBase58();
function stand(overrides = {}) {
  let clock = 1_800_000_000_000;
  const now = () => clock;
  const pool = stubPoolEngine({ now });
  const calls = [];
  const engine = { metadata: async (body) => (calls.push("metadata"), { ok: true, data: { name: body.name, symbol: body.symbol, metadataUri: `https://ryntra.io/api/launch/metadata/${"a".repeat(64)}`, imageUri: "", image: "" } }) };
  const phases = [];
  const signed = [];
  const signer = { wallet: "Test wallet", address: CREATOR, sign: async (wires) => (signed.push(wires.length), overrides.sign ? overrides.sign(wires, signed.length) : { ok: true, signed: wires }) };
  const run = (extra = {}) =>
    runPoolLaunch({ engine, pool: { ...pool, ...(overrides.pool ?? {}) }, signer, fields: { name: "Kite", symbol: "KITE", picture: { base64: "AA==", url: "blob:kite" } }, network: "solana:devnet", choice: { after: 3_600, at: null, pair: "SOL", ladder: false, ...(overrides.choice ?? {}) }, onPhase: (phase) => phases.push(phase), now, switchOpen: true, poolSwitch: true, wait: async (ms) => void (clock += ms), ...extra });
  return { pool, run, phases, signed, calls, advance: (ms) => (clock += ms), now };
}

test("three approvals from the press to the pool: the coin, the pool, the supply — each named, then the launch set", async () => {
  const s = stand();
  const done = await s.run();
  assert.equal(done.step, "pooled", JSON.stringify(done));
  assert.deepEqual(s.signed, [1, 1, 3], "the wallet is asked three times: one transaction, one, three");
  assert.deepEqual(s.phases.filter((phase) => phase.step === "sign").map((phase) => phase.pool.stage), ["COIN", "POOL", "SUPPLY"]);
  assert.deepEqual(s.phases.filter((phase) => phase.step === "send").map((phase) => phase.pool.stage), ["COIN", "POOL", "SUPPLY"]);
  assert.equal(done.pooled.opensAt, Math.floor(s.now() / 1000) + 3_600, "trading opens when the review said");
  assert.equal(done.pooled.symbol, "KITE");
  assert.deepEqual(s.calls, ["metadata"], "the details are stored once");
  const view = await s.pool.view(done.pooled.mint);
  assert.equal(view.data.next, null);
  assert.equal(view.data.phase, "COUNTDOWN");
  /* The cost shown at each prompt is what is left of the whole launch. */
  const costs = s.phases.filter((phase) => phase.step === "sign").map((phase) => Number(phase.costLamports));
  assert.ok(costs[0] > costs[1] && costs[1] > costs[2] && costs[2] > 0, JSON.stringify(costs));
});

test("with the creator's ladder the supply's step is one transaction more, and the tower reads the ladder resting", async () => {
  const s = stand({ choice: { ladder: true } });
  const done = await s.run();
  assert.equal(done.step, "pooled", JSON.stringify(done));
  assert.deepEqual(s.signed, [1, 1, 4], "the supply: two positions, the hand-over and the ladder");
  const view = await s.pool.view(done.pooled.mint);
  assert.equal(view.data.ladder.state, "RESTING");
  assert.equal(view.data.ladder.leftRaw, view.data.ladder.amountRaw, "the whole ladder rests before the opening");
  assert.deepEqual({ near: view.data.ladder.nearMultiple, far: view.data.ladder.farMultiple, share: view.data.ladder.shareBps }, { near: 2, far: 10, share: 500 });
  /* A ladder told on other terms than the review showed is not signed for. */
  const odd = stand({ choice: { ladder: true } });
  const shifted = { ...odd.pool, build: async (body) => odd.pool.build(body).then((answer) => (answer.ok && answer.data.ladder ? { ok: true, data: { ...answer.data, ladder: { ...answer.data.ladder, nearMultiple: 1.2 } } } : answer)) };
  const refusedOdd = await odd.run({ pool: shifted });
  assert.equal(refusedOdd.failure?.code, "CITY_BUILD_UNEXPECTED");
  assert.deepEqual(odd.signed, []);
  /* An engine that builds a ladder the review did not show is not signed for. */
  const other = stand();
  const pool = { ...other.pool, build: async (body) => other.pool.build({ ...body, ...(body.mint ? {} : { ladder: true }) }) };
  const stopped = await other.run({ pool });
  assert.deepEqual({ step: stopped.step, code: stopped.failure?.code }, { step: "failed", code: "CITY_BUILD_UNEXPECTED" });
  assert.deepEqual(other.signed, [], "the wallet was never opened");
});

test("with the reward for the pool's liquidity the supply's step is one transaction more, the city's read lets it through, and the review's terms are held", async () => {
  const s = stand({ choice: { ladder: true, reward: { shareBps: 200, days: 30 } } });
  const done = await s.run();
  assert.equal(done.step, "pooled", JSON.stringify(done));
  assert.deepEqual(s.signed, [1, 1, 5], "the supply: two positions, the hand-over, the ladder and the reward");
  const view = await s.pool.view(done.pooled.mint);
  assert.deepEqual({ share: view.data.reward.shareBps, days: view.data.reward.days, state: view.data.reward.state }, { share: 200, days: 30, state: "WAITING" });
  assert.equal(view.data.reward.endsAt - view.data.reward.opensAt, 30 * 86_400);
  /* A reward told on other terms than the review showed is not signed for. */
  const odd = stand({ choice: { reward: { shareBps: 200, days: 30 } } });
  const shifted = { ...odd.pool, build: async (body) => odd.pool.build(body).then((answer) => (answer.ok && answer.data.reward ? { ok: true, data: { ...answer.data, reward: { ...answer.data.reward, shareBps: 1_000 } } } : answer)) };
  assert.equal((await odd.run({ pool: shifted })).failure?.code, "CITY_BUILD_UNEXPECTED");
  assert.deepEqual(odd.signed, []);
  /* An engine that builds a reward the review did not show is not signed for. */
  const other = stand();
  const pool = { ...other.pool, build: async (body) => other.pool.build({ ...body, ...(body.mint ? {} : { reward: { shareBps: 100, days: 7 } }) }) };
  assert.equal((await other.run({ pool })).failure?.code, "CITY_BUILD_UNEXPECTED");
  assert.deepEqual(other.signed, [], "the wallet was never opened");
  /* Five transactions in the supply's step only where the launch pays a reward. */
  const five = [wire([poolIx(nft)]), wire([poolIx(nft)]), wire([poolIx()]), wire([poolIx()]), wire([poolIx()])];
  assert.equal(checkPoolStep({ ...args("SUPPLY", five), reward: true }).ok, true);
  assert.equal(checkPoolStep(args("SUPPLY", five)).ok, false);
  assert.equal(checkPoolStep({ ...args("SUPPLY", [...five, wire([poolIx()])]), reward: true }).ok, false, "never six");
  assert.equal(checkPoolStep({ ...args("POOL", [wire([poolIx()]), wire([poolIx()]), wire([poolIx()]), wire([poolIx()]), wire([poolIx()])]), reward: true }).ok, false, "never in the pool's step");
});

test("shut doors launch nothing: the city's switch, mainnet's constant, the launch district itself", async () => {
  for (const extra of [{ poolSwitch: false }, { network: "solana:mainnet", poolWord: false }, { switchOpen: false }]) {
    const s = stand();
    const stopped = await s.run(extra);
    assert.deepEqual({ step: stopped.step, code: stopped.failure?.code }, { step: "failed", code: "CITY_LAUNCH_CLOSED" }, JSON.stringify(extra));
    assert.deepEqual(s.signed, []);
    assert.deepEqual(s.calls, []);
  }
});

test("a refusal before the coin is a launch that never began; after it, the launch waits half-way and is taken up — never minted twice", async () => {
  /* The wallet says no to the first step: nothing landed. */
  const first = stand({ sign: () => ({ ok: false, reason: "User rejected the request." }) });
  const declined = await first.run();
  assert.deepEqual({ code: declined.failure.code, stage: declined.failure.stage, token: declined.failure.token }, { code: "WALLET_REFUSED", stage: "before", token: null });

  /* The wallet says no to the second step: the coin is on chain — said as half-way, with its coin to continue from. */
  const second = stand({ sign: (wires, nth) => (nth === 2 ? { ok: false, reason: "User rejected the request." } : { ok: true, signed: wires }) });
  const half = await second.run();
  assert.equal(half.failure.code, POOL_HALF_WAY);
  assert.equal(half.failure.stage, "send");
  const mint = half.failure.token;
  assert.match(mint, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal((await second.pool.view(mint)).data.next, "POOL");
  /* «Continue»: the same flow with the coin — two approvals left, no details stored again, no second coin. */
  const before = second.signed.length;
  const resumed = stand({ pool: second.pool });
  const finished = await resumed.run({ resume: mint });
  assert.equal(finished.step, "pooled", JSON.stringify(finished));
  assert.equal(finished.pooled.mint, mint);
  assert.deepEqual(resumed.signed, [1, 3], "the pool and the supply");
  assert.deepEqual(resumed.calls, [], "nothing is stored or minted again");
  assert.equal(before, 2);
  assert.equal((await second.pool.list()).data.launches.filter((launch) => launch.creator === CREATOR).length, 1);
});

test("bytes the review did not show never reach the wallet", async () => {
  const s = stand();
  const stopped = await s.run({ check: () => ({ ok: false, reason: "The step calls a program the launch is not made of." }) });
  assert.deepEqual({ step: stopped.step, code: stopped.failure.code }, { step: "failed", code: "CITY_BUILD_UNEXPECTED" });
  assert.deepEqual(s.signed, [], "the wallet was never opened");
  /* An engine that answers with another opening time than the review showed is not signed for either. */
  const moved = stand();
  const pool = { ...moved.pool, build: async (body) => moved.pool.build(body).then((answer) => (answer.ok ? { ok: true, data: { ...answer.data, opensAt: answer.data.opensAt + 60 } } : answer)) };
  const other = await runPoolLaunch({ engine: { metadata: async () => ({ ok: true, data: { name: "Kite", symbol: "KITE", metadataUri: "https://ryntra.io/api/launch/metadata/x" } }) }, pool, signer: { wallet: "w", address: CREATOR, sign: async () => assert.fail("the wallet was opened") }, fields: { name: "Kite", symbol: "KITE", picture: { base64: "", url: "" } }, network: "solana:devnet", choice: POOL_DEFAULT, onPhase: () => undefined, switchOpen: true, poolSwitch: true });
  assert.equal(other.failure.code, "CITY_BUILD_UNEXPECTED");
});

/* ------------------------------------------------------------------ the towers */

const SOL_MINT = "So11111111111111111111111111111111111111112";
const listed = (over = {}) => ({ mint: "MintA", pool: "PoolA", creator: "CreatorA", name: "Night Glow", symbol: "GLOW", metadataUri: "", pair: "SOL", opensAt: 2_000, phase: "COUNTDOWN", createdAt: "2026-11-15T10:00:00.000Z", ...over });
const base = { towers: [{ id: SOL_MINT, symbol: "SOL", name: "Solana", icon: null, district: "strip", price: 150, mcap: 1, liquidity: 1, holders: 1, change5m: 0, change1h: 0, change24h: 0, volume24h: 0, traders1h: 0, organic: 0, verified: true, launchedAt: null }], fetchedAt: "", source: "live" };

test("a launch into a pool stands in the docks at its own price — in dollars only where the pair's dollar price is known", () => {
  const start = poolTowerOf(listed(), undefined, 150);
  assert.equal(start.district, "docks");
  assert.ok(Math.abs(start.mcap - 30 * 150) < 1e-6, "thirty SOL of market cap at the first price");
  assert.equal(start.verified, false, "only Jupiter verifies a coin");
  const grown = poolTowerOf(listed(), { price: { start: 3e-8, now: 6e-8 } }, 150);
  assert.ok(Math.abs(grown.mcap - 60 * 150) < 1e-6);
  const unread = poolTowerOf(listed(), undefined, null);
  assert.equal(unread.mcap, 0);
  assert.ok(unread.unread.includes("mcap") && unread.unread.includes("price"), "SOL's price not read: named unread, never guessed");
  assert.ok(Math.abs(poolTowerOf(listed({ pair: "USDC" }), undefined, null).mcap - 5_000) < 1e-6, "a dollar is a dollar");
});

test("a launch still being built is its creator's alone to see; the rest join the city beside its own towers", () => {
  const launches = [listed(), listed({ mint: "MintB", phase: "BUILDING", creator: "CreatorB" })];
  assert.deepEqual(shownPools(launches, null, 1_000).map((launch) => launch.mint), ["MintA"]);
  assert.deepEqual(shownPools(launches, "CreatorB", 1_000).map((launch) => launch.mint), ["MintA", "MintB"]);
  const city = withPoolLaunches(base, launches, {}, null, 1_000);
  assert.deepEqual(city.towers.map((tower) => tower.id), [SOL_MINT, "MintA"]);
  assert.equal(withPoolLaunches(base, [], {}, null, 1_000), base, "no launch: the very same city");
  assert.notEqual(poolTowersKey(launches, {}, null, 1_000), poolTowersKey(launches, {}, "CreatorB", 1_000));
  assert.equal(poolTowersKey(launches, {}, null, 1_000), poolTowersKey(launches, {}, null, 1_500), "a second that changes nothing leaves the skyline alone");
});

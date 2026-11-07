import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { createSyncNativeInstruction, createTransferInstruction, getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { BLOCKHASH_SUBMIT_MARGIN_MS, MAX_SIGNABLE_WINDOW_MS, resetMsPerSlotCache } from "../../solana/blockhash-life.ts";
import { binsFrom, networkFeeOf, parseReviewInput, redacted, reviewLiquidityAction, submitLiquidityAction } from "./actions.ts";
import { LiquidityRefusal } from "./contract.ts";
import { createDammV2Venue, DAMM_V2_PROGRAM } from "./damm-v2.ts";
import { createDlmmVenue, DLMM_PROGRAM } from "./dlmm.ts";
import { admitLiquidityAction, CANARY_MAX_DEPOSIT_USD, depositUsd, liquidityActionStates, liquidityGateMode } from "./gate.ts";
import { replayConnection } from "./rpc-cassette.ts";
import { builtCallsOnly, checkSigned, issueTicket, messageDigest, openCosigners, readTicket, sealCosigners, TICKET_TTL_MS, withoutSignaturesOf } from "./ticket.ts";
import { DAMM_V2_SCENARIO, DLMM_SCENARIO, dlmmSdkFromCommonJs, fixedKeypair } from "./fixtures/scenarios.mjs";

const require = createRequire(import.meta.url);
const tape = (name) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.tape.json.gz`, import.meta.url))).toString("utf8"));
const DLMM_TAPE = tape("dlmm");
const DAMM_TAPE = tape("damm-v2");
const DLMM_SDK = dlmmSdkFromCommonJs(require("@meteora-ag/dlmm"));

const KEY = "a-test-key-that-is-long-enough";
const OWNER = Keypair.generate();
const OWNER_ADDRESS = OWNER.publicKey.toBase58();
const STRANGER = Keypair.generate().publicKey.toBase58();
const POOL = DLMM_SCENARIO.pool;
const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

const open = { RYNTRA_LIQUIDITY_ACTIONS: "OPEN", BETA_TOKEN_SECRET: KEY };
const canary = { RYNTRA_LIQUIDITY_ACTIONS: "CANARY", RYNTRA_LIQUIDITY_CANARY_WALLET: OWNER_ADDRESS, BETA_TOKEN_SECRET: KEY };

/* ------------------------------------------------------------------ gate */

test("the gate: closed unless set, a canary admits one wallet character for character, open admits all", () => {
  assert.equal(liquidityGateMode({}), "CLOSED");
  assert.equal(liquidityGateMode({ RYNTRA_LIQUIDITY_ACTIONS: "yes" }), "CLOSED");
  assert.equal(liquidityGateMode({ RYNTRA_LIQUIDITY_ACTIONS: " open " }), "OPEN");
  assert.deepEqual(admitLiquidityAction(OWNER_ADDRESS, {}), { ok: false, code: "ACTIONS_CLOSED" });
  assert.deepEqual(admitLiquidityAction(OWNER_ADDRESS, canary), { ok: true, mode: "CANARY", maxDepositUsd: CANARY_MAX_DEPOSIT_USD });
  assert.deepEqual(admitLiquidityAction(STRANGER, canary), { ok: false, code: "ACTIONS_CLOSED" });
  assert.deepEqual(admitLiquidityAction(OWNER_ADDRESS.toLowerCase(), canary), { ok: false, code: "ACTIONS_CLOSED" });
  assert.deepEqual(admitLiquidityAction(OWNER_ADDRESS, { RYNTRA_LIQUIDITY_ACTIONS: "CANARY" }), { ok: false, code: "ACTIONS_CLOSED" }, "a canary with no wallet admits nobody");
  assert.deepEqual(admitLiquidityAction(null, open), { ok: true, mode: "OPEN", maxDepositUsd: null });
  const stranger = liquidityActionStates(STRANGER, canary);
  assert.deepEqual(stranger.add, { status: "later", until: "after a live check" });
  assert.equal(stranger.maxDepositUsd, null);
  assert.deepEqual(liquidityActionStates(OWNER_ADDRESS, canary).claim, { status: "on" });
});

test("a deposit's dollars: only the sides that go in need a price", () => {
  const deposit = { x: { units: "1500000000", decimals: 9 }, y: { units: "0", decimals: 6 } };
  assert.equal(depositUsd(deposit, { x: 2, y: null }), 3);
  assert.equal(depositUsd(deposit, { x: null, y: 1 }), null);
  assert.equal(depositUsd({ x: deposit.x, y: { units: "2500000", decimals: 6 } }, { x: 2, y: 1 }), 5.5);
});

/* ---------------------------------------------------------------- ticket */

const sample = { owner: OWNER_ADDRESS, venue: "meteora-dlmm", action: "add", pool: POOL, position: STRANGER, messages: ["a".repeat(64)], cosign: null };

test("a ticket is read back only with the key that sealed it, whole and in time", () => {
  const sealed = issueTicket(sample, open, 1_000);
  const read = readTicket(sealed, open, 2_000);
  assert.equal(read.ok, true);
  assert.deepEqual({ ...read.ticket, issuedAt: 0, expiresAt: 0 }, { v: 1, ...sample, issuedAt: 0, expiresAt: 0 });
  assert.equal(read.ticket.expiresAt, 1_000 + TICKET_TTL_MS);
  assert.deepEqual(readTicket(sealed, open, 1_000 + TICKET_TTL_MS + 1), { ok: false, code: "TICKET_EXPIRED" });
  assert.deepEqual(readTicket(sealed, { BETA_TOKEN_SECRET: "another-key-long-enough" }, 2_000), { ok: false, code: "TICKET_INVALID" });
  const [payload, mac] = sealed.split(".");
  const doctored = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), owner: STRANGER })).toString("base64url");
  assert.deepEqual(readTicket(`${doctored}.${mac}`, open, 2_000), { ok: false, code: "TICKET_INVALID" });
  assert.equal(issueTicket(sample, { BETA_TOKEN_SECRET: "short" }), null, "no key, no ticket");
  assert.deepEqual(readTicket(sealed, {}, 2_000), { ok: false, code: "TICKET_INVALID" });
});

const LIGHTHOUSE = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

/** A transaction the wallet pays for, calling `program`; `extra` instructions after it (what a wallet adds); signed by the owner when `sign`. */
function wire(program = DLMM_PROGRAM, { payer = OWNER, sign = false, data = [1, 2, 3], extra = [] } = {}) {
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: BLOCKHASH });
  tx.add(new TransactionInstruction({ programId: new PublicKey(program), keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }], data: Buffer.from(data) }));
  for (const instruction of extra) tx.add(instruction);
  if (sign) tx.sign(payer);
  return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
}

test("signed bytes pass only when they are the Review's messages, in order, paid and signed by the wallet", () => {
  const unsigned = [wire(DLMM_PROGRAM, { data: [1] }), wire(DLMM_PROGRAM, { data: [2] })];
  const ticket = { v: 1, ...sample, messages: unsigned.map(messageDigest), issuedAt: 0, expiresAt: 1 };
  const signed = [wire(DLMM_PROGRAM, { data: [1], sign: true }), wire(DLMM_PROGRAM, { data: [2], sign: true })];
  const passed = checkSigned(ticket, signed);
  assert.equal(passed.ok, true);
  assert.equal(passed.signatures.length, 2);
  assert.match(passed.signatures[0], /^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
  assert.deepEqual(checkSigned(ticket, [signed[1], signed[0]]), { ok: false, code: "SIGNED_MISMATCH", index: 0 }, "the order is the Review's");
  assert.deepEqual(checkSigned(ticket, [signed[0]]), { ok: false, code: "SIGNED_MISMATCH", index: 1 });
  assert.deepEqual(checkSigned(ticket, [unsigned[0], signed[1]]), { ok: false, code: "NOT_SIGNED", index: 0 });
  assert.deepEqual(checkSigned(ticket, [wire(DLMM_PROGRAM, { data: [9], sign: true }), signed[1]]), { ok: false, code: "SIGNED_MISMATCH", index: 0 }, "other bytes than reviewed");
  const forged = Transaction.from(Buffer.from(signed[0], "base64"));
  forged.signatures[0].signature = Buffer.alloc(64, 7);
  assert.deepEqual(checkSigned(ticket, [forged.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), signed[1]]), { ok: false, code: "NOT_SIGNED", index: 0 });
});

test("what a wallet adds on signing: Lighthouse assertions and a priority under the ceiling pass; anything else does not", () => {
  const unsigned = [wire(DLMM_PROGRAM, { data: [1] })];
  const ticket = { v: 1, ...sample, messages: unsigned.map(messageDigest), issuedAt: 0, expiresAt: 1 };
  const assertion = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), keys: [{ pubkey: OWNER.publicKey, isSigner: false, isWritable: false }], data: Buffer.from([7, 0, 1]) });
  const priority = [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 })];
  assert.equal(checkSigned(ticket, [wire(DLMM_PROGRAM, { data: [1], sign: true, extra: [assertion, ...priority] })]).ok, true);
  const writing = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), keys: [], data: Buffer.from([0, 1]) });
  assert.equal(checkSigned(ticket, [wire(DLMM_PROGRAM, { data: [1], sign: true, extra: [writing] })]).code, "SIGNED_MISMATCH", "Lighthouse's memory writes are not assertions");
  const greedy = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000 })];
  assert.equal(checkSigned(ticket, [wire(DLMM_PROGRAM, { data: [1], sign: true, extra: greedy })]).code, "SIGNED_MISMATCH", "a priority above 0.005 SOL");
  const third = Keypair.generate();
  const signerAdded = new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), keys: [{ pubkey: third.publicKey, isSigner: true, isWritable: false }], data: Buffer.from([7]) });
  const withThird = Transaction.from(Buffer.from(wire(DLMM_PROGRAM, { data: [1], extra: [signerAdded] }), "base64"));
  withThird.sign(OWNER, third);
  assert.equal(checkSigned(ticket, [withThird.serialize().toString("base64")]).code, "SIGNED_MISMATCH", "no signer the build did not name");
  const transfer = SystemProgram.transfer({ fromPubkey: OWNER.publicKey, toPubkey: new PublicKey(STRANGER), lamports: 1 });
  assert.equal(checkSigned(ticket, [wire(DLMM_PROGRAM, { data: [1], sign: true, extra: [transfer] })]).code, "SIGNED_MISMATCH", "a transfer slipped in");
});

test("a built transaction may call the venue and token plumbing only, paid by the wallet", () => {
  assert.deepEqual(builtCallsOnly(wire(DLMM_PROGRAM), OWNER_ADDRESS, DLMM_PROGRAM), { ok: true });
  assert.equal(builtCallsOnly(wire(DLMM_PROGRAM), STRANGER, DLMM_PROGRAM).ok, false, "paid by someone else");
  assert.equal(builtCallsOnly(wire(SystemProgram.programId.toBase58()), OWNER_ADDRESS, DLMM_PROGRAM).ok, false, "never calls the venue");
  assert.equal(builtCallsOnly(wire(DAMM_V2_PROGRAM), OWNER_ADDRESS, DLMM_PROGRAM).ok, false, "another program");
  const ownWsol = getAssociatedTokenAddressSync(NATIVE_MINT, OWNER.publicKey, true);
  const wrap = [SystemProgram.transfer({ fromPubkey: OWNER.publicKey, toPubkey: ownWsol, lamports: 5 }), createSyncNativeInstruction(ownWsol)];
  assert.deepEqual(builtCallsOnly(wire(DLMM_PROGRAM, { extra: wrap }), OWNER_ADDRESS, DLMM_PROGRAM), { ok: true }, "wrapping SOL into the wallet's own account");
  const away = SystemProgram.transfer({ fromPubkey: OWNER.publicKey, toPubkey: new PublicKey(STRANGER), lamports: 5 });
  assert.equal(builtCallsOnly(wire(DLMM_PROGRAM, { extra: [away] }), OWNER_ADDRESS, DLMM_PROGRAM).ok, false, "SOL to someone else");
  const spl = createTransferInstruction(ownWsol, new PublicKey(STRANGER), OWNER.publicKey, 5);
  assert.equal(builtCallsOnly(wire(DLMM_PROGRAM, { extra: [spl] }), OWNER_ADDRESS, DLMM_PROGRAM).ok, false, "a token transfer");
  const greedy = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000 })];
  assert.equal(builtCallsOnly(wire(DLMM_PROGRAM, { extra: greedy }), OWNER_ADDRESS, DLMM_PROGRAM).ok, false, "a priority the relay would refuse");
});

test("the adapters' real builds on recorded mainnet state pass the build check — DLMM add, remove, claim; DAMM v2 add, remove, claim", async () => {
  const dlmm = createDlmmVenue({ connection: replayConnection(DLMM_TAPE), sdk: DLMM_SDK, now: () => DLMM_TAPE.scenario.now, newKeypair: () => fixedKeypair(DLMM_SCENARIO.seed) });
  const d = DLMM_TAPE.scenario;
  const builds = [
    await dlmm.buildAdd(await dlmm.previewAdd({ pool: d.pool, owner: d.lp, amountX: d.amountX, amountY: d.amountY, bins: d.bins, shape: "spot", slippageBps: 100 })),
    await dlmm.buildRemove(await dlmm.previewRemove({ position: d.inRange, owner: d.lp, shareBps: 10_000, close: true, slippageBps: 100 })),
    await dlmm.buildClaim(await dlmm.previewClaim({ position: d.inRange, owner: d.lp })),
  ];
  for (const built of builds) for (const tx of built.transactions) assert.deepEqual(builtCallsOnly(tx.wireBase64, d.lp, DLMM_PROGRAM), { ok: true });
  for (const built of builds) for (const tx of built.transactions) assert.ok(networkFeeOf(tx.wireBase64) >= 5_000n);

  const damm = createDammV2Venue({ connection: replayConnection(DAMM_TAPE), now: () => DAMM_TAPE.scenario.now, newKeypair: () => fixedKeypair(DAMM_V2_SCENARIO.seed) });
  const m = DAMM_TAPE.scenario;
  const dammBuilds = [
    await damm.buildAdd(await damm.previewAdd({ pool: m.pool, owner: m.lp, position: m.unlocked, amountX: m.amountX, amountY: m.amountY, slippageBps: 100 })),
    await damm.buildRemove(await damm.previewRemove({ position: m.unlocked, owner: m.lp, shareBps: 5_000, slippageBps: 100 })),
    await damm.buildClaim(await damm.previewClaim({ position: m.unlocked, owner: m.lp })),
  ];
  for (const built of dammBuilds) for (const tx of built.transactions) assert.deepEqual(builtCallsOnly(tx.wireBase64, m.lp, DAMM_V2_PROGRAM), { ok: true });
});

/* ---------------------------------------------------------------- review */

test("the browser's body is read field by field", () => {
  const add = { action: "add", venue: "meteora-dlmm", request: { pool: POOL, owner: OWNER_ADDRESS, amountX: "10", amountY: "0", bins: { lower: -5, upper: 5 }, shape: "spot", slippageBps: 100 } };
  assert.equal(parseReviewInput(add).request.amountX, "10");
  assert.equal(parseReviewInput({ ...add, venue: "uniswap" }), null);
  assert.equal(parseReviewInput({ ...add, request: { ...add.request, amountX: "1.5" } }), null, "base units only");
  assert.equal(parseReviewInput({ ...add, request: { ...add.request, shape: "flat" } }), null);
  assert.equal(parseReviewInput({ ...add, request: { ...add.request, owner: "not a key" } }), null);
  assert.equal(parseReviewInput({ action: "remove", venue: "meteora-damm2", request: { position: STRANGER, owner: OWNER_ADDRESS, shareBps: 0, slippageBps: 100 } }), null);
  assert.equal(parseReviewInput({ action: "claim", venue: "meteora-damm2", request: { position: STRANGER, owner: OWNER_ADDRESS } }).action, "claim");
  assert.equal(parseReviewInput({ action: "swap", venue: "meteora-dlmm", request: add.request }), null);
});

const amount = (units, decimals) => ({ units, decimals, asset: "x" });

/** A venue that answers from memory: one add, one claim, building `wires`. */
function fakeVenue({ wires = [wire(DLMM_PROGRAM)], refuse = null, deposit = { x: amount("1000000000", 9), y: amount("0", 6) } } = {}) {
  const preview = (action, request) => ({ action, venue: "meteora-dlmm", pool: POOL, request, fees: [], rent: [], transactions: wires.length, notices: [], price: "150", at: 0, expiresAt: 1, deposit, claimed: { x: amount("1", 9), y: amount("1", 6) } });
  const built = (p) => ({ preview: p, transactions: wires.map((wireBase64) => ({ wireBase64, presigned: [] })), feePayer: OWNER_ADDRESS, validUntil: "1", position: STRANGER });
  const guard = () => {
    if (refuse) throw new LiquidityRefusal(refuse, "refused");
  };
  const asked = [];
  return {
    asked,
    program: DLMM_PROGRAM,
    async pool() { return { shape: { kind: "bins", activeBin: 100, binStepBps: 4 } }; },
    async previewAdd(request) { guard(); asked.push(request); return preview("add", request); },
    async buildAdd(p) { return built(p); },
    async previewClaim(request) { guard(); return preview("claim", request); },
    async buildClaim(p) { return built(p); },
    async previewRemove(request) { guard(); return preview("remove", request); },
    async buildRemove(p) { return built(p); },
  };
}

function fakeConnection({ simulation = null, send = null, statuses = [] } = {}) {
  const sent = [];
  let polled = 0;
  return {
    sent,
    async simulateTransaction() {
      if (simulation instanceof Error) throw simulation;
      return { value: { err: simulation, logs: [] } };
    },
    async sendRawTransaction(bytes) {
      sent.push(Buffer.from(bytes).toString("base64"));
      if (send) send(sent.length - 1);
      return "sig";
    },
    async getSignatureStatuses() {
      const status = statuses.length ? statuses[Math.min(polled, statuses.length - 1)] : { confirmationStatus: "confirmed", err: null };
      polled += 1;
      return { value: [status] };
    },
  };
}

const depsWith = (env, { venue = fakeVenue(), connections = [fakeConnection()], prices = { x: 3, y: 1 }, forgot = [] } = {}) => ({
  env,
  connections,
  venuesFor: () => ({ "meteora-dlmm": venue, "meteora-damm2": venue }),
  pricesOf: async () => ({ xMint: "x", yMint: "x", ...prices }),
  forget: (owner) => forgot.push(owner),
  pollMs: 1,
  relayMs: 2_000,
});

const addBody = (owner = OWNER_ADDRESS) => ({ action: "add", venue: "meteora-dlmm", request: { pool: POOL, owner, amountX: "1000000000", amountY: "0", bins: { lower: 1, upper: 10 }, shape: "spot", slippageBps: 100 } });

test("Review: closed for all by default, for strangers under the canary, and capped for the canary wallet", async () => {
  assert.equal((await reviewLiquidityAction(addBody(), depsWith({ BETA_TOKEN_SECRET: KEY }))).code, "ACTIONS_CLOSED");
  assert.equal((await reviewLiquidityAction(addBody(STRANGER), depsWith(canary))).code, "ACTIONS_CLOSED");
  const priced = await reviewLiquidityAction(addBody(), depsWith(canary, { prices: { x: 3, y: 1 } }));
  assert.equal(priced.ok, true);
  assert.equal(priced.value.depositUsd, 3);
  const over = await reviewLiquidityAction(addBody(), depsWith(canary, { prices: { x: CANARY_MAX_DEPOSIT_USD + 1, y: 1 } }));
  assert.deepEqual([over.status, over.code], [403, "CANARY_LIMIT"]);
  assert.equal((await reviewLiquidityAction(addBody(), depsWith(canary, { prices: { x: null, y: 1 } }))).code, "CANARY_UNPRICED");
  assert.equal((await reviewLiquidityAction(addBody(), depsWith({ RYNTRA_LIQUIDITY_ACTIONS: "OPEN" }))).code, "ACTIONS_UNAVAILABLE", "no key, no Review");
  assert.equal((await reviewLiquidityAction({ action: "add" }, depsWith(open))).code, "BAD_REQUEST");
});

test("Review: a sealed answer for exactly the built bytes; a venue's refusal, a foreign program or a failed simulation stops it", async () => {
  const reviewed = await reviewLiquidityAction(addBody(), depsWith(open, { prices: { x: 999, y: 1 } }));
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.value.depositUsd, null, "no ceiling when open, so no valuation");
  assert.equal(reviewed.value.networkFeeLamports, "5000");
  const ticket = readTicket(reviewed.value.ticket, open);
  assert.deepEqual(ticket.ticket.messages, reviewed.value.transactions.map((tx) => messageDigest(tx.wireBase64)));
  assert.equal(ticket.ticket.position, STRANGER);

  const notOwner = await reviewLiquidityAction({ action: "claim", venue: "meteora-dlmm", request: { position: STRANGER, owner: OWNER_ADDRESS } }, depsWith(open, { venue: fakeVenue({ refuse: "NOT_OWNER" }) }));
  assert.deepEqual([notOwner.status, notOwner.code], [403, "NOT_OWNER"]);
  const foreign = await reviewLiquidityAction(addBody(), depsWith(open, { venue: fakeVenue({ wires: [wire(SystemProgram.programId.toBase58())] }) }));
  assert.equal(foreign.code, "BUILD_REFUSED");
  const refused = await reviewLiquidityAction(addBody(), depsWith(open, { connections: [fakeConnection({ simulation: { InstructionError: [0, "Custom"] } })] }));
  assert.deepEqual([refused.status, refused.code], [422, "SIMULATION_FAILED"]);
});

test("Review: a DLMM range is counted from the active bin the server reads, not the page's", async () => {
  const venue = fakeVenue();
  const body = { ...addBody(), range: { place: "above", half: 5 } };
  delete body.request.bins;
  const reviewed = await reviewLiquidityAction(body, depsWith(open, { venue }));
  assert.equal(reviewed.ok, true);
  assert.deepEqual(venue.asked[0].bins, { lower: 101, upper: 111 });
  assert.deepEqual(binsFrom(100, { place: "below", half: 5 }), { lower: 89, upper: 99 });
  assert.equal(parseReviewInput({ ...body, range: { place: "above", half: 40 } }), null, "wider than one position");
});

test("Review: an endpoint's failure reaches the browser as a fixed sentence, its address only the log, redacted", async () => {
  const failing = fakeVenue();
  failing.previewAdd = async () => {
    throw new Error("request to https://rpc.example/?api-key=SECRET failed, reason: socket hang up");
  };
  const answer = await reviewLiquidityAction(addBody(), depsWith(open, { venue: failing }));
  assert.equal(answer.code, "UNAVAILABLE");
  assert.doesNotMatch(answer.reason, /SECRET|example/);
  assert.doesNotMatch(redacted(new Error("request to https://rpc.example/?api-key=SECRET failed")), /SECRET/);
});

test("Review: a canary price is the deposit's only for the mints the venue priced; a zero price is no price", async () => {
  const unmatched = { ...depsWith(canary), pricesOf: async () => ({ x: 1, y: 1, xMint: "another", yMint: "x" }) };
  assert.equal((await reviewLiquidityAction(addBody(), unmatched)).code, "CANARY_UNPRICED");
  assert.equal((await reviewLiquidityAction(addBody(), depsWith(canary, { prices: { x: 0, y: 1 } }))).code, "CANARY_UNPRICED");
});

test("Review: an endpoint that fails gives way to the next; a refusal does not", async () => {
  let asked = 0;
  const failing = fakeVenue();
  failing.previewAdd = async () => {
    asked += 1;
    throw new Error("fetch failed");
  };
  const second = fakeConnection();
  const venues = new Map([["a", failing], ["b", fakeVenue()]]);
  const first = fakeConnection();
  const deps = { ...depsWith(open), connections: [first, second], venuesFor: (c) => ({ "meteora-dlmm": c === first ? venues.get("a") : venues.get("b") }) };
  const reviewed = await reviewLiquidityAction(addBody(), deps);
  assert.equal(reviewed.ok, true);
  assert.equal(asked, 1);
});

/* ----------------------------------------------------------------- relay */

async function sealedPair(env = open, wires = [wire(DLMM_PROGRAM, { data: [1] }), wire(DLMM_PROGRAM, { data: [2] })]) {
  const reviewed = await reviewLiquidityAction(addBody(), depsWith(env, { venue: fakeVenue({ wires }) }));
  const signed = reviewed.value.transactions.map((tx) => {
    const t = Transaction.from(Buffer.from(tx.wireBase64, "base64"));
    t.partialSign(OWNER);
    return t.serialize().toString("base64");
  });
  return { ticket: reviewed.value.ticket, signed };
}

test("relay: the reviewed bytes are sent once each, in order, settled from the chain, and the wallet's positions are read again", async () => {
  const { ticket, signed } = await sealedPair();
  const connection = fakeConnection({ statuses: [null, { confirmationStatus: "processed", err: null }, { confirmationStatus: "confirmed", err: null }] });
  const forgot = [];
  const relayed = await submitLiquidityAction({ ticket, signed }, depsWith(open, { connections: [connection], forgot }));
  assert.equal(relayed.ok, true);
  assert.equal(relayed.value.settled, true);
  assert.deepEqual(relayed.value.results.map((r) => r.state), ["LANDED", "LANDED"]);
  assert.deepEqual(connection.sent, signed);
  assert.deepEqual(forgot, [OWNER_ADDRESS]);
});

test("relay: a failure stops the rest; a preflight refusal of the first means nothing moved", async () => {
  const { ticket, signed } = await sealedPair();
  const failing = fakeConnection({ statuses: [{ confirmationStatus: "confirmed", err: { InstructionError: [1, "Custom"] } }] });
  const relayed = await submitLiquidityAction({ ticket, signed }, depsWith(open, { connections: [failing] }));
  assert.deepEqual(relayed.value.results.map((r) => r.state), ["FAILED", "NOT_SENT"]);
  assert.equal(failing.sent.length, 1);
  assert.equal(relayed.value.settled, false);

  const again = fakeConnection({ send: () => { throw new Error("failed to send transaction: Transaction simulation failed: This transaction has already been processed"); } });
  const repeated = await submitLiquidityAction({ ticket, signed }, depsWith(open, { connections: [again] }));
  assert.deepEqual(repeated.value.results.map((r) => r.state), ["LANDED", "LANDED"], "the same bytes sent before are read from the chain, not called «nothing moved»");

  const preflight = fakeConnection({ send: () => { throw new Error("failed to send transaction: Transaction simulation failed: Error processing Instruction 1"); } });
  const refused = await submitLiquidityAction({ ticket, signed }, depsWith(open, { connections: [preflight] }));
  assert.deepEqual([refused.status, refused.code], [422, "SIMULATION_FAILED"]);
});

test("relay: other bytes, a doctored ticket, a closed gate or no answer in time", async () => {
  const { ticket, signed } = await sealedPair();
  assert.equal((await submitLiquidityAction({ ticket, signed: [signed[1], signed[0]] }, depsWith(open))).code, "SIGNED_MISMATCH");
  assert.equal((await submitLiquidityAction({ ticket: `${ticket}x`, signed }, depsWith(open))).code, "TICKET_INVALID");
  assert.equal((await submitLiquidityAction({ ticket, signed }, depsWith({ BETA_TOKEN_SECRET: KEY }))).code, "ACTIONS_CLOSED", "the gate is asked again at the relay");
  const silent = fakeConnection({ statuses: [null] });
  const late = await submitLiquidityAction({ ticket, signed }, { ...depsWith(open, { connections: [silent] }), relayMs: 20 });
  assert.deepEqual(late.value.results.map((r) => r.state), ["UNKNOWN", "NOT_SENT"], "no second send: the signature is read, and the rest wait");
  assert.equal(silent.sent.length, 1);
});

/* --------------------------------------------------- the wallet signs first */

/** A build that opens a position: the venue's instruction names a fresh key as a signer, and the build signed with it. */
function presignedBuild(fresh) {
  const tx = new Transaction({ feePayer: OWNER.publicKey, recentBlockhash: BLOCKHASH });
  tx.add(new TransactionInstruction({ programId: new PublicKey(DLMM_PROGRAM), keys: [{ pubkey: OWNER.publicKey, isSigner: true, isWritable: true }, { pubkey: fresh.publicKey, isSigner: true, isWritable: true }], data: Buffer.from([4]) }));
  tx.partialSign(fresh);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

test("a fresh key is sealed in the ticket, readable only with the server's key", () => {
  const fresh = Keypair.generate();
  const sealed = sealCosigners([{ index: 0, key: fresh }], open);
  assert.doesNotMatch(sealed, new RegExp(Buffer.from(fresh.secretKey).toString("base64").slice(0, 16)));
  const opened = openCosigners(sealed, open);
  assert.equal(opened[0].key.publicKey.toBase58(), fresh.publicKey.toBase58());
  assert.equal(openCosigners(sealed, { BETA_TOKEN_SECRET: "another-key-long-enough" }), null);
  assert.equal(openCosigners(`${sealed.slice(0, -2)}AA`, open), null, "a doctored seal is not opened");
  assert.deepEqual(openCosigners(null, open), []);
});

test("the wallet sees a new position's bytes signed by nobody; the relay adds the fresh key's signature after the wallet's", async () => {
  const fresh = Keypair.generate();
  const wire = presignedBuild(fresh);
  const venue = fakeVenue({ wires: [wire] });
  venue.buildAdd = async (p) => ({ preview: p, transactions: [{ wireBase64: wire, presigned: [fresh.publicKey.toBase58()] }], feePayer: OWNER_ADDRESS, validUntil: "1", position: fresh.publicKey.toBase58() });
  const deps = { ...depsWith(open, { venue }), takeFreshKey: (pk) => (pk === fresh.publicKey.toBase58() ? fresh : null) };
  const reviewed = await reviewLiquidityAction(addBody(), deps);
  assert.equal(reviewed.ok, true);
  const shown = Transaction.from(Buffer.from(reviewed.value.transactions[0].wireBase64, "base64"));
  assert.ok(shown.signatures.every((entry) => entry.signature === null || entry.signature.every((byte) => byte === 0)), "no signature on what the wallet sees");
  assert.deepEqual(reviewed.value.transactions[0].presigned, []);
  assert.equal(messageDigest(reviewed.value.transactions[0].wireBase64), messageDigest(wire), "the same message as built");

  shown.partialSign(OWNER);
  const walletSigned = shown.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const connection = fakeConnection();
  const relayed = await submitLiquidityAction({ ticket: reviewed.value.ticket, signed: [walletSigned] }, { ...deps, connections: [connection] });
  assert.equal(relayed.ok, true);
  const sent = Transaction.from(Buffer.from(connection.sent[0], "base64"));
  assert.equal(sent.verifySignatures(true), true, "both signatures real on the bytes sent");

  /* Phantom's path: the wallet adds an assertion and its own budget, a data limit among them, then signs. */
  const changed = Transaction.from(Buffer.from(reviewed.value.transactions[0].wireBase64, "base64"));
  changed.add(new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), keys: [{ pubkey: OWNER.publicKey, isSigner: false, isWritable: false }], data: Buffer.from([7, 1]) }));
  changed.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }));
  changed.add(new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data: Buffer.from([4, 0, 0, 0x40, 0]) }));
  changed.signatures = changed.signatures.map((entry) => ({ publicKey: entry.publicKey, signature: null }));
  changed.partialSign(OWNER);
  const phantomPath = fakeConnection();
  const relayedChanged = await submitLiquidityAction({ ticket: reviewed.value.ticket, signed: [changed.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64")] }, { ...deps, connections: [phantomPath] });
  assert.equal(relayedChanged.ok, true, "the fresh key signs over the message the wallet changed");
  assert.equal(Transaction.from(Buffer.from(phantomPath.sent[0], "base64")).verifySignatures(true), true);

  const noKey = await reviewLiquidityAction(addBody(), { ...deps, takeFreshKey: () => null });
  assert.equal(noKey.code, "BUILD_REFUSED", "a build whose fresh key is not held is not shown");
  const unsignedByWallet = await submitLiquidityAction({ ticket: reviewed.value.ticket, signed: [reviewed.value.transactions[0].wireBase64] }, { ...deps, connections: [fakeConnection()] });
  assert.equal(unsignedByWallet.code, "NOT_SIGNED", "the fresh key alone does not make bytes the wallet's");
});

test("emptying a signature keeps the message", () => {
  const fresh = Keypair.generate();
  const wire = presignedBuild(fresh);
  const emptied = withoutSignaturesOf(wire, [fresh.publicKey.toBase58()]);
  assert.equal(messageDigest(emptied), messageDigest(wire));
  const before = Transaction.from(Buffer.from(wire, "base64"));
  const after = Transaction.from(Buffer.from(emptied, "base64"));
  assert.deepEqual(after.serializeMessage(), before.serializeMessage(), "the message bytes do not change");
  assert.equal(after.signatures.find((e) => e.publicKey.equals(fresh.publicKey)).signature, null, "the fresh key's slot is empty");
});

/* AG-1: the bytes live as long as their blockhash; the Review's window and the ticket are read from the chain. */
const chainAt = (blocksLeft) => () => ({
  epochInfo: async () => ({ blockHeight: 1_000n - BigInt(blocksLeft), absoluteSlot: 9_000_000n }),
  performanceSamples: async () => [{ numSlots: 300n, samplePeriodSecs: 60 }],
});

test("Review (AG-1): the signable window and the ticket come from the bytes' blocks left, not a minute", async () => {
  resetMsPerSlotCache();
  const venue = fakeVenue();
  const built = venue.buildAdd;
  venue.buildAdd = async (p) => ({ ...(await built(p)), validUntil: "1000" });
  const deps = { ...depsWith(open, { venue }), chainReader: chainAt(100), now: () => 50_000 };
  const reviewed = await reviewLiquidityAction(addBody(), deps);
  assert.equal(reviewed.ok, true);
  /* 100 blocks × 200 ms = 20 s of life; the person signs inside 15 s, the ticket dies with the bytes. */
  assert.equal(reviewed.value.signableMs, 100 * 200 - BLOCKHASH_SUBMIT_MARGIN_MS);
  assert.equal(reviewed.value.expiresAt, 50_000 + reviewed.value.signableMs);
  const ticket = readTicket(reviewed.value.ticket, open, 50_000);
  assert.equal(ticket.ticket.expiresAt, 50_000 + 100 * 200);
  assert.deepEqual(readTicket(reviewed.value.ticket, open, 50_000 + 100 * 200 + 1), { ok: false, code: "TICKET_EXPIRED" });

  const dead = await reviewLiquidityAction(addBody(), { ...deps, chainReader: chainAt(-5) });
  assert.deepEqual([dead.status, dead.code], [503, "UNAVAILABLE"], "bytes already dead are never offered");
  resetMsPerSlotCache();
});

test("Review (AG-1): a tip the endpoint cannot give still seals no more than one life", async () => {
  resetMsPerSlotCache();
  const reviewed = await reviewLiquidityAction(addBody(), { ...depsWith(open), chainReader: () => ({ epochInfo: async () => { throw new Error("down"); }, performanceSamples: async () => [] }), now: () => 0 });
  assert.equal(reviewed.ok, true);
  assert.ok(reviewed.value.signableMs <= MAX_SIGNABLE_WINDOW_MS);
  assert.ok(readTicket(reviewed.value.ticket, open, 0).ticket.expiresAt <= TICKET_TTL_MS);
  resetMsPerSlotCache();
});

test("a Zap's shape: one the engine builds passes through, anything else is no request (CITY-210)", async () => {
  const { parseZapInput } = await import("./actions.ts");
  const key = "So11111111111111111111111111111111111111112";
  const body = (extra) => ({ action: "zap_in", venue: "meteora-dlmm", request: { pool: key, owner: key, amountIn: "100000000", half: 16, slippageBps: 100, ...extra } });
  assert.equal(parseZapInput(body({})).request.shape, undefined);
  assert.equal(parseZapInput(body({ shape: "curve" })).request.shape, "curve");
  assert.equal(parseZapInput(body({ shape: "bid_ask" })).request.shape, "bid_ask");
  assert.equal(parseZapInput(body({ shape: "wave" })), null);
  assert.equal(parseZapInput(body({ shape: 1 })), null);
});

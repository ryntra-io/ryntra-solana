import assert from "node:assert/strict";
import test from "node:test";

import { bandOf } from "../exposure.ts";
import { DESK, DESK_PAIRS, DESK_URL } from "./config.ts";
import { openDesk } from "./desk.ts";
import { COMPUTE_MAX, TRANSFER_HEAD, checkJoint, checkLeg, jointCompute, messageOf } from "./joint.ts";
import { DeskRefused, httpDesk, refusalCode } from "./link.ts";
import { FIRM_MAX_MS, canFill, checkQuote, firmLeft, makeQuote, outFor, quoteFromWire, quoteToWire, quotesPair } from "./quote.ts";
import { DeskError, PAID_READER, deskAbilities, swapAtDesk } from "./run.ts";
import { holdSlot, pickSlot, readySlot, releaseSlot, slotOf, spendSlot } from "./slots.ts";
import { DESK_STEPS, bandActionOf, bandOfWay, chooseWay, deskStep, lineOfWay, ringPair } from "./way.ts";

/* The private desk: a swap inside the ring — the person pays the desk's one-time address, the desk's address
   pays the person, two private transfers in one transaction. The facts the band says stay `exposure.ts`'s. */

const OWNER = "Own1111111111111111111111111111111111111111";
const DESK_A = "Desk111111111111111111111111111111111111111";
const DESK_B = "DeskB11111111111111111111111111111111111111";
const RING = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
const TREE = "777pvSTree111111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";
const SOL = SYSTEM;
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const CHAIN = "solana:devnet";
const PAIRS = [{ inMint: SOL, outMint: USDC }];
const TERMS = { spreadBps: 50, minInRaw: 1_000_000n, firmMs: 8_000, fillMs: 45_000, midMaxAgeMs: 10_000 };
/** 1 SOL buys 140 USDC at the middle. */
const MID = (at) => ({ inRaw: 1_000_000_000n, outRaw: 140_000_000n, at });
const ASK = { owner: OWNER, inMint: SOL, outMint: USDC, inRaw: 250_000_000n };

/* ---------------- quote ---------------- */

test("the price: the middle less the spread, rounded down — the desk never pays a unit more", () => {
  assert.equal(outFor(250_000_000n, MID(0), 0), 35_000_000n);
  assert.equal(outFor(250_000_000n, MID(0), 50), 34_825_000n, "0.5 % off");
  assert.equal(outFor(1n, { inRaw: 3n, outRaw: 2n, at: 0 }, 0), 0n, "a third of a unit is nothing");
  assert.equal(outFor(0n, MID(0), 0), 0n);
  assert.equal(outFor(5n, { inRaw: 0n, outRaw: 1n, at: 0 }, 0), 0n, "no middle, nothing");
});

test("a firm quote names the one-time address, the exact amount and a few seconds to take it", () => {
  const made = makeQuote({ ask: ASK, pairs: PAIRS, terms: TERMS, mid: MID(1_000), slot: { address: DESK_A, holds: 50_000_000n }, id: "q1", chain: CHAIN, now: 2_000 });
  assert.equal(made.ok, true);
  const q = made.quote;
  assert.equal(q.desk, DESK_A);
  assert.equal(q.inRaw, ASK.inRaw);
  assert.equal(q.outRaw, 34_825_000n);
  assert.equal(q.firmUntil, 10_000);
  assert.equal(q.fillUntil, 47_000);
  assert.equal(firmLeft(q, 4_000), 6_000);
  assert.equal(firmLeft(q, 20_000), 0);
  assert.equal(canFill(q, 47_000), true);
  assert.equal(canFill(q, 47_001), false);
});

test("the desk says why it quotes nothing — and the Swap then goes the route's way", () => {
  const base = { ask: ASK, pairs: PAIRS, terms: TERMS, mid: MID(1_000), slot: { address: DESK_A, holds: 50_000_000n }, id: "q", chain: CHAIN, now: 2_000 };
  const code = (over) => {
    const made = makeQuote({ ...base, ...over });
    return made.ok ? "ok" : made.code;
  };
  assert.equal(code({}), "ok");
  assert.equal(code({ ask: { ...ASK, outMint: SOL } }), "SAME");
  assert.equal(code({ pairs: [{ inMint: USDC, outMint: SOL }] }), "PAIR", "a pair is quoted one way");
  assert.equal(code({ ask: { ...ASK, inRaw: 10n } }), "SMALL");
  assert.equal(code({ mid: null }), "NO_PRICE");
  assert.equal(code({ mid: MID(-20_000) }), "STALE_PRICE");
  assert.equal(code({ mid: MID(9_000) }), "STALE_PRICE", "a price from the future is not believed either");
  assert.equal(code({ slot: { address: DESK_A, holds: 1n } }), "NO_STOCK");
  assert.equal(code({ slot: null }), "NO_STOCK");
  assert.equal(code({ terms: { ...TERMS, spreadBps: 900 } }), "TERMS");
  assert.equal(code({ terms: { ...TERMS, firmMs: FIRM_MAX_MS + 1 } }), "TERMS");
  assert.equal(quotesPair(PAIRS, { inMint: SOL, outMint: SOL }), false);
});

test("the person takes only the quote it asked for, on its network, still firm", () => {
  const q = makeQuote({ ask: ASK, pairs: PAIRS, terms: TERMS, mid: MID(1_000), slot: { address: DESK_A, holds: 50_000_000n }, id: "q", chain: CHAIN, now: 2_000 }).quote;
  assert.equal(checkQuote(q, ASK, CHAIN, 3_000), null);
  assert.equal(checkQuote({ ...q, inRaw: q.inRaw + 1n }, ASK, CHAIN, 3_000), "ASK");
  assert.equal(checkQuote({ ...q, owner: DESK_B }, ASK, CHAIN, 3_000), "ASK");
  assert.equal(checkQuote(q, ASK, "solana:mainnet", 3_000), "CHAIN");
  assert.equal(checkQuote({ ...q, desk: "not an address" }, ASK, CHAIN, 3_000), "DESK");
  assert.equal(checkQuote({ ...q, desk: OWNER }, ASK, CHAIN, 3_000), "DESK", "the person never pays itself");
  assert.equal(checkQuote({ ...q, outRaw: 0n }, ASK, CHAIN, 3_000), "NOTHING");
  assert.equal(checkQuote({ ...q, firmUntil: q.at + 60_000, fillUntil: q.at + 90_000 }, ASK, CHAIN, 3_000), "LONG");
  assert.equal(checkQuote(q, ASK, CHAIN, 10_001), "EXPIRED");
});

test("a quote travels as text and comes back the same; anything else is not a quote", () => {
  const q = makeQuote({ ask: ASK, pairs: PAIRS, terms: TERMS, mid: MID(1_000), slot: { address: DESK_A, holds: 50_000_000n }, id: "q", chain: CHAIN, now: 2_000 }).quote;
  assert.deepEqual(quoteFromWire(JSON.parse(JSON.stringify(quoteToWire(q)))), q);
  assert.equal(quoteFromWire(null), null);
  assert.equal(quoteFromWire({ ...quoteToWire(q), outRaw: "-5" }), null);
  assert.equal(quoteFromWire({ ...quoteToWire(q), spreadBps: 9_999 }), null);
  assert.equal(quoteFromWire({ ...quoteToWire(q), firmUntil: "soon" }), null);
});

/* ---------------- slots ---------------- */

test("each quote holds one one-time address that holds enough — the smallest of them", () => {
  let slots = [readySlot(DESK_A, { [USDC]: 500_000_000n }), readySlot(DESK_B, { [USDC]: 40_000_000n }), readySlot("Small1111111111111111111111111111111111111", { [USDC]: 1_000n })];
  assert.equal(pickSlot(slots, USDC, 34_825_000n, 0).address, DESK_B, "the big one stays for a big quote");
  assert.equal(pickSlot(slots, USDC, 600_000_000n, 0), null, "never two addresses for one quote");
  assert.equal(pickSlot(slots, SOL, 1n, 0), null, "nothing in that coin");
  slots = holdSlot(slots, DESK_B, "q1", 10_000);
  assert.equal(pickSlot(slots, USDC, 34_825_000n, 5_000).address, DESK_A, "a held address is not quoted twice");
  assert.equal(pickSlot(slots, USDC, 34_825_000n, 10_001).address, DESK_B, "a hold past its time is free again");
  assert.equal(slotOf(releaseSlot(slots, "q1"), "q1"), null);
  const used = spendSlot(slots, "q1");
  assert.equal(slotOf(used, "q1").state, "used");
  assert.equal(pickSlot(used, USDC, 34_825_000n, 99_999).address, DESK_A, "a used address is never quoted again");
});

/* ---------------- way and band ---------------- */

const four = (band) => Object.fromEntries(band.cells.map(({ part, shown }) => [part, shown]));

test("the desk's way stands only where the desk quotes the pair and the browser can check the desk's leg", () => {
  const desk = { url: "https://desk.example", pairs: PAIRS };
  const pair = { inMint: SOL, outMint: USDC };
  assert.deepEqual(chooseWay({ desk, pair, canCheck: true }), { way: "desk" });
  assert.deepEqual(chooseWay({ desk, pair: { inMint: USDC, outMint: SOL }, canCheck: true }), { way: "route", why: "PAIR" });
  assert.deepEqual(chooseWay({ desk, pair, canCheck: false }), { way: "route", why: "CHECK" });
  assert.deepEqual(chooseWay({ desk: { url: null, pairs: PAIRS }, pair, canCheck: true }), { way: "route", why: "SHUT" });
  assert.deepEqual(chooseWay({ desk: { url: "https://desk.example", pairs: [] }, pair, canCheck: true }), { way: "route", why: "SHUT" });
});

test("today there is no desk: no address is set, and nothing can check the desk's leg yet", () => {
  assert.equal(DESK_URL, null);
  assert.deepEqual([...DESK_PAIRS], []);
  assert.equal(PAID_READER, null);
  assert.deepEqual(chooseWay({ desk: DESK, pair: { inMint: SOL, outMint: USDC }, canCheck: PAID_READER !== null }), { way: "route", why: "SHUT" });
  const sdk = { getTransactionDecoder() {}, getCompiledTransactionMessageDecoder() {}, verifySignature() {} };
  assert.equal(deskAbilities(sdk).canCheck, false, "decoders alone are not enough");
  assert.equal(deskAbilities(sdk, async () => null).canCheck, true);
  assert.equal(deskAbilities({}, async () => null).canCheck, false, "the bundle of 18.11 has no message decoder");
});

test("the band before the press is exposure.ts's own: the desk hides the coins and the amounts, the route shows all", () => {
  assert.equal(bandActionOf("desk"), "swap");
  assert.equal(bandActionOf("route"), "routeSwap");
  assert.deepEqual(bandOfWay("desk"), bandOf("swap"));
  assert.deepEqual(bandOfWay("route"), bandOf("routeSwap"));
  assert.deepEqual(four(bandOfWay("desk")), { who: "seen", to: "seen", what: "hidden", amount: "hidden" }, "both addresses sign; no coin, no sum");
  assert.deepEqual(four(bandOfWay("route")), { who: "seen", to: "seen", what: "seen", amount: "seen" }, "the trade is on chain");
  assert.equal(bandOfWay("desk").checked, "local", "until the devnet probe lands it — then exposure.ts says devnet");
  assert.deepEqual(four(bandOfWay("desk", "open")), { who: "seen", to: "seen", what: "seen", amount: "seen" }, "the open mode is plain Solana");
  assert.equal(lineOfWay("desk"), "deskSeen");
  assert.equal(lineOfWay("route"), "seen");
});

test("each step of the desk's swap says who sees what; the joint step is the band", () => {
  assert.deepEqual([...DESK_STEPS], ["quote", "joint", "stock"]);
  const quote = deskStep("quote");
  assert.ok(Object.values(quote.everyone).every((s) => s === "hidden"), "asking a price puts nothing on chain");
  assert.ok(Object.values(quote.desk).every((s) => s === "seen"), "the desk is the other side of the trade");
  const joint = deskStep("joint");
  assert.deepEqual(joint.everyone, four(bandOf("swap")));
  assert.ok(Object.values(joint.prover).every((s) => s === "seen"), "the proof server gets each leg whole");
  const stock = deskStep("stock");
  assert.equal(stock.everyone.what, "hidden");
  assert.equal(stock.everyone.amount, "hidden");
  for (const step of DESK_STEPS) assert.equal(deskStep(step).desk.who, "seen", "the desk is never told it cannot see");
});

/* ---------------- a fake SDK and kit: transactions as JSON, legs as one ring instruction ---------------- */

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const unb64 = (text) => new Uint8Array(Buffer.from(text, "base64"));
const HEAD = [0x10, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x04];
const fakeSign = (address, message) => {
  const out = new Uint8Array(64);
  const seed = enc.encode(address);
  for (let i = 0; i < 64; i++) out[i] = (seed[i % seed.length] + message[i % message.length] + i) % 251 + 1;
  return out;
};
const msgToBytes = (compiled) => enc.encode(JSON.stringify(compiled, (_k, v) => (v instanceof Uint8Array ? { u8: Array.from(v) } : typeof v === "bigint" ? v.toString() : v)));
const msgFromBytes = (bytes) => JSON.parse(dec.decode(bytes), (_k, v) => (v && typeof v === "object" && Array.isArray(v.u8) ? new Uint8Array(v.u8) : v));

/** Compiles instructions into a version 1 message the way kit 8 decodes it: fee payer first, then signers, then the rest. */
function compileV1({ feePayer, instructions, computeUnitLimit }) {
  const signers = [feePayer];
  const rest = [];
  for (const ix of instructions) for (const a of ix.accounts) if (a.role >= 2 && !signers.includes(a.address)) signers.push(a.address);
  for (const ix of instructions) for (const a of [{ address: ix.programAddress, role: 0 }, ...ix.accounts]) if (!signers.includes(a.address) && !rest.includes(a.address)) rest.push(a.address);
  const staticAccounts = [...signers, ...rest];
  const index = (a) => staticAccounts.indexOf(a);
  const compiled = {
    version: 1,
    header: { numSignerAccounts: signers.length, numReadonlySignerAccounts: 0, numReadonlyNonSignerAccounts: 0 },
    staticAccounts,
    instructionHeaders: instructions.map((ix) => ({ programAccountIndex: index(ix.programAddress), numInstructionAccounts: ix.accounts.length, numInstructionDataBytes: ix.data.length })),
    instructionPayloads: instructions.map((ix) => ({ instructionAccountIndices: ix.accounts.map((a) => index(a.address)), instructionData: ix.data })),
    configValues: [{ kind: "u32", value: computeUnitLimit }],
    roles: instructions.map((ix) => ix.accounts.map((a) => a.role)),
  };
  return { messageBytes: msgToBytes(compiled), signatures: Object.fromEntries(signers.map((s) => [s, null])) };
}

let pdaCount = 0;
/** A private transfer as one ring instruction: payer, tree, ring, system, tree, its own record, the owner. The data is the head and «ciphertext». */
function transferIx({ feePayer, owner, recipient, amount, asset }) {
  const cipher = enc.encode(`${recipient}|${asset ?? "SOL"}|${amount}|${pdaCount}`).map((b) => b ^ 0x5a);
  const pda = `Pda${String(++pdaCount).padStart(40, "1")}`;
  return {
    programAddress: RING,
    accounts: [
      { address: feePayer, role: 3 },
      { address: TREE, role: 1 },
      { address: RING, role: 0 },
      { address: SYSTEM, role: 0 },
      { address: TREE, role: 1 },
      { address: pda, role: 1 },
      { address: owner, role: owner === feePayer ? 3 : 2 },
    ],
    data: new Uint8Array([...HEAD, ...cipher]),
  };
}

function fakeSdk(log = []) {
  const sdk = {
    SOL_MINT: SOL,
    getTransactionEncoder: () => ({ encode: (tx) => enc.encode(JSON.stringify({ m: b64(tx.messageBytes), s: Object.fromEntries(Object.entries(tx.signatures).map(([k, v]) => [k, v ? b64(v) : null])) })) }),
    getTransactionDecoder: () => ({
      decode: (bytes) => {
        const j = JSON.parse(dec.decode(bytes));
        return { messageBytes: unb64(j.m), signatures: Object.fromEntries(Object.entries(j.s).map(([k, v]) => [k, v ? unb64(v) : null])) };
      },
    }),
    getCompiledTransactionMessageDecoder: () => ({ decode: (bytes) => msgFromBytes(bytes) }),
    decompileTransactionMessage: (m) => ({
      instructions: m.instructionHeaders.map((h, i) => ({
        programAddress: m.staticAccounts[h.programAccountIndex],
        accounts: Array.from(m.instructionPayloads[i].instructionAccountIndices, (j, k) => ({ address: m.staticAccounts[j], role: m.roles[i][k] })),
        data: m.instructionPayloads[i].instructionData,
      })),
    }),
    compileUnsignedTransaction: (input) => compileV1(input),
    partiallySignTransactionWithSigners: async (signers, tx) => ({ ...tx, signatures: { ...tx.signatures, ...Object.fromEntries(signers.map((s) => [s.address, fakeSign(s.address, tx.messageBytes)])) } }),
    getPublicKeyFromAddress: async (address) => address,
    verifySignature: async (key, signature, message) => Buffer.from(signature).equals(Buffer.from(fakeSign(key, message))),
    getSignatureFromTransaction: (tx) => `sig-${b64(tx.signatures[Object.keys(tx.signatures)[0]] ?? new Uint8Array(1)).slice(0, 12)}`,
    buildTransferTransaction: async ({ wallet, feePayer, recipient, amount, asset }) => {
      log.push(["leg", wallet.owner, recipient, asset ?? "SOL", amount]);
      return compileV1({ feePayer, instructions: [transferIx({ feePayer, owner: wallet.owner, recipient, amount, asset })], computeUnitLimit: 450_000 });
    },
    syncWallet: async () => undefined,
    getPrivateTokenBalances: () => [{ mint: USDC, amount: 34_825_000n }],
  };
  const client = {
    solanaRpc: {
      getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "Fresh11111111111111111111111111111111111111", lastValidBlockHeight: 99n } }) }),
      sendTransaction: (wire) => ({ send: async () => log.push(["sent", wire.length]) }),
    },
    confirmTransaction: async () => 7n,
  };
  const gate = { ask: async (addresses) => (log.push(["gate", ...addresses]), { paused: false, cap: null, marks: Object.fromEntries(addresses.map((a) => [a, "clear"])) }), landed: () => undefined };
  return { sdk, client, gate };
}

const bookOf = (owner) => ({ wallet: { owner }, keys: {}, owner });

function wallet(sdk, log) {
  return {
    address: OWNER,
    signWire: async (wire) => {
      log.push(["wallet"]);
      const tx = sdk.getTransactionDecoder().decode(wire);
      return sdk.getTransactionEncoder().encode({ ...tx, signatures: { ...tx.signatures, [OWNER]: fakeSign(OWNER, tx.messageBytes) } });
    },
  };
}

function deskFor(ctx, clock, over = {}) {
  return openDesk({
    ctx,
    chain: CHAIN,
    terms: TERMS,
    pairs: PAIRS,
    mid: async () => MID(clock.t),
    keys: [{ address: DESK_A, signer: { address: DESK_A }, book: bookOf(DESK_A) }],
    slots: [readySlot(DESK_A, { [USDC]: 100_000_000n })],
    now: () => clock.t,
    id: () => "q1",
    ...over,
  });
}

/* ---------------- messages and checks ---------------- */

function legMessage(owner, recipient, feePayer = owner) {
  const tx = compileV1({ feePayer, instructions: [transferIx({ feePayer, owner, recipient, amount: 5n })], computeUnitLimit: 450_000 });
  return { tx, m: messageOf(msgFromBytes(tx.messageBytes)) };
}

function jointOf(instructions, feePayer = OWNER) {
  const tx = compileV1({ feePayer, instructions, computeUnitLimit: 900_000 });
  return messageOf(msgFromBytes(tx.messageBytes));
}

test("a version 1 message and an older one read the same way: signers, payer, instructions, compute", () => {
  const { m } = legMessage(OWNER, DESK_A);
  assert.equal(m.version, 1);
  assert.equal(m.payer, OWNER);
  assert.deepEqual([...m.signers], [OWNER]);
  assert.equal(m.instructions.length, 1);
  assert.equal(m.instructions[0].program, RING);
  assert.equal(m.computeUnits, 450_000);
  const legacy = messageOf({
    version: 0,
    header: { numSignerAccounts: 1 },
    staticAccounts: [OWNER, "ComputeBudget111111111111111111111111111111", RING],
    instructions: [
      { programAddressIndex: 1, accountIndices: [], data: new Uint8Array([2, 0x20, 0xa1, 0x07, 0x00]) },
      { programAddressIndex: 2, accountIndices: [0], data: new Uint8Array([1, 2, 3]) },
    ],
  });
  assert.equal(legacy.computeUnits, 500_000);
  assert.equal(legacy.instructions.length, 1, "compute budget is read, not counted as an instruction");
  assert.equal(TRANSFER_HEAD, 10);
  assert.equal(jointCompute([m, m]), 900_000);
  assert.equal(jointCompute([m, m, m, m]), COMPUTE_MAX);
});

test("the person's wallet signs only their own leg, untouched, beside one transfer of the quote's desk address", () => {
  const mine = transferIx({ feePayer: OWNER, owner: OWNER, recipient: DESK_A, amount: 250n });
  const theirs = transferIx({ feePayer: OWNER, owner: DESK_A, recipient: OWNER, amount: 34n, asset: USDC });
  const mineMsg = messageOf(msgFromBytes(compileV1({ feePayer: OWNER, instructions: [mine], computeUnitLimit: 450_000 }).messageBytes));
  const check = (joint, over = {}) => checkJoint({ joint, mine: mineMsg, owner: OWNER, desk: DESK_A, bytes: 1_700, ...over });

  assert.equal(check(jointOf([mine, theirs])), null);
  assert.equal(check(jointOf([theirs, mine])), null, "either order: the legs are whole");
  assert.equal(check({ ...jointOf([mine, theirs]), version: 0 }), "VERSION");
  assert.equal(check(jointOf([mine, theirs], DESK_A)), "PAYER", "the desk paying the fee would tie its address to the person");
  assert.equal(check(jointOf([mine, theirs]), { desk: DESK_B }), "SIGNERS", "another desk address than the quote's");
  assert.equal(check(jointOf([mine])), "SIGNERS", "the desk's leg dropped: the desk would be paid for nothing");
  const changed = { ...mine, data: new Uint8Array([...mine.data.subarray(0, -1), mine.data.at(-1) ^ 1]) };
  assert.equal(check(jointOf([changed, theirs])), "MINE_CHANGED");
  const pull = { programAddress: SYSTEM, accounts: [{ address: OWNER, role: 3 }, { address: DESK_A, role: 3 }], data: new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]) };
  assert.equal(check(jointOf([mine, theirs, pull])), "FOREIGN", "nothing else may draw on the person's wallet");
  const deposit = { ...theirs, data: new Uint8Array([0x11, ...theirs.data.subarray(1)]) };
  assert.equal(check(jointOf([mine, deposit])), "FOREIGN", "the desk's leg must be a private transfer like the person's");
  const sneaky = { ...theirs, accounts: theirs.accounts.map((a, i) => (i === 5 ? { address: OWNER, role: 1 } : a)) };
  assert.equal(check(jointOf([mine, sneaky])), "FOREIGN", "the person's wallet only where a transfer names its fee payer");
  const other = transferIx({ feePayer: OWNER, owner: DESK_B, recipient: OWNER, amount: 34n });
  assert.equal(check(jointOf([mine, other])), "SIGNERS", "a leg signed by another desk address than the quote names");
  assert.equal(check(jointOf([mine, theirs]), { bytes: 5_000 }), "TOO_BIG");
  assert.equal(check({ ...jointOf([mine, theirs]), computeUnits: 2_000_000 }), "COMPUTE");
  assert.equal(check(jointOf([mine, theirs]), { mine: { ...mineMsg, instructions: [] } }), "MINE_CHANGED");
});

test("the desk joins only a leg the person alone signs and pays, one private transfer", () => {
  assert.equal(checkLeg(legMessage(OWNER, DESK_A).m, OWNER, DESK_A), null);
  assert.equal(checkLeg({ ...legMessage(OWNER, DESK_A).m, version: 0 }, OWNER, DESK_A), "VERSION");
  assert.equal(checkLeg(legMessage(OWNER, DESK_A, DESK_A).m, OWNER, DESK_A), "PAYER");
  assert.equal(checkLeg(legMessage(DESK_B, DESK_A, OWNER).m, OWNER, DESK_A), "SIGNERS", "someone else's notes");
  assert.equal(checkLeg({ ...legMessage(OWNER, DESK_A).m, instructions: [] }, OWNER, DESK_A), "EMPTY");
  const { m } = legMessage(OWNER, DESK_A);
  const withDesk = { ...m, instructions: [{ ...m.instructions[0], accounts: [...m.instructions[0].accounts, DESK_A] }] };
  assert.equal(checkLeg(withDesk, OWNER, DESK_A), "FOREIGN", "the person's leg never asks the desk's address for anything");
});

/* ---------------- the whole swap, both sides in place ---------------- */

test("a desk swap end to end: quote, gate, take, the person's leg, the desk's leg, one joint transaction, one signature", async () => {
  const log = [];
  const ctx = fakeSdk(log);
  const clock = { t: 1_000 };
  const desk = deskFor(ctx, clock);
  const stages = [];
  const done = await swapAtDesk({ ctx, book: bookOf(OWNER), wallet: wallet(ctx.sdk, log), link: desk, ask: ASK, probe: true, paid: null, now: () => clock.t, on: (s) => stages.push(s) });
  assert.deepEqual(stages, ["quoting", "proving", "joining", "signing", "reading"]);
  assert.equal(done.quote.desk, DESK_A);
  assert.equal(done.quote.outRaw, 34_825_000n);
  assert.equal(done.landed.slot, 7n);
  assert.deepEqual(done.held, [{ mint: USDC, amount: 34_825_000n }]);
  const order = log.map((e) => e[0]);
  assert.deepEqual(order, ["gate", "leg", "leg", "wallet", "sent"], "the gate before any proof; the wallet once, after both legs");
  assert.deepEqual(log[0], ["gate", OWNER, DESK_A], "paying the desk is a private send: both addresses checked");
  assert.deepEqual(log[1], ["leg", DESK_A, OWNER, USDC, 34_825_000n], "the desk starts its leg when the quote is taken");
  assert.deepEqual(log[2], ["leg", OWNER, DESK_A, "SOL", 250_000_000n], "the person's leg: exactly the amount, to the quote's address");
  assert.equal(slotOf(desk.slots(), "q1").state, "used", "one fill per one-time address");
});

test("the person's side refuses before the wallet is asked: no reader, a stale quote, a desk that cheats", async () => {
  const run = async (link, over = {}) => {
    const log = [];
    const ctx = fakeSdk(log);
    const clock = { t: 1_000 };
    try {
      await swapAtDesk({ ctx, book: bookOf(OWNER), wallet: wallet(ctx.sdk, log), link: link(ctx, clock), ask: ASK, probe: true, paid: null, now: () => clock.t, ...over });
      return ["ok", log];
    } catch (error) {
      return [error.code ?? String(error), log, error.message];
    }
  };
  const asked = (log) => log.some((e) => e[0] === "wallet");

  let [code, log] = await run((ctx, clock) => deskFor(ctx, clock), { probe: false });
  assert.equal(code, "DESK_UNCHECKED", "without a reader of the desk's leg the browser never starts");
  assert.equal(log.length, 0, "nothing asked, nothing proved");

  [code, log] = await run((ctx, clock) => ({ ...deskFor(ctx, clock), quote: async (ask) => ({ ...(await deskFor(ctx, clock).quote(ask)), outRaw: 0n }) }));
  assert.equal(code, "DESK_QUOTE");
  assert.equal(asked(log), false);

  [code] = await run((ctx, clock) => {
    const d = deskFor(ctx, clock);
    return { ...d, take: async (id) => ((clock.t += 60_000), d.take(id)) };
  });
  assert.equal(code, "EXPIRED", "a price not taken in time is not taken");

  const cheat = (rewrite) => (ctx, clock) => {
    const d = deskFor(ctx, clock);
    return { ...d, fill: async (id, leg) => rewrite(ctx, await d.fill(id, leg)) };
  };
  const reshape = (ctx, wire, change) => {
    const tx = ctx.sdk.getTransactionDecoder().decode(unb64(wire));
    const m = ctx.sdk.decompileTransactionMessage(msgFromBytes(tx.messageBytes));
    const again = compileV1({ feePayer: OWNER, instructions: change(m.instructions), computeUnitLimit: 900_000 });
    const signed = { ...again, signatures: { ...again.signatures, [DESK_A]: fakeSign(DESK_A, again.messageBytes) } };
    return b64(ctx.sdk.getTransactionEncoder().encode(signed));
  };
  let message;
  [code, log, message] = await run(cheat((ctx, wire) => reshape(ctx, wire, (ixs) => [ixs[0], ixs[1], { programAddress: SYSTEM, accounts: [{ address: OWNER, role: 3 }, { address: DESK_A, role: 1 }], data: new Uint8Array(12) }])));
  assert.equal(code, "DESK_JOINT");
  assert.equal(message, "FOREIGN");
  assert.equal(asked(log), false, "a cheating desk never reaches the wallet");

  [code, log, message] = await run(cheat((ctx, wire) => reshape(ctx, wire, (ixs) => [{ ...ixs[0], data: new Uint8Array([...ixs[0].data, 1]) }, ixs[1]])));
  assert.equal(code, "DESK_JOINT");
  assert.equal(message, "MINE_CHANGED");
  assert.equal(asked(log), false);

  [code, log, message] = await run(cheat((ctx, wire) => {
    const tx = ctx.sdk.getTransactionDecoder().decode(unb64(wire));
    return b64(ctx.sdk.getTransactionEncoder().encode({ ...tx, signatures: { ...tx.signatures, [DESK_A]: new Uint8Array(64).fill(7) } }));
  }));
  assert.equal(code, "DESK_JOINT");
  assert.equal(message, "UNSIGNED", "the desk's signature must be true for this message");
  assert.equal(asked(log), false);

  [code, log] = await run((ctx, clock) => deskFor(ctx, clock), { probe: false, paid: async () => ({ mint: USDC, amount: 1n }) });
  assert.equal(code, "DESK_SHORT", "the desk's leg pays less than quoted");
  assert.equal(asked(log), false);

  [code] = await run((ctx, clock) => deskFor(ctx, clock), { probe: false, paid: async (_m, q) => ({ mint: q.outMint, amount: q.outRaw }) });
  assert.equal(code, "ok", "a reader that finds the quote paid lets the wallet sign");
});

test("the desk refuses what it should: no stock, a late take, a late fill, a leg that is not the person's alone", async () => {
  const ctx = fakeSdk();
  const clock = { t: 1_000 };
  const poor = deskFor(ctx, clock, { slots: [readySlot(DESK_A, { [USDC]: 10n })] });
  await assert.rejects(poor.quote(ASK), (e) => e instanceof DeskRefused && e.code === "NO_STOCK");

  const late = deskFor(ctx, clock);
  const q = await late.quote(ASK);
  assert.equal(slotOf(late.slots(), q.id).state, "held");
  clock.t += 9_000;
  await assert.rejects(late.take(q.id), (e) => e.code === "EXPIRED");
  assert.equal(slotOf(late.slots(), q.id), null, "the hold comes off: the address may be quoted again");
  await assert.rejects(late.take("nope"), (e) => e.code === "NO_QUOTE");

  clock.t = 1_000;
  const slow = deskFor(ctx, clock);
  const q2 = await slow.quote(ASK);
  await slow.take(q2.id);
  const leg = compileV1({ feePayer: OWNER, instructions: [transferIx({ feePayer: OWNER, owner: OWNER, recipient: DESK_A, amount: ASK.inRaw })], computeUnitLimit: 450_000 });
  clock.t += 46_000;
  await assert.rejects(slow.fill(q2.id, b64(ctx.sdk.getTransactionEncoder().encode(leg))), (e) => e.code === "EXPIRED");

  clock.t = 1_000;
  const strict = deskFor(ctx, clock);
  const q3 = await strict.quote(ASK);
  await strict.take(q3.id);
  const notMine = compileV1({ feePayer: OWNER, instructions: [transferIx({ feePayer: OWNER, owner: DESK_B, recipient: DESK_A, amount: ASK.inRaw })], computeUnitLimit: 450_000 });
  await assert.rejects(strict.fill(q3.id, b64(ctx.sdk.getTransactionEncoder().encode(notMine))), (e) => e.code === "SIGNERS");
});

test("the browser's desk link: three calls, the desk's own refusal code, silence said as no answer", async () => {
  const calls = [];
  const q = makeQuote({ ask: ASK, pairs: PAIRS, terms: TERMS, mid: MID(1_000), slot: { address: DESK_A, holds: 50_000_000n }, id: "q", chain: CHAIN, now: 2_000 }).quote;
  const answers = { "/quote": [200, { quote: quoteToWire(q) }], "/take": [409, { code: "EXPIRED" }], "/fill": [200, { joint: "AAAA" }] };
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push([path, JSON.parse(init.body)]);
    const [status, body] = answers[path];
    return new Response(JSON.stringify(body), { status });
  };
  const link = httpDesk("https://desk.example", fetchImpl);
  assert.deepEqual(await link.quote(ASK), q);
  assert.deepEqual(calls[0][1], { owner: OWNER, inMint: SOL, outMint: USDC, inRaw: "250000000" }, "amounts travel as text");
  await assert.rejects(link.take("q"), (e) => e.code === "EXPIRED");
  assert.equal(await link.fill("q", "BBBB"), "AAAA");
  assert.deepEqual(calls[2][1], { id: "q", leg: "BBBB" });
  const silent = httpDesk("https://desk.example", async () => {
    throw new Error("offline");
  });
  await assert.rejects(silent.quote(ASK), (e) => e.code === "NO_ANSWER");
  assert.ok(new DeskError("DESK_JOINT", "FOREIGN").message === "FOREIGN");
  assert.equal(refusalCode("EXPIRED"), "DESK_EXPIRED");
  for (const code of ["NO_STOCK", "SMALL", "NO_PRICE", "STALE_PRICE", "PAIR", "SAME"]) assert.equal(refusalCode(code), "DESK_NOT_NOW", code);
  for (const code of ["NO_ANSWER", "NO_QUOTE", "FOREIGN", "SIGNERS", "TERMS"]) assert.equal(refusalCode(code), "DESK_REFUSED", code);
});

test("SOL by either name: the card's wrapped SOL and the ring's system program are one pair", () => {
  const desk = { url: "https://desk.example", pairs: [{ inMint: SOL, outMint: USDC }] };
  const WSOL = "So11111111111111111111111111111111111111112";
  assert.deepEqual(ringPair({ inMint: WSOL, outMint: USDC }), { inMint: SOL, outMint: USDC });
  assert.deepEqual(chooseWay({ desk, pair: { inMint: WSOL, outMint: USDC }, canCheck: true }), { way: "desk" });
  assert.deepEqual(chooseWay({ desk: { ...desk, pairs: [{ inMint: WSOL, outMint: USDC }] }, pair: { inMint: SOL, outMint: USDC }, canCheck: true }), { way: "desk" });
});

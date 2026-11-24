/**
 * The stock keeper's moves on DLMM Pro, with no network: the ticks of a range from the person's bounds, and
 * the lock on the agent's key held to the very bytes the rehearsal sent (`scripts/launch-qa/dlmm-pro-range-rehearsal.mjs
 * --write`) — the four the agent signed, which the program took; the seven the lock refused; and every way of
 * bending a signed move past the person's bounds, each refused for its own reason.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { readFixture } from "./fixture-kit.mjs";

const { KEEPER_RIGHTS, MAX_KEEPER_BAND_BPS, depositTermsOf, expandRangesOf, halfWidthBpsOf, keeperCallOf, keeperRefusalOf, keeperTicksOf, keeperWidthTicks } = await import("./range.server.ts");
const { CARE_RIGHTS } = await import("./earn.server.ts");
const { getSqrtPriceFromTickId, tickIdFromSqrtPrice } = await import("@meteora-ag/dlmm-pro-sdk");

const fixture = readFixture(new URL("./fixtures/range-rehearsal.json.gz", import.meta.url));
const { who, addresses, spacing, bounds } = fixture;
const PROGRAM = new PublicKey(fixture.program);
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const keeper = { agent: who.agent, owner: who.person, pool: addresses.pool, nftMint: addresses.personPosition, mints: [addresses.stock, addresses.usdc], tickSpacing: spacing, bounds: bounds.shift };
const messageOf = (wire) => VersionedTransaction.deserialize(Buffer.from(wire, "base64")).message.serialize();

/* ------------------------------------------------------------------ ticks */

test("a tick is a hundredth of a percent of the price: the venue's reckoning is the program's", () => {
  for (const tick of [-20_000, -46, 0, 46_050, 100_000]) {
    const sqrt = Number(BigInt(getSqrtPriceFromTickId(tick).toString())) / 2 ** 64;
    assert.ok(Math.abs(sqrt * sqrt / Math.pow(1.0001, tick) - 1) < 1e-9, `tick ${tick}`);
  }
});

test("a range from the person's bounds: never narrower than asked, on the pool's spacing, the price inside it", () => {
  for (const [center, half, step] of [
    [46_050, 50, 10],
    [46_057, 50, 10],
    [-18_934, 400, 64],
    [0, 10, 1],
    [-3, 10, 10],
    [46_050, 5_000, 100],
  ]) {
    const range = keeperTicksOf(center, half, step);
    assert.equal(Math.abs(range.tickLowerId % step), 0);
    assert.equal(Math.abs(range.tickUpperId % step), 0);
    assert.ok(!Object.is(range.tickLowerId, -0) && !Object.is(range.tickUpperId, -0), "never a negative zero");
    assert.ok(range.tickLowerId <= center && center < range.tickUpperId, `${center} inside ${JSON.stringify(range)}`);
    assert.ok(halfWidthBpsOf(range) >= half - 1, `${halfWidthBpsOf(range)} ≥ ${half}`);
    const width = keeperWidthTicks({ narrowestBps: half, widestBps: half }, step);
    const span = range.tickUpperId - range.tickLowerId;
    assert.ok(span >= width.min && span <= width.max, `${span} within ${JSON.stringify(width)}`);
  }
  assert.equal(halfWidthBpsOf({ tickLowerId: -50, tickUpperId: 50 }), 50);
});

test("a keeper's rights are a care's three and the two that lay a range; one that only takes out keeps a care's three", () => {
  assert.deepEqual([...KEEPER_RIGHTS], [...CARE_RIGHTS, "addLiquidity", "updateRange"]);
});

/* ------------------------------------------------------------------ the rehearsal's own bytes */

test("every move the agent signed in the rehearsal passes the lock — and the program took each", () => {
  assert.deepEqual(Object.keys(fixture.signed).sort(), ["close0", "dividend0", "open0", "pull0"]);
  for (const [name, entry] of Object.entries(fixture.signed)) {
    assert.equal(entry.said, null, name);
    assert.equal(keeperRefusalOf(messageOf(entry.wire), entry.subject), null, name);
  }
  const close = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(fixture.signed.close0.wire, "base64")).message);
  const calls = close.instructions.filter((ix) => ix.programId.equals(PROGRAM)).map((ix) => keeperCallOf(ix.data));
  assert.deepEqual(calls, ["refresh", "claimFee", "removeLiquidity", "expand", "deposit", "removeRanges"], "a whole move — out to her, in from her — in one message");
});

test("every walk around the bounds the rehearsal tried, the lock refuses for the reason it gave then", () => {
  assert.deepEqual(Object.keys(fixture.refused).sort(), ["depositFromAgent", "depositOverBounds", "feesToAgent", "pullLays", "rangeTooWide", "rentToAgent", "spendApproval"]);
  for (const [name, entry] of Object.entries(fixture.refused)) {
    assert.ok(entry.said, name);
    assert.equal(keeperRefusalOf(messageOf(entry.wire), entry.subject), entry.said, name);
  }
});

/* ------------------------------------------------------------------ a signed move, bent */

const closeMessage = () => {
  const decoded = VersionedTransaction.deserialize(Buffer.from(fixture.signed.close0.wire, "base64")).message;
  return { decoded, message: TransactionMessage.decompile(decoded) };
};
/** The signed close, with `change` applied to a copy of its instructions, compiled again for the same payer. */
function bent(change, payer = new PublicKey(who.agent)) {
  const { message } = closeMessage();
  const instructions = message.instructions.map((ix) => ({ programId: ix.programId, keys: ix.keys.map((key) => ({ ...key })), data: Buffer.from(ix.data) }));
  const changed = change(instructions) ?? instructions;
  return new TransactionMessage({ payerKey: payer, recentBlockhash: message.recentBlockhash, instructions: changed }).compileToV0Message().serialize();
}
const call = (instructions, name) => instructions.find((ix) => ix.programId.equals(PROGRAM) && keeperCallOf(ix.data) === name);
const agentAta = (mint, program) => getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(who.agent), true, program);
const u64 = (value) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
};
const u128 = (value) => Buffer.concat([u64(value & ((1n << 64n) - 1n)), u64(value >> 64n)]);
/** `add_liquidity_imbalance`'s data with its caps and band rewritten. */
function deposit(data, terms) {
  const head = Buffer.from(data.subarray(0, 8));
  const now = depositTermsOf(data);
  const next = { ...now, ...terms };
  const option = (value, write) => (value === null ? Buffer.of(0) : Buffer.concat([Buffer.of(1), write(value)]));
  /* What follows the band and the minimum: the layout version and the slot's index, then the hooks' slices, as the SDK wrote them. */
  const body = Buffer.concat([option(now.maxAmountX, u64), option(now.maxAmountY, u64), option(now.band, (band) => Buffer.concat([u128(band.min), u128(band.max)])), option(now.minLiquidity, u128)]);
  const tail = Buffer.from(data.subarray(8 + body.length));
  return Buffer.concat([head, option(next.maxAmountX, u64), option(next.maxAmountY, u64), option(next.band, (band) => Buffer.concat([u128(band.min), u128(band.max)])), option(next.minLiquidity, u128), tail]);
}
const expand = (data, ranges) => {
  const out = Buffer.alloc(8 + 4 + 8 * ranges.length);
  Buffer.from(data.subarray(0, 8)).copy(out);
  out.writeUInt32LE(ranges.length, 8);
  ranges.forEach((range, index) => {
    out.writeInt32LE(range.tickLowerId, 12 + 8 * index);
    out.writeInt32LE(range.tickUpperId, 16 + 8 * index);
  });
  return out;
};

test("the signed close reads back as the move it was: one range of ±4 %, a deposit within the bounds, inside a keeper's band, inside the range", () => {
  const { message } = closeMessage();
  const laid = expandRangesOf(call(message.instructions, "expand").data);
  assert.equal(laid.length, 1);
  assert.ok(Math.abs(halfWidthBpsOf(laid[0]) - 400) <= 10, `${halfWidthBpsOf(laid[0])}`);
  const terms = depositTermsOf(call(message.instructions, "deposit").data);
  assert.ok(terms.maxAmountX <= BigInt(bounds.shift.maxPutBackPerShift.xRaw) && terms.maxAmountY <= BigInt(bounds.shift.maxPutBackPerShift.yRaw));
  assert.ok(terms.band && terms.band.min < terms.band.max);
  const low = tickIdFromSqrtPrice(new BN(terms.band.min.toString()));
  const high = tickIdFromSqrtPrice(new BN(terms.band.max.toString()));
  assert.ok(laid[0].tickLowerId <= low && high < laid[0].tickUpperId);
  assert.equal(keeperRefusalOf(bent(() => null), keeper), null, "compiled again unchanged, it still passes");
});

test("a signed move bent past the person's bounds is refused — each bend for its own reason", () => {
  const { message } = closeMessage();
  const laid = expandRangesOf(call(message.instructions, "expand").data)[0];
  const terms = depositTermsOf(call(message.instructions, "deposit").data);
  const width = keeperWidthTicks(bounds.shift, spacing);
  const centre = (laid.tickLowerId + laid.tickUpperId) / 2;
  const cases = [
    ["a range wider than the person allowed", (ixs) => void (call(ixs, "expand").data = expand(call(ixs, "expand").data, [{ tickLowerId: centre - width.max, tickUpperId: centre + width.max }]))],
    ["a range narrower than the person allowed", (ixs) => void (call(ixs, "expand").data = expand(call(ixs, "expand").data, [{ tickLowerId: centre - spacing, tickUpperId: centre + spacing }]))],
    ["more than one new range at a time", (ixs) => void (call(ixs, "expand").data = expand(call(ixs, "expand").data, [laid, laid]))],
    ["a deposit over what the person allowed a move to put back", (ixs) => void (call(ixs, "deposit").data = deposit(call(ixs, "deposit").data, { maxAmountX: BigInt(bounds.shift.maxPutBackPerShift.xRaw) + 1n }))],
    ["a deposit over what the person allowed a move to put back", (ixs) => void (call(ixs, "deposit").data = deposit(call(ixs, "deposit").data, { maxAmountY: BigInt(bounds.shift.maxPutBackPerShift.yRaw) + 1n }))],
    ["a deposit with no band of the price", (ixs) => void (call(ixs, "deposit").data = deposit(call(ixs, "deposit").data, { band: null }))],
    [
      "a deposit with a band of the price wider than a keeper's",
      (ixs) => {
        const mid = terms.band.min;
        void (call(ixs, "deposit").data = deposit(call(ixs, "deposit").data, { band: { min: mid, max: (mid * BigInt(10_000 + MAX_KEEPER_BAND_BPS + 50)) / 10_000n } }));
      },
    ],
    [
      "a deposit whose band of the price is outside the range laid",
      (ixs) => {
        const high = BigInt(getSqrtPriceFromTickId(laid.tickUpperId + 50).toString());
        void (call(ixs, "deposit").data = deposit(call(ixs, "deposit").data, { band: { min: (high * 999n) / 1000n, max: high } }));
      },
    ],
    [
      "a deposit from an account other than the owner's own",
      (ixs) => {
        const at = 5;
        call(ixs, "deposit").keys[at].pubkey = agentAta(addresses.usdc, TOKEN);
      },
    ],
    [
      "a call that pays an account other than the owner's own",
      (ixs) => {
        call(ixs, "removeLiquidity").keys[5].pubkey = agentAta(addresses.stock, TOKEN_2022);
      },
    ],
    [
      "a deleted range's rent to someone other than the owner",
      (ixs) => {
        call(ixs, "removeRanges").keys[4].pubkey = new PublicKey(who.agent);
      },
    ],
    [
      "a new range the agent does not pay for",
      (ixs) => {
        /* Named, not signing: were it a signer, the message would need the person's signature and be refused for that first. */
        call(ixs, "expand").keys[4] = { pubkey: new PublicKey(who.person), isSigner: false, isWritable: true };
      },
    ],
    ["an instruction outside the keeper's", (ixs) => [...ixs, SystemProgram.transfer({ fromPubkey: new PublicKey(who.agent), toPubkey: Keypair.generate().publicKey, lamports: 1 })]],
    ["the compute budget is outside the agent's ceiling", (ixs) => [...ixs.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId)), ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000_000 })]],
    ["a call of the program that is not a keeper's", (ixs) => [...ixs, { programId: PROGRAM, keys: [], data: Buffer.alloc(8, 7) }]],
  ];
  for (const [reason, change] of cases) assert.equal(keeperRefusalOf(bent(change), keeper), reason, reason);
});

test("the same move is refused to anyone it was not built for: another agent, another owner, another pool or position, a keeper that only takes out", () => {
  const wire = messageOf(fixture.signed.close0.wire);
  assert.equal(keeperRefusalOf(wire, { ...keeper, agent: Keypair.generate().publicKey.toBase58() }), "the agent is not the one payer and signer");
  assert.equal(keeperRefusalOf(wire, { ...keeper, owner: who.agent }), "the agent is not the position's owner");
  assert.equal(keeperRefusalOf(wire, { ...keeper, pool: addresses.usdc }), "a call on another pool");
  assert.equal(keeperRefusalOf(wire, { ...keeper, nftMint: addresses.probePosition }), "a call on another position");
  assert.equal(keeperRefusalOf(wire, { ...keeper, bounds: bounds.pull }), "a keeper that only takes out lays no range and puts nothing back");
  assert.equal(keeperRefusalOf(wire, { ...keeper, bounds: { ...bounds.shift, widestBps: 100 } }), "a range wider than the person allowed", "bounds narrowed after the build: the move is outside them");
  assert.equal(keeperRefusalOf(wire, { ...keeper, mints: [addresses.usdc] }), null, "the move opens no account of the owner's");
  assert.equal(keeperRefusalOf(Uint8Array.of(1, 2, 3), keeper), "not a transaction message");
  assert.equal(keeperRefusalOf(bent(() => null, new PublicKey(who.person)), keeper), "the agent is not the one payer and signer");
  /* A take-out alone is what a keeper that only takes out signs. */
  const pull = fixture.signed.pull0;
  assert.equal(keeperRefusalOf(messageOf(pull.wire), pull.subject), null);
  assert.deepEqual(pull.subject.bounds, bounds.pull);
});

test("the lock reads the two calls' arguments as the program lays them out", () => {
  const data = expand(Buffer.alloc(8, 1), [
    { tickLowerId: -120, tickUpperId: 80 },
    { tickLowerId: 5, tickUpperId: 9 },
  ]);
  assert.deepEqual(expandRangesOf(data), [
    { tickLowerId: -120, tickUpperId: 80 },
    { tickLowerId: 5, tickUpperId: 9 },
  ]);
  assert.throws(() => expandRangesOf(Buffer.alloc(10)));
  const { message } = closeMessage();
  const original = call(message.instructions, "deposit").data;
  const same = deposit(original, {});
  assert.deepEqual(Buffer.from(same), Buffer.from(original), "the test's own writer lays the data out as the SDK did");
  assert.throws(() => depositTermsOf(Buffer.alloc(9)));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, PublicKey, SystemInstruction, SystemProgram, Transaction } from "@solana/web3.js";
import { CpAmm, derivePositionAddress } from "@meteora-ag/cp-amm-sdk";

import { ACTIONS_UNTIL, LiquidityRefusal, liquidityActions, liquidityVenueCapabilities } from "./contract.ts";
import { DAMM_V2_PROGRAM, createDammV2Venue } from "./damm-v2.ts";
import { DLMM_PROGRAM, DLMM_PREVIEW_TTL_MS, createDlmmVenue } from "./dlmm.ts";
import { assertBinRange, assertSidesFit, binRangeState, minusSlippage, numeratorToBps, parseUnits, percentToBps, plusSlippage, shareOf, sqrtRangeState } from "./math.ts";
import { replayConnection, TapeMiss } from "./rpc-cassette.ts";
import { DAMM_V2_SCENARIO, DLMM_SCENARIO, dlmmSdkFromCommonJs, fixedKeypair } from "./fixtures/scenarios.mjs";

const require = createRequire(import.meta.url);
const tape = (name) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.tape.json.gz`, import.meta.url))).toString("utf8"));
const DLMM_TAPE = tape("dlmm");
const DAMM_TAPE = tape("damm-v2");
const DLMM_SDK = dlmmSdkFromCommonJs(require("@meteora-ag/dlmm"));

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();
const ATA = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const MEMO = "MemoSq4gqABAXKb96qWH1toBVWyYZfS6wqzfTjxWNa1";

const dlmmVenue = (now = DLMM_TAPE.scenario.now) =>
  createDlmmVenue({ connection: replayConnection(DLMM_TAPE), sdk: DLMM_SDK, now: () => now, newKeypair: () => fixedKeypair(DLMM_SCENARIO.seed) });
const dammVenue = (now = DAMM_TAPE.scenario.now) => createDammV2Venue({ connection: replayConnection(DAMM_TAPE), now: () => now, newKeypair: () => fixedKeypair(DAMM_V2_SCENARIO.seed) });

const DLMM_CODER = DLMM_SDK.createProgram(new Connection("http://127.0.0.1:9")).coder.instruction;
const DAMM_CODER = new CpAmm(new Connection("http://127.0.0.1:9"))._program.coder.instruction;

const refusal = (code) => (error) => error instanceof LiquidityRefusal && error.code === code;
const digits = (value) => typeof value === "string" && /^\d+$/.test(value);

/**
 * What a built transaction may touch, decoded instruction by instruction: the compute budget; SOL moved only into the
 * person's own token account (wrapping); token accounts created only for the person, paid by the person; token
 * accounts closed only back to the person; no token transfer or approval at the top level at all — the venue's own
 * program moves the tokens, against the arguments checked below. Returns the venue's instructions, decoded.
 */
function assertOnlyThePersonsMoney(built, preview, venueProgram, owner, mints) {
  const person = new PublicKey(owner);
  const own = new Set(mints.map(([mint, program]) => getAssociatedTokenAddressSync(new PublicKey(mint), person, true, new PublicKey(program)).toBase58()));
  const coder = venueProgram === DLMM_PROGRAM ? DLMM_CODER : DAMM_CODER;
  const decoded = [];
  assert.equal(built.feePayer, owner);
  assert.ok(digits(built.validUntil));
  assert.ok(built.transactions.length >= 1 && built.transactions.length <= preview.transactions, "no more transactions than the preview said");
  for (const unsigned of built.transactions) {
    const tx = Transaction.from(Buffer.from(unsigned.wireBase64, "base64"));
    assert.equal(tx.feePayer.toBase58(), owner);
    const personSignature = tx.signatures.find((entry) => entry.publicKey.equals(person));
    assert.ok(personSignature, "the person signs");
    assert.equal(personSignature.signature, null, "the build never signs for the person");
    for (const entry of tx.signatures) if (!entry.publicKey.equals(person)) assert.ok(unsigned.presigned.includes(entry.publicKey.toBase58()) && entry.signature, "every other signer is a fresh key that already signed");
    for (const ix of tx.instructions) {
      const program = ix.programId.toBase58();
      if (program === ComputeBudgetProgram.programId.toBase58()) continue;
      if (program === SystemProgram.programId.toBase58()) {
        assert.equal(SystemInstruction.decodeInstructionType(ix), "Transfer", "the only System call is wrapping SOL");
        const { fromPubkey, toPubkey } = SystemInstruction.decodeTransfer(ix);
        assert.ok(fromPubkey.equals(person) && own.has(toPubkey.toBase58()), "SOL moves only into the person's own token account");
      } else if (program === ATA) {
        assert.ok(ix.keys[0].pubkey.equals(person), "the person pays for the token account");
        assert.ok(ix.keys[2].pubkey.equals(person), "a token account is created only for the person");
      } else if (program === TOKEN || program === TOKEN_2022) {
        const kind = ix.data[0];
        if (kind === 17) assert.ok(own.has(ix.keys[0].pubkey.toBase58()), "only the person's own account is synced");
        else if (kind === 9) assert.ok(ix.keys[1].pubkey.equals(person) && ix.keys[2].pubkey.equals(person), "a closed account pays back to the person");
        else assert.fail(`a token instruction ${kind} at the top level`);
      } else if (program === venueProgram) {
        const call = coder.decode(ix.data);
        decoded.push(call);
        /* The venue's own accounts by the program's IDL: the person's token accounts receive, the person signs and gets the rent back. */
        const names = ACCOUNTS[venueProgram].get(call.name.toLowerCase());
        assert.ok(names, `the IDL names the accounts of ${call.name}`);
        names.forEach((name, index) => {
          const meta = ix.keys[index];
          if (!meta) return;
          if (TOKEN_ACCOUNTS.has(name)) assert.ok(own.has(meta.pubkey.toBase58()), `${call.name}.${name} is the person's own token account`);
          if (PERSON_ACCOUNTS.has(name)) assert.ok(meta.pubkey.equals(person), `${call.name}.${name} is the person`);
        });
      } else if (program !== MEMO) {
        assert.fail(`unexpected program ${program}`);
      }
    }
  }
  assert.ok(decoded.length > 0, "the venue's program is called");
  return decoded;
}

const accountsOf = (idl) => new Map(idl.instructions.map((ix) => [ix.name.replace(/_/g, "").toLowerCase(), ix.accounts.map((account) => account.name)]));
const ACCOUNTS = { [DLMM_PROGRAM]: accountsOf(require("@meteora-ag/dlmm").IDL), [DAMM_V2_PROGRAM]: accountsOf(require("@meteora-ag/cp-amm-sdk").CpAmmIdl) };
const TOKEN_ACCOUNTS = new Set(["user_token_x", "user_token_y", "token_a_account", "token_b_account"]);
const PERSON_ACCOUNTS = new Set(["sender", "signer", "rent_receiver", "owner", "payer"]);

const named = (decoded, name) => decoded.find((ix) => ix?.name === name)?.data;
const bn = (value) => BigInt(value.toString());

/* ------------------------------------------------------------------ math */

test("slippage rounds against the person: the floor down, the ceiling up", () => {
  assert.equal(minusSlippage(1_000_001n, 100), 990_000n);
  assert.equal(plusSlippage(1_000_001n, 100), 1_010_002n);
  assert.equal(plusSlippage(1_000_000n, 100), 1_010_000n);
  assert.equal(shareOf(999n, 5_000), 499n);
  assert.equal(percentToBps("0.04"), 4);
  assert.equal(percentToBps(0.0255), 2.55);
  assert.equal(numeratorToBps(400_000n), 4);
  assert.equal(numeratorToBps(2_500_000n), 25);
});

test("a range's place against the price, and the sides it accepts", () => {
  assert.equal(binRangeState(10, 20, 15), "in_range");
  assert.equal(binRangeState(16, 20, 15), "above");
  assert.equal(binRangeState(10, 14, 15), "below");
  assert.equal(sqrtRangeState(5n, 1n, 9n), "in_range");
  assert.equal(sqrtRangeState(1n, 1n, 9n), "above");
  assert.equal(sqrtRangeState(9n, 1n, 9n), "below");
  assert.doesNotThrow(() => assertSidesFit("above", 5n, 0n));
  assert.throws(() => assertSidesFit("above", 5n, 1n), refusal("SIDE_NOT_ACCEPTED"));
  assert.throws(() => assertSidesFit("below", 1n, 5n), refusal("SIDE_NOT_ACCEPTED"));
  assert.throws(() => assertSidesFit("in_range", 0n, 0n), refusal("AMOUNT_ZERO"));
  assert.throws(() => assertBinRange(5, 4, 70, 1000), refusal("RANGE_INVALID"));
  assert.throws(() => assertBinRange(0, 70, 70, 1000), refusal("RANGE_TOO_WIDE"));
  assert.doesNotThrow(() => assertBinRange(0, 69, 70, 1000));
  assert.throws(() => parseUnits("1.5", "amount"), refusal("BAD_REQUEST"));
  assert.throws(() => parseUnits("-1", "amount"), refusal("BAD_REQUEST"));
});

test("reading is on, actions wait for a live check, and the venue carries only `liquidity`", () => {
  const closed = liquidityActions(false);
  assert.deepEqual(closed.pools, { status: "on" });
  assert.deepEqual(closed.positions, { status: "on" });
  for (const action of ["add", "remove", "claim"]) assert.deepEqual(closed[action], { status: "later", until: ACTIONS_UNTIL });
  assert.deepEqual(liquidityActions(true).add, { status: "on" });
  const flags = liquidityVenueCapabilities();
  assert.deepEqual(flags.liquidity, { status: "on" });
  for (const flag of ["swap", "limit", "clob", "perps", "launch"]) assert.deepEqual(flags[flag], { status: "off" });
  const venue = dlmmVenue();
  assert.equal(venue.capabilities().maxBins, 70);
  assert.deepEqual(venue.capabilities().actions.add, { status: "later", until: ACTIONS_UNTIL });
});

test("the tape answers only what it holds", async () => {
  const connection = replayConnection({ endpoint: "x", recordedAt: "x", calls: [{ method: "getSlot", params: [{ commitment: "confirmed" }], response: { jsonrpc: "2.0", id: "1", result: 7 } }] });
  assert.equal(await connection.getSlot("confirmed"), 7);
  await assert.rejects(() => connection.getSlot("finalized"), (error) => error instanceof TapeMiss || /tape holds no answer/.test(String(error?.message)));
});

/* ------------------------------------------------------------------ DLMM */

test("DLMM: the SOL-USDC pool as the chain holds it — bins, price, fees, reserves, with source and time", async () => {
  const pool = await dlmmVenue().pool(DLMM_SCENARIO.pool);
  assert.equal(pool.venue, "meteora-dlmm");
  assert.equal(pool.network, "solana");
  assert.equal(pool.tokenX.mint, SOL);
  assert.equal(pool.tokenX.decimals, 9);
  assert.equal(pool.tokenY.mint, USDC);
  assert.equal(pool.tokenY.decimals, 6);
  assert.equal(pool.shape.kind, "bins");
  assert.equal(pool.shape.activeBin, DLMM_TAPE.scenario.active);
  assert.ok(pool.shape.binStepBps > 0);
  const price = Number(pool.price);
  assert.ok(price > 20 && price < 2_000, `a SOL price in dollars, not ${pool.price}`);
  assert.ok(pool.fees.baseBps > 0);
  assert.ok(pool.fees.currentBps >= pool.fees.baseBps);
  assert.ok(pool.fees.maxBps >= pool.fees.currentBps);
  assert.ok(pool.fees.protocolSharePct >= 0 && pool.fees.protocolSharePct <= 100);
  assert.ok(digits(pool.reserves.x.units) && digits(pool.reserves.y.units));
  assert.equal(pool.reserves.x.asset, SOL);
  assert.equal(pool.enabled, true);
  assert.deepEqual({ kind: pool.source.kind, program: pool.source.program, at: pool.source.at }, { kind: "chain", program: DLMM_PROGRAM, at: DLMM_TAPE.scenario.now });
  assert.ok(Number.isInteger(pool.source.slot));
  assert.deepEqual(dlmmVenue().fees(pool), [{ who: "venue", applies_to: "swap", bps: pool.fees.currentBps }]);
});

test("DLMM: a wallet's positions from the program — range, side, amounts and waiting fees agree with the price", async () => {
  const venue = dlmmVenue();
  const positions = await venue.positions(DLMM_SCENARIO.lp);
  assert.equal(positions.length, 12);
  const active = DLMM_TAPE.scenario.active;
  for (const position of positions) {
    assert.equal(position.owner, DLMM_SCENARIO.lp);
    assert.equal(position.pool, DLMM_SCENARIO.pool);
    assert.equal(position.range.kind, "bins");
    assert.equal(position.rangeState, binRangeState(position.range.lowerBin, position.range.upperBin, active));
    assert.ok(Number(position.range.lowerPrice) < Number(position.range.upperPrice));
    if (position.rangeState === "above") assert.equal(position.amounts.y.units, "0");
    if (position.rangeState === "below") assert.equal(position.amounts.x.units, "0");
    assert.equal(position.lockedBps, 0);
    assert.equal(position.nftMint, null);
  }
  const noFees = positions.find((p) => p.address === DLMM_SCENARIO.noFees);
  assert.deepEqual([noFees.unclaimedFees.x.units, noFees.unclaimedFees.y.units], ["0", "0"]);
  const inPool = await venue.positions(DLMM_SCENARIO.lp, { pool: DLMM_SCENARIO.pool });
  assert.deepEqual(inPool.map((p) => p.address), positions.map((p) => p.address));
  const one = await venue.position(DLMM_SCENARIO.inRange);
  assert.equal(one.rangeState, "in_range");
  assert.deepEqual({ ...one, source: null }, { ...positions.find((p) => p.address === DLMM_SCENARIO.inRange), source: null });
  assert.equal((await venue.position(DLMM_SCENARIO.oneSided)).rangeState, "above");
});

test("DLMM: Ryntra's executor holds one ladder step below the price — quote token only", async () => {
  const [step] = await dlmmVenue().positions(DLMM_SCENARIO.executor);
  assert.equal(step.rangeState, "below");
  assert.equal(step.amounts.x.units, "0");
  assert.equal(step.amounts.y.units, "10500000");
  assert.equal(step.amounts.y.asset, USDC);
});


test("DLMM: a new position across the price — rent from the network, no fee row, the fresh key signs, the program gets the preview's amounts", async () => {
  const venue = dlmmVenue();
  const s = DLMM_TAPE.scenario;
  const preview = await venue.previewAdd({ pool: s.pool, owner: s.lp, amountX: s.amountX, amountY: s.amountY, bins: s.bins, shape: "spot", slippageBps: 100 });
  assert.equal(preview.action, "add");
  assert.equal(preview.opensPosition, true);
  assert.equal(preview.rangeState, "in_range");
  assert.deepEqual(preview.range.kind === "bins" && [preview.range.lowerBin, preview.range.upperBin], [s.bins.lower, s.bins.upper]);
  assert.deepEqual([preview.deposit.x.units, preview.deposit.y.units], [s.amountX, s.amountY]);
  assert.deepEqual(preview.fees, []);
  assert.deepEqual(preview.notices, []);
  const position = preview.rent.find((r) => r.what === "position");
  assert.equal(position.direction, "pay");
  assert.equal(position.refundable, true);
  assert.ok(BigInt(position.lamports) > 0n && BigInt(position.lamports) < 57_406_080n, "the network's rent, below the SDK's stale constant");
  assert.equal(preview.expiresAt - preview.at, DLMM_PREVIEW_TTL_MS);

  const built = await venue.buildAdd(preview);
  const key = fixedKeypair(DLMM_SCENARIO.seed).publicKey.toBase58();
  assert.equal(built.position, key);
  assert.deepEqual(built.transactions.map((t) => t.presigned), [[key]]);
  const decoded = assertOnlyThePersonsMoney(built, preview, DLMM_PROGRAM, s.lp, [[SOL, TOKEN], [USDC, TOKEN]]);
  assert.deepEqual(named(decoded, "initializePosition"), { lowerBinId: s.bins.lower, width: s.bins.upper - s.bins.lower + 1 });
  const add = named(decoded, "addLiquidityByStrategy2").liquidityParameter;
  assert.deepEqual([bn(add.amountX), bn(add.amountY)], [BigInt(s.amountX), BigInt(s.amountY)]);
  assert.deepEqual([add.strategyParameters.minBinId, add.strategyParameters.maxBinId], [s.bins.lower, s.bins.upper]);
});

test("DLMM: a range above the price takes only SOL, says so, and refuses USDC", async () => {
  const venue = dlmmVenue();
  const s = DLMM_TAPE.scenario;
  const preview = await venue.previewAdd({ pool: s.pool, owner: s.lp, amountX: s.amountX, amountY: "0", bins: s.above, shape: "curve", slippageBps: 100 });
  assert.equal(preview.rangeState, "above");
  assert.deepEqual(preview.notices, ["one_sided"]);
  assert.equal(preview.request.shape, "curve");
  const add = named(assertOnlyThePersonsMoney(await venue.buildAdd(preview), preview, DLMM_PROGRAM, s.lp, [[SOL, TOKEN], [USDC, TOKEN]]), "addLiquidityByStrategy2").liquidityParameter;
  assert.deepEqual([bn(add.amountX), bn(add.amountY)], [BigInt(s.amountX), 0n]);
  await assert.rejects(() => venue.previewAdd({ pool: s.pool, owner: s.lp, amountX: s.amountX, amountY: s.amountY, bins: s.above, shape: "spot", slippageBps: 100 }), refusal("SIDE_NOT_ACCEPTED"));
});

test("DLMM: adding to a held position keeps its bins and opens nothing", async () => {
  const venue = dlmmVenue();
  const s = DLMM_TAPE.scenario;
  const held = await venue.position(s.inRange);
  const preview = await venue.previewAdd({ pool: s.pool, owner: s.lp, position: s.inRange, amountX: s.amountX, amountY: s.amountY, slippageBps: 100 });
  assert.equal(preview.opensPosition, false);
  assert.deepEqual(preview.rent, []);
  assert.deepEqual(preview.request.bins, { lower: held.range.lowerBin, upper: held.range.upperBin });
  const built = await venue.buildAdd(preview);
  assert.equal(built.position, s.inRange);
  assert.deepEqual(built.transactions.map((t) => t.presigned), [[]]);
  const decoded = assertOnlyThePersonsMoney(built, preview, DLMM_PROGRAM, s.lp, [[SOL, TOKEN], [USDC, TOKEN]]);
  assert.equal(named(decoded, "initializePosition"), undefined);
  assert.equal(bn(named(decoded, "addLiquidityByStrategy2").liquidityParameter.amountX), BigInt(s.amountX));
});

test("DLMM: remove half, remove and close, claim — figures from the position, the program gets the same share and bins", async () => {
  const venue = dlmmVenue();
  const s = DLMM_TAPE.scenario;
  const listed = (await venue.positions(s.lp)).find((p) => p.address === s.inRange);
  assert.equal(listed.feeRecipient, s.lp);
  const half = await venue.previewRemove({ position: s.inRange, owner: s.lp, shareBps: 5_000, slippageBps: 100 });
  assert.equal(half.expected.x.units, (BigInt(listed.amounts.x.units) / 2n).toString(), "half of what the wallet's position list says");
  assert.equal(half.expected.y.units, (BigInt(listed.amounts.y.units) / 2n).toString());
  assert.equal(half.minimum, null, "DLMM pays each bin's share; the program takes no threshold");
  assert.deepEqual([half.feesClaimed.x.units, half.feesClaimed.y.units, half.rewardsClaimed], ["0", "0", []]);
  assert.equal(half.closesPosition, false);
  const removal = named(assertOnlyThePersonsMoney(await venue.buildRemove(half), half, DLMM_PROGRAM, s.lp, [[SOL, TOKEN], [USDC, TOKEN]]), "removeLiquidityByRange2");
  assert.deepEqual([removal.bpsToRemove, removal.fromBinId, removal.toBinId], [5_000, listed.range.lowerBin, listed.range.upperBin]);

  const close = await venue.previewRemove({ position: s.inRange, owner: s.lp, shareBps: 10_000, close: true, slippageBps: 100 });
  assert.deepEqual([close.feesClaimed.x.units, close.feesClaimed.y.units], [listed.unclaimedFees.x.units, listed.unclaimedFees.y.units]);
  assert.equal(close.rent[0].direction, "return");
  assert.ok(BigInt(close.rent[0].lamports) > 0n);
  const closing = assertOnlyThePersonsMoney(await venue.buildRemove(close), close, DLMM_PROGRAM, s.lp, [[SOL, TOKEN], [USDC, TOKEN]]);
  assert.equal(named(closing, "removeLiquidityByRange2").bpsToRemove, 10_000);
  assert.ok(closing.some((ix) => /^closePosition/.test(ix.name)), "the position is closed in the same signature");
  assert.ok(closing.some((ix) => /^claimFee/.test(ix.name)), "its fees are claimed on the way");

  const claim = await venue.previewClaim({ position: s.inRange, owner: s.lp });
  assert.deepEqual([claim.claimed.x.units, claim.claimed.y.units], [listed.unclaimedFees.x.units, listed.unclaimedFees.y.units]);
  assert.ok(BigInt(claim.claimed.x.units) > 0n);
  const claiming = named(assertOnlyThePersonsMoney(await venue.buildClaim(claim), claim, DLMM_PROGRAM, s.lp, [[SOL, TOKEN], [USDC, TOKEN]]), "claimFee2");
  assert.deepEqual([claiming.minBinId, claiming.maxBinId], [listed.range.lowerBin, listed.range.upperBin]);
});

test("DLMM: refusals — nothing to claim, someone else's position, bad requests, a stale or doctored preview", async () => {
  const venue = dlmmVenue();
  const s = DLMM_TAPE.scenario;
  await assert.rejects(() => venue.previewClaim({ position: s.noFees, owner: s.lp }), refusal("NOTHING_TO_CLAIM"));
  await assert.rejects(() => venue.previewRemove({ position: s.inRange, owner: s.executor, shareBps: 5_000, slippageBps: 100 }), refusal("NOT_OWNER"));
  await assert.rejects(() => venue.previewRemove({ position: s.inRange, owner: s.lp, shareBps: 0, slippageBps: 100 }), refusal("BAD_REQUEST"));
  await assert.rejects(() => venue.previewRemove({ position: s.inRange, owner: s.lp, shareBps: 5_000, close: true, slippageBps: 100 }), refusal("BAD_REQUEST"));
  await assert.rejects(() => venue.previewAdd({ pool: s.pool, owner: s.lp, amountX: "1", amountY: "1", bins: s.bins, slippageBps: 9_000 }), refusal("BAD_REQUEST"));
  await assert.rejects(() => venue.previewAdd({ pool: s.pool, owner: "not-an-address", amountX: "1", amountY: "1", bins: s.bins, slippageBps: 100 }), refusal("BAD_REQUEST"));
  await assert.rejects(() => venue.previewAdd({ pool: s.pool, owner: s.lp, amountX: "1", amountY: "1", slippageBps: 100 }), refusal("RANGE_INVALID"));
  await assert.rejects(() => venue.previewAdd({ pool: s.pool, owner: s.lp, amountX: "1", amountY: "1", bins: { lower: s.active - 40, upper: s.active + 40 }, slippageBps: 100 }), refusal("RANGE_TOO_WIDE"));
  const preview = await venue.previewAdd({ pool: s.pool, owner: s.lp, amountX: s.amountX, amountY: s.amountY, bins: s.bins, shape: "spot", slippageBps: 100 });
  await assert.rejects(() => dlmmVenue(s.now + DLMM_PREVIEW_TTL_MS + 1).buildAdd(preview), refusal("PREVIEW_EXPIRED"));
  /* A preview edited on its way back is checked again, not trusted: a bad amount is refused, a moved price is refused. */
  await assert.rejects(() => venue.buildAdd({ ...preview, request: { ...preview.request, amountX: "1e21" } }), refusal("BAD_REQUEST"));
  await assert.rejects(() => venue.buildAdd({ ...preview, request: { ...preview.request, slippageBps: 9_999 } }), refusal("BAD_REQUEST"));
  await assert.rejects(() => venue.buildAdd({ ...preview, price: String(Number(preview.price) * 1.05) }), refusal("PREVIEW_EXPIRED"));
  /* A doctored deposit in the preview does not reach the chain: the build uses the request it re-checked. */
  const doctored = await venue.buildAdd({ ...preview, deposit: { ...preview.deposit, x: { ...preview.deposit.x, units: "1" } } });
  const sent = named(assertOnlyThePersonsMoney(doctored, preview, DLMM_PROGRAM, s.lp, [[SOL, TOKEN], [USDC, TOKEN]]), "addLiquidityByStrategy2").liquidityParameter;
  assert.equal(bn(sent.amountX), BigInt(s.amountX));
});

/* --------------------------------------------------------------- DAMM v2 */

test("DAMM v2: a bounded SOL-USDC curve with the price between its bounds; a compounding launch pool with none", async () => {
  const venue = dammVenue();
  const s = DAMM_TAPE.scenario;
  const curve = await venue.pool(s.pool);
  assert.equal(curve.venue, "meteora-damm2");
  assert.equal(curve.tokenX.mint, SOL);
  assert.equal(curve.tokenY.mint, USDC);
  assert.equal(curve.shape.compounding, false);
  assert.equal(curve.shape.concentrated, true);
  assert.ok(Number(curve.shape.minPrice) < Number(curve.price) && Number(curve.price) < Number(curve.shape.maxPrice));
  assert.equal(curve.fees.baseBps, 4);
  assert.equal(curve.fees.currentBps, null, "no dynamic part on this pool");
  assert.equal(curve.fees.protocolSharePct, 20);
  assert.ok(BigInt(curve.reserves.x.units) > 0n && BigInt(curve.reserves.y.units) > 0n);
  assert.equal(curve.source.program, DAMM_V2_PROGRAM);
  assert.deepEqual(venue.fees(curve), [{ who: "venue", applies_to: "swap", bps: 4 }]);

  const launch = await venue.pool(s.compoundingPool);
  assert.equal(launch.tokenX.program, TOKEN_2022);
  assert.deepEqual(launch.shape, { kind: "range", minPrice: null, maxPrice: null, concentrated: false, compounding: true });
  assert.equal(launch.enabled, true);
  assert.ok(launch.fees.baseBps > 0);
});

test("DAMM v2: positions by who holds the NFT — free, vesting and locked for good counted apart", async () => {
  const venue = dammVenue();
  const s = DAMM_TAPE.scenario;
  const [mine] = await venue.positions(s.lp);
  assert.equal(mine.address, s.unlocked);
  assert.equal(mine.owner, s.lp);
  assert.equal(mine.feeRecipient, s.lp);
  assert.equal(mine.pool, s.pool);
  assert.ok(mine.nftMint);
  assert.equal(mine.lockedBps, 0);
  assert.equal(mine.rangeState, "in_range");
  assert.ok(BigInt(mine.amounts.x.units) > 0n && BigInt(mine.amounts.y.units) > 0n);
  assert.ok(BigInt(mine.unclaimedFees.x.units) > 0n);
  assert.deepEqual((await venue.positions(s.lp, { pool: s.pool })).map((p) => p.address), [s.unlocked]);
  assert.deepEqual({ ...(await venue.position(s.unlocked)), source: null }, { ...mine, source: null });

  const executor = await venue.positions(s.executor);
  assert.equal(executor.find((p) => p.address === s.locked).lockedBps, 10_000);
  const vesting = (await venue.positions(s.vester)).find((p) => p.address === s.vesting);
  assert.ok(vesting.lockedBps > 0 && vesting.lockedBps < 10_000, "part vesting, part free");
});

test("DAMM v2: a new position — the side that runs out decides, the NFT key signs beside the wallet, the program's caps are the preview's", async () => {
  const venue = dammVenue();
  const s = DAMM_TAPE.scenario;
  const preview = await venue.previewAdd({ pool: s.pool, owner: s.lp, amountX: s.amountX, amountY: s.amountY, slippageBps: 100 });
  assert.equal(preview.opensPosition, true);
  assert.equal(preview.rangeState, "in_range");
  const x = BigInt(preview.deposit.x.units);
  const y = BigInt(preview.deposit.y.units);
  assert.ok(x <= BigInt(s.amountX) && y <= BigInt(s.amountY));
  const floorX = minusSlippage(BigInt(s.amountX), 100);
  const floorY = minusSlippage(BigInt(s.amountY), 100);
  assert.ok(x >= floorX || y >= floorY, "the side that runs out goes in whole, less at most the slippage");
  assert.equal(preview.notices.includes("partial_deposit"), x < floorX || y < floorY);
  assert.deepEqual(preview.fees, []);
  assert.equal(preview.rent[0].what, "position");
  assert.ok(BigInt(preview.rent[0].lamports) > 0n);

  const built = await venue.buildAdd(preview);
  const nft = fixedKeypair(DAMM_V2_SCENARIO.seed).publicKey;
  assert.equal(built.position, derivePositionAddress(nft).toBase58());
  assert.deepEqual(built.transactions[0].presigned, [nft.toBase58()]);
  const decoded = assertOnlyThePersonsMoney(built, preview, DAMM_V2_PROGRAM, s.lp, [[SOL, TOKEN], [USDC, TOKEN]]);
  assert.ok(named(decoded, "createPosition"));
  const add = named(decoded, "addLiquidity").params;
  assert.ok(bn(add.liquidityDelta) > 0n);
  assert.deepEqual([bn(add.tokenAAmountThreshold), bn(add.tokenBAmountThreshold)], [x, y], "the caps the wallet signs are the deposit Review shows");
  /* A doctored preview can only tighten the caps, never loosen them. */
  const tightened = named(assertOnlyThePersonsMoney(await venue.buildAdd({ ...preview, deposit: { ...preview.deposit, y: { ...preview.deposit.y, units: "1" } } }), preview, DAMM_V2_PROGRAM, s.lp, [[SOL, TOKEN], [USDC, TOKEN]]), "addLiquidity").params;
  assert.equal(bn(tightened.tokenBAmountThreshold), 1n);
  const loosened = named(assertOnlyThePersonsMoney(await venue.buildAdd({ ...preview, deposit: { ...preview.deposit, x: { ...preview.deposit.x, units: "999999999999" } } }), preview, DAMM_V2_PROGRAM, s.lp, [[SOL, TOKEN], [USDC, TOKEN]]), "addLiquidity").params;
  assert.equal(bn(loosened.tokenAAmountThreshold), x);
  await assert.rejects(() => venue.previewAdd({ pool: s.pool, owner: s.lp, amountX: s.amountX, amountY: "0", slippageBps: 100 }), refusal("SIDE_NOT_ACCEPTED"));
});

test("DAMM v2: into the compounding pool — both tokens, the launch token's own program", async () => {
  const venue = dammVenue();
  const s = DAMM_TAPE.scenario;
  const preview = await venue.previewAdd({ pool: s.compoundingPool, owner: s.lp, amountX: s.compoundingAmountX, amountY: s.compoundingAmountY, slippageBps: 100 });
  assert.equal(preview.rangeState, "in_range");
  assert.deepEqual(preview.range, { kind: "range", minPrice: null, maxPrice: null });
  const built = await venue.buildAdd(preview);
  const add = named(assertOnlyThePersonsMoney(built, preview, DAMM_V2_PROGRAM, s.lp, [[preview.deposit.x.asset, TOKEN_2022], [USDC, TOKEN]]), "addLiquidity").params;
  assert.equal(bn(add.tokenAAmountThreshold), BigInt(preview.deposit.x.units));
  assert.ok(BigInt(preview.deposit.x.units) <= BigInt(s.compoundingAmountX) && BigInt(preview.deposit.y.units) <= BigInt(s.compoundingAmountY));
});

test("DAMM v2: add to a held position, remove half with its floor, close with its fees, claim", async () => {
  const venue = dammVenue();
  const s = DAMM_TAPE.scenario;
  const held = await venue.position(s.unlocked);
  const mints = [[SOL, TOKEN], [USDC, TOKEN]];

  const add = await venue.previewAdd({ pool: s.pool, owner: s.lp, position: s.unlocked, amountX: s.amountX, amountY: s.amountY, slippageBps: 100 });
  assert.equal(add.opensPosition, false);
  assert.deepEqual(add.rent, []);
  const addBuilt = await venue.buildAdd(add);
  assert.deepEqual(addBuilt.transactions[0].presigned, []);
  const adding = assertOnlyThePersonsMoney(addBuilt, add, DAMM_V2_PROGRAM, s.lp, mints);
  assert.equal(named(adding, "createPosition"), undefined);
  assert.equal(bn(named(adding, "addLiquidity").params.tokenAAmountThreshold), BigInt(add.deposit.x.units));

  const half = await venue.previewRemove({ position: s.unlocked, owner: s.lp, shareBps: 5_000, slippageBps: 100 });
  assert.ok(BigInt(half.expected.x.units) > 0n && BigInt(half.expected.y.units) > 0n);
  assert.ok(BigInt(half.expected.x.units) <= BigInt(held.amounts.x.units) / 2n + 1n);
  assert.equal(half.minimum.x.units, minusSlippage(BigInt(half.expected.x.units), 100).toString());
  assert.equal(half.minimum.y.units, minusSlippage(BigInt(half.expected.y.units), 100).toString());
  const removing = named(assertOnlyThePersonsMoney(await venue.buildRemove(half), half, DAMM_V2_PROGRAM, s.lp, mints), "removeLiquidity").params;
  assert.deepEqual([bn(removing.tokenAAmountThreshold), bn(removing.tokenBAmountThreshold)], [BigInt(half.minimum.x.units), BigInt(half.minimum.y.units)]);
  /* A doctored floor can only rise: a lowered one is ignored. */
  const lowered = named(assertOnlyThePersonsMoney(await venue.buildRemove({ ...half, minimum: { x: { ...half.minimum.x, units: "0" }, y: { ...half.minimum.y, units: "0" } } }), half, DAMM_V2_PROGRAM, s.lp, mints), "removeLiquidity").params;
  assert.equal(bn(lowered.tokenAAmountThreshold), BigInt(half.minimum.x.units));

  const close = await venue.previewRemove({ position: s.unlocked, owner: s.lp, shareBps: 10_000, close: true, slippageBps: 100 });
  assert.deepEqual([close.feesClaimed.x.units, close.feesClaimed.y.units], [held.unclaimedFees.x.units, held.unclaimedFees.y.units]);
  assert.equal(close.rent[0].direction, "return");
  const closing = assertOnlyThePersonsMoney(await venue.buildRemove(close), close, DAMM_V2_PROGRAM, s.lp, mints);
  assert.ok(closing.some((ix) => ix.name === "closePosition"), "the position is closed in the same signature");
  assert.ok(closing.some((ix) => ix.name === "claimPositionFee"), "its fees are claimed on the way");

  const claim = await venue.previewClaim({ position: s.unlocked, owner: s.lp });
  assert.deepEqual([claim.claimed.x.units, claim.claimed.y.units], [held.unclaimedFees.x.units, held.unclaimedFees.y.units]);
  assert.ok(assertOnlyThePersonsMoney(await venue.buildClaim(claim), claim, DAMM_V2_PROGRAM, s.lp, mints).some((ix) => ix.name === "claimPositionFee"));
});

test("DAMM v2: a vesting position gives only its free part and names the vesting; a locked one and a stranger are refused", async () => {
  const venue = dammVenue();
  const s = DAMM_TAPE.scenario;
  const vested = await venue.previewRemove({ position: s.vesting, owner: s.vester, shareBps: 5_000, slippageBps: 100 });
  assert.ok(vested.notices.includes("locked_part_stays"));
  assert.ok(BigInt(vested.expected.x.units) > 0n);
  await assert.rejects(() => venue.previewRemove({ position: s.vesting, owner: s.vester, shareBps: 10_000, close: true, slippageBps: 100 }), refusal("POSITION_LOCKED"));
  assertOnlyThePersonsMoney(await venue.buildRemove(vested), vested, DAMM_V2_PROGRAM, s.vester, [[SOL, TOKEN], [USDC, TOKEN]]);
  await assert.rejects(() => venue.previewRemove({ position: s.locked, owner: s.executor, shareBps: 5_000, slippageBps: 100 }), refusal("POSITION_LOCKED"));
  await assert.rejects(() => venue.previewRemove({ position: s.unlocked, owner: s.executor, shareBps: 5_000, slippageBps: 100 }), refusal("NOT_OWNER"));
});

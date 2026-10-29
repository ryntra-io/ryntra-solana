import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import {
  CLAIM_EVENTS,
  CLAIM_LAYOUTS,
  DAMM_V2_PROGRAM,
  DBC_PROGRAM,
  EVENT_IX_TAG,
  base58Decode,
  base58Encode,
  extractSolanaClaims,
  launchConfigPlans,
  PoolShareRowSchema,
  poolShareKey,
  poolShareTotals,
  receivedOf,
  reconcilePoolShares,
  valueReceived,
} from "./pool-share.ts";

const SAFE = "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA";
const EXECUTOR = "J7zLmXSewhb1kcqwpL4SKpKfivivwn6wmSHwSg6H4JeU";
const PROTECTED = "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G";
const MICRO = "3xh95YxdDBDiR35mWJo4E3hVoXNDqW4hdXemuWwsBD8w";
const DEMO = "GVDLyxgHraJcbmzds6i6hMgb3jSUUhSaHq5XVFnq6AS5";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const POOL = "8VtucGA9hvmH8GTVnVRbF5CNNfaLTKie5DyLAEaQJ6e1";
const TOKEN = "HgAhkysa1111111111111111111111111111111111";

const disc = (name) => Object.entries(CLAIM_LAYOUTS).find(([, layout]) => layout.name === name)[0];
const eventDisc = (name) => Object.entries(CLAIM_EVENTS).find(([, event]) => event === name)[0];
const u64 = (value) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const pk = (address) => Buffer.from(base58Decode(address).length === 32 ? base58Decode(address) : Buffer.concat([Buffer.alloc(32 - base58Decode(address).length), base58Decode(address)]));
const ixData = (name, ...rest) => base58Encode(Buffer.concat([Buffer.from(disc(name), "hex"), ...rest]));
const eventData = (name, ...fields) => base58Encode(Buffer.concat([Buffer.from(EVENT_IX_TAG, "hex"), Buffer.from(eventDisc(name), "hex"), ...fields]));

/** A claim_trading_fee2 the Squads safe executes: the call and its event are both inner instructions. */
function safeCurveClaim({ signature = "sigA", claimer = SAFE, config = PROTECTED, pool = POOL, quote = 47_824n, base = 0n, withEvent = true, err = null } = {}) {
  const accounts = ["auth", config, pool, "ta", "tb", "bv", "qv", TOKEN, USDC, claimer, "p1", "p2", "ea", DBC_PROGRAM];
  return {
    slot: 456_500_000,
    blockTime: 1_760_371_200,
    meta: {
      err,
      innerInstructions: [{
        index: 1,
        instructions: [
          { programId: DBC_PROGRAM, accounts, data: ixData("claim_trading_fee2", u64(1n), u64(2n)), stackHeight: 2 },
          ...(withEvent ? [{ programId: DBC_PROGRAM, accounts: ["ea"], data: eventData("EvtClaimTradingFee", pk(pool), u64(base), u64(quote)), stackHeight: 3 }] : []),
        ],
      }],
    },
    transaction: { signatures: [signature], message: { instructions: [{ programId: "ComputeBudget111111111111111111111111111111", data: "" }, { programId: "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf", accounts: [], data: "1" }] } },
  };
}

/** The SDKs' IDLs as their bundles carry them — read as text, so the test does not load the SDKs. */
function idlBlock(pkg, name) {
  const text = readFileSync(new URL(`../../node_modules/${pkg}/dist/index.js`, import.meta.url), "utf8");
  const at = text.search(new RegExp(`name:\\s*"${name}"`));
  assert.ok(at >= 0, `${name} is not in ${pkg}`);
  const block = text.slice(at, at + 6_000);
  const discriminator = Buffer.from(/discriminator:\s*\[([^\]]*)\]/.exec(block)[1].split(",").map((n) => Number(n.trim()))).toString("hex");
  const accounts = [...block.slice(0, block.indexOf("args:") > 0 ? block.indexOf("args:") : 0).matchAll(/\{\s*name:\s*"(\w+)"/g)].map((m) => m[1]);
  return { discriminator, accounts };
}

test("the discriminators and account places are the programs' own (Meteora SDK IDLs)", () => {
  for (const [discriminator, layout] of Object.entries(CLAIM_LAYOUTS)) {
    const pkg = layout.program === DBC_PROGRAM ? "@meteora-ag/dynamic-bonding-curve-sdk" : "@meteora-ag/cp-amm-sdk";
    const ix = idlBlock(pkg, layout.name);
    assert.equal(ix.discriminator, discriminator, layout.name);
    for (const [role, place] of Object.entries(layout.at)) {
      const expected = { config: "config", pool: layout.source === "curve" || layout.source === "lp" ? "pool" : "virtual_pool", claimer: layout.name === "withdraw_migration_fee" ? "sender" : layout.source === "lp" ? "signer" : "fee_claimer", baseMint: "base_mint", quoteMint: "quote_mint", tokenAMint: "token_a_mint", tokenBMint: "token_b_mint", position: "position", destination: layout.source === "curve" || layout.source === "lp" ? "token_b_account" : "token_quote_account" }[role];
      assert.equal(ix.accounts[place], expected, `${layout.name}.${role}`);
    }
    assert.equal(idlBlock(pkg, CLAIM_EVENTS[layout.event]).discriminator, layout.event, CLAIM_EVENTS[layout.event]);
  }
});

test("a Squads-executed curve claim is read from the inner instruction and its event", () => {
  const [fact] = extractSolanaClaims(safeCurveClaim(), new Set([SAFE]));
  assert.equal(fact.signature, "sigA");
  assert.equal(fact.index, "1.0");
  assert.equal(fact.source, "curve");
  assert.equal(fact.config, PROTECTED);
  assert.equal(fact.pool, POOL);
  assert.equal(fact.quoteMint, USDC);
  assert.equal(fact.pairRaw, 47_824n);
  assert.equal(fact.tokenRaw, 0n);
  assert.equal(fact.at, "2025-10-13T16:00:00.000Z");
});

test("no event — the amount is missing, not zero; another claimer or a failed transaction — nothing", () => {
  assert.equal(extractSolanaClaims(safeCurveClaim({ withEvent: false }), new Set([SAFE]))[0].pairRaw, null);
  assert.deepEqual(extractSolanaClaims(safeCurveClaim({ claimer: EXECUTOR }), new Set([SAFE])), []);
  assert.deepEqual(extractSolanaClaims(safeCurveClaim({ err: { InstructionError: [1, "Custom"] } }), new Set([SAFE])), []);
});

test("the migration fee carries its flag, and a DAMM v2 position claim its two sides", () => {
  const migration = {
    slot: 1, blockTime: 1, meta: { err: null, innerInstructions: [] },
    transaction: { signatures: ["sigM"], message: { instructions: [
      { programId: DBC_PROGRAM, accounts: ["auth", MICRO, POOL, "rcv", "qv", USDC, EXECUTOR, "p", "ea", DBC_PROGRAM], data: ixData("withdraw_migration_fee", Buffer.from([0])) },
    ] } },
  };
  migration.meta.innerInstructions = [{ index: 0, instructions: [{ programId: DBC_PROGRAM, accounts: ["ea"], data: eventData("EvtWithdrawMigrationFee", pk(POOL), u64(15_000_000n), Buffer.from([0])) }] }];
  const [m] = extractSolanaClaims(migration, new Set([EXECUTOR]));
  assert.equal(m.source, "migration");
  assert.equal(m.flag, 0);
  assert.equal(m.pairRaw, 15_000_000n);

  const DAMM = "7UNr1t6DnPb4vwmR72BioSnr5cbatwYWcxHAzawafMtD";
  const lp = {
    slot: 2, blockTime: 2, meta: { err: null, innerInstructions: [{ index: 0, instructions: [{ programId: DAMM_V2_PROGRAM, accounts: ["ea"], data: eventData("EvtClaimPositionFee", pk(DAMM), pk(POOL), pk(SAFE), u64(5n), u64(60_000n)) }] }] },
    transaction: { signatures: ["sigL"], message: { instructions: [
      { programId: DAMM_V2_PROGRAM, accounts: ["auth", DAMM, POOL, "ta", "tb", "va", "vb", TOKEN, USDC, "nft", SAFE, "p1", "p2", "ea", DAMM_V2_PROGRAM], data: ixData("claim_position_fee") },
    ] } },
  };
  const [l] = extractSolanaClaims(lp, new Set([SAFE]));
  assert.equal(l.source, "lp");
  assert.equal(l.pool, DAMM);
  assert.equal(l.baseMint, TOKEN);
  assert.equal(l.quoteMint, USDC);
  assert.equal(l.pairRaw, 60_000n);
  assert.equal(l.destination, "tb");
  assert.equal(l.destinationOwner, null, "no token balances, no stated owner");
  assert.equal(l.tokenRaw, 5n);
});

test("the registry decides who claims what: the safe takes all, the executor's Micro only revenue, the demo market nothing", () => {
  const plans = launchConfigPlans(ATTRIBUTION_REGISTRY);
  assert.deepEqual(plans.counted.get(PROTECTED), { id: "solana-launch-config-protected", config: PROTECTED, claimer: SAFE, rule: "ALL" });
  assert.equal(plans.counted.get("B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1G").claimer, SAFE);
  assert.deepEqual(plans.counted.get(MICRO), { id: "solana-launch-config-micro", config: MICRO, claimer: EXECUTOR, rule: "MICRO_REVENUE" });
  assert.equal(plans.counted.has(DEMO), false);
  assert.match(plans.skipped.get(DEMO), /demo/);
  assert.deepEqual([...plans.claimers].sort(), [SAFE, EXECUTOR].sort());
  /* An older registry document without the flag still says the demo market counts nothing. */
  const older = launchConfigPlans(ATTRIBUTION_REGISTRY.map(({ technicalValidation: _flag, ...row }) => row));
  assert.equal(older.counted.has(DEMO), false);
});

test("Micro: three quarters of the curve and the position, none of the migration fee or the surplus", () => {
  assert.equal(receivedOf("MICRO_REVENUE", "curve", 1_000n), 750n);
  assert.equal(receivedOf("MICRO_REVENUE", "lp", 1_001n), 751n);
  assert.equal(receivedOf("MICRO_REVENUE", "migration", 1_000n), 0n);
  assert.equal(receivedOf("MICRO_REVENUE", "surplus", 1_000n), 0n);
  assert.equal(receivedOf("ALL", "migration", 1_000n), 1_000n);
});

test("valuation: USDC at par; a community token at a price of the claim's moment, otherwise unvalued", () => {
  const at = "2026-10-13T16:00:00.000Z";
  assert.deepEqual(valueReceived({ network: "solana", mint: USDC, decimals: 6, raw: 47_824n, at, price: null }).usdMicros, "47824");
  assert.equal(valueReceived({ network: "arc", mint: "0x3600000000000000000000000000000000000000", decimals: 6, raw: 5n, at, price: null }).valuation.basis, "STABLECOIN_PAR");
  const community = "CommunityToken1111111111111111111111111111";
  const priced = valueReceived({ network: "solana", mint: community, decimals: 9, raw: 2_000_000_000n, at, price: { price: "0.25", sourceRef: "jupiter", observedAt: "2026-10-13T16:03:00.000Z" } });
  assert.equal(priced.usdMicros, "500000");
  assert.equal(priced.valuation.basis, "PRICED_AT_SETTLEMENT");
  const late = valueReceived({ network: "solana", mint: community, decimals: 9, raw: 2_000_000_000n, at, price: { price: "0.25", sourceRef: "jupiter", observedAt: "2026-10-13T16:10:00.000Z" } });
  assert.equal(late.usdMicros, null);
  assert.equal(late.valuation.basis, "UNVALUED");
  assert.equal(valueReceived({ network: "solana", mint: community, decimals: 9, raw: 1n, at, price: null }).usdMicros, null);
});

const claimRow = (over = {}) => ({
  kind: "CLAIM", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, venuePool: null, config: PROTECTED, creator: "SysvarRent111111111111111111111111111111111", source: "curve", claimer: SAFE,
  claim: { tx: "sigA", index: "1.0", block: 1, at: "2026-10-13T16:00:00.000Z", finality: "finalized" },
  asset: { mint: USDC, symbol: "USDC", decimals: 6 }, claimedRaw: "47824", receivedRaw: "47824", tokenRaw: "0", rule: "ALL", usdMicros: "47824",
  valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: null, observedAt: null }, allocation: null, recordedAt: "2026-10-13T17:00:00.000Z", ...over,
});

const POOL_A = `0x${"a".repeat(64)}`;
const POOL_B = `0x${"b".repeat(64)}`;
const splitRow = (parts, over = {}) => claimRow({
  network: "arc", chain: "eip155:5042", pool: null, source: "hook", rule: "OLDEST_CREDIT", asset: { mint: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6 },
  claimedRaw: "250", receivedRaw: "250", tokenRaw: null, usdMicros: "250", claim: { tx: "0xc40", index: "3", block: 40, at: "2026-10-13T16:00:00.000Z", finality: "finalized" },
  allocation: parts.map(([pool, raw]) => ({ pool, creator: null, receivedRaw: raw, usdMicros: raw })), ...over,
});

test("the key is the claim's own place — a split claim one key whatever its split", () => {
  assert.equal(poolShareKey(claimRow()), `solana:${POOL}:claim:sigA:1.0`);
  assert.equal(poolShareKey(splitRow([[POOL_A, "100"], [POOL_B, "150"]])), "arc:pooled:claim:0xc40:3");
  assert.equal(poolShareKey(splitRow([[null, "250"]])), "arc:pooled:claim:0xc40:3");
  assert.equal(PoolShareRowSchema.safeParse(splitRow([[POOL_A, "100"]])).success, false, "parts that do not add up are refused");
  assert.equal(PoolShareRowSchema.safeParse(claimRow({ pool: null })).success, false, "a claim with neither a pool nor an allocation is refused");
  assert.equal(PoolShareRowSchema.safeParse(claimRow({ claim: { ...claimRow().claim, finality: "confirmed" } })).success, false);
});

test("the totals: a split claim credits each pool its part; unvalued or pending is no data, not a smaller number", () => {
  const stream1 = { kind: "STREAM1", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, config: PROTECTED, venue: "curve", operationRef: "trade1", trader: SAFE, entries: 2, usdMicros: "6000", settledAt: "2026-10-13T15:00:00.000Z", recordedAt: "2026-10-13T17:00:00.000Z" };
  assert.equal(poolShareKey(stream1), `solana:${POOL}:stream1:trade1`);
  const [total] = poolShareTotals([claimRow(), stream1]);
  assert.deepEqual(total, { network: "solana", pool: POOL, claims: 1, receivedUsdMicros: "47824", valuedUsdMicros: "47824", unvaluedClaims: 0, stream1UsdMicros: "6000", stream1Operations: 1, stream1Pending: 0 });
  const [unvalued] = poolShareTotals([claimRow(), claimRow({ claim: { ...claimRow().claim, tx: "sigB" }, usdMicros: null, valuation: { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null } })]);
  assert.equal(unvalued.receivedUsdMicros, null);
  assert.equal(unvalued.valuedUsdMicros, "47824");
  assert.equal(unvalued.unvaluedClaims, 1);
  const [pending] = poolShareTotals([claimRow(), stream1], [{ pool: POOL, count: 1 }]);
  assert.equal(pending.stream1UsdMicros, null);
  assert.equal(pending.stream1Pending, 1);
  const [untraced] = poolShareTotals([claimRow(), stream1], [{ pool: null, count: 2 }]);
  assert.equal(untraced.stream1UsdMicros, null, "a trade not yet traced to a pool may be this pool's");
  const split = poolShareTotals([splitRow([[POOL_A, "100"], [POOL_B, "150"]])]);
  assert.deepEqual(split.map((row) => [row.pool, row.receivedUsdMicros]), [[POOL_A, "100"], [POOL_B, "150"]]);
});

test("the reconciliation finds what is missing, extra or different — and checks a split claim's parts add up", () => {
  const rows = [claimRow(), claimRow({ claim: { ...claimRow().claim, tx: "sigX" } })];
  const result = reconcilePoolShares(rows, [
    { network: "solana", tx: "sigA", index: "1.0", claimedRaw: "47824" },
    { network: "solana", tx: "sigB", index: "0", claimedRaw: "5" },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.matched, 1);
  assert.deepEqual(result.missing.map((claim) => claim.tx), ["sigB"]);
  assert.deepEqual(result.extra.map((claim) => claim.tx), ["sigX"]);
  assert.equal(reconcilePoolShares([splitRow([[POOL_A, "100"], [POOL_B, "150"]])], [{ network: "arc", tx: "0xc40", index: "3", claimedRaw: "250" }]).ok, true);
  const short = reconcilePoolShares([splitRow([[POOL_A, "100"], [POOL_B, "150"]], { claimedRaw: "251" })], [{ network: "arc", tx: "0xc40", index: "3", claimedRaw: "251" }]);
  assert.equal(short.ok, false);
  assert.deepEqual(short.mismatched[0], { network: "arc", tx: "0xc40", index: "3", journal: "250", chain: "251" });
});

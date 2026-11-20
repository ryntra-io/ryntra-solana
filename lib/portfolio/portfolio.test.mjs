/**
 * The portfolio engine with no network.
 *
 * Meteora DLMM and DAMM v2 run the engine's own venue code on mainnet state recorded on tape
 * (`lib/liquidity/studio/fixtures/*.tape.json.gz`, public pools and the public wallets that hold positions in them).
 * The other sources read answers in the shapes their providers document (`./fixtures/`, see its README): the owner and
 * the mints are real public addresses, the accounts of stake, lending and the projection are made from seeds.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { parseJsonWithBigInts } from "@solana/rpc-spec-types";

import { PortfolioResponseSchema } from "../api/v1/contract.ts";
import { createDammV2Venue } from "../liquidity/studio/damm-v2.ts";
import { createDlmmVenue } from "../liquidity/studio/dlmm.ts";
import { replayConnection } from "../liquidity/studio/rpc-cassette.ts";
import { DAMM_V2_SCENARIO, DLMM_SCENARIO, dlmmSdkFromCommonJs, fixedKeypair } from "../liquidity/studio/fixtures/scenarios.mjs";
import { KAMINO_LEND_PROGRAM, KAMINO_MAIN_MARKET, fromScaled, jupiterLendPosition, kaminoPositions, kaminoReservesFrom } from "./lend.ts";
import { DLMM_PRO_PROGRAM_ID, dlmmProPosition, liquidityPosition } from "./meteora.ts";
import { NATIVE_SOL_MINT, STAKE_PROGRAM, SYSTEM_PROGRAM, USDC_MINT, worthOfTokens } from "./model.ts";
import { projectionPositions } from "./projection.ts";
import { ANSWER_TTL_MS, GRACE_MS, REFRESH_FLOOR_MS, forgetPortfolio, minuteBudget, projectionLeft, readPortfolio, resetPortfolioMemory, valued } from "./service.ts";
import { stakeAccountsFrom, stakeExit, stakePositions } from "./stake.ts";
import { LST_MINTS, walletFromAccounts, walletFromDas, walletPositions, withWrapped } from "./wallet.ts";

const require = createRequire(import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const tape = (name) => JSON.parse(gunzipSync(readFileSync(new URL(`../liquidity/studio/fixtures/${name}.tape.json.gz`, import.meta.url))).toString("utf8"));

const OWNER = DLMM_SCENARIO.lp;
const AT = "2026-11-16T12:00:00.000Z";
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

/* ------------------------------------------------------------------ the wallet */

test("DAS: every coin with its exact raw balance, native SOL first, an LST drawn as staking, NFTs left out", () => {
  const body = parseJsonWithBigInts(readFileSync(new URL("./fixtures/das-assets-by-owner.json", import.meta.url), "utf8"));
  const read = walletFromDas(body.result);
  assert.equal(read.lamports, "3250000000");
  assert.equal(read.solUsd, 142.5);
  assert.deepEqual(read.coins.map((c) => c.mint).sort(), [BONK, USDC_MINT, JITOSOL].sort(), "the position NFT and the picture are not coins");
  /* Past 2^53: the big-integer parse keeps the last digits. */
  assert.equal(read.coins.find((c) => c.mint === BONK).amountRaw, "9876543210987654321");

  const rows = walletPositions(read, AT);
  assert.equal(rows[0].id, "wallet:sol");
  assert.equal(rows[0].refs.program, SYSTEM_PROGRAM);
  assert.equal(rows[0].tokens[0].mint, NATIVE_SOL_MINT);
  assert.equal(rows[0].value.usd, 3.25 * 142.5);
  const usdc = rows.find((r) => r.id === `wallet:${USDC_MINT}`);
  assert.equal(usdc.kind, "coin");
  assert.equal(usdc.refs.account, "33w1PyANFmgmc4VmK1CpGg6AGLPZKFtiMUG2o6bQxECG");
  assert.ok(Math.abs(usdc.value.usd - 125.5 * 1.0001) < 1e-9);
  const jito = rows.find((r) => r.id === `wallet:${JITOSOL}`);
  assert.equal(jito.kind, "lst");
  assert.equal(jito.value.usd, null, "DAS gave no price: the catalogue prices it later");
  for (const row of rows) assert.deepEqual(row.exit, { oneStep: true, how: "swap", reason: null, partBps: 10_000, untilEpoch: null, untilTime: null });
});

test("the engine's own reading: accounts of one mint are one coin; frozen, empty and NFT accounts are not coins", () => {
  const accounts = fixture("token-accounts.json");
  const read = walletFromAccounts(accounts, 3_250_000_000n);
  assert.equal(read.lamports, "3250000000");
  assert.deepEqual(read.coins.map((c) => [c.mint, c.amountRaw]), [[USDC_MINT, "126000000"]]);
  assert.equal(read.coins[0].account, "33w1PyANFmgmc4VmK1CpGg6AGLPZKFtiMUG2o6bQxECG", "the first account is named");
  assert.equal(walletPositions({ coins: [], lamports: "0", solUsd: null }, AT).length, 0, "an empty wallet draws nothing");
});

/** A wrapped SOL account as `getTokenAccountsByOwner` (by the native mint, `jsonParsed`) states it — the QA's whale's (19.11). */
const wrappedAccount = (pubkey, amount, state = "initialized") => ({
  pubkey,
  account: {
    lamports: 86_260_510_409_753,
    owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    data: {
      program: "spl-token",
      parsed: { type: "account", info: { isNative: true, mint: NATIVE_SOL_MINT, owner: "MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa", rentExemptReserve: { amount: "1488440", decimals: 9 }, state, tokenAmount: { amount, decimals: 9 } } },
    },
  },
});

test("wrapped SOL: the chain's own read of the native mint puts in what DAS did not carry — counted at SOL's price", () => {
  const body = parseJsonWithBigInts(readFileSync(new URL("./fixtures/das-assets-by-owner.json", import.meta.url), "utf8"));
  const das = walletFromDas(body.result);
  assert.ok(!das.coins.some((c) => c.mint === NATIVE_SOL_MINT), "the DAS reading carries no wrapped SOL, as on production for the QA's whale");
  const read = withWrapped(das, [wrappedAccount("CTyFguG69kwYrzk24P3UuBvY1rR5atu9kf2S6XEwAU8X", "86260508921310"), wrappedAccount("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "1000000000")]);
  const wrapped = read.coins.filter((c) => c.mint === NATIVE_SOL_MINT);
  assert.equal(wrapped.length, 1, "every wrapped account of the wallet is one coin");
  assert.equal(wrapped[0].amountRaw, "86261508921310");
  assert.equal(wrapped[0].account, "CTyFguG69kwYrzk24P3UuBvY1rR5atu9kf2S6XEwAU8X");
  assert.deepEqual(read.coins.filter((c) => c.mint !== NATIVE_SOL_MINT), das.coins, "every other coin stays as DAS read it");
  assert.equal(read.lamports, das.lamports);

  const rows = walletPositions(read, AT);
  assert.equal(rows[0].id, "wallet:sol", "native SOL stays its own row");
  const row = rows.find((r) => r.id === `wallet:${NATIVE_SOL_MINT}`);
  assert.equal(row.label, "wSOL");
  assert.equal(row.kind, "coin");
  const priced = valued(row, PRICES, 142.5);
  assert.ok(Math.abs(priced.value.usd - 86_261.50892131 * 142.5) < 0.01, "at SOL's own price");
  assert.equal(wrapped[0].priceUsd, 142.5, "DAS's own price of SOL stands with it");
  const blind = valued(row, new Map(), 142.5);
  assert.ok(Math.abs(blind.value.usd - 86_261.50892131 * 142.5) < 0.01, "a price read that missed never leaves it unpriced");

  /* What DAS said of it gives way to the chain: never counted twice. */
  const twice = withWrapped({ ...das, coins: [...das.coins, { mint: NATIVE_SOL_MINT, symbol: "SOL", decimals: 9, amountRaw: "5", program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", account: null, priceUsd: 142.5 }] }, [wrappedAccount("CTyFguG69kwYrzk24P3UuBvY1rR5atu9kf2S6XEwAU8X", "7")]);
  assert.deepEqual(twice.coins.filter((c) => c.mint === NATIVE_SOL_MINT).map((c) => [c.amountRaw, c.priceUsd]), [["7", 142.5]]);
  /* None on chain, a frozen one, an empty one: no wrapped row. */
  assert.ok(!withWrapped(das, []).coins.some((c) => c.mint === NATIVE_SOL_MINT));
  assert.ok(!withWrapped(das, [wrappedAccount("CTyFguG69kwYrzk24P3UuBvY1rR5atu9kf2S6XEwAU8X", "0"), wrappedAccount("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "9", "frozen")]).coins.some((c) => c.mint === NATIVE_SOL_MINT));
});

test("the LSTs named are the stake pools' own mints, every one a valid address", () => {
  for (const [mint, symbol] of Object.entries(LST_MINTS)) {
    assert.match(mint, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.match(symbol, /SOL$|^INF$/);
  }
  assert.ok(Object.hasOwn(LST_MINTS, JITOSOL) && Object.hasOwn(LST_MINTS, "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So"));
});

/* ------------------------------------------------------------------ native stake */

test("stake: one account once; the stake program's rule decides whether one step takes it out", () => {
  const { byStaker, byWithdrawer, epoch, nowUnix } = fixture("stake-accounts.json");
  const accounts = stakeAccountsFrom(byStaker, byWithdrawer);
  assert.equal(accounts.length, 5, "the account in both lists is one");
  const rows = stakePositions(accounts, OWNER, BigInt(epoch), BigInt(nowUnix), AT);
  const exitOf = (address) => rows.find((r) => r.refs.position === address).exit;

  assert.deepEqual(exitOf("GfAWLSGnaeYJQFT37fgFXkopQKHix4AkHX1zYPqsz7M7"), { oneStep: false, how: "stake-deactivate", reason: "STAKE_ACTIVE", partBps: 0, untilEpoch: 881, untilTime: null });
  assert.equal(exitOf("CoHZUdyhdQs2Y5Qgy5EKK26W9LpveG77fEC6tsFnrc6U").reason, "NOT_WITHDRAWER", "a staker may deactivate, never withdraw");
  assert.equal(exitOf("CoHZUdyhdQs2Y5Qgy5EKK26W9LpveG77fEC6tsFnrc6U").how, "stake-deactivate");
  assert.deepEqual(exitOf("2nKFuqzH3SVQbCJyzKGHZ3WNa9LgAKE6Aj5wbGpjYoJL"), { oneStep: false, how: "stake-withdraw", reason: "STAKE_COOLING", partBps: 0, untilEpoch: 881, untilTime: null });
  assert.deepEqual(exitOf("4V3qfL4uo34XnQhCk6hCHqMLqzPWPjL958Tr5MEXCV4y"), { oneStep: true, how: "stake-withdraw", reason: null, partBps: 10_000, untilEpoch: null, untilTime: null });
  const lockup = exitOf("C5KjVqWXkUuRhXJQP5vHUYPNWaQzpnBX8y7gwqk2QmMo");
  assert.equal(lockup.reason, "STAKE_LOCKUP");
  assert.equal(lockup.untilTime, new Date(1_830_000_000 * 1000).toISOString());

  const active = rows.find((r) => r.refs.position === "GfAWLSGnaeYJQFT37fgFXkopQKHix4AkHX1zYPqsz7M7");
  assert.equal(active.refs.program, STAKE_PROGRAM);
  assert.equal(active.refs.market, "CzHk5foWUjbFQv8CuJSZgfiFiCgXz8BZcGVPhxNVzvV8", "the validator it is delegated to");
  assert.equal(active.tokens[0].amountRaw, "25002282880", "worth what a withdraw gives: the rent reserve with it");

  /* The epoch not read: a stake past its deactivation is still counted as cooling — never freed on a guess. */
  const free = accounts.find((a) => a.address === "4V3qfL4uo34XnQhCk6hCHqMLqzPWPjL958Tr5MEXCV4y");
  assert.equal(stakeExit(free, OWNER, null, BigInt(nowUnix)).reason, "STAKE_COOLING");
});

/* ------------------------------------------------------------------ Meteora, on recorded chain state */

const DLMM_TAPE = tape("dlmm");
const DAMM_TAPE = tape("damm-v2");
const DLMM_SDK = dlmmSdkFromCommonJs(require("@meteora-ag/dlmm"));
const dlmmVenue = () => createDlmmVenue({ connection: replayConnection(DLMM_TAPE), sdk: DLMM_SDK, now: () => DLMM_TAPE.scenario.now, newKeypair: () => fixedKeypair(DLMM_SCENARIO.seed) });
const dammVenue = () => createDammV2Venue({ connection: replayConnection(DAMM_TAPE), now: () => DAMM_TAPE.scenario.now, newKeypair: () => fixedKeypair(DAMM_V2_SCENARIO.seed) });

test("DLMM on mainnet state: every position of a stranger's wallet, its pool, range, fees and a whole exit", async () => {
  const positions = (await dlmmVenue().positions(DLMM_SCENARIO.lp)).map((p) => liquidityPosition(p));
  assert.equal(positions.length, 12);
  for (const row of positions) {
    assert.equal(row.protocol, "meteora-dlmm");
    assert.equal(row.kind, "pool");
    assert.equal(row.refs.pool, DLMM_SCENARIO.pool);
    assert.equal(row.refs.program, "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
    assert.equal(row.refs.nftMint, null);
    assert.deepEqual(row.exit.how, "pool-withdraw");
    assert.equal(row.exit.oneStep, true, "DLMM positions have no lock");
    assert.deepEqual(row.tokens.filter((t) => t.role === "held").map((t) => t.mint), [NATIVE_SOL_MINT, USDC_MINT]);
  }
  const inRange = positions.find((p) => p.refs.position === DLMM_SCENARIO.inRange);
  assert.equal(inRange.inRange, true);
  assert.ok(inRange.tokens.some((t) => t.role === "fee"), "fees waiting are coins of the position");
  assert.equal(positions.find((p) => p.refs.position === DLMM_SCENARIO.oneSided).inRange, false);
  assert.equal(positions.find((p) => p.refs.position === DLMM_SCENARIO.noFees).tokens.filter((t) => t.role === "fee").length, 0);
});

test("DAMM v2 on mainnet state: the NFT that holds it, and a lock that leaves only the free part", async () => {
  const venue = dammVenue();
  const [free] = (await venue.positions(DAMM_V2_SCENARIO.lp, { pool: DAMM_V2_SCENARIO.pool })).map((p) => liquidityPosition(p));
  assert.equal(free.protocol, "meteora-damm-v2");
  assert.equal(free.refs.position, DAMM_V2_SCENARIO.unlocked);
  assert.ok(free.refs.nftMint, "a DAMM v2 position is held by its NFT");
  assert.equal(free.exit.oneStep, true);

  const vesting = (await venue.positions(DAMM_V2_SCENARIO.vester)).map((p) => liquidityPosition(p)).find((p) => p.refs.position === DAMM_V2_SCENARIO.vesting);
  assert.equal(vesting.exit.reason, "LOCKED");
  assert.ok(vesting.exit.partBps > 0 && vesting.exit.partBps < 10_000, `only the free part leaves: ${vesting.exit.partBps}`);

  const locked = (await venue.positions(DAMM_V2_SCENARIO.executor)).map((p) => liquidityPosition(p)).find((p) => p.refs.position === DAMM_V2_SCENARIO.locked);
  assert.deepEqual([locked.exit.reason, locked.exit.partBps], ["LOCKED", 0], "locked for good: nothing leaves");
});

test("DLMM Pro: the pool's own worth in SOL with its fees; the pier names the coins; an empty position is no row", () => {
  const pier = { address: "7BWj5zG1BVG78dcuLCw6tEKia3FY3VKZq7EN9cY3tJQD", x: { mint: NATIVE_SOL_MINT, symbol: "SOL", decimals: 9 }, y: { mint: USDC_MINT, symbol: "USDC", decimals: 6 }, solIsX: true, price: 142.5, feeBps: 5, tickSpacing: 1, tickId: 0, depthLamports: null, rewards: [], takesDeposits: true };
  const position = {
    nftMint: "FWhtSf4vXhRXDDhdk2QwtYeGLXqu5jMCrXNU11iMZ42d",
    pool: pier.address,
    inRange: true,
    ranges: 3,
    lowerPrice: 130,
    upperPrice: 155,
    worth: { xRaw: "1000000000", yRaw: "142500000", lamports: "2000000000" },
    fees: { xRaw: "1000000", yRaw: "142500", lamports: "2000000" },
    rewards: [{ index: 0, mint: BONK, symbol: "Bonk", accruedRaw: "500000", running: true }],
    empty: false,
    cared: false,
    care: null,
  };
  const row = dlmmProPosition(position, pier, AT);
  assert.equal(row.value.sol, 2.002);
  assert.equal(row.earned.sol, 0.002);
  assert.equal(row.label, "SOL–USDC");
  assert.equal(row.refs.program, DLMM_PRO_PROGRAM_ID);
  assert.equal(row.refs.nftMint, position.nftMint);
  assert.deepEqual(row.tokens.map((t) => t.role), ["held", "held", "fee", "fee", "reward"]);
  assert.equal(dlmmProPosition({ ...position, empty: true }, pier, AT), null);
  /* Without the pier, the worth in SOL stands and is not counted again from a coin. */
  const bare = dlmmProPosition(position, null, AT);
  assert.equal(bare.value.sol, 2.002);
  assert.equal(worthOfTokens(bare.tokens.map((t) => ({ ...t, usd: 1 }))), null, "the worth is the pool's SOL figure, never a sum of the coins again");
});

/* ------------------------------------------------------------------ lending */

const earnPosition = (over = {}) => ({
  provider: "jupiter",
  marketId: USDC_MINT,
  asset: { mint: USDC_MINT, symbol: "USDC", decimals: 6 },
  sharesRaw: "1000000000",
  underlyingRaw: "1052000000",
  depositedRaw: "1000000000",
  earnedRaw: "52000000",
  availableRaw: "1052000000",
  readAt: AT,
  readFrom: "wallet",
  ...over,
});

test("Jupiter Lend: a deposit worth its shares at the market's rate, its interest shown, one withdraw unless liquidity is short", () => {
  const row = jupiterLendPosition(earnPosition(), "FWhtSf4vXhRXDDhdk2QwtYeGLXqu5jMCrXNU11iMZ42d", 1);
  assert.equal(row.kind, "deposit");
  assert.equal(row.value.usd, 1052);
  assert.equal(row.earned.usd, 52);
  assert.equal(row.exit.oneStep, true);
  assert.equal(row.exit.how, "lend-withdraw");
  assert.equal(row.refs.market, USDC_MINT);
  assert.equal(worthOfTokens(row.tokens.map((t) => ({ ...t, usd: t.usd ?? 99 }))), 1052, "the share token adds nothing to the worth");

  const short = jupiterLendPosition(earnPosition({ availableRaw: "526000000" }), null, 1);
  assert.deepEqual([short.exit.oneStep, short.exit.reason, short.exit.partBps], [false, "LIQUIDITY", 5_000]);
  assert.equal(jupiterLendPosition(earnPosition({ sharesRaw: "0" }), null, 1), null, "the chain says nothing is there");
  assert.equal(jupiterLendPosition(earnPosition({ sharesRaw: null }), null, 1), null, "shares not read: no position is made up");
});

test("Kamino: a deposit and, beside it, the borrow that holds it; dollars from the obligation; reserves named by the metrics", () => {
  const reserves = kaminoReservesFrom(fixture("kamino-reserves-metrics.json"));
  assert.equal(reserves.size, 2);
  const rows = kaminoPositions(fixture("kamino-obligations.json"), KAMINO_MAIN_MARKET, reserves, AT);
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.value.usd, r.exit.reason]), [
    ["kamino:DTC2FQPScaJ5Lv1sv5S2fLhQ8Wwc3grow464redr4QYQ:deposit", "deposit", 1500, "DEBT"],
    ["kamino:DTC2FQPScaJ5Lv1sv5S2fLhQ8Wwc3grow464redr4QYQ:borrow", "borrow", -400.04, "REPAY"],
    ["kamino:DjUvYurpWTuWbmk3okbistDxoPH4mxPsHk6Yi1yx4KV4:deposit", "deposit", 50.5, "NO_ROUTE"],
  ]);
  const [deposit, borrow] = rows;
  assert.deepEqual(deposit.tokens.map((t) => [t.mint, t.role, t.usd]), [[NATIVE_SOL_MINT, "supplied", 1425]], "a reserve the metrics did not name stays in the worth, out of the coins");
  assert.deepEqual(borrow.tokens.map((t) => [t.symbol, t.role]), [["USDC", "borrowed"]]);
  assert.equal(deposit.refs.program, KAMINO_LEND_PROGRAM);
  assert.equal(deposit.refs.position, "DTC2FQPScaJ5Lv1sv5S2fLhQ8Wwc3grow464redr4QYQ");
  assert.equal(fromScaled((2n ** 60n * 3n + 2n ** 59n).toString()), 3.5);
  assert.equal(fromScaled("-1"), null);
  assert.deepEqual(kaminoPositions({ unexpected: true }, KAMINO_MAIN_MARKET, reserves, AT), [], "an answer of another shape is nothing, never a guess");
});

/* ------------------------------------------------------------------ the projection */

test("Jupiter Portfolio: rows of a projection, never an exit; what the engine reads itself gives way", () => {
  const rows = projectionPositions(fixture("jupiter-portfolio-positions.json"), AT);
  for (const row of rows) {
    assert.equal(row.origin, "projection");
    assert.deepEqual([row.exit.oneStep, row.exit.reason], [false, "PROJECTION"]);
  }
  assert.ok(!rows.some((r) => r.platform === null), "an element without a platform is dropped");
  const drift = rows.filter((r) => r.platform === "drift");
  assert.deepEqual(drift.map((r) => [r.kind, r.value.usd]), [["deposit", 250], ["borrow", -40]]);

  const own = [
    { refs: { position: "DTC2FQPScaJ5Lv1sv5S2fLhQ8Wwc3grow464redr4QYQ", pool: null, nftMint: null, account: null } },
    { refs: { position: DLMM_SCENARIO.inRange, pool: DLMM_SCENARIO.pool, nftMint: null, account: null } },
  ];
  const left = projectionLeft(rows, own, new Set(["wallet", "meteora-dlmm", "meteora-damm-v2"]));
  assert.deepEqual(left.map((r) => r.platform).sort(), ["drift", "drift", "marinade"], "the wallet, Meteora and the obligation the engine shows are not counted twice");
  /* The wallet not read: its projection stays rather than leave a hole. */
  assert.ok(projectionLeft(rows, [], new Set()).some((r) => r.platform === "wallet-tokens"));
});

/* ------------------------------------------------------------------ the whole answer */

const PRICES = new Map([
  [NATIVE_SOL_MINT, { usd: 142.5, symbol: "SOL" }],
  [USDC_MINT, { usd: 1, symbol: "USDC" }],
  [JITOSOL, { usd: 172, symbol: "JitoSOL" }],
  [BONK, { usd: 0.00002, symbol: "Bonk" }],
]);

function harness(over = {}) {
  const calls = {};
  const counted = (name, reader) => async (owner, signal) => {
    calls[name] = (calls[name] ?? 0) + 1;
    return reader(owner, signal);
  };
  const dasBody = parseJsonWithBigInts(readFileSync(new URL("./fixtures/das-assets-by-owner.json", import.meta.url), "utf8"));
  const stake = fixture("stake-accounts.json");
  const readers = {
    wallet: counted("wallet", async () => {
      const read = walletFromDas(dasBody.result);
      return { ok: true, positions: walletPositions(read, AT), readAt: AT, solUsd: read.solUsd };
    }),
    "native-stake": counted("native-stake", async () => ({ ok: true, positions: stakePositions(stakeAccountsFrom(stake.byStaker, stake.byWithdrawer), OWNER, BigInt(stake.epoch), BigInt(stake.nowUnix), AT), readAt: AT })),
    "meteora-dlmm": counted("meteora-dlmm", async (owner) => ({ ok: true, positions: (await dlmmVenue().positions(owner)).map((p) => liquidityPosition(p)), readAt: AT })),
    "meteora-damm-v2": counted("meteora-damm-v2", async () => ({ ok: false, reason: "REFUSED" })),
    "jupiter-lend": counted("jupiter-lend", async () => ({ ok: false, reason: "NO_KEY" })),
    kamino: counted("kamino", async () => ({ ok: true, positions: kaminoPositions(fixture("kamino-obligations.json"), KAMINO_MAIN_MARKET, kaminoReservesFrom(fixture("kamino-reserves-metrics.json")), AT), readAt: AT })),
    "jupiter-portfolio": counted("jupiter-portfolio", async () => ({ ok: true, positions: projectionPositions(fixture("jupiter-portfolio-positions.json"), AT), readAt: AT })),
    ...over,
  };
  let clock = Date.parse(AT);
  return { calls, deps: { readers, prices: async () => PRICES, now: () => clock, sourceMs: 2_000 }, tick: (ms) => (clock += ms) };
}

test("the whole answer: every source at once, priced once, summed once — and it is the contract's shape", async () => {
  resetPortfolioMemory();
  const { deps } = harness();
  const answer = await readPortfolio(OWNER, deps);
  PortfolioResponseSchema.parse({ network: "solana:mainnet", ...answer });
  assert.equal(answer.solUsd, 142.5);

  const state = Object.fromEntries(answer.sources.map((s) => [s.source, [s.state, s.reason]]));
  assert.deepEqual(state["meteora-damm-v2"], ["unread", "REFUSED"]);
  assert.deepEqual(state["jupiter-lend"], ["off", "NO_KEY"], "a key the deployment does not have is its choice, not a failure");
  assert.deepEqual(state["meteora-dlmm-pro"], ["off", "CLOSED"], "a source the deployment does not serve");
  assert.deepEqual(state.wallet, ["read", null]);

  const unread = answer.positions.filter((p) => p.state === "unread");
  assert.deepEqual(unread.map((p) => [p.protocol, p.exit.reason]), [["meteora-damm-v2", "NOT_READ"]], "the source that fell is one row that says so");
  assert.equal(answer.positions.at(-1).state, "unread", "and it stands last");

  const jito = answer.positions.find((p) => p.id === `wallet:${JITOSOL}`);
  assert.equal(jito.value.usd, 344, "the catalogue priced what DAS did not");
  assert.equal(jito.value.sol, Math.round((344 / 142.5) * 1e9) / 1e9);
  const stake = answer.positions.find((p) => p.refs.position === "GfAWLSGnaeYJQFT37fgFXkopQKHix4AkHX1zYPqsz7M7");
  assert.equal(stake.value.usd, Math.round(25.00228288 * 142.5 * 10_000) / 10_000);

  const own = answer.positions.filter((p) => p.state !== "unread" && p.origin !== "projection");
  const sum = own.reduce((s, p) => s + p.value.usd, 0);
  assert.ok(Math.abs(answer.totals.usd - sum) < 0.01, `${answer.totals.usd} ≈ ${sum}`);
  assert.equal(answer.totals.complete, false, "a source did not answer");
  assert.ok(own.some((p) => p.kind === "borrow" && p.value.usd < 0), "a borrow takes from the total");

  /* The projection: the wallet, Meteora and the Kamino obligation the engine read are not counted twice. */
  const projected = answer.positions.filter((p) => p.origin === "projection");
  assert.deepEqual([...new Set(projected.map((p) => p.platform))].sort(), ["drift", "marinade"]);
  assert.equal(answer.totals.projectedUsd, 250 - 40 + 71.25);
});

test("the projection's silence does not make the engine's own total incomplete", async () => {
  resetPortfolioMemory();
  const ok = async () => ({ ok: true, positions: [], readAt: AT });
  const { deps } = harness({ "meteora-damm-v2": ok, "jupiter-portfolio": async () => ({ ok: false, reason: "BUDGET" }) });
  const answer = await readPortfolio(OWNER, deps);
  assert.deepEqual(answer.sources.find((s) => s.source === "jupiter-portfolio"), { source: "jupiter-portfolio", state: "unread", reason: "BUDGET", readAt: null, positions: 0 });
  assert.ok(!answer.positions.some((p) => p.state === "unread"), "no row for the projection: it only ever adds");
  assert.equal(answer.totals.projectedUsd, 0);
  assert.equal(answer.totals.complete, true, "every source of the engine answered and every row has a price");
  const long = projectionPositions({ elements: [{ platformId: "x".repeat(300), type: "multiple", value: 1, data: { assets: [] } }] }, AT);
  assert.ok(long[0].platform.length <= 64 && long[0].id.length <= 160);
});

test("a source read only in part (the wallet without its wrapped SOL) is read, says why, and the total is not whole", async () => {
  resetPortfolioMemory();
  const ok = async () => ({ ok: true, positions: [], readAt: AT });
  const dasBody = parseJsonWithBigInts(readFileSync(new URL("./fixtures/das-assets-by-owner.json", import.meta.url), "utf8"));
  const wallet = async () => {
    const read = walletFromDas(dasBody.result);
    return { ok: true, positions: walletPositions(read, AT), readAt: AT, solUsd: read.solUsd, partial: "TIMEOUT" };
  };
  const { deps } = harness({ wallet, "meteora-damm-v2": ok });
  const answer = await readPortfolio(OWNER, deps);
  PortfolioResponseSchema.parse({ network: "solana:mainnet", ...answer });
  assert.deepEqual(answer.sources.find((s) => s.source === "wallet"), { source: "wallet", state: "read", reason: "TIMEOUT", readAt: AT, positions: 3 + 1 });
  assert.ok(answer.positions.some((p) => p.id === "wallet:sol"), "the coins that did read stand");
  assert.ok(!answer.positions.some((p) => p.state === "unread"), "no row says the wallet was not read: it was");
  assert.equal(answer.totals.complete, false);
});

test("a source that falls shows its last good read, marked stale with its own time — and after the grace, one unread row", async () => {
  resetPortfolioMemory();
  const first = harness();
  await readPortfolio(OWNER, first.deps);
  const failing = harness({ kamino: async () => ({ ok: false, reason: "TIMEOUT" }) });
  failing.tick(REFRESH_FLOOR_MS + 1);
  const second = await readPortfolio(OWNER, failing.deps, { refresh: true });
  const kamino = second.positions.filter((p) => p.protocol === "kamino");
  assert.equal(kamino.length, 3);
  assert.ok(kamino.every((p) => p.state === "stale"));
  assert.deepEqual(second.sources.find((s) => s.source === "kamino"), { source: "kamino", state: "stale", reason: "TIMEOUT", readAt: AT, positions: 3 });
  assert.equal(second.totals.complete, false);

  const later = harness({ kamino: async () => ({ ok: false, reason: "TIMEOUT" }) });
  later.tick(GRACE_MS + 1);
  const third = await readPortfolio(OWNER, later.deps, { refresh: true });
  assert.deepEqual(third.positions.filter((p) => p.protocol === "kamino").map((p) => p.state), ["unread"]);
});

test("time: a source that does not answer in its budget is cut off, and the answer leaves without it", async () => {
  resetPortfolioMemory();
  const { deps } = harness({ kamino: (_owner, signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ ok: true, positions: [], readAt: AT }))) });
  const started = Date.now();
  const answer = await readPortfolio(OWNER, { ...deps, sourceMs: 60 });
  assert.ok(Date.now() - started < 1_500);
  assert.deepEqual(answer.sources.find((s) => s.source === "kamino").reason, "TIMEOUT");
});

test("a reader that throws is a source that refused; prices that do not answer leave rows without a value, never a guess", async () => {
  resetPortfolioMemory();
  const { deps } = harness({ "native-stake": async () => { throw new Error("boom"); } });
  const answer = await readPortfolio(OWNER, { ...deps, prices: () => new Promise(() => {}), priceMs: 30 });
  assert.deepEqual(answer.sources.find((s) => s.source === "native-stake").reason, "REFUSED");
  assert.equal(answer.solUsd, 142.5, "SOL's price as the wallet's own reading stated it");
  assert.equal(answer.positions.find((p) => p.id === `wallet:${JITOSOL}`).value.usd, null);
  assert.equal(answer.totals.complete, false);
});

test("memory: one wallet's read in flight is shared, a whole answer is kept, «Ще раз» waits its floor", async () => {
  resetPortfolioMemory();
  const h = harness();
  const [a, b] = await Promise.all([readPortfolio(OWNER, h.deps), readPortfolio(OWNER, h.deps)]);
  assert.equal(a, b);
  assert.equal(h.calls.wallet, 1);
  h.tick(REFRESH_FLOOR_MS - 1);
  assert.equal(await readPortfolio(OWNER, h.deps, { refresh: true }), a, "«Ще раз» right after a read is the same read");
  h.tick(2);
  const again = await readPortfolio(OWNER, h.deps, { refresh: true });
  assert.notEqual(again, a, "past the floor, «Ще раз» reads again");
  assert.equal(h.calls.wallet, 2);
  h.tick(ANSWER_TTL_MS - 1);
  assert.equal(await readPortfolio(OWNER, h.deps), again, "kept for its time");
  h.tick(2);
  const third = await readPortfolio(OWNER, h.deps);
  assert.equal(h.calls.wallet, 3, "and read again after it");
  forgetPortfolio(OWNER);
  assert.notEqual(await readPortfolio(OWNER, h.deps), third, "after an action the next read asks every source");
  assert.equal(h.calls.wallet, 4);
});

test("a paid provider's minute: past the share, refused at once; a minute later, open again", () => {
  let at = 0;
  const allow = minuteBudget(2, () => at);
  assert.deepEqual([allow(), allow(), allow()], [true, true, false]);
  at = 60_000;
  assert.equal(allow(), true);
});

test("a pool's name is its two coins: a fee's coin never stands in for a side without a symbol", () => {
  const SOL = "So11111111111111111111111111111111111111112";
  const OTHER = "Stnk111111111111111111111111111111111111111";
  const row = (tokens) => ({
    id: "meteora-damm-v2:P",
    protocol: "meteora-damm-v2",
    platform: null,
    kind: "pool",
    state: "read",
    origin: "chain",
    label: null,
    value: { usd: null, sol: null },
    earned: null,
    tokens,
    inRange: true,
    exit: { oneStep: true, how: "pool-withdraw", reason: null, partBps: 10_000, untilEpoch: null, untilTime: null },
    refs: { program: null, pool: null, position: null, nftMint: null, market: null, account: null },
    readAt: "2026-11-19T00:00:00.000Z",
  });
  const token = (mint, symbol, role) => ({ mint, symbol, decimals: 9, amountRaw: "1000000000", usd: null, role });
  const unnamed = valued(row([token(OTHER, null, "held"), token(SOL, "SOL", "held"), token(SOL, "SOL", "fee")]), new Map(), 150);
  assert.equal(unnamed.label, null, "SOL–SOL was not the pair: a side without a symbol leaves the name to the screen");
  const named = valued(row([token(OTHER, "STNK", "held"), token(SOL, "SOL", "held"), token(SOL, "SOL", "fee")]), new Map(), 150);
  assert.equal(named.label, "STNK–SOL");
});

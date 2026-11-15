// The DLMM Pro venue on mainnet's own pools, frozen — with no network.
//
// The fixture is every pool the program had on mainnet on 14.11.2026, two days after it opened: each pool account
// whole, its coins' mints, the tick arrays a swap of either direction would walk, and the chain's clock
// (`scripts/launch-qa/dlmm-pro-fixtures.mjs` in the development repository records it, read only). The rehearsal's
// fixture holds what these pools do not have yet — activation rules, a market-cap fee schedule, limit orders, a reward
// that runs; this one holds that the venue reads what is really there.
import assert from "node:assert/strict";
import test from "node:test";

import { DlmmProClient } from "@meteora-ag/dlmm-pro-sdk";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { readFixture, rpcConnection, snapshotSource } from "./fixture-kit.mjs";

const { createDlmmProVenue } = await import("./venue.server.ts");
const { decodePoolAccount } = await import("./pools.server.ts");

const fixture = readFixture(new URL("./fixtures/mainnet-pools-2026-11-14.json.gz", import.meta.url));
const connection = rpcConnection(snapshotSource(fixture.snapshot));
const venue = createDlmmProVenue({ connection, referralOwner: null });
const sdk = new DlmmProClient(connection);
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const plain = (value) => JSON.parse(JSON.stringify(value, (_, inner) => (typeof inner === "bigint" ? inner.toString() : inner)));

test("every pool of the program is found by its discriminator and read whole", async () => {
  const pools = await venue.pools.list();
  assert.equal(pools.length, 8);
  assert.deepEqual(pools.map((pool) => pool.address).sort(), fixture.pools);
  for (const pool of pools) {
    const info = await connection.getAccountInfo(new PublicKey(pool.address));
    assert.deepEqual(plain(decodePoolAccount(sdk, Buffer.from(info.data))), plain(await sdk.state.fetchPoolWithExtensions(new PublicKey(pool.address))));
    assert.deepEqual(plain(await venue.pools.read(pool.address)), plain(pool), "one pool read alone is the pool of the list");
    assert.equal(pool.at.unix, fixture.snapshot.clock.unix);
    assert.ok(pool.price > 0 && Number.isFinite(pool.price));
    assert.ok([WSOL, USDC].includes(pool.tokenY.mint), "every pool so far is quoted in wrapped SOL or USDC");
  }
});

test("the three kinds of pool, their fees and their partner read as they are", async () => {
  const pools = await venue.pools.list();
  const kinds = pools.reduce((count, pool) => ({ ...count, [pool.kind]: (count[pool.kind] ?? 0) + 1 }), {});
  assert.deepEqual(kinds, { static: 5, dynamic: 1, launch: 2 });
  /* A launch pool has no partner and gives the protocol a fifth of what liquidity earns; the others a tenth. */
  for (const pool of pools) {
    assert.equal(pool.fee.protocolShareBps, pool.kind === "launch" ? 2_000 : 1_000);
    assert.equal(pool.partner !== null, pool.kind === "dynamic", "only a pool from a partner's config has a partner");
    assert.equal(pool.fee.totalBps, Math.round((pool.fee.baseBps + pool.fee.dynamicBps) * 100) / 100);
    /* Two days in, none of them gates its opening: open to everyone, nothing paused. */
    assert.equal(pool.rules, null);
    assert.deepEqual(pool.paused, { swaps: false, deposits: false });
    for (const gate of Object.values(pool.open)) assert.deepEqual(gate, { open: true, reason: "open", opensAt: null });
    assert.deepEqual(pool.rewards, [], "liquidity mining is switched on in some, and no slot is set up yet");
  }
  const partnered = pools.find((pool) => pool.kind === "dynamic");
  assert.deepEqual(partnered.partner, { address: "Dc85YcHkAWs62ndssWcGN5V4xYaQzPzgUDiRGtvnZas6", feeBps: 200 });
  /* The one schedule among them: 99 % falling in a line to 0.75 % over 180 steps, long since settled. */
  const scheduled = pools.filter((pool) => pool.fee.mode !== "fixed");
  assert.equal(scheduled.length, 1);
  assert.deepEqual({ mode: scheduled[0].fee.mode, start: scheduled[0].fee.startBps, end: scheduled[0].fee.endBps, step: scheduled[0].fee.period, steps: scheduled[0].fee.periods, now: scheduled[0].fee.baseBps }, { mode: "timeLinear", start: 9_900, end: 75, step: 180, steps: 180, now: 75 });
  assert.ok(scheduled[0].fee.settles.atPoint < fixture.snapshot.clock.unix && scheduled[0].fee.settles.atPrice === null);
  assert.deepEqual(pools.filter((pool) => pool.extensions.liquidityMining).map((pool) => pool.kind).sort(), ["launch", "static"]);
  assert.ok(pools.every((pool) => pool.fee.collectedIn === "output"), "none collects only in Y yet");
});

test("pools of one coin are found on either side of the pair", async () => {
  const sol = await venue.pools.list({ mint: WSOL });
  assert.equal(sol.length, 7);
  assert.equal((await venue.pools.list({ mint: USDC })).length, 1);
  const pools = await venue.pools.list();
  const twice = pools.map((pool) => pool.tokenX.mint).find((mint, index, all) => all.indexOf(mint) !== index);
  assert.equal((await venue.pools.list({ mint: twice })).length, 2, "one coin, two pools: a launch pool and one from a config");
  assert.deepEqual(await venue.pools.list({ mint: "11111111111111111111111111111111" }), []);
});

test("a quote on a live pool is the SDK's quote, and the fee it charges is the fee the venue read", async () => {
  const pools = await venue.pools.list();
  let quoted = 0;
  for (const pool of pools) {
    if (pool.liquidity === "0") {
      /* A pool with nothing in range at its price: an amount it cannot take whole is refused, never built to fail. */
      const refusal = await venue.swap.quote({ pool: pool.address, inputMint: pool.tokenY.mint, amountInRaw: "1000000", slippageBps: 100, wallet: "11111111111111111111111111111112" }).then(() => null, (error) => error.code);
      assert.ok(["PARTIAL_FILL", "NO_LIQUIDITY"].includes(refusal), `${pool.address}: ${refusal}`);
      continue;
    }
    const amount = 100_000n;
    const request = { pool: pool.address, inputMint: pool.tokenY.mint, amountInRaw: amount.toString(), slippageBps: 100, wallet: "11111111111111111111111111111112" };
    const quote = await venue.swap.quote(request).catch((error) => error);
    if (quote instanceof Error) {
      assert.equal(quote.code, "PARTIAL_FILL", `${pool.address}: ${quote.message}`);
      continue;
    }
    const direct = await sdk.pool.quoteExactIn({ pool: new PublicKey(pool.address), inputAmount: new BN(amount.toString()), swapForY: false, hasReferral: false, swapper: new PublicKey(request.wallet) });
    assert.equal(quote.amountOutRaw, direct.quote.transferFeeExcludedOutAmount.toString());
    assert.equal(quote.referral, false);
    assert.equal(quote.fee.mint, pool.tokenX.mint, "these pools take their fee from the coin a swap pays out");
    assert.equal(quote.fee.partnerRaw !== "0", pool.kind === "dynamic" && BigInt(quote.fee.totalRaw) > 50n);
    /* The fee is taken from the output, each step's rounded up: the whole of it over what it was charged on is the rate the venue read. */
    const charged = BigInt(direct.quote.outAmount.toString()) + BigInt(quote.fee.totalRaw);
    const rate = Number((BigInt(quote.fee.totalRaw) * 1_000_000_000n) / charged);
    assert.ok(Math.abs(rate - Number(pool.fee.numerator)) <= Number(pool.fee.numerator) * 0.01 + 1_000_000_000 / Number(charged) + 1, `${pool.address}: charged ${rate} · read ${pool.fee.numerator}`);
    quoted += 1;
  }
  assert.ok(quoted >= 5, `${quoted} pools quoted`);
});

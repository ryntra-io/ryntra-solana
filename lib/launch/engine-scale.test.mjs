import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ENGINE_RULE } from "../core/launch/engine.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { runAutopilot } from "./autopilot.server.ts";
import { readEngineQueue } from "./engine.server.ts";

/*
 * The executor's pass at scale (SOL-L6): hundreds of markets against a chain and a store whose every call costs time on
 * the pass's clock — a curve read alone 120 ms, a hundred curves at once 150 ms, a market's fees 150 ms, a price 100 ms,
 * every store call 5 ms. The clock adds every cost one after another, as if nothing ran at once: the pass's real time
 * is shorter. Synthetic addresses only.
 */
/* The minute's budget as the scheduled route runs it (read from its source: importing it would load the real chain). */
const EXECUTOR_CRON_BUDGET_MS = Number(/EXECUTOR_CRON_BUDGET_MS = ([0-9_]+);/.exec(readFileSync(new URL("./executor-cron.server.ts", import.meta.url), "utf8"))[1].replaceAll("_", ""));
const EXECUTOR = "Exec1111111111111111111111111111111111111111";
const PAIR = "Pair1111111111111111111111111111111111111111";
const CREATOR = "Peop1111111111111111111111111111111111111111";
const at = Date.parse("2026-10-20T06:00:00.000Z");
const STORE_MS = 5;

/** A store whose every call costs `STORE_MS` on the clock. */
function slowStore(store, cost) {
  const wrap = (collection) =>
    new Proxy(collection, {
      get(target, key) {
        const value = target[key];
        return typeof value === "function"
          ? async (...args) => {
              cost(STORE_MS);
              return value.apply(target, args);
            }
          : value;
      },
    });
  return { ...store, collection: (name) => wrap(store.collection(name)), versioned: (name) => wrap(store.versioned(name)) };
}

function scale({ markets, onDex, failFees = new Set(), full = 0, firstWeek = 0, lamports = 1_000_000_000n }) {
  const clock = { now: at };
  const cost = (ms) => {
    clock.now += ms;
  };
  const calls = { curve: 0, curves: 0, migrations: 0, fees: new Map(), price: new Map(), heldBy: 0 };
  const tokens = Array.from({ length: markets }, (_, index) => `Tok${String(index).padStart(5, "0")}`);
  const graduatedFrom = markets - onDex;
  const curveOf = (token) => {
    const index = tokens.indexOf(token);
    if (index >= graduatedFrom) return { migrated: true, reserveRaw: 750_000_000n, thresholdRaw: 750_000_000n, finishedAt: 1_791_000_000, dammPool: `Damm${token}` };
    /* The first `full` markets hold their threshold, not yet graduated. */
    return { migrated: false, reserveRaw: index < full ? 750_000_000n : 10_000_000n, thresholdRaw: 750_000_000n, finishedAt: null, dammPool: null };
  };
  const chain = {
    executor: EXECUTOR,
    curve: async (record) => {
      calls.curve += 1;
      cost(120);
      return curveOf(record.token);
    },
    curves: async (records) => {
      calls.curves += 1;
      cost(150 * Math.ceil(records.length / ENGINE_RULE.readBatch));
      return new Map(records.map((record) => [record.token, curveOf(record.token)]));
    },
    buildMigration: async () => {
      calls.migrations += 1;
      cost(200);
      return { transaction: { op: "migrate" }, signers: [] };
    },
    oldestSignature: async () => null,
    transaction: async () => null,
    price: async (_pool, token) => {
      calls.price.set(token, (calls.price.get(token) ?? 0) + 1);
      cost(100);
      return { price: 0.0001, pairMint: PAIR, tokenDecimals: 6, pairDecimals: 6 };
    },
    /* Every ladder's price in bulk, a hundred a request from each node. */
    prices: async (pools) => {
      cost(150 * Math.ceil(pools.length / ENGINE_RULE.readBatch));
      for (const { token } of pools) calls.price.set(token, (calls.price.get(token) ?? 0) + 1);
      return new Map(pools.map(({ dammPool }) => [dammPool, { price: 0.0001, pairMint: PAIR, tokenDecimals: 6, pairDecimals: 6 }]));
    },
    pricesSecond: async (pools) => {
      cost(150 * Math.ceil(pools.length / ENGINE_RULE.readBatch));
      return new Map(pools.map(({ dammPool }) => [dammPool, 0.0001]));
    },
    priceSecond: async () => {
      cost(100);
      return 0.0001;
    },
    heldBy: async () => {
      calls.heldBy += 1;
      cost(50);
      return 0n;
    },
    partnerEarned: async () => 0n,
    partnerFees: async (record) => {
      calls.fees.set(record.token, (calls.fees.get(record.token) ?? 0) + 1);
      cost(150);
      if (failFees.has(record.token)) throw new Error("fetch failed");
      return { token: record.token, curve: record.pool, config: "Conf", feeClaimer: EXECUTOR, pairMint: PAIR, migrated: true, curveRaw: 0n, curveTokenRaw: 0n, migration: { raw: 0n, withdrawn: true }, surplus: { raw: 0n, withdrawn: true }, lp: null, lpUnread: false, dammPool: `Damm${record.token}` };
    },
    buildPartnerClaim: async () => {
      throw new Error("nothing to claim here");
    },
    decimals: async () => 6,
    held: async () => {
      cost(50);
      return 0n;
    },
    lamports: async () => {
      cost(50);
      return lamports;
    },
    floor: { pool: async () => null },
    holder: { pool: async () => null, readPosition: async () => null, buildCollectorClaim: async () => null },
    prepare: async () => {
      cost(30);
      return { signature: `sig-${clock.now}`, validUntil: 100 };
    },
    /* A send's answer lost: the graduation stays in flight — nothing here lands. */
    send: async (_tx, _validUntil) => {
      cost(300);
      return { outcome: "UNKNOWN", signature: `sig-${clock.now}`, reason: null };
    },
    outcome: async () => "UNKNOWN",
  };
  const memory = createMemoryGuardStore();
  const store = slowStore(memory, cost);
  const deps = { network: { cluster: "devnet" }, store, chain, floorOpen: false, /* Ryntra's own budget markets: the ladder's policies are the same on people's, whose creators are watched from launch. */ ryntraLaunched: async () => true, peopleOpen: async () => true, now: () => new Date(clock.now) };
  const seed = async () => {
    for (const [index, token] of tokens.entries()) {
      /* Launched a month ago; the first `firstWeek` two days ago — their creators watched, the long way, each pass. */
      const launchedAt = index < firstWeek ? at - 2 * 86_400_000 + index * 1_000 : at - 30 * 86_400_000 + index * 1_000;
      await memory.collection("launches").set(`solana:devnet:${token}`, {
        cluster: "devnet",
        state: "LAUNCHED",
        token,
        pool: `Curv${token}`,
        config: "Conf",
        pairMint: PAIR,
        preset: "micro",
        creator: CREATOR,
        name: token,
        symbol: "SYN",
        metadataUri: "",
        signature: `create-${token}`,
        validUntil: "0",
        firstBuyInRaw: "0",
        firstBuyOutRaw: "0",
        lock: null,
        buildId: token,
        referralCode: null,
        launchedAt: new Date(launchedAt).toISOString(),
      });
      if (index >= graduatedFrom) {
        await memory.collection("launchAutopilot").set(`solana:devnet:${token}:grad-${token}`, { cluster: "devnet", token, kind: "GRADUATED", signature: `grad-${token}`, at: new Date(at - 86_400_000).toISOString(), slot: 1, actor: "anyone", pairRaw: "1", tokensRaw: null, pool: null, position: null, lowerBinId: null, upperBinId: null, priceLow: null, priceHigh: null, lamports: null });
      }
    }
  };
  const pass = async () => {
    const started = clock.now;
    const report = await runAutopilot(deps, { budgetMs: EXECUTOR_CRON_BUDGET_MS });
    const ms = clock.now - started;
    clock.now = started + 60_000;
    return { report, ms };
  };
  return { clock, calls, tokens, store: memory, seed, pass, graduatedFrom };
}

/* The route's own limit: a pass that started an act a little before its budget sees the act through inside 60 s. */
const ROUTE_MS = 60_000;

for (const markets of [100, 500]) {
  test(`${markets} markets, a tenth in their first week: every curve read in a few requests; every budget and ladder reached within the budget's freshness; no pass past the route's minute`, async () => {
    const onDex = Math.round(markets / 5);
    const world = scale({ markets, onDex, firstWeek: Math.round(markets / 10) });
    await world.seed();
    const passes = [];
    for (let index = 0; index < 8; index += 1) passes.push(await world.pass());
    assert.equal(passes[0].report.stats.markets, markets);
    assert.equal(world.calls.curves, 8, "one bulk read a pass");
    for (const { ms } of passes) assert.ok(ms < ROUTE_MS, `a pass took ${ms} ms on a clock that adds every cost in turn`);
    /* From the second pass on (the first meets every market new), every curve is read in bulk. */
    for (const { report } of passes.slice(1)) assert.equal(report.stats.curvesSingle, 0, "no curve read alone");
    const ladders = world.tokens.slice(world.graduatedFrom);
    /* Within the budget's freshness (BUDGET_RULE.observationMaxAgeSeconds, 300 s = 5 passes) once settled: every ladder read. */
    assert.ok(ladders.every((token) => (world.calls.price.get(token) ?? 0) >= 1), "every ladder read");
    assert.ok(ladders.every((token) => (world.calls.fees.get(token) ?? 0) >= 1), "every budget looked at");
    const reads = ladders.map((token) => world.calls.price.get(token) ?? 0);
    assert.ok(Math.max(...reads) - Math.min(...reads) <= 2, "the ladders taken in turn — none far ahead of another");
    const queue = await readEngineQueue(world.store, "devnet", "floor");
    assert.equal(queue.size, onDex, "the queue keeps every ladder's turn between passes");
    /* The budget's freshness: a ladder not read for 300 s only reads in its next pass (BUDGET_RULE.observationMaxAgeSeconds). */
    /* With every price read in bulk, from the fourth pass every ladder is visited each pass. */
    for (const { report } of passes.slice(3)) assert.equal(report.stats.floor.left, 0, "every ladder visited each pass once settled");
    for (const { report } of passes.slice(2)) assert.ok(report.stats.floor.lagSeconds < 300, `the ladders' queue lags ${report.stats.floor.lagSeconds} s`);
    assert.ok(world.calls.heldBy >= Math.round(markets / 10) * 2, "the first week's creators watched pass after pass");
  });
}

test("four full curves at once and 0.08 SOL: as many start as would one after another — the floor is kept with the acts running a few at once", async () => {
  /* 0.08 SOL, the floor 0.03, a graduation 0.025: one after another they start at 0.08, 0.055 and 0.03; the fourth would start below. */
  const world = scale({ markets: 4, onDex: 0, full: 4, lamports: 80_000_000n });
  await world.seed();
  const { report } = await world.pass();
  assert.equal(world.calls.migrations, 3);
  assert.equal(report.steps.filter((step) => step.step === "LOW_SOL").length, 1);
});

test("a market whose visit fails waits a growing time before the next, the others are not held up, and it is said failing while it waits", async () => {
  const failing = "Tok00000";
  const world = scale({ markets: 10, onDex: 10, failFees: new Set([failing]) });
  await world.seed();
  const seen = [];
  for (let index = 0; index < 12; index += 1) {
    const { report } = await world.pass();
    const slot = (await readEngineQueue(world.store, "devnet", "budget")).get(failing);
    seen.push({ errors: slot.errors, failing: report.stats.failing });
  }
  const tries = world.calls.fees.get(failing);
  assert.ok(tries >= 3 && tries <= 5, `tried ${tries} times in twelve minutes, not twelve`);
  const errors = seen.map((row) => row.errors);
  assert.equal(errors[0], 1, "one failure: counted, its wait begun");
  assert.ok(Math.max(...errors) >= 3, "the run of failures is counted");
  assert.ok(seen.every((row) => row.failing === 1), "said failing every pass while it waits out its failure, not only when tried");
  const others = world.tokens.filter((token) => token !== failing);
  assert.ok(others.every((token) => (world.calls.fees.get(token) ?? 0) >= 2), "the others keep their turns");
});

test("what an act set aside is given back when it ends: eight graduations one after another in a pass, never more than a few set aside at once", async () => {
  /* 0.15 SOL read every time (the stand's balance does not move): with four acts at most in flight, 0.1 is set aside at most. */
  const world = scale({ markets: 8, onDex: 0, full: 8, lamports: 150_000_000n });
  await world.seed();
  await world.pass();
  assert.equal(world.calls.migrations, 8, "the set-asides of finished acts were given back");
});

import assert from "node:assert/strict";
import test from "node:test";

/*
 * The day of every listed DLMM Pro pool at once: each pool counted at most once per window however many ask, refreshed
 * behind the answer, a pool not reached answered «counting» (never zeros, never a failed answer), a pool the node did
 * not answer for keeping its last count.
 */

const { createDaysKeeper, DAYS_LIMITS } = await import("./days.server.ts");
const { isProDaysAnswer } = await import("./tape.ts");
const { TapeUnavailable } = await import("./tape.server.ts");

const SOL = "So11111111111111111111111111111111111111112";
const rowOf = (address) => ({
  address,
  x: { mint: `${address}mint`, symbol: "COIN", name: null, decimals: 6, icon: null, verified: null, usd: 1 },
  y: { mint: SOL, symbol: "SOL", name: "Solana", decimals: 9, icon: null, verified: true, usd: 100 },
  fee: { collectedIn: "tokenY" },
});
const ROWS = ["A", "B", "C", "D", "E"].map(rowOf);

const whole = { from: null, checked: "2026-11-20T00:00:00.000Z", transactions: 0, whole: true, stop: "window" };
const partial = { from: "2026-11-19T23:00:00.000Z", checked: "2026-11-20T00:00:00.000Z", transactions: 3, whole: false, stop: "budget" };
const viewOf = (pool, depth = whole) => ({ pool, depth, txs: [], sides: new Map() });

/** A clock the test moves, and a reader that counts what it is asked. */
function stand(behave = () => whole) {
  let now = Date.parse("2026-11-20T00:00:00.000Z");
  const asked = [];
  const readDay = async (pool) => {
    asked.push(pool.address);
    const depth = await behave(pool.address);
    return viewOf(pool, depth);
  };
  return { readDay, asked, clock: () => now, move: (ms) => (now += ms) };
}

test("each pool is counted once per window however many ask; the counts are served as kept between", async () => {
  const { readDay, asked, clock, move } = stand();
  const keeper = createDaysKeeper(readDay, DAYS_LIMITS, clock);
  const first = await keeper.read(ROWS);
  await first.refresh;
  assert.deepEqual([...asked].sort(), ["A", "B", "C", "D", "E"]);
  for (let ask = 0; ask < 40; ask += 1) {
    move(10_000);
    const { days, refresh } = await keeper.read(ROWS);
    if (clock() - Date.parse("2026-11-20T00:00:00.000Z") < DAYS_LIMITS.fresh) {
      assert.equal(refresh, null, "nothing is due inside the window");
      assert.ok(days.every((day) => day.state === "ready"));
    }
    await refresh;
  }
  assert.equal(asked.length, 10, "two windows passed: each pool counted twice");
  const { days } = await keeper.read(ROWS);
  const answer = { network: "mainnet", at: new Date(clock()).toISOString(), fresh: DAYS_LIMITS.fresh / 1000, days };
  assert.ok(isProDaysAnswer(answer));
  const day = days[0];
  assert.deepEqual([day.state, day.depth.whole, day.stats.volume.usd, day.stats.fees.lp.usd], ["ready", true, 0, 0], "a quiet day is zeros, counted whole");
});

test("a cold answer waits for its first refresh; a pool the refresh did not reach is «counting» and goes first next time", async () => {
  let slow = true;
  const { readDay, asked, clock, move } = stand((address) => (address === "C" && slow ? new Promise((done) => setTimeout(() => done(whole), 200)) : whole));
  const keeper = createDaysKeeper(readDay, { ...DAYS_LIMITS, concurrency: 1, time: 50, wait: 1_000 }, () => clock() + (asked.includes("C") ? 100 : 0));
  const { days } = await keeper.read(ROWS);
  assert.deepEqual(days.map((day) => day.state), ["ready", "ready", "counting", "counting", "counting"], "the refresh ran out of time on C; nothing failed");
  assert.equal(days[2].at, null);
  slow = false;
  move(DAYS_LIMITS.gap);
  const next = await keeper.read(ROWS);
  await next.refresh;
  assert.equal(asked.slice(3, 4)[0], "C", "the pools not counted go first");
  const done = await keeper.read(ROWS);
  assert.ok(done.days.every((day) => day.state === "ready"));
});

test("a pool the node did not answer for keeps its last count; with none it is «counting»; a partial day is counted again sooner", async () => {
  let failing = new Set(["B"]);
  const depths = { D: partial };
  const { readDay, asked, clock, move } = stand((address) => {
    if (failing.has(address)) throw new Error("the node did not answer");
    return depths[address] ?? whole;
  });
  const keeper = createDaysKeeper(readDay, DAYS_LIMITS, clock);
  const cold = await keeper.read(ROWS);
  await cold.refresh;
  const first = await keeper.read(ROWS);
  assert.equal(first.days[1].state, "counting", "never counted, so no figure");
  assert.equal(first.days[3].stats.whole, false, "a floor, said as one");

  move(DAYS_LIMITS.gap);
  const second = await keeper.read(ROWS);
  await second.refresh;
  assert.deepEqual([...new Set(asked.slice(5))].sort(), ["B", "D"], "the uncounted and the partial (read deeper too), not the rest");

  failing = new Set(["A"]);
  move(DAYS_LIMITS.fresh);
  const third = await keeper.read(ROWS);
  await third.refresh;
  const after = await keeper.read(ROWS);
  assert.equal(after.days[0].state, "ready", "A keeps its last count");
  assert.equal(after.days[0].at, new Date(Date.parse("2026-11-20T00:00:00.000Z")).toISOString(), "and says when it was counted");
  assert.equal(after.days[1].state, "ready", "B is counted now");
});

test("the line moves on with every refresh: pools that keep failing do not hold its head, and end «unknown», not counting forever", async () => {
  const broken = new Set(["A", "B"]);
  let now = Date.parse("2026-11-20T00:00:00.000Z");
  const asked = [];
  /* Each read takes 10 ms of the clock; a refresh has 25 ms — three pools at most. */
  const readDay = async (pool) => {
    asked.push(pool.address);
    now += 10;
    if (broken.has(pool.address)) throw new Error("the node did not answer");
    return viewOf(pool);
  };
  const keeper = createDaysKeeper(readDay, { ...DAYS_LIMITS, concurrency: 1, time: 25 }, () => now);
  const states = async () => {
    const { refresh } = await keeper.read(ROWS, now);
    await refresh;
    return (await keeper.read(ROWS, now)).days.map((day) => `${day.pool}:${day.state}`).join(" ");
  };
  assert.equal(await states(), "A:counting B:counting C:ready D:counting E:counting", "the first refresh reached three pools");
  now += DAYS_LIMITS.retry;
  assert.equal(await states(), "A:counting B:counting C:ready D:ready E:ready", "the next starts with those never asked, not with the two that failed");
  now += DAYS_LIMITS.retry;
  await states();
  now += DAYS_LIMITS.retry;
  assert.equal(await states(), "A:unknown B:unknown C:ready D:ready E:ready", "three failures in a row: an honest end");
  const { refresh, days } = await keeper.read(ROWS, now + DAYS_LIMITS.retry);
  assert.equal(refresh, null, "an unknown pool is not asked again every few seconds");
  const answer = { network: "mainnet", at: new Date(now).toISOString(), fresh: 300, days };
  assert.ok(isProDaysAnswer(answer));
  const tried = asked.filter((address) => address === "A").length;
  assert.equal(tried, 3);
  broken.clear();
  now += DAYS_LIMITS.fresh;
  await states();
  assert.equal(asked.filter((address) => address === "A").length, tried, "past the window the counted pools go first");
  now += DAYS_LIMITS.gap;
  await states();
  assert.equal(asked.filter((address) => address === "A").length, tried + 1, "then the unknown ones are asked again");
  assert.match(await states(), /^A:ready B:ready/, "and counted once the node answers");
});

/** A reader over pools that need `need[address]` transactions for their day, with a minute's budget of `budget` reads. */
function budgeted(need, budget) {
  const read = Object.fromEntries(Object.keys(need).map((address) => [address, 0]));
  const spent = { total: 0, deeper: [] };
  const readDay = async (pool, _now, deeper) => {
    if (deeper) spent.deeper.push(pool.address);
    const want = Math.min(deeper ? 120 : 20, need[pool.address] - read[pool.address], budget - spent.total);
    read[pool.address] += want;
    spent.total += want;
    const whole = read[pool.address] >= need[pool.address];
    return viewOf(pool, { from: null, checked: null, transactions: read[pool.address], whole, stop: whole ? "window" : "budget" });
  };
  return { readDay, read, spent };
}

test("a refresh's second pass gives what is left of the minute's budget to the days read only in part, the deepest first", async () => {
  const { readDay, read, spent } = budgeted({ A: 600, B: 150, C: 0, D: 0, E: 0 }, 300);
  const keeper = createDaysKeeper(readDay, DAYS_LIMITS, () => Date.parse("2026-11-20T00:00:00.000Z"));
  const { refresh } = await keeper.read(ROWS);
  await refresh;
  assert.deepEqual(spent.deeper, ["A", "B"], "only the partial days, deepest first");
  assert.deepEqual([read.A, read.B], [140, 140], "each got its first share, then a deeper read in the same refresh");
  assert.ok(spent.total <= 300, "never past the minute's budget");
  const { days } = await keeper.read(ROWS);
  assert.deepEqual([days[0].depth.transactions, days[0].stats.whole], [140, false], "the count says how deep it went");

  const tight = budgeted({ A: 600, B: 150, C: 0, D: 0, E: 0 }, 200);
  const second = createDaysKeeper(tight.readDay, DAYS_LIMITS, () => Date.parse("2026-11-20T00:00:00.000Z"));
  await (await second.read(ROWS)).refresh;
  assert.deepEqual([tight.read.A, tight.read.B, tight.spent.total], [140, 60, 200], "the deepest pool first, the next one what is left");
});

test("our own budget is not a pool's failure: it stays «counting», goes first, and never ends «unknown»; the node's refusals do", async () => {
  let budget = false;
  const { readDay, clock, move } = stand((address) => {
    if (address === "A" && !budget) throw new TapeUnavailable("Nothing of the pool's transactions could be read yet.", "budget");
    if (address === "B") throw new TapeUnavailable("The node did not list the pool's transactions.", "node");
    return whole;
  });
  const keeper = createDaysKeeper(readDay, DAYS_LIMITS, clock);
  for (let turn = 0; turn < 6; turn += 1) {
    await (await keeper.read(ROWS)).refresh;
    move(DAYS_LIMITS.retry);
  }
  const { days, refresh } = await keeper.read(ROWS);
  await refresh;
  assert.equal(days[0].state, "counting", "six refreshes without budget: still counting, never unknown");
  assert.equal(days[1].state, "unknown", "three refusals of the node: an honest end");
  budget = true;
  move(DAYS_LIMITS.retry);
  await (await keeper.read(ROWS)).refresh;
  assert.equal((await keeper.read(ROWS)).days[0].state, "ready", "counted as soon as there is budget");
});

test("only the deepest pools are counted, and a refresh starts at most once per gap", async () => {
  const { readDay, asked, clock, move } = stand();
  const keeper = createDaysKeeper(readDay, { ...DAYS_LIMITS, pools: 3 }, clock);
  const first = await keeper.read(ROWS);
  await first.refresh;
  assert.deepEqual(first.days.map((day) => day.pool), ["A", "B", "C"]);
  assert.equal(asked.length, 3);
  move(1_000);
  const again = await keeper.read([...ROWS.slice(0, 2), rowOf("Z")]);
  assert.equal(again.refresh, null, "a new pool waits for the gap");
  assert.equal(again.days[2].state, "counting");
  move(DAYS_LIMITS.gap);
  const later = await keeper.read([...ROWS.slice(0, 2), rowOf("Z")]);
  await later.refresh;
  assert.equal(asked.at(-1), "Z");
  assert.equal(keeper.size(), 3, "pools no longer listed are let go");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FLOOR_RULE, METEORA_MIGRATION_KEEPERS, floorLadder } from "../core/launch/autopilot.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { autopilotReceipts, floorRecord, isMigration, lastAutopilotPass, poolAccepted, runAutopilot } from "./autopilot.server.ts";
import { journalMarks, readExecutorMarket, setExecutorStop } from "./executor.server.ts";

/*
 * The executor's money paths against a chain that answers on purpose: a pool model with an active bin, one position
 * of the executor's and the executor's wallet. Synthetic addresses only.
 */
const EXECUTOR = "Exec1111111111111111111111111111111111111111";
const TOKEN = "Tokn1111111111111111111111111111111111111111";
const PAIR = "Pair1111111111111111111111111111111111111111";
const CURVE = "Curv1111111111111111111111111111111111111111";
const DAMM = "Damm1111111111111111111111111111111111111111";
const DLMM = "Dlmm1111111111111111111111111111111111111111";
const MIGRATION_LOGS = ["Program ComputeBudget111111111111111111111111111111 invoke [1]", "Program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN invoke [1]", "Program log: Instruction: MigrationDammV2"];

function world(options = {}) {
  const state = {
    now: Date.parse("2026-10-07T06:00:00.000Z"),
    curve: { migrated: true, reserveRaw: 15_454_411_163n, thresholdRaw: 15_454_411_163n, finishedAt: 1_791_000_000, dammPool: DAMM },
    price: 0.0001,
    earned: 400_000_000n,
    wallet: { [PAIR]: 1_000_000_000n, [TOKEN]: 0n },
    lamports: 1_000_000_000n,
    pool: options.pool ?? null,
    position: null,
    sends: [],
    /* What the next sends answer, in order; CONFIRMED once the list is spent. Each answer still lands or not as said. */
    answers: [],
    facts: new Map(),
    unread: new Set(),
    oldest: null,
    outcomes: new Map(),
    /* Sent and neither landed nor dropped yet: each lands when the test says so. */
    hanging: new Map(),
    serial: 0,
  };
  const binOf = (price) => Math.floor(Math.log(price) / Math.log(1.01) + 1e-9);
  const spend = (amount) => {
    if (state.wallet[PAIR] < amount) throw Object.assign(new Error("insufficient funds"), { refused: true });
    state.wallet[PAIR] -= amount;
  };
  const effects = {
    createPool: (tx) => {
      if (tx.proof) {
        spend(tx.proof.amountRaw);
        state.wallet[TOKEN] += 12_345n;
      }
      state.pool = { pool: DLMM, tokenIsX: true, binStep: 100, activeBinId: tx.activeBinId, decimalsX: 6, decimalsY: 6, creator: EXECUTOR, baseFeeBps: 100, collectsFeeInY: true, enabled: true, creatorCanSwitchOff: false, alphaVault: false, activationAt: 0 };
      return { pair: tx.proof ? -tx.proof.amountRaw : 0n, token: tx.proof ? 12_345n : 0n };
    },
    openSteps: (tx) => {
      spend(tx.amountRaw);
      state.position = { position: "Posn1111111111111111111111111111111111111111", lowerBinId: tx.ladder.lowerBinId, upperBinId: tx.ladder.upperBinId, pairRaw: tx.amountRaw, tokenRaw: 0n };
      return { pair: -tx.amountRaw, token: 0n };
    },
    syncSteps: (tx) => {
      const taken = state.position && tx.position ? state.position.pairRaw : 0n;
      if (state.position && tx.position) state.position.pairRaw = 0n;
      state.wallet[PAIR] += taken;
      state.pool.activeBinId = tx.activeBinId;
      return { pair: taken, token: 0n };
    },
    placeSteps: (tx) => {
      if (tx.ladder.upperBinId >= state.pool.activeBinId) throw Object.assign(new Error("The steps must sit below the pool's price."), { refused: true });
      spend(tx.amountRaw);
      state.position.pairRaw += tx.amountRaw;
      state.position.lowerBinId = tx.ladder.lowerBinId;
      state.position.upperBinId = tx.ladder.upperBinId;
      return { pair: -tx.amountRaw, token: 0n };
    },
    migrate: () => {
      state.curve = { ...state.curve, migrated: true };
      return { pair: 0n, token: 0n, logs: MIGRATION_LOGS };
    },
  };
  const venue = {
    pool: async () => (state.pool ? { ...state.pool } : null),
    createPool: async (args) => ({ op: "createPool", ...args }),
    openSteps: async (args) => ({ transactions: [{ op: "openSteps", ...args }], position: { publicKey: { toBase58: () => "Posn1111111111111111111111111111111111111111" } } }),
    syncSteps: async (args) => (state.pool.activeBinId === args.activeBinId ? null : { op: "syncSteps", ...args }),
    placeSteps: async (args) => ({ op: "placeSteps", ...args }),
    readSteps: async () => (state.position ? { position: state.position.position, lowerBinId: state.position.lowerBinId, upperBinId: state.position.upperBinId, pairRaw: state.position.pairRaw.toString(), tokenRaw: state.position.tokenRaw.toString(), feePairRaw: "0" } : null),
  };
  const land = (tx, signature) => {
    const moved = effects[tx.op](tx);
    state.facts.set(signature, { feePayer: EXECUTOR, at: new Date(state.now).toISOString(), slot: 1, logs: moved.logs ?? [], lamportsSpent: 5_000n, failed: false, delta: (mint) => (mint === PAIR ? moved.pair : mint === TOKEN ? moved.token : 0n) });
    state.outcomes.set(signature, "CONFIRMED");
  };
  const sendOne = (tx, signature) => {
    state.sends.push(tx.op);
    const answer = state.answers.shift() ?? "CONFIRMED";
    /* LOST: landed, its answer lost. HANGING: not landed yet, its answer lost. REFUSED: never landed. */
    if (answer === "HANGING") {
      state.hanging.set(signature, tx);
      return { outcome: "UNKNOWN", signature, reason: null };
    }
    if (answer === "LOST") {
      land(tx, signature);
      return { outcome: "UNKNOWN", signature, reason: null };
    }
    if (answer === "LOST_UNREAD") {
      land(tx, signature);
      state.unread.add(signature);
      return { outcome: "UNKNOWN", signature, reason: null };
    }
    if (answer === "REFUSED") {
      state.outcomes.set(signature, "EXPIRED");
      return { outcome: "REJECTED", signature, reason: "refused" };
    }
    /* FAILED: landed and failed on chain — it took the fee and changed nothing. */
    if (answer === "FAILED") {
      state.facts.set(signature, { feePayer: EXECUTOR, at: new Date(state.now).toISOString(), slot: 1, logs: [], lamportsSpent: 5_000n, failed: true, delta: () => 0n });
      state.outcomes.set(signature, "FAILED");
      return { outcome: "FAILED", signature, reason: "failed" };
    }
    try {
      land(tx, signature);
    } catch (error) {
      /* What the chain refuses at its preflight never lands. */
      if (!error.refused) throw error;
      state.outcomes.set(signature, "EXPIRED");
      return { outcome: "REJECTED", signature, reason: error.message };
    }
    return { outcome: "CONFIRMED", signature, reason: null };
  };
  const signatures = new Map();
  const chain = {
    executor: EXECUTOR,
    curve: async () => ({ ...state.curve }),
    buildMigration: async () => ({ transaction: { op: "migrate" }, signers: [] }),
    oldestSignature: async () => state.oldest,
    transaction: async (signature) => (state.unread.has(signature) ? null : (state.facts.get(signature) ?? null)),
    price: async () => ({ price: state.price, pairMint: PAIR, tokenDecimals: 6, pairDecimals: 6 }),
    partnerEarned: async () => state.earned,
    decimals: async () => 6,
    held: async (mint) => state.wallet[mint] ?? 0n,
    lamports: async () => state.lamports,
    floor: venue,
    prepare: async (tx) => {
      const signature = `sig-${++state.serial}`;
      signatures.set(tx, signature);
      return { signature, validUntil: 100 };
    },
    send: async (tx) => sendOne(tx, signatures.get(tx)),
    outcome: async (signature) => state.outcomes.get(signature) ?? "UNKNOWN",
  };
  const store = createMemoryGuardStore();
  const deps = { network: { cluster: "devnet" }, store, chain, floorOpen: options.floorOpen ?? true, ryntraLaunched: async (creator) => (options.ours ?? ["Crea1111111111111111111111111111111111111111"]).includes(creator), now: () => new Date(state.now) };
  const record = { cluster: "devnet", state: "LAUNCHED", token: TOKEN, pool: CURVE, config: "Conf1111111111111111111111111111111111111111", pairMint: PAIR, preset: "protected", creator: "Crea1111111111111111111111111111111111111111", name: "Test", symbol: "TST", metadataUri: "", signature: "create", validUntil: "0", firstBuyInRaw: "0", firstBuyOutRaw: "0", lock: null, buildId: "b", referralCode: null, launchedAt: "2026-10-07T05:00:00.000Z" };
  const landHanging = () => {
    for (const [signature, tx] of state.hanging) land(tx, signature);
    state.hanging.clear();
  };
  return { state, deps, store, record, binOf, landHanging, pass: () => runAutopilot(deps), tick: (seconds = 60) => (state.now += seconds * 1000) };
}

async function seed(w) {
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  /* The graduation already recorded, so these tests watch the liquidity alone. */
  await w.store.collection("launchAutopilot").set(`solana:devnet:${TOKEN}:grad`, { cluster: "devnet", token: TOKEN, kind: "GRADUATED", signature: "grad", at: null, slot: 1, actor: "other", pairRaw: "1", tokensRaw: null, pool: null, position: null, lowerBinId: null, upperBinId: null, priceLow: null, priceHigh: null, lamports: null });
}

/** Passes a minute apart until the liquidity is placed; the number of passes it took. */
async function untilPlaced(w) {
  for (let pass = 1; pass <= 20; pass += 1) {
    const report = await w.pass();
    if (report.steps.some((step) => step.step === "FLOOR_PLACED")) return pass;
    w.tick();
  }
  throw new Error("never placed");
}

test("every pass is written down with its time: a market's health says the executor acts only while passes keep coming", async () => {
  const w = world();
  assert.equal(await lastAutopilotPass(w.store, "devnet"), null, "no pass yet");
  await seed(w);
  await w.pass();
  const first = await lastAutopilotPass(w.store, "devnet");
  const { stats, ...pass } = first;
  assert.deepEqual(pass, { cluster: "devnet", executor: EXECUTOR, at: new Date(w.state.now).toISOString() });
  assert.equal(stats.markets, 1, "with what the pass did, counted");
  w.tick(90);
  await w.pass();
  assert.equal((await lastAutopilotPass(w.store, "devnet")).at, new Date(w.state.now).toISOString(), "the newest pass replaces the last");
});

test("a full curve is graduated by the executor; its receipt is written only from the transaction read back", async () => {
  const w = world();
  w.state.curve = { ...w.state.curve, migrated: false };
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  w.state.unread.add("sig-1");
  const first = await w.pass();
  assert.ok(first.steps.some((step) => step.step === "GRADUATED" && step.signature === "sig-1"));
  assert.equal((await autopilotReceipts(w.store, "devnet", TOKEN)).length, 0, "a transaction not read is never a receipt with a guessed author");
  /* Next pass: the pool's first transaction is that migration — read now, the executor's. */
  w.state.unread.clear();
  w.state.oldest = "sig-1";
  await w.pass();
  const receipts = await autopilotReceipts(w.store, "devnet", TOKEN);
  assert.deepEqual(receipts.map((row) => [row.kind, row.actor, row.signature, row.pairRaw]), [["GRADUATED", "ryntra", "sig-1", "15454411163"]]);
});

test("a graduation by someone else is recorded with who sent it, only when its transaction is the curve's migration", async () => {
  const w = world({ floorOpen: false });
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  w.state.oldest = "first";
  w.state.facts.set("first", { feePayer: METEORA_MIGRATION_KEEPERS[0], at: "2026-10-07T06:00:00.000Z", slot: 9, logs: ["Program 11111111111111111111111111111111 invoke [1]"], lamportsSpent: null, failed: false, delta: () => 0n });
  const unproven = await w.pass();
  assert.ok(unproven.steps.some((step) => step.step === "GRADUATION_UNPROVEN"), "a pool's oldest known transaction that is not the migration proves nothing");
  /* Not proven: looked for again after a wait (SOL-L6), not every minute. */
  assert.ok((await w.pass()).steps.some((step) => step.step === "GRADUATION_RECORD_LATER"));
  w.tick(60);
  /* A failed attempt, even with the migration's logs, proves nothing. */
  w.state.facts.set("first", { ...w.state.facts.get("first"), logs: MIGRATION_LOGS, failed: true });
  assert.ok((await w.pass()).steps.some((step) => step.step === "GRADUATION_UNPROVEN"));
  w.state.facts.set("first", { ...w.state.facts.get("first"), failed: false });
  w.tick(120);
  await w.pass();
  const [receipt] = await autopilotReceipts(w.store, "devnet", TOKEN);
  assert.deepEqual([receipt.kind, receipt.actor, receipt.lamports], ["GRADUATED", "meteora", null]);
  assert.ok(isMigration(MIGRATION_LOGS) && !isMigration(["Program log: Instruction: MigrationDammV2"]));
});

test("the liquidity is placed after reads spanning ten minutes: the pool with its proof, then the steps, the amount a quarter of the partner's fees", async () => {
  const w = world();
  await seed(w);
  const passes = await untilPlaced(w);
  assert.ok(passes >= 11, `placed after ${passes} passes — not before ten minutes of reads`);
  assert.deepEqual(w.state.sends, ["createPool", "openSteps"]);
  assert.equal(w.state.position.pairRaw, 100_000_000n);
  const floor = await floorRecord(w.store, "devnet", TOKEN);
  assert.deepEqual([floor.state, floor.placedRaw, floor.pending], ["PLACED", "100000000", null]);
  const receipts = await autopilotReceipts(w.store, "devnet", TOKEN);
  const pool = receipts.find((row) => row.kind === "FLOOR_POOL");
  assert.deepEqual([pool.pairRaw, pool.tokensRaw], ["10000", "12345"], "the proof's cent and what it bought");
  assert.equal(receipts.find((row) => row.kind === "FLOOR_PLACED").pairRaw, "100000000");
});

test("a move up puts back everything emptying took out; what was placed is counted once", async () => {
  const w = world();
  await seed(w);
  await untilPlaced(w);
  const before = w.state.position.upperBinId;
  /* The price stands 20 % higher: seen, then confirmed five minutes later, once the window's median has followed. */
  w.state.price *= 1.2;
  let raised = false;
  for (let pass = 0; pass < 30 && !raised; pass += 1) {
    w.tick();
    raised = (await w.pass()).steps.some((step) => step.step === "FLOOR_RAISED");
  }
  assert.ok(raised, "the steps moved up");
  assert.ok(w.state.position.upperBinId >= before + FLOOR_RULE.raiseStepBins);
  assert.equal(w.state.position.pairRaw, 100_000_000n, "the steps hold what they held before the move");
  assert.equal(w.state.wallet[PAIR], 1_000_000_000n - 10_000n - 100_000_000n, "nothing is left behind in the wallet");
  const floor = await floorRecord(w.store, "devnet", TOKEN);
  assert.deepEqual([floor.placedRaw, floor.redeposit ?? null], ["100000000", null]);
  const receipts = await autopilotReceipts(w.store, "devnet", TOKEN);
  assert.equal(receipts.find((row) => row.kind === "FLOOR_WITHDRAWN").pairRaw, "100000000");
  assert.equal(receipts.find((row) => row.kind === "FLOOR_RAISED").pairRaw, "100000000");
});

async function placedAndHigh(w) {
  await seed(w);
  await untilPlaced(w);
  w.state.price *= 1.2;
  /* Until the move starts: the pass that sends the emptying. */
  for (let pass = 0; pass < 30; pass += 1) {
    w.tick();
    const sends = w.state.sends.length;
    if (w.state.answers.length === 0) w.state.answers.push(...w.pending);
    await w.pass();
    if (w.state.sends.slice(sends).includes("syncSteps")) return;
    w.state.answers.length = 0;
  }
  throw new Error("never moved");
}

test("an emptying whose answer was lost is finished by the next pass: the money goes back into the new steps", async () => {
  const w = world();
  w.pending = ["LOST"];
  await placedAndHigh(w);
  assert.equal(w.state.position.pairRaw, 0n, "emptied, its answer lost");
  assert.ok((await floorRecord(w.store, "devnet", TOKEN)).redeposit, "the move is written down");
  w.tick();
  await w.pass();
  assert.equal(w.state.position.pairRaw, 100_000_000n);
  assert.equal((await floorRecord(w.store, "devnet", TOKEN)).placedRaw, "100000000");
});

test("a refill refused after the emptying keeps the money owed to the steps until a pass puts it back", async () => {
  const w = world();
  w.pending = ["CONFIRMED", "REFUSED"];
  await placedAndHigh(w);
  assert.equal(w.state.position.pairRaw, 0n);
  assert.equal((await floorRecord(w.store, "devnet", TOKEN)).redeposit.raw, "100000000", "what emptying took out is known and owed");
  w.tick();
  await w.pass();
  assert.equal(w.state.position.pairRaw, 100_000_000n);
  assert.equal((await floorRecord(w.store, "devnet", TOKEN)).redeposit, null);
});

test("a pool price moved by anyone between the two halves is taken back before the steps go in", async () => {
  const w = world();
  w.pending = ["CONFIRMED", "REFUSED"];
  await placedAndHigh(w);
  /* `go_to_a_bin` asks no signature: someone moved the empty pool's price far below. */
  w.state.pool.activeBinId -= 200;
  w.tick();
  await w.pass();
  assert.equal(w.state.position.pairRaw, 100_000_000n);
  assert.ok(w.state.position.upperBinId < w.state.pool.activeBinId);
});

test("a pool of the pair made by someone else is used only on the same terms", () => {
  const ours = { pool: DLMM, tokenIsX: true, binStep: 100, activeBinId: 0, decimalsX: 6, decimalsY: 6, creator: "Some1111111111111111111111111111111111111111", baseFeeBps: 100, collectsFeeInY: true, enabled: true, creatorCanSwitchOff: false, alphaVault: false, activationAt: 10 };
  assert.equal(poolAccepted(ours, EXECUTOR, 20), true);
  assert.equal(poolAccepted({ ...ours, creatorCanSwitchOff: true }, EXECUTOR, 20), false, "its creator could switch trading off");
  assert.equal(poolAccepted({ ...ours, activationAt: 30 }, EXECUTOR, 20), false, "not open yet");
  assert.equal(poolAccepted({ ...ours, baseFeeBps: 500 }, EXECUTOR, 20), false);
  assert.equal(poolAccepted({ ...ours, collectsFeeInY: false }, EXECUTOR, 20), false);
  assert.equal(poolAccepted({ ...ours, alphaVault: true }, EXECUTOR, 20), false);
  assert.equal(poolAccepted({ ...ours, tokenIsX: false, creator: EXECUTOR }, EXECUTOR, 20), false, "the token on the wrong side is never ours to use");
  assert.equal(poolAccepted({ ...ours, creator: EXECUTOR, creatorCanSwitchOff: true }, EXECUTOR, 20), true, "our own pool");
});

test("a foreign pool on other terms blocks the liquidity on that token; with the operator stop closed nothing is touched", async () => {
  const w = world({ pool: { pool: DLMM, tokenIsX: true, binStep: 100, activeBinId: 0, decimalsX: 6, decimalsY: 6, creator: "Some1111111111111111111111111111111111111111", baseFeeBps: 100, collectsFeeInY: true, enabled: true, creatorCanSwitchOff: true, alphaVault: false, activationAt: 0 } });
  await seed(w);
  for (let pass = 0; pass < 14; pass += 1) {
    await w.pass();
    w.tick();
  }
  assert.equal((await floorRecord(w.store, "devnet", TOKEN)).blocked, "POOL_TAKEN");
  assert.deepEqual(w.state.sends, []);
  const closed = world({ floorOpen: false });
  await seed(closed);
  const report = await closed.pass();
  assert.ok(report.steps.some((step) => step.step === "FLOOR_CLOSED"));
  assert.equal(await floorRecord(closed.store, "devnet", TOKEN), null);
});

test("below the SOL the liquidity needs, nothing is started; the steps' ladder stays where the rule puts it", async () => {
  const w = world();
  await seed(w);
  w.state.lamports = 100_000_000n;
  for (let pass = 0; pass < 14; pass += 1) {
    await w.pass();
    w.tick();
  }
  assert.deepEqual(w.state.sends, []);
  assert.deepEqual(floorLadder(-950), { lowerBinId: -999, upperBinId: -955 });
});

test("money owed back to the steps is never free: with Ryntra's share above what was placed and the wallet holding only the steps' money, a lost and unread emptying still ends with the steps refilled", async () => {
  const w = world();
  /* A share of 200 against 100 placed: a top-up of 100 is owed — but the wallet holds only what is placed, plus the proof's cent. */
  w.state.earned = 800_000_000n;
  w.state.wallet[PAIR] = 100_010_000n;
  w.pending = ["LOST_UNREAD"];
  await placedAndHigh(w);
  assert.equal(w.state.position.pairRaw, 0n, "emptied, its answer lost and its transaction not read yet");
  w.tick();
  assert.ok((await w.pass()).steps.some((step) => step.step === "FLOOR_SYNC_UNREAD"), "nothing is placed while what was taken out is not known");
  w.state.unread.clear();
  for (let pass = 0; pass < 3 && w.state.position.pairRaw === 0n; pass += 1) {
    w.tick();
    await w.pass();
  }
  assert.equal(w.state.position.pairRaw, 100_000_000n, "the steps hold their money again");
  assert.equal(w.state.wallet[PAIR], 0n);
  const floor = await floorRecord(w.store, "devnet", TOKEN);
  assert.deepEqual([floor.placedRaw, floor.redeposit ?? null], ["100000000", null]);
});

test("a pool whose creation answer was lost gets its receipt when the next pass finds the pool", async () => {
  const w = world();
  await seed(w);
  w.state.answers.length = 0;
  let lost = false;
  for (let pass = 0; pass < 20 && !lost; pass += 1) {
    w.tick();
    const before = w.state.sends.length;
    if (!w.state.pool) w.state.answers.push("LOST");
    await w.pass();
    lost = w.state.sends.slice(before).includes("createPool");
    if (!lost) w.state.answers.length = 0;
  }
  assert.ok(lost && w.state.pool, "the pool landed, its answer lost");
  w.tick();
  await w.pass();
  const pool = (await autopilotReceipts(w.store, "devnet", TOKEN)).find((row) => row.kind === "FLOOR_POOL");
  assert.ok(pool, "the receipt is written from the chain");
  assert.deepEqual([pool.pairRaw, pool.tokensRaw], ["10000", "12345"]);
});

test("no second pool is created while the first creation may still land: it gets its receipt when it does, and one that never landed is let go", async () => {
  const w = world();
  await seed(w);
  w.state.answers.length = 0;
  let sent = false;
  for (let pass = 0; pass < 20 && !sent; pass += 1) {
    w.tick();
    const before = w.state.sends.length;
    if (!w.state.pool) w.state.answers.push("HANGING");
    await w.pass();
    sent = w.state.sends.slice(before).includes("createPool");
    if (!sent) w.state.answers.length = 0;
  }
  assert.ok(sent && !w.state.pool, "the creation is out, not landed, its answer lost");
  w.tick();
  const before = w.state.sends.length;
  assert.ok((await w.pass()).steps.some((step) => step.step === "FLOOR_POOL_PENDING"));
  assert.ok(!w.state.sends.slice(before).includes("createPool"), "no second creation meanwhile");
  w.landHanging();
  w.tick();
  await w.pass();
  const pool = (await autopilotReceipts(w.store, "devnet", TOKEN)).find((row) => row.kind === "FLOOR_POOL");
  assert.ok(pool, "the late creation has its receipt");
  assert.deepEqual([pool.pairRaw, pool.tokensRaw], ["10000", "12345"]);

  /* A creation that expired without landing: the next pass creates the pool again. */
  const again = world();
  await seed(again);
  again.state.answers.length = 0;
  let out = null;
  for (let pass = 0; pass < 20 && !out; pass += 1) {
    again.tick();
    const count = again.state.sends.length;
    if (!again.state.pool) again.state.answers.push("HANGING");
    await again.pass();
    if (again.state.sends.slice(count).includes("createPool")) out = [...again.state.hanging.keys()][0];
    else again.state.answers.length = 0;
  }
  assert.ok(out);
  again.state.hanging.clear();
  again.state.outcomes.set(out, "EXPIRED");
  again.tick();
  const count = again.state.sends.length;
  await again.pass();
  assert.ok(again.state.sends.slice(count).includes("createPool"), "an expired creation is sent again");
  assert.ok(again.state.pool);
});

/* ------------------------------------------------------------ the collector on holders' positions */

const OWNER = "Ownr1111111111111111111111111111111111111111";
const POSITION = "Hpos1111111111111111111111111111111111111111";
const NFT = "Hnft1111111111111111111111111111111111111111";
const HOLDER_POOL = "Hpool111111111111111111111111111111111111111";

function holderWorld(read = {}) {
  const w = world({ floorOpen: false });
  const position = { closed: false, owner: OWNER, delegate: EXECUTOR, delegatedAmount: "0", bitmask: 80, unclaimedPairRaw: "2500000", ...read };
  const claimed = [];
  w.deps.chain.holder = {
    pool: async () => ({ address: HOLDER_POOL, token: TOKEN, pairMint: PAIR, tokenIsA: true, tokenDecimals: 6, pairDecimals: 6, price: 0.0001, collectFeeMode: 2, compoundingBps: 5000 }),
    readPosition: async () => ({ position: POSITION, nftMint: NFT, ...position }),
    buildCollectorClaim: async (pool, args) => {
      claimed.push(args);
      return { op: "claim", args };
    },
  };
  /* A claim pays what waits to the owner's own accounts, and nothing to anyone else. */
  w.deps.chain.prepare = async (tx) => {
    const signature = `claim-${claimed.length}`;
    tx.signature = signature;
    return { signature, validUntil: 100 };
  };
  w.deps.chain.send = async (tx) => {
    const answer = w.state.answers.shift() ?? "CONFIRMED";
    const facts = { feePayer: EXECUTOR, at: new Date(w.state.now).toISOString(), slot: 1, logs: [], lamportsSpent: 7_000n, failed: false, delta: () => 0n, deltaOf: (owner, mint) => (owner === tx.args.owner && mint === PAIR ? BigInt(position.unclaimedPairRaw) : 0n) };
    if (answer === "REFUSED") return { outcome: "REJECTED", signature: tx.signature, reason: "refused" };
    w.state.facts.set(tx.signature, facts);
    w.state.outcomes.set(tx.signature, "CONFIRMED");
    if (answer === "LOST_UNREAD") w.state.unread.add(tx.signature);
    return { outcome: answer === "LOST_UNREAD" ? "UNKNOWN" : "CONFIRMED", signature: tx.signature, reason: null };
  };
  const seedPosition = () =>
    w.store.collection("launchHolderPositions").set(`devnet:${OWNER}:${POSITION}`, { cluster: "devnet", wallet: OWNER, token: TOKEN, pool: HOLDER_POOL, position: POSITION, nftMint: NFT, state: "OPEN", enteredAt: "2026-10-07T05:30:00.000Z", entrySignature: "entry", validUntil: "0", input: "pair", enteredRaw: "5000000", enteredPairRaw: "5000000", feeRaw: "0", granted: true, pairDollar: true });
  const receipts = async () => (await w.store.collection("launchHolderClaims").valuesWithPrefix(`devnet:${POSITION}:`)).map((row) => [row.state, row.owner, row.pairRaw, row.signature]);
  return { ...w, position, claimed, seedPosition, receipts };
}

test("the collector claims a holder's waiting fees to the owner only, and once a day at most", async () => {
  const h = holderWorld();
  await h.seedPosition();
  const first = await h.pass();
  assert.ok(first.steps.some((step) => step.step === "HOLDER_CLAIMED" && step.signature === "claim-1"));
  assert.deepEqual(h.claimed.map((args) => [args.collector, args.owner, args.position]), [[EXECUTOR, OWNER, POSITION]], "the claim names the owner the NFT account belongs to");
  assert.deepEqual(await h.receipts(), [["CONFIRMED", OWNER, "2500000", "claim-1"]], "the receipt is the owner's own gain, read from the transaction");
  h.tick(60 * 60);
  assert.ok((await h.pass()).steps.some((step) => step.step === "HOLDER_WAIT"), "a second claim waits a day");
  assert.equal(h.claimed.length, 1);
  h.tick(24 * 60 * 60);
  await h.pass();
  assert.equal(h.claimed.length, 2, "a day later it claims again");
});

test("the collector does nothing on a permission that is not exactly Ryntra's, below a dollar, or on a moved position", async () => {
  for (const [read, step] of [
    [{ bitmask: 80 | (1 << 3) }, "HOLDER_WIDER"],
    [{ bitmask: 80 | (1 << 2) }, "HOLDER_WIDER"],
    [{ delegate: "Else1111111111111111111111111111111111111111" }, "HOLDER_OTHER_DELEGATE"],
    [{ bitmask: 0 }, "HOLDER_NONE"],
    [{ delegatedAmount: "1" }, "HOLDER_TRANSFERABLE"],
    [{ unclaimedPairRaw: "999999" }, "HOLDER_WAIT"],
    [{ owner: null }, "HOLDER_MOVED"],
    [{ closed: true }, "HOLDER_CLOSED"],
  ]) {
    const h = holderWorld(read);
    await h.seedPosition();
    const report = await h.pass();
    assert.ok(report.steps.some((row) => row.step === step), `${JSON.stringify(read)} → ${step}`);
    assert.equal(h.claimed.length, 0, `${JSON.stringify(read)}: nothing claimed`);
  }
});

test("a claim whose answer was lost is read by the next pass, never sent twice; a refused one leaves no receipt", async () => {
  const h = holderWorld();
  await h.seedPosition();
  h.state.answers.push("LOST_UNREAD");
  const first = await h.pass();
  assert.ok(first.steps.some((step) => step.step === "HOLDER_CLAIM_PENDING"));
  assert.deepEqual(await h.receipts(), [["PENDING", OWNER, "0", "claim-1"]], "written before the send");
  h.state.unread.clear();
  h.tick(60);
  const second = await h.pass();
  assert.ok(second.steps.some((step) => step.step === "HOLDER_CLAIMED" && step.signature === "claim-1"));
  assert.equal(h.claimed.length, 1, "no second claim while the first could land");
  assert.deepEqual(await h.receipts(), [["CONFIRMED", OWNER, "2500000", "claim-1"]]);

  const r = holderWorld();
  await r.seedPosition();
  r.state.answers.push("REFUSED");
  assert.ok((await r.pass()).steps.some((step) => step.step === "HOLDER_CLAIM_REFUSED"));
  assert.deepEqual(await r.receipts(), []);
});

test("an account the owner closed is not reopened at the collector's cost: the claim waits", async () => {
  const h = holderWorld();
  h.deps.chain.holder.buildCollectorClaim = async () => null;
  await h.seedPosition();
  assert.ok((await h.pass()).steps.some((step) => step.step === "HOLDER_NO_ACCOUNT"));
  assert.deepEqual(await h.receipts(), []);

  /* Read with the position: the claim is not even built while either account is closed. */
  for (const ownerAccounts of [{ token: false, pair: true }, { token: true, pair: false }]) {
    const c = holderWorld({ ownerAccounts });
    await c.seedPosition();
    assert.ok((await c.pass()).steps.some((step) => step.step === "HOLDER_NO_ACCOUNT"), JSON.stringify(ownerAccounts));
    assert.equal(c.claimed.length, 0);
  }
});

test("an entry whose answer was lost is settled by the collector's pass and collected without the holder coming back", async () => {
  const h = holderWorld();
  await h.seedPosition();
  const key = `devnet:${OWNER}:${POSITION}`;
  const row = await h.store.collection("launchHolderPositions").get(key);
  await h.store.collection("launchHolderPositions").set(key, { ...row, state: "PENDING" });
  h.state.outcomes.set("entry", "CONFIRMED");
  const report = await h.pass();
  assert.equal((await h.store.collection("launchHolderPositions").get(key)).state, "OPEN");
  assert.ok(report.steps.some((step) => step.step === "HOLDER_CLAIMED"), report.steps.map((step) => step.step).join(","));

  /* Never landed and no position on chain: the record goes. */
  const g = holderWorld({ closed: true });
  await g.seedPosition();
  const gone = await g.store.collection("launchHolderPositions").get(key);
  await g.store.collection("launchHolderPositions").set(key, { ...gone, state: "PENDING" });
  g.state.outcomes.set("entry", "EXPIRED");
  await g.pass();
  assert.equal(await g.store.collection("launchHolderPositions").get(key), undefined);
});

test("the collector paces its reads: under a dollar once an hour, after a refused claim six hours", async () => {
  const h = holderWorld({ unclaimedPairRaw: "500000" });
  await h.seedPosition();
  let reads = 0;
  const read = h.deps.chain.holder.readPosition;
  h.deps.chain.holder.readPosition = async (...args) => {
    reads++;
    return read(...args);
  };
  await h.pass();
  h.tick(10 * 60);
  await h.pass();
  assert.equal(reads, 1, "under a dollar: not read again within the hour");
  h.tick(60 * 60);
  await h.pass();
  assert.equal(reads, 2, "read again after the hour");

  const r = holderWorld();
  await r.seedPosition();
  r.state.answers.push("REFUSED");
  await r.pass();
  r.tick(60 * 60);
  await r.pass();
  assert.equal(r.claimed.length, 1, "no retry within six hours of a refused claim");
  r.tick(6 * 60 * 60);
  await r.pass();
  assert.equal(r.claimed.length, 2, "retried after six hours");
});

test("a position claimed within the day is not read from the chain until the day is out", async () => {
  const h = holderWorld();
  await h.seedPosition();
  await h.pass();
  assert.equal(h.claimed.length, 1);
  let reads = 0;
  const read = h.deps.chain.holder.readPosition;
  h.deps.chain.holder.readPosition = async (...args) => {
    reads++;
    return read(...args);
  };
  h.tick(23 * 60 * 60);
  assert.ok((await h.pass()).steps.some((step) => step.step === "HOLDER_WAIT"));
  assert.equal(reads, 0, "no read inside the day");
  h.tick(60 * 60);
  await h.pass();
  assert.equal(reads, 1, "read once the day is out");
  assert.equal(h.claimed.length, 2);
});

test("two passes at once never claim one position twice: the second finds it leased", async () => {
  const h = holderWorld();
  await h.seedPosition();
  const [first, second] = await Promise.all([h.pass(), h.pass()]);
  const steps = [...first.steps, ...second.steps].map((step) => step.step);
  assert.equal(h.claimed.length, 1, "one claim");
  assert.ok(steps.includes("HOLDER_CLAIMED") && steps.includes("HOLDER_LEASED"), steps.join(","));
});

/* ------------------------------------------------------------------ the executor on production: marks, switch, retries */

const marksOf = async (w, token = TOKEN) => (await journalMarks(w.store, "devnet", token)).map((mark) => [mark.kind, mark.state, mark.actor, mark.signature, mark.scope]);
const onCurve = (w, full) => {
  w.state.curve = { ...w.state.curve, migrated: false, reserveRaw: full ? w.state.curve.thresholdRaw : 1n, finishedAt: full ? Math.floor(w.state.now / 1000) : null };
};

test("the executor's first pass over a market goes into its log once; a pass that changes nothing writes nothing", async () => {
  const w = world({ floorOpen: false });
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  onCurve(w, false);
  const first = await w.pass();
  assert.ok(first.steps.some((step) => step.step === "WATCH_STARTED"));
  assert.deepEqual(await marksOf(w), [["WATCH_STARTED", null, "ryntra", null, null]]);
  w.tick();
  const second = await w.pass();
  assert.deepEqual(second.steps.map((step) => step.step), ["ON_CURVE"], "on the curve, nothing to note");
  assert.equal((await marksOf(w)).length, 1);
  assert.deepEqual(w.state.sends, [], "nothing signed on a curve below its threshold");
});

test("the operator's switch on one market: nothing is signed there, the stop and the resume are in its log", async () => {
  const w = world({ floorOpen: false });
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  onCurve(w, true);
  const stop = await setExecutorStop(w.store, { cluster: "devnet", token: TOKEN, stopped: true, by: "admin:1", now: new Date(w.state.now), tokens: [TOKEN] });
  assert.deepEqual(stop, { changed: true, marked: [TOKEN] });
  const again = await setExecutorStop(w.store, { cluster: "devnet", token: TOKEN, stopped: true, by: "admin:1", now: new Date(w.state.now), tokens: [TOKEN] });
  assert.deepEqual(again, { changed: false, marked: [] }, "a flip that changes nothing writes nothing");
  const stopped = await w.pass();
  assert.ok(stopped.steps.some((step) => step.step === "STOPPED"));
  assert.deepEqual(w.state.sends, [], "a full curve on a stopped market is not graduated by the executor");
  w.tick();
  await setExecutorStop(w.store, { cluster: "devnet", token: TOKEN, stopped: false, by: "admin:1", now: new Date(w.state.now), tokens: [TOKEN] });
  w.tick();
  const resumed = await w.pass();
  assert.ok(resumed.steps.some((step) => step.step === "GRADUATED"));
  assert.deepEqual(w.state.sends, ["migrate"]);
  const kinds = (await marksOf(w)).map(([kind, state, actor, , scope]) => [kind, state, actor, scope]);
  assert.deepEqual(kinds, [
    ["STOPPED", "PAUSED_RISK", "operator", "market"],
    ["RESUMED", null, "operator", "market"],
    ["WATCH_STARTED", null, "ryntra", null],
    ["STATE", "CORE_MARKET_LIVE", "ryntra", null],
  ]);
});

test("the switch for every market: each market's log gets the stop once; one stopped on its own stays stopped when every market resumes", async () => {
  const w = world({ floorOpen: false });
  const OTHER = "Othr1111111111111111111111111111111111111111";
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  await w.store.collection("launches").set(`solana:devnet:${OTHER}`, { ...w.record, token: OTHER, launchedAt: "2026-10-07T05:30:00.000Z" });
  const now = () => new Date(w.state.now);
  await setExecutorStop(w.store, { cluster: "devnet", token: OTHER, stopped: true, by: "admin:1", now: now(), tokens: [TOKEN, OTHER] });
  w.tick();
  const all = await setExecutorStop(w.store, { cluster: "devnet", token: null, stopped: true, by: "admin:1", now: now(), tokens: [TOKEN, OTHER] });
  assert.deepEqual(all.marked, [TOKEN], "the market already stopped gets no second stop");
  onCurve(w, true);
  await w.pass();
  assert.deepEqual(w.state.sends, [], "every market stopped: nothing signed");
  w.tick();
  const resumed = await setExecutorStop(w.store, { cluster: "devnet", token: null, stopped: false, by: "admin:1", now: now(), tokens: [TOKEN, OTHER] });
  assert.deepEqual(resumed.marked, [TOKEN], "a market stopped on its own is not resumed by every market's resume");
  assert.deepEqual((await marksOf(w, OTHER)).map(([kind, , , , scope]) => [kind, scope]), [["STOPPED", "market"]]);
  assert.deepEqual((await marksOf(w)).map(([kind, , , , scope]) => [kind, scope]), [["STOPPED", "all"], ["RESUMED", "all"]]);
});

test("a graduation refused is sent again by the executor itself, at once; one in flight is read, never sent over", async () => {
  const w = world({ floorOpen: false });
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  onCurve(w, true);
  w.state.answers.push("REFUSED");
  const first = await w.pass();
  assert.ok(first.steps.some((step) => step.step === "GRADUATION_REJECTED"));
  const market = await readExecutorMarket(w.store, "devnet", TOKEN);
  assert.deepEqual([market.failures, market.graduation, market.state], [1, null, "MIGRATION_FAILED"]);
  /* The next pass sends it again; its answer is lost — the next pass reads it rather than sending a second. */
  w.tick();
  w.state.answers.push("HANGING");
  const second = await w.pass();
  assert.ok(second.steps.some((step) => step.step === "GRADUATION_SENT"));
  w.tick();
  const third = await w.pass();
  assert.ok(third.steps.some((step) => step.step === "GRADUATION_PENDING"));
  assert.deepEqual(w.state.sends, ["migrate", "migrate"], "no third send while the second may land");
  w.landHanging();
  w.tick();
  const fourth = await w.pass();
  assert.ok(fourth.steps.some((step) => step.step === "GRADUATED_KNOWN" && step.signature === "sig-2"), "the graduation in flight landed: its receipt from its own transaction");
  const receipts = await autopilotReceipts(w.store, "devnet", TOKEN);
  assert.deepEqual(receipts.map((row) => [row.kind, row.actor, row.signature]), [["GRADUATED", "ryntra", "sig-2"]]);
  assert.deepEqual((await marksOf(w)).map(([kind, state, , signature]) => [kind, state, signature]), [
    ["WATCH_STARTED", null, null],
    ["GRADUATION_FAILED", "MIGRATION_FAILED", null],
    /* The retry in flight is not a new state after the failure: the log goes from the failure to the DEX. */
    ["STATE", "CORE_MARKET_LIVE", "sig-2"],
  ]);
  const after = await readExecutorMarket(w.store, "devnet", TOKEN);
  assert.deepEqual([after.failures, after.graduation, after.state], [0, null, "CORE_MARKET_LIVE"]);
});

test("failures in a row wait longer each time; every failure that landed on chain is in the log", async () => {
  const w = world({ floorOpen: false });
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  onCurve(w, true);
  w.state.answers.push("FAILED", "FAILED");
  await w.pass();
  w.tick(1);
  await w.pass();
  assert.deepEqual(w.state.sends, ["migrate", "migrate"], "the first failure is sent again at once");
  w.tick(60);
  const waiting = await w.pass();
  assert.ok(waiting.steps.some((step) => step.step === "GRADUATION_WAIT"), "after two failures in a row the next waits two minutes");
  assert.equal(w.state.sends.length, 2);
  w.tick(60);
  await w.pass();
  assert.deepEqual(w.state.sends, ["migrate", "migrate", "migrate"]);
  const failed = (await marksOf(w)).filter(([kind]) => kind === "GRADUATION_FAILED");
  assert.deepEqual(failed.map(([, , , signature]) => signature), ["sig-1", "sig-2"], "each failed transaction on chain, with its signature");
});

test("on a market launched by people the ladder is not placed in phase 0; graduation is still sent", async () => {
  const w = world({ ours: [] });
  await seed(w);
  for (let pass = 0; pass < 15; pass += 1) {
    const report = await w.pass();
    assert.ok(report.steps.some((step) => step.step === "FLOOR_NOT_OURS"));
    w.tick();
  }
  assert.deepEqual(w.state.sends, [], "no pool, no steps");
  assert.equal(await floorRecord(w.store, "devnet", TOKEN), null);
});

test("the market's states from the DEX on go into its log as the executor reads them, each with the transaction it rests on", async () => {
  const w = world();
  await seed(w);
  await untilPlaced(w);
  w.tick();
  await w.pass();
  const states = (await marksOf(w)).filter(([kind]) => kind === "STATE").map(([, state, , signature]) => [state, signature]);
  const placed = (await autopilotReceipts(w.store, "devnet", TOKEN)).find((row) => row.kind === "FLOOR_PLACED").signature;
  /* The market budget is accounted by the next subtask: here the core market on the DEX, then the ladder placed. */
  assert.deepEqual(states, [
    ["CORE_MARKET_LIVE", "grad"],
    ["LADDER_ACTIVE", placed],
  ]);
  /* Thirty days on the DEX: mature. */
  w.tick(31 * 86_400);
  await w.pass();
  const last = (await journalMarks(w.store, "devnet", TOKEN)).at(-1);
  assert.deepEqual([last.kind, last.state, last.from], ["STATE", "MATURE", "LADDER_ACTIVE"]);
});

/* ------------------------------------------------------------------ the critic's cases: a switch read at the moment of signing */

test("a switch that cannot be read lets nothing be signed, and the pass is not counted", async () => {
  const w = world({ floorOpen: false });
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  onCurve(w, true);
  const store = w.deps.store;
  const broken = {
    ...store,
    collection: (name) => store.collection(name),
    versioned: (name) => (name === "launchExecutorStops" ? { ...store.versioned(name), valuesWithPrefix: async () => { throw new Error("store down"); } } : store.versioned(name)),
    compareAndSetMany: (writes) => store.compareAndSetMany(writes),
  };
  const report = await runAutopilot({ ...w.deps, store: broken });
  assert.deepEqual(report.steps.map((step) => step.step), ["STOPS_UNREAD"]);
  assert.deepEqual(w.state.sends, []);
  assert.equal(await lastAutopilotPass(store, "devnet"), null, "a pass that could not read its switch is not a pass at work");
});

test("a stop flipped while the pass runs holds at the moment of signing: nothing signed, nothing written down for it", async () => {
  const w = world({ floorOpen: false });
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  onCurve(w, true);
  w.deps.chain.buildMigration = async () => {
    await setExecutorStop(w.store, { cluster: "devnet", token: TOKEN, stopped: true, by: "admin:1", now: new Date(w.state.now), tokens: [TOKEN] });
    return { transaction: { op: "migrate" }, signers: [] };
  };
  const report = await w.pass();
  assert.ok(report.steps.some((step) => step.step === "STOPPED"), report.steps.map((step) => step.step).join(","));
  assert.deepEqual(w.state.sends, []);
  const market = await readExecutorMarket(w.store, "devnet", TOKEN);
  assert.equal(market.graduation, null, "no graduation in flight for a send that never happened");
});

test("a stopped market's ladder and holders' positions get nothing signed; a creator that cannot be read is not Ryntra's", async () => {
  const w = world();
  await seed(w);
  await setExecutorStop(w.store, { cluster: "devnet", token: TOKEN, stopped: true, by: "admin:1", now: new Date(w.state.now), tokens: [TOKEN] });
  for (let pass = 0; pass < 12; pass += 1) {
    const report = await w.pass();
    assert.ok(report.steps.some((step) => step.step === "STOPPED"));
    w.tick();
  }
  assert.deepEqual(w.state.sends, [], "the ladder of a stopped market is not placed");

  const h = holderWorld();
  await h.seedPosition();
  await setExecutorStop(h.store, { cluster: "devnet", token: TOKEN, stopped: true, by: "admin:1", now: new Date(h.state.now), tokens: [TOKEN] });
  await h.pass();
  assert.equal(h.claimed.length, 0, "the collector waits on a stopped market");

  const u = world();
  u.deps.ryntraLaunched = async () => {
    throw new Error("the admin's list did not answer");
  };
  await seed(u);
  const report = await u.pass();
  assert.ok(report.steps.some((step) => step.step === "FLOOR_NOT_OURS"));
  assert.deepEqual(u.state.sends, []);
});

test("the ladder of this subtask stands on the Classic and Protected presets only", async () => {
  const w = world();
  w.record = { ...w.record, preset: "community" };
  await seed(w);
  const report = await w.pass();
  assert.ok(report.steps.some((step) => step.step === "FLOOR_NOT_THIS_PRESET"));
  assert.deepEqual(w.state.sends, []);
});

test("a curve that just filled goes first: markets still on their curve, newest first, before markets on the DEX", async () => {
  const w = world({ floorOpen: false });
  const OLD = "Oldd1111111111111111111111111111111111111111";
  await w.store.collection("launches").set(`solana:devnet:${OLD}`, { ...w.record, token: OLD, launchedAt: "2026-10-01T00:00:00.000Z" });
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, { ...w.record, launchedAt: "2026-10-07T05:00:00.000Z" });
  const { updateExecutorMarket } = await import("./executor.server.ts");
  await updateExecutorMarket(w.store, "devnet", OLD, new Date(w.state.now), (market) => ({ ...market, watchedAt: "2026-10-01T00:00:00.000Z", state: "CORE_MARKET_LIVE" }));
  /* One at a time, so the order the curves are read in is the order the pass takes them. */
  w.deps.concurrency = 1;
  const seen = [];
  const curve = w.deps.chain.curve;
  w.deps.chain.curve = async (record) => {
    seen.push(record.token);
    return curve(record);
  };
  await w.pass();
  assert.deepEqual(seen.slice(0, 2), [TOKEN, OLD]);
});

test("the minute's count of what it sent takes only this minute's sends", async () => {
  const { sentCount } = await import("./executor.server.ts");
  assert.equal(
    sentCount([
      { token: "a", step: "GRADUATED", signature: "1" },
      { token: "b", step: "GRADUATED_KNOWN", signature: "2" },
      { token: "c", step: "GRADUATION_LANDED", signature: "3" },
      { token: "d", step: "GRADUATION_FAILED_EARLIER", signature: "4" },
      { token: "e", step: "FLOOR_POOL_PENDING", signature: "5" },
      { token: "f", step: "FLOOR_PLACED", signature: "6" },
      { token: "g", step: "HOLDER_CLAIMED", signature: "7" },
      { token: "h", step: "GRADUATION_FAILED", signature: "8" },
    ]),
    4,
  );
});

test("on mainnet the executor runs only on the production deployment with a store every instance shares", async () => {
  const { executorPaused } = await import("./executor.server.ts");
  const mainnet = { cluster: "mainnet" };
  const base = { network: mainnet, laneOpen: true, writesHere: true, sharedStore: true, key: true };
  assert.equal(executorPaused(base), null);
  assert.equal(executorPaused({ ...base, writesHere: false }), "NOT_HERE", "a preview or a local server never signs mainnet");
  assert.equal(executorPaused({ ...base, sharedStore: false }), "NO_SHARED_STORE", "a store one instance holds loses what was written before a send");
  assert.equal(executorPaused({ ...base, network: { cluster: "devnet" }, sharedStore: false }), null, "the devnet stand keeps its file store");
  assert.equal(executorPaused({ ...base, laneOpen: false }), "LANE_CLOSED");
  assert.equal(executorPaused({ ...base, key: false }), "NO_EXECUTOR");
  assert.equal(executorPaused({ ...base, network: null }), "NO_NETWORK");
  const source = (await import("node:fs")).readFileSync(new URL("./autopilot-chain.server.ts", import.meta.url), "utf8");
  assert.ok(source.includes("writesHere: network ? launchWritesHere(network) : false, sharedStore: storeSupportsConcurrentInstances(store)"), "the chain asks the gate with the deployment and the store");
});

test("a graduation of ours that landed while the curve's read still lags is the DEX, never a failed move", async () => {
  const w = world({ floorOpen: false });
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  onCurve(w, true);
  w.state.curve = { ...w.state.curve, finishedAt: Math.floor(w.state.now / 1000) - 20 * 60 };
  w.state.answers.push("HANGING");
  const first = await w.pass();
  assert.ok(first.steps.some((step) => step.step === "GRADUATION_SENT"));
  w.landHanging();
  /* The node that reads the curve has not seen the migration yet. */
  w.state.curve = { ...w.state.curve, migrated: false };
  w.tick();
  const second = await w.pass();
  assert.ok(second.steps.some((step) => step.step === "GRADUATION_LANDED"), second.steps.map((step) => step.step).join(","));
  const states = (await marksOf(w)).filter(([kind]) => kind !== "WATCH_STARTED").map(([kind, state]) => [kind, state]);
  assert.deepEqual(states, [["STATE", "MIGRATING"], ["STATE", "CORE_MARKET_LIVE"]], "no failed move is written after a graduation that went through");
});

test("the executor's minute: Vercel calls it every minute with the cron secret, and the route runs one pass and nothing else", () => {
  const crons = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")).crons;
  assert.deepEqual(crons.filter((cron) => cron.path === "/api/cron/launch-autopilot"), [{ path: "/api/cron/launch-autopilot", schedule: "* * * * *" }]);
  const route = readFileSync(new URL("../../app/api/cron/launch-autopilot/route.ts", import.meta.url), "utf8");
  assert.match(route, /decideBearerAuth\(/, "only the cron secret's bearer runs it");
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /runExecutorMinute\(\)/, "one pass, by the executor's own module");
  assert.match(route, /maxDuration = 60/);
  assert.doesNotMatch(route, /RYNTRA_LAUNCH_EXECUTOR_SECRET/, "the route never reads the key itself");
});

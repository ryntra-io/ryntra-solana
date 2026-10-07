import assert from "node:assert/strict";
import test from "node:test";

import { FLOOR_RULE, METEORA_MIGRATION_KEEPERS, floorLadder } from "../core/launch/autopilot.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { autopilotReceipts, floorRecord, isMigration, poolAccepted, runAutopilot } from "./autopilot.server.ts";

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
    migrate: async () => sendOne({ op: "migrate" }, `sig-${++state.serial}`),
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
  const deps = { network: { cluster: "devnet" }, store, chain, floorOpen: options.floorOpen ?? true, now: () => new Date(state.now) };
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
  /* A failed attempt, even with the migration's logs, proves nothing. */
  w.state.facts.set("first", { ...w.state.facts.get("first"), logs: MIGRATION_LOGS, failed: true });
  assert.ok((await w.pass()).steps.some((step) => step.step === "GRADUATION_UNPROVEN"));
  w.state.facts.set("first", { ...w.state.facts.get("first"), failed: false });
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

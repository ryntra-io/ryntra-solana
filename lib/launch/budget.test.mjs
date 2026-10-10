import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { autopilotReceipts, floorRecord, runAutopilot } from "./autopilot.server.ts";
import { readBudgetRecord, readRevenue } from "./budget.server.ts";
import { journalMarks, readExecutorMarket } from "./executor.server.ts";

/*
 * A market's budget against a chain that answers on purpose: the partner's fees waiting in Meteora's programs, the
 * executor's wallet, a DLMM pool and one position. Synthetic addresses only.
 */
const EXECUTOR = "Exec1111111111111111111111111111111111111111";
const MULTISIG = "Msig1111111111111111111111111111111111111111";
const TOKEN = "Tokn1111111111111111111111111111111111111111";
const PAIR = "Pair1111111111111111111111111111111111111111";
const CURVE = "Curv1111111111111111111111111111111111111111";
const DAMM = "Damm1111111111111111111111111111111111111111";
const DLMM = "Dlmm1111111111111111111111111111111111111111";
const OURS = "Crea1111111111111111111111111111111111111111";
const PEOPLE = "Peop1111111111111111111111111111111111111111";
const USDC = (value) => BigInt(Math.round(value * 1_000_000));

function world(options = {}) {
  const state = {
    now: Date.parse("2026-10-11T06:00:00.000Z"),
    curve: { migrated: true, reserveRaw: USDC(50), thresholdRaw: USDC(50), finishedAt: 1_791_000_000, dammPool: DAMM },
    price: 0.0001,
    second: undefined,
    wallet: { [PAIR]: 0n, [TOKEN]: 0n },
    lamports: 300_000_000n,
    creatorHeld: 0n,
    partner: { feeClaimer: options.feeClaimer ?? EXECUTOR, migration: USDC(15), migrationWithdrawn: false, surplus: 0n, surplusWithdrawn: false, curve: USDC(4.35654), lp: USDC(6.898543) },
    pool: null,
    position: null,
    sends: [],
    built: [],
    answers: [],
    facts: new Map(),
    outcomes: new Map(),
    hanging: new Map(),
    alerts: [],
    serial: 0,
  };
  const claimEffect = (source) => {
    const p = state.partner;
    const amount = source === "migration" ? p.migration : source === "surplus" ? p.surplus : source === "curve" ? p.curve : p.lp;
    if (source === "migration") p.migrationWithdrawn = true;
    else if (source === "surplus") p.surplusWithdrawn = true;
    else if (source === "curve") p.curve = 0n;
    else p.lp = 0n;
    state.wallet[PAIR] += amount;
    return { pair: amount, token: 0n };
  };
  const spend = (amount) => {
    if (state.wallet[PAIR] < amount) throw Object.assign(new Error("insufficient funds"), { refused: true });
    state.wallet[PAIR] -= amount;
  };
  const effects = {
    claim: (tx) => claimEffect(tx.source),
    createPool: (tx) => {
      if (tx.proof) spend(tx.proof.amountRaw);
      state.wallet[TOKEN] += tx.proof ? 12_345n : 0n;
      state.pool = { pool: DLMM, tokenIsX: true, binStep: tx.binStep ?? 100, activeBinId: tx.activeBinId, decimalsX: 6, decimalsY: 6, creator: EXECUTOR, baseFeeBps: 100, collectsFeeInY: true, enabled: true, creatorCanSwitchOff: false, alphaVault: false, activationAt: 0 };
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
      spend(tx.amountRaw);
      state.position.pairRaw += tx.amountRaw;
      state.position.lowerBinId = tx.ladder.lowerBinId;
      state.position.upperBinId = tx.ladder.upperBinId;
      return { pair: -tx.amountRaw, token: 0n };
    },
  };
  const land = (tx, signature) => {
    const moved = effects[tx.op](tx);
    state.facts.set(signature, { feePayer: EXECUTOR, at: new Date(state.now).toISOString(), slot: 1, logs: [], lamportsSpent: 5_000n, failed: false, delta: (mint) => (mint === PAIR ? moved.pair : mint === TOKEN ? moved.token : 0n), deltaOf: () => 0n });
    state.outcomes.set(signature, "CONFIRMED");
  };
  const signatures = new Map();
  const chain = {
    executor: EXECUTOR,
    curve: async () => ({ ...state.curve }),
    buildMigration: async () => ({ transaction: { op: "migrate" }, signers: [] }),
    oldestSignature: async () => null,
    transaction: async (signature) => state.facts.get(signature) ?? null,
    price: async () => ({ price: state.price, pairMint: PAIR, tokenDecimals: 6, pairDecimals: 6 }),
    priceSecond: async () => (state.second === undefined ? state.price : state.second),
    heldBy: async () => state.creatorHeld,
    partnerEarned: async () => 0n,
    partnerFees: async () => ({
      token: TOKEN,
      curve: CURVE,
      config: "Conf",
      feeClaimer: state.partner.feeClaimer,
      pairMint: PAIR,
      migrated: state.curve.migrated,
      curveRaw: state.partner.curve,
      curveTokenRaw: 0n,
      migration: { raw: state.partner.migration, withdrawn: state.partner.migrationWithdrawn },
      surplus: { raw: state.partner.surplus, withdrawn: state.partner.surplusWithdrawn },
      lp: { pool: DAMM, position: "Lpos", positionNftAccount: "Lnft", pairRaw: state.partner.lp, tokenRaw: 0n },
      dammPool: DAMM,
    }),
    buildPartnerClaim: async (read, source) => {
      if (read.feeClaimer !== EXECUTOR) throw new Error("not the claimer");
      state.built.push(source);
      return { op: "claim", source };
    },
    decimals: async () => 6,
    held: async (mint) => state.wallet[mint] ?? 0n,
    lamports: async () => state.lamports,
    floor: {
      pool: async () => (state.pool ? { ...state.pool } : null),
      createPool: async (args) => ({ op: "createPool", ...args }),
      openSteps: async (args) => ({ transactions: [{ op: "openSteps", ...args }], position: { publicKey: { toBase58: () => "Posn1111111111111111111111111111111111111111" } } }),
      syncSteps: async (args) => (state.pool.activeBinId === args.activeBinId ? null : { op: "syncSteps", ...args }),
      placeSteps: async (args) => ({ op: "placeSteps", ...args }),
      readSteps: async () => (state.position ? { position: state.position.position, lowerBinId: state.position.lowerBinId, upperBinId: state.position.upperBinId, pairRaw: state.position.pairRaw.toString(), tokenRaw: state.position.tokenRaw.toString(), feePairRaw: "0" } : null),
    },
    holder: { pool: async () => null, readPosition: async () => null, buildCollectorClaim: async () => null },
    prepare: async (tx) => {
      const signature = `sig-${++state.serial}`;
      signatures.set(tx, signature);
      return { signature, validUntil: 100 };
    },
    send: async (tx) => {
      const signature = signatures.get(tx);
      state.sends.push(tx.op === "claim" ? `claim:${tx.source}` : tx.op);
      const answer = state.answers.shift() ?? "CONFIRMED";
      if (answer === "LOST") {
        land(tx, signature);
        return { outcome: "UNKNOWN", signature, reason: null };
      }
      if (answer === "REFUSED") {
        state.outcomes.set(signature, "EXPIRED");
        return { outcome: "REJECTED", signature, reason: "refused" };
      }
      try {
        land(tx, signature);
      } catch (error) {
        if (!error.refused) throw error;
        state.outcomes.set(signature, "EXPIRED");
        return { outcome: "REJECTED", signature, reason: error.message };
      }
      return { outcome: "CONFIRMED", signature, reason: null };
    },
    outcome: async (signature) => state.outcomes.get(signature) ?? "UNKNOWN",
  };
  const store = createMemoryGuardStore();
  const deps = {
    network: { cluster: "devnet" },
    store,
    chain,
    floorOpen: options.floorOpen ?? false,
    ryntraLaunched: async (creator) => creator === OURS,
    now: () => new Date(state.now),
    alert: async (text) => {
      state.alerts.push(text);
      return true;
    },
  };
  const record = { cluster: "devnet", state: "LAUNCHED", token: TOKEN, pool: CURVE, config: "Conf", pairMint: PAIR, preset: options.preset ?? "demo", creator: options.creator ?? OURS, name: "Demo", symbol: "DEMO", metadataUri: "", signature: "create", validUntil: "0", firstBuyInRaw: "0", firstBuyOutRaw: "0", lock: null, buildId: "b", referralCode: null, launchedAt: "2026-10-11T05:00:00.000Z" };
  return { state, deps, store, record, pass: () => runAutopilot(deps), tick: (seconds = 60) => (state.now += seconds * 1000) };
}

async function seed(w) {
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  await w.store.collection("launchAutopilot").set(`solana:devnet:${TOKEN}:grad`, { cluster: "devnet", token: TOKEN, kind: "GRADUATED", signature: "grad", at: new Date(w.state.now - 600_000).toISOString(), slot: 1, actor: "ryntra", pairRaw: "1", tokensRaw: null, pool: null, position: null, lowerBinId: null, upperBinId: null, priceLow: null, priceHigh: null, lamports: null });
}

async function passes(w, count) {
  const steps = [];
  for (let index = 0; index < count; index += 1) {
    steps.push(...(await w.pass()).steps);
    w.tick();
  }
  return steps;
}

test("the demo market Ryntra launched: the executor claims the migration fee, then the curve's fees — the budget's part and Ryntra's revenue apart, each in the log", async () => {
  const w = world();
  await seed(w);
  const first = await w.pass();
  assert.ok(first.steps.some((step) => step.step === "BUDGET_CLAIMED"));
  assert.deepEqual(w.state.sends, ["claim:migration"], "one claim a pass, the migration fee first");
  w.tick();
  await w.pass();
  assert.deepEqual(w.state.sends, ["claim:migration", "claim:curve"]);
  const budget = await readBudgetRecord(w.store, "devnet", TOKEN);
  assert.deepEqual(budget.claims.map((claim) => [claim.source, claim.pairRaw, claim.budgetRaw, claim.revenueRaw]), [
    ["migration", "15000000", "15000000", "0"],
    ["curve", "4356540", "1089135", "3267405"],
  ]);
  const receipts = (await autopilotReceipts(w.store, "devnet", TOKEN)).filter((row) => row.kind === "FEE_CLAIMED");
  assert.deepEqual(receipts.map((row) => [row.source, row.pairRaw, row.budgetRaw, row.actor]), [
    ["migration", "15000000", "15000000", "ryntra"],
    ["curve", "4356540", "1089135", "ryntra"],
  ]);
  const market = await readExecutorMarket(w.store, "devnet", TOKEN);
  assert.equal(market.budgetRaw, "15000000", "funded by its first claim");
  const marks = await journalMarks(w.store, "devnet", TOKEN);
  assert.ok(marks.some((mark) => mark.kind === "STATE" && mark.state === "ENDOWMENT_FUNDED" && mark.pairRaw === "15000000"));
});

test("the locked position's fees are claimed once a day at most, from 1 USDC", async () => {
  const w = world();
  w.state.partner = { ...w.state.partner, migrationWithdrawn: true, curve: 0n };
  await seed(w);
  await w.pass();
  assert.deepEqual(w.state.sends.filter((send) => send.startsWith("claim")), ["claim:lp"]);
  w.state.partner.lp = USDC(5);
  w.tick(3_600);
  await w.pass();
  assert.equal(w.state.sends.filter((send) => send === "claim:lp").length, 1, "not again within the day");
  w.tick(86_400);
  w.state.partner.lp = USDC(0.5);
  await w.pass();
  assert.equal(w.state.sends.filter((send) => send === "claim:lp").length, 1, "not below a dollar");
  w.state.partner.lp = USDC(2);
  await w.pass();
  assert.equal(w.state.sends.filter((send) => send === "claim:lp").length, 2);
});

test("a market of people on Micro: nothing is claimed and no ladder stands — the fees wait in Meteora's pools", async () => {
  const w = world({ preset: "micro", creator: PEOPLE });
  await seed(w);
  const steps = await passes(w, 15);
  assert.deepEqual(w.state.sends, []);
  assert.deepEqual(w.state.built, []);
  assert.ok(steps.some((step) => step.step === "BUDGET_IN_POOL"));
  assert.ok(steps.some((step) => step.step === "FLOOR_NOT_OURS"));
});

test("a config whose fee claimer on chain is not the executor is never claimed, whatever its preset says; Classic is never claimed at all", async () => {
  const w = world({ feeClaimer: MULTISIG });
  await seed(w);
  const steps = await passes(w, 3);
  assert.ok(steps.some((step) => step.step === "BUDGET_NOT_CLAIMER"));
  assert.deepEqual(w.state.built, []);
  const classic = world({ preset: "classic" });
  await seed(classic);
  await passes(classic, 3);
  assert.deepEqual(classic.state.built, [], "the executor builds no partner claim on a multisig's config");
});

test("a claim whose answer was lost is read by the next pass, never sent twice; a refused one is sent again", async () => {
  const w = world();
  await seed(w);
  w.state.answers = ["LOST"];
  const first = await w.pass();
  assert.ok(first.steps.some((step) => step.step === "BUDGET_CLAIMED"), "read back at once from its transaction");
  const w2 = world();
  await seed(w2);
  w2.state.answers = ["REFUSED"];
  const refused = await w2.pass();
  assert.ok(refused.steps.some((step) => step.step === "BUDGET_CLAIM_REJECTED"));
  w2.tick();
  await w2.pass();
  assert.deepEqual(w2.state.sends, ["claim:migration", "claim:migration"]);
  assert.equal((await readBudgetRecord(w2.store, "devnet", TOKEN)).claims.length, 1, "counted once");
});

test("the budget's ladder: steps of 2.5 % from 70 % of the budget, 5 USDC and more each, without the operator's ladder stop", async () => {
  const w = world({ floorOpen: false });
  w.state.partner = { ...w.state.partner, curve: 0n, lp: 0n, migration: USDC(65) };
  await seed(w);
  let placed = false;
  for (let index = 0; index < 20 && !placed; index += 1) {
    placed = (await w.pass()).steps.some((step) => step.step === "FLOOR_PLACED");
    w.tick();
  }
  assert.ok(placed, "placed from the budget");
  assert.equal(w.state.pool.binStep, 250, "a pool of 2.5 % steps");
  const position = w.state.position;
  assert.equal(position.pairRaw, USDC(45.5) - 0n, "70 % of 65 USDC");
  assert.equal(position.upperBinId - position.lowerBinId + 1, 9, "nine steps of 5 USDC and more");
  assert.equal(w.state.pool.activeBinId - position.upperBinId, 2, "the first step two bins below the price, ≈ −4.8 %");
  const stored = await floorRecord(w.store, "devnet", TOKEN);
  assert.deepEqual([stored.funding, stored.binStep, stored.placedRaw], ["budget", 250, String(USDC(45.5))]);
});

test("the risk limits: a price two nodes disagree on — nothing done; a fall of over 30 % in the hour — no new money, the pause in the log with its reason", async () => {
  const w = world();
  w.state.partner = { ...w.state.partner, curve: 0n, lp: 0n, migration: USDC(65) };
  await seed(w);
  w.state.second = w.state.price * 1.05;
  const diverged = await passes(w, 15);
  assert.ok(diverged.some((step) => step.step === "BUDGET_DATA_DIVERGED"));
  assert.ok(!w.state.sends.includes("openSteps"), "no ladder on prices that do not agree");
  /* Reads for five minutes, then the price falls by a third. */
  const w2 = world();
  w2.state.partner = { ...w2.state.partner, curve: 0n, lp: 0n, migration: USDC(65) };
  await seed(w2);
  for (let index = 0; index < 6; index += 1) {
    await w2.pass();
    w2.tick();
  }
  w2.state.price = w2.state.price * 0.65;
  const fall = await passes(w2, 8);
  assert.ok(fall.some((step) => step.step === "BUDGET_RISK_DROP"));
  assert.ok(!w2.state.sends.includes("openSteps"), "no money into steps during the fall");
  const marks = await journalMarks(w2.store, "devnet", TOKEN);
  const pause = marks.find((mark) => mark.state === "PAUSED_RISK");
  assert.deepEqual(pause?.risks, ["DROP"]);
});

test("a sale from the creator's wallet in the first week stops new money, for good; SOL below 0.1 stops it too", async () => {
  const w = world();
  w.state.partner = { ...w.state.partner, curve: 0n, lp: 0n, migration: USDC(65) };
  w.state.creatorHeld = USDC(1_000_000);
  await seed(w);
  await passes(w, 3);
  w.state.creatorHeld = USDC(900_000);
  await passes(w, 15);
  assert.ok(!w.state.sends.includes("openSteps"));
  const budget = await readBudgetRecord(w.store, "devnet", TOKEN);
  assert.ok(budget.creatorSoldAt !== null);
  assert.deepEqual(budget.risks, ["CREATOR_SOLD"]);
  w.state.creatorHeld = USDC(2_000_000);
  await passes(w, 2);
  assert.deepEqual((await readBudgetRecord(w.store, "devnet", TOKEN)).risks, ["CREATOR_SOLD"], "buying back does not undo the sale");
  const low = world();
  low.state.partner = { ...low.state.partner, curve: 0n, lp: 0n, migration: USDC(65) };
  low.state.lamports = 90_000_000n;
  await seed(low);
  await passes(low, 15);
  assert.deepEqual((await readBudgetRecord(low.store, "devnet", TOKEN)).risks, ["LOW_SOL"]);
  assert.ok(!low.state.sends.includes("openSteps"));
});

test("Ryntra's revenue above 100 USDC on the wallet: the operator is told once, and again only after another 100", async () => {
  const w = world();
  w.state.partner = { ...w.state.partner, migrationWithdrawn: true, lp: 0n, curve: USDC(140) };
  await seed(w);
  const first = await w.pass();
  assert.ok(first.steps.some((step) => step.step === "REVENUE_ALERTED"));
  assert.equal(w.state.alerts.length, 1);
  assert.match(w.state.alerts[0], /105\.00 USDC/);
  assert.match(w.state.alerts[0], /мультисиг/);
  const revenue = await readRevenue(w.store, "devnet");
  assert.deepEqual([revenue.claimedRaw, revenue.onWalletRaw, revenue.reservesRaw, revenue.delivered], [String(USDC(105)), String(USDC(105)), String(USDC(35)), true]);
  w.tick();
  await w.pass();
  assert.equal(w.state.alerts.length, 1, "told once");
  /* The operator sweeps the revenue: the wallet keeps only the budget. */
  w.state.wallet[PAIR] = USDC(35);
  w.tick();
  await w.pass();
  assert.equal((await readRevenue(w.store, "devnet")).onWalletRaw, "0");
  assert.equal((await readRevenue(w.store, "devnet")).alertedRaw, null, "below the threshold again: the next crossing is told anew");
});

test("exhausted: the steps sold through and the reserve below a step — the market's state says so", async () => {
  const w = world();
  w.state.partner = { ...w.state.partner, curve: 0n, lp: 0n, migration: USDC(7.2) };
  await seed(w);
  let placed = false;
  for (let index = 0; index < 20 && !placed; index += 1) {
    placed = (await w.pass()).steps.some((step) => step.step === "FLOOR_PLACED");
    w.tick();
  }
  assert.ok(placed);
  assert.equal(w.state.position.pairRaw, USDC(5.04), "one step: 70 % of 7.2 USDC");
  /* Sales went through the step: it holds the token now. */
  w.state.position.pairRaw = 0n;
  w.state.position.tokenRaw = 50_000n;
  await passes(w, 2);
  const marks = await journalMarks(w.store, "devnet", TOKEN);
  assert.ok(marks.some((mark) => mark.state === "ENDOWMENT_EXHAUSTED"));
});

test("the operator's Telegram: the founder's id when set, else the admin who last flipped the executor's switch", async () => {
  const { operatorTelegramId } = await import("./executor.server.ts");
  const stop = (by, at) => ({ version: 0, cluster: "mainnet", scope: "market", token: TOKEN, stopped: false, at, by });
  const stops = { all: stop("admin:111", "2026-10-09T21:00:00.000Z"), markets: new Map([[TOKEN, stop("admin:222", "2026-10-09T21:07:41.000Z")]]) };
  assert.equal(operatorTelegramId({ ALERT_TELEGRAM_ID: "999" }, stops), 999);
  assert.equal(operatorTelegramId({}, stops), 222, "the latest flip");
  assert.equal(operatorTelegramId({ ALERT_TELEGRAM_ID: "x" }, { all: stop("stand", "2026-10-09T21:00:00.000Z"), markets: new Map() }), null);
  assert.equal(operatorTelegramId({}, null), null);
});

test("one wallet, a Classic ladder and a Micro budget: the operator's ladder never spends the budget or Ryntra's revenue", async () => {
  const w = world({ preset: "classic", floorOpen: true });
  await seed(w);
  /* The wallet holds only a Micro market's budget and Ryntra's revenue from it — nothing of the operator's. */
  const MICRO = "Micr1111111111111111111111111111111111111111";
  const claim = (source, raw) => ({ source, signature: `claim-${source}`, at: null, pairRaw: String(raw), tokensRaw: "0", budgetRaw: String(source === "migration" ? raw : raw / 4n), revenueRaw: String(source === "migration" ? 0n : raw - raw / 4n) });
  await w.store.versioned("launchBudgets").compareAndSet(`solana:devnet:${MICRO}`, null, { version: 0, cluster: "devnet", token: MICRO, pairMint: PAIR, claims: [claim("migration", USDC(60)), claim("lp", USDC(40))], pending: null, lpClaimedAt: null, topUps: [], seen: [], creatorHighRaw: null, creatorSoldAt: null, risks: [], riskAt: null, stepsPairRaw: null, exhaustedAt: null, updatedAt: new Date(w.state.now).toISOString() });
  w.deps.chain.partnerEarned = async () => USDC(4000);
  w.state.wallet[PAIR] = USDC(100);
  const steps = await passes(w, 15);
  assert.ok(!w.state.sends.includes("openSteps"), "nothing of the wallet is the operator's: the Classic ladder places nothing");
  assert.ok(steps.some((step) => step.step === "FLOOR_NO_BUDGET"));
  /* The operator puts 50 USDC on the wallet for it: that much, no more. */
  w.state.wallet[PAIR] += USDC(50);
  await passes(w, 2);
  assert.equal(w.state.position?.pairRaw, USDC(50) - 10_000n, "the operator's money less the pool's cent of proof");
});

test("a sale from the creator's wallet while the market is still on its curve is caught from the executor's first pass", async () => {
  const w = world();
  w.state.curve = { ...w.state.curve, migrated: false, reserveRaw: USDC(20) };
  w.state.creatorHeld = USDC(500_000);
  await w.store.collection("launches").set(`solana:devnet:${TOKEN}`, w.record);
  await w.pass();
  w.tick();
  w.state.creatorHeld = USDC(100_000);
  await w.pass();
  const budget = await readBudgetRecord(w.store, "devnet", TOKEN);
  assert.ok(budget.creatorSoldAt !== null, "the sale on the curve is kept");
  assert.equal(budget.claims.length, 0, "nothing is claimed on the curve");
});

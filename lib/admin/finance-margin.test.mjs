import assert from "node:assert/strict";
import test from "node:test";

import { projectFinance } from "./finance.ts";
import { MANUAL_COST_LINES } from "./finance-manual.ts";

/* MET-1: gross revenue by source without counting one flow twice, the contribution after costs, the success metrics. */

const NOW = "2026-10-25T12:00:00.000Z";
const NOW_S = Date.parse(NOW) / 1000;
const DAY = 86_400;
const DAY_MS = DAY * 1000;
const ago = (days) => new Date(Date.parse(NOW) - days * DAY_MS).toISOString();

/** Three curve trades: 1, 2 and 0.5 USDC of trading fee, the creator's 40 %, a 0.1 referral on the second (as SOL-F1's test). */
function curveTrades() {
  return [1_000_000n, 2_000_000n, 500_000n].map((fee, index) => {
    const creator = (fee * 40n) / 100n;
    const referral = index === 1 ? 100_000n : 0n;
    return { signature: `sig-${index}`, at: NOW_S - (index === 0 ? 40 * DAY : DAY), trader: `trader-${index}`, venue: "curve", creatorRaw: creator.toString(), ryntraRaw: (fee - creator + referral).toString(), ownRaw: "0", maker: false };
  });
}

function launch(overrides = {}) {
  return {
    token: "TokenMint1111111111111111111111111111111111",
    symbol: "WICK",
    preset: "protected",
    creator: "creator",
    own: false,
    launchedAt: "2026-10-07T06:04:09.000Z",
    pair: { decimals: 6, dollar: true },
    trades: curveTrades(),
    tradesComplete: true,
    counters: {
      roleOwner: "creator",
      curve: { totalTradingRaw: "3500000", creatorPct: 40, unclaimedRaw: "1400000" },
      graduation: { migrated: false, thresholdRaw: "15454411163", feePct: 2, creatorPct: 40, withdrawn: false },
      lp: null,
      sharing: null,
    },
    partner: { curveUnclaimedRaw: "1100000", migrated: false, migration: { raw: "0", withdrawn: false }, surplus: { raw: "0", withdrawn: false }, lp: null, lpUnread: false, feeClaimer: "vault" },
    claims: [{ signature: "claim-1", at: NOW, source: "curve", pairRaw: "1000000", tokenRaw: "0" }],
    claimsComplete: true,
    ledgerClaims: null,
    creatorReceipts: [],
    ledgerTrades: [],
    ...overrides,
  };
}

const op = (id, signature, overrides = {}) => ({
  id,
  signature,
  product: "SWAP",
  status: "CONFIRMED",
  internal: false,
  at: NOW,
  feeCollected: true,
  ryntraUsd: 0.8,
  grossUsd: 1,
  feeAsset: null,
  feeGrossRaw: null,
  verification: "VERIFIED",
  wallet: "wallet-a",
  startedAt: ago(1),
  confirmedAt: new Date(Date.parse(ago(1)) + 2_000).toISOString(),
  ...overrides,
});

function inputs(overrides = {}) {
  return {
    now: NOW,
    scope: "all",
    launches: [launch()],
    launchesUnread: 0,
    operations: [],
    terminalChain: null,
    rewards: { entries: [], payouts: new Map(), unparsed: 0 },
    costs: { wallets: [{ role: "executor", address: "exec", lamports: "10000000", transactions: 3, complete: true }], executorLedgerLamports: null, growthSpentMicros: "0" },
    prices: { So11111111111111111111111111111111111111112: 100 },
    internalWallets: new Set(["owner"]),
    internalComplete: true,
    readAt: NOW,
    manualCosts: [],
    credits: [],
    modelSpend: { micros: "0", unpriced: 0 },
    ...overrides,
  };
}

const source = (model, id) => model.margin.sources.find((entry) => entry.id === id);
const cost = (model, id) => model.margin.costs.find((entry) => entry.id === id);
const metric = (model, id) => model.success.metrics.find((entry) => entry.id === id);
const close = (actual, expected) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

/* A bill of $1 for every manual line and every month of the panel's period — September and October 2026. */
const allBills = MANUAL_COST_LINES.flatMap((line) => ["2026-09", "2026-10"].map((month) => ({ line, month, usd: "1.00", source: `bill ${line} ${month}`, enteredAt: NOW })));

test("one flow is counted once: a terminal fee the ledger holds twice, Ryntra's fee inside a launch trade, claimed and claimable beside the gross", () => {
  /* sig-1 is a launch trade sent through the terminal: its 0.3 of Ryntra's own fee is in the trade's part and in ownRaw. */
  const trades = curveTrades().map((trade, index) => (index === 1 ? { ...trade, ryntraRaw: String(BigInt(trade.ryntraRaw) + 300_000n), ownRaw: "300000" } : trade));
  const operations = [
    op("a", "swap-1"),
    /* The same transaction written twice — a reload, a second lane: one fee. */
    op("a-again", "swap-1"),
    op("s", "sig-1", { product: "SPOT", ryntraUsd: 0.3, grossUsd: 0.375 }),
  ];
  const model = projectFinance(inputs({ launches: [launch({ trades })], operations, credits: [{ signature: "pay-1", wallet: "wallet-b", amountRaw: "5000000" }, { signature: "pay-1", wallet: "wallet-b", amountRaw: "5000000" }] }));

  assert.equal(source(model, "swap").flows, 1);
  close(source(model, "swap").gross.usd, 1);
  close(source(model, "swap").venue.usd, 0.2);
  close(source(model, "spot").gross.usd, 0.375);
  /* The launch's referral stays 0.1: the 0.3 is the terminal's, never the launch's too. */
  close(source(model, "launchReferral").gross.usd, 0.1);
  close(source(model, "launchCurve").gross.usd, 2.1);
  assert.equal(source(model, "credits").flows, 1, "one payment, listed twice, is one flow");
  close(source(model, "credits").gross.usd, 5);
  /* gross = 1 + 0.375 + 2.1 + 0.1 + 5 — the claimed 1.0 and the claimable 1.1 are not added again. */
  close(model.margin.gross.usd, 1 + 0.375 + 2.1 + 0.1 + 5);
  close(model.margin.notAdded.claimed.usd, 1);
  close(model.margin.notAdded.claimable.usd, 1.1);
  /* Ryntra's side of the gross is SOL-F1's revenue, and the terminal's own line agrees on the duplicate. */
  const ryntraSide = model.margin.sources.reduce((total, entry) => total + (entry.ryntra.usd ?? 0), 0);
  close(ryntraSide, model.split.revenue.usd + 5);
  close(model.lines.earned.parts.find((part) => part.id === "terminal").usd, 0.8 + 0.3);
  assert.equal(model.differences.filter((entry) => entry.kind === "TERMINAL_FEE_AMOUNT").length, 0, "the same row twice is no difference");
  /* Two rows of one transaction that disagree on Ryntra's part: still one fee, and the disagreement named. */
  const disagree = projectFinance(inputs({ operations: [op("a", "swap-1"), op("b", "swap-1", { ryntraUsd: 0.5 })] }));
  assert.equal(source(disagree, "swap").flows, 1);
  assert.ok(disagree.differences.some((entry) => entry.kind === "TERMINAL_FEE_AMOUNT" && entry.ref === "swap-1"));
});

test("the market's budget is not Ryntra's gross: Micro's quarter is beside it, not in it", () => {
  const model = projectFinance(inputs({ launches: [launch({ preset: "micro" })] }));
  close(source(model, "launchCurve").gross.usd, 1.575);
  close(model.margin.notAdded.budget.usd, 0.525);
  close(model.margin.gross.usd, 1.575 + 0.1);
});

test("the contribution after every cost: exact once every bill is in, a ceiling (≤) while one is missing", () => {
  const operations = [op("a", "swap-1")];
  const spend = { micros: "250000", unpriced: 0 };
  const whole = projectFinance(inputs({ operations, manualCosts: allBills, modelSpend: spend, credits: [{ signature: "pay-1", wallet: "wallet-b", amountRaw: "5000000" }] }));
  /* Revenue 2.2 + 0.8, credits 5; costs: 0.01 SOL at $100 = 1, five lines of two monthly bills of 1, the model 0.25. */
  const expected = whole.lines.net.usd + 5 - 2 * MANUAL_COST_LINES.length - 0.25;
  close(whole.margin.contribution.usd, expected);
  close(whole.margin.contribution.usd, 2.2 + 0.8 + 5 - 1 - 10 - 0.25);
  assert.equal(whole.margin.contribution.atMost ?? false, false);
  assert.equal(whole.margin.contribution.atLeast, false);
  close(whole.margin.share, expected / whole.margin.gross.usd);
  for (const id of ["rpcData", "signing", "delivery", "support"]) {
    assert.equal(cost(whole, id).manual, true, id);
    assert.deepEqual(cost(whole, id).parts[0].months, ["2026-09", "2026-10"]);
  }
  assert.equal(cost(whole, "llm").manual, false, "the model's tokens come from the receipts");
  close(cost(whole, "llm").usd, 0.25);
  close(cost(whole, "venue").usd, 0.2);

  /* One month's bill of two: the line is a floor (≥), the contribution a ceiling (≤). */
  const oneMonth = projectFinance(inputs({ operations, manualCosts: allBills.filter((bill) => bill.line !== "signing" || bill.month === "2026-10"), modelSpend: spend }));
  assert.equal(cost(oneMonth, "signing").atLeast, true);
  close(cost(oneMonth, "signing").usd, 1);
  assert.equal(oneMonth.margin.contribution.atMost, true);
  /* The same bill entered twice is one bill. */
  const twice = projectFinance(inputs({ operations, manualCosts: [...allBills, allBills[0]], modelSpend: spend }));
  close(cost(twice, allBills[0].line).usd, 2);

  const missing = projectFinance(inputs({ operations, manualCosts: allBills.filter((bill) => bill.line !== "rpcData"), modelSpend: spend }));
  assert.equal(cost(missing, "rpcData").usd, null, "a bill not entered is no data, never $0");
  assert.equal(missing.margin.contribution.atMost, true);
  assert.equal(missing.margin.share, null);
});

test("a cost not read never becomes a zero; a row of the wrong shape is refused, not counted", () => {
  const model = projectFinance(inputs({ modelSpend: null, credits: null, manualCosts: [...allBills, { line: "rpcData", month: "Oct", usd: "12", source: "bill", enteredAt: NOW }, { line: "rpcData", month: "2026-10", usd: "-3", source: "bill", enteredAt: NOW }] }));
  assert.equal(cost(model, "llm").usd, null);
  assert.equal(source(model, "credits").gross.usd, null);
  assert.equal(model.margin.manualRefused, 2);
  close(cost(model, "rpcData").usd, 2);
  for (const id of ["subscriptions", "usage", "marketplace"]) {
    assert.equal(source(model, id).gross.usd, null, id);
    assert.ok(source(model, id).task, id);
  }
});

test("cashback is read against Ryntra's share of the operation it was accrued on, never the venue's whole fee", () => {
  const entry = (type, usdMicros, ref, extra = {}) => ({ type, recipient: "wallet-a", rateBps: 5000, shareRaw: null, usdMicros, valuation: { basis: "STABLECOIN_PAR" }, source: { operationRef: ref }, createdAt: NOW, claimId: null, signature: null, rules: { version: "2.1.0", base: "RECEIVED", baseRaw: "800000", rank: null }, fundedBy: "fee", ...extra });
  const entries = [entry("CASHBACK", "400000", "swap-1"), entry("REFERRAL_L1", "80000", "swap-1"), entry("CASHBACK", "500000", "swap-2", { rules: undefined }), entry("CASHBACK", "10000", "ghost")];
  const model = projectFinance(inputs({ operations: [op("a", "swap-1"), op("b", "swap-2", { ryntraUsd: 0.8, grossUsd: 1 })], rewards: { entries, payouts: new Map(), unparsed: 0 } }));
  const incentives = model.margin.incentives;
  /* Base: 0.8 + 0.8 of Ryntra's share (each operation once), not the 2.0 the people paid. */
  close(incentives.base.usd, 1.6);
  assert.equal(incentives.base.atLeast, true, "a row naming an operation the ledger does not hold leaves the base a floor");
  close(incentives.accrued.usd, 0.98);
  close(incentives.rate, 0.98 / 1.6);
  assert.equal(incentives.grossBaseRows, 1);
  assert.equal(incentives.baseUnknownRows, 1);
  assert.equal(incentives.aboveReceived, false);
  close(cost(model, "cashback").usd, 0.91);
  close(cost(model, "referrals").usd, 0.08);

  /* A row not valued yet, or rows the ledger's schema refuses, leave what was accrued a floor — never an exact figure too low. */
  const unvalued = projectFinance(inputs({ operations: [op("a", "swap-1")], rewards: { entries: [entry("CASHBACK", "400000", "swap-1"), entry("CASHBACK", null, "swap-1")], payouts: new Map(), unparsed: 0 } }));
  assert.equal(unvalued.margin.incentives.accrued.atLeast, true);
  const refused = projectFinance(inputs({ operations: [op("a", "swap-1")], rewards: { entries: [entry("CASHBACK", "400000", "swap-1")], payouts: new Map(), unparsed: 2 } }));
  assert.equal(refused.margin.incentives.accrued.atLeast, true);
  /* A failed attempt of the same transaction listed first does not hide the fee-bearing row's base. */
  const attempt = projectFinance(inputs({ operations: [op("x", "swap-1", { status: "FAILED", feeCollected: false }), op("a", "swap-1")], rewards: { entries: [entry("CASHBACK", "400000", "swap-1")], payouts: new Map(), unparsed: 0 } }));
  close(attempt.margin.incentives.base.usd, 0.8);
  assert.equal(attempt.margin.incentives.base.atLeast, false);
});

test("executors: only the wallets the costs read are parts — a role with no wallet is no unread part", () => {
  const model = projectFinance(inputs());
  assert.deepEqual(cost(model, "executors").parts.map((part) => part.id), ["executor", "workers"]);
  /* Launch sources count the launches each earned on; a source nothing was earned on has no flows. */
  assert.equal(source(model, "launchCurve").flows, 1);
  assert.equal(source(model, "launchGraduation").flows, 0);
  const unreadLaunches = projectFinance(inputs({ launches: null }));
  assert.equal(source(unreadLaunches, "launchCurve").venue.usd, null, "the venue's share of a source not read is not $0");
});

test("success metrics: activation, retention, bots, autonomous actions, post-DEX launches, latency, failures, recoveries, security", () => {
  const operations = [
    op("1", "s-1", { wallet: "wallet-a", confirmedAt: ago(40), startedAt: new Date(Date.parse(ago(40)) - 1_000).toISOString() }),
    op("2", "s-2", { wallet: "wallet-a", confirmedAt: ago(5), startedAt: new Date(Date.parse(ago(5)) - 3_000).toISOString() }),
    op("3", "s-3", { wallet: "wallet-b", confirmedAt: ago(2), startedAt: new Date(Date.parse(ago(2)) - 5_000).toISOString() }),
    op("4", "s-4", { wallet: "wallet-c", status: "FAILED", feeCollected: false }),
    op("5", "s-5", { wallet: "wallet-c", status: "IN_FLIGHT", feeCollected: false, startedAt: ago(1), confirmedAt: null }),
    op("6", "s-6", { wallet: "owner", internal: true }),
  ];
  const success = {
    launches: [
      {
        token: "T1",
        creator: "creator-1",
        launchedAt: ago(20),
        own: false,
        receipts: [
          { kind: "GRADUATED", actor: "meteora", at: ago(10), signature: "g-1" },
          { kind: "FLOOR_PLACED", actor: "ryntra", at: ago(9), signature: "f-1" },
          { kind: "FEE_CLAIMED", actor: "ryntra", at: ago(3), signature: "f-2" },
        ],
        marks: [{ kind: "GRADUATION_FAILED", at: ago(11) }],
        executorState: "LADDER_ACTIVE",
      },
      { token: "T2", creator: "creator-2", launchedAt: ago(15), own: false, receipts: [{ kind: "GRADUATED", actor: "ryntra", at: ago(12), signature: "g-2" }], marks: [], executorState: "CORE_MARKET_LIVE" },
      { token: "T3", creator: "owner", launchedAt: ago(15), own: true, receipts: [], marks: [], executorState: null },
    ],
    autoinvest: [
      { owner: "wallet-a", status: "active" },
      { owner: "wallet-b", status: "paused" },
    ],
    holderClaims: [
      { owner: "holder-1", state: "CONFIRMED", at: ago(40) },
      { owner: "holder-1", state: "PENDING", at: null },
    ],
    assistant: [
      { owner: "Wa11etAssistant1111111111111111111111111111", at: ago(1), outcome: "ok", latencyMs: 1_200 },
      { owner: "guest_0123456789abcdef0123456789abcdef", at: ago(1), outcome: "ok", latencyMs: 800 },
      { owner: "system_brief", at: ago(1), outcome: "error", latencyMs: 50 },
    ],
    security: { total: 1, open: 0, complete: true },
  };
  const all = projectFinance(inputs({ operations, success }));
  /* wallet-a, wallet-b, owner, creator-1, creator-2, the wallet that asked the assistant (guests and the platform are no wallet). */
  assert.equal(metric(all, "activation").value, 6);
  const external = projectFinance(inputs({ scope: "external", operations, success }));
  assert.equal(metric(external, "activation").value, 5, "Ryntra's own wallets left out");
  /* Eligible for 7 days: wallet-a (40 d), creator-1 (20 d), creator-2 (15 d); wallet-a came back 35 days after. */
  assert.deepEqual([metric(external, "retention7").value, metric(external, "retention7").n], [1 / 3, 3]);
  assert.deepEqual([metric(external, "retention30").value, metric(external, "retention30").n], [1, 1]);
  assert.equal(metric(external, "liveBots").value, 2, "an active rule and a market on the ladder");
  assert.equal(metric(external, "autonomousActions").value, 4, "three acts of the executor (its graduation of T2 among them; one by Meteora is not Ryntra's) and one confirmed collection");
  assert.equal(metric(external, "autonomousActions").recent, 3);
  assert.deepEqual([metric(external, "postDexLaunches").value, metric(external, "postDexLaunches").n], [1, 2]);
  assert.deepEqual([metric(external, "recoveredGraduations").value, metric(external, "recoveredGraduations").n], [1, 1]);
  assert.equal(metric(external, "latencyOperations").value, 3_000);
  assert.equal(metric(external, "latencyOperations").approximate, true);
  assert.equal(metric(external, "latencyAssistant").value, 1_000);
  assert.deepEqual([metric(external, "failedShare").value, metric(external, "failedShare").n], [1 / 4, 4]);
  assert.equal(metric(external, "stuck").value, 1);
  assert.equal(metric(external, "securityIncidents").value, 1);
  assert.equal(metric(external, "securityIncidents").target, 0);
  for (const [id, task] of [
    ["teamsPaying", "TEAM-1"],
    ["sdkFirstCall", "DEV-1"],
    ["walletsInProfit", "DSC-2"],
  ]) {
    assert.equal(metric(external, id).state, "NO_SOURCE");
    assert.equal(metric(external, id).value, null);
    assert.equal(metric(external, id).task, task);
  }
});

test("success metrics not read are unread — never a zero", () => {
  const model = projectFinance(inputs({ operations: null, success: null }));
  for (const id of ["liveBots", "autonomousActions", "postDexLaunches", "latencyOperations", "failedShare", "securityIncidents"]) {
    assert.equal(metric(model, id).state, "UNREAD", id);
    assert.equal(metric(model, id).value, null, id);
  }
  /* Nothing to count a share over is no data, not 0 %. */
  const empty = projectFinance(inputs({ operations: [], success: { launches: [], autoinvest: [], holderClaims: [], assistant: [], security: { total: 0, open: 0, complete: true } } }));
  assert.equal(metric(empty, "retention7").value, null);
  assert.equal(metric(empty, "failedShare").value, null);
  assert.equal(metric(empty, "securityIncidents").value, 0, "a read list with no security thread is a measured zero");
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/* The window's switch is a build's own: this test is a build that opened it. */
process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN_PRO = "open";

const { clock, no, ok, scriptedEngine, wire } = await import("../districts/harbor/test-fixtures.mjs");
const { useEarn } = await import("./open.ts");
const { EARN_PRO_OPEN, PRO_MIN_LAMPORTS, PRO_RESERVE_LAMPORTS, bandPct, proAmounts, proChoice, proDefaultGoal, proDepth, proIncome, proName, proOther, proPrice, proReach, proReward, proSol } = await import("./pro.ts");
const { PRO_LOCKED, proFailure, proGoal, setProEnv, signableOf, useProPier } = await import("./pro-store.ts");
const { earnWords } = await import("./words.ts");

const OWNER = "4EeXyPQ1u3bWMZ3C3BaG2Tn9z8W1E6uN9rT5aS8dPGWw";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const POOL = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6";
const NFT = "9vSjhyXNLVEFbHkCbSnHMDavHZ4bXfZbfVcM9fM9Vkss";
const connection = { wallet: "Phantom", address: OWNER };
const holdings = (sol) => ({ owner: OWNER, sol: { spendableRaw: String(sol), decimals: 9 }, tokens: new Map(), complete: true, at: 1 });
const rich = holdings(12e9);

const pier = (changes = {}) => ({
  address: POOL,
  x: { mint: SOL, symbol: "SOL", decimals: 9 },
  y: { mint: USDC, symbol: "USDC", decimals: 6 },
  solIsX: true,
  price: 150.4,
  feeBps: 25,
  tickSpacing: 10,
  tickId: -18_934,
  depthLamports: "869400000000",
  rewards: [{ index: 0, mint: USDC, symbol: "USDC", perDayRaw: "864000000", running: true, endsAt: 1_800_000_000 }],
  takesDeposits: true,
  ...changes,
});
const staked = pier({ x: { mint: JITO, symbol: "JitoSOL", decimals: 9 }, y: { mint: SOL, symbol: "SOL", decimals: 9 }, solIsX: false, price: 1.2603, tickSpacing: 1, rewards: [] });
const boat = (changes = {}) => ({
  nftMint: NFT,
  pool: POOL,
  inRange: true,
  ranges: 7,
  lowerPrice: 147.4,
  upperPrice: 152.3,
  worth: { xRaw: "800000000", yRaw: "115000000", lamports: "1564000000" },
  fees: { xRaw: "1200000", yRaw: "180000", lamports: "2396000" },
  rewards: [{ index: 0, mint: USDC, symbol: "USDC", accruedRaw: "4210000", running: true }],
  empty: false,
  cared: false,
  care: null,
  ...changes,
});
const openReview = (changes = {}) => ({
  network: "devnet",
  action: "open",
  ticket: "t".repeat(64),
  transactions: [wire(1), wire(2)],
  expiresAt: new Date(1_000_000 + 30_000).toISOString(),
  summary: { action: "open", goesIn: { xRaw: "985000000", yRaw: "147000000", lamports: "1962000000" }, staysLamports: "33000000", bandBps: 40, lowerPrice: 148, upperPrice: 152.9, ranges: 1, swap: { lamports: "990000000", feeBps: 25, referral: true }, networkLamports: 15_000, depositLamports: 24_000_000, position: POOL, nftMint: NFT },
  ...changes,
});
const boatReview = (action, summary) => ({ network: "devnet", action, ticket: "t".repeat(64), transactions: [wire(3)], expiresAt: new Date(1_000_000 + 30_000).toISOString(), summary: { action, networkLamports: 5_000, ...summary } });
const landed = (count) => ok({ results: Array.from({ length: count }, (_, i) => ({ signature: `sig${i}`, state: "LANDED", reason: null })), settled: true });

const reset = () => useProPier.setState({ list: { status: "idle" }, boats: null, pier: null, boat: null, style: "balanced", goal: null, typed: "1", stop: 0, target: null, reviewed: null, phase: "idle", outcome: null, sent: null, notice: null });

function setup(script = {}) {
  const harness = scriptedEngine({ positions: [ok({ network: "devnet", owner: OWNER, positions: [boat()], care: true })], ...script });
  harness.engine.piers = () => {
    harness.calls.push({ route: "piers", args: [] });
    return Promise.resolve(structuredClone(script.piers?.[0] ?? ok({ network: "devnet", piers: [pier(), staked], at: "2026-11-15T12:00:00.000Z", care: true })));
  };
  const time = clock();
  const after = [];
  const signs = [];
  setProEnv({
    engine: harness.engine,
    now: time.now,
    sleep: time.sleep,
    sign: (_, network) => async (unsigned) => {
      signs.push({ network, unsigned });
      return { ok: true, signed: unsigned.map((_, i) => wire(i + 10)) };
    },
    after: (owner) => after.push(owner),
  });
  return { ...harness, time, after, signs };
}

beforeEach(() => {
  reset();
  useEarn.setState({ busy: false });
});

test("a Pro pier names itself like any pier, and says only what the chain holds", () => {
  assert.equal(EARN_PRO_OPEN, true);
  assert.equal(proName(pier()), "SOL · USDC");
  assert.equal(proName(staked), "JitoSOL · SOL");
  assert.deepEqual([proOther(pier()).symbol, proSol(pier()).symbol, proOther(staked).symbol, proSol(staked).symbol], ["USDC", "SOL", "JitoSOL", "SOL"]);
  assert.deepEqual([proDefaultGoal(pier()), proDefaultGoal(staked)], ["even", "near"]);
  assert.equal(proGoal(pier(), null), "even");
  assert.equal(proGoal(pier(), "edges"), "edges");
  /* A style's reach is its steps of the pool's tick spacing: 16 × 10 ticks is 1.6 %; on a spacing of one, sixteen hundredths. */
  assert.ok(Math.abs(proReach(pier(), "balanced") - 1.61) < 0.01, String(proReach(pier(), "balanced")));
  assert.ok(Math.abs(proReach(staked, "balanced") - 0.16) < 0.005);
  assert.ok(proReach(pier(), "calm") > proReach(pier(), "balanced") && proReach(pier(), "balanced") > proReach(pier(), "dense"));
  assert.equal(proDepth(pier()), "869");
  assert.equal(proDepth(pier({ depthLamports: "23900000000000" })), "24K");
  assert.equal(proDepth(pier({ depthLamports: null })), null);
  assert.deepEqual(proReward(pier()), { perDay: "864", symbol: "USDC" });
  assert.equal(proReward(staked), null);
  assert.equal(proReward(pier({ rewards: [{ ...pier().rewards[0], running: false }] })), null, "a reward that does not run is not a figure on the row");
  assert.equal(proReward(pier({ rewards: [{ ...pier().rewards[0], symbol: null }] })), null, "nor is a coin without a name");
  assert.equal(proAmounts(pier(), "985000000", "147000000"), "0.985 SOL + 147 USDC");
  assert.equal(proAmounts(pier(), "0", "147000000"), "147 USDC");
  assert.equal(bandPct(40), "0.4");
  assert.equal(bandPct(6), "0.06");
  assert.equal(proPrice(147.4321), "147.4");
  assert.equal(proPrice(1.26034), "1.26");
});

test("the choice: an amount of SOL within the engine's bounds, held with the SOL kept aside", () => {
  const good = proChoice(pier(), "balanced", "even", "1", rich, OWNER);
  assert.deepEqual([good.problem, good.lamports, good.key], [null, 1_000_000_000n, `pro:open:${OWNER}:${POOL}:balanced:even:1000000000`]);
  assert.equal(proChoice(pier(), "balanced", "even", "abc", rich, OWNER).problem, "format");
  assert.equal(proChoice(pier(), "balanced", "even", "0.04", rich, OWNER).problem, "min");
  assert.equal(proChoice(pier(), "balanced", "even", "11", holdings(50e9), OWNER).problem, null, "no ceiling on an opening");
  assert.equal(proChoice(pier(), "balanced", "even", "1", holdings(1.03e9), OWNER).problem, "sol", "the position's deposit is kept aside");
  assert.equal(proChoice(pier(), "balanced", "even", "1", null, OWNER).problem, null, "a wallet not read yet is not refused");
  assert.equal(proChoice(pier(), "balanced", "even", "1", rich, null).key, null, "no wallet, no Review");
  assert.equal(proChoice(pier(), "balanced", "even", "1", rich, OWNER).max, 12_000_000_000n - PRO_RESERVE_LAMPORTS, "as much as the wallet holds beside the deposit");
  assert.equal(proChoice(pier(), "balanced", "even", "1", holdings(3e9), OWNER).max, 3_000_000_000n - PRO_RESERVE_LAMPORTS);
  assert.notEqual(proChoice(pier(), "calm", "even", "1", rich, OWNER).key, good.key, "another width is another Review");
  assert.notEqual(proChoice(pier(), "balanced", "near", "1", rich, OWNER).key, good.key, "another goal is another Review");
  assert.ok(PRO_MIN_LAMPORTS === 50_000_000n);
});

test("a boat's income is two lines: the fees in SOL, and the pool's reward in its own coin", () => {
  const income = proIncome(pier(), boat());
  assert.equal(income.feesLamports, 2_396_000n);
  assert.deepEqual(income.rewards, [{ text: "4.21 USDC", running: true }]);
  assert.deepEqual(proIncome(pier(), boat({ rewards: [] })).rewards, []);
  assert.deepEqual(proIncome(pier(), boat({ rewards: [{ index: 0, mint: OWNER, symbol: null, accruedRaw: "1", running: true }] })).rewards, [], "a reward in a coin with no name is not said");
});

test("a Review is signable for as long as its ticket lives, less the margin a relay needs — never longer than the bytes", () => {
  const review = openReview();
  assert.equal(signableOf(review, 1_000_000).signableMs, 25_000);
  assert.equal(signableOf(review, 1_020_000).signableMs, 5_000);
  assert.equal(signableOf(review, 1_029_000).signableMs, 0);
  assert.equal(signableOf({ ...review, expiresAt: new Date(1_000_000 + 600_000).toISOString() }, 1_000_000).signableMs, 25_000);
  assert.equal(signableOf({ ...review, expiresAt: "soon" }, 1_000_000).signableMs, 0);
  assert.deepEqual(signableOf(review, 1_000_000).transactions.map((tx) => tx.wireBase64), review.transactions);
});

test("the list: read once a minute, kept through a miss, and closed where the server does not serve it", async () => {
  const { time, routes } = setup();
  await useProPier.getState().loadPiers();
  assert.equal(useProPier.getState().list.status, "ready");
  assert.deepEqual(useProPier.getState().list.value.piers.map((entry) => proName(entry)), ["SOL · USDC", "JitoSOL · SOL"]);
  await useProPier.getState().loadPiers();
  assert.equal(routes("piers").length, 1, "fresh for a minute");
  time.advance(61_000);
  await useProPier.getState().loadPiers();
  assert.equal(routes("piers").length, 2);

  reset();
  setup({ piers: [no("NETWORK")] });
  await useProPier.getState().loadPiers();
  assert.equal(useProPier.getState().list.status, "error");

  reset();
  const closed = setup({ piers: [no("CAPABILITY_UNAVAILABLE")] });
  await useProPier.getState().loadPiers();
  assert.equal(useProPier.getState().list.status, "closed");
  await useProPier.getState().loadPiers();
  await useProPier.getState().loadBoats(OWNER);
  assert.equal(closed.routes("piers").length, 1, "a closed server is not asked again");
  assert.equal(closed.routes("positions").length, 0);
});

test("an opening: the Review of exactly what is on the card, one prompt for both transactions, the relay once", async () => {
  const { routes, signs, after } = setup({ review: [ok(openReview())], submit: [landed(2)] });
  await useProPier.getState().loadPiers();
  useProPier.getState().openPier(pier());
  await useProPier.getState().prepare(connection, { kind: "open" }, rich);
  assert.deepEqual(routes("review")[0].args[0], { action: "open", owner: OWNER, pool: POOL, goal: "even", style: "balanced", lamports: "1000000000" });
  assert.equal(useProPier.getState().reviewed.review.summary.bandBps, 40);
  assert.equal(useProPier.getState().phase, "idle");

  await useProPier.getState().confirm(connection, rich);
  assert.equal(signs.length, 1, "one prompt");
  assert.deepEqual([signs[0].network, signs[0].unsigned.length], ["devnet", 2]);
  assert.equal(routes("submit").length, 1);
  assert.deepEqual(routes("submit")[0].args, ["t".repeat(64), [wire(10), wire(11)]]);
  assert.deepEqual([useProPier.getState().outcome.kind, useProPier.getState().phase, useEarn.getState().busy], ["done", "done", false]);
  assert.deepEqual(after, [OWNER]);
  assert.equal(routes("positions").length, 1, "the boats are read again");
  useProPier.getState().again();
  assert.deepEqual([useProPier.getState().pier, useProPier.getState().outcome], [null, null], "back to the list");
});

test("a change on the card drops the Review; a stale one is built again before the wallet opens", async () => {
  const { routes, time, signs } = setup({ review: [ok(openReview())] });
  useProPier.getState().openPier(pier());
  await useProPier.getState().prepare(connection, { kind: "open" }, rich);
  for (const change of [() => useProPier.getState().setTyped("2"), () => useProPier.getState().setStyle("calm"), () => useProPier.getState().setGoal("near")]) {
    change();
    assert.equal(useProPier.getState().reviewed, null);
    await useProPier.getState().prepare(connection, { kind: "open" }, rich);
    assert.notEqual(useProPier.getState().reviewed, null);
  }
  assert.deepEqual(routes("review").at(-1).args[0], { action: "open", owner: OWNER, pool: POOL, goal: "near", style: "calm", lamports: "2000000000" });
  time.advance(26_000);
  const before = routes("review").length;
  await useProPier.getState().confirm(connection, rich);
  assert.equal(signs.length, 0, "aged bytes never open the wallet");
  assert.equal(routes("review").length, before + 1);
  assert.equal(useProPier.getState().notice.text, earnWords().pro.fresh);
});

test("how it ends: only the swap landed, a refusal, a wallet that said no, an answer that never came", async () => {
  /* The swap landed and the deposit did not: said as it is, and the list is the next place. */
  let run = setup({ review: [ok(openReview())], submit: [ok({ results: [{ signature: "a", state: "LANDED", reason: null }, { signature: "b", state: "FAILED", reason: "ExceededSlippage" }], settled: false })] });
  useProPier.getState().openPier(pier());
  await useProPier.getState().prepare(connection, { kind: "open" }, rich);
  await useProPier.getState().confirm(connection, rich);
  assert.deepEqual([useProPier.getState().outcome.kind, useProPier.getState().sent.review.action], ["partial", "open"]);
  assert.match(earnWords("en").pro.partialOpen("USDC"), /Your SOL and USDC are in your wallet/);
  useProPier.getState().again();
  assert.equal(useProPier.getState().pier, null);

  /* The relay refused before it sent anything: the card stays, with the reason. */
  reset();
  run = setup({ review: [ok(openReview())], submit: [no("SIMULATION_FAILED")] });
  useProPier.getState().openPier(pier());
  await useProPier.getState().prepare(connection, { kind: "open" }, rich);
  await useProPier.getState().confirm(connection, rich);
  assert.deepEqual([useProPier.getState().outcome, useProPier.getState().phase, useProPier.getState().notice.text], [null, "idle", proFailure("SIMULATION_FAILED")]);
  assert.equal(useProPier.getState().reviewed, null, "a refused Review is built again");

  /* The wallet said no: the same Review stays to be signed. */
  reset();
  run = setup({ review: [ok(openReview())] });
  setProEnv({ sign: () => async () => ({ ok: false }) });
  useProPier.getState().openPier(pier());
  await useProPier.getState().prepare(connection, { kind: "open" }, rich);
  await useProPier.getState().confirm(connection, rich);
  assert.equal(useProPier.getState().notice.text, proFailure("WALLET_REFUSED"));
  assert.notEqual(useProPier.getState().reviewed, null);
  assert.equal(run.routes("submit").length, 0);

  /* No answer from the relay: the chain is asked, nothing is sent again. */
  reset();
  run = setup({ review: [ok(openReview())], submit: [no("TIMEOUT")], status: [ok({ results: [{ signature: "x", state: "UNKNOWN", reason: null }, { signature: "y", state: "UNKNOWN", reason: null }] })] });
  useProPier.getState().openPier(pier());
  await useProPier.getState().prepare(connection, { kind: "open" }, rich);
  await useProPier.getState().confirm(connection, rich);
  assert.equal(useProPier.getState().outcome.kind, "unknown");
  assert.equal(run.routes("submit").length, 1, "sent once");
  assert.ok(run.routes("status").length > 0);
});

test("a boat: one thing chosen, its exact figures, one signature — and the care by one approval with its stop", async () => {
  const { routes, signs } = setup({ review: [ok(boatReview("compound", { collected: { xRaw: "1200000", yRaw: "180000", lamports: "2396000" }, bandBps: 20 }))], submit: [landed(1)] });
  await useProPier.getState().loadPiers();
  useProPier.getState().openBoat(boat());
  await useProPier.getState().prepare(connection, { kind: "compound", nftMint: NFT }, rich);
  assert.deepEqual(routes("review")[0].args[0], { action: "compound", owner: OWNER, pool: POOL, nftMint: NFT });
  await useProPier.getState().confirm(connection, rich);
  assert.deepEqual([useProPier.getState().outcome.kind, signs[0].unsigned.length], ["done", 1]);

  reset();
  const care = setup({ review: [ok(boatReview("care_on", { agent: OWNER, rights: ["claimFee", "claimReward", "removeLiquidity"], stopBelow: 135.36, stopCoin: "SOL", stopUnit: "USDC" }))], submit: [landed(1)] });
  await useProPier.getState().loadPiers();
  useProPier.getState().openBoat(boat());
  useProPier.getState().setStop(10);
  await useProPier.getState().prepare(connection, { kind: "care_on", nftMint: NFT }, rich);
  assert.deepEqual(care.routes("review")[0].args[0], { action: "care_on", owner: OWNER, pool: POOL, nftMint: NFT, stopPct: 10 });
  /* Another stop is another Review. */
  useProPier.getState().setStop(25);
  assert.equal(useProPier.getState().reviewed, null);
  await useProPier.getState().prepare(connection, { kind: "care_on", nftMint: NFT }, rich);
  assert.equal(care.routes("review").at(-1).args[0].stopPct, 25);
  /* A boat that is not the one on screen is not acted on. */
  await useProPier.getState().prepare(connection, { kind: "leave", nftMint: OWNER }, rich);
  assert.equal(care.routes("review").length, 2);

  /* Nothing to take yet is said quietly, as a note. */
  reset();
  setup({ review: [no("NOTHING_TO_DO")] });
  useProPier.getState().openBoat(boat());
  await useProPier.getState().prepare(connection, { kind: "collect", nftMint: NFT }, rich);
  assert.deepEqual(useProPier.getState().notice, { tone: "warn", text: proFailure("NOTHING_TO_DO") });
});

test("while the wallet signs or bytes travel the window holds, and the card cannot be left or changed", async () => {
  let release;
  const { time } = setup({ review: [ok(openReview())], submit: [landed(2)] });
  setProEnv({ sign: () => () => new Promise((resolve) => (release = () => resolve({ ok: true, signed: [wire(10), wire(11)] }))), now: time.now, sleep: time.sleep });
  useProPier.getState().openPier(pier());
  await useProPier.getState().prepare(connection, { kind: "open" }, rich);
  const going = useProPier.getState().confirm(connection, rich);
  await Promise.resolve();
  assert.deepEqual([useProPier.getState().phase, useEarn.getState().busy, PRO_LOCKED.has("wallet")], ["wallet", true, true]);
  useProPier.getState().back();
  useProPier.getState().setTyped("5");
  useProPier.getState().openBoat(boat());
  assert.deepEqual([useProPier.getState().pier?.address, useProPier.getState().typed, useProPier.getState().boat], [POOL, "1", null]);
  release();
  await going;
  assert.deepEqual([useProPier.getState().phase, useEarn.getState().busy], ["done", false]);
});

test("every refusal the engine names has its words in both languages, and none promises anything", () => {
  const codes = ["STOPPED", "NOT_A_PIER", "PIER_NOT_OPEN", "AMOUNT_LOW", "AMOUNT_HIGH", "CARE_CLOSED", "BALANCE_LOW", "NOTHING_TO_DO", "REFUSED", "UNAVAILABLE", "TICKET_INVALID", "SIGNED_MISMATCH", "NOT_SIGNED", "SIMULATION_FAILED", "WALLET_REFUSED", "WALLET_MISMATCH", "CAPABILITY_UNAVAILABLE", "RATE_LIMITED"];
  for (const lang of ["en", "uk"]) {
    const words = earnWords(lang).pro;
    for (const code of codes) assert.ok(typeof words.failures[code] === "string" && words.failures[code].length > 0, `${lang} ${code}`);
    for (const action of ["open", "compound", "collect", "leave", "close", "care_on", "care_off"]) assert.ok(words.done[action] && words.doneLine[action], `${lang} ${action}`);
    const all = JSON.stringify(words, (_, value) => (typeof value === "function" ? value("1", "X") : value));
    assert.doesNotMatch(all, /guarantee|гарант|profit|прибут|x1000|APY|APR|дохідність/i, `${lang}: no promise of a return`);
    assert.doesNotMatch(all, /\b(API|engine|route|ticket|endpoint|id)\b/i, `${lang}: no technical word on a screen`);
  }
  assert.equal(proFailure("SOMETHING_NEW"), earnWords().pro.failures.UNAVAILABLE, "a refusal nobody named reads as «not now»");
});

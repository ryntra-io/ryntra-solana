// Run from repo root: node --test lib/core/launch/distribution.test.mjs
//
// The six cases this campaign has to get right, and each of them is here: a
// second claim takes nothing, a swapped root is seen, a wallet outside the list
// is told so, a campaign whose escrow is short offers nothing, leftovers come
// back only where something can bring them, and a Boost payout does not exist
// before the token's proven exit to a DEX.
import assert from "node:assert/strict";
import test from "node:test";

import { Keypair } from "@solana/web3.js";

import { needsReview, trustScore } from "../../growth/protect.ts";
import { DEFAULT_ELIGIBILITY, eligibilityRows } from "./distribution-audience.ts";
import { rootPlan, vestingProof, verifyVestingProof } from "./distribution-merkle.ts";
import {
  AT_ONCE,
  DISTRIBUTION_STAGES,
  ESCROW_RENT_LAMPORTS,
  STREAMFLOW_GATE_KEY,
  STREAMFLOW_MISSING,
  audienceOf,
  boostDistributionRows,
  boostDistributionTerms,
  claimPanel,
  distributionPlan,
  distributionProblems,
  distributionReconcile,
  distributionReportLines,
  distributionReview,
  launchToRewardsGate,
  leftoverPlan,
  nextUnlockOf,
  protocolFor,
  stageAfter,
  vestingNodeFor,
  vestingNodesFor,
} from "./distribution.ts";

const DAY = 86_400;
const NOW = 1_800_000_000;
const judge = { needsReview, trustScore };
const key = () => Keypair.generate().publicKey.toBase58();
const TOKEN = key();
const OWNER = key();
const TREASURY = key();
const RYNTRA = key();
const wallets = Array.from({ length: 4 }, key);

const vesting = (over = {}) => ({ startsAt: NOW, cliffDays: 0, unlockDays: 0, periodHours: 24, ...over });
const calculation = (over = {}) => ({ mode: "proRata", potRaw: "1000", capPerWalletRaw: null, floorPerWalletRaw: "1", maxWallets: 100, tiers: [], ...over });

const draft = (over = {}) => ({
  scenario: "teamVesting",
  token: TOKEN,
  owner: OWNER,
  leftoverRecipient: TREASURY,
  currency: { mint: TOKEN, decimals: 6, symbol: "WICK" },
  snapshot: null,
  eligibility: { ...DEFAULT_ELIGIBILITY, requireBought: false },
  calculation: calculation(),
  vesting: vesting(),
  cancel: "nobody",
  expiry: null,
  kyc: false,
  afterDex: false,
  ...over,
});

const snapshot = (over = {}) => ({ mint: TOKEN, slot: 400_000_000, finality: "finalized", takenAt: NOW, exclusions: ["creator", "program", "ryntra"], ...over });
const candidate = (wallet, over = {}) => ({
  wallet,
  holdingRaw: "1000",
  boughtRaw: "1000",
  heldSinceSlot: 399_000_000,
  fundingHashes: [],
  deviceHashes: [],
  signals: [],
  kyc: null,
  excluded: null,
  ...over,
});

/* ---------------------------------------------- the cycle and the protocol */

test("the stages are spec §10.2's cycle, in order and each once", () => {
  assert.deepEqual(DISTRIBUTION_STAGES, ["draft", "snapshot", "eligibility", "calculation", "review", "funding", "root", "claim", "reconcile", "recover", "report"]);
  assert.equal(stageAfter("draft"), "snapshot");
  assert.equal(stageAfter("recover"), "report");
  assert.equal(stageAfter("report"), null);
});

test("Met Lock holds the vesting, Streamflow only the open airdrop", () => {
  const plain = { expiry: false, kyc: false };
  for (const scenario of ["teamVesting", "investorVesting", "merkleClaim", "milestone", "partnerRewards", "launchToRewards", "boostPayout"]) {
    const choice = protocolFor(scenario, plain);
    assert.equal(choice.protocol, "metLock", `${scenario} is Met Lock`);
    assert.equal(choice.open, true);
  }
  /* An open community campaign is Met Lock too, until it asks for one of the two things Met Lock has no instruction for. */
  assert.equal(protocolFor("communityAirdrop", plain).why, "OPEN_LIST_IS_MET_LOCK");
  assert.equal(protocolFor("communityAirdrop", plain).protocol, "metLock");
  assert.equal(protocolFor("snapshotDrop", { expiry: true, kyc: false }).protocol, "streamflow");
  assert.equal(protocolFor("loyaltyRewards", { expiry: false, kyc: true }).why, "KYC_NEEDS_STREAMFLOW");
  /* Vesting never leaves Met Lock, whatever it asks for — that is the whole of the decision. */
  assert.equal(protocolFor("teamVesting", { expiry: true, kyc: true }).protocol, "metLock");

  /* And the second protocol is not open: the conditions the report put on it are still a list. */
  const needed = protocolFor("communityAirdrop", { expiry: true, kyc: false });
  assert.equal(needed.open, false);
  assert.deepEqual(needed.missing, STREAMFLOW_MISSING);
  assert.ok(STREAMFLOW_MISSING.length > 0, "the list is what keeps the gate shut");
  /* Even with the key set: a switch does not answer a lawyer's question. */
  assert.equal(protocolFor("communityAirdrop", { expiry: true, kyc: false }, { [STREAMFLOW_GATE_KEY]: "open" }).open, false);
});

test("a draft says every one of its faults at once", () => {
  assert.deepEqual(distributionProblems(draft(), NOW), []);
  const codes = (over, ryntra) => distributionProblems(draft(over), NOW, ryntra);
  assert.deepEqual(codes({ token: "nope" }), ["TOKEN_NOT_AN_ADDRESS"]);
  assert.deepEqual(codes({ leftoverRecipient: RYNTRA }, new Set([RYNTRA])), ["LEFTOVER_IS_RYNTRA"], "a campaign's leftovers never come to Ryntra");
  assert.deepEqual(codes({ cancel: "stranger" }), ["CANCEL_UNKNOWN"]);
  /* A claim window on Met Lock is a promise nothing keeps: the draft is refused rather than drawn with it. */
  assert.deepEqual(codes({ expiry: NOW - 1 }), ["EXPIRY_IN_PAST", "EXPIRY_NOT_ENFORCED"]);
  assert.deepEqual(codes({ expiry: NOW + DAY }), ["EXPIRY_NOT_ENFORCED"]);
  assert.deepEqual(codes({ scenario: "communityAirdrop", snapshot: snapshot(), expiry: NOW + DAY }), ["PROTOCOL_NOT_OPEN"], "an open airdrop with a window needs the protocol that keeps one");
  assert.deepEqual(codes({ vesting: vesting({ cliffDays: 200, unlockDays: 100 }) }), ["CLIFF_AFTER_UNLOCK"]);
  assert.deepEqual(codes({ vesting: vesting({ unlockDays: 4_000 }) }), ["VESTING_TOO_LONG"]);
  assert.deepEqual(codes({ vesting: vesting({ periodHours: 0 }) }), ["PERIOD_OUT_OF_BOUNDS"]);

  /* A campaign over a snapshot needs one, and a root is never funded against a slot that can still be rolled back. */
  assert.equal(audienceOf("snapshotDrop"), "snapshot");
  assert.equal(audienceOf("teamVesting"), "list");
  assert.deepEqual(codes({ scenario: "snapshotDrop", snapshot: null }), ["SNAPSHOT_MISSING"]);
  assert.deepEqual(codes({ scenario: "snapshotDrop", snapshot: snapshot({ finality: "confirmed" }) }), ["SNAPSHOT_NOT_FINAL"]);
  assert.deepEqual(codes({ scenario: "snapshotDrop", snapshot: snapshot() }), []);
});

/* ---------------------------------------------- the list the chain takes */

test("a schedule becomes one row of the tree: the whole allocation, the remainder at the cliff, nobody swappable", () => {
  const once = vestingNodeFor({ wallet: wallets[0], amountRaw: "1000" }, vesting(), "nobody");
  assert.deepEqual(once, {
    recipient: wallets[0],
    vestingStartTime: NOW,
    cliffTime: NOW,
    frequency: 0,
    cliffUnlockRaw: "1000",
    amountPerPeriodRaw: "0",
    numberOfPeriod: 0,
    updateRecipientMode: 0,
    cancelMode: 0,
  });

  const vested = vestingNodeFor({ wallet: wallets[0], amountRaw: "1003" }, vesting({ cliffDays: 30, unlockDays: 130, periodHours: 24 }), "owner");
  assert.equal(vested.numberOfPeriod, 100);
  assert.equal(vested.frequency, DAY);
  assert.equal(vested.amountPerPeriodRaw, "10");
  assert.equal(vested.cliffUnlockRaw, "3", "what does not divide unlocks at the cliff, so the escrow holds the allocation exactly");
  assert.equal(BigInt(vested.cliffUnlockRaw) + BigInt(vested.amountPerPeriodRaw) * BigInt(vested.numberOfPeriod), 1003n);
  assert.equal(vested.cancelMode, 1);
  assert.equal(vested.updateRecipientMode, 0, "a campaign that could redirect a claim is not a claim");
  assert.equal(nextUnlockOf(vested, NOW), vested.cliffTime);
  assert.equal(nextUnlockOf(vested, vested.cliffTime), vested.cliffTime + DAY);
  assert.equal(nextUnlockOf(vested, vested.cliffTime + 100 * DAY), null);
});

test("a plan divides the pot over the eligible rows alone and leaves the ones waiting for a person out of the root", async () => {
  const rows = eligibilityRows(
    [candidate(wallets[0]), candidate(wallets[1]), candidate(wallets[2], { signals: ["S1_SHARED_FUNDING"] })],
    { ...DEFAULT_ELIGIBILITY, maxPerCluster: 0 },
    judge,
  );
  const plan = distributionPlan(draft({ scenario: "snapshotDrop", snapshot: snapshot() }), rows, NOW);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.heldBack, 1, "the row with an open case is not in this root");
  assert.deepEqual(plan.rows.map((row) => row.wallet), [wallets[0], wallets[1]]);
  assert.deepEqual(plan.rows.map((row) => row.amountRaw), ["500", "500"]);
  const published = await rootPlan(plan.nodes);
  assert.deepEqual(published.problems, []);
  assert.equal(published.maxClaimAmountRaw, "1000", "what the program may ever pay is what the list adds up to");
  assert.equal(published.maxEscrow, 2);
});

test("the Review states the funding, who pays what and which promises a program keeps", async () => {
  const plan = distributionPlan(draft({ calculation: calculation({ capPerWalletRaw: "400" }) }), eligibilityRows([candidate(wallets[0]), candidate(wallets[1])], { ...DEFAULT_ELIGIBILITY, requireBought: false }, judge), NOW);
  const published = await rootPlan(plan.nodes);
  const review = distributionReview(draft({ calculation: calculation({ capPerWalletRaw: "400" }) }), plan.nodes, {
    root: published.root,
    maxClaimAmountRaw: published.maxClaimAmountRaw,
    maxEscrow: published.maxEscrow,
    leftoverRaw: plan.leftoverRaw,
    heldBack: plan.heldBack,
    belowFloor: plan.belowFloor,
  });
  assert.equal(review.allocatedRaw, "800");
  assert.equal(review.fundingRaw, review.maxClaimAmountRaw, "the funding is the list, and the list is the cap");
  assert.equal(review.fundingRaw, "800");
  assert.equal(review.leftoverRaw, "200");
  assert.equal(review.protocol.protocol, "metLock");

  /* Ryntra takes nothing, and the rent of an escrow is paid by whoever makes it — the recipient, taking their own. */
  const rent = review.fees.find((fee) => fee.currency === "sol" && fee.amountRaw !== null);
  assert.equal(rent.payer, "recipient");
  assert.equal(rent.amountRaw, String(ESCROW_RENT_LAMPORTS));
  assert.deepEqual(review.fees.filter((fee) => fee.currency === "token").map((fee) => fee.amountRaw), ["0", "0"]);

  /* The two things Met Lock cannot do are warnings on every campaign, not a footnote somewhere else. */
  assert.ok(review.warnings.includes("OVERFUNDING_STRANDS"));
  assert.ok(review.warnings.includes("NO_EXPIRY"));
  assert.ok(review.enforced.some((row) => row.by === "program" && /second claim/.test(row.fact)));
  assert.ok(review.enforced.some((row) => row.by === "program" && /recipient's own signature/.test(row.fact)));
  assert.ok(review.enforced.some((row) => row.by === "ryntra" && /snapshot/.test(row.fact)));
  assert.ok(review.enforced.some((row) => /nobody may cancel/.test(row.fact)), "a lock nobody may cancel says so");
});

test("a campaign whose owner may cancel says it before anybody claims", async () => {
  const subject = draft({ cancel: "owner" });
  const plan = distributionPlan(subject, eligibilityRows([candidate(wallets[0])], { ...DEFAULT_ELIGIBILITY, requireBought: false }, judge), NOW);
  const published = await rootPlan(plan.nodes);
  const review = distributionReview(subject, plan.nodes, { root: published.root, maxClaimAmountRaw: published.maxClaimAmountRaw, maxEscrow: published.maxEscrow, leftoverRaw: "0", heldBack: 0, belowFloor: 0 });
  assert.ok(review.warnings.includes("OWNER_MAY_CANCEL"));
  assert.ok(review.enforced.some((row) => /only what has not vested/.test(row.fact)));
});

/* ---------------------------------------------- a second claim, a wrong wallet, a short escrow */

test("a second claim takes nothing: the row's own escrow counts what it paid", () => {
  const node = vestingNodeFor({ wallet: wallets[0], amountRaw: "1000" }, vesting(), "nobody");
  const panel = (claimedRaw, now = NOW) =>
    claimPanel({ node, escrow: claimedRaw === null ? null : { address: key(), claimedRaw, cancelled: false }, receipts: [], read: true, funded: true, underReview: false, afterDex: false, now });

  const first = panel(null);
  assert.equal(first.state, "CLAIMABLE");
  assert.equal(first.claimableRaw, "1000");
  assert.equal(first.takenRaw, "0");

  const after = panel("1000");
  assert.equal(after.state, "CLAIMED");
  assert.equal(after.claimableRaw, "0", "nothing is offered a second time");
  assert.equal(after.leftRaw, "0");
  assert.equal(after.takenRaw, "1000");
});

test("a vesting row is claimed in parts, and each claim offers only what unlocked since the last", () => {
  const node = vestingNodeFor({ wallet: wallets[0], amountRaw: "1005" }, vesting({ cliffDays: 10, unlockDays: 20, periodHours: 24 }), "nobody");
  assert.equal(node.cliffUnlockRaw, "5");
  assert.equal(node.amountPerPeriodRaw, "100");
  const at = (now, claimedRaw) => claimPanel({ node, escrow: { address: key(), claimedRaw, cancelled: false }, receipts: [], read: true, funded: true, underReview: false, afterDex: false, now });
  assert.equal(at(NOW, "0").state, "WAITING");
  assert.equal(at(NOW, "0").claimableRaw, "0");
  assert.equal(at(NOW, "0").nextUnlockAt, node.cliffTime);
  const atCliff = at(node.cliffTime, "0");
  assert.equal(atCliff.state, "CLAIMABLE");
  assert.equal(atCliff.claimableRaw, "5", "only the remainder waits at the cliff");
  const partly = at(node.cliffTime + 3 * DAY, "5");
  assert.equal(partly.state, "PARTLY_CLAIMED");
  assert.equal(partly.claimableRaw, "300");
  assert.equal(at(node.cliffTime + 100 * DAY, "1005").state, "CLAIMED");
});

test("a wallet outside the list is told so, and its proof does not exist", async () => {
  const list = vestingNodesFor([{ wallet: wallets[0], amountRaw: "600" }, { wallet: wallets[1], amountRaw: "400" }], vesting(), "nobody");
  const published = await rootPlan(list);
  assert.equal(await vestingProof(list, wallets[3]), null);
  const panel = claimPanel({ node: null, escrow: null, receipts: [], read: true, funded: true, underReview: false, afterDex: false, now: NOW });
  assert.equal(panel.state, "NOT_IN_LIST");
  assert.equal(panel.owedRaw, null, "a wallet with nothing owed is told nothing, never zero as a promise");

  /* And taking somebody else's row with one's own proof fails the program's own check. */
  const mine = await vestingProof(list, wallets[0]);
  assert.equal(await verifyVestingProof(list[1], mine, published.root), false);
});

test("a campaign whose escrow is short offers nothing, and the reconciliation names it", () => {
  const node = vestingNodeFor({ wallet: wallets[0], amountRaw: "1000" }, vesting(), "nobody");
  const short = claimPanel({ node, escrow: null, receipts: [], read: true, funded: false, underReview: false, afterDex: false, now: NOW });
  assert.equal(short.state, "NOT_FUNDED");
  assert.equal(short.owedRaw, "1000", "the row is still owed what the list published");
  assert.equal(short.claimableRaw, "0", "but nothing is offered against money that is not there");

  const list = { root: "a".repeat(64), totalRaw: "1000", wallets: 1 };
  assert.equal(distributionReconcile(list, { root: list.root, fundedRaw: "400", distributedRaw: "0", escrowsMade: 0 }).state, "UNDERFUNDED");
  assert.equal(distributionReconcile(list, { root: list.root, fundedRaw: "1000", distributedRaw: "1000", escrowsMade: 1 }).state, "OK");
  assert.equal(distributionReconcile(list, { root: list.root, fundedRaw: "1400", distributedRaw: "0", escrowsMade: 0 }).state, "OVERFUNDED");
  assert.equal(distributionReconcile(list, { root: "b".repeat(64), fundedRaw: "1000", distributedRaw: "0", escrowsMade: 0 }).state, "ROOT_MISMATCH");
  assert.equal(distributionReconcile(list, { root: list.root, fundedRaw: "1000", distributedRaw: "1000", escrowsMade: 2 }).state, "ESCROW_OVERRUN");
  /* A chain that was not read says so; it never reads as zero. */
  const unread = distributionReconcile(list, null);
  assert.equal(unread.state, "NOT_READ");
  assert.equal(unread.fundedRaw, null);
  assert.equal(unread.unassignedRaw, null);
});

test("a row its owner cancelled says so, and offers nothing", () => {
  const node = vestingNodeFor({ wallet: wallets[0], amountRaw: "1000" }, vesting({ cliffDays: 10, unlockDays: 20, periodHours: 24 }), "owner");
  const panel = claimPanel({
    node,
    escrow: { address: key(), claimedRaw: "5", cancelled: true },
    receipts: [],
    read: true,
    funded: true,
    underReview: false,
    afterDex: false,
    now: node.cliffTime + 3 * DAY,
  });
  assert.equal(panel.state, "CANCELLED");
  assert.equal(panel.claimableRaw, "0", "a cancelled row is not offered, whatever its schedule says");
  assert.equal(panel.takenRaw, "5", "what the recipient had taken is still what they took");
});

test("a read that failed states nothing, and a case still open holds the row", () => {
  const node = vestingNodeFor({ wallet: wallets[0], amountRaw: "1000" }, vesting(), "nobody");
  const base = { node, escrow: null, receipts: [], funded: true, underReview: false, afterDex: false, now: NOW };
  assert.equal(claimPanel({ ...base, read: false }).state, "UNREAD");
  assert.equal(claimPanel({ ...base, read: false }).owedRaw, null);
  assert.equal(claimPanel({ ...base, read: true, underReview: true }).state, "UNDER_REVIEW");
});

/* ---------------------------------------------- the leftovers */

test("only what something can bring comes back, and the stranded part says so plainly", () => {
  const open = leftoverPlan({ unspentPotRaw: "200", cancellableUnvestedRaw: "500", strandedRaw: "0", cancel: "owner", leftoverRecipient: TREASURY });
  assert.deepEqual(open.map((row) => [row.kind, row.amountRaw, row.recoverable]), [
    ["unspentPot", "200", true],
    ["cancelledUnvested", "500", true],
    ["strandedInRoot", "0", false],
  ]);
  assert.match(open[0].how, new RegExp(TREASURY));

  /* A lock nobody may cancel returns nothing of a row — that is what the lock is. */
  const locked = leftoverPlan({ unspentPotRaw: "200", cancellableUnvestedRaw: "500", strandedRaw: "0", cancel: "nobody", leftoverRecipient: TREASURY });
  assert.equal(locked[1].amountRaw, "0");
  assert.equal(locked[1].recoverable, false);

  /* And money funded above the list never leaves a root escrow: no instruction takes it out. */
  const stranded = leftoverPlan({ unspentPotRaw: "0", cancellableUnvestedRaw: "0", strandedRaw: "750", cancel: "owner", leftoverRecipient: TREASURY });
  assert.equal(stranded[2].recoverable, false);
  assert.match(stranded[2].how, /no instruction that empties a root escrow/);
});

/* ---------------------------------------------- Launch-to-Rewards and the Boost payout */

test("a campaign that waits for a DEX opens on the chain's own answer and on nothing else", () => {
  const graduated = { read: true, migrated: true, pool: key(), graduation: { signature: "sig", at: NOW - 100 } };
  assert.deepEqual(launchToRewardsGate(graduated), { open: true, reason: "OPEN", at: NOW - 100 });
  assert.equal(launchToRewardsGate({ ...graduated, migrated: false }).reason, "NOT_MIGRATED");
  assert.equal(launchToRewardsGate({ ...graduated, pool: null }).reason, "NOT_MIGRATED");
  assert.equal(launchToRewardsGate({ ...graduated, graduation: null }).reason, "NO_SIGNATURE");
  /* An unread chain is never a yes: a full curve, a plan or a status is not an exit. */
  assert.deepEqual(launchToRewardsGate({ ...graduated, read: false }), { open: false, reason: "NOT_READ", at: null });
  assert.deepEqual(launchToRewardsGate(null), { open: false, reason: "NOT_READ", at: null });
});

test("a Boost payout is a claim the holder makes, and it does not exist before the exit to a DEX", async () => {
  const payout = { rows: [{ wallet: wallets[0], bonusRaw: "250" }, { wallet: wallets[1], bonusRaw: "0" }, { wallet: wallets[2], bonusRaw: "125" }] };
  const rows = boostDistributionRows(payout);
  assert.deepEqual(rows.map((row) => [row.wallet, row.amountRaw]), [[wallets[0], "250"], [wallets[2], "125"]], "a wallet owed nothing is not a row");

  const terms = boostDistributionTerms(NOW - 10);
  assert.deepEqual(terms, { startsAt: NOW - 10, ...AT_ONCE });
  const nodes = vestingNodesFor(rows, terms, "nobody");
  const published = await rootPlan(nodes);
  assert.deepEqual(published.problems, []);
  assert.equal(published.maxClaimAmountRaw, "375");

  /* The holder takes it with their own signature: everything is unlocked, so nothing waits on the creator. */
  const panel = claimPanel({ node: nodes[0], escrow: null, receipts: [], read: true, funded: true, underReview: false, afterDex: false, now: NOW });
  assert.equal(panel.state, "CLAIMABLE");
  assert.equal(panel.claimableRaw, "250");
  assert.equal(nodes[0].cancelMode, 0, "a counted payout is nobody's to cancel");

  /* Before the proven exit there is no campaign to claim from at all. */
  const waiting = claimPanel({ node: nodes[0], escrow: null, receipts: [], read: true, funded: false, underReview: false, afterDex: true, now: NOW });
  assert.equal(waiting.state, "AFTER_DEX");
  assert.equal(waiting.claimableRaw, null);
});

/* ---------------------------------------------- the report */

test("the report says what was promised, what was taken and what cannot come back", async () => {
  const subject = draft({ scenario: "communityAirdrop", snapshot: snapshot(), calculation: calculation({ potRaw: "1000000" }) });
  const plan = distributionPlan(subject, eligibilityRows([candidate(wallets[0]), candidate(wallets[1])], DEFAULT_ELIGIBILITY, judge), NOW);
  const published = await rootPlan(plan.nodes);
  const review = distributionReview(subject, plan.nodes, {
    root: published.root,
    maxClaimAmountRaw: published.maxClaimAmountRaw,
    maxEscrow: published.maxEscrow,
    leftoverRaw: plan.leftoverRaw,
    heldBack: plan.heldBack,
    belowFloor: plan.belowFloor,
  });
  const reconcile = distributionReconcile({ root: published.root, totalRaw: published.maxClaimAmountRaw, wallets: published.maxEscrow }, {
    root: published.root,
    fundedRaw: published.maxClaimAmountRaw,
    distributedRaw: "500000",
    escrowsMade: 1,
  });
  const leftovers = leftoverPlan({ unspentPotRaw: plan.leftoverRaw, cancellableUnvestedRaw: "0", strandedRaw: "0", cancel: subject.cancel, leftoverRecipient: TREASURY });

  for (const locale of ["uk", "en"]) {
    const lines = distributionReportLines({ draft: subject, review, reconcile, leftovers, claimed: { wallets: 1, amountRaw: "500000" }, at: NOW }, locale);
    assert.equal(lines.length, 4);
    assert.ok(lines.every((line) => line.length > 0 && line.length < 600));
    assert.ok(lines.some((line) => line.includes(published.root)));
    assert.ok(lines.some((line) => line.includes("WICK")));
    assert.ok(lines.some((line) => (locale === "uk" ? /Повторний claim неможливий у ланцюгу/ : /repeated claim is impossible on chain/).test(line)));
    assert.ok(lines.some((line) => (locale === "uk" ? /0,5/ : /0\.5/).test(line)), "half a million base units of six decimals reads as 0,5");
  }
});

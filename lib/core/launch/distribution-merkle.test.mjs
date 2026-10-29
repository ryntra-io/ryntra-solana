// Run from repo root: node --test lib/core/launch/distribution-merkle.test.mjs
//
// The tree below is not Ryntra's to choose: `create_vesting_escrow_from_root`
// hashes the row itself and checks the proof against the root it stores, so a
// leaf or a pair built one byte differently makes every claim of the campaign
// fail with `InvalidMerkleProof`. The first test therefore rebuilds the leaf and
// the pairs by a path that shares no code with the module — node's own sha256
// and web3.js's own base58 — and the rest pin the three properties a claim
// stands on: a proof reaches only its own root, a row belongs only to its own
// wallet, and a row's schedule cannot be swapped under it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { Keypair, PublicKey } from "@solana/web3.js";

import {
  MET_LOCK_ACTOR_MODE,
  U64_MAX,
  claimableRaw,
  metLockActorOf,
  nodeEndsAt,
  nodeTotalRaw,
  rootPlan,
  unlockedRaw,
  verifyVestingProof,
  vestingLeaf,
  vestingNodeProblems,
  vestingProof,
  vestingRoot,
} from "./distribution-merkle.ts";

const DAY = 86_400;
const wallets = Array.from({ length: 9 }, () => Keypair.generate().publicKey.toBase58());

const node = (recipient, over = {}) => ({
  recipient,
  vestingStartTime: 1_800_000_000,
  cliffTime: 1_800_000_000 + 30 * DAY,
  frequency: DAY,
  cliffUnlockRaw: "1000",
  amountPerPeriodRaw: "100",
  numberOfPeriod: 90,
  updateRecipientMode: 0,
  cancelMode: 0,
  ...over,
});

/* ---------------------------------------------- the shape, by another path */

const sha = (...parts) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};
const le8 = (value) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};
/** The leaf as the program computes it, written out again from the program's source rather than from the module. */
const leafByHand = (row) =>
  sha(
    Buffer.from([0]),
    sha(
      new PublicKey(row.recipient).toBuffer(),
      le8(row.vestingStartTime),
      le8(row.cliffTime),
      le8(row.frequency),
      le8(row.cliffUnlockRaw),
      le8(row.amountPerPeriodRaw),
      le8(row.numberOfPeriod),
      Buffer.from([row.updateRecipientMode]),
      Buffer.from([row.cancelMode]),
    ),
  ).toString("hex");
const pairByHand = (a, b) => {
  const [low, high] = a <= b ? [a, b] : [b, a];
  return sha(Buffer.from([1]), Buffer.from(low, "hex"), Buffer.from(high, "hex")).toString("hex");
};

test("a leaf is the program's own hash of the whole row under the leaf prefix", async () => {
  const row = node(wallets[0]);
  assert.equal(await vestingLeaf(row), leafByHand(row));
  /* Every field is in the hash: change one and the leaf is another leaf, which is what stops a row being replayed
     with a longer cliff or a larger amount. */
  for (const over of [{ cliffTime: 1_800_000_000 + 31 * DAY }, { cliffUnlockRaw: "1001" }, { amountPerPeriodRaw: "101" }, { numberOfPeriod: 91 }, { frequency: 2 * DAY }, { cancelMode: 1 }]) {
    assert.notEqual(await vestingLeaf(node(wallets[0], over)), await vestingLeaf(row), `the leaf ignores ${Object.keys(over)[0]}`);
  }
});

test("a root is the pairs hashed sorted, and an odd level's last entry is hashed with itself", async () => {
  const two = [node(wallets[0]), node(wallets[1])];
  assert.equal(await vestingRoot(two), pairByHand(leafByHand(two[0]), leafByHand(two[1])));

  /* Three leaves: the third has no sibling, so it is hashed with itself — not carried up. A tree that carried it up
     would publish a root its own proofs could still reach, but not the one the locker's builder publishes. */
  const three = [node(wallets[0]), node(wallets[1]), node(wallets[2])];
  const [a, b, c] = three.map(leafByHand);
  const expected = pairByHand(pairByHand(a, b), pairByHand(c, c));
  assert.equal(await vestingRoot(three), expected);
  assert.notEqual(await vestingRoot(three), pairByHand(pairByHand(a, b), c), "the odd entry is duplicated, not carried");
});

test("the leaves keep the list's own order: two lists of the same rows in another order are two campaigns", async () => {
  const first = [node(wallets[0]), node(wallets[1]), node(wallets[2])];
  const second = [first[2], first[0], first[1]];
  assert.notEqual(await vestingRoot(first), await vestingRoot(second));
  /* And each list's own proofs hold inside it. */
  for (const list of [first, second]) {
    for (const row of list) {
      assert.equal(await verifyVestingProof(row, await vestingProof(list, row.recipient), await vestingRoot(list)), true);
    }
  }
});

test("every row of a list up to nine wallets proves against the list's root", async () => {
  for (let size = 1; size <= 9; size += 1) {
    const list = wallets.slice(0, size).map((wallet) => node(wallet));
    const root = await vestingRoot(list);
    for (const row of list) {
      const proof = await vestingProof(list, row.recipient);
      assert.ok(proof, `a row of ${size} has a proof`);
      assert.equal(await verifyVestingProof(row, proof, root), true, `row of ${size} verifies`);
    }
  }
});

/* ---------------------------------------------- a swapped root, a wrong wallet, a changed row */

test("a proof reaches only the root it was made for: a swapped root leaves every claim failing", async () => {
  const list = [node(wallets[0]), node(wallets[1]), node(wallets[2])];
  const other = [node(wallets[0]), node(wallets[1]), node(wallets[3])];
  const root = await vestingRoot(list);
  const swapped = await vestingRoot(other);
  assert.notEqual(root, swapped);
  const proof = await vestingProof(list, wallets[0]);
  assert.equal(await verifyVestingProof(list[0], proof, root), true);
  assert.equal(await verifyVestingProof(list[0], proof, swapped), false, "the list's proof does not reach another root");
  /* Nor does a root of the right shape that nobody built: 32 bytes of zeros is still a refusal, never a pass. */
  assert.equal(await verifyVestingProof(list[0], proof, "0".repeat(64)), false);
  assert.equal(await verifyVestingProof(list[0], proof, "not a hash"), false);
});

test("a row belongs to one wallet: another wallet's proof and another wallet's row both fail", async () => {
  const list = [node(wallets[0]), node(wallets[1]), node(wallets[2])];
  const root = await vestingRoot(list);
  const mine = await vestingProof(list, wallets[0]);
  /* The claimant is an account of the transaction, so the only way to try somebody else's row is to take their row —
     and then the leaf is theirs, not the claimant's: the program would build a different node and refuse. */
  assert.equal(await verifyVestingProof(node(wallets[1]), mine, root), false, "my proof does not carry another row");
  assert.equal(await verifyVestingProof(node(wallets[0], { recipient: wallets[1] }), mine, root), false, "nor a row with the recipient swapped");
  assert.equal(await vestingProof(list, wallets[4]), null, "a wallet outside the list has no proof at all");
});

test("a row's amounts and dates cannot be raised under the same proof", async () => {
  const list = [node(wallets[0]), node(wallets[1])];
  const root = await vestingRoot(list);
  const proof = await vestingProof(list, wallets[0]);
  assert.equal(await verifyVestingProof({ ...list[0], cliffUnlockRaw: "100000" }, proof, root), false);
  assert.equal(await verifyVestingProof({ ...list[0], numberOfPeriod: 900 }, proof, root), false);
  assert.equal(await verifyVestingProof({ ...list[0], cancelMode: MET_LOCK_ACTOR_MODE.owner }, proof, root), false);
});

/* ---------------------------------------------- what the program refuses in a row */

test("a row the program would refuse is named, each rule once", () => {
  assert.deepEqual(vestingNodeProblems(node(wallets[0])), []);
  assert.deepEqual(vestingNodeProblems(node("not-a-wallet")), ["RECIPIENT_NOT_AN_ADDRESS"]);
  /* An amount with two spellings is refused before anything is added up — there is no total to judge. */
  assert.deepEqual(vestingNodeProblems(node(wallets[0], { cliffUnlockRaw: "01" })), ["NOT_AN_AMOUNT"]);
  assert.deepEqual(vestingNodeProblems(node(wallets[0], { cliffTime: 1_700_000_000 })), ["CLIFF_BEFORE_START"]);
  assert.deepEqual(vestingNodeProblems(node(wallets[0], { frequency: 0 })), ["FREQUENCY_ZERO"]);
  assert.deepEqual(vestingNodeProblems(node(wallets[0], { cancelMode: 9 })), ["MODE_UNKNOWN"]);
  assert.deepEqual(vestingNodeProblems(node(wallets[0], { cliffUnlockRaw: "0", amountPerPeriodRaw: "0", numberOfPeriod: 0, frequency: 0 })), ["NOTHING_TO_PAY"]);
  /* A schedule whose total passes a u64 is not a schedule: the program stores every amount as one. */
  assert.deepEqual(vestingNodeProblems(node(wallets[0], { cliffUnlockRaw: String(U64_MAX), amountPerPeriodRaw: "1", numberOfPeriod: 1 })), ["TOTAL_ABOVE_U64"]);
  assert.equal(metLockActorOf(0), "nobody");
  assert.equal(metLockActorOf(3), "either");
  assert.equal(metLockActorOf(4), null);
});

test("a list is a list only when every row holds and no wallet is in it twice", async () => {
  const good = await rootPlan([node(wallets[0]), node(wallets[1])]);
  assert.deepEqual(good.problems, []);
  assert.equal(good.maxEscrow, 2);
  assert.equal(good.maxClaimAmountRaw, String(2n * (1000n + 100n * 90n)));
  assert.match(good.root, /^[0-9a-f]{64}$/);

  const empty = await rootPlan([]);
  assert.deepEqual(empty.problems, ["NO_ROWS"]);
  assert.equal(empty.root, null, "a campaign with no rows publishes nothing");

  /* Two rows for one wallet could never both become escrows — the second one's address already exists. */
  const twice = await rootPlan([node(wallets[0]), node(wallets[0])]);
  assert.deepEqual(twice.problems, ["RECIPIENT_REPEATED"]);
  assert.equal(twice.root, null);

  const refused = await rootPlan([node(wallets[0]), node(wallets[1], { frequency: 0 })]);
  assert.deepEqual(refused.problems, ["ROW_REFUSED"]);
  assert.deepEqual(refused.refused, [{ index: 1, recipient: wallets[1], problems: ["FREQUENCY_ZERO"] }]);
});

/* ---------------------------------------------- the vesting arithmetic, as the program counts it */

test("a row unlocks nothing before its cliff, the cliff's amount at it, then one period at a time", () => {
  const row = node(wallets[0]);
  const cliff = row.cliffTime;
  assert.equal(unlockedRaw(row, cliff - 1), 0n);
  assert.equal(unlockedRaw(row, cliff), 1000n);
  assert.equal(unlockedRaw(row, cliff + DAY - 1), 1000n, "a part of a period unlocks nothing");
  assert.equal(unlockedRaw(row, cliff + DAY), 1100n);
  assert.equal(unlockedRaw(row, cliff + 90 * DAY), 10_000n);
  assert.equal(unlockedRaw(row, cliff + 900 * DAY), 10_000n, "never past the row's own periods");
  assert.equal(nodeTotalRaw(row), 10_000n);
  assert.equal(nodeEndsAt(row), cliff + 90 * DAY);

  /* Everything at once: no periods at all, and the whole row waits at the cliff. */
  const once = node(wallets[1], { frequency: 0, cliffUnlockRaw: "500", amountPerPeriodRaw: "0", numberOfPeriod: 0 });
  assert.equal(unlockedRaw(once, once.cliffTime - 1), 0n);
  assert.equal(unlockedRaw(once, once.cliffTime), 500n);
  assert.equal(nodeEndsAt(once), once.cliffTime);
});

test("a second claim can only take what has unlocked since the first", () => {
  const row = node(wallets[0]);
  const cliff = row.cliffTime;
  assert.equal(claimableRaw(row, 0n, cliff), 1000n);
  assert.equal(claimableRaw(row, 1000n, cliff), 0n, "nothing twice at the same moment");
  assert.equal(claimableRaw(row, 1000n, cliff + 2 * DAY), 200n);
  assert.equal(claimableRaw(row, 10_000n, cliff + 900 * DAY), 0n, "a row taken whole gives nothing more");
  /* The escrow's own counter is what makes this true on chain, so a figure above what unlocked never goes negative. */
  assert.equal(claimableRaw(row, 99_999n, cliff + 900 * DAY), 0n);
});

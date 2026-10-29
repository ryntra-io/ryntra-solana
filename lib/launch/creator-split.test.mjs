import assert from "node:assert/strict";
import test from "node:test";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

import { MEMO_PROGRAM, parseSplitRuleMemo, splitRoot, verifySplitProof, splitProof } from "../core/launch/creator-split.ts";
const DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
import {
  LaunchSplitDepthBuildResponseSchema,
  LaunchSplitDepthSubmitResponseSchema,
  LaunchSplitPayoutBuildResponseSchema,
  LaunchSplitPayoutSubmitResponseSchema,
  LaunchSplitRuleBuildResponseSchema,
  LaunchSplitRuleSubmitResponseSchema,
  LaunchSplitViewSchema,
} from "../api/v1/contract.ts";
import { GUARD_COLLECTIONS, createMemoryGuardStore } from "../guard/store.ts";
import { launchNetwork } from "./config.server.ts";
import {
  LAUNCH_CREATOR_SPLITS,
  creatorSplitOpenFor,
  creatorSplitView,
  depthPoolAccepted,
  depthProblems,
  prepareSplitDepth,
  prepareSplitPayout,
  prepareSplitRule,
  readCreatorSplit,
  splitOfferLines,
  submitSplitDepth,
  submitSplitPayout,
  submitSplitRule,
} from "./creator-split.server.ts";

const DEVNET = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" });
const MAINNET = launchNetwork({});
const ENV = { BETA_TOKEN_SECRET: "a-test-secret-of-enough-length-0123456789" };
const T0 = 1_800_000_000;

const creator = Keypair.generate();
const stranger = Keypair.generate();
const community = Keypair.generate().publicKey.toBase58();
const token = Keypair.generate().publicKey.toBase58();
const pairMint = DEVNET.pairs.classic.mint;
const shareWallet = Keypair.generate().publicKey.toBase58();
const OWN = Keypair.generate().publicKey.toBase58();
const FRESH = Keypair.generate().publicKey.toBase58();
const FAKE_POOL = Keypair.generate().publicKey.toBase58();

const mintData = (decimals) => {
  const data = Buffer.alloc(82);
  data[44] = decimals;
  data[45] = 1;
  return data;
};

function fakeConnection({ sent = [] } = {}) {
  const accounts = new Map([
    [pairMint, { owner: TOKEN_PROGRAM_ID, data: mintData(6) }],
    [token, { owner: TOKEN_2022_PROGRAM_ID, data: mintData(6) }],
  ]);
  return {
    getAccountInfo: async (key) => {
      const found = accounts.get(key.toBase58());
      return found ? { ...found, lamports: 2_039_280, executable: false, rentEpoch: 0 } : null;
    },
    getLatestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1_000 }),
    getEpochInfo: async () => ({ blockHeight: 900, absoluteSlot: 1_000 }),
    getRecentPerformanceSamples: async () => [],
    sendRawTransaction: async (bytes) => {
      sent.push(Transaction.from(bytes));
      return "sent";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
    getSignatureStatuses: async () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] }),
  };
}

const launchRecord = {
  cluster: "devnet",
  state: "LAUNCHED",
  token,
  pool: Keypair.generate().publicKey.toBase58(),
  config: DEVNET.configs.classic,
  pairMint,
  preset: "classic",
  creator: creator.publicKey.toBase58(),
  name: "Owl",
  symbol: "OWL",
  metadataUri: "http://localhost:3020/m/x",
  signature: "create",
  validUntil: "100",
  firstBuyInRaw: "0",
  firstBuyOutRaw: "0",
  lock: null,
  feeSharing: { vault: Keypair.generate().publicKey.toBase58(), shares: [{ address: creator.publicKey.toBase58(), bps: 8_000 }, { address: shareWallet, bps: 2_000 }], signature: "s", state: "SHARED", reason: null },
  buildId: "b",
  referralCode: null,
  launchedAt: new Date(T0 * 1000).toISOString(),
};

/** The creator's share as the chain counts it: settable by the test. */
function shareOf(start = { earnedRaw: "1000000", claimedRaw: "1000000", migrated: false, dammPool: null, roleOwner: creator.publicKey.toBase58(), lpHeld: null }) {
  let value = start;
  return { read: async () => value, set: (next) => (value = { ...value, ...next }) };
}

const holders = Array.from({ length: 5 }, () => Keypair.generate().publicKey.toBase58());
const bundled = Keypair.generate().publicKey.toBase58();
const programOwned = PublicKey.findProgramAddressSync([Buffer.from("pool")], new PublicKey(DLMM_PROGRAM))[0].toBase58();

function marketFacts(over = {}) {
  return {
    mintAccounts: [
      ...holders.map((owner, index) => ({ owner, account: Keypair.generate().publicKey.toBase58(), amountRaw: String((index + 1) * 1_000_000) })),
      { owner: creator.publicKey.toBase58(), account: "c", amountRaw: "90000000" },
      { owner: bundled, account: "b", amountRaw: "50000000" },
      { owner: programOwned, account: "p", amountRaw: "700000000" },
      { owner: shareWallet, account: "s", amountRaw: "7000000" },
      { owner: OWN, account: "o", amountRaw: "3000000" },
      { owner: FRESH, account: "f", amountRaw: "9000000" },
    ],
    response: { holders: { groups: { bundle: { shareBps: 100, wallets: 1, atLeast: false } } } },
    labels: new Map([[bundled, ["bundle"]]]),
    state: {},
    ...over,
  };
}

/** A whole history as the ledger keeps it: each wallet's bought less sold, the wallets the creator paid a buy for. */
function historyOf(trades) {
  const bought = new Map();
  const creatorPaid = new Set();
  for (const trade of trades) {
    bought.set(trade.trader, (bought.get(trade.trader) ?? 0n) + (trade.side === "buy" ? BigInt(trade.tokensRaw) : -BigInt(trade.tokensRaw)));
    if (trade.side === "buy" && trade.payer === creator.publicKey.toBase58() && trade.trader !== trade.payer) creatorPaid.add(trade.trader);
  }
  return { bought, creatorPaid, complete: true };
}

async function stand(over = {}) {
  const store = createMemoryGuardStore();
  await store.collection("launches").set(`solana:devnet:${token}`, launchRecord);
  let now = new Date(T0 * 1000);
  const sent = [];
  const share = shareOf();
  const deps = {
    network: DEVNET,
    connection: fakeConnection({ sent }),
    store,
    now: () => now,
    env: ENV,
    ownWallets: async () => ({ wallets: new Set([OWN]), complete: true }),
    share: (record) => share.read(record),
    market: async () => marketFacts(),
    /* The whole history: every holder bought what it holds; the creator's fresh wallet got its tokens by a transfer. */
    history: async () => historyOf([...holders.map((trader, index) => ({ trader, payer: trader, side: "buy", tokensRaw: String((index + 1) * 1_000_000) })), { trader: bundled, payer: bundled, side: "buy", tokensRaw: "50000000" }]),
    balance: async () => 1_000_000_000_000n,
    simulate: async () => null,
    ...over.deps,
  };
  return { deps, store, sent, share, at: (seconds) => (now = new Date(seconds * 1000)) };
}

const rule = (shares, wallet = null) => ({ shares: { self: 0, depth: 0, community: 0, holders: 0, ...shares }, community: wallet });
const signed = (wire, ...keys) => {
  const tx = Transaction.from(Buffer.from(wire, "base64"));
  tx.partialSign(...keys);
  return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
};
const memoOf = (tx) => {
  const memo = tx.instructions.find((instruction) => instruction.programId.toBase58() === MEMO_PROGRAM);
  return memo ? Buffer.from(memo.data).toString("utf8") : null;
};

async function writeRule(s, r = rule({ self: 5_000, depth: 2_000, community: 1_000, holders: 2_000 }, community)) {
  const prepared = await prepareSplitRule(s.deps, { token, creator: creator.publicKey.toBase58(), rule: r });
  assert.equal(prepared.ok, true, prepared.message);
  LaunchSplitRuleBuildResponseSchema.parse(prepared.build);
  const submitted = await submitSplitRule(s.deps, { token, creator: creator.publicKey.toBase58(), buildId: prepared.build.buildId, signedWireBase64: signed(prepared.build.unsignedWireBase64, creator) });
  assert.equal(submitted.ok, true, submitted.message);
  LaunchSplitRuleSubmitResponseSchema.parse(submitted.submit);
  return { prepared, submitted };
}

test("the store knows the split's collections, and mainnet stays closed until its switch is turned", () => {
  for (const name of ["launchCreatorSplits", "launchCreatorSplitBuilds", "launchCreatorSplitSends", "launchCreatorSplitBought"]) assert.ok(GUARD_COLLECTIONS.includes(name), name);
  assert.equal(creatorSplitOpenFor(DEVNET), true);
  assert.equal(creatorSplitOpenFor(MAINNET, { VERCEL_ENV: "production" }), false, "closed by default on mainnet");
  assert.equal(creatorSplitOpenFor(MAINNET, { VERCEL_ENV: "preview" }, true), false, "only the deployment that writes launches");
  assert.equal(creatorSplitOpenFor(MAINNET, { VERCEL_ENV: "production" }, true), true, "the switch opens it on the deployment that writes launches");
});

test("a rule is the creator's own: written by a memo the creator signs, counted from the fees earned when it was built", async () => {
  const s = await stand();
  const refused = await prepareSplitRule(s.deps, { token, creator: stranger.publicKey.toBase58(), rule: rule({ self: 9_000, holders: 1_000 }) });
  assert.equal(refused.code, "WALLET_MISMATCH");
  const linked = await prepareSplitRule(s.deps, { token, creator: creator.publicKey.toBase58(), rule: rule({ self: 9_000, community: 1_000 }, shareWallet) });
  assert.equal(linked.code, "LAUNCH_SHARES_INVALID", "a vault's row is no community");
  const { prepared, submitted } = await writeRule(s);
  const tx = Transaction.from(Buffer.from(prepared.build.unsignedWireBase64, "base64"));
  assert.equal(tx.feePayer.toBase58(), creator.publicKey.toBase58());
  assert.deepEqual(parseSplitRuleMemo(memoOf(tx)).rule, prepared.build.rule, "the memo carries the rule");
  assert.ok(tx.instructions[0].keys.some((key) => key.isSigner && key.pubkey.equals(creator.publicKey)), "the creator signs the memo itself");
  assert.equal(submitted.submit.state, "CONFIRMED");
  const record = await readCreatorSplit(s.store, "devnet", token);
  assert.equal(record.segments.length, 1);
  assert.equal(record.segments[0].fromEarnedRaw, "1000000");
  assert.equal(s.sent.length, 1);
  assert.match(splitOfferLines(record, "uk")[0], /холдерам 20 %/);
  const again = await submitSplitRule(s.deps, { token, creator: creator.publicKey.toBase58(), buildId: prepared.build.buildId, signedWireBase64: signed(prepared.build.unsignedWireBase64, creator) });
  assert.equal(again.code, "LAUNCH_BUILD_USED", "a build is sent once");
});

test("other bytes than the rule built are refused, and a rule in force can only be raised", async () => {
  const s = await stand();
  const prepared = await prepareSplitRule(s.deps, { token, creator: creator.publicKey.toBase58(), rule: rule({ self: 8_000, holders: 2_000 }) });
  const other = new Transaction().add(new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [{ pubkey: creator.publicKey, isSigner: true, isWritable: false }], data: Buffer.from("ryntra:split:1:rule:x") }));
  other.feePayer = creator.publicKey;
  other.recentBlockhash = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
  other.sign(creator);
  const forged = await submitSplitRule(s.deps, { token, creator: creator.publicKey.toBase58(), buildId: prepared.build.buildId, signedWireBase64: other.serialize().toString("base64") });
  assert.equal(forged.code, "LAUNCH_SIGNED_OTHER_BYTES");
  await writeRule(s, rule({ self: 8_000, holders: 2_000 }));
  const lowered = await prepareSplitRule(s.deps, { token, creator: creator.publicKey.toBase58(), rule: rule({ self: 9_000, holders: 1_000 }) });
  assert.equal(lowered.code, "LAUNCH_SHARES_INVALID");
  s.share.set({ earnedRaw: "3000000" });
  await writeRule(s, rule({ self: 6_000, holders: 3_000, depth: 1_000 }));
  const record = await readCreatorSplit(s.store, "devnet", token);
  assert.deepEqual(record.segments.map((segment) => segment.fromEarnedRaw), ["1000000", "3000000"], "the raise counts from the fees earned at its build");
});

test("what the rule owes follows the creator's claims, whichever way the creator claimed", async () => {
  const s = await stand();
  await writeRule(s);
  s.share.set({ earnedRaw: "11000000", claimedRaw: "6000000" });
  const view = await creatorSplitView(s.deps, token);
  LaunchSplitViewSchema.parse(view);
  assert.equal(view.read, "OK");
  assert.equal(view.ledger.subjectRaw, "5000000", "1 USDC earned before the rule is not the rule's");
  assert.deepEqual(view.ledger.due, { self: "2500000", depth: "1000000", community: "500000", holders: "1000000" });
  assert.deepEqual(view.ledger.owed, { depth: "1000000", community: "500000", holders: "1000000" });
  assert.equal(view.lines.en.length, 5);
  const unread = await creatorSplitView({ ...s.deps, share: async () => Promise.reject(new Error("node down")) }, token);
  assert.equal(unread.read, "NOT_READ");
  assert.equal(unread.ledger, null, "a figure not read is null, never zero");
});

test("the payout puts the round's root on chain first, then pays the community and the snapshot's holders — never the creator, the bundle, programs or Ryntra", async () => {
  const s = await stand();
  await writeRule(s);
  s.share.set({ earnedRaw: "21000000", claimedRaw: "21000000" });
  const prepared = await prepareSplitPayout(s.deps, { token, creator: creator.publicKey.toBase58() });
  assert.equal(prepared.ok, true, prepared.message);
  const build = prepared.build;
  LaunchSplitPayoutBuildResponseSchema.parse(build);
  assert.equal(build.community.amountRaw, "2000000");
  assert.deepEqual(new Set(build.rows.map((row) => row.wallet)), new Set(holders), "only the people");
  assert.equal(build.holdersRaw, build.rows.reduce((sum, row) => sum + BigInt(row.amountRaw), 0n).toString());
  assert.ok(BigInt(build.holdersRaw) <= 4_000_000n);
  assert.equal(build.snapshot.excluded.bundle.wallets, 1);
  assert.equal(build.snapshot.excluded.program.wallets, 1);
  assert.equal(build.snapshot.excluded.linked.wallets, 1);
  assert.equal(build.snapshot.excluded.ryntra.wallets, 1);
  assert.deepEqual(build.snapshot.excluded.unbought, { wallets: 1, amountRaw: "9000000" }, "a wallet filled by a transfer is not paid");
  assert.equal(build.root, await splitRoot(build.rows));
  const proof = await splitProof(build.rows, holders[4]);
  assert.ok(await verifySplitProof(build.rows.find((row) => row.wallet === holders[4]), proof, build.root));
  const first = Transaction.from(Buffer.from(build.unsignedWireBase64[0], "base64"));
  assert.equal(memoOf(first), build.memo);
  assert.match(build.memo, new RegExp(`:round:${token}:1:${build.root}:5:`));
  const submitted = await submitSplitPayout(s.deps, { token, creator: creator.publicKey.toBase58(), buildId: build.buildId, signedWireBase64: build.unsignedWireBase64.map((wire) => signed(wire, creator)) });
  assert.equal(submitted.ok, true, submitted.message);
  assert.equal(submitted.submit.state, "PAID");
  LaunchSplitPayoutSubmitResponseSchema.parse(submitted.submit);
  assert.equal(memoOf(s.sent[1]), build.memo, "the root went first after the rule");
  const view = await creatorSplitView(s.deps, token);
  LaunchSplitViewSchema.parse(view);
  assert.equal(view.ledger.done.community, "2000000");
  assert.equal(view.ledger.done.holders, build.holdersRaw);
  assert.equal(view.rounds.length, 1);
  const next = await prepareSplitPayout(s.deps, { token, creator: creator.publicKey.toBase58() });
  assert.equal(next.code, "LAUNCH_NOTHING_TO_CLAIM", "paid is not paid again");
});

test("holders are never paid on a read in part, and two payouts of the same owed money cannot both go", async () => {
  const s = await stand();
  await writeRule(s, rule({ self: 8_000, holders: 2_000 }));
  s.share.set({ earnedRaw: "101000000", claimedRaw: "101000000" });
  const partial = await prepareSplitPayout({ ...s.deps, market: async () => marketFacts({ mintAccounts: null }) }, { token, creator: creator.publicKey.toBase58() });
  assert.equal(partial.code, "UNAVAILABLE");
  const historyPartial = await prepareSplitPayout({ ...s.deps, history: async () => ({ bought: new Map(), creatorPaid: new Set(), complete: false }) }, { token, creator: creator.publicKey.toBase58() });
  assert.equal(historyPartial.code, "UNAVAILABLE", "who bought what is known only from the whole history");
  const bundlePartial = await prepareSplitPayout({ ...s.deps, market: async () => marketFacts({ response: { holders: { groups: { bundle: { shareBps: 1, wallets: 1, atLeast: true } } } } }) }, { token, creator: creator.publicKey.toBase58() });
  assert.equal(bundlePartial.code, "UNAVAILABLE", "a bundle known only in part is no snapshot");
  const a = await prepareSplitPayout(s.deps, { token, creator: creator.publicKey.toBase58() });
  const b = await prepareSplitPayout(s.deps, { token, creator: creator.publicKey.toBase58() });
  const first = await submitSplitPayout(s.deps, { token, creator: creator.publicKey.toBase58(), buildId: a.build.buildId, signedWireBase64: a.build.unsignedWireBase64.map((wire) => signed(wire, creator)) });
  assert.equal(first.submit.state, "PAID");
  const second = await submitSplitPayout(s.deps, { token, creator: creator.publicKey.toBase58(), buildId: b.build.buildId, signedWireBase64: b.build.unsignedWireBase64.map((wire) => signed(wire, creator)) });
  assert.equal(second.code, "LAUNCH_BUILD_USED", "the second build is refused before it leaves");
});

/** A venue that answers what the creator's steps ask, and builds DLMM-shaped transactions without a network. */
function fakeVenue({ pool = true, holdsToken = "0" } = {}) {
  const made = [];
  let exists = pool;
  const ix = (signers) => new TransactionInstruction({ programId: new PublicKey(DLMM_PROGRAM), keys: signers.map((pubkey) => ({ pubkey, isSigner: true, isWritable: true })), data: Buffer.from([7]) });
  return {
    made,
    async pool() {
      if (!exists) return null;
      return { pool: FAKE_POOL, tokenIsX: true, binStep: 100, activeBinId: 500, decimalsX: 6, decimalsY: 6, creator: OWN, baseFeeBps: 100, collectsFeeInY: true, enabled: true, creatorCanSwitchOff: false, alphaVault: false, activationAt: T0 - 60 };
    },
    async createPool({ payer }) {
      made.push("createPool");
      exists = true;
      return new Transaction().add(ix([new PublicKey(payer)]));
    },
    async openSteps({ owner, ladder, amountRaw }) {
      made.push(["openSteps", ladder, String(amountRaw)]);
      const position = Keypair.generate();
      return { transactions: [new Transaction().add(ix([new PublicKey(owner), position.publicKey]))], position };
    },
    async placeSteps({ owner, position, ladder, amountRaw }) {
      made.push(["placeSteps", position, ladder, String(amountRaw)]);
      return new Transaction().add(ix([new PublicKey(owner)]));
    },
    async syncSteps() {
      return null;
    },
    async readSteps(poolAddress, position) {
      return { position, lowerBinId: 470, upperBinId: 494, pairRaw: "1000000", tokenRaw: holdsToken, feePairRaw: "0" };
    },
  };
}

test("depth waits for the DEX, then the creator's steps stand below the lower price; a second time the same position moves", async () => {
  const venue = fakeVenue();
  const s = await stand({ deps: { venue, price: async () => ({ price: (1.01 ** 520) , tokenDecimals: 6, pairDecimals: 6 }) } });
  await writeRule(s);
  s.share.set({ earnedRaw: "11000000", claimedRaw: "11000000" });
  const early = await prepareSplitDepth(s.deps, { token, creator: creator.publicKey.toBase58() });
  assert.equal(early.code, "LAUNCH_NOT_GRADUATED");
  s.share.set({ migrated: true, dammPool: Keypair.generate().publicKey.toBase58() });
  const prepared = await prepareSplitDepth(s.deps, { token, creator: creator.publicKey.toBase58() });
  assert.equal(prepared.ok, true, prepared.message);
  assert.equal(prepared.build.phase, "STEPS");
  LaunchSplitDepthBuildResponseSchema.parse(prepared.build);
  assert.equal(prepared.build.amountRaw, "2000000", "a fifth of the 10 USDC claimed under the rule");
  assert.equal(prepared.build.ladder.upperBinId, 496, "under the pool's own bin 500, the lower of the two");
  assert.ok(prepared.build.position);
  const tx = Transaction.from(Buffer.from(prepared.build.unsignedWireBase64, "base64"));
  assert.equal(tx.signatures.find((entry) => entry.publicKey.toBase58() === prepared.build.position).signature, null, "the position's key is not in the bytes the wallet sees");
  const submitted = await submitSplitDepth(s.deps, { token, creator: creator.publicKey.toBase58(), buildId: prepared.build.buildId, signedWireBase64: signed(prepared.build.unsignedWireBase64, creator) });
  assert.equal(submitted.ok, true, submitted.message);
  assert.equal(submitted.submit.state, "CONFIRMED");
  LaunchSplitDepthSubmitResponseSchema.parse(submitted.submit);
  assert.ok(s.sent.at(-1).verifySignatures(true), "the position signed after the creator");
  s.share.set({ earnedRaw: "21000000", claimedRaw: "21000000" });
  const again = await prepareSplitDepth(s.deps, { token, creator: creator.publicKey.toBase58() });
  assert.equal(again.ok, true, again.message);
  assert.equal(again.build.position, prepared.build.position, "the steps holding only the pair currency move and grow");
  assert.equal(venue.made.at(-1)[0], "placeSteps");
  const view = await creatorSplitView(s.deps, token);
  assert.equal(view.ledger.done.depth, "2000000");
  assert.equal(view.depth.steps.length, 1);
  assert.equal(view.depth.steps[0].pairRaw, "1000000");
});

test("with no DLMM pool the creator's first act makes it, and a pool someone can switch off is refused", async () => {
  const s = await stand({ deps: { venue: fakeVenue({ pool: false }), price: async () => ({ price: 0.5, tokenDecimals: 6, pairDecimals: 6 }) } });
  await writeRule(s);
  s.share.set({ earnedRaw: "11000000", claimedRaw: "11000000", migrated: true, dammPool: Keypair.generate().publicKey.toBase58() });
  const prepared = await prepareSplitDepth(s.deps, { token, creator: creator.publicKey.toBase58() });
  assert.equal(prepared.ok, true, prepared.message);
  assert.equal(prepared.build.phase, "POOL");
  assert.equal(prepared.build.amountRaw, "0");
  const switchable = { pool: "P", tokenIsX: true, binStep: 100, activeBinId: 1, decimalsX: 6, decimalsY: 6, creator: "x", baseFeeBps: 100, collectsFeeInY: true, enabled: true, creatorCanSwitchOff: true, alphaVault: false, activationAt: 0 };
  assert.equal(depthPoolAccepted(switchable, T0), false);
  assert.equal(depthPoolAccepted({ ...switchable, creatorCanSwitchOff: false }, T0), true);
  const foreign = new Transaction().add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: stranger.publicKey, lamports: 1 }), new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) }));
  foreign.feePayer = creator.publicKey;
  assert.equal(depthProblems(foreign, creator.publicKey.toBase58(), "STEPS").length, 2, "a SOL transfer to a stranger and a program beyond the act's");
});

test("nothing is written for a stranger's token, and the split's record is keyed by cluster and token", async () => {
  const s = await stand();
  const empty = await creatorSplitView(s.deps, token);
  LaunchSplitViewSchema.parse(empty);
  assert.equal(empty.rule, null, "a launch with no rule yet: the empty split, for the creator to write one");
  assert.equal(empty.open, true);
  assert.equal(await creatorSplitView(s.deps, Keypair.generate().publicKey.toBase58()), null, "no launch, no split");
  await writeRule(s);
  assert.ok(await s.store.versioned(LAUNCH_CREATOR_SPLITS).get(`devnet:${token}`));
  const stranger_token = Keypair.generate().publicKey.toBase58();
  const refused = await prepareSplitPayout(s.deps, { token: stranger_token, creator: creator.publicKey.toBase58() });
  assert.equal(refused.code, "LAUNCH_NOT_FOUND");
  assert.equal(getAssociatedTokenAddressSync(new PublicKey(pairMint), creator.publicKey).toBase58().length > 30, true);
});

test("what the rules owe never falls: a role moved away keeps the count where it was and says so", async () => {
  const s = await stand();
  await writeRule(s, rule({ self: 8_000, holders: 2_000 }));
  s.share.set({ earnedRaw: "11000000", claimedRaw: "11000000" });
  assert.equal((await creatorSplitView(s.deps, token)).ledger.due.holders, "2000000");
  /* The creator hands the curve's role to another wallet: their own counters read nothing from now on. */
  s.share.set({ earnedRaw: "0", claimedRaw: "0", roleOwner: stranger.publicKey.toBase58() });
  const moved = await creatorSplitView(s.deps, token);
  assert.equal(moved.ledger.due.holders, "2000000", "the obligation buyers saw stays");
  assert.deepEqual(moved.ledger.warnings, ["ROLE_MOVED"]);
  s.share.set({ roleOwner: creator.publicKey.toBase58(), migrated: true, lpHeld: false });
  assert.deepEqual((await creatorSplitView(s.deps, token)).ledger.warnings, ["LP_MOVED"]);
});

test("a community wallet of Ryntra's runtime is refused, and nothing is signed or sent once the network is closed", async () => {
  const s = await stand();
  const ryntra = await prepareSplitRule(s.deps, { token, creator: creator.publicKey.toBase58(), rule: rule({ self: 9_000, community: 1_000 }, OWN) });
  assert.equal(ryntra.code, "LAUNCH_SHARES_INVALID");
  const unread = await prepareSplitRule({ ...s.deps, ownWallets: async () => ({ wallets: new Set(), complete: false }) }, { token, creator: creator.publicKey.toBase58(), rule: rule({ self: 9_000, community: 1_000 }, community) });
  assert.equal(unread.code, "UNAVAILABLE", "Ryntra's wallets read in part: no community wallet is taken on a guess");
  const prepared = await prepareSplitRule(s.deps, { token, creator: creator.publicKey.toBase58(), rule: rule({ self: 9_000, holders: 1_000 }) });
  const closed = await submitSplitRule({ ...s.deps, network: { ...DEVNET, cluster: "mainnet", chain: "solana:mainnet" } }, { token, creator: creator.publicKey.toBase58(), buildId: prepared.build.buildId, signedWireBase64: signed(prepared.build.unsignedWireBase64, creator) });
  assert.equal(closed.code, "CAPABILITY_UNAVAILABLE");
  assert.equal(s.sent.length, 0);
});

test("no transfer leaves before the root is seen on chain; what was not sent stays reserved until its bytes die", async () => {
  const s = await stand();
  await writeRule(s, rule({ self: 8_000, holders: 2_000 }));
  s.share.set({ earnedRaw: "101000000", claimedRaw: "101000000" });
  const built = await prepareSplitPayout(s.deps, { token, creator: creator.publicKey.toBase58() });
  /* The root's send gets no answer: the node takes it and never confirms in the route's time. */
  const silent = { ...s.deps.connection, confirmTransaction: async () => Promise.reject(new Error("The node did not answer in time.")), getSignatureStatuses: async () => ({ value: [null] }), getBlockHeight: async () => 900, getEpochInfo: async () => ({ blockHeight: 900, absoluteSlot: 1_000 }) };
  let clock = T0 * 1000;
  const sent = await submitSplitPayout({ ...s.deps, connection: silent, now: () => new Date((clock += 2_000)) }, { token, creator: creator.publicKey.toBase58(), buildId: built.build.buildId, signedWireBase64: built.build.unsignedWireBase64.map((wire) => signed(wire, creator)) });
  assert.equal(sent.ok, true, sent.message);
  assert.equal(memoOf(s.sent.at(-1)), built.build.memo, "only the root went out");
  assert.ok(sent.submit.txs.slice(1).every((tx) => tx.state !== "CONFIRMED"));
  const record = await readCreatorSplit(s.store, "devnet", token);
  assert.ok(record.rounds[0].txs.every((tx) => tx.state === "PENDING"), "nothing is freed before the chain says so");
  const again = await prepareSplitPayout({ ...s.deps, connection: silent }, { token, creator: creator.publicKey.toBase58() });
  assert.equal(again.code, "LAUNCH_BUILD_USED", "a next payout waits for the chain's word on this one");
});

test("a DLMM pool whose price lags the market is first brought up to it, then the steps go under the market", async () => {
  const venue = fakeVenue();
  const s = await stand({ deps: { venue: { ...venue, syncSteps: async ({ owner }) => new Transaction().add(new TransactionInstruction({ programId: new PublicKey(DLMM_PROGRAM), keys: [{ pubkey: new PublicKey(owner), isSigner: true, isWritable: true }], data: Buffer.from([9]) })) }, price: async () => ({ price: 1.01 ** 600, tokenDecimals: 6, pairDecimals: 6 }) } });
  await writeRule(s);
  s.share.set({ earnedRaw: "11000000", claimedRaw: "11000000", migrated: true, lpHeld: true, dammPool: Keypair.generate().publicKey.toBase58() });
  const prepared = await prepareSplitDepth(s.deps, { token, creator: creator.publicKey.toBase58() });
  assert.equal(prepared.ok, true, prepared.message);
  assert.equal(prepared.build.phase, "SYNC", "the pool sits at bin 500, the market at 600");
  assert.equal(prepared.build.amountRaw, "0");
  LaunchSplitDepthBuildResponseSchema.parse(prepared.build);
});

test("a wallet the creator paid a buy for, anywhere in the whole history, is the creator's own; a rule on a moved role is refused", async () => {
  const s = await stand();
  await writeRule(s, rule({ self: 8_000, holders: 2_000 }));
  s.share.set({ earnedRaw: "101000000", claimedRaw: "101000000" });
  const late = holders[4];
  const history = async () => historyOf(holders.map((trader, index) => ({ trader, payer: trader === late ? creator.publicKey.toBase58() : trader, side: "buy", tokensRaw: String((index + 1) * 1_000_000) })));
  const built = await prepareSplitPayout({ ...s.deps, history }, { token, creator: creator.publicKey.toBase58() });
  assert.equal(built.ok, true, built.message);
  assert.ok(!built.build.rows.some((row) => row.wallet === late), "a buy the creator paid for, years after the opening minutes, is still the creator's");
  const moved = await stand();
  moved.share.set({ roleOwner: stranger.publicKey.toBase58() });
  const refused = await prepareSplitRule(moved.deps, { token, creator: creator.publicKey.toBase58(), rule: rule({ self: 9_000, holders: 1_000 }) });
  assert.equal(refused.code, "LAUNCH_SHARES_INVALID");
});

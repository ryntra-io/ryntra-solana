import assert from "node:assert/strict";
import test from "node:test";

import { LOCK_PROGRAM_ID, LockClient } from "@meteora-ag/met-lock-sdk";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { DEVNET_BOOST_BOUNDS } from "../core/launch/boost.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import {
  BOOST_BOUNDS_ENV,
  TX_MAX_BYTES,
  boostBounds,
  boostView,
  escrowProblems,
  payoutProblems,
  prepareBoost,
  prepareBoostPayout,
  readBoostCampaign,
  settledBoostCampaign,
  submitBoost,
  submitBoostPayout,
} from "./boost.server.ts";
import { launchNetwork } from "./config.server.ts";

const DEVNET = launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "http://localhost:3020" });
const MAINNET = launchNetwork({});
const ENV = { BETA_TOKEN_SECRET: "a-test-secret-of-enough-length-0123456789" };
const HOUR = 3_600;
const T0 = 1_800_000_000;

const creator = Keypair.generate();
const stranger = Keypair.generate();
const token = Keypair.generate().publicKey.toBase58();
const pairMint = DEVNET.pairs.classic.mint;
const coder = new LockClient(new Connection("http://127.0.0.1:9"), "confirmed").program.coder.instruction;

const mintData = (decimals) => {
  const data = Buffer.alloc(82);
  data[44] = decimals;
  data[45] = 1;
  return data;
};
const tokenAccount = (mint, owner, amount) => {
  const data = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(data, 0);
  new PublicKey(owner).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  return data;
};

/** A node that answers what a build and a send ask: the mints, the creator's balances, a blockhash, a send that lands. */
function fakeConnection({ balance = 10_000_000_000n, sent = [] } = {}) {
  const accounts = new Map([
    [pairMint, { owner: TOKEN_PROGRAM_ID, data: mintData(6) }],
    [token, { owner: TOKEN_2022_PROGRAM_ID, data: mintData(6) }],
    [getAssociatedTokenAddressSync(new PublicKey(pairMint), creator.publicKey, false, TOKEN_PROGRAM_ID).toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(pairMint, creator.publicKey, balance) }],
    [getAssociatedTokenAddressSync(new PublicKey(token), creator.publicKey, false, TOKEN_2022_PROGRAM_ID).toBase58(), { owner: TOKEN_2022_PROGRAM_ID, data: tokenAccount(token, creator.publicKey, balance) }],
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

const shareWallet = Keypair.generate().publicKey.toBase58();
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
  feeSharing: { vault: Keypair.generate().publicKey.toBase58(), shares: [{ address: creator.publicKey.toBase58(), bps: 6_000 }, { address: shareWallet, bps: 4_000 }], signature: "s", state: "SHARED", reason: null },
  buildId: "b",
  referralCode: null,
  launchedAt: new Date(T0 * 1000).toISOString(),
};

async function stand(over = {}) {
  const store = createMemoryGuardStore();
  await store.collection("launches").set(`solana:devnet:${token}`, launchRecord);
  let now = new Date(T0 * 1000);
  const sent = [];
  const deps = {
    network: DEVNET,
    connection: fakeConnection({ sent, ...(over.connection ?? {}) }),
    store,
    now: () => now,
    env: ENV,
    ownWallets: async () => ({ wallets: new Set([OWN]), complete: true }),
    ...over.deps,
  };
  return { deps, store, sent, at: (seconds) => (now = new Date(seconds * 1000)) };
}

const OWN = Keypair.generate().publicKey.toBase58();
const rules = (over = {}) => ({
  currency: "PAIR",
  bonusBps: 200,
  minBuyRaw: "50000000",
  capPerWalletRaw: "20000000",
  budgetRaw: "1000000000",
  startsAt: T0,
  endsAt: T0 + 3 * HOUR,
  holdHours: 1,
  routes: "any",
  ...over,
});

const sign = (wire, ...keys) => {
  const tx = Transaction.from(Buffer.from(wire, "base64"));
  tx.partialSign(...keys);
  return tx.serialize({ requireAllSignatures: false }).toString("base64");
};

/** The escrow as the chain would store the commitment built from `rules()`; `over` makes it another. */
const escrowAs = (over = {}) => async (address) => ({ escrow: address, mint: pairMint, creator: creator.publicKey.toBase58(), recipient: creator.publicKey.toBase58(), totalRaw: "1000000000", claimedRaw: "0", heldRaw: "1000000000", cliffAt: T0 + 4 * HOUR, cancelMode: 0, updateRecipientMode: 0, ...over });

const escrowIx = (wire) => Transaction.from(Buffer.from(wire, "base64")).instructions.find((ix) => ix.programId.equals(LOCK_PROGRAM_ID));

test("the bounds: the stand's own on devnet;", () => {
  assert.equal(boostBounds(DEVNET, {}), DEVNET_BOOST_BOUNDS);
  assert.equal(boostBounds(MAINNET, {}), null, "no bounds variable: no campaign on mainnet");
  const owner = JSON.stringify({ ...DEVNET_BOOST_BOUNDS, currencies: ["PAIR"], routes: ["ryntra"], minHoldHours: 12 });
  assert.equal(boostBounds(MAINNET, { [BOOST_BOUNDS_ENV]: owner }), null, "a preview or a local server opens nothing on mainnet");
  const bounds = boostBounds(MAINNET, { [BOOST_BOUNDS_ENV]: owner, VERCEL_ENV: "production" });
  assert.deepEqual(bounds?.currencies, ["PAIR"]);
  assert.equal(bounds?.minHoldHours, 12);
  assert.equal(boostBounds(MAINNET, { [BOOST_BOUNDS_ENV]: "{not json", VERCEL_ENV: "production" }), null);
  assert.equal(boostBounds(MAINNET, { [BOOST_BOUNDS_ENV]: JSON.stringify({ ...DEVNET_BOOST_BOUNDS, maxBonusBps: 20_000 }), VERCEL_ENV: "production" }), null, "bounds that do not hold are no bounds");
});

test("a campaign is refused before anything is built: mainnet without bounds, a foreign creator, rules out of bounds, a token not launched here, a low balance", async () => {
  const { deps } = await stand();
  const input = { token, creator: creator.publicKey.toBase58(), rules: rules() };
  assert.equal((await prepareBoost({ ...deps, network: MAINNET }, input)).code, "CAPABILITY_UNAVAILABLE");
  assert.equal((await prepareBoost(deps, { ...input, creator: stranger.publicKey.toBase58() })).code, "WALLET_MISMATCH");
  const out = await prepareBoost(deps, { ...input, rules: rules({ bonusBps: 9_000 }) });
  assert.equal(out.code, "VALIDATION_ERROR");
  assert.equal(out.issues[0].path, "rules.BONUS_OUT_OF_BOUNDS");
  assert.equal((await prepareBoost(deps, { ...input, token: Keypair.generate().publicKey.toBase58() })).code, "LAUNCH_NOT_FOUND");
  const poor = await stand({ connection: { balance: 5n } });
  assert.equal((await prepareBoost(poor.deps, input)).code, "LAUNCH_BALANCE_LOW");
  assert.equal((await prepareBoost({ ...deps, env: {} }, input)).code, "LAUNCH_PAUSED", "without the server's key the escrow's base cannot wait sealed");
});

test("the commitment: the whole budget into Met Lock from the creator to the creator, nobody may cancel or redirect it, unlocking at the end and the hold", async () => {
  const { deps, store, sent } = await stand({ deps: { observe: escrowAs() } });
  const built = await prepareBoost(deps, { token, creator: creator.publicKey.toBase58(), rules: rules() });
  assert.equal(built.ok, true, built.message);
  const tx = Transaction.from(Buffer.from(built.build.unsignedWireBase64, "base64"));
  assert.ok(tx.feePayer.equals(creator.publicKey), "the creator pays");
  assert.ok(tx.signatures.every((entry) => !entry.signature || entry.signature.every((byte) => byte === 0)), "the bytes the wallet sees carry no signature yet");
  const ix = escrowIx(built.build.unsignedWireBase64);
  const decoded = coder.decode(Buffer.from(ix.data));
  assert.equal(decoded.name, "createVestingEscrowV2");
  const params = decoded.data.params;
  assert.equal(params.cancelMode, 0, "nobody may cancel");
  assert.equal(params.updateRecipientMode, 0, "nobody may change the recipient");
  assert.equal(params.cliffUnlockAmount.toString(), "1000000000", "the whole budget");
  assert.equal(params.numberOfPeriod.toString(), "0", "nothing unlocks before the cliff");
  assert.equal(Number(params.cliffTime.toString()), T0 + 4 * HOUR, "the cliff is the end and the hold");
  assert.equal(built.build.unlocksAt, T0 + 4 * HOUR);
  /* createVestingEscrowV2: base, escrow, tokenMint, escrowToken, sender, senderToken, recipient, tokenProgram, … */
  assert.equal(ix.keys[4].pubkey.toBase58(), creator.publicKey.toBase58(), "the creator sends");
  assert.equal(ix.keys[6].pubkey.toBase58(), creator.publicKey.toBase58(), "and receives");
  assert.equal(ix.keys[2].pubkey.toBase58(), pairMint, "USDC for a bonus in the pair currency");
  assert.ok(ix.keys[7].pubkey.equals(TOKEN_PROGRAM_ID), "USDC lives under SPL Token");
  assert.equal(built.build.escrow, ix.keys[1].pubkey.toBase58());
  assert.match(built.build.lines.uk[0], /Ryntra бере 0/);

  const submitWith = (signedWireBase64) => submitBoost(deps, { token, buildId: built.build.buildId, creator: creator.publicKey.toBase58(), signedWireBase64 });
  assert.equal((await submitWith(built.build.unsignedWireBase64)).code, "LAUNCH_SIGNED_OTHER_BYTES", "unsigned by the creator");
  /* The same bytes with the escrow made cancellable (its `cancelMode` byte), signed by the creator: not the build. */
  const cancellable = Transaction.from(Buffer.from(built.build.unsignedWireBase64, "base64"));
  const changed = cancellable.instructions.find((entry) => entry.programId.equals(LOCK_PROGRAM_ID));
  changed.data = Buffer.from(changed.data);
  changed.data[57] = 1;
  assert.equal(coder.decode(changed.data).data.params.cancelMode, 1);
  cancellable.partialSign(creator);
  assert.equal((await submitWith(cancellable.serialize({ requireAllSignatures: false }).toString("base64"))).code, "LAUNCH_SIGNED_OTHER_BYTES");
  const submitted = await submitBoost(deps, { token, buildId: built.build.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: sign(built.build.unsignedWireBase64, creator) });
  assert.equal(submitted.ok, true, submitted.message);
  assert.equal(submitted.submit.state, "LOCKED");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].verifySignatures(true), "the escrow's base signed after the creator, over the same message");
  const campaign = await readBoostCampaign(store, "devnet", token);
  assert.equal(campaign.commitment.state, "LOCKED");
  assert.equal(campaign.countsFrom, T0);
  assert.equal((await submitBoost(deps, { token, buildId: built.build.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: sign(built.build.unsignedWireBase64, creator) })).code, "LAUNCH_BUILD_USED");
  assert.equal((await prepareBoost(deps, { token, creator: creator.publicKey.toBase58(), rules: rules() })).code, "LAUNCH_BUILD_USED", "one campaign per token");
});

test("a bonus in the token locks the token under Token-2022", async () => {
  const { deps } = await stand();
  const built = await prepareBoost(deps, { token, creator: creator.publicKey.toBase58(), rules: rules({ currency: "TOKEN", capPerWalletRaw: "1000000", budgetRaw: "100000000" }) });
  assert.equal(built.ok, true, built.message);
  const ix = escrowIx(built.build.unsignedWireBase64);
  assert.equal(ix.keys[2].pubkey.toBase58(), token);
  assert.ok(ix.keys[7].pubkey.equals(TOKEN_2022_PROGRAM_ID));
  assert.equal(built.build.currency.symbol, "OWL");
});

/* ------------------------------------------------------------ the payout */

let slot = 1;
const buy = (trader, pairRaw, at) => ({ signature: `buy${slot}`.padEnd(64, "1").slice(0, 64).replace(/[0OIl]/g, "1"), slot: slot++, at, side: "buy", venue: "curve", trader, payer: trader, account: null, tokensRaw: String(BigInt(pairRaw) * 10n), pairRaw: String(pairRaw), feeRaw: "0", priceAfter: 1 });
const sell = (trader, at) => ({ ...buy(trader, 1, at), side: "sell" });

async function lockedCampaign(trades, { complete = true, held = "1000000000", over = {} } = {}) {
  const escrow = { held };
  const s = await stand({
    deps: {
      trades: async () => ({ trades, complete }),
      observe: async (address) => ({ escrow: address, mint: pairMint, creator: creator.publicKey.toBase58(), recipient: creator.publicKey.toBase58(), totalRaw: "1000000000", claimedRaw: "0", heldRaw: escrow.held, cliffAt: T0 + 4 * HOUR, cancelMode: 0, updateRecipientMode: 0 }),
      ...over,
    },
  });
  const built = await prepareBoost(s.deps, { token, creator: creator.publicKey.toBase58(), rules: rules(over.rules) });
  assert.equal(built.ok, true, built.message);
  const submitted = await submitBoost(s.deps, { token, buildId: built.build.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: sign(built.build.unsignedWireBase64, creator) });
  assert.equal(submitted.submit.state, "LOCKED");
  return { ...s, escrow, built: built.build };
}

const buyers = Array.from({ length: 30 }, () => Keypair.generate().publicKey.toBase58());

test("the payout: claimed back to the creator, then only eligible wallets, the plan's total, nothing to Ryntra — in transactions that fit", async () => {
  const early = buyers[1];
  const trades = [
    ...buyers.map((wallet, index) => buy(wallet, 100_000_000 + index, T0 + 60 + index)),
    buy(DEVNET.feeWallet, 900_000_000, T0 + 100),
    buy(OWN, 900_000_000, T0 + 101),
    buy(shareWallet, 900_000_000, T0 + 102),
    buy(creator.publicKey.toBase58(), 900_000_000, T0 + 103),
    sell(early, T0 + 1_000),
  ];
  const { deps, at, sent, store } = await lockedCampaign(trades);
  at(T0 + 4 * HOUR - 1);
  assert.equal((await prepareBoostPayout(deps, { token, creator: creator.publicKey.toBase58() })).code, "LAUNCH_NOTHING_TO_CLAIM", "the hold is not over");
  at(T0 + 4 * HOUR);
  assert.equal((await prepareBoostPayout(deps, { token, creator: stranger.publicKey.toBase58() })).code, "WALLET_MISMATCH");
  const built = await prepareBoostPayout(deps, { token, creator: creator.publicKey.toBase58() });
  assert.equal(built.ok, true, built.message);
  const plan = built.build;
  const eligible = buyers.filter((wallet) => wallet !== early);
  assert.deepEqual(plan.rows.map((row) => row.wallet), eligible, "in the order of their first purchase, the early seller out");
  assert.equal(plan.remaining, 0);
  assert.equal(plan.claimsEscrow, true);
  const expected = eligible.reduce((sum, wallet) => sum + (BigInt(100_000_000 + buyers.indexOf(wallet)) * 200n) / 10_000n, 0n);
  assert.equal(plan.totalRaw, expected.toString());
  const txs = plan.unsignedWireBase64.map((wire) => Transaction.from(Buffer.from(wire, "base64")));
  assert.ok(txs.length >= 3, `29 wallets take several transactions (${txs.length})`);
  for (const wire of plan.unsignedWireBase64) assert.ok(Buffer.from(wire, "base64").length <= TX_MAX_BYTES, "each transaction fits");
  const perTx = txs.map((tx) => tx.instructions.filter((ix) => ix.programId.equals(TOKEN_PROGRAM_ID)).length);
  assert.ok(perTx.slice(1, -1).every((count) => count >= 8), `as many as fit: ${perTx.join(", ")}`);
  const claim = txs[0].instructions.find((ix) => ix.programId.equals(LOCK_PROGRAM_ID));
  assert.equal(coder.decode(Buffer.from(claim.data)).name, "claimV2", "the escrow comes back to the creator first");
  assert.equal(txs.slice(1).some((tx) => tx.instructions.some((ix) => ix.programId.equals(LOCK_PROGRAM_ID))), false);
  /* Every transfer: from the creator's account, to an eligible wallet's own, the plan's amount; the sum is the plan. */
  const source = getAssociatedTokenAddressSync(new PublicKey(pairMint), creator.publicKey, false, TOKEN_PROGRAM_ID).toBase58();
  const ataOf = (wallet) => getAssociatedTokenAddressSync(new PublicKey(pairMint), new PublicKey(wallet), true, TOKEN_PROGRAM_ID).toBase58();
  const ryntra = [DEVNET.feeWallet, DEVNET.referralOwner, OWN].map(ataOf);
  let total = 0n;
  let transfers = 0;
  for (const tx of txs) {
    assert.ok(tx.feePayer.equals(creator.publicKey));
    for (const ix of tx.instructions) {
      if (!ix.programId.equals(TOKEN_PROGRAM_ID)) continue;
      transfers += 1;
      assert.equal(ix.keys[0].pubkey.toBase58(), source);
      const to = ix.keys[2].pubkey.toBase58();
      assert.ok(eligible.map(ataOf).includes(to), "only an eligible wallet's account");
      assert.ok(!ryntra.includes(to), "nothing to a wallet of Ryntra's");
      total += Buffer.from(ix.data).readBigUInt64LE(1);
    }
  }
  assert.equal(transfers, eligible.length);
  assert.equal(total.toString(), plan.totalRaw);
  const own = new Set([DEVNET.feeWallet, OWN]);
  const planned = { creator: creator.publicKey.toBase58(), mint: pairMint, program: TOKEN_PROGRAM_ID.toBase58(), rows: plan.rows, ryntra: own };
  assert.deepEqual(payoutProblems(txs, planned), []);
  /* A transfer slipped in to Ryntra's fee wallet is caught before anything leaves. */
  const tampered = Transaction.from(Buffer.from(plan.unsignedWireBase64[1], "base64"));
  tampered.add(createTransferCheckedInstruction(new PublicKey(source), new PublicKey(pairMint), new PublicKey(ataOf(DEVNET.feeWallet)), creator.publicKey, 1n, 6, [], TOKEN_PROGRAM_ID));
  assert.ok(payoutProblems([txs[0], tampered, ...txs.slice(2)], planned).some((line) => line.includes("outside the plan")));
  assert.ok(payoutProblems(txs, { ...planned, rows: [...plan.rows, { wallet: OWN, bonusRaw: "1" }] }).some((line) => line.includes("Ryntra")));

  /* Signed in one window, sent in order: PAID; the same build again is refused, and nothing is left to pay. */
  const before = sent.length;
  const submitted = await submitBoostPayout(deps, { token, buildId: plan.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: plan.unsignedWireBase64.map((wire) => sign(wire, creator)) });
  assert.equal(submitted.ok, true, submitted.message);
  assert.equal(submitted.submit.state, "PAID");
  assert.equal(submitted.submit.paidRaw, plan.totalRaw);
  assert.equal(sent.length - before, txs.length);
  assert.equal((await submitBoostPayout(deps, { token, buildId: plan.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: plan.unsignedWireBase64.map((wire) => sign(wire, creator)) })).code, "LAUNCH_BUILD_USED");
  const campaign = await readBoostCampaign(store, "devnet", token);
  assert.equal(campaign.payouts.every((tx) => tx.state === "CONFIRMED"), true);
  assert.equal(campaign.payouts.flatMap((tx) => tx.wallets).length, eligible.length);
});

test("the payout is not built on a history read in part, nor through Ryntra without its records", async () => {
  const trades = [buy(buyers[0], 100_000_000, T0 + 60)];
  const partial = await lockedCampaign(trades, { complete: false });
  partial.at(T0 + 4 * HOUR);
  assert.equal((await prepareBoostPayout(partial.deps, { token, creator: creator.publicKey.toBase58() })).code, "UNAVAILABLE");
  const noOwn = await lockedCampaign(trades, { over: { ownWallets: async () => ({ wallets: new Set(), complete: false }) } });
  noOwn.at(T0 + 4 * HOUR);
  assert.equal((await prepareBoostPayout(noOwn.deps, { token, creator: creator.publicKey.toBase58() })).code, "UNAVAILABLE", "Ryntra's own wallets read in part: not counted");
  /* Through Ryntra: a purchase counts only where Ryntra's trade route recorded it. */
  const other = buy(buyers[1], 100_000_000, T0 + 61);
  const routed = await lockedCampaign([...trades, other], { over: { rules: { routes: "ryntra" } } });
  await routed.store.collection("launchTradeRecords").set(`devnet:${other.signature}`, { side: "buy", state: "DONE", wallet: buyers[1] });
  routed.at(T0 + 4 * HOUR);
  const built = await prepareBoostPayout(routed.deps, { token, creator: creator.publicKey.toBase58() });
  assert.equal(built.ok, true, built.message);
  assert.deepEqual(built.build.rows.map((row) => row.wallet), [buyers[1]]);
});

test("a wallet is paid once: two builds of the same wallets, both signed — the second is refused before anything of it leaves, sent one after the other or at once", async () => {
  for (const together of [false, true]) {
    const trades = buyers.slice(0, 14).map((wallet, index) => buy(wallet, 100_000_000 + index, T0 + 60 + index));
    const { deps, at, sent, store, escrow } = await lockedCampaign(trades);
    at(T0 + 4 * HOUR);
    const who = { token, creator: creator.publicKey.toBase58() };
    const first = await prepareBoostPayout(deps, who);
    const second = await prepareBoostPayout(deps, who);
    assert.equal(first.ok, true, first.message);
    assert.equal(second.ok, true, second.message);
    assert.deepEqual(second.build.rows.map((row) => row.wallet), first.build.rows.map((row) => row.wallet), "the same wallets in both builds");
    const signed = (plan) => ({ ...who, buildId: plan.buildId, signedWireBase64: plan.unsignedWireBase64.map((wire) => sign(wire, creator)) });
    const before = sent.length;
    const answers = together
      ? await Promise.all([submitBoostPayout(deps, signed(first.build)), submitBoostPayout(deps, signed(second.build))])
      : [await submitBoostPayout(deps, signed(first.build)), await submitBoostPayout(deps, signed(second.build))];
    const taken = answers.filter((answer) => answer.ok);
    assert.equal(taken.length, 1, `one build pays (${together ? "at once" : "one after the other"})`);
    assert.equal(taken[0].submit.state, "PAID");
    assert.equal(answers.find((answer) => !answer.ok).code, "LAUNCH_BUILD_USED");
    assert.equal(sent.length - before, first.build.unsignedWireBase64.length, "only one build's transactions left");
    const campaign = await readBoostCampaign(store, "devnet", token);
    const paid = campaign.payouts.filter((tx) => tx.state !== "FAILED").flatMap((tx) => tx.wallets);
    assert.equal(new Set(paid).size, paid.length, "no wallet twice");
    assert.equal(paid.length, 14);
    escrow.held = "0";
    assert.equal((await prepareBoostPayout(deps, who)).code, "LAUNCH_NOTHING_TO_CLAIM", "every wallet paid, the escrow claimed");
  }
});

test("a payout that may still land holds the next build; once its time ran out unseen, its wallets are planned again", async () => {
  const trades = buyers.slice(0, 3).map((wallet, index) => buy(wallet, 100_000_000 + index, T0 + 60 + index));
  const { deps, at, store } = await lockedCampaign(trades);
  at(T0 + 4 * HOUR);
  let height = 900;
  const quiet = {
    ...deps.connection,
    getLatestBlockhash: async () => ({ blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 5_000 }),
    getEpochInfo: async () => ({ blockHeight: height, absoluteSlot: 2_000 }),
    getSignatureStatuses: async () => ({ context: { slot: 2_000 }, value: [null] }),
  };
  const rows = store.versioned("launchBoosts");
  const key = `devnet:${token}`;
  const current = await rows.get(key);
  const pending = { signature: "5".repeat(88), wallets: [buyers[0]], amountRaw: "2000000", state: "PENDING", reason: null, validUntil: "1000" };
  assert.ok(await rows.compareAndSet(key, current.version, { ...current, version: current.version + 1, payouts: [pending] }));
  const who = { token, creator: creator.publicKey.toBase58() };
  assert.equal((await prepareBoostPayout({ ...deps, connection: quiet }, who)).code, "LAUNCH_BUILD_USED", "a payout on its way: no next build");
  height = 1_031;
  const built = await prepareBoostPayout({ ...deps, connection: quiet }, who);
  assert.equal(built.ok, true, built.message);
  assert.ok(built.build.rows.some((row) => row.wallet === buyers[0]), "its wallet is planned again once it can no longer land");
  assert.equal((await readBoostCampaign(store, "devnet", token)).payouts[0].state, "FAILED");
});

test("the budget is locked only as built, a token opens one campaign at a time, and purchases count from the moment it was first seen locked", async () => {
  const input = { token, creator: creator.publicKey.toBase58(), rules: rules() };
  const commit = async (deps) => {
    const built = await prepareBoost(deps, input);
    assert.equal(built.ok, true, built.message);
    return submitBoost(deps, { token, buildId: built.build.buildId, creator: input.creator, signedWireBase64: sign(built.build.unsignedWireBase64, creator) });
  };
  for (const [over, said] of [
    [{ cancelMode: 1 }, /cancel/],
    [{ updateRecipientMode: 1 }, /recipient/],
    [{ mint: token }, /another token/],
    [{ recipient: stranger.publicKey.toBase58() }, /someone other than the creator/],
    [{ totalRaw: "1" }, /another amount/],
    [{ cliffAt: T0 + HOUR }, /another time/],
  ]) {
    const { deps, store } = await stand({ deps: { observe: escrowAs(over) } });
    const submitted = await commit(deps);
    assert.equal(submitted.submit.state, "FAILED", JSON.stringify(over));
    assert.match(submitted.submit.reason, said);
    assert.equal((await readBoostCampaign(store, "devnet", token)).commitment.state, "FAILED");
  }
  /* Two commitments for one token sent at once: one opens the campaign, the other is refused before it leaves. */
  const twice = await stand({ deps: { observe: escrowAs() } });
  const a = await prepareBoost(twice.deps, input);
  const b = await prepareBoost(twice.deps, input);
  const answers = await Promise.all([a, b].map((built) => submitBoost(twice.deps, { token, buildId: built.build.buildId, creator: input.creator, signedWireBase64: sign(built.build.unsignedWireBase64, creator) })));
  assert.equal(answers.filter((answer) => answer.ok).length, 1);
  assert.equal(answers.find((answer) => !answer.ok).code, "LAUNCH_BUILD_USED");
  assert.equal(twice.sent.length, 1);
  /* Landed but not yet seen: PENDING, no rule said; seen ten minutes later, purchases count from then. */
  let seen = false;
  const late = await stand({ deps: { observe: async (address) => (seen ? escrowAs()(address) : null) } });
  assert.equal((await commit(late.deps)).submit.state, "PENDING");
  late.at(T0 + 600);
  seen = true;
  const view = await boostView({ ...late.deps, trades: async () => ({ trades: [], complete: true }) }, token);
  assert.equal(view.state, "LOCKED");
  assert.equal(view.countsFrom, T0 + 600);
  assert.equal((await readBoostCampaign(late.store, "devnet", token)).countsFrom, T0 + 600);
});

test("never past the budget across builds; a record without a version is refused, never written", async () => {
  const trades = buyers.slice(0, 3).map((wallet, index) => buy(wallet, 100_000_000 + index, T0 + 60 + index));
  const { deps, at, store, sent } = await lockedCampaign(trades);
  at(T0 + 4 * HOUR);
  const who = { token, creator: creator.publicKey.toBase58() };
  const built = await prepareBoostPayout(deps, who);
  assert.equal(built.ok, true, built.message);
  /* Meanwhile another payout took all but 1 USDC of the 1 000 budget: this build would go past it — refused, nothing sent. */
  const rows = store.versioned("launchBoosts");
  const key = `devnet:${token}`;
  const current = await rows.get(key);
  const elsewhere = { signature: "6".repeat(88), wallets: [Keypair.generate().publicKey.toBase58()], amountRaw: "999000000", state: "CONFIRMED", reason: null, validUntil: "1000" };
  assert.ok(await rows.compareAndSet(key, current.version, { ...current, version: current.version + 1, payouts: [elsewhere] }));
  const before = sent.length;
  const refused = await submitBoostPayout(deps, { ...who, buildId: built.build.buildId, signedWireBase64: built.build.unsignedWireBase64.map((wire) => sign(wire, creator)) });
  assert.equal(refused.code, "LAUNCH_BUILD_USED");
  assert.match(refused.message, /budget/);
  assert.equal(sent.length, before);
  /* A new build plans only what the budget left still pays: each wallet's 2 USDC no longer fits 1 USDC. */
  const capped = await prepareBoostPayout(deps, who);
  assert.equal(capped.ok, true, capped.message);
  assert.deepEqual(capped.build.rows, []);
  /* A row stored without a version: no compare-and-set moves it, and nothing is written as NaN. */
  const { version: _version, ...unversioned } = await rows.get(key);
  await store.collection("launchBoosts").set(key, { ...unversioned, payouts: [] });
  const again = await prepareBoostPayout(deps, who);
  assert.equal(again.ok, true, again.message);
  const stale = await submitBoostPayout(deps, { ...who, buildId: again.build.buildId, signedWireBase64: again.build.unsignedWireBase64.map((wire) => sign(wire, creator)) });
  assert.equal(stale.code, "LAUNCH_BUILD_USED");
  assert.match(stale.message, /no version/);
  assert.equal((await rows.get(key)).version, undefined);
});

test("the token page settles a campaign without a clock of its own: a commitment that can no longer land is FAILED", async () => {
  const { deps, store } = await stand({ deps: { observe: async () => null } });
  const built = await prepareBoost(deps, { token, creator: creator.publicKey.toBase58(), rules: rules() });
  const submitted = await submitBoost(deps, { token, buildId: built.build.buildId, creator: creator.publicKey.toBase58(), signedWireBase64: sign(built.build.unsignedWireBase64, creator) });
  assert.equal(submitted.submit.state, "PENDING");
  const gone = {
    ...deps.connection,
    getEpochInfo: async () => ({ blockHeight: 1_031, absoluteSlot: 2_000 }),
    getSignatureStatuses: async () => ({ context: { slot: 2_000 }, value: [null] }),
  };
  const settled = await settledBoostCampaign({ store, connection: gone, second: null }, await readBoostCampaign(store, "devnet", token));
  assert.equal(settled.commitment.state, "FAILED");
  assert.equal((await readBoostCampaign(store, "devnet", token)).commitment.state, "FAILED");
});

test("an amount has one spelling: a budget with a leading zero is refused before anything is built; the escrow's amount is compared as a number", async () => {
  const { LaunchBoostRulesSchema } = await import("../api/v1/contract.ts");
  const spelled = rules({ budgetRaw: "0100000000" });
  assert.equal(LaunchBoostRulesSchema.safeParse(spelled).success, false, "the contract refuses a leading zero");
  assert.equal(LaunchBoostRulesSchema.safeParse(rules()).success, true);
  assert.equal(LaunchBoostRulesSchema.safeParse(rules({ minBuyRaw: "0" })).success, true, "zero is spelled «0»");
  const { deps } = await stand();
  const refused = await prepareBoost(deps, { token, creator: creator.publicKey.toBase58(), rules: spelled });
  assert.equal(refused.code, "VALIDATION_ERROR", "and so does the server, whatever reaches it");
  const campaign = { creator: creator.publicKey.toBase58(), currency: { mint: pairMint }, rules: { budgetRaw: "0100000000" }, unlocksAt: T0 + 4 * HOUR };
  assert.deepEqual(escrowProblems(campaign, await escrowAs({ totalRaw: "100000000" })("x")), [], "100000000 locked is the budget 0100000000");
  assert.deepEqual(escrowProblems(campaign, await escrowAs({ totalRaw: "100000001" })("x")), ["the escrow holds another amount than the budget"]);
});

test("the page: the rules and lines, what the escrow holds, what was paid — and «not read» when the escrow cannot be read", async () => {
  const trades = [buy(buyers[0], 100_000_000, T0 + 60), buy(buyers[1], 200_000_000, T0 + 61)];
  const { deps, at } = await lockedCampaign(trades);
  at(T0 + HOUR);
  const view = await boostView(deps, token);
  assert.equal(view.state, "LOCKED");
  assert.equal(view.read, "OK");
  assert.deepEqual(view.funded, { totalRaw: "1000000000", heldRaw: "1000000000", claimedRaw: "0" });
  assert.equal(view.payout.state, "WAITING");
  assert.equal(view.payout.recipients, 2);
  assert.equal(view.payout.plannedRaw, "6000000");
  assert.equal(view.payout.paidRaw, "0");
  assert.match(view.lines.en[0], /Ryntra takes 0/);
  const blind = await boostView({ ...deps, observe: async () => { throw new Error("429"); } }, token);
  assert.equal(blind.read, "NOT_READ");
  assert.equal(blind.funded, null, "not read is null, never zero");
  const unread = await boostView({ ...deps, trades: async () => ({ trades, complete: false }) }, token);
  assert.equal(unread.read, "NOT_READ");
  assert.equal(unread.payout.state, "NOT_READ");
  assert.equal(unread.payout.recipients, null);
  assert.equal(await boostView(deps, Keypair.generate().publicKey.toBase58()), null);
});

// Run from repo root: node --test lib/solana/allowances/service.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNT_SIZE, AccountLayout, MintLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  CANCEL_SUBSCRIPTION_DISCRIMINATOR,
  CLOSE_SUBSCRIPTION_AUTHORITY_DISCRIMINATOR,
  CREATE_FIXED_DELEGATION_DISCRIMINATOR,
  CREATE_RECURRING_DELEGATION_DISCRIMINATOR,
  INIT_SUBSCRIPTION_AUTHORITY_DISCRIMINATOR,
  REVOKE_DELEGATION_DISCRIMINATOR,
  REVOKE_SUBSCRIPTION_AUTHORITY_DISCRIMINATOR,
  SUBSCRIBE_DISCRIMINATOR,
  TRANSFER_FIXED_DISCRIMINATOR,
  UNKNOWN_INIT_ID,
  getCreateFixedDelegationInstructionDataDecoder,
  getCreateRecurringDelegationInstructionDataDecoder,
  getFixedDelegationEncoder,
  getPlanEncoder,
  getRecurringDelegationEncoder,
  getSubscriptionAuthorityEncoder,
  getSubscriptionDelegationEncoder,
  getTransferFixedInstructionDataDecoder,
} from "@solana/subscriptions";
import { getBase58Decoder } from "@solana/kit";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

import { createMemoryGuardStore } from "../../guard/store.ts";
import { SUBSCRIPTIONS_PROGRAM, USDC, isAddress, rentOf } from "./model.ts";
import { authorityAddress, subscriptionAddress } from "./program.server.ts";
import { allowanceNetwork, allowanceSendStatus, allowanceState, buildAllowance, programRefusal, submitAllowance } from "./service.server.ts";

const PROGRAM = new PublicKey(SUBSCRIPTIONS_PROGRAM);
const MINT = USDC.mint.devnet;
const person = Keypair.generate();
const wallet = person.publicKey.toBase58();
const agent = Keypair.generate();
const agentAddress = agent.publicKey.toBase58();
const merchant = Keypair.generate().publicKey.toBase58();
const other = Keypair.generate().publicKey.toBase58();
const NOW = Date.parse("2026-10-20T12:00:00Z");
const NOW_S = BigInt(NOW / 1000);
const ata = (owner) => getAssociatedTokenAddressSync(new PublicKey(MINT), new PublicKey(owner), true, TOKEN_PROGRAM_ID).toBase58();
const SA = await authorityAddress(wallet, MINT);

const info = (owner, data) => ({ data: Buffer.from(data), owner: new PublicKey(owner), lamports: 2_000_000, executable: false, rentEpoch: 0 });
const tokenAccount = (owner, { amount = 5_000_000n, delegate = null, delegated = 0n, state = 1 } = {}) => {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    { mint: new PublicKey(MINT), owner: new PublicKey(owner), amount, delegateOption: delegate ? 1 : 0, delegate: new PublicKey(delegate ?? PublicKey.default), state, isNativeOption: 0, isNative: 0n, delegatedAmount: delegated, closeAuthorityOption: 0, closeAuthority: PublicKey.default },
    data,
  );
  return info(TOKEN_PROGRAM_ID, data);
};
const mintAccount = () => {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply: 0n, decimals: 6, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default }, data);
  return info(TOKEN_PROGRAM_ID, data);
};
const authority = (user, initId = 77n) => info(PROGRAM, getSubscriptionAuthorityEncoder().encode({ discriminator: 0, user, tokenMint: MINT, payer: user, bump: 255, initId }));
const header = (discriminator, delegator, delegatee, initId = 77n) => ({ discriminator, version: 1, bump: 255, delegator, delegatee, payer: delegator, initId });
const fixedAccount = (delegator, delegatee, { remaining = 1_000_000n, expiry = NOW_S + 86_400n, initId = 77n } = {}) =>
  info(PROGRAM, getFixedDelegationEncoder().encode({ header: header(2, delegator, delegatee, initId), subscriptionAuthority: SA, mint: MINT, amount: remaining, expiryTs: expiry }));
const recurringAccount = (delegator, delegatee) =>
  info(PROGRAM, getRecurringDelegationEncoder().encode({ header: header(3, delegator, delegatee), subscriptionAuthority: SA, mint: MINT, currentPeriodStartTs: NOW_S - 100n, periodLengthS: 86_400n, expiryTs: NOW_S + 30n * 86_400n, amountPerPeriod: 500_000n, amountPulledInPeriod: 200_000n }));
const ZERO = "11111111111111111111111111111111";
const planAccount = ({ mint = MINT, status = 1, endTs = 0n } = {}) =>
  info(
    PROGRAM,
    getPlanEncoder().encode({
      discriminator: 1,
      owner: merchant,
      bump: 255,
      status,
      data: { planId: 7n, mint, terms: { amount: 9_990_000n, periodHours: 720n, createdAt: NOW_S - 1_000n }, endTs, destinations: [merchant, ZERO, ZERO, ZERO], pullers: [ZERO, ZERO, ZERO, ZERO], metadataUri: "".padEnd(128, "\0") },
    }),
  );
const subscriptionAccount = (plan, { expiresAt = 0n, pulled = 0n } = {}) =>
  info(
    PROGRAM,
    getSubscriptionDelegationEncoder().encode({ header: header(4, wallet, plan), terms: { amount: 9_990_000n, periodHours: 720n, createdAt: NOW_S - 1_000n }, amountPulledInPeriod: pulled, currentPeriodStartTs: NOW_S - 3_600n, expiresAtTs: expiresAt }),
  );

/** A node that answers what the limits read: accounts by address, the program's scan by the header's bytes, a blockhash and the tip. */
function chain(accounts, { scanFails = false, readsFail = false } = {}) {
  return {
    getMultipleAccountsInfo: async (keys) => {
      if (readsFail) throw new Error("the node refused");
      return keys.map((k) => accounts.get(k.toBase58()) ?? null);
    },
    getAccountInfo: async (k) => {
      if (readsFail) throw new Error("the node refused");
      return accounts.get(k.toBase58()) ?? null;
    },
    getProgramAccounts: async (program, config) => {
      if (scanFails) throw new Error("getProgramAccounts is disabled on this node");
      const { offset, bytes } = config.filters[0].memcmp;
      const want = new PublicKey(bytes).toBuffer();
      return [...accounts]
        .filter(([, account]) => account.owner.equals(program) && account.data.length >= offset + 32 && account.data.subarray(offset, offset + 32).equals(want))
        .map(([pubkey, account]) => ({ pubkey: new PublicKey(pubkey), account }));
    },
    getSignaturesForAddress: async () => [],
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1_150 }),
    getEpochInfo: async () => ({ blockHeight: 1_000, absoluteSlot: 2_000 }),
    getRecentPerformanceSamples: async () => [{ numSlots: 150, samplePeriodSecs: 60 }],
    sendRawTransaction: async () => {
      throw Object.assign(new Error("Transaction simulation failed: Error processing Instruction 0: custom program error: 0x12c"), { logs: ["Program De1eg… failed: custom program error: 0x12c"] });
    },
  };
}

const deps = (accounts, options) => ({ network: "devnet", connection: chain(accounts, options), store: createMemoryGuardStore(), now: () => new Date(NOW), nonce: () => 42n });
const decoded = (build) => Transaction.from(Buffer.from(build.unsignedWireBase64[0], "base64"));
const programIxs = (tx) => tx.instructions.filter((ix) => ix.programId.equals(PROGRAM));

test("served only where the deployment names the network", () => {
  assert.equal(allowanceNetwork({}), null);
  assert.equal(allowanceNetwork({ NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK: "devnet" }), "devnet");
  assert.equal(allowanceNetwork({ NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "devnet" }), null);
});

test("a first limit opens the token's authority and the limit in one transaction, bound to the same slot's generation", async () => {
  const accounts = new Map([[ata(wallet), tokenAccount(wallet)]]);
  const built = await buildAllowance(deps(accounts), { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "1000000", termSeconds: 86_400 });
  assert.equal(built.ok, true, JSON.stringify(built));
  const tx = decoded(built.build);
  assert.equal(tx.feePayer.toBase58(), wallet);
  const [init, create] = programIxs(tx);
  assert.equal(init.data[0], INIT_SUBSCRIPTION_AUTHORITY_DISCRIMINATOR);
  assert.equal(create.data[0], CREATE_FIXED_DELEGATION_DISCRIMINATOR);
  const data = getCreateFixedDelegationInstructionDataDecoder().decode(create.data).fixedDelegation;
  assert.equal(data.amount, 1_000_000n);
  assert.equal(data.expiryTs, NOW_S + 86_400n);
  assert.equal(data.nonce, 42n);
  assert.equal(data.expectedSubscriptionAuthorityInitId, UNKNOWN_INIT_ID);
  /* Only the wallet signs; nothing of Ryntra's is in the transaction. */
  assert.deepEqual(tx.signatures.map((s) => s.publicKey.toBase58()), [wallet]);
  const review = built.build.review;
  assert.equal(review.approves, "first");
  assert.equal(review.counterparty, agentAddress);
  assert.equal(review.endsAt, String(NOW_S + 86_400n));
  assert.equal(review.delegation, create.keys[2].pubkey.toBase58());
  assert.equal(review.rentLamports, String(1_628_640n + rentOf("fixed")));
});

test("with the authority open and approved, a limit binds to its real generation and asks no approval", async () => {
  const accounts = new Map([
    [ata(wallet), tokenAccount(wallet, { delegate: SA, delegated: 18_446_744_073_709_551_615n })],
    [SA, authority(wallet)],
  ]);
  const built = await buildAllowance(deps(accounts), { kind: "recurring", wallet, delegatee: agentAddress, amountRaw: "500000", period: "week", termSeconds: 90 * 86_400 });
  assert.equal(built.ok, true, JSON.stringify(built));
  const ixs = programIxs(decoded(built.build));
  assert.equal(ixs.length, 1);
  assert.equal(ixs[0].data[0], CREATE_RECURRING_DELEGATION_DISCRIMINATOR);
  const data = getCreateRecurringDelegationInstructionDataDecoder().decode(ixs[0].data).recurringDelegation;
  assert.equal(data.expectedSubscriptionAuthorityInitId, 77n);
  assert.equal(data.periodLengthS, 7n * 86_400n);
  assert.equal(data.startTs, 0n);
  assert.equal(data.expiryTs, NOW_S + 90n * 86_400n);
  assert.equal(built.build.review.approves, null);
});

test("another app's approval on the account is replaced only with the Review saying so", async () => {
  const accounts = new Map([
    [ata(wallet), tokenAccount(wallet, { delegate: other, delegated: 10n })],
    [SA, authority(wallet)],
  ]);
  const built = await buildAllowance(deps(accounts), { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "1", termSeconds: 86_400 });
  assert.equal(built.ok, true);
  assert.equal(built.build.review.approves, "again");
  assert.equal(built.build.review.replacesDelegate, other);
  assert.equal(programIxs(decoded(built.build))[0].data[0], INIT_SUBSCRIPTION_AUTHORITY_DISCRIMINATOR);
});

test("no USDC account, a limit to oneself, an empty term: refused before a byte is built", async () => {
  assert.equal((await buildAllowance(deps(new Map()), { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "1", termSeconds: 86_400 })).code, "ALLOWANCE_NO_TOKEN_ACCOUNT");
  const self = await buildAllowance(deps(new Map([[ata(wallet), tokenAccount(wallet)]])), { kind: "fixed", wallet, delegatee: wallet, amountRaw: "1", termSeconds: 86_400 });
  assert.equal(self.code, "VALIDATION_ERROR");
  assert.equal(self.issues[0].code, "DELEGATEE_IS_SELF");
});

function given() {
  const delegation = Keypair.generate().publicKey.toBase58();
  const accounts = new Map([
    [ata(wallet), tokenAccount(wallet, { delegate: SA, delegated: 18_446_744_073_709_551_615n })],
    [SA, authority(wallet)],
    [MINT, mintAccount()],
    [delegation, fixedAccount(wallet, agentAddress)],
  ]);
  return { delegation, accounts };
}

test("the delegatee spends within the limit: one transfer, counted by the program against the limit", async () => {
  const { delegation, accounts } = given();
  accounts.set(ata(agentAddress), tokenAccount(agentAddress));
  const built = await buildAllowance(deps(accounts), { kind: "spend", wallet: agentAddress, delegation, amountRaw: "400000", to: agentAddress });
  assert.equal(built.ok, true, JSON.stringify(built));
  const tx = decoded(built.build);
  assert.equal(tx.feePayer.toBase58(), agentAddress);
  const [transfer] = programIxs(tx);
  assert.equal(transfer.data[0], TRANSFER_FIXED_DISCRIMINATOR);
  assert.equal(getTransferFixedInstructionDataDecoder().decode(transfer.data).transferData.amount, 400_000n);
  assert.equal(built.build.review.opensTokenAccount, false);
});

test("over the limit is refused before signing; the program would refuse it too", async () => {
  const { delegation, accounts } = given();
  const over = await buildAllowance(deps(accounts), { kind: "spend", wallet: agentAddress, delegation, amountRaw: "1000001", to: agentAddress });
  assert.equal(over.ok, false);
  assert.equal(over.code, "ALLOWANCE_LIMIT_EXCEEDED");
  const stranger = await buildAllowance(deps(accounts), { kind: "spend", wallet: other, delegation, amountRaw: "1", to: other });
  assert.equal(stranger.code, "ALLOWANCE_NOT_DELEGATEE");
});

test("nothing is taken from a stopped limit, nor from one whose state could not be read: unknown is not active", async () => {
  const { delegation, accounts } = given();
  /* The node answers the limit itself, then fails the authority and the token account behind it. */
  let calls = 0;
  const flaky = { ...deps(accounts), connection: { ...chain(accounts), getMultipleAccountsInfo: async (keys) => (calls++ === 0 ? keys.map((k) => accounts.get(k.toBase58()) ?? null) : Promise.reject(new Error("down"))) } };
  const unread = await buildAllowance(flaky, { kind: "spend", wallet: agentAddress, delegation, amountRaw: "1", to: agentAddress });
  assert.equal(unread.code, "ALLOWANCE_NOT_ACTIVE");
  assert.match(unread.message, /unknown/);
  accounts.delete(SA);
  const stopped = await buildAllowance(deps(accounts), { kind: "spend", wallet: agentAddress, delegation, amountRaw: "1", to: agentAddress });
  assert.equal(stopped.code, "ALLOWANCE_NOT_ACTIVE");
  assert.match(stopped.message, /stopped/);
});

test("revoke is one instruction that closes the limit itself — not a new limit over it", async () => {
  const { delegation, accounts } = given();
  const built = await buildAllowance(deps(accounts), { kind: "revoke", wallet, delegation });
  assert.equal(built.ok, true, JSON.stringify(built));
  const [revoke] = programIxs(decoded(built.build));
  assert.equal(revoke.data[0], REVOKE_DELEGATION_DISCRIMINATOR);
  assert.equal(revoke.keys[1].pubkey.toBase58(), delegation);
  assert.equal(revoke.keys[1].isWritable, true);
  /* The deposit back is the account's own lamports, to the wallet that paid it. */
  assert.equal(built.build.review.refundLamports, "2000000");
  assert.equal(built.build.review.revokes, "limit");
  const notMine = await buildAllowance(deps(accounts), { kind: "revoke", wallet: agentAddress, delegation });
  assert.equal(notMine.code, "ALLOWANCE_NOT_YOURS");
});

test("a subscription is cancelled with what the merchant may still take said; closed once its period is over", async () => {
  const plan = Keypair.generate().publicKey.toBase58();
  const subscription = await subscriptionAddress(plan, wallet);
  const accounts = new Map([
    [ata(wallet), tokenAccount(wallet, { delegate: SA, delegated: 18_446_744_073_709_551_615n })],
    [SA, authority(wallet)],
    [MINT, mintAccount()],
    [plan, planAccount()],
    [subscription, subscriptionAccount(plan, { pulled: 9_990_000n })],
  ]);
  const cancel = await buildAllowance(deps(accounts), { kind: "revoke", wallet, delegation: subscription });
  assert.equal(cancel.ok, true, JSON.stringify(cancel));
  assert.equal(programIxs(decoded(cancel.build))[0].data[0], CANCEL_SUBSCRIPTION_DISCRIMINATOR);
  assert.equal(cancel.build.review.revokes, "cancel");
  /* This period's charge was taken already: nothing more until the end. */
  assert.equal(cancel.build.review.grace, null);
  accounts.set(subscription, subscriptionAccount(plan, { pulled: 0n }));
  const unpaid = await buildAllowance(deps(accounts), { kind: "revoke", wallet, delegation: subscription });
  assert.deepEqual(unpaid.build.review.grace, { raw: "9990000", until: String(NOW_S - 3_600n + 720n * 3_600n) });
  accounts.set(subscription, subscriptionAccount(plan, { expiresAt: NOW_S + 10n }));
  assert.equal((await buildAllowance(deps(accounts), { kind: "revoke", wallet, delegation: subscription })).code, "ALLOWANCE_ALREADY_CANCELLED");
  accounts.set(subscription, subscriptionAccount(plan, { expiresAt: NOW_S - 10n }));
  const close = await buildAllowance(deps(accounts), { kind: "revoke", wallet, delegation: subscription });
  const [revoke] = programIxs(decoded(close.build));
  assert.equal(revoke.data[0], REVOKE_DELEGATION_DISCRIMINATOR);
  assert.equal(revoke.keys[2].pubkey.toBase58(), plan);
  assert.equal(close.build.review.revokes, "close");
});

test("subscribe binds the plan's terms as read; another token, a sunset plan or a second subscription are refused", async () => {
  const plan = Keypair.generate().publicKey.toBase58();
  const accounts = new Map([
    [ata(wallet), tokenAccount(wallet)],
    [plan, planAccount()],
  ]);
  const built = await buildAllowance(deps(accounts), { kind: "subscribe", wallet, plan });
  assert.equal(built.ok, true, JSON.stringify(built));
  const ixs = programIxs(decoded(built.build));
  assert.deepEqual(ixs.map((ix) => ix.data[0]), [INIT_SUBSCRIPTION_AUTHORITY_DISCRIMINATOR, SUBSCRIBE_DISCRIMINATOR]);
  assert.equal(built.build.review.counterparty, merchant);
  assert.equal(built.build.review.amountRaw, "9990000");
  assert.equal(built.build.review.periodSeconds, 720 * 3_600);
  assert.deepEqual(built.build.review.plan.destinations, [merchant]);
  accounts.set(plan, planAccount({ mint: other }));
  assert.equal((await buildAllowance(deps(accounts), { kind: "subscribe", wallet, plan })).code, "ALLOWANCE_PLAN_ASSET");
  accounts.set(plan, planAccount({ status: 0 }));
  assert.equal((await buildAllowance(deps(accounts), { kind: "subscribe", wallet, plan })).code, "ALLOWANCE_PLAN_SUNSET");
  accounts.set(plan, planAccount());
  accounts.set(await subscriptionAddress(plan, wallet), subscriptionAccount(plan));
  assert.equal((await buildAllowance(deps(accounts), { kind: "subscribe", wallet, plan })).code, "ALLOWANCE_ALREADY_SUBSCRIBED");
});

test("stop all: the token's approval revoked and its authority closed, with the count of what stops", async () => {
  const { accounts } = given();
  const built = await buildAllowance(deps(accounts), { kind: "stopAll", wallet });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(programIxs(decoded(built.build))[0].data[0], REVOKE_SUBSCRIPTION_AUTHORITY_DISCRIMINATOR);
  assert.equal(built.build.review.stops, 1);
  assert.equal((await buildAllowance(deps(new Map([[ata(wallet), tokenAccount(wallet)]])), { kind: "stopAll", wallet })).code, "ALLOWANCE_NOTHING_TO_STOP");
});

test("the state: who may take what now, on both sides; a refused scan is «not read», a failed read is «unknown»", async () => {
  const { delegation, accounts } = given();
  const recurring = Keypair.generate().publicKey.toBase58();
  accounts.set(recurring, recurringAccount(wallet, agentAddress));
  const read = await allowanceState(deps(accounts), wallet);
  assert.equal(read.ok, true);
  const { state } = read;
  assert.equal(state.givenUnread, false);
  assert.equal(state.given.length, 2);
  const fixedRow = state.given.find((row) => row.address === delegation);
  assert.equal(fixedRow.status, "active");
  assert.equal(fixedRow.availableRaw, "1000000");
  assert.equal(fixedRow.asset, "USDC");
  /* The node gave no history: the original amount is not read, so «spent» is not said. */
  assert.equal(fixedRow.originalRaw, null);
  assert.equal(fixedRow.spentRaw, null);
  assert.deepEqual(fixedRow.actions, ["revoke"]);
  const recurringRow = state.given.find((row) => row.address === recurring);
  assert.equal(recurringRow.spentRaw, "200000");
  assert.equal(recurringRow.availableRaw, "300000");
  assert.equal(state.usdc.authorityOpen, true);
  const asAgent = await allowanceState(deps(accounts), agentAddress);
  assert.equal(asAgent.state.received.length, 2);
  assert.deepEqual(asAgent.state.received.find((row) => row.address === delegation).actions, ["spend"]);

  const refused = await allowanceState(deps(accounts, { scanFails: true }), wallet);
  assert.equal(refused.state.givenUnread, true);
  assert.equal(refused.state.given.length, 0);
  const blind = await allowanceState({ ...deps(accounts), connection: { ...chain(accounts), getMultipleAccountsInfo: async () => { throw new Error("down"); } } }, wallet);
  assert.ok(blind.state.given.every((row) => row.status === "unknown" && row.availableRaw === null));
  assert.equal(blind.state.usdc.balanceRaw, null);
});

test("submit: the signed bytes must be the built ones; a refusal by the program is said by its name", async () => {
  const accounts = new Map([[ata(wallet), tokenAccount(wallet)]]);
  const d = deps(accounts);
  const built = await buildAllowance(d, { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "1", termSeconds: 86_400 });
  const tx = decoded(built.build);
  tx.sign(person);
  const signed = tx.serialize().toString("base64");
  const tampered = decoded(built.build);
  tampered.instructions[1].data[9] ^= 1;
  tampered.sign(person);
  assert.equal((await submitAllowance(d, { buildId: built.build.buildId, wallet, signedWireBase64: [tampered.serialize().toString("base64")] })).code, "ALLOWANCE_SIGNED_OTHER_BYTES");
  assert.equal((await submitAllowance(d, { buildId: built.build.buildId, wallet: agentAddress, signedWireBase64: [signed] })).code, "WALLET_MISMATCH");
  const refused = await submitAllowance(d, { buildId: built.build.buildId, wallet, signedWireBase64: [signed] });
  assert.equal(refused.code, "ALLOWANCE_SUBMIT_FAILED");
  assert.match(refused.message, /\(300\)/);
  assert.equal((await submitAllowance(d, { buildId: built.build.buildId, wallet, signedWireBase64: [signed] })).code, "ALLOWANCE_BUILD_USED");
  assert.equal((await submitAllowance(d, { buildId: "0".repeat(32), wallet, signedWireBase64: [signed] })).code, "ALLOWANCE_BUILD_NOT_FOUND");
});

test("the program's refusals by name", () => {
  assert.match(programRefusal("custom program error: 0x12c"), /300/);
  assert.match(programRefusal("custom program error: 0x190"), /400/);
  assert.equal(programRefusal("blockhash not found"), "blockhash not found");
});

test("a take pays only a person's wallet or a USDC account: a token account named directly is used as is; a program, a PDA or another mint is refused", async () => {
  const { delegation, accounts } = given();
  const own = ata(agentAddress);
  accounts.set(own, tokenAccount(agentAddress));
  /* The agent pastes its own USDC account, not its wallet: paid into that account, never into one opened under it. */
  const direct = await buildAllowance(deps(accounts), { kind: "spend", wallet: agentAddress, delegation, amountRaw: "1", to: own });
  assert.equal(direct.ok, true, JSON.stringify(direct));
  const ixs = decoded(direct.build).instructions;
  assert.equal(ixs.length, 1);
  assert.equal(ixs[0].keys.some((k) => k.pubkey.toBase58() === own), true);
  /* An address no key can sign for (the limit's own PDA). */
  const pda = await buildAllowance(deps(accounts), { kind: "spend", wallet: agentAddress, delegation, amountRaw: "1", to: SA });
  assert.equal(pda.code, "ALLOWANCE_RECIPIENT");
  /* An account another program owns. */
  const foreign = Keypair.generate().publicKey.toBase58();
  accounts.set(foreign, info(PROGRAM, Buffer.alloc(10)));
  assert.equal((await buildAllowance(deps(accounts), { kind: "spend", wallet: agentAddress, delegation, amountRaw: "1", to: foreign })).code, "ALLOWANCE_RECIPIENT");
  /* A wallet without a USDC account: the agent opens it, said in the Review. */
  const fresh = Keypair.generate().publicKey.toBase58();
  const opens = await buildAllowance(deps(accounts), { kind: "spend", wallet: agentAddress, delegation, amountRaw: "1", to: fresh });
  assert.equal(opens.build.review.opensTokenAccount, true);
});

test("stop all says plainly when another app's approval stays on the account", async () => {
  const { accounts } = given();
  accounts.set(ata(wallet), tokenAccount(wallet, { delegate: other, delegated: 10n }));
  const built = await buildAllowance(deps(accounts), { kind: "stopAll", wallet });
  assert.equal(built.build.review.remainsDelegate, other);
});

test("a cancel promises the merchant nothing that cannot be taken: stopped gives no grace, unread says not known", async () => {
  const plan = Keypair.generate().publicKey.toBase58();
  const subscription = await subscriptionAddress(plan, wallet);
  const accounts = new Map([
    [ata(wallet), tokenAccount(wallet, { delegate: SA, delegated: 18_446_744_073_709_551_615n })],
    [MINT, mintAccount()],
    [plan, planAccount()],
    [subscription, subscriptionAccount(plan)],
  ]);
  const stopped = await buildAllowance(deps(accounts), { kind: "revoke", wallet, delegation: subscription });
  assert.equal(stopped.build.review.grace, null);
  assert.equal(stopped.build.review.graceUnknown, false);
});

test("closing a limit that is over is called closing, not revoking", async () => {
  const { delegation, accounts } = given();
  accounts.set(delegation, fixedAccount(wallet, agentAddress, { remaining: 0n }));
  assert.equal((await buildAllowance(deps(accounts), { kind: "revoke", wallet, delegation })).build.review.revokes, "close");
});

test("an address is base58 of exactly 32 bytes", () => {
  assert.equal(isAddress(wallet), true);
  assert.equal(isAddress("11111111111111111111111111111111"), true);
  assert.equal(isAddress("1".repeat(44)), false);
});

test("a build made again at signing: the same terms pass; a plan made anew at another price does not", async () => {
  const { sameTerms } = await import("./review-terms.ts");
  const accounts = new Map([[ata(wallet), tokenAccount(wallet)]]);
  const first = await buildAllowance({ ...deps(accounts), nonce: () => 1n }, { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "5", termSeconds: 86_400 });
  const again = await buildAllowance({ ...deps(accounts), nonce: () => 2n, now: () => new Date(NOW + 120_000) }, { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "5", termSeconds: 86_400 });
  assert.notEqual(first.build.review.delegation, again.build.review.delegation);
  assert.equal(sameTerms(first.build.review, again.build.review), true);
  /* An hour on the Review moves the end by an hour: shown again, not signed. */
  const late = await buildAllowance({ ...deps(accounts), nonce: () => 3n, now: () => new Date(NOW + 3_600_000) }, { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "5", termSeconds: 86_400 });
  assert.equal(sameTerms(first.build.review, late.build.review), false);
  const plan = Keypair.generate().publicKey.toBase58();
  accounts.set(plan, planAccount());
  const reviewed = await buildAllowance(deps(accounts), { kind: "subscribe", wallet, plan });
  const raised = planAccount();
  raised.data.writeBigUInt64LE(99_990_000n, 1 + 32 + 1 + 1 + 8 + 32);
  accounts.set(plan, raised);
  const rebuilt = await buildAllowance(deps(accounts), { kind: "subscribe", wallet, plan });
  assert.equal(rebuilt.build.review.amountRaw, "99990000");
  assert.equal(sameTerms(reviewed.build.review, rebuilt.build.review), false);
});

test("a take is refused to a frozen USDC account, another mint's account, a Token-2022 account and a program", async () => {
  const { delegation, accounts } = given();
  const frozen = Keypair.generate().publicKey.toBase58();
  accounts.set(frozen, tokenAccount(agentAddress, { state: 2 }));
  const otherMint = Keypair.generate().publicKey.toBase58();
  const foreignMint = tokenAccount(agentAddress);
  new PublicKey(other).toBuffer().copy(foreignMint.data, 0);
  accounts.set(otherMint, foreignMint);
  const t22 = Keypair.generate().publicKey.toBase58();
  accounts.set(t22, { ...tokenAccount(agentAddress), owner: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") });
  const program = Keypair.generate().publicKey.toBase58();
  accounts.set(program, { ...info(PROGRAM, Buffer.alloc(0)), executable: true });
  for (const to of [frozen, otherMint, t22, program]) {
    assert.equal((await buildAllowance(deps(accounts), { kind: "spend", wallet: agentAddress, delegation, amountRaw: "1", to })).code, "ALLOWANCE_RECIPIENT", to);
  }
});

test("a cancel whose authority could not be read says so, with no amount promised", async () => {
  const plan = Keypair.generate().publicKey.toBase58();
  const subscription = await subscriptionAddress(plan, wallet);
  const accounts = new Map([
    [ata(wallet), tokenAccount(wallet, { delegate: SA, delegated: 1n })],
    [SA, authority(wallet)],
    [MINT, mintAccount()],
    [plan, planAccount()],
    [subscription, subscriptionAccount(plan)],
  ]);
  /* The subscription and its plan read; everything after them fails. */
  let calls = 0;
  const flaky = { ...deps(accounts), connection: { ...chain(accounts), getMultipleAccountsInfo: async (keys) => (calls++ < 3 ? keys.map((k) => accounts.get(k.toBase58()) ?? null) : Promise.reject(new Error("down"))) } };
  const built = await buildAllowance(flaky, { kind: "revoke", wallet, delegation: subscription });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.build.review.grace, null);
  assert.equal(built.build.review.graceUnknown, true);
});

test("stop all on a wallet whose USDC account is gone or frozen closes the authority alone, its rent to whoever paid it", async () => {
  const sponsor = Keypair.generate().publicKey.toBase58();
  const sponsored = info(PROGRAM, getSubscriptionAuthorityEncoder().encode({ discriminator: 0, user: wallet, tokenMint: MINT, payer: sponsor, bump: 255, initId: 77n }));
  for (const accounts of [new Map([[SA, sponsored]]), new Map([[SA, sponsored], [ata(wallet), tokenAccount(wallet, { delegate: SA, delegated: 1n, state: 2 })]])]) {
    const built = await buildAllowance(deps(accounts), { kind: "stopAll", wallet });
    assert.equal(built.ok, true, JSON.stringify(built));
    const [close] = programIxs(decoded(built.build));
    assert.equal(close.data[0], CLOSE_SUBSCRIPTION_AUTHORITY_DISCRIMINATOR);
    assert.deepEqual(close.keys.map((k) => k.pubkey.toBase58()), [wallet, SA, sponsor]);
    assert.equal(close.keys[0].isSigner, true);
    assert.equal(built.build.review.closesOnly, true);
    assert.equal(built.build.review.refundLamports, "0");
  }
});

test("submit: an instruction of another program, or a program id changed, is not what was reviewed — nothing is sent", async () => {
  const accounts = new Map([[ata(wallet), tokenAccount(wallet)]]);
  const d = deps(accounts);
  let sends = 0;
  d.connection.sendRawTransaction = async () => {
    sends += 1;
    throw new Error("must not be sent");
  };
  const built = await buildAllowance(d, { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "1", termSeconds: 86_400 });
  const foreign = decoded(built.build);
  foreign.add(new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), keys: [], data: Buffer.from("x") }));
  foreign.sign(person);
  assert.equal((await submitAllowance(d, { buildId: built.build.buildId, wallet, signedWireBase64: [foreign.serialize().toString("base64")] })).code, "ALLOWANCE_SIGNED_OTHER_BYTES");
  const moved = decoded(built.build);
  const last = moved.instructions.at(-1);
  moved.instructions[moved.instructions.length - 1] = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: last.keys, data: last.data });
  moved.sign(person);
  assert.equal((await submitAllowance(d, { buildId: built.build.buildId, wallet, signedWireBase64: [moved.serialize().toString("base64")] })).code, "ALLOWANCE_SIGNED_OTHER_BYTES");
  assert.equal(sends, 0);
});

test("a sent build is read again until the chain's word is final: never sent and past its blockhash is «not landed», never a guess", async () => {
  const accounts = new Map([[ata(wallet), tokenAccount(wallet)]]);
  const store = createMemoryGuardStore();
  let clock = NOW;
  let tip = { blockHeight: 1_000, absoluteSlot: 2_000 };
  let status = null;
  const connection = {
    ...chain(accounts),
    getEpochInfo: async () => tip,
    getSignatureStatuses: async () => ({ context: { slot: tip.absoluteSlot + 1 }, value: [status] }),
  };
  const d = { network: "devnet", connection, store, now: () => new Date(clock), nonce: () => 42n };
  const built = await buildAllowance(d, { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "1", termSeconds: 86_400 });
  const query = { build: built.build.buildId, wallet };
  /* Nothing kept as sent yet, the build still signable: a submit may be under way — not known. */
  assert.equal((await allowanceSendStatus(d, query)).status.state, "PENDING");
  /* Expired, but the chain not past its blockhash: still not «not landed». */
  clock = Date.parse(built.build.expiresAt) + 60_000;
  assert.equal((await allowanceSendStatus(d, query)).status.state, "PENDING");
  tip = { blockHeight: 1_200, absoluteSlot: 2_500 };
  assert.equal((await allowanceSendStatus(d, query)).status.state, "NOT_LANDED");
  assert.equal((await allowanceSendStatus(d, { ...query, wallet: agentAddress })).code, "WALLET_MISMATCH");
  assert.equal((await allowanceSendStatus(d, { ...query, build: "0".repeat(32) })).code, "ALLOWANCE_BUILD_NOT_FOUND");

  /* A send kept: its own signature is what is read. */
  clock = NOW;
  tip = { blockHeight: 1_000, absoluteSlot: 2_000 };
  const again = await buildAllowance(d, { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "1", termSeconds: 86_400 });
  const tx = decoded(again.build);
  tx.sign(person);
  const signature = getBase58Decoder().decode(new Uint8Array(tx.signature));
  /* A send kept and its answer lost: no final word kept with it. */
  await store.collection("solanaAllowanceSends").set(`devnet:${again.build.buildId}`, { network: "devnet", id: again.build.buildId, at: new Date(clock).toISOString(), signature });
  const sent = { build: again.build.buildId, wallet };
  assert.equal((await allowanceSendStatus(d, sent)).status.state, "PENDING");
  status = { slot: 2_001, confirmations: 1, err: null, confirmationStatus: "confirmed" };
  const landed = (await allowanceSendStatus(d, sent)).status;
  assert.equal(landed.state, "CONFIRMED");
  assert.equal(landed.signature, signature);
  assert.equal(landed.kind, "fixed");
  status = { slot: 2_001, confirmations: 1, err: { InstructionError: [1, { Custom: 300 }] }, confirmationStatus: "confirmed" };
  assert.equal((await allowanceSendStatus(d, sent)).status.state, "FAILED");
  status = null;
  tip = { blockHeight: 1_200, absoluteSlot: 2_500 };
  assert.equal((await allowanceSendStatus(d, sent)).status.state, "NOT_LANDED");
});

test("the state says why a limit is blocked and what the USDC approval allows now", async () => {
  const delegation = Keypair.generate().publicKey.toBase58();
  for (const [account, blockedBy, delegatedRaw, frozen] of [
    [tokenAccount(wallet, { delegate: SA, delegated: 1n, state: 2 }), "frozen", "1", true],
    [tokenAccount(wallet, { delegate: other, delegated: 1n }), "approvalOther", "1", false],
    [tokenAccount(wallet, { delegate: SA, delegated: 0n }), "approvalUsed", "0", false],
    [tokenAccount(wallet), "approvalRevoked", "0", false],
  ]) {
    const accounts = new Map([
      [ata(wallet), account],
      [SA, authority(wallet)],
      [MINT, mintAccount()],
      [delegation, fixedAccount(wallet, agentAddress)],
    ]);
    const read = await allowanceState(deps(accounts), wallet);
    const row = read.state.given.find((given) => given.address === delegation);
    assert.equal(row.status, "blocked", blockedBy);
    assert.equal(row.blockedBy, blockedBy);
    assert.equal(read.state.usdc.delegatedRaw, delegatedRaw);
    assert.equal(read.state.usdc.frozen, frozen);
  }
});

test("no new limit is built while one this wallet sent is not final; a revoke and stop all always are", async () => {
  const accounts = new Map([[ata(wallet), tokenAccount(wallet, { delegate: SA, delegated: 1n })], [SA, authority(wallet)], [MINT, mintAccount()]]);
  const store = createMemoryGuardStore();
  let status = null;
  const tip = { blockHeight: 1_000, absoluteSlot: 2_000 };
  const connection = { ...chain(accounts), getEpochInfo: async () => tip, getSignatureStatuses: async () => ({ context: { slot: 2_001 }, value: [status] }) };
  const d = { network: "devnet", connection, store, now: () => new Date(NOW), nonce: () => 42n };
  const give = { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "100000000", termSeconds: 86_400 };
  const first = await buildAllowance(d, give);
  await store.collection("solanaAllowanceSends").set(`devnet:${first.build.buildId}`, { network: "devnet", id: first.build.buildId, at: new Date(NOW).toISOString(), signature: "1".repeat(64) });
  /* The answer was lost: the same limit again would be a second one — refused, here and from any other tab. */
  for (const request of [give, { ...give, kind: "recurring", period: "day", termSeconds: 30 * 86_400 }]) {
    assert.equal((await buildAllowance(d, request)).code, "ALLOWANCE_SEND_PENDING", request.kind);
  }
  /* Taking a right away never waits. */
  assert.equal((await buildAllowance(d, { kind: "stopAll", wallet })).ok, true);
  /* Another wallet is not held back by this one's send. */
  const elsewhere = await buildAllowance(d, { ...give, wallet: agentAddress, delegatee: wallet });
  assert.notEqual(elsewhere.code, "ALLOWANCE_SEND_PENDING");
  /* Once the chain's word is final it is kept, and the next limit is built. */
  status = { slot: 2_001, confirmations: 1, err: null, confirmationStatus: "confirmed" };
  assert.equal((await buildAllowance(d, give)).ok, true);
  status = null;
  assert.equal((await buildAllowance(d, give)).ok, true);
  assert.equal((await store.collection("solanaAllowanceSends").get(`devnet:${first.build.buildId}`)).outcome, "CONFIRMED");
});

test("no second take is built while one this wallet sent is not final: a take sent twice would be paid twice", async () => {
  const { delegation, accounts } = given();
  const store = createMemoryGuardStore();
  let status = null;
  const connection = { ...chain(accounts), getEpochInfo: async () => ({ blockHeight: 1_000, absoluteSlot: 2_000 }), getSignatureStatuses: async () => ({ context: { slot: 2_001 }, value: [status] }) };
  const d = { network: "devnet", connection, store, now: () => new Date(NOW), nonce: () => 42n };
  const take = { kind: "spend", wallet: agentAddress, delegation, amountRaw: "1", to: agentAddress };
  const first = await buildAllowance(d, take);
  assert.equal(first.ok, true, JSON.stringify(first));
  await store.collection("solanaAllowanceSends").set(`devnet:${first.build.buildId}`, { network: "devnet", id: first.build.buildId, at: new Date(NOW).toISOString(), signature: "1".repeat(64) });
  assert.equal((await buildAllowance(d, take)).code, "ALLOWANCE_SPEND_PENDING");
  status = { slot: 2_001, confirmations: 1, err: null, confirmationStatus: "confirmed" };
  assert.equal((await buildAllowance(d, take)).ok, true);
});

test("a submit refused before it reached the chain is final: it holds no later limit back", async () => {
  const accounts = new Map([[ata(wallet), tokenAccount(wallet)]]);
  const d = deps(accounts);
  const built = await buildAllowance(d, { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "1", termSeconds: 86_400 });
  const tx = decoded(built.build);
  tx.sign(person);
  assert.equal((await submitAllowance(d, { buildId: built.build.buildId, wallet, signedWireBase64: [tx.serialize().toString("base64")] })).code, "ALLOWANCE_SUBMIT_FAILED");
  assert.equal((await allowanceSendStatus(d, { build: built.build.buildId, wallet })).status.state, "NOT_LANDED");
  assert.equal((await buildAllowance(d, { kind: "fixed", wallet, delegatee: agentAddress, amountRaw: "1", termSeconds: 86_400 })).ok, true);
});


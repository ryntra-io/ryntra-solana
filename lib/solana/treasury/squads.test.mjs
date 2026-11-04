// Run from repo root: node --test lib/solana/treasury/squads.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import * as multisig from "@sqds/multisig";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage } from "@solana/web3.js";

import { GUARD_COLLECTIONS } from "../../guard/store.ts";
import {
  TX_BYTES_CAP,
  addMemberRent,
  batchLineBytes,
  batchRemaining,
  buildConfig,
  buildCreate,
  buildCreateAgent,
  buildDeposit,
  buildPayouts,
  buildSpend,
  buildVote,
  configTransactionBytes,
  failedInstructionIndex,
  legacyInstructions,
  limitAvailable,
  multisigBytes,
  pack,
  payerOf,
  payoutInstructions,
  readLine,
  readMultisig,
  refreshRentRate,
  rentExemptLamports,
  sizeOf,
  v1Parts,
  squadsErrorName,
  sumsOfMessage,
} from "./squads.server.ts";

const program = multisig.PROGRAM_ID;
const wallet = Keypair.generate().publicKey.toBase58();
const second = Keypair.generate().publicKey.toBase58();
const agent = Keypair.generate().publicKey.toBase58();
const recipients = Array.from({ length: 40 }, () => Keypair.generate().publicKey.toBase58());
const programTreasury = Keypair.generate().publicKey;
const { generated } = multisig;

const decode = (struct, instruction) => struct.deserialize(instruction.data)[0];
const isSquads = (instruction) => instruction.programId.equals(program);

/** A multisig as `readMultisig` gives it, without a node. */
function fakeRead(members = [wallet, second], transactionIndex = 4n) {
  const createKey = Keypair.generate().publicKey;
  const [address] = multisig.getMultisigPda({ createKey });
  const [vault] = multisig.getVaultPda({ multisigPda: address, index: 0 });
  return {
    address,
    vault,
    account: { threshold: 1, timeLock: 0, configAuthority: PublicKey.default },
    members: members.map((member) => ({ address: member, initiate: true, vote: true, execute: true })),
    transactionIndex,
    staleTransactionIndex: 0n,
  };
}

test("the treasury's store collections exist", () => {
  assert.ok(GUARD_COLLECTIONS.includes("solanaTreasuryBuilds"));
  assert.ok(GUARD_COLLECTIONS.includes("solanaTreasurySends"));
});

test("a new treasury is the person's: no config authority for anyone, rent back to its own vault, the wallet creates and pays", () => {
  const seed = Keypair.generate().publicKey;
  const built = buildCreate({ wallet, createKey: seed, members: [{ address: second, initiate: false, vote: true, execute: false }, { address: wallet, initiate: true, vote: true, execute: true }], threshold: 2, timeLockSeconds: 86_400, programTreasury });
  assert.equal(built.groups.length, 1);
  const [instruction] = built.groups[0].instructions;
  assert.ok(isSquads(instruction));
  const args = decode(generated.multisigCreateV2Struct, instruction).args;
  assert.equal(args.configAuthority, null, "Ryntra takes no config authority");
  assert.ok(args.rentCollector?.equals(built.vault), "rent goes back to the treasury's own vault");
  assert.equal(args.threshold, 2);
  assert.equal(args.timeLock, 86_400);
  assert.equal(args.members.length, 2);
  const sorted = [...args.members].sort((a, b) => Buffer.compare(a.key.toBuffer(), b.key.toBuffer()));
  assert.deepEqual(args.members.map((m) => m.key.toBase58()), sorted.map((m) => m.key.toBase58()), "members in key order");
  assert.equal(args.members.find((m) => m.key.toBase58() === wallet).permissions.mask, 7);
  assert.equal(args.members.find((m) => m.key.toBase58() === second).permissions.mask, 2);
  /* The creator and payer is the wallet; the throwaway createKey co-signs, and nothing else does. */
  const signers = instruction.keys.filter((meta) => meta.isSigner).map((meta) => meta.pubkey.toBase58());
  assert.ok(signers.includes(wallet));
  /* The seed key is the browser's and signs after the wallet: the server holds no key and signs nothing. */
  assert.equal(built.groups[0].signers, undefined);
  assert.ok(signers.includes(seed.toBase58()));
  assert.equal(signers.length, 2);
  const [pda] = multisig.getMultisigPda({ createKey: seed });
  assert.ok(pda.equals(built.multisig));
  assert.ok(built.rentLamports > 0n);
});

test("an agent's multisig: the person alone in every role; one change sets the agent's limit with its recipients and the short delay", () => {
  const destination = recipients[0];
  const built = buildCreateAgent({ network: "devnet", wallet, createKey: Keypair.generate().publicKey, agent, timeLockSeconds: 600, asset: "USDC", amountRaw: 25_000_000n, period: "day", destinations: [destination], programTreasury });
  assert.equal(built.groups.length, 2);
  const create = decode(generated.multisigCreateV2Struct, built.groups[0].instructions[0]).args;
  assert.equal(create.configAuthority, null);
  assert.equal(create.threshold, 1);
  assert.deepEqual(create.members.map((m) => [m.key.toBase58(), m.permissions.mask]), [[wallet, 7]], "the agent is not a member");
  const [configCreate, proposalCreate, approve, execute] = built.groups[1].instructions;
  assert.deepEqual(
    [configCreate, proposalCreate, approve, execute].map((ix) => ix.data.subarray(0, 8).toString("hex")),
    [generated.configTransactionCreateInstructionDiscriminator, generated.proposalCreateInstructionDiscriminator, generated.proposalApproveInstructionDiscriminator, generated.configTransactionExecuteInstructionDiscriminator].map((d) => Buffer.from(d).toString("hex")),
  );
  const actions = decode(generated.configTransactionCreateStruct, configCreate).args.actions;
  const limit = actions.find((action) => action.__kind === "AddSpendingLimit");
  assert.ok(limit);
  assert.deepEqual(limit.members.map(String), [agent]);
  assert.deepEqual(limit.destinations.map(String), [destination], "the mandate names where it may pay");
  assert.equal(limit.mint.toBase58(), "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  assert.equal(limit.amount.toString(), "25000000");
  assert.equal(limit.period, 1);
  assert.deepEqual(actions.find((action) => action.__kind === "SetTimeLock"), { __kind: "SetTimeLock", newTimeLock: 600 });
  const [limitPda] = multisig.getSpendingLimitPda({ multisigPda: built.multisig, createKey: limit.createKey });
  assert.ok(limitPda.equals(built.limit));
  assert.ok(execute.keys.some((meta) => meta.pubkey.equals(limitPda) && meta.isWritable), "the execute names the limit it opens");
  assert.throws(() => buildCreateAgent({ network: "devnet", wallet, createKey: Keypair.generate().publicKey, agent, timeLockSeconds: 86_400, asset: "SOL", amountRaw: 1n, period: "once", destinations: [destination], programTreasury }));
  /* Both transactions fit a legacy transaction with room for the wallet's own instructions. */
  for (const group of built.groups) assert.ok(sizeOf([group], new PublicKey(wallet)) <= TX_BYTES_CAP);
});

test("payouts are one batch under one proposal: a draft, the lines, then opened with the proposer's vote", () => {
  const read = fakeRead();
  const payouts = recipients.map((to, index) => ({ to, amountRaw: BigInt(index + 1) * 1_000_000n }));
  for (const asset of ["SOL", "USDC"]) {
    const built = buildPayouts({ network: "devnet", read, wallet, asset, payouts, alsoApprove: true });
    assert.equal(built.index, 5n, "the next transaction number");
    const first = built.groups[0].instructions;
    assert.deepEqual(first.map((ix) => ix.data.subarray(0, 8).toString("hex")), [generated.batchCreateInstructionDiscriminator, generated.proposalCreateInstructionDiscriminator].map((d) => Buffer.from(d).toString("hex")));
    assert.equal(decode(generated.proposalCreateStruct, first[1]).args.draft, true);
    const last = built.groups.at(-1).instructions;
    assert.deepEqual(last.map((ix) => ix.data.subarray(0, 8).toString("hex")), [generated.proposalActivateInstructionDiscriminator, generated.proposalApproveInstructionDiscriminator].map((d) => Buffer.from(d).toString("hex")));
    /* Every line is in exactly one batch transaction, the sums match, and each batch transaction pays from the vault. */
    const adds = built.groups.slice(1, -1).map((group) => decode(generated.batchAddTransactionStruct, group.instructions[0]).args);
    assert.equal(adds.length, built.items);
    let total = 0n;
    let lines = 0;
    for (const add of adds) {
      const [message] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(add.transactionMessage));
      assert.ok(message.accountKeys[0].equals(read.vault), "the vault pays");
      const sums = sumsOfMessage(message, "devnet");
      for (const sum of sums) {
        assert.equal(sum.asset, asset);
        total += sum.raw;
      }
      lines += sums.length;
    }
    assert.equal(lines, payouts.length);
    assert.equal(total, payouts.reduce((sum, payout) => sum + payout.amountRaw, 0n));
    /* Packed for the wallet: every transaction under the cap, in order. */
    const packed = pack(built.groups, new PublicKey(wallet));
    for (const groups of packed) assert.ok(sizeOf(groups, new PublicKey(wallet)) <= TX_BYTES_CAP);
    assert.equal(packed.flat().length, built.groups.length);
  }
  const quiet = buildPayouts({ network: "devnet", read, wallet, asset: "SOL", payouts: payouts.slice(0, 2), alsoApprove: false });
  assert.equal(quiet.groups.at(-1).instructions.length, 1, "no vote from a proposer who does not vote");
});

test("a USDC line opens the recipient's account from the vault when it has none, then transfers checked", () => {
  const read = fakeRead();
  const instructions = payoutInstructions({ network: "devnet", vault: read.vault, asset: "USDC", payout: { to: recipients[1], amountRaw: 7n } });
  assert.equal(instructions.length, 2);
  assert.equal(instructions[0].data[0], 1, "create idempotent");
  assert.ok(instructions[0].keys[0].pubkey.equals(read.vault), "the vault pays the account's rent");
  assert.equal(instructions[1].data[0], 12, "TransferChecked");
  const sol = payoutInstructions({ network: "devnet", vault: read.vault, asset: "SOL", payout: { to: recipients[1], amountRaw: 9n } });
  assert.ok(sol[0].programId.equals(SystemProgram.programId));
  const message = new TransactionMessage({ payerKey: read.vault, recentBlockhash: PublicKey.default.toBase58(), instructions: [...instructions, ...sol] });
  const bytes = multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message, vaultPda: read.vault });
  const [decoded] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(bytes));
  assert.deepEqual(sumsOfMessage(decoded, "devnet").map((sum) => [sum.asset, sum.raw]), [["USDC", 7n], ["SOL", 9n]]);
});

test("a change of the rules is a proposal, with the proposer's own vote when they vote", () => {
  const read = fakeRead();
  const limit = buildConfig({ network: "devnet", read, wallet, alsoApprove: true, change: { type: "addLimit", asset: "SOL", amountRaw: "1000000000", period: "month", spenders: [agent], destinations: [recipients[2]] } });
  assert.equal(limit.index, 5n);
  const [create, proposal, approve] = limit.groups[0].instructions;
  const actions = decode(generated.configTransactionCreateStruct, create).args.actions;
  assert.equal(actions[0].__kind, "AddSpendingLimit");
  assert.equal(actions[0].mint.toBase58(), PublicKey.default.toBase58(), "SOL is the default key");
  assert.deepEqual(actions[0].destinations.map(String), [recipients[2]]);
  assert.ok(proposal && approve);
  const timeLock = buildConfig({ network: "devnet", read, wallet, alsoApprove: false, change: { type: "timeLock", seconds: 3_600 } });
  assert.equal(timeLock.groups[0].instructions.length, 2);
  assert.deepEqual(decode(generated.configTransactionCreateStruct, timeLock.groups[0].instructions[0]).args.actions, [{ __kind: "SetTimeLock", newTimeLock: 3_600 }]);
});

test("executions never share a transaction: each carries its own compute limit, and a transaction holds one at most", () => {
  const wallet$ = new PublicKey(wallet);
  const exec = () => ({ instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), SystemProgram.transfer({ fromPubkey: wallet$, toPubkey: wallet$, lamports: 1 })], alone: true });
  const plain = () => ({ instructions: [SystemProgram.transfer({ fromPubkey: wallet$, toPubkey: wallet$, lamports: 2 })] });
  const packed = pack([exec(), exec(), plain(), plain(), exec()], wallet$);
  assert.deepEqual(packed.map((groups) => groups.length), [1, 1, 2, 1]);
  for (const groups of packed) {
    const limits = groups.flatMap((group) => group.instructions).filter((ix) => ix.programId.equals(ComputeBudgetProgram.programId));
    assert.ok(limits.length <= 1);
  }
});

test("limits set as Phantom asks: legacy bytes open with the loaded-data limit; on v1 an execution's compute limit moves into the config", () => {
  const wallet$ = new PublicKey(wallet);
  const transfer = () => SystemProgram.transfer({ fromPubkey: wallet$, toPubkey: wallet$, lamports: 1 });
  const exec = { instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), transfer()], alone: true };
  const [limit, ...rest] = legacyInstructions([exec]);
  assert.ok(limit.programId.equals(ComputeBudgetProgram.programId));
  assert.equal(limit.data[0], 4);
  assert.equal(limit.data.readUInt32LE(1), 16 * 1024 * 1024);
  assert.equal(rest.length, 2, "the group's own instructions follow, unchanged");
  /* The size the pack counts is the size sent: the limit is in it. */
  const bare = new Transaction({ feePayer: wallet$, blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 0 }).add(transfer());
  assert.ok(sizeOf([{ instructions: [transfer()] }], wallet$) > bare.serialize({ requireAllSignatures: false, verifySignatures: false }).length);

  const v1 = v1Parts([exec]);
  assert.equal(v1.computeUnitLimit, 400_000);
  assert.ok(v1.instructions.every((ix) => !ix.programId.equals(ComputeBudgetProgram.programId)), "no Compute Budget instruction on v1");
  /* Without one: what legacy bytes get by default, 200,000 an instruction, never past the runtime's 1,400,000. */
  assert.equal(v1Parts([{ instructions: [transfer(), transfer()] }]).computeUnitLimit, 400_000);
  assert.equal(v1Parts([{ instructions: Array.from({ length: 9 }, transfer) }]).computeUnitLimit, 1_400_000);
});

test("votes: for, against, and a cancel while the delay runs", () => {
  const read = fakeRead();
  const discriminator = (vote) => buildVote({ read, wallet, index: 3n, vote })[0].instructions[0].data.subarray(0, 8).toString("hex");
  assert.equal(discriminator("approve"), Buffer.from(generated.proposalApproveInstructionDiscriminator).toString("hex"));
  assert.equal(discriminator("reject"), Buffer.from(generated.proposalRejectInstructionDiscriminator).toString("hex"));
  assert.equal(discriminator("cancel"), Buffer.from(generated.proposalCancelV2InstructionDiscriminator).toString("hex"));
});

test("spending from a limit needs no vote; a USDC recipient's account is opened by the wallet first", () => {
  const read = fakeRead();
  const limit = { address: Keypair.generate().publicKey.toBase58(), asset: "USDC", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", amountRaw: "10", remainingRaw: "10", period: "day", lastReset: 0, spenders: [wallet], destinations: [recipients[3]] };
  const [group] = buildSpend({ network: "devnet", read, wallet, limit, amountRaw: 4n, to: recipients[3] });
  assert.equal(group.instructions.length, 2);
  assert.ok(group.instructions[0].keys[0].pubkey.equals(new PublicKey(wallet)), "the wallet pays for the account");
  const use = decode(generated.spendingLimitUseStruct, group.instructions[1]).args;
  assert.equal(Number(use.amount), 4);
  assert.equal(use.decimals, 6);
});

test("a limit's period turns over: the whole amount is available again", () => {
  const limit = { amountRaw: "100", remainingRaw: "10", period: "day", lastReset: 1_000 };
  assert.equal(limitAvailable(limit, 1_000 + 3_600), 10n);
  assert.equal(limitAvailable(limit, 1_000 + 86_400), 100n);
  assert.equal(limitAvailable({ ...limit, period: "once" }, 10_000_000), 10n, "a one-time limit never refills");
});

test("a top-up goes from the wallet to the vault: SOL by transfer; USDC checked, the vault's account opened by the wallet first", () => {
  const read = fakeRead();
  const [sol] = buildDeposit({ network: "devnet", vault: read.vault, wallet, asset: "SOL", amountRaw: 10_000_000n });
  assert.equal(sol.instructions.length, 1);
  const [transfer] = sol.instructions;
  assert.ok(transfer.programId.equals(SystemProgram.programId));
  assert.ok(transfer.keys[0].pubkey.equals(new PublicKey(wallet)) && transfer.keys[0].isSigner, "from the wallet, signed by it");
  assert.ok(transfer.keys[1].pubkey.equals(read.vault), "to the vault itself, nowhere else");
  assert.equal(transfer.data.readBigUInt64LE(4), 10_000_000n);
  const [usdc] = buildDeposit({ network: "devnet", vault: read.vault, wallet, asset: "USDC", amountRaw: 2_000_000n });
  const [open, checked] = usdc.instructions;
  assert.equal(open.data[0], 1, "create idempotent");
  assert.ok(open.keys[0].pubkey.equals(new PublicKey(wallet)), "the wallet pays the vault account's rent");
  assert.ok(open.keys[2].pubkey.equals(read.vault), "the account is the vault's");
  assert.equal(checked.data[0], 12, "TransferChecked");
  assert.equal(checked.data.readBigUInt64LE(1), 2_000_000n);
  assert.equal(checked.data[9], 6, "USDC's six decimals");
  assert.ok(checked.keys[2].pubkey.equals(open.keys[1].pubkey), "into the vault's USDC account");
  assert.ok(checked.keys[3].pubkey.equals(new PublicKey(wallet)) && checked.keys[3].isSigner, "the wallet is the authority");
  assert.equal(checked.keys[1].pubkey.toBase58(), "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "Circle's devnet USDC");
  /* Nothing of Ryntra's rides along: the System, the Token and the Associated Token programs only. */
  for (const instruction of [...sol.instructions, ...usdc.instructions]) assert.ok(["11111111111111111111111111111111", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"].includes(instruction.programId.toBase58()));
});

/** A node that answers from a map of accounts: address → { data, owner }. */
function mapNode(accounts) {
  const info = (address) => {
    const found = accounts.get(address.toBase58());
    return found ? { data: found.data, owner: found.owner ?? program, lamports: found.lamports ?? 1_000_000, executable: false, rentEpoch: 0 } : null;
  };
  return { getAccountInfo: async (address) => info(address), getMultipleAccountsInfo: async (keys) => keys.map(info) };
}

function multisigAccount(createKey, members = [wallet]) {
  const [address] = multisig.getMultisigPda({ createKey });
  const [vault] = multisig.getVaultPda({ multisigPda: address, index: 0 });
  const [data] = multisig.accounts.Multisig.fromArgs({
    createKey,
    configAuthority: PublicKey.default,
    threshold: 1,
    timeLock: 0,
    transactionIndex: 3,
    staleTransactionIndex: 0,
    rentCollector: vault,
    bump: 255,
    members: members.map((member) => ({ key: new PublicKey(member), permissions: { mask: 7 } })),
  }).serialize();
  return { address, vault, data };
}

/** A batch line as Squads stores it: the vault's message with four-byte lengths. */
function lineAccount(vault, instructions) {
  const message = new TransactionMessage({ payerKey: vault, recentBlockhash: PublicKey.default.toBase58(), instructions });
  const [decoded] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message, vaultPda: vault })));
  const stored = {
    ...decoded,
    instructions: decoded.instructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accountIndexes: Uint8Array.from(ix.accountIndexes), data: Uint8Array.from(ix.data) })),
    addressTableLookups: [],
  };
  return multisig.accounts.VaultBatchTransaction.fromArgs({ bump: 255, ephemeralSignerBumps: Uint8Array.from([]), message: stored }).serialize()[0];
}

test("a treasury is read only from a real multisig: its own kind of account, at the address its createKey derives", async () => {
  const real = multisigAccount(Keypair.generate().publicKey);
  const accounts = new Map([[real.address.toBase58(), { data: real.data }]]);
  const read = await readMultisig(mapNode(accounts), real.address.toBase58());
  assert.ok(read.vault.equals(real.vault));
  assert.equal(read.dataLength, real.data.length);
  /* A batch line someone wrote, owned by Squads: the SDK's decoder alone would read its bytes as a 1-of-1 multisig. */
  const fake = Keypair.generate().publicKey;
  accounts.set(fake.toBase58(), { data: lineAccount(real.vault, [SystemProgram.transfer({ fromPubkey: real.vault, toPubkey: fake, lamports: 1 })]) });
  await assert.rejects(readMultisig(mapNode(accounts), fake.toBase58()), { code: "TREASURY_NOT_SQUADS" });
  /* A multisig's own bytes copied to another address are not that multisig. */
  const elsewhere = Keypair.generate().publicKey;
  accounts.set(elsewhere.toBase58(), { data: real.data });
  await assert.rejects(readMultisig(mapNode(accounts), elsewhere.toBase58()), { code: "TREASURY_NOT_SQUADS" });
  /* Not Squads' account at all. */
  accounts.set(elsewhere.toBase58(), { data: real.data, owner: SystemProgram.programId });
  await assert.rejects(readMultisig(mapNode(accounts), elsewhere.toBase58()), { code: "TREASURY_NOT_SQUADS" });
});

test("rent is counted as Squads sizes the accounts: a change's actions, a batch line's stored message, a full multisig's ten new places", () => {
  /* The actions as Squads stores them (`ConfigTransaction::size`): 85 bytes of frame and each action's own bytes. */
  assert.equal(configTransactionBytes([{ __kind: "ChangeThreshold", newThreshold: 2 }]), 85 + 3);
  assert.equal(configTransactionBytes([{ __kind: "AddMember", newMember: { key: PublicKey.default, permissions: { mask: 2 } } }]), 85 + 34);
  const limit = { __kind: "AddSpendingLimit", createKey: PublicKey.default, vaultIndex: 0, mint: PublicKey.default, amount: 1, period: 1, members: [PublicKey.default], destinations: [PublicKey.default, PublicKey.default] };
  assert.equal(configTransactionBytes([limit]), 85 + 83 + 32 + 64);
  /* A batch line's account: the SDK's own serialization of what Squads stores. */
  const vault = Keypair.generate().publicKey;
  for (const asset of ["SOL", "USDC"]) {
    const instructions = payoutInstructions({ network: "devnet", vault, asset, payout: { to: recipients[5], amountRaw: 5n } });
    const message = new TransactionMessage({ payerKey: vault, recentBlockhash: PublicKey.default.toBase58(), instructions });
    assert.equal(batchLineBytes(multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message, vaultPda: vault })), lineAccount(vault, instructions).length, asset);
  }
  /* A multisig made for two has no room: the third member grows it by ten places, the executor pays the rent of those. */
  const full = { dataLength: multisigBytes(2), lamports: rentExemptLamports(multisigBytes(2)) };
  assert.equal(addMemberRent(full, 3), rentExemptLamports(multisigBytes(2) + 330) - full.lamports);
  assert.equal(addMemberRent({ dataLength: multisigBytes(2) + 330, lamports: rentExemptLamports(multisigBytes(2) + 330) }, 4), 0n, "room left: nothing to pay");
});

test("an approved batch's remaining lines are read whatever the list read: sums, accounts the vault opens, and lines this page cannot show", async () => {
  const treasury = multisigAccount(Keypair.generate().publicKey);
  const accounts = new Map([[treasury.address.toBase58(), { data: treasury.data }]]);
  const read = await readMultisig(mapNode(accounts), treasury.address.toBase58());
  const index = 7n;
  const [batchPda] = multisig.getTransactionPda({ multisigPda: treasury.address, index });
  const [batch] = multisig.accounts.Batch.fromArgs({ multisig: treasury.address, creator: new PublicKey(wallet), index, bump: 255, vaultIndex: 0, vaultBump: 255, size: 3, executedTransactionIndex: 1 }).serialize();
  accounts.set(batchPda.toBase58(), { data: batch });
  const line = (item, instructions) => accounts.set(multisig.getBatchTransactionPda({ multisigPda: treasury.address, batchIndex: index, transactionIndex: item })[0].toBase58(), { data: lineAccount(treasury.vault, instructions) });
  const usdcLine = (to, raw) => payoutInstructions({ network: "devnet", vault: treasury.vault, asset: "USDC", payout: { to, amountRaw: raw } });
  /* Line 1 has run; lines 2 and 3 remain: 2 + 3 USDC to two recipients, one of whom already has an account. */
  line(1, usdcLine(recipients[10], 1_000_000n));
  line(2, usdcLine(recipients[11], 2_000_000n));
  line(3, usdcLine(recipients[12], 3_000_000n));
  const usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  accounts.set(getAssociatedTokenAddressSync(usdcMint, new PublicKey(recipients[12]), true).toBase58(), { data: Buffer.alloc(165), owner: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") });
  const remaining = await batchRemaining(mapNode(accounts), read, index, "devnet");
  assert.equal(remaining.items, 2);
  assert.deepEqual(remaining.sums, [{ asset: "USDC", raw: 5_000_000n, lines: 2 }]);
  /* Whom: the wallets, read from the accounts opened beside each payment. */
  assert.deepEqual(remaining.recipients, [recipients[11], recipients[12]]);
  assert.equal(remaining.newTokenAccounts, 1);
  assert.equal(remaining.foreign, false);
  /* A line that pays from somewhere other than the vault, or does something else, is not run from this page. */
  const stranger = Keypair.generate().publicKey;
  line(3, [SystemProgram.transfer({ fromPubkey: stranger, toPubkey: new PublicKey(recipients[13]), lamports: 5 })]);
  assert.equal((await batchRemaining(mapNode(accounts), read, index, "devnet")).foreign, true);
});

test("a refusal names its instruction, and whose money that instruction spends", () => {
  assert.equal(failedInstructionIndex("Transaction simulation failed: Error processing Instruction 1: custom program error: 0x1"), 1);
  assert.equal(failedInstructionIndex('{"InstructionError":[2,{"Custom":6021}]}'), 2);
  assert.equal(failedInstructionIndex("Blockhash not found"), null);
  const read = fakeRead();
  const walletKey = new PublicKey(wallet);
  const tx = (instructions) => new Transaction({ feePayer: walletKey, blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 0 }).add(...instructions);
  /* A USDC spend: the recipient's account is the wallet's to open (0); the limit's payment is the vault's (1). */
  const limit = { address: Keypair.generate().publicKey.toBase58(), asset: "USDC", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", amountRaw: "10", remainingRaw: "10", period: "day", lastReset: 0, spenders: [wallet], destinations: [recipients[3]] };
  const spend = tx(buildSpend({ network: "devnet", read, wallet, limit, amountRaw: 4n, to: recipients[3] })[0].instructions);
  assert.equal(payerOf(spend, 0), "wallet");
  assert.equal(payerOf(spend, 1), "vault");
  /* A vote is the wallet's; an instruction not in the transaction, or none named, is not guessed. */
  const vote = tx(buildVote({ read, wallet, index: 3n, vote: "approve" })[0].instructions);
  assert.equal(payerOf(vote, 0), "wallet");
  assert.equal(payerOf(vote, 5), null);
  assert.equal(payerOf(vote, null), null);
});

test("Squads' refusals are named only when Squads itself refused; another program's numbers and names are not read as Squads'", () => {
  const squads = program.toBase58();
  const guard = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
  const logs = (...lines) => lines.join("\n");
  /* Thrown by Squads: its name. */
  assert.equal(
    squadsErrorName(logs(`Program ${squads} invoke [1]`, "Program log: AnchorError thrown in programs/squads_multisig_program/src/instructions/batch_execute_transaction.rs:107. Error Code: TimeLockNotReleased. Error Number: 6021.", `Program ${squads} failed: custom program error: 0x1785`)),
    "TimeLockNotReleased",
  );
  assert.equal(squadsErrorName(logs(`Program ${squads} invoke [1]`, `Program ${squads} failed: custom program error: 0x1777`)), "StaleProposal");
  /* A wallet guard's own 6000s, failing first: not Squads'. */
  assert.equal(squadsErrorName(logs(`Program ${guard} invoke [1]`, `Program ${guard} failed: custom program error: 0x1770`)), null);
  /* An inner program refusing under Squads: the first to fail is not Squads. */
  assert.equal(squadsErrorName(logs(`Program ${squads} invoke [1]`, "Program 11111111111111111111111111111111 invoke [2]", "Program 11111111111111111111111111111111 failed: custom program error: 0x1", `Program ${squads} failed: custom program error: 0x1`)), null);
  /* Without logs: a bare number of an instruction that is Squads'. */
  const read = fakeRead();
  const vote = new Transaction({ feePayer: new PublicKey(wallet), blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 0 }).add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), ...buildVote({ read, wallet, index: 3n, vote: "approve" })[0].instructions);
  assert.equal(squadsErrorName('{"InstructionError":[1,{"Custom":6010}]}', vote, 1), "AlreadyApproved");
  assert.equal(squadsErrorName('{"InstructionError":[0,{"Custom":6010}]}', vote, 0), null, "the compute budget program is not Squads");
});

test("a line reads as the vault's own payment only when every account is named in it, and an account it opens is USDC's", () => {
  const vault = Keypair.generate().publicKey;
  const to = Keypair.generate().publicKey;
  const decode = (instructions) => {
    const message = new TransactionMessage({ payerKey: vault, recentBlockhash: PublicKey.default.toBase58(), instructions });
    return multisig.types.transactionMessageBeet.deserialize(Buffer.from(multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message, vaultPda: vault })))[0];
  };
  const plain = decode([SystemProgram.transfer({ fromPubkey: vault, toPubkey: to, lamports: 5 })]);
  assert.deepEqual({ ...readLine(plain, { vault }, "devnet"), opened: [] }, { sol: 5n, usdc: 0n, solLines: 1, usdcLines: 0, opened: [], recipients: [to.toBase58()], foreign: false });
  /* The recipient loaded from a lookup table: an index past the named keys — never shown, so never «for». */
  const looked = { ...plain, instructions: plain.instructions.map((ix) => ({ ...ix, accountIndexes: [ix.accountIndexes[0], plain.accountKeys.length + 3] })), addressTableLookups: [{ accountKey: Keypair.generate().publicKey, writableIndexes: [3], readonlyIndexes: [] }] };
  assert.equal(readLine(looked, { vault }, "devnet").foreign, true);
  assert.equal(readLine({ ...looked, addressTableLookups: [] }, { vault }, "devnet").foreign, true, "an index past the keys alone");
  /* An account the vault opens for another token is not a USDC account this page pays for. */
  const otherMint = Keypair.generate().publicKey;
  const other = decode([openAccount(vault, to, otherMint)]);
  assert.equal(readLine(other, { vault }, "devnet").foreign, true);
});

function openAccount(payer, owner, mint) {
  return createAssociatedTokenAccountIdempotentInstruction(payer, getAssociatedTokenAddressSync(mint, owner, true), owner, mint);
}

test("an account the vault opens must be paid in the same line: one opened for nothing is vault rent to someone unnamed", () => {
  const vault = Keypair.generate().publicKey;
  const usdc = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  const decode = (instructions) => {
    const message = new TransactionMessage({ payerKey: vault, recentBlockhash: PublicKey.default.toBase58(), instructions });
    return multisig.types.transactionMessageBeet.deserialize(Buffer.from(multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message, vaultPda: vault })))[0];
  };
  const owner = () => Keypair.generate().publicKey;
  /* Only opens: nothing paid, accounts handed out. */
  const onlyOpens = decode([owner(), owner()].map((who) => createAssociatedTokenAccountIdempotentInstruction(vault, getAssociatedTokenAddressSync(usdc, who, true), who, usdc)));
  assert.equal(readLine(onlyOpens, { vault }, "devnet").foreign, true);
  /* A real payout plus one more account opened for someone else. */
  const paid = owner();
  const extra = owner();
  const mixed = decode([...payoutInstructions({ network: "devnet", vault, asset: "USDC", payout: { to: paid.toBase58(), amountRaw: 5n } }), createAssociatedTokenAccountIdempotentInstruction(vault, getAssociatedTokenAddressSync(usdc, extra, true), extra, usdc)]);
  assert.equal(readLine(mixed, { vault }, "devnet").foreign, true);
  /* The page's own payout: opened and paid, its owner named. */
  const own = readLine(decode(payoutInstructions({ network: "devnet", vault, asset: "USDC", payout: { to: paid.toBase58(), amountRaw: 5n } })), { vault }, "devnet");
  assert.equal(own.foreign, false);
  assert.deepEqual(own.recipients, [paid.toBase58()]);
});

test("rent is the network's own rate, read from it; a failed read keeps the last", async () => {
  await refreshRentRate({ getMinimumBalanceForRentExemption: async () => 128 * 5_080 }, Date.now() + 1e12);
  assert.equal(rentExemptLamports(0), 650_240n);
  assert.equal(rentExemptLamports(165), 1_488_440n, "a token account, as the network answers it");
  await refreshRentRate({ getMinimumBalanceForRentExemption: async () => { throw new Error("down"); } }, Date.now() + 2e12);
  assert.equal(rentExemptLamports(0), 650_240n);
});

test("a line paying the treasury's own multisig account is not a payout this page approves or runs", () => {
  const read = fakeRead();
  const message = new TransactionMessage({ payerKey: read.vault, recentBlockhash: PublicKey.default.toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: read.vault, toPubkey: read.address, lamports: 5 })] });
  const [decoded] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message, vaultPda: read.vault })));
  assert.equal(readLine(decoded, read, "devnet").foreign, true);
});

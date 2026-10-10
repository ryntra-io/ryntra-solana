import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { CpAmmIdl } from "@meteora-ag/cp-amm-sdk";
import { DynamicBondingCurveIdl } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { EXECUTOR_INSTRUCTIONS, executorSigningRefusal as refusal } from "./executor-signing.server.ts";

/* DLMM's module build does not load under plain Node; its CommonJS build does — the IDL is the same. */
const { IDL: DlmmIdl } = createRequire(import.meta.url)("@meteora-ag/dlmm");
const executorSigningRefusal = (instructions, executorAddress, payees) => refusal(instructions, executorAddress, DlmmIdl, payees);

/* Synthetic keys only: the executor, a stranger, a token on Token-2022 and USDC on the classic token program. */
const executor = Keypair.generate().publicKey;
const stranger = Keypair.generate().publicKey;
const token = Keypair.generate().publicKey;
const usdc = Keypair.generate().publicKey;
const own = (mint, program) => getAssociatedTokenAddressSync(mint, executor, true, program);

/** An instruction of a Meteora program as its IDL lays it out, every account named in `named` and the rest random. */
function ix(idl, name, named) {
  const shape = idl.instructions.find((entry) => entry.name === name);
  assert.ok(shape, name);
  const keys = shape.accounts.map((account) => ({ pubkey: named[account.name] ?? Keypair.generate().publicKey, isSigner: false, isWritable: true }));
  return new TransactionInstruction({ programId: new PublicKey(idl.address), keys, data: Buffer.from([...shape.discriminator, 0, 0, 0, 0]) });
}

test("the executor signs a partner's claim to its own accounts, its migration, its steps and the opening of its own account", () => {
  const claim = ix(DynamicBondingCurveIdl, "claim_trading_fee", { base_mint: token, quote_mint: usdc, token_a_account: own(token, TOKEN_2022_PROGRAM_ID), token_b_account: own(usdc, TOKEN_PROGRAM_ID), fee_claimer: executor });
  const open = createAssociatedTokenAccountIdempotentInstruction(executor, own(usdc, TOKEN_PROGRAM_ID), executor, usdc, TOKEN_PROGRAM_ID);
  assert.equal(executorSigningRefusal([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), open, claim], executor.toBase58()), null);
  const surplus = ix(DynamicBondingCurveIdl, "partner_withdraw_surplus", { quote_mint: usdc, token_quote_account: own(usdc, TOKEN_PROGRAM_ID), fee_claimer: executor });
  const migrationFee = ix(DynamicBondingCurveIdl, "withdraw_migration_fee", { quote_mint: usdc, token_quote_account: own(usdc, TOKEN_PROGRAM_ID), sender: executor });
  const migration = ix(DynamicBondingCurveIdl, "migration_damm_v2", { payer: executor });
  const lp = ix(CpAmmIdl, "claim_position_fee", { token_a_mint: token, token_b_mint: usdc, token_a_account: own(token, TOKEN_2022_PROGRAM_ID), token_b_account: own(usdc, TOKEN_PROGRAM_ID), signer: executor });
  const steps = ix(DlmmIdl, "rebalance_liquidity", { token_x_mint: token, token_y_mint: usdc, user_token_x: own(token, TOKEN_2022_PROGRAM_ID), user_token_y: own(usdc, TOKEN_PROGRAM_ID), owner: executor, rent_payer: executor });
  for (const each of [surplus, migrationFee, migration, lp, steps]) assert.equal(executorSigningRefusal([each], executor.toBase58()), null);
});

test("it refuses a claim paid to another wallet's account, a transfer, another program, and a Meteora instruction off its list", () => {
  const elsewhere = ix(DynamicBondingCurveIdl, "claim_trading_fee", { base_mint: token, quote_mint: usdc, token_a_account: own(token, TOKEN_2022_PROGRAM_ID), token_b_account: getAssociatedTokenAddressSync(usdc, stranger, true, TOKEN_PROGRAM_ID), fee_claimer: executor });
  assert.match(executorSigningRefusal([elsewhere], executor.toBase58()), /token_b_account/);
  assert.match(executorSigningRefusal([SystemProgram.transfer({ fromPubkey: executor, toPubkey: stranger, lamports: 1 })], executor.toBase58()), /not on the executor's list/);
  assert.match(executorSigningRefusal([createTransferInstruction(own(usdc, TOKEN_PROGRAM_ID), stranger, executor, 1n)], executor.toBase58()), /not on the executor's list/);
  const creatorFee = ix(DynamicBondingCurveIdl, "claim_creator_trading_fee", { base_mint: token, quote_mint: usdc, creator: executor });
  assert.match(executorSigningRefusal([creatorFee], executor.toBase58()), /claim_creator_trading_fee is not on/);
  const protocol = ix(DlmmIdl, "withdraw_protocol_fee", {});
  assert.match(executorSigningRefusal([protocol], executor.toBase58()), /withdraw_protocol_fee is not on/);
  const foreignOpen = createAssociatedTokenAccountIdempotentInstruction(executor, getAssociatedTokenAddressSync(usdc, stranger, true, TOKEN_PROGRAM_ID), stranger, usdc, TOKEN_PROGRAM_ID);
  assert.match(executorSigningRefusal([foreignOpen], executor.toBase58()), /another wallet/);
  const anotherClaimer = ix(DynamicBondingCurveIdl, "partner_withdraw_surplus", { quote_mint: usdc, token_quote_account: own(usdc, TOKEN_PROGRAM_ID), fee_claimer: stranger });
  assert.match(executorSigningRefusal([anotherClaimer], executor.toBase58()), /fee_claimer/);
});

test("every name on the list is an instruction its program's IDL knows", () => {
  for (const [idl, names] of [[DynamicBondingCurveIdl, EXECUTOR_INSTRUCTIONS.dbc], [CpAmmIdl, EXECUTOR_INSTRUCTIONS.damm], [DlmmIdl, EXECUTOR_INSTRUCTIONS.dlmm]]) {
    for (const name of names) assert.ok(idl.instructions.some((entry) => entry.name === name), name);
  }
});

test("the holders' collector may pay a position's owner — only the owner it names, never a third wallet", () => {
  const holder = Keypair.generate().publicKey;
  const toHolder = ix(CpAmmIdl, "claim_position_fee", { token_a_mint: token, token_b_mint: usdc, token_a_account: getAssociatedTokenAddressSync(token, holder, true, TOKEN_2022_PROGRAM_ID), token_b_account: getAssociatedTokenAddressSync(usdc, holder, true, TOKEN_PROGRAM_ID), signer: executor });
  assert.equal(executorSigningRefusal([toHolder], executor.toBase58(), [holder.toBase58()]), null);
  assert.match(executorSigningRefusal([toHolder], executor.toBase58(), []), /not the executor's own/);
  assert.match(executorSigningRefusal([toHolder], executor.toBase58(), [stranger.toBase58()]), /not the executor's own/);
});

test("a swap only as the pool's proof — small, between its own accounts, no referral — and a bounded compute budget", () => {
  const withAmount = (instruction) => {
    const data = Buffer.alloc(24);
    instruction.data.copy(data, 0, 0, 8);
    instruction.data = data;
    return instruction;
  };
  const proof = withAmount(ix(CpAmmIdl, "swap", { token_a_mint: token, token_b_mint: usdc, input_token_account: own(usdc, TOKEN_PROGRAM_ID), output_token_account: own(token, TOKEN_2022_PROGRAM_ID), payer: executor, referral_token_account: new PublicKey(CpAmmIdl.address) }));
  proof.data.writeBigUInt64LE(10_000n, 8);
  assert.equal(executorSigningRefusal([proof], executor.toBase58()), null);
  const big = withAmount(ix(CpAmmIdl, "swap", { token_a_mint: token, token_b_mint: usdc, input_token_account: own(usdc, TOKEN_PROGRAM_ID), output_token_account: own(token, TOKEN_2022_PROGRAM_ID), payer: executor, referral_token_account: new PublicKey(CpAmmIdl.address) }));
  big.data.writeBigUInt64LE(5_000_000n, 8);
  assert.match(executorSigningRefusal([big], executor.toBase58()), /ceiling/);
  const referred = withAmount(ix(CpAmmIdl, "swap", { token_a_mint: token, token_b_mint: usdc, input_token_account: own(usdc, TOKEN_PROGRAM_ID), output_token_account: own(token, TOKEN_2022_PROGRAM_ID), payer: executor, referral_token_account: getAssociatedTokenAddressSync(usdc, stranger, true, TOKEN_PROGRAM_ID) }));
  referred.data.writeBigUInt64LE(10_000n, 8);
  assert.match(executorSigningRefusal([referred], executor.toBase58()), /referral/);
  assert.equal(executorSigningRefusal([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })], executor.toBase58()), null);
  assert.match(executorSigningRefusal([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000_000 })], executor.toBase58()), /compute-budget/);
});

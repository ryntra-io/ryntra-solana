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
  /* CITY-196: the proof only with the pool it opens, after it in the same message. */
  const pool = ix(DlmmIdl, "initialize_customizable_permissionless_lb_pair2", { token_mint_x: token, token_mint_y: usdc, user_token_x: own(token, TOKEN_2022_PROGRAM_ID), user_token_y: own(usdc, TOKEN_PROGRAM_ID), funder: executor });
  assert.equal(executorSigningRefusal([proof, pool], executor.toBase58()), null);
  const big = withAmount(ix(CpAmmIdl, "swap", { token_a_mint: token, token_b_mint: usdc, input_token_account: own(usdc, TOKEN_PROGRAM_ID), output_token_account: own(token, TOKEN_2022_PROGRAM_ID), payer: executor, referral_token_account: new PublicKey(CpAmmIdl.address) }));
  big.data.writeBigUInt64LE(5_000_000n, 8);
  assert.match(executorSigningRefusal([big, pool], executor.toBase58()), /ceiling/);
  const referred = withAmount(ix(CpAmmIdl, "swap", { token_a_mint: token, token_b_mint: usdc, input_token_account: own(usdc, TOKEN_PROGRAM_ID), output_token_account: own(token, TOKEN_2022_PROGRAM_ID), payer: executor, referral_token_account: getAssociatedTokenAddressSync(usdc, stranger, true, TOKEN_PROGRAM_ID) }));
  referred.data.writeBigUInt64LE(10_000n, 8);
  assert.match(executorSigningRefusal([referred, pool], executor.toBase58()), /referral/);
  assert.equal(executorSigningRefusal([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })], executor.toBase58()), null);
  assert.match(executorSigningRefusal([ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000_000 })], executor.toBase58()), /compute-budget/);
});

test("CITY-196: the executor buys no coin — a swap is signed only as the proof of a DLMM pool it opens after it, of that pool's coin", () => {
  const swapOf = (mint, program) => {
    const instruction = ix(CpAmmIdl, "swap", { token_a_mint: mint, token_b_mint: usdc, input_token_account: own(usdc, TOKEN_PROGRAM_ID), output_token_account: own(mint, program), payer: executor, referral_token_account: new PublicKey(CpAmmIdl.address) });
    const data = Buffer.alloc(24);
    instruction.data.copy(data, 0, 0, 8);
    data.writeBigUInt64LE(10_000n, 8);
    instruction.data = data;
    return instruction;
  };
  const poolOf = (mint) => ix(DlmmIdl, "initialize_customizable_permissionless_lb_pair2", { token_mint_x: mint, token_mint_y: usdc, user_token_x: own(mint, TOKEN_2022_PROGRAM_ID), user_token_y: own(usdc, TOKEN_PROGRAM_ID), funder: executor });
  const buy = swapOf(token, TOKEN_2022_PROGRAM_ID);
  /* A launch's coin bought on its own — no pool opened: refused, however small. */
  assert.match(executorSigningRefusal([buy], executor.toBase58()), /no new pool's proof — the executor buys no coin/);
  /* The pool opened first and the swap after it: not the proof the opening asks for. */
  assert.match(executorSigningRefusal([poolOf(token), buy], executor.toBase58()), /no new pool's proof/);
  /* A pool of another coin after it: the swap buys a coin that pool does not ask for. */
  const other = Keypair.generate().publicKey;
  assert.match(executorSigningRefusal([buy, poolOf(other)], executor.toBase58()), /does not buy the new pool's coin/);
  /* The proof itself: the coin of the pool opened after it, into the executor's own account — on either token program. */
  assert.equal(executorSigningRefusal([buy, poolOf(token)], executor.toBase58()), null);
  assert.equal(executorSigningRefusal([swapOf(other, TOKEN_PROGRAM_ID), poolOf(other)], executor.toBase58()), null);
});

test("every way the collector's tries on a holder's position took on mainnet is refused here too, before any signature", () => {
  /* The same tries the chain refused (docs/research/launch-holder-autopilot-2026-10-07/mainnet-2026-10-11.json): a second
     wall, so the executor's key never signs one of them whatever a pass would build. */
  const holder = Keypair.generate().publicKey;
  const nft = Keypair.generate().publicKey;
  const nftAccount = Keypair.generate().publicKey;
  const holderUsdc = getAssociatedTokenAddressSync(usdc, holder, true, TOKEN_PROGRAM_ID);
  const holderToken = getAssociatedTokenAddressSync(token, holder, true, TOKEN_2022_PROGRAM_ID);
  const toOwn = { token_a_mint: token, token_b_mint: usdc, token_a_account: own(token, TOKEN_2022_PROGRAM_ID), token_b_account: own(usdc, TOKEN_PROGRAM_ID), signer: executor };
  const toHolder = { token_a_mint: token, token_b_mint: usdc, token_a_account: holderToken, token_b_account: holderUsdc, signer: executor };
  const tries = [
    ix(CpAmmIdl, "remove_liquidity", toOwn),
    ix(CpAmmIdl, "remove_all_liquidity", toOwn),
    ix(CpAmmIdl, "remove_liquidity", toHolder),
    ix(CpAmmIdl, "add_liquidity", toHolder),
    ix(CpAmmIdl, "permanent_lock_position", { signer: executor }),
    ix(CpAmmIdl, "close_position", { owner: executor, rent_receiver: executor }),
    ix(CpAmmIdl, "update_delegate_permission", { owner: executor }),
    ix(CpAmmIdl, "split_position", { first_owner: executor, second_owner: executor }),
    createTransferInstruction(nftAccount, own(nft, TOKEN_2022_PROGRAM_ID), executor, 1, [], TOKEN_2022_PROGRAM_ID),
    createTransferInstruction(holderUsdc, own(usdc, TOKEN_PROGRAM_ID), executor, 1, [], TOKEN_PROGRAM_ID),
    new TransactionInstruction({ programId: new PublicKey("zapvX9M3uf5pvy4wRPAbQgdQsM1xmuiFnkfHKPvwMiz"), keys: [{ pubkey: executor, isSigner: true, isWritable: true }], data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) }),
    /* The fees of the holder's position to a third wallet's accounts, though the holder is the payee named. */
    ix(CpAmmIdl, "claim_position_fee", { ...toHolder, token_b_account: getAssociatedTokenAddressSync(usdc, stranger, true, TOKEN_PROGRAM_ID) }),
  ];
  for (const each of tries) assert.notEqual(executorSigningRefusal([each], executor.toBase58(), [holder.toBase58()]), null, each.programId.toBase58());
  /* The one it signs: the holder's fees to the holder's own accounts. */
  assert.equal(executorSigningRefusal([ix(CpAmmIdl, "claim_position_fee", toHolder)], executor.toBase58(), [holder.toBase58()]), null);
});

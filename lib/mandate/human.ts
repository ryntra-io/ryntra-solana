/**
 * CITY-174 — what the person signs: turn the agent on, stop it, take the rest back. Each is one transaction and one
 * signature of her wallet; nothing here holds or asks for a key.
 *
 * - **Enable.** Her smart account (created in the same transaction when she has none), the budget moved into its vault,
 *   and the agent's policy — the terms of `./terms.ts` — at once. She pays the policy's rent, and it comes back to her
 *   when the policy goes.
 * - **Stop.** The policy removed: from the next block the agent can sign whatever it likes — nothing it signs moves the
 *   budget. A trade it prepared before falls on chain (CITY-136 §2, §7).
 * - **Withdraw.** As the smart account's settings signer she moves the rest to her wallet herself: no policy, no agent,
 *   no Ryntra in the way. SOL comes back unwrapped.
 */

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createHarvestWithheldTokensToMintInstruction,
  createSyncNativeInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount } from "@solana/web3.js";

import {
  ALL_PERMISSIONS,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createSmartAccountInstruction,
  nextPolicySeed,
  ownerExecuteInstruction,
  settingsSyncInstruction,
  ssaAddress,
  type ProgramConfig,
  type SettingsState,
} from "./ssa.ts";
import { budgetProgramOf, budgetToken, mandatePolicy, termsRefusal, type MandateTerms } from "./terms.ts";

export type Cluster = "devnet" | "mainnet";

/** One mandate: the terms and the accounts they live in. Public data only. */
export type Mandate = Readonly<{
  cluster: Cluster;
  terms: MandateTerms;
  settings: PublicKey;
  vault: PublicKey;
  policy: PublicKey;
  policySeed: bigint;
  /** The vault's token account of the budget — the only account the agent may spend from. */
  budgetAccount: PublicKey;
}>;

/** The person's smart account as the chain has it: none yet (the program's config names the next one), or hers. */
export type SmartAccount = Readonly<{ kind: "absent"; config: ProgramConfig }> | Readonly<{ kind: "present"; settings: PublicKey; state: SettingsState }>;

/**
 * The person's transactions, in the order they land: one when everything fits a packet (the devnet stand, a person who
 * already has a smart account), two otherwise — the account and the budget first, then the policy — both asked of her
 * wallet at once, one approval.
 */
export type EnablePlan = Readonly<{ mandate: Mandate; transactions: readonly (readonly TransactionInstruction[])[] }>;

/** The owner's canonical account of `mint` under the coin's token program — Token's unless named (CITY-184). */
export const tokenAccountOf = (owner: PublicKey, mint: PublicKey, program: PublicKey = TOKEN_PROGRAM_ID) => getAssociatedTokenAddressSync(mint, owner, true, program);

/** A token the agent buys for her: its mint, and its program when it is not Token's (a coin of Token-2022). */
export type ReceiveMint = PublicKey | Readonly<{ mint: PublicKey; program: PublicKey }>;

const receiveOf = (entry: ReceiveMint): Readonly<{ mint: PublicKey; program: PublicKey }> => (entry instanceof PublicKey ? { mint: entry, program: TOKEN_PROGRAM_ID } : entry);

/**
 * Turn the agent on: one transaction the person signs. `fund` moves that much of the budget's token into the vault;
 * `receiveMints` — the tokens the agent buys for her whose accounts she opens now (her own; their rent is hers and stays
 * hers); `agentFeeLamports` — SOL for the agent's network fees, when the person pays them.
 */
export function planEnable(
  input: Readonly<{ cluster: Cluster; terms: MandateTerms; account: SmartAccount; fund: bigint; nowSeconds: bigint; receiveMints?: readonly ReceiveMint[]; agentFeeLamports?: bigint }>,
): EnablePlan {
  const { terms } = input;
  const refusal = termsRefusal(terms, input.nowSeconds);
  if (refusal) throw new Error(`The mandate is not written: ${refusal}.`);
  if (input.fund < 0n) throw new Error("The budget moved in is not negative.");
  const human = terms.human;
  const instructions: TransactionInstruction[] = [];

  let settings: PublicKey;
  let policySeed: bigint;
  if (input.account.kind === "absent") {
    settings = ssaAddress.settings(input.account.config.smartAccountIndex + 1n);
    instructions.push(createSmartAccountInstruction({ creator: human, treasury: input.account.config.treasury, settings }));
    policySeed = 1n;
  } else {
    if (!input.account.state.signers.some((signer) => signer.key.equals(human)) || input.account.state.threshold !== 1 || input.account.state.timeLock !== 0) {
      throw new Error("The smart account is not one the person alone controls at once.");
    }
    settings = input.account.settings;
    policySeed = nextPolicySeed(input.account.state);
  }
  const vault = ssaAddress.vault(settings, 0);
  const policy = ssaAddress.policy(settings, policySeed);
  const budgetProgram = budgetProgramOf(terms);
  const budgetAccount = tokenAccountOf(vault, terms.budgetMint, budgetProgram);

  instructions.push(createAssociatedTokenAccountIdempotentInstruction(human, budgetAccount, vault, terms.budgetMint, budgetProgram));
  if (input.fund > 0n) {
    if (terms.budgetMint.equals(NATIVE_MINT)) {
      instructions.push(SystemProgram.transfer({ fromPubkey: human, toPubkey: budgetAccount, lamports: input.fund }), createSyncNativeInstruction(budgetAccount));
    } else {
      const decimals = budgetDecimalsOf(terms);
      instructions.push(createTransferCheckedInstruction(tokenAccountOf(human, terms.budgetMint, budgetProgram), terms.budgetMint, budgetAccount, human, input.fund, decimals, [], budgetProgram));
    }
  }
  const fixed = terms.fixedBuy;
  const receive = [...(input.receiveMints ?? []).map(receiveOf), ...(fixed ? [{ mint: fixed.outputMint, program: fixed.outputProgram ?? TOKEN_PROGRAM_ID }] : [])];
  for (const { mint, program } of new Map(receive.map((entry) => [entry.mint.toBase58(), entry])).values()) {
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(human, tokenAccountOf(human, mint, program), human, mint, program));
    /* Jupiter's `route_v2` lands the output in the vault's own account of the mint first, then hands it on to her. */
    if (terms.venue.kind === "jupiter") instructions.push(createAssociatedTokenAccountIdempotentInstruction(human, tokenAccountOf(vault, mint, program), vault, mint, program));
  }
  if (input.agentFeeLamports && input.agentFeeLamports > 0n) instructions.push(SystemProgram.transfer({ fromPubkey: human, toPubkey: terms.agent, lamports: input.agentFeeLamports }));

  const policyCreate =
    settingsSyncInstruction({
      settings,
      rentPayer: human,
      signers: [human],
      policyAccounts: [policy],
      actions: [
        {
          kind: "policyCreate",
          create: {
            seed: policySeed,
            policy: mandatePolicy(terms, { vault, budgetAccount }),
            signers: [{ key: terms.agent, permissions: ALL_PERMISSIONS }],
            threshold: 1,
            start: null,
            expiresAt: terms.expiresAt,
          },
        },
      ],
    });
  const mandate: Mandate = { cluster: input.cluster, terms, settings, vault, policy, policySeed, budgetAccount };
  if (fits(human, [...instructions, policyCreate])) return { mandate, transactions: [[...instructions, policyCreate]] };
  if (!fits(human, [policyCreate]) || !fits(human, instructions)) throw new Error("The mandate's policy does not fit one transaction.");
  return { mandate, transactions: [instructions, [policyCreate]] };
}

/** Whether these instructions make one transaction within the packet ceiling. */
export function fits(payer: PublicKey, instructions: readonly TransactionInstruction[]): boolean {
  try {
    return wireSize(unsignedTransaction(payer, instructions, PublicKey.default.toBase58())) <= MAX_TRANSACTION_BYTES;
  } catch {
    /* web3.js refuses to serialize a message over the ceiling. */
    return false;
  }
}

/** Stop the agent: the policy removed; its rent goes back to the person who paid it. */
export function planStop(mandate: Mandate): readonly TransactionInstruction[] {
  const human = mandate.terms.human;
  return [settingsSyncInstruction({ settings: mandate.settings, rentPayer: human, signers: [human], policyAccounts: [mandate.policy], actions: [{ kind: "policyRemove", policy: mandate.policy }] })];
}

/**
 * Take the rest back, as the settings signer: SOL — the vault's wSOL account closed straight into her wallet (all of it,
 * unwrapped, its rent too); USDC or a coin she gave to sell — the balance to her account, then the empty account closed to
 * her. A coin with a transfer fee keeps what it withheld in the account, and the program closes no such account: that
 * share is swept to the coin's mint first — anyone may, and nothing moves to anyone.
 */
export function planWithdraw(mandate: Mandate, balance: bigint, options: Readonly<{ keepOpen?: boolean }> = {}): readonly TransactionInstruction[] {
  const human = mandate.terms.human;
  const mint = mandate.terms.budgetMint;
  const program = budgetProgramOf(mandate.terms);
  const inner: TransactionInstruction[] = [];
  /* CITY-195: a coin's account a working agent still routes its buys through stays open — it is emptied, not closed. */
  const keep = Boolean(options.keepOpen) && !mint.equals(NATIVE_MINT);
  if (!mint.equals(NATIVE_MINT) && balance > 0n) {
    inner.push(createTransferCheckedInstruction(mandate.budgetAccount, mint, tokenAccountOf(human, mint, program), mandate.vault, balance, budgetDecimalsOf(mandate.terms), [], program));
  }
  if (!keep) inner.push(createCloseAccountInstruction(mandate.budgetAccount, human, mandate.vault, [], program));
  if (!inner.length) return [];
  const before = mint.equals(NATIVE_MINT) ? [] : [createAssociatedTokenAccountIdempotentInstruction(human, tokenAccountOf(human, mint, program), human, mint, program)];
  const sweep = !keep && mandate.terms.budgetCoin?.transferFee ? [createHarvestWithheldTokensToMintInstruction(mint, [mandate.budgetAccount], program)] : [];
  return [...before, ...sweep, ownerExecuteInstruction({ settings: mandate.settings, signer: human, instructions: inner })];
}

/** The decimals of the budget's token: SOL's or USDC's, or the coin's own. */
function budgetDecimalsOf(terms: MandateTerms): number {
  if (terms.budgetCoin) return terms.budgetCoin.decimals;
  return budgetToken(terms.budgetMint)!.decimals;
}

/** Stop and take the rest back in one signature. */
export function planStopAndWithdraw(mandate: Mandate, balance: bigint): readonly TransactionInstruction[] {
  return [...planStop(mandate), ...planWithdraw(mandate, balance)];
}

/** A v0 transaction for one payer, unsigned. */
export function unsignedTransaction(payer: PublicKey, instructions: readonly TransactionInstruction[], blockhash: string, lookupTables: readonly AddressLookupTableAccount[] = []): VersionedTransaction {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [...instructions] }).compileToV0Message([...lookupTables]);
  return new VersionedTransaction(message);
}

/** Solana's packet ceiling for one serialized transaction. */
export const MAX_TRANSACTION_BYTES = 1_232;

export const wireSize = (transaction: VersionedTransaction) => transaction.serialize().length;

/**
 * CITY-203 — what the person signs: give the agent the position to look after, stop it, take everything back. Each is
 * signed by their wallet once (one approval, at most three transactions); nothing here holds or asks for a key.
 *
 * - **Enable.** Their smart account (made in the same approval when they have none), what they put in moved into its care
 *   vault (index 1), their own token accounts of the pool's two coins (where every exit lands), a little SOL for the
 *   position's rent (back to them when it closes) and for the agent's network fees, and the pool's two policies. The
 *   agent then opens the position inside the vault.
 * - **Stop.** Both policies removed: from the next block the agent can sign nothing that touches the vault.
 * - **Take back.** As the settings signer they move what the vault holds to their wallet themselves.
 */

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";

import { fits, type Cluster, type SmartAccount } from "../mandate/human.ts";
import { ALL_PERMISSIONS, NATIVE_MINT, createSmartAccountInstruction, nextPolicySeed, settingsSyncInstruction, ssaAddress } from "../mandate/ssa.ts";
import { careOwnerExecuteInstruction, careVaultOf } from "./ssa-care.ts";
import { carePolicies, careTermsRefusal, type CareTerms } from "./terms.ts";

/** One care: the terms and the accounts they live in. Public data only. */
export type Care = Readonly<{
  cluster: Cluster;
  terms: CareTerms;
  settings: PublicKey;
  /** The smart account's vault this care lives in (1, 2, ...); vault 0 is the trading budget's. */
  vaultIndex: number;
  vault: PublicKey;
  exitPolicy: PublicKey;
  tendPolicy: PublicKey;
  exitSeed: bigint;
  tendSeed: bigint;
}>;

/** SOL the vault keeps for the position's rent and its bin arrays — returned to the person when the position closes. */
export const CARE_RENT_LAMPORTS = 120_000_000n;
/** SOL for the agent's network fees, paid by the person once (decision 95: the person pays the agent's way). */
export const CARE_AGENT_FEE_LAMPORTS = 10_000_000n;

export const ownTokenAccount = (owner: PublicKey, mint: PublicKey, program: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, program);

export type CareFund = Readonly<{ x: bigint; y: bigint }>;

export type CareEnablePlan = Readonly<{ care: Care; transactions: readonly (readonly TransactionInstruction[])[] }>;

/** The decimals of a coin the person moves in: the transfer is `transferChecked`. */
export type Decimals = Readonly<{ x: number; y: number }>;

/** Turn the care on: the person's transactions, in the order they land, asked of the wallet at once. */
export function planCareEnable(
  input: Readonly<{ cluster: Cluster; terms: CareTerms; account: SmartAccount; fund: CareFund; decimals: Decimals; nowSeconds: bigint; vaultIndex?: number; rentLamports?: bigint; agentFeeLamports?: bigint }>,
): CareEnablePlan {
  const { terms } = input;
  const refusal = careTermsRefusal(terms, input.nowSeconds);
  if (refusal) throw new Error(`The care is not written: ${refusal}.`);
  if (input.fund.x < 0n || input.fund.y < 0n || input.fund.x + input.fund.y === 0n) throw new Error("Something goes into the care.");
  const human = terms.human;
  const pool = terms.pool;
  const setup: TransactionInstruction[] = [];

  let settings: PublicKey;
  let exitSeed: bigint;
  if (input.account.kind === "absent") {
    settings = ssaAddress.settings(input.account.config.smartAccountIndex + 1n);
    setup.push(createSmartAccountInstruction({ creator: human, treasury: input.account.config.treasury, settings }));
    exitSeed = 1n;
  } else {
    const state = input.account.state;
    if (!state.signers.some((signer) => signer.key.equals(human)) || state.threshold !== 1 || state.timeLock !== 0) throw new Error("The smart account is not one the person alone controls at once.");
    settings = input.account.settings;
    exitSeed = nextPolicySeed(state);
  }
  const tendSeed = exitSeed + 1n;
  const vaultIndex = input.vaultIndex ?? 1;
  if (!Number.isInteger(vaultIndex) || vaultIndex < 1 || vaultIndex > 255) throw new Error("A care lives in vault 1 to 255.");
  const vault = careVaultOf(settings, vaultIndex);
  const exitPolicy = ssaAddress.policy(settings, exitSeed);
  const tendPolicy = ssaAddress.policy(settings, tendSeed);

  const sides = [
    { mint: pool.mintX, program: pool.programX, amount: input.fund.x, decimals: input.decimals.x },
    { mint: pool.mintY, program: pool.programY, amount: input.fund.y, decimals: input.decimals.y },
  ];
  for (const side of sides) {
    /* Their own account first — every exit lands there — then the vault's. */
    setup.push(createAssociatedTokenAccountIdempotentInstruction(human, ownTokenAccount(human, side.mint, side.program), human, side.mint, side.program));
    const vaultAccount = ownTokenAccount(vault, side.mint, side.program);
    setup.push(createAssociatedTokenAccountIdempotentInstruction(human, vaultAccount, vault, side.mint, side.program));
    if (side.amount <= 0n) continue;
    if (side.mint.equals(NATIVE_MINT)) setup.push(SystemProgram.transfer({ fromPubkey: human, toPubkey: vaultAccount, lamports: side.amount }), createSyncNativeInstruction(vaultAccount));
    else setup.push(createTransferCheckedInstruction(ownTokenAccount(human, side.mint, side.program), side.mint, vaultAccount, human, side.amount, side.decimals, [], side.program));
  }
  const rent = input.rentLamports ?? CARE_RENT_LAMPORTS;
  if (rent > 0n) setup.push(SystemProgram.transfer({ fromPubkey: human, toPubkey: vault, lamports: rent }));
  const agentFee = input.agentFeeLamports ?? CARE_AGENT_FEE_LAMPORTS;
  if (agentFee > 0n) setup.push(SystemProgram.transfer({ fromPubkey: human, toPubkey: terms.agent, lamports: agentFee }));

  const policies = carePolicies(terms, vault, vaultIndex);
  const create = (seed: bigint, policy: PublicKey, which: "exit" | "tend") =>
    settingsSyncInstruction({
      settings,
      rentPayer: human,
      signers: [human],
      policyAccounts: [policy],
      actions: [
        {
          kind: "policyCreate",
          create: { seed, policy: policies[which], signers: [{ key: terms.agent, permissions: ALL_PERMISSIONS }], threshold: 1, start: null, expiresAt: terms.expiresAt },
        },
      ],
    });
  const exitCreate = create(exitSeed, exitPolicy, "exit");
  const tendCreate = create(tendSeed, tendPolicy, "tend");
  const care: Care = { cluster: input.cluster, terms, settings, vaultIndex, vault, exitPolicy, tendPolicy, exitSeed, tendSeed };

  const transactions: (readonly TransactionInstruction[])[] = [];
  /* Pack in order: the setup, then the exit policy, then the tend one — as few transactions as fit the packet. */
  let current: TransactionInstruction[] = [];
  for (const instruction of [...setup, exitCreate, tendCreate]) {
    if (fits(human, [...current, instruction])) {
      current.push(instruction);
      continue;
    }
    if (!current.length || !fits(human, [instruction])) throw new Error("A care policy does not fit one transaction.");
    transactions.push(current);
    current = [instruction];
  }
  if (current.length) transactions.push(current);
  return { care, transactions };
}

/** Stop the care: both policies removed; their rent goes back to the person. */
export function planCareStop(care: Care): readonly TransactionInstruction[] {
  const human = care.terms.human;
  return [
    settingsSyncInstruction({
      settings: care.settings,
      rentPayer: human,
      signers: [human],
      policyAccounts: [care.exitPolicy, care.tendPolicy],
      actions: [
        { kind: "policyRemove", policy: care.exitPolicy },
        { kind: "policyRemove", policy: care.tendPolicy },
      ],
    }),
  ];
}

/**
 * Take back what the vault holds, as the settings signer: each coin's balance to their account, the vault's accounts
 * closed to them (wrapped SOL comes back as SOL), and the vault's spare SOL. The position itself, if one is still open,
 * goes out first through the agent's exit (or the person's own exit through the vault, `careOwnerExecuteInstruction`).
 */
export function planCareWithdraw(care: Care, balances: Readonly<{ x: bigint; y: bigint; lamports: bigint }>, decimals: Decimals): readonly TransactionInstruction[] {
  const human = care.terms.human;
  const pool = care.terms.pool;
  const inner: TransactionInstruction[] = [];
  const sides = [
    { mint: pool.mintX, program: pool.programX, amount: balances.x, decimals: decimals.x },
    { mint: pool.mintY, program: pool.programY, amount: balances.y, decimals: decimals.y },
  ];
  for (const side of sides) {
    const vaultAccount = ownTokenAccount(care.vault, side.mint, side.program);
    if (!side.mint.equals(NATIVE_MINT) && side.amount > 0n) {
      inner.push(createTransferCheckedInstruction(vaultAccount, side.mint, ownTokenAccount(human, side.mint, side.program), care.vault, side.amount, side.decimals, [], side.program));
    }
    inner.push(createCloseAccountInstruction(vaultAccount, human, care.vault, [], side.program));
  }
  if (balances.lamports > 0n) inner.push(SystemProgram.transfer({ fromPubkey: care.vault, toPubkey: human, lamports: balances.lamports }));
  return [careOwnerExecuteInstruction({ settings: care.settings, signer: human, instructions: inner, accountIndex: care.vaultIndex })];
}

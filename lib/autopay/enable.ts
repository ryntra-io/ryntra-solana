/**
 * What the person signs for an autopay, and the one payment the executor builds. Each of the person's
 * actions is one approval of their wallet; nothing here holds or asks for a key.
 *
 * - **Turn on.** Their smart account (made in the same approval when they have none), every payment of the schedule
 *   moved into the autopay's own vault (index 128 and up), the recipient's USDC account opened when a USDC autopay
 *   needs one (its rent is the recipient's to keep, as with any first transfer), SOL for the executor's network fees,
 *   and the policy (`./policy.ts`). The policy's rent is theirs and comes back at «Stop».
 * - **Stop.** One transaction: the policy removed — from the next block the executor can move nothing — and what the
 *   vault still holds back to their wallet, through their own settings signature, with no policy and no Ryntra in the way.
 * - **A payment.** The executor's transaction: the compute budget and one execution through the policy, one transfer.
 *
 * The executions on a vault other than 0 are `../care/ssa-care.ts`'s (the vault's index as a parameter).
 */

import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";

import { careOwnerExecuteInstruction, carePolicyExecuteInstruction } from "../care/ssa-care.ts";
import { fits, type SmartAccount } from "../mandate/human.ts";
import { ALL_PERMISSIONS, TOKEN_PROGRAM_ID, createSmartAccountInstruction, nextPolicySeed, settingsSyncInstruction, ssaAddress } from "../mandate/ssa.ts";
import { AUTOPAY_VAULT_FIRST, AUTOPAY_VAULT_LAST, USDC_DECIMALS, USDC_MINT, autopayPolicy, autopayRefusal, landingOf, sourceOf, usdcAccountOf, type AutopayNetwork, type AutopayTerms } from "./policy.ts";
import { endsAt, networkOf, totalOf } from "./schedule.ts";

/** One autopay: the terms and the accounts they live in. Public data only. */
export type Autopay = Readonly<{
  terms: AutopayTerms;
  settings: PublicKey;
  vaultIndex: number;
  vault: PublicKey;
  policy: PublicKey;
  policySeed: bigint;
}>;

export type AutopayEnablePlan = Readonly<{ autopay: Autopay; transactions: readonly (readonly TransactionInstruction[])[]; fund: bigint; network: bigint }>;

/** The executor's compute budget for one payment: a transfer through the policy needs well under it. */
export const PAYMENT_COMPUTE_UNITS = 200_000;
/** The executor's highest price per compute unit, micro-lamports: the priority it pays is at most 5 000 lamports. */
export const PAYMENT_UNIT_PRICE_MAX = 25_000n;

/** Turn an autopay on: the person's transactions, in the order they land, asked of the wallet at once. */
export function planAutopayEnable(input: Readonly<{ terms: AutopayTerms; account: SmartAccount; vaultIndex: number; nowSeconds: bigint }>): AutopayEnablePlan {
  const { terms } = input;
  const refusal = autopayRefusal(terms, input.nowSeconds);
  if (refusal) throw new Error(`The autopay is not written: ${refusal}.`);
  const vaultIndex = input.vaultIndex;
  if (!Number.isInteger(vaultIndex) || vaultIndex < AUTOPAY_VAULT_FIRST || vaultIndex > AUTOPAY_VAULT_LAST) throw new Error(`An autopay lives in vault ${AUTOPAY_VAULT_FIRST} to ${AUTOPAY_VAULT_LAST}.`);
  const human = terms.human;
  const setup: TransactionInstruction[] = [];

  let settings: PublicKey;
  let policySeed: bigint;
  if (input.account.kind === "absent") {
    settings = ssaAddress.settings(input.account.config.smartAccountIndex + 1n);
    setup.push(createSmartAccountInstruction({ creator: human, treasury: input.account.config.treasury, settings }));
    policySeed = 1n;
  } else {
    const state = input.account.state;
    if (!state.signers.some((signer) => signer.key.equals(human)) || state.threshold !== 1 || state.timeLock !== 0) throw new Error("The smart account is not one the person alone controls at once.");
    settings = input.account.settings;
    policySeed = nextPolicySeed(state);
  }
  const vault = ssaAddress.vault(settings, vaultIndex);
  const policy = ssaAddress.policy(settings, policySeed);
  const fund = totalOf(terms.schedule);
  const network = networkOf(terms.schedule);

  if (terms.schedule.coin === "SOL") {
    setup.push(SystemProgram.transfer({ fromPubkey: human, toPubkey: vault, lamports: fund }));
  } else {
    const mint = USDC_MINT[terms.network];
    const vaultAccount = usdcAccountOf(vault, terms.network);
    setup.push(createAssociatedTokenAccountIdempotentInstruction(human, vaultAccount, vault, mint, TOKEN_PROGRAM_ID));
    setup.push(createTransferCheckedInstruction(usdcAccountOf(human, terms.network), mint, vaultAccount, human, fund, USDC_DECIMALS, [], TOKEN_PROGRAM_ID));
    /* The recipient's own USDC account, where every payment lands: opened once now, as any first transfer opens it. */
    setup.push(createAssociatedTokenAccountIdempotentInstruction(human, landingOf(terms), terms.recipient, mint, TOKEN_PROGRAM_ID));
  }
  if (network > 0n) setup.push(SystemProgram.transfer({ fromPubkey: human, toPubkey: terms.agent, lamports: network }));

  const create = settingsSyncInstruction({
    settings,
    rentPayer: human,
    signers: [human],
    policyAccounts: [policy],
    actions: [
      {
        kind: "policyCreate",
        create: {
          seed: policySeed,
          policy: autopayPolicy(terms, { vault, vaultIndex }),
          signers: [{ key: terms.agent, permissions: ALL_PERMISSIONS }],
          threshold: 1,
          start: null,
          expiresAt: endsAt(terms.schedule),
        },
      },
    ],
  });
  const autopay: Autopay = { terms, settings, vaultIndex, vault, policy, policySeed };
  if (fits(human, [...setup, create])) return { autopay, transactions: [[...setup, create]], fund, network };
  if (!fits(human, setup) || !fits(human, [create])) throw new Error("The autopay's policy does not fit one transaction.");
  return { autopay, transactions: [setup, [create]], fund, network };
}

/** What the vault holds now: lamports for SOL, USDC's base units for USDC (`0n` — nothing to take back). */
export type VaultBalance = Readonly<{ lamports: bigint; usdc: bigint; usdcAccountOpen: boolean }>;

/**
 * Stop: the policy removed and the rest taken back, in one transaction the person alone signs. SOL — the vault's
 * lamports to their wallet; USDC — the balance to their USDC account and the vault's account closed to them (its rent
 * too). A policy already gone (ended on its own) is not removed twice: only the rest comes back.
 */
export function planAutopayStop(autopay: Autopay, balance: VaultBalance, options: Readonly<{ policyLive: boolean }> = { policyLive: true }): readonly TransactionInstruction[] {
  const { terms } = autopay;
  const human = terms.human;
  const out: TransactionInstruction[] = [];
  if (options.policyLive) {
    out.push(settingsSyncInstruction({ settings: autopay.settings, rentPayer: human, signers: [human], policyAccounts: [autopay.policy], actions: [{ kind: "policyRemove", policy: autopay.policy }] }));
  }
  const inner: TransactionInstruction[] = [];
  if (terms.schedule.coin === "USDC" && balance.usdcAccountOpen) {
    const mint = USDC_MINT[terms.network];
    const vaultAccount = usdcAccountOf(autopay.vault, terms.network);
    if (balance.usdc > 0n) inner.push(createTransferCheckedInstruction(vaultAccount, mint, usdcAccountOf(human, terms.network), autopay.vault, balance.usdc, USDC_DECIMALS, [], TOKEN_PROGRAM_ID));
    inner.push(createCloseAccountInstruction(vaultAccount, human, autopay.vault, [], TOKEN_PROGRAM_ID));
  }
  if (balance.lamports > 0n) inner.push(SystemProgram.transfer({ fromPubkey: autopay.vault, toPubkey: human, lamports: balance.lamports }));
  if (inner.length) {
    if (terms.schedule.coin === "USDC" && balance.usdc > 0n) {
      out.push(createAssociatedTokenAccountIdempotentInstruction(human, usdcAccountOf(human, terms.network), human, USDC_MINT[terms.network], TOKEN_PROGRAM_ID));
    }
    out.push(careOwnerExecuteInstruction({ settings: autopay.settings, signer: human, instructions: inner, accountIndex: autopay.vaultIndex }));
  }
  return out;
}

/** The one transfer of a payment, as the policy's rule reads it: from the vault, to the named address, exactly the amount. */
export function paymentTransfer(autopay: Pick<Autopay, "terms" | "vault">): TransactionInstruction {
  const { terms, vault } = autopay;
  const amount = terms.schedule.amount;
  if (terms.schedule.coin === "SOL") return SystemProgram.transfer({ fromPubkey: vault, toPubkey: terms.recipient, lamports: amount });
  return createTransferCheckedInstruction(sourceOf(terms, vault), USDC_MINT[terms.network], landingOf(terms), vault, amount, USDC_DECIMALS, [], TOKEN_PROGRAM_ID);
}

/** The executor's payment: its compute budget and one execution through the policy. The executor pays and signs alone. */
export function paymentInstructions(autopay: Autopay, unitPrice: bigint = 0n): readonly TransactionInstruction[] {
  const price = unitPrice < 0n ? 0n : unitPrice > PAYMENT_UNIT_PRICE_MAX ? PAYMENT_UNIT_PRICE_MAX : unitPrice;
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: PAYMENT_COMPUTE_UNITS }),
    ...(price > 0n ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price })] : []),
    carePolicyExecuteInstruction({ policy: autopay.policy, signer: autopay.terms.agent, instructions: [paymentTransfer(autopay)], constraintIndices: [0], accountIndex: autopay.vaultIndex }),
  ];
}

/** The network an autopay's record names, read back. */
export const isAutopayNetwork = (value: unknown): value is AutopayNetwork => value === "devnet" || value === "mainnet";

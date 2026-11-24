/**
 * An autopay's terms and the one policy they become, on the mandate's primitive (decision 95, D3: the
 * person's Squads smart account, `../mandate/ssa.ts`). The program holds every bound, not our code:
 *
 * - **to whom** — one address the person named. SOL: the System program's `Transfer` from the autopay's vault to that
 *   address, pinned by key. USDC: Token's `TransferChecked` from the vault's USDC account to that address's own USDC
 *   account (its canonical one, pinned by key), USDC's mint pinned, six decimals;
 * - **how much** — exactly one payment's amount in each transfer, and at most that amount leaving the vault per window
 *   (the policy's spending limit, a period of the schedule's length, from its start);
 * - **how often** — one window, one payment's sum: a second payment in the same window breaks the spending limit;
 * - **until when** — the policy and its limit end where the last window closes; after it the program refuses;
 * - **who** — the executor's key (the agent's, in Google Cloud KMS), alone; it signs and pays the network fee, nothing more.
 *
 * Nothing else: no swap, no other program, no other account, no other coin. The money lives in a vault of its own —
 * index 128 and up of the same smart account — so the agent's trading policy (vault 0) and the pool care (vaults 1…)
 * never reach it, and this policy never reaches theirs. The worst a stolen executor key can do is pay the person's own
 * recipient the person's own amount on the person's own schedule, early within a window. «Stop» — the person's one
 * signature removes the policy and takes the rest back (`./enable.ts`).
 *
 * Pure — the screen, the server, the executor's signer and the tests share it.
 */

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

import { TOKEN_PROGRAM_ID, type AccountConstraint, type DataConstraint, type InstructionConstraint, type ProgramInteractionPolicy, type SpendingLimit } from "../mandate/ssa.ts";
import { endsAt, periodOf, scheduleRefusal, type AutopayCoin, type AutopaySchedule } from "./schedule.ts";

/** USDC's mint on each network (Circle's). */
export const USDC_MINT: Readonly<Record<"devnet" | "mainnet", PublicKey>> = Object.freeze({
  mainnet: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  devnet: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
});
export const USDC_DECIMALS = 6;

/**
 * The spending limit's «mint» for the vault's own lamports: the program tracks native SOL under the default key (the
 * vault's lamports may not fall at all without such a limit, `account_tracking.rs`). The devnet
 * rehearsal proves it before any person uses SOL autopay (`scripts/autopay/rehearse-devnet.mjs`, step «SOL»).
 */
export const NATIVE_LIMIT_MINT = PublicKey.default;

/** The first vault an autopay lives in; each further autopay of the same person takes the next free index. */
export const AUTOPAY_VAULT_FIRST = 128;
export const AUTOPAY_VAULT_LAST = 255;

/** `Transfer` in the System program's instruction enum. */
export const SYSTEM_TRANSFER = 2;
/** `TransferChecked` in Token's instruction enum. */
export const TOKEN_TRANSFER_CHECKED = 12;

/** Where each instruction keeps what the policy pins. */
export const LAYOUT = Object.freeze({
  systemTransfer: { from: 0, to: 1, tag: 0, lamports: 4 },
  transferChecked: { source: 0, mint: 1, destination: 2, authority: 3, tag: 0, amount: 1, decimals: 9 },
});

export type AutopayNetwork = "devnet" | "mainnet";

export type AutopayTerms = Readonly<{
  network: AutopayNetwork;
  /** The person: their wallet signs the settings; every leftover comes back to it. */
  human: PublicKey;
  /** The executor: the policy's one signer. */
  agent: PublicKey;
  /** The one address the money goes to — a contact's, or a `.skr` name resolved before the person signs. */
  recipient: PublicKey;
  schedule: AutopaySchedule;
}>;

/** The accounts the policy pins, read from the terms. */
export type AutopayAccounts = Readonly<{ vault: PublicKey; vaultIndex: number }>;

/** The coin's mint as the transfers name it; SOL moves as lamports and names none. */
export const mintOf = (coin: AutopayCoin, network: AutopayNetwork): PublicKey | null => (coin === "USDC" ? USDC_MINT[network] : null);

/** An owner's canonical USDC account (Token's). Off-curve owners — a vault, a smart account — have one too. */
export const usdcAccountOf = (owner: PublicKey, network: AutopayNetwork): PublicKey => getAssociatedTokenAddressSync(USDC_MINT[network], owner, true, TOKEN_PROGRAM_ID);

/** Where the money lands: SOL — the recipient's address itself; USDC — the recipient's own USDC account. */
export const landingOf = (terms: Pick<AutopayTerms, "recipient" | "network" | "schedule">): PublicKey =>
  terms.schedule.coin === "SOL" ? terms.recipient : usdcAccountOf(terms.recipient, terms.network);

/** Where the money leaves from: SOL — the vault itself; USDC — the vault's USDC account. */
export const sourceOf = (terms: Pick<AutopayTerms, "network" | "schedule">, vault: PublicKey): PublicKey =>
  terms.schedule.coin === "SOL" ? vault : usdcAccountOf(vault, terms.network);

/** Why the terms are not an autopay the engine writes; null when they are. */
export function autopayRefusal(terms: AutopayTerms, nowSeconds: bigint): string | null {
  const schedule = scheduleRefusal(terms.schedule, nowSeconds);
  if (schedule) return schedule;
  if (terms.human.equals(terms.agent)) return "the executor's key is not the person's wallet";
  if (terms.recipient.equals(terms.human)) return "an autopay pays someone else";
  if (terms.recipient.equals(terms.agent)) return "an autopay does not pay the executor";
  if (terms.recipient.equals(PublicKey.default) || terms.recipient.equals(SystemProgram.programId)) return "the recipient is a person's address";
  return null;
}

/* ------------------------------------------------------------------ constraint builders */

const keys = (index: number, ...pinned: PublicKey[]): AccountConstraint => ({ index, rule: { kind: "keys", keys: pinned }, owner: null });
const u8 = (offset: number, value: number): DataConstraint => ({ offset, value: { kind: "u8", value }, operator: "equals" });
const u32 = (offset: number, value: number): DataConstraint => ({ offset, value: { kind: "u32", value }, operator: "equals" });
const u64 = (offset: number, value: bigint): DataConstraint => ({ offset, value: { kind: "u64", value }, operator: "equals" });

/** The one transfer the policy allows: from the vault, to the named address, exactly one payment. */
export function paymentConstraint(terms: AutopayTerms, vault: PublicKey): InstructionConstraint {
  const amount = terms.schedule.amount;
  if (terms.schedule.coin === "SOL") {
    const at = LAYOUT.systemTransfer;
    return { programId: SystemProgram.programId, accounts: [keys(at.from, vault), keys(at.to, terms.recipient)], data: [u32(at.tag, SYSTEM_TRANSFER), u64(at.lamports, amount)] };
  }
  const at = LAYOUT.transferChecked;
  return {
    programId: TOKEN_PROGRAM_ID,
    accounts: [keys(at.source, usdcAccountOf(vault, terms.network)), keys(at.mint, USDC_MINT[terms.network]), keys(at.destination, usdcAccountOf(terms.recipient, terms.network)), keys(at.authority, vault)],
    data: [u8(at.tag, TOKEN_TRANSFER_CHECKED), u64(at.amount, amount), u8(at.decimals, USDC_DECIMALS)],
  };
}

/** The spending limit: one payment's sum per window, from the first window to the end of the last. */
export function paymentLimit(terms: AutopayTerms): SpendingLimit {
  const { schedule } = terms;
  return {
    mint: schedule.coin === "SOL" ? NATIVE_LIMIT_MINT : USDC_MINT[terms.network],
    start: schedule.startAt,
    expiration: endsAt(schedule),
    period: { customSeconds: periodOf(schedule) },
    maxPerPeriod: schedule.amount,
  };
}

/** The policy the terms become: one rule, one limit, on the autopay's own vault. */
export function autopayPolicy(terms: AutopayTerms, accounts: AutopayAccounts): ProgramInteractionPolicy {
  if (!Number.isInteger(accounts.vaultIndex) || accounts.vaultIndex < AUTOPAY_VAULT_FIRST || accounts.vaultIndex > AUTOPAY_VAULT_LAST) {
    throw new Error(`An autopay lives in vault ${AUTOPAY_VAULT_FIRST} to ${AUTOPAY_VAULT_LAST}.`);
  }
  return { accountIndex: accounts.vaultIndex, constraints: [paymentConstraint(terms, accounts.vault)], spendingLimits: [paymentLimit(terms)] };
}

/** The first bytes of a smart account policy account (Anchor's discriminator of `Policy`). */
const POLICY_DISCRIMINATOR = Uint8Array.of(222, 135, 7, 163, 235, 177, 33, 68);
/** `PolicyState::ProgramInteraction` — the kind every policy of Ryntra's is (the agent's budget, a care, an autopay). */
const PROGRAM_INTERACTION = 3;

/**
 * The vault a policy acts on, read from its bytes on chain; null when it is not a program-interaction policy or does
 * not read. The layout is the program's `Policy`: discriminator, settings, seed, bump, two transaction indices, the
 * signers (u32 count, 33 bytes each), threshold u16, time lock u32, then `policy_state` — its variant byte and, for a
 * program-interaction policy, `account_index` first. The devnet rehearsal reads an autopay's own policy back with it
 * (`scripts/autopay/rehearse-devnet.mjs`, «сховище читається з байтів політики»).
 */
export function policyVaultIndex(data: Uint8Array): number | null {
  if (data.length < 8 + 32 + 8 + 1 + 8 + 8 + 4 || POLICY_DISCRIMINATOR.some((byte, i) => data[i] !== byte)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 8 + 32 + 8 + 1 + 8 + 8;
  const signers = view.getUint32(at, true);
  if (signers > 64) return null;
  at += 4 + signers * 33 + 2 + 4;
  if (at + 2 > data.length || data[at] !== PROGRAM_INTERACTION) return null;
  return data[at + 1]!;
}

/** A u64 as the policy's bytes hold it, little-endian. */
const u64Bytes = (value: bigint): Buffer => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
};

/**
 * Whether the policy's bytes on chain carry the record's terms: the recipient's landing account, the amount and the
 * end. A record whose numbers the policy does not hold is not the person's signature, and the executor never works it.
 */
export function policyCarriesTerms(policyData: Uint8Array, terms: AutopayTerms): boolean {
  const data = Buffer.from(policyData);
  return (
    data.indexOf(Buffer.from(landingOf(terms).toBytes())) >= 0 &&
    data.indexOf(u64Bytes(terms.schedule.amount)) >= 0 &&
    data.indexOf(u64Bytes(endsAt(terms.schedule))) >= 0
  );
}

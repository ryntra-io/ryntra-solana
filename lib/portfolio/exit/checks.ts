/**
 * What a transaction of an exit may do, read from its bytes before anyone is asked to sign it.
 *
 * One rule for every transaction of the package, whoever built it: **the wallet pays for it, the wallet is who signs it,
 * and money moves only through the venue named and back into the wallet's own accounts.** Each kind of step is held to
 * its own reading of that rule:
 *
 * - `studio` — a Meteora DLMM or DAMM v2 withdrawal or claim, built by the pools engine: the engine's own rule for its
 *   bytes (`lib/liquidity/studio/ticket.ts` `builtCallsOnly`), as every pool action already passes;
 * - `venue` — a venue's bytes the engine's own SDK builds (DLMM Pro): only the venue's programs and the wallet's own
 *   plumbing — its token accounts opened on its own rent, its own wrapped SOL wrapped and unwrapped, an account closed
 *   back to it;
 * - `lend` — a Jupiter Lend withdrawal, whose bytes a remote API answers: the same, and one instruction — the Earn
 *   program's `withdraw`, signed by the wallet, giving the wallet's own share and paying the wallet's own account of the
 *   asset — so the asset cannot be paid to anyone else, and a deposit cannot pass for a withdrawal;
 * - `stake` — exactly one instruction of the stake program: a withdraw of the named account to the wallet, or its
 *   deactivation, by the wallet's authority;
 * - `zap` — a swap of what arrived through Meteora's Zap Out and Jupiter's route: the rules of `zap-check.ts`, as the
 *   Zap already passes — the wallet's own accounts on both sides, Ryntra's fee exactly as reviewed, the floor, the cap —
 *   and the balance it counts from is the one this server read itself, written where the route's own amount stands;
 * - `swap` — the swap engine's own order: its pre-sign check ran where it was built; here the payer is the wallet.
 *
 * And for all: nothing a relay would later refuse — the signers are the payer and those the instructions name, the
 * compute budget is within what a wallet may set (`walletAdditionsAllowed`).
 *
 * Pure: no network, no clock.
 */

import { createHash } from "node:crypto";

import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, StakeProgram, type AddressLookupTableAccount, type TransactionInstruction } from "@solana/web3.js";

import { builtCallsOnly, decodeWire, walletAdditionsAllowed, type DecodedTransaction } from "../../liquidity/studio/ticket.ts";
import { ROUTE_V2, SHARED_ACCOUNTS_ROUTE_V2, ZAP_IX, ZAP_PROGRAM, zapCallsOnly, type ZapCheckContext } from "../../liquidity/studio/zap-check.ts";

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const SYSTEM = "11111111111111111111111111111111";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN = TOKEN_PROGRAM_ID.toBase58();
const TOKEN_2022 = TOKEN_2022_PROGRAM_ID.toBase58();
const MEMO = new Set(["MemoSq4gqABAXKb96qnH8TyNMKSDgWgN2ub7ZM4eE6h", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);
const STAKE = StakeProgram.programId.toBase58();

export type StepRule =
  | Readonly<{ kind: "studio"; program: string }>
  | Readonly<{ kind: "venue"; programs: readonly string[] }>
  | Readonly<{ kind: "stake"; account: string; op: "withdraw" | "deactivate" }>
  /** `programs` — Lend's own, the Earn program first: the withdrawal is its instruction. */
  | Readonly<{ kind: "lend"; programs: readonly string[]; assetMint: string; shareMint: string }>
  /**
   * `pre` — the wallet's balance of the coin swapped (`context.mintX`), read by this server at the Review: the sweep
   * takes only what stands above it; `percent` — the share of that it takes.
   */
  | Readonly<{ kind: "zap"; context: ZapCheckContext; pre: bigint; percent: number }>
  | Readonly<{ kind: "swap" }>;

export type RuleCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;
const refuse = (reason: string): RuleCheck => ({ ok: false, reason });

function ownAccount(owner: string, mint: string, program: string): string | null {
  try {
    return getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, new PublicKey(program)).toBase58();
  } catch {
    return null;
  }
}

/** The wallet's own plumbing beside a venue's call: nothing here can send a coin or a lamport to anyone but the wallet. */
export function ownPlumbing(instruction: TransactionInstruction, owner: string): boolean {
  const program = instruction.programId.toBase58();
  const keys = instruction.keys.map((meta) => meta.pubkey.toBase58());
  const data = Buffer.from(instruction.data);
  if (program === COMPUTE_BUDGET || MEMO.has(program)) return true;
  const wsol = ownAccount(owner, NATIVE_MINT.toBase58(), TOKEN);
  if (program === ATA) {
    /* create, or create-idempotent: paid by the wallet, for the wallet, at the wallet's canonical account of the mint. */
    if (!(data.length === 0 || (data.length === 1 && (data[0] === 0 || data[0] === 1)))) return false;
    const [payer, account, holder, mint, , tokenProgram] = keys;
    if (payer !== owner || holder !== owner || !account || !mint || !tokenProgram) return false;
    return (tokenProgram === TOKEN || tokenProgram === TOKEN_2022) && account === ownAccount(owner, mint, tokenProgram);
  }
  if (program === SYSTEM) {
    /* A transfer of the wallet's lamports into its own wrapped-SOL account. */
    return data.length === 12 && data.readUInt32LE(0) === 2 && keys[0] === owner && keys[1] === wsol;
  }
  if (program === TOKEN || program === TOKEN_2022) {
    /* syncNative of the wallet's wrapped SOL; an account closed by the wallet, back to the wallet. */
    if (data.length === 1 && data[0] === 17) return keys[0] === wsol;
    if (data.length === 1 && data[0] === 9) return keys[1] === owner && keys[2] === owner;
    return false;
  }
  return false;
}

/** A venue's bytes: only its programs and the wallet's plumbing, and the venue is called. */
export function venueCallsOnly(transaction: DecodedTransaction, owner: string, programs: readonly string[]): RuleCheck {
  const venue = new Set(programs);
  let calls = 0;
  for (const instruction of transaction.instructions) {
    const program = instruction.programId.toBase58();
    if (venue.has(program)) {
      calls += 1;
      continue;
    }
    if (!ownPlumbing(instruction, owner)) return refuse(`The built transaction has an instruction of ${program} outside the action.`);
  }
  return calls > 0 ? { ok: true } : refuse("The built transaction does not call the venue.");
}

/** Anchor's discriminator of the Earn program's `withdraw`. */
const LEND_WITHDRAW = createHash("sha256").update("global:withdraw").digest().subarray(0, 8);

/**
 * A Jupiter Lend withdrawal: the venue's rule, and exactly one instruction of Lend's programs — the Earn program's
 * `withdraw`, signed by the wallet, its accounts as Lend's IDL lays them out: the signer, the wallet's own account of
 * the share it gives (`owner_token_account`), the wallet's own account of the asset it gets
 * (`recipient_token_account`). The other order is a deposit, and is refused with everything else laid out otherwise:
 * such a withdrawal is then taken on Earn's own screen.
 */
export function lendWithdrawOnly(transaction: DecodedTransaction, owner: string, rule: Readonly<{ programs: readonly string[]; assetMint: string; shareMint: string }>): RuleCheck {
  const held = venueCallsOnly(transaction, owner, rule.programs);
  if (!held.ok) return held;
  const venue = new Set(rule.programs);
  const calls = transaction.instructions.filter((instruction) => venue.has(instruction.programId.toBase58()));
  if (calls.length !== 1) return refuse("A withdrawal is one instruction of the market.");
  const [call] = calls;
  if (call!.programId.toBase58() !== rule.programs[0] || !Buffer.from(call!.data).subarray(0, 8).equals(LEND_WITHDRAW)) return refuse("The market's instruction is not a withdrawal.");
  const keys = call!.keys;
  if (keys.length < 3 || keys[0]!.pubkey.toBase58() !== owner || !keys[0]!.isSigner) return refuse("The withdrawal is not the wallet's own.");
  const own = (mint: string): Set<string | null> => new Set([ownAccount(owner, mint, TOKEN), ownAccount(owner, mint, TOKEN_2022)]);
  const laidOut = own(rule.shareMint).has(keys[1]!.pubkey.toBase58()) && own(rule.assetMint).has(keys[2]!.pubkey.toBase58());
  return laidOut ? { ok: true } : refuse("The withdrawal's token accounts are not the wallet's own of the share and the asset.");
}

/**
 * What the one Zap Out of a transaction counts: the account it counts (`user_token_in_account`), the share it takes,
 * the balance before (`pre_user_token_balance`) and where in the route's data it writes the amount
 * (`offset_amount_in`). Null — no Zap Out, more than one, or data that cannot be read.
 */
export function zapOutCounts(instructions: readonly TransactionInstruction[]): Readonly<{ account: string | null; percent: number; pre: bigint; offset: number; payload: Buffer }> | null {
  const outs = instructions.filter((instruction) => instruction.programId.toBase58() === ZAP_PROGRAM && Buffer.from(instruction.data).subarray(0, 8).equals(Buffer.from(ZAP_IX.zapOut)));
  if (outs.length !== 1) return null;
  const data = Buffer.from(outs[0]!.data);
  /* discriminator, percentage u8, offset_amount_in u16, pre_user_token_balance u64, max_swap_amount u64, payload_data bytes */
  if (data.length < 31 || 31 + data.readUInt32LE(27) !== data.length) return null;
  return { account: outs[0]!.keys[0]?.pubkey.toBase58() ?? null, percent: data[8]!, pre: data.readBigUInt64LE(11), offset: data.readUInt16LE(9), payload: data.subarray(31) };
}

/** Where each of Jupiter's two routes keeps the amount it swaps (`in_amount`): the place a Zap Out must write to, and no other. */
function routeAmountOffset(payload: Buffer): number | null {
  if (payload.subarray(0, 8).equals(Buffer.from(ROUTE_V2))) return 8;
  if (payload.subarray(0, 8).equals(Buffer.from(SHARED_ACCOUNTS_ROUTE_V2))) return 9;
  return null;
}

/** The stake program's `Withdraw` (4) and `Deactivate` (5), as its instruction enum numbers them. */
const STAKE_WITHDRAW = 4;
const STAKE_DEACTIVATE = 5;

/** A stake step: one instruction of the stake program on the named account — its lamports to the wallet, or deactivated — by the wallet. */
export function stakeCallsOnly(transaction: DecodedTransaction, owner: string, account: string, op: "withdraw" | "deactivate"): RuleCheck {
  const calls = transaction.instructions.filter((instruction) => instruction.programId.toBase58() !== COMPUTE_BUDGET);
  if (calls.length !== 1) return refuse("A stake step is one instruction.");
  const [call] = calls;
  if (call!.programId.toBase58() !== STAKE) return refuse("A stake step calls the stake program only.");
  const keys = call!.keys.map((meta) => meta.pubkey.toBase58());
  const data = Buffer.from(call!.data);
  if (data.length < 4) return refuse("The stake instruction cannot be read.");
  const index = data.readUInt32LE(0);
  if (op === "withdraw") {
    /* stake, recipient, clock, stake history, withdraw authority — and no custodian. */
    if (index !== STAKE_WITHDRAW || data.length !== 12 || keys.length !== 5) return refuse("The stake instruction is not a withdraw.");
    if (keys[0] !== account || keys[1] !== owner || keys[4] !== owner || !call!.keys[4]!.isSigner) return refuse("The withdraw does not pay the wallet from the named stake account.");
    return { ok: true };
  }
  /* stake, clock, stake authority. */
  if (index !== STAKE_DEACTIVATE || data.length !== 4 || keys.length !== 3) return refuse("The stake instruction is not a deactivation.");
  if (keys[0] !== account || keys[2] !== owner || !call!.keys[2]!.isSigner) return refuse("The deactivation is not the wallet's, of the named stake account.");
  return { ok: true };
}

/**
 * One built transaction against its rule. `tables` — the lookup tables its message names, read from the chain; a
 * version-0 message without every one of them cannot be read and is refused.
 */
export function ruleHolds(rule: StepRule, wireBase64: string, tables: readonly AddressLookupTableAccount[], owner: string): RuleCheck {
  const decoded = decodeWire(wireBase64, tables);
  if (!decoded) return refuse("The built transaction could not be read.");
  if (decoded.feePayer?.toBase58() !== owner) return refuse("The built transaction is paid by someone other than the wallet.");
  if (!decoded.signers.some((signer) => signer.toBase58() === owner)) return refuse("The wallet does not sign the built transaction.");
  if (!walletAdditionsAllowed(decoded)) return refuse("The built transaction's signers or compute budget are outside what the relay accepts.");
  /* Outside the swap engine's managed lane nobody signs but the wallet: no key of anyone else's is waited for. */
  if (rule.kind !== "swap" && decoded.signers.length !== 1) return refuse("The built transaction names a signer other than the wallet.");
  switch (rule.kind) {
    case "studio":
      return builtCallsOnly(wireBase64, owner, rule.program);
    case "venue":
      return venueCallsOnly(decoded, owner, rule.programs);
    case "lend":
      return lendWithdrawOnly(decoded, owner, rule);
    case "stake":
      return stakeCallsOnly(decoded, owner, rule.account, rule.op);
    case "zap": {
      const checked = zapCallsOnly(decoded.instructions, decoded.feePayer?.toBase58() ?? null, rule.context);
      if (!checked.ok) return refuse(checked.reason);
      /* Exactly the one swap reviewed, through the Zap program. */
      if (!(checked.zapCalls >= 1 && checked.swaps === 1)) return refuse("The built swap is not one Zap Out.");
      /* It counts from the balance this server read, and writes the amount where the route keeps its own. */
      const counts = zapOutCounts(decoded.instructions);
      if (!counts || counts.pre !== rule.pre) return refuse("The built swap counts from a balance other than the one read.");
      /* The balance read is of the coin swapped: that account is the one counted, and the share taken is the one reviewed. */
      if (counts.account !== ownAccount(owner, rule.context.mintX, rule.context.programX) || counts.percent !== rule.percent) return refuse("The built swap counts another account, or another share, than reviewed.");
      if (counts.offset !== routeAmountOffset(counts.payload)) return refuse("The built swap writes its amount outside the route's own.");
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

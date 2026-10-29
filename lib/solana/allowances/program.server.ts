/**
 * The Subscriptions program on the wire (SOL-7): its accounts read and decoded, its instructions built by the
 * Foundation's own SDK (`@solana/subscriptions`, Kit instructions) and handed to the legacy transactions the rest of
 * Ryntra's Solana flows sign and send. Signers are named by address only: the server holds no key and signs nothing.
 */

import {
  ACCOUNT_SIZE,
  AccountLayout,
  AccountState,
  MintLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { address as kitAddress, createNoopSigner, type Instruction } from "@solana/kit";
import {
  CREATE_FIXED_DELEGATION_DISCRIMINATOR,
  UNKNOWN_INIT_ID,
  ZERO_ADDRESS,
  findSubscriptionAuthorityPda,
  findSubscriptionDelegationPda,
  getCancelSubscriptionOverlayInstructionAsync,
  getCloseSubscriptionAuthorityOverlayInstructionAsync,
  getCreateFixedDelegationInstructionDataDecoder,
  getCreateFixedDelegationOverlayInstructionAsync,
  getCreateRecurringDelegationOverlayInstructionAsync,
  getFixedDelegationDecoder,
  getInitSubscriptionAuthorityOverlayInstructionAsync,
  getPlanDecoder,
  getRecurringDelegationDecoder,
  getRevokeDelegationOverlayInstruction,
  getRevokeSubscriptionAuthorityOverlayInstructionAsync,
  getRevokeSubscriptionOverlayInstruction,
  getSubscribeOverlayInstructionAsync,
  getSubscriptionAuthorityDecoder,
  getSubscriptionDelegationDecoder,
  getTransferFixedOverlayInstructionAsync,
  getTransferRecurringOverlayInstructionAsync,
} from "@solana/subscriptions";
import { PublicKey, TransactionInstruction, type AccountInfo, type Connection } from "@solana/web3.js";

import { getTransactionAnyVersion } from "../v1-tx.ts";
import { SUBSCRIPTIONS_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, type AuthorityRead, type DelegationRead, type PlanRead, type TokenAccountRead } from "./model.ts";

export class AllowanceRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const key = (value: string) => new PublicKey(value);
const signer = (value: string) => createNoopSigner(kitAddress(value));
const PROGRAM_KEY = new PublicKey(SUBSCRIPTIONS_PROGRAM);

/** A Kit instruction as the legacy transaction holds it: the same program, accounts, roles and bytes. */
export function toLegacy(instruction: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: key(instruction.programAddress),
    keys: (instruction.accounts ?? []).map((meta) => ({ pubkey: key(meta.address), isSigner: meta.role >= 2, isWritable: (meta.role & 1) === 1 })),
    data: Buffer.from(instruction.data ?? new Uint8Array()),
  });
}

export async function authorityAddress(user: string, mint: string): Promise<string> {
  const [pda] = await findSubscriptionAuthorityPda({ user: kitAddress(user), tokenMint: kitAddress(mint) });
  return pda;
}

export async function subscriptionAddress(plan: string, subscriber: string): Promise<string> {
  const [pda] = await findSubscriptionDelegationPda({ planPda: kitAddress(plan), subscriber: kitAddress(subscriber) });
  return pda;
}

export function tokenAccountAddress(owner: string, mint: string, tokenProgram: string = TOKEN_PROGRAM): string {
  return getAssociatedTokenAddressSync(key(mint), key(owner), true, key(tokenProgram)).toBase58();
}

/* ─── Decoding ──────────────────────────────────────────────────────────────── */

const bytes = (data: Buffer | Uint8Array) => new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

/** One of the program's limit accounts, by its first byte (2 fixed, 3 recurring, 4 subscription); null — not one. */
export function decodeDelegation(address: string, data: Buffer | Uint8Array): DelegationRead | null {
  const raw = bytes(data);
  try {
    switch (raw[0]) {
      case 2: {
        const d = getFixedDelegationDecoder().decode(raw);
        return { kind: "fixed", address, header: header(d.header), mint: d.mint, remainingRaw: d.amount, expiryTs: d.expiryTs };
      }
      case 3: {
        const d = getRecurringDelegationDecoder().decode(raw);
        return {
          kind: "recurring",
          address,
          header: header(d.header),
          mint: d.mint,
          periodStartTs: d.currentPeriodStartTs,
          periodSeconds: d.periodLengthS,
          expiryTs: d.expiryTs,
          perPeriodRaw: d.amountPerPeriod,
          pulledInPeriodRaw: d.amountPulledInPeriod,
        };
      }
      case 4: {
        const d = getSubscriptionDelegationDecoder().decode(raw);
        return {
          kind: "subscription",
          address,
          header: header(d.header),
          amountRaw: d.terms.amount,
          periodHours: d.terms.periodHours,
          createdAt: d.terms.createdAt,
          pulledInPeriodRaw: d.amountPulledInPeriod,
          periodStartTs: d.currentPeriodStartTs,
          expiresAtTs: d.expiresAtTs,
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function header(h: { delegator: string; delegatee: string; payer: string; initId: bigint }) {
  return { delegator: h.delegator, delegatee: h.delegatee, payer: h.payer, initId: h.initId };
}

export function decodeAuthority(address: string, info: AccountInfo<Buffer> | null): AuthorityRead {
  if (!info || info.data.length === 0) return { state: "absent" };
  if (!info.owner.equals(PROGRAM_KEY)) throw new AllowanceRefusal("ALLOWANCE_AUTHORITY_FOREIGN", "The authority's address is held by another program.");
  const d = getSubscriptionAuthorityDecoder().decode(bytes(info.data));
  return { state: "present", address, initId: d.initId, payer: d.payer };
}

export function decodeTokenAccount(address: string, info: AccountInfo<Buffer> | null, mint: string, owner: string): TokenAccountRead {
  if (!info) return { state: "absent" };
  const program = info.owner.toBase58();
  if ((program !== TOKEN_PROGRAM && program !== TOKEN_2022_PROGRAM) || info.data.length < ACCOUNT_SIZE) return { state: "absent" };
  const account = AccountLayout.decode(info.data.subarray(0, ACCOUNT_SIZE));
  if (account.mint.toBase58() !== mint || account.owner.toBase58() !== owner || account.state === AccountState.Uninitialized) return { state: "absent" };
  return {
    state: "present",
    address,
    balanceRaw: account.amount,
    delegate: account.delegateOption ? account.delegate.toBase58() : null,
    delegatedRaw: account.delegateOption ? account.delegatedAmount : 0n,
    frozen: account.state === AccountState.Frozen,
  };
}

export function decodePlan(address: string, info: AccountInfo<Buffer> | null): PlanRead {
  if (!info || !info.owner.equals(PROGRAM_KEY) || info.data[0] !== 1) return { state: "absent" };
  const plan = getPlanDecoder().decode(bytes(info.data));
  const live = (list: readonly string[]) => list.filter((entry) => entry !== ZERO_ADDRESS);
  return {
    state: "present",
    address,
    owner: plan.owner,
    planId: plan.data.planId,
    mint: plan.data.mint,
    active: plan.status === 1,
    endTs: plan.data.endTs,
    amountRaw: plan.data.terms.amount,
    periodHours: plan.data.terms.periodHours,
    createdAt: plan.data.terms.createdAt,
    destinations: live(plan.data.destinations),
    pullers: live(plan.data.pullers),
  };
}

export type MintRead = Readonly<{ address: string; program: string; decimals: number }>;

export function decodeMint(address: string, info: AccountInfo<Buffer> | null): MintRead | null {
  if (!info) return null;
  const program = info.owner.toBase58();
  if ((program !== TOKEN_PROGRAM && program !== TOKEN_2022_PROGRAM) || info.data.length < MintLayout.span) return null;
  return { address, program, decimals: MintLayout.decode(info.data.subarray(0, MintLayout.span)).decimals };
}

/* ─── Reads ─────────────────────────────────────────────────────────────────── */

/** Where a wallet sits in a limit's header: the delegator at byte 3, the delegatee at byte 35. */
const OFFSET = { delegator: 3, delegatee: 35 } as const;

/** Every limit account naming the wallet as delegator (or delegatee); a refused scan throws — «not read», never «none». */
export async function readDelegations(connection: Connection, role: keyof typeof OFFSET, wallet: string): Promise<DelegationRead[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_KEY, { commitment: "confirmed", filters: [{ memcmp: { offset: OFFSET[role], bytes: wallet } }] });
  return accounts.map((row) => decodeDelegation(row.pubkey.toBase58(), row.account.data)).filter((row): row is DelegationRead => row !== null);
}

/** Up to a hundred accounts a call, in the order asked; a failed call throws. */
export async function readMany(connection: Connection, addresses: readonly string[]): Promise<Map<string, AccountInfo<Buffer> | null>> {
  const out = new Map<string, AccountInfo<Buffer> | null>();
  const unique = [...new Set(addresses)];
  for (let index = 0; index < unique.length; index += 100) {
    const slice = unique.slice(index, index + 100);
    const infos = await connection.getMultipleAccountsInfo(slice.map(key), "confirmed");
    slice.forEach((entry, at) => out.set(entry, infos[at] ?? null));
  }
  return out;
}

/**
 * A fixed limit's amount at creation, from its creating transaction (the program keeps only what is left). Null —
 * not found: the account's history is longer than one page, it was made inside another program's call, or the oldest
 * creation at this address carries another end date (the address was used again).
 */
export async function readFixedOriginal(connection: Connection, delegation: string, expiryTs: bigint): Promise<bigint | null> {
  const signatures = await connection.getSignaturesForAddress(key(delegation), { limit: 1_000 }, "confirmed");
  if (signatures.length === 0 || signatures.length >= 1_000) return null;
  const oldest = signatures.slice(-3).reverse();
  for (const entry of oldest) {
    if (entry.err) continue;
    const tx = await getTransactionAnyVersion(connection, entry.signature);
    if (!tx || tx.meta?.err) continue;
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
    for (const instruction of tx.transaction.message.compiledInstructions) {
      if (!keys.get(instruction.programIdIndex)?.equals(PROGRAM_KEY)) continue;
      if (instruction.data[0] !== CREATE_FIXED_DELEGATION_DISCRIMINATOR) continue;
      if (keys.get(instruction.accountKeyIndexes[2] ?? -1)?.toBase58() !== delegation) continue;
      const created = getCreateFixedDelegationInstructionDataDecoder().decode(instruction.data).fixedDelegation;
      /* An address used again (a revoked limit made anew with the same nonce) is not this limit's creation: not read. */
      return created.expiryTs === expiryTs ? created.amount : null;
    }
  }
  return null;
}

/* ─── Instructions ──────────────────────────────────────────────────────────── */

/**
 * The token's authority for this wallet: opened if absent, and the token account approved to it for u64::MAX — the
 * program's one approval, through which every limit on the token is counted. Idempotent: an open authority keeps its
 * generation and only its approval is given again.
 */
export async function initAuthorityIx(args: Readonly<{ wallet: string; mint: string; tokenAccount: string; tokenProgram?: string }>): Promise<TransactionInstruction> {
  return toLegacy(
    await getInitSubscriptionAuthorityOverlayInstructionAsync({
      owner: signer(args.wallet),
      tokenMint: kitAddress(args.mint),
      tokenProgram: kitAddress(args.tokenProgram ?? TOKEN_PROGRAM),
      userAta: kitAddress(args.tokenAccount),
    }),
  );
}

/** The authority's generation a create binds to: the real one when the authority is open, else the same-slot sentinel. */
const generation = (initId: bigint | null) => initId ?? UNKNOWN_INIT_ID;

export async function createFixedIx(args: Readonly<{ wallet: string; delegatee: string; mint: string; nonce: bigint; amountRaw: bigint; expiryTs: bigint; initId: bigint | null }>): Promise<Readonly<{ instruction: TransactionInstruction; delegation: string }>> {
  const instruction = await getCreateFixedDelegationOverlayInstructionAsync({
    delegator: signer(args.wallet),
    delegatee: kitAddress(args.delegatee),
    tokenMint: kitAddress(args.mint),
    nonce: args.nonce,
    amount: args.amountRaw,
    expiryTs: args.expiryTs,
    expectedSubscriptionAuthorityInitId: generation(args.initId),
  });
  return { instruction: toLegacy(instruction), delegation: instruction.accounts![2]!.address };
}

export async function createRecurringIx(args: Readonly<{ wallet: string; delegatee: string; mint: string; nonce: bigint; perPeriodRaw: bigint; periodSeconds: bigint; expiryTs: bigint; initId: bigint | null }>): Promise<Readonly<{ instruction: TransactionInstruction; delegation: string }>> {
  const instruction = await getCreateRecurringDelegationOverlayInstructionAsync({
    delegator: signer(args.wallet),
    delegatee: kitAddress(args.delegatee),
    tokenMint: kitAddress(args.mint),
    nonce: args.nonce,
    amountPerPeriod: args.perPeriodRaw,
    periodLengthS: args.periodSeconds,
    /* 0: the first period starts when the transaction lands — the program then requires the end date it has. */
    startTs: 0n,
    expiryTs: args.expiryTs,
    expectedSubscriptionAuthorityInitId: generation(args.initId),
  });
  return { instruction: toLegacy(instruction), delegation: instruction.accounts![2]!.address };
}

/** A subscription bound to the plan's terms as read: a plan changed between the read and the landing refuses it. */
export async function subscribeIx(args: Readonly<{ wallet: string; plan: Extract<PlanRead, { state: "present" }>; initId: bigint | null }>): Promise<TransactionInstruction> {
  return toLegacy(
    await getSubscribeOverlayInstructionAsync({
      subscriber: signer(args.wallet),
      merchant: kitAddress(args.plan.owner),
      planId: args.plan.planId,
      tokenMint: kitAddress(args.plan.mint),
      expectedAmount: args.plan.amountRaw,
      expectedPeriodHours: args.plan.periodHours,
      expectedCreatedAt: args.plan.createdAt,
      expectedSubscriptionAuthorityInitId: generation(args.initId),
    }),
  );
}

/** A fixed or recurring limit closed: nothing more can be taken from it, its rent goes back to whoever paid it. */
export function revokeIx(args: Readonly<{ wallet: string; delegation: string; payer: string }>): TransactionInstruction {
  return toLegacy(
    getRevokeDelegationOverlayInstruction({
      authority: signer(args.wallet),
      delegationAccount: kitAddress(args.delegation),
      ...(args.payer !== args.wallet ? { receiver: kitAddress(args.payer) } : {}),
    }),
  );
}

export async function cancelIx(args: Readonly<{ wallet: string; plan: string; subscription: string }>): Promise<TransactionInstruction> {
  return toLegacy(await getCancelSubscriptionOverlayInstructionAsync({ subscriber: signer(args.wallet), planPda: kitAddress(args.plan), subscriptionPda: kitAddress(args.subscription) }));
}

/** A cancelled subscription past its paid period, closed for its rent. */
export function closeSubscriptionIx(args: Readonly<{ wallet: string; plan: string; subscription: string; payer: string }>): TransactionInstruction {
  return toLegacy(
    getRevokeSubscriptionOverlayInstruction({
      authority: signer(args.wallet),
      planPda: kitAddress(args.plan),
      subscriptionPda: kitAddress(args.subscription),
      ...(args.payer !== args.wallet ? { receiver: kitAddress(args.payer) } : {}),
    }),
  );
}

/** The authority closed alone, for a wallet whose token account is gone: nothing is left to revoke on it. */
export async function closeAuthorityIx(args: Readonly<{ wallet: string; mint: string; payer: string }>): Promise<TransactionInstruction> {
  return toLegacy(
    await getCloseSubscriptionAuthorityOverlayInstructionAsync({
      user: signer(args.wallet),
      tokenMint: kitAddress(args.mint),
      ...(args.payer !== args.wallet ? { receiver: kitAddress(args.payer) } : {}),
    }),
  );
}

/** Every limit on the token at once: the token account's approval revoked and the authority closed. */
export async function stopAllIx(args: Readonly<{ wallet: string; mint: string; payer: string; tokenProgram?: string }>): Promise<TransactionInstruction> {
  return toLegacy(
    await getRevokeSubscriptionAuthorityOverlayInstructionAsync({
      user: signer(args.wallet),
      tokenMint: kitAddress(args.mint),
      tokenProgram: kitAddress(args.tokenProgram ?? TOKEN_PROGRAM),
      ...(args.payer !== args.wallet ? { receiver: kitAddress(args.payer) } : {}),
    }),
  );
}

/** The delegatee takes `amountRaw` from a fixed or recurring limit into `receiverAta`; the program counts it against the limit. */
export async function transferIx(args: Readonly<{ kind: "fixed" | "recurring"; wallet: string; delegation: string; delegator: string; mint: string; amountRaw: bigint; receiverAta: string; tokenProgram?: string }>): Promise<TransactionInstruction> {
  const tokenProgram = args.tokenProgram ?? TOKEN_PROGRAM;
  const input = {
    amount: args.amountRaw,
    delegatee: signer(args.wallet),
    delegationPda: kitAddress(args.delegation),
    delegator: kitAddress(args.delegator),
    delegatorAta: kitAddress(tokenAccountAddress(args.delegator, args.mint, tokenProgram)),
    receiverAta: kitAddress(args.receiverAta),
    tokenMint: kitAddress(args.mint),
    tokenProgram: kitAddress(tokenProgram),
    transferHookAccounts: [],
  };
  return toLegacy(await (args.kind === "fixed" ? getTransferFixedOverlayInstructionAsync(input) : getTransferRecurringOverlayInstructionAsync(input)));
}

export type Receiver = Readonly<{ ok: true; tokenAccount: string; opens: boolean }> | Readonly<{ ok: false; code: string; message: string }>;

/**
 * Where a take pays, fail-closed (the rules of `lib/solana/send-recipient.ts` on this route's connection): a person's
 * wallet — its USDC account, opened when absent — or an existing USDC token account named on purpose. A program, an
 * account another program owns, an address no key can sign for, another mint's account or a frozen one is refused: an
 * account opened for such an owner could never be emptied again.
 */
export async function resolveReceiver(connection: Connection, to: string, mint: string): Promise<Receiver> {
  const refuse = (message: string): Receiver => ({ ok: false, code: "ALLOWANCE_RECIPIENT", message });
  const entered = key(to);
  const info = await connection.getAccountInfo(entered, "confirmed");
  if (info?.executable) return refuse("That address is a program, not a wallet.");
  const program = info?.owner.toBase58() ?? null;
  if (program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM) {
    const account = decodeTokenAccount(to, info, mint, (info && info.data.length >= ACCOUNT_SIZE ? AccountLayout.decode(info.data.subarray(0, ACCOUNT_SIZE)).owner.toBase58() : "")) ;
    if (program !== TOKEN_PROGRAM || account.state !== "present") return refuse("That token account does not hold this USDC.");
    if (account.frozen) return refuse("That token account is frozen.");
    return { ok: true, tokenAccount: to, opens: false };
  }
  if (program !== null && program !== "11111111111111111111111111111111") return refuse("That account belongs to a program, not a person's wallet.");
  if (!PublicKey.isOnCurve(entered.toBytes())) return refuse("That address is not a wallet (a program's or a vault's): give its USDC account instead.");
  const ata = tokenAccountAddress(to, mint);
  const held = decodeTokenAccount(ata, await connection.getAccountInfo(key(ata), "confirmed"), mint, to);
  if (held.state === "present" && held.frozen) return refuse("That wallet's USDC account is frozen.");
  return { ok: true, tokenAccount: ata, opens: held.state !== "present" };
}

export function openTokenAccountIx(args: Readonly<{ payer: string; owner: string; mint: string; tokenProgram?: string }>): TransactionInstruction {
  const program = key(args.tokenProgram ?? TOKEN_PROGRAM);
  return createAssociatedTokenAccountIdempotentInstruction(key(args.payer), getAssociatedTokenAddressSync(key(args.mint), key(args.owner), true, program), key(args.owner), key(args.mint), program);
}

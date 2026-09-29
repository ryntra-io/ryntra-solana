/**
 * Building the exact transaction the founder's wallet will be asked to sign.
 *
 * **This module is deliberately outside the public evidence kit.** The kit
 * reads; this writes, and `packages/solana-evidence-sdk/boundaries.test.mjs`
 * fails the build if a transaction-construction identifier ever appears in a
 * shipped file. Adding this path to `docs/solana/SDK-EXTRACTION-MANIFEST.json`
 * would turn a read-only kit into something that can build a transfer, which
 * is exactly the boundary that gate exists to hold.
 *
 * Two rules shape everything here.
 *
 * **The instruction is `transferChecked`, never `transfer`.** The checked form
 * carries the mint and its decimals and the token program refuses the transfer
 * if they disagree with the mint's own state. The unchecked form would happily
 * move a wrong amount when a decimals assumption is stale — and a decimals
 * assumption is exactly the thing that goes stale between reading a mint and
 * signing for it.
 *
 * **Nothing here holds or wants a key.** The fee payer enters as a noop signer
 * — an address with no signing ability — so the compiled transaction carries an
 * empty signature slot that only the founder's wallet can fill. There is no
 * code path in this repository that produces a Solana signature.
 */

import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  getTransferCheckedWithFeeInstruction,
  getTokenSize,
  type Extension,
  type ExtensionArgs,
} from "@solana-program/token-2022";
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";

import type { SplTransferInput } from "../agent-control/adapters/solana-token-2022.ts";
import type { MintReadSuccess } from "./mint.ts";
import { computeTransferFee } from "./preflight.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";
import { resolveTokenRecipient } from "./send-recipient.ts";
import {
  classifySendSupport,
  sendSupportInputFromFacts,
  type SendSupportVerdict,
} from "./send-support.ts";
import { associatedTokenAccount } from "./token-account.ts";
import {
  classifyTokenTransfer,
  MEMO_PROGRAM_ID,
  type SendActionKind,
} from "./send-kinds.ts";

/* Re-exported: the memo id moved to `send-kinds.ts` so a browser bundle can
   recognize it without importing this builder. */
export { MEMO_PROGRAM_ID };
import type { SolanaAssetPassport } from "./types.ts";

const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111" as Address;

export type TransferBuildFailure = Readonly<{
  ok: false;
  code:
    | "INPUT_MINT_MISMATCH"
    | "SENDER_ACCOUNT_MISSING"
    | "INSUFFICIENT_BALANCE"
    | "INSUFFICIENT_FEE_BALANCE"
    | "BLOCKHASH_UNAVAILABLE"
    | "FEE_UNAVAILABLE"
    | "ZERO_AMOUNT"
    | "SENDER_RECIPIENT_SAME"
    /* The entered destination is not one this asset can pay into: wrong mint,
       wrong token program, a program-owned account, or an owner no key exists
       for. Separate from `BUILD_FAILED` because nothing was wrong with the
       build — the destination was wrong, and the person can fix it. */
    | "RECIPIENT_UNSUPPORTED"
    /* The chosen source accounts do not add up to the amount. A builder that
       shrugged and sent the difference would move less than was approved. */
    | "SOURCE_TOTAL_MISMATCH"
    /* Too many legs to fit one transaction. Splitting silently into two
       transactions would mean two signatures and two chances to half-fail. */
    | "TRANSACTION_TOO_LARGE"
    /* A transfer hook runs on this mint and its extra accounts did not resolve. */
    | "HOOK_ACCOUNTS_UNAVAILABLE"
    /* An account this transfer depends on neither answered nor reported itself
       absent. Refusing is the only honest move: guessing "absent" changes the
       transaction's shape, and guessing "present" builds one that fails. */
    | "ACCOUNT_STATE_UNREADABLE"
    | "BUILD_FAILED";
  reason: string;
}>;

/**
 * What must not change between the bytes we built and the bytes that come
 * back signed.
 *
 * The Stellar lifecycle learned this the expensive way: comparing the fields
 * *around* a signed payload detects nothing, because a wallet that returned a
 * different transaction would return different fields too. So the fingerprint
 * covers the compiled message bytes themselves, and the post-signature check
 * verifies the signature over those exact bytes rather than trusting that the
 * envelope looks familiar.
 */
export type TransferLegFingerprint = Readonly<{
  programAddress: string;
  source: string;
  mint: string;
  destination: string;
  authority: string;
  amountRaw: string;
  decimals: number;
}>;

export type TransferFingerprint = Readonly<{
  /** SHA-256 over the compiled message bytes — the preimage a signature covers. */
  messageHash: string;
  feePayer: string;
  blockhash: string;
  instructionCount: number;
  /**
   * The first transfer leg. Kept because every parser written for the
   * single-source shape reads it, including the immutable M1B artifact's.
   */
  transfer: TransferLegFingerprint;
  /**
   * One entry per transfer instruction, in message order.
   *
   * A transfer can draw on several accounts holding the same mint, and
   * fingerprinting only the first leg would let a wallet drop or rewrite the
   * others while the check still passed.
   */
  transfers: readonly TransferLegFingerprint[];
}>;

export type WalletAugmentationPlan = Readonly<{
  computeUnitLimit: number;
  microLamportsPerUnit: string;
  maximumPriorityFeeLamports: string;
  lighthouseAssertions: readonly Readonly<{
    kind: "ASSERT_ACCOUNT_INFO_MULTI" | "ASSERT_TOKEN_ACCOUNT_MULTI";
    account: string;
  }>[];
}>;

export type TransferPlan = Readonly<{
  /** Canon §10.3. Set at build time so a later reader cannot re-derive a different case. */
  actionKind: SendActionKind;
  network: SplTransferInput["network"];
  mint: string;
  tokenProgram: string;
  decimals: number;
  sender: string;
  recipient: string;
  /**
   * The first source account. A compatibility projection of `sources[0]`, kept
   * because the M1B receipt parsers and the settlement checks read it.
   */
  senderTokenAccount: string;
  recipientTokenAccount: string;
  /** Every account this transfer draws on, with its own amount and mint fee. */
  sources: readonly Readonly<{ account: string; amountRaw: string; feeRaw: string }>[];
  /** Whether the destination was a wallet, or a token account entered directly. */
  recipientKind: "WALLET_OWNER" | "EXISTING_TOKEN_ACCOUNT";
  /**
   * Whose token account the transfer pays into.
   *
   * The same as `recipient` when a wallet was entered, and **not** the same
   * when an existing token account was: there the typed address is the account
   * and its owner is somebody else's key. The receipt states the recipient
   * account's owner as an expectation and reads the observed one from the
   * chain's post-balances, so taking it from `recipient` made a correct
   * transfer into a token account reconcile as a deviation about an owner
   * nothing was ever wrong with.
   */
  recipientOwner: string;
  /** Present only when the destination requires an accompanying memo. */
  memo: string | null;
  /** Resolved hook program and the exact extra accounts pinned for this amount. */
  transferHook: Readonly<{ program: string; extraAccounts: readonly string[] }> | null;
  /** What this exact transfer shape was classified as, from fresh chain facts. */
  support: SendSupportVerdict;
  /** True when the transaction has to create the recipient's account first. */
  createsRecipientAccount: boolean;
  /** Rent for a new recipient account, lamports, when known. Null when not created or not read. */
  ataRentLamports: string | null;
  amountRaw: string;
  /** The sender's balance at build time, in base units, as the chain reported. */
  senderBalanceRaw: string;
  /** Base signature fee returned by getFeeForMessage for these exact message bytes. */
  baseFeeLamports: string;
  /** M0C adds no compute-unit-price instruction, so this is exactly zero. */
  priorityFeeLamports: string;
  /** Present only after the server adopts and re-reviews a bounded wallet modification. */
  walletAugmentation?: WalletAugmentationPlan;
  /** Outer instruction program ids in the order the reviewed message invokes them. */
  programs: readonly string[];
  blockhash: string;
  lastValidBlockHeight: string;
  /** The exact bytes handed to the wallet, base64. Unsigned. */
  unsignedWireBase64: string;
  fingerprint: TransferFingerprint;
  builtAt: string;
}>;

export type TransferBuildResult =
  | Readonly<{ ok: true; plan: TransferPlan }>
  | TransferBuildFailure;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function programAddressOf(passport: SolanaAssetPassport): Address {
  return (passport.identity.programKind === "TOKEN_2022"
    ? TOKEN_2022_PROGRAM_ADDRESS
    : TOKEN_PROGRAM_ADDRESS) as Address;
}

function mintExtensions(read: MintReadSuccess): readonly Extension[] {
  return read.decoded.extensions.__option === "Some" ? read.decoded.extensions.value : [];
}

/** Account extensions the Associated Token Program allocates for this mint. */
function requiredTokenAccountExtensions(read: MintReadSuccess): ExtensionArgs[] | undefined {
  if (read.programKind !== "TOKEN_2022") return undefined;

  const mint = mintExtensions(read);
  const required: ExtensionArgs[] = [{ __kind: "ImmutableOwner" }];
  if (mint.some((extension) => extension.__kind === "TransferFeeConfig")) {
    required.push({ __kind: "TransferFeeAmount", withheldAmount: 0n });
  }
  if (mint.some((extension) => extension.__kind === "TransferHook")) {
    required.push({ __kind: "TransferHookAccount", transferring: false });
  }
  if (mint.some((extension) => extension.__kind === "NonTransferable")) {
    required.push({ __kind: "NonTransferableAccount" });
  }
  if (mint.some((extension) => extension.__kind === "PausableConfig")) {
    required.push({ __kind: "PausableAccount" });
  }
  return required;
}

/* Derivation moved to `token-account.ts` so the recipient resolver can use it
   without importing this builder. Re-exported because every existing caller
   imports it from here. */
export { associatedTokenAccount };

/** The token program's own "no program here": the all-zero key. */
const ZERO_ADDRESS = "11111111111111111111111111111111";

/** `AccountState::Frozen` as the token program encodes it. */
const ACCOUNT_STATE_FROZEN = 2;

function memoInstruction(memo: string): Instruction {
  return {
    programAddress: MEMO_PROGRAM_ID as Address,
    accounts: [],
    data: new TextEncoder().encode(memo),
  } as Instruction;
}

/** The hook program this mint runs on every transfer, or null when it has none. */
function hookProgramIdOf(read: MintReadSuccess): string | null {
  const hook = mintExtensions(read).find((extension) => extension.__kind === "TransferHook");
  if (!hook) return null;
  const programId = String((hook as { programId?: unknown }).programId ?? "");
  return programId === "" || programId === ZERO_ADDRESS ? null : programId;
}

/**
 * What the chain says about one token account.
 *
 * Three states, not two. "Does not exist" is a fact this lifecycle needs — it
 * is the difference between a two-instruction transaction and a one-instruction
 * one — but a timeout, a rate limit or a transport error is **not** that fact,
 * and collapsing them made every read failure assert an absence. One flaky
 * `getTokenAccountBalance` turned a transfer into an existing account into an
 * account-creation: an extra instruction, rent the sender did not expect, a
 * different canary family, and a receipt whose reconciliation then recorded a
 * deviation about the account it had itself invented.
 */
export type TokenAccountRead =
  | Readonly<{ state: "PRESENT"; amountRaw: string }>
  | Readonly<{ state: "ABSENT" }>
  | Readonly<{ state: "UNREADABLE"; reason: string }>;

/**
 * The cluster's answer for an account it looked for and did not find.
 *
 * Read from the structured error before the message, because the message stopped
 * carrying the answer. `@solana/kit` now throws
 * `Solana error #-32602; Decode this error by running \`npx @solana/errors decode …\``
 * and puts the cluster's own words — *Invalid param: could not find account* —
 * in `context.__serverMessage`, base64 inside that decode instruction. A
 * classifier that sniffed only `message` therefore stopped recognising an
 * absent account the day that shape changed, and reported every missing
 * recipient account as unreadable instead.
 *
 * What that cost is the whole account-creation path: a transfer to somebody who
 * has never held this token refused with `ACCOUNT_STATE_UNREADABLE` rather than
 * creating the account and pricing its rent. It stayed hidden because every
 * recipient tested since already had an account, so the read never failed.
 *
 * `-32602` alone is not enough — it is `Invalid params` generally — so the code
 * narrows the search and the server's words decide.
 */
export function readsAsMissingAccount(failure: unknown): boolean {
  const context = (failure as { context?: Record<string, unknown> } | null | undefined)?.context;
  const serverMessage =
    context && typeof context.__serverMessage === "string" ? context.__serverMessage : "";
  const message = failure instanceof Error ? failure.message : String(failure);
  return /could not find account|account not found|invalid param/i.test(
    `${serverMessage} ${message}`,
  );
}

export async function readTokenAccount(
  handle: SolanaRpcHandle,
  tokenAccount: string,
): Promise<TokenAccountRead> {
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getTokenAccountBalance(tokenAccount as never).send({ abortSignal }),
    );
    return { state: "PRESENT", amountRaw: response.value.amount };
  } catch (failure) {
    if (readsAsMissingAccount(failure)) return { state: "ABSENT" };
    return {
      state: "UNREADABLE",
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
}

/**
 * The balance, or `null` for an account that is absent **or** unreadable.
 *
 * Kept for callers that only need a number and have their own refusal for a
 * missing one. Anything deciding the *shape* of a transaction must use
 * `readTokenAccount`, because for that decision the two nulls mean opposite
 * things.
 */
export async function readTokenAccountBalance(
  handle: SolanaRpcHandle,
  tokenAccount: string,
): Promise<string | null> {
  const read = await readTokenAccount(handle, tokenAccount);
  return read.state === "PRESENT" ? read.amountRaw : null;
}

/** Read the base fee for the exact compiled message. A null fee is not a zero fee. */
export async function readBaseFeeLamports(
  handle: SolanaRpcHandle,
  messageBytes: Uint8Array,
): Promise<Readonly<{ ok: true; lamports: string }> | TransferBuildFailure> {
  try {
    const encoded = Buffer.from(messageBytes).toString("base64");
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .getFeeForMessage(encoded as never, { commitment: "confirmed" })
        .send({ abortSignal }),
    );
    if (response.value === null || response.value === undefined) {
      return {
        ok: false,
        code: "FEE_UNAVAILABLE",
        reason: "The cluster returned no fee for the exact message, so the transfer cannot enter Review.",
      };
    }
    return { ok: true, lamports: String(response.value) };
  } catch (failure) {
    return {
      ok: false,
      code: "FEE_UNAVAILABLE",
      reason: `The endpoint did not price the exact message, so the transfer cannot enter Review: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }
}

/**
 * Build the transfer.
 *
 * Never throws: every refusal is a value with a code, because a build that
 * fails is an ordinary outcome of this surface — the sender holds nothing, the
 * evidence names a different mint, the endpoint would not give a blockhash —
 * and each of those deserves its own sentence rather than a stack trace.
 */
export async function buildTransferTransaction(args: {
  handle: SolanaRpcHandle;
  read: MintReadSuccess;
  passport: SolanaAssetPassport;
  input: SplTransferInput;
  /** The cluster epoch fetched with the mint, required to bind a fee config. */
  epoch: bigint;
  /**
   * The exact accounts to draw on, chosen by `chooseSpendSources`. Omitted
   * means the sender's canonical associated account for the whole amount,
   * which is what every single-source caller already meant.
   */
  sources?: readonly Readonly<{ address: string; amountRaw: string; state?: string }>[];
  /** A memo the destination requires, inserted immediately before its transfer. */
  memo?: string | null;
  now?: Date;
  /**
   * Solana Pay reference keys (RYN-PAY-REQUEST-001): read-only, non-signer
   * accounts appended to the last transfer leg so the transaction that paid
   * one request is findable by `getSignaturesForAddress(reference)`. The token
   * program ignores trailing accounts it does not name; nothing moves through
   * them. Omitted by every Send caller, whose bytes are therefore unchanged.
   */
  references?: readonly string[];
}): Promise<TransferBuildResult> {
  const { handle, read, passport, input } = args;

  if (input.mint !== read.raw.mint) {
    return {
      ok: false,
      code: "INPUT_MINT_MISMATCH",
      reason: `The proposal names mint ${input.mint} but the evidence was read from ${read.raw.mint}; building over the wrong mint would produce an exact transaction for the wrong asset.`,
    };
  }
  if (input.amountRaw === "0") {
    return { ok: false, code: "ZERO_AMOUNT", reason: "A zero-value transfer cannot be built." };
  }
  if (input.sender === input.recipient) {
    return { ok: false, code: "SENDER_RECIPIENT_SAME", reason: "The sender and recipient must be different accounts." };
  }

  const tokenProgram = programAddressOf(passport);
  const decimals = passport.identity.decimals.value;

  /* Classify the destination before deriving anything from it. An address can
     be a wallet whose associated account this transfer derives, or a token
     account the sender entered on purpose — and it can also be a mint, a
     program, an account of another mint or an owner no key exists for, all of
     which are refused here rather than discovered by the wallet. */
  const destination = await resolveTokenRecipient({
    handle,
    address: input.recipient,
    mint: input.mint,
    tokenProgram: String(tokenProgram),
  });
  if (!destination.ok) {
    return { ok: false, code: "RECIPIENT_UNSUPPORTED", reason: destination.reason };
  }
  const recipientTokenAccount = destination.destinationTokenAccount as string;
  /* Whose account it is. For an entered token account that is its recorded
     owner, not the address that was typed. */
  const recipientOwner = destination.owner;

  const senderTokenAccount = await associatedTokenAccount({
    owner: input.sender,
    mint: input.mint,
    tokenProgram: String(tokenProgram),
  });

  /* One leg per source account, in the order the caller chose them. The
     default is the single canonical account for the whole amount, which is
     what every caller written before multi-source meant. */
  const legs =
    args.sources && args.sources.length > 0
      ? args.sources.map((source) => ({ account: source.address, amountRaw: source.amountRaw }))
      : [{ account: senderTokenAccount, amountRaw: input.amountRaw }];

  const legTotal = legs.reduce((total, leg) => total + BigInt(leg.amountRaw), 0n);
  if (legTotal !== BigInt(input.amountRaw)) {
    return {
      ok: false,
      code: "SOURCE_TOTAL_MISMATCH",
      reason: `The chosen source accounts add up to ${legTotal} base units and the transfer asks for ${input.amountRaw}. A transfer that quietly moves a different amount than the one approved is not built.`,
    };
  }
  /* A hard ceiling well inside the wire limit. Above it the message would
     either not compile or not fit, and either way the answer is one refusal
     rather than a partial send split across two signatures. */
  const MAXIMUM_TRANSFER_LEGS = 12;
  if (legs.length > MAXIMUM_TRANSFER_LEGS) {
    return {
      ok: false,
      code: "TRANSACTION_TOO_LARGE",
      reason: `This asset sits in ${legs.length} accounts and one transaction carries at most ${MAXIMUM_TRANSFER_LEGS} transfer legs. Send a smaller amount, or consolidate the accounts first.`,
    };
  }

  const [senderRead, recipientRead] = await Promise.all([
    readTokenAccount(handle, legs[0].account),
    readTokenAccount(handle, recipientTokenAccount),
  ]);

  /* An account whose state did not read decides nothing. Both of these used to
     fall through as "absent", which for the sender meant a wrong refusal and
     for the recipient meant silently adding an account-creation to a transfer
     into an account that already existed. */
  if (senderRead.state === "UNREADABLE" || recipientRead.state === "UNREADABLE") {
    const unreadable = senderRead.state === "UNREADABLE" ? senderRead : recipientRead;
    return {
      ok: false,
      code: "ACCOUNT_STATE_UNREADABLE",
      reason: `The chain did not answer for an account this transfer depends on, so its shape cannot be decided: ${"reason" in unreadable ? unreadable.reason : "no reason given"}`,
    };
  }
  const senderBalance = senderRead.state === "PRESENT" ? senderRead.amountRaw : null;
  const recipientBalance = recipientRead.state === "PRESENT" ? recipientRead.amountRaw : null;

  if (senderBalance === null) {
    return {
      ok: false,
      code: "SENDER_ACCOUNT_MISSING",
      reason: `${input.sender} holds no account for this mint on ${input.network}, so there is nothing to send. Receiving the token once creates the account.`,
    };
  }
  if (BigInt(senderBalance) < BigInt(legs[0].amountRaw)) {
    return {
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      reason: `The account this transfer draws on holds ${senderBalance} base units and this leg asks for ${legs[0].amountRaw}. This is read from the chain at build time, not assumed.`,
    };
  }

  let blockhash: string;
  let lastValidBlockHeight: string;
  try {
    const latest = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getLatestBlockhash({ commitment: "confirmed" }).send({ abortSignal }),
    );
    blockhash = String(latest.value.blockhash);
    lastValidBlockHeight = String(latest.value.lastValidBlockHeight);
  } catch (failure) {
    return {
      ok: false,
      code: "BLOCKHASH_UNAVAILABLE",
      reason: `The endpoint did not return a recent blockhash, so no transaction can be built with a valid lifetime: ${failure instanceof Error ? failure.message : String(failure)}`,
    };
  }

  try {
    /* A signer that cannot sign. The fee payer's signature slot is left empty
       on purpose — the wallet fills it and nothing here can. */
    const feePayer = createNoopSigner(input.sender as Address);

    const instructions: Instruction[] = [];
    if (recipientBalance === null) {
      /* Idempotent, so a recipient account created between this read and the
         submission does not turn a good transfer into a failed one. */
      instructions.push(
        getCreateAssociatedTokenIdempotentInstruction({
          payer: feePayer,
          ata: recipientTokenAccount as Address,
          /* The account's owner, which is only the entered address when the
             entered address was a wallet. */
          owner: recipientOwner as Address,
          mint: input.mint as Address,
          systemProgram: SYSTEM_PROGRAM_ADDRESS,
          tokenProgram,
        }),
      );
    }
    const hasTransferFee = mintExtensions(read).some((extension) => extension.__kind === "TransferFeeConfig");

    /* A memo the destination requires, placed immediately before the transfer
       it belongs to rather than at the top of the message, because the token
       program reads the memo that precedes its own instruction. */
    if (args.memo) {
      instructions.push(memoInstruction(args.memo));
    }

    /* One checked transfer per source account, each with its own fee.
       Rounding is per instruction and upward, so two legs do not pay what one
       leg of the summed amount would — the mint withholds on each. */
    const legFees = legs.map((leg) =>
      hasTransferFee
        ? computeTransferFee(mintExtensions(read), BigInt(leg.amountRaw), args.epoch).feeRaw
        : "0",
    );
    legs.forEach((leg, index) => {
      const transferInput = {
        source: leg.account as Address,
        mint: input.mint as Address,
        destination: recipientTokenAccount as Address,
        authority: feePayer,
        amount: BigInt(leg.amountRaw),
        decimals,
      };
      instructions.push(
        hasTransferFee
          ? getTransferCheckedWithFeeInstruction(
              { ...transferInput, fee: BigInt(legFees[index]) },
              { programAddress: tokenProgram },
            )
          : getTransferCheckedInstruction(transferInput, { programAddress: tokenProgram }),
      );
    });

    const references = args.references ?? [];
    if (references.length > 0) {
      const last = instructions[instructions.length - 1];
      instructions[instructions.length - 1] = {
        ...last,
        accounts: [
          ...(last.accounts ?? []),
          ...references.map((reference) => ({ address: reference as Address, role: 0 })),
        ],
      } as Instruction;
    }

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayer(input.sender as Address, draft),
      (draft) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash as Blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) },
          draft,
        ),
      (draft) => appendTransactionMessageInstructions(instructions, draft),
    );

    const compiled = compileTransaction(message);
    const unsignedWireBase64 = getBase64EncodedWireTransaction(compiled);

    const baseFee = await readBaseFeeLamports(
      handle,
      compiled.messageBytes as unknown as Uint8Array,
    );
    if (!baseFee.ok) return baseFee;

    const createsRecipientAccount = recipientBalance === null;
    let ataRentLamports: string | null = null;
    if (createsRecipientAccount) {
      try {
        const rent = await withRpcDiscipline(handle, (abortSignal) =>
          handle.rpc
            .getMinimumBalanceForRentExemption(BigInt(getTokenSize(requiredTokenAccountExtensions(read))))
            .send({ abortSignal }),
        );
        ataRentLamports = String(rent);
      } catch {
        ataRentLamports = null;
      }
    }
    let feePayerBalanceLamports: bigint;
    try {
      const balance = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getBalance(input.sender as never).send({ abortSignal }),
      );
      feePayerBalanceLamports = BigInt(balance.value);
    } catch (failure) {
      return {
        ok: false,
        code: "FEE_UNAVAILABLE",
        reason: `The endpoint did not return the fee payer's SOL balance: ${failure instanceof Error ? failure.message : String(failure)}`,
      };
    }
    const requiredLamports = BigInt(baseFee.lamports) + BigInt(ataRentLamports ?? "0");
    if (feePayerBalanceLamports < requiredLamports) {
      return {
        ok: false,
        code: "INSUFFICIENT_FEE_BALANCE",
        reason: `The fee payer holds ${feePayerBalanceLamports.toString()} lamports, but this message requires ${baseFee.lamports} base-fee lamports${ataRentLamports ? ` and ${ataRentLamports} lamports of recipient-account rent` : ""}.`,
      };
    }
    const programs = [
      ...(createsRecipientAccount ? [String(ASSOCIATED_TOKEN_PROGRAM_ADDRESS)] : []),
      ...(args.memo ? [MEMO_PROGRAM_ID] : []),
      String(tokenProgram),
    ];

    /* One fingerprint leg per transfer instruction, in message order. */
    const transferLegs = legs.map((leg) => ({
      programAddress: String(tokenProgram),
      source: leg.account,
      mint: input.mint,
      destination: recipientTokenAccount,
      authority: input.sender,
      amountRaw: leg.amountRaw,
      decimals,
    }));

    /* What this exact shape is, decided from the facts just read rather than
       from the mint's reputation. The verdict travels on the plan so the
       server gate, the Review panel and the receipt all read the same one. */
    const support = classifySendSupport(
      sendSupportInputFromFacts({
        actionKind: classifyTokenTransfer({
          tokenProgram: String(tokenProgram),
          createsRecipientAccount,
        }),
        passport,
        preflight: null,
        sourceStates: legs.map(() => "INITIALIZED" as const),
        destination: {
          createsAccount: createsRecipientAccount,
          state: createsRecipientAccount ? null : "INITIALIZED",
        },
        transferHookExtraAccountsResolved: false,
        memoTransferRequired: args.memo ? true : false,
        structural: {
          nonTransferable: mintExtensions(read).some((entry) => entry.__kind === "NonTransferable"),
          paused: mintExtensions(read).some(
            (entry) => entry.__kind === "PausableConfig" && entry.paused === true,
          ),
          defaultAccountStateFrozen: mintExtensions(read).some(
            (entry) => entry.__kind === "DefaultAccountState" && entry.state === ACCOUNT_STATE_FROZEN,
          ),
          hookProgramId: hookProgramIdOf(read),
          transferFeeBasisPoints: hasTransferFee
            ? computeTransferFee(mintExtensions(read), BigInt(input.amountRaw), args.epoch).basisPoints
            : null,
        },
      }),
    );
    return {
      ok: true,
      plan: {
        actionKind: classifyTokenTransfer({
          tokenProgram: String(tokenProgram),
          createsRecipientAccount,
        }),
        network: input.network,
        mint: input.mint,
        tokenProgram: String(tokenProgram),
        decimals,
        sender: input.sender,
        recipient: input.recipient,
        /* The first leg, for every parser written before multi-source. */
        senderTokenAccount: legs[0].account,
        recipientTokenAccount,
        sources: legs.map((leg, index) => ({
          account: leg.account,
          amountRaw: leg.amountRaw,
          feeRaw: legFees[index],
        })),
        recipientKind: destination.kind,
        recipientOwner,
        memo: args.memo ?? null,
        transferHook: null,
        support,
        createsRecipientAccount,
        ataRentLamports,
        amountRaw: input.amountRaw,
        senderBalanceRaw: senderBalance,
        baseFeeLamports: baseFee.lamports,
        priorityFeeLamports: "0",
        programs,
        blockhash,
        lastValidBlockHeight,
        unsignedWireBase64,
        fingerprint: {
          messageHash: await sha256Hex(compiled.messageBytes as unknown as Uint8Array),
          feePayer: input.sender,
          blockhash,
          instructionCount: instructions.length,
          transfer: transferLegs[0],
          transfers: transferLegs,
        },
        builtAt: (args.now ?? new Date()).toISOString(),
      },
    };
  } catch (failure) {
    return {
      ok: false,
      code: "BUILD_FAILED",
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
}

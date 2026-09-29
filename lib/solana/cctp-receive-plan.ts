/**
 * Everything that would make the Solana replay fail, checked before a wallet
 * opens — and the exact bytes it would sign.
 *
 * This is `planBaseCctpMint`'s counterpart, and the questions it has to ask are
 * not the same ones. On Base the destination is a contract call, the recipient
 * is an address that always exists, and the only cost is gas. On Solana the
 * replay creates a nine-byte account somebody has to pay rent for, credits a
 * token account that may not exist yet, and needs Circle's own fee account
 * named correctly or it reverts.
 *
 * The replay guard is asked first, because a message already received needs no
 * transaction at all and offering one would be offering to waste a signature.
 */

import {
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
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
import { getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token-2022";
import { createHash } from "node:crypto";

import {
  buildCctpReceiveInstruction,
  CCTP_USED_NONCE_ACCOUNT_BYTES,
  deriveCctpReceiveAccounts,
  readTokenMessengerFeeRecipient,
  SOLANA_SYSTEM_PROGRAM,
  SOLANA_TOKEN_PROGRAM,
  SPL_TOKEN_ACCOUNT_BYTES,
} from "./cctp-receive.ts";
import {
  cctpLookupCompressionMap,
  cctpLookupCoverage,
  cctpReceiveLookupAddresses,
  readCctpLookupTable,
  resolveCctpLookupTableAddress,
} from "./cctp-lookup-table.ts";
import { SOLANA_CCTP_MAINNET_REGISTRY } from "./cctp-registry.ts";
import { SOLANA_ADDRESS_PATTERN } from "./cctp-direction.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";
import { associatedTokenAccount } from "./token-account.ts";

export type SolanaReceiveReadinessState = "READY" | "ALREADY_RECEIVED" | "NOT_READY" | "UNAVAILABLE";

export type SolanaReceivePlan = Readonly<{
  schema: "ryntra.solana.cctp-receive-plan";
  schemaVersion: "1.0.0";
  network: "mainnet";
  chainRef: "solana:mainnet";
  state: SolanaReceivePlanState;
  /** The wallet that will sign and pay. Not necessarily the recipient. */
  payer: string;
  /** The wallet the money is for. */
  recipientOwner: string;
  /** The token account CCTP credits, which the message already named. */
  recipientTokenAccount: string;
  recipientAccountExists: boolean;
  /**
   * What the receiving account held before this step.
   *
   * Read here rather than left to the card, because the receipt's
   * reconciliation asks for a balance on *both* sides of the arrival and a
   * before-figure that was never captured cannot be captured afterwards.
   */
  recipientUsdcBeforeRaw: string | null;
  /** True when this transaction also creates the recipient's token account. */
  createsRecipientAccount: boolean;
  nonce: string;
  usedNonceAccount: string;
  feeRecipientTokenAccount: string | null;
  /** The unsigned transaction, for the wallet. Null when there is nothing to sign. */
  unsignedWireBase64: string | null;
  blockhash: string | null;
  lastValidBlockHeight: string | null;
  costs: Readonly<{
    networkFeeLamports: string | null;
    /** Rent for the replay account. Paid by whoever submits, and never returned. */
    usedNonceRentLamports: string | null;
    /** Rent for the recipient's token account, when this creates one. */
    recipientAccountRentLamports: string | null;
    totalLamports: string | null;
  }>;
  payerLamports: string | null;
  affordable: boolean | null;
  fingerprint: Readonly<{ messageHash: string; feePayer: string; instructionCount: number; signers: readonly string[] }> | null;
  /**
   * The exact bytes, run without effect before any wallet sees them.
   *
   * A person should never be asked to approve a transaction nobody has
   * executed. It is also the last of Phantom's four published conditions for
   * not showing its red warning, and this lane used to satisfy it only after
   * the signature, which is one step too late to help the person deciding.
   */
  simulation: Readonly<{ status: "PRESENT" | "SKIPPED"; succeeded: boolean; error: string | null }>;
  /** One wallet prompt. Stated here so no surface has to count instructions. */
  walletPrompts: number;
  /**
   * How large the transaction is, and how close that is to what Solana accepts.
   *
   * Reported rather than left implicit because it is not a curiosity: the first
   * real transfer on this lane built at 1,226 bytes of 1,232 and Phantom blocked
   * it in red for exactly that reason. A surface that cannot see the number
   * cannot tell a comfortable transfer from one that is about to stop being
   * constructible.
   */
  size: Readonly<{
    wireBytes: number | null;
    limitBytes: 1232;
    headroomBytes: number | null;
    /** The lookup table this build used, and what it covered. */
    lookupTable: string | null;
    lookupTableState: string;
    lookupCovered: number;
    lookupTotal: number;
  }>;
  reason: string | null;
  permissionless: Readonly<{
    destinationCallerIsZero: boolean;
    meaning: "ANYONE_HOLDING_THE_MESSAGE_AND_ATTESTATION_MAY_SUBMIT_IT" | "ONLY_THE_PINNED_CALLER_MAY_SUBMIT_IT";
    notAGuarantee: "PERMISSIONLESS_MEANS_ANYONE_MAY_SUBMIT_IT_NOT_THAT_SOMEONE_WILL";
  }>;
  observedAt: string;
}>;

type SolanaReceivePlanState = SolanaReceiveReadinessState;

function sha256Hex(bytes: Uint8Array): string {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Build the Solana replay.
 *
 * Never throws for a chain condition: an unreadable account, a consumed nonce
 * and an unaffordable transaction are values with a state, because each of them
 * is a different next action for the person holding the transfer.
 */
export async function planSolanaCctpReceive(
  handle: SolanaRpcHandle,
  args: Readonly<{
    payer: string;
    recipientOwner: string;
    sourceDomain: number;
    /** The source chain's USDC as thirty-two bytes, from the message itself. */
    remoteTokenHex: string;
    nonce: string;
    messageHex: string;
    attestationHex: string;
    /** Thirty-two bytes from the message header. Zero means anyone may submit. */
    destinationCallerHex: string;
    now?: () => Date;
  }>,
): Promise<SolanaReceivePlan> {
  const observedAt = (args.now ?? (() => new Date()))().toISOString();
  const payer = args.payer.trim();
  const recipientOwner = args.recipientOwner.trim();
  const destinationCallerIsZero = /^(0x)?0{64}$/.test(args.destinationCallerHex.trim());

  const base = {
    schema: "ryntra.solana.cctp-receive-plan",
    schemaVersion: "1.0.0",
    network: "mainnet",
    chainRef: "solana:mainnet",
    payer,
    recipientOwner,
    nonce: args.nonce.trim().toLowerCase(),
    walletPrompts: 1,
    permissionless: {
      destinationCallerIsZero,
      meaning: destinationCallerIsZero
        ? ("ANYONE_HOLDING_THE_MESSAGE_AND_ATTESTATION_MAY_SUBMIT_IT" as const)
        : ("ONLY_THE_PINNED_CALLER_MAY_SUBMIT_IT" as const),
      notAGuarantee: "PERMISSIONLESS_MEANS_ANYONE_MAY_SUBMIT_IT_NOT_THAT_SOMEONE_WILL" as const,
    },
    observedAt,
  } as const;

  const unavailable = (reason: string, patch: Partial<SolanaReceivePlan> = {}): SolanaReceivePlan => ({
    ...base,
    state: "UNAVAILABLE",
    recipientTokenAccount: "",
    recipientAccountExists: false,
    recipientUsdcBeforeRaw: null,
    createsRecipientAccount: false,
    usedNonceAccount: "",
    feeRecipientTokenAccount: null,
    unsignedWireBase64: null,
    blockhash: null,
    lastValidBlockHeight: null,
    costs: {
      networkFeeLamports: null,
      usedNonceRentLamports: null,
      recipientAccountRentLamports: null,
      totalLamports: null,
    },
    payerLamports: null,
    affordable: null,
    fingerprint: null,
    simulation: { status: "SKIPPED", succeeded: false, error: null },
    size: {
      wireBytes: null,
      limitBytes: 1232,
      headroomBytes: null,
      lookupTable: null,
      lookupTableState: "NOT_REACHED",
      lookupCovered: 0,
      lookupTotal: 0,
    },
    reason,
    ...patch,
  });

  if (!SOLANA_ADDRESS_PATTERN.test(payer)) {
    return unavailable("The submitting wallet is not a Solana address.");
  }
  if (!SOLANA_ADDRESS_PATTERN.test(recipientOwner)) {
    return unavailable("The recipient is not a Solana address.");
  }

  const usdc = SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address;
  let derived: Awaited<ReturnType<typeof deriveCctpReceiveAccounts>>;
  let recipientTokenAccount: string;
  try {
    [derived, recipientTokenAccount] = await Promise.all([
      deriveCctpReceiveAccounts({
        sourceDomain: args.sourceDomain,
        remoteTokenHex: args.remoteTokenHex,
        nonce: args.nonce,
      }),
      associatedTokenAccount({ owner: recipientOwner, mint: usdc, tokenProgram: SOLANA_TOKEN_PROGRAM }),
    ]);
  } catch (cause) {
    return unavailable(cause instanceof Error ? cause.message : String(cause));
  }

  const withAccounts = {
    ...base,
    recipientTokenAccount,
    usedNonceAccount: derived.usedNonce,
    recipientUsdcBeforeRaw: null as string | null,
  };

  /* The replay guard, first. The account existing *is* the guard: the
     transmitter creates it during a successful receive and its presence is
     what makes a second one impossible. */
  let usedNonceExists: boolean;
  let recipientExists: boolean;
  let recipientUsdcBeforeRaw: string | null = null;
  let tokenMessengerData: Uint8Array | null;
  let payerLamports: string | null;
  try {
    const [used, recipient, messenger, balance] = await Promise.all([
      withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getAccountInfo(derived.usedNonce as never, { commitment: "confirmed", encoding: "base64" }).send({ abortSignal }),
      ),
      withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getAccountInfo(recipientTokenAccount as never, { commitment: "confirmed", encoding: "base64" }).send({ abortSignal }),
      ),
      withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getAccountInfo(derived.tokenMessenger as never, { commitment: "confirmed", encoding: "base64" }).send({ abortSignal }),
      ),
      withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getBalance(payer as never, { commitment: "confirmed" }).send({ abortSignal }),
      ),
    ]);
    usedNonceExists = used.value !== null && used.value !== undefined;
    recipientExists = recipient.value !== null && recipient.value !== undefined;
    /*
     * The balance before the transfer, captured here because it cannot be
     * captured afterwards.
     *
     * The first version of this only recorded a figure when the account did
     * *not* exist — a zero opening balance for a first-ever transfer — and left
     * `null` for every account that already had one. The first real Base to
     * Solana transfer landed correctly and its receipt still read
     * `DEVIATION_RECORDED`, with one deviation: the recipient's balance was not
     * read on both sides of the mint. The money was right and the statement
     * about it was one axis short, which is exactly the kind of gap a receipt
     * exists to refuse to paper over.
     *
     * An unreadable balance stays null rather than becoming a zero: a zero is a
     * claim, and "we could not read it" is not one.
     */
    recipientUsdcBeforeRaw = recipientExists
      ? await withRpcDiscipline(handle, (abortSignal) =>
          handle.rpc.getTokenAccountBalance(recipientTokenAccount as never, { commitment: "confirmed" }).send({ abortSignal }),
        )
          .then((read) => String(read.value.amount))
          .catch(() => null)
      : "0";
    const encodedMessenger = messenger.value?.data;
    tokenMessengerData = Array.isArray(encodedMessenger)
      ? Uint8Array.from(Buffer.from(String(encodedMessenger[0]), "base64"))
      : null;
    payerLamports = String(balance.value);
  } catch (cause) {
    return unavailable(
      `The destination accounts could not be read, so whether this transfer has already arrived is unknown: ${cause instanceof Error ? cause.message : String(cause)}`,
      withAccounts,
    );
  }

  if (usedNonceExists) {
    /* Nothing to send. The transfer already completed, by this person or by
       anyone else holding the message. */
    return {
      ...unavailable("", withAccounts),
      state: "ALREADY_RECEIVED",
      recipientAccountExists: recipientExists,
      payerLamports,
      reason: "This transfer has already been received on Solana. Sending it again would fail and move nothing.",
    };
  }

  const feeRecipientOwner = tokenMessengerData ? readTokenMessengerFeeRecipient(tokenMessengerData) : null;
  if (!feeRecipientOwner) {
    return unavailable(
      "Circle's own fee account for this route could not be read, and a transfer built without it would be refused by the programme.",
      { ...withAccounts, recipientAccountExists: recipientExists, payerLamports },
    );
  }
  let feeRecipientTokenAccount: string;
  try {
    feeRecipientTokenAccount = await associatedTokenAccount({
      owner: feeRecipientOwner,
      mint: usdc,
      tokenProgram: SOLANA_TOKEN_PROGRAM,
    });
  } catch (cause) {
    return unavailable(cause instanceof Error ? cause.message : String(cause), {
      ...withAccounts,
      recipientAccountExists: recipientExists,
      payerLamports,
    });
  }

  let blockhash: string;
  let lastValidBlockHeight: string;
  try {
    const latest = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getLatestBlockhash({ commitment: "confirmed" }).send({ abortSignal }),
    );
    blockhash = String(latest.value.blockhash);
    lastValidBlockHeight = String(latest.value.lastValidBlockHeight);
  } catch (cause) {
    return unavailable(
      `The cluster did not return a blockhash: ${cause instanceof Error ? cause.message : String(cause)}`,
      { ...withAccounts, recipientAccountExists: recipientExists, feeRecipientTokenAccount, payerLamports },
    );
  }

  /*
   * The lookup table, read before the message is compiled.
   *
   * Fifteen of the twenty accounts a `receive_message` names never change, and
   * writing each of them out in full is what put the first real transfer six
   * bytes under Solana's packet limit. A table replaces each of those
   * thirty-two-byte addresses with an index.
   *
   * Absent or unreadable, the build simply proceeds without it: larger, still
   * correct, and honest about its own size in `size` below. A missing table is
   * never a reason to refuse a transfer that has already burned on the far side.
   */
  /* The table for *this* source domain. A Base table holds Base's token pair
     and remote messenger, which compress nothing on an Ethereum receive. */
  const lookupTable = await readCctpLookupTable(handle, resolveCctpLookupTableAddress(process.env, args.sourceDomain));
  let lookupDerived: readonly string[] = [];
  try {
    lookupDerived = await cctpReceiveLookupAddresses({
      sourceDomain: args.sourceDomain,
      remoteTokenHex: args.remoteTokenHex,
      feeRecipientTokenAccount,
    });
  } catch {
    /* A derivation that failed here is not a reason to stop: it only means
       nothing can be compressed, and the uncompressed build is the same
       transfer. */
  }
  const coverage = cctpLookupCoverage({ table: lookupTable, derived: lookupDerived });

  let unsignedWireBase64: string;
  let messageBytes: Uint8Array;
  let instructionCount: number;
  try {
    const feePayer = createNoopSigner(payer as Address);
    const instructions: Instruction[] = [];
    if (!recipientExists) {
      /* Idempotent, and in the same transaction as the replay rather than
         before it. The message names this exact account and the programme
         creates nothing, so a missing account is not a warning to show — it is
         a step that has to happen, and folding it in here means the person
         signs once rather than twice and cannot end up having paid for an
         account whose transfer then never arrives. */
      instructions.push(
        getCreateAssociatedTokenIdempotentInstruction({
          payer: feePayer,
          ata: recipientTokenAccount as Address,
          owner: recipientOwner as Address,
          mint: usdc as Address,
          systemProgram: SOLANA_SYSTEM_PROGRAM as Address,
          tokenProgram: SOLANA_TOKEN_PROGRAM as Address,
        }),
      );
    }
    instructions.push(
      await buildCctpReceiveInstruction({
        payer,
        caller: payer,
        sourceDomain: args.sourceDomain,
        remoteTokenHex: args.remoteTokenHex,
        nonce: args.nonce,
        mintRecipient: recipientTokenAccount,
        feeRecipientTokenAccount,
        messageHex: args.messageHex,
        attestationHex: args.attestationHex,
      }),
    );
    instructionCount = instructions.length;
    const compression = cctpLookupCompressionMap({ table: lookupTable, derived: lookupDerived });
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayer(payer as Address, draft),
      (draft) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash as Blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) },
          draft,
        ),
      (draft) => appendTransactionMessageInstructions(instructions, draft),
      (draft) =>
        Object.keys(compression).length === 0
          ? draft
          : compressTransactionMessageUsingAddressLookupTables(draft, compression),
    );
    const compiled = compileTransaction(message);
    unsignedWireBase64 = getBase64EncodedWireTransaction(compiled);
    messageBytes = compiled.messageBytes as unknown as Uint8Array;
  } catch (cause) {
    return unavailable(
      `The receiving transaction could not be built: ${cause instanceof Error ? cause.message : String(cause)}`,
      { ...withAccounts, recipientAccountExists: recipientExists, feeRecipientTokenAccount, payerLamports, blockhash, lastValidBlockHeight },
    );
  }

  let networkFeeLamports: string | null = null;
  let usedNonceRentLamports: string | null = null;
  let recipientAccountRentLamports: string | null = null;
  try {
    const [fee, nonceRent, accountRent] = await Promise.all([
      withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc
          .getFeeForMessage(Buffer.from(messageBytes).toString("base64") as never, { commitment: "confirmed" })
          .send({ abortSignal }),
      ),
      withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getMinimumBalanceForRentExemption(BigInt(CCTP_USED_NONCE_ACCOUNT_BYTES)).send({ abortSignal }),
      ),
      recipientExists
        ? Promise.resolve(null)
        : withRpcDiscipline(handle, (abortSignal) =>
            handle.rpc.getMinimumBalanceForRentExemption(BigInt(SPL_TOKEN_ACCOUNT_BYTES)).send({ abortSignal }),
          ),
    ]);
    networkFeeLamports = fee.value === null || fee.value === undefined ? null : String(fee.value);
    usedNonceRentLamports = String(nonceRent);
    recipientAccountRentLamports = accountRent === null ? null : String(accountRent);
  } catch {
    /* An unpriced cost is not a free one. The state below says NOT_READY rather
       than offering a transaction whose price nobody could read. */
  }

  const totalLamports =
    networkFeeLamports !== null && usedNonceRentLamports !== null
      ? (
          BigInt(networkFeeLamports) +
          BigInt(usedNonceRentLamports) +
          BigInt(recipientAccountRentLamports ?? "0")
        ).toString()
      : null;
  const affordable =
    totalLamports !== null && payerLamports !== null ? BigInt(payerLamports) >= BigInt(totalLamports) : null;

  /**
   * The exact bytes, executed without effect before a wallet is ever shown them.
   *
   * Phantom's published guidance for developers ends on this: *"Before
   * submitting the transaction for signing, simulate the transaction with
   * `sigVerify: false` using your RPC node to ensure it will not fail onchain.
   * Failed transactions could trigger simulation warnings."* It is the right
   * order irrespective of any wallet — a person should never be asked to
   * approve bytes nobody has run — and until now this lane ran them only after
   * the signature, in the submit route, which is one step too late to be of any
   * use to the person deciding.
   *
   * A simulation that could not be obtained is reported as absent rather than
   * as a pass.
   */
  let simulation: Readonly<{ status: "PRESENT" | "SKIPPED"; succeeded: boolean; error: string | null }> = {
    status: "SKIPPED",
    succeeded: false,
    error: null,
  };
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .simulateTransaction(unsignedWireBase64 as never, {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
        })
        .send({ abortSignal }),
    );
    const failed = response.value.err !== null && response.value.err !== undefined;
    simulation = {
      status: "PRESENT",
      succeeded: !failed,
      error: failed
        ? JSON.stringify(response.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
        : null,
    };
  } catch (cause) {
    simulation = {
      status: "SKIPPED",
      succeeded: false,
      error: `The cluster would not simulate this step: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const costs = { networkFeeLamports, usedNonceRentLamports, recipientAccountRentLamports, totalLamports };
  /* Measured from the bytes that would actually go on the wire, not estimated
     from the account count. */
  const wireBytes = Buffer.from(unsignedWireBase64, "base64").length;
  const size = {
    wireBytes,
    limitBytes: 1232 as const,
    headroomBytes: 1232 - wireBytes,
    lookupTable: lookupTable.state === "ACTIVE" ? lookupTable.address : null,
    lookupTableState: lookupTable.state,
    lookupCovered: coverage.covered,
    lookupTotal: coverage.total,
  };
  const fingerprint = {
    messageHash: sha256Hex(messageBytes),
    feePayer: payer,
    instructionCount,
    /* One signature and one signer. The replay needs no ephemeral key of its
       own — the account it creates is a program-derived address, which is
       exactly why this side takes one prompt where the burn side takes two. */
    signers: [payer] as readonly string[],
  };

  const ready = {
    ...withAccounts,
    recipientAccountExists: recipientExists,
    recipientUsdcBeforeRaw,
    createsRecipientAccount: !recipientExists,
    feeRecipientTokenAccount,
    unsignedWireBase64,
    blockhash,
    lastValidBlockHeight,
    costs,
    payerLamports,
    affordable,
    fingerprint,
    simulation,
    size,
  };

  if (totalLamports === null) {
    return { ...ready, state: "NOT_READY", reason: "The cost of receiving could not be read, and an unpriced cost is not a free one." };
  }
  if (affordable === false) {
    return {
      ...ready,
      state: "NOT_READY",
      reason: "This wallet holds too little SOL for the network fee and the deposit the receiving account needs.",
    };
  }
  if (!simulation.succeeded) {
    /* Offering a wallet a transaction the cluster says fails is asking somebody
       to pay a fee to be told what a read already knew. */
    return {
      ...ready,
      state: "NOT_READY",
      reason:
        simulation.status === "SKIPPED"
          ? "The network would not run this step without effect, so what it would do is unknown and it is not being offered for signing."
          : `This step does not succeed when the network runs it, so nothing was offered to sign: ${simulation.error}`,
    };
  }
  return { ...ready, state: "READY", reason: null };
}

/**
 * What came back from the wallet on the receiving side, checked against what
 * this deployment derived.
 *
 * The burn side compares two complete wire transactions, because there the
 * server built exact bytes and the only legitimate difference is a wallet's own
 * guards. This side cannot do that as cheaply — the plan is rebuilt against a
 * fresh blockhash on every request, so byte equality would fail for an honest
 * signature every time. So it checks the **effect** instead, and re-derives
 * every part of that effect from things a caller cannot choose: the durable
 * claim, and the message Circle actually signed.
 *
 * Four things have to hold, and each of them rules out a different substitution:
 *
 * 1. **One CCTP instruction, on the real transmitter.** Not two, not a
 *    look-alike programme.
 * 2. **Its data is exactly the receive of the attested message.** The
 *    discriminator, Circle's message and Circle's attestation, byte for byte —
 *    so a transaction carrying somebody else's message cannot pass.
 * 3. **It credits the account the message names**, which is the account the
 *    recipient's wallet owns. This is the field that decides where the money
 *    lands.
 * 4. **Everything else is a known companion**: creating that same token
 *    account, a compute-budget request, or a wallet's own Lighthouse
 *    assertions, which can only make a transaction fail and never move
 *    anything.
 *
 * Unlike a burn, a mistake here cannot destroy value: the replay is
 * idempotent, and the money goes to the account the message named whoever
 * submits it. What this check protects is the person's signature and their SOL
 * — a transaction that does something they did not read is a defect even when
 * it cannot spend their USDC.
 */

import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";

import { encodeReceiveMessageData, SOLANA_SYSTEM_PROGRAM, SOLANA_TOKEN_PROGRAM } from "./cctp-receive.ts";
import { SOLANA_CCTP_MAINNET_REGISTRY } from "./cctp-registry.ts";

const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

/** The position of the credited token account in `receive_message`'s account list. */
export const RECEIVE_MINT_RECIPIENT_INDEX = 15;

export const CCTP_RECEIVE_VERDICTS = [
  "CLEARED",
  "UNREADABLE",
  "NO_RECEIVE_INSTRUCTION",
  "MULTIPLE_RECEIVE_INSTRUCTIONS",
  "MESSAGE_CHANGED",
  "RECIPIENT_CHANGED",
  "UNREVIEWED_PROGRAM",
  "FEE_PAYER_CHANGED",
] as const;
export type CctpReceiveVerdict = (typeof CCTP_RECEIVE_VERDICTS)[number];

export type CctpReceiveCheck = Readonly<{
  verdict: CctpReceiveVerdict;
  detail: string;
  /** Programs beyond the receive itself. Empty when the wallet added nothing. */
  companionPrograms: readonly string[];
}>;

type CompiledMessage = Readonly<{
  header: Readonly<{
    numSignerAccounts: number;
    numReadonlySignerAccounts: number;
    numReadonlyNonSignerAccounts: number;
  }>;
  staticAccounts: readonly unknown[];
  instructions: readonly Readonly<{
    programAddressIndex: number;
    accountIndices?: readonly number[];
    data?: Uint8Array;
  }>[];
}>;

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

const hex = (bytes: Uint8Array | undefined): string => (bytes ? Buffer.from(bytes).toString("hex") : "");

/**
 * Check one signed receiving transaction.
 *
 * Every expectation is supplied by the caller from a durable or provider
 * source. Nothing here reads the request.
 */
export function checkCctpSignedReceive(args: {
  signedWireBase64: string;
  /** The wallet that was asked to sign and pay. */
  payer: string;
  /** The exact message Circle signed for this transfer. */
  messageHex: string;
  attestationHex: string;
  /** The token account the message names, derived from the recipient's wallet. */
  recipientTokenAccount: string;
}): CctpReceiveCheck {
  let message: CompiledMessage;
  try {
    const transaction = getTransactionDecoder().decode(fromBase64(args.signedWireBase64));
    message = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes as unknown as Uint8Array,
    ) as unknown as CompiledMessage;
  } catch (cause) {
    return {
      verdict: "UNREADABLE",
      detail: `The signed transfer could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`,
      companionPrograms: [],
    };
  }

  const transmitter =
    SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.components.find((entry) => entry.role === "MESSAGE_TRANSMITTER_V2")
      ?.address ?? "";
  const account = (index: number): string => String(message.staticAccounts[index] ?? `lookup:${index}`);

  if (account(0) !== args.payer) {
    return {
      verdict: "FEE_PAYER_CHANGED",
      detail: "The transfer that came back is paid for by a different wallet from the one that was asked.",
      companionPrograms: [],
    };
  }

  let expectedData: string;
  try {
    expectedData = hex(encodeReceiveMessageData(args.messageHex, args.attestationHex));
  } catch (cause) {
    return {
      verdict: "MESSAGE_CHANGED",
      detail: `The attested message could not be encoded for comparison: ${cause instanceof Error ? cause.message : String(cause)}`,
      companionPrograms: [],
    };
  }

  const receives = message.instructions.filter((entry) => account(entry.programAddressIndex) === transmitter);
  if (receives.length === 0) {
    return {
      verdict: "NO_RECEIVE_INSTRUCTION",
      detail: "The transfer that came back does not receive anything through Circle's programme.",
      companionPrograms: [],
    };
  }
  if (receives.length > 1) {
    return {
      verdict: "MULTIPLE_RECEIVE_INSTRUCTIONS",
      detail: "The transfer that came back would receive more than once, which was not what was prepared.",
      companionPrograms: [],
    };
  }
  const receive = receives[0];
  if (hex(receive.data) !== expectedData) {
    return {
      verdict: "MESSAGE_CHANGED",
      detail: "The transfer that came back carries a different message from the one Circle signed for this transfer.",
      companionPrograms: [],
    };
  }
  const credited = account((receive.accountIndices ?? [])[RECEIVE_MINT_RECIPIENT_INDEX] ?? -1);
  if (credited !== args.recipientTokenAccount) {
    return {
      verdict: "RECIPIENT_CHANGED",
      detail: "The transfer that came back would credit a different account from the one this transfer is for.",
      companionPrograms: [],
    };
  }

  /* Everything a wallet or this product is allowed to have put alongside it.
     An unknown programme is a full stop rather than a warning: the person read
     one action and this is the moment to notice a second. */
  const allowed = new Set([
    transmitter,
    ASSOCIATED_TOKEN_PROGRAM,
    COMPUTE_BUDGET_PROGRAM,
    LIGHTHOUSE_PROGRAM,
    SOLANA_SYSTEM_PROGRAM,
    SOLANA_TOKEN_PROGRAM,
  ]);
  const companions: string[] = [];
  for (const entry of message.instructions) {
    const program = account(entry.programAddressIndex);
    if (program === transmitter) continue;
    if (!allowed.has(program)) {
      return {
        verdict: "UNREVIEWED_PROGRAM",
        detail: `The transfer that came back also calls ${program}, which was not part of what was prepared.`,
        companionPrograms: companions,
      };
    }
    if (!companions.includes(program)) companions.push(program);
  }

  return {
    verdict: "CLEARED",
    detail: "The signed transfer receives exactly the message Circle signed, into exactly the account it names.",
    companionPrograms: companions,
  };
}

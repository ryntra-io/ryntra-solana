/**
 * Circle's attestation, read for one burn.
 *
 * This is the module the whole bridge waits on, and it exists to get one thing
 * right that is easy to get wrong: **while a burn is waiting, Iris answers
 * HTTP 404.** Circle documents this as a normal polling state, not as a
 * refusal. A client that reads 404 as "no such burn" concludes the money never
 * left, and the next thing a person does after that conclusion is burn again —
 * which is precisely the failure the bridge forbids and the one this lane can
 * never recover from. So 404 is `PENDING_INDEXING` here, and nothing in this
 * file can turn an unread answer into an absent burn.
 *
 * Circle publishes three distinct not-ready states and this module keeps them
 * distinct, because they lead to different actions:
 *
 * - **404** — the burn is not indexed yet, or the hash/domain is wrong. Keep
 *   polling; if it persists, verify the burn on the source explorer rather
 *   than resending.
 * - **200 with an empty `messages` array** — the transaction is known and not
 *   processed. Keep polling.
 * - **200 with a message whose status is not `complete`** — awaiting block
 *   confirmations. Keep polling, and Circle may say why in `delayReason`.
 *
 * A trap worth naming: Circle's prose pages print `"status": "pending"` while
 * its OpenAPI specification enumerates `pending_confirmations`. Both cannot be
 * matched by equality, so nothing here compares against either — the only
 * positive test is `status === "complete"`, and everything else is not ready.
 * Circle's own sample code does the same, which is the tell that the prose is
 * the stale half.
 *
 * The second trap is subtler. `attestation` is the literal string `PENDING`
 * and `message` is the literal string `0x` while a burn waits, so a client that
 * checks only `status` and then forwards `message` would hand the destination
 * chain two bytes and call it a transfer. Both fields are proved to be real
 * hex here before any state above pending is reported.
 */

import {
  readIrisJson,
  CCTP_IRIS_MAINNET_ORIGIN,
  type CctpProviderReason,
} from "./cctp-provider.ts";
import { decodeCctpV2Message, isPlaceholderNonce, type CctpV2Message } from "./cctp-message.ts";
import { solanaCctpLane, type SolanaCctpDirection } from "./cctp-registry.ts";

export const CCTP_ATTESTATION_STATES = [
  /** Circle has not indexed the burn yet. Includes HTTP 404. Never terminal. */
  "PENDING_INDEXING",
  /** Circle has the burn and is still waiting on source-chain confirmations. */
  "PENDING_CONFIRMATIONS",
  /** A signed attestation exists over a message this product can decode. */
  "ATTESTED",
  /** The answer could not be read. Also never terminal, and never an absence. */
  "UNAVAILABLE",
] as const;
export type CctpAttestationState = (typeof CCTP_ATTESTATION_STATES)[number];

/**
 * Why the read did not produce an attestation.
 *
 * `NO_MATCHING_MESSAGE` is this module's own: Iris answered about the
 * transaction and none of the messages it returned is the burn that was
 * expected. That is not the same as "the burn is missing" and must never be
 * allowed to read as one — a burn transaction on Solana can legitimately carry
 * more than one CCTP message, and an expectation that fails to match is a
 * reason to stop and look, not a reason to send anything again.
 */
export type CctpAttestationReason = CctpProviderReason | "NO_MATCHING_MESSAGE";

/** Circle's own account of why a Fast transfer has not been signed yet. */
export const CCTP_DELAY_REASONS = [
  "insufficient_fee",
  "amount_above_max",
  "insufficient_allowance_available",
] as const;
export type CctpDelayReason = (typeof CCTP_DELAY_REASONS)[number];

export type CctpAttestedMessage = Readonly<{
  /** The exact bytes the destination transmitter must be handed. */
  messageHex: string;
  /** Concatenated 65-byte ECDSA signatures from Circle's attesters. */
  attestationHex: string;
  /** Circle's own identifier for the emitted event. */
  eventNonce: string;
  /** The replay key the destination `usedNonces` mapping is keyed on. */
  nonce: string;
  cctpVersion: 2;
  decoded: CctpV2Message;
}>;

export type CctpAttestationLookup = Readonly<{
  schema: "ryntra.solana.cctp-attestation";
  schemaVersion: "1.0.0";
  provider: "CIRCLE_IRIS_V2";
  environment: "MAINNET";
  sourceDomain: number;
  destinationDomain: number;
  transactionHash: string;
  state: CctpAttestationState;
  reason: CctpAttestationReason | null;
  httpStatus: number | null;
  delayReason: CctpDelayReason | null;
  /** How many messages Circle returned for this transaction, matched or not. */
  messagesReturned: number;
  attested: CctpAttestedMessage | null;
  /**
   * The soonest this may be asked again, in milliseconds.
   *
   * Carried in the answer rather than left to the caller's memory. Circle's
   * reference implementation polls no faster than every five seconds, and its
   * own sample sleeps five minutes after a 429 — exceeding the published limit
   * blocks every API request for the next five minutes, which during a live
   * transfer would blind this product exactly when it must not be blind.
   */
  pollAfterMs: number;
  observedAt: string;
  source: Readonly<{ host: "iris-api.circle.com"; ref: string }>;
}>;

/** Circle's documented floor. Never poll faster than this. */
export const CCTP_ATTESTATION_POLL_MS = 5_000;
/** Circle's own back-off after a throttle, from its reference client. */
export const CCTP_ATTESTATION_THROTTLED_POLL_MS = 300_000;

const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX_BODY = /^0x[0-9a-fA-F]+$/;

/**
 * Whether this string can be a transaction identifier on the source chain.
 *
 * Checked before it reaches a URL. A Solana burn is looked up by its base58
 * signature exactly as the cluster returned it — no `0x`, no hex conversion —
 * and an EVM burn by its 32-byte hash; putting an unvalidated string into a
 * provider request is how a lookup becomes a request for something else.
 */
export function isSourceTransactionId(sourceDomain: number, value: string): boolean {
  const trimmed = value.trim();
  return sourceDomain === 5 ? SOLANA_SIGNATURE.test(trimmed) : EVM_TX_HASH.test(trimmed);
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function delayReasonOf(value: unknown): CctpDelayReason | null {
  return typeof value === "string" && (CCTP_DELAY_REASONS as readonly string[]).includes(value)
    ? (value as CctpDelayReason)
    : null;
}

/** What a caller already knows about its own burn, so the answer can be bound to it. */
export type CctpAttestationExpectation = Readonly<{
  destinationDomain: number;
  /** 32 bytes, hex. The recipient the burn actually named. */
  mintRecipient: string;
  amountRaw: string;
}>;

type Candidate = Readonly<{
  ready: boolean;
  delayReason: CctpDelayReason | null;
  attested: CctpAttestedMessage | null;
}>;

/**
 * Read one message entry without trusting any single field of it.
 *
 * `status` alone is not enough and neither is `attestation` alone: the entry is
 * only ready when the status says complete **and** both variable-length fields
 * carry real hex **and** the message decodes as CCTP V2 with a nonce that is
 * not the placeholder the destination pre-marks as consumed.
 */
function readCandidate(entry: unknown): Candidate {
  const raw = object(entry);
  if (!raw) return { ready: false, delayReason: null, attested: null };
  const delayReason = delayReasonOf(raw.delayReason);

  const status = typeof raw.status === "string" ? raw.status : null;
  const messageHex = typeof raw.message === "string" ? raw.message.trim() : "";
  const attestationHex = typeof raw.attestation === "string" ? raw.attestation.trim() : "";
  const eventNonce = typeof raw.eventNonce === "string" ? raw.eventNonce : "";
  const cctpVersion = typeof raw.cctpVersion === "number" ? raw.cctpVersion : null;

  /* The only positive test. Neither documented spelling of "not complete" is
     compared against, because Circle's prose and its specification disagree on
     which one the wire carries. */
  if (status !== "complete") return { ready: false, delayReason, attested: null };
  /* `0x` and `PENDING` are Circle's placeholders, not values. */
  if (!HEX_BODY.test(messageHex) || messageHex.length <= 2) {
    return { ready: false, delayReason, attested: null };
  }
  if (!HEX_BODY.test(attestationHex) || attestationHex.length <= 2) {
    return { ready: false, delayReason, attested: null };
  }
  /* A V1 message returned by the V2 endpoint is a real possibility — the same
     endpoint serves both — and it is not this lane's message. */
  if (cctpVersion !== 2) return { ready: false, delayReason, attested: null };

  const decoded = decodeCctpV2Message(messageHex);
  if (!decoded.ok) return { ready: false, delayReason, attested: null };
  if (isPlaceholderNonce(decoded.message.header.nonce)) {
    return { ready: false, delayReason, attested: null };
  }

  return {
    ready: true,
    delayReason,
    attested: {
      messageHex,
      attestationHex,
      eventNonce,
      nonce: decoded.message.header.nonce,
      cctpVersion: 2,
      decoded: decoded.message,
    },
  };
}

function matchesExpectation(candidate: CctpAttestedMessage, expect: CctpAttestationExpectation): boolean {
  const { header, burn } = candidate.decoded;
  if (!burn) return false;
  if (header.destinationDomain !== expect.destinationDomain) return false;
  if (burn.mintRecipient.toLowerCase() !== expect.mintRecipient.trim().toLowerCase()) return false;
  return burn.amountRaw === expect.amountRaw;
}

function lookup(
  base: Omit<CctpAttestationLookup, "state" | "reason" | "httpStatus" | "delayReason" | "messagesReturned" | "attested" | "pollAfterMs">,
  patch: Pick<CctpAttestationLookup, "state" | "reason" | "httpStatus"> &
    Partial<Pick<CctpAttestationLookup, "delayReason" | "messagesReturned" | "attested" | "pollAfterMs">>,
): CctpAttestationLookup {
  return {
    ...base,
    delayReason: null,
    messagesReturned: 0,
    attested: null,
    pollAfterMs: patch.reason === "RATE_LIMITED" ? CCTP_ATTESTATION_THROTTLED_POLL_MS : CCTP_ATTESTATION_POLL_MS,
    ...patch,
  };
}

/**
 * Ask Circle about one burn.
 *
 * Never throws for a provider condition. Every outcome — including a refusal,
 * a throttle and an unreachable edge — comes back as a state with a reason, so
 * a caller cannot accidentally treat an exception as an answer.
 */
export async function fetchCctpAttestation(
  input: Readonly<{
    direction: SolanaCctpDirection;
    transactionHash: string;
    expect?: CctpAttestationExpectation;
  }>,
  dependencies: Readonly<{ fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number }> = {},
): Promise<CctpAttestationLookup> {
  const lane = solanaCctpLane(input.direction);
  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const transactionHash = input.transactionHash.trim();
  const base = {
    schema: "ryntra.solana.cctp-attestation",
    schemaVersion: "1.0.0",
    provider: "CIRCLE_IRIS_V2",
    environment: "MAINNET",
    sourceDomain: lane.source.domain,
    destinationDomain: lane.destination.domain,
    transactionHash,
    observedAt,
    source: {
      host: "iris-api.circle.com" as const,
      ref: `${CCTP_IRIS_MAINNET_ORIGIN}/v2/messages/${lane.source.domain}`,
    },
  } satisfies Omit<
    CctpAttestationLookup,
    "state" | "reason" | "httpStatus" | "delayReason" | "messagesReturned" | "attested" | "pollAfterMs"
  >;

  if (!isSourceTransactionId(lane.source.domain, transactionHash)) {
    return lookup(base, { state: "UNAVAILABLE", reason: "MALFORMED_RESPONSE", httpStatus: null });
  }

  const read = await readIrisJson(
    `/v2/messages/${lane.source.domain}`,
    {
      fetchImpl: dependencies.fetchImpl ?? fetch,
      timeoutMs: dependencies.timeoutMs ?? 8_000,
    },
    { transactionHash },
  );

  if (!read.ok) {
    /* The line this whole module exists for. */
    if (read.status === 404) {
      return lookup(base, { state: "PENDING_INDEXING", reason: null, httpStatus: 404 });
    }
    return lookup(base, { state: "UNAVAILABLE", reason: read.code, httpStatus: read.status });
  }

  const payload = object(read.value);
  const messages = payload && Array.isArray(payload.messages) ? payload.messages : null;
  if (!messages) {
    return lookup(base, { state: "UNAVAILABLE", reason: "MALFORMED_RESPONSE", httpStatus: read.status });
  }
  if (messages.length === 0) {
    /* Circle knows the transaction and has not processed it. Still pending. */
    return lookup(base, { state: "PENDING_INDEXING", reason: null, httpStatus: read.status, messagesReturned: 0 });
  }
  if (messages.length > 32) {
    return lookup(base, {
      state: "UNAVAILABLE",
      reason: "MALFORMED_RESPONSE",
      httpStatus: read.status,
      messagesReturned: messages.length,
    });
  }

  const candidates = messages.map(readCandidate);
  const delayReason = candidates.find((entry) => entry.delayReason !== null)?.delayReason ?? null;
  const shared = { httpStatus: read.status, delayReason, messagesReturned: messages.length };

  const ready = candidates.filter((entry): entry is Candidate & { attested: CctpAttestedMessage } =>
    entry.ready && entry.attested !== null,
  );

  if (input.expect) {
    const bound = ready.find((entry) => matchesExpectation(entry.attested, input.expect as CctpAttestationExpectation));
    if (bound) {
      return lookup(base, { state: "ATTESTED", reason: null, ...shared, attested: bound.attested });
    }
    /* Something is still waiting, so ours may be the one that is waiting. */
    if (ready.length < candidates.length) {
      return lookup(base, { state: "PENDING_CONFIRMATIONS", reason: null, ...shared });
    }
    /* Every message Circle has for this transaction is signed, and none of them
       is the burn that was expected. That is a stop-and-look, never a resend. */
    return lookup(base, { state: "UNAVAILABLE", reason: "NO_MATCHING_MESSAGE", ...shared });
  }

  if (ready.length > 0) {
    return lookup(base, { state: "ATTESTED", reason: null, ...shared, attested: ready[0].attested });
  }
  return lookup(base, { state: "PENDING_CONFIRMATIONS", reason: null, ...shared });
}

/**
 * Whether this state permits building a destination mint.
 *
 * One function, so no surface has to remember the rule. Everything that is not
 * a bound attestation answers false, including every flavour of "we could not
 * read it" — an unread answer authorizes nothing.
 */
export function cctpMintAuthorized(result: CctpAttestationLookup): boolean {
  return result.state === "ATTESTED" && result.attested !== null;
}

/**
 * Whether the caller should ask again.
 *
 * True for both pending states and for every unavailable one except a
 * malformed answer, which will not become well-formed by waiting.
 */
export function cctpShouldPollAgain(result: CctpAttestationLookup): boolean {
  if (result.state === "ATTESTED") return false;
  if (result.state === "UNAVAILABLE") {
    return result.reason !== "MALFORMED_RESPONSE" && result.reason !== "NO_MATCHING_MESSAGE";
  }
  return true;
}

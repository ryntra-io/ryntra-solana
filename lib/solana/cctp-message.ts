/**
 * The CCTP V2 wire message, decoded.
 *
 * Three separate parties hand this product the same bytes and none of them is
 * a source of truth on its own: Circle's attestation service returns them as
 * hex, the destination chain carries them in `receiveMessage` calldata, and the
 * source chain's `MessageSent` account holds them before either. A decoder that
 * lives in one of those places would have to be copied into the others, so it
 * lives here and all three read it.
 *
 * **The version field is the whole safety story.** CCTP V1 and V2 use the same
 * transport and different layouts: V1 writes `0` at offset 0, carries a
 * `uint64` nonce at offset 12 and ends its header at 116 bytes; V2 writes `1`,
 * carries a `bytes32` nonce at the same offset and ends at 148. Decoding a V1
 * message with V2 offsets does not fail — it produces a plausible, wrong
 * message, which is why this module refuses on the version byte instead of
 * trusting a caller who said "V2".
 *
 * Every offset below was read out of a real Solana → Base mainnet transfer
 * before it was written down; `cctp-message.test.mjs` pins the whole decoder
 * against that exact message rather than against Circle's field list. That
 * matters more than usual here: Circle's own published contract-interfaces page
 * still documents the V1 event shapes for V2 contracts, so the documentation
 * and the chain disagree, and the chain is what settles.
 */

const HEX = /^0x[0-9a-fA-F]*$/;

/** V2 writes 1 here. V1 writes 0 and means a different layout entirely. */
export const CCTP_V2_MESSAGE_VERSION = 1;
/** version + two domains + nonce + three addresses + two thresholds. */
export const CCTP_V2_HEADER_BYTES = 148;
/** Everything in a burn body before the variable-length hook data. */
export const CCTP_V2_BURN_BODY_FIXED_BYTES = 228;

/**
 * Circle supports exactly two finality thresholds and clamps everything else:
 * anything at or below 1000 is a Fast message, 2000 is Standard. A number in
 * between is not a third speed — it is one of these two after rounding.
 */
export const CCTP_FINALITY = Object.freeze({ CONFIRMED: 1000, FINALIZED: 2000 });

export type CctpV2Header = Readonly<{
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  /** The replay key on the destination. Assigned off chain by Circle. */
  nonce: string;
  sender: string;
  recipient: string;
  /** 32 zero bytes mean anyone may complete the mint. */
  destinationCaller: string;
  minFinalityThreshold: number;
  finalityThresholdExecuted: number;
  /** Hex, without the header. Empty for a message with no body. */
  messageBody: string;
}>;

export type CctpV2BurnBody = Readonly<{
  version: number;
  /** The source chain's token, as 32 bytes. A Solana mint is already 32. */
  burnToken: string;
  mintRecipient: string;
  /** Base units, as a decimal string. USDC has six decimals. */
  amountRaw: string;
  messageSender: string;
  maxFeeRaw: string;
  /** What Circle actually took. Never assumed equal to `maxFeeRaw`. */
  feeExecutedRaw: string;
  /** After this destination block the message must be re-attested. */
  expirationBlock: string;
  hookData: string;
}>;

export type CctpV2Message = Readonly<{
  header: CctpV2Header;
  /** Null when the body is not a burn body — this product never mints those. */
  burn: CctpV2BurnBody | null;
  raw: string;
}>;

export type CctpMessageDecodeFailure = Readonly<{
  ok: false;
  code:
    | "NOT_HEX"
    | "ODD_LENGTH"
    | "HEADER_TOO_SHORT"
    | "VERSION_IS_V1"
    | "VERSION_UNKNOWN"
    | "BODY_TOO_SHORT"
    | "BODY_VERSION_UNKNOWN";
  reason: string;
}>;

export type CctpMessageDecodeResult =
  | Readonly<{ ok: true; message: CctpV2Message }>
  | CctpMessageDecodeFailure;

function normalise(hex: string): string | null {
  const trimmed = hex.trim();
  if (!HEX.test(trimmed)) return null;
  return trimmed.slice(2).toLowerCase();
}

const u32 = (body: string, byteOffset: number): number =>
  Number.parseInt(body.slice(byteOffset * 2, byteOffset * 2 + 8), 16);

const bytes32 = (body: string, byteOffset: number): string =>
  `0x${body.slice(byteOffset * 2, byteOffset * 2 + 64)}`;

const u256 = (body: string, byteOffset: number): string =>
  BigInt(`0x${body.slice(byteOffset * 2, byteOffset * 2 + 64)}`).toString();

/**
 * Decode one CCTP V2 message.
 *
 * Refuses rather than guesses. A V1 message gets its own refusal code, because
 * "this is the older protocol" and "these bytes are corrupt" are different
 * facts and lead a caller to different actions.
 */
export function decodeCctpV2Message(hex: string): CctpMessageDecodeResult {
  const body = normalise(hex);
  if (body === null) {
    return { ok: false, code: "NOT_HEX", reason: "A CCTP message must be 0x-prefixed hexadecimal." };
  }
  if (body.length % 2 !== 0) {
    return { ok: false, code: "ODD_LENGTH", reason: "A CCTP message must contain whole bytes." };
  }
  if (body.length < CCTP_V2_HEADER_BYTES * 2) {
    return {
      ok: false,
      code: "HEADER_TOO_SHORT",
      reason: `A CCTP V2 header is ${CCTP_V2_HEADER_BYTES} bytes; these bytes are ${body.length / 2}.`,
    };
  }

  const version = u32(body, 0);
  if (version === 0) {
    return {
      ok: false,
      code: "VERSION_IS_V1",
      reason:
        "These are CCTP V1 bytes, whose nonce is a uint64 and whose header ends at 116 bytes. Decoding them with V2 offsets would succeed and be wrong.",
    };
  }
  if (version !== CCTP_V2_MESSAGE_VERSION) {
    return { ok: false, code: "VERSION_UNKNOWN", reason: `Unrecognised CCTP message version ${version}.` };
  }

  const header: CctpV2Header = {
    version,
    sourceDomain: u32(body, 4),
    destinationDomain: u32(body, 8),
    nonce: bytes32(body, 12),
    sender: bytes32(body, 44),
    recipient: bytes32(body, 76),
    destinationCaller: bytes32(body, 108),
    minFinalityThreshold: u32(body, 140),
    finalityThresholdExecuted: u32(body, 144),
    messageBody: `0x${body.slice(CCTP_V2_HEADER_BYTES * 2)}`,
  };

  const rawBody = body.slice(CCTP_V2_HEADER_BYTES * 2);
  if (rawBody.length === 0) {
    return { ok: true, message: { header, burn: null, raw: `0x${body}` } };
  }
  if (rawBody.length < CCTP_V2_BURN_BODY_FIXED_BYTES * 2) {
    return {
      ok: false,
      code: "BODY_TOO_SHORT",
      reason: `A CCTP V2 burn body is at least ${CCTP_V2_BURN_BODY_FIXED_BYTES} bytes; this body is ${rawBody.length / 2}.`,
    };
  }
  const bodyVersion = u32(rawBody, 0);
  if (bodyVersion !== CCTP_V2_MESSAGE_VERSION) {
    return {
      ok: false,
      code: "BODY_VERSION_UNKNOWN",
      reason: `Unrecognised CCTP burn body version ${bodyVersion}.`,
    };
  }

  const burn: CctpV2BurnBody = {
    version: bodyVersion,
    burnToken: bytes32(rawBody, 4),
    mintRecipient: bytes32(rawBody, 36),
    amountRaw: u256(rawBody, 68),
    messageSender: bytes32(rawBody, 100),
    maxFeeRaw: u256(rawBody, 132),
    feeExecutedRaw: u256(rawBody, 164),
    expirationBlock: u256(rawBody, 196),
    hookData: `0x${rawBody.slice(CCTP_V2_BURN_BODY_FIXED_BYTES * 2)}`,
  };

  return { ok: true, message: { header, burn, raw: `0x${body}` } };
}

/**
 * The nonce, without decoding the rest.
 *
 * This is what the destination's `usedNonces` mapping is keyed on, so it is the
 * one field a replay check needs and the one field worth reading cheaply.
 */
export function cctpMessageNonce(hex: string): string | null {
  const body = normalise(hex);
  if (body === null || body.length < CCTP_V2_HEADER_BYTES * 2) return null;
  if (u32(body, 0) !== CCTP_V2_MESSAGE_VERSION) return null;
  return bytes32(body, 12);
}

/** 32 zero bytes. */
export const CCTP_ZERO_BYTES32 = `0x${"0".repeat(64)}`;

/**
 * A nonce of all zeroes is never a real one, and treating it as real is a
 * specific way to be wrong rather than a general one: the destination
 * transmitter pre-marks `usedNonces[bytes32(0)]` as consumed at deployment, so
 * a malformed or empty message reads back as **already minted** instead of as
 * unreadable. A replay check that skipped this would report the safest-sounding
 * answer at exactly the moment it knew nothing.
 */
export function isPlaceholderNonce(nonce: string): boolean {
  return nonce.trim().toLowerCase() === CCTP_ZERO_BYTES32;
}

/** Whether this message asked for Fast or Standard. */
export function cctpSpeedOf(threshold: number): "FAST" | "STANDARD" {
  return threshold <= CCTP_FINALITY.CONFIRMED ? "FAST" : "STANDARD";
}

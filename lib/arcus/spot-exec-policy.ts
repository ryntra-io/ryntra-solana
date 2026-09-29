import {
  PERMIT2_ADDRESS,
  SPOT_CHAIN_ID,
  SPOT_SETTLEMENT_ROUTER_ADDRESS,
  USDG_ADDRESS,
  USDG_DECIMALS,
  type SpotQuote,
} from "./spot.ts";
import { keccak256Hex } from "../crypto/keccak.ts";

export const SIG_PLACEHOLDER = "ab".repeat(65);
export const SPOT_INTENT_MAX_TTL_SECONDS = 60 * 60;
/** Current executable Rialto router entrypoint, verified against fresh Arcus RFQs. */
export const RIALTO_EXECUTE_SELECTOR = "0x8fb4309b";
/** Current settlement-router runtime pin; bytecode drift blocks execution pending review. */
export const RIALTO_ROUTER_RUNTIME_CODE_HASH = "0xa7041268d6f20802f420b5c71e84a991dc797f27cb474265598b89e43ef27611";
export const RIALTO_ACTION_TYPEHASH = "0xbe0fb9f9c839c2cce64be2d995cfb1a5e93d885cdab2e091110092ba0d7ac85e";
export const RIALTO_DIRECT_SWAP_SELECTOR = "0x2203d44a";
export type RialtoDirectRoutePin = Readonly<{ target: string; runtimeCodeHash: string }>;
const RIALTO_DIRECT_ROUTE_PINS: Readonly<Record<string, RialtoDirectRoutePin>> = Object.freeze({
  "0x322f0929c4625ed5bad873c95208d54e1c003b2d": Object.freeze({
    target: "0x08b29f180ae8873897b3b8c2e0ea041172236e63",
    runtimeCodeHash: "0xd8d39b3fb0b337a1f23f1e4ccba77e33ea9b300a86ea942d2f2ba8b3c5d0ecf1",
  }),
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": Object.freeze({
    target: "0x957bb4b86ccc706d44983fb889ed63c6f9bdc662",
    runtimeCodeHash: "0x42aac84cc4ac111c5f158c493a11151cbeb67db542dfb5364be432bfffabfd67",
  }),
  "0x86923f96303d656e4aa86d9d42d1e57ad2023fdc": Object.freeze({
    target: "0xaf7e236fd675a4de1a393516105db8afb53dc1eb",
    runtimeCodeHash: "0x3aa159564650828e17fd154dabd385f73abb5164106c3e0418ba518d0250445d",
  }),
});
export type RialtoExecutionTokenMetadata = Readonly<{ symbol: string; decimals: number }>;
const RIALTO_EXECUTION_TOKEN_METADATA: Readonly<Record<string, RialtoExecutionTokenMetadata>> = Object.freeze({
  [USDG_ADDRESS.toLowerCase()]: Object.freeze({ symbol: "USDG", decimals: USDG_DECIMALS }),
  "0x322f0929c4625ed5bad873c95208d54e1c003b2d": Object.freeze({ symbol: "TSLA", decimals: 18 }),
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": Object.freeze({ symbol: "AAPL", decimals: 18 }),
  "0x86923f96303d656e4aa86d9d42d1e57ad2023fdc": Object.freeze({ symbol: "AMD", decimals: 18 }),
});
export function readRialtoExecutionTokenMetadata(token: string): RialtoExecutionTokenMetadata | null {
  try {
    return RIALTO_EXECUTION_TOKEN_METADATA[address(token, "execution token")] ?? null;
  } catch {
    return null;
  }
}
const RIALTO_PERMIT_OFFSET = 0x1a0;
const RIALTO_ACTIONS_OFFSET = 0x2a0;
export const SPOT_FEE_RECIPIENT_ADDRESS = "0xec8acb43c45f4b98125df8cb5f42c963e5b3cfdd";
/** Ryntra product guardrail, independent of venue limits: never sign a route fee above 1%. */
export const SPOT_MAX_TOTAL_FEE_BPS = 100;
/** Arcus currently enforces a $10 USDG minimum; final fresh RFQs are checked before signing. */
export const SPOT_MIN_NOTIONAL_USDG = 10;

export type SpotExecutionFee = Readonly<{
  srcBps: number; dstBps: number; signedBps: number; totalBps: number;
  side: "source" | "destination"; recipient: string;
  token: string; symbol: string; decimals: number;
  amount: string; amountDecimal: string;
}>;

type SignedSpotFee = Readonly<{ srcBps: number; dstBps: number; bps: number; side: "source" | "destination"; recipient: string }>;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_DATA_RE = /^0x(?:[0-9a-fA-F]{2})+$/;
const BYTES32_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;
const RIALTO_QUOTE_ID_RE = /^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;

export function readRialtoDirectRoutePin(sellToken: string, buyToken: string): RialtoDirectRoutePin | null {
  const sell = address(sellToken, "sell token");
  const buy = address(buyToken, "buy token");
  const usdg = address(USDG_ADDRESS, "USDG");
  if ((sell === usdg) === (buy === usdg)) return null;
  return RIALTO_DIRECT_ROUTE_PINS[sell === usdg ? buy : sell] ?? null;
}

type JsonRecord = Record<string, unknown>;

export type SpotExecutionIntent = {
  quote: SpotQuote;
  taker: string;
  sellToken: string;
  buyToken: string;
  sellAmount: bigint;
  nowMs?: number;
};

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is missing or malformed`);
  }
  return value as JsonRecord;
}

function address(value: unknown, label: string): string {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    throw new Error(`${label} is missing or malformed`);
  }
  return value.toLowerCase();
}

function integer(value: unknown, label: string): bigint {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`${label} is missing or malformed`);
  }
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} is missing or malformed`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new Error(`${label} is missing or malformed`);
  }
}

function sameAddress(actual: unknown, expected: string, label: string): void {
  if (address(actual, label) !== address(expected, `expected ${label}`)) {
    throw new Error(`${label} does not match the requested trade`);
  }
}

function bytes32(value: unknown, label: string): string {
  if (typeof value !== "string" || !BYTES32_RE.test(value)) {
    throw new Error(`${label} is missing or malformed`);
  }
  return value.replace(/^0x/i, "").toLowerCase();
}

function rialtoQuoteId(value: unknown): string {
  if (typeof value !== "string" || !RIALTO_QUOTE_ID_RE.test(value)) {
    throw new Error("quote id is missing or malformed");
  }
  return value.toLowerCase();
}
const MAX_UINT256 = (1n << 256n) - 1n;

type Eip712Field = Readonly<{ name: string; type: string }>;

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) {
    throw new Error(`${label} has an unexpected type schema`);
  }
}

function typeFields(types: JsonRecord, name: string): Eip712Field[] {
  const value = types[name];
  if (!Array.isArray(value)) throw new Error(`${name} type schema is missing or malformed`);
  return value.map((entry, index) => {
    const field = record(entry, `${name} type field ${index}`);
    exactKeys(field, ["name", "type"], `${name} type field ${index}`);
    if (typeof field.name !== "string" || typeof field.type !== "string") {
      throw new Error(`${name} type schema is missing or malformed`);
    }
    return { name: field.name, type: field.type };
  });
}

function exactTypeFields(actual: Eip712Field[], expected: readonly Eip712Field[], label: string): void {
  if (
    actual.length !== expected.length
    || actual.some((field, i) => field.name !== expected[i].name || field.type !== expected[i].type)
  ) {
    throw new Error(`${label} has an unexpected type schema`);
  }
}

function validatePermit2TypeSchema(toSign: JsonRecord): void {
  const types = record(toSign.types, "Permit2 types");
  exactKeys(
    types,
    ["EIP712Domain", "TokenPermissions", "PermitWitnessTransferFrom", "RialtoSwap"],
    "Permit2 types",
  );
  exactTypeFields(typeFields(types, "EIP712Domain"), [
    { name: "name", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ], "EIP712Domain");
  exactTypeFields(typeFields(types, "TokenPermissions"), [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ], "TokenPermissions");
  exactTypeFields(typeFields(types, "PermitWitnessTransferFrom"), [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "RialtoSwap" },
  ], "PermitWitnessTransferFrom");

  exactTypeFields(typeFields(types, "RialtoSwap"), [
    { name: "recipient", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "minBuyAmount", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "feeRecipient", type: "address" },
    { name: "srcBps", type: "uint16" },
    { name: "dstBps", type: "uint16" },
    { name: "referralCode", type: "bytes32" },
    { name: "quoteId", type: "bytes32" },
    { name: "actionsHash", type: "bytes32" },
  ], "RialtoSwap");
}
function validateSignedFee(witness: JsonRecord): SignedSpotFee {
  const src = integer(witness.srcBps, "source fee bps");
  const dst = integer(witness.dstBps, "destination fee bps");
  if ((src === 0n) === (dst === 0n) || src > BigInt(SPOT_MAX_TOTAL_FEE_BPS) || dst > BigInt(SPOT_MAX_TOTAL_FEE_BPS)) {
    throw new Error("signed route fee has an unsupported leg or exceeds the Ryntra safety limit");
  }
  const recipient = address(witness.feeRecipient, "fee recipient");
  if (recipient !== SPOT_FEE_RECIPIENT_ADDRESS) {
    throw new Error("signed route fee has an unsupported recipient");
  }
  return {
    srcBps: Number(src),
    dstBps: Number(dst),
    bps: Number(src === 0n ? dst : src),
    side: src > 0n ? "source" : "destination",
    recipient,
  };
}

function decimalToUnits(value: unknown, decimals: number): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error("platform fee decimal is malformed");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error("platform fee decimal precision is malformed");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
}

function assertRialtoFeeSemantics(
  signed: SignedSpotFee,
  sellToken: string,
  buyToken: string,
): void {
  const sell = address(sellToken, "sell token");
  const buy = address(buyToken, "buy token");
  const usdg = address(USDG_ADDRESS, "USDG");
  if ((sell === usdg) === (buy === usdg)) {
    throw new Error("Rialto fee semantics require exactly one USDG leg");
  }
  const expectedSide = sell === usdg ? "source" : "destination";
  if (signed.side !== expectedSide) {
    throw new Error("Rialto fee side does not match the audited USDG semantics");
  }
}

function validatePlatformFee(
  quote: SpotQuote,
  signed: SignedSpotFee,
  sellToken: string,
  buyToken: string,
  sellAmount: bigint,
): SpotExecutionFee {
  assertRialtoFeeSemantics(signed, sellToken, buyToken);
  const raw = record(quote.raw, "raw quote");
  const platform = record(raw.platform_fee, "platform fee");
  const total = integer(platform.total_bps, "platform fee bps");
  if (total <= 0n || total > BigInt(SPOT_MAX_TOTAL_FEE_BPS)) {
    throw new Error("platform fee exceeds the Ryntra safety limit");
  }
  if (total < BigInt(signed.bps) || total > BigInt(signed.bps + 1)) {
    throw new Error("platform and signed fee bps are inconsistent");
  }
  if (!Array.isArray(platform.fees) || platform.fees.length !== 1) {
    throw new Error("platform fee breakdown is missing or ambiguous");
  }

  const item = record(platform.fees[0], "platform fee item");
  if (item.side !== signed.side) throw new Error("platform and signed fee sides are inconsistent");
  const token = address(item.token, "platform fee token");
  sameAddress(token, USDG_ADDRESS, "platform fee token");
  sameAddress(item.recipient, signed.recipient, "platform fee recipient");
  const bps = integer(item.bps, "platform fee item bps");
  if (bps !== total || integer(item.bps_x100, "platform fee bps x100") !== total * 100n) {
    throw new Error("platform fee breakdown is inconsistent");
  }
  const canonical = readRialtoExecutionTokenMetadata(token);
  if (!canonical) throw new Error("platform fee token is outside the canonical execution allowlist");
  const decimalsBig = integer(item.decimals, "platform fee decimals");
  if (decimalsBig !== BigInt(canonical.decimals)) {
    throw new Error("platform fee decimals do not match canonical token metadata");
  }
  const decimals = canonical.decimals;
  const amount = integer(item.amount, "platform fee amount");
  if (amount <= 0n || decimalToUnits(item.amount_decimal, decimals) !== amount) {
    throw new Error("platform fee amount is inconsistent");
  }
  if (signed.side === "source" && amount !== sellAmount * total / 10_000n) {
    throw new Error("source platform fee amount does not match the quoted sell amount");
  }
  if (signed.side === "destination") {
    const netBuyAmount = integer(quote.buyAmount, "quote buy amount");
    const grossBuyAmount = netBuyAmount + amount;
    if (amount !== grossBuyAmount * total / 10_000n) throw new Error("destination platform fee amount does not match the quoted buy amount");
  }
  if (typeof item.symbol !== "string" || !/^[A-Za-z0-9._-]{1,16}$/.test(item.symbol)) {
    throw new Error("platform fee symbol is malformed");
  }
  if (item.symbol !== canonical.symbol) {
    throw new Error("platform fee symbol does not match canonical token metadata");
  }

  return {
    srcBps: signed.srcBps,
    dstBps: signed.dstBps,
    signedBps: signed.bps,
    totalBps: Number(total),
    side: signed.side,
    recipient: signed.recipient,
    token,
    symbol: canonical.symbol,
    decimals,
    amount: amount.toString(),
    amountDecimal: item.amount_decimal as string,
  };
}

/** Safe display helper. Invalid or unsupported fee state is unknown, never zero. */
export function readSpotQuoteFee(quote: SpotQuote): SpotExecutionFee | null {
  try {
    const toSign = record(quote.toSign, "Permit2 intent");
    const message = record(toSign.message, "Permit2 message");
    const permitted = record(message.permitted, "permitted token");
    const witness = record(message.witness, "Rialto witness");
    const signed = validateSignedFee(witness);
    return validatePlatformFee(
      quote,
      signed,
      address(permitted.token, "permitted sell token"),
      address(witness.buyToken, "witness buy token"),
      integer(permitted.amount, "permitted sell amount"),
    );
  } catch {
    return null;
  }
}
function abiWord(payload: string, offset: number, label: string): string {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % 32 !== 0 || offset + 32 > payload.length / 2) {
    throw new Error(`${label} is outside canonical calldata bounds`);
  }
  return payload.slice(offset * 2, (offset + 32) * 2);
}

function abiBytes(payload: string, offset: number, length: number, label: string): string {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > payload.length / 2) {
    throw new Error(`${label} is outside calldata bounds`);
  }
  return payload.slice(offset * 2, (offset + length) * 2);
}

function abiInteger(payload: string, offset: number, label: string): bigint {
  return BigInt(`0x${abiWord(payload, offset, label)}`);
}

function canonicalAddressWord(word: string, label: string): string {
  if (!/^0{24}[0-9a-f]{40}$/.test(word)) throw new Error(`${label} is not a canonical ABI address`);
  return `0x${word.slice(24)}`;
}

function assertCalldataAddress(payload: string, offset: number, expected: string, label: string): void {
  if (canonicalAddressWord(abiWord(payload, offset, label), label) !== address(expected, `expected ${label}`)) {
    throw new Error(`${label} does not match the signed intent`);
  }
}

function assertCalldataInteger(payload: string, offset: number, expected: bigint, label: string): void {
  if (abiInteger(payload, offset, label) !== expected) throw new Error(`${label} does not match the signed intent`);
}

function assertCalldataBytes32(payload: string, offset: number, expected: unknown, label: string): void {
  if (abiWord(payload, offset, label) !== bytes32(expected, label)) {
    throw new Error(`${label} does not match the signed intent`);
  }
}

/** Canonical-decode the exact live Rialto wire contract and recompute the signed actionsHash. */
function validateRialtoCalldata(
  calldata: string,
  expected: {
    sellToken: string; buyToken: string; sellAmount: bigint; minBuyAmount: bigint;
    taker: string; deadline: bigint; nonce: bigint; witness: JsonRecord; signedFee: SignedSpotFee;
  },
): void {
  const payload = calldata.slice(10);
  if (payload.length === 0 || payload.length % 64 !== 0) throw new Error("Rialto calldata is not canonical ABI data");
  assertCalldataAddress(payload, 0x00, expected.sellToken, "calldata sell token");
  assertCalldataAddress(payload, 0x20, expected.buyToken, "calldata buy token");
  assertCalldataInteger(payload, 0x40, expected.sellAmount, "calldata sell amount");
  assertCalldataInteger(payload, 0x60, expected.minBuyAmount, "calldata minimum buy amount");
  assertCalldataAddress(payload, 0x80, expected.taker, "calldata recipient");
  assertCalldataInteger(payload, 0xa0, expected.deadline, "calldata deadline");
  assertCalldataAddress(payload, 0xc0, expected.signedFee.recipient, "calldata fee recipient");
  assertCalldataInteger(payload, 0xe0, BigInt(expected.signedFee.srcBps), "calldata source fee bps");
  assertCalldataInteger(payload, 0x100, BigInt(expected.signedFee.dstBps), "calldata destination fee bps");
  assertCalldataBytes32(payload, 0x120, expected.witness.referralCode, "calldata referral code");
  assertCalldataBytes32(payload, 0x140, expected.witness.quoteId, "calldata witness quote id");
  assertCalldataInteger(payload, 0x160, BigInt(RIALTO_PERMIT_OFFSET), "calldata permit offset");
  assertCalldataInteger(payload, 0x180, BigInt(RIALTO_ACTIONS_OFFSET), "calldata actions offset");

  assertCalldataAddress(payload, RIALTO_PERMIT_OFFSET, expected.taker, "permit owner");
  assertCalldataInteger(payload, RIALTO_PERMIT_OFFSET + 0x20, expected.nonce, "permit nonce");
  assertCalldataInteger(payload, RIALTO_PERMIT_OFFSET + 0x40, expected.deadline, "permit deadline");
  assertCalldataInteger(payload, RIALTO_PERMIT_OFFSET + 0x60, 0x80n, "permit signature offset");
  assertCalldataInteger(payload, RIALTO_PERMIT_OFFSET + 0x80, 65n, "permit signature length");
  if (abiBytes(payload, RIALTO_PERMIT_OFFSET + 0xa0, 65, "signature placeholder") !== SIG_PLACEHOLDER) {
    throw new Error("calldata signature placeholder is not canonical");
  }
  if (!/^0*$/.test(abiBytes(payload, RIALTO_PERMIT_OFFSET + 0xa0 + 65, 31, "signature padding"))) {
    throw new Error("calldata signature padding is non-zero");
  }

  const countBig = abiInteger(payload, RIALTO_ACTIONS_OFFSET, "actions length");
  if (countBig !== 1n) throw new Error("Rialto route must contain exactly one supported direct action");
  const count = Number(countBig);
  const offsetsBase = RIALTO_ACTIONS_OFFSET + 32;
  let expectedTupleOffset = count * 32;
  const actionHashes: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const relative = abiInteger(payload, offsetsBase + i * 32, `action ${i} offset`);
    if (relative !== BigInt(expectedTupleOffset)) throw new Error("Rialto actions are not canonically packed");
    const tuple = offsetsBase + Number(relative);
    const words = Array.from({ length: 9 }, (_, field) => abiWord(payload, tuple + field * 32, `action ${i} field ${field}`));
    if (BigInt(`0x${words[0]}`) > 0xffn) throw new Error("Rialto action uint8 field is out of range");
    canonicalAddressWord(words[1], `action ${i} address 1`);
    canonicalAddressWord(words[2], `action ${i} address 2`);
    canonicalAddressWord(words[3], `action ${i} address 3`);
    if (BigInt(`0x${words[5]}`) > 0xffffn) throw new Error("Rialto action uint16 field is out of range");
    if (BigInt(`0x${words[7]}`) !== 0x120n) throw new Error("Rialto action bytes offset is not canonical");

    const byteLengthBig = abiInteger(payload, tuple + 0x120, `action ${i} bytes length`);
    if (byteLengthBig > 65_536n) throw new Error("Rialto action bytes are unreasonably large");
    const byteLength = Number(byteLengthBig);
    const bytesStart = tuple + 0x140;
    const bytesValue = abiBytes(payload, bytesStart, byteLength, `action ${i} bytes`);
    const paddedLength = Math.ceil(byteLength / 32) * 32;
    if (!/^0*$/.test(abiBytes(payload, bytesStart + byteLength, paddedLength - byteLength, `action ${i} padding`))) {
      throw new Error("Rialto action padding is non-zero");
    }

    const routePin = readRialtoDirectRoutePin(expected.sellToken, expected.buyToken);
    if (!routePin) throw new Error("Rialto direct action token pair is not in the audited allowlist");
    if (BigInt(`0x${words[0]}`) !== 0n) throw new Error("Rialto action kind is unsupported");
    if (canonicalAddressWord(words[1], `action ${i} target`) !== routePin.target) {
      throw new Error("Rialto action target is unsupported");
    }
    if (canonicalAddressWord(words[2], `action ${i} sell token`) !== address(expected.sellToken, "expected action sell token")) {
      throw new Error("Rialto action sell token does not match the signed intent");
    }
    if (canonicalAddressWord(words[3], `action ${i} buy token`) !== address(expected.buyToken, "expected action buy token")) {
      throw new Error("Rialto action buy token does not match the signed intent");
    }
    const signedSourceFee = expected.sellAmount * BigInt(expected.signedFee.srcBps) / 10_000n;
    const actionSellAmount = expected.sellAmount - signedSourceFee;
    if (BigInt(`0x${words[4]}`) !== actionSellAmount) throw new Error("Rialto action sell amount is unsupported");
    if (BigInt(`0x${words[5]}`) !== 0n) throw new Error("Rialto action scalar is unsupported");
    if (BigInt(`0x${words[6]}`) !== expected.minBuyAmount) {
      throw new Error("Rialto action minimum output does not match the signed intent");
    }
    if (BigInt(`0x${words[8]}`) !== 36n) throw new Error("Rialto action final scalar is unsupported");
    if (byteLength !== 164 || bytesValue.slice(0, 8) !== RIALTO_DIRECT_SWAP_SELECTOR.slice(2)) {
      throw new Error("Rialto direct action payload is unsupported");
    }

    const nested = bytesValue.slice(8);
    const nestedWord = (field: number) => nested.slice(field * 64, (field + 1) * 64);
    const sellIsUsdg = address(expected.sellToken, "expected sell token") === address(USDG_ADDRESS, "USDG");
    const direction = BigInt(`0x${nestedWord(0)}`);
    if (direction !== (sellIsUsdg ? 0n : 1n)) throw new Error("Rialto direct action direction is unsupported");
    if (BigInt(`0x${nestedWord(1)}`) !== actionSellAmount) {
      throw new Error("Rialto direct action amount is unsupported");
    }
    if (BigInt(`0x${nestedWord(2)}`) !== expected.minBuyAmount) {
      throw new Error("Rialto direct action minimum output does not match the signed intent");
    }
    if (canonicalAddressWord(nestedWord(3), "Rialto direct action recipient") !== address(SPOT_SETTLEMENT_ROUTER_ADDRESS, "router")) {
      throw new Error("Rialto direct action recipient is unsupported");
    }
    if (BigInt(`0x${nestedWord(4)}`) !== expected.deadline) {
      throw new Error("Rialto direct action deadline does not match the signed intent");
    }

    const encoded = [
      RIALTO_ACTION_TYPEHASH.slice(2),
      ...words.slice(0, 7),
      keccak256Hex(`0x${bytesValue}`).slice(2),
      words[8],
    ].join("");
    actionHashes.push(keccak256Hex(`0x${encoded}`));
    expectedTupleOffset = bytesStart + paddedLength - offsetsBase;
  }

  if (offsetsBase + expectedTupleOffset !== payload.length / 2) {
    throw new Error("Rialto calldata has trailing or missing action bytes");
  }
  const actionsHash = keccak256Hex(`0x${actionHashes.map((hash) => hash.slice(2)).join("")}`);
  if (actionsHash.slice(2) !== bytes32(expected.witness.actionsHash, "actions hash")) {
    throw new Error("calldata actions do not match the signed actions hash");
  }
}



/**
 * Fail-closed validation for every field that can redirect or enlarge a spot swap.
 * This runs after the final RFQ refresh and before the wallet sees a signing prompt.
 */
export function validateSpotExecutionIntent({
  quote,
  taker,
  sellToken,
  buyToken,
  sellAmount,
  nowMs = Date.now(),
}: SpotExecutionIntent): SpotExecutionFee {
  if (quote.venue.toLowerCase() !== "rialto") {
    throw new Error("quote is not from the executable Rialto venue");
  }
  if (sellAmount <= 0n) throw new Error("invalid sell amount");
  if (integer(quote.sellAmount, "quote sell amount") !== sellAmount) {
    throw new Error("quote sell amount does not match the requested trade");
  }

  const buyAmount = integer(quote.buyAmount, "quote buy amount");
  const minBuyAmount = integer(quote.minBuyAmount, "minimum buy amount");
  if (buyAmount <= 0n || minBuyAmount <= 0n || minBuyAmount > buyAmount) {
    throw new Error("quote has an invalid minimum buy amount");
  }
  const normalizedSellToken = address(sellToken, "sell token");
  const normalizedBuyToken = address(buyToken, "buy token");
  const normalizedUsdg = address(USDG_ADDRESS, "USDG");
  const minimumUsdgUnits = BigInt(SPOT_MIN_NOTIONAL_USDG) * 10n ** BigInt(USDG_DECIMALS);
  if (
    (normalizedSellToken === normalizedUsdg && sellAmount < minimumUsdgUnits)
    || (normalizedBuyToken === normalizedUsdg && buyAmount < minimumUsdgUnits)
  ) {
    throw new Error(`Arcus minimum order is ${SPOT_MIN_NOTIONAL_USDG} USDG`);
  }
  // Arcus's top-level fee list is separate from the signed Rialto witness fee. It is currently
  // empty; an unknown or non-empty second fee channel is unsupported and must fail closed.
  if (!Array.isArray(quote.fees) || quote.fees.length !== 0)
    throw new Error("quote has an unsupported or unknown fee");

  const tx = record(quote.tx, "router transaction");
  sameAddress(tx.to, SPOT_SETTLEMENT_ROUTER_ADDRESS, "settlement router");
  const txValue = tx.value == null ? 0n : integer(tx.value, "transaction value");
  if (txValue !== 0n) throw new Error("quote unexpectedly attaches ETH - refusing to sign");
  if (typeof tx.data !== "string" || !HEX_DATA_RE.test(tx.data)) {
    throw new Error("router calldata is malformed");
  }
  const calldata = tx.data.toLowerCase();
  if (!calldata.startsWith(RIALTO_EXECUTE_SELECTOR)) {
    throw new Error("router calldata has an unexpected Rialto selector");
  }
  const signatureSlots = calldata.split(SIG_PLACEHOLDER).length - 1;
  if (signatureSlots !== 1) {
    throw new Error("calldata does not have exactly one signature slot");
  }

  const toSign = record(quote.toSign, "Permit2 intent");
  const domain = record(toSign.domain, "Permit2 domain");
  if (domain.name !== "Permit2") throw new Error("quote has an unexpected signing domain");
  if (integer(domain.chainId, "signing chain") !== BigInt(SPOT_CHAIN_ID)) {
    throw new Error("quote is for a different chain");
  }
  sameAddress(domain.verifyingContract, PERMIT2_ADDRESS, "signing contract");
  if (toSign.primaryType !== "PermitWitnessTransferFrom") {
    throw new Error("quote has an unexpected Permit2 primary type");
  }
  validatePermit2TypeSchema(toSign);

  const message = record(toSign.message, "Permit2 message");
  const permitted = record(message.permitted, "permitted token");
  sameAddress(permitted.token, sellToken, "permitted sell token");
  if (integer(permitted.amount, "permitted sell amount") !== sellAmount) {
    throw new Error("permitted amount does not match the requested trade");
  }
  sameAddress(message.spender, SPOT_SETTLEMENT_ROUTER_ADDRESS, "Permit2 spender");
  const nonce = integer(message.nonce, "Permit2 nonce");
  if (nonce > MAX_UINT256) throw new Error("Permit2 nonce is outside uint256 range");

  const nowSeconds = BigInt(Math.floor(nowMs / 1000));
  const deadline = integer(message.deadline, "Permit2 deadline");
  if (deadline <= nowSeconds) throw new Error("quote intent has expired");
  if (deadline > nowSeconds + BigInt(SPOT_INTENT_MAX_TTL_SECONDS)) {
    throw new Error("quote intent deadline is unreasonably long");
  }

  const witness = record(message.witness, "Rialto witness");
  sameAddress(witness.recipient, taker, "swap recipient");
  sameAddress(witness.buyToken, buyToken, "witness buy token");
  if (integer(witness.minBuyAmount, "witness minimum buy amount") !== minBuyAmount) {
    throw new Error("witness minimum buy amount does not match the quote");
  }
  if (integer(witness.deadline, "witness deadline") !== deadline) {
    throw new Error("witness deadline does not match the Permit2 deadline");
  }
  // Rialto's response contains a server correlation UUID and a separate bytes32
  // identifier signed inside the Permit2 witness. Validate both formats without
  // inventing an equality relationship that the venue does not provide.
  rialtoQuoteId(quote.quoteId);
  bytes32(witness.quoteId, "witness quote id");

  bytes32(witness.referralCode, "referral code");
  bytes32(witness.actionsHash, "actions hash");
  const signedFee = validateSignedFee(witness);
  assertRialtoFeeSemantics(signedFee, sellToken, buyToken);
  validateRialtoCalldata(calldata, {
    sellToken,
    buyToken,
    sellAmount,
    minBuyAmount,
    taker,
    deadline,
    nonce,
    witness,
    signedFee,
  });
  return validatePlatformFee(quote, signedFee, sellToken, buyToken, sellAmount);
}

/**
 * The destination mint, prepared but never sent from here.
 *
 * Circle does not deliver a Standard CCTP transfer. Something has to call
 * `receiveMessage(message, attestation)` on the destination chain, and on this
 * lane that something is the person's own Base wallet. This module builds the
 * exact call, prices it, and checks the conditions that would waste a signature
 * — but it holds no key and sends nothing. The transaction leaves from a wallet
 * in the browser, the same way the burn does.
 *
 * ## `destinationCaller` is zero, and what that does and does not mean
 *
 * The burn pins no address as the only one permitted to complete the mint, so
 * the message is **permissionless**: anyone holding it and its attestation may
 * submit it, and the transmitter's replay guard makes a second submission a
 * no-op rather than a second mint. That is a real recovery property and it is
 * worth stating.
 *
 * It is not a guarantee that funds cannot be stuck, and this product does not
 * make that claim. Permissionless means *anyone may*, not *someone will*: if no
 * one submits it, nothing arrives. A Fast message can also pass its expiration
 * block and need re-attestation before it can be minted at all. The honest
 * sentence is that completing the mint does not depend on any single party,
 * including us.
 */

import {
  abiAddressWord,
  baseRpcCall,
  hexQuantityToDecimal,
  readBaseErc20Balance,
  type BaseRpcHandle,
} from "./rpc.ts";
import { evmCctpAddresses, readBaseNonceState } from "./cctp-observe.ts";
import { cctpChainRefOf } from "../solana/cctp-direction.ts";

/** `keccak256("receiveMessage(bytes,bytes)")[0..4]`, computed from the signature. */
export const RECEIVE_MESSAGE_SELECTOR = "0x57ecfd28";

const HEX = /^0x([0-9a-fA-F]{2})*$/;

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function dynamicBytes(hex: string): { length: bigint; padded: string } {
  const body = hex.slice(2).toLowerCase();
  const bytes = BigInt(body.length / 2);
  const remainder = body.length % 64;
  return { length: bytes, padded: remainder === 0 ? body : body + "0".repeat(64 - remainder) };
}

/**
 * ABI-encode `receiveMessage(bytes message, bytes attestation)`.
 *
 * Hand-encoded rather than pulled through a general encoder: the shape is two
 * dynamic `bytes` and nothing else, and the whole encoding is a head of two
 * offsets followed by a length and padded body for each. Writing it out means
 * the test can pin the exact layout the destination transaction on Base uses
 * rather than trusting an encoder to agree.
 */
export function encodeReceiveMessage(messageHex: string, attestationHex: string): string {
  if (!HEX.test(messageHex) || messageHex.length <= 2) {
    throw new Error("The CCTP message must be non-empty whole-byte hexadecimal.");
  }
  if (!HEX.test(attestationHex) || attestationHex.length <= 2) {
    throw new Error("The attestation must be non-empty whole-byte hexadecimal.");
  }
  const message = dynamicBytes(messageHex);
  const attestation = dynamicBytes(attestationHex);
  /* Two head words, then the message block, then the attestation block. */
  const messageOffset = 64n;
  const attestationOffset = messageOffset + 32n + BigInt(message.padded.length / 2);
  return (
    RECEIVE_MESSAGE_SELECTOR +
    word(messageOffset) +
    word(attestationOffset) +
    word(message.length) +
    message.padded +
    word(attestation.length) +
    attestation.padded
  );
}

export type BaseMintReadinessState = "READY" | "ALREADY_MINTED" | "NOT_READY" | "UNAVAILABLE";

export type BaseMintPlan = Readonly<{
  schema: "ryntra.base.cctp-mint-plan";
  schemaVersion: "1.0.0";
  /** The chain the mint lands on. Base or Ethereum; the handle decides. */
  chainRef: "eip155:8453" | "eip155:1";
  chainId: number;
  state: BaseMintReadinessState;
  /** The contract the wallet must be pointed at. Never a proxy of our choosing. */
  to: string;
  data: string | null;
  from: string;
  nonce: string;
  /** Gas the chain itself estimated for this exact call, when it could. */
  gasEstimate: string | null;
  gasPriceWei: string | null;
  /** Estimate times price, in wei. Null when either half is unknown. */
  maximumCostWei: string | null;
  ethBalanceWei: string | null;
  usdcBeforeRaw: string | null;
  /** True only when the chain priced the call and the wallet can pay for it. */
  affordable: boolean | null;
  reason: string | null;
  permissionless: Readonly<{
    destinationCallerIsZero: true;
    meaning: "ANYONE_HOLDING_THE_MESSAGE_AND_ATTESTATION_MAY_SUBMIT_IT";
    /* Stated in the plan itself so no surface has to remember not to overclaim. */
    notAGuarantee: "PERMISSIONLESS_MEANS_ANYONE_MAY_SUBMIT_IT_NOT_THAT_SOMEONE_WILL";
  }>;
  observedAt: string;
}>;

/**
 * Everything that would make the mint fail, checked before a wallet opens.
 *
 * The replay guard is asked first and it is the one that changes the answer
 * rather than the detail: a message already consumed needs no transaction at
 * all, and offering one would spend gas to be told so by a revert.
 */
export async function planBaseCctpMint(
  handle: BaseRpcHandle,
  args: Readonly<{
    from: string;
    nonce: string;
    messageHex: string;
    attestationHex: string;
    now?: () => Date;
  }>,
): Promise<BaseMintPlan> {
  const observedAt = (args.now ?? (() => new Date()))().toISOString();
  const addresses = evmCctpAddresses(handle.chain.id);
  const base = {
    schema: "ryntra.base.cctp-mint-plan",
    schemaVersion: "1.0.0",
    chainRef: cctpChainRefOf(handle.chain.chainRef),
    chainId: handle.chain.chainId,
    to: addresses.messageTransmitter,
    from: args.from.trim().toLowerCase(),
    nonce: args.nonce.trim().toLowerCase(),
    permissionless: {
      destinationCallerIsZero: true,
      meaning: "ANYONE_HOLDING_THE_MESSAGE_AND_ATTESTATION_MAY_SUBMIT_IT",
      notAGuarantee: "PERMISSIONLESS_MEANS_ANYONE_MAY_SUBMIT_IT_NOT_THAT_SOMEONE_WILL",
    },
    observedAt,
  } as const;

  const unavailable = (reason: string): BaseMintPlan => ({
    ...base,
    state: "UNAVAILABLE",
    data: null,
    gasEstimate: null,
    gasPriceWei: null,
    maximumCostWei: null,
    ethBalanceWei: null,
    usdcBeforeRaw: null,
    affordable: null,
    reason,
  });

  if (abiAddressWord(base.from) === null) {
    return unavailable("The submitting address is not a 20-byte EVM address.");
  }

  const nonceState = await readBaseNonceState(handle, args.nonce);
  if (nonceState.state === "UNREADABLE") {
    return unavailable(nonceState.reason ?? "The replay guard could not be read.");
  }

  let data: string;
  try {
    data = encodeReceiveMessage(args.messageHex, args.attestationHex);
  } catch (cause) {
    return unavailable(cause instanceof Error ? cause.message : String(cause));
  }

  const [balanceRead, usdcRead] = await Promise.all([
    baseRpcCall<string>(handle, "eth_getBalance", [base.from, "latest"]),
    readBaseErc20Balance(handle, { token: addresses.usdc, owner: base.from }),
  ]);
  const ethBalanceWei = balanceRead.ok ? hexQuantityToDecimal(balanceRead.value) : null;
  const usdcBeforeRaw = usdcRead.ok ? usdcRead.value : null;

  if (nonceState.state === "CONSUMED") {
    /* Nothing to send. The transfer already completed, by us or by anyone. */
    return {
      ...base,
      state: "ALREADY_MINTED",
      data,
      gasEstimate: null,
      gasPriceWei: null,
      maximumCostWei: null,
      ethBalanceWei,
      usdcBeforeRaw,
      affordable: null,
      reason: `This message has already been received on ${handle.chain.label}. Submitting it again would revert and mint nothing.`,
    };
  }

  const [gasRead, priceRead] = await Promise.all([
    baseRpcCall<string>(handle, "eth_estimateGas", [{ from: base.from, to: base.to, data }]),
    baseRpcCall<string>(handle, "eth_gasPrice", []),
  ]);
  const gasEstimate = gasRead.ok ? hexQuantityToDecimal(gasRead.value) : null;
  const gasPriceWei = priceRead.ok ? hexQuantityToDecimal(priceRead.value) : null;
  const maximumCostWei =
    gasEstimate !== null && gasPriceWei !== null ? (BigInt(gasEstimate) * BigInt(gasPriceWei)).toString() : null;
  const affordable =
    maximumCostWei !== null && ethBalanceWei !== null ? BigInt(ethBalanceWei) >= BigInt(maximumCostWei) : null;

  if (gasEstimate === null) {
    return {
      ...base,
      state: "NOT_READY",
      data,
      gasEstimate,
      gasPriceWei,
      maximumCostWei,
      ethBalanceWei,
      usdcBeforeRaw,
      affordable,
      reason: `${handle.chain.label} would not price this call, so it would likely revert: ${gasRead.ok ? "no estimate returned" : gasRead.reason}`,
    };
  }
  if (affordable === false) {
    return {
      ...base,
      state: "NOT_READY",
      data,
      gasEstimate,
      gasPriceWei,
      maximumCostWei,
      ethBalanceWei,
      usdcBeforeRaw,
      affordable,
      reason: `The submitting wallet holds less ETH on ${handle.chain.label} than this call would cost.`,
    };
  }

  return {
    ...base,
    state: "READY",
    data,
    gasEstimate,
    gasPriceWei,
    maximumCostWei,
    ethBalanceWei,
    usdcBeforeRaw,
    affordable,
    reason: null,
  };
}

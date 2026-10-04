/**
 * The destination half of a CCTP transfer, observed on Base.
 *
 * A burn on Solana proves that value left. It proves nothing about arrival, and
 * the arrival is read independently rather than inferred from the attestation
 * service saying the transfer completed. This module is that read.
 *
 * ## Two questions, deliberately asked in this order
 *
 * 1. **Was this message consumed?** `MessageTransmitterV2.usedNonces(bytes32)`
 *    answers from current state: `1` means the message was received and can
 *    never be received again. This is the question that governs recovery,
 *    because it is answerable from the head of the chain with no history at
 *    all — an endpoint that holds one hundred blocks can still answer it.
 * 2. **What actually arrived?** The `MintAndWithdraw` log carries the amount
 *    minted and the fee Circle took. This one needs history, and history is
 *    the thing the free endpoints ration.
 *
 * Keeping them apart produces a state most implementations do not have and this
 * lane needs: **consumed, but not seen.** The chain says the message was minted
 * and the log is outside every reachable window. That is not a failure and it
 * is emphatically not permission to burn again; it is an honest "the money
 * arrived and this product cannot yet show you the transaction", which is
 * exactly the sentence the recovery rule is written around.
 *
 * ## Why detection keys on logs rather than on the transaction
 *
 * `receiveMessage` is frequently relayed — through account abstraction, through
 * a rebalancer contract, through anything with gas — so the transaction's `to`
 * is often not the transmitter and its selector is often not `receiveMessage`.
 * A detector that matched on either would miss most real mints. Every match
 * here is on `(address, topic0)`.
 *
 * Every topic below was computed from its canonical signature and then matched
 * against a real Solana → Base mint on Base mainnet. That double check earned
 * its keep twice: Circle's own contract-interfaces page still documents the V1
 * shapes, whose `MessageReceived` carries a `uint64` nonce and whose
 * `MintAndWithdraw` has three parameters instead of four. Both hash to topics
 * that never appear on the V2 path, so an integration written from that page
 * filters on them and silently finds nothing.
 */

import {
  abiAddressWord,
  baseEthCall,
  baseRpcCall,
  evmChainProfileByRef,
  hexQuantityToDecimal,
  readBaseErc20Balance,
  readBaseLogs,
  type BaseEndpoint,
  type BaseLog,
  type BaseRpcHandle,
  type EvmChainId,
} from "./rpc.ts";
import { isPlaceholderNonce } from "../solana/cctp-message.ts";
import { cctpChainRefOf, isEvmChain } from "../solana/cctp-direction.ts";
import { SOLANA_CCTP_MAINNET_REGISTRY } from "../solana/cctp-registry.ts";

/** `keccak256("usedNonces(bytes32)")[0..4]`. */
export const USED_NONCES_SELECTOR = "0xfeb61724";

/**
 * Topic0 for every event a destination mint emits, with the exact signature
 * each was hashed from. The signatures are here because the hash alone cannot
 * be checked by a reader, and these four are the difference between observing
 * a mint and observing nothing.
 */
export const BASE_CCTP_TOPICS = Object.freeze({
  /** `MessageReceived(address,uint32,bytes32,bytes32,uint32,bytes)` — V2. */
  messageReceived: "0xff48c13eda96b1cceacc6b9edeedc9e9db9d6226afbc30146b720c19d3addb1c",
  /** `MintAndWithdraw(address,uint256,address,uint256)` — V2, on TokenMessengerV2. */
  mintAndWithdraw: "0x50c55e915134d457debfa58eb6f4342956f8b0616d51a89a3659360178e1ab63",
  /** `Mint(address,address,uint256)` on USDC itself. */
  usdcMint: "0xab8530f87dc9b59234c4623bf917212bb2536d647574c8e7e5da92c2ede0c9f8",
  /** `Transfer(address,address,uint256)`. */
  transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
});

function baseComponent(role: "MESSAGE_TRANSMITTER_V2" | "TOKEN_MESSENGER_V2" | "TOKEN_MINTER_V2"): string {
  const component = SOLANA_CCTP_MAINNET_REGISTRY.chains.base.components.find((entry) => entry.role === role);
  if (!component) throw new Error(`The CCTP registry has no ${role} for Base.`);
  return component.address;
}

export const BASE_MESSAGE_TRANSMITTER_V2 = baseComponent("MESSAGE_TRANSMITTER_V2");
export const BASE_TOKEN_MESSENGER_V2 = baseComponent("TOKEN_MESSENGER_V2");
export const BASE_USDC = SOLANA_CCTP_MAINNET_REGISTRY.chains.base.asset.address;

export type EvmCctpAddresses = Readonly<{
  chain: EvmChainId;
  chainRef: string;
  label: string;
  messageTransmitter: string;
  tokenMessenger: string;
  usdc: string;
}>;

/**
 * The three addresses a destination read needs, for the chain a handle names.
 *
 * Read from the registry per chain rather than from the `BASE_*` constants
 * above, which stay for the callers that still spell the chain out. Circle
 * deploys V2 at the same addresses on Base and Ethereum, so only the USDC
 * differs — and that is exactly the one a reader would copy across by mistake.
 */
export function evmCctpAddresses(chain: EvmChainId): EvmCctpAddresses {
  /* An RPC handle can name an EVM chain the CCTP registry has never heard of
     since Robinhood Chain got one for the swap lane. The registry would answer
     `undefined` and every address below would read off it; refusing here is
     the only honest answer, because there is no Circle deployment on that
     chain to return. */
  if (!isEvmChain(chain)) throw new TypeError(`${chain} has no Circle domain; USDC does not bridge there.`);
  const entry = SOLANA_CCTP_MAINNET_REGISTRY.chains[chain];
  const find = (role: "MESSAGE_TRANSMITTER_V2" | "TOKEN_MESSENGER_V2"): string => {
    const component = entry.components.find((candidate) => candidate.role === role);
    if (!component) throw new Error(`The CCTP registry has no ${role} for ${entry.label}.`);
    return component.address;
  };
  return {
    chain,
    chainRef: entry.chainRef,
    label: entry.label,
    messageTransmitter: find("MESSAGE_TRANSMITTER_V2"),
    tokenMessenger: find("TOKEN_MESSENGER_V2"),
    usdc: entry.asset.address,
  };
}

/** The same, looked up by the CAIP-2 reference an observation carries. */
export function evmCctpAddressesByRef(chainRef: string): EvmCctpAddresses {
  const profile = evmChainProfileByRef(chainRef);
  if (!profile) throw new Error(`${chainRef} is not an EVM chain this product bridges with.`);
  return evmCctpAddresses(profile.id);
}

export type BaseNonceState = "CONSUMED" | "UNCONSUMED" | "UNREADABLE";

export type BaseNonceRead = Readonly<{
  state: BaseNonceState;
  nonce: string;
  reason: string | null;
  /** Which operator answered. Named, so a disagreement has somewhere to point. */
  observedBy: string | null;
}>;

/**
 * Has the destination already consumed this message?
 *
 * The all-zero nonce is refused before it is asked, and refusing it is not
 * pedantry: the transmitter pre-marks `usedNonces[bytes32(0)]` as consumed when
 * it is deployed, so a malformed or empty message would come back **already
 * minted**. A duplicate-burn boundary that accepted that answer would report
 * the safest-sounding conclusion at precisely the moment it knew nothing.
 */
export async function readBaseNonceState(
  handle: BaseRpcHandle,
  nonce: string,
): Promise<BaseNonceRead> {
  const trimmed = nonce.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(trimmed)) {
    return { state: "UNREADABLE", nonce: trimmed, reason: "A CCTP V2 nonce is 32 bytes of hexadecimal.", observedBy: null };
  }
  if (isPlaceholderNonce(trimmed)) {
    return {
      state: "UNREADABLE",
      nonce: trimmed,
      reason:
        "The all-zero nonce is pre-marked consumed on the transmitter, so asking it would return `already minted` for a message that does not exist.",
      observedBy: null,
    };
  }

  const read = await baseEthCall(handle, {
    to: evmCctpAddresses(handle.chain.id).messageTransmitter,
    data: `${USED_NONCES_SELECTOR}${trimmed.slice(2)}`,
  });
  if (!read.ok) return { state: "UNREADABLE", nonce: trimmed, reason: read.reason, observedBy: null };

  const decimal = hexQuantityToDecimal(read.value);
  if (decimal === null) {
    return { state: "UNREADABLE", nonce: trimmed, reason: "The transmitter returned a non-quantity.", observedBy: read.endpoint.host };
  }
  return {
    state: decimal === "0" ? "UNCONSUMED" : "CONSUMED",
    nonce: trimmed,
    reason: null,
    observedBy: read.endpoint.host,
  };
}

export type BaseMintFacts = Readonly<{
  transactionHash: string;
  blockNumber: string;
  /** The address the mint credited, lower-cased. */
  mintRecipient: string;
  mintToken: string;
  /** Base units, as the chain reported them. */
  mintedRaw: string;
  /** What Circle took on the destination. Read, never assumed zero. */
  feeCollectedRaw: string;
  observedBy: string;
}>;

export type BaseMintObservationState =
  /** The mint was found and read. */
  | "MINTED"
  /** The message has not been consumed. The mint has not happened. */
  | "NOT_MINTED"
  /**
   * The chain says the message is consumed and the log is out of reach.
   * The money arrived; this product cannot yet show the transaction.
   */
  | "CONSUMED_UNSEEN"
  /** Nothing could be established. Never an absence. */
  | "UNAVAILABLE";

export type BaseMintObservation = Readonly<{
  schema: "ryntra.base.cctp-mint-observation";
  schemaVersion: "1.0.0";
  /** The chain that was read. Base or Ethereum; the handle decides. */
  chainRef: "eip155:8453" | "eip155:1";
  state: BaseMintObservationState;
  nonce: string;
  nonceState: BaseNonceState;
  facts: BaseMintFacts | null;
  reason: string | null;
  /** The window that was actually searched, so an empty result is legible. */
  searched: Readonly<{ fromBlock: string; toBlock: string }> | null;
  observedAt: string;
}>;

const word = (data: string, index: number): string =>
  `0x${data.slice(2 + index * 64, 2 + (index + 1) * 64)}`;

const wordToDecimal = (data: string, index: number): string | null => {
  const raw = word(data, index);
  return /^0x[0-9a-f]{64}$/.test(raw) ? BigInt(raw).toString() : null;
};

const topicToAddress = (topic: string): string | null =>
  /^0x0{24}[0-9a-f]{40}$/.test(topic) ? `0x${topic.slice(26)}` : null;

/** Pull the `MintAndWithdraw` facts out of one transaction's logs. */
export function readMintAndWithdraw(
  logs: readonly BaseLog[],
  observedBy: string,
  transactionHash: string,
  blockNumber: string,
  /** The messenger that emitted the mint. Base's when unsaid, as every earlier caller meant. */
  tokenMessenger: string = BASE_TOKEN_MESSENGER_V2,
): BaseMintFacts | null {
  for (const log of logs) {
    if (log.address !== tokenMessenger.toLowerCase()) continue;
    if (log.topics[0] !== BASE_CCTP_TOPICS.mintAndWithdraw) continue;
    const mintRecipient = topicToAddress(log.topics[1] ?? "");
    const mintToken = topicToAddress(log.topics[2] ?? "");
    const mintedRaw = wordToDecimal(log.data, 0);
    const feeCollectedRaw = wordToDecimal(log.data, 1);
    if (!mintRecipient || !mintToken || mintedRaw === null || feeCollectedRaw === null) continue;
    return { transactionHash, blockNumber, mintRecipient, mintToken, mintedRaw, feeCollectedRaw, observedBy };
  }
  return null;
}

function parseReceiptLogs(value: unknown): readonly BaseLog[] | null {
  if (typeof value !== "object" || value === null) return null;
  const receipt = value as Record<string, unknown>;
  if (!Array.isArray(receipt.logs)) return null;
  const logs: BaseLog[] = [];
  for (const entry of receipt.logs) {
    if (typeof entry !== "object" || entry === null) return null;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.address !== "string" || typeof raw.data !== "string" || !Array.isArray(raw.topics)) return null;
    logs.push({
      address: raw.address.toLowerCase(),
      topics: raw.topics.map((topic) => String(topic).toLowerCase()),
      data: raw.data.toLowerCase(),
      blockNumber: typeof raw.blockNumber === "string" ? raw.blockNumber : "0x0",
      transactionHash: typeof raw.transactionHash === "string" ? raw.transactionHash.toLowerCase() : "",
      logIndex: typeof raw.logIndex === "string" ? raw.logIndex : "0x0",
    });
  }
  return logs;
}

/**
 * Look for the destination mint of one message.
 *
 * The state answer is decided by `usedNonces` first and the log search second,
 * so a window too narrow to contain the mint downgrades the answer to
 * `CONSUMED_UNSEEN` instead of turning into `NOT_MINTED`. Those two are the
 * opposite of one another and only one of them is safe to be wrong about.
 */
export async function observeBaseCctpMint(
  handle: BaseRpcHandle,
  args: Readonly<{
    nonce: string;
    fromBlock: bigint;
    toBlock: bigint;
    now?: () => Date;
  }>,
): Promise<BaseMintObservation> {
  const observedAt = (args.now ?? (() => new Date()))().toISOString();
  const addresses = evmCctpAddresses(handle.chain.id);
  const base = {
    schema: "ryntra.base.cctp-mint-observation",
    schemaVersion: "1.0.0",
    chainRef: cctpChainRefOf(handle.chain.chainRef),
    nonce: args.nonce.trim().toLowerCase(),
    observedAt,
  } as const;

  const nonceRead = await readBaseNonceState(handle, args.nonce);
  if (nonceRead.state === "UNREADABLE") {
    return {
      ...base,
      state: "UNAVAILABLE",
      nonceState: "UNREADABLE",
      facts: null,
      reason: nonceRead.reason,
      searched: null,
    };
  }
  if (nonceRead.state === "UNCONSUMED") {
    return {
      ...base,
      state: "NOT_MINTED",
      nonceState: "UNCONSUMED",
      facts: null,
      reason: null,
      searched: null,
    };
  }

  const searched = { fromBlock: args.fromBlock.toString(), toBlock: args.toBlock.toString() };
  const logs = await readBaseLogs(handle, {
    address: addresses.messageTransmitter,
    /* topic1 is the caller and topic2 is the nonce; leaving the caller open is
       the point, since the mint may be relayed by anyone. */
    topics: [BASE_CCTP_TOPICS.messageReceived, null, base.nonce],
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
  });
  if (!logs.ok) {
    return {
      ...base,
      state: "CONSUMED_UNSEEN",
      nonceState: "CONSUMED",
      facts: null,
      reason: `The message is consumed on ${handle.chain.label} and its transaction could not be read: ${logs.reason}`,
      searched,
    };
  }
  const received = logs.value[0];
  if (!received) {
    return {
      ...base,
      state: "CONSUMED_UNSEEN",
      nonceState: "CONSUMED",
      facts: null,
      reason: `The message is consumed on ${handle.chain.label}; its receiving transaction is outside the searched window.`,
      searched,
    };
  }

  const receipt = await baseRpcCall<unknown>(handle, "eth_getTransactionReceipt", [received.transactionHash]);
  if (!receipt.ok) {
    return {
      ...base,
      state: "CONSUMED_UNSEEN",
      nonceState: "CONSUMED",
      facts: null,
      reason: `The receiving transaction ${received.transactionHash} could not be read: ${receipt.reason}`,
      searched,
    };
  }
  const receiptLogs = parseReceiptLogs(receipt.value);
  if (!receiptLogs) {
    return {
      ...base,
      state: "CONSUMED_UNSEEN",
      nonceState: "CONSUMED",
      facts: null,
      reason: `${receipt.endpoint.host} returned a receipt this reader could not parse.`,
      searched,
    };
  }
  const blockNumber = hexQuantityToDecimal(received.blockNumber) ?? received.blockNumber;
  const facts = readMintAndWithdraw(receiptLogs, receipt.endpoint.host, received.transactionHash, blockNumber, addresses.tokenMessenger);
  if (!facts) {
    return {
      ...base,
      state: "CONSUMED_UNSEEN",
      nonceState: "CONSUMED",
      facts: null,
      reason: `The receiving transaction ${received.transactionHash} carries no MintAndWithdraw for this token.`,
      searched,
    };
  }
  return { ...base, state: "MINTED", nonceState: "CONSUMED", facts, reason: null, searched };
}

/**
 * Did the right address receive the right amount?
 *
 * Separate from the observation on purpose. The observation says what the chain
 * did; this says whether that is what was asked for. Merging them would let a
 * mint to the wrong recipient read as a successful transfer because something
 * was minted.
 */
export function reconcileBaseMint(
  observation: BaseMintObservation,
  expected: Readonly<{ recipient: string; receivedRaw: string }>,
): Readonly<{ verdict: "MATCHED" | "DEVIATION_RECORDED" | "NOT_OBSERVED"; deviations: readonly string[] }> {
  if (observation.state !== "MINTED" || !observation.facts) {
    return { verdict: "NOT_OBSERVED", deviations: [] };
  }
  const deviations: string[] = [];
  const wanted = expected.recipient.trim().toLowerCase();
  if (observation.facts.mintRecipient !== wanted) {
    deviations.push(`recipient: expected ${wanted}, minted to ${observation.facts.mintRecipient}`);
  }
  /* The token the *observed* chain mints, not Base's by habit: a Base USDC
     address compared against an Ethereum mint would record a deviation on
     every correct Ethereum transfer. */
  const usdc = evmCctpAddressesByRef(observation.chainRef).usdc.toLowerCase();
  if (observation.facts.mintToken !== usdc) {
    deviations.push(`token: expected ${usdc}, minted ${observation.facts.mintToken}`);
  }
  if (observation.facts.mintedRaw !== expected.receivedRaw) {
    deviations.push(`amount: expected ${expected.receivedRaw}, minted ${observation.facts.mintedRaw}`);
  }
  return { verdict: deviations.length === 0 ? "MATCHED" : "DEVIATION_RECORDED", deviations };
}

/** The recipient's USDC balance on Base, in base units. Six decimals. */
export async function readBaseUsdcBalance(
  handle: BaseRpcHandle,
  owner: string,
): Promise<Readonly<{ ok: true; raw: string; observedBy: string }> | Readonly<{ ok: false; reason: string }>> {
  if (abiAddressWord(owner) === null) return { ok: false, reason: `${owner} is not a 20-byte EVM address.` };
  const read = await readBaseErc20Balance(handle, { token: evmCctpAddresses(handle.chain.id).usdc, owner });
  return read.ok ? { ok: true, raw: read.value, observedBy: read.endpoint.host } : { ok: false, reason: read.reason };
}

/**
 * The same read from a second operator, for the independent-confirmation rule.
 *
 * Takes the endpoint that already answered and asks a different one. If only
 * one operator is configured this returns `null` rather than asking the same
 * host twice and calling the result agreement.
 */
export function secondOperator(handle: BaseRpcHandle, already: string): BaseEndpoint | null {
  return handle.endpoints.find((endpoint) => endpoint.host !== already) ?? null;
}

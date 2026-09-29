/**
 * The Base burn, prepared but never sent from here.
 *
 * This is `cctp-plan.ts`'s counterpart on the other side of the lane, and it is
 * a different shape because the chain is. A Solana burn is one instruction the
 * server compiles into bytes a wallet signs and hands back for inspection. A
 * Base burn is calldata a wallet signs **and broadcasts** in the same call — so
 * this module builds `to` and `data`, prices them against the chain, and stops.
 * No key, no signer, no broadcast.
 *
 * ## The allowance is the reason there can be two prompts
 *
 * `depositForBurn` moves USDC out of the sender's account, which on an ERC-20
 * needs an allowance for the TokenMessenger. If one is already in place and
 * large enough, the person signs once. If it is not, they sign twice: once to
 * approve, once to burn. The count is *derived from the current allowance* and
 * shown before the first prompt opens, because a second wallet window nobody
 * mentioned is indistinguishable from something going wrong.
 *
 * The approval is written for the exact amount rather than for an unlimited
 * one. An unlimited approval is more convenient for the second transfer and
 * leaves a standing permission over somebody's whole balance for the sake of
 * saving them a signature they were already told about.
 *
 * ## Every number below was read, and the ones that could not be are null
 *
 * When the allowance is short, the chain will not price the burn — it reverts
 * in estimation, correctly, because at that moment it *would* revert. That is
 * reported as an unpriced burn with the reason attached, and the plan is built
 * again after the approval lands. It is never replaced with a plausible number.
 *
 * ## What was verified on mainnet rather than read in a document
 *
 * The selector `0x8e0250ee`, the seven-argument order, `destinationCaller` of
 * thirty-two zero bytes and `minFinalityThreshold` of 2000 all come from a live
 * Base `depositForBurn` — transaction `0xf5ee0590…`, sending domain 0 with
 * `maxFee` zero. Circle's contract-interfaces page still documents V1 shapes
 * for V2 contracts, so the chain settled it.
 */

import { getAddressEncoder, address as solanaAddress, type Address } from "@solana/kit";

import {
  abiAddressWord,
  baseEthCall,
  baseRpcCall,
  hexQuantityToDecimal,
  readBaseErc20Balance,
  type BaseRpcHandle,
} from "./rpc.ts";
import { evmCctpAddresses } from "./cctp-observe.ts";
import { cctpBurnIntentDigest, CCTP_FINALITY_THRESHOLD } from "../solana/cctp-burn.ts";
import { cctpProtocolFeeRaw } from "../solana/cctp-plan.ts";
import { cctpChainRefOf, isEvmChain, SOLANA_ADDRESS_PATTERN, type CctpEvmChain, type CctpEvmSourceDirection } from "../solana/cctp-direction.ts";
import type { CctpProviderSnapshot } from "../solana/cctp-provider.ts";
import { SOLANA_CCTP_MAINNET_REGISTRY, solanaCctpDirectionsFor } from "../solana/cctp-registry.ts";

/** `keccak256("approve(address,uint256)")[0..4]`. */
export const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
/** `keccak256("allowance(address,address)")[0..4]`. */
export const ERC20_ALLOWANCE_SELECTOR = "0xdd62ed3e";
/**
 * `keccak256("depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)")[0..4]`.
 *
 * Confirmed against a live Base transaction rather than derived and hoped over:
 * CCTP V1 exposes a five-argument `depositForBurn` with the same name, and the
 * two selectors are entirely different values that would both look right.
 */
export const CCTP_DEPOSIT_FOR_BURN_SELECTOR = "0x8e0250ee";

const ADDRESS = getAddressEncoder();

function word(value: bigint): string {
  if (value < 0n) throw new Error("An ABI word cannot encode a negative quantity.");
  const hex = value.toString(16);
  if (hex.length > 64) throw new Error("The value does not fit in a 32-byte ABI word.");
  return hex.padStart(64, "0");
}

/**
 * A Solana address as CCTP's 32-byte recipient.
 *
 * A Solana public key is already thirty-two bytes, so there is no padding to do
 * — but there is a trap worth naming. On a Solana destination the recipient in
 * the message is the recipient's **associated token account**, not their wallet:
 * `receive_message` transfers into a token account and creates nothing. Passing
 * a wallet address here would produce a message that can never be received, and
 * the burn would already have happened by the time anyone found out. The caller
 * derives the token account; this only encodes what it is given.
 */
export function solanaMintRecipient(tokenAccount: string): string {
  const trimmed = tokenAccount.trim();
  if (!SOLANA_ADDRESS_PATTERN.test(trimmed)) {
    throw new Error(`Not a Solana address: ${tokenAccount}`);
  }
  return Buffer.from(ADDRESS.encode(solanaAddress(trimmed) as Address)).toString("hex");
}

/** Thirty-two zero bytes: anyone holding the message may complete the mint. */
export function anyDestinationCallerHex(): string {
  return "0".repeat(64);
}

/** ABI-encode `approve(address spender, uint256 value)`. */
export function encodeErc20Approve(spender: string, amountRaw: string): string {
  const spenderWord = abiAddressWord(spender);
  if (spenderWord === null) throw new Error(`Not a 20-byte EVM address: ${spender}`);
  return `${ERC20_APPROVE_SELECTOR}${spenderWord}${word(BigInt(amountRaw))}`;
}

export type BaseDepositForBurnArgs = Readonly<{
  amountRaw: string;
  destinationDomain: number;
  /** Thirty-two bytes, hex without `0x`. Already the destination's own shape. */
  mintRecipientHex: string;
  burnToken: string;
  destinationCallerHex: string;
  maxFeeRaw: string;
  minFinalityThreshold: number;
}>;

/**
 * ABI-encode `depositForBurn`.
 *
 * Seven static arguments and no dynamic ones, so the encoding is the selector
 * followed by seven words in declaration order. Written out rather than passed
 * through a general encoder for the same reason `encodeReceiveMessage` is: the
 * test can then pin the exact layout that moves real money.
 */
export function encodeDepositForBurn(args: BaseDepositForBurnArgs): string {
  const burnTokenWord = abiAddressWord(args.burnToken);
  if (burnTokenWord === null) throw new Error(`Not a 20-byte EVM address: ${args.burnToken}`);
  if (!/^[0-9a-f]{64}$/.test(args.mintRecipientHex)) {
    throw new Error("The mint recipient must be thirty-two bytes of lower-case hexadecimal.");
  }
  if (!/^[0-9a-f]{64}$/.test(args.destinationCallerHex)) {
    throw new Error("The destination caller must be thirty-two bytes of lower-case hexadecimal.");
  }
  if (BigInt(args.maxFeeRaw) >= BigInt(args.amountRaw)) {
    /* Circle refuses a fee ceiling at or above the amount, and a burn that
       reverts costs a signature to discover something arithmetic could say. */
    throw new Error("The fee ceiling must be below the amount being burned.");
  }
  return (
    CCTP_DEPOSIT_FOR_BURN_SELECTOR +
    word(BigInt(args.amountRaw)) +
    word(BigInt(args.destinationDomain)) +
    args.mintRecipientHex +
    burnTokenWord +
    args.destinationCallerHex +
    word(BigInt(args.maxFeeRaw)) +
    word(BigInt(args.minFinalityThreshold))
  );
}

/** The current ERC-20 allowance, in base units. */
export async function readBaseErc20Allowance(
  handle: BaseRpcHandle,
  args: Readonly<{ token: string; owner: string; spender: string }>,
): Promise<Readonly<{ ok: true; raw: string; observedBy: string }> | Readonly<{ ok: false; reason: string }>> {
  const ownerWord = abiAddressWord(args.owner);
  const spenderWord = abiAddressWord(args.spender);
  if (ownerWord === null || spenderWord === null) {
    return { ok: false, reason: "The allowance owner and spender must both be 20-byte EVM addresses." };
  }
  const read = await baseEthCall(handle, {
    to: args.token,
    data: `${ERC20_ALLOWANCE_SELECTOR}${ownerWord}${spenderWord}`,
  });
  if (!read.ok) return { ok: false, reason: read.reason };
  const decimal = hexQuantityToDecimal(read.value);
  if (decimal === null) return { ok: false, reason: "The token returned an allowance that is not a hex quantity." };
  return { ok: true, raw: decimal, observedBy: read.endpoint.host };
}

export type BaseBurnPlanFailureCode =
  | "OWNER_INVALID"
  | "RECIPIENT_INVALID"
  | "AMOUNT_OUT_OF_RANGE"
  | "PROVIDER_FACTS_UNAVAILABLE"
  | "BALANCE_UNREADABLE"
  | "BALANCE_INSUFFICIENT"
  | "ALLOWANCE_UNREADABLE"
  | "CHAIN_NOT_CCTP"
  | "BUILD_FAILED";

export type BaseBurnPlanFailure = Readonly<{ ok: false; code: BaseBurnPlanFailureCode; reason: string }>;

/** One EVM call the person will be asked to sign, priced where the chain would price it. */
export type BaseCall = Readonly<{
  purpose: "APPROVE" | "BURN";
  to: string;
  data: string;
  gasEstimate: string | null;
  /** Estimate times the current gas price, in wei. Null when either half is unknown. */
  maximumCostWei: string | null;
  /** Why the chain would not price it, when it would not. */
  unpricedReason: string | null;
}>;

export type BaseBurnPlan = Readonly<{
  schema: "ryntra.base.cctp-burn-plan";
  schemaVersion: "1.0.0";
  network: "mainnet";
  /** Which EVM chain burns. Decided by the handle, never by the request. */
  direction: CctpEvmSourceDirection;
  sourceChain: CctpEvmChain;
  destinationChain: "solana";
  sourceDomain: number;
  destinationDomain: number;
  chainRef: "eip155:8453" | "eip155:1";
  chainId: number;
  /** The EVM account that holds the USDC and will sign. */
  owner: string;
  /** The Solana wallet the person typed. Their money ends up here. */
  destinationOwner: string;
  /** The Solana token account CCTP will actually credit. */
  destinationRecipient: string;
  /** Whether that token account exists today. It must, before the message lands. */
  destinationAccountExists: boolean;
  mintRecipientHex: string;
  destinationCallerHex: string;
  amountRaw: string;
  maxFeeRaw: string;
  protocolFeeRaw: string;
  expectedReceiveRaw: string;
  minFinalityThreshold: number;
  speed: "STANDARD";
  minimumFeeBps: string;
  /** The contract the allowance is granted to, and the one that burns. */
  tokenMessenger: string;
  burnToken: string;
  allowance: Readonly<{
    currentRaw: string;
    requiredRaw: string;
    sufficient: boolean;
    /** Exactly the amount, never unlimited. Null when no approval is needed. */
    approveAmountRaw: string | null;
  }>;
  balances: Readonly<{ usdcRaw: string; ethWei: string | null }>;
  gasPriceWei: string | null;
  /** In the order they will be signed. One entry, or two. */
  calls: readonly BaseCall[];
  /** How many wallet prompts this will take. Derived, and said before the first. */
  walletPrompts: number;
  /** Every priced call added together. Null when any of them is unpriced. */
  totalMaximumCostWei: string | null;
  affordable: boolean | null;
  intentDigest: string;
  builtAt: string;
}>;

export type BaseBurnPlanResult = Readonly<{ ok: true; plan: BaseBurnPlan }> | BaseBurnPlanFailure;

/**
 * Build the Base burn.
 *
 * Never throws for an ordinary condition: an unreadable balance, a short
 * allowance and an unaffordable transfer are all values with a code, because
 * each of them is a sentence a person needs rather than a stack trace.
 */
export async function planBaseCctpBurn(
  handle: BaseRpcHandle,
  args: Readonly<{
    provider: CctpProviderSnapshot;
    owner: string;
    /** The Solana wallet the person typed. */
    destinationOwner: string;
    /** Its associated USDC account, derived by the caller. */
    destinationTokenAccount: string;
    destinationAccountExists: boolean;
    amountRaw: string;
    now?: () => Date;
  }>,
): Promise<BaseBurnPlanResult> {
  const builtAt = (args.now ?? (() => new Date()))().toISOString();
  /* Robinhood Chain can be read over RPC but has no Circle domain and no USDC,
     so a handle for it must never reach a burn or a mint. The type used to
     make this impossible by accident, when every EVM chain this product knew
     was a CCTP chain; now it is said out loud, and refused at run time as well
     as at compile time. */
  if (!isEvmChain(handle.chain.id)) {
    return { ok: false, code: "CHAIN_NOT_CCTP", reason: `${handle.chain.label} has no Circle domain; USDC does not bridge there.` };
  }
  const cctpChain = handle.chain.id;
  /* The chain is the handle's, said once here. Base and Ethereum burn through
     the same contract at the same address; what differs is the USDC, the
     domain the message carries and the lane the claim is written under. */
  const chain = evmCctpAddresses(cctpChain);
  const direction = solanaCctpDirectionsFor(cctpChain).toSolana;
  const sourceDomain = SOLANA_CCTP_MAINNET_REGISTRY.chains[cctpChain].domain;
  const owner = args.owner.trim().toLowerCase();
  if (abiAddressWord(owner) === null) {
    return { ok: false, code: "OWNER_INVALID", reason: `The sending wallet is not a 20-byte address on ${chain.label}.` };
  }
  if (!SOLANA_ADDRESS_PATTERN.test(args.destinationOwner.trim())) {
    return {
      ok: false,
      code: "RECIPIENT_INVALID",
      reason: `The Solana recipient must be a Solana address. A ${chain.label}-style address here would burn into nothing.`,
    };
  }
  const amount = BigInt(args.amountRaw);
  if (amount <= 0n) {
    return { ok: false, code: "AMOUNT_OUT_OF_RANGE", reason: "Enter an amount greater than zero." };
  }

  if (args.provider.fees.state !== "AVAILABLE") {
    return {
      ok: false,
      code: "PROVIDER_FACTS_UNAVAILABLE",
      reason: "Circle's fee for this exact route could not be read, so no ceiling can be set for it.",
    };
  }
  const tier = args.provider.fees.tiers.find((entry) => entry.mode === "STANDARD");
  if (!tier) {
    return { ok: false, code: "PROVIDER_FACTS_UNAVAILABLE", reason: "Circle returned no Standard tier for this route." };
  }
  const protocolFeeRaw = cctpProtocolFeeRaw(args.amountRaw, tier.minimumFeeBps);
  if (BigInt(protocolFeeRaw) >= amount) {
    return {
      ok: false,
      code: "AMOUNT_OUT_OF_RANGE",
      reason: "Circle's fee for this route is at least as large as the amount, so nothing would arrive.",
    };
  }

  const [usdcRead, ethRead, allowanceRead, gasPriceRead] = await Promise.all([
    readBaseErc20Balance(handle, { token: chain.usdc, owner }),
    baseRpcCall<string>(handle, "eth_getBalance", [owner, "latest"]),
    readBaseErc20Allowance(handle, { token: chain.usdc, owner, spender: chain.tokenMessenger }),
    baseRpcCall<string>(handle, "eth_gasPrice", []),
  ]);

  if (!usdcRead.ok) {
    return { ok: false, code: "BALANCE_UNREADABLE", reason: `The wallet's USDC on ${chain.label} could not be read: ${usdcRead.reason}` };
  }
  if (BigInt(usdcRead.value) < amount) {
    return { ok: false, code: "BALANCE_INSUFFICIENT", reason: `The wallet holds less USDC on ${chain.label} than this transfer would burn.` };
  }
  if (!allowanceRead.ok) {
    return {
      ok: false,
      code: "ALLOWANCE_UNREADABLE",
      reason: `The current permission this wallet has given Circle could not be read, and an unknown permission is not a granted one: ${allowanceRead.reason}`,
    };
  }

  const ethWei = ethRead.ok ? hexQuantityToDecimal(ethRead.value) : null;
  const gasPriceWei = gasPriceRead.ok ? hexQuantityToDecimal(gasPriceRead.value) : null;
  const allowanceSufficient = BigInt(allowanceRead.raw) >= amount;

  let mintRecipientHex: string;
  let burnData: string;
  const destinationCallerHex = anyDestinationCallerHex();
  try {
    mintRecipientHex = solanaMintRecipient(args.destinationTokenAccount);
    burnData = encodeDepositForBurn({
      amountRaw: args.amountRaw,
      destinationDomain: 5,
      mintRecipientHex,
      burnToken: chain.usdc,
      destinationCallerHex,
      maxFeeRaw: protocolFeeRaw,
      minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
    });
  } catch (cause) {
    return { ok: false, code: "BUILD_FAILED", reason: cause instanceof Error ? cause.message : String(cause) };
  }

  const calls: BaseCall[] = [];
  const priced = async (purpose: "APPROVE" | "BURN", to: string, data: string): Promise<BaseCall> => {
    const estimate = await baseRpcCall<string>(handle, "eth_estimateGas", [{ from: owner, to, data }]);
    const gasEstimate = estimate.ok ? hexQuantityToDecimal(estimate.value) : null;
    return {
      purpose,
      to,
      data,
      gasEstimate,
      maximumCostWei:
        gasEstimate !== null && gasPriceWei !== null ? (BigInt(gasEstimate) * BigInt(gasPriceWei)).toString() : null,
      unpricedReason:
        gasEstimate !== null
          ? null
          : estimate.ok
            ? `${chain.label} returned no estimate for this call.`
            : `${chain.label} would not price this call: ${estimate.reason}`,
    };
  };

  if (!allowanceSufficient) {
    calls.push(await priced("APPROVE", chain.usdc, encodeErc20Approve(chain.tokenMessenger, args.amountRaw)));
    /* Deliberately not estimated. Until the approval lands the burn genuinely
       would revert, so the chain's refusal to price it is the correct answer to
       the wrong question — and a number invented in its place would be the one
       thing on this card nobody read anywhere. */
    calls.push({
      purpose: "BURN",
      to: chain.tokenMessenger,
      data: burnData,
      gasEstimate: null,
      maximumCostWei: null,
      unpricedReason:
        `${chain.label} cannot price the transfer until the permission above is in place, so its fee is read again straight afterwards.`,
    });
  } else {
    calls.push(await priced("BURN", chain.tokenMessenger, burnData));
  }

  const totalMaximumCostWei = calls.every((call) => call.maximumCostWei !== null)
    ? calls.reduce((sum, call) => sum + BigInt(call.maximumCostWei as string), 0n).toString()
    : null;
  const affordable =
    totalMaximumCostWei !== null && ethWei !== null ? BigInt(ethWei) >= BigInt(totalMaximumCostWei) : null;

  const plan: BaseBurnPlan = {
    schema: "ryntra.base.cctp-burn-plan",
    schemaVersion: "1.0.0",
    network: "mainnet",
    direction,
    sourceChain: cctpChain,
    destinationChain: "solana",
    sourceDomain,
    destinationDomain: 5,
    chainRef: cctpChainRefOf(handle.chain.chainRef),
    chainId: handle.chain.chainId,
    owner,
    destinationOwner: args.destinationOwner.trim(),
    destinationRecipient: args.destinationTokenAccount.trim(),
    destinationAccountExists: args.destinationAccountExists,
    mintRecipientHex: `0x${mintRecipientHex}`,
    destinationCallerHex: `0x${destinationCallerHex}`,
    amountRaw: args.amountRaw,
    maxFeeRaw: protocolFeeRaw,
    protocolFeeRaw,
    expectedReceiveRaw: (amount - BigInt(protocolFeeRaw)).toString(),
    minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
    speed: "STANDARD",
    minimumFeeBps: tier.minimumFeeBps,
    tokenMessenger: chain.tokenMessenger,
    burnToken: chain.usdc,
    allowance: {
      currentRaw: allowanceRead.raw,
      requiredRaw: args.amountRaw,
      sufficient: allowanceSufficient,
      approveAmountRaw: allowanceSufficient ? null : args.amountRaw,
    },
    balances: { usdcRaw: usdcRead.value, ethWei },
    gasPriceWei,
    calls,
    walletPrompts: calls.length,
    totalMaximumCostWei,
    affordable,
    /* The same digest function the forward lane uses, given this lane's own
       facts. The burner is the EVM account, and what it burns from is that same
       account rather than a separate token account — on an ERC-20 the balance
       lives at the owner's address, so naming the owner twice is the honest
       encoding of "there is no second account here". */
    intentDigest: cctpBurnIntentDigest({
      direction,
      sourceDomain,
      owner,
      burnTokenAccount: owner,
      amountRaw: args.amountRaw,
      destinationDomain: 5,
      mintRecipient: Uint8Array.from(Buffer.from(mintRecipientHex, "hex")),
      minFinalityThreshold: CCTP_FINALITY_THRESHOLD.STANDARD,
    }),
    builtAt,
  };
  return { ok: true, plan };
}

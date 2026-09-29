/**
 * Which way the money is going, said once and never inferred.
 *
 * Before this module the lane had a direction in its registry and nowhere else:
 * `cctp-plan.ts` asked Circle for `SOLANA_TO_BASE`, the burn route refused
 * anything that was not that literal, the attestation route hard-coded
 * destination domain 6, and the receipt named Solana as the source in its
 * schema. Every one of those looked like shared code and was not. Building the
 * reverse leg on top of that would have produced the worst possible defect for
 * a money product: a screen that says Base → Solana while one hidden half of
 * the system still reads Solana → Base.
 *
 * So direction is a value that travels with the transfer, from the request to
 * the Receipt, and this module is the only place that decides what it means.
 * Nothing anywhere may work it out from a route name, from the shape of an
 * address, or from which wallet happens to be connected — those are guesses
 * that are right until the day they are not.
 *
 * ## Three chains, two kinds of chain
 *
 * Ethereum joined on 2026-09-05 (`RYN-SOL-MONEY-FLOWS-001E`). It did not add a
 * third *kind* of chain: every question this module answers about Base — what
 * a recipient is, who needs an approval, how a transaction is named — has the
 * same answer on Ethereum, because both are EVM chains running Circle's V2
 * contracts at the same addresses. What differs is the chain id, the domain
 * number, the USDC contract and the gas. So the model below is `"solana"` on
 * one side and an *EVM chain* on the other, and code that used to test
 * `chain === "base"` to mean "the EVM side" now asks `isEvmChain`, which is the
 * question it always meant.
 *
 * ## What each half of a lane actually is
 *
 * A CCTP transfer has a **source** chain, where value is burned and a message
 * is emitted, and a **destination** chain, where the message is replayed once
 * and value appears. The two chains here are not symmetric and pretending they
 * are is how a bridge breaks:
 *
 * - **The destination recipient is not the same kind of thing on both sides.**
 *   On an EVM chain it is the owner's 20-byte address. On Solana CCTP mints
 *   into a *token account*, so the 32-byte recipient in the message is the
 *   recipient's associated USDC account, not their wallet. This was read off a
 *   live mainnet `receive_message`, not assumed: the message's `mintRecipient`
 *   equals the token account the transfer credited, and its owner is the person.
 * - **Approval only exists on one side.** Burning on an EVM chain spends an
 *   ERC-20 allowance and may need a separate `approve` first. Burning on Solana
 *   needs no such thing, and an owner-authority signature covers it.
 * - **The number of wallet prompts differs, and it is not a constant.** It is
 *   derived where it is known and stated before the first one opens.
 */

import {
  SOLANA_CCTP_MAINNET_REGISTRY,
  solanaCctpDirectionsFor,
  solanaCctpEvmChainOf,
  solanaCctpLane,
  SOLANA_CCTP_DIRECTIONS,
  SOLANA_CCTP_EVM_CHAINS,
  type SolanaCctpChainId,
  type SolanaCctpDirection,
  type SolanaCctpEvmChainId,
} from "./cctp-registry.ts";

/**
 * The canonical name for a lane.
 *
 * Aliased rather than redefined: the registry already owns the pair and a
 * second enum would be a second source of truth for the one fact this module
 * exists to make single.
 */
export type CctpDirection = SolanaCctpDirection;

export const CCTP_DIRECTIONS = SOLANA_CCTP_DIRECTIONS;

/** A chain a lane can start or end on. */
export type CctpChain = SolanaCctpChainId;
/** The EVM end of a lane. */
export type CctpEvmChain = SolanaCctpEvmChainId;
/** A lane that starts on Solana, and one that ends there. */
export type CctpSolanaSourceDirection = "SOLANA_TO_BASE" | "SOLANA_TO_ETHEREUM";
export type CctpEvmSourceDirection = "BASE_TO_SOLANA" | "ETHEREUM_TO_SOLANA";

export const CCTP_EVM_CHAINS = SOLANA_CCTP_EVM_CHAINS;
export const CCTP_SOLANA_SOURCE_DIRECTIONS: readonly CctpSolanaSourceDirection[] = ["SOLANA_TO_BASE", "SOLANA_TO_ETHEREUM"];
export const CCTP_EVM_SOURCE_DIRECTIONS: readonly CctpEvmSourceDirection[] = ["BASE_TO_SOLANA", "ETHEREUM_TO_SOLANA"];

export const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
export const EVM_TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
export const SOLANA_SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export function isCctpDirection(value: unknown): value is CctpDirection {
  return typeof value === "string" && (CCTP_DIRECTIONS as readonly string[]).includes(value);
}

export function isCctpChain(value: unknown): value is CctpChain {
  return value === "solana" || isEvmChain(value);
}

/** Whether a chain is the EVM end of a lane. The question `=== "base"` used to stand in for. */
export function isEvmChain(value: unknown): value is CctpEvmChain {
  return typeof value === "string" && (CCTP_EVM_CHAINS as readonly string[]).includes(value);
}

export function isSolanaSourceDirection(direction: CctpDirection): direction is CctpSolanaSourceDirection {
  return direction === "SOLANA_TO_BASE" || direction === "SOLANA_TO_ETHEREUM";
}

export function isEvmSourceDirection(direction: CctpDirection): direction is CctpEvmSourceDirection {
  return !isSolanaSourceDirection(direction);
}

/** The chain a lane starts on, and the chain it ends on. Never guessed. */
export function cctpSourceChain(direction: CctpDirection): CctpChain {
  return isSolanaSourceDirection(direction) ? "solana" : solanaCctpEvmChainOf(direction);
}

export function cctpDestinationChain(direction: CctpDirection): CctpChain {
  return isSolanaSourceDirection(direction) ? solanaCctpEvmChainOf(direction) : "solana";
}

/** The EVM chain a lane touches, whichever end it is on. */
export function cctpEvmChain(direction: CctpDirection): CctpEvmChain {
  return solanaCctpEvmChainOf(direction);
}

/** The one place a direction is derived from two chains, and it is explicit. */
export function cctpDirectionOf(sourceChain: CctpChain, destinationChain: CctpChain): CctpDirection | null {
  if (sourceChain === "solana" && isEvmChain(destinationChain)) return solanaCctpDirectionsFor(destinationChain).fromSolana;
  if (isEvmChain(sourceChain) && destinationChain === "solana") return solanaCctpDirectionsFor(sourceChain).toSolana;
  return null;
}

export function cctpReverseDirection(direction: CctpDirection): CctpDirection {
  const pair = solanaCctpDirectionsFor(solanaCctpEvmChainOf(direction));
  return direction === pair.fromSolana ? pair.toSolana : pair.fromSolana;
}

/** Whether a string can be an address on that chain. Format only, never ownership. */
export function isChainAddress(chain: CctpChain, value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return chain === "solana" ? SOLANA_ADDRESS_PATTERN.test(trimmed) : EVM_ADDRESS_PATTERN.test(trimmed);
}

/** Whether a string can be a transaction identifier on that chain. */
export function isChainTransactionId(chain: CctpChain, value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return chain === "solana" ? SOLANA_SIGNATURE_PATTERN.test(trimmed) : EVM_TX_HASH_PATTERN.test(trimmed);
}

/**
 * How a chain names itself in a receipt and in a CAIP-2 reference.
 *
 * Read from the registry rather than written twice, so a chain that ever moves
 * moves in one file.
 */
export function cctpChainRef(chain: CctpChain): string {
  return SOLANA_CCTP_MAINNET_REGISTRY.chains[chain].chainRef;
}

/**
 * The CAIP-2 reference of a chain that carries a Circle domain, narrowed.
 *
 * An RPC handle can now name an EVM chain that CCTP has never heard of
 * (Robinhood Chain, added by `RYN-SOL-MONEY-FLOWS-001H` for the swap lane), so
 * a plan that copies `handle.chain.chainRef` into a CCTP receipt is copying a
 * wider type than the receipt means. This is the one place that narrows it,
 * and it refuses rather than widening the receipt: a reference that is not one
 * of Circle's two is a bug upstream of here, and a bridge that keeps going
 * with the wrong chain in its receipt is the defect this module exists to
 * prevent.
 */
export function cctpChainRefOf(chainRef: string): "eip155:8453" | "eip155:1" {
  if (chainRef === "eip155:8453" || chainRef === "eip155:1") return chainRef;
  throw new TypeError(`${chainRef} is not a CCTP chain; USDC does not bridge there.`);
}

/** The chain's name as a person reads it. */
export function cctpChainLabel(chain: CctpChain): string {
  return SOLANA_CCTP_MAINNET_REGISTRY.chains[chain].label;
}

export function cctpChainDomain(chain: CctpChain): 0 | 5 | 6 {
  return SOLANA_CCTP_MAINNET_REGISTRY.chains[chain].domain;
}

/** The registry chain for a Circle domain number, or null for one this product does not know. */
export function cctpChainOfDomain(domain: number): CctpChain | null {
  for (const chain of ["solana", ...CCTP_EVM_CHAINS] as const) {
    if (SOLANA_CCTP_MAINNET_REGISTRY.chains[chain].domain === domain) return chain;
  }
  return null;
}

export function cctpUsdcAddress(chain: CctpChain): string {
  return SOLANA_CCTP_MAINNET_REGISTRY.chains[chain].asset.address;
}

/**
 * Everything a caller needs about one lane, in one value.
 *
 * `solanaCctpLane` already returns the two registry entries; this adds the
 * facts a *builder* needs and a registry has no opinion about — which side
 * needs a token approval, what a recipient is on the destination, and how the
 * source transaction is identified.
 */
export type CctpLaneFacts = Readonly<{
  direction: CctpDirection;
  /** The EVM end of the lane, so a caller never has to work out which side it is. */
  evmChain: CctpEvmChain;
  source: Readonly<{
    chain: CctpChain;
    label: string;
    chainRef: string;
    domain: 0 | 5 | 6;
    usdc: string;
    /** True when spending the burner's balance needs a separate ERC-20 allowance. */
    requiresTokenApproval: boolean;
  }>;
  destination: Readonly<{
    chain: CctpChain;
    label: string;
    chainRef: string;
    domain: 0 | 5 | 6;
    usdc: string;
    /**
     * What the message's 32-byte recipient actually names.
     *
     * `OWNER_ADDRESS` on an EVM chain. `ASSOCIATED_TOKEN_ACCOUNT` on Solana —
     * and that account must already exist when the message is replayed, which
     * is a real step a person may have to take rather than a detail.
     */
    recipientKind: "OWNER_ADDRESS" | "ASSOCIATED_TOKEN_ACCOUNT";
  }>;
}>;

export function cctpLaneFacts(direction: CctpDirection): CctpLaneFacts {
  const lane = solanaCctpLane(direction);
  const sourceChain = cctpSourceChain(direction);
  const destinationChain = cctpDestinationChain(direction);
  return {
    direction,
    evmChain: cctpEvmChain(direction),
    source: {
      chain: sourceChain,
      label: lane.source.label,
      chainRef: lane.source.chainRef,
      domain: lane.source.domain,
      usdc: lane.source.asset.address,
      requiresTokenApproval: isEvmChain(sourceChain),
    },
    destination: {
      chain: destinationChain,
      label: lane.destination.label,
      chainRef: lane.destination.chainRef,
      domain: lane.destination.domain,
      usdc: lane.destination.asset.address,
      recipientKind: destinationChain === "solana" ? "ASSOCIATED_TOKEN_ACCOUNT" : "OWNER_ADDRESS",
    },
  };
}

/**
 * The CCTP component a lane's source burns through, and the one its
 * destination replays through.
 *
 * Solana names its burn program `TOKEN_MESSENGER_MINTER_V2` and the EVM chains
 * split the same job across `TOKEN_MESSENGER_V2`; asking for "the source
 * program" without knowing which chain it is on is exactly the kind of question
 * that produces a plausible wrong address.
 */
export function cctpSourceProgram(direction: CctpDirection): string {
  const lane = solanaCctpLane(direction);
  const role = lane.source.id === "solana" ? "TOKEN_MESSENGER_MINTER_V2" : "TOKEN_MESSENGER_V2";
  const component = lane.source.components.find((entry) => entry.role === role);
  if (!component) throw new Error(`The CCTP registry has no ${role} for ${lane.source.id}.`);
  return component.address;
}

export function cctpDestinationProgram(direction: CctpDirection): string {
  const lane = solanaCctpLane(direction);
  const component = lane.destination.components.find((entry) => entry.role === "MESSAGE_TRANSMITTER_V2");
  if (!component) throw new Error(`The CCTP registry has no MESSAGE_TRANSMITTER_V2 for ${lane.destination.id}.`);
  return component.address;
}

/**
 * A program or asset written so a reader can tell which chain it is on.
 *
 * A bare hex string and a bare base58 string are both "an address"; prefixing
 * the EVM one with its CAIP-2 chain is what stops a Base contract, an Ethereum
 * contract and a Solana program being compared as if they were one namespace.
 */
export function cctpProgramRef(chain: CctpChain, address: string): string {
  return isEvmChain(chain) ? `${cctpChainRef(chain)}:${address}` : address;
}

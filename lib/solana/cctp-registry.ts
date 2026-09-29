import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "../guard/canonical-json.ts";

/**
 * The CCTP lanes this product knows, read from Circle's own pages and nowhere else.
 *
 * Three chains now: Solana, Base and Ethereum. The third arrived with
 * `RYN-SOL-MONEY-FLOWS-001E` after the route research of 2026-09-05, and it
 * arrived *here* rather than as a fourth copy of the Base wiring because a
 * registry with two chains had let every module assume "the other side is
 * Base". Ethereum is the first candidate MASTER-PLAN §7 names, and on CCTP V2
 * it is the same rail as Base: native USDC burned on one side and minted on
 * the other, no wrapped token, no pool, the very same four contract addresses
 * — Circle deploys V2 at identical addresses on every EVM chain, which is a
 * fact this file pins rather than assumes (the `sourceRef` on every component
 * is the page it was read from).
 *
 * What the registry does **not** say is that a lane is open to a person. That
 * is a route-matrix and lane-state question (`bridge-routes.ts`,
 * `lane-state.ts`); this file only records what exists on chain.
 */

const CIRCLE_SOURCE = z
  .string()
  .url()
  .refine((value) => new URL(value).origin === "https://developers.circle.com", {
    message: "CCTP registry evidence must come from official Circle documentation.",
  });
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const ComponentSchema = z
  .object({
    role: z.enum([
      "MESSAGE_TRANSMITTER_V2",
      "TOKEN_MESSENGER_MINTER_V2",
      "TOKEN_MESSENGER_V2",
      "TOKEN_MINTER_V2",
      "MESSAGE_V2",
    ]),
    address: z.string().min(32).max(44),
    sourceRef: CIRCLE_SOURCE,
  })
  .strict();

const CapabilitiesSchema = z
  .object({
    standardSource: z.literal(true),
    fastSource: z.literal(true),
    forwardingService: z.literal(true),
    upfrontFees: z.boolean(),
  })
  .strict();

const AssetSchema = z
  .object({
    symbol: z.literal("USDC"),
    decimals: z.literal(6),
    representation: z.literal("NATIVE_USDC"),
    address: z.string().min(32).max(44),
    assetRef: z.string().min(32).max(96),
    sourceRef: CIRCLE_SOURCE,
  })
  .strict();

const SolanaChainSchema = z
  .object({
    id: z.literal("solana"),
    label: z.literal("Solana"),
    chainRef: z.literal("solana:mainnet"),
    domain: z.literal(5),
    addressFormat: z.literal("SOLANA_BASE58"),
    asset: AssetSchema.extend({
      address: z.string().regex(SOLANA_ADDRESS),
      assetRef: z.literal("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    }).strict(),
    components: z
      .tuple([
        ComponentSchema.extend({
          role: z.literal("MESSAGE_TRANSMITTER_V2"),
          address: z.string().regex(SOLANA_ADDRESS),
        }).strict(),
        ComponentSchema.extend({
          role: z.literal("TOKEN_MESSENGER_MINTER_V2"),
          address: z.string().regex(SOLANA_ADDRESS),
        }).strict(),
      ]),
    capabilities: CapabilitiesSchema.extend({ upfrontFees: z.literal(false) }).strict(),
  })
  .strict();

/**
 * The four V2 contracts every EVM chain deploys, in one fixed order.
 *
 * Shared between Base and Ethereum on purpose: the addresses are the same on
 * both, and a reader comparing the two entries should see that the *only*
 * things that differ are the chain, its domain and its USDC.
 */
const EvmComponentsSchema = z.tuple([
  ComponentSchema.extend({
    role: z.literal("MESSAGE_TRANSMITTER_V2"),
    address: z.string().regex(EVM_ADDRESS),
  }).strict(),
  ComponentSchema.extend({
    role: z.literal("TOKEN_MESSENGER_V2"),
    address: z.string().regex(EVM_ADDRESS),
  }).strict(),
  ComponentSchema.extend({
    role: z.literal("TOKEN_MINTER_V2"),
    address: z.string().regex(EVM_ADDRESS),
  }).strict(),
  ComponentSchema.extend({
    role: z.literal("MESSAGE_V2"),
    address: z.string().regex(EVM_ADDRESS),
  }).strict(),
]);

const BaseChainSchema = z
  .object({
    id: z.literal("base"),
    label: z.literal("Base"),
    chainRef: z.literal("eip155:8453"),
    domain: z.literal(6),
    addressFormat: z.literal("EVM_HEX"),
    asset: AssetSchema.extend({
      address: z.literal("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
      assetRef: z.literal("eip155:8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    }).strict(),
    components: EvmComponentsSchema,
    capabilities: CapabilitiesSchema.extend({ upfrontFees: z.literal(true) }).strict(),
  })
  .strict();

const EthereumChainSchema = z
  .object({
    id: z.literal("ethereum"),
    label: z.literal("Ethereum"),
    chainRef: z.literal("eip155:1"),
    /* Domain 0 is Ethereum on Circle's table, and the one domain whose number
       is falsy — every `if (domain)` in the code base is a bug waiting for it. */
    domain: z.literal(0),
    addressFormat: z.literal("EVM_HEX"),
    asset: AssetSchema.extend({
      address: z.literal("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
      assetRef: z.literal("eip155:1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
    }).strict(),
    components: EvmComponentsSchema,
    capabilities: CapabilitiesSchema.extend({ upfrontFees: z.literal(true) }).strict(),
  })
  .strict();

export const SolanaCctpRegistrySchema = z
  .object({
    schema: z.literal("ryntra.solana.cctp-registry"),
    schemaVersion: z.literal("1.1.0"),
    network: z.literal("MAINNET"),
    provider: z.literal("CIRCLE_CCTP_V2"),
    apiOrigin: z.literal("https://iris-api.circle.com"),
    chains: z.object({ solana: SolanaChainSchema, base: BaseChainSchema, ethereum: EthereumChainSchema }).strict(),
    sources: z
      .object({
        domains: CIRCLE_SOURCE,
        solanaPrograms: CIRCLE_SOURCE,
        evmContracts: CIRCLE_SOURCE,
        assets: CIRCLE_SOURCE,
        fees: CIRCLE_SOURCE,
        allowance: CIRCLE_SOURCE,
        recovery: CIRCLE_SOURCE,
      })
      .strict(),
    /* The day every address above was last read off its `sourceRef` page. All
       three chains were re-read together on 2026-09-05, the day Ethereum
       joined; the Base and Solana entries did not change under that read. */
    observedAt: z.literal("2026-09-05"),
  })
  .strict();

export type SolanaCctpRegistry = z.output<typeof SolanaCctpRegistrySchema>;
export type SolanaCctpChain = SolanaCctpRegistry["chains"][keyof SolanaCctpRegistry["chains"]];
export type SolanaCctpChainId = SolanaCctpChain["id"];
export type SolanaCctpEvmChainId = Exclude<SolanaCctpChainId, "solana">;
export type SolanaCctpEvmChain = SolanaCctpRegistry["chains"]["base"] | SolanaCctpRegistry["chains"]["ethereum"];

const SOLANA_PROGRAM_SOURCE = "https://developers.circle.com/cctp/references/solana-programs";
const EVM_CONTRACT_SOURCE = "https://developers.circle.com/cctp/references/contract-addresses";
const ASSET_SOURCE = "https://developers.circle.com/stablecoins/usdc-contract-addresses";

/**
 * The same four contracts on every EVM chain Circle lists for V2.
 *
 * Written once and reused rather than pasted twice: two copies of the same
 * address that could drift is precisely the "looks like shared code and is
 * not" failure the direction module was written against.
 */
const EVM_V2_COMPONENTS = [
  {
    role: "MESSAGE_TRANSMITTER_V2",
    address: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    sourceRef: EVM_CONTRACT_SOURCE,
  },
  {
    role: "TOKEN_MESSENGER_V2",
    address: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    sourceRef: EVM_CONTRACT_SOURCE,
  },
  {
    role: "TOKEN_MINTER_V2",
    address: "0xfd78EE919681417d192449715b2594ab58f5D002",
    sourceRef: EVM_CONTRACT_SOURCE,
  },
  {
    role: "MESSAGE_V2",
    address: "0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78",
    sourceRef: EVM_CONTRACT_SOURCE,
  },
] as const;

export const SOLANA_CCTP_MAINNET_REGISTRY: SolanaCctpRegistry = SolanaCctpRegistrySchema.parse({
  schema: "ryntra.solana.cctp-registry",
  schemaVersion: "1.1.0",
  network: "MAINNET",
  provider: "CIRCLE_CCTP_V2",
  apiOrigin: "https://iris-api.circle.com",
  chains: {
    solana: {
      id: "solana",
      label: "Solana",
      chainRef: "solana:mainnet",
      domain: 5,
      addressFormat: "SOLANA_BASE58",
      asset: {
        symbol: "USDC",
        decimals: 6,
        representation: "NATIVE_USDC",
        address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        assetRef: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        sourceRef: ASSET_SOURCE,
      },
      components: [
        {
          role: "MESSAGE_TRANSMITTER_V2",
          address: "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
          sourceRef: SOLANA_PROGRAM_SOURCE,
        },
        {
          role: "TOKEN_MESSENGER_MINTER_V2",
          address: "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
          sourceRef: SOLANA_PROGRAM_SOURCE,
        },
      ],
      capabilities: {
        standardSource: true,
        fastSource: true,
        forwardingService: true,
        upfrontFees: false,
      },
    },
    base: {
      id: "base",
      label: "Base",
      chainRef: "eip155:8453",
      domain: 6,
      addressFormat: "EVM_HEX",
      asset: {
        symbol: "USDC",
        decimals: 6,
        representation: "NATIVE_USDC",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        assetRef: "eip155:8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        sourceRef: ASSET_SOURCE,
      },
      components: [...EVM_V2_COMPONENTS],
      capabilities: {
        standardSource: true,
        fastSource: true,
        forwardingService: true,
        upfrontFees: true,
      },
    },
    ethereum: {
      id: "ethereum",
      label: "Ethereum",
      chainRef: "eip155:1",
      domain: 0,
      addressFormat: "EVM_HEX",
      asset: {
        symbol: "USDC",
        decimals: 6,
        representation: "NATIVE_USDC",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        assetRef: "eip155:1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        sourceRef: ASSET_SOURCE,
      },
      components: [...EVM_V2_COMPONENTS],
      capabilities: {
        standardSource: true,
        fastSource: true,
        forwardingService: true,
        upfrontFees: true,
      },
    },
  },
  sources: {
    domains: "https://developers.circle.com/cctp/concepts/supported-chains-and-domains",
    solanaPrograms: SOLANA_PROGRAM_SOURCE,
    evmContracts: EVM_CONTRACT_SOURCE,
    assets: ASSET_SOURCE,
    fees: "https://developers.circle.com/cctp/concepts/fees",
    allowance: "https://developers.circle.com/cctp/concepts/fast-transfer-allowance",
    recovery: "https://developers.circle.com/cctp/howtos/retry-failed-mint",
  },
  observedAt: "2026-09-05",
});

/**
 * Every lane, named by its two ends.
 *
 * The Base pair keeps its original names and its place at the front of the
 * list: durable claims, receipts and History rows on production were written
 * under those two literals, and a rename would turn settled transfers into
 * unreadable ones.
 */
export type SolanaCctpDirection = "SOLANA_TO_BASE" | "BASE_TO_SOLANA" | "SOLANA_TO_ETHEREUM" | "ETHEREUM_TO_SOLANA";
export const SOLANA_CCTP_DIRECTIONS: readonly SolanaCctpDirection[] = [
  "SOLANA_TO_BASE",
  "BASE_TO_SOLANA",
  "SOLANA_TO_ETHEREUM",
  "ETHEREUM_TO_SOLANA",
];

export const SOLANA_CCTP_EVM_CHAINS: readonly SolanaCctpEvmChainId[] = ["base", "ethereum"];

export function isSolanaCctpEvmChainId(value: unknown): value is SolanaCctpEvmChainId {
  return typeof value === "string" && (SOLANA_CCTP_EVM_CHAINS as readonly string[]).includes(value);
}

export function verifySolanaCctpRegistry(
  value: unknown,
): Readonly<{ ok: true; registry: SolanaCctpRegistry }> | Readonly<{ ok: false; reason: string }> {
  const parsed = SolanaCctpRegistrySchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues.map((issue) => `${issue.path.join(".") || "registry"}: ${issue.message}`).join(" · "),
    };
  }
  return { ok: true, registry: parsed.data };
}

export function cctpRegistryDigest(value: unknown): string {
  const registry = SolanaCctpRegistrySchema.parse(value);
  return `0x${createHash("sha256")
    .update(`ryntra.solana.cctp-registry.v1\n${canonicalJson(registry)}`, "utf8")
    .digest("hex")}`;
}

/** The EVM chain a lane touches — the one end of it that is not Solana. */
export function solanaCctpEvmChainOf(direction: SolanaCctpDirection): SolanaCctpEvmChainId {
  return direction === "SOLANA_TO_BASE" || direction === "BASE_TO_SOLANA" ? "base" : "ethereum";
}

export type SolanaCctpSolanaSourceDirection = Extract<SolanaCctpDirection, `SOLANA_TO_${string}`>;
export type SolanaCctpEvmSourceDirection = Exclude<SolanaCctpDirection, SolanaCctpSolanaSourceDirection>;

/** The two lane names an EVM chain takes part in, Solana-source first. */
export function solanaCctpDirectionsFor(
  chain: SolanaCctpEvmChainId,
): Readonly<{ fromSolana: SolanaCctpSolanaSourceDirection; toSolana: SolanaCctpEvmSourceDirection }> {
  return chain === "base"
    ? { fromSolana: "SOLANA_TO_BASE", toSolana: "BASE_TO_SOLANA" }
    : { fromSolana: "SOLANA_TO_ETHEREUM", toSolana: "ETHEREUM_TO_SOLANA" };
}

export function solanaCctpEvmChain(chain: SolanaCctpEvmChainId): SolanaCctpEvmChain {
  return SOLANA_CCTP_MAINNET_REGISTRY.chains[chain];
}

/** The registry entry for a Circle domain number, or null for one this product does not know. */
export function solanaCctpChainByDomain(domain: number): SolanaCctpChain | null {
  const { solana, base, ethereum } = SOLANA_CCTP_MAINNET_REGISTRY.chains;
  if (domain === solana.domain) return solana;
  if (domain === base.domain) return base;
  if (domain === ethereum.domain) return ethereum;
  return null;
}

export function solanaCctpLane(direction: SolanaCctpDirection): Readonly<{
  direction: SolanaCctpDirection;
  source: SolanaCctpChain;
  destination: SolanaCctpChain;
}> {
  const registry = SOLANA_CCTP_MAINNET_REGISTRY;
  const evm = registry.chains[solanaCctpEvmChainOf(direction)];
  return direction === "SOLANA_TO_BASE" || direction === "SOLANA_TO_ETHEREUM"
    ? { direction, source: registry.chains.solana, destination: evm }
    : { direction, source: evm, destination: registry.chains.solana };
}

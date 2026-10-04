/**
 * The four x402 implementations, as data.
 *
 * **There is one protocol and one engine.** `x402-engine.ts` owns every
 * decision; this file owns none. A declaration here is a record of what a
 * provider's own documentation says it does, with the URL and the date it was
 * read — never a branch, never a capability, never a claim that Ryntra can
 * reach it.
 *
 * ## Why four axes and not one provider chip
 *
 * Two unrelated systems ship under the name **B402** on BNB Smart Chain.
 *
 * - **Binance B402** — Binance's own implementation of x402, behind
 *   RSA-SHA256-signed requests with an issued `clientId` and an IP allowlist,
 *   with `eip3009` / `permit2-exact` / `permit2-upto` as its
 *   `assetTransferMethod` values and CAIP-2 networks.
 * - **Vistara Labs B402** — an independent open-source relayer with its own
 *   `B402Relayer` contracts, an unauthenticated facilitator, its own network
 *   strings, and a README that states the contracts *"have not been
 *   professionally audited"*.
 *
 * One `B402` label in a receipt attributes a payment to the wrong operator, the
 * wrong trust model and the wrong audit status. That is the same defect class
 * as the three-way `TSLA` collision caught earlier, and the fix is the same:
 * the axes are per surface, and the collapsed label does not exist.
 *
 * So `providerImplementation`, `paymentMethod`, `facilitator` and `network` are
 * four independent fields. The fifth constraint — which assets are permitted on
 * which chain — is **not** here: it belongs to the owner policy, because a
 * provider declaring it *can* move USDT is a different fact from an owner
 * permitting it.
 */

export const PAYMENT_PROTOCOL = "X402" as const;

export type PaymentProtocol = typeof PAYMENT_PROTOCOL;

/**
 * Which implementation of the protocol. Never the bare string `B402`: it is
 * ambiguous in the wild and a test refuses it.
 */
export const PROVIDER_IMPLEMENTATIONS = [
  "BINANCE_B402",
  "VISTARA_B402",
  "COINBASE_X402",
  "SELF_HOSTED_X402",
] as const;

export type ProviderImplementation = (typeof PROVIDER_IMPLEMENTATIONS)[number];

/**
 * How the buyer's authorization is expressed on-chain.
 *
 * The first three mirror Binance's own `assetTransferMethod` values verbatim —
 * `eip3009`, `permit2-exact`, `permit2-upto` — in this repository's screaming
 * case. The fourth is Vistara's relayer signature, which is not an x402 scheme
 * at all: it is a call into that project's own `B402RelayerV2` contract, which
 * is exactly why it needs its own name rather than being folded into one of the
 * three above.
 */
export const PAYMENT_METHODS = [
  "EIP_3009",
  "PERMIT2_EXACT",
  "PERMIT2_UP_TO",
  "VISTARA_RELAYER_EIP712",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Who verifies the signature and submits the transfer. */
export const PAYMENT_FACILITATORS = ["BINANCE", "VISTARA", "COINBASE_CDP", "SELF_HOSTED"] as const;

export type PaymentFacilitator = (typeof PAYMENT_FACILITATORS)[number];

import type { PaymentTrustClass } from "./vocabulary.ts";

/** One asset a provider's own documentation names, with the methods it names for it. */
export type DeclaredAsset = Readonly<{
  /** CAIP-19, the same shape `lib/guard/networks.ts` derives. */
  assetRef: string;
  symbol: string;
  network: string;
  methods: readonly PaymentMethod[];
}>;

export type PaymentImplementationDeclaration = Readonly<{
  id: ProviderImplementation;
  label: string;
  /** The legal or project operator. Two `B402`s, two operators. */
  operator: string;
  /** The hash-pinned registry adapter this implementation resolves through. */
  adapterRef: string;
  /** The action subtype an actual paid request would resolve to. */
  actionRef: string;
  facilitators: readonly PaymentFacilitator[];
  /** CAIP-2 only. A provider's own network spelling is recorded, never used as an id. */
  networks: readonly string[];
  /** How the provider spells each method on the wire, or `null` where it publishes none. */
  wireValueByMethod: Readonly<Partial<Record<PaymentMethod, string>>>;
  /** Only assets whose contract address the source actually publishes. */
  assets: readonly DeclaredAsset[];
  /**
   * The highest trust class this operator's own report can support, before any
   * independent observation. An x402 receipt is a server assertion about an
   * interaction.
   */
  facilitatorTrustCeiling: PaymentTrustClass;
  /** Whether Ryntra can reach it at all today. It cannot, anywhere. */
  ryntraReach: "NONE";
  source: Readonly<{ url: string; observedAt: string }>;
  limitations: readonly string[];
}>;

const BSC_MAINNET = "eip155:56";
const BSC_TESTNET = "eip155:97";

/** CAIP-19, derived rather than typed — the same rule `assetRefFor` follows. */
function erc20(network: string, address: string): string {
  return `${network}/erc20:${address}`;
}

/**
 * Binance B402.
 *
 * Source: `developers.binance.com/docs/onchainpay-x402/introduction.md` and
 * `.../open-apis-v2/1.get-supported-configurations.md`, read 2026-08-24.
 *
 * The asset table is the sharp part. Binance publishes contracts for four
 * tokens on **BSC Mainnet** and states plainly which methods each supports:
 * `eip3009` only exists for the two tokens with native EIP-3009 support. So a
 * request for `EIP_3009` on USDT is not a policy question — the provider says
 * it is impossible — and the engine refuses it by name.
 *
 * The environment table inverts that. Binance says B402 is **live on BSC
 * Testnet** and that mainnet access is granted on request; it publishes no
 * testnet contract table. The network that is live is therefore the one where
 * no asset can be named, and every route on it refuses. That is recorded rather
 * than papered over with mainnet addresses on a testnet chain id.
 */
export const BINANCE_B402: PaymentImplementationDeclaration = Object.freeze({
  id: "BINANCE_B402",
  label: "Binance B402",
  operator: "Binance",
  adapterRef: "adapter:binance-b402@1",
  actionRef: "action:binance-b402/pay-service-request@1",
  facilitators: Object.freeze(["BINANCE"] as const),
  networks: Object.freeze([BSC_MAINNET, BSC_TESTNET]),
  wireValueByMethod: Object.freeze({
    EIP_3009: "eip3009",
    PERMIT2_EXACT: "permit2-exact",
    PERMIT2_UP_TO: "permit2-upto",
  }),
  assets: Object.freeze([
    Object.freeze({
      assetRef: erc20(BSC_MAINNET, "0xcE24439F2D9C6a2289F741120FE202248B666666"),
      symbol: "U",
      network: BSC_MAINNET,
      methods: Object.freeze(["EIP_3009", "PERMIT2_EXACT", "PERMIT2_UP_TO"] as const),
    }),
    Object.freeze({
      assetRef: erc20(BSC_MAINNET, "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d"),
      symbol: "USD1",
      network: BSC_MAINNET,
      methods: Object.freeze(["EIP_3009", "PERMIT2_EXACT", "PERMIT2_UP_TO"] as const),
    }),
    Object.freeze({
      assetRef: erc20(BSC_MAINNET, "0x55d398326f99059fF775485246999027B3197955"),
      symbol: "USDT",
      network: BSC_MAINNET,
      methods: Object.freeze(["PERMIT2_EXACT", "PERMIT2_UP_TO"] as const),
    }),
    Object.freeze({
      assetRef: erc20(BSC_MAINNET, "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"),
      symbol: "USDC",
      network: BSC_MAINNET,
      methods: Object.freeze(["PERMIT2_EXACT", "PERMIT2_UP_TO"] as const),
    }),
  ]),
  facilitatorTrustCeiling: "FACILITATOR_ASSERTION",
  ryntraReach: "NONE",
  source: Object.freeze({
    url: "https://developers.binance.com/docs/onchainpay-x402/introduction",
    observedAt: "2026-08-24",
  }),
  limitations: Object.freeze([
    "Live on BSC Testnet for partner onboarding; production access is granted on request after merchant onboarding. Ryntra holds no clientId, no RSA key and no allowlisted IP, and requests none.",
    "No contract table is published for BSC Testnet, so no asset can be declared on the network that is live. Every testnet route refuses rather than borrowing a mainnet address.",
    "The authenticated surface requires RSA-SHA256-signed requests. Nothing in this repository can produce one, and no endpoint constant is stored.",
  ]),
});

/**
 * Vistara Labs B402 — the other B402.
 *
 * Source: `github.com/Vistara-Labs/b402` `README.md` @ `main`, read 2026-08-24.
 *
 * Its trust ceiling is `UNVERIFIED_ASSERTION` and the reason is structural
 * rather than a judgement of the project: the facilitator is documented as an
 * open API with no authentication, so a report from it cannot be attributed to
 * anyone. The README also states the contracts have not been professionally
 * audited, and it names its facilitator host twice with two different values.
 *
 * Only USDT is declared, because it is the only token whose contract address
 * the source actually prints. USD1 and USDC are named in prose with no address;
 * naming them here without one would invent the fact the engine is supposed to
 * check.
 */
export const VISTARA_B402: PaymentImplementationDeclaration = Object.freeze({
  id: "VISTARA_B402",
  label: "Vistara Labs B402",
  operator: "Vistara Labs",
  adapterRef: "adapter:vistara-b402@1",
  actionRef: "action:vistara-b402/pay-service-request@1",
  facilitators: Object.freeze(["VISTARA"] as const),
  networks: Object.freeze([BSC_MAINNET, BSC_TESTNET]),
  wireValueByMethod: Object.freeze({
    VISTARA_RELAYER_EIP712: "transferWithAuthorization",
  }),
  assets: Object.freeze([
    Object.freeze({
      assetRef: erc20(BSC_MAINNET, "0x55d398326f99059fF775485246999027B3197955"),
      symbol: "USDT",
      network: BSC_MAINNET,
      methods: Object.freeze(["VISTARA_RELAYER_EIP712"] as const),
    }),
  ]),
  facilitatorTrustCeiling: "UNVERIFIED_ASSERTION",
  ryntraReach: "NONE",
  source: Object.freeze({
    url: "https://github.com/Vistara-Labs/b402",
    observedAt: "2026-08-24",
  }),
  limitations: Object.freeze([
    "Its own README states the smart contracts have not been professionally audited.",
    "The facilitator is documented as an open API with no authentication, so its report cannot be attributed to a known party. That is why its trust ceiling is UNVERIFIED_ASSERTION.",
    "It names its networks `bsc` and `bsc-testnet` in one place and `bsc-mainnet` in another, and names two different facilitator hosts. Both spellings are recorded; neither is used as an identifier here, where the id is CAIP-2.",
    "USD1 and USDC are named in prose with no contract address published, so neither is declared.",
    "It is not affiliated with Binance and shares only the name.",
  ]),
});

/**
 * Coinbase x402 — the protocol's reference implementation.
 *
 * Source: `github.com/coinbase/x402` `specs/x402-specification-v2.md` @ `main`,
 * read 2026-08-24.
 *
 * The spec names networks and says EVM support means "ERC-20 tokens
 * implementing EIP-3009 (Transfer with Authorization). Example: USDC". It
 * publishes **no contract addresses**, and it says token availability depends
 * on the facilitator. So this declaration carries networks and no assets, and
 * every route through it refuses at the asset. That is what the primary source
 * supports; filling in a USDC address from memory is precisely the fabrication
 * the four axes exist to prevent.
 */
export const COINBASE_X402: PaymentImplementationDeclaration = Object.freeze({
  id: "COINBASE_X402",
  label: "Coinbase x402",
  operator: "Coinbase / x402 Foundation",
  adapterRef: "adapter:coinbase-x402@1",
  actionRef: "action:coinbase-x402/pay-service-request@1",
  facilitators: Object.freeze(["COINBASE_CDP"] as const),
  networks: Object.freeze([
    "eip155:8453",
    "eip155:84532",
    "eip155:43114",
    "eip155:43113",
    "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  ]),
  wireValueByMethod: Object.freeze({
    EIP_3009: "exact",
  }),
  assets: Object.freeze([]),
  facilitatorTrustCeiling: "FACILITATOR_ASSERTION",
  ryntraReach: "NONE",
  source: Object.freeze({
    url: "https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md",
    observedAt: "2026-08-24",
  }),
  limitations: Object.freeze([
    "The specification publishes no token contract addresses and states that availability depends on the facilitator, so no asset is declared and every route refuses at the asset.",
    "`exact` is the scheme name, not a method name. It is recorded as the wire value for EIP_3009 and is not treated as an identifier of its own.",
    "The Solana side of the `exact` scheme uses TransferChecked rather than EIP-3009 and would need its own method value before any Solana route could resolve. None is declared.",
  ]),
});

/**
 * A facilitator the owner runs themselves.
 *
 * It exists as an axis value so that an operator can declare their own
 * deployment, not so Ryntra can claim one. Nothing is declared, so every route
 * refuses at the network — which is the correct answer for a deployment that
 * does not exist.
 *
 * Its trust ceiling is `UNVERIFIED_ASSERTION` for a reason worth stating: when
 * the resource server also runs the facilitator, the party with the interest is
 * verifying its own payment. That is self-attestation, whoever owns it.
 */
export const SELF_HOSTED_X402: PaymentImplementationDeclaration = Object.freeze({
  id: "SELF_HOSTED_X402",
  label: "Self-hosted x402",
  operator: "The deploying owner",
  adapterRef: "adapter:self-hosted-x402@1",
  actionRef: "action:self-hosted-x402/pay-service-request@1",
  facilitators: Object.freeze(["SELF_HOSTED"] as const),
  networks: Object.freeze([]),
  wireValueByMethod: Object.freeze({}),
  assets: Object.freeze([]),
  facilitatorTrustCeiling: "UNVERIFIED_ASSERTION",
  ryntraReach: "NONE",
  source: Object.freeze({
    url: "https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md",
    observedAt: "2026-08-24",
  }),
  limitations: Object.freeze([
    "Nothing is declared, because nothing is deployed. Every route refuses at the network until an operator declares one.",
    "A resource server that also runs its own facilitator is verifying its own payment, so its report is self-attestation regardless of who owns it.",
  ]),
});

export const PAYMENT_IMPLEMENTATIONS: readonly PaymentImplementationDeclaration[] = Object.freeze([
  BINANCE_B402,
  VISTARA_B402,
  COINBASE_X402,
  SELF_HOSTED_X402,
]);

const BY_ID = new Map(PAYMENT_IMPLEMENTATIONS.map((entry) => [entry.id, entry]));

/** Look one up, or `null`. The engine turns `null` into a named refusal. */
export function paymentImplementation(id: string): PaymentImplementationDeclaration | null {
  return BY_ID.get(id as ProviderImplementation) ?? null;
}

/**
 * The networks and assets one Swap form can name — `RYN-SOL-MONEY-FLOWS-001F`,
 * Unified Swap V1 (Owner decision 2026-09-07).
 *
 * This module is the product's vocabulary, not a provider's: four networks,
 * the assets worth naming outright, and the pairs worth offering first. It is
 * pure and client-safe on purpose: the card and the routes classify with the
 * same table, so the sentence a person reads is the sentence the gate acted on.
 *
 * ## The named pairs stopped being the gate on 2026-09-09
 *
 * Until `RYN-SOL-MONEY-FLOWS-001I` a cross-chain pair existed only if it was
 * one of ten the Owner had written down, and everything else read "Not
 * available for this pair". That list was never the rails' limit — both
 * providers quote arbitrary tokens, verified live — it was ours, from the day
 * the lane opened with four tuples. The Owner removed it: any token to any
 * other, across these networks.
 *
 * So `CROSS_SWAP_TUPLES` is now a **shortlist**, not an allowlist. It is what
 * the surface offers first and what the tests pin; a pair outside it is
 * ordinary, and what decides whether it can be done is the provider that
 * carries its chains and the price a live quote comes back with — never this
 * file. What has not changed: no provider or asset is ever substituted
 * quietly, and an unknown token is refused rather than guessed at.
 *
 * Robinhood Chain joined on 2026-09-09 (`RYN-SOL-MONEY-FLOWS-001H`) and is the
 * first network here that no existing engine could reach: it has no Circle
 * CCTP domain, no USDC, and Mayan does not serve it. It arrives with a second
 * cross-swap provider rather than with a fourth copy of anything — see
 * `CrossSwapProvider` below.
 *
 * The three USDC addresses are repeated from `lib/solana/cctp-registry.ts`
 * rather than imported, so the client bundle does not carry the registry and
 * its schema; `catalog.test.mjs` asserts the two never drift apart. USDG has
 * no entry there at all, because CCTP has nothing to say about it.
 */

/* The one import this vocabulary has: the reserve arithmetic that decides what
   MAX may offer. Also pure and client-safe, and split out because "how much
   does this transaction cost" is a different question from "what is this
   network called". */
import { solanaPreFlightReserveLamports } from "./gas-reserve.ts";

/*
 * The networks Bridge may carry, and what it took for each to be here.
 *
 * Four became seven on 2026-09-10 (Owner: *«Додай наступні мережі тільки після
 * нормального gas/MAX handling»*). Every fact below — chain id, RPC, explorer,
 * native coin, USDC contract and its decimals — is read from Relay's own
 * `/chains`, not typed from memory, and every one of the eight new origin
 * routes was quoted live before the network was added.
 *
 * Two of those live reads changed what got written. **USDC on BNB Chain has
 * eighteen decimals, not six** — reading it as six would misprice every amount
 * by a factor of a million. And **Polygon's POL reports
 * `supportsBridging: false`** while quoting a real executable route as an
 * origin, which is the clearest possible statement that the chain index is
 * metadata and the quote is the gate.
 */
export const SWAP_NETWORKS = ["solana", "base", "ethereum", "arbitrum", "optimism", "polygon", "bnb", "robinhood"] as const;
export type SwapNetwork = (typeof SWAP_NETWORKS)[number];

export const SWAP_NETWORK_META: Readonly<Record<SwapNetwork, { label: string; chainRef: string; addressFormat: "SOLANA_BASE58" | "EVM_HEX" }>> = {
  solana: { label: "Solana", chainRef: "solana:mainnet", addressFormat: "SOLANA_BASE58" },
  base: { label: "Base", chainRef: "eip155:8453", addressFormat: "EVM_HEX" },
  ethereum: { label: "Ethereum", chainRef: "eip155:1", addressFormat: "EVM_HEX" },
  arbitrum: { label: "Arbitrum", chainRef: "eip155:42161", addressFormat: "EVM_HEX" },
  optimism: { label: "Optimism", chainRef: "eip155:10", addressFormat: "EVM_HEX" },
  polygon: { label: "Polygon", chainRef: "eip155:137", addressFormat: "EVM_HEX" },
  bnb: { label: "BNB Chain", chainRef: "eip155:56", addressFormat: "EVM_HEX" },
  robinhood: { label: "Robinhood Chain", chainRef: "eip155:4663", addressFormat: "EVM_HEX" },
};

/**
 * Where a transaction on each EVM network can be read back by anyone.
 *
 * A `Record` over the EVM networks rather than a ternary ending in Etherscan,
 * because that ternary shipped: the first Robinhood Chain swap landed, and its
 * receipt linked the hash to **Ethereum**, where the same hash belongs to a
 * stranger. A receipt that opens somebody else's transaction is worse than one
 * that opens nothing. The compiler now names a new network here or the file
 * does not build.
 *
 * Robinhood Chain publishes its explorer in its own documentation
 * (`docs/vendor/robinhood-chain/pages/connecting.html`, alongside chain id 4663
 * and the mainnet RPC).
 */
export const EVM_EXPLORER_TX: Readonly<Record<Exclude<SwapNetwork, "solana">, string>> = {
  base: "https://basescan.org/tx/",
  ethereum: "https://etherscan.io/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  bnb: "https://bscscan.com/tx/",
  robinhood: "https://robinhoodchain.blockscout.com/tx/",
};

/**
 * The order a person meets the networks in, most-reached-for first.
 *
 * Owner instruction 2026-09-10: *«Не показуй одразу 63 мережі великим списком»*.
 * This is the "popular" half of that — a curated order, not a ranking computed
 * from anything, because a menu that reorders itself between visits is a menu
 * people stop being able to use from memory.
 *
 * Solana is absent on purpose: it is the fixed side of every bridge, so it is
 * never one of the choices.
 */
export const POPULAR_BRIDGE_NETWORKS: readonly SwapNetwork[] = ["base", "ethereum", "arbitrum", "optimism", "polygon", "bnb", "robinhood"];

export function isSwapNetwork(value: unknown): value is SwapNetwork {
  return typeof value === "string" && (SWAP_NETWORKS as readonly string[]).includes(value);
}

/**
 * What a token *is*, across networks. USDC on Solana and USDC on Base are the
 * same economic asset (native Circle USDC on both, per the CCTP registry); SOL
 * and ETH are different assets from everything else. An arbitrary Solana mint
 * is its own asset, named by its mint, so a same-chain pair of two mints is a
 * swap and never a transfer.
 */
export type SwapEconomicAsset = "SOL" | "ETH" | "USDC" | "USDG" | "BNB" | "POL" | `SPL:${string}` | `ERC20:${string}`;

export type SwapCatalogAsset = Readonly<{
  /** Stable id within its network: `SOL`, `ETH`, `USDC`, `USDG`, `BNB`, `POL`. */
  code: "SOL" | "ETH" | "USDC" | "USDG" | "BNB" | "POL";
  network: SwapNetwork;
  symbol: string;
  decimals: number;
  kind: "NATIVE" | "TOKEN";
  /** Mint (Solana) or contract (EVM); the native coin has none. */
  address: string | null;
  economicAsset: SwapEconomicAsset;
  /** The address Jupiter and the Solana wallet use for this asset (wrapped SOL mint for SOL). */
  solanaMint: string | null;
}>;

/** Jupiter and Wallet Standard name native SOL by the wrapped-SOL mint. */
export const SOLANA_NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const ETHEREUM_USDC_CONTRACT = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
/**
 * USDG on Robinhood Chain — Paxos' Global Dollar, the quote asset of Arcus
 * spot. Six decimals, not eighteen: read from Robinhood's own contracts page
 * (`docs/vendor/robinhood-chain/pages/contracts.html`), confirmed by
 * `docs/ARCUS-API.md` and by `lib/arcus/spot.ts`, which has held the identical
 * address since the spot router was verified live. The three agree, and
 * `catalog.test.mjs` keeps them agreeing.
 *
 * There is no USDC on this chain at all, which is the whole reason Robinhood
 * Chain is a swap destination and never a bridge one — see `bridge-routes.ts`.
 */
export const ROBINHOOD_USDG_CONTRACT = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/*
 * USDC on the four networks added on 2026-09-10, each read from Relay's
 * `erc20Currencies` for its chain rather than from memory.
 *
 * `BNB_USDC_DECIMALS` is the one worth staring at: eighteen, not six. Every
 * other USDC in this file is a six-decimal token, and carrying that assumption
 * one network further would have made every BNB amount wrong by 10^12 — a
 * mistake that reads as a working swap right up until somebody sends money.
 */
export const ARBITRUM_USDC_CONTRACT = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
export const OPTIMISM_USDC_CONTRACT = "0x0b2c639c533813f4aa9d7837caf62653d097ff85";
export const POLYGON_USDC_CONTRACT = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
export const BNB_USDC_CONTRACT = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
export const BNB_USDC_DECIMALS = 18;

export const SWAP_CATALOG: readonly SwapCatalogAsset[] = [
  { code: "SOL", network: "solana", symbol: "SOL", decimals: 9, kind: "NATIVE", address: null, economicAsset: "SOL", solanaMint: SOLANA_NATIVE_SOL_MINT },
  { code: "USDC", network: "solana", symbol: "USDC", decimals: 6, kind: "TOKEN", address: SOLANA_USDC_MINT, economicAsset: "USDC", solanaMint: SOLANA_USDC_MINT },
  { code: "ETH", network: "base", symbol: "ETH", decimals: 18, kind: "NATIVE", address: null, economicAsset: "ETH", solanaMint: null },
  { code: "USDC", network: "base", symbol: "USDC", decimals: 6, kind: "TOKEN", address: BASE_USDC_CONTRACT, economicAsset: "USDC", solanaMint: null },
  { code: "ETH", network: "ethereum", symbol: "ETH", decimals: 18, kind: "NATIVE", address: null, economicAsset: "ETH", solanaMint: null },
  { code: "USDC", network: "ethereum", symbol: "USDC", decimals: 6, kind: "TOKEN", address: ETHEREUM_USDC_CONTRACT, economicAsset: "USDC", solanaMint: null },
  { code: "ETH", network: "arbitrum", symbol: "ETH", decimals: 18, kind: "NATIVE", address: null, economicAsset: "ETH", solanaMint: null },
  { code: "USDC", network: "arbitrum", symbol: "USDC", decimals: 6, kind: "TOKEN", address: ARBITRUM_USDC_CONTRACT, economicAsset: "USDC", solanaMint: null },
  { code: "ETH", network: "optimism", symbol: "ETH", decimals: 18, kind: "NATIVE", address: null, economicAsset: "ETH", solanaMint: null },
  { code: "USDC", network: "optimism", symbol: "USDC", decimals: 6, kind: "TOKEN", address: OPTIMISM_USDC_CONTRACT, economicAsset: "USDC", solanaMint: null },
  { code: "POL", network: "polygon", symbol: "POL", decimals: 18, kind: "NATIVE", address: null, economicAsset: "POL", solanaMint: null },
  { code: "USDC", network: "polygon", symbol: "USDC", decimals: 6, kind: "TOKEN", address: POLYGON_USDC_CONTRACT, economicAsset: "USDC", solanaMint: null },
  { code: "BNB", network: "bnb", symbol: "BNB", decimals: 18, kind: "NATIVE", address: null, economicAsset: "BNB", solanaMint: null },
  { code: "USDC", network: "bnb", symbol: "USDC", decimals: BNB_USDC_DECIMALS, kind: "TOKEN", address: BNB_USDC_CONTRACT, economicAsset: "USDC", solanaMint: null },
  { code: "ETH", network: "robinhood", symbol: "ETH", decimals: 18, kind: "NATIVE", address: null, economicAsset: "ETH", solanaMint: null },
  { code: "USDG", network: "robinhood", symbol: "USDG", decimals: 6, kind: "TOKEN", address: ROBINHOOD_USDG_CONTRACT, economicAsset: "USDG", solanaMint: null },
];

export function catalogAssets(network: SwapNetwork): readonly SwapCatalogAsset[] {
  return SWAP_CATALOG.filter((asset) => asset.network === network);
}

/**
 * The assets a network can actually carry, where the provider refuses the rest
 * outright rather than merely lacking liquidity for them.
 *
 * Robinhood Chain is the one network where these differ sharply, and the gap
 * is not a detail. Its token index lists the Stock Tokens — TSLA, NVDA, AAPL,
 * SPY, SGOV and the rest — and its **router refuses every one of them**:
 * `UNSUPPORTED_CURRENCY`, in both directions, on every asset probed
 * 2026-09-09. A surface that offered them because the index knows their names
 * would be promising something no signature could ever produce.
 *
 * So this is a pinned list of what the router accepts, and it is deliberately
 * a different question from whether a route exists right now:
 *
 * - **not on this list** → the asset is refused before anything is quoted,
 *   because the provider will never take it;
 * - **on this list, no route today** → an honest `Unavailable` from the live
 *   quote, because that is a market condition and may change within the hour.
 *
 * `WETH` sits in the second category in one direction: inbound quotes fine,
 * outbound answered `NO_SWAP_ROUTES_FOUND` on the same probe. That is
 * liquidity, not a refusal, so it stays listed and the quote answers for it.
 *
 * Networks with no entry here are unrestricted: their providers take any token
 * the index can describe, which the same probes confirmed.
 */
export const NETWORK_ROUTABLE_ASSETS: Partial<Record<SwapNetwork, readonly string[]>> = {
  robinhood: [
    "0x0000000000000000000000000000000000000000",
    "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    ROBINHOOD_USDG_CONTRACT,
  ],
};

/**
 * Whether a network will carry this asset at all.
 *
 * Takes a catalog code or an address; anything not on a restricted network's
 * list is refused. Pure and client-safe, so the card and the routes answer
 * with the same sentence.
 */
export function assetRoutableOnNetwork(network: SwapNetwork, asset: string): boolean {
  const allowed = NETWORK_ROUTABLE_ASSETS[network];
  if (!allowed) return true;
  const wanted = asset.trim().toLowerCase();
  if (allowed.some((entry) => entry.toLowerCase() === wanted)) return true;
  /* A catalog code names the same thing as its address. */
  const byCode = SWAP_CATALOG.find((entry) => entry.network === network && entry.code === asset);
  if (!byCode) return false;
  const address = (byCode.address ?? "0x0000000000000000000000000000000000000000").toLowerCase();
  return allowed.some((entry) => entry.toLowerCase() === address);
}

const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_CONTRACT = /^0x[0-9a-fA-F]{40}$/;

/**
 * One side of the form as the person named it: a network and an asset.
 *
 * The asset may be a catalog code (`SOL`, `USDC`, `USDG`, `ETH`), a base58
 * mint on Solana, or a `0x` contract on any of the EVM networks. Anything
 * else — a symbol nobody here knows, a malformed address — is not an asset,
 * and says so rather than being guessed into one.
 *
 * A token outside the catalog resolves with `symbol` and `decimals` null.
 * That is deliberate and load-bearing: decimals decide the size of a swap, so
 * they are read from the token index at quote time (`lib/relay/currencies.ts`)
 * rather than defaulted here, where every default would be wrong for some
 * token.
 */
export type SwapSideRef = Readonly<{ network: SwapNetwork; asset: string }>;

export type ResolvedSwapAsset = Readonly<{
  network: SwapNetwork;
  /** Catalog code, or the mint itself for an arbitrary Solana token. */
  asset: string;
  symbol: string | null;
  decimals: number | null;
  economicAsset: SwapEconomicAsset;
  /** The mint Jupiter is asked about; null off Solana. */
  solanaMint: string | null;
  catalog: SwapCatalogAsset | null;
}>;

export function resolveSwapAsset(side: SwapSideRef): ResolvedSwapAsset | null {
  const fromCatalog = SWAP_CATALOG.find((asset) => asset.network === side.network && asset.code === side.asset);
  if (fromCatalog) {
    return {
      network: fromCatalog.network,
      asset: fromCatalog.code,
      symbol: fromCatalog.symbol,
      decimals: fromCatalog.decimals,
      economicAsset: fromCatalog.economicAsset,
      solanaMint: fromCatalog.solanaMint,
      catalog: fromCatalog,
    };
  }
  const wanted = side.asset.trim();
  const shaped = side.network === "solana" ? BASE58_MINT.test(wanted) : EVM_CONTRACT.test(wanted);
  if (!shaped) return null;
  const byAddress = SWAP_CATALOG.find(
    (asset) =>
      asset.network === side.network &&
      (asset.network === "solana"
        ? asset.solanaMint === wanted
        : asset.address !== null && asset.address.toLowerCase() === wanted.toLowerCase()),
  );
  if (byAddress) {
    return {
      network: byAddress.network,
      asset: byAddress.code,
      symbol: byAddress.symbol,
      decimals: byAddress.decimals,
      economicAsset: byAddress.economicAsset,
      solanaMint: byAddress.solanaMint,
      catalog: byAddress,
    };
  }
  if (side.network !== "solana") {
    /* An arbitrary EVM contract. Its economic identity is its own address on
       its own chain: two contracts are never the same asset just because they
       wear the same symbol, which is exactly the confusion that would let a
       cross-chain transfer be offered for a token that has no such rail. */
    return {
      network: side.network,
      asset: wanted,
      symbol: null,
      decimals: null,
      economicAsset: `ERC20:${side.network}:${wanted.toLowerCase()}`,
      solanaMint: null,
      catalog: null,
    };
  }
  const byMint = SWAP_CATALOG.find((asset) => asset.network === "solana" && asset.solanaMint === wanted);
  if (byMint) {
    return {
      network: "solana",
      asset: byMint.code,
      symbol: byMint.symbol,
      decimals: byMint.decimals,
      economicAsset: byMint.economicAsset,
      solanaMint: byMint.solanaMint,
      catalog: byMint,
    };
  }
  /* An arbitrary Solana mint: Jupiter's territory. Decimals and symbol are
     read live by the same-chain quote, never guessed here. */
  return {
    network: "solana",
    asset: side.asset,
    symbol: null,
    decimals: null,
    economicAsset: `SPL:${side.asset}`,
    solanaMint: side.asset,
    catalog: null,
  };
}

/**
 * What a network opens on when somebody switches to it, and what it falls back
 * to when that clashes with the other leg.
 *
 * Two keyed records rather than `network === "solana" ? … : "USDC"`, and the
 * difference is not style. That ternary shipped in the card: **Robinhood Chain
 * has no USDC** — it is the one network here that does not, which is the whole
 * reason it is a swap destination — so choosing its tab handed the form an
 * asset that does not exist on it. `resolveSwapAsset` answered null, the
 * classifier answered `UNKNOWN_ASSET`, and the tab a person had just pressed
 * said *Pick a different asset on one side*, with no balance, no share buttons
 * and no route. The tab looked broken because for that network it was.
 *
 * It lives here rather than in the card because it is a fact about the
 * catalogue — every opening asset must be an asset its network actually has —
 * and `catalog.test.mjs` asserts exactly that, for every network there is.
 */
const NETWORK_OPENING_ASSET: Readonly<Record<SwapNetwork, string>> = {
  solana: SOLANA_NATIVE_SOL_MINT,
  base: "USDC",
  ethereum: "USDC",
  /* Every added chain opens on USDC: it is the asset somebody bringing money to
     Solana is most likely to be holding, and the one whose value needs no
     explaining. The native coin is the alternate. */
  arbitrum: "USDC",
  optimism: "USDC",
  polygon: "USDC",
  bnb: "USDC",
  /* USDG is the point of this lane: it is what Arcus spot is quoted in. */
  robinhood: "USDG",
};

/** The second choice, for when the opening one is already on the other leg. */
const NETWORK_ALTERNATE_ASSET: Readonly<Record<SwapNetwork, string>> = {
  solana: SOLANA_USDC_MINT,
  base: "ETH",
  ethereum: "ETH",
  arbitrum: "ETH",
  optimism: "ETH",
  /* Each chain's own coin, which is not ETH on two of them — and getting this
     wrong offers somebody an asset their wallet does not hold. */
  polygon: "POL",
  bnb: "BNB",
  robinhood: "ETH",
};

/**
 * The asset a leg should open on, given what the other leg already holds.
 *
 * Only a clash on the *same* network is a clash: SOL against Solana USDC is a
 * swap, and USDC on Base against USDC on Solana is a transfer — both are
 * things a person may well be here to do.
 */
export function defaultSwapAssetFor(network: SwapNetwork, other: SwapSideRef | null): string {
  const opening = NETWORK_OPENING_ASSET[network];
  const otherAsset = other ? resolveSwapAsset(other) : null;
  if (!otherAsset || otherAsset.network !== network) return opening;
  const openingAsset = resolveSwapAsset({ network, asset: opening });
  return openingAsset && openingAsset.economicAsset === otherAsset.economicAsset ? NETWORK_ALTERNATE_ASSET[network] : opening;
}

/**
 * Which provider carries a cross-asset pair.
 *
 * Two, and the second is not a preference. Mayan carried every pair V1 shipped
 * with, and it cannot reach Robinhood Chain at all: its token endpoint answers
 * HTTP 500 to `robinhood`, `robinhoodchain` and `rhc` while answering 200 to
 * `base` and `arbitrum` (read 2026-09-09). Circle has no CCTP domain for chain
 * 4663 and there is no USDC on it. LI.FI does list the chain, but for a Solana
 * origin its own answer names `relaydepository` — Relay underneath an extra
 * aggregator. So Relay is not one option among several; it is the rail, and
 * going to it directly removes a hop and a trust layer rather than adding one.
 *
 * A tuple names its provider so nothing has to guess from the networks, and so
 * a pair can never silently move to a provider the Owner did not name for it.
 */
export type CrossSwapProvider = "MAYAN" | "RELAY";

/** The mechanism expected to carry a tuple; the live quote still decides. */
export type CrossSwapRouteMechanism = "SWIFT" | "FAST_MCTP" | "RELAY_DEPOSIT";

/**
 * The four cross-asset pairs the Owner approved on 2026-09-07, by name. Each
 * is exactly one direction; the reverse of a listed pair is not implied.
 */
export type MayanCrossSwapTupleId =
  | "ETHEREUM_ETH_TO_SOLANA_SOL"
  | "SOLANA_SOL_TO_ETHEREUM_ETH"
  | "BASE_USDC_TO_SOLANA_SOL"
  | "SOLANA_SOL_TO_BASE_USDC";

/**
 * The six Robinhood Chain pairs the Owner approved on 2026-09-09, by name.
 *
 * Both of the chain's solver assets, in both directions, against the two
 * Solana assets a person here already holds. USDG is the point of the lane:
 * it is the quote asset of Arcus spot, so this is the way into and out of the
 * money that buys Stock Tokens. Nothing about holding USDG is a claim about
 * being able to buy any particular token — that is the venue's own gate, and
 * `lib/rwa` answers it.
 */
export type RelayCrossSwapTupleId =
  | "SOLANA_SOL_TO_ROBINHOOD_USDG"
  | "ROBINHOOD_USDG_TO_SOLANA_SOL"
  | "SOLANA_USDC_TO_ROBINHOOD_USDG"
  | "ROBINHOOD_USDG_TO_SOLANA_USDC"
  | "ROBINHOOD_ETH_TO_SOLANA_SOL"
  | "SOLANA_SOL_TO_ROBINHOOD_ETH";

/**
 * A pair's id: one of the shortlisted names, or a derived one for any other
 * pair. The template member keeps the written names assignable and readable
 * while admitting `SOLANA_DezXA…_TO_ROBINHOOD_USDG` for a token nobody wrote
 * down — which is every token, now that the list is a shortlist.
 */
export type CrossSwapTupleId = MayanCrossSwapTupleId | RelayCrossSwapTupleId | `${string}_TO_${string}`;

export type CrossSwapTuple = Readonly<{
  id: CrossSwapTupleId;
  provider: CrossSwapProvider;
  from: Readonly<{ network: SwapNetwork; asset: "SOL" | "ETH" | "USDC" | "USDG" }>;
  to: Readonly<{ network: SwapNetwork; asset: "SOL" | "ETH" | "USDC" | "USDG" }>;
  /** Which mechanism is expected to carry it; the quote decides live. */
  expectedRoutes: readonly CrossSwapRouteMechanism[];
}>;

export const MAYAN_CROSS_SWAP_TUPLES: readonly CrossSwapTuple[] = [
  { id: "ETHEREUM_ETH_TO_SOLANA_SOL", provider: "MAYAN", from: { network: "ethereum", asset: "ETH" }, to: { network: "solana", asset: "SOL" }, expectedRoutes: ["FAST_MCTP"] },
  { id: "SOLANA_SOL_TO_ETHEREUM_ETH", provider: "MAYAN", from: { network: "solana", asset: "SOL" }, to: { network: "ethereum", asset: "ETH" }, expectedRoutes: ["SWIFT", "FAST_MCTP"] },
  { id: "BASE_USDC_TO_SOLANA_SOL", provider: "MAYAN", from: { network: "base", asset: "USDC" }, to: { network: "solana", asset: "SOL" }, expectedRoutes: ["FAST_MCTP"] },
  { id: "SOLANA_SOL_TO_BASE_USDC", provider: "MAYAN", from: { network: "solana", asset: "SOL" }, to: { network: "base", asset: "USDC" }, expectedRoutes: ["SWIFT", "FAST_MCTP"] },
];

export const RELAY_CROSS_SWAP_TUPLES: readonly CrossSwapTuple[] = [
  { id: "SOLANA_SOL_TO_ROBINHOOD_USDG", provider: "RELAY", from: { network: "solana", asset: "SOL" }, to: { network: "robinhood", asset: "USDG" }, expectedRoutes: ["RELAY_DEPOSIT"] },
  { id: "ROBINHOOD_USDG_TO_SOLANA_SOL", provider: "RELAY", from: { network: "robinhood", asset: "USDG" }, to: { network: "solana", asset: "SOL" }, expectedRoutes: ["RELAY_DEPOSIT"] },
  { id: "SOLANA_USDC_TO_ROBINHOOD_USDG", provider: "RELAY", from: { network: "solana", asset: "USDC" }, to: { network: "robinhood", asset: "USDG" }, expectedRoutes: ["RELAY_DEPOSIT"] },
  { id: "ROBINHOOD_USDG_TO_SOLANA_USDC", provider: "RELAY", from: { network: "robinhood", asset: "USDG" }, to: { network: "solana", asset: "USDC" }, expectedRoutes: ["RELAY_DEPOSIT"] },
  { id: "ROBINHOOD_ETH_TO_SOLANA_SOL", provider: "RELAY", from: { network: "robinhood", asset: "ETH" }, to: { network: "solana", asset: "SOL" }, expectedRoutes: ["RELAY_DEPOSIT"] },
  { id: "SOLANA_SOL_TO_ROBINHOOD_ETH", provider: "RELAY", from: { network: "solana", asset: "SOL" }, to: { network: "robinhood", asset: "ETH" }, expectedRoutes: ["RELAY_DEPOSIT"] },
];

export const CROSS_SWAP_TUPLES: readonly CrossSwapTuple[] = [...MAYAN_CROSS_SWAP_TUPLES, ...RELAY_CROSS_SWAP_TUPLES];

/** One of the shortlisted pairs, when the person happens to have picked one. */
export function findCrossSwapTuple(from: ResolvedSwapAsset, to: ResolvedSwapAsset): CrossSwapTuple | null {
  return (
    CROSS_SWAP_TUPLES.find(
      (tuple) =>
        tuple.from.network === from.network &&
        tuple.from.asset === from.asset &&
        tuple.to.network === to.network &&
        tuple.to.asset === to.asset,
    ) ?? null
  );
}

/**
 * Which provider carries a pair of networks. Since 2026-09-10: **Relay, always.**
 *
 * Owner decision — *«Bridge = cross-chain, Relay-only… Без Mayan/CCTP у default
 * routing»*. Bridge owns one provider so that it owns one failure and one status
 * model, and so nothing can change rails between the quote and the signature:
 * two rails with different custody shapes would make the signed swap a different
 * swap from the reviewed one.
 *
 * Mayan is not deleted, and its absence is a routing decision rather than a
 * verdict on the rail. It stays compiled, tested and reachable as rollback —
 * `MAYAN_CROSS_SWAP_TUPLES` below is still the record of the four pairs the
 * Owner named for it — and returning it to service is this function and nothing
 * else.
 *
 * The arguments are kept because the signature is the seam that a rollback
 * restores, and a caller that already passes both networks should not have to be
 * rewritten to get them back.
 */
export function crossSwapProviderFor(_from: SwapNetwork, _to: SwapNetwork): CrossSwapProvider {
  return "RELAY";
}

/** How a pair is named in a record, a receipt and a trail. */
function pairSideId(asset: ResolvedSwapAsset): string {
  const network = asset.network.toUpperCase();
  /* A catalog asset by its code, anything else by its own address: two tokens
     that share a symbol must never share an id. */
  const name = asset.catalog ? asset.catalog.code : asset.asset;
  return `${network}_${name}`;
}

/**
 * The pair a person actually chose, derived rather than looked up.
 *
 * Before `RYN-SOL-MONEY-FLOWS-001I` this was a lookup in a ten-row table and a
 * pair outside it did not exist. The table is a shortlist now, so the pair is
 * built from the two sides: same shape as a shortlisted tuple, same `provider`
 * the engine reads, and an `id` that survives into the order record and the
 * receipt. A shortlisted pair keeps its written name, so nothing already
 * stored changes meaning.
 *
 * Null only when the two sides are the same asset on the same network — the
 * one pair that is not a swap in any direction.
 */
export function crossSwapPairFor(from: ResolvedSwapAsset, to: ResolvedSwapAsset): CrossSwapTuple | null {
  if (from.network === to.network && from.economicAsset === to.economicAsset) return null;
  const provider = crossSwapProviderFor(from.network, to.network);
  const shortlisted = findCrossSwapTuple(from, to);
  /* A shortlisted pair keeps its **written name** — that id is in stored order
     records and on issued receipts, and changing it would rename history — but
     never its **provider**: four of the shortlisted tuples name Mayan, and the
     routing decision above is the one that is current. Id from the table,
     provider from the decision. */
  if (shortlisted) return { ...shortlisted, provider, expectedRoutes: provider === "RELAY" ? ["RELAY_DEPOSIT"] : shortlisted.expectedRoutes };
  return {
    id: `${pairSideId(from)}_TO_${pairSideId(to)}` as CrossSwapTupleId,
    provider,
    from: { network: from.network, asset: from.asset as "SOL" | "ETH" | "USDC" | "USDG" },
    to: { network: to.network, asset: to.asset as "SOL" | "ETH" | "USDC" | "USDG" },
    expectedRoutes: provider === "RELAY" ? ["RELAY_DEPOSIT"] : from.network === "solana" ? ["SWIFT"] : ["FAST_MCTP"],
  };
}

/** Raw integer amount → decimal string, exact, no floating point. */
export function formatRawAmount(raw: string | bigint, decimals: number): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  if (value < 0n) throw new RangeError("Amounts are never negative.");
  if (decimals === 0) return value.toString();
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Raw integer amount → what a person reads: exact, then trimmed to at most
 * `maxFraction` decimals (truncated, never rounded up, so a displayed minimum
 * is never more than the signed one). An 18-decimal ETH figure otherwise
 * prints sixteen digits nobody can read.
 */
export function displayRawAmount(raw: string | bigint, decimals: number, maxFraction = 8): string {
  const exact = formatRawAmount(raw, decimals);
  const [whole, fraction = ""] = exact.split(".");
  if (fraction.length <= maxFraction) return exact;
  const trimmed = fraction.slice(0, maxFraction).replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}

/** Decimal string → raw integer string, exact; refuses more digits than the asset has. */
export function parseHumanAmount(text: string, decimals: number): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const whole = match[1];
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return raw.toString();
}

/**
 * What a cross-chain swap must leave behind, on top of the ordinary fee
 * reserve the wallet inventory already withholds.
 *
 * Mayan Swift does not merely sign and send. It opens an order account on
 * Solana and locks that account's rent for the life of the order — every
 * observed Swift quote states 3,000,000 lamports — and the rent is paid from
 * the same lamports the amount is taken from. An amount filled from the whole
 * spendable balance is therefore always short by the rent, and the order
 * cannot be built at all. This is the failure `NATIVE_SOL_FEE_RESERVE_LAMPORTS`
 * was introduced for on Send, one layer further out: the largest amount the
 * product offers must be the largest amount it can sign.
 *
 * On Ethereum the same role is played by gas, which is paid in the very asset
 * being swapped. Like the Solana fee reserve, this figure is deliberately not
 * the fee itself — the fee is unknown until the transaction is built, and a
 * number is needed before anyone has typed anything. It is the allowance that
 * keeps MAX signable.
 */
export const SOLANA_CROSS_SWAP_RENT_RESERVE_LAMPORTS = 3_000_000n;
export const ETHEREUM_CROSS_SWAP_GAS_RESERVE_WEI = 2_000_000_000_000_000n;
/**
 * The same allowance on Robinhood Chain, which is an Arbitrum L2 and costs
 * three orders of magnitude less than Ethereum. Measured rather than guessed,
 * from live Relay quotes on 2026-09-09: the dearest origin is an ERC-20 one,
 * `approve` 76,425 gas plus `deposit` 80,319 at a 262,833,200 wei cap — about
 * 4.1e13 wei, which Relay priced at five cents. A native-ETH origin is 32,432
 * gas, about 8.5e12 wei.
 *
 * 2e14 wei (0.0002 ETH) is roughly five times the dearest observed total. Like
 * the other two constants this is not the fee — the fee is unknown until the
 * transaction is built — it is the headroom that keeps MAX signable. Using
 * Ethereum's figure here would withhold ten times the cost of the transaction
 * from every person who tried to swap their whole balance out.
 */
export const ROBINHOOD_CROSS_SWAP_GAS_RESERVE_WEI = 200_000_000_000_000n;
/**
 * The same allowance on Base, which had none until now.
 *
 * Base ETH reserved nothing, so MAX on a Base-ETH origin offered the whole
 * balance and left not one wei for the gas that same balance has to pay. It was
 * invisible for as long as `BASE_USDC_TO_SOLANA_SOL` was the only Base pair
 * anyone reached — USDC pays its gas out of a different coin — and it became
 * reachable the day any token could be paired with any other.
 *
 * Not measured, and said so rather than implied: Base is an OP-stack L2 whose
 * gas is the same order as Robinhood Chain's, and this is that figure. Like the
 * other three it is headroom rather than a fee — the fee is unknown until the
 * transaction is built — and being generous costs a person a fraction of a cent
 * of unspent balance, while being short costs them the whole swap.
 */
export const BASE_CROSS_SWAP_GAS_RESERVE_WEI = 200_000_000_000_000n;

/**
 * What each EVM network withholds from its **own** coin, keyed rather than
 * chained. A ternary ending in `0n` is how Base came to reserve nothing at all;
 * the compiler now names a new network here or this file does not build.
 */
/*
 * Pre-flight allowances for the four networks added on 2026-09-10, each sized
 * against its own measured origin gas rather than copied from a neighbour.
 *
 * Measured live on 2026-09-10, origin gas the wallet pays on a swap into Solana:
 * Arbitrum $0.0018 native and $0.0042 through an approval, Optimism $0.000003
 * and $0.000004, Polygon $0.0177 and $0.0038, BNB $0.0033 and $0.0075. The
 * allowances below are one to two orders of magnitude above those, which is what
 * a pre-flight guess should be — it is corrected against the built
 * transaction's own cost before anything is signed (`reconcileNativeCost`).
 *
 * Polygon's is denominated in POL and BNB's in BNB, not in ETH. A reserve in the
 * wrong coin is not a conservative reserve, it is a wrong number.
 */
export const ARBITRUM_CROSS_SWAP_GAS_RESERVE_WEI = 200_000_000_000_000n;
export const OPTIMISM_CROSS_SWAP_GAS_RESERVE_WEI = 200_000_000_000_000n;
/** Two POL, against a measured 0.19 POL on the dearest observed origin. */
export const POLYGON_CROSS_SWAP_GAS_RESERVE_WEI = 2_000_000_000_000_000_000n;
/** 0.0005 BNB, about a hundred times the measured cost. */
export const BNB_CROSS_SWAP_GAS_RESERVE_WEI = 500_000_000_000_000n;

const EVM_NATIVE_GAS_RESERVE_WEI: Readonly<Record<Exclude<SwapNetwork, "solana">, bigint>> = {
  base: BASE_CROSS_SWAP_GAS_RESERVE_WEI,
  ethereum: ETHEREUM_CROSS_SWAP_GAS_RESERVE_WEI,
  arbitrum: ARBITRUM_CROSS_SWAP_GAS_RESERVE_WEI,
  optimism: OPTIMISM_CROSS_SWAP_GAS_RESERVE_WEI,
  polygon: POLYGON_CROSS_SWAP_GAS_RESERVE_WEI,
  bnb: BNB_CROSS_SWAP_GAS_RESERVE_WEI,
  robinhood: ROBINHOOD_CROSS_SWAP_GAS_RESERVE_WEI,
};

/**
 * The coin each network charges gas in — which is not ETH on two of them.
 *
 * The reserve used to be gated on `economicAsset === "ETH"`, which was true of
 * every EVM network this product had. Adding Polygon and BNB Chain made it a
 * bug: a native POL or BNB origin would have reserved **nothing**, offered the
 * whole balance to MAX, and produced an amount that could never be signed —
 * exactly the failure the reserve exists to prevent, reintroduced by a hard-coded
 * symbol.
 */
const NETWORK_GAS_ASSET: Readonly<Record<SwapNetwork, SwapEconomicAsset>> = {
  solana: "SOL",
  base: "ETH",
  ethereum: "ETH",
  arbitrum: "ETH",
  optimism: "ETH",
  polygon: "POL",
  bnb: "BNB",
  robinhood: "ETH",
};

/**
 * The largest amount of `asset` a cross-chain swap may offer from `balanceRaw`.
 *
 * Only the network's own coin reserves anything: USDC on Base pays its gas in
 * ETH, from a different balance, so its whole balance stays offerable. When a
 * live quote has stated the rent it is preferred over the constant, so a
 * provider that changes the figure moves this number with it.
 */
/**
 * The **pre-flight** reserve: what MAX holds back before any transaction exists.
 *
 * Deliberately conservative and deliberately not priced here. One measured gas
 * limit is true of one operation on one chain, and multiplying it by one gas
 * price is not the maximum cost on an EIP-1559 chain (base fee plus priority) or
 * on an optimistic rollup (execution plus an L1 data fee that appears in no
 * `gasPrice`). A figure computed that way would be confidently wrong.
 *
 * So this is a guess whose only job is to keep MAX in the region of signable.
 * The real number arrives with the built transaction, and `reconcileNativeCost`
 * corrects the amount once against it — see `gas-reserve.ts`.
 */
export function crossSwapReserveRaw(
  network: SwapNetwork,
  economicAsset: SwapEconomicAsset,
  quotedRentRaw: string | null = null,
): bigint {
  if (network === "solana") {
    /* Only the native coin pays out of itself. An SPL origin is spent whole, and
       whether the wallet can afford the fee is a separate question the built
       transaction answers. */
    if (economicAsset !== "SOL") return 0n;
    return solanaPreFlightReserveLamports(quotedRentRaw, SOLANA_CROSS_SWAP_RENT_RESERVE_LAMPORTS).reserveLamports;
  }
  /* An EVM network pays gas in **its own** coin, so a reserve is owed only when
     the asset being swapped is that coin. Anything else is spent whole, and
     whether the wallet can afford the fee is a separate question the built
     transaction answers. */
  if (economicAsset !== NETWORK_GAS_ASSET[network]) return 0n;
  return EVM_NATIVE_GAS_RESERVE_WEI[network];
}

export function crossSwapOfferableRaw(
  network: SwapNetwork,
  economicAsset: SwapEconomicAsset,
  balanceRaw: string,
  quotedRentRaw: string | null = null,
): string {
  const balance = BigInt(balanceRaw);
  const reserve = crossSwapReserveRaw(network, economicAsset, quotedRentRaw);
  return (balance > reserve ? balance - reserve : 0n).toString();
}

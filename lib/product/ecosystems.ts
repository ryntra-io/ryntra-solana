import type { ProductCapabilityId } from "./capabilities.ts";

/**
 * The ecosystem and venue manifests.
 *
 * This is deliberately **not** the Capability Registry. Canon §12 is explicit
 * that accepting a direction does not create a registry row, and the failure
 * mode it prevents is the one every roadmap page invites: nine chains listed on
 * a site, each implying support nobody built.
 *
 * A manifest records that a direction exists, what kind of thing it is, and —
 * when it cannot be used — the exact reason. `capabilities` is the only link to
 * what is actually shipped, and it is empty for everything that is not.
 *
 * The distinction the whole file exists to hold:
 *
 *   chain_pack     settles. Robinhood Chain, Ethereum, Solana, Stellar.
 *   venue_adapter  quotes and executes. Arcus, Uniswap, 0x, HyperCore.
 *
 * Robinhood Chain is a chain. Arcus is a venue on it. They are one story for a
 * user and two things for the software, and collapsing them is how a product
 * ends up with a second application named after a venue.
 */

export type EcosystemKind = "chain_pack" | "venue_adapter";

/**
 * Deliberately narrower than the capability maturities. A manifest is not a
 * capability: it says whether the direction can be used at all, and the detail
 * lives in the capabilities it names.
 */
export type EcosystemState =
  | "live"
  | "testnet_verified"
  | "read_only"
  | "research";

export type EcosystemManifest = Readonly<{
  id: string;
  name: string;
  kind: EcosystemKind;
  state: EcosystemState;
  /** One line a stranger can read. Factual; never a slogan. */
  role: string;
  /** Registry ids that back this manifest. Empty means nothing is shipped. */
  capabilities: readonly ProductCapabilityId[];
  /**
   * Why it cannot be used further than its state allows. Required for
   * everything that is not `live`, because a listed ecosystem with no stated
   * limit is read as a promise.
   */
  gate: string | null;
  /** The registered task that would advance it, when one exists. */
  advancedBy: string | null;
}>;

export const ECOSYSTEMS: readonly EcosystemManifest[] = [
  /* ------------------------------------------------------------- chains -- */
  {
    id: "robinhood-chain",
    name: "Robinhood Chain",
    kind: "chain_pack",
    state: "live",
    role: "Tokenized-asset settlement. Stock Tokens, market-hours and reference-price evidence.",
    capabilities: ["arcus-spot-rfq", "arcus-account-read", "rwa-risk-pack", "portfolio-heat"],
    /* Corrected 2026-08-23 by `RYN-RHC-001`, in the change that made the old
       sentence false. It said the Stock Token read-only API was "not integrated
       or verified", which was true when written and stopped being true when
       this packet integrated it — working rule 9. What replaces it says exactly
       how far the verification went: the schema is verified against the
       provider's own published documentation, and the only live response this
       repository has ever received from `api.robinhood.com` is a 403. A 200 body
       has not been observed and is not claimed. */
    gate: "Execution is bounded to three registered spot routes. The Stock Token read-only API is integrated and its schema verified against the provider's published documentation, but no successful response has been observed: from a sanctions-restricted jurisdiction it answers 403, which is shown as the venue's own refusal rather than replaced with a value. The testnet chain 46630 is still not verified.",
    /* `null` rather than this packet's own id: pointing at a task that is done
       reads as "already advanced", and the one gate still open here — the
       testnet chain — has no registered task behind it. */
    advancedBy: null,
  },
  {
    id: "ethereum-evm",
    name: "Ethereum / EVM core",
    kind: "chain_pack",
    state: "research",
    /* Rewritten 2026-08-19 against `docs/products/evm.md`. The previous line
       said Base, Arbitrum *and Robinhood Chain* would reuse this core, which
       collapsed two things the canon keeps apart: Robinhood Chain is its own
       manifest row and its own settled venue. The canon's frozen network order
       is Base first, then Ethereum, then Arbitrum, then Optimism. */
    role: "One shared EVM system rather than one application per chain — Base first, then Ethereum, Arbitrum and Optimism, each contributing a chain profile rather than a rebuild.",
    capabilities: [],
    /* The sentence the EVM canon says must not slip. It belongs on the public
       map rather than only in the document, because the failure it prevents is
       a reader assuming that listing ten EVM networks means ten equally safe
       ones. */
    gate: "No adapter exists and nothing in the pack is built. EVM compatibility is not the same security or finality, so each network needs its own chain profile before it can be named as supported.",
    /* Was `RYN-CORE-001` until 2026-08-19 — the *module kernel* packet, which
       defines Module, Asset, DataSource, Scanner and Route interfaces and
       cannot advance this direction at all. A pointer at a task that cannot
       advance a row reads as sequenced work and is worse than none. The
       product canon registered `RYN-EVM-001` for the shared core and
       ChainProfile, and it depends on the packet that corrected this. */
    advancedBy: "RYN-EVM-001",
  },
  {
    id: "starknet",
    name: "Starknet",
    kind: "chain_pack",
    state: "research",
    /* Registered 2026-08-19 from `docs/products/starknet.md`, which answers
       "where does this sit" with *nowhere yet* and names this map as the only
       honest place for it. Private finance is the core the pack was built on,
       and stating it plainly is what stops the row reading as a generic
       "another L2 soon". */
    role: "A private-finance and BTCFi pack: shielded balances and private swaps that still settle to a public receipt with scoped disclosure.",
    capabilities: [],
    /* Two conditions, not one. The canon puts compatibility work first *and*
       makes the workstream itself an owner decision, under the general rule
       that one ecosystem is in active implementation at a time. Naming only
       the technical half would imply the rest is merely scheduled. */
    gate: "No adapter exists and nothing in the pack is built. Two things gate it: v0.15 compatibility work, and an explicit owner decision to open an active Starknet workstream at all — one ecosystem is in active implementation at a time.",
    advancedBy: "RYN-STK-001",
  },
  {
    id: "solana",
    name: "Solana",
    kind: "chain_pack",
    /* `research` until 2026-08-17, held there by "no adapter exists" — a
       sentence RYN-SOL-A1 made false and RYN-SOL-A4 made publicly visible:
       the evidence core, the registry adapter, the preflight and the owner
       policy are shipped, and the Solana workspace reads real mainnet mints
       on the site. M1B finalized one exact ATA-create owner canary and M1 the
       ordinary transfer beside it; the manifest remains `read_only` because
       neither bounded proof opens general execution — both moved exactly what
       their owner approved in their own wallet, and nothing runs unattended.
       Capability rows carry the narrower result. */
    state: "read_only",
    role: "Token-2022 asset semantics: mint identity, issuer powers, transfer-affecting extensions, exact transfer preflight, owner policy, and live read-only venue quotes.",
    capabilities: ["solana-asset-passport", "solana-swap-quote-preview", "solana-cctp-precanary"],
    gate: "Reads are live and read-only, including keyed Jupiter Swap API V2 quotes and Circle CCTP V2 evidence. M1B finalized one exact 0.5 USDC ATA-create transfer. M2 finalized one exact 2.622093 USDC to 0.025621005 SOL action; two RPC reads, a valid signed receipt and a public exact-hash provenance correction support `Swap · OWNER_CANARY_VERIFIED` for that action family only. The chain pack remains read-only globally: every later swap needs a fresh route, Review and wallet signature. M1 finalized one exact 0.5 USDC transfer to a recipient whose account already existed and reconciled MATCHED. Bridge remains RYN-SOL-M3 and Token-2022 remains RYN-SOL-M4. The published evidence-kit repository is an older read-only release and is not claimed to include this M2 verifier correction.",
    advancedBy: "RYN-SOL-M0A",
  },
  {
    id: "stellar",
    name: "Stellar",
    kind: "chain_pack",
    /* `research` until 2026-08-14, and the sentence that held it there was
       "no capability is registered". Six now are, so the state moves with them
       rather than after them — a gate that outlives its own condition is worse
       than no gate. It moves to `testnet_verified` and not further: one
       operation is proven end to end on a public testnet, and mainnet is
       read-only. */
    state: "testnet_verified",
    role: "Issuer controls, trustline requirements, holder rights and eligibility, anchors and the on/off-ramp boundary, path payments, and RWA asset semantics.",
    capabilities: [
      "stellar-asset-passport",
      "stellar-wallet-connect",
      "stellar-testnet-payment-lifecycle",
      "stellar-receipt-verification",
    ],
    gate: "One operation is proven: an owner-signed classic XLM payment on Stellar Testnet, reconciled against the ledger and receipted. Mainnet is read-only and the browser is not permitted to reach it. Policy evaluation and route evidence are registered as planned and not built, which is why every receipt carries policyVersion and routePlanHash as null. Every value-moving operation beyond the proven one carries its own gate.",
    advancedBy: "RYN-STELLAR-006",
  },
  {
    id: "xrpl",
    name: "XRPL",
    kind: "chain_pack",
    state: "research",
    role: "Cross-currency payment paths, issued assets and issuer controls.",
    capabilities: [],
    gate: "Not in the product canon until a governance-class decision adds it. Read-only issued-asset scanning would come first.",
    /* Was `RYN-XRPL-001`, which has never existed in the registry — found by
       the existence check written for `ethereum-evm`'s wrong pointer, on its
       first run. `null` is the honest value and the type already allowed it:
       this row's own gate says XRPL is not in the canon until a
       governance-class decision adds it, so there is no task to name, and
       inventing an id makes an unregistered direction look sequenced. */
    advancedBy: null,
  },

  /* ------------------------------------------------------------- venues -- */
  {
    id: "arcus-spot",
    name: "Arcus Spot",
    kind: "venue_adapter",
    state: "live",
    role: "The current execution provider for supported Robinhood Chain spot routes.",
    capabilities: ["arcus-spot-rfq", "arcus-trade-key-setup"],
    gate: "Wallet-signed RFQ execution covers USDG↔TSLA, USDG↔AAPL and USDG↔AMD only. Every other pair is unsupported, not merely unlisted.",
    advancedBy: "RYN-ARCUS-001",
  },
  {
    id: "arcus-perps",
    name: "Arcus Perps",
    kind: "venue_adapter",
    state: "read_only",
    role: "Perpetuals market data, account reads and paper planning on live data.",
    capabilities: ["arcus-account-read"],
    gate: "No order is ever submitted. Order lifecycle, fills, funding and liquidation semantics must pass canon Gate G2 before anything executes.",
    advancedBy: "RYN-PERP-001",
  },
  {
    id: "uniswap",
    name: "Uniswap v3",
    kind: "venue_adapter",
    state: "read_only",
    role: "Independent on-chain quote comparison against the executing route.",
    capabilities: ["uniswap-quote-comparison"],
    gate: "Quotes only, and honestly: at verification the stock-token v3 pools held no liquidity, which the comparison reports rather than hides. Nothing executes through it.",
    advancedBy: "RYN-ROUTE-001",
  },
  {
    id: "zeroex",
    name: "0x",
    kind: "venue_adapter",
    state: "research",
    role: "A candidate second route on Robinhood Chain, for comparison before anything else.",
    capabilities: [],
    /* Probed live on 2026-08-19 with the founder's key, which replaced "chain
       support is unverified" with a sharper limit. Chain 4663 is supported and
       quotes ordinary pairs; Stock Tokens — the assets this route exists to
       compare — are refused outright. Stating only "no adapter exists" would
       now read as though building one were the remaining work, when the
       remaining work is a decision nobody in this repository can take. */
    gate: "No adapter exists, and the blocker is not chain support. Chain 4663 answers: 0x quotes USDG against the native asset with liquidity available, measured 2026-08-19. Every Stock Token is refused — BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE, 'not authorized for trade due to legal restrictions'. What would change that is 0x's to state and was not verified here; the registry records the condition as an RWA opt-in carrying compliance and geofencing responsibility, which is a founder and legal decision. Until it is taken, a second route covers crypto pairs and none of the tokenized equities the comparison exists for. The first engineering step after it remains a non-broadcast quote canary — no production switch, fee, signature or funds action.",
    advancedBy: "RYN-ROUTE-001",
  },
  {
    id: "hypercore",
    name: "Hyperliquid HyperCore",
    kind: "venue_adapter",
    state: "research",
    role: "A professional perpetuals venue. HyperCore is the venue; HyperEVM would be a separate chain pack and is not this.",
    capabilities: [],
    gate: "A read-only adapter exists behind the venue seam and was live-probed, but no user surface ships it. Builder-code economics stay off until disclosure, revocability, a fee cap and legal review all pass.",
    advancedBy: "RYN-VENUE-001",
  },
];

export function ecosystemById(id: string): EcosystemManifest | undefined {
  return ECOSYSTEMS.find((entry) => entry.id === id);
}

export function ecosystemsOfKind(kind: EcosystemKind): readonly EcosystemManifest[] {
  return ECOSYSTEMS.filter((entry) => entry.kind === kind);
}

/**
 * Whether a manifest may render an action.
 *
 * A research row gets no button. That is the rule canon §7 of the addendum asks
 * for in as many words — no active execution CTA for research, no implied
 * partnership, no "coming soon" — and it is enforced here rather than
 * remembered per page.
 */
export function isSelectable(entry: EcosystemManifest): boolean {
  return entry.state !== "research" && entry.capabilities.length > 0;
}

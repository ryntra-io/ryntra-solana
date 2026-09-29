import type { UserAccess } from "../domain/capability.ts";
import { ROUTES, type RouteId } from "../domain/ids.ts";
import { ROUTE_CAPABILITIES } from "../domain/registry.ts";

export const CAPABILITY_MATURITIES = [
  "live",
  /**
   * Proven end to end on a public testnet, for one exact operation.
   *
   * This existed on the website before it existed here, which is how four
   * surfaces once ended up with a hard-coded `fixedState` and no registry entry
   * behind them: the registry had no maturity that meant "real, reconciled, and
   * not mainnet", so the page asserted it directly and skipped the freshness
   * gate every other claim passes through. It is a maturity, not a label.
   */
  "testnet",
  "paper",
  "preview",
  "planned",
  "after_gate",
] as const;

/** @deprecated Prefer CAPABILITY_MATURITIES. Kept for the migration boundary. */
export const CAPABILITY_STATUSES = CAPABILITY_MATURITIES;

export type CapabilityMaturity = (typeof CAPABILITY_MATURITIES)[number];
/** @deprecated Prefer CapabilityMaturity. */
export type CapabilityStatus = CapabilityMaturity;

/** Maturity says whether a capability is shipped. Mode says what it can do. */
export type CapabilityMode =
  | "none"
  | "read_only"
  | "paper_only"
  /**
   * Execution that really happened, on a network whose assets have no intended
   * monetary value. It is deliberately not `supported_live`: that mode is
   * reserved for moving real value, and exactly one capability holds it.
   */
  | "testnet_execution"
  | "supported_live";

export type CapabilityEvidenceState =
  | "fresh"
  | "stale"
  | "unknown"
  | "conflicting";

export type CapabilityTruthTone =
  | "positive"
  | "caution"
  | "danger"
  | "neutral";

/**
 * The four status axes, plus enforcement — Agent Control canon v5.2 §9.
 *
 * `maturity` alone cannot describe a capability. There is no single word for
 * "proven by tests, not on mainnet, and shown publicly as a preview", so a
 * registry with one axis forces a page to pick the flattering half. These are
 * separate questions and they stay separate values:
 *
 *   verification — how well is it proven?
 *   availability — who can see it?
 *   environment  — where does it run?
 *   health       — how is it right now?
 *   enforcement  — who actually stops the action?
 *
 * `maturity` above is kept as the shipped-or-not summary the rest of the
 * repository already reads; these add the axes it cannot express.
 */
export const CAPABILITY_VERIFICATIONS = [
  "PLANNED",
  "BUILDING",
  "INTERNAL_VERIFIED",
  "EXTERNAL_VALIDATED",
  "PRODUCTION_VERIFIED",
] as const;

export const CAPABILITY_AVAILABILITIES = [
  "HIDDEN",
  "INTERNAL",
  "PRIVATE_PREVIEW",
  "PUBLIC_PREVIEW",
  "GA",
] as const;

export const CAPABILITY_ENVIRONMENTS = ["MOCK", "CI", "TESTNET", "MAINNET", "PRODUCTION"] as const;

export const CAPABILITY_HEALTHS = ["UNKNOWN", "HEALTHY", "DEGRADED", "OUTAGE"] as const;

/**
 * Who technically stops the action. Canon forbids the short forms
 * (`PROVIDER_ENFORCED`, `WALLET_ENFORCED`, `CONTRACT_ENFORCED`) — a rule named
 * where the vocabulary lives, so a future edit cannot reintroduce them quietly.
 */
export const CAPABILITY_ENFORCEMENTS = [
  "OBSERVE_ONLY",
  "RYNTRA_GATEWAY_ENFORCED",
  "PROVIDER_NATIVE_ENFORCED",
  "WALLET_NATIVE_ENFORCED",
  "SMART_CONTRACT_ENFORCED",
] as const;

export type CapabilityVerification = (typeof CAPABILITY_VERIFICATIONS)[number];
export type CapabilityAvailability = (typeof CAPABILITY_AVAILABILITIES)[number];
export type CapabilityEnvironment = (typeof CAPABILITY_ENVIRONMENTS)[number];
export type CapabilityHealth = (typeof CAPABILITY_HEALTHS)[number];
export type CapabilityEnforcement = (typeof CAPABILITY_ENFORCEMENTS)[number];

export type CapabilityAxes = {
  verification: CapabilityVerification;
  availability: CapabilityAvailability;
  environment: CapabilityEnvironment;
  health: CapabilityHealth;
  enforcement: CapabilityEnforcement;
  /**
   * Routes that can reach the same effect without passing through the declared
   * enforcement point. An empty array is a claim that none exist, so it is only
   * correct when that was checked; "we have not looked" is `["UNKNOWN"]`.
   */
  knownBypass: readonly string[];
};

export type PublicCapabilitySurface =
  | "landing"
  | "methodology"
  | "demo"
  | "cabinet"
  | "strategy_lab"
  | "agent_control";

export type CapabilityProviderId = "arcus" | "uniswap" | "hyperliquid" | "stellar" | "solana" | "agentverse";

/**
 * Who a capability depends on. `Id` widens for a registry kept beside this one
 * (rows registered elsewhere use the same shape and are read through the same
 * freshness and truth functions below).
 */
export type CapabilityProvider<Id extends string = CapabilityProviderId> = {
  /**
   * `chain` is not a venue. A chain settles; Arcus quotes and executes.
   * Collapsing the two is the mistake canon §7 exists to prevent, and a
   * registry that can only name venues forces a chain pack to masquerade as one.
   */
  kind: "venue" | "protocol" | "chain" | "platform";
  id: Id;
  label: string;
};

export type PublicCapabilityEvidence = {
  id: string;
  kind: "product_surface" | "official_source";
  label: string;
  /** A public URL or public route; never a repository path. */
  reference: string;
};

export type InternalCapabilityEvidence = {
  id: string;
  kind: "production" | "code" | "test" | "task" | "decision";
  /** Repository-local evidence. It must never be rendered as a public link. */
  reference: string;
};

export type CapabilityFreshness = {
  /** A claim is re-evaluated from its date at read time, not trusted forever. */
  policy: "rolling_review";
  maxAgeDays: number;
  /** The state established at review time. Age and route drift can downgrade it. */
  state: CapabilityEvidenceState;
  basis: "route_and_product" | "product_code_and_tests" | "roadmap_and_task";
};

export type CapabilityFailClosed = {
  on: readonly (
    | "unknown_scope"
    | "stale_evidence"
    | "conflicting_evidence"
    | "data_unavailable"
    | "route_unavailable"
    | "user_ineligible"
    | "authorization_missing"
    | "feature_disabled"
    | "gate_incomplete"
  )[];
  behavior: string;
  recovery: string;
};

export type CapabilityAuthority = {
  authorization:
    | "none"
    | "wallet_signature"
    | "human_plan_approval"
    | "future_scoped_mandate";
  custody: "non_custodial" | "not_applicable";
  withdrawalAuthority: false;
};

export type ProductCapabilityId =
  /* Stellar, registered 2026-08-14. Separate rows because reading an asset,
     connecting a wallet, settling a payment and verifying a receipt are
     different operations over different code, and one row would let any of
     them borrow another's proof. The two unbuilt rows are
     here deliberately — a reviewer who can see the named gap trusts the four
     shipped rows more, and `policyVersion: null` in every receipt this product
     writes needs a record to point at. */
  | "stellar-asset-passport"
  | "stellar-wallet-connect"
  | "stellar-testnet-payment-lifecycle"
  | "stellar-receipt-verification"
  | "stellar-route-evidence"
  | "stellar-policy-evaluation"
  /* The Solana line's records: the read-only Asset Passport, the keyed V2
     swap quote preview, and the read-only CCTP pre-canary architecture. Each
     is separate because a quote, a mint read and a bridge review prove
     different effects; none borrows authority from another. */
  | "solana-asset-passport"
  | "solana-swap-quote-preview"
  | "solana-cctp-precanary"
  | "agent-control-intent"
  | "agent-control-preflight"
  | "agent-decision-passport-preview"
  | "agent-launch-public-read"
  | "bnb-apex-read-observer"
  | "agentverse-public-passport"
  | "agentverse-discovery"
  | "bnb-agent-job-lifecycle"
  | "arcus-spot-rfq"
  | "arcus-account-read"
  | "uniswap-quote-comparison"
  | "arcus-trade-key-setup"
  | "supported-route-readiness"
  | "rwa-risk-pack"
  | "telegram-daily-recap"
  | "smarttrade-plan"
  | "decision-journal"
  | "strategy-lab-v1"
  | "complete-decision-loop"
  | "multi-venue-overlay"
  | "personal-workspace"
  | "portfolio-heat"
  | "complete-portfolio-risk"
  | "risk-readiness-scanner"
  | "replay-robustness"
  | "pro-order-flow"
  | "guarded-automation"
  | "sequencer-monitoring";

export type PublicCapability<Id extends string = ProductCapabilityId> = {
  id: Id;
  label: string;
  maturity: CapabilityMaturity;
  mode: CapabilityMode;
  scope: {
    provider: CapabilityProvider<string> | null;
    route: RouteId | null;
    venues: readonly string[];
    assets: readonly string[];
  };
  evidence: {
    public: readonly PublicCapabilityEvidence[];
    internal: readonly InternalCapabilityEvidence[];
  };
  /** YYYY-MM-DD: last review of this exact Ryntra claim, not provider uptime. */
  lastVerifiedAt: string;
  freshness: CapabilityFreshness;
  publicLabel: string;
  limitation: string;
  failClosed: CapabilityFailClosed;
  authority: CapabilityAuthority;
  publicSurfaces: readonly PublicCapabilitySurface[];
  /**
   * Optional on purpose. Forty-odd entries predate the axes, and requiring them
   * everywhere at once would mean editing every claim in one pass — which is
   * how a status ends up copied rather than checked. Entries without them read
   * through `capabilityAxes()`, which derives the *conservative* value from
   * maturity and never invents an enforcement stronger than observation.
   */
  axes?: CapabilityAxes;
};

const ARCUS: CapabilityProvider = {
  kind: "venue",
  id: "arcus",
  label: "Arcus",
};

const UNISWAP: CapabilityProvider = {
  kind: "protocol",
  id: "uniswap",
  label: "Uniswap",
};

/**
 * One provider for both Stellar networks, and the network named per record.
 *
 * The Asset Passport reads mainnet and the proven payment lifecycle is
 * testnet, so a label that fixed one network would make half these records lie
 * in the place a reader looks first.
 */
const STELLAR: CapabilityProvider = {
  kind: "chain",
  id: "stellar",
  label: "Stellar",
};

/* One provider, and after the Mainnet Canon v5.0 it means one network: every
   Solana capability this registry carries reads Solana mainnet, and every one
   that will ever move value opens on mainnet through its own owner canary.
   The label still fixes no network, because each record names its own — that
   convention outlives the two-network reason it was written for. */
const SOLANA: CapabilityProvider = {
  kind: "chain",
  id: "solana",
  label: "Solana",
};

const AGENTVERSE: CapabilityProvider = {
  kind: "platform",
  id: "agentverse",
  label: "Agentverse",
};

/**
 * Re-verified 2026-08-08 against live sources, not extended by editing a date.
 *
 * Arcus spot RFQ router returned 118 tokens on chain 4663 with USDG, TSLA, AAPL
 * and AMD at exactly the addresses `lib/arcus/spot-exec-policy.ts` pins;
 * Robinhood Chain answered `eth_chainId` 0x1237 at block 30578158; the Arcus
 * spot indexer and both perps REST hosts answered; Uniswap v3 QuoterV2 and
 * Factory both carry bytecode on 4663.
 *
 * The previous value, 2026-07-19, was eleven days from expiring — and the route
 * registry it also checks was three days from it, which would have flipped
 * every executable claim on the site to `Re-verifying` on 2026-08-11.
 */
export const VERIFIED_AT = "2026-08-08";

/**
 * Stellar's own review date, and the reason this file now has two.
 *
 * `lastVerifiedAt` means the last review of *this exact Ryntra claim*. On
 * 2026-08-08 there was no Stellar claim to review — the adapter did not exist.
 * Giving these records the Arcus date would be the "extended by editing a
 * date" move the note above forbids, and re-stamping the Arcus rows with
 * today would claim a live re-probe that did not happen. Two dates is what is
 * true, so the registry carries two and the surfaces that quote a review date
 * read them from here rather than assuming one.
 *
 * Verified 2026-08-14: the Passport, the wallet connection, the receipt
 * verifier and the signed testnet lifecycle all answered on the deployed site,
 * and the lifecycle's transaction was re-read from the ledger independently of
 * its own receipt.
 */
const STELLAR_VERIFIED_AT = "2026-08-14";

/* Solana's own review date, same rule: `lastVerifiedAt` is the last review of
   this exact Ryntra claim, and the Solana claim first existed — and was
   verified against live mainnet reads on the rendered workspace — on the day
   RYN-SOL-A4 shipped. */
const SOLANA_VERIFIED_AT = "2026-08-27";

/** First exact review of the source-built Agent Control slice. */
const AGENT_CONTROL_VERIFIED_AT = "2026-08-14";

export const LIVE_FRESHNESS: CapabilityFreshness = {
  policy: "rolling_review",
  maxAgeDays: 30,
  state: "fresh",
  basis: "product_code_and_tests",
};
const ROUTE_FRESHNESS: CapabilityFreshness = {
  policy: "rolling_review",
  maxAgeDays: 30,
  state: "fresh",
  basis: "route_and_product",
};
const ROADMAP_FRESHNESS: CapabilityFreshness = {
  policy: "rolling_review",
  maxAgeDays: 90,
  state: "fresh",
  basis: "roadmap_and_task",
};

export const NO_AUTHORITY: CapabilityAuthority = {
  authorization: "none",
  custody: "not_applicable",
  withdrawalAuthority: false,
};

export const PLAN_AUTHORITY: CapabilityAuthority = {
  authorization: "human_plan_approval",
  custody: "not_applicable",
  withdrawalAuthority: false,
};

const INTERNAL_TASK: InternalCapabilityEvidence = {
  id: "ryn-ux-000-task",
  kind: "task",
  reference: "docs/tasks/active/RYN-UX-000.md",
};

/**
 * Stellar — four shipped rows and two that are not.
 *
 * The unbuilt pair is not padding. `/stellar` states what is planned as well as
 * what works, and the alternative to a record is prose on a page, which is
 * exactly the drift `RYN-CAP-001` was opened to close: four surfaces once
 * asserted a state the registry had no way to express, and skipped the freshness
 * gate every other claim passes through.
 */
const STELLAR_CAPABILITIES = [
  {
    id: "stellar-asset-passport",
    label: "Stellar Asset Passport",
    maturity: "live",
    mode: "read_only",
    scope: { provider: STELLAR, route: null, venues: [], assets: ["USTRY", "CETES", "USDC", "EURC"] },
    evidence: {
      public: [
        {
          id: "stellar-passport-ustry",
          kind: "product_surface",
          label: "Etherfuse USTRY Asset Passport",
          reference:
            "/stellar/workspace/assets/USTRY%3AGCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC",
        },
      ],
      internal: [
        { id: "stellar-passport-code", kind: "code", reference: "lib/stellar issuer, trustline and SEP-1 reads" },
        { id: "stellar-passport-tests", kind: "test", reference: "lib/stellar adapter suite and the passport route tests" },
        { id: "stellar-passport-task", kind: "task", reference: "RYN-STELLAR-004" },
      ],
    },
    lastVerifiedAt: STELLAR_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Live · read-only Stellar Mainnet asset and issuer evidence",
    limitation:
      "Reads public Stellar Mainnet ledger state and the issuer's own SEP-1 stellar.toml. Issuer-declared fields are the issuer describing itself and are unverified by Ryntra; no issuer API is called and no Etherfuse integration exists. There is no score, no rating and no recommendation, and a section whose source fails renders UNAVAILABLE with its reason rather than a default. Price and liquidity are not wired.",
    failClosed: {
      on: ["data_unavailable", "stale_evidence", "conflicting_evidence", "unknown_scope"],
      behavior:
        "A source that fails costs only its own section, which states why it is unavailable; an asset identified by code alone is a 404 rather than a guess at which issuer was meant.",
      recovery:
        "Re-read the ledger, or open the asset by its exact CODE:ISSUER identity; nothing is served from a cached default.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology"],
  },
  {
    id: "stellar-wallet-connect",
    label: "Freighter Connect wallet connection",
    maturity: "live",
    mode: "read_only",
    scope: { provider: STELLAR, route: null, venues: [], assets: ["XLM"] },
    evidence: {
      public: [
        {
          id: "stellar-wallet-surface",
          kind: "product_surface",
          label: "Stellar Hub sending surface",
          reference: "/stellar/workspace/send",
        },
      ],
      internal: [
        { id: "stellar-wallet-code", kind: "code", reference: "the Freighter adapter behind Ryntra's wallet port" },
        { id: "stellar-wallet-tests", kind: "test", reference: "wallet adapter and network-guard suites" },
        { id: "stellar-wallet-task", kind: "task", reference: "RYN-STELLAR-008 wallet layer" },
      ],
    },
    lastVerifiedAt: STELLAR_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Live · connection, address and network through the official Freighter client",
    limitation:
      "Connection, public address and network detection through the official @stellar/freighter-api client, behind a provider-neutral adapter. It never requests a key or a seed phrase and by itself signs nothing; signing belongs to the payment lifecycle record and is refused outside Stellar Testnet. With no extension installed most of the wallet API never settles, so every call is raced against a timeout rather than awaited.",
    failClosed: {
      on: ["feature_disabled", "authorization_missing", "data_unavailable", "route_unavailable"],
      behavior:
        "No extension, a refused connection or the wrong network renders the disconnected or wrong-network state by name instead of a partly-live surface.",
      recovery:
        "Install or unlock Freighter, switch it to the network the surface declares, and reconnect; Ryntra stores no wallet state on a server.",
    },
    authority: {
      authorization: "none",
      custody: "non_custodial",
      withdrawalAuthority: false,
    },
    publicSurfaces: ["methodology"],
  },
  {
    id: "stellar-testnet-payment-lifecycle",
    label: "Stellar Testnet payment lifecycle",
    maturity: "testnet",
    mode: "testnet_execution",
    scope: { provider: STELLAR, route: null, venues: [], assets: ["XLM"] },
    evidence: {
      public: [
        {
          id: "stellar-lifecycle-explorer",
          kind: "official_source",
          label: "Stellar Testnet transaction",
          reference:
            "https://stellar.expert/explorer/testnet/tx/1cf2324346b95d8b350f8316e5aec76063bc827c45819bb7d8cecd4c1a45c95c",
        },
      ],
      internal: [
        { id: "stellar-lifecycle-code", kind: "code", reference: "the Stellar preflight, submission boundary and reconciliation modules" },
        { id: "stellar-lifecycle-tests", kind: "test", reference: "Stellar transaction, reconciliation and receipt suites" },
        { id: "stellar-lifecycle-run", kind: "production", reference: "owner-signed run 1cf23243… ledger 4,126,028, reconciled MATCHED" },
      ],
    },
    lastVerifiedAt: STELLAR_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Testnet verified · one owner-signed classic XLM payment",
    limitation:
      "One owner-signed classic XLM payment on Stellar Testnet: transaction 1cf23243…, ledger 4,126,028, closed 2026-08-13, txSuccess and paymentSuccess, reconciled MATCHED across four checks with balances moving exactly as authorized. Ryntra holds no key — the signature happens inside the owner's wallet and the submission goes from the browser to the public Stellar endpoint. Mainnet is not claimed and no other operation, asset or amount is proven. The submission path's ERROR branch is still unobserved: every refusal so far happened at the ledger, not at submission.",
    failClosed: {
      on: ["authorization_missing", "data_unavailable", "gate_incomplete", "conflicting_evidence"],
      behavior:
        "The write boundary takes the cleared comparison verdict rather than signed bytes, so a transaction that skipped the comparison has no way in; a payment to an account that does not exist is refused before a signature is spent, and a fee-bumped transaction is refused by name.",
      recovery:
        "Correct the refused action and authorize again; an uncertain submission is reconciled by transaction hash from the ledger, never re-sent.",
    },
    authority: {
      authorization: "wallet_signature",
      custody: "non_custodial",
      withdrawalAuthority: false,
    },
    publicSurfaces: ["methodology"],
  },
  {
    id: "stellar-receipt-verification",
    label: "Stellar decision receipt and public verifier",
    maturity: "testnet",
    mode: "read_only",
    scope: { provider: STELLAR, route: null, venues: [], assets: ["XLM"] },
    evidence: {
      public: [
        {
          id: "stellar-verifier-surface",
          kind: "product_surface",
          label: "Receipt verifier",
          reference: "/stellar/workspace/receipts",
        },
      ],
      internal: [
        { id: "stellar-receipt-code", kind: "code", reference: "the canonicalizer, hash chain and verifier modules" },
        { id: "stellar-receipt-tests", kind: "test", reference: "receipt canonicalization, chain and verifier suites" },
        { id: "stellar-receipt-run", kind: "production", reference: "receipt for 1cf23243… verified CONFIRMED, six findings, from a minified document" },
      ],
    },
    lastVerifiedAt: STELLAR_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Testnet verified · receipt recomputed and the ledger re-read by anyone",
    limitation:
      "A receipt chains intent, authorization, transaction, effects and itself, and anyone can recompute every link and re-read the ledger without trusting Ryntra. Verdicts are CONFIRMED, ALTERED and UNCONFIRMED — UNCONFIRMED means nothing contradicted the document, not that it is true. Every receipt this product currently writes carries policyVersion and routePlanHash as null with the reason named, because policy evaluation and route evidence are not built.",
    failClosed: {
      on: ["data_unavailable", "conflicting_evidence", "stale_evidence"],
      behavior:
        "A document whose hashes do not recompute is reported ALTERED rather than accepted, and a ledger that cannot be re-read yields UNCONFIRMED rather than a pass.",
      recovery:
        "Re-run the verification against the ledger; a receipt that disagrees with the chain is evidence of the disagreement, not of the payment.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology"],
  },
  {
    id: "stellar-route-evidence",
    label: "Stellar route and liquidity evidence",
    maturity: "planned",
    mode: "none",
    scope: { provider: STELLAR, route: null, venues: [], assets: ["XLM"] },
    evidence: {
      public: [],
      internal: [
        { id: "stellar-route-task", kind: "task", reference: "RYN-STELLAR-005" },
        { id: "stellar-route-decision", kind: "decision", reference: "Soroswap Routing API selected as the route-evidence building block" },
      ],
    },
    lastVerifiedAt: STELLAR_VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "Planned · not integrated",
    limitation:
      "No route provider is called and no quote is fetched. When it lands it produces evidence only — a normalized route plan with expected output, minimum output, price impact, fees, expiry, provider and conflicting quotes. Ryntra builds no router and executes nothing on it, and until it exists every receipt carries routePlanHash as null with that reason.",
    failClosed: {
      on: ["gate_incomplete", "data_unavailable", "feature_disabled"],
      behavior:
        "Route and liquidity sections state that the provider is not integrated instead of rendering an empty panel or a placeholder quote.",
      recovery:
        "None available to a user; the capability ships as its own task and no surface may imply it earlier.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology"],
  },
  {
    id: "stellar-policy-evaluation",
    label: "Stellar policy evaluation",
    maturity: "planned",
    mode: "none",
    scope: { provider: STELLAR, route: null, venues: [], assets: ["XLM"] },
    evidence: {
      public: [],
      internal: [
        { id: "stellar-policy-task", kind: "task", reference: "RYN-STELLAR-006" },
        { id: "stellar-policy-receipt", kind: "production", reference: "every Stellar receipt written so far carries policyVersion: null and names this row as the reason" },
      ],
    },
    lastVerifiedAt: STELLAR_VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "Planned · not built",
    limitation:
      "No owner-defined policy can be evaluated against a Stellar action yet. The deterministic BLOCK or REVIEW with reason codes over issuer controls, trustline state, oracle freshness, concentration and size is registered work and not shipped, so no surface may describe a Stellar decision as policy-checked. What exists instead is a preflight that refuses an action the ledger would reject, which is a different and narrower thing.",
    failClosed: {
      on: ["gate_incomplete", "authorization_missing", "feature_disabled"],
      behavior:
        "Receipts record policyVersion as null with the reason named rather than omitting the field, because a field absent from a receipt reads as a field removed from one.",
      recovery:
        "None available to a user; the capability ships as its own task and no receipt may imply a policy version it never had.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology"],
  },
] as const;

/*
 * Agent Control is registered as what exists, not as the network it may one
 * day reach. Three rows are source-built preview contracts, three are bounded
 * read-only preview adapters, and two preserve the exact external gates.
 * Agentverse, Agent Launch, ERC-8183 and BNB provider capability never promotes
 * Ryntra maturity by association.
 */
const SOLANA_CAPABILITIES = [
  {
    id: "solana-asset-passport",
    label: "Solana Asset Passport",
    maturity: "live",
    mode: "read_only",
    /* The six live-captured fixture mints are the verified set; the surface
       reads any mainnet mint, which the limitation states rather than the
       scope implying an index. */
    scope: { provider: SOLANA, route: null, venues: [], assets: ["PYUSD", "BERN", "USDC", "USDT", "BONK", "SOL"] },
    evidence: {
      public: [
        {
          id: "solana-passport-pyusd",
          kind: "product_surface",
          label: "PayPal USD (PYUSD) Solana Asset Passport",
          reference: "/solana/workspace/assets?mint=2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
        },
      ],
      internal: [
        { id: "solana-passport-code", kind: "code", reference: "lib/solana mint, extension and passport reads" },
        {
          id: "solana-passport-tests",
          kind: "test",
          reference: "lib/solana fixture suite over six live-captured mainnet mints",
        },
        { id: "solana-passport-task", kind: "task", reference: "RYN-SOL-A4" },
      ],
    },
    lastVerifiedAt: SOLANA_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Live · read-only Solana mainnet mint and Token-2022 evidence",
    limitation:
      "Reads any public Solana mainnet mint account: program ownership, authorities, supply and every Token-2022 extension, each field labeled with its provenance. Off-chain metadata, price, liquidity and holder concentration are not read, and the passport says so instead of filling the gap. There is no score, no rating and no recommendation; an extension this version cannot decode is reported as unsupported rather than guessed, and a failed read renders its exact failure code.",
    failClosed: {
      on: ["data_unavailable", "stale_evidence", "conflicting_evidence", "unknown_scope"],
      behavior:
        "An address that is not a mint, an account that does not exist, undecodable bytes and an endpoint that did not answer are four distinct refusals, each rendered by name; nothing is served from a cached default.",
      recovery: "Re-read the mint from its shareable link — opening one re-reads the chain.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology"],
  },
  {
    id: "solana-swap-quote-preview",
    label: "Solana swap quote preview",
    maturity: "live",
    mode: "read_only",
    /* The three mints whose quotes were captured live from the venue are the
       verified set — the same convention the passport above states. The surface
       quotes any mainnet pair the venue routes, and offers a fourth featured
       pair (SOL→BONK) whose quote was never captured; scope records what was
       verified, never what is offered, so a narrower list here is the honest
       direction. Founder decision, 2026-08-18. */
    scope: { provider: SOLANA, route: null, venues: [], assets: ["SOL", "USDC", "PYUSD"] },
    evidence: {
      public: [
        {
          id: "solana-swap-surface",
          kind: "product_surface",
          label: "Solana Swap — live quote and owner-signed execution path",
          reference: "/solana/workspace/swap",
        },
        {
          id: "solana-m2-explorer",
          kind: "official_source",
          label: "Solana Explorer — exact M2 transaction",
          reference: "https://explorer.solana.com/tx/4NAKLXGnECdnrgJTv7CBtMjpYSDgcZuKaBfc1SKSHTLfhhrYkTTyGSsjM3LpRGQHKWR34dociwkhRrG9U8R41Cgr",
        },
        {
          id: "solana-m2-receipt",
          kind: "product_surface",
          label: "Signed M2 Swap Outcome Receipt",
          reference: "/api/solana/receipts/m2",
        },
        {
          id: "solana-m2-correction",
          kind: "product_surface",
          label: "Hash-bound M2 receipt provenance correction",
          reference: "/api/solana/receipts/m2/correction",
        },
      ],
      internal: [
        { id: "solana-quotes-code", kind: "code", reference: "lib/solana/quotes.ts over keyed Jupiter Swap API V2 /order with an explicit degraded fallback" },
        {
          id: "solana-quotes-tests",
          kind: "test",
          reference: "lib/solana/quotes.test.mjs over live-captured quote fixtures",
        },
        { id: "solana-quotes-task", kind: "task", reference: "RYN-SOL-M0D" },
        { id: "solana-m2-task", kind: "task", reference: "RYN-SOL-M2" },
        { id: "solana-m2-chain-evidence", kind: "production", reference: "docs/tasks/evidence/RYN-SOL-M2-chain-evidence.json" },
      ],
    },
    lastVerifiedAt: SOLANA_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Live quotes · Swap action family owner-canary verified for one exact mainnet operation",
    limitation:
      "Reads live mainnet `/order` quotes from keyed Jupiter Swap API V2 and applies the structural review over the output mint. One exact owner-signed 2.622093 USDC to 0.025621005 SOL action finalized and was independently read. Its immutable receipt remains DEVIATION_RECORDED: the wallet-modified adopted RPC lane has no Jupiter execute report, and a hash-bound public correction records two inaccurate legacy provenance labels. The action-family registry marks only this exact Swap canary `OWNER_CANARY_VERIFIED`; this global capability row remains read-only with no authority. The evidence does not guarantee another pair, amount, route or landing and grants no autonomous or public execution authority. Bridge, Send, Spot and Perps are unaffected.",
    failClosed: {
      on: ["data_unavailable", "stale_evidence", "conflicting_evidence", "route_unavailable"],
      behavior:
        "No route, a venue refusal, a rate limit and an unreachable endpoint remain distinct internally; the customer sees concise recovery copy rather than raw provider codes. A failed quote leaves no verdict rather than judging a number that does not exist.",
      recovery: "Ask again from the shareable link — a new ask is a new quote, never a replay of a stale one.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology"],
  },
  {
    id: "solana-cctp-precanary",
    label: "Solana ↔ Base CCTP owner-canary verified",
    /* Promoted by RYN-SOL-M3 on 2026-09-02: one owner-signed CCTP V2 transfer
       of 2.000000 USDC from Solana to Base, observed on both chains and
       reconciled MATCHED. The shape follows the Swap promotion after M2 rather
       than inventing one — `supported_live` stays where it is, reserved for
       moving real value on a path open to users, and this path is not. What
       the canary proved is stated in the label and the limitation instead of
       being implied by a mode. */
    maturity: "live",
    mode: "read_only",
    scope: { provider: SOLANA, route: null, venues: ["circle-cctp-v2"], assets: ["USDC"] },
    evidence: {
      public: [
        {
          id: "solana-cctp-surface",
          kind: "product_surface",
          label: "Solana Bridge — CCTP V2 pre-canary review",
          reference: "/solana/workspace/bridge",
        },
      ],
      internal: [
        { id: "solana-cctp-registry", kind: "code", reference: "lib/solana/cctp-registry.ts over official Circle domains, programs, contracts and native-USDC representations" },
        { id: "solana-cctp-provider", kind: "code", reference: "lib/solana/cctp-provider.ts over public Circle Iris fee, allowance and key reads" },
        { id: "solana-cctp-lifecycle", kind: "test", reference: "lib/solana/cctp-lifecycle.test.mjs and cctp-receipt.test.mjs over the lifecycle, recovery and the issuer-signed receipt the public verifier accepts" },
        { id: "solana-cctp-burn", kind: "code", reference: "lib/solana/cctp-burn.ts and cctp-plan.ts, the depositForBurn encoder pinned to a real mainnet burn" },
        { id: "solana-cctp-claim", kind: "code", reference: "lib/solana/cctp-burn-claim.ts, the duplicate-burn boundary keyed on the intent rather than the signed bytes" },
        { id: "solana-cctp-destination", kind: "code", reference: "lib/base/rpc.ts and lib/base/cctp-observe.ts, read-only Base with three declared operators and a consumed-but-unseen state" },
        { id: "solana-cctp-task", kind: "task", reference: "RYN-SOL-M0F" },
        { id: "solana-m3-task", kind: "task", reference: "RYN-SOL-M3" },
        {
          id: "solana-m3-chain-evidence",
          kind: "production",
          reference: "docs/tasks/evidence/RYN-SOL-M3-chain-evidence.json, read back from both chains after the transfer",
        },
        {
          id: "solana-m3-receipt",
          kind: "production",
          reference: "docs/tasks/evidence/RYN-SOL-M3-bridge-receipt.json, MATCHED and SIGNATURE_VALID under the verifier",
        },
      ],
    },
    lastVerifiedAt: "2026-09-02",
    freshness: LIVE_FRESHNESS,
    publicLabel: "Bridge action family owner-canary verified for one exact mainnet transfer",
    limitation:
      "Reads and reviews native USDC routes in both Solana ↔ Base directions through Circle CCTP V2, including official domains and contracts, current public fee and Fast-allowance evidence, and the message-first recovery model. The execution path — build, burn, attestation, destination call, both-side observation, receipt and read-only recovery — has been used exactly once. On 2026-09-02 the owner signed one transfer of 2.000000 USDC from Solana to Base under RYN-SOL-M3: burn signature 2FzRq4M2…32yTP at slot 443729373, destination mint 0x1792fd89…b2cda in Base block 50786518, source balance down 2.000000 and destination balance up 2.000000, reconciled MATCHED with no deviation and no second burn. That is one transfer, one direction, one asset and one amount, and it promotes nothing else: no other direction, size or asset is verified, the transfer is not open to anyone but the owner, and the refundable rent of 0.00386976 SOL is not claimable for five days and has not been claimed.",
    failClosed: {
      on: ["data_unavailable", "stale_evidence", "conflicting_evidence", "authorization_missing", "feature_disabled"],
      behavior:
        "An unavailable Circle edge remains unavailable rather than becoming a zero fee or empty allowance; provider reachability never authorizes execution; recovery refuses a second burn and starts from the existing message and attestation.",
      recovery:
        "Inspect the existing burn, message, attestation and destination mint in order. No recovery path creates a second burn.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology"],
  },
] as const;

const AGENT_CONTROL_CAPABILITIES = [
  {
    id: "agent-control-intent",
    label: "Agent action intent normalization",
    maturity: "preview",
    mode: "read_only",
    scope: {
      provider: null,
      route: null,
      venues: ["source-preview"],
      assets: ["sample-unfunded-agent-job-draft"],
    },
    evidence: {
      public: [{ id: "agent-intent-surface", kind: "product_surface", label: "Action Passport Lab", reference: "/agents/workspace/lab" }],
      internal: [
        { id: "agent-intent-code", kind: "code", reference: "lib/agent-control/contracts.ts" },
        { id: "agent-intent-developer-kit", kind: "code", reference: "packages/agent-control-sdk and packages/agent-control-mcp" },
        { id: "agent-intent-task", kind: "task", reference: "docs/tasks/active/RYN-AGENT-CONTROL-001.md" },
      ],
    },
    lastVerifiedAt: AGENT_CONTROL_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Source preview",
    limitation:
      "A strict, versioned AgentActionIntent normalizes a sample agent request in source. It does not prove that Agentverse or ASI:One delivered the request, and it creates, funds or submits no external job.",
    failClosed: {
      on: ["unknown_scope", "stale_evidence", "conflicting_evidence", "feature_disabled"],
      behavior: "Reject the request rather than infer a chain, provider, asset, amount, evaluator or missing fact.",
      recovery: "Supply a complete versioned intent and fresh source-labelled evidence, then run deterministic preflight again.",
    },
    authority: NO_AUTHORITY,
    axes: {
      verification: "INTERNAL_VERIFIED",
      availability: "PUBLIC_PREVIEW",
      environment: "CI",
      health: "UNKNOWN",
      /* Enforcement is not a kernel field yet: the grade lives in the
         workspace shell, so nothing here may claim more than observation. */
      enforcement: "OBSERVE_ONLY",
      knownBypass: [
        "Direct external calls: an agent holding its own wallet or provider client can act without passing through Ryntra.",
      ],
    },
    publicSurfaces: ["methodology", "agent_control"],
  },
  {
    id: "agent-control-preflight",
    label: "Agent Control deterministic preflight",
    maturity: "preview",
    mode: "paper_only",
    scope: {
      provider: null,
      route: null,
      venues: ["source-preview"],
      assets: ["sample-unfunded-agent-job-draft"],
    },
    evidence: {
      public: [{ id: "agent-preflight-surface", kind: "product_surface", label: "Action Passport Lab", reference: "/agents/workspace/lab" }],
      internal: [
        { id: "agent-preflight-code", kind: "code", reference: "lib/agent-control/core.ts" },
        { id: "agent-preflight-developer-kit", kind: "code", reference: "packages/agent-control-sdk, packages/agent-control-mcp and examples/agent-control-builder" },
        { id: "agent-preflight-tests", kind: "test", reference: "lib/agent-control/core.test.mjs" },
      ],
    },
    lastVerifiedAt: AGENT_CONTROL_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Source preview · deterministic",
    limitation:
      "The source preview evaluates one immutable local policy and emits the shared Guard PolicyResult vocabulary. Execution is hard-disabled; an allowed result is not a provider signature, wallet authorization, job or settlement.",
    failClosed: {
      on: ["gate_incomplete", "authorization_missing", "data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Return blocked, insufficient-evidence, expired or unsupported and keep every external action unavailable.",
      recovery: "Resolve the named evidence or policy issue and require a separately bound human decision before any future adapter may proceed.",
    },
    authority: PLAN_AUTHORITY,
    axes: {
      verification: "INTERNAL_VERIFIED",
      availability: "PUBLIC_PREVIEW",
      environment: "CI",
      health: "UNKNOWN",
      /* Enforcement is not a kernel field yet: the grade lives in the
         workspace shell, so nothing here may claim more than observation. */
      enforcement: "OBSERVE_ONLY",
      knownBypass: [
        "Direct external calls: an agent holding its own wallet or provider client can act without passing through Ryntra.",
      ],
    },
    publicSurfaces: ["methodology", "agent_control"],
  },
  {
    id: "agent-decision-passport-preview",
    /* Stable id retained for registry compatibility; the artifact name is now
       unambiguously Action Passport Preview. */
    label: "Agent Action Passport Preview",
    maturity: "preview",
    mode: "read_only",
    scope: {
      provider: null,
      route: null,
      venues: ["source-preview"],
      assets: ["sample-unfunded-agent-job-draft"],
    },
    evidence: {
      public: [{ id: "agent-verifier-surface", kind: "product_surface", label: "Action Passport Preview verifier", reference: "/agents/verify" }],
      internal: [
        { id: "agent-passport-code", kind: "code", reference: "lib/agent-control/contracts.ts and lib/agent-control/core.ts" },
        { id: "agent-passport-developer-contract", kind: "code", reference: "openapi/ryntra-agent-control-v0.yaml and packages/agent-control-sdk" },
        { id: "agent-passport-tests", kind: "test", reference: "lib/agent-control/canonical.test.mjs and core.test.mjs" },
      ],
    },
    lastVerifiedAt: AGENT_CONTROL_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Source preview · integrity-checkable",
    limitation:
      "The verifier can recompute a source-preview passport that always states OUTCOME_NOT_OBSERVED. It is not a finalized receipt and carries no job id, transaction hash, provider result, evaluator result or independently observed effect.",
    failClosed: {
      on: ["conflicting_evidence", "data_unavailable", "gate_incomplete"],
      behavior: "Return INVALID on any schema, relationship or hash mismatch and never upgrade the preview to finalized.",
      recovery: "Use the exact unmodified preview; a future finalized receipt requires a new contract and independently observed actual effects.",
    },
    authority: PLAN_AUTHORITY,
    axes: {
      verification: "INTERNAL_VERIFIED",
      availability: "PUBLIC_PREVIEW",
      environment: "CI",
      health: "UNKNOWN",
      /* Enforcement is not a kernel field yet: the grade lives in the
         workspace shell, so nothing here may claim more than observation. */
      enforcement: "OBSERVE_ONLY",
      knownBypass: [
        "Direct external calls: an agent holding its own wallet or provider client can act without passing through Ryntra.",
      ],
    },
    publicSurfaces: ["methodology", "agent_control"],
  },
  {
    id: "agent-launch-public-read",
    label: "Agent Launch public token read adapter",
    maturity: "preview",
    mode: "read_only",
    scope: {
      provider: null,
      route: null,
      venues: ["agent-launch-public-api"],
      assets: ["bsc-testnet-token-zero-state"],
    },
    evidence: {
      public: [
        { id: "agent-launch-docs", kind: "official_source", label: "Agent Launch docs", reference: "https://agent-launch.ai/docs" },
      ],
      internal: [
        { id: "agent-launch-adapter", kind: "code", reference: "lib/agent-control/adapters/agent-launch.ts" },
        { id: "agent-launch-developer-route", kind: "code", reference: "app/api/agents/agent-launch, packages/agent-control-sdk and packages/agent-control-mcp" },
        { id: "agent-launch-tests", kind: "test", reference: "lib/agent-control/adapters/agent-launch.test.mjs" },
      ],
    },
    lastVerifiedAt: AGENT_CONTROL_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Source preview · public reads only",
    limitation:
      "A bounded adapter normalizes Agent Launch public token list/detail GET responses for explicit chainId 97, preserves raw provider data and surfaces controller/schema drift. It exposes no authentication, tokenization, trading, payment, signing or deployment path; the observed chain-97 list was an honest zero state.",
    failClosed: {
      on: ["data_unavailable", "stale_evidence", "conflicting_evidence", "route_unavailable"],
      behavior: "Reject wrong-chain, contradictory, oversized, malformed or timed-out provider responses rather than infer token or agent facts.",
      recovery: "Re-read the exact public endpoint with explicit chainId 97 and preserve the provider response and observation time.",
    },
    authority: NO_AUTHORITY,
    axes: {
      verification: "BUILDING",
      availability: "PUBLIC_PREVIEW",
      environment: "CI",
      health: "UNKNOWN",
      /* Enforcement is not a kernel field yet: the grade lives in the
         workspace shell, so nothing here may claim more than observation. */
      enforcement: "OBSERVE_ONLY",
      knownBypass: [
        "Direct external calls: an agent holding its own wallet or provider client can act without passing through Ryntra.",
      ],
    },
    publicSurfaces: ["methodology", "agent_control"],
  },
  {
    id: "bnb-apex-read-observer",
    label: "BNB APEX read-only observer",
    maturity: "preview",
    mode: "read_only",
    scope: {
      provider: null,
      route: null,
      venues: ["bnb-apex", "bsc-testnet"],
      assets: ["deployment-metadata", "known-job-observation"],
    },
    evidence: {
      public: [
        { id: "bnb-apex-source", kind: "official_source", label: "BNB APEX contracts", reference: "https://github.com/bnb-chain/apex-contracts" },
      ],
      internal: [
        { id: "bnb-apex-adapter", kind: "code", reference: "lib/agent-control/adapters/bnb-apex.ts" },
        { id: "bnb-apex-developer-route", kind: "code", reference: "app/api/agents/bnb-apex, packages/agent-control-sdk and packages/agent-control-mcp" },
        { id: "bnb-apex-tests", kind: "test", reference: "lib/agent-control/adapters/bnb-apex.test.mjs" },
      ],
    },
    lastVerifiedAt: AGENT_CONTROL_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Source preview · known references only",
    limitation:
      "A bounded read-only adapter verifies the allowlisted BSC testnet deployment and can inspect one known transaction hash plus job id without broad log scans. It surfaces provider address/payment-asset drift, signs nothing, and no Ryntra-owned job, transaction or terminal outcome has been observed.",
    failClosed: {
      on: ["data_unavailable", "stale_evidence", "conflicting_evidence", "route_unavailable"],
      behavior: "Reject a wrong chain, RPC origin, contract link, missing code, unknown emitter, unbound job event or conflicting token metadata.",
      recovery: "Use an allowlisted official RPC and exact known job/transaction references, then compare receipt evidence with current contract state.",
    },
    authority: NO_AUTHORITY,
    axes: {
      verification: "INTERNAL_VERIFIED",
      availability: "PUBLIC_PREVIEW",
      environment: "TESTNET",
      health: "UNKNOWN",
      /* Enforcement is not a kernel field yet: the grade lives in the
         workspace shell, so nothing here may claim more than observation. */
      enforcement: "OBSERVE_ONLY",
      knownBypass: [
        "Direct external calls: an agent holding its own wallet or provider client can act without passing through Ryntra.",
      ],
    },
    publicSurfaces: ["methodology", "agent_control"],
  },
  {
    id: "agentverse-public-passport",
    label: "Agentverse public Agent Passport",
    maturity: "preview",
    mode: "read_only",
    scope: {
      provider: AGENTVERSE,
      route: null,
      venues: ["agentverse-public-registry"],
      assets: ["agent-profile-registration-and-protocol-metadata"],
    },
    evidence: {
      public: [
        { id: "agentverse-passport-surface", kind: "product_surface", label: "Agent Passport", reference: "/agents/passport" },
        { id: "agentverse-resolver-docs", kind: "official_source", label: "Agentverse resolver", reference: "https://docs.agentverse.ai/api-reference/almanac/resolve-identifier" },
        { id: "agentverse-search-docs", kind: "official_source", label: "Agentverse search record", reference: "https://docs.agentverse.ai/v-1/api-reference/search/get-agent" },
        { id: "agentverse-manifest-docs", kind: "official_source", label: "Agentverse protocol manifest", reference: "https://docs.agentverse.ai/api-reference/almanac/get-manifest" },
      ],
      internal: [
        { id: "agentverse-passport-code", kind: "code", reference: "lib/agent-control/agent-passport.ts and adapters/agentverse.ts" },
        { id: "agentverse-passport-developer-kit", kind: "code", reference: "packages/agent-control-sdk, packages/agent-control-mcp and examples/agent-control-builder" },
        { id: "agentverse-passport-tests", kind: "test", reference: "lib/agent-control/agent-passport.test.mjs and adapters/agentverse.test.mjs" },
        { id: "agentverse-passport-task", kind: "task", reference: "docs/tasks/active/RYN-AGENT-CONTROL-002.md" },
      ],
    },
    lastVerifiedAt: AGENT_CONTROL_VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Source preview · public records only",
    limitation:
      "A bounded read-only adapter resolves one exact public Agentverse address, preserves registry/search/manifest provenance, and exposes provider-declared facts, conflicts and unknowns. It does not authenticate ownership, test declared endpoints, prove liveness, invoke ASI:One, register an agent, score trust or execute an action.",
    failClosed: {
      on: ["data_unavailable", "stale_evidence", "conflicting_evidence", "route_unavailable"],
      behavior: "Keep each unavailable or schema-drifted source partial or unknown and emit no trust, liveness, ownership or capability verdict.",
      recovery: "Re-read the fixed public Agentverse sources for the exact address and inspect their independent provenance, conflicts and observation time.",
    },
    authority: NO_AUTHORITY,
    axes: {
      verification: "BUILDING",
      availability: "PUBLIC_PREVIEW",
      environment: "CI",
      health: "UNKNOWN",
      /* Enforcement is not a kernel field yet: the grade lives in the
         workspace shell, so nothing here may claim more than observation. */
      enforcement: "OBSERVE_ONLY",
      knownBypass: [
        "Direct external calls: an agent holding its own wallet or provider client can act without passing through Ryntra.",
      ],
    },
    publicSurfaces: ["methodology", "agent_control"],
  },
  {
    id: "agentverse-discovery",
    label: "Agentverse and ASI:One discovery adapter",
    maturity: "planned",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["agentverse", "asi-one"],
      assets: ["agent-request-evidence"],
    },
    evidence: {
      public: [],
      internal: [{ id: "agentverse-task", kind: "task", reference: "docs/tasks/active/RYN-AGENT-CONTROL-001.md external gates" }],
    },
    lastVerifiedAt: AGENT_CONTROL_VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "Planned · external registration not proven",
    limitation:
      "Ryntra has not registered, published or discovered an Agentverse agent and has no ASI:One invocation evidence. Requirements from one official program brief are not represented as universal platform requirements.",
    failClosed: {
      on: ["gate_incomplete", "data_unavailable", "route_unavailable", "feature_disabled"],
      behavior: "Show the adapter as planned and accept no external-origin claim without exact request provenance.",
      recovery: "Complete a separately authorized registration and preserve the real request, agent identity, timestamps and platform evidence.",
    },
    authority: NO_AUTHORITY,
    axes: {
      verification: "PLANNED",
      availability: "HIDDEN",
      environment: "MOCK",
      health: "UNKNOWN",
      /* Enforcement is not a kernel field yet: the grade lives in the
         workspace shell, so nothing here may claim more than observation. */
      enforcement: "OBSERVE_ONLY",
      knownBypass: [
        "UNKNOWN",
      ],
    },
    publicSurfaces: ["methodology", "agent_control"],
  },
  {
    id: "bnb-agent-job-lifecycle",
    label: "BNB agent job lifecycle",
    maturity: "planned",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["bnb-apex", "bsc-testnet"],
      assets: ["provider-reported-test-payment-asset"],
    },
    evidence: {
      public: [],
      internal: [{ id: "bnb-agent-task", kind: "task", reference: "docs/tasks/active/RYN-AGENT-CONTROL-001.md external gates" }],
    },
    lastVerifiedAt: AGENT_CONTROL_VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "Planned · no Ryntra job or transaction",
    limitation:
      "No Ryntra ERC-8183 or BNB APEX job has been created, funded, submitted, evaluated or settled. Draft-standard and provider contracts do not prove a Ryntra integration, and conflicting payment-token metadata remains unresolved.",
    failClosed: {
      on: ["gate_incomplete", "authorization_missing", "data_unavailable", "route_unavailable", "conflicting_evidence"],
      behavior: "Create no job, request no signature, submit no provider work and finalize no receipt.",
      recovery: "Resolve exact contracts and token metadata, obtain separately authorized provider and wallet actions, then observe actual effects independently.",
    },
    authority: {
      authorization: "wallet_signature",
      custody: "non_custodial",
      withdrawalAuthority: false,
    },
    axes: {
      verification: "PLANNED",
      availability: "HIDDEN",
      environment: "MOCK",
      health: "UNKNOWN",
      /* Enforcement is not a kernel field yet: the grade lives in the
         workspace shell, so nothing here may claim more than observation. */
      enforcement: "OBSERVE_ONLY",
      knownBypass: [
        "UNKNOWN",
      ],
    },
    publicSurfaces: ["methodology", "agent_control"],
  },
] as const;

export const PUBLIC_CAPABILITIES = [
  ...STELLAR_CAPABILITIES,
  ...SOLANA_CAPABILITIES,
  ...AGENT_CONTROL_CAPABILITIES,
  {
    id: "arcus-spot-rfq",
    label: "Arcus spot RFQ",
    maturity: "live",
    mode: "supported_live",
    scope: {
      provider: ARCUS,
      route: "arcus-spot-rfq",
      venues: ["arcus"],
      assets: ["USDG↔TSLA", "USDG↔AAPL", "USDG↔AMD"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "arcus-spot-state", kind: "production", reference: "docs/STATE.md current Arcus spot scope" },
        { id: "arcus-spot-code", kind: "code", reference: "lib/venues/arcus and the wallet-signed swap route" },
        { id: "arcus-spot-tests", kind: "test", reference: "wallet-signed swap and route contract test suites" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROUTE_FRESHNESS,
    publicLabel: "Live · Arcus spot only",
    limitation:
      "Wallet-signed RFQ execution is limited to USDG↔TSLA, USDG↔AAPL, and USDG↔AMD on Arcus spot. Route availability, wallet state, and user eligibility are checked separately for every attempt.",
    failClosed: {
      on: ["route_unavailable", "user_ineligible", "authorization_missing", "stale_evidence", "conflicting_evidence"],
      behavior: "Do not expose or submit the live action; preserve the plan as non-executing evidence.",
      recovery: "Refresh route and eligibility checks, then require a new explicit wallet signature.",
    },
    authority: {
      authorization: "wallet_signature",
      custody: "non_custodial",
      withdrawalAuthority: false,
    },
    publicSurfaces: ["landing", "methodology", "cabinet"],
  },
  {
    id: "arcus-account-read",
    label: "Arcus account read",
    maturity: "live",
    mode: "read_only",
    scope: {
      provider: ARCUS,
      route: "arcus-perps-clob",
      venues: ["arcus"],
      assets: ["authorized-arcus-account-markets"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "account-read-state", kind: "production", reference: "docs/STATE.md current read-only account scope" },
        { id: "account-read-code", kind: "code", reference: "app/api/arcus and Arcus account clients" },
        { id: "account-read-tests", kind: "test", reference: "Arcus account and auth contract test suites" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROUTE_FRESHNESS,
    publicLabel: "Live · Arcus read-only",
    limitation:
      "Reads supported Arcus account data by public wallet address only. It does not authorize live perps, withdrawals, another user, or execution on another venue.",
    failClosed: {
      on: ["data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Show unavailable or stale account state and never substitute sample data for the account.",
      recovery: "Re-enter or refresh the public wallet address, then complete a fresh read before showing current values.",
    },
    authority: {
      authorization: "none",
      custody: "not_applicable",
      withdrawalAuthority: false,
    },
    publicSurfaces: ["methodology", "cabinet"],
  },
  {
    id: "uniswap-quote-comparison",
    label: "Uniswap quote comparison",
    maturity: "live",
    mode: "read_only",
    scope: {
      provider: UNISWAP,
      route: "uniswap-rhchain-amm",
      venues: ["uniswap-v3-on-robinhood-chain"],
      assets: ["same-supported-spot-pair-and-exact-input-amount"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "uniswap-quote-code", kind: "code", reference: "app/robinhood/workspace/swap quote comparison and lib/venues/uniswap" },
        { id: "uniswap-quote-tests", kind: "test", reference: "Uniswap quote and route-registry test suites" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROUTE_FRESHNESS,
    publicLabel: "Live · Read-only Uniswap v3 quote",
    limitation:
      "Compares the same supported pair and exact input amount as the Arcus quote. It is informational only: no Uniswap route selection or execution is shipped, and unavailable or empty liquidity remains explicit.",
    failClosed: {
      on: ["route_unavailable", "data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Do not rank an unavailable or stale quote and never infer executable liquidity from a failed check.",
      recovery: "Retry the exact pair and amount; keep execution on the separately supported Arcus route only.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology", "cabinet"],
  },
  {
    id: "arcus-trade-key-setup",
    label: "Arcus trade-key setup",
    maturity: "live",
    mode: "none",
    scope: {
      provider: ARCUS,
      route: null,
      venues: ["arcus"],
      assets: ["arcus-account-authorization"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "trade-key-state", kind: "production", reference: "docs/validation-log.md 2026-07-10 create and revoke verification" },
        { id: "trade-key-code", kind: "code", reference: "app/app/connect and lib/arcus/client-keys" },
        { id: "trade-key-tests", kind: "test", reference: "Arcus client-key and connection test suites" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Live · Wallet-approved setup and revoke",
    limitation:
      "This Arcus-only setup does not enable live SmartTrade or perps execution and never gives Ryntra withdrawal authority.",
    failClosed: {
      on: ["authorization_missing", "feature_disabled", "stale_evidence", "conflicting_evidence"],
      behavior: "Create no authorization and leave execution disabled.",
      recovery: "Restart the scoped setup and require a fresh explicit wallet approval; revoke remains available to the owner.",
    },
    authority: {
      authorization: "wallet_signature",
      custody: "non_custodial",
      withdrawalAuthority: false,
    },
    publicSurfaces: ["methodology", "cabinet"],
  },
  {
    id: "supported-route-readiness",
    label: "Supported-route readiness",
    maturity: "live",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["paper", "arcus-spot"],
      assets: ["supported-paper-markets", "arcus-supported-spot-assets"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "readiness-code", kind: "code", reference: "lib/domain/readiness.ts and current paper and Arcus spot wiring" },
        { id: "readiness-tests", kind: "test", reference: "lib/domain/readiness.test.mjs" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Live · Scoped deterministic checks",
    limitation:
      "The current checks cover supported paper plans and Arcus spot inputs. They are not a safety guarantee, eligibility verdict, universal scanner, or proof that execution will succeed.",
    failClosed: {
      on: ["unknown_scope", "data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Return no_trade or an unresolved result; never infer readiness from a missing signal.",
      recovery: "Supply fresh supported inputs and run the deterministic checks again.",
    },
    authority: PLAN_AUTHORITY,
    publicSurfaces: ["landing", "methodology", "demo", "cabinet"],
  },
  {
    id: "rwa-risk-pack",
    label: "Specialist RWA risk context",
    maturity: "live",
    mode: "read_only",
    scope: {
      provider: ARCUS,
      route: null,
      venues: ["arcus"],
      assets: ["supported-tokenized-assets"],
    },
    evidence: {
      public: [{ id: "rwa-demo", kind: "product_surface", label: "Sample risk context", reference: "/demo" }],
      internal: [
        { id: "rwa-code", kind: "code", reference: "lib/rwa and supported instrument risk surfaces" },
        { id: "rwa-tests", kind: "test", reference: "RWA risk, oracle, multiplier, and corporate-action suites" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Live · Supported Arcus RWA scope",
    limitation:
      "Shows verified fields for supported tokenized-asset contracts only. It is not a universal RWA, issuer, oracle, eligibility, or safety assessment.",
    failClosed: {
      on: ["unknown_scope", "data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Mark the affected signal unknown or stale and withhold any positive risk state derived from it.",
      recovery: "Refresh the exact contract, oracle, and market inputs before reevaluating the signal.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["landing", "methodology", "demo", "cabinet"],
  },
  {
    id: "telegram-daily-recap",
    label: "Telegram decision recap",
    maturity: "live",
    mode: "read_only",
    scope: {
      provider: null,
      route: null,
      venues: ["current-beta-workspace"],
      assets: ["supported-paper-and-observed-records"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "recap-state", kind: "production", reference: "docs/STATE.md current Telegram recap scope" },
        { id: "recap-tests", kind: "test", reference: "Telegram first-use, replay, logout, and recap suites" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Live · Current beta recap",
    limitation:
      "Summarizes records in the current beta scope. A delivered message is not a trade instruction, execution receipt, or complete ReviewRecord.",
    failClosed: {
      on: ["authorization_missing", "data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Send no recap for an unauthorized or unresolved record set and never fill gaps with invented events.",
      recovery: "Reauthenticate and rebuild the recap from the current recorded events.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology", "cabinet"],
  },
  {
    id: "smarttrade-plan",
    label: "SmartTrade plan",
    maturity: "paper",
    mode: "paper_only",
    scope: {
      provider: null,
      route: null,
      venues: ["venue-neutral-paper"],
      assets: ["supported-paper-markets"],
    },
    evidence: {
      public: [{ id: "paper-demo", kind: "product_surface", label: "Read-only paper workflow sample", reference: "/demo" }],
      internal: [
        { id: "paper-code", kind: "code", reference: "app/robinhood/workspace/terminal and app/api/paper" },
        { id: "paper-tests", kind: "test", reference: "paper planning and readiness suites" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Paper",
    limitation:
      "Records and simulates a plan only. It creates no real order and does not imply that a live route will be added or become eligible.",
    failClosed: {
      on: ["unknown_scope", "data_unavailable", "feature_disabled", "conflicting_evidence"],
      behavior: "Keep the record non-executing and mark unresolved inputs instead of promoting the plan.",
      recovery: "Correct the supported inputs and create a newly reviewed paper plan.",
    },
    authority: PLAN_AUTHORITY,
    publicSurfaces: ["landing", "methodology", "demo", "cabinet"],
  },
  {
    id: "decision-journal",
    label: "Decision journal",
    maturity: "paper",
    mode: "paper_only",
    scope: {
      provider: null,
      route: null,
      venues: ["paper", "arcus-read-only"],
      assets: ["supported-paper-records", "observed-arcus-fills"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "journal-code", kind: "code", reference: "lib/journal and current journal UI" },
        { id: "journal-tests", kind: "test", reference: "journal recap and paper workflow suites" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Paper · Partial read-only imports",
    limitation:
      "Covers paper records and observed Arcus fill context. The complete disposition, reconciliation, ReviewRecord, and StrategySpec version lineage are not shipped.",
    failClosed: {
      on: ["data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Show an incomplete or stale journal state and never synthesize a missing decision or fill.",
      recovery: "Restore the source record and rerun reconciliation before accepting a review.",
    },
    authority: PLAN_AUTHORITY,
    publicSurfaces: ["landing", "methodology", "cabinet"],
  },
  {
    id: "strategy-lab-v1",
    label: "Strategy Lab V1",
    maturity: "preview",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["local-venue-neutral-research"],
      assets: ["supported-import-fixtures"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "slab-state", kind: "task", reference: "docs/tasks/active/RYN-SLAB-001.md" },
        { id: "slab-code", kind: "code", reference: "app/app/strategy-lab and lib/strategy-lab" },
        { id: "slab-tests", kind: "test", reference: "Strategy Lab V1 deterministic suites" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Preview · Local and execution-free",
    limitation:
      "Local review candidate only: not deployed, absent from navigation, persistence-disabled, and unable to execute trades. Manual and template operation remains authoritative.",
    failClosed: {
      on: ["feature_disabled", "data_unavailable", "gate_incomplete", "conflicting_evidence"],
      behavior: "Keep the preview local, non-persistent, and execution-free.",
      recovery: "Complete the separately scoped release, data, and human-approval gates before changing maturity or mode.",
    },
    authority: PLAN_AUTHORITY,
    publicSurfaces: ["methodology", "strategy_lab"],
  },
  {
    id: "complete-decision-loop",
    label: "Complete decision loop",
    maturity: "planned",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["future-supported-connections"],
      assets: ["future-supported-strategy-evidence"],
    },
    evidence: {
      public: [],
      internal: [
        INTERNAL_TASK,
        { id: "loop-roadmap", kind: "decision", reference: "docs/NORTH-STAR.md and docs/ROADMAP.md minimum product loop" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "Planned · Complete loop not shipped",
    limitation:
      "The full StrategySpec to deterministic readiness to disposition to DecisionReceipt to ReviewRecord to human-approved next StrategySpec loop is not shipped as one product flow.",
    failClosed: {
      on: ["gate_incomplete", "unknown_scope", "stale_evidence", "conflicting_evidence"],
      behavior: "Describe the loop as planned and never infer completion from individual shipped, paper, or preview components.",
      recovery: "Ship and independently verify every versioned contract and transition before changing the registry maturity.",
    },
    authority: PLAN_AUTHORITY,
    publicSurfaces: ["landing", "methodology"],
  },
  {
    id: "personal-workspace",
    label: "Personal workspace",
    maturity: "planned",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["future-supported-connections"],
      assets: ["future-supported-instruments"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "workspace-roadmap", kind: "decision", reference: "docs/ROADMAP.md workspace and retention" },
        INTERNAL_TASK,
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "Planned",
    limitation:
      "No configurable Simple/Pro workspace is shipped. The landing preview shows the intended arrangement and carries this maturity. Depth may change how much is shown, never what is true.",
    failClosed: {
      on: ["gate_incomplete", "unknown_scope", "feature_disabled"],
      behavior: "Render the preview as intent with its registry maturity; never expose a control implying a saved workspace exists.",
      recovery: "Ship the workspace through its own task and release train, then re-evaluate this entry.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["landing", "methodology"],
  },
  {
    id: "multi-venue-overlay",
    label: "Multi-venue overlay",
    maturity: "planned",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["future-selected-connections"],
      assets: ["future-normalized-connection-scope"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "venue-task", kind: "task", reference: "docs/tasks/INDEX.md row RYN-VENUE-001" },
        { id: "venue-decision", kind: "decision", reference: "docs/VENUES.md connection ladder" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "Planned",
    limitation:
      "No additional user-facing venue is selected or shipped. The first accepted connection may be manual or read-only and may be no venue at all.",
    failClosed: {
      on: ["gate_incomplete", "unknown_scope", "data_unavailable", "conflicting_evidence"],
      behavior: "Show no normalized cross-venue state and keep every unverified connection unavailable.",
      recovery: "Complete the venue scorecard, data-rights, normalization, and read-only release gates.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology"],
  },
  {
    id: "portfolio-heat",
    label: "Portfolio heat",
    maturity: "live",
    mode: "read_only",
    scope: {
      provider: ARCUS,
      route: null,
      venues: ["arcus"],
      assets: ["connected-wallet-supported-stock-token-holdings"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "heat-state", kind: "production", reference: "docs/STATE.md current scoped Stock Token holdings heat" },
        { id: "heat-code", kind: "code", reference: "app/robinhood/workspace/swap and lib/domain/portfolio-heat" },
        { id: "heat-tests", kind: "test", reference: "portfolio heat and swap-terminal contract test suites" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: LIVE_FRESHNESS,
    publicLabel: "Live · Scoped Stock Token holdings",
    limitation:
      "Shows exposure, concentration, and correlated-family warnings only for supported Stock Token holdings in the connected public wallet. It excludes USDG cash and does not claim complete, cross-venue, or scenario-loss portfolio risk.",
    failClosed: {
      on: ["data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Keep missing values partial or unknown, mark stale prices, and never count unreadable holdings as zero.",
      recovery: "Refresh the public wallet balances and Stock Token prices before treating the scoped view as current.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology", "cabinet"],
  },
  {
    id: "complete-portfolio-risk",
    label: "Complete portfolio risk",
    maturity: "planned",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["future-normalized-connections"],
      assets: ["future-complete-multi-asset-portfolio"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "complete-heat-task", kind: "task", reference: "docs/tasks/INDEX.md row RYN-RISK-004" },
        { id: "complete-heat-roadmap", kind: "decision", reference: "docs/ROADMAP.md risk intelligence" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "Planned · Complete portfolio risk not shipped",
    limitation:
      "Portfolio-wide exposure, concentration, correlation, and scenario loss across normalized venues and asset classes are not available in the current product.",
    failClosed: {
      on: ["gate_incomplete", "unknown_scope", "data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Render no complete portfolio-risk verdict and preserve each missing source as unknown.",
      recovery: "Complete connection coverage, normalization, freshness, and scenario gates before changing maturity.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology"],
  },
  {
    id: "risk-readiness-scanner",
    label: "Risk and readiness scanner",
    maturity: "planned",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["future-supported-connections"],
      assets: ["future-supported-instruments"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "scanner-roadmap", kind: "decision", reference: "docs/ROADMAP.md risk intelligence" },
        INTERNAL_TASK,
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "Planned",
    limitation:
      "No user-facing cross-venue scanner is shipped. The landing block demonstrates the method on fixed sample values and is labelled with this maturity. Future discovery must show provenance and freshness and cannot present a recommendation as certainty.",
    failClosed: {
      on: ["gate_incomplete", "unknown_scope", "data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Return no candidate or an unresolved candidate, never a positive recommendation from incomplete evidence.",
      recovery: "Verify the connection, instrument, data rights, and current signals before rescanning.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["landing", "methodology"],
  },
  {
    id: "replay-robustness",
    label: "Replay and robustness",
    maturity: "planned",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["research-data-after-rights"],
      assets: ["future-supported-strategy-evidence"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "replay-task", kind: "task", reference: "docs/tasks/INDEX.md row RYN-REPLAY-001" },
        { id: "slab-replay-task", kind: "task", reference: "docs/tasks/INDEX.md rows RYN-SLAB-004 and RYN-SLAB-005" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "Planned",
    limitation:
      "Walk-forward, regime, and replay evidence depends on verified data rights and may emit only paper or no-trade records until separately released.",
    failClosed: {
      on: ["gate_incomplete", "data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Produce no robustness claim and keep the strategy non-executing.",
      recovery: "Restore licensed, versioned data and rerun the complete deterministic replay gate.",
    },
    authority: PLAN_AUTHORITY,
    publicSurfaces: ["methodology", "strategy_lab"],
  },
  {
    id: "pro-order-flow",
    label: "Professional order-flow views",
    maturity: "after_gate",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["future-selected-clob"],
      assets: ["feed-supported-clob-instruments"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "orderflow-task", kind: "task", reference: "docs/tasks/INDEX.md rows RYN-PRO-001 and RYN-PRO-002" },
        { id: "orderflow-decision", kind: "decision", reference: "docs/VENUES.md market-structure truth" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "After feed and data-rights gate",
    limitation:
      "DOM, tape, footprint, and true volume profile require a suitable CLOB trade feed and verified display and storage rights; RFQ and AMM data cannot substitute.",
    failClosed: {
      on: ["gate_incomplete", "unknown_scope", "data_unavailable", "conflicting_evidence"],
      behavior: "Render no order-book-derived visualization and never fabricate market structure.",
      recovery: "Verify a CLOB source, entitlements, rights, freshness, and UI semantics before enabling a view.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology"],
  },
  {
    id: "guarded-automation",
    label: "Guarded automation",
    maturity: "after_gate",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["future-approved-live-adapter"],
      assets: ["future-mandate-scoped-instruments"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "automation-task", kind: "task", reference: "docs/tasks/INDEX.md rows RYN-AUTO-001 and RYN-AUTO-002" },
        { id: "automation-roadmap", kind: "decision", reference: "docs/ROADMAP.md guarded automation" },
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "After legal, security, and reliability gates",
    limitation:
      "Automation is not shipped and cannot start before scoped authority, simulation, human authorization, limits, idempotency, kill switch, audit, and incident gates pass.",
    failClosed: {
      on: ["gate_incomplete", "authorization_missing", "route_unavailable", "feature_disabled", "conflicting_evidence"],
      behavior: "Create and submit no automated action.",
      recovery: "Complete every named gate and require a separately approved, revocable, bounded mandate.",
    },
    authority: {
      authorization: "future_scoped_mandate",
      custody: "non_custodial",
      withdrawalAuthority: false,
    },
    publicSurfaces: ["methodology"],
  },
  {
    id: "sequencer-monitoring",
    label: "Independent sequencer monitoring",
    maturity: "after_gate",
    mode: "none",
    scope: {
      provider: null,
      route: null,
      venues: ["robinhood-chain-after-observable-source"],
      assets: ["supported-robinhood-chain-routes"],
    },
    evidence: {
      public: [],
      internal: [
        { id: "sequencer-code", kind: "code", reference: "lib/rwa/risk.ts explicit unmeasured sequencer state" },
        INTERNAL_TASK,
      ],
    },
    lastVerifiedAt: VERIFIED_AT,
    freshness: ROADMAP_FRESHNESS,
    publicLabel: "After an observable source and reliability gate",
    limitation:
      "Ryntra does not independently monitor Robinhood Chain sequencer uptime because the current surface has no verified observable source. The signal remains unknown, never healthy by assumption.",
    failClosed: {
      on: ["gate_incomplete", "data_unavailable", "stale_evidence", "conflicting_evidence"],
      behavior: "Keep sequencer state unknown and never render a positive monitored status.",
      recovery: "Add and verify an observable source with freshness, outage, and recovery tests before changing maturity.",
    },
    authority: NO_AUTHORITY,
    publicSurfaces: ["methodology", "cabinet"],
  },
] as const satisfies readonly PublicCapability[];

/** @deprecated Prefer PUBLIC_CAPABILITIES. */
export const PRODUCT_CAPABILITIES: readonly PublicCapability[] = PUBLIC_CAPABILITIES;

export function productCapabilityById(id: ProductCapabilityId): PublicCapability {
  const capability = PUBLIC_CAPABILITIES.find((item) => item.id === id);
  if (!capability) throw new Error(`Unknown product capability: ${id}`);
  return capability;
}

export function getPublicCapabilitiesForSurface(
  surface: PublicCapabilitySurface,
): readonly PublicCapability[] {
  return PUBLIC_CAPABILITIES.filter((capability) =>
    (capability.publicSurfaces as readonly PublicCapabilitySurface[]).includes(surface),
  );
}

/**
 * What maturity implies on the other axes when an entry has not stated them.
 *
 * Every derived value is the weaker reading. `preview` becomes `BUILDING` on
 * CI rather than `INTERNAL_VERIFIED` on testnet, because a preview that has
 * genuinely been verified can say so explicitly, whereas a default that
 * flatters cannot be corrected by anything except noticing it.
 */
const DERIVED_AXES: Readonly<Record<CapabilityMaturity, Omit<CapabilityAxes, "knownBypass">>> = {
  live: {
    verification: "PRODUCTION_VERIFIED",
    availability: "GA",
    environment: "PRODUCTION",
    health: "UNKNOWN",
    enforcement: "OBSERVE_ONLY",
  },
  testnet: {
    verification: "INTERNAL_VERIFIED",
    availability: "PUBLIC_PREVIEW",
    environment: "TESTNET",
    health: "UNKNOWN",
    enforcement: "OBSERVE_ONLY",
  },
  paper: {
    verification: "BUILDING",
    availability: "PUBLIC_PREVIEW",
    environment: "MOCK",
    health: "UNKNOWN",
    enforcement: "OBSERVE_ONLY",
  },
  preview: {
    verification: "BUILDING",
    availability: "PUBLIC_PREVIEW",
    environment: "CI",
    health: "UNKNOWN",
    enforcement: "OBSERVE_ONLY",
  },
  planned: {
    verification: "PLANNED",
    availability: "HIDDEN",
    environment: "MOCK",
    health: "UNKNOWN",
    enforcement: "OBSERVE_ONLY",
  },
  after_gate: {
    verification: "PLANNED",
    availability: "HIDDEN",
    environment: "MOCK",
    health: "UNKNOWN",
    enforcement: "OBSERVE_ONLY",
  },
};

/**
 * The five axes for one capability — declared where present, derived otherwise.
 *
 * `knownBypass` defaults to `["UNKNOWN"]` rather than `[]`: an empty list reads
 * as "there is no way around this", which is a security claim, and silence is
 * not that claim.
 */
export function capabilityAxes(capability: PublicCapability<string>): CapabilityAxes {
  if (capability.axes) return capability.axes;
  return { ...DERIVED_AXES[capability.maturity], knownBypass: ["UNKNOWN"] };
}

const DAY_MS = 86_400_000;

function ageState(
  verifiedAt: string,
  maxAgeDays: number,
  now: Date,
): CapabilityEvidenceState {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt)) return "unknown";
  const verifiedMs = Date.parse(`${verifiedAt}T00:00:00.000Z`);
  const nowMs = now.getTime();
  if (!Number.isFinite(verifiedMs) || !Number.isFinite(nowMs)) return "unknown";
  const ageDays = (nowMs - verifiedMs) / DAY_MS;
  if (ageDays < -1) return "conflicting";
  return ageDays > maxAgeDays ? "stale" : "fresh";
}

function providerMatchesRoute(capability: PublicCapability<string>): boolean {
  const routeId = capability.scope.route;
  if (!routeId) {
    const provider = capability.scope.provider;
    return provider === null || provider.kind === "platform" || provider.id === "arcus";
  }
  const route = ROUTES[routeId];
  const provider = capability.scope.provider;
  if (!provider) return false;
  if (route.executor.kind === "venue") {
    return provider.kind === "venue" && provider.id === route.executor.venue;
  }
  return provider.kind === "protocol" && provider.id === route.executor.protocol;
}

/**
 * Re-evaluates a claim at read time. Route-bound claims are cross-checked against
 * lib/domain/registry.ts and lib/domain/ids.ts; feature flags and provider
 * capability marketing are deliberately not evidence inputs.
 */
export function getCapabilityFreshness(
  capability: PublicCapability<string>,
  now = new Date(),
): CapabilityEvidenceState {
  if (capability.freshness.state !== "fresh") return capability.freshness.state;

  const productAge = ageState(
    capability.lastVerifiedAt,
    capability.freshness.maxAgeDays,
    now,
  );
  if (productAge !== "fresh") return productAge;

  const routeId = capability.scope.route;
  if (!routeId) return "fresh";
  if (!providerMatchesRoute(capability)) return "conflicting";

  const routeClaim = ROUTE_CAPABILITIES[routeId];
  if (!routeClaim || routeClaim.source === "unverified") return "unknown";

  const routeAge = ageState(
    routeClaim.verifiedAt,
    capability.freshness.maxAgeDays,
    now,
  );
  if (routeAge !== "fresh") return routeAge;

  if (capability.maturity === "live" && capability.mode === "supported_live") {
    if (routeClaim.protocol !== "live" || routeClaim.ryntra !== "live") {
      return "conflicting";
    }
  }
  if (capability.maturity === "live" && capability.mode === "read_only") {
    if (routeClaim.ryntra !== "read-only" && routeClaim.ryntra !== "live") {
      return "conflicting";
    }
  }
  return "fresh";
}

/**
 * The sanctioned presentation selector. Consumers must not color maturity
 * directly: stale, unknown, or conflicting evidence is never positive.
 */
export function getCapabilityTruthTone(
  capability: PublicCapability<string>,
  now = new Date(),
  userAccess: UserAccess = "unknown",
): CapabilityTruthTone {
  const freshness = getCapabilityFreshness(capability, now);
  if (freshness === "conflicting") return "danger";
  if (freshness === "stale" || freshness === "unknown") return "caution";
  if (capability.maturity !== "live") return "neutral";

  if (capability.mode === "supported_live") {
    if (userAccess === "restricted") return "danger";
    if (userAccess !== "available") return "caution";
  }
  return "positive";
}

/**
 * The Stellar Hub module registry.
 *
 * Same discipline as an earlier hub's, and for the same reason: **a rail entry
 * without a page is the most expensive mistake this file can make**, so
 * `railed()` throws rather than rendering a destination that does not exist.
 * Everything registered but unbuilt is `mapped` — it appears on the Hub Map
 * with its state and its gate, where it can be described honestly, and nowhere
 * else.
 *
 * The groups are the seven the product already uses. What differs here is
 * the domain: Stellar's consequential facts are issuer controls, trustlines,
 * holder rights, anchors and redemption, so those get modules of their own.
 *
 * ## Four independent facts, not one word
 *
 * A single `maturity` word was doing four jobs and getting three of them wrong.
 * `AVAILABLE` said nothing about whether a surface reads mainnet or signs on
 * testnet; nothing recorded when a state was last checked; and one capability —
 * the full payment lifecycle — was registered **twice**, once as a built
 * `Authorize` and once as a gated future `Send`, with two different states for
 * the same code. So the record now carries what the reader actually needs to
 * separate:
 *
 * ```text
 * environment  which network's facts this surface deals in
 * mode         what it is allowed to do there
 * maturity     how far it has actually come
 * lastVerifiedAt  when that was last true against a live source
 * ```
 *
 * `CODE COMPLETE`, `DEPLOYED`, `TESTNET VERIFIED` and `SUPPORTED LIVE` are never
 * interchangeable, and four fields is what it takes to stop them being written
 * as though they were.
 */

export type StellarModuleGroup = "HOME" | "OBSERVE" | "MOVE" | "TREASURY" | "CONTROL" | "PROVE" | "BUILD";

/**
 * Which network's facts a module deals in.
 *
 * This workspace is genuinely two things at once, and pretending otherwise is
 * what made the front door say `Mainnet · read-only` on a product that signs and
 * submits testnet transactions. Naming the environment per module is what lets
 * both statements be true on the same screen.
 */
export type StellarModuleEnvironment =
  /** Reads real mainnet assets, issuers and ledger state. Moves nothing. */
  | "MAINNET_DATA"
  /** Reports both halves at once. Exactly one surface does: the Overview. */
  | "BOTH"
  /** Prepares and proves an action on Stellar Testnet, signed in your own wallet. */
  | "TESTNET_ACTION"
  /** Would act on mainnet. Behind a separate release gate that no toggle reaches. */
  | "FUTURE_MAINNET"
  /** Touches no network — preferences, documentation, the map itself. */
  | "NONE";

/** What a module is permitted to do in its environment. */
export type StellarModuleMode = "READ_ONLY" | "TESTNET_EXECUTION" | "NONE";

export type StellarModuleMaturity =
  /** A real working surface. Reads only; moves nothing. */
  | "AVAILABLE"
  /** A real surface whose lifecycle ran on Stellar Testnet and reconciled. */
  | "TESTNET_VERIFIED"
  /** Built enough to open, not proven against a live source. */
  | "PREVIEW"
  /** Registered architecture with a delivery task, not yet a page. */
  | "IN_BUILD"
  /** Accepted direction, no active work. */
  | "PLANNED"
  /** Blocked on a named technical, provider or owner condition. */
  | "GATED";

export type StellarModule = Readonly<{
  id: string;
  group: StellarModuleGroup;
  label: string;
  /** One line: the job this module does for a person. */
  purpose: string;
  /** The disclosure body on the Hub Map card. */
  detail: string;
  /** What is already built and working today. Never a promise. */
  exists: string;
  /** What is not built, stated plainly rather than implied by a state word. */
  missing: string;
  /** The exact condition that moves this module forward. */
  gate: string;
  route: string | null;
  environment: StellarModuleEnvironment;
  mode: StellarModuleMode;
  maturity: StellarModuleMaturity;
  /** ISO date this state was last true against a live source, or null. */
  lastVerifiedAt: string | null;
  visibleInGuided: boolean;
  visibleInPro: boolean;
  searchable: boolean;
}>;

type Spec = Omit<StellarModule, "visibleInGuided" | "visibleInPro" | "searchable">;

function railed(spec: Spec & { guided?: boolean }): StellarModule {
  const { guided = false, ...rest } = spec;
  if (!rest.route) throw new Error(`Stellar Hub module "${rest.id}" is railed but has no route.`);
  /* A surface a person can open has been observed working, or it should not be
     in the rail. A railed module with no verification date is a page nobody
     checked, described as though somebody had. */
  if (!rest.lastVerifiedAt) throw new Error(`Stellar Hub module "${rest.id}" is railed with no lastVerifiedAt.`);
  return { ...rest, visibleInGuided: guided, visibleInPro: true, searchable: true };
}

/** Registered architecture. Renders on the Hub Map and nowhere else. */
function mapped(spec: Omit<Spec, "route" | "lastVerifiedAt">): StellarModule {
  return {
    ...spec,
    route: null,
    lastVerifiedAt: null,
    visibleInGuided: false,
    visibleInPro: false,
    searchable: false,
  };
}

const BASE = "/stellar/workspace";

/* Two dates, and they mean different things. The lifecycle date is when the
   owner signed and the ledger reconciled; the read date is when the mainnet
   surfaces were last observed answering on the deployed site. Collapsing them
   into one would be the same mistake the capability registry made with a single
   file-level review date. */
const LIFECYCLE_PROVEN = "2026-08-13";
const READS_OBSERVED = "2026-08-14";
/* Activity and Attention shipped together, because neither is worth much without
   the other: a condition that outlives its screen needs somewhere to live, and a
   history nobody is told about is a log. */
const RETENTION_SHIPPED = "2026-08-14";
/* The Observe slice, and the date Soroswap's API surface was read live to
   establish which half of it needs a credential. */
const OBSERVE_SHIPPED = "2026-08-14";

export const STELLAR_MODULES: readonly StellarModule[] = [
  railed({
    id: "overview",
    group: "HOME",
    label: "Overview",
    purpose: "What needs attention, what Stellar is doing, and what this workspace has proven.",
    detail:
      "Mission control for both halves of this workspace: the mainnet network pulse, what each issuer can do to a holding, whatever currently blocks an action, and the transactions this product has actually recorded.",
    exists: "Network pulse, issuer control watch, live attention state, and the two proven testnet lifecycles.",
    missing: "Watched assets and a recent-activity list, both of which need an action store.",
    gate: "Activity — the same store both rows read from.",
    route: BASE,
    environment: "BOTH",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: READS_OBSERVED,
    guided: true,
  }),
  railed({
    id: "attention",
    group: "HOME",
    label: "Attention & Recovery",
    purpose: "Everything that is blocking, degraded or unfinished, each with its exact recovery step.",
    detail:
      "Action required, caution and context, in that order. A wrong wallet network, a source that did not answer, a payment awaiting authorization, a failed transaction, a ledger that did not do what was authorized — each stating what happened, why it matters, what it affects, when it was observed and the one step that fixes it. The Overview panel and this page are the same computation, so they cannot disagree.",
    exists: "Every condition, computed from the wallet state machine, the evidence state of each read, and every stored lifecycle.",
    missing: "Conditions that need a policy to detect, because policy evaluation is not built.",
    gate: "Policies, for the rules a person defines in advance.",
    route: `${BASE}/attention`,
    environment: "BOTH",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: RETENTION_SHIPPED,
  }),
  railed({
    id: "network",
    group: "OBSERVE",
    label: "Network",
    purpose: "Ledger, protocol version, fees and the reserve, read live.",
    detail: "Stellar RPC for the ledger and the endpoint's retention window; Horizon for the base fee and base reserve. Both carry their observation time.",
    exists: "Ledger sequence, protocol version, endpoint health, retention horizon, base fee and base reserve.",
    missing: "Nothing in scope for this module.",
    gate: "None.",
    route: `${BASE}/network`,
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: READS_OBSERVED,
  }),
  railed({
    id: "assets",
    group: "OBSERVE",
    label: "Assets & RWA",
    purpose: "Find an asset by its exact identity and open its passport.",
    detail: "Search by CODE:ISSUER, plus a short list of real mainnet assets to start from. A code alone never resolves — many different assets share one.",
    exists: "Exact-identity search and the full Asset Passport over real mainnet assets, including issuer controls, holding requirements and a permanent unknowns rail.",
    missing: "Disambiguation from a bare code, which needs an indexed asset set.",
    gate: "RWA Market — the same index.",
    route: `${BASE}/assets`,
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: READS_OBSERVED,
    guided: true,
  }),
  railed({
    id: "rwa-market",
    group: "OBSERVE",
    label: "RWA & tokenized assets",
    purpose: "Tokenized treasuries, stablebonds and stablecoins side by side, issuer powers first.",
    detail:
      "A curated set resolved live, not a market — Stellar has no asset index this product reads, so coverage is not claimed. Every row carries what the issuer can do to a holding before it carries supply, because on Stellar that is the fact that decides the outcome. Nothing is ranked and no note says whether an asset is good.",
    exists: "Issuer powers, holder addresses and the issuer's declared domain, read per asset at request time.",
    missing: "Coverage. Four assets is a set; a market needs an index to iterate.",
    gate: "An asset index with a source and a refresh contract.",
    route: `${BASE}/rwa`,
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: OBSERVE_SHIPPED,
  }),
  railed({
    id: "issuers",
    group: "OBSERVE",
    label: "Issuers & Anchors",
    purpose: "The organisations behind assets, what they can do to a holding, and what they say about themselves.",
    detail:
      "One issuer at a time: account flags enforced by the network, then the issuer's own stellar.toml declaration — which carries no more authority than a company's website and is labelled that way. When the two disagree, the flags are the fact and the document is a claim.",
    exists: "Account flags, home domain, the organisation block and per-asset currency declarations, grouped by issuer.",
    missing: "Anchor deposit and withdrawal state, which is a SEP-6 or SEP-24 read this adapter does not perform, and coverage beyond the curated set.",
    gate: "One anchor integration for the anchor half; an asset index for coverage.",
    route: `${BASE}/issuers`,
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: OBSERVE_SHIPPED,
  }),
  railed({
    id: "markets",
    group: "OBSERVE",
    label: "Markets & Liquidity",
    purpose: "What a routing provider says a trade would do, normalized — never a route Ryntra produced.",
    detail:
      "Soroswap is integrated as the building block for liquidity. Its public health endpoint answers today and reports which venues its indexer covers. Everything that carries a price — quotes, pools, prices, the protocol and asset lists — answers 403 without an API key, so the quote path runs for real and renders its real refusal with the exact next step. A quote with no minimum output is refused outright.",
    exists: "The adapter, the normalized RoutePlan, the comparison, and live provider health across four indexed venues.",
    missing: "The API key that unlocks quotes, pools and prices, and a second provider to disagree with the first.",
    gate: "Register at api.soroswap.finance, generate a key, set SOROSWAP_API_KEY. No agent may create that account.",
    route: `${BASE}/markets`,
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    /* Built and reachable, and the half that carries a price has never returned
       one here. `PREVIEW` is exactly that: openable, not proven against a live
       source. Calling it AVAILABLE would claim the credentialed half works. */
    maturity: "PREVIEW",
    lastVerifiedAt: OBSERVE_SHIPPED,
  }),
  mapped({
    id: "flows",
    group: "OBSERVE",
    label: "Payments & Flows",
    purpose: "Where value actually moves on Stellar, by corridor and by asset.",
    detail: "Payment volume, path-payment corridors and anchor flows, read from the ledger rather than from a provider's marketing. Aggregate only — this is market structure, never a person's transactions.",
    exists: "Nothing. Every figure here is an aggregation the read adapter does not perform.",
    missing: "A ledger aggregation source with a stated method, and the vocabulary that keeps holder addresses from being described as people.",
    gate: "An aggregation source whose method can be published beside its numbers.",
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "defi",
    group: "OBSERVE",
    label: "DeFi & Yield",
    purpose: "Where an asset is used in a protocol, and what that exposes a holder to.",
    detail: "Protocol use is a risk fact before it is an opportunity: a token deposited into a lending market inherits that market's oracle and its liquidation rules. Read and explain, never recommend or promise a yield.",
    exists: "Nothing. The Passport reserves a protocol-use section and it renders as unknown.",
    missing: "Protocol reads, which on Soroban need contract-level resolution the adapter declares out of scope.",
    gate: "Soroban contract reads, and one protocol with a stable public interface.",
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "GATED",
  }),
  mapped({
    id: "ecosystem",
    group: "OBSERVE",
    label: "Ecosystem",
    purpose: "Who is building on Stellar, and which of them this workspace can actually read.",
    detail: "A map of the ecosystem is only useful if it says which entries Ryntra has integrated, which it has merely read about, and which it has not verified at all. Anything else is a logo wall.",
    exists: "The distinction itself, enforced elsewhere: the capability registry already separates a verified integration from a named one.",
    missing: "The surface, and a maintenance contract — an ecosystem list nobody re-reads is wrong within a quarter.",
    gate: "A source with a refresh date, so entries can go stale rather than silently rot.",
    environment: "NONE",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  railed({
    id: "providers",
    group: "OBSERVE",
    label: "Providers",
    purpose: "Every external source this workspace depends on, and whether it answered.",
    detail:
      "Stellar RPC, Horizon, Soroswap and each issuer domain, with what it is for, what it answered and what breaks without it. `Gated` is its own state and not a failure: a provider that is reachable and needs a credential this deployment does not hold is not an outage, and reporting it as one sends somebody looking for a problem that does not exist.",
    exists: "Live state for every source that builds a page here, with the exact recovery step where there is one.",
    missing: "Retained history. This is the last read rather than a record, and it says so rather than implying a trend.",
    gate: "Somewhere to retain observations — the same retention question Activity answered for actions.",
    route: `${BASE}/providers`,
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: OBSERVE_SHIPPED,
  }),
  railed({
    id: "send",
    group: "MOVE",
    label: "Send",
    purpose: "Send an exact testnet payment, authorize it, sign it in your own wallet, and check what the ledger did.",
    detail:
      "The whole lifecycle on one screen. A fingerprint is taken before the bytes leave, Freighter signs, the signed transaction is compared field by field against what was authorized, and only bytes that matched can be submitted — the submit function takes the cleared verdict rather than an XDR, so nothing else can reach the network. Then the ledger is read back independently, expected is compared against actual, and the result is a receipt whose every hash can be recomputed. Testnet only; Ryntra holds no key and no signed transaction reaches a Ryntra server.",
    exists: "The complete eight-stage lifecycle for XLM, proven by an owner-signed testnet payment that reconciled MATCHED and by a preflight that refused a doomed one before any signature.",
    missing: "Issued assets, which need destination trustline and issuer-authorization preflight before a build is honest.",
    gate: "The Move slice — issued-asset preflight, then Swap & Path Payment.",
    route: `${BASE}/send`,
    environment: "TESTNET_ACTION",
    mode: "TESTNET_EXECUTION",
    /* For one operation and no other: a testnet XLM payment — txSuccess ·
       paymentSuccess, reconciled MATCHED, receipt verified CONFIRMED. Issued assets are not proven and the card says so. */
    maturity: "TESTNET_VERIFIED",
    lastVerifiedAt: LIFECYCLE_PROVEN,
    /* Guided too, and deliberately. It is the surface that states the product's
       central claim — a signature is not an authorization — and a page reachable
       only by switching to Pro is a page most people never find. Guided shows
       five destinations, the most the workspace design allows. */
    guided: true,
  }),
  mapped({
    id: "path-payment",
    group: "MOVE",
    label: "Swap & Path Payment",
    purpose: "Strict-send and strict-receive paths with every hop disclosed.",
    detail: "Delivering a local-currency token is not a bank payout; offchain settlement needs an anchor. Gated on route evidence and issued-asset support.",
    exists: "The lifecycle underneath it — build, authorize, compare, submit, reconcile, receipt — is proven and asset-agnostic.",
    missing: "Route evidence to disclose, and the strict-send/strict-receive operations themselves.",
    gate: "Markets & Liquidity, so a path can be shown before it is signed.",
    environment: "TESTNET_ACTION",
    mode: "TESTNET_EXECUTION",
    maturity: "GATED",
  }),
  mapped({
    id: "cctp",
    group: "MOVE",
    label: "CCTP Bridge",
    purpose: "Move a stablecoin between chains through its issuer rather than a wrapper.",
    detail: "A burn on one chain and a mint on another, attested by the issuer — which is a different risk shape from a bridge that holds your asset. Ryntra would show the attestation and the boundary, never operate a bridge.",
    exists: "Nothing on Stellar. The lifecycle and reconciliation kernel are shared and already proven in the product.",
    missing: "Everything specific to this: the route, and first a live read confirming the protocol supports this chain pair at all.",
    gate: "Verified provider support for the exact chain pair, read from the provider's own live source — never assumed from an announcement.",
    environment: "FUTURE_MAINNET",
    mode: "NONE",
    maturity: "GATED",
  }),
  mapped({
    id: "ramp",
    group: "MOVE",
    label: "On / Off-Ramp",
    purpose: "Where onchain conversion ends and an anchor's responsibility begins.",
    detail: "Ryntra does not become an anchor. It shows the provider, quote, KYC state, the exact boundary and the recovery path. Gated on an anchor integration.",
    exists: "The boundary language, which is the part most products get wrong.",
    missing: "An anchor: SEP-6 or SEP-24 deposit and withdraw, and the KYC state that comes with it.",
    gate: "One anchor integration with published terms.",
    environment: "FUTURE_MAINNET",
    mode: "NONE",
    maturity: "GATED",
  }),
  mapped({
    id: "request",
    group: "MOVE",
    label: "Request Payment",
    purpose: "Ask for an exact amount, with the trustline and memo already correct.",
    detail: "Most failed Stellar payments fail for two avoidable reasons — no trustline, or a missing memo. A request that carries both turns them into the sender's preflight rather than the recipient's support ticket.",
    exists: "Both checks: destination account, trustline and authorization are already read by the Send preflight.",
    missing: "A shareable request, and somewhere for it to live between two people.",
    gate: "Somewhere to persist a request, which is the same store Activity needs.",
    environment: "TESTNET_ACTION",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "treasury-strategy",
    group: "TREASURY",
    label: "Treasury Strategy",
    purpose: "Issuer concentration, duration, liquidity and oracle-freshness limits.",
    detail: "The policy kernel that evaluates this already exists and is proven in the product. Stellar-specific rules need the asset facts to be indexed first.",
    exists: "The Guard policy kernel, with deterministic evaluation and reason codes.",
    missing: "Stellar rules to evaluate, and a portfolio to evaluate them against.",
    gate: "Stellar policy evaluation, then a connected account.",
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "rwa-allocation",
    group: "TREASURY",
    label: "RWA Allocation",
    purpose: "Current versus target exposure, by issuer, duration and liquidity.",
    detail: "Read and plan only; it proposes and never executes. Needs a connected wallet to have a portfolio to measure.",
    exists: "Per-asset facts — issuer, model, liquidity state — resolved by the Passport.",
    missing: "Holdings, and a target to compare them against.",
    gate: "Account balance reads, then Treasury Strategy.",
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "payouts",
    group: "TREASURY",
    label: "Payouts",
    purpose: "Pay one recipient repeatedly, against a policy, with a receipt each time.",
    detail: "The payout kernel — hashing, schemas, principal registry, daily outflow ledger — exists and is source-verified in the kernel. Nothing about it is Stellar-specific except the settlement leg.",
    exists: "The kernel, its schemas and its golden vectors.",
    missing: "The Stellar settlement leg and its own live proof; the kernel has never moved value.",
    gate: "Recipients and Approvers, then a separately authorized live payout.",
    environment: "TESTNET_ACTION",
    mode: "NONE",
    maturity: "GATED",
  }),
  mapped({
    id: "batch",
    group: "TREASURY",
    label: "Batch Disbursement",
    purpose: "Many payments, one authorization, and one honest report of what settled.",
    detail: "The hard part is not the sending — it is that a batch settles partially, and a surface that reports a batch as one success or one failure is lying about the middle case.",
    exists: "Per-transaction reconciliation, which is what a partial batch report is built from.",
    missing: "The batch itself, and the partial-settlement report.",
    gate: "Payouts.",
    environment: "TESTNET_ACTION",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  mapped({
    id: "rebalance",
    group: "TREASURY",
    label: "Rebalance",
    purpose: "Move an allocation back to target, with the expected effects stated first.",
    detail: "A proposal, priced and disclosed, that a human authorizes step by step. It never executes a plan as one action, because a plan that half-executes needs each leg to be recoverable on its own.",
    exists: "Expected-versus-actual reconciliation per leg.",
    missing: "The allocation to rebalance and the routes to rebalance through.",
    gate: "RWA Allocation and Swap & Path Payment.",
    environment: "FUTURE_MAINNET",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  mapped({
    id: "collateral",
    group: "TREASURY",
    label: "Collateral & Yield",
    purpose: "What a position earns, and what would liquidate it.",
    detail: "Stated in that order deliberately. Yield is the reason a person opens the panel; the liquidation threshold and the oracle behind it are why they should keep it open.",
    exists: "Nothing.",
    missing: "Protocol positions, oracle reads and the liquidation model.",
    gate: "DeFi & Yield.",
    environment: "FUTURE_MAINNET",
    mode: "NONE",
    maturity: "GATED",
  }),
  mapped({
    id: "strategies",
    group: "CONTROL",
    label: "Strategies & Risk",
    purpose: "The rules you decided in advance, versioned, and what each one would have blocked.",
    detail: "A StrategySpec is immutable once approved. Changing your mind creates a new version rather than editing the old one, so a receipt can name the exact rules that were in force.",
    exists: "The StrategySpec contract and its immutability, in the shared kernel.",
    missing: "Stellar-specific rules, and the surface to author them.",
    gate: "Stellar policy evaluation.",
    environment: "NONE",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  mapped({
    id: "policies",
    group: "CONTROL",
    label: "Policies",
    purpose: "Readable rules, immutable versions, and what each one blocks.",
    detail:
      "Shared with the existing Guard policy kernel rather than reimplemented. Registered here so the Stellar surface names it rather than hiding it. Until it exists, every receipt this workspace produces carries policyVersion: null with a reason naming this module — a field absent from a receipt reads as a field removed from one.",
    exists: "The kernel, and the honest null on every Stellar receipt.",
    missing: "Stellar rules over issuer controls, trustline state, oracle freshness, concentration and size.",
    gate: "The registered policy row — the one every Stellar receipt already points at.",
    environment: "NONE",
    mode: "NONE",
    maturity: "IN_BUILD",
  }),
  mapped({
    id: "recipients",
    group: "CONTROL",
    label: "Recipients",
    purpose: "Addresses you have paid before, with what is known about each one.",
    detail: "An address book is a risk control, not a convenience: the check that matters is whether this destination exists, accepts the asset, and is the one you used last time.",
    exists: "Destination existence, trustline and authorization reads, performed per payment.",
    missing: "Anywhere to keep a recipient between payments.",
    gate: "Persistence.",
    environment: "TESTNET_ACTION",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "approvers",
    group: "CONTROL",
    label: "Approvers",
    purpose: "Who may authorize what, and above which amount a second person is required.",
    detail: "Roles that imply nothing about legal authority — the principal registry deliberately names function rather than title. Two people approving is a control; two people named on a screen is decoration.",
    exists: "The principal registry with its five non-implying roles.",
    missing: "The Stellar binding, and the surface.",
    gate: "Payouts.",
    environment: "NONE",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  mapped({
    id: "trustlines",
    group: "CONTROL",
    label: "Trustlines & Permissions",
    purpose: "What your account has authorized, and what can still be revoked.",
    detail: "A passport states what an asset demands of any account. This states what one account has actually granted, which needs that account connected.",
    exists: "Trustline and authorization reads for any account, and the reserve each trustline locks.",
    missing: "The connected-account view, and the change operations themselves.",
    gate: "Account reads for the connected wallet.",
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "GATED",
  }),
  mapped({
    id: "agents",
    group: "CONTROL",
    label: "Agents",
    purpose: "What a program may do on your behalf, and what it may never do.",
    detail: "An agent surface is only honest if the boundary is structural: no key, a scoped mandate, an explicit human authorization for anything that settles, and a kill switch that is not a preference. Registered here to name that boundary, not to promise the feature.",
    exists: "The boundary itself: authorization is a separate artifact from a signature, and this product has no key to delegate.",
    missing: "Everything else, and it is gated behind a required security review.",
    gate: "The registered automation gates — a bounded mandate is never a feature decision alone.",
    environment: "FUTURE_MAINNET",
    mode: "NONE",
    maturity: "GATED",
  }),
  railed({
    id: "settings",
    group: "CONTROL",
    label: "Settings",
    purpose: "Your workspace, your wallet, and what this product structurally cannot do.",
    detail: "Workspace depth and appearance, the connected wallet and its network, which sources answer, and the boundaries — stated in one place a person can point at rather than scattered across pages.",
    exists: "Workspace and wallet state, the network and source table, and the construction boundaries.",
    missing: "Notification delivery, which needs somewhere to deliver to.",
    gate: "A notification channel with an opt-in contract.",
    route: `${BASE}/settings`,
    environment: "NONE",
    mode: "NONE",
    maturity: "AVAILABLE",
    lastVerifiedAt: READS_OBSERVED,
    guided: true,
  }),
  railed({
    id: "activity",
    group: "PROVE",
    label: "Activity",
    purpose: "Every action this workspace prepared, and what became of it.",
    detail:
      "Draft, blocked, awaiting authorization, authorized, signed, submitted, confirmed, reconciliation required, reconciled, failed — with the intent, the authorization, what the ledger recorded, whether expected matched actual, and the receipt behind each row. Kept in your browser and nowhere else: Ryntra has no account for this workspace and keeps no server-side record of anyone using it.",
    exists: "The whole lifecycle, recorded in place so one payment is one row, with a delete control and a stated cap.",
    missing: "Per-record permalinks, and export.",
    gate: "Reports, for a period with its evidence intact.",
    route: `${BASE}/activity`,
    environment: "TESTNET_ACTION",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: RETENTION_SHIPPED,
  }),
  railed({
    id: "receipts",
    group: "PROVE",
    label: "Receipts",
    purpose: "Recompute a receipt's hashes and read the ledger again, without trusting Ryntra.",
    detail:
      "Expected versus actual, bound to one transaction. Every hash on a receipt is recomputed in your browser from the receipt's own contents, and then the ledger is read again to see whether it still agrees — a document can be internally perfect and still describe a transaction that never happened. A bare transaction hash works here too, checked against the envelope the ledger stores rather than against an authorization.",
    exists: "Hash recomputation, an independent ledger re-read, reconciliation from the ledger's own envelope, and a fee-bump refusal by name.",
    missing: "Per-receipt permalinks and a public route that needs no workspace.",
    gate: "Verifier — the same checks on a public URL.",
    route: `${BASE}/receipts`,
    environment: "TESTNET_ACTION",
    mode: "READ_ONLY",
    maturity: "TESTNET_VERIFIED",
    lastVerifiedAt: LIFECYCLE_PROVEN,
    /* Guided as well, which takes it to the five destinations the workspace
       design allows and no further. Send without a way to check the receipt it
       produces is half a story, and the half that asks for trust. */
    guided: true,
  }),
  mapped({
    id: "verifier",
    group: "PROVE",
    label: "Verifier",
    purpose: "Anyone can check a Ryntra receipt without a wallet and without an account.",
    detail:
      "The same recomputation the Receipts page performs, on a public route: VERIFIED, NOT FOUND, TAMPERED, SUPERSEDED, or the one that matters most — transaction confirmed, authorization not proven. A receipt only a customer can verify is a customer-service tool, not evidence.",
    exists: "All of the checking. It runs today inside the workspace.",
    missing: "The public route, and per-receipt permalinks to hand somebody.",
    gate: "A public surface decision — this is the one that carries a claim.",
    environment: "TESTNET_ACTION",
    mode: "READ_ONLY",
    maturity: "IN_BUILD",
  }),
  mapped({
    id: "journal",
    group: "PROVE",
    label: "Journal",
    purpose: "What was decided, what happened, and what that changes next time.",
    detail: "The review half of the loop. A decision compared against its outcome produces at most a proposed next version — never an automatic change to the rules.",
    exists: "The ReviewRecord contract in the shared kernel.",
    missing: "Outcomes to review, which is Activity again.",
    gate: "Activity.",
    environment: "NONE",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  mapped({
    id: "reports",
    group: "PROVE",
    label: "Reports",
    purpose: "A period, exported, with every figure still pointing at its evidence.",
    detail: "An export that drops provenance is a spreadsheet of numbers somebody else has to trust. Each line keeps its transaction, its receipt and its observation time.",
    exists: "Provenance on every value, which is the property an export must not lose.",
    missing: "The period, the export and the format.",
    gate: "Activity.",
    environment: "NONE",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  railed({
    id: "developers",
    group: "BUILD",
    label: "Developers",
    purpose: "The read adapter, its sources and its declared boundaries.",
    detail: "What the adapter reads, from which source, and exactly what it refuses to do.",
    exists: "Every read, its source, and the refusals — including the client that rejects sendTransaction by name.",
    missing: "A published contract with support and rate limits.",
    gate: "Data API.",
    route: `${BASE}/developers`,
    environment: "NONE",
    mode: "NONE",
    maturity: "AVAILABLE",
    lastVerifiedAt: READS_OBSERVED,
  }),
  mapped({
    id: "data-api",
    group: "BUILD",
    label: "Data API",
    purpose: "The passport and its evidence as a machine-readable contract.",
    detail: "Every read already returns a data / sources / as_of / state envelope, so the shape exists. Publishing it is a separate decision about support and rate limits.",
    exists: "The envelope, enforced by the type system rather than by convention.",
    missing: "Publication: versioning, rate limits, and a support commitment.",
    gate: "A support decision, which is a business commitment rather than an engineering one.",
    environment: "MAINNET_DATA",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "guard-api",
    group: "BUILD",
    label: "Evidence API",
    purpose: "Decision and settlement evidence, as an API.",
    detail: "An API over the same Evidence Kernel this workspace uses. Stellar would be one venue behind it, never a separate product.",
    exists: "The kernel, its schemas and its receipt contract, source-verified in the product.",
    missing: "The Stellar binding and the tenant boundary that a shared API requires.",
    gate: "A registered platform task, and a security review before any tenant boundary ships.",
    environment: "NONE",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  mapped({
    id: "mcp",
    group: "BUILD",
    label: "MCP",
    purpose: "The same evidence, readable by an assistant that cannot act on it.",
    detail: "Read tools only. An assistant may explain, formalize, compare and review; it never supplies a missing fact, decides a policy, authorizes, signs or executes — and a read-only surface is how that boundary stays structural rather than promised.",
    exists: "The boundary, stated in the operating contract and enforced by having no key.",
    missing: "The server, and the scope decision about what an assistant may read.",
    gate: "Evidence API.",
    environment: "NONE",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  mapped({
    id: "sdk",
    group: "BUILD",
    label: "SDK",
    purpose: "The lifecycle and its receipt, callable from your own code.",
    detail: "Publishing a package is a support commitment: a version somebody depends on cannot be quietly changed. Registered here, deliberately unpublished.",
    exists: "The lifecycle, typed and tested, inside this repository.",
    missing: "Packaging, versioning and the support commitment that comes with publication.",
    gate: "Evidence API, then an explicit publication decision.",
    environment: "NONE",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  mapped({
    id: "webhooks",
    group: "BUILD",
    label: "Webhooks",
    purpose: "Be told when something settled, without polling for it.",
    detail: "Delivery is the easy half. The hard half is that a webhook consumer must be able to verify what it was told, which means the payload carries the same receipt anyone else could check.",
    exists: "The receipt, and independent verification of it.",
    missing: "Delivery, retries, and signing.",
    gate: "Evidence API.",
    environment: "NONE",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  mapped({
    id: "billing",
    group: "BUILD",
    label: "Usage & Billing",
    purpose: "What was used, what it costs, and what stays free regardless.",
    detail: "Truth and safety are never behind a paywall: what a person can learn about an asset they hold, and whether an action is blocked, remain free of charge whatever else is metered.",
    exists: "Nothing. There is no paid path in this product.",
    missing: "Everything, and it is gated on evidence that anyone wants to pay before it is built.",
    gate: "The registered billing gate.",
    environment: "NONE",
    mode: "NONE",
    maturity: "PLANNED",
  }),
];

export const STELLAR_MAP_GROUPS: readonly { group: StellarModuleGroup; title: string }[] = [
  { group: "HOME", title: "Home" },
  { group: "OBSERVE", title: "Observe" },
  { group: "MOVE", title: "Move" },
  { group: "TREASURY", title: "Treasury" },
  { group: "CONTROL", title: "Control" },
  { group: "PROVE", title: "Prove" },
  { group: "BUILD", title: "Build" },
];

/* The words a reader sees are `environmentChip` in `parts.tsx`, deliberately in
   one place: the label depends on `mode` as well as `environment` — a testnet
   surface that signs and one that only verifies are not the same claim — so a
   second lookup table keyed on environment alone would be a list that cannot
   agree with the first. */

export function stellarModule(id: string): StellarModule | undefined {
  return STELLAR_MODULES.find((entry) => entry.id === id);
}

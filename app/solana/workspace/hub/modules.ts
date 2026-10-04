import type { WorkspaceLocale } from "@/app/shell/locale";
import { translateSolana } from "../i18n/catalog.ts";

/**
 * The Solana Hub module registry.
 *
 * Same discipline as the Stellar Hub, for the same reason: **a rail
 * entry without a page is the most expensive mistake this file can make**, so
 * `railed()` throws rather than rendering a destination that does not exist.
 *
 * This file used to carry a second job, and it was removed on 2026-09-03. The
 * old rule read: *the sidebar must carry Markets, Swap and Strategy
 * gate-named — visible where a person looks for them, never rendered as
 * finished*, and `gated()` existed to put a routeless module into the Pro rail
 * with its gate showing. The rail no longer projects routeless
 * entries at all, so `gated()` and `mapped()` now differ only in that `gated()`
 * asserts its gate names something. The invariant that matters is unchanged and
 * is enforced by construction: a routed module has been verified, and a module
 * without a route cannot pretend to have one.
 *
 * What replaced the rail's job is this registry doing it properly. Eighteen
 * capabilities that were rail rows tagged `Soon` are registered here instead,
 * each with what exists, what does not, and the condition that moves it —
 * which is the description the rail could never carry, because a rail row has
 * room for a label and a badge and nothing else.
 *
 * ## Four independent facts, not one word
 *
 * Inherited from the Stellar registry, where a single `maturity` word was
 * doing four jobs and getting three wrong:
 *
 * ```text
 * environment     which network's facts this surface deals in
 * mode            what it is allowed to do there
 * maturity        how far it has actually come
 * lastVerifiedAt  when that was last true against a live source
 * ```
 *
 * ## The vocabulary has no Devnet in it
 *
 * This registry used to carry `DEVNET_ACTION`, `DEVNET_EXECUTION` and
 * `DEVNET_VERIFIED`, held there by a devnet-first ladder whose last rung was an
 * owner signature on a network where nothing has worth. That ladder is gone:
 * Solana is built as a mainnet product, Devnet is an optional internal
 * regression fixture and never a release gate, and the product names five
 * status axes. So the environment axis is `MAINNET · OFFCHAIN`, the mode axis
 * is `READ_ONLY · USER_SIGNED · NONE`, and the word above `AVAILABLE` is
 * `OWNER_CANARY_VERIFIED` — the M5 promotion word, earned per action family by
 * one owner-signed mainnet action, never by a devnet rehearsal.
 *
 * `NONE` survives on the mode axis because the named modes have no value for a
 * surface that touches no network at all, and calling the Settings page
 * `READ_ONLY` would claim a read it never performs. `PLANNED` survives on the
 * maturity axis for the same reason: the named maturity ladder stops at
 * `GATED`, and an accepted direction with no active work is not blocked on a
 * named condition.
 */

export type SolanaModuleGroup = "HOME" | "OBSERVE" | "TRADE" | "PROVE" | "BUILD" | "CONTROL";

/** Which network's facts a module deals in. */
export type SolanaModuleEnvironment =
  /** Solana mainnet — real mints, real balances, real consequences. */
  | "MAINNET"
  /** Touches no network — preferences, documentation, the map itself. */
  | "OFFCHAIN";

/** What a module is permitted to do in its environment. */
export type SolanaModuleMode = "READ_ONLY" | "USER_SIGNED" | "NONE";

/** How far a module has actually come. */
export type SolanaModuleMaturity =
  /** A real working surface. Reads only; moves nothing. */
  | "AVAILABLE"
  /** One owner-signed mainnet action of this family ran, reconciled and receipted. */
  | "OWNER_CANARY_VERIFIED"
  /** Built enough to open, not proven against a live source. */
  | "PREVIEW"
  /** Active work with a registered task. */
  | "IN_BUILD"
  /** An accepted direction with no active work. */
  | "PLANNED"
  /** Blocked on a named condition, stated on the card. */
  | "GATED";

export type SolanaModule = Readonly<{
  id: string;
  group: SolanaModuleGroup;
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
  environment: SolanaModuleEnvironment;
  mode: SolanaModuleMode;
  maturity: SolanaModuleMaturity;
  /** ISO date this state was last true against a live source, or null. */
  lastVerifiedAt: string | null;
  visibleInGuided: boolean;
  visibleInPro: boolean;
  searchable: boolean;
}>;

type Spec = Omit<SolanaModule, "visibleInGuided" | "visibleInPro" | "searchable">;

function railed(spec: Spec & { guided?: boolean }): SolanaModule {
  const { guided = false, ...rest } = spec;
  if (!rest.route) throw new Error(`Solana Hub module "${rest.id}" is railed but has no route.`);
  /* A surface a person can open has been observed working, or it should not be
     in the rail. A railed module with no verification date is a page nobody
     checked, described as though somebody had. */
  if (!rest.lastVerifiedAt) throw new Error(`Solana Hub module "${rest.id}" is railed with no lastVerifiedAt.`);
  return { ...rest, visibleInGuided: guided, visibleInPro: true, searchable: true };
}

/**
 * Registered with no page, and with an enforced gate.
 *
 * It once put the entry into the Pro rail as a disabled row; that ended on
 * 2026-09-03, so this is now a `mapped()` that additionally refuses a gate
 * that does not name the phase opening it — *a gated entry whose gate says
 * nothing is a "coming soon" badge, which is the thing this registry forbids*.
 * That rule is the reason to keep the helper rather than fold it away, and
 * `surfaces.test.mjs` applies a matching rule to every entry in the file
 * however it was constructed.
 */
function gated(spec: Omit<Spec, "route" | "lastVerifiedAt">): SolanaModule {
  if (!/\bPhase [A-F]\b/.test(spec.gate)) {
    throw new Error(`Solana Hub module "${spec.id}" is gated without naming the phase that opens it.`);
  }
  return {
    ...spec,
    route: null,
    lastVerifiedAt: null,
    visibleInGuided: false,
    visibleInPro: true,
    searchable: false,
  };
}

/**
 * Registered architecture. Renders on the Hub Map and nowhere else.
 *
 * `lastVerifiedAt` is optional here and defaults to null, because most mapped
 * entries are directions with nothing to verify. One is not: the public
 * evidence kit exists and was checked, it simply lives in a repository rather
 * than behind a route in this workspace. Forcing null on it would print
 * "Never — nothing to verify yet" beside `AVAILABLE`, which is a contradiction
 * the map would state in its own two columns.
 */
function mapped(spec: Omit<Spec, "route" | "lastVerifiedAt"> & { lastVerifiedAt?: string }): SolanaModule {
  return {
    ...spec,
    route: null,
    lastVerifiedAt: spec.lastVerifiedAt ?? null,
    visibleInGuided: false,
    visibleInPro: false,
    searchable: false,
  };
}

const BASE = "/solana/workspace";
/* M1B's own constant retired with the copy that cited it; its verified time
   survives in `recorded-m1b.ts` and its evidence file, which is where a fact
   about a closed run belongs. */
/* Receive has no transaction to date itself by: it produces a URL and reads a
   balance list. This is the day the surface was built and looked at. */
const RECEIVE_VERIFIED_AT = "2026-09-03T00:00:00.000Z";
/* The day the wallet-scoped action ledger and the History surface over it were
   built and looked at. */
const HISTORY_VERIFIED_AT = "2026-09-03T00:00:00.000Z";
/** The M1 transfer's own block time, not the moment its receipt was written. */
const M1_VERIFIED_AT = "2026-09-01T16:19:31.000Z";
const M2_VERIFIED_AT = "2026-09-01T11:55:21.403Z";

/* The day the shell, the passport surface and the live mainnet reads behind
   them were verified rendered — geometry measured and looked at. */
const SHELL_SHIPPED = "2026-08-17";

/* The day the public evidence kit was last checked the way a stranger checks
   it: `ryntra-io/ryntra-solana-evidence` rebuilt on fresh history, cloned from
   GitHub into an empty directory, installed from its own lockfile, 43 tests
   green. Not the day it was first published — the day the current repository
   was verified. */
const KIT_VERIFIED = "2026-08-26";

export const SOLANA_MODULES: readonly SolanaModule[] = [
  railed({
    id: "overview",
    group: "HOME",
    /* "Overview" in the registry against "Market overview" in the rail was one
       thing with two names on two screens. The rail reads this field now, so
       the longer name — the one that says what the page is an overview OF —
       wins in both places. */
    label: "Market overview",
    purpose: "What this workspace reads live, which issuer powers sit on real mints, and what waits on which gate.",
    detail:
      "Mission control for a read-only workspace: the mainnet epoch as the endpoint answered it, issuer powers across the six verified mints, and the registry's own account of what exists against what is registered with a gate.",
    exists: "Live epoch read, live issuer-power rows over the six fixture-verified mints, and the module ledger.",
    missing:
      "Watched mints, and a resting summary of recent activity. History has its own page now; this screen does not yet carry a view of it.",
    gate: "The watchlist waits on Phase B's retention decision. A summary of History on this screen is a separate piece of work.",
    /* Market overview moved off the product root on 2026-09-04: the root is
       Home now, and a catalogue of mints is where Markets opens. */
    route: `${BASE}/markets`,
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: SHELL_SHIPPED,
    guided: true,
  }),
  railed({
    id: "assets",
    group: "OBSERVE",
    label: "Asset Passports",
    purpose: "Paste a mint address and read what it structurally is — and share the read as a link.",
    detail:
      "The Solana Asset Passport: exact identity, what the issuer can do to a holding (mint, freeze, and every transfer-affecting Token-2022 extension), every extension with its provenance, and a permanent unknowns rail. The page's address is the shareable deep link; opening it re-reads the chain.",
    exists:
      "The full passport over any mainnet mint — SPL or Token-2022 — with provenance on every field, plus six real mints to start from.",
    missing: "Off-chain metadata (name, logo, issuer's own description), price, liquidity and holder concentration.",
    gate: "Phase B data adapters for metadata and prices; the scanner for concentration.",
    route: `${BASE}/assets`,
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: SHELL_SHIPPED,
    guided: true,
  }),
  gated({
    id: "markets",
    group: "OBSERVE",
    /* `Market universes`, not `Markets`. The product has a domain called
       Markets and it opens today; this row is the curated-universe view that
       does not, and the two carried one word between them. On the Hub Map that
       was a reader's puzzle, and on the public Product Map — where the same
       registry is projected for people with no registry — it read as
       `Markets · Planned` beside a working Markets domain, which is the
       opposite of true. The label now says what the purpose line already did. */
    label: "Market universes",
    purpose: "Curated market universes with prices, metadata and freshness on every read.",
    detail:
      "Token lists and prices from named providers, compared rather than trusted singly, over curated universes — tokenized assets, majors, stables — with a stated method and never a claimed index. The live quote path already runs on the Swap surface; this module is the market view around it.",
    exists: "The quote adapter and venue health, live on Swap since the swap preview shipped.",
    missing: "Market data adapters (prices, metadata, OHLCV decision), the universes and the page.",
    gate: "Phase B — the data adapters, and separately the universes and watchlist.",
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "universe",
    group: "OBSERVE",
    label: "Universes & Watchlist",
    purpose: "Curated sets of tokenized assets, majors and stables — and a watchlist that stays in your browser.",
    detail:
      "Curated means curated: Solana has no asset index this product reads, so coverage is a set with a stated method, never a market. The watchlist follows the Stellar retention decision — browser-local, deletable, nowhere else.",
    exists: "Nothing. The curated-scope discipline is inherited from the Stellar Observe slice, where it is enforced in the type.",
    missing: "The universes, the page, and the local store.",
    /* The gate used to name work that was superseded on 2026-08-26. A gate
       that names retired work names nothing. */
    gate: "Phase B — Radar and the data-coverage truth model, which owns the curated-scope discipline this needs.",
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "scanner",
    group: "OBSERVE",
    label: "Scanner",
    purpose: "Structural facts across many mints at once — never a score.",
    detail:
      "Liquidity depth, pool age, holder concentration, authorities present, extension risk flags, price change. Facts with provenance, filterable; UNKNOWN stays UNKNOWN instead of defaulting to reassurance.",
    exists: "Nothing. The per-mint facts it would aggregate are the passport's, already read with provenance.",
    missing: "The multi-mint read path, the filters and the saved-scan store.",
    gate: "Phase B — the scanner itself.",
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  railed({
    id: "trade",
    group: "TRADE",
    label: "Swap",
    purpose: "A live mainnet swap quote for any pair, and your own wallet's signature to execute it.",
    detail:
      "Jupiter Swap API V2's exact order fields — quote, minimum received, total/platform/priority fees, router, mode, route and a bounded Review window — beside both Asset Passports and the thirteen-rule policy verdict. One owner-signed USDC to SOL canary finalized and reconciled; its immutable receipt is valid and carries a separate public correction for two legacy provenance labels.",
    exists:
      "One exact 2.622093 USDC to 0.025621005 SOL transaction is finalized, independently read by two RPC operators and bound to a signed receipt plus an exact-hash correction record. The full keyed production surface still quotes routed pairs and amounts behind the same evidence and wallet controls.",
    missing: "One exact owner canary verifies this action family; it does not guarantee every pair, amount, route or future landing, and it creates no autonomous or public execution authority.",
    gate: "None. Swap is closed as a product; every later swap still requires a fresh route, an exact Review and the person's own visible wallet signature.",
    route: `${BASE}/swap`,
    environment: "MAINNET",
    mode: "USER_SIGNED",
    maturity: "OWNER_CANARY_VERIFIED",
    lastVerifiedAt: M2_VERIFIED_AT,
    guided: true,
  }),
  /*
   * The transfer between chains: recorded, and no longer a surface.
   *
   * Since 2026-09-08 the cross-chain swap replaces the bridge. The capability
   * did not go anywhere — the same Circle CCTP V2 engine runs, signed in the
   * person's own wallet, mounted by Swap for the one class of pair that is the
   * same asset on two networks — but it has no page, no rail row and no route
   * of its own, so the record is `mapped` rather than `railed`. Deleting the
   * record instead would erase the owner canary of 2026-09-02 that proved it,
   * which is a fact about what this product has done rather than a fact about
   * where a menu points.
   */
  mapped({
    id: "bridge",
    group: "TRADE",
    label: "Transfer between networks",
    purpose: "Move native USDC between Solana and Base through Circle CCTP V2, signed in your own wallet.",
    detail:
      "A burn on the source chain, Circle's attestation, a mint on the destination, and a Bridge Receipt that reconciles both sides from endpoints that did not build the transfer. Recovery is message-first, so a closed tab or a slow confirmation is a state you can resume from rather than a transfer you have lost.",
    exists:
      "The Solana to Base direction, for any amount your balance and the provider allow. One owner-signed transfer of 2 USDC is finalized and reconciled MATCHED on both chains, with a receipt the public verifier reads as valid.",
    missing:
      "The Base to Solana direction, provider-driven token and route discovery, and live provider minimums and maximums.",
    gate: "Waits on the reverse leg, which is a build, not a switch: an ERC-20 approve, a Base depositForBurn encoder, a Solana receiveMessage builder and a chain-tagged duplicate-burn claim.",
    environment: "MAINNET",
    mode: "USER_SIGNED",
    maturity: "OWNER_CANARY_VERIFIED",
    lastVerifiedAt: "2026-09-02",
  }),
  gated({
    id: "strategy",
    group: "TRADE",
    label: "Strategy",
    purpose: "Formalize a strategy, test it on history, prove it on paper — before it touches a venue.",
    detail:
      "The Strategy Lab core exists in this product for other markets. Binding it to Solana instruments — specs, historical data with provenance, deterministic backtests, walk-forward, paper trading — is its own registered phase, and pretending a binding exists before it does is what this card exists to prevent.",
    exists: "The chain-neutral Strategy Lab kernel, live elsewhere in the product.",
    missing: "Every Solana binding: instruments, data, backtests, paper lifecycle.",
    gate: "Phase C — all seven of its steps.",
    environment: "OFFCHAIN",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  railed({
    id: "receipts",
    group: "PROVE",
    label: "Receipts",
    purpose: "Open signed Solana Outcome Receipts and independently check what each one proves.",
    detail:
      "Three immutable observations. The M1 Send receipt reconciled MATCHED with no deviation to record. M1B's preserves the deviation it found rather than reissuing a cleaner one, and M2's carries a hash-bound public correction naming the two inaccurate provenance sentences it shipped with.",
    exists: "The signed M1 Send Outcome Receipt, the signed M1B Outcome Receipt, the signed M2 Swap Outcome Receipt with its hash-bound correction, explorer proofs and both verifier paths.",
    missing: "No Bridge or Token-2022 receipt exists.",
    gate: "Send and Swap are closed for their exact proved actions. The bridge canary and the Token-2022 canary remain separate action-family gates.",
    route: `${BASE}/receipts`,
    environment: "OFFCHAIN",
    mode: "NONE",
    maturity: "AVAILABLE",
    lastVerifiedAt: M1_VERIFIED_AT,
    guided: true,
  }),
  railed({
    id: "send",
    group: "PROVE",
    label: "Send",
    purpose: "One real transfer: built, simulated, signed in the owner's wallet, observed independently, reconciled, receipted.",
    detail:
      "The first Solana transaction this product stands behind. The wallet is yours, the signature is yours, and the observation is an independent read-back — Ryntra holds no key and asks the wallet to sign rather than to sign-and-send, so a comparison still happens between your approval and the network. A deviation records as a deviation, never rounded to a match.",
    exists:
      "Two exact owner-signed transfers are finalized on Solana Mainnet. M1 moved 0.5 USDC to a recipient who already held an account and reconciled MATCHED — the first Solana receipt this product matched outright. M1B proved the harder shape before it, creating the recipient's account and paying its rent. Both were wallet-signed, submitted once and read back by two independent RPC operators.",
    missing:
      "Neither proof promotes an amount, a destination or an asset beyond the ones actually sent. Nothing here executes on anyone's behalf: every transfer still needs a fresh build, a fresh simulation and the owner's own wallet confirmation.",
    gate: "Send is proved for owner-signed classic SPL transfers. Supported Token-2022 cases wait on the Token-2022 canary, and Send as a finished product waits on its own production step.",
    route: `${BASE}/send`,
    environment: "MAINNET",
    mode: "USER_SIGNED",
    maturity: "OWNER_CANARY_VERIFIED",
    lastVerifiedAt: M1_VERIFIED_AT,
    guided: true,
  }),
  railed({
    id: "holdings",
    group: "OBSERVE",
    label: "Holdings",
    purpose: "What this wallet owns, and what it is worth where a price exists.",
    detail:
      "One list rather than a wall of widgets, because the question is 'what do I have'. Read live from the connected address across both token programs, priced from the token catalogue where the catalogue has a price. An asset nobody prices shows a dash and is counted separately from the total, never as zero.",
    exists:
      "Live balances for the connected wallet, native SOL and every non-zero SPL and Token-2022 account, with search, a value total and an explicit count of what could not be priced. Money that has left and not yet settled is counted above the total rather than folded into it. An unreadable balance renders as unreadable rather than as an empty wallet.",
    missing:
      "Per-chain totals for a linked EVM wallet. A Solana wallet and an EVM wallet are not one person because both are open in one browser, so this waits on each being signed for explicitly.",
    gate: "Multi-chain totals wait on the wallet sign-in that proves ownership, and this repository has no Solana sign-in yet.",
    route: `${BASE}/holdings`,
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: RECEIVE_VERIFIED_AT,
    guided: true,
  }),
  railed({
    id: "journal",
    group: "PROVE",
    label: "History",
    purpose: "Every transfer this wallet made here, and where each one is right now.",
    detail:
      "One list, keyed by the connected wallet rather than by the browser it was started in. A transfer that is still moving says so; one waiting on a step only this person can take says that instead, because telling somebody to wait for themselves is the worst thing this screen could do. State is read back from the lane that owns it on every load, so a row cannot age into a lie.",
    exists:
      "Send, Swap and Bridge write to a wallet-first action ledger, and this reads it back for the connected address with the current state of each lane. A swap that never came back can be asked what happened, from any browser that connects the wallet.",
    missing:
      "Transfers made before this ledger existed, and any made outside Ryntra: both are on the chain and not in here, and the page says so rather than implying the wallet did nothing. Swap amounts are unlabelled because that lane stores no decimals anywhere.",
    gate: "Full onchain reconstruction is not planned yet. The private half is notes: wallet-scoped private data that waits on Solana sign-in.",
    route: `${BASE}/history`,
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: HISTORY_VERIFIED_AT,
    guided: true,
  }),
  railed({
    id: "receive",
    group: "PROVE",
    label: "Receive",
    purpose: "Your address to be paid, or a request for an exact amount of an exact token.",
    detail:
      "Two jobs on one card. The address, with a QR any Solana wallet can scan, is the one most people need. A payment request adds a token, an amount and a note, and carries a reference so this request can be told apart from any other for the same amount — which a wallet address alone cannot do.",
    exists:
      "The address as a scannable code, and a payment request as a normal link — https://ryntra.io/pay/<id> — that opens in any browser with the amount, the token, what it is for, who is paid and until when, a code for phone wallets and Pay with wallet in the browser. Ryntra watches the request's own reference on chain and says Awaiting, Paid or Expired; a paid request appears in Activity. The payer signs with their own wallet; nothing here signs.",
    missing:
      "A Payment Receipt for what somebody else sent you: Activity shows the received payment with its transaction, and the receipt model does not yet describe an incoming transfer.",
    gate: "Phase B — subscriptions, allowances and the wider payments business tools. The incoming-payment receipt waits on the receipt model naming an incoming transfer.",
    route: `${BASE}/receive`,
    environment: "MAINNET",
    /* Read-only in the exact sense: this surface has no transaction builder and
       no signer. What it produces is a URL. */
    mode: "READ_ONLY",
    maturity: "AVAILABLE",
    lastVerifiedAt: RECEIVE_VERIFIED_AT,
    guided: true,
  }),
  railed({
    id: "developers",
    group: "BUILD",
    label: "Developers",
    purpose: "The read adapter, its sources, its published contracts and its refusals.",
    detail:
      "Every read this workspace performs, from which endpoint, under which timeout — and the exact things the kit refuses to do. The passport and preflight contracts are published as JSON Schemas generated from the source types, with a parity test that fails on drift.",
    exists:
      "The registry entry, four published schemas, the RPC source table, the refusal list — and the public evidence kit itself, Apache-2.0 at `ryntra-io/ryntra-solana-evidence`.",
    missing: "A package-registry release. The kit is cloned and run from source; nothing is published to npm.",
    gate: "None for the kit — it shipped public. A registry release is its own separate operator decision.",
    route: `${BASE}/developers`,
    environment: "OFFCHAIN",
    mode: "NONE",
    maturity: "AVAILABLE",
    lastVerifiedAt: SHELL_SHIPPED,
  }),
  mapped({
    id: "sdk-mcp",
    group: "BUILD",
    label: "SDK & MCP",
    purpose: "The same evidence, callable from your own code and readable by an assistant that cannot act on it.",
    detail:
      "`inspect_solana_mint`, `preflight_solana_action`, `verify_solana_receipt` — read tools only. An assistant may explain, formalize, compare and review; it never supplies a missing fact, decides a policy, authorizes, signs or executes.",
    exists:
      "The whole kit, public and Apache-2.0 at `ryntra-io/ryntra-solana-evidence`: the typed SDK, the local stdio MCP server, the CLI, the four schemas and a green verify workflow. It holds no key and has no signing path — that is a property of the kit, not a gap in it.",
    missing: "Nothing in scope. A write tool is not planned: an assistant that could sign is the boundary this kit exists to hold.",
    gate: "None. The kit is published; a package-registry release is a separate operator decision, not a gate on this module.",
    environment: "OFFCHAIN",
    mode: "NONE",
    maturity: "AVAILABLE",
    lastVerifiedAt: KIT_VERIFIED,
  }),
  railed({
    id: "settings",
    group: "CONTROL",
    label: "Settings",
    purpose: "Which network is read, how the owner-canary policy is bounded, and what this workspace structurally cannot do.",
    detail:
      "The endpoint table, the enforced 20 USD owner-canary package with per-family allowlists and durable exposure, the operator emergency stop, and the boundary list. The public page can read policy state and cannot mutate it.",
    exists: "Network facts, policy limits, durable ledger boundary, verdict vocabulary and the fail-closed operator switch state.",
    missing: "Nothing in scope for this module.",
    gate: "None.",
    route: `${BASE}/settings`,
    environment: "OFFCHAIN",
    mode: "NONE",
    maturity: "AVAILABLE",
    lastVerifiedAt: SHELL_SHIPPED,
    guided: true,
  }),
  mapped({
    id: "policy",
    group: "CONTROL",
    label: "Owner policy",
    purpose: "The thirteen dials that decide what a transfer may do before anyone signs it.",
    detail:
      "The evidence policy remains thirteen dials. The owner-canary layer adds an immutable package/family budget, destination/mint/program allowlists, durable submit-once exposure and ALLOW / REVIEW / BLOCK / PAUSE / UNKNOWN under a fail-closed operator switch.",
    exists:
      "Both deterministic engines: the thirteen-rule evidence policy and the durable owner-canary policy. Send binds both verdicts into one issuer-signed Review bundle; Settings renders the canary control plane read-only.",
    missing: "A general user-editable policy builder. The canary switch remains operator configuration, never an unauthenticated browser control.",
    gate: "None for the enforced owner-canary policy. A general policy editor belongs to a later bounded control task.",
    environment: "OFFCHAIN",
    mode: "NONE",
    maturity: "AVAILABLE",
    lastVerifiedAt: "2026-08-27",
  }),

  /* ── The capabilities that left the rail, 2026-09-03 ──────────────────────
     The rule: a future capability stays registered and does not occupy
     primary working navigation until it has a real user route. These thirteen
     were rail rows tagged `Soon`, which is how they came to be described
     without ever being registered — the rail typed their labels by hand and
     nothing here had to be true about them.
     Every `exists` below was checked against this repository rather than
     inferred from intent, and "Nothing is built." is written where that is the
     answer. Three of them are not empty and say so: `alerts` has a working
     Home surface with no Solana projection, `payments` has the URL half of a
     payment request already shipping inside Receive, and `provider-status` has
     a tested health engine running in production and no surface at all. */

  mapped({
    id: "launches",
    group: "OBSERVE",
    label: "Launches",
    purpose: "New mints and new pools, with how little is known about them stated first.",
    detail:
      "A new token is the case where coverage matters most and exists least: no price history, no holder history, often no metadata beyond what the issuer wrote. Anything here has to lead with what is unknown rather than rank on what little is known.",
    exists: "Nothing is built.",
    missing:
      "Pool-creation and mint-age discovery, a candidate list, and the coverage model that would make such a list readable rather than a leaderboard.",
    gate: "Phase B — Radar and the data-coverage truth model, which owns discovery and the coverage vocabulary this needs.",
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "flow",
    group: "OBSERVE",
    label: "Market flow",
    purpose: "Where volume actually went, and how much of that is one address.",
    detail:
      "Net flow, large trades and liquidity change over time. Its value is entirely in the coverage statement beside it: a flow figure assembled from partial sources is a confident number about an unknown quantity.",
    exists: "Nothing is built.",
    missing:
      "Buy and sell volume, net flow, large-trade observation, liquidity and holder change, and any aggregation across sources.",
    gate: "Phase B — Radar and the data-coverage truth model.",
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "wallet-intelligence",
    group: "OBSERVE",
    label: "Wallet intelligence",
    purpose: "What a set of addresses has done, without pretending to know who they are.",
    detail:
      "Clustering and labelling addresses is the easiest place in this product to state a guess as a fact. Nothing here may name a person, and a cohort has to carry the method that built it.",
    exists: "Nothing is built. This repository reads a wallet only when somebody hands it one, and tracks no address.",
    missing: "Clustering, labelling, cohorts, ranking and any tracking of an address the person did not supply.",
    gate:
      "No work is planned for this yet. It is the least-planned part of the Radar family, and its own work would have to follow Phase B's Radar, because the coverage model comes first.",
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "rwa-markets",
    group: "OBSERVE",
    label: "RWA markets",
    purpose: "Tokenized real-world assets on Solana, with the issuer's powers stated before the price.",
    detail:
      "A tokenized share is a claim with a controller, a jurisdiction and a schedule. The passport discipline this workspace already applies to a mint is the part that transfers; the market data is not the hard half.",
    exists:
      "Nothing on Solana. A real tokenized-asset kernel exists in this repository and every line of it is Robinhood Chain: ERC-8056 multipliers and eth_call, with no mint, no SPL or Token-2022 and no Solana RPC in it.",
    missing:
      "Any Solana-side tokenized-asset read: the mint-level passport for an RWA, the issuer-power model in SPL terms, and the market view over it.",
    gate: "Phase B — the Solana RWA passport and the Pro view.",
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "alerts",
    group: "OBSERVE",
    label: "Alerts",
    purpose: "Being told when something you hold changes, rather than finding out by opening a page.",
    detail:
      "Alerts belong to Home, because the question is about a person's whole position and not one network's slice. What Solana owes is the projection: the events worth waking somebody for, and the freshness behind each one.",
    exists:
      "A real Alerts surface, and it is Home's rather than Solana's: /app/alerts renders over lib/home/alerts/channels.ts with routing and delivery already built.",
    missing:
      "The Solana projection. Nothing in the Home alert machinery mentions Solana, and no Solana event can raise an alert today.",
    gate:
      "No Solana work is planned for Alerts yet. Their categories are already fixed, and the Home surface they project into already exists.",
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),
  mapped({
    id: "creator-insights",
    group: "OBSERVE",
    label: "Creator & Treasury",
    purpose: "For the people who issued a token: who holds it, where it moved, and what the treasury did.",
    detail:
      "This is the business side of the same passport read — holder concentration, large exits, treasury balances and team approvals. It is a different reader with a different job, not a Pro version of the consumer page.",
    exists: "Nothing is built. There is no treasury, multi-signer or team-approval machinery in the Solana lane.",
    missing:
      "Holder counts and concentration, treasury balances, large-exit observation, project events, and any multi-signer approval path.",
    gate: "No work is planned for this capability yet. Its scope is defined, and Business Tools open through Settings rather than the rail.",
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "PLANNED",
  }),

  /*
   * Spot is live since 2026-09-11. `AVAILABLE` rather than
   * `OWNER_CANARY_VERIFIED` because the fill that would prove the family from
   * this surface is an owner-signed act and has not been observed yet; the
   * engine underneath is the one Swap's canary proved. The public map reads
   * both words as AVAILABLE, and the receipt is where the evidence belongs.
   */
  mapped({
    id: "spot",
    group: "TRADE",
    label: "Spot",
    purpose: "One market terminal: find an asset, see its real price and chart, and buy or sell it with your own signature.",
    detail:
      "Markets with search and a watchlist; Crypto, Memes and Stocks/RWA as categories from Jupiter's own tags; real candles from a pool that is provably the market; an order ticket with the exact costs; the wallet's holding and fills below. Market Buy and Sell run the same direct Jupiter order and execute path Swap runs.",
    exists: "Live at /app/spot since 2026-09-11: the markets, the chart, the ticket, the server-side watchlist, the Activity row that reads Spot Buy or Spot Sell, and a settled fill shown as a fill. Every category trades, tokenized stocks and RWA included, with the issuer named on the ticket; the first Spot fill landed on 2026-09-11.",
    missing: "Standing orders (Limit, TP-SL) and an order book.",
    gate: "None for Market Buy and Sell. Standing orders wait on an Advanced Orders decision; a tokenized stock trades under its issuer's terms, which the ticket names.",
    environment: "MAINNET",
    mode: "USER_SIGNED",
    maturity: "AVAILABLE",
  }),
  /*
   * Predictions — the only new first-class page of the target structure
   * (2026-09-11), visible and locked. The aggregator integration is not
   * implemented and the page carries no odds, balances or trading actions; the
   * record exists so the public map can show the direction without the app
   * pretending to have it.
   */
  mapped({
    id: "predictions",
    group: "TRADE",
    label: "Predictions",
    purpose: "Markets on outcomes — crypto, macro, business, politics, sports — through aggregated venues.",
    detail:
      "Discovery across venues with the same question priced side by side, a position opened and closed through Review with the person's own signature, its result in Activity, and prediction signals beside the markets they refer to. Prediction detail lives inside the page and is never a row of its own.",
    exists: "A visible locked page at /app/predictions that states what it will own. No market, odd, balance or trading action is shown.",
    missing: "The aggregator integration: market discovery, pricing, order construction, settlement and the signals. Partner/API access has been requested and is pending.",
    gate: "A separate surface only after its own data, custody, risk and canary gate — and, before that, the aggregator's partner/API access, requested and pending.",
    environment: "MAINNET",
    mode: "USER_SIGNED",
    maturity: "PLANNED",
  }),
  mapped({
    id: "trigger",
    group: "TRADE",
    label: "Limit & DCA",
    purpose: "An order that waits, and a schedule that keeps buying — each with the custody question answered first.",
    detail:
      "A limit order that waits has to hold funds somewhere, and a schedule that keeps buying acts while nobody is watching. Both are custody questions before they are trading features, which is why the product puts Schedule → notification → fresh evidence → fresh quote → Review → wallet signature in that order.",
    exists: "Nothing is built. There is no Trigger or Recurring adapter in this repository.",
    missing:
      "The order construction, the custodial-vault deposit, withdrawal and recovery path, and the DCA schedule with its per-draw Review.",
    gate:
      "The blocking condition is named rather than dated: the custody disclosure and the withdrawal path must exist before an order may wait on anyone's funds.",
    environment: "MAINNET",
    mode: "USER_SIGNED",
    maturity: "GATED",
  }),
  mapped({
    id: "grid",
    group: "TRADE",
    label: "Grid",
    purpose: "A strategy with defined price levels and a fixed budget.",
    detail: "Grid remains a planned strategy pattern; the builder and execution adapter are not implemented.",
    exists: "The strategy direction is accepted; there is no Grid execution engine.",
    missing: "A grid specification, simulation, limits, execution provider and user-authorized lifecycle.",
    gate: "Waits on the Grid builder, simulation and a separate execution acceptance.",
    environment: "MAINNET",
    mode: "NONE",
    maturity: "PLANNED",
  }),
  mapped({
    id: "perps",
    group: "TRADE",
    label: "Perps",
    purpose: "Leveraged positions, which is the one place on this product where a person can lose more than they put in.",
    detail:
      "Funding, margin and liquidation are the whole feature; the order ticket is the easy part. The product sets a five-rung ladder for exactly that reason, and nothing about it is reachable by extending Swap.",
    exists: "Nothing is built. There is no perps client, market read, position, funding, margin or liquidation model in the Solana tree.",
    missing:
      "A venue adapter, market and funding reads, position and margin state, leverage input, liquidation-price calculation, and the paper rung that has to come before any of it moves money.",
    gate: "The perps release ladder, whose first rung is a read-only market and position model with no order path at all.",
    environment: "MAINNET",
    mode: "USER_SIGNED",
    maturity: "GATED",
  }),
  mapped({
    id: "payments",
    group: "TRADE",
    label: "Payments",
    purpose: "Ask someone for a payment, and know when it actually arrived.",
    detail:
      "The link is the easy half. What makes a payment request a product is everything after it: an expiry, the expected amount against the observed one, and a receipt for the person who paid as well as the person who asked.",
    exists:
      "The URL half, and it ships inside Receive rather than a Payments surface: buildSolanaPayUrl produces a real Solana Pay transfer request with recipient, amount, SPL token and reference.",
    missing:
      "Everything after the URL — expiry, policy, observed payment, expected against actual, and the Receipt a payment request requires.",
    gate: "Phase B — Payments, subscriptions, x402 and agents, as Business Tools rather than a consumer hero.",
    environment: "MAINNET",
    mode: "USER_SIGNED",
    maturity: "PLANNED",
  }),
  mapped({
    id: "subscriptions",
    group: "TRADE",
    label: "Subscriptions & x402",
    purpose: "A recurring charge you can see, cap and stop.",
    detail:
      "An allowance is a promise about the future, so the whole feature is the revoke path and the cap — not the charge. The shape is fixed: a delegate with a cap, a cadence, an expiry, and expected draws recorded against actual ones.",
    exists: "Nothing is built in the Solana lane. x402 and B402 appear nowhere under lib/solana or app/solana, and there is no allowance machinery.",
    missing:
      "The delegate, cap, cadence, expiry and revocation, the expected-against-actual draw record, and the receipts for each charge.",
    gate: "Phase B — the same work as Payments. It must implement the allowance shape described above.",
    environment: "MAINNET",
    mode: "USER_SIGNED",
    maturity: "PLANNED",
  }),

  mapped({
    id: "automation",
    group: "CONTROL",
    label: "Automation",
    purpose: "Something that acts while you are not looking — which is why it is a policy question, not a feature.",
    detail:
      "The ladder is fixed: watch, then paper, then prepare, and only then anything guarded. Agent Control is the product that would govern the last rung, and it currently pins execution off and human authorization on by contract.",
    exists:
      "Nothing is built. There is no scheduler, recurring action or unattended execution path in this repository, and Agent Control is structurally incapable of executing: its policy contract pins execution disabled and human authorization required.",
    missing: "Every rung above Prepare, and the Agent Control authorization path that would have to carry it.",
    gate: "No Solana automation work is planned yet. The ladder above governs it, and the Strategy Lab owns the rungs beneath it.",
    environment: "MAINNET",
    mode: "USER_SIGNED",
    maturity: "PLANNED",
  }),
  mapped({
    id: "provider-status",
    group: "BUILD",
    label: "Provider status",
    purpose: "Which provider answered, how fresh the answer was, and what to do when one is down.",
    detail:
      "This is the one capability here whose engine already exists and whose surface does not. The four provider states are implemented over the endpoint pair and are read on every request; nothing renders them.",
    exists:
      "The engine. lib/solana/health.ts implements the four states over the mainnet endpoint pair, with tests, running in production on every read.",
    missing: "The surface. No page, route or panel renders the health state anywhere in this workspace.",
    gate: "No work is planned for the surface yet. The contract — the provider list, the four states and the degraded-read discipline — is fixed, and the engine already satisfies it.",
    environment: "MAINNET",
    mode: "READ_ONLY",
    maturity: "PLANNED",
    lastVerifiedAt: "2026-09-03",
  }),
];

export const SOLANA_MAP_GROUPS: readonly { group: SolanaModuleGroup; title: string }[] = [
  { group: "HOME", title: "Home" },
  { group: "OBSERVE", title: "Observe" },
  { group: "TRADE", title: "Trade" },
  { group: "PROVE", title: "Prove" },
  { group: "BUILD", title: "Build" },
  { group: "CONTROL", title: "Control" },
];

export function localizedSolanaModules(locale: WorkspaceLocale): readonly SolanaModule[] {
  if (locale === "en") return SOLANA_MODULES;
  return SOLANA_MODULES.map((entry) => ({
    ...entry,
    label: translateSolana(locale, entry.label),
    purpose: translateSolana(locale, entry.purpose),
    detail: translateSolana(locale, entry.detail),
    exists: translateSolana(locale, entry.exists),
    missing: translateSolana(locale, entry.missing),
    gate: translateSolana(locale, entry.gate),
  }));
}

export function localizedSolanaMapGroups(locale: WorkspaceLocale) {
  return SOLANA_MAP_GROUPS.map((entry) => ({ ...entry, title: translateSolana(locale, entry.title) }));
}

export function solanaModule(id: string): SolanaModule | undefined {
  return SOLANA_MODULES.find((entry) => entry.id === id);
}

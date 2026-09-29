/**
 * The Product & Architecture Paper, as data.
 *
 * Twenty-nine chapters in the founder's frozen order. They live here rather than in
 * JSX for one reason that matters: a test can count them, check the order, and
 * assert that no chapter carries a status badge — which is the single rule that
 * keeps this document a paper instead of a roadmap.
 *
 * Every chapter is drawn from a canon document in `docs/products/`, from
 * `PRODUCT.md`, or from the security boundary — not written fresh here. The
 * paper is a projection of what was already established, which is why it can be
 * this short and still be complete.
 */

/**
 * The notice, and the reason this document is allowed to exist at all.
 *
 * Without it every paragraph would have to carry a status badge and the paper
 * would become a roadmap nobody can read. With it, the paper describes the
 * system and the register answers separately for what can be relied on today —
 * two different questions, asked by two different readers.
 *
 * It lives beside the chapters rather than in the route file for two reasons:
 * a Next.js route may not export an arbitrary value, and a constant a test can
 * import is a constant a copy edit cannot quietly soften.
 */
export const PAPER_NOTICE =
  "This paper describes the product architecture and design direction. It is not a statement that every described capability is currently available. See Current Capabilities for release truth.";

export type Chapter = Readonly<{ title: string; body: string }>;

export const PAPER_CHAPTERS: readonly Chapter[] = [
  {
    title: "Executive thesis",
    body: "Ryntra is a venue-neutral Risk, Strategy & Evidence OS for programmable assets. It connects what an asset or action is, what evidence exists, what is missing, which rule applies, what the person actually authorizes, what external infrastructure executes, what actually happened, and what should be remembered next. The canonical line: AI structures. Evidence supports. Rules validate. Humans authorize. Receipts prove.",
  },
  {
    title: "The problem",
    body: "Fast execution is not a correct decision, and a confirmed transaction is not proof that what was intended is what occurred. Every venue optimises the click. Almost nothing between the intent and the outcome is kept — so a person cannot review a past decision, and cannot tell an unlucky good decision from a lucky bad one.",
  },
  {
    title: "Ryntra principles",
    body: "Evidence before conclusion. The human authorizes. Truth is not a paid tier. Gates, not dates. Say what is missing. Each of these is a refusal that costs something, which is why they are principles rather than positioning.",
  },
  {
    title: "One Evidence Kernel",
    body: "Ten modules sit under every surface: intent normalization, evidence resolver, evidence-sufficiency evaluation, the policy and decision engine, the authorization boundary, the execution lifecycle, the reconciliation engine, the receipt engine, the capability registry and the event ledger. Every vertical is that same kernel with a different adapter attached.",
  },
  {
    title: "Canonical decision lifecycle",
    body: "Discover, understand, plan, gather evidence, evaluate policy and risk, review, authorize, execute, reconcile, issue a receipt, journal it. Four state axes stay independent throughout — evidence status, policy decision, execution status, reconciliation status — because merging them into one traffic light is where most products lose the truth.",
  },
  {
    title: "Product archetypes",
    body: "Seven, and no surface invents an eighth: overview, radar, passport, action console, strategy lab, receipts, settings. A composite professional terminal is permitted as a composition of those archetypes; it is never a new type of thing.",
  },
  {
    title: "Ryntra Home",
    body: "The neutral command centre above every vertical: what needs attention, observed value with its coverage, connections, portfolio heat, strategy, agents, receipts. Home aggregates, explains, prioritises and routes. Specialist workspaces execute, and Home itself never signs.",
  },
  {
    title: "Radar and Portfolio",
    body: "Discovery and holdings, under the rule that makes both honest: a total is shown together with how much of it could actually be valued, sources are never summed without a common basis, and an unavailable balance is never rendered as zero.",
  },
  {
    title: "Passport system",
    body: "One readable object per thing — instrument, asset, issuer, pool, account, agent, action. Each carries the provenance of every fact it states and preserves what is unknown rather than smoothing it into a number.",
  },
  {
    title: "Strategy and semi-automation",
    body: "A ladder rather than a switch: Watch, Paper, Prepare, and only then a bounded mandate. Nothing in the consumer product trades on its own, and a prepared action still meets the governor and then the person.",
  },
  {
    title: "Risk and Policy",
    body: "A deterministic governor between a plan and a signature, returning ALLOW, REVIEW, BLOCK or PAUSE by rule and policy version. It never means safe, legal or profitable. A BLOCK is the product working, and is presented that way.",
  },
  {
    title: "Human authorization",
    body: "The person sees the understandable action, never only calldata and a contract address. Authorization is recorded as an act distinct from the wallet signature and bound to the intent revision, the evidence root and the execution fingerprint. The payload approved is the payload that executes.",
  },
  {
    title: "Execution adapters",
    body: "Bounded translations of one network, venue or protocol. They quote, submit and report. They carry no policy — a second policy engine inside an adapter is forbidden — and the provider behind a route is always disclosed.",
  },
  {
    title: "Outcome Receipts and Journal",
    body: "The flagship artifact and its memory. A receipt binds intent, policy version, evidence snapshot, authorization, transaction and actual effects, and only then reconciles them; its hashes recompute independently of the application. The journal keeps process, adherence and mistakes rather than a performance table.",
  },
  {
    title: "AI Assistant",
    body: "Contextual and source-backed. It structures and explains; deterministic services calculate, gate and execute; people authorize. It does not fabricate current data, does not sign, and never silently turns a filter or a limit into live authority.",
  },
  {
    title: "Agent Control",
    body: "One global, provider-neutral and chain-neutral domain for economic actions proposed by AI agents, with exactly three public artifacts — Agent Passport, Action Passport, Outcome Receipt — and one Action and Receipt core projected into every network adapter rather than duplicated per chain.",
  },
  {
    title: "Ecosystem architecture",
    body: "A network settles, a venue quotes, a protocol is talked to, an adapter translates. Each ecosystem pack is an instance of the same shell rather than a copy of it, and one ecosystem is in active implementation at a time.",
  },
  {
    title: "Tokenized Markets",
    body: "One asset, multiple execution surfaces, one evidence-bound decision record. Robinhood Chain settles, Arcus executes, 0x routes. The raw underlying price and the multiplier-adjusted onchain feed are normalized explicitly, because that is the easiest place in the whole product to be wrong by orders of magnitude.",
  },
  {
    title: "Solana",
    body: "The reference vertical, chosen because one network already contains permissionless tokens, Token-2022 controls, a meme market, deep spot liquidity, tokenized equities, payments and agent-native rails. Its Asset Passport reads issuer powers and every extension with its provenance.",
  },
  {
    title: "Stellar",
    body: "RWA, markets, global rails, DeFi and agentic payments. Its distinguishing surface is the issuer: on Stellar, who issued an asset and which powers they retained is a readable fact rather than an inference.",
  },
  {
    title: "EVM",
    body: "One shared product system across Base, Ethereum, Arbitrum, Optimism and the rest — roughly four fifths shared, one fifth chain profile. EVM compatibility is never the same security or finality, and the account itself is a first-class object: externally owned, contract, or delegated.",
  },
  {
    title: "Starknet",
    body: "Privacy and Bitcoin are the wedge: scoped disclosure over a public envelope, and a Bitcoin passport that carries wrapper, bridge and federation trust rather than the word trustless. A blueprint, gated behind an owner decision.",
  },
  {
    title: "Security and non-custody",
    body: "Funds stay with the user. No seed phrase is ever received, nothing is signed on anyone's behalf, and a connected venue credential cannot withdraw. The complete boundary, including what has not been audited, is published on its own page rather than summarised here.",
  },
  {
    title: "Data, freshness and conflicts",
    body: "Every material fact carries a source and an observation time. Sources are not summed without a common valuation basis, a conflict is shown as a conflict, and staleness is a state rather than a silence.",
  },
  {
    title: "Monetization principles",
    body: "Depth, compute, automation, analytics, collaboration and infrastructure are payable. The right to know a critical truth before a financial action is not. A paid plan can never turn a BLOCK into an ALLOW, produce a better risk verdict, or hide a material warning from a free user.",
  },
  {
    title: "Developer platform",
    body: "The same lifecycle through a versioned API and SDK, in four integration modes from purely advisory to a wallet that will not pass an operation without a valid decision. Read and propose tools before any write tool, and no generic signer.",
  },
  {
    title: "Future expansion boundaries",
    body: "A new network, venue or protocol enters through a scorecard — user value, law, API and data rights, reliability, economics, non-custodial fit — and its first maturity is read-only or manual. Being registered is not being supported.",
  },
  {
    title: "Anti-scope",
    body: "Not an exchange, broker, dealer, custodian or adviser. Not a wallet, a bridge, a DEX or a lending protocol. No universal safety score, no signal marketplace with profit claims, no autonomous consumer trading, and no token.",
  },
  {
    title: "Glossary",
    body: "The vocabulary this paper uses is defined once, in the documentation glossary. Two of its entries are deliberately different words for deliberately different things: an evidence state describes how well a fact is known, a capability state describes how far a capability has got.",
  },
];

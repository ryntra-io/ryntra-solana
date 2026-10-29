/**
 * The capability and authority matrix (EXE-1; spec §17.3 PR-1, §5.3, §6.1, §13.4): one row per venue × action on
 * Solana, and for each the five things a person and a client are owed before they trust it —
 *
 * - **provider** — what the venue itself offers today (`MAINNET`, `BETA`, `DEVNET`, `NOT_OFFERED`);
 * - **readiness** — how far Ryntra has built it: `PROVEN` (a full cycle on mainnet is recorded — `evidence` names
 *   it), `BUILT` (the code is whole, no live cycle yet), `PARTIAL`, `MISSING`;
 * - **eligibility** — who may act when the row's switch is open: everyone with a wallet, one canary wallet, the
 *   pilot's wallets, Ryntra's operator alone, nobody;
 * - **enforcement** — what holds the bound of the action when the person is not signing it (spec §5.3):
 *   `PROGRAM_ENFORCED` (an on-chain program cannot exceed it), `PROVIDER_NATIVE` (the venue's own mechanism — a
 *   pool's bins, a venue's keeper), `RYNTRA_GATEWAY_ENFORCED` (Ryntra's server checks before it builds; the person's
 *   wallet still signs) or `OBSERVE_ONLY` (nothing binds — Ryntra watches and reminds). A wished-for limit in the UI
 *   is not a cryptographic one, and `notCovered` names the path the bound does not cover;
 * - **mode** — `MANUAL` (the person signs every action), `ASSISTED` (one signature, then the venue's own mechanics),
 *   `AUTONOMOUS` (an executor independent of the browser, under a bounded mandate). A row is called automatic only
 *   with all seven elements of spec §6.1 — `automation` — and none is today.
 *
 * The state a person reads is resolved from the row and the deployment's switches (`resolveAuthority`): one of the
 * seven honest states of spec §13.4. `LIVE` needs the row's ceiling `LIVE` — which the validator allows only with a
 * proven cycle on production — and its switch open; a closed switch reads `DISABLED`, and so does a canary, which is
 * never announced; a pilot for named wallets reads `PREVIEW`. `UNKNOWN` and
 * `RECOVERY` are the states of a read that failed and of an action being reconciled — a surface says them at runtime;
 * no row sits in them.
 *
 * The switches are the ones the routes already obey, read here, never a second switch: the lanes
 * (`lib/solana/lane-state.ts`) and the three-state gates `CLOSED · CANARY · OPEN` of the pools and Phoenix
 * (`lib/liquidity/studio/gate.ts`, `lib/phoenix/collateral.ts`, `lib/phoenix/orders.ts`). The older registries —
 * the core's routing registry (`./capabilities.ts`) and the claims registry (`lib/product/capabilities.ts`) — are
 * checked against this one (`authority-matrix.test.mjs`): neither may call live what this matrix does not.
 *
 * Financial logic is not here: no route, fee, signature or receipt changes with this file. Pure: no I/O, no clock.
 */

import { z } from "zod";

import { SOLANA_LANES, resolveSolanaLaneState, type SolanaLane } from "../solana/lane-state.ts";

export const HONEST_STATES = ["LIVE", "PAPER", "PREVIEW", "DISABLED", "UNAVAILABLE", "UNKNOWN", "RECOVERY"] as const;
export type HonestState = (typeof HONEST_STATES)[number];

export const ENFORCEMENT_LEVELS = ["PROGRAM_ENFORCED", "PROVIDER_NATIVE", "RYNTRA_GATEWAY_ENFORCED", "OBSERVE_ONLY"] as const;
export type Enforcement = (typeof ENFORCEMENT_LEVELS)[number];

export const EXECUTION_MODES = ["MANUAL", "ASSISTED", "AUTONOMOUS"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const PROVIDER_STATUSES = ["MAINNET", "BETA", "DEVNET", "NOT_OFFERED"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const RYNTRA_READINESS = ["PROVEN", "BUILT", "PARTIAL", "MISSING"] as const;
export type RyntraReadiness = (typeof RYNTRA_READINESS)[number];

export const ELIGIBILITY = ["EVERYONE", "CANARY", "PILOT", "OPERATOR", "NOBODY"] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];

/** Who signs each movement of money on the row. */
export const SIGNERS = ["PERSON_EACH", "PERSON_ONCE", "MULTISIG", "PROVIDER", "RYNTRA_KEY", "NONE"] as const;
export type Signer = (typeof SIGNERS)[number];

/** What goes on with no person present: nothing, a reminder, the venue's own mechanics, or an executor that signs. */
export const RUNS_ALONE = ["NOTHING", "REMINDER", "VENUE", "EXECUTOR"] as const;
export type RunsAlone = (typeof RUNS_ALONE)[number];

/** The most a row can say with what it has: the switch narrows it, never widens it. */
export const STATE_CEILINGS = ["LIVE", "PAPER", "PREVIEW", "UNAVAILABLE"] as const;
export type StateCeiling = (typeof STATE_CEILINGS)[number];

/** Spec §6.1: a bot is automatic only with all seven. */
export const AUTOMATION_ELEMENTS = [
  "strategyDefinition",
  "trigger",
  "riskPolicy",
  "authorizedExecutor",
  "reconciler",
  "runtime",
  "resultLedger",
] as const;
export type AutomationElement = (typeof AUTOMATION_ELEMENTS)[number];
export type AutomationElements = Readonly<Record<AutomationElement, boolean>>;

export const AUTHORITY_VENUES = [
  "jupiter",
  "meteora-dlmm",
  "meteora-damm2",
  "meteora-dbc",
  "relay",
  "circle-cctp",
  "phoenix",
  "squads",
  "subscriptions",
  "solana",
  "solana-pay",
  "agg",
  "ryntra",
] as const;
export type AuthorityVenue = (typeof AUTHORITY_VENUES)[number];

/** The surface a row is drawn on — where its state is said to a person. */
export const AUTHORITY_SURFACES = ["trade", "perps", "pools", "bots", "launch", "money", "treasury", "predictions", "agents"] as const;
export type AuthoritySurface = (typeof AUTHORITY_SURFACES)[number];

/** The three-state gates: `CLOSED` (the default, and any other value) · `CANARY` (one wallet) · `OPEN`. */
export const TRIAD_GATE_KEYS = ["RYNTRA_LIQUIDITY_ACTIONS", "RYNTRA_PHOENIX_COLLATERAL", "RYNTRA_PHOENIX_ORDERS", "RYNTRA_TEAM_LAUNCH"] as const;
export type TriadGateKey = (typeof TRIAD_GATE_KEYS)[number];

/** The network a surface is served on: `mainnet` · `devnet` · unset (not served). */
export const NETWORK_GATE_KEYS = ["NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK", "NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK"] as const;
export type NetworkGateKey = (typeof NETWORK_GATE_KEYS)[number];

/** A pilot's switch: `on` opens it to the wallets the deployment names, anything else closes it. */
export const PILOT_GATE_KEYS = ["PREDICTIONS_LIVE_FUNDING"] as const;
export type PilotGateKey = (typeof PILOT_GATE_KEYS)[number];

export type AuthorityGate =
  /** An operator lane: `OPEN` by name, anything else paused. */
  | Readonly<{ kind: "LANE"; lane: SolanaLane }>
  /** Two lanes, both open: an action that needs the second on top of the first. */
  | Readonly<{ kind: "LANES"; lanes: readonly [SolanaLane, SolanaLane] }>
  /** A three-state gate. */
  | Readonly<{ kind: "TRIAD"; key: TriadGateKey }>
  /** The network the surface is served on. */
  | Readonly<{ kind: "NETWORK"; key: NetworkGateKey }>
  /** A pilot for named wallets. */
  | Readonly<{ kind: "PILOT"; key: PilotGateKey }>
  /** No switch: the row's ceiling is what it is (a simulation, a read, something not built). */
  | Readonly<{ kind: "NONE" }>;

export type AuthorityRow = Readonly<{
  /** `venue.action`, stable: clients key on it. */
  id: string;
  venue: AuthorityVenue;
  action: string;
  surface: AuthoritySurface;
  provider: ProviderStatus;
  readiness: RyntraReadiness;
  ceiling: StateCeiling;
  /** Who may act when the switch is open. */
  eligibility: Eligibility;
  enforcement: Enforcement;
  mode: ExecutionMode;
  signer: Signer;
  runsAlone: RunsAlone;
  network: "mainnet" | "devnet";
  gate: AuthorityGate;
  automation: AutomationElements;
  /** The recorded full cycle on mainnet a `LIVE` ceiling rests on — what happened and when, said publicly (the API serves it). Null without one. */
  evidence: string | null;
  /** The path the bound does not cover (spec §5.3: «direct external wallet calls: not covered»); null when none. */
  notCovered: string | null;
  /** The task that moves the row next; null when none is registered. Internal: the API does not serve it. */
  next: string | null;
  /** One plain line for an operator and a client: what the row is, never a promise. */
  note: string;
}>;

const NONE_OF_SEVEN: AutomationElements = Object.freeze({
  strategyDefinition: false,
  trigger: false,
  riskPolicy: false,
  authorizedExecutor: false,
  reconciler: false,
  runtime: false,
  resultLedger: false,
});

const seven = (present: Partial<AutomationElements>): AutomationElements => Object.freeze({ ...NONE_OF_SEVEN, ...present });

const lane = (name: SolanaLane): AuthorityGate => ({ kind: "LANE", lane: name });
const triad = (key: TriadGateKey): AuthorityGate => ({ kind: "TRIAD", key });
const served = (key: NetworkGateKey): AuthorityGate => ({ kind: "NETWORK", key });
const NO_GATE: AuthorityGate = { kind: "NONE" };

/** The wallet that signs a Ryntra-built transaction can sign anything else elsewhere: the bound is Ryntra's route, not the wallet. */
const OUTSIDE_RYNTRA = "The same wallet signing outside Ryntra is not covered.";

/**
 * The rows, in the order a reader meets them: trading, perps, pools and bots, launch, money, treasury, predictions,
 * agents.
 */
export const AUTHORITY_MATRIX: readonly AuthorityRow[] = Object.freeze([
  /* ------------------------------------------------------------------ trade */
  {
    id: "jupiter.swap",
    venue: "jupiter",
    action: "swap",
    surface: "trade",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "RYNTRA_GATEWAY_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: lane("SWAP"),
    automation: NONE_OF_SEVEN,
    evidence: "A full swap cycle on mainnet accepted and reconciled with the chain, 2026-10-19",
    notCovered: OUTSIDE_RYNTRA,
    next: null,
    note: "Swap, Spot and stocks: one order, a Review with the issuer's signature and a simulation, one wallet signature, a receipt.",
  },
  {
    id: "jupiter.limit",
    venue: "jupiter",
    action: "limit",
    surface: "trade",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    /* The price bound sits in Trigger's program account, but the fill is Jupiter's keeper's: the venue's mechanism, not Ryntra's or the person's. */
    enforcement: "PROVIDER_NATIVE",
    mode: "ASSISTED",
    signer: "PERSON_ONCE",
    runsAlone: "VENUE",
    network: "mainnet",
    gate: lane("SWAP"),
    automation: NONE_OF_SEVEN,
    evidence: "A limit order placed through Ryntra filled on mainnet, 2026-10-16",
    notCovered: null,
    next: "SOL-C14",
    note: "Jupiter Trigger: the person signs the order once; Jupiter's keeper fills it at the price. From $5; a cancel is signed too.",
  },
  {
    id: "meteora-dlmm.limit",
    venue: "meteora-dlmm",
    action: "limit",
    surface: "trade",
    provider: "MAINNET",
    readiness: "BUILT",
    ceiling: "PREVIEW",
    eligibility: "EVERYONE",
    /* The pool's own bins convert the order as the price crosses them: the venue's mechanism. */
    enforcement: "PROVIDER_NATIVE",
    mode: "ASSISTED",
    signer: "PERSON_ONCE",
    runsAlone: "VENUE",
    network: "mainnet",
    gate: lane("SWAP"),
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: null,
    next: null,
    note: "A limit as liquidity in a pool's bins: built and offered; no person's order on mainnet is recorded yet.",
  },
  {
    id: "relay.cross-swap",
    venue: "relay",
    action: "cross-swap",
    surface: "trade",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    /* What the person signs is the Solana deposit Ryntra's route checked; the delivery is Relay's solvers', bound only by the quote's minimum. */
    enforcement: "RYNTRA_GATEWAY_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "VENUE",
    network: "mainnet",
    gate: lane("CROSS_SWAP"),
    automation: NONE_OF_SEVEN,
    evidence: "Cross-chain swaps through Relay on production, 2026-10-15",
    notCovered: OUTSIDE_RYNTRA,
    next: null,
    note: "Cross-chain swap and bridge from Solana: the person signs the deposit; Relay's solvers deliver on the other chain.",
  },
  {
    id: "circle-cctp.bridge",
    venue: "circle-cctp",
    action: "bridge",
    surface: "money",
    provider: "MAINNET",
    readiness: "PARTIAL",
    ceiling: "PREVIEW",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: lane("BRIDGE"),
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: null,
    next: null,
    note: "USDC over CCTP: the routes exist and were canaried on 02.09; no page offers it — people's bridge is Relay.",
  },

  /* ------------------------------------------------------------------ perps */
  {
    id: "phoenix.collateral",
    venue: "phoenix",
    action: "collateral",
    surface: "perps",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: triad("RYNTRA_PHOENIX_COLLATERAL"),
    automation: NONE_OF_SEVEN,
    evidence: "A deposit reconciled with the chain, then collateral opened to everyone, 2026-10-21",
    notCovered: null,
    next: null,
    note: "USDC between the wallet and Phoenix: each deposit and withdrawal signed by the wallet.",
  },
  {
    id: "phoenix.orders",
    venue: "phoenix",
    action: "orders",
    surface: "perps",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "PROVIDER_NATIVE",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "VENUE",
    network: "mainnet",
    gate: triad("RYNTRA_PHOENIX_ORDERS"),
    automation: NONE_OF_SEVEN,
    evidence: "An open, a TP/SL and a close on mainnet reconciled with the chain, 2026-10-22",
    notCovered: null,
    next: "PERP-3",
    note: "Open, change and close a position: every order signed by the wallet; TP/SL rest on Phoenix and fire there.",
  },

  /* ------------------------------------------------------------ pools, bots */
  {
    id: "meteora-dlmm.liquidity",
    venue: "meteora-dlmm",
    action: "liquidity",
    surface: "pools",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: triad("RYNTRA_LIQUIDITY_ACTIONS"),
    automation: NONE_OF_SEVEN,
    evidence: "A canary added, claimed and withdrew on mainnet before the actions opened to everyone",
    notCovered: null,
    next: null,
    note: "Add, withdraw and claim in a DLMM pool: the position is the person's, every action signed by the wallet.",
  },
  {
    id: "meteora-damm2.liquidity",
    venue: "meteora-damm2",
    action: "liquidity",
    surface: "pools",
    provider: "MAINNET",
    readiness: "BUILT",
    ceiling: "PREVIEW",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: triad("RYNTRA_LIQUIDITY_ACTIONS"),
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: null,
    next: null,
    note: "Add, withdraw and claim in a DAMM v2 pool: open with the pools' gate, every action signed by the wallet; the canary cycle was on DLMM.",
  },
  {
    id: "meteora-dlmm.grid",
    venue: "meteora-dlmm",
    action: "grid",
    surface: "bots",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "PROVIDER_NATIVE",
    mode: "ASSISTED",
    signer: "PERSON_ONCE",
    runsAlone: "VENUE",
    network: "mainnet",
    gate: triad("RYNTRA_LIQUIDITY_ACTIONS"),
    /* The levels are the pool's bins: the pool fills them both ways. Nothing of Ryntra's re-grids, stops or collects. */
    automation: seven({ strategyDefinition: true, trigger: true }),
    evidence: "A grid placed and stopped on mainnet, 2026-10-21",
    notCovered: null,
    next: "SOL-6",
    note: "Grid on DLMM: levels in the pool's own bins, placed once; the pool fills them. No re-grid; stop and collect are signed.",
  },
  {
    id: "ryntra.recurring-buy",
    venue: "ryntra",
    action: "recurring-buy",
    surface: "bots",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "OBSERVE_ONLY",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "REMINDER",
    network: "mainnet",
    gate: NO_GATE,
    /* The rule and its schedule exist and the server sends the reminder; the purchase is the person's swap. */
    automation: seven({ strategyDefinition: true, trigger: true }),
    evidence: "Reminders and the buys people signed from them on production, 2026-10-21",
    notCovered: "The monthly budget only silences reminders; it binds no purchase.",
    next: "EXE-4",
    note: "Recurring buy: Ryntra reminds on the day; every purchase is a swap the person reviews and signs.",
  },
  {
    id: "ryntra.trade-plan",
    venue: "ryntra",
    action: "trade-plan",
    surface: "bots",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "OBSERVE_ONLY",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: NO_GATE,
    automation: seven({ strategyDefinition: true, resultLedger: true }),
    evidence: "Plans kept on the server and their trades judged on production, 2026-09-15",
    notCovered: "A plan's stop and target are not orders: nothing sells at them.",
    next: null,
    note: "Trade plan: entry, size, stop and target kept beside the result; the trade is the person's swap.",
  },
  {
    id: "ryntra.exit-plan",
    venue: "ryntra",
    action: "exit-plan",
    surface: "trade",
    provider: "MAINNET",
    readiness: "PARTIAL",
    ceiling: "PREVIEW",
    eligibility: "EVERYONE",
    enforcement: "OBSERVE_ONLY",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: NO_GATE,
    automation: seven({ strategyDefinition: true }),
    evidence: null,
    notCovered: "Kept on the device only: no order rests on the chain, every sale is signed.",
    next: null,
    note: "Exit plan TP/SL/trailing for a meme: on production as an intent on the device; no plan-to-sale cycle is recorded, and each sale is a swap the person signs.",
  },
  {
    id: "ryntra.auto-dca",
    venue: "ryntra",
    action: "auto-dca",
    surface: "bots",
    provider: "MAINNET",
    readiness: "MISSING",
    ceiling: "UNAVAILABLE",
    eligibility: "NOBODY",
    enforcement: "PROGRAM_ENFORCED",
    mode: "AUTONOMOUS",
    signer: "NONE",
    runsAlone: "EXECUTOR",
    network: "mainnet",
    gate: NO_GATE,
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: null,
    next: "EXE-4",
    note: "The first autonomous bot: a bounded signer, a durable worker, Stop and Revoke — not built. Its bound and mode are the target, not a fact.",
  },

  /* ----------------------------------------------------------------- launch */
  {
    id: "meteora-dbc.launch",
    venue: "meteora-dbc",
    action: "launch",
    surface: "launch",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "VENUE",
    network: "mainnet",
    gate: lane("LAUNCH"),
    automation: NONE_OF_SEVEN,
    evidence: "Quick Launch open on mainnet, 2026-10-06",
    notCovered: null,
    next: null,
    note: "Create a token on a dynamic bonding curve: the creator signs; the curve and its migration are Meteora's program.",
  },
  {
    id: "ryntra.team-launch",
    venue: "ryntra",
    action: "team-launch",
    surface: "launch",
    provider: "MAINNET",
    readiness: "BUILT",
    ceiling: "PREVIEW",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "MANUAL",
    signer: "MULTISIG",
    runsAlone: "VENUE",
    network: "mainnet",
    gate: triad("RYNTRA_TEAM_LAUNCH"),
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: "The team's own wallets launching the same token outside Ryntra are not covered.",
    next: "MOS-2",
    note: "A team's launch through its Squads treasury: the wizard's rights and rules, the curve and its migration Meteora's program.",
  },
  {
    id: "meteora-dbc.trade",
    venue: "meteora-dbc",
    action: "trade",
    surface: "launch",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "RYNTRA_GATEWAY_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: lane("LAUNCH"),
    automation: NONE_OF_SEVEN,
    evidence: "Trades on the curve and in the pool with signed receipts on mainnet, 2026-10-06",
    notCovered: OUTSIDE_RYNTRA,
    next: null,
    note: "Buy and sell a launched token on its curve or pool: each trade signed by the wallet, with a receipt.",
  },
  {
    id: "meteora-dbc.creator-claim",
    venue: "meteora-dbc",
    action: "creator-claim",
    surface: "launch",
    provider: "MAINNET",
    readiness: "PARTIAL",
    ceiling: "PREVIEW",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: lane("LAUNCH"),
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: null,
    next: "SOL-L1d",
    note: "The creator claims the curve's fee: built and offered, signed by the creator's wallet; no creator's claim on mainnet is recorded, and the curve's surplus is not offered.",
  },
  {
    id: "meteora-dbc.holder-collect",
    venue: "meteora-dbc",
    action: "holder-collect",
    surface: "launch",
    provider: "MAINNET",
    readiness: "BUILT",
    ceiling: "PREVIEW",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "AUTONOMOUS",
    signer: "RYNTRA_KEY",
    runsAlone: "EXECUTOR",
    network: "mainnet",
    gate: lane("LAUNCH"),
    /* The holder's permission bits bound it on the chain and the program pays only the owner; no claim on mainnet yet. */
    automation: seven({ strategyDefinition: true, trigger: true, riskPolicy: true, authorizedExecutor: true, runtime: true }),
    evidence: null,
    notCovered: null,
    next: null,
    note: "Holders' fee collector: the holder grants a delegate permission once; Ryntra's executor claims at most daily into the holder's own accounts. No claim recorded on mainnet.",
  },
  {
    id: "meteora-dbc.graduation",
    venue: "meteora-dbc",
    action: "graduation",
    surface: "launch",
    provider: "MAINNET",
    readiness: "PARTIAL",
    ceiling: "PREVIEW",
    eligibility: "OPERATOR",
    enforcement: "RYNTRA_GATEWAY_ENFORCED",
    mode: "AUTONOMOUS",
    signer: "RYNTRA_KEY",
    runsAlone: "EXECUTOR",
    network: "mainnet",
    /* Graduations and the market budget's claims run under Launch's lane alone (`lib/launch/config.server.ts` launchOpen). */
    gate: lane("LAUNCH"),
    automation: seven({ strategyDefinition: true, trigger: true, authorizedExecutor: true, runtime: true, resultLedger: true }),
    evidence: null,
    notCovered: "The instructions the executor may sign are a check in Ryntra's code, not a program's bound.",
    next: "EXE-3",
    note: "Ryntra's key, every minute: graduations on any Ryntra launch; market-budget fee claims on Ryntra's own markets only. Not every element of an autonomous bot is proven.",
  },
  {
    id: "meteora-dbc.liquidity-ladder",
    venue: "meteora-dbc",
    action: "liquidity-ladder",
    surface: "launch",
    provider: "MAINNET",
    readiness: "PARTIAL",
    ceiling: "PREVIEW",
    eligibility: "OPERATOR",
    enforcement: "RYNTRA_GATEWAY_ENFORCED",
    mode: "AUTONOMOUS",
    signer: "RYNTRA_KEY",
    runsAlone: "EXECUTOR",
    network: "mainnet",
    /* Placing and moving Ryntra's own liquidity needs the floor's lane on top of Launch's (`launchFloorOpen`). */
    gate: { kind: "LANES", lanes: ["LAUNCH", "LAUNCH_FLOOR"] },
    automation: seven({ strategyDefinition: true, trigger: true, authorizedExecutor: true, runtime: true, resultLedger: true }),
    evidence: null,
    notCovered: "The instructions the executor may sign are a check in Ryntra's code, not a program's bound.",
    next: "MOS-1",
    note: "The fee-funded liquidity ladder: Ryntra's own liquidity placed and moved by its key; it has run on the demo market only.",
  },
  {
    id: "meteora-dbc.partner-claim",
    venue: "meteora-dbc",
    action: "partner-claim",
    surface: "launch",
    provider: "MAINNET",
    readiness: "MISSING",
    ceiling: "UNAVAILABLE",
    eligibility: "NOBODY",
    enforcement: "PROGRAM_ENFORCED",
    mode: "MANUAL",
    signer: "MULTISIG",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: NO_GATE,
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: null,
    next: "SOL-L1d",
    note: "Ryntra's partner fee claimed through the treasury multisig: no product code yet.",
  },

  /* ------------------------------------------------------------------ money */
  {
    id: "solana.send",
    venue: "solana",
    action: "send",
    surface: "money",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "RYNTRA_GATEWAY_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: lane("SEND"),
    automation: NONE_OF_SEVEN,
    evidence: "Send on production with the recipient check",
    notCovered: OUTSIDE_RYNTRA,
    next: null,
    note: "Send SOL and tokens: the recipient checked, one wallet signature.",
  },
  {
    id: "solana-pay.pay",
    venue: "solana-pay",
    action: "pay",
    surface: "money",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "RYNTRA_GATEWAY_ENFORCED",
    mode: "MANUAL",
    signer: "PERSON_EACH",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: NO_GATE,
    automation: NONE_OF_SEVEN,
    evidence: "Payment links paid and settled on production",
    notCovered: "A node that never answers the send can leave the page offering a second payment.",
    next: null,
    note: "Payment links and Solana Pay: the payer signs each payment.",
  },

  /* --------------------------------------------------------------- treasury */
  {
    id: "squads.treasury",
    venue: "squads",
    action: "treasury",
    surface: "treasury",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "LIVE",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "MANUAL",
    signer: "MULTISIG",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: served("NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK"),
    automation: NONE_OF_SEVEN,
    evidence: "A treasury canary on mainnet",
    notCovered: null,
    next: "TEAM-2",
    note: "A Squads treasury: every transfer approved by its members up to the threshold the program holds.",
  },
  {
    id: "squads.spending-limit",
    venue: "squads",
    action: "spending-limit",
    surface: "treasury",
    provider: "MAINNET",
    readiness: "BUILT",
    ceiling: "PREVIEW",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "ASSISTED",
    signer: "PERSON_ONCE",
    runsAlone: "VENUE",
    network: "mainnet",
    gate: served("NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK"),
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: "The cap at the draft is Ryntra's check; once on the chain Squads holds it.",
    next: null,
    note: "A Squads spending limit as a mandate: opened with the treasury, no canary of its own on mainnet (devnet only).",
  },

  {
    id: "subscriptions.allowance",
    venue: "subscriptions",
    action: "allowance",
    surface: "money",
    provider: "MAINNET",
    readiness: "BUILT",
    ceiling: "PREVIEW",
    eligibility: "EVERYONE",
    enforcement: "PROGRAM_ENFORCED",
    mode: "ASSISTED",
    signer: "PERSON_ONCE",
    runsAlone: "VENUE",
    network: "mainnet",
    gate: served("NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK"),
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: "A merchant's plan with no end date charges until it is cancelled.",
    next: null,
    note: "Allowances on the Subscriptions program: the person signs once; the merchant pulls within the program's limit. Devnet first, mainnet by canary.",
  },

  /* ------------------------------------------------------------ predictions */
  {
    id: "agg.predictions-paper",
    venue: "agg",
    action: "predictions-paper",
    surface: "predictions",
    provider: "MAINNET",
    readiness: "PROVEN",
    ceiling: "PAPER",
    eligibility: "EVERYONE",
    enforcement: "OBSERVE_ONLY",
    mode: "MANUAL",
    signer: "NONE",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: NO_GATE,
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: null,
    next: null,
    note: "Prediction markets across AGG's venues, simulated: no real money.",
  },
  {
    id: "agg.predictions-live",
    venue: "agg",
    action: "predictions-live",
    surface: "predictions",
    provider: "MAINNET",
    readiness: "BUILT",
    ceiling: "PREVIEW",
    eligibility: "PILOT",
    enforcement: "RYNTRA_GATEWAY_ENFORCED",
    mode: "MANUAL",
    signer: "PROVIDER",
    runsAlone: "NOTHING",
    network: "mainnet",
    gate: { kind: "PILOT", key: "PREDICTIONS_LIVE_FUNDING" },
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: "The deposit sits in a wallet the venue manages; it signs every trade and withdrawal.",
    next: "WP-10",
    note: "Real-money predictions: built for the pilot's wallets and venues, up to $5 an order; the live pilot has not started.",
  },

  /* ----------------------------------------------------------------- agents */
  {
    id: "ryntra.agent-mandate",
    venue: "ryntra",
    action: "agent-mandate",
    surface: "agents",
    provider: "MAINNET",
    readiness: "MISSING",
    ceiling: "UNAVAILABLE",
    eligibility: "NOBODY",
    enforcement: "PROGRAM_ENFORCED",
    mode: "AUTONOMOUS",
    signer: "NONE",
    runsAlone: "EXECUTOR",
    network: "mainnet",
    gate: NO_GATE,
    automation: NONE_OF_SEVEN,
    evidence: null,
    notCovered: null,
    next: "SOL-5",
    note: "An agent's bounded mandate on Solana mainnet: not built. Its bound and mode are the target, not a fact.",
  },
]);

/* -------------------------------------------------------------- resolution */

export type GatePosition = "OPEN" | "CANARY" | "DEVNET" | "CLOSED" | "NONE";

/** The switch's position on this deployment, read the way its own route reads it. */
export function gatePosition(gate: AuthorityGate, env: Readonly<Record<string, string | undefined>>): GatePosition {
  if (gate.kind === "NONE") return "NONE";
  if (gate.kind === "LANE") return resolveSolanaLaneState(gate.lane, env) === "OPEN" ? "OPEN" : "CLOSED";
  if (gate.kind === "LANES") return gate.lanes.every((name) => resolveSolanaLaneState(name, env) === "OPEN") ? "OPEN" : "CLOSED";
  const value = env[gate.key]?.trim();
  if (gate.kind === "NETWORK") {
    const network = value?.toLowerCase();
    return network === "mainnet" || network === "mainnet-beta" ? "OPEN" : network === "devnet" ? "DEVNET" : "CLOSED";
  }
  /* A pilot admits the wallets the deployment names, never everyone: its open is a canary. */
  if (gate.kind === "PILOT") return value?.toLowerCase() === "on" ? "CANARY" : "CLOSED";
  const upper = value?.toUpperCase();
  return upper === "OPEN" ? "OPEN" : upper === "CANARY" ? "CANARY" : "CLOSED";
}

export type ResolvedAuthority = Readonly<{
  id: string;
  state: HonestState;
  /** Who may act right now: the row's eligibility narrowed by the switch. */
  eligibility: Eligibility;
  gate: GatePosition;
}>;

/**
 * The state a person reads, and who may act. The switch narrows the ceiling and never widens it: closed —
 * `DISABLED`; a canary — `PREVIEW` for one wallet; open or none — the ceiling. A row with no live cycle never
 * resolves `LIVE` (the validator keeps its ceiling below).
 */
export function resolveAuthority(row: AuthorityRow, env: Readonly<Record<string, string | undefined>> = process.env): ResolvedAuthority {
  const gate = gatePosition(row.gate, env);
  if (row.ceiling === "UNAVAILABLE") return { id: row.id, state: "UNAVAILABLE", eligibility: "NOBODY", gate };
  if (gate === "CLOSED") return { id: row.id, state: "DISABLED", eligibility: "NOBODY", gate };
  /* A canary is not announced: a stranger is told what `CLOSED` tells them (`lib/liquidity/studio/gate.ts`). A pilot is named on its own surface. */
  if (gate === "CANARY" && row.gate.kind === "TRIAD") return { id: row.id, state: "DISABLED", eligibility: "NOBODY", gate: "CLOSED" };
  if (gate === "CANARY") return { id: row.id, state: "PREVIEW", eligibility: "PILOT", gate };
  /* Served on devnet only: test money, never LIVE. */
  if (gate === "DEVNET") return { id: row.id, state: row.ceiling === "PAPER" ? "PAPER" : "PREVIEW", eligibility: row.eligibility, gate };
  return { id: row.id, state: row.ceiling, eligibility: row.eligibility, gate };
}

export function findAuthority(id: string): AuthorityRow | null {
  return AUTHORITY_MATRIX.find((row) => row.id === id) ?? null;
}

/** Whether a row may be called automatic: all seven elements of spec §6.1, and live. */
export function isAutomatic(row: AuthorityRow): boolean {
  return row.mode === "AUTONOMOUS" && row.ceiling === "LIVE" && AUTOMATION_ELEMENTS.every((element) => row.automation[element]);
}

/** Whether any row on a surface may be called automatic today. */
export function anyAutomatic(surface?: AuthoritySurface, rows: readonly AuthorityRow[] = AUTHORITY_MATRIX): boolean {
  return rows.some((row) => (surface === undefined || row.surface === surface) && isAutomatic(row));
}

/* -------------------------------------------------------------- validation */

const RowSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/),
    venue: z.enum(AUTHORITY_VENUES),
    action: z.string().regex(/^[a-z0-9-]+$/),
    surface: z.enum(AUTHORITY_SURFACES),
    provider: z.enum(PROVIDER_STATUSES),
    readiness: z.enum(RYNTRA_READINESS),
    ceiling: z.enum(STATE_CEILINGS),
    eligibility: z.enum(ELIGIBILITY),
    enforcement: z.enum(ENFORCEMENT_LEVELS),
    mode: z.enum(EXECUTION_MODES),
    signer: z.enum(SIGNERS),
    runsAlone: z.enum(RUNS_ALONE),
    network: z.enum(["mainnet", "devnet"]),
    gate: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("LANE"), lane: z.enum(SOLANA_LANES) }).strict(),
      z.object({ kind: z.literal("LANES"), lanes: z.tuple([z.enum(SOLANA_LANES), z.enum(SOLANA_LANES)]) }).strict(),
      z.object({ kind: z.literal("TRIAD"), key: z.enum(TRIAD_GATE_KEYS) }).strict(),
      z.object({ kind: z.literal("NETWORK"), key: z.enum(NETWORK_GATE_KEYS) }).strict(),
      z.object({ kind: z.literal("PILOT"), key: z.enum(PILOT_GATE_KEYS) }).strict(),
      z.object({ kind: z.literal("NONE") }).strict(),
    ]),
    automation: z.object(Object.fromEntries(AUTOMATION_ELEMENTS.map((element) => [element, z.boolean()])) as Record<AutomationElement, z.ZodBoolean>).strict(),
    evidence: z.string().min(1).max(200).nullable(),
    notCovered: z.string().min(1).max(200).nullable(),
    next: z.string().min(1).max(32).nullable(),
    note: z.string().min(1).max(200),
  })
  .strict()
  .superRefine((row, context) => {
    const issue = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
    if (row.id !== `${row.venue}.${row.action}`) issue("id", "The id is venue.action.");
    /* No false LIVE: a live ceiling rests on a recorded mainnet cycle the provider still offers, behind a switch an operator can close or a row that needs none. */
    if (row.ceiling === "LIVE") {
      if (row.evidence === null) issue("evidence", "A LIVE ceiling needs its recorded mainnet cycle.");
      if (row.readiness !== "PROVEN") issue("readiness", "A LIVE ceiling needs a proven cycle.");
      if (row.network !== "mainnet") issue("network", "LIVE is mainnet only.");
      if (row.provider !== "MAINNET" && row.provider !== "BETA") issue("provider", "LIVE needs the venue on mainnet.");
      if (row.eligibility === "NOBODY" || row.eligibility === "OPERATOR") issue("eligibility", "A LIVE row is open to people.");
    }
    if (row.readiness === "MISSING" && row.ceiling !== "UNAVAILABLE") issue("ceiling", "Nothing built reads UNAVAILABLE.");
    if (row.ceiling === "UNAVAILABLE" && row.eligibility !== "NOBODY") issue("eligibility", "Nobody acts on what is not built.");
    if (row.provider === "NOT_OFFERED" && row.ceiling !== "UNAVAILABLE") issue("ceiling", "What the venue does not offer is UNAVAILABLE.");
    if (row.provider === "DEVNET" && row.ceiling === "LIVE") issue("ceiling", "A devnet venue is never LIVE.");
    /* Spec §6.1, §5.3, §5.4: automatic only with all seven, a bound that is not observation, no bypass, an executor. */
    if (row.mode === "AUTONOMOUS" && row.ceiling === "LIVE") {
      for (const element of AUTOMATION_ELEMENTS) if (!row.automation[element]) issue("automation", `Autonomous LIVE lacks ${element} (spec §6.1).`);
      if (row.enforcement === "OBSERVE_ONLY") issue("enforcement", "Nothing binds an observed bot: it is not autonomous.");
      if (row.notCovered !== null) issue("notCovered", "A bypass path exists: Autonomous is not offered (spec §5.3).");
      if (row.runsAlone !== "EXECUTOR") issue("runsAlone", "An autonomous row runs on an executor.");
    }
    if (row.mode === "MANUAL" && row.signer === "PERSON_ONCE") issue("signer", "Manual is a signature for every action.");
    if (row.mode === "ASSISTED" && row.runsAlone !== "VENUE" && row.runsAlone !== "NOTHING") issue("runsAlone", "Assisted is the venue's own mechanics.");
    if (row.runsAlone === "REMINDER" && row.mode !== "MANUAL") issue("mode", "A reminder buys nothing: the person signs.");
    if (row.runsAlone === "EXECUTOR" && row.mode !== "AUTONOMOUS") issue("mode", "An executor that signs is the autonomous mode.");
    if (row.ceiling === "PAPER" && row.signer !== "NONE") issue("signer", "A simulation signs nothing.");
    if (row.signer === "RYNTRA_KEY" && row.runsAlone !== "EXECUTOR") issue("signer", "Ryntra's key signs only as an executor.");
    if (row.eligibility === "PILOT" && row.gate.kind !== "PILOT") issue("gate", "A pilot opens by its own switch.");
  });

/** The matrix checked as a whole: every row valid, no id twice. */
export function validateAuthorityMatrix(rows: readonly AuthorityRow[] = AUTHORITY_MATRIX): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const parsed = RowSchema.safeParse(row);
    if (!parsed.success) for (const issue of parsed.error.issues) problems.push(`${row.id}: ${issue.path.join(".")} ${issue.message}`);
    if (seen.has(row.id)) problems.push(`${row.id}: registered twice`);
    seen.add(row.id);
  }
  return problems;
}

/* ------------------------------------------------------------- projection */

/** What a surface draws for one row: its honest state and how it runs — never the switch's variable. */
export type AuthorityView = Readonly<{
  id: string;
  state: HonestState;
  eligibility: Eligibility;
  enforcement: Enforcement;
  mode: ExecutionMode;
  runsAlone: RunsAlone;
  automatic: boolean;
}>;

/** The rows a surface draws, resolved on this deployment, by id. Throws on an id the matrix does not hold: a surface never invents a row. */
export function authorityViews<Id extends string>(ids: readonly Id[], env: Readonly<Record<string, string | undefined>> = process.env): Readonly<Record<Id, AuthorityView>> {
  const views = {} as Record<Id, AuthorityView>;
  for (const id of ids) {
    const row = findAuthority(id);
    if (!row) throw new Error(`authority matrix: no row ${id}`);
    const resolved = resolveAuthority(row, env);
    views[id] = { id, state: resolved.state, eligibility: resolved.eligibility, enforcement: row.enforcement, mode: row.mode, runsAlone: row.runsAlone, automatic: isAutomatic(row) };
  }
  return views;
}

export { BOTS_AUTHORITY_IDS, type BotsAuthorityId } from "./authority-ids.ts";

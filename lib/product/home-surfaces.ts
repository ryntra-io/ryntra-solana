/**
 * The Ryntra Home surface register.
 *
 * The public documentation page for Home renders from this file rather than
 * from prose, which is what makes the finish line's last condition — *no
 * sentence a person can read that a test cannot check* — true for that page.
 * Every field here is checkable: the route resolves, the module exists, the
 * write authority is a constant, and the after-gate list names the exact record
 * that would have to exist before any of it could change.
 *
 * **`writeAuthority` is the constant `NONE` on every row and is not read from
 * an input.** Home reads. Every surface listed here compiles a projection from
 * records other parts of the product already keep, and no route in this list
 * writes, signs, authorizes, executes or moves anything. A row that needed a
 * different value would have to change the type, which is the review moment it
 * deserves.
 */

export const HOME_WRITE_AUTHORITY = "NONE" as const;

export type HomeSurfaceRecord = Readonly<{
  id: string;
  label: string;
  href: string;
  /** One line. What a reader comes to this surface to find out. */
  question: string;
  /** The compiler that owns what this surface's facts mean. */
  module: string;
  /** The delivery wave that built it. */
  wave: string;
  /** What this surface refuses to do, stated where a reader will see it. */
  refuses: readonly string[];
  writeAuthority: typeof HOME_WRITE_AUTHORITY;
}>;

export const HOME_SURFACES: readonly HomeSurfaceRecord[] = Object.freeze([
  {
    id: "today",
    label: "Today",
    href: "/app",
    question: "What needs me right now, and what is the state of what I hold?",
    module: "app/app/overview/loop-state.ts",
    wave: "RYN-HOME-003",
    refuses: ["Ranks attention by a fixed priority rather than an invented importance score."],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "brief",
    label: "Daily Brief",
    href: "/app/brief",
    question: "What happened while I was not looking?",
    module: "lib/home/brief/daily-brief.ts",
    wave: "RYN-HOME-007",
    refuses: [
      "Issues no single importance number: a decision outranks a change outranks a portfolio move outranks an operational state, by a declared table.",
      "Never drops an empty section — an empty one states why, so a calm day cannot look like a failed load.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "portfolio",
    label: "Portfolio",
    href: "/app/portfolio",
    question: "What do I hold, what is it worth, and what is the risk?",
    module: "lib/home/portfolio/read-model.ts",
    wave: "RYN-HOME-002",
    refuses: [
      "Never shows a value without its coverage, currency, observation time and source state.",
      "Never totals the live and paper books.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "adviser",
    label: "Adviser",
    href: "/app/adviser",
    question: "What does this mean for me, and on what evidence?",
    module: "lib/home/workbench/answer.ts",
    wave: "RYN-HOME-006",
    refuses: [
      "Issues no personalized buy, sell or hold verdict; the AI stays inside Explain, Formalize, Compare and Review.",
      "Withholds the deterministic result unless every required input is present and current.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "research",
    label: "Research",
    href: "/app/research",
    question: "What changed, and can I trust the evidence that says so?",
    module: "lib/home/research/read-model.ts",
    wave: "RYN-HOME-004",
    refuses: [
      "Never computes a last-run time from a schedule; an unobserved run is unknown.",
      "Monitoring scope never widens execution authority.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "strategies",
    label: "Strategies",
    href: "/app/strategies",
    question: "Where is each strategy in its lifecycle, and does its evidence carry it?",
    module: "lib/home/strategy/lifecycle.ts",
    wave: "RYN-HOME-006",
    refuses: [
      "Refuses seven of eleven lifecycle states by name, because nothing records the decision behind them.",
      "Incomplete backtest evidence is not evidence and cannot reach Approved.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "decisions",
    label: "Decisions",
    href: "/app/action-cases",
    question: "What is waiting on me, and what did I decide before?",
    module: "lib/home/advice/advice-case.ts",
    wave: "RYN-HOME-005",
    refuses: [
      "Carries adviceAuthority NONE and a recommendation typed null; the product issues no personalized recommendation.",
      "A disposition nobody recorded stays pending rather than being inferred from a shared ticker.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "journal",
    label: "Journal",
    href: "/app/journal",
    question: "Did what I expected actually happen?",
    module: "lib/home/advice/journal.ts",
    wave: "RYN-HOME-005",
    refuses: ["Marks every link of plan → decision → outcome → conclusion as recorded or missing, with a reason on each gap."],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "alerts",
    label: "Monitoring",
    href: "/app/alerts",
    question: "What was I told, what was held back, and by which limit?",
    module: "lib/home/alerts/channels.ts",
    wave: "RYN-HOME-007",
    refuses: [
      "Never merges channel configuration with observed delivery: linked and has-ever-delivered are separate facts.",
      "Shows a suppressed alert at full weight with the rule that suppressed it.",
      "Enables, disables and tests nothing — those are writes.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "coverage",
    label: "Coverage",
    href: "/app/coverage",
    question: "How much of my world can this product actually see?",
    module: "lib/home/coverage/coverage.ts",
    wave: "RYN-HOME-007",
    refuses: [
      "Reports counted-of-total with every gap named; a percentage that hides its denominator is not offered.",
      "An unrecorded budget reads Unrecorded, never zero.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "operations",
    label: "Operations",
    href: "/app/operations",
    question: "Is the machinery up, what breaks while it is not, and what may this product legally do?",
    module: "lib/home/operations/operations.ts",
    wave: "RYN-HOME-007",
    refuses: [
      "Incidents are derived from observed failures and cannot be authored.",
      "Kill switches are shown and never thrown; each names the authority that may.",
      "The regulatory perimeter fails closed and refuses interface copy and jurisdiction labels as sources.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "control",
    label: "Control",
    href: "/app/control",
    question: "What is the operating state of the machine, and who owns each fact?",
    module: "lib/home/control/projection.ts",
    wave: "RYN-HOME-006",
    refuses: [
      "Every tile is a projection with a named owner and a link; nothing is recomputed here.",
      "A fact no server can read says exactly that.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
  {
    id: "connect",
    label: "Connections",
    href: "/app/connect",
    question: "What is connected, with what scope, and how do I revoke it?",
    module: "lib/home/connections.ts",
    wave: "RYN-HOME-001",
    refuses: [
      "Never requests a seed phrase, private key, withdrawal scope or master viewing key.",
      "Watch-only is a full connection state and never implies ownership.",
    ],
    writeAuthority: HOME_WRITE_AUTHORITY,
  },
]);

/**
 * The three operations that are not enabled, with what would have to exist.
 *
 * They are listed publicly on purpose. A reader deciding whether to trust this
 * product is better served by the named gap than by silence — and the named gap
 * is what stops a later surface from quietly implying one of them works.
 */
export type AfterGateCapability = Readonly<{
  id: string;
  label: string;
  /** The exact record that would have to exist first. */
  gate: string;
  module: string;
}>;

export const HOME_AFTER_GATE: readonly AfterGateCapability[] = Object.freeze([
  {
    id: "personalized-advice",
    label: "Personalized advice",
    gate: "A RegulatoryCapabilityState record from a provider contract, counsel opinion, product perimeter or regulator publication — for this context version, this instrument class and this operation. None exists.",
    module: "lib/home/regulatory/capability-state.ts",
  },
  {
    id: "order-transmission",
    label: "Live order transmission",
    gate: "The same record for order transmission, plus a provider role that is not NONE. None exists.",
    module: "lib/home/regulatory/capability-state.ts",
  },
  {
    id: "autonomy",
    label: "Autonomy and discretion",
    gate: "The same record for discretionary management, plus an Agent Control mandate a human authorized. Neither exists.",
    module: "lib/home/regulatory/capability-state.ts",
  },
]);

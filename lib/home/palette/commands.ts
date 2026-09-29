/**
 * The command palette index.
 *
 * A palette is the most natural place in an application to put a verb — *send*,
 * *approve*, *sign* — one keystroke from anywhere, with no surrounding context.
 * That is exactly what this product does not do: an action happens on the
 * surface that gave you the reason for it, beside the evidence, through the
 * Action Console. So this index is navigation and only navigation. Every entry
 * is a route, none carries a callback, and a test refuses any entry whose id,
 * label or keywords contain an action verb.
 *
 * `PALETTE_AUTHORITY` is the constant `NAVIGATION_ONLY` for the same reason
 * every other projection in Home carries its authority: a later reader should
 * find the boundary in the type, not in a comment.
 *
 * Ranking is a declared ladder — exact id, label prefix, label substring,
 * keyword — with ties broken on the index's own order. No fuzzy score, no
 * recency weighting, no learned ordering: the same query has to produce the
 * same list every time, or a keyboard-driven reader cannot build muscle memory.
 */

export const PALETTE_AUTHORITY = "NAVIGATION_ONLY" as const;

/**
 * Verbs that may not appear anywhere in this index.
 *
 * They are the words that would turn a navigation entry into an action one.
 * The list is checked against ids, labels *and* keywords, because a keyword is
 * how somebody would find a control they expect to be able to trigger.
 */
export const ACTION_VERBS = [
  "send",
  "sign",
  "execute",
  "authorize",
  "approve",
  "revoke",
  "pause",
  "resume",
  "trip",
  "delete",
  "buy",
  "sell",
  "trade",
  "withdraw",
  "deposit",
  "transfer",
  "enable",
  "disable",
] as const;

export type CommandEntry = Readonly<{
  id: string;
  label: string;
  href: string;
  keywords: readonly string[];
  group: string;
  needsSession?: boolean;
}>;

export const HOME_COMMANDS: readonly CommandEntry[] = Object.freeze([
  { id: "today", label: "Today", href: "/app", keywords: ["home", "overview", "start"], group: "Home", needsSession: true },
  { id: "brief", label: "Daily Brief", href: "/app/brief", keywords: ["digest", "since", "summary", "morning"], group: "Home", needsSession: true },
  { id: "portfolio", label: "Portfolio", href: "/app/portfolio", keywords: ["positions", "valuation", "risk", "cash", "exposure"], group: "Home", needsSession: true },
  { id: "adviser", label: "Adviser", href: "/app/adviser", keywords: ["ryn", "workbench", "question", "explain", "compare"], group: "Home", needsSession: true },
  { id: "research", label: "Research", href: "/app/research", keywords: ["radar", "changes", "mandate", "monitor", "sources"], group: "Home", needsSession: true },
  { id: "strategies", label: "Strategies", href: "/app/strategies", keywords: ["lifecycle", "backtest", "forward", "paper", "versions"], group: "Home", needsSession: true },
  { id: "decisions", label: "Decisions", href: "/app/action-cases", keywords: ["queue", "cases", "advice", "disposition"], group: "Home", needsSession: true },
  { id: "journal", label: "Journal", href: "/app/journal", keywords: ["review", "outcome", "cycle", "conclusion"], group: "Home", needsSession: true },
  { id: "alerts", label: "Alerts and channels", href: "/app/alerts", keywords: ["notifications", "telegram", "quiet hours", "cooldown", "suppressed"], group: "Operations", needsSession: true },
  { id: "coverage", label: "Coverage", href: "/app/coverage", keywords: ["sources", "data", "budget", "completeness", "gaps"], group: "Operations", needsSession: true },
  { id: "operations", label: "Operations", href: "/app/operations", keywords: ["health", "incident", "recovery", "kill switch", "perimeter", "regulatory"], group: "Operations", needsSession: true },
  { id: "control", label: "Control", href: "/app/control", keywords: ["agent", "projections", "commitments", "authority"], group: "Operations", needsSession: true },
  { id: "connections", label: "Connections", href: "/app/connect", keywords: ["wallets", "venues", "watch-only", "sources", "link"], group: "Account", needsSession: true },
  { id: "settings", label: "Settings", href: "/app/settings", keywords: ["appearance", "language", "theme", "preferences"], group: "Account", needsSession: true },
  { id: "access", label: "Access", href: "/app/beta", keywords: ["account", "confirm", "beta", "identity"], group: "Account" },
  { id: "agent-control", label: "Agent Control", href: "/agents/workspace", keywords: ["policy", "evidence", "kill switch", "commitments"], group: "Elsewhere" },
  { id: "docs", label: "Documentation", href: "/docs", keywords: ["handbook", "glossary", "capabilities", "principles"], group: "Elsewhere" },
  { id: "capabilities", label: "Current capabilities", href: "/docs/current-capabilities", keywords: ["register", "maturity", "what works"], group: "Elsewhere" },
]);

/** The index a reader may actually use, given whether they are signed in. */
export function commandsFor(input: Readonly<{ hasSession: boolean }>): readonly CommandEntry[] {
  return input.hasSession ? HOME_COMMANDS : HOME_COMMANDS.filter((command) => !command.needsSession);
}

/** Lower rank sorts first. `null` means the entry does not match at all. */
function rank(command: CommandEntry, query: string): number | null {
  const id = command.id.toLowerCase();
  const label = command.label.toLowerCase();
  if (id === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.includes(query)) return 2;
  if (id.includes(query)) return 3;
  if (command.keywords.some((keyword) => keyword.toLowerCase().includes(query))) return 4;
  return null;
}

export function searchCommands(index: readonly CommandEntry[], query: string): readonly CommandEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...index];

  return index
    .map((command, position) => ({ command, position, rank: rank(command, needle) }))
    .filter((entry): entry is { command: CommandEntry; position: number; rank: number } => entry.rank !== null)
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.position - b.position))
    .map((entry) => entry.command);
}

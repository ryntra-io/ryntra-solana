/* The documented Robinhood Trading MCP tool surface (RYN-RH-MCP-001).

   **Documentation-sourced, and the whole file says so.** Robinhood publishes the
   tool tables in its own support article, which answered 200; the MCP endpoint
   that would serve `tools/list` answered 403 from this egress. So every entry
   carries `source: "official-docs"` and `reachedOverMcp: false`, and a test fails
   if either is ever quietly changed. Listing a tool and having seen it are
   different facts, exactly as they were for Binance.

   **Effects are written down per tool, never derived from the name.** This
   repository built a name-prefix guardrail twice against Binance and it failed
   open both times. The list below is what a prefix rule gets wrong here:
   `review_equity_order` and `preview_crypto_order` are simulations that place
   nothing, while `place_*` and `cancel_*` both change real orders. An unknown
   name is `WRITE_ORDER`, because the cost of misreading a new order tool as a
   read is an order. */

import inventory from "./fixtures/documented-tools.json" with { type: "json" };

export type ToolEffect =
  /** Returns state. Includes order simulations, which create nothing. */
  | "READ"
  /** Changes provider state that holds no assets: watchlists, saved scans. */
  | "WRITE_NO_ASSET"
  /** Creates, cancels or alters a real order. */
  | "WRITE_ORDER";

export type DocumentedTool = {
  name: string;
  description: string;
  family: string;
  effect: ToolEffect;
  /** Constant. Nothing in this package has spoken to the venue. */
  source: "official-docs";
  reachedOverMcp: false;
};

/**
 * Every documented tool, classified one at a time.
 *
 * Read it as the answer to "what could this agent do to my account", not as a
 * list of endpoints. The six `WRITE_ORDER` entries are the entire order surface;
 * the twelve watchlist and six scanner writes touch no assets; everything else
 * reads.
 */
export const DOCUMENTED_TOOL_EFFECTS: Readonly<Record<string, ToolEffect>> = {
  /* Account, portfolio and search. */
  get_accounts: "READ",
  get_portfolio: "READ",
  get_realized_pnl: "READ",
  get_pnl_trade_history: "READ",
  search: "READ",

  /* Watchlists. Writes, and deliberately not order writes: a watchlist holds no
     value, so a product that treats every write the same would refuse a rename
     with the sentence it uses to refuse a market order. */
  get_watchlists: "READ",
  get_watchlist_items: "READ",
  get_option_watchlist: "READ",
  get_popular_watchlists: "READ",
  create_watchlist: "WRITE_NO_ASSET",
  update_watchlist: "WRITE_NO_ASSET",
  follow_watchlist: "WRITE_NO_ASSET",
  unfollow_watchlist: "WRITE_NO_ASSET",
  add_to_watchlist: "WRITE_NO_ASSET",
  remove_from_watchlist: "WRITE_NO_ASSET",
  add_option_to_watchlist: "WRITE_NO_ASSET",
  remove_option_from_watchlist: "WRITE_NO_ASSET",

  /* Market data. */
  get_equity_historicals: "READ",
  get_equity_fundamentals: "READ",
  get_financials: "READ",
  get_equity_price_book: "READ",
  get_equity_technical_indicators: "READ",
  get_earnings_results: "READ",
  get_earnings_calendar: "READ",
  get_indexes: "READ",
  get_index_quotes: "READ",

  /* Equities. `review_equity_order` simulates and returns pre-trade warnings; it
     is the one name in this family a prefix rule would misfile. */
  get_equity_positions: "READ",
  get_equity_tax_lots: "READ",
  get_equity_quotes: "READ",
  get_equity_orders: "READ",
  get_equity_tradability: "READ",
  review_equity_order: "READ",
  place_equity_order: "WRITE_ORDER",
  cancel_equity_order: "WRITE_ORDER",

  /* Options. */
  get_option_level_upgrade_info: "READ",
  get_option_historicals: "READ",
  get_option_chains: "READ",
  get_option_instruments: "READ",
  get_option_quotes: "READ",
  get_option_positions: "READ",
  get_option_orders: "READ",
  review_option_order: "READ",
  place_option_order: "WRITE_ORDER",
  cancel_option_order: "WRITE_ORDER",

  /* Crypto. `preview_crypto_order` is the equities family's `review_` under a
     second verb — the same operation named differently, which is precisely why
     the classification is a table and not a rule. */
  get_currency_pairs: "READ",
  get_crypto_quotes: "READ",
  get_crypto_positions: "READ",
  get_crypto_orders: "READ",
  preview_crypto_order: "READ",
  place_crypto_order: "WRITE_ORDER",
  cancel_crypto_order: "WRITE_ORDER",

  /* Scanner. */
  get_scans: "READ",
  get_scanner_filter_specs: "READ",
  create_scan: "WRITE_NO_ASSET",
  run_scan: "WRITE_NO_ASSET",
  update_scan_filters: "WRITE_NO_ASSET",
  update_scan_config: "WRITE_NO_ASSET",
};

/**
 * Fail-closed. A tool this table has never seen is treated as an order tool, so
 * a name Robinhood adds next release cannot pass a read-only gate by being new.
 */
export function effectOf(name: string): ToolEffect {
  return DOCUMENTED_TOOL_EFFECTS[name] ?? "WRITE_ORDER";
}

export function documentedTools(): readonly DocumentedTool[] {
  const tools: DocumentedTool[] = [];
  for (const family of inventory.families) {
    for (const tool of family.tools) {
      tools.push({
        name: tool.name,
        description: tool.description,
        family: family.id,
        effect: effectOf(tool.name),
        source: "official-docs",
        reachedOverMcp: false,
      });
    }
  }
  return tools;
}

export function toolsWithEffect(effect: ToolEffect): readonly DocumentedTool[] {
  return documentedTools().filter(function (tool) { return tool.effect === effect; });
}

export type MissingCapability = {
  id: string;
  label: string;
  reason: string;
  evidence: readonly string[];
};

/**
 * What the agent cannot do, recorded as absences with reasons.
 *
 * An empty space in a tool table is ambiguous — it can mean "not offered", "not
 * documented yet" or "nobody looked". Each of these has a stated cause, and three
 * of the four are things the provider says in words rather than things inferred
 * from the table being short.
 */
export const MISSING_CAPABILITIES: readonly MissingCapability[] = [
  {
    id: "withdrawal",
    label: "Move assets out of Robinhood",
    reason:
      "No documented tool withdraws, and the product's whole safety story is that the agent " +
      "reaches only the balance the customer funded into the Agentic account. Unverified over " +
      "MCP: the inventory was read from documentation, not from tools/list.",
    evidence: [
      "docs: robinhood.com/us/en/agentic-trading (2026-08-24)",
      "fixture: lib/robinhood-mcp/fixtures/documented-tools.json",
    ],
  },
  {
    id: "external-transfer",
    label: "Transfer between accounts, or off-platform",
    reason:
      "No documented transfer tool exists, and the crypto article states in words that the agent " +
      "can trade crypto but cannot transfer it — those actions have to be done by the customer in " +
      "the Robinhood app.",
    evidence: [
      "docs: robinhood.com/us/en/support/articles/agentic-trading-overview (2026-08-24)",
    ],
  },
  {
    id: "crypto-staking",
    label: "Stake or lend crypto",
    reason:
      "Stated as excluded by the provider in the same sentence that excludes transfers, rather " +
      "than merely absent from the tool table.",
    evidence: [
      "docs: robinhood.com/us/en/support/articles/agentic-trading-overview (2026-08-24)",
    ],
  },
  {
    id: "account-opening",
    label: "Open an account",
    reason:
      "The provider states the agent cannot open a Robinhood Crypto account and can only point " +
      "the customer to where to do it. Opening the Agentic account itself is a desktop-only human " +
      "onboarding that runs during authentication.",
    evidence: [
      "docs: robinhood.com/us/en/support/articles/agentic-trading-overview (2026-08-24)",
    ],
  },
  {
    id: "margin-borrowing",
    label: "Borrow on margin",
    reason:
      "The provider states margin borrowing is not yet enabled for Agentic accounts. Limited " +
      "margin exists and only settles funds faster: it creates no loan, no interest and no margin " +
      "call, and the provider says so in its own disclosure.",
    evidence: [
      "docs: robinhood.com/us/en/support/articles/trading-with-your-agent (2026-08-24)",
    ],
  },
];

/**
 * Narrowing a history to what a person is looking for, and taking it with them.
 *
 * This is the depth `Simple | Pro` was supposed to mean and did not. Canon
 * `§0.7` allows Pro to carry *more data and control over the same product* and
 * forbids it from becoming a technical dump or a longer list, so what Pro adds
 * here is a way to narrow the list and a way to leave with it — never a row
 * Simple cannot see, and never a code, host or digest on screen.
 *
 * Pure and total: no clock, no storage, no network, no locale. The card decides
 * what to render; this decides what the answer is, and every branch of it is a
 * test rather than something reachable only by connecting a wallet with a
 * history behind it.
 *
 * The filter is generic over the caller's own row type rather than narrowing to
 * the fields it reads. A surface carries more per action than this module cares
 * about — a destination chain, a mint — and a filter that returned a narrower
 * shape would force every caller to widen it back, which is where a field
 * quietly goes missing from a screen.
 */

/**
 * The filters are the product's own pages, not the ledger's lanes (Owner,
 * 2026-09-12: *«можна було так само вибрати, що було у Своп, що було в Брідж,
 * що було в Спот»*). `SPOT` is a Swap-lane row whose origin says Spot; `SWAP`
 * is a Swap-lane row that does not; `BRIDGE` is everything that crossed a
 * chain — the USDC bridge and the cross-chain swap the Bridge page runs.
 */
export const HISTORY_FILTERS = ["ALL", "SPOT", "SWAP", "BRIDGE", "SEND", "RECEIVE", "NEEDS_YOU"] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export type HistoryLane = "SEND" | "SWAP" | "BRIDGE" | "RECEIVE" | "CROSS_SWAP";
export type HistoryOutcome = "IN_FLIGHT" | "DONE" | "FAILED" | "NEEDS_YOU";

export type HistoryMovement = Readonly<{
  amountRaw: string;
  decimals: number | null;
  symbol: string | null;
}>;

export type HistoryAction = Readonly<{
  actionId: string;
  lane: HistoryLane;
  outcome: HistoryOutcome;
  out: HistoryMovement | null;
  in: HistoryMovement | null;
  signature: string | null;
  /**
   * The chain transactions a cross-chain row has and `signature` cannot hold.
   *
   * Optional so every caller that predates them still satisfies this type. The
   * export reads them because a file somebody reconciles against a statement is
   * exactly where the identifier of a Base or Robinhood Chain transaction
   * belongs — canon `§0.5` keeps a hash off the screen, not out of a file the
   * person asked for.
   */
  sourceTx?: string | null;
  destinationTx?: string | null;
  /** What Ryntra charged, where the provider confirmed taking it. */
  fee?: Readonly<{ collected: boolean; amountRaw: string | null; decimals: number | null; symbol: string | null }> | null;
  /** Which page made the row, where the signed bundle carried it. */
  origin?: Readonly<{ surface: string; side?: string }> | null;
  updatedAt: string;
}>;

/** The page a row belongs to, as the filters name them. */
export function historyPage(action: Pick<HistoryAction, "lane" | "origin">): Exclude<HistoryFilter, "ALL" | "NEEDS_YOU"> {
  if (action.lane === "SWAP") return action.origin?.surface === "SPOT" ? "SPOT" : "SWAP";
  if (action.lane === "CROSS_SWAP" || action.lane === "BRIDGE") return "BRIDGE";
  if (action.lane === "RECEIVE") return "RECEIVE";
  return "SEND";
}

/**
 * `NEEDS_YOU` is not a lane, and that is the point of having it here.
 *
 * The other four filters answer *what kind of thing was this*; this one answers
 * *what is still mine to deal with*, which is the only question on this screen
 * with a deadline attached. A person who has done two hundred transfers and has
 * one waiting needs that one, not a lane.
 */
export function filterHistory<T extends HistoryAction>(
  actions: readonly T[],
  filter: HistoryFilter,
): readonly T[] {
  switch (filter) {
    case "ALL":
      return actions;
    case "NEEDS_YOU":
      return actions.filter(
        (action) => action.outcome === "NEEDS_YOU" || action.outcome === "IN_FLIGHT",
      );
    default:
      return actions.filter((action) => historyPage(action) === filter);
  }
}

/** How many rows each filter would show, so a control can say so before it is pressed. */
export function historyCounts<T extends HistoryAction>(
  actions: readonly T[],
): Readonly<Record<HistoryFilter, number>> {
  const counts = {} as Record<HistoryFilter, number>;
  for (const filter of HISTORY_FILTERS) counts[filter] = filterHistory(actions, filter).length;
  return counts;
}

function decimal(movement: HistoryMovement | null): string {
  if (!movement) return "";
  const decimals = movement.decimals ?? 0;
  const raw = movement.amountRaw;
  if (!/^\d+$/.test(raw)) return "";
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

/**
 * One CSV field.
 *
 * Every field is quoted and every quote doubled, unconditionally. Selective
 * quoting is where CSV writers go wrong, and the cost here is a spreadsheet
 * that silently splits somebody's transfer across two columns. A leading `=`,
 * `+`, `-` or `@` is also prefixed with a quote character, because a
 * spreadsheet treats those as formulas — a token symbol is data, and no export
 * of this product's should be able to execute anything when it is opened.
 */
function field(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export const HISTORY_EXPORT_COLUMNS = [
  "date",
  "kind",
  "state",
  "sent",
  "sent_asset",
  "received",
  "received_asset",
  "signature",
  "source_transaction",
  "destination_transaction",
  "ryntra_fee",
  "ryntra_fee_asset",
] as const;

/**
 * What is on screen, in a file the person owns.
 *
 * Deliberately the *filtered* list rather than everything: the export answers
 * the question the screen is currently asking. The signature is included
 * because this is a record to keep and check against a chain, which is the one
 * place a signature belongs — canon `§0.5` keeps it off the screen, not out of
 * a file the person asked for.
 */
export function historyToCsv(actions: readonly HistoryAction[]): string {
  const rows = [HISTORY_EXPORT_COLUMNS.map(field).join(",")];
  for (const action of actions) {
    rows.push(
      [
        action.updatedAt,
        action.lane,
        action.outcome,
        decimal(action.out),
        action.out?.symbol ?? "",
        decimal(action.in),
        action.in?.symbol ?? "",
        action.signature ?? "",
        action.sourceTx ?? "",
        action.destinationTx ?? "",
        /* A quoted fee is not a paid one, and a column in a file somebody
           reconciles is the last place to blur that. Only a confirmed
           collection is written; everything else is blank. */
        action.fee?.collected && action.fee.amountRaw
          ? decimal({ amountRaw: action.fee.amountRaw, decimals: action.fee.decimals ?? 0, symbol: action.fee.symbol ?? null })
          : "",
        action.fee?.collected && action.fee.amountRaw ? (action.fee.symbol ?? "") : "",
      ]
        .map(field)
        .join(","),
    );
  }
  /* Trailing newline: a file without one is a file some tools drop the last
     row of. */
  return `${rows.join("\n")}\n`;
}

/** A filename that sorts, and that says whose history and which slice. */
export function historyExportName(wallet: string, filter: HistoryFilter, isoDate: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(isoDate) ? isoDate.slice(0, 10) : "history";
  const slice = filter === "ALL" ? "" : `-${filter.toLowerCase()}`;
  return `ryntra-${wallet.slice(0, 4)}${slice}-${day}.csv`;
}

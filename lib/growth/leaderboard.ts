import { effectiveRewardEntries } from "../rewards/ledger.ts";
import type { RewardEntry } from "../rewards/model.ts";
import type { RankEvent } from "../rewards/rank.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { countedSwaps, traderWeek } from "./trader-pnl.ts";
import { within, type WeekRange } from "./weeks.ts";

/**
 * The three weekly boards — traders, friends, creators — computed from rows
 * that already exist.
 *
 * ## Status, never money
 *
 * A place on a board is a place and a badge. Nothing is paid for it, nothing
 * converts, nothing is entered: a board ranks what people did through Ryntra
 * in one week and starts again the next. Profit-and-volume prizes would turn
 * a stake and a result into a wager, which is exactly what Rewards rules
 * out.
 *
 * - **Traders** — the result of the week's closed trades in percent
 *   ({@link traderWeek}), from {@link TRADERS_MIN_CLOSED_USD} of closed
 *   trades, so a single dollar sold at a lucky moment does not top the board.
 * - **Friends** — how many people a wallet invited traded that week (a
 *   friend counts from a real trade on which Ryntra received a fee).
 * - **Creators** — the wallet's launches that left their curve for a DEX that
 *   week.
 *
 * ## Who is never on a board
 *
 * The owner's and test wallets (the admin's internal list) and anyone who
 * chose to be hidden. They are filtered when a board is read, not when it is
 * computed, so a change takes effect on the next read.
 *
 * Pure: the store, the clock and the internal list are the caller's.
 */

export const BOARD_IDS = ["TRADERS", "FRIENDS", "CREATORS"] as const;
export type BoardId = (typeof BOARD_IDS)[number];

/** The traders' board minimum: closed trades worth at least this many dollars in the week. */
export const TRADERS_MIN_CLOSED_USD = 100;
export const TRADERS_MIN_CLOSED_MICROS = BigInt(TRADERS_MIN_CLOSED_USD) * 1_000_000n;

/** Rows a board keeps and the page lists. */
export const BOARD_ROWS = 20;
/** Places that earn the week's podium. */
export const PODIUM = 3;

export type TraderMetric = Readonly<{ wallet: string; resultBps: number; closedCostMicros: string; closedTrades: number; at: string }>;
export type FriendMetric = Readonly<{ wallet: string; active: number; at: string }>;
export type CreatorMetric = Readonly<{ wallet: string; launches: number; at: string }>;

/** One week's figures for every wallet that did something on a board — before anyone is filtered. */
export type WeekMetrics = Readonly<{
  week: WeekRange;
  traders: readonly TraderMetric[];
  friends: readonly FriendMetric[];
  creators: readonly CreatorMetric[];
}>;

/** Reward rows by recipient, each group resolved on its own so one wallet's bad row never empties a board. */
export function entriesByRecipient(entries: readonly RewardEntry[]): ReadonlyMap<string, readonly RewardEntry[]> {
  const groups = new Map<string, RewardEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.recipient);
    if (list) list.push(entry);
    else groups.set(entry.recipient, [entry]);
  }
  const out = new Map<string, readonly RewardEntry[]>();
  for (const [wallet, list] of groups) {
    try {
      out.set(wallet, effectiveRewardEntries(list));
    } catch {
      /* Conflicting valuations: this wallet is left off, never guessed at. */
    }
  }
  return out;
}

/** Launch events, one per mint: the store keeps a wallet-led copy and the mint's own claim. */
export function uniqueRankEvents(events: readonly RankEvent[]): readonly RankEvent[] {
  const seen = new Map<string, RankEvent>();
  for (const event of events) seen.set(`${event.kind}:${event.ref}`, seen.get(`${event.kind}:${event.ref}`) ?? event);
  return [...seen.values()];
}

/** Every wallet's figures for one week. */
export function weekMetrics(
  args: Readonly<{
    week: WeekRange;
    entries: ReadonlyMap<string, readonly RewardEntry[]>;
    actions: ReadonlyMap<string, readonly SolanaWalletAction[]>;
    events: readonly RankEvent[];
  }>,
): WeekMetrics {
  const { week } = args;

  const traders: TraderMetric[] = [];
  for (const [wallet, actions] of args.actions) {
    /* Only wallets that sold something this week can have a result. */
    if (!countedSwaps(actions, wallet).some((action) => within(action.startedAt, week))) continue;
    const result = traderWeek(actions, wallet, week);
    if (result.resultBps === null || result.lastClosedAt === null) continue;
    traders.push({ wallet, resultBps: result.resultBps, closedCostMicros: result.closedCostMicros.toString(), closedTrades: result.closedTrades, at: result.lastClosedAt });
  }

  const friends: FriendMetric[] = [];
  for (const [wallet, rows] of args.entries) {
    const firstSeen = new Map<string, string>();
    for (const entry of rows) {
      if (entry.type !== "REFERRAL_L1" || entry.recipient !== wallet || !entry.source) continue;
      const friend = entry.source.trader;
      if (friend === wallet || !within(entry.source.settledAt, week)) continue;
      const known = firstSeen.get(friend);
      if (!known || entry.source.settledAt < known) firstSeen.set(friend, entry.source.settledAt);
    }
    if (firstSeen.size === 0) continue;
    /* The tie-break: when the count reached what it is — the last new friend's first trade. */
    const at = [...firstSeen.values()].sort().at(-1)!;
    friends.push({ wallet, active: firstSeen.size, at });
  }

  const byCreator = new Map<string, { launches: number; at: string }>();
  for (const event of uniqueRankEvents(args.events)) {
    if (event.kind !== "LAUNCH_GRADUATED" || !within(event.at, week)) continue;
    const known = byCreator.get(event.wallet);
    byCreator.set(event.wallet, { launches: (known?.launches ?? 0) + 1, at: known && known.at > event.at ? known.at : event.at });
  }
  const creators: CreatorMetric[] = [...byCreator].map(([wallet, value]) => ({ wallet, ...value }));

  return { week, traders, friends, creators };
}

export type BoardRow = Readonly<{
  place: number;
  wallet: string;
  /** Traders: basis points of result. Friends: active friends. Creators: launches on a DEX. */
  value: number;
}>;

const byText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * One board, ordered and placed, without the wallets `exclude` names.
 *
 * Ties are broken so the order never depends on how rows came out of the
 * store: traders by more closed, then whoever closed first; friends and
 * creators by whoever reached the count first; and last of all by address.
 */
export function boardRows(metrics: WeekMetrics, board: BoardId, exclude: ReadonlySet<string>): readonly BoardRow[] {
  const keep = <T extends { wallet: string }>(rows: readonly T[]) => rows.filter((row) => !exclude.has(row.wallet));
  let ordered: readonly { wallet: string; value: number }[];
  if (board === "TRADERS") {
    ordered = keep(metrics.traders)
      .filter((row) => BigInt(row.closedCostMicros) >= TRADERS_MIN_CLOSED_MICROS)
      .sort((a, b) => b.resultBps - a.resultBps || (BigInt(b.closedCostMicros) > BigInt(a.closedCostMicros) ? 1 : BigInt(b.closedCostMicros) < BigInt(a.closedCostMicros) ? -1 : 0) || byText(a.at, b.at) || byText(a.wallet, b.wallet))
      .map((row) => ({ wallet: row.wallet, value: row.resultBps }));
  } else if (board === "FRIENDS") {
    ordered = keep(metrics.friends)
      .sort((a, b) => b.active - a.active || byText(a.at, b.at) || byText(a.wallet, b.wallet))
      .map((row) => ({ wallet: row.wallet, value: row.active }));
  } else {
    ordered = keep(metrics.creators)
      .sort((a, b) => b.launches - a.launches || byText(a.at, b.at) || byText(a.wallet, b.wallet))
      .map((row) => ({ wallet: row.wallet, value: row.launches }));
  }
  return ordered.map((row, index) => ({ place: index + 1, ...row }));
}

/** The best place `wallet` holds on any board of a week, or null. */
export function bestPlace(metrics: WeekMetrics, wallet: string, exclude: ReadonlySet<string>): Readonly<{ board: BoardId; place: number }> | null {
  let best: { board: BoardId; place: number } | null = null;
  for (const board of BOARD_IDS) {
    const row = boardRows(metrics, board, exclude).find((candidate) => candidate.wallet === wallet);
    if (row && (best === null || row.place < best.place)) best = { board, place: row.place };
  }
  return best;
}

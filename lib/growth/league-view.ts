import { z } from "zod";

import { maskWallet } from "../rewards/referral.ts";
import { REWARD_RANKS, type RewardRank } from "../rewards/rules.ts";
import { walletFace } from "./badges.ts";
import { LIQUIDITY_BADGE_IDS, type LiquidityBadgeId } from "./liquidity.ts";
import { BOARD_IDS, BOARD_ROWS, boardRows, PODIUM, TRADERS_MIN_CLOSED_USD, type BoardId, type WeekMetrics } from "./leaderboard.ts";
import { SEASON_TASK_IDS, SEASON_THEMES, type SeasonProgress } from "./seasons.ts";
import { SEASON_WEEKS, weekOfSeason, type SeasonRange, type WeekRange } from "./weeks.ts";

/**
 * What the leaderboard and season pages may know, and nothing more.
 *
 * Another wallet appears only as four characters from each end of its
 * address, the number its face is drawn from, its rank (the frame it wears)
 * and the one figure the board ranks — a result in percent, a count of
 * friends, a count of launches. No dollar figure of anyone else ever leaves
 * the server. The viewer's own row may carry how far it is from the traders'
 * minimum, because that figure is theirs.
 *
 * The schemas are the routes' contract: the routes parse their own answer
 * before sending it, and a test reads them.
 */

const Rank = z.enum(REWARD_RANKS);
const Board = z.enum(BOARD_IDS);

export const LeagueRowSchema = z
  .object({
    place: z.number().int().min(1),
    /** Four characters from each end of the address. */
    name: z.string().min(1).max(20),
    /** The number the face is drawn from (`faceAvatarSvg`). */
    face: z.number().int().min(0),
    rank: Rank.nullable(),
    /** Traders: basis points of result. Friends: friends who traded. Creators: launches on a DEX. */
    value: z.number().int(),
    you: z.boolean(),
    /** The wallet's highest liquidity badge — only when it chose to show it on the boards. */
    liquidity: z.enum(LIQUIDITY_BADGE_IDS).optional(),
  })
  .strict();
export type LeagueRow = z.infer<typeof LeagueRowSchema>;

const YouOnBoardSchema = z
  .object({
    place: z.number().int().min(1).nullable(),
    value: z.number().int().nullable(),
    /** Traders only: dollars of closed trades this week, and the minimum. */
    closedUsd: z.string().nullable(),
  })
  .strict();

const BoardSchema = z.object({ rows: z.array(LeagueRowSchema), total: z.number().int().min(0) }).strict();

const SeasonHeadSchema = z
  .object({
    number: z.number().int().min(1),
    theme: z.enum(SEASON_THEMES),
    start: z.string().datetime(),
    end: z.string().datetime(),
    /** The week of the season the board's week is, 1 to `weeks`; null outside it. */
    week: z.number().int().min(1).nullable(),
    weeks: z.number().int().min(1),
  })
  .strict();

export const LeaderboardsResponseSchema = z
  .object({
    ok: z.literal(true),
    week: z
      .object({
        kind: z.enum(["current", "previous"]),
        start: z.string().datetime(),
        end: z.string().datetime(),
        final: z.boolean(),
        updatedAt: z.string().datetime(),
      })
      .strict(),
    season: SeasonHeadSchema.nullable(),
    boards: z.object({ TRADERS: BoardSchema, FRIENDS: BoardSchema, CREATORS: BoardSchema }).strict(),
    rules: z
      .object({
        tradersMinUsd: z.number().int().min(0),
        podium: z.number().int().min(1),
        rows: z.number().int().min(1),
        /** Whether the creators' board is offered: once any launch has reached a DEX. */
        creators: z.boolean(),
      })
      .strict(),
    /** The proven viewer, or null without proof. */
    you: z
      .object({
        name: z.string(),
        face: z.number().int().min(0),
        rank: Rank.nullable(),
        hidden: z.boolean(),
        /** An owner's or test wallet: never on a board. */
        excluded: z.boolean(),
        boards: z.object({ TRADERS: YouOnBoardSchema, FRIENDS: YouOnBoardSchema, CREATORS: YouOnBoardSchema }).strict(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type LeaderboardsResponse = z.infer<typeof LeaderboardsResponseSchema>;

function usd(micros: bigint): string {
  const cents = micros / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function seasonHead(season: SeasonRange | null, weekStart: string, theme: (typeof SEASON_THEMES)[number] | null): z.infer<typeof SeasonHeadSchema> | null {
  if (!season || !theme) return null;
  return { number: season.number, theme, start: season.start, end: season.end, week: weekOfSeason(season, weekStart), weeks: SEASON_WEEKS };
}

function row(
  place: number,
  wallet: string,
  value: number,
  ranks: Readonly<Record<string, RewardRank>>,
  viewer: string | null,
  liquidity: Readonly<Record<string, LiquidityBadgeId>> = {},
): LeagueRow {
  const shown = Object.hasOwn(liquidity, wallet) ? liquidity[wallet] : undefined;
  return { place, name: maskWallet(wallet), face: walletFace(wallet), rank: ranks[wallet] ?? null, value, you: wallet === viewer, ...(shown ? { liquidity: shown } : {}) };
}

/** The boards of one week as the page reads them. */
export function leaderboardsView(
  args: Readonly<{
    kind: "current" | "previous";
    week: WeekRange;
    metrics: WeekMetrics;
    ranks: Readonly<Record<string, RewardRank>>;
    computedAt: string;
    final: boolean;
    exclude: ReadonlySet<string>;
    season: z.infer<typeof SeasonHeadSchema> | null;
    creators: boolean;
    /** The proven viewer: their wallet, rank now, whether hidden and whether internal. */
    viewer: Readonly<{ wallet: string; rank: RewardRank | null; hidden: boolean; internal: boolean }> | null;
    /** The highest liquidity badge of each wallet that chose to show it (`readPublicLiquidity`). */
    liquidity?: Readonly<Record<string, LiquidityBadgeId>>;
  }>,
): LeaderboardsResponse {
  const viewerWallet = args.viewer?.wallet ?? null;
  const boards = {} as Record<BoardId, { rows: LeagueRow[]; total: number }>;
  for (const board of BOARD_IDS) {
    const ordered = boardRows(args.metrics, board, args.exclude);
    boards[board] = {
      rows: ordered.slice(0, BOARD_ROWS).map((entry) => row(entry.place, entry.wallet, entry.value, args.ranks, viewerWallet, args.liquidity)),
      total: ordered.length,
    };
  }
  let you: LeaderboardsResponse["you"] = null;
  if (args.viewer) {
    const wallet = args.viewer.wallet;
    /* Where the viewer stands — or, hidden, would stand were they shown. An
       owner's or test wallet has no place at all. */
    const viewerExclude = args.viewer.internal ? args.exclude : new Set([...args.exclude].filter((candidate) => candidate !== wallet));
    const mine = Object.fromEntries(
      BOARD_IDS.map((board) => {
        const standing = boardRows(args.metrics, board, viewerExclude).find((entry) => entry.wallet === wallet);
        const closed = board === "TRADERS" ? args.metrics.traders.find((entry) => entry.wallet === wallet) : undefined;
        const value =
          standing?.value
          ?? (board === "TRADERS" ? closed?.resultBps ?? null
            : board === "FRIENDS" ? args.metrics.friends.find((entry) => entry.wallet === wallet)?.active ?? null
            : args.metrics.creators.find((entry) => entry.wallet === wallet)?.launches ?? null);
        return [board, { place: standing?.place ?? null, value, closedUsd: board === "TRADERS" ? usd(closed ? BigInt(closed.closedCostMicros) : 0n) : null }];
      }),
    ) as Record<BoardId, z.infer<typeof YouOnBoardSchema>>;
    you = { name: maskWallet(wallet), face: walletFace(wallet), rank: args.viewer.rank, hidden: args.viewer.hidden, excluded: args.viewer.internal, boards: mine };
  }
  return LeaderboardsResponseSchema.parse({
    ok: true,
    week: { kind: args.kind, start: args.week.start, end: args.week.end, final: args.final, updatedAt: args.computedAt },
    season: args.season,
    boards,
    rules: { tradersMinUsd: TRADERS_MIN_CLOSED_USD, podium: PODIUM, rows: BOARD_ROWS, creators: args.creators },
    you,
  });
}

/* ----------------------------------------------------------------- season */

const PodiumsSchema = z.object({ TRADERS: z.array(LeagueRowSchema), FRIENDS: z.array(LeagueRowSchema), CREATORS: z.array(LeagueRowSchema) }).strict();

export const SeasonResponseSchema = z
  .object({
    ok: z.literal(true),
    /** The season now — the page's link to the current one. Null before seasons begin. */
    current: z.number().int().min(1).nullable(),
    /** Whether the creators' podium is shown: once any launch has reached a DEX. */
    creators: z.boolean(),
    season: SeasonHeadSchema.extend({ state: z.enum(["LIVE", "ENDED"]) }).strict().nullable(),
    weeks: z.array(
      z
        .object({
          number: z.number().int().min(1),
          start: z.string().datetime(),
          end: z.string().datetime(),
          state: z.enum(["ENDED", "LIVE", "AHEAD"]),
          /** Ended and past the time late settlements may land: its podium is final. */
          final: z.boolean(),
          /** The top three of each board — for a week that has ended or is running; null ahead or when unreadable. */
          podiums: PodiumsSchema.nullable(),
        })
        .strict(),
    ),
    community: z.object({ participants: z.number().int().min(0), complete: z.number().int().min(0) }).strict().nullable(),
    you: z
      .object({
        hidden: z.boolean(),
        tasks: z.array(z.object({ id: z.enum(SEASON_TASK_IDS), done: z.boolean(), have: z.number().int().min(0), need: z.number().int().min(1), at: z.string().datetime().nullable() }).strict()),
        complete: z.boolean(),
        completedAt: z.string().datetime().nullable(),
        /** The best finished weekly place in the top three, if any: the podium badge. */
        podium: z.object({ board: Board, place: z.number().int().min(1), week: z.number().int().min(1) }).strict().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type SeasonResponse = z.infer<typeof SeasonResponseSchema>;

export function podiumsOf(metrics: WeekMetrics, ranks: Readonly<Record<string, RewardRank>>, exclude: ReadonlySet<string>, viewer: string | null): z.infer<typeof PodiumsSchema> {
  return Object.fromEntries(
    BOARD_IDS.map((board) => [board, boardRows(metrics, board, exclude).slice(0, PODIUM).map((entry) => row(entry.place, entry.wallet, entry.value, ranks, viewer))]),
  ) as z.infer<typeof PodiumsSchema>;
}

export function youInSeason(progress: SeasonProgress, hidden: boolean, podium: Readonly<{ board: BoardId; place: number; week: number }> | null): NonNullable<SeasonResponse["you"]> {
  return {
    hidden,
    tasks: progress.tasks.map((task) => ({ ...task })),
    complete: progress.complete,
    completedAt: progress.completedAt,
    podium,
  };
}


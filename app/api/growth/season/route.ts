import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { BOARD_IDS, boardRows, PODIUM, type BoardId } from "@/lib/growth/leaderboard";
import { boardExclusions, launchesReachedDex, readSeasonCounts, readWeek, seasonsBegan, type WeekSnapshot } from "@/lib/growth/league-store";
import { podiumsOf, SeasonResponseSchema, seasonHead, youInSeason, type SeasonResponse } from "@/lib/growth/league-view";
import { seasonProgress, seasonTheme } from "@/lib/growth/seasons";
import { seasonAt, seasonRange, weekRange } from "@/lib/growth/weeks";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { listRewardEntries } from "@/lib/rewards/ledger";
import { getWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/growth/season[?season=N][&address=]` — a season and its weeks.
 *
 * Public: the theme, the dates, each week's top three on every board, and
 * how many people took part. With `address` and that wallet's proof, also
 * what the viewer did of the season's tasks and their podium badge. Without
 * `season`, the season running now. Before the first season began, every
 * part is empty rather than invented.
 */
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

const EMPTY: SeasonResponse = { ok: true, current: null, creators: false, season: null, weeks: [], community: null, you: null };

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const url = new URL(req.url);
  const asked = url.searchParams.get("season");
  const address = url.searchParams.get("address") ?? "";

  try {
    const store = getGuardRuntime().store;
    const now = new Date().toISOString();
    const nowMs = Date.parse(now);
    const firstStart = await seasonsBegan(store, now);
    const current = firstStart ? seasonAt(firstStart, now) : null;
    if (!firstStart || !current) return json(EMPTY);
    const number = asked === null ? current.number : Number(asked);
    if (!Number.isInteger(number) || number < 1 || number > current.number) {
      return json({ ok: false, error: "SEASON_NOT_FOUND", current: current.number }, 404);
    }
    const season = seasonRange(firstStart, number);
    const [exclusions, creators] = await Promise.all([boardExclusions(store), launchesReachedDex(store).catch(() => false)]);

    let viewer: string | null = null;
    if (address) {
      const proof = await getWalletProofFrom(req.headers);
      if (proof && proof.chain === "solana" && proof.address === address) viewer = address;
    }

    const snapshots = new Map<string, WeekSnapshot>();
    const weeks: SeasonResponse["weeks"] = [];
    for (const [index, start] of season.weeks.entries()) {
      const range = weekRange(start);
      const state = nowMs >= Date.parse(range.end) ? "ENDED" : nowMs >= Date.parse(range.start) ? "LIVE" : "AHEAD";
      let podiums: SeasonResponse["weeks"][number]["podiums"] = null;
      let final = false;
      if (state !== "AHEAD") {
        const snapshot = await readWeek(store, range, now).catch(() => null);
        if (snapshot) {
          snapshots.set(start, snapshot);
          final = snapshot.final;
          podiums = podiumsOf(snapshot.metrics, snapshot.ranks, exclusions.wallets, viewer);
        }
      }
      weeks.push({ number: index + 1, start: range.start, end: range.end, state, final, podiums });
    }

    const community = await readSeasonCounts(store, season, now, exclusions.internal)
      .then(({ participants, complete }) => ({ participants, complete }))
      .catch(() => null);

    let you: SeasonResponse["you"] = null;
    if (viewer) {
      const wallet = viewer;
      const entries = await listRewardEntries(store, wallet).catch(() => null);
      if (entries) {
        /* The podium badge: a top-three place on a week whose figures are
           final — never on one late settlements could still change. A hidden
           wallet is not on the boards, so it holds none. */
        let podium: { board: BoardId; place: number; week: number } | null = null;
        for (const week of weeks) {
          if (week.state !== "ENDED" || !week.final) continue;
          const snapshot = snapshots.get(week.start);
          if (!snapshot) continue;
          for (const board of BOARD_IDS) {
            const place = boardRows(snapshot.metrics, board, exclusions.wallets).find((row) => row.wallet === wallet)?.place;
            if (place !== undefined && place <= PODIUM && (podium === null || place < podium.place)) podium = { board, place, week: week.number };
          }
        }
        /* The viewer's own rows failing to read leave only their part out, never the season. */
        try {
          you = youInSeason(seasonProgress({ wallet, entries, season, at: now }), exclusions.hidden.has(wallet), podium);
        } catch {
          you = null;
        }
      }
    }

    const head = seasonHead(season, season.start, seasonTheme(season.number));
    /* The week running now, for a season still running; null once it ended. */
    const live = weeks.find((week) => week.state === "LIVE")?.number ?? null;
    return json(
      SeasonResponseSchema.parse({
        ok: true,
        current: current.number,
        creators,
        season: head ? { ...head, week: live, state: nowMs >= Date.parse(season.end) ? "ENDED" : "LIVE" } : null,
        weeks,
        community,
        you,
      }),
    );
  } catch {
    return json({ ok: false, error: "SEASON_UNAVAILABLE" }, 503);
  }
}

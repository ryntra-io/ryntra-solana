import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { boardExclusions, launchesReachedDex, readWeek, seasonsBegan } from "@/lib/growth/league-store";
import { leaderboardsView, seasonHead } from "@/lib/growth/league-view";
import { seasonTheme } from "@/lib/growth/seasons";
import { currentWeek, previousWeek, seasonAt } from "@/lib/growth/weeks";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { readRankStanding } from "@/lib/rewards/rank-store";
import { getWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/growth/leaderboards?week=current|previous[&address=]` — the
 * three boards of one week.
 *
 * Public: a board is a status people chose to be seen with, and every name
 * on it is four characters from each end of an address that is public on
 * any explorer anyway. With `address` and that wallet's proof, the answer
 * also says where the viewer stands — including how far a trader is from the
 * board's minimum, which is nobody else's business and so never without the
 * proof. Not cached by the browser: the viewer's part rides on a cookie.
 */
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const url = new URL(req.url);
  const kind = url.searchParams.get("week") === "previous" ? "previous" : "current";
  const address = url.searchParams.get("address") ?? "";

  try {
    const store = getGuardRuntime().store;
    const now = new Date().toISOString();
    const week = kind === "previous" ? previousWeek(now) : currentWeek(now);
    const [exclusions, snapshot, firstStart, creators] = await Promise.all([
      boardExclusions(store),
      readWeek(store, week, now),
      seasonsBegan(store, now).catch(() => null),
      launchesReachedDex(store).catch(() => false),
    ]);
    const season = firstStart ? seasonAt(firstStart, week.start) : null;

    let viewer: Parameters<typeof leaderboardsView>[0]["viewer"] = null;
    if (address) {
      const proof = await getWalletProofFrom(req.headers);
      if (proof && proof.chain === "solana" && proof.address === address) {
        const rank = await readRankStanding(store, address, now).then((standing) => standing.rank).catch(() => null);
        viewer = { wallet: address, rank, hidden: exclusions.hidden.has(address), internal: exclusions.internal.has(address) };
      }
    }

    return json(
      leaderboardsView({
        kind,
        week,
        metrics: snapshot.metrics,
        ranks: snapshot.ranks,
        computedAt: snapshot.computedAt,
        final: snapshot.final,
        exclude: exclusions.wallets,
        season: seasonHead(season, week.start, season ? seasonTheme(season.number) : null),
        creators,
        viewer,
      }),
    );
  } catch {
    return json({ ok: false, error: "LEADERBOARDS_UNAVAILABLE" }, 503);
  }
}

import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { resolveInternalWallets } from "@/lib/admin/internal-wallets";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { listAllPointsEntries, listPointsEntries, rankPoints } from "@/lib/points/ledger";
import { pointsView } from "@/lib/points/view";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { rewardsActivation } from "@/lib/rewards/activation";
import { readClaim } from "@/lib/rewards/claim";
import { ensureRewardAccount, listRewardEntries, readRewardAccount, reconcileReferralEdges, readReferralCounts } from "@/lib/rewards/ledger";
import { maskWallet, referralLink } from "@/lib/rewards/referral";
import { rankStanding, rankSummary, type RankEvent } from "@/lib/rewards/rank";
import { achievementsOf } from "@/lib/growth/achievements";
import { listRankEvents, rewardRulesEffectiveFrom, rewardRulesFor } from "@/lib/rewards/rank-store";
import type { RewardRules } from "@/lib/rewards/rules";
import { readRewardsReserve, rewardsTreasuryConfig } from "@/lib/rewards/treasury.server";
import { heldUsdMicros, readReserveLedger } from "@/lib/rewards/reserve";
import { rewardsView } from "@/lib/rewards/view";
import { getWalletProofFrom } from "@/lib/session";
import { replayBenefitJobs } from "@/lib/rewards/benefit-replay.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `/api/rewards` — what this wallet has earned, behind proof it owns it.
 *
 * ## Why proof, when History is readable by address
 *
 * `solanaWalletActions` is deliberately readable by address alone: everything
 * in it is already visible on an explorer under that same address, and gating a
 * public read behind a signature is theatre. Rewards are the opposite. A
 * balance owed by Ryntra exists nowhere on chain, a referral code is a thing
 * only its owner should be handed, and how much somebody has earned is not
 * public. So this route answers only for the wallet that has proved itself —
 * the same proof the payment-request listing uses, from a signed message rather
 * than a transaction.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

function publicOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const url = new URL(req.url);
  const address = url.searchParams.get("address") ?? "";
  const locale = url.searchParams.get("locale") === "uk" ? "uk" : "en";
  /* The `rw` proof cookie in a browser, or the native bearer session for the
     same wallet (`RYN-API-CONTRACT-001`, contract 1.1.0: rewards over the bearer). */
  const proof = await getWalletProofFrom(req.headers);
  if (!proof || proof.chain !== "solana" || proof.address !== address) {
    return json({ error: "proof required", proof: false }, 401);
  }

  try {
  const store = getGuardRuntime().store;
  const now = new Date().toISOString();
  // Only this proven wallet's already queued settlements; no history backfill.
  await replayBenefitJobs(store, { wallet: address, limit: 2, budgetMs: 6_000, now }).catch(() => undefined);
  /* Creating the record here is what gives a person a referral link the first
     time they open the page, without asking them to sign anything extra. */

  /*
   * No attribution happens here any more.
   *
   * It used to: a code in the browser and a proven wallet first existed
   * together at this exact point, so this is where they were joined. It worked
   * and it was too quiet — a person never saw who they were being attached to,
   * and somebody who had opened the wrong link had no moment at which to
   * notice. Binding now lives in `/api/rewards/referral` as its own deliberate
   * action, and this read only reports what is already true.
   */
  /* Created on first sight so a person has a link to copy without signing
     anything extra. Creating a row is not an attribution. */
  const account = await ensureRewardAccount(store, address, now);

  /*
   * Re-assert this wallet's place in the referral graph before the counts are
   * read.
   *
   * An attribution made before the counters existed — by the old read path that
   * bound silently while a page loaded — left its referrer's figure at zero and
   * nothing indexed the graph by referrer, so it could never be found again.
   * The edge write is idempotent, so this costs an absent-key check for a wallet
   * whose edges are already there and repairs one whose are not, exactly once.
   */
  await reconcileReferralEdges(store, address, now);
  /* Rules 2.0.0 come into force on the first ask after this build is deployed
     to production — a read counts, so the page and the next trade agree on
     which rules apply. A failure here is a rank left unavailable, never a
     failed Rewards read. */
  /* The rules in force decide the shares the page shows; if they cannot be
     read, the rank is unavailable rather than shown under the wrong rules. */
  const rulesNow = await rewardRulesFor(store, now, now).catch(() => null);
  const [entries, reserve, claim, ledger, points] = await Promise.all([
    listRewardEntries(store, address),
    readRewardsReserve(),
    readClaim(store, address),
    readReserveLedger(store),
    readPoints(store, address),
  ]);

  const view = rewardsView({
    entries,
    reserve,
    /* What other people's open claims are already holding out of the same pot.
       Without this the page would offer one dollar to two wallets. */
    heldUsdMicros: heldUsdMicros(ledger, now),
    /* Counted when somebody confirmed this wallet as their inviter, not when
       they first traded — a referrer who has invited ten people has invited
       ten people. */
    referrals: await readReferralCounts(store, address),
    claim,
    locale,
    referral: { code: account.code, link: referralLink(publicOrigin(req), account.code) },
  });

  const latestAccount = await readRewardAccount(store, address);
  const payoutConfig = rewardsTreasuryConfig();
  const payoutsEnabled = payoutConfig.configured && payoutConfig.canSign;
  const response = json({
    ok: true,
    address,
    /* `bigint` does not survive JSON, and the page needs the decimal strings
       rather than the micro counts anyway. The one figure it needs as a number
       is whether Claim may be pressed, which is already a boolean. */
    available: view.available,
    pending: view.pending,
    lifetime: view.lifetime,
    cashback: view.cashback,
    referralL1: view.referralL1,
    referralL2: view.referralL2,
    sourceAmounts: Object.fromEntries(Object.entries(view.balance.bySource).map(([key, value]) => [key, value.toString()])),
    claimable: view.balance.claimable && payoutsEnabled,
    claimBlockedReason: payoutsEnabled ? view.balance.claimBlockedReason : locale === "uk" ? "Виплати винагород тимчасово недоступні." : "Rewards payouts are temporarily unavailable.",
    pendingReasons: view.balance.pendingReasons,
    referrals: view.referrals,
    rows: view.rows,
    referral: view.referral,
    claim: view.claim,
    /* Who this wallet is attached to, masked, or null. The page renders a
       confirmed block from it and never a Change control: after an explicit
       confirmation the inviter does not move in V1. */
    invitedBy: latestAccount?.referrer ? maskWallet(latestAccount.referrer) : null,
    /* Ryntra Points — six figures about this wallet's own activity and a
       rank that names no other wallet. Null when the ledger could not be
       read, which the page shows as unavailable rather than as zero. */
    points,
    /* `rank`: the rank over the last 30 days and what it pays on a friend's
       trade. Null when the rank events could not be read — unavailable, not
       Bronze. `achievements`: every rank ever reached and the achievements
       held, each with its day; null when they could not be read. */
    ...(await readRankAndBadges(store, address, entries, now, rulesNow)),
    /* Has accrual begun at all on this deployment? A page that says
       "your rewards will appear after your first trade" while nothing is
       accruing is making a promise that is not yet true, and the honest
       fix is one sentence rather than a hidden menu entry. */
    started: rewardsActivation().state === "OPEN",
  });
  return response;
  } catch { return json({ ok: false, error: "REWARDS_UNAVAILABLE" }, 503); }
}

/**
 * This wallet's rank and its badges, from the rows already read plus its
 * rank events — read once for both. Each is null on its own failure: the
 * rank needs the rules in force, the badges only the rows.
 */
async function readRankAndBadges(
  store: ReturnType<typeof getGuardRuntime>["store"],
  wallet: string,
  entries: Parameters<typeof rankStanding>[0]["entries"],
  now: string,
  rules: RewardRules | null,
) {
  let events: readonly RankEvent[];
  try {
    events = await listRankEvents(store, wallet);
  } catch {
    return { rank: null, achievements: null };
  }
  /* When ranks began on this store — badges are dated from it, never before;
     null while rules 2.0.0 have not begun here. A failed read leaves only the
     badges unavailable, never the rank. */
  const since = await rewardRulesEffectiveFrom(store, now).catch(() => undefined);
  const rank = (() => {
    if (!rules) return null;
    try {
      return rankSummary(rankStanding({ wallet, entries, events, at: now }), rules);
    } catch {
      return null;
    }
  })();
  /* The ranks reached and the achievements held — badges stay when a rank
     falls. Null when they cannot be computed, which the page shows by not
     drawing the panel. */
  const achievements = (() => {
    if (since === undefined) return null;
    try {
      return achievementsOf({ wallet, entries, events, at: now, since });
    } catch {
      return null;
    }
  })();
  return { rank, achievements };
}

/**
 * This wallet's points, and where it stands.
 *
 * The rank needs every external wallet's rows, so the whole collection is
 * read — right at this product's volume, and written down in the ledger
 * module as the thing that moves to a rollup when it stops being right. A
 * failure here is a null on the page, never a failed Rewards read: points are
 * a fact beside the balance, not a condition of it.
 */
async function readPoints(store: ReturnType<typeof getGuardRuntime>["store"], wallet: string) {
  try {
    const [mine, all, internal] = await Promise.all([
      listPointsEntries(store, wallet),
      listAllPointsEntries(store),
      resolveInternalWallets(store, process.env),
    ]);
    if (internal.store !== "measured") return null;
    return { ...pointsView({ entries: mine, wallet, ranking: rankPoints(all, internal.wallets) }), excluded: internal.wallets.has(wallet) };
  } catch {
    return null;
  }
}

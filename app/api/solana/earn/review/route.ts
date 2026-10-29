import { openEarnDoor } from "@/lib/earn/http.server";
import { earnReviewHandler } from "@/lib/earn/routes";
import { reviewEarn } from "@/lib/earn/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The Review of one Earn action — a deposit of an asset from the wallet into a lending market, or a
 * withdrawal back to it. The provider builds the transaction, the market is read at the same moment the bytes
 * are built, the amount is cut to what the market can actually pay, and the answer is what the Review shows
 * with a ticket sealing those exact bytes. Nothing is signed or sent here, and Ryntra takes no fee.
 */
export const POST = earnReviewHandler({ openDoor: openEarnDoor, review: reviewEarn });

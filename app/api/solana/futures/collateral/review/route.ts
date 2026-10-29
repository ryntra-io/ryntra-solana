import { reviewCollateral } from "@/lib/phoenix/collateral.server";
import { collateralReviewHandler } from "@/lib/phoenix/collateral-routes";
import { openCollateralDoor } from "@/lib/phoenix/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The Review of a Phoenix collateral action (B6) — a deposit of USDC from the wallet or a withdrawal back to it: Phoenix's
 * SDK builds the transaction, every instruction is checked against the action and the whole is simulated, and the answer
 * is what Review shows with a ticket that seals those exact bytes. Nothing is signed or sent here; no fee of Ryntra's.
 */
export const POST = collateralReviewHandler({ openDoor: openCollateralDoor, review: reviewCollateral });

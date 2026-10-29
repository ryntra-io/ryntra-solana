import { openCollateralDoor } from "@/lib/phoenix/http.server";
import { reviewOrder } from "@/lib/phoenix/orders.server";
import { orderReviewHandler } from "@/lib/phoenix/orders-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The Review of a Phoenix order (B6b) — open or add to a position, cut or close it, set its TP/SL, cancel a resting
 * order: Phoenix's SDK builds the transaction, every instruction is checked byte for byte against the order and the
 * whole is simulated with Phoenix's own view of the account after it (margin, liquidation price, funding). The answer is
 * what Review shows with a ticket that seals those exact bytes. Nothing is signed or sent here.
 */
export const POST = orderReviewHandler({ openDoor: openCollateralDoor, review: reviewOrder });

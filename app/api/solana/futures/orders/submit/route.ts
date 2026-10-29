import { openCollateralDoor } from "@/lib/phoenix/http.server";
import { submitOrder } from "@/lib/phoenix/orders.server";
import { orderSubmitHandler } from "@/lib/phoenix/orders-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The wallet's signed Phoenix order (B6b): the bytes are held to the Review's ticket — the same message, the same wallet,
 * the signature real, the gate as it stands now — then sent once and settled from the chain's answer, with Phoenix's
 * record of what it filled. A refusal before the send means nothing moved.
 */
export const POST = orderSubmitHandler({ openDoor: openCollateralDoor, submit: submitOrder, env: () => process.env });

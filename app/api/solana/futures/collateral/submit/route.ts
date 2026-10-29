import { submitCollateral } from "@/lib/phoenix/collateral.server";
import { collateralSubmitHandler } from "@/lib/phoenix/collateral-routes";
import { openCollateralDoor } from "@/lib/phoenix/http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The wallet's signed collateral action (B6): the bytes are held to the Review's ticket — the same message, the same
 * wallet, the signature real, the gate as it stands now — then sent once and settled from the chain's answer. A refusal
 * before the send means nothing moved.
 */
export const POST = collateralSubmitHandler({ openDoor: openCollateralDoor, submit: submitCollateral, env: () => process.env });

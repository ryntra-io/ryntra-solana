import { openEarnDoor } from "@/lib/earn/http.server";
import { earnSubmitHandler } from "@/lib/earn/routes";
import { submitEarn } from "@/lib/earn/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The signed bytes, once. Before they leave: the gate as it stands now, the market as it stands now — a rate
 * that fell past the tolerance or liquidity that can no longer pay the withdrawal holds them back — and the
 * bytes themselves against the Review's seal. Afterwards the answer is a receipt, and a chain that has not
 * answered yet is «unknown» rather than «nothing moved».
 */
export const POST = earnSubmitHandler({ openDoor: openEarnDoor, submit: submitEarn });

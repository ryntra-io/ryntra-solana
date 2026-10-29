import { readApiBody } from "@/lib/api/v1/http";
import { AllowanceBuildRequestSchema } from "@/lib/solana/allowances/contract";
import { NOT_SERVED, allowanceFailure, allowanceJson, allowanceRateRefusal } from "@/lib/solana/allowances/http.server";
import { allowanceDeps, buildAllowance } from "@/lib/solana/allowances/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/solana/allowances/build` (SOL-7) — the one transaction for a spending-limit action on the Subscriptions
 * program, for the person's wallet to sign as the fee payer, with the Review that says what it does. The server keeps
 * the unsigned bytes to compare the signed ones with and signs nothing.
 */
export async function POST(request: Request) {
  const deps = allowanceDeps();
  if (!deps) return allowanceFailure("ALLOWANCES_UNAVAILABLE", NOT_SERVED);
  const limited = allowanceRateRefusal("write", request.headers);
  if (limited) return limited;
  const read = await readApiBody(request, AllowanceBuildRequestSchema, 8_000);
  if (!read.ok) return read.response;
  const built = await buildAllowance(deps, read.body);
  if (!built.ok) return allowanceFailure(built.code, built.message, { issues: built.issues });
  return allowanceJson(built.build);
}

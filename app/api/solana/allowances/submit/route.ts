import { readApiBody } from "@/lib/api/v1/http";
import { AllowanceSendStatusQuerySchema, AllowanceSubmitRequestSchema } from "@/lib/solana/allowances/contract";
import { NOT_SERVED, allowanceFailure, allowanceJson, allowanceRateRefusal } from "@/lib/solana/allowances/http.server";
import { allowanceDeps, allowanceSendStatus, submitAllowance } from "@/lib/solana/allowances/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/solana/allowances/submit` (SOL-7) — what the wallet signed: the built transaction, with only the wallet's
 * own fee and guard instructions added; sent once. `PENDING` — sent and not confirmed in time: the page reads the
 * chain again, nothing is sent twice.
 */
export async function POST(request: Request) {
  const deps = allowanceDeps();
  if (!deps) return allowanceFailure("ALLOWANCES_UNAVAILABLE", NOT_SERVED);
  const limited = allowanceRateRefusal("write", request.headers);
  if (limited) return limited;
  const read = await readApiBody(request, AllowanceSubmitRequestSchema, 16_000);
  if (!read.ok) return read.response;
  const submitted = await submitAllowance(deps, read.body).catch(() => null);
  if (!submitted) return allowanceFailure("ALLOWANCE_SEND_UNKNOWN", "Whether it was sent is not known now: read the limits again before preparing it again.");
  if (!submitted.ok) return allowanceFailure(submitted.code, submitted.message);
  return allowanceJson(submitted.submit);
}

/**
 * `GET /api/solana/allowances/submit?build=&wallet=` (SOL-7) — a sent build's word from the chain: CONFIRMED, FAILED,
 * NOT_LANDED (never on chain and never can be) or PENDING. The page asks it after a PENDING or a lost answer, until it
 * is final; it sends nothing.
 */
export async function GET(request: Request) {
  const deps = allowanceDeps();
  if (!deps) return allowanceFailure("ALLOWANCES_UNAVAILABLE", NOT_SERVED);
  const limited = allowanceRateRefusal("read", request.headers);
  if (limited) return limited;
  const url = new URL(request.url);
  const query = AllowanceSendStatusQuerySchema.safeParse({ build: url.searchParams.get("build"), wallet: url.searchParams.get("wallet") });
  if (!query.success) return allowanceFailure("VALIDATION_ERROR", "build, wallet: required");
  const read = await allowanceSendStatus(deps, query.data).catch(() => null);
  if (!read) return allowanceFailure("UNAVAILABLE", "The network could not be read now.");
  if (!read.ok) return allowanceFailure(read.code, read.message);
  return allowanceJson(read.status);
}

import { RulePaymentOwnRequestSchema, type RuleListResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { markOwnPaymentAccount } from "@/lib/autoinvest/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * «Це мій рахунок» (contract 1.19.0 — «перекази між своїми рахунками не
 * рахуються»). The proven wallet names the other side of one of its counted
 * payments, by the payment's signature, as its own account: no transfer to or
 * from it counts for any «З кожної оплати» rule of the wallet from now on, and
 * every waiting event with it leaves what waits. The answer is the wallet's
 * rules as they stand after it; the account itself is never named back.
 * Nothing moves money here.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, RulePaymentOwnRequestSchema, 1_024);
  if (!read.ok) return read.response;
  const runtime = getGuardRuntime();
  if (!runtime.writes.allowed || !storeSurvivesColdStart(runtime.store)) return apiFailure("UNAVAILABLE", "Rules need a durable store; this deployment does not have one.");
  const marked = await markOwnPaymentAccount(runtime.store, proof.address, read.body.signature);
  if (!marked.ok) return apiFailure(marked.code, marked.message);
  return apiJson({ address: proof.address, rules: [...marked.rules], total: marked.total, budget: marked.budget } satisfies RuleListResponse);
}

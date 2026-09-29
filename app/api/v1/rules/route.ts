import { RuleCreateRequestSchema, type RuleListResponse, type RuleResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { createRule, listRules } from "@/lib/autoinvest/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The proven wallet's «Автоінвест» rules (`RYN-INVEST-SIMPLE-001`, sessions
 * 3–4, contracts 1.12.0 and 1.13.0): `GET` lists them newest first, each
 * occurrence read through the wallet's History, with the month's budget;
 * `POST` writes one — a confirmed company, a sum in dollars, and how often and
 * when on the person's own clock («Регулярно»), how far its price must fall
 * («Якщо впаде», the reference point the price now), or what it takes from
 * the wallet's own USDC payments and incoming transfers («З кожної оплати»,
 * contract 1.19.0 — the sum the least a reminder opens at). A rule only schedules a
 * reminder: every purchase is the wallet's own signature on a fresh Review.
 * One set of routes for the web (proof cookie) and the phone (bearer); see
 * `lib/api/v1/proof.ts`.
 */

export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const listed = await listRules(getGuardRuntime().store, proof.address);
  return apiJson({ address: proof.address, rules: [...listed.rules], total: listed.total, budget: listed.budget } satisfies RuleListResponse);
}

export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, RuleCreateRequestSchema, 4_096);
  if (!read.ok) return read.response;
  const runtime = getGuardRuntime();
  /* A rule is written once and reminds for months: the store must outlive the instance, which the runtime's own write gate decides. */
  if (!runtime.writes.allowed || !storeSurvivesColdStart(runtime.store)) return apiFailure("UNAVAILABLE", "Rules need a durable store; this deployment does not have one.");
  const created = await createRule(runtime.store, {
    owner: proof.address,
    mint: read.body.asset.mint,
    amountUsd: read.body.amountUsd,
    kind: read.body.kind,
    schedule: read.body.schedule ?? null,
    dip: read.body.dip ?? null,
    payments: read.body.payments ?? null,
    priceCondition: read.body.priceCondition ?? null,
    locale: read.body.locale,
  });
  if (!created.ok) return apiFailure(created.code, created.message);
  return apiJson({ rule: created.rule } satisfies RuleResponse, 201);
}

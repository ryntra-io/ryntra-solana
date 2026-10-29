import { apiFailure, apiJson } from "@/lib/api/v1/http";
import type { PlanAnswer } from "@/lib/assistant/plans/service";

export const NO_STORE = { "cache-control": "private, no-store" } as const;
export const PLAN_ID = /^apl_[0-9a-f]{24}$/;

export const localeOf = (request: Request): "en" | "uk" => (new URL(request.url).searchParams.get("locale") === "uk" ? "uk" : "en");

/** The service's answer as the contract carries it: the plan, or the failure with its code (`PLAN_INVALID` with the fields). */
export function planAnswer(answer: PlanAnswer, headers: Record<string, string> = {}) {
  if (!answer.ok) return apiFailure(answer.code, answer.reason, { headers, ...(answer.issues ? { issues: answer.issues } : {}) });
  return apiJson(answer.response, 200, { ...headers, ...NO_STORE });
}

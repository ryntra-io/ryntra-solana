/**
 * The context a conversation opens from, written as one query parameter:
 * `asset:<mint>[:<symbol>]`, `plan:<id>`, `portfolio`, `note:<id>` or
 * `page:<name>`. The same reader on the web page and on the suggestions
 * route; the same writer on every "Ask Ryn" link.
 */

import { AgentContextSchema, BASE58, PLAN_ID, type AgentContext } from "../api/v1/contract.ts";

export function parseContextParam(raw: string | null): AgentContext | null {
  if (!raw) return null;
  const [kind, ...rest] = raw.split(":");
  if (kind === "asset" && rest[0] && BASE58.test(rest[0])) {
    const parsed = AgentContextSchema.safeParse({ kind: "asset", mint: rest[0], ...(rest[1] ? { symbol: rest[1].slice(0, 32) } : {}) });
    return parsed.success ? parsed.data : null;
  }
  if (kind === "plan" && rest[0] && PLAN_ID.test(rest[0])) return { kind: "plan", planId: rest[0] };
  if (kind === "portfolio") return { kind: "portfolio" };
  if (kind === "note" && rest[0] && rest[0].length >= 4 && rest[0].length <= 64) return { kind: "note", inboxId: rest[0] };
  if (kind === "page" && rest[0]) {
    const parsed = AgentContextSchema.safeParse({ kind: "page", page: rest[0] });
    return parsed.success ? parsed.data : null;
  }
  return null;
}

export function contextParam(context: AgentContext): string {
  switch (context.kind) {
    case "asset":
      return `asset:${context.mint}${context.symbol ? `:${context.symbol}` : ""}`;
    case "plan":
      return `plan:${context.planId}`;
    case "portfolio":
      return "portfolio";
    case "note":
      return `note:${context.inboxId}`;
    default:
      return `page:${context.page}`;
  }
}

/** The address of Ryn's page for a context, with an optional first question. */
export function rynHref(context: AgentContext | null, question?: string): string {
  const params = new URLSearchParams();
  if (context) params.set("context", contextParam(context));
  if (question) params.set("q", question);
  const query = params.toString();
  return query ? `/app/ryn?${query}` : "/app/ryn";
}

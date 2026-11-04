import { z } from "zod";

import { AGENT_SYMBOL_ENV, agentResult, joinBook } from "@/lib/mandate/agent-service.server";
import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";
import { planFrom } from "@/lib/mandate/plans";
import { STRATEGIES } from "@/lib/mandate/strategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * CITY-175 — the agent's book, on devnet. `POST` — the mandate the person just signed joins the agent's book with her
 * strategy (checked on chain first: the policy, its one signer the agent, the person's account); `GET ?policy=&owner=`
 * — what the agent did for her: its state, its trades, what it spent and bought, and what that is worth now; with
 * `&since=<ms>` (CITY-194) also what it did since then, and always its last day.
 * Public data only; this route holds no key and signs nothing.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Digits = z.string().regex(/^\d{1,20}$/);
const RecordSchema = z.object({ owner: Base58, settings: Base58, vault: Base58, policy: Base58, budget: Base58, perTrade: Digits, perDay: Digits, expiresAt: Digits }).strict();
const BodySchema = z.object({ record: RecordSchema, strategy: z.enum(STRATEGIES), plan: z.string().max(80).nullish(), said: z.string().max(140).nullish(), coin: Base58.nullish() }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "agent");
  if (gate instanceof Response) return gate;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  /* CITY-193: the strategy's numbers, as the plan's text; none — the strategy's own defaults are not guessed, steady is. */
  const plan = body.plan ? planFrom(body.plan) : null;
  if ((body.plan && !plan) || (plan && plan.id !== body.strategy) || (!plan && body.strategy !== "steady")) return mandateFailure(422, "REFUSED", "Not a strategy the agent runs.", gate.rate);
  const joined = await joinBook({ record: body.record, strategy: body.strategy, plan, said: body.said ?? null, coin: body.coin ?? null }, gate);
  if (!joined.ok) return mandateFailure(joined.code === "UNAVAILABLE" ? 503 : 422, joined.code, joined.reason, gate.rate);
  return Response.json({ network: gate.network, status: joined.entry.status, strategy: joined.entry.strategy, plan: joined.entry.plan ?? "steady" }, { headers: mandateHeaders(gate.rate) });
}

export async function GET(request: Request) {
  const gate = openMandate(request, "agent-read");
  if (gate instanceof Response) return gate;
  const url = new URL(request.url);
  const policy = Base58.safeParse(url.searchParams.get("policy"));
  const owner = Base58.safeParse(url.searchParams.get("owner"));
  if (!policy.success || !owner.success) return mandateFailure(400, "VALIDATION_ERROR", "Not addresses.", gate.rate);
  /* CITY-194: `since` — when this browser last saw the agent, ms; the answer then says what it did since. */
  const sinceText = url.searchParams.get("since");
  const since = sinceText && /^\d{12,14}$/u.test(sinceText) ? Number(sinceText) : null;
  const view = await agentResult({ policy: policy.data, owner: owner.data, since }, gate, { symbol: process.env[AGENT_SYMBOL_ENV] ?? null }).catch(() => undefined);
  if (view === undefined) return mandateFailure(503, "UNAVAILABLE", "The agent's book did not answer.", gate.rate);
  if (!view) return mandateFailure(404, "NOT_IN_BOOK", "The agent does not work for this mandate.", gate.rate);
  return Response.json({ network: gate.network, ...view }, { headers: mandateHeaders(gate.rate) });
}

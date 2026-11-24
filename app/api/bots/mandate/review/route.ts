import { z } from "zod";

import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";
import { DAYS_MAX } from "@/lib/mandate/budget";
import { AGENT_EXIT_ENV, agentExitOn } from "@/lib/mandate/exit.server";
import { reviewEnable } from "@/lib/mandate/service.server";
import { planFrom } from "@/lib/mandate/plans";
import { botMoneyRefusal, botOfPlan } from "@/lib/bots/money/gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Turn the agent on, on the gate's network: `POST` the person's wallet, her budget — the day's cap and the
 * trade's in lamports, the term in days, any numbers she wrote — and, on mainnet, the coin the
 * agent buys; the answer is her unsigned transactions (one wallet approval), the mandate's public addresses, and what the
 * signature moves into her vault and gives the agent for its fees. `exit` — the agent keeps the coin in her
 * vault and sells it on its own by the rules her ticket shows (a second policy, the same approval), while the deployment
 * says `RYNTRA_AGENT_EXIT=on`. `plan` — the plan the budget is for; a bot that sells (the grid's levels,
 * signals) is reviewed only while its money is open (`RYNTRA_BOTS_*_MONEY`) and always with the sale — refused before
 * her signature, never after. This route never signs: it has no key.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Lamports = z.string().regex(/^\d{1,20}$/);
const BodySchema = z.object({ owner: Base58, perDay: Lamports, perTrade: Lamports, days: z.number().int().min(1).max(DAYS_MAX), smartAccount: Base58.nullish(), coin: Base58.nullish(), exit: z.boolean().optional(), plan: z.string().max(80).nullish() }).strict();

export async function POST(request: Request) {
  const gate = openMandate(request, "review");
  if (gate instanceof Response) return gate;
  const body = await readMandateBody(request, BodySchema, gate.rate);
  if (body instanceof Response) return body;
  const budget = { perDay: BigInt(body.perDay), perTrade: BigInt(body.perTrade), days: body.days };
  const exit = body.exit === true && agentExitOn(process.env[AGENT_EXIT_ENV]);
  const plan = body.plan ? planFrom(body.plan) : null;
  if (body.plan && !plan) return mandateFailure(422, "REFUSED", "Not a strategy the agent runs.", gate.rate);
  const closed = botMoneyRefusal(plan, process.env);
  if (closed) return mandateFailure(422, "REFUSED", closed, gate.rate);
  if (botOfPlan(plan) !== null && !exit) return mandateFailure(422, "REFUSED", "A bot that sells needs its budget signed with the sale.", gate.rate);
  const review = await reviewEnable({ owner: body.owner, budget, smartAccount: body.smartAccount ?? null, coin: body.coin ?? null, exit }, gate);
  if (!review.ok) return mandateFailure(review.code === "VALIDATION_ERROR" ? 400 : 422, review.code, review.reason, gate.rate);
  return Response.json({ network: gate.network, record: review.record, transactions: review.transactions, fundLamports: review.fundLamports, networkLamports: review.networkLamports }, { headers: mandateHeaders(gate.rate) });
}

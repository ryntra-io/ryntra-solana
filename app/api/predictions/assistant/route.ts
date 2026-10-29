import { z } from "zod";

import { agentDepsFor, agentGuestDeps } from "@/app/api/v1/agent/runtime";
import { guestKeyFor } from "@/lib/assistant/guest";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { clientIp, FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";
import { askRyntraOnMarket, type AskAsker } from "@/lib/predictions/assistant/service";
import { ASK_TOPICS } from "@/lib/predictions/assistant/topics";
import { failure } from "@/lib/predictions/failure";
import { optionalPredictionActor, predictionFailure, predictionJson, readPredictionBody } from "@/lib/predictions/http";
import { getPredictionProvider } from "@/lib/predictions/agg/adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Body = z
  .object({
    eventId: Id,
    venueMarketId: Id,
    outcomeId: Id.nullable().optional(),
    topic: z.enum(ASK_TOPICS).nullable().optional(),
    text: z.string().max(600).optional(),
    locale: z.enum(["en", "uk"]),
    amountUsd: z.number().finite().positive().max(100_000).nullable().optional(),
  })
  .strict()
  .refine((body) => Boolean(body.topic) || Boolean(body.text?.trim()), { message: "Ask with a topic or with words." });

/** A warm instance's burst bound per asker; the model's day is the assistant's own allowance. */
const limiter = new FixedWindowLimiter({ limit: 10, windowMs: 60_000, maxKeys: 5_000 });

/**
 * `POST /api/predictions/assistant` — «Спитати Ryntra» on a market. The
 * assistant's composer, verifier, model and allowance on the prediction
 * reads: a proven Solana wallet asks on its own allowance (free credits
 * only — no price is shown here), anyone else as a guest keyed by a digest
 * of the day. Nothing is quoted, placed or signed; the plan draft opens in
 * the plan builder.
 */
export async function POST(request: Request) {
  const read = await readPredictionBody(request, Body, 4_096);
  if (!read.ok) return read.response;
  const actor = await optionalPredictionActor(request);
  const secret = process.env.BETA_TOKEN_SECRET?.trim();
  const guestKey = secret ? guestKeyFor(clientIp(request.headers), secret, Date.now()) : null;
  const asker: AskAsker = actor && actor.chain === "solana" ? { kind: "wallet", wallet: actor.wallet } : { kind: "guest", key: guestKey };
  const rate = limiter.consume(asker.kind === "wallet" ? asker.wallet : (guestKey ?? clientIp(request.headers)));
  if (!rate.allowed) return predictionFailure(failure("RATE_LIMITED", "Too many questions in a minute; ask again shortly.", { retryAfterSeconds: 60 }));
  const guard = getGuardRuntime();
  const core = asker.kind === "wallet" ? await agentDepsFor(request, asker.wallet) : await agentGuestDeps();
  /* Without durable writes the model's allowance would live in one instance's memory, so the model is not called: the reads answer. */
  const metered = guard.writes.allowed && storeSurvivesColdStart(guard.store);
  try {
    const response = await askRyntraOnMarket(
      { store: guard.store, provider: getPredictionProvider(), model: metered ? core.model : null, budget: core.budget, credits: core.credits ?? null },
      { asker, eventId: read.body.eventId, venueMarketId: read.body.venueMarketId, outcomeId: read.body.outcomeId ?? null, topic: read.body.topic ?? null, text: read.body.text ?? "", locale: read.body.locale, amountUsd: read.body.amountUsd ?? null },
    );
    return predictionJson(response, 200, rateLimitHeaders(rate));
  } catch {
    return predictionFailure(failure("UNAVAILABLE", "Ryntra could not answer just now; ask again."));
  }
}

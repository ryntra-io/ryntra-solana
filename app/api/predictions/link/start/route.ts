import { z } from "zod";

import { isTurnstileToken } from "@/lib/predictions/bot-check";
import { predictionFailure, predictionJson, readPredictionBody, requirePredictionActor } from "@/lib/predictions/http";
import { startLink } from "@/lib/predictions/link";
import { predictionsLocale } from "@/lib/predictions/locale.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** No body, or the bot check's token when the last start answered CHALLENGE_REQUIRED. */
const StartBody = z.object({ turnstileToken: z.string().refine(isTurnstileToken, "not a bot-check token").optional() }).strict();

/**
 * Step one of the identity link: the provider issues its own nonce and the
 * server builds the sign-in message for the proven wallet and this site. The
 * browser signs exactly this text with the wallet — one explicit signature,
 * shown by the wallet as a sign-in for this domain — and nothing else. The
 * Ryntra proof is never reused.
 *
 * When many people sign in at once the provider asks for its bot check
 * first: the answer is CHALLENGE_REQUIRED with the site key, the browser
 * shows the check and posts here again with its token.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const body = await readPredictionBody(request, StartBody, 4_096);
  if (!body.ok) return body.response;
  const { actor } = resolved;
  const url = new URL(request.url);
  const locale = await predictionsLocale();
  const challenge = await startLink(actor.store, actor.provider, actor.wallet, { domain: url.host, uri: url.origin, locale, turnstileToken: body.body.turnstileToken ?? null });
  if (!challenge.ok) return predictionFailure(challenge);
  return predictionJson(challenge.value);
}

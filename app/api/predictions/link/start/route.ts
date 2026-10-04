import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { predictionFailure, predictionJson, requirePredictionActor } from "@/lib/predictions/http";
import { startLink } from "@/lib/predictions/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step one of the identity link: the provider issues its own nonce and the
 * server builds the sign-in message for the proven wallet and this site. The
 * browser signs exactly this text with the wallet — one explicit signature,
 * shown by the wallet as a sign-in for this domain — and nothing else. The
 * Ryntra proof is never reused.
 */
export async function POST(request: Request) {
  const resolved = await requirePredictionActor(request, "mutation");
  if (!resolved.ok) return resolved.response;
  const { actor } = resolved;
  const url = new URL(request.url);
  const locale = await solanaServerLocale();
  const challenge = await startLink(actor.store, actor.provider, actor.wallet, { domain: url.host, uri: url.origin, locale });
  if (!challenge.ok) return predictionFailure(challenge);
  return predictionJson(challenge.value);
}

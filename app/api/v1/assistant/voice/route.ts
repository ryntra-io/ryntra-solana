import { creditsContextForWallet, fixturesOn } from "@/app/api/v1/agent/runtime";
import { readCreditsResponse } from "@/lib/assistant/credits/view";
import { voiceDailySeconds, createOpenAiTranscriber } from "@/lib/assistant/telegram/voice";
import { createFixtureTranscriber, hearWebVoice } from "@/lib/assistant/voice/web";
import { ASSISTANT_VOICE_MAX_BASE64, AssistantVoiceRequestSchema, type AssistantVoiceResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "private, no-store" } as const;
/** The audio in base64 and the few fields around it. */
const BODY_MAX = ASSISTANT_VOICE_MAX_BASE64 + 1_024;
/** Six recordings a minute per wallet: a person speaks a question and corrects it; a script would send hundreds. */
const limiter = new FixedWindowLimiter({ limit: 6, windowMs: 60_000, maxKeys: 5_000 });

/**
 * `POST /api/v1/assistant/voice` (contract 1.64.0, AI-08) — a recording the
 * browser made, heard on the server where its own recognition is missing or
 * failed, at the price shown (`prices.voice` for each started 30 s, up to two
 * minutes). The answer is the words for the question field, never a question
 * asked: the person corrects them and presses «Спитати». Nothing here asks
 * the agent, signs, sends or trades.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  /* A body that says it is larger than two minutes of audio is not read at all; one that says nothing is bounded by the platform's limit and then by `readApiBody`. */
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > BODY_MAX) return apiFailure("VOICE_TOO_LONG", "Two minutes is the longest recording heard.");
  const rate = limiter.consume(proof.address);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many recordings in a minute; try again shortly.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, AssistantVoiceRequestSchema, BODY_MAX);
  if (!read.ok) return read.response;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", "Voice on the server needs a durable store; this deployment does not have one.");
  const context = await creditsContextForWallet(proof.address, Date.now());
  if (!context) return apiFailure("CAPABILITY_UNAVAILABLE", "Credits are switched off on this deployment, so voice is not heard on the server.");
  const body = read.body;
  const heard = await hearWebVoice(
    {
      store: guard.store,
      holder: context.holder,
      config: context.config,
      /* The stand hears with the fixture: nothing leaves the machine, nothing is paid. */
      transcriber: fixturesOn() ? createFixtureTranscriber() : createOpenAiTranscriber(process.env, fetch, "web"),
      dailySeconds: voiceDailySeconds(process.env),
      now: Date.now,
    },
    { id: body.id, audio: new Uint8Array(Buffer.from(body.audio, "base64")), mime: body.mime, seconds: body.seconds, locale: body.locale, acceptCredits: body.acceptCredits },
  ).catch(() => null);
  if (heard === null) return apiFailure("UNAVAILABLE", "The recording could not be heard now; nothing was charged.");
  if (!heard.ok) return apiFailure(heard.code, heard.reason, { headers: rateLimitHeaders(rate) });
  const credits = await readCreditsResponse(guard.store, context, Date.now())
    .then((view) => view.credits)
    .catch(() => null);
  return apiJson({ text: heard.text, seconds: heard.seconds, spent: heard.spent, free: heard.free, repeat: heard.repeat, credits } satisfies AssistantVoiceResponse, 200, { ...rateLimitHeaders(rate), ...NO_STORE });
}

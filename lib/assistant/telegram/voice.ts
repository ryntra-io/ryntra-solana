/**
 * Voice in Telegram (AI-07, PLAN §7) — a voice message as the person's
 * question, never as a permission.
 *
 * Telegram hands the bot a voice message as a file with its length. The
 * length is shown with the price before anything is heard: 6 credits for each
 * started 30 seconds, up to two minutes. Only «Розпізнати» sends the file to
 * the server's transcriber (`gpt-transcribe`, the language always given, the
 * product's tickers as the hint — what AI-01 measured: WER 13 %, the ticker
 * heard in 95 % of recordings). The words heard come back with «Так» and
 * «Виправити»; only «Так» asks them. Ryntra answers in text — there is no
 * voice out.
 *
 * Every transcription is priced from the seconds the provider says it billed
 * (`usage.type = "duration"`) — measured, never guessed — and written to the
 * runtime log as one `[assistant.cost]` line without a chat or a word.
 */

import { priceOf, type CreditsConfig } from "../credits/prices.ts";

/** The longest voice message heard: two minutes. */
export const VOICE_MAX_SECONDS = 120;
/**
 * The most a voice message may weigh per second it says it lasts. The length
 * in a voice message is the sender's word; Telegram's voice notes are Opus at
 * 16–32 kbit/s (2–4 KB a second) — 16 KB a second is four times that, so an
 * honest recording always passes and a file that hides hours behind «1 s» is
 * never sent to be heard.
 */
export const VOICE_BYTES_PER_SECOND = 16 * 1024;
/** Two minutes at that rate — and never more, whatever a message says. */
export const VOICE_MAX_BYTES = VOICE_MAX_SECONDS * VOICE_BYTES_PER_SECOND;

/** The bytes a voice message of `seconds` may weigh: at least 64 KB (a short note's container), at most two minutes'. */
export function voiceBytesAllowed(seconds: number): number {
  return Math.min(VOICE_MAX_BYTES, Math.max(64 * 1024, Math.ceil(seconds) * VOICE_BYTES_PER_SECOND));
}
/** Credits are counted per each started block of this many seconds. */
export const VOICE_BLOCK_SECONDS = 30;

export const TRANSCRIBE_MODEL_ENV = "OPENAI_ASSISTANT_MODEL_VOICE";
export const TRANSCRIBE_MODEL_DEFAULT = "gpt-transcribe";
/** USD per minute of audio, OpenAI's list read on 17.10.2026 (AI-01, `scripts/assistant/quality/pricing.mjs`). */
export const TRANSCRIBE_PRICES: Readonly<Record<string, number>> = { "gpt-transcribe": 0.0045, "gpt-4o-mini-transcribe": 0.003 };
/** The deployment's ceiling of voice heard on the server in a UTC day, in seconds — the setting `RYNTRA_ASSISTANT_VOICE_DAILY_SECONDS`. */
export const VOICE_DAILY_SECONDS_ENV = "RYNTRA_ASSISTANT_VOICE_DAILY_SECONDS";
export const VOICE_DAILY_SECONDS_DEFAULT = 6 * 60 * 60;

/** The words a transcriber is given as a hint: the product's tickers and names, never a sentence (AI-01's glossary). */
export const VOICE_GLOSSARY = "Ryntra, SOL, Solana, BONK, JUP, Jupiter, WIF, dogwifhat, USDC, TRUMP, PEPE, NVDAx, NVDAon, OPENAI, PreStocks, Meteora, $";

/* The glossary's words, longest first, without the marks between them: «Pre-Stocks», «NVDA on» and «$SOL» are its words too. */
const GLOSSARY_RUN = new RegExp(
  `^(?:${VOICE_GLOSSARY.toLowerCase()
    .split(/[\s,]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .join("|")})*$`,
  "u",
);

/* What a recogniser is known to write over silence besides its hint — a video's closing line, a subtitler's credit. */
const SILENCE_FILLERS = ["дякую за перегляд", "продовження наступає", "thank you for watching", "thanks for watching", "subtitles by the amara.org community"].map((line) => line.replace(/[^\p{L}\p{N}]/gu, ""));

/**
 * AI-21 (the phone's request 70): whether the words heard are the hint
 * itself. On silence a recogniser may answer with its prompt — 26 s of
 * nothing came back as «Ryntra, SOL, Solana, BONK, …» and was charged as
 * words. Words heard that are only the glossary's (or nothing once its words,
 * the marks between them and a known silence filler are taken out) are no
 * words at all: nothing was heard, and nothing is charged. A ticker said alone
 * («SOL») is answered the same way — the person types it.
 */
export function onlyGlossary(text: string): boolean {
  let compact = text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  for (const filler of SILENCE_FILLERS) compact = compact.split(filler).join("");
  /* Longer than the glossary said three times over is speech, and the pattern is never run on it. */
  return compact.length <= 3 * VOICE_GLOSSARY.length && GLOSSARY_RUN.test(compact);
}

/**
 * A voice note's real length from its container — Opus in Ogg, as Telegram
 * records it: the granule position of the last page, at Opus's 48 kHz. `null`
 * when the bytes are not Ogg or carry no page with a position.
 */
export function oggSeconds(bytes: Uint8Array): number | null {
  const isPage = (at: number) => bytes[at] === 0x4f && bytes[at + 1] === 0x67 && bytes[at + 2] === 0x67 && bytes[at + 3] === 0x53;
  if (bytes.length < 27 || !isPage(0)) return null;
  /* The stream the file begins with is the recording: a page of any other stream (a crafted tail) is not its length. */
  const serial = (at: number) => (bytes[at + 14]! | (bytes[at + 15]! << 8) | (bytes[at + 16]! << 16) | (bytes[at + 17]! << 24)) >>> 0;
  const first = serial(0);
  for (let at = bytes.length - 27; at >= 0; at -= 1) {
    if (!isPage(at) || serial(at) !== first) continue;
    let granule = 0n;
    for (let i = 7; i >= 0; i -= 1) granule = (granule << 8n) | BigInt(bytes[at + 6 + i]!);
    /* -1 (all bits set) marks a page with no finished packet: look further back. */
    if (granule === 0xffffffffffffffffn) continue;
    return Number(granule) / 48_000;
  }
  return null;
}

/** The started blocks of a voice message: 1 s … 30 s is one, 31 s … 60 s two, up to four at two minutes. */
export function voiceBlocks(seconds: number): number {
  const whole = Math.max(1, Math.ceil(seconds));
  return Math.ceil(whole / VOICE_BLOCK_SECONDS);
}

/** What hearing a voice message costs, shown before it is heard. */
export function voiceCredits(config: CreditsConfig, seconds: number): number {
  return voiceBlocks(seconds) * priceOf(config, "voice");
}

export type VoiceRefusal = "too-long" | "too-big" | "not-voice";

/** A voice message the bot will offer to hear, or why not — decided on what Telegram says of the file, before it is fetched. */
export function judgeVoice(input: Readonly<{ seconds: number | undefined; bytes: number | undefined; mime: string | undefined }>): Readonly<{ ok: true; seconds: number }> | Readonly<{ ok: false; why: VoiceRefusal }> {
  const seconds = typeof input.seconds === "number" && Number.isFinite(input.seconds) ? Math.max(1, Math.ceil(input.seconds)) : null;
  if (seconds === null) return { ok: false, why: "not-voice" };
  if (seconds > VOICE_MAX_SECONDS) return { ok: false, why: "too-long" };
  if (typeof input.bytes === "number" && input.bytes > voiceBytesAllowed(seconds)) return { ok: false, why: "too-big" };
  if (input.mime && !/^audio\//i.test(input.mime)) return { ok: false, why: "not-voice" };
  return { ok: true, seconds };
}

export function voiceDailySeconds(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env[VOICE_DAILY_SECONDS_ENV]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : VOICE_DAILY_SECONDS_DEFAULT;
}

export function transcribeModel(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const named = env[TRANSCRIBE_MODEL_ENV]?.trim();
  return named && /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(named) ? named : TRANSCRIBE_MODEL_DEFAULT;
}

/** Micro-dollars for seconds billed, rounded up; `null` for a model the table does not price. */
export function transcribeMicroUsd(model: string, seconds: number): number | null {
  const perMinute = TRANSCRIBE_PRICES[model];
  if (perMinute === undefined) return null;
  return Math.ceil((perMinute * 1_000_000 * Math.max(0, seconds)) / 60 - 1e-9);
}

/**
 * `measured` — the seconds are the provider's own; false when it said none and they were estimated from the file's size.
 * A recording the provider heard as no words still carries what it billed (`billedSeconds`, `costMicroUsd`): the
 * person pays nothing, the deployment's day of voice counts it (AI-21).
 */
export type Heard =
  | Readonly<{ ok: true; text: string; billedSeconds: number; measured: boolean; costMicroUsd: number | null; model: string; latencyMs: number }>
  | Readonly<{ ok: false; reason: string; billedSeconds?: number; costMicroUsd?: number | null }>;

/** Hear a voice file: its bytes and type, the person's language. */
export type Transcriber = (input: Readonly<{ bytes: Uint8Array; mime: string; locale: "uk" | "en"; seconds: number }>) => Promise<Heard>;

/** Where a recording came from: a Telegram voice message, or the web's recording (AI-08). */
export type VoiceChannel = "telegram" | "web";

/** The line the runtime log gets for one transcription: the model, the seconds, the cost, the latency, the outcome — never a chat or a word. */
export function voiceCostLine(input: Readonly<{ model: string; billedSeconds: number; measured?: boolean; costMicroUsd: number | null; latencyMs: number; outcome: "ok" | "failed"; channel?: VoiceChannel }>): string {
  return `[assistant.cost] ${JSON.stringify({ task: "transcribe", model: input.model, seconds: input.billedSeconds, measured: input.measured ?? true, costUsd: input.costMicroUsd === null ? null : input.costMicroUsd / 1_000_000, latencyMs: input.latencyMs, outcome: input.outcome, channel: input.channel ?? "telegram" })}`;
}

/**
 * The production transcriber: OpenAI's `/v1/audio/transcriptions` with the
 * language and the glossary, the key from the environment only. `null` when
 * the deployment has no key or the model switch is off — voice then says it
 * is not available, and nothing is charged.
 */
export function createOpenAiTranscriber(env: Readonly<Record<string, string | undefined>> = process.env, fetchImpl: typeof fetch = fetch, channel: VoiceChannel = "telegram"): Transcriber | null {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key || env.RYNTRA_AGENT_MODEL_ENABLED?.trim() !== "1") return null;
  const model = transcribeModel(env);
  return async ({ bytes, mime, locale, seconds }) => {
    const started = Date.now();
    const form = new FormData();
    form.append("model", model);
    form.append("language", locale);
    form.append("prompt", VOICE_GLOSSARY);
    form.append("response_format", "json");
    const type = mime.split(";")[0] || "audio/ogg";
    /* The provider reads the format from the name: Telegram's voice is Ogg; a sent audio file keeps its own kind. */
    const name = type.includes("ogg") || type.includes("opus") ? "voice.ogg" : type.includes("mpeg") || type.includes("mp3") ? "voice.mp3" : type.includes("mp4") || type.includes("m4a") || type.includes("aac") ? "voice.m4a" : type.includes("wav") ? "voice.wav" : type.includes("webm") ? "voice.webm" : "voice.ogg";
    form.append("file", new Blob([bytes as BlobPart], { type }), name);
    try {
      const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30_000) });
      const latencyMs = Date.now() - started;
      if (!response.ok) {
        console.info(voiceCostLine({ model, billedSeconds: 0, costMicroUsd: 0, latencyMs, outcome: "failed", channel }));
        return { ok: false, reason: `the transcriber answered ${response.status}` };
      }
      const body = (await response.json()) as { text?: unknown; usage?: { type?: unknown; seconds?: unknown } };
      const measured = body.usage?.type === "duration" && typeof body.usage.seconds === "number" && Number.isFinite(body.usage.seconds);
      /* No seconds from the provider: the container's own length, else the file at Opus's lowest 6 kbit/s — never the sender's stated length alone. */
      const billed = measured ? Math.ceil(body.usage!.seconds as number) : Math.max(seconds, Math.ceil(oggSeconds(bytes) ?? bytes.byteLength / 750));
      const cost = transcribeMicroUsd(model, billed);
      console.info(voiceCostLine({ model, billedSeconds: billed, measured, costMicroUsd: cost, latencyMs, outcome: "ok", channel }));
      const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim().slice(0, 2_000) : "";
      /* The prompt's own words back (silence, AI-21): nothing was heard — the hold is given back on the web and in Telegram alike. */
      return text && !onlyGlossary(text) ? { ok: true, text, billedSeconds: billed, measured, costMicroUsd: cost, model, latencyMs } : { ok: false, reason: "nothing was heard", billedSeconds: billed, costMicroUsd: cost };
    } catch (error) {
      console.info(voiceCostLine({ model, billedSeconds: 0, costMicroUsd: 0, latencyMs: Date.now() - started, outcome: "failed", channel }));
      return { ok: false, reason: error instanceof Error ? error.message : "the transcriber did not answer" };
    }
  };
}

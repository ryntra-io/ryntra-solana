/**
 * AI-08 — the web's paid voice (PLAN §7, §9): a recording the browser made,
 * heard on Ryntra's server where the browser's own recognition is missing or
 * failed. Voice is input only (AI-Р9): what is heard comes back as words for
 * the question field, where the person reads and corrects the ticker and the
 * sum; nothing is asked, and nothing at all is done, until they press
 * «Спитати». No route here reaches the agent, a plan or a wallet.
 *
 * The price is the Telegram voice's: 6 credits for each started 30 seconds,
 * up to two minutes, shown before the recording is sent (`acceptCredits` must
 * be that price). The order is the ledger's own: price shown → hold → heard →
 * the hold kept for words heard, given back whole when nothing was. Each
 * recording carries the browser's own id: sent again (a lost answer, a second
 * press) it is answered with the words already heard, never charged twice.
 *
 * The length is the browser's word, so it is read from the recording's own
 * container (WebM, MP4, Ogg — `length.ts`) before anything is paid; a
 * recording whose container does not say is not heard. The deployment's day
 * of voice, shared with Telegram, is claimed at the most a recording of that
 * many bytes could hold, and settled at what the provider billed — at that
 * most when the provider did not say (a timeout, an error), never at zero.
 * A holder whose recording the provider heard longer than the browser said
 * has no voice on the server for the rest of the UTC day.
 */

import { withBoundedCasRetry, type GuardStore } from "../../guard/store.ts";
import { readBalance, reserveCredits, settleCredits } from "../credits/ledger.ts";
import type { CreditsConfig } from "../credits/prices.ts";
import { claimVoiceSeconds, settleVoiceSeconds } from "../telegram/link.ts";
import { VOICE_MAX_SECONDS, voiceCredits, type Heard, type Transcriber } from "../telegram/voice.ts";
import { recordingSeconds } from "./length.ts";

/** A recording said to last this long may be this much longer by its container: a browser's clock and the audio's own differ by a frame or two. */
export const WEB_VOICE_SLACK_SECONDS = 2;
/**
 * The most a second of a browser's recording may weigh: 24 KB. The recorder
 * asks 32 kbit/s (4 KB a second); Safari may keep AAC's own 128 kbit/s
 * (16 KB a second) and its container — both fit, and two minutes of it stay
 * under the platform's body limit in base64.
 */
export const WEB_VOICE_BYTES_PER_SECOND = 24 * 1024;
export const WEB_VOICE_MAX_BYTES = VOICE_MAX_SECONDS * WEB_VOICE_BYTES_PER_SECOND;
/** Speech at its thinnest — Opus at 6 kbit/s: the longest a recording of so many bytes could be, for the deployment's day. */
const WORST_BYTES_PER_SECOND = 750;

export const VOICE_COLLECTION = "assistantVoice" as const;
/** The recordings a holder's record keeps: enough for a retry, never a history. */
export const VOICE_KEPT = 8;
/** A recording's id, made by the browser when it stops. */
export const RECORDING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type WebVoiceInput = Readonly<{
  /** The browser's id of this recording: the same id is heard once. */
  id: string;
  audio: Uint8Array;
  mime: string;
  /** Whole seconds, as the browser counted them while recording. */
  seconds: number;
  locale: "uk" | "en";
  /** The price the person saw on the button. */
  acceptCredits: number;
}>;

export type WebVoiceDeps = Readonly<{
  store: GuardStore;
  holder: string;
  config: CreditsConfig;
  transcriber: Transcriber | null;
  /** The deployment's ceiling of voice heard on the server in a UTC day, in seconds. */
  dailySeconds: number;
  now: () => number;
}>;

export type WebVoiceFailureCode =
  | "VALIDATION_ERROR"
  | "VOICE_TOO_LONG"
  | "VOICE_PRICE_NOT_SHOWN"
  | "VOICE_NOT_HEARD"
  | "VOICE_DAY_SPENT"
  | "CREDITS_DAY_CAP"
  | "AGENT_BUDGET_EXHAUSTED"
  | "AGENT_BUSY"
  | "CAPABILITY_UNAVAILABLE"
  | "UNAVAILABLE";

/** `spent` — the credits kept for the words; `free` — how many of them were the day's free ones; `repeat` — the recording was heard before. */
export type WebVoiceHeard = Readonly<{ ok: true; text: string; seconds: number; spent: number; free: number; repeat: boolean }>;
export type WebVoiceResult = WebVoiceHeard | Readonly<{ ok: false; code: WebVoiceFailureCode; reason: string }>;

type HeardRow = Readonly<{ id: string; text: string; seconds: number; spent: number; free: number; at: string }>;
/** A recording sent again after its hold was given back (the provider failed, the server stopped) is held under its next attempt. */
type TryRow = Readonly<{ id: string; n: number }>;
/** `silent` — the day's recordings the provider billed and heard no words in (AI-21). */
type VoiceRecord = Readonly<{ version: number; heard: readonly HeardRow[]; tries?: readonly TryRow[]; pausedDay?: string; silent?: Readonly<{ day: string; count: number }> }>;

/** Recordings with no words a wallet may send in a UTC day: they cost the person nothing, so they never spend the deployment's day for everyone (AI-21). */
export const WEB_VOICE_SILENT_PER_DAY = 10;

const rows = (store: GuardStore) => store.versioned<VoiceRecord>(VOICE_COLLECTION);
const voiceKey = (holder: string) => `voice:${holder}`;

/** The bytes a recording said to last `seconds` may weigh: at least 64 KB (a short recording's container), at most two minutes'. */
export function webVoiceBytesAllowed(seconds: number): number {
  return Math.min(WEB_VOICE_MAX_BYTES, Math.max(64 * 1024, Math.ceil(seconds) * WEB_VOICE_BYTES_PER_SECOND));
}

const dayOf = (nowMs: number) => new Date(nowMs).toISOString().slice(0, 10);

async function readRecord(store: GuardStore, holder: string): Promise<VoiceRecord | null> {
  return ((await rows(store).get(voiceKey(holder)).catch(() => null)) as VoiceRecord | null) ?? null;
}

/** Change the holder's record; a record that could not be written is the next send's to find out. */
async function change(store: GuardStore, holder: string, next: (current: VoiceRecord | null) => Omit<VoiceRecord, "version">): Promise<void> {
  try {
    await withBoundedCasRetry(async () => {
      const current = (await rows(store).get(voiceKey(holder))) as VoiceRecord | null;
      return (await rows(store).compareAndSet(voiceKey(holder), current?.version ?? null, { ...next(current), version: (current?.version ?? 0) + 1 })) ? true : false;
    });
  } catch {
    /* Not written: a resend of this recording meets the ledger's hold and is held again once that hold is given back. */
  }
}

const remember = (store: GuardStore, holder: string, row: HeardRow) => change(store, holder, (current) => ({ ...current, heard: [row, ...(current?.heard ?? []).filter((entry) => entry.id !== row.id)].slice(0, VOICE_KEPT) }));
const nextTry = (store: GuardStore, holder: string, id: string, n: number) => change(store, holder, (current) => ({ ...current, heard: current?.heard ?? [], tries: [{ id, n }, ...(current?.tries ?? []).filter((entry) => entry.id !== id)].slice(0, VOICE_KEPT) }));
const heardSilence = (store: GuardStore, holder: string, day: string) => change(store, holder, (current) => ({ ...current, heard: current?.heard ?? [], silent: { day, count: current?.silent?.day === day ? current.silent.count + 1 : 1 } }));
const pause = (store: GuardStore, holder: string, day: string) => change(store, holder, (current) => ({ ...current, heard: current?.heard ?? [], pausedDay: day }));

const answered = (row: HeardRow, repeat: boolean): WebVoiceHeard => ({ ok: true, text: row.text, seconds: row.seconds, spent: row.spent, free: row.free, repeat });

/** Hear one recording for the question field — the price held first, kept only for words heard. */
export async function hearWebVoice(deps: WebVoiceDeps, input: WebVoiceInput): Promise<WebVoiceResult> {
  const id = input.id.toLowerCase();
  if (!RECORDING_ID.test(id)) return { ok: false, code: "VALIDATION_ERROR", reason: "A recording needs its id." };
  const seconds = Number.isFinite(input.seconds) ? Math.max(1, Math.ceil(input.seconds)) : 0;
  if (!/^audio\//i.test(input.mime) || seconds < 1) return { ok: false, code: "VALIDATION_ERROR", reason: "The recording is not audio." };
  if (seconds > VOICE_MAX_SECONDS) return { ok: false, code: "VOICE_TOO_LONG", reason: "Two minutes is the longest recording heard." };
  if (input.audio.byteLength > webVoiceBytesAllowed(seconds)) return { ok: false, code: "VOICE_TOO_LONG", reason: "The recording is larger than its length allows." };
  /* The container's own length, before anything is paid: a recording that does not say, or says more than the browser, is not heard. */
  const real = recordingSeconds(input.audio, input.mime);
  if (real === null) return { ok: false, code: "VALIDATION_ERROR", reason: "The recording's length could not be read from it." };
  if (real > seconds + WEB_VOICE_SLACK_SECONDS) return { ok: false, code: "VOICE_TOO_LONG", reason: "The recording is longer than it says." };
  if (!deps.transcriber) return { ok: false, code: "CAPABILITY_UNAVAILABLE", reason: "Voice is not heard on the server on this deployment." };
  /* Sent again — a lost answer, a second press: the words already heard, nothing charged again. */
  const record = await readRecord(deps.store, deps.holder);
  const before = record?.heard?.find((row) => row.id === id);
  if (before) return answered(before, true);
  if (record?.pausedDay === dayOf(deps.now())) return { ok: false, code: "VOICE_DAY_SPENT", reason: "A recording was longer than it said: voice on the server is paused for this wallet until tomorrow (UTC)." };
  if (record?.silent?.day === dayOf(deps.now()) && record.silent.count >= WEB_VOICE_SILENT_PER_DAY) return { ok: false, code: "VOICE_DAY_SPENT", reason: "Too many recordings without words today: voice on the server rests for this wallet until tomorrow (UTC); the browser's microphone or typing still works." };
  const price = voiceCredits(deps.config, seconds);
  if (input.acceptCredits !== price) return { ok: false, code: "VOICE_PRICE_NOT_SHOWN", reason: `Hearing this recording costs ${price} credits — not the ${input.acceptCredits} shown.` };
  const claimedAt = deps.now();
  /* The day's voice is claimed at the most these bytes could hold, and settled at what the provider billed. */
  const claim = Math.max(seconds, Math.ceil(input.audio.byteLength / WORST_BYTES_PER_SECOND));
  if (!(await claimVoiceSeconds(deps.store, claim, deps.dailySeconds, claimedAt))) return { ok: false, code: "VOICE_DAY_SPENT", reason: "Today's voice on the server is spent on this deployment; the browser's microphone or typing still works." };
  /* The attempt's key: a recording whose hold was given back (the provider failed, a server stopped) is held again under the next one. */
  let attempt = record?.tries?.find((row) => row.id === id)?.n ?? 0;
  let idem = `web-voice:${id}:${attempt}`;
  let held = await reserveCredits(deps.store, deps.holder, { action: "voice", amount: price, acceptCredits: input.acceptCredits, idem, config: deps.config, nowMs: claimedAt });
  if (held.ok && held.repeat) {
    const kept = (await readRecord(deps.store, deps.holder))?.heard?.find((row) => row.id === id);
    const holdId = held.holdId;
    /* Still held, and not past its expiry: another send is hearing it right now. */
    const open = (await readBalance(deps.store, deps.holder).catch(() => null))?.holds.some((hold) => hold.id === holdId && Date.parse(hold.expiresAt) > claimedAt) ?? false;
    if (kept || open) {
      await settleVoiceSeconds(deps.store, { claimed: claim, heard: 0, microUsd: 0, claimedAtMs: claimedAt });
      return kept ? answered(kept, true) : { ok: false, code: "AGENT_BUSY", reason: "This recording is being heard; ask again in a moment." };
    }
    /* That attempt was paid for, but its words were never kept (the store did not take them): heard again, not charged again. */
    const paid = await settleCredits(deps.store, deps.holder, { holdId, charged: price, idem: `${idem}:capture`, nowMs: claimedAt }).catch(() => null);
    /* (A hold past its expiry that no sweep gave back yet is kept here — once — and the recording heard on it.) */
    if (paid?.ok && paid.charged > 0) {
      const again = await deps.transcriber({ bytes: input.audio, mime: input.mime, locale: input.locale, seconds }).catch(() => ({ ok: false as const, reason: "the transcriber failed" }));
      await settleVoiceSeconds(deps.store, { claimed: claim, heard: again.ok ? again.billedSeconds : claim, microUsd: again.ok ? (again.costMicroUsd ?? 0) : 0, claimedAtMs: claimedAt });
      if (!again.ok) return { ok: false, code: "UNAVAILABLE", reason: "The recording could not be heard now; it was paid for once and is not charged again." };
      if (again.measured && again.billedSeconds > seconds + WEB_VOICE_SLACK_SECONDS) await pause(deps.store, deps.holder, dayOf(deps.now()));
      const row: HeardRow = { id, text: again.text, seconds, spent: paid.charged, free: 0, at: new Date(deps.now()).toISOString() };
      await remember(deps.store, deps.holder, row);
      return answered(row, true);
    }
    /* That attempt ended without words kept and its hold is gone: the next attempt. */
    attempt += 1;
    await nextTry(deps.store, deps.holder, id, attempt);
    idem = `web-voice:${id}:${attempt}`;
    held = await reserveCredits(deps.store, deps.holder, { action: "voice", amount: price, acceptCredits: input.acceptCredits, idem, config: deps.config, nowMs: claimedAt });
  }
  if (!held.ok || held.repeat) {
    await settleVoiceSeconds(deps.store, { claimed: claim, heard: 0, microUsd: 0, claimedAtMs: claimedAt });
    if (held.ok) return { ok: false, code: "AGENT_BUSY", reason: "This recording is being heard; ask again in a moment." };
    if (held.code === "PRICE_NOT_SHOWN") return { ok: false, code: "VOICE_PRICE_NOT_SHOWN", reason: held.reason };
    if (held.code === "CREDITS_BUSY") return { ok: false, code: "AGENT_BUSY", reason: held.reason };
    if (held.code === "CREDITS_LIMIT") return { ok: false, code: "CREDITS_DAY_CAP", reason: held.reason };
    if (held.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE", reason: held.reason };
    return { ok: false, code: "AGENT_BUDGET_EXHAUSTED", reason: held.reason };
  }
  const heard = await deps.transcriber({ bytes: input.audio, mime: input.mime, locale: input.locale, seconds }).catch((): Heard => ({ ok: false, reason: "the transcriber failed" }));
  const settledAt = deps.now();
  if (!heard.ok) {
    const silent = heard.reason === "nothing was heard";
    await settleCredits(deps.store, deps.holder, { holdId: held.holdId, charged: 0, idem: `${idem}:release`, nowMs: settledAt }).catch(() => null);
    /* The provider may have heard — and billed — before it failed: the day keeps the most it could have been, never zero. */
    await settleVoiceSeconds(deps.store, { claimed: claim, heard: silent ? (heard.billedSeconds ?? seconds) : claim, microUsd: silent ? (heard.costMicroUsd ?? 0) : 0, claimedAtMs: claimedAt });
    await nextTry(deps.store, deps.holder, id, attempt + 1);
    if (silent) await heardSilence(deps.store, deps.holder, dayOf(settledAt));
    /* No words in it is the recording's; a provider that did not answer is ours — the recording waits to be heard again. */
    return silent ? { ok: false, code: "VOICE_NOT_HEARD", reason: "No words were heard in the recording; nothing was charged." } : { ok: false, code: "UNAVAILABLE", reason: "The recording could not be heard now; nothing was charged." };
  }
  const settled = await settleCredits(deps.store, deps.holder, { holdId: held.holdId, charged: price, idem: `${idem}:capture`, nowMs: settledAt }).catch(() => null);
  await settleVoiceSeconds(deps.store, { claimed: claim, heard: heard.billedSeconds, microUsd: heard.costMicroUsd ?? 0, claimedAtMs: claimedAt });
  /* What was kept is what is said: a capture the store did not take is given back when the hold expires. */
  const spent = settled?.ok ? settled.charged : 0;
  /* The provider heard more than the browser said: the words were paid for and come back, and this wallet's voice on the server rests until tomorrow. */
  if (heard.measured && heard.billedSeconds > seconds + WEB_VOICE_SLACK_SECONDS) await pause(deps.store, deps.holder, dayOf(settledAt));
  const row: HeardRow = { id, text: heard.text, seconds, spent, free: spent > 0 ? Math.min(spent, held.parts.free) : 0, at: new Date(settledAt).toISOString() };
  await remember(deps.store, deps.holder, row);
  return answered(row, false);
}

/**
 * The stand's transcriber: what a person might say, in their language, with
 * a ticker and a sum to correct — nothing leaves the machine, nothing is paid.
 */
export function createFixtureTranscriber(): Transcriber {
  return async ({ locale, seconds }) => ({
    ok: true,
    text: locale === "uk" ? "що зрушило ціну бонк сьогодні і чи варто ставити стеження на 5 000 доларів" : "what moved the price of bonk today and should I watch it at 5,000 dollars",
    billedSeconds: seconds,
    measured: true,
    costMicroUsd: 0,
    model: "fixture",
    latencyMs: 0,
  });
}

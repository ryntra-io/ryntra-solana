"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AssistantCredits, AssistantVoiceResponse } from "@/lib/api/v1/contract";

/**
 * AI-06c: the microphone of the question field — voice is input only
 * (decision AI-Р9). The browser's own recognition (Web Speech API: Chrome,
 * Edge, Safari; not Firefox) writes what it heard into the field, live, where
 * the person reads and corrects it; nothing is sent without the press of
 * «Спитати». Chrome sends the sound to Google to recognise it — the field
 * says so while the microphone is in use. Where the browser does not
 * recognise speech, or its recognition failed, a proven wallet records
 * instead and Ryntra's server hears it at the price shown (AI-08,
 * `useRecording` below); a browser that can do neither gets no button.
 */

type Alternative = { transcript: string };
type Result = { isFinal: boolean; length: number; [index: number]: Alternative };
type ResultEvent = { resultIndex: number; results: { length: number; [index: number]: Result } };
type ErrorEvent = { error: string };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: ResultEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** The field's words with what was said after them: one space between, the spoken words as heard. */
export function joinDictation(before: string, spoken: string): string {
  const said = spoken.replace(/\s+/g, " ").trim();
  if (said.length === 0) return before;
  const head = before.replace(/\s+$/, "");
  return head.length === 0 ? said : `${head} ${said}`;
}

/**
 * What was heard so far, from the session's results in order. Android's Chrome repeats the words said before inside
 * each next result («що», «що зрушило», «що зрушило ціну»): a result that starts with the one before it replaces it
 * rather than being added, so the field never reads the same words twice.
 */
export function heardText(results: readonly string[]): string {
  const parts: string[] = [];
  for (const raw of results) {
    const words = raw.replace(/\s+/g, " ").trim();
    if (words.length === 0) continue;
    const last = parts.length > 0 ? parts[parts.length - 1] : null;
    /* By whole words: «що» and then «щодо BONK» are two things said. */
    const same = last !== null && (words.toLowerCase() === last.toLowerCase() || words.toLowerCase().startsWith(`${last.toLowerCase()} `));
    if (same) parts[parts.length - 1] = words;
    else parts.push(words);
  }
  return parts.join(" ");
}

/** Why the microphone stopped short: no permission, nothing heard, or the recognition itself failed. */
export type DictationProblem = "denied" | "silence" | "failed";

export function problemOf(error: string): DictationProblem | null {
  if (error === "aborted") return null;
  if (error === "not-allowed" || error === "service-not-allowed" || error === "audio-capture") return "denied";
  if (error === "no-speech") return "silence";
  return "failed";
}

export type Dictation = Readonly<{
  /** False until the browser is known to recognise speech — and for good where it does not: no button then. */
  supported: boolean;
  listening: boolean;
  /** True once the microphone was used for this field — the line about where the sound goes stays beside it. */
  used: boolean;
  problem: DictationProblem | null;
  toggle: () => void;
  stop: () => void;
  /** The person typed: a problem said about the last try is no longer news. */
  clear: () => void;
}>;

/* ── The language spoken: the person's, not the page's ─────────────────── */

/**
 * A person reading the page in English may speak Ukrainian to it (the operator, 21.10: «привіт, як діла» heard by an
 * English recogniser as «private private yoga»). The microphone listens in the language the person chose here, kept in
 * this browser; before any choice — Ukrainian when it is among the browser's languages, else the page's.
 */
export const VOICE_LANGUAGE_KEY = "ryntra.voice-language.v1";

export function speechLanguage(pageLocale: WorkspaceLocale, browserLanguages: readonly string[], stored: string | null): WorkspaceLocale {
  if (stored === "uk" || stored === "en") return stored;
  if (browserLanguages.some((tag) => tag.toLowerCase().split("-")[0] === "uk")) return "uk";
  return pageLocale;
}

/** The language the microphone listens in, and its switch — the choice kept in this browser. */
export function useVoiceLanguage(pageLocale: WorkspaceLocale): readonly [WorkspaceLocale, () => void] {
  const [language, setLanguage] = useState<WorkspaceLocale>(pageLocale);
  /* Read after mount: a server knows neither the browser's languages nor what it keeps. */
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(VOICE_LANGUAGE_KEY);
    } catch {
      /* storage may be off: the browser's languages decide */
    }
    setLanguage(speechLanguage(pageLocale, navigator.languages?.length ? navigator.languages : [navigator.language ?? ""], stored));
  }, [pageLocale]);
  const toggle = useCallback(() => {
    setLanguage((current) => {
      const next: WorkspaceLocale = current === "uk" ? "en" : "uk";
      try {
        window.localStorage.setItem(VOICE_LANGUAGE_KEY, next);
      } catch {
        /* not kept: the choice holds for this page */
      }
      return next;
    });
  }, []);
  return [language, toggle] as const;
}

/**
 * The microphone for one field. `text` and `setText` are the field's own:
 * what is heard is written after the words already there, the interim words
 * live, and replaced by the final ones; the person edits it all before asking.
 * `locale` is the language spoken (`useVoiceLanguage`), not the page's.
 */
export function useDictation(locale: WorkspaceLocale, text: string, setText: (value: string) => void, disabled = false): Dictation {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [used, setUsed] = useState(false);
  const [problem, setProblem] = useState<DictationProblem | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const base = useRef("");
  const latest = useRef({ text, setText });
  latest.current = { text, setText };

  /* Read after mount: a server knows no browser, and the first paint must match it. */
  useEffect(() => {
    setSupported(recognitionConstructor() !== null);
  }, []);

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  /* A field that is sending, or a surface that goes away, ends the recognition. */
  useEffect(() => {
    if (disabled) recognition.current?.abort();
  }, [disabled]);
  useEffect(() => () => recognition.current?.abort(), []);

  const toggle = useCallback(() => {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    const Constructor = recognitionConstructor();
    if (!Constructor || disabled) return;
    const next = new Constructor();
    next.lang = locale === "uk" ? "uk-UA" : "en-US";
    /* One question at a time: the recognition ends at the pause after it. */
    next.continuous = false;
    next.interimResults = true;
    next.maxAlternatives = 1;
    base.current = latest.current.text;
    next.onresult = (event) => {
      const said: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) said.push(event.results[index][0]?.transcript ?? "");
      latest.current.setText(joinDictation(base.current, heardText(said)).slice(0, 2000));
    };
    next.onerror = (event) => {
      const found = problemOf(event.error);
      if (found) setProblem(found);
    };
    next.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    setProblem(null);
    try {
      next.start();
      recognition.current = next;
      setListening(true);
      setUsed(true);
    } catch {
      setProblem("failed");
    }
  }, [disabled, locale]);

  const clear = useCallback(() => setProblem(null), []);

  return { supported, listening, used, problem, toggle, stop, clear };
}

/* ── AI-08: the paid fallback — a recording heard on Ryntra's server ─────── */

/** The longest recording, as the server hears it (contract `ASSISTANT_VOICE_MAX_SECONDS`). */
export const RECORDING_MAX_SECONDS = 120;
/** Credits are counted per each started block of this many seconds. */
export const RECORDING_BLOCK_SECONDS = 30;
/** Low enough that two minutes always fit what the server takes, high enough for speech. */
const RECORDING_BITS_PER_SECOND = 32_000;
/** In the order a recorder is asked: Opus in WebM (Chrome, Edge), Opus in Ogg (Firefox), AAC in MP4 (Safari). */
const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"] as const;

/** The type this browser records in, or none: a browser that records nothing the server hears gets no fallback. */
export function recordingType(isTypeSupported: (type: string) => boolean): string | null {
  for (const type of RECORDING_TYPES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      /* A recorder that throws on the question records nothing we can name. */
    }
  }
  return null;
}

/** What hearing `seconds` costs: `perBlock` credits for each started 30 s — 1 s … 30 s is one block. */
export function recordingCredits(seconds: number, perBlock: number): number {
  return Math.ceil(Math.max(1, Math.ceil(seconds)) / RECORDING_BLOCK_SECONDS) * perBlock;
}

/** `0:07`, `1:30` — a recording's length as the line reads it. */
export const clockOf = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * Why the recording did not become words: the microphone, the length, a recording the server could not read, the
 * credits, the day's cap, the deployment's day of voice, the price that moved, nothing heard, or the server.
 */
export type RecordingProblem = "denied" | "recorder" | "failed" | "silence" | "tooLong" | "unreadable" | "noCredits" | "dayCap" | "daySpent" | "priceChanged";

export function recordingProblemOf(code: string | undefined): RecordingProblem {
  if (code === "VOICE_TOO_LONG") return "tooLong";
  if (code === "VOICE_NOT_HEARD") return "silence";
  if (code === "VALIDATION_ERROR") return "unreadable";
  if (code === "AGENT_BUDGET_EXHAUSTED") return "noCredits";
  if (code === "CREDITS_DAY_CAP") return "dayCap";
  if (code === "VOICE_DAY_SPENT") return "daySpent";
  if (code === "VOICE_PRICE_NOT_SHOWN") return "priceChanged";
  return "failed";
}

/**
 * A recording waits to be sent again only where a second press can work: the price moved (now read anew) or the
 * server did not answer. Any other refusal lets it go, and «Спитати» is back for the question the line asks to type.
 */
export const recordingKept = (problem: RecordingProblem): boolean => problem === "priceChanged" || problem === "failed";

type RecorderLike = {
  state: string;
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  stop(): void;
};
type RecorderConstructor = { new (stream: MediaStream, options?: { mimeType?: string; audioBitsPerSecond?: number }): RecorderLike; isTypeSupported(type: string): boolean };

function recorderConstructor(): RecorderConstructor | null {
  if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return (window as unknown as { MediaRecorder?: RecorderConstructor }).MediaRecorder ?? null;
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** A recording's own id, made when it stops: sent again, the server answers it with the same words and charges nothing. */
function recordingId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `opening` — the browser asks the person for the microphone; nothing is recorded yet. */
export type RecordingPhase = "idle" | "opening" | "recording" | "recorded" | "hearing";

export type Recording = Readonly<{
  /** False until the browser is known to record a type the server hears. */
  supported: boolean;
  phase: RecordingPhase;
  /** The seconds recorded so far, or of the recording waiting to be heard. */
  seconds: number;
  /** What hearing the recording waiting costs, shown on its button; null while the price is unknown. */
  price: number | null;
  problem: RecordingProblem | null;
  /** Credits taken for the last recording heard, and how many of them were the day's free ones — said beside its words. */
  spent: Readonly<{ credits: number; free: number }> | null;
  start: () => void;
  stop: () => void;
  hear: () => void;
  cancel: () => void;
  clear: () => void;
}>;

/** One press of the microphone: its stream, its recorder and its clock — a recording let go never touches the next one. */
type Run = { discarded: boolean; media: MediaStream | null; recorder: RecorderLike | null; ticker: ReturnType<typeof setInterval> | null };

function endRun(run: Run): void {
  if (run.ticker) clearInterval(run.ticker);
  run.ticker = null;
  run.media?.getTracks().forEach((track) => track.stop());
  run.media = null;
}

/**
 * The paid fallback of the field's microphone (AI-08): a recording made in
 * the browser, sent to Ryntra's server only by «Розпізнати · N кредитів» —
 * the price shown before anything is sent — and heard there. What comes back
 * is written after the field's words for the person to correct; nothing is
 * asked without «Спитати». `perBlock` is the server's price of 30 seconds
 * (`prices.voice`); `onCredits` gets the credits after a recording was sent —
 * `null` when the server did not say them, and they are read again.
 */
export function useRecording(locale: WorkspaceLocale, text: string, setText: (value: string) => void, perBlock: number | null, onCredits: (credits: AssistantCredits | null) => void, disabled = false): Recording {
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState<RecordingProblem | null>(null);
  const [spent, setSpent] = useState<Recording["spent"]>(null);
  const run = useRef<Run | null>(null);
  const clip = useRef<Readonly<{ blob: Blob; id: string; seconds: number }> | null>(null);
  const latest = useRef({ text, setText, onCredits });
  latest.current = { text, setText, onCredits };

  /* Read after mount: a server knows no browser, and the first paint must match it. */
  useEffect(() => {
    const Constructor = recorderConstructor();
    setSupported(Constructor !== null && recordingType((type) => Constructor.isTypeSupported(type)) !== null);
  }, []);

  const cancel = useCallback(() => {
    const current = run.current;
    run.current = null;
    if (current) {
      current.discarded = true;
      if (current.recorder && current.recorder.state !== "inactive") current.recorder.stop();
      endRun(current);
    }
    clip.current = null;
    setPhase("idle");
    setSeconds(0);
  }, []);

  /* «Стоп» before the microphone was given lets the press go; after, it ends the recording. */
  const stop = useCallback(() => {
    const recorder = run.current?.recorder;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else if (run.current) cancel();
  }, [cancel]);

  /* A field that is sending ends a recording and keeps nothing; a surface that goes away lets the microphone go. */
  useEffect(() => {
    if (disabled && (phase === "recording" || phase === "opening")) cancel();
  }, [disabled, phase, cancel]);
  useEffect(
    () => () => {
      const current = run.current;
      run.current = null;
      if (current) {
        current.discarded = true;
        if (current.recorder && current.recorder.state !== "inactive") current.recorder.stop();
        endRun(current);
      }
    },
    [],
  );

  const start = useCallback(() => {
    const Constructor = recorderConstructor();
    if (!Constructor || disabled || run.current) return;
    const type = recordingType((candidate) => Constructor.isTypeSupported(candidate));
    if (!type) return;
    const own: Run = { discarded: false, media: null, recorder: null, ticker: null };
    run.current = own;
    setProblem(null);
    setSpent(null);
    clip.current = null;
    setSeconds(0);
    setPhase("opening");
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((media) => {
        own.media = media;
        if (own.discarded) {
          endRun(own);
          return;
        }
        const chunks: Blob[] = [];
        const recorder = new Constructor(media, { mimeType: type, audioBitsPerSecond: RECORDING_BITS_PER_SECOND });
        own.recorder = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        const startedAt = Date.now();
        recorder.onstop = () => {
          const elapsed = Math.min(RECORDING_MAX_SECONDS, Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)));
          endRun(own);
          /* A recording let go — or one a newer press replaced — keeps nothing. */
          if (own.discarded || run.current !== own) return;
          run.current = null;
          const blob = new Blob(chunks, { type: recorder.mimeType || type });
          if (blob.size === 0) {
            setPhase("idle");
            setProblem("silence");
            return;
          }
          clip.current = { blob, id: recordingId(), seconds: elapsed };
          setSeconds(elapsed);
          setPhase("recorded");
        };
        recorder.start(1_000);
        setPhase("recording");
        /* The clock the person sees; at two minutes the recording ends by itself. */
        own.ticker = setInterval(() => {
          const now = (Date.now() - startedAt) / 1000;
          setSeconds(Math.min(RECORDING_MAX_SECONDS, Math.floor(now)));
          if (now >= RECORDING_MAX_SECONDS && recorder.state !== "inactive") recorder.stop();
        }, 250);
      })
      .catch(() => {
        /* No microphone given is the person's to allow; a microphone given and a recorder that did not start is the browser's. */
        const granted = own.media !== null;
        endRun(own);
        if (run.current !== own) return;
        run.current = null;
        setPhase("idle");
        setProblem(granted ? "recorder" : "denied");
      });
  }, [disabled]);

  const price = perBlock === null ? null : recordingCredits(Math.max(1, seconds), perBlock);

  const hear = useCallback(() => {
    const waiting = clip.current;
    if (!waiting || phase !== "recorded" || price === null || disabled) return;
    setPhase("hearing");
    setProblem(null);
    void base64Of(waiting.blob)
      .then((audio) =>
        fetch("/api/v1/assistant/voice", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Ryntra-API": "1" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ id: waiting.id, audio, mime: waiting.blob.type, seconds: waiting.seconds, locale, acceptCredits: price }),
        }),
      )
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as Partial<AssistantVoiceResponse> & { error?: { code?: string } };
        if (clip.current !== waiting) return;
        if (!response.ok || typeof body.text !== "string") {
          const found = recordingProblemOf(body.error?.code);
          setProblem(found);
          /* A price that moved, credits short, the day's cap: the figures are read again before the next press. */
          if (found === "priceChanged" || found === "noCredits" || found === "dayCap") latest.current.onCredits(null);
          if (recordingKept(found)) setPhase("recorded");
          else {
            clip.current = null;
            setPhase("idle");
            setSeconds(0);
          }
          return;
        }
        /* After the words in the field now — the person may have typed while it was heard. */
        latest.current.setText(joinDictation(latest.current.text, body.text).slice(0, 2000));
        latest.current.onCredits(body.credits ?? null);
        clip.current = null;
        setSpent({ credits: body.spent ?? price, free: body.free ?? 0 });
        setPhase("idle");
        setSeconds(0);
      })
      .catch(() => {
        /* No answer: the recording waits; sent again under its own id, it is never charged twice. */
        if (clip.current !== waiting) return;
        setProblem("failed");
        setPhase("recorded");
      });
  }, [disabled, locale, phase, price]);

  const clear = useCallback(() => {
    setProblem(null);
    setSpent(null);
  }, []);

  return { supported, phase, seconds, price, problem, spent, start, stop, hear, cancel, clear };
}

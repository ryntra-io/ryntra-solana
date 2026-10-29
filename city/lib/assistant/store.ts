import { create } from 'zustand';
import type { Tower } from '../market/types.ts';
import { cityLine, detailsOf, intentOf, pickTowers, shortLine, type Details, type Intent } from './answer.ts';
import { askGuest, type Asked } from './ask.ts';

/**
 * Ryntra in the city (CITY-10): the panel, the question in flight, and the answer as towers. The camera reads `shown`
 * and `focusAt` (city/components/city/CameraRig.tsx) and the scene lights `shown` (city/components/assistant/Beacons.tsx).
 * It holds no wallet and no key, and nothing it does moves money: a tower in an answer only opens that tower's card.
 */

export type AssistantPhase = 'idle' | 'asking' | 'answered';

/** Who wrote the line: Ryntra from its reads, or the city from its own read while Ryntra could not answer. */
export type Voice = 'ryntra' | 'city';

type AssistantState = {
  open: boolean;
  phase: AssistantPhase;
  /** The tower the person had picked when they opened Ryntra: the question is about it. */
  subject: Tower | null;
  question: string | null;
  intent: Intent;
  line: string | null;
  voice: Voice;
  /** Ryntra could not take more questions for a minute. */
  busy: boolean;
  details: Details | null;
  /** The towers the answer is about, in order: the camera frames them and the scene lights them. */
  shown: Tower[];
  /** When the camera was last asked to frame `shown` (ms). */
  focusAt: number;
  day: { used: number; allowance: number } | null;

  show: (subject: Tower | null) => void;
  hide: () => void;
  ask: (question: string, towers: readonly Tower[], ask?: typeof askGuest) => Promise<void>;
};

const QUIET = { phase: 'idle' as const, question: null, intent: 'other' as const, line: null, voice: 'ryntra' as const, busy: false, details: null, shown: [] as Tower[], day: null };

let asked = 0;
let inFlight: AbortController | null = null;

export const useAssistant = create<AssistantState>((set, get) => ({
  open: false,
  subject: null,
  focusAt: 0,
  ...QUIET,

  show: (subject) => set({ open: true, subject, ...(subject ? { ...QUIET, shown: [subject], focusAt: Date.now() } : {}) }),

  hide: () => {
    inFlight?.abort();
    inFlight = null;
    asked++;
    set({ open: false, subject: null, ...QUIET, focusAt: Date.now() });
  },

  ask: async (question, towers, ask = askGuest) => {
    const text = question.trim();
    if (!text) return;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const id = ++asked;
    const subject = get().subject;
    const intent = intentOf(text, subject);
    set({ phase: 'asking', question: text, intent, line: null, details: null, busy: false });
    const answer: Asked = await ask(text, subject, controller.signal);
    // A newer question, or the panel closed: this answer is no one's now.
    if (id !== asked) return;
    inFlight = null;
    if (answer.ok) {
      const shown = pickTowers(answer.turn, towers, intent, subject);
      set({ phase: 'answered', voice: 'ryntra', line: shortLine(answer.turn), details: detailsOf(answer.turn), shown, focusAt: Date.now(), day: answer.day });
      return;
    }
    // Ryntra is away: the city still shows what its own read says, and says only that.
    const shown = pickTowers(null, towers, intent, subject);
    set({ phase: 'answered', voice: 'city', busy: answer.busy, line: cityLine(intent, shown), details: null, shown, focusAt: Date.now(), day: null });
  },
}));

// Development hook: lets the screenshot scripts and the console drive the panel.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __assistant: useAssistant });

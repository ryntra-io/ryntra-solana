import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { wordsNow } from '../i18n/dict.ts';
import { reelOf, sinceOf, worthPlaying, type Line, type Market } from './away.ts';
import { world, type WorldClient } from './client.ts';
import { randomId } from './ids.ts';
import { browserStorage, type StorageLike } from './mock.ts';
import { isWorldError, type AwayConsent, type MeResponse } from './types.ts';
import { AWAY_WORDS } from './words.ts';

/**
 * «While you were away», from the moment a signed-in wallet's quarter is on screen: when this browser last saw the
 * city (kept per account on this device), the world's report since then, the reel of lines and where it stands, and
 * the person's consent for the report to reach them elsewhere. The reel plays once per return and can always be
 * skipped; the moment it ends, or the person skips it, is the next «since». Consent only changes a switch on the
 * server: nothing is ever sent from here.
 */

export type AwayChannel = 'telegram' | 'push';

/** The channels the reel offers, with their names on screen (Telegram by its name, the push in the language on screen). */
export const AWAY_CHANNELS: readonly Readonly<{ id: AwayChannel; label: string }>[] = [
  { id: 'telegram', label: 'Telegram' },
  {
    id: 'push',
    get label() {
      return wordsNow(AWAY_WORDS).push;
    },
  },
];

/**
 * The channels to offer here (CITY-6e): inside the Ryntra app there is no push — the app registers none — so its switch
 * is not shown there; a browser keeps both.
 */
export function awayChannels(inApp: boolean): readonly Readonly<{ id: AwayChannel; label: string }>[] {
  return inApp ? AWAY_CHANNELS.filter((c) => c.id !== 'push') : AWAY_CHANNELS;
}

export type AwayState = {
  /** `idle` — not checked yet for this account; `reading`; `playing`; `done` — played, skipped or nothing to tell. */
  status: 'idle' | 'reading' | 'playing' | 'done';
  owner: string | null;
  since: string | null;
  until: string | null;
  lines: Line[];
  index: number;
  /** Held on a line: for a person reading it, and for the screenshot scripts. */
  paused: boolean;
  /** The person's consent, or null while unknown or when the world cannot keep it yet. */
  consent: (AwayConsent & { canConsent: boolean }) | null;
  consentBusy: AwayChannel | null;
  consentError: string | null;
  /** Read the report for this account if the person was away long enough, and start the reel when it has lines. */
  check: (input: { owner: string; me: MeResponse; market: Market | null; held: ReadonlySet<string> }) => Promise<boolean>;
  next: () => void;
  /** Ends the reel: played through, skipped, or the person took the camera. */
  finish: () => void;
  pause: (paused: boolean) => void;
  /** Turn a channel on or off on the server. */
  toggle: (channel: AwayChannel) => Promise<void>;
  /** The person is here now: the next «since» starts from this moment. */
  seen: () => void;
  /** The account on screen changed: the next one is checked afresh. */
  reset: () => void;
};

export type AwayOptions = {
  client?: () => WorldClient;
  storage?: StorageLike | null;
  now?: () => number;
  newKey?: () => string;
};

export const SEEN_KEY = 'ryntra.city.away.v1';
const seenKey = (owner: string) => `${SEEN_KEY}:${owner}`;

/** The consent switches' answers, in the language on screen when they are said (`./words.ts`). */
export const CONSENT_LINES: Readonly<Record<'refused' | 'offline', string>> = {
  get refused() {
    return wordsNow(AWAY_WORDS).consentRefused;
  },
  get offline() {
    return wordsNow(AWAY_WORDS).consentOffline;
  },
};

export function createAwayStore(options: AwayOptions = {}) {
  const client = options.client ?? world;
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const now = options.now ?? (() => Date.now());
  const newKey = options.newKey ?? randomId;

  const readSeen = (owner: string): string | null => {
    try {
      return storage?.getItem(seenKey(owner)) ?? null;
    } catch {
      return null;
    }
  };
  const writeSeen = (owner: string, at: string) => {
    try {
      storage?.setItem(seenKey(owner), at);
    } catch {
      // A private window keeps nothing: the next visit tells the last day again.
    }
  };

  let ticket = 0;

  return createStore<AwayState>()((set, get) => ({
    status: 'idle',
    owner: null,
    since: null,
    until: null,
    lines: [],
    index: 0,
    paused: false,
    consent: null,
    consentBusy: null,
    consentError: null,

    async check({ owner, me, market, held }) {
      const st = get();
      if (st.owner === owner && st.status !== 'idle') return st.status === 'playing';
      const mine = ++ticket;
      set({ status: 'reading', owner, lines: [], index: 0, paused: false, since: null, until: null, consent: null, consentError: null });
      const at = now();
      const last = readSeen(owner);
      // The consent is read beside the report; a world that cannot keep it yet leaves the switches out.
      void client()
        .consent()
        .then((c) => {
          if (ticket === mine) set({ consent: { ...c.consent, canConsent: c.canConsent } });
        })
        .catch(() => undefined);
      const born = me.resident.createdAt;
      if (!worthPlaying(last, at, born)) {
        writeSeen(owner, new Date(at).toISOString());
        set({ status: 'done' });
        return false;
      }
      try {
        const away = await client().away(sinceOf(last, at, born));
        if (ticket !== mine) return false;
        const lines = reelOf({ report: away.report, me, market, held });
        writeSeen(owner, away.until);
        set({ since: away.since, until: away.until, lines, index: 0, status: lines.length ? 'playing' : 'done' });
        return lines.length > 0;
      } catch {
        // Nothing read, nothing lost: the last «since» stays for the next visit.
        if (ticket === mine) set({ status: 'done' });
        return false;
      }
    },

    next() {
      const { status, index, lines } = get();
      if (status !== 'playing') return;
      if (index + 1 >= lines.length) get().finish();
      else set({ index: index + 1 });
    },

    finish() {
      if (get().status !== 'playing') return;
      set({ status: 'done', paused: false });
      get().seen();
    },

    pause(paused) {
      set({ paused });
    },

    async toggle(channel) {
      const { consent, consentBusy } = get();
      if (!consent || !consent.canConsent || consentBusy) return;
      const want = !consent[channel];
      const owner = get().owner;
      set({ consentBusy: channel, consentError: null });
      const key = newKey();
      const send = () => client().setConsent({ [channel]: want }, key);
      try {
        let res;
        try {
          res = await send();
        } catch (e) {
          // No answer or a broken server: once more with the same key, so it is never applied twice.
          if (!isWorldError(e) || !(e.status === 0 || e.status >= 500)) throw e;
          res = await send();
        }
        if (get().owner !== owner) return;
        set({ consent: { ...res.consent, canConsent: res.canConsent }, consentBusy: null });
      } catch (e) {
        if (get().owner !== owner) return;
        const refused = isWorldError(e) && (e.code === 'WALLET_REQUIRED' || e.code === 'NO_RESIDENT');
        set({ consentBusy: null, consentError: refused ? CONSENT_LINES.refused : CONSENT_LINES.offline });
      }
    },

    seen() {
      const { owner, status } = get();
      // Before the report is read, «since» must stay where the last visit left it.
      if (!owner || status === 'idle' || status === 'reading') return;
      writeSeen(owner, new Date(now()).toISOString());
    },

    reset() {
      ticket += 1;
      set({ status: 'idle', owner: null, since: null, until: null, lines: [], index: 0, paused: false, consent: null, consentBusy: null, consentError: null });
    },
  }));
}

export type AwayStore = ReturnType<typeof createAwayStore>;

export const awayStore: AwayStore = createAwayStore();

export function useAway<T>(pick: (state: AwayState) => T): T {
  return useStore(awayStore, pick);
}

// Development hook: lets the screenshot scripts hold the reel on a line.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __away: awayStore });

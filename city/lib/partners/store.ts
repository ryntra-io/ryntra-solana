import { create } from 'zustand';
import { langNow } from '../i18n/lang.ts';
import { proveWallet, type ProofOutcome } from '../trade/proof.ts';
import { DEMO_ANSWER, districtOf, withEarnings, type DistrictView } from './district.ts';
import { DEMO_INVITATION, invitationOf, type Invitation } from './landing.ts';

/**
 * «Ryntra Partners»' own state (CITY-126, CITY-127): the window and its tab, «Мій район»'s read of `/api/rewards`
 * (the same proven read «Scouts» makes — how much somebody earned is not public), the friend's landing and the two
 * choices a partner makes on this device: to show their handle on the season board, and to light their network on the
 * map. Nothing here pays and nothing here binds by itself: the engine binds a friend on the proven wallet's own read.
 */

export type PartnersTab = 'referrer' | 'creator' | 'guild';
export type PartnersStatus = 'none' | 'reading' | 'proof' | 'proving' | 'ready' | 'failed';

/** What the engine said stays good this long. */
const TTL_MS = 60_000;
const CHOICES_KEY = 'ryntra.partners.choices';
const LANDING_KEY = 'ryntra.partners.landing';

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type PartnersEnv = Readonly<{
  fetch: (url: string, init?: RequestInit) => Promise<Answer>;
  prove: (connection: Readonly<{ wallet: string; address: string }>) => Promise<ProofOutcome>;
  now: () => number;
}>;

let env: PartnersEnv = {
  fetch: (url, init) => fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store', ...init }),
  prove: proveWallet,
  now: () => Date.now(),
};

/** Swap what the window reaches: for tests, and nothing else. */
export function setPartnersEnv(next: Partial<PartnersEnv>): void {
  env = { ...env, ...next };
}

type Choices = Readonly<{ handle: boolean; streets: boolean }>;

const readChoices = (): Choices => {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(CHOICES_KEY) ?? '{}') as Partial<Choices>;
    return { handle: raw.handle === true, streets: raw.streets === true };
  } catch {
    return { handle: false, streets: false };
  }
};

type Partners = {
  open: boolean;
  tab: PartnersTab;
  /** «Мій район» instead of the programme. */
  district: boolean;
  /** Development only: demo figures under the fixed «ДЕМО» mark. */
  demo: boolean;
  owner: string | null;
  status: PartnersStatus;
  view: DistrictView | null;
  at: number | null;
  message: string | null;
  invitation: Invitation | null;
  landing: boolean;
  choices: Choices;
  show: (where?: Readonly<{ tab?: PartnersTab; district?: boolean }>) => void;
  close: () => void;
  setTab: (tab: PartnersTab) => void;
  setDistrict: (on: boolean) => void;
  choose: (key: keyof Choices, on: boolean) => void;
  read: (owner: string, force?: boolean) => Promise<void>;
  prove: (connection: Readonly<{ wallet: string; address: string }>) => Promise<void>;
  reset: () => void;
  /** Ask the engine what this browser carries; greet the friend once. */
  greet: (demo?: boolean) => Promise<void>;
  /** «Увійти в місто»: the landing goes and does not come back on this device. */
  enter: () => void;
  /** The proven wallet's own read of its invitation: the engine binds it then. */
  bind: (owner: string) => Promise<void>;
  setup: (a: Readonly<{ demo: boolean }>) => void;
};

let ticket = 0;

export const usePartners = create<Partners>((set, get) => ({
  open: false,
  tab: 'referrer',
  district: false,
  demo: false,
  owner: null,
  status: 'none',
  view: null,
  at: null,
  message: null,
  invitation: null,
  landing: false,
  choices: { handle: false, streets: false },

  show: (where) => set({ open: true, landing: false, ...(where?.tab ? { tab: where.tab } : {}), ...(where?.district !== undefined ? { district: where.district } : {}) }),
  close: () => set({ open: false }),
  setTab: (tab) => set({ tab, district: false }),
  setDistrict: (on) => set({ district: on }),

  choose: (key, on) => {
    const choices = { ...get().choices, [key]: on };
    set({ choices });
    try {
      globalThis.localStorage?.setItem(CHOICES_KEY, JSON.stringify(choices));
    } catch {
      // The choice holds for this visit.
    }
  },

  setup: ({ demo }) => {
    set({ demo, choices: readChoices() });
    if (demo) set({ status: 'ready', view: districtOf(DEMO_ANSWER), at: env.now(), owner: null });
  },

  read: async (owner, force = false) => {
    const state = get();
    if (state.demo) return;
    if (state.owner === owner && !force) {
      if (state.status === 'reading' || state.status === 'proving') return;
      if (state.status === 'ready' && state.at !== null && env.now() - state.at < TTL_MS) return;
    }
    const my = ++ticket;
    set({ owner, status: 'reading', message: null, ...(state.owner === owner ? {} : { view: null, at: null }) });
    let answer: Answer;
    try {
      answer = await env.fetch(`/api/rewards?${new URLSearchParams({ address: owner, locale: langNow() })}`);
    } catch {
      if (my === ticket) set({ status: 'failed' });
      return;
    }
    if (my !== ticket) return;
    if (answer.status === 401) {
      set({ status: 'proof', view: null, at: null });
      return;
    }
    let view: DistrictView | null = null;
    if (answer.ok) {
      try {
        view = districtOf(await answer.json());
      } catch {
        view = null;
      }
    }
    if (my !== ticket) return;
    if (!view) {
      set({ status: 'failed' });
      return;
    }
    /* The weekly payout's figures (CITY-128), on the same proof; an answer that does not come keeps the Rewards view. */
    try {
      const earnings = await env.fetch(`/api/partners/earnings?${new URLSearchParams({ address: owner })}`);
      if (earnings.ok) view = withEarnings(view, await earnings.json());
    } catch {
      // The Rewards figures stand.
    }
    if (my !== ticket) return;
    set({ status: 'ready', view, at: env.now() });
  },

  prove: async (connection) => {
    if (get().status === 'proving') return;
    const my = ++ticket;
    set({ owner: connection.address, status: 'proving', message: null });
    const proof = await env.prove(connection);
    if (my !== ticket) return;
    if (!proof.ok) {
      set({ status: 'proof', message: proof.state === 'declined' ? null : proof.message });
      return;
    }
    await get().bind(connection.address);
    await get().read(connection.address, true);
  },

  reset: () => {
    ticket += 1;
    if (get().demo) return;
    set({ owner: null, status: 'none', view: null, at: null, message: null });
  },

  greet: async (demo = false) => {
    if (demo) {
      set({ invitation: DEMO_INVITATION, landing: true });
      return;
    }
    let seen = false;
    try {
      seen = Boolean(globalThis.sessionStorage?.getItem(LANDING_KEY));
    } catch {
      // No storage: greet once per visit.
    }
    try {
      const answer = await env.fetch('/api/rewards/referral');
      if (!answer.ok) return;
      const invitation = invitationOf(await answer.json());
      // Greeted once a visit; the invitation itself stays, so the wallet that comes later still binds it.
      if (invitation) set({ invitation, landing: !seen });
    } catch {
      // No greeting; the city is the city.
    }
  },

  enter: () => {
    set({ landing: false });
    try {
      globalThis.sessionStorage?.setItem(LANDING_KEY, '1');
    } catch {
      // The landing simply stays closed for this visit.
    }
  },

  bind: async (owner) => {
    if (!get().invitation || get().demo) return;
    try {
      const answer = await env.fetch(`/api/rewards/referral?${new URLSearchParams({ address: owner })}`);
      if (!answer.ok) return;
      const body = (await answer.json()) as { confirmed?: unknown };
      if (body?.confirmed) set({ invitation: null });
    } catch {
      // The engine binds on the next proven read.
    }
  },
}));

/** Open the partner page from anywhere: the menu, «Scouts». */
export function openPartners(where?: Readonly<{ tab?: PartnersTab; district?: boolean }>): void {
  usePartners.getState().show(where);
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __partners: usePartners });

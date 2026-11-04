import { create } from 'zustand';
import { createChannels, withProof, type BotLink, type ChannelFailure, type ChannelsApi, type Device, type TelegramView } from './channels.ts';

/**
 * Telegram and the phones as the settings window shows them (CITY-87), read from the engine for the connected wallet.
 * `signedOut`: the wallet has not proved itself to Ryntra yet — the window offers the one message from a tap, and
 * never asks the wallet by itself.
 */

export type Read<T> =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'reading' }>
  | Readonly<{ status: 'signedOut' }>
  | Readonly<{ status: 'failed' }>
  | Readonly<{ status: 'ready'; value: T }>;

type Prove = () => Promise<'ok' | 'declined' | 'failed'>;

export type ChannelsEnv = Readonly<{
  api: ChannelsApi;
  open: (url: string) => boolean;
  /** How often, and how many times, the window asks whether the chat was connected after the bot's link opened. */
  pollMs: number;
  polls: number;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}>;

/** A kept link is opened again only while its code has this long left; otherwise a fresh one is asked for. */
const LINK_MARGIN_MS = 30_000;

let env: ChannelsEnv = {
  api: createChannels(),
  open: (url) => {
    try {
      const opened = window.open(url, '_blank');
      if (opened) opened.opener = null;
      return Boolean(opened);
    } catch {
      return false;
    }
  },
  pollMs: 4_000,
  polls: 45,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export function setChannelsEnv(next: Partial<ChannelsEnv>): void {
  env = { ...env, ...next };
}

type ChannelsStore = {
  owner: string | null;
  telegram: Read<TelegramView>;
  devices: Read<readonly Device[]>;
  /** The bot's link, kept while the person has not pressed Start yet and its code still works — a second tap opens it again. */
  link: BotLink | null;
  busy: 'connect' | 'disconnect' | 'device' | null;
  /** The last change that did not go through, for one quiet line. */
  failure: ChannelFailure | null;
  read: (owner: string | null) => Promise<void>;
  connect: (owner: string, locale: 'en' | 'uk', prove: Prove) => Promise<void>;
  disconnect: (owner: string, prove: Prove) => Promise<void>;
  removeDevice: (owner: string, deviceId: string, prove: Prove) => Promise<void>;
};

const readOf = <T,>(result: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: ChannelFailure }>): Read<T> =>
  result.ok ? { status: 'ready', value: result.value } : result.failure === 'unauthorized' ? { status: 'signedOut' } : { status: 'failed' };

let polling = 0;

export const useChannels = create<ChannelsStore>((set, get) => ({
  owner: null,
  telegram: { status: 'idle' },
  devices: { status: 'idle' },
  link: null,
  busy: null,
  failure: null,

  read: async (owner) => {
    if (owner !== get().owner) set({ owner, telegram: { status: 'idle' }, devices: { status: 'idle' }, link: null, failure: null });
    if (!owner) return;
    if (get().telegram.status !== 'ready') set({ telegram: { status: 'reading' } });
    if (get().devices.status !== 'ready') set({ devices: { status: 'reading' } });
    const [telegram, devices] = await Promise.all([env.api.telegram(), env.api.devices()]);
    if (get().owner !== owner) return;
    set({ telegram: readOf(telegram), devices: readOf(devices), ...(telegram.ok && telegram.value.connected ? { link: null } : {}) });
  },

  connect: async (owner, locale, prove) => {
    if (get().busy) return;
    const kept = get().link;
    if (kept && linkLive(kept)) {
      env.open(kept.url);
      void watchTelegram(owner);
      return;
    }
    set({ busy: 'connect', failure: null, link: null });
    const result = await withProof(() => env.api.connectTelegram(locale), prove);
    if (get().owner !== owner) return set({ busy: null });
    if (!result.ok) return set({ busy: null, failure: result.failure });
    set({ busy: null, link: result.value });
    // A browser may refuse a window opened after the wallet's message: the kept link is one more tap («Open Telegram»).
    env.open(result.value.url);
    void watchTelegram(owner);
  },

  disconnect: async (owner, prove) => {
    if (get().busy) return;
    set({ busy: 'disconnect', failure: null });
    const result = await withProof(() => env.api.disconnectTelegram(), prove);
    if (get().owner !== owner) return set({ busy: null });
    set(result.ok ? { busy: null, telegram: { status: 'ready', value: result.value }, link: null } : { busy: null, failure: result.failure });
  },

  removeDevice: async (owner, deviceId, prove) => {
    if (get().busy) return;
    set({ busy: 'device', failure: null });
    const result = await withProof(() => env.api.removeDevice(deviceId), prove);
    if (get().owner !== owner) return set({ busy: null });
    if (!result.ok) return set({ busy: null, failure: result.failure });
    const devices = get().devices;
    set({ busy: null, devices: devices.status === 'ready' ? { status: 'ready', value: devices.value.filter((d) => d.deviceId !== deviceId) } : devices });
  },
}));

/** Whether a kept link's code still works long enough to be opened. */
function linkLive(link: BotLink): boolean {
  return link.expiresAt - env.now() > LINK_MARGIN_MS;
}

/** The kept link as the window shows it: gone once its code has run out, so the button asks for a fresh one. */
export function liveLink(link: BotLink | null): BotLink | null {
  return link && linkLive(link) ? link : null;
}

/** After the bot's link opened: ask now and then whether the chat was connected, until it is, the code runs out or the time is up. */
async function watchTelegram(owner: string): Promise<void> {
  const run = ++polling;
  for (let i = 0; i < env.polls; i += 1) {
    await env.wait(env.pollMs);
    const st = useChannels.getState();
    if (run !== polling || st.owner !== owner || !st.link) return;
    if (!linkLive(st.link)) {
      useChannels.setState({ link: null });
      return;
    }
    const read = await env.api.telegram();
    if (run !== polling || useChannels.getState().owner !== owner) return;
    if (read.ok && read.value.connected) {
      useChannels.setState({ telegram: { status: 'ready', value: read.value }, link: null });
      return;
    }
  }
}

/** Back to a fresh page (tests). */
export function resetChannels(): void {
  polling += 1;
  useChannels.setState({ owner: null, telegram: { status: 'idle' }, devices: { status: 'idle' }, link: null, busy: null, failure: null });
}

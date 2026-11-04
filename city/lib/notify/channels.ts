/**
 * The centre's line to the engine's notification channels (CITY-87): the same routes the Ryntra app calls, on the same
 * origin, under the wallet's proof (contract 1.11.0), unchanged.
 *
 * - `/api/v1/notifications/telegram` — whether a Telegram chat is connected (its handle, never its id), the bot's
 *   link with a signed fifteen-minute code, the disconnect. The chat is bound only by the bot, when the person presses
 *   Start in Telegram.
 * - `/api/v1/notifications/devices` — the phones with the Ryntra app that the engine pushes to, and taking one away.
 *   A phone registers itself from the app (it holds the push token); the page never does.
 *
 * A read takes the proof the wallet already gave and never asks the wallet by itself; a change asks for the wallet's
 * one signed message first when the proof is missing (`withProof`). Nothing here signs a transaction or moves money.
 */

export type TelegramView = Readonly<{ connected: boolean; username: string | null }>;

export type Device = Readonly<{ deviceId: string; platform: string; appVersion: string; registeredAt: string }>;

/** The bot's link and when its signed code stops working (fifteen minutes after it was made). */
export type BotLink = Readonly<{ url: string; expiresAt: number }>;

/** `unauthorized`: no proof of the wallet yet; `declined`: the wallet said no to the one message. */
export type ChannelFailure = 'unauthorized' | 'declined' | 'network' | 'failed';
export type ChannelResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: ChannelFailure }>;

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type ChannelFetch = (url: string, init: Readonly<{ method: string; headers: Record<string, string>; body?: string; credentials: 'same-origin'; cache: 'no-store' }>) => Promise<Answer>;

export const TELEGRAM_ROUTE = '/api/v1/notifications/telegram';
export const DEVICES_ROUTE = '/api/v1/notifications/devices';

const HEADERS = { 'X-Ryntra-API': '1', accept: 'application/json' } as const;
/** The bot's link as the contract writes it; anything else is never opened. */
const BOT_LINK = /^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=[A-Za-z0-9_-]+$/;
const DEVICE_ID = /^dev_[0-9a-f]{24}$/;

async function call<T>(fetchImpl: ChannelFetch, url: string, method: string, body: unknown, pick: (json: Record<string, unknown>) => T | null): Promise<ChannelResult<T>> {
  let answer: Answer;
  try {
    answer = await fetchImpl(url, {
      method,
      headers: body === undefined ? { ...HEADERS } : { ...HEADERS, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    return { ok: false, failure: 'network' };
  }
  if (answer.status === 401) return { ok: false, failure: 'unauthorized' };
  const json = (await answer.json().catch(() => null)) as Record<string, unknown> | null;
  if (!answer.ok || !json) return { ok: false, failure: 'failed' };
  const value = pick(json);
  return value === null ? { ok: false, failure: 'failed' } : { ok: true, value };
}

function telegramOf(json: Record<string, unknown>): TelegramView | null {
  const t = json.telegram as Record<string, unknown> | undefined;
  if (!t || typeof t !== 'object' || typeof t.connected !== 'boolean') return null;
  return { connected: t.connected, username: typeof t.username === 'string' && t.username ? t.username : null };
}

function botLinkOf(json: Record<string, unknown>): BotLink | null {
  if (typeof json.link !== 'string' || !BOT_LINK.test(json.link)) return null;
  const expiresAt = typeof json.expiresAt === 'string' ? Date.parse(json.expiresAt) : NaN;
  return { url: json.link, expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 };
}

function devicesOf(json: Record<string, unknown>): Device[] | null {
  if (!Array.isArray(json.devices)) return null;
  return json.devices
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object' && typeof (d as Record<string, unknown>).deviceId === 'string')
    .map((d) => ({
      deviceId: d.deviceId as string,
      platform: typeof d.platform === 'string' ? d.platform : 'android',
      appVersion: typeof d.appVersion === 'string' ? d.appVersion : '',
      registeredAt: typeof d.registeredAt === 'string' ? d.registeredAt : '',
    }));
}

export type ChannelsApi = Readonly<{
  telegram: () => Promise<ChannelResult<TelegramView>>;
  /** The bot's link to open: the chat is connected once the person presses Start there. */
  connectTelegram: (locale: 'en' | 'uk') => Promise<ChannelResult<BotLink>>;
  disconnectTelegram: () => Promise<ChannelResult<TelegramView>>;
  devices: () => Promise<ChannelResult<readonly Device[]>>;
  removeDevice: (deviceId: string) => Promise<ChannelResult<true>>;
}>;

export function createChannels(fetchImpl: ChannelFetch = (url, init) => fetch(url, init)): ChannelsApi {
  return {
    telegram: () => call(fetchImpl, TELEGRAM_ROUTE, 'GET', undefined, telegramOf),
    connectTelegram: (locale) => call(fetchImpl, TELEGRAM_ROUTE, 'POST', { locale }, botLinkOf),
    disconnectTelegram: () => call(fetchImpl, TELEGRAM_ROUTE, 'DELETE', undefined, telegramOf),
    devices: () => call(fetchImpl, DEVICES_ROUTE, 'GET', undefined, devicesOf),
    removeDevice: async (deviceId) => {
      if (!DEVICE_ID.test(deviceId)) return { ok: false, failure: 'failed' };
      return call(fetchImpl, `${DEVICES_ROUTE}/${deviceId}`, 'DELETE', undefined, (json) => (json.ok === true ? (true as const) : null));
    },
  };
}

/**
 * A change under the wallet's proof: a missing proof is asked for once — one signed message, never a transaction —
 * then the change again. The wallet's «no» is an answer of its own.
 */
export async function withProof<T>(change: () => Promise<ChannelResult<T>>, prove: () => Promise<'ok' | 'declined' | 'failed'>): Promise<ChannelResult<T>> {
  const first = await change();
  if (first.ok || first.failure !== 'unauthorized') return first;
  const proof = await prove();
  if (proof === 'declined') return { ok: false, failure: 'declined' };
  if (proof === 'failed') return first;
  return change();
}

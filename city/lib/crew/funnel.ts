/**
 * The first action's funnel: where a newcomer stops on the way from the first screen to the first signature
 * of the agent's budget. Seven moments, each counted at most once per visit (a tab's session), so the count of a moment
 * is the count of visits that reached it — no visitor id, no cookie, no wallet address in any form, no amount.
 *
 * A row says which moment, the language, and one fixed word for the device (`desk`, `phone`, or `app` — the Ryntra app's
 * WebView on Seeker) and, for two moments, one fixed word more (why a signature did not happen; which wallet app the
 * page was sent to). It rides on `/api/track` into the `events` table the admin already reads — no new table, no
 * migration. Pure: the page (`funnel-watch.ts`) and the route read the same names and the same shapes.
 *
 * It reaches the whole way to money: the city drawn (a visit that leaves while it loads is told apart from one
 * that saw the city), a sentence said, any wallet connected, the wallet's sign-in, and a trade's own signature and its
 * landing. A visit driven by a browser robot (`navigator.webdriver` — our own walks and shots) says `bot` in place of its
 * word, so the admin's count is people's.
 */

/** The moments, in the order of the agent's path. */
export const FUNNEL_STEPS = [
  /** The city's first screen, with the one action it offers. */
  'agent_home',
  /** The city's first frame drawn: the visit saw the city, not only its loading. */
  'agent_drawn',
  /** The first screen's action tapped: «Say it. Your agent does the rest.» */
  'agent_hint',
  /** The line where a sentence is said (⌘K, «Ask Ryntra», the hint) opened. */
  'agent_line',
  /** A sentence said: a ready one picked or one typed, and run. */
  'agent_said',
  /** The agent's card shown: the budget, the limits, «Sign» — from a sentence or from Agents → Hire. */
  'agent_card',
  /** A wallet connected with the card on the way. */
  'agent_wallet',
  /** «Sign» tapped. */
  'agent_sign',
  /** The budget signed: the agent is on. */
  'agent_signed',
] as const;

/**
 * The visit's way to money beside the card: «Practice first» (the agent on paper, no wallet asked), any wallet
 * connected, the wallet's sign-in, a trade signed, a trade landed.
 */
export const FUNNEL_WIDE = ['agent_practice', 'agent_connect', 'agent_signin', 'agent_trade', 'agent_traded'] as const;

/** Off the path: a signature that did not happen (the budget's, a trade's), and the phone sent to a wallet app. */
export const FUNNEL_SIDE = ['agent_sign_no', 'agent_wallet_app', 'agent_trade_no'] as const;

export const FUNNEL_EVENT_NAMES = [...FUNNEL_STEPS, ...FUNNEL_WIDE, ...FUNNEL_SIDE] as const;
export type FunnelName = (typeof FUNNEL_EVENT_NAMES)[number];

export const FUNNEL_DEVICES = ['desk', 'phone', 'app'] as const;
export type FunnelDevice = (typeof FUNNEL_DEVICES)[number];

/**
 * The one word a moment may carry: why nothing was signed; which wallet app, or the install page; `bot` for a visit a
 * browser robot drives (it replaces any other word, so robots' rows are one shape the admin leaves out).
 */
export const FUNNEL_WORDS = ['walletno', 'refused', 'unreachable', 'failed', 'phantom', 'solflare', 'install', 'bot'] as const;
export type FunnelWord = (typeof FUNNEL_WORDS)[number];

/** The placement every funnel row carries, so the admin reads them apart from the rest of the site's. */
export const FUNNEL_PLACEMENT = 'agent';
/** The page is the city's home; a row never says more about where it was. */
export const FUNNEL_PATH = '/';

const NAMES: ReadonlySet<string> = new Set(FUNNEL_EVENT_NAMES);
const DEVICES: ReadonlySet<string> = new Set(FUNNEL_DEVICES);
const WORDS: ReadonlySet<string> = new Set(FUNNEL_WORDS);

export const isFunnelEvent = (name: unknown): name is FunnelName => typeof name === 'string' && NAMES.has(name);

/** The word a moment carries: `bot` for a robot's visit, whatever the moment's own word was. */
export function funnelWord(word: FunnelWord | null, robot: boolean): FunnelWord | null {
  return robot ? 'bot' : word;
}

/** The device as one word, from what the page can see: the Ryntra app's WebView, a touch screen, or a desk. */
export function funnelDevice(inApp: boolean, coarse: boolean): FunnelDevice {
  return inApp ? 'app' : coarse ? 'phone' : 'desk';
}

const refOf = (device: unknown, word: unknown): string | null => {
  if (typeof device !== 'string' || !DEVICES.has(device)) return null;
  return typeof word === 'string' && WORDS.has(word) ? `${device}:${word}` : device;
};

/** A moment as the page sends it. */
export function funnelEvent(name: FunnelName, device: FunnelDevice, lang: 'en' | 'uk', word: FunnelWord | null = null): Readonly<Record<string, string | null>> {
  return { name, placement: FUNNEL_PLACEMENT, locale: lang, path: FUNNEL_PATH, ref: refOf(device, word) };
}

/**
 * The row `/api/track` stores for a funnel moment: every field held to its fixed shape, whatever the request carried —
 * a ref that is not «device» or «device:word» from the fixed sets is dropped, never stored as sent.
 */
export function funnelTrackRow(body: Readonly<Record<string, unknown>>): Readonly<{ name: string; placement: string; locale: string | null; path: string; ref: string | null }> | null {
  if (!isFunnelEvent(body.name)) return null;
  const [device, word, extra] = typeof body.ref === 'string' && body.ref.length <= 24 ? body.ref.split(':') : [];
  return {
    name: body.name,
    placement: FUNNEL_PLACEMENT,
    locale: body.locale === 'en' || body.locale === 'uk' ? body.locale : null,
    path: FUNNEL_PATH,
    ref: extra === undefined ? refOf(device, word ?? null) : null,
  };
}

/**
 * Once per visit: the moments already sent in this tab, kept in its session store — gone with the tab, never shared,
 * never read by anything else. A refused store (a private window) keeps them in memory for the page's life.
 */
export function onceStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null): Readonly<{ first: (name: FunnelName) => boolean }> {
  const KEY = 'ryntra.city.funnel.v1';
  const memory = new Set<string>();
  const read = (): Set<string> => {
    try {
      const raw = storage?.getItem(KEY);
      return raw ? new Set(raw.split(',').filter((n) => NAMES.has(n))) : new Set(memory);
    } catch {
      return new Set(memory);
    }
  };
  return {
    first: (name) => {
      const seen = read();
      if (seen.has(name) || memory.has(name)) return false;
      seen.add(name);
      memory.add(name);
      try {
        storage?.setItem(KEY, [...seen].join(','));
      } catch {
        /* A private window: the memory above keeps it for this page. */
      }
      return true;
    },
  };
}

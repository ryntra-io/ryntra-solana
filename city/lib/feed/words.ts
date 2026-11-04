import { digits, words } from '../i18n/dict.ts';

/** The names of the switches in «Show on home», by switch (CITY-79). */
export const FEED_SWITCHES = words(
  {
    gainers: 'Gainers',
    losers: 'Losers',
    inflows: 'Volume',
    coins: 'New coins',
    pools: 'New pools',
    flashing: 'Flashing effects',
    hot: 'Hot now card',
    arrivals: 'Arrivals card',
  },
  {
    gainers: 'Зростають',
    losers: 'Падають',
    inflows: 'Обсяг',
    coins: 'Нові монети',
    pools: 'Нові пули',
    flashing: 'Миготіння',
    hot: 'Картка «Гаряче зараз»',
    arrivals: 'Картка «Новосілля»',
  },
);

/** The feed's own words around its events. */
export const FEED = words(
  {
    feed: 'Live event feed',
    events: 'Events',
    eventsNew: 'Events, something new',
    clips: 'Clips of this visit',
    quiet: 'Quiet for now.',
    showOnHome: 'Show on home',
    sources: 'Sources and times',
    fewer: 'Fewer events',
    all: 'All events',
    close: 'Close',
    allOff: 'Everything is off.',
    now: 'now',
    minutes: (n: number) => `${n}m`,
    hours: (n: number) => `${n}h`,
    days: (n: number) => `${n}d`,
    justNow: 'just now',
    ago: (when: string) => `${when} ago`,
    told: (what: string, source: string, when: string, clock: string) => `${what}. ${source}, ${when}, at ${clock}.`,
    flyTo: 'Fly to it.',
    openPool: 'Open the pool.',
  },
  {
    feed: 'Події наживо',
    events: 'Події',
    eventsNew: 'Події, є нове',
    clips: 'Кліпи цього візиту',
    quiet: 'Поки тихо.',
    showOnHome: 'Показувати на головній',
    sources: 'Джерела й час',
    fewer: 'Менше подій',
    all: 'Усі події',
    close: 'Закрити',
    allOff: 'Усе вимкнено.',
    now: 'зараз',
    minutes: (n: number) => `${n} хв`,
    hours: (n: number) => `${n} год`,
    days: (n: number) => `${n} дн`,
    justNow: 'щойно',
    ago: (when: string) => `${when} тому`,
    told: (what: string, source: string, when: string, clock: string) => `${what}. ${source}, ${when}, о ${clock}.`,
    flyTo: 'Летіти до неї.',
    openPool: 'Відкрити пул.',
  },
);

/**
 * The feed's events are written once, when they arrive, in English (city/lib/feed/feed.ts); the card retells them in the
 * language on screen, so a switch of language repaints the events already in the list too. Each rule is one fixed
 * phrase of feed.ts; a phrase no rule knows stays as it was written.
 */
const RETELL_UK: readonly (readonly [RegExp, string | ((...m: string[]) => string)])[] = [
  [/^(.+) · 24h volume$/, (_, v) => `${v} · обсяг за 24 год`],
  // The more particular phrase first: «Unverified · … liquidity» before «… liquidity».
  [/^Unverified · (.+) liquidity$/, (_, v) => `Не перевірено · ${v} ліквідності`],
  [/^(.+) liquidity$/, (_, v) => `${v} ліквідності`],
  // «New pool» before «… pool», or it reads «Пул New» (CITY-188).
  [/^New coin$/, 'Нова монета'],
  [/^New pool$/, 'Новий пул'],
  [/^(.+) pool$/, (_, pair) => `Пул ${pair}`],
  [/^(\$\S+) launched on Ryntra$/, (_, t) => `${t} запущено на Ryntra`],
  [/^([+−-][\d.]+%) · (\d+)h$/, (_, p, h) => `${p} · ${h} год`],
  [/^([+−-][\d.]+%) · (\d+)m$/, (_, p, m) => `${p} · ${m} хв`],
  [/^([+−-][\d.]+%) · (\d+)d$/, (_, p, d) => `${p} · ${d} дн`],
];

/** One line of an event, in the language given («uk» retells it; English is how it was written). */
export function retell(text: string, lang: 'en' | 'uk'): string {
  if (lang === 'en' || !text) return text;
  for (const [rule, to] of RETELL_UK) {
    const m = text.match(rule);
    if (m) return digits(typeof to === 'string' ? to : to(...m), lang);
  }
  return digits(text, lang);
}

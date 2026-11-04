/**
 * The old handbook's addresses and where each one leads now (CITY-180). The old chapters stood in the old interface, which nobody
 * is to see (decision 75); their words are not used. A link somebody kept still lands on the section of the documentation that
 * covers the same ground, for good and in one hop. A chapter about what is not in the city leads to the hub.
 *
 * Pure data, no imports: the build's config reads this file before anything is compiled.
 */

const HUB = '/docs';

export const OLD_CHAPTERS: Readonly<Record<string, string>> = {
  '/docs/introduction': '/docs/start',
  '/docs/how-ryntra-works': '/docs/start',
  '/docs/start/getting-started': '/docs/start',
  '/docs/start/cabinet': '/docs/start',
  '/docs/start/wallet': '/docs/start',
  '/docs/ryntra-home': '/docs/start',
  '/docs/phone': '/docs/start',
  '/docs/manage/settings': '/docs/start',
  '/docs/glossary': '/docs/help',
  '/docs/reference/glossary': '/docs/help',
  '/docs/reference/networks': '/docs/start',

  '/docs/trade/overview': '/docs/trade',
  '/docs/trade/swap': '/docs/trade',
  '/docs/trade/screener': '/docs/city',
  '/docs/trade/trends': '/docs/city',
  '/docs/trade/spot': '/docs/orders',
  '/docs/trade/tokenized-stocks': '/docs/trade',
  '/docs/invest/buy': '/docs/trade',
  '/docs/invest/company-page': '/docs/trade',
  '/docs/invest/private-companies': '/docs/trade',
  '/docs/invest/what-you-buy': '/docs/trade',
  '/docs/invest/autoinvest': '/docs/orders',
  '/docs/strategies/my-strategies': '/docs/orders',
  '/docs/strategies/overview': '/docs/agent',
  '/docs/strategies/results': '/docs/agent',
  '/docs/bots': '/docs/agent',
  '/docs/ryntra': '/docs/agent',
  '/docs/agent-control': '/docs/agent',

  '/docs/launch/creator': '/docs/launch',
  '/docs/launch/launch-a-token': '/docs/launch',

  '/docs/manage/pools': '/docs/earn',

  '/docs/manage/activity': '/docs/money',
  '/docs/manage/portfolio': '/docs/money',
  '/docs/money/bridge': '/docs/money',
  '/docs/money/receive': '/docs/money',
  '/docs/money/send': '/docs/money',
  '/docs/money/top-up': '/docs/money',
  '/docs/trade/bridge': '/docs/money',
  '/docs/receipts-journal': '/docs/money',
  '/docs/reference/receipts': '/docs/money',
  '/docs/ecosystems': '/docs/money',

  '/docs/money/referrals': '/docs/partners',
  '/docs/money/rewards': '/docs/partners',
  '/docs/money/points': '/docs/partners',

  '/docs/reference/fees': '/docs/fees',

  '/docs/core-principles': '/docs/security',
  '/docs/reference/review': '/docs/security',
  '/docs/reference/security': '/docs/security',

  '/docs/faq': '/docs/help',
  '/docs/reference/faq': '/docs/help',
  '/docs/reference/statuses': '/docs/help',
  '/docs/reference/troubleshooting': '/docs/help',

  '/docs/developers': '/developers',
  '/docs/developers/:reference+': '/developers',

  '/docs/roadmap': '/roadmap',
  '/docs/changelog': '/roadmap',
  '/docs/current-capabilities': '/roadmap',
  '/docs/soon': '/roadmap',
  '/docs/product-paper': '/build',

  '/docs/trade/perps': HUB,
  '/docs/trade/predictions': HUB,
};

/** The sections' Ukrainian twins of old: `/uk/docs/…` says the same language with `?lang=` and leads to the one address. */
const SECTIONS = 'start|city|trade|orders|launch|earn|agent|money|partners|security|fees|guard|help';

export type ChapterRedirect = Readonly<{ source: string; destination: string; permanent: true }>;

/** The rows for `next.config.ts`: every old chapter, its Ukrainian address, and the hub's and the sections' Ukrainian addresses. */
export function oldChapterRedirects(): ChapterRedirect[] {
  const uk = (destination: string) => `${destination}?lang=uk`;
  return [
    ...Object.entries(OLD_CHAPTERS).flatMap(([source, destination]): ChapterRedirect[] => [
      { source, destination, permanent: true },
      { source: `/uk${source}`, destination: uk(destination), permanent: true },
    ]),
    { source: '/uk/docs', destination: uk('/docs'), permanent: true },
    { source: `/uk/docs/:section(${SECTIONS})`, destination: uk('/docs/:section'), permanent: true },
  ];
}

/** An older row of the config that leads to an old chapter leads straight to its section: one hop, never a chain. */
export function throughChapters<Row extends Readonly<{ destination: string }>>(row: Row): Row {
  const target = OLD_CHAPTERS[row.destination.startsWith('/docs/developers/') ? '/docs/developers/:reference+' : row.destination];
  return target ? { ...row, destination: target } : row;
}

/** A row of the config under an address this table already answers: never reached. */
export function shadowedByChapters(source: string): boolean {
  const plain = source.startsWith('/uk/') ? source.slice(3) : source;
  return plain in OLD_CHAPTERS || plain.startsWith('/docs/developers/');
}

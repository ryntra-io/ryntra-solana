/**
 * The old interface's addresses, and the place of the city each one opens (CITY-13, decision 75); and the short
 * addresses a person types by hand, each in one hop to its district or window (CITY-159).
 *
 * The old cabinet (`app/app/**`, `app/solana/workspace/**`), its aliases and Mission Control are closed: nobody sees
 * them. Every address they answered at leads, for good (308; a few for now, `TEMPORARY`), to the district or window of the city that does the same
 * work — a coin to its tower, a prediction market to its page in the Oracle, Send to Money on Send. What has no pair
 * opens the city's home. `next.config.ts` puts these rows ahead of every other row but the landing's language map and
 * predict.ryntra.io's own; `scripts/city/old-addresses.mjs` writes the table of `docs/city/OLD-ADDRESSES.md` from them
 * and walks every old address on a running server.
 *
 * A window that is closed in a deployment (its switch is not `open`) does not open from its address either: the city's
 * home answers, as the dock does (`city/components/open/OpenFromAddress.tsx`).
 *
 * Pure data, no imports: the build's config reads this file before anything is compiled.
 */

/**
 * The places of the city an old address can open; `page` is a document of the site at its own address (the help, the
 * legal texts, About, the documentation), which the city's document windows take over where it stands (CITY-157).
 */
export const CITY_PLACES = ['home', 'coin', 'trade', 'exchange', 'oracle', 'money', 'mine', 'launch', 'hall', 'harbor', 'agents', 'assistant', 'settings', 'page'] as const;
export type CityPlace = (typeof CITY_PLACES)[number];

/** The windows `/?open=<window>` opens; `coin` and `home` are addresses of their own. */
export const OPEN_WINDOWS = ['trade', 'exchange', 'oracle', 'money', 'mine', 'launch', 'hall', 'harbor', 'agents', 'assistant', 'settings'] as const;
export type OpenWindow = (typeof OPEN_WINDOWS)[number];

/** The query key that names a window on the city's home. */
export const OPEN_KEY = 'open';

/** A Solana mint, as a path segment or a query value captures it. */
export const MINT_PATTERN = '[1-9A-HJ-NP-Za-km-z]{32,44}';

/** One old address and where it leads. `query` names a query key whose mint value takes the address deeper, to the coin. */
export type OldAddress = Readonly<{
  source: string;
  destination: string;
  place: CityPlace;
  query?: string;
  /** 308 for good, or 307 where the address may be wanted again (see `TEMPORARY`). */
  permanent: boolean;
}>;

/**
 * The old addresses that lead into the city for now, not for good (307): a browser caches a 308 forever, so an address
 * another product or a later step may take back is never answered with one. `/agents` and `/agent-control` were another
 * product's, not this one (decision 69), temporary in the cabinet's own table too; `/live` was
 * Launch Night's, which the city's Launch brings back (CITY-146).
 */
const TEMPORARY = /^\/(?:agents(?:\/|$)|agent-control$|live$)/;

/**
 * A friend's code in `?ref=` (`lib/rewards/referral-code.ts`: twelve symbols of its alphabet, a letter among them),
 * exactly as `lib/growth/ref-param.ts` takes it. On an old address of the cabinet such a link is left to the address
 * layer (`middleware.ts`), which remembers the friend at `/r/<code>` and comes back to the same address, whose row then
 * leads it into the city: a 308 first would carry the code to a page the layer never sees, and the friend is lost.
 * Only where that layer listens — `/app/…`, `/uk/app/…`, `/solana/…` — so no other row ever lets the old page show.
 */
export const REFERRAL_ALPHABET = '0123456789BCDFGHJKLMNPQRSTVWXZ';
const REFERRAL_SYMBOL = `[${REFERRAL_ALPHABET}${REFERRAL_ALPHABET.replace(/[0-9]/g, '').toLowerCase()}]`;
const REFERRAL_LETTER = `[${REFERRAL_ALPHABET.replace(/[0-9]/g, '')}${REFERRAL_ALPHABET.replace(/[0-9]/g, '').toLowerCase()}]`;
/** The `ref` value, as Next anchors it (`^…$`). */
export const REFERRAL_REF = `\\s*(?=[0-9]*${REFERRAL_LETTER})${REFERRAL_SYMBOL}{12}\\s*`;
const REFERRAL_LISTENS = /^\/(?:uk\/)?(?:app|solana)(?:\/|$)/;

const HOME = '/';
const open = (window: OpenWindow, extra = '') => `/?${OPEN_KEY}=${window}${extra}`;
const COIN = '/c/:mint';

type Row = readonly [source: string, destination: string, place: CityPlace, query?: string];

/**
 * The cabinet's rows, written once for `/app/…`; the same rows answer at `/uk/app/…` (the city speaks English only).
 * Specific rows first: Next answers with the first row that matches.
 */
const CABINET: readonly Row[] = [
  /* Deeper first: a coin named in the address opens its tower. */
  ['/app/spot', COIN, 'coin', 'mint'],
  ['/app/swap', COIN, 'coin', 'out'],
  ['/app/swap', COIN, 'coin', 'in'],
  ['/app/trade', COIN, 'coin', 'out'],
  ['/app/assets', COIN, 'coin', 'mint'],
  [`/app/token/:mint(${MINT_PATTERN})`, COIN, 'coin'],
  [`/app/launch/:mint(${MINT_PATTERN})`, COIN, 'coin'],

  /* Trading: Swap and Spot are the trade window; Perps is the Exchange. */
  ['/app/swap/:path*', open('trade'), 'trade'],
  ['/app/spot/:path*', open('trade'), 'trade'],
  ['/app/trade/:path*', open('trade'), 'trade'],
  ['/app/terminal/:path*', open('trade'), 'trade'],
  ['/app/token/:path*', open('trade'), 'trade'],
  ['/app/perps/:path*', open('exchange'), 'exchange'],
  ['/app/futures/:path*', open('exchange'), 'exchange'],

  /* Predictions are the Oracle (CITY-67): its positions, a market's own page, the board. */
  ['/app/predictions/portfolio', open('oracle', '&page=positions'), 'oracle'],
  ['/app/predictions/:eventId', open('oracle', '&market=:eventId'), 'oracle'],
  ['/app/predictions', open('oracle'), 'oracle'],

  /* Money and the bridge: each on its tab of Money. */
  ['/app/send/:path*', open('money', '&tab=send'), 'money'],
  ['/app/bridge/:path*', open('money', '&tab=bridge'), 'money'],
  ['/app/top-up/:path*', open('money', '&tab=topup'), 'money'],
  ['/app/receive/:path*', open('money', '&tab=topup'), 'money'],
  ['/app/money/:path*', open('money', '&tab=topup'), 'money'],
  ['/app/activity/:path*', open('money', '&tab=activity'), 'money'],
  ['/app/history/:path*', open('money', '&tab=activity'), 'money'],
  ['/app/receipts/:path*', open('money', '&tab=activity'), 'money'],
  ['/app/operations/:path*', open('money', '&tab=activity'), 'money'],
  ['/app/journal/:path*', open('money', '&tab=activity'), 'money'],
  ['/app/action-cases/:path*', open('money', '&tab=activity'), 'money'],

  /* The portfolio is «My towers». */
  ['/app/portfolio/:path*', open('mine'), 'mine'],
  ['/app/holdings/:path*', open('mine'), 'mine'],
  ['/app/assets/:path*', open('mine'), 'mine'],
  ['/app/allowances/:path*', open('mine'), 'mine'],
  ['/app/map/:path*', open('mine'), 'mine'],
  ['/app/launch/mine', open('mine'), 'mine'],
  ['/app/launch/positions', open('mine'), 'mine'],

  /* Launch is the Launch Docks of the city. */
  ['/app/launch/:path*', open('launch'), 'launch'],

  /* Rewards are the Hall. */
  ['/app/rewards/:path*', open('hall'), 'hall'],

  /* Pools and yields are the Harbor. */
  ['/app/earn/:path*', open('harbor'), 'harbor'],
  ['/app/markets/pools/:path*', open('harbor'), 'harbor'],

  /* Bots, agents, the treasury and every strategy page are the Agents district. */
  ...['bots', 'agents', 'treasury', 'autoinvest', 'strategies', 'strategy-lab', 'plans', 'results', 'control'].map(
    (page): Row => [`/app/${page}/:path*`, open('agents'), 'agents'],
  ),

  /* The assistant, its research and its watches are the city's assistant. */
  ...['ryn', 'ideas', 'research', 'adviser', 'alerts', 'lens'].map((page): Row => [`/app/${page}/:path*`, open('assistant'), 'assistant']),

  /* Settings and the sign-in door are the city's Settings. */
  ['/app/settings/:path*', open('settings'), 'settings'],
  ['/app/connect/:path*', open('settings'), 'settings'],

  /* The developer pages were always the site's documentation. */
  ['/app/developers/:path*', '/developers', 'page'],
  ['/app/coverage/:path*', '/docs', 'page'],

  /* Everything else of the cabinet — Home, Markets, Trends, the stocks, fees, any page not named — is the city. */
  ['/app/:path*', HOME, 'home'],
];

/** The Solana workspace of the cabinet's first years, and the aliases that led into the cabinet. */
const OTHERS: readonly Row[] = [
  ['/solana/workspace/spot', COIN, 'coin', 'mint'],
  ['/solana/workspace/swap', COIN, 'coin', 'out'],
  ['/solana/workspace/assets', COIN, 'coin', 'mint'],
  ['/solana/workspace/swap/:path*', open('trade'), 'trade'],
  ['/solana/workspace/trade/:path*', open('trade'), 'trade'],
  ['/solana/workspace/spot/:path*', open('trade'), 'trade'],
  ['/solana/workspace/futures/:path*', open('exchange'), 'exchange'],
  ['/solana/workspace/send/:path*', open('money', '&tab=send'), 'money'],
  ['/solana/workspace/bridge/:path*', open('money', '&tab=bridge'), 'money'],
  ['/solana/workspace/receive/:path*', open('money', '&tab=topup'), 'money'],
  ['/solana/workspace/money/:path*', open('money', '&tab=topup'), 'money'],
  ['/solana/workspace/history/:path*', open('money', '&tab=activity'), 'money'],
  ['/solana/workspace/receipts/:path*', open('money', '&tab=activity'), 'money'],
  ['/solana/workspace/holdings/:path*', open('mine'), 'mine'],
  ['/solana/workspace/assets/:path*', open('mine'), 'mine'],
  ['/solana/workspace/map/:path*', open('mine'), 'mine'],
  ['/solana/workspace/rewards/:path*', open('hall'), 'hall'],
  ['/solana/workspace/earn/:path*', open('harbor'), 'harbor'],
  ['/solana/workspace/settings/:path*', open('settings'), 'settings'],
  ['/solana/workspace/developers/:path*', '/developers', 'page'],
  ['/solana/:path*', HOME, 'home'],

  /* Mission Control (decision 68): a mission is its coin's tower; Launch Night and the rest are the city. */
  [`/mission/:mint(${MINT_PATTERN})`, COIN, 'coin'],
  ['/mission/:path*', HOME, 'home'],
  ['/live', HOME, 'home'],

  /* The shell Predictions had as a product of its own: the Oracle. predict.ryntra.io keeps its own rules. */
  ['/predict/portfolio', open('oracle', '&page=positions'), 'oracle'],
  ['/predict/:eventId', open('oracle', '&market=:eventId'), 'oracle'],
  ['/predict/:path*', open('oracle'), 'oracle'],

  /* The aliases that led into the cabinet, each in one hop now. */
  [`/assets/:mint(${MINT_PATTERN})`, COIN, 'coin'],
  ['/agents/workspace/settings', open('settings'), 'settings'],
  ['/agents/:path*', open('agents'), 'agents'],
  ['/agent-control', open('agents'), 'agents'],
  ...['/home', '/beta', '/demo', '/product', '/product-map', '/workspaces'].map((source): Row => [source, HOME, 'home']),
];

const UK = '/uk';

function rows(): OldAddress[] {
  const at = ([source, destination, place, query]: Row): OldAddress => ({ source, destination, place, ...(query ? { query } : {}), permanent: !TEMPORARY.test(source) });
  const cabinet = CABINET.map(at);
  return [...cabinet, ...cabinet.map((row) => ({ ...row, source: `${UK}${row.source}` })), ...OTHERS.map(at)];
}

/** Every old address, in the order it is matched. */
export const OLD_ADDRESSES: readonly OldAddress[] = rows();

/**
 * The short addresses a person types by hand or a post names (CITY-159): each opens its district or window in one
 * hop. None of them ever had a page; each answered with the framework's bare 404. They lead into the city for now
 * (307), never for good: an address this short may yet be wanted for a page of its own, and a browser keeps a 308
 * forever.
 *
 * The documents lead to the address the site keeps for them — the legal texts at `/legal/…` (a store listing and the
 * law name those), the help at `/support` — the city's document pages since CITY-157, as `/about` is.
 * The old About at `/company` stays a page until the city leads it somewhere. What the city has no place for (`/blog`, `/press`, `/brand`) is not led anywhere: it is the
 * city's own 404, with its one way back (`city/components/open/Lost.tsx`).
 */
const SHORT: readonly Row[] = [
  /* A coin by its mint: its tower. */
  [`/token/:mint(${MINT_PATTERN})`, COIN, 'coin'],
  [`/coin/:mint(${MINT_PATTERN})`, COIN, 'coin'],

  /* Trading: the trade window, the Exchange, the Oracle. */
  ...['/trade', '/swap', '/spot'].map((source): Row => [source, open('trade'), 'trade']),
  ...['/exchange', '/perps', '/futures'].map((source): Row => [source, open('exchange'), 'exchange']),
  ...['/predictions', '/oracle'].map((source): Row => [source, open('oracle'), 'oracle']),

  /* Money, each on its tab. */
  ['/money', open('money'), 'money'],
  ['/send', open('money', '&tab=send'), 'money'],
  ...['/receive', '/deposit', '/top-up'].map((source): Row => [source, open('money', '&tab=topup'), 'money']),
  ['/bridge', open('money', '&tab=bridge'), 'money'],
  ...['/history', '/activity'].map((source): Row => [source, open('money', '&tab=activity'), 'money']),

  /* The districts. */
  ...['/portfolio', '/holdings'].map((source): Row => [source, open('mine'), 'mine']),
  ['/launch', open('launch'), 'launch'],
  ...['/rewards', '/hall'].map((source): Row => [source, open('hall'), 'hall']),
  ...['/earn', '/pools', '/harbor', '/yield'].map((source): Row => [source, open('harbor'), 'harbor']),
  ['/bots', open('agents'), 'agents'],
  ['/assistant', open('assistant'), 'assistant'],
  /* `/connect` is the AI-chat connector's consent page since CITY-154: no short address takes it. */
  ...['/settings', '/login', '/signin', '/account'].map((source): Row => [source, open('settings'), 'settings']),

  /* `/status` led to the old documentation; the city is what is live. */
  ...['/status', '/city', '/map'].map((source): Row => [source, HOME, 'home']),

  /* The documents, at the addresses the site keeps for them. The legal texts are English only. */
  ...['/terms', '/tos', '/legal', `${UK}/legal/terms`].map((source): Row => [source, '/legal/terms', 'page']),
  ...['/privacy', `${UK}/legal/privacy`].map((source): Row => [source, '/legal/privacy', 'page']),
  ...['/help', '/faq'].map((source): Row => [source, '/support', 'page']),
];

/** Every short address, in the order it is matched after the old ones; each for now (307). */
export const SHORT_ADDRESSES: readonly OldAddress[] = SHORT.map(([source, destination, place]) => ({ source, destination, place, permanent: false }));

/** Where a short address may lead that is not the city's own page yet: the site's documents, which CITY-157 takes over. */
export const DOCUMENT_PREFIXES = ['/docs', '/developers', '/legal', '/support', '/about', '/company'] as const;

type HostCondition = Readonly<{ type: 'host'; value: string }>;
type QueryCondition = Readonly<{ type: 'query'; key: string; value: string }>;
export type CityRedirect = {
  source: string;
  destination: string;
  permanent: boolean;
  has?: (HostCondition | QueryCondition)[];
  missing?: QueryCondition[];
};

/**
 * A row as Next reads it: the query key, when there is one, captured as the coin's mint; a friend's `?ref=` code on
 * the cabinet's addresses left to the address layer first.
 */
function redirectOf(row: OldAddress, host?: Readonly<{ condition: HostCondition; origin: string }>): CityRedirect {
  const has: (HostCondition | QueryCondition)[] = [];
  if (host) has.push(host.condition);
  if (row.query) has.push({ type: 'query', key: row.query, value: `(?<mint>${MINT_PATTERN})` });
  const destination = host ? `${host.origin}${row.destination}` : row.destination;
  const missing: QueryCondition[] = REFERRAL_LISTENS.test(row.source) ? [{ type: 'query', key: 'ref', value: REFERRAL_REF }] : [];
  return { source: row.source, destination, permanent: row.permanent, ...(has.length ? { has } : {}), ...(missing.length ? { missing } : {}) };
}

/**
 * The redirects of the old addresses, for `next.config.ts`.
 *
 * `appHost` is the application's own host (app.ryntra.io), where the cabinet answered at `/solana/…` and the build's
 * own links at `/app/…`. There the host's root opens the city on the site's origin, and every old address hands over
 * to the same address on the site, whose rows below lead it on: the host never shows the city itself. The workspace of
 * the first years (`/solana/workspace/…`) is the same address on the site, not a page of the cabinet. The host's root
 * and the short addresses lead to the city only for now (307): what that host becomes is the domains' own decision
 * (`docs/domains/`).
 */
export function oldAddressRedirects(appHost?: Readonly<{ condition: HostCondition; origin: string }>): CityRedirect[] {
  const plain = [...OLD_ADDRESSES, ...SHORT_ADDRESSES].map((row) => redirectOf(row));
  if (!appHost) return plain;
  const to = (source: string, destination: string, permanent = true): CityRedirect => ({ source, destination: `${appHost.origin}${destination}`, permanent, has: [appHost.condition] });
  return [
    to('/', '/', false),
    to('/solana/workspace/:path*', '/solana/workspace/:path*'),
    to('/solana/:path*', '/app/:path*'),
    to(`${UK}/solana/:path*`, '/app/:path*'),
    to('/app/:path*', '/app/:path*'),
    to(`${UK}/app/:path*`, '/app/:path*'),
    /* A short address on the application's host opens its place on the site, in one hop too. */
    ...SHORT_ADDRESSES.map((row) => to(row.source, row.destination, false)),
    ...plain,
  ];
}

/** The path prefixes of the old interface, for the headers that keep them out of every index. */
export const OLD_PREFIXES = ['/app', '/uk/app', '/solana', '/mission', '/live'] as const;

/** The addresses this table answers whatever the query: no coin to read from it, no friend's code to wait for. */
const ANSWERED = new Set([...OLD_ADDRESSES, ...SHORT_ADDRESSES].filter((row) => !row.query && !REFERRAL_LISTENS.test(row.source)).map((row) => row.source));

/**
 * Whether a row of the build's older tables answers under a prefix this table takes whole (`/app/:path*` and the
 * like, unconditional), or at an address one of its rows answers as it is (`/status`, `/home`): such a row is never
 * reached, so the config leaves it out rather than keep a dead chain.
 */
export function shadowedByOldAddresses(source: string): boolean {
  return ANSWERED.has(source) || /^\/(?:uk\/)?(?:app|solana|mission|agents|predict)(?:\/|$)|^\/live$/.test(source);
}

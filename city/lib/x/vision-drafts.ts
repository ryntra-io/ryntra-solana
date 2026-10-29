import { BRAND } from '../brand.ts';
import { X_MAX, xLength } from '../moments/drafts/post.ts';
import { HandleError, mention, type Involvement, type MentionContext } from './handles.ts';

/**
 * Drafts for X that say what Ryntra City is and how each live feature works (CITY-44): the vision thread, a thread per
 * live feature with its CITY-42 video, and the weekly «Built this week» with the road map. Data only: nothing here
 * posts. Each draft goes through the queue of CITY-3 and a person's approval; publishing is a separate step.
 *
 * Honesty is checked, not trusted. Every post names what it claims: `live` points at the task's row or the line of the
 * production record that shows it is on ryntra.io and open to people; `building` names the rows it describes as still
 * to come. The check that reads those records lives beside the documents (`docs/city/x/claims.test.mjs`).
 *
 * A partner is tagged only where it really is in the work (Jupiter routes the swap and verifies tokens, Meteora runs
 * the launch curve and the pools, Phantom signs, Solana is the market). The tag is a slot, `{@jupiter}`: its handle is
 * filled in only from the handle list a person has checked (`handles.ts`, CITY-41), in a post a person approved, never
 * typed here.
 */

export type Partner = 'jupiter' | 'meteora' | 'phantom' | 'solana';

/** What each partner does in the posts that tag it, as the handle list names it (`handles.ts`). */
const INVOLVED: Readonly<Record<Partner, Involvement>> = { jupiter: 'swap', meteora: 'launch', phantom: 'wallet', solana: 'chain' };

export const PARTNERS: Readonly<Record<Partner, { name: string; role: string }>> = {
  jupiter: { name: 'Jupiter', role: 'routes the swap from a tower and verifies the tokens the city names' },
  meteora: { name: 'Meteora', role: 'the launch curve (DBC), DAMM v2 and DLMM pools' },
  phantom: { name: 'Phantom', role: 'a wallet that signs the trade and the sign-in message' },
  solana: { name: 'Solana', role: 'the market the city draws' },
};

/** The longest a handle can be as X counts it: `@` and 15 characters. A slot is counted at that length. */
export const HANDLE_MAX = 16;

const SLOT = /\{@([a-z]+)\}/g;

/** A bare domain becomes a link on X and counts as one. */
const BARE_LINK = /(^|[\s(])((?:[a-z0-9-]+\.)+(?:io|com|ag|fi|xyz|so)(?:\/\S*)?)/gi;

export type Evidence = Readonly<{ registry: string }> | Readonly<{ state: string }>;

/** The five live features, each with its CITY-42 video. */
export type Feature = 'city-and-tower' | 'buy-from-tower' | 'link-and-search' | 'your-quarter' | 'moment-clip';
export const FEATURES: readonly Feature[] = ['city-and-tower', 'buy-from-tower', 'link-and-search', 'your-quarter', 'moment-clip'];

/** The id of a feature's video in the CITY-42 package (`apps/video`): CITY-42 names its scenarios this way. */
export const scenarioOf = (feature: Feature): string => `city42:${feature}`;

export type Media =
  /** The feature's video from CITY-42: 16:9 for the post, 1:1 for the feed, text in the frame, no sound needed. */
  | Readonly<{ kind: 'video'; scenario: string; ratios: readonly ('16:9' | '1:1')[] }>
  /** A frame of the live city, taken by `node scripts/city/shots.mjs`. */
  | Readonly<{ kind: 'shot'; shot: string }>
  /** The road map, «Шлях Ryntra City»: a frame of the page `node scripts/city-map/build.mjs` builds. */
  | Readonly<{ kind: 'map' }>;

export type PostDraft = Readonly<{
  text: string;
  media: Media | null;
  live: readonly Evidence[];
  building: readonly string[];
}>;

export type Series = 'vision' | 'feature' | 'weekly';

export type VisionDraft = Readonly<{
  id: string;
  series: Series;
  title: string;
  feature: Feature | null;
  /** A thread: each post after the first replies to the one before it. */
  posts: readonly PostDraft[];
}>;

const HOME = `https://${BRAND.domain}`;
/** `/c/<mint>` opens the city on one coin (`city/lib/share/coin-link.ts`). $JUP is the example: an example, not a pick. */
export const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const COIN = (mint: string) => `${HOME}/c/${mint}`;

const video = (feature: Feature): Media => ({ kind: 'video', scenario: scenarioOf(feature), ratios: ['16:9', '1:1'] });
const reg = (...ids: string[]): Evidence[] => ids.map((registry) => ({ registry }));

/** Lines of the production record for what has no task row of its own. */
const STATE_LINK_SEARCH = "`/c/<mint>` with the coin's share image, search";
const STATE_SIGNED_BUILD = 'the quarter claimed and a home built under the wallet';

const post = (text: string, extra: Partial<Omit<PostDraft, 'text'>> = {}): PostDraft => ({
  text,
  media: extra.media ?? null,
  live: extra.live ?? [],
  building: extra.building ?? [],
});

const DISCLOSURE = 'Not financial advice. Crypto is volatile. Non-custodial — you sign every trade.';

// ---------- The vision thread ----------

export const VISION_THREAD: VisionDraft = {
  id: 'vision-thread',
  series: 'vision',
  title: 'Ryntra City, the whole picture',
  feature: null,
  posts: [
    post(
      'Ryntra City: the whole {@solana} market as one living 3D city. Every coin is a tower.\n\nThis is the full picture of what we are building. What is live on ryntra.io today and what comes next, kept apart.',
      { media: { kind: 'shot', shot: 'city-wide' }, live: reg('CITY-12') },
    ),
    post(
      'Live now: the city.\n\nThe market is a night skyline in five districts: Sol Core, DeFi Heights, Meme Strip, Stock Avenue and the Launch Docks. A tower’s height follows market cap, never above what its liquidity can hold. Every figure carries its source and window.',
      { media: { kind: 'shot', shot: 'districts' }, live: reg('CITY-12') },
    ),
    post(
      'Live now: buy and sell from a tower.\n\nTap a tower, pay in SOL or USDC, pick an amount or type your own. Before you sign you see the Ryntra fee, the route through {@jupiter}, the least you get and the price impact. One signature in your own wallet.',
      { media: { kind: 'shot', shot: 'trade-card' }, live: reg('CITY-1', 'CITY-37') },
    ),
    post(
      'Live now: a link for every coin, and search.\n\nEvery coin has its own link that opens the city on it, and its own card when shared on X. Search by ticker, name or a pasted mint address. Coins Jupiter does not verify are marked Unverified.',
      { media: { kind: 'shot', shot: 'search' }, live: [{ state: STATE_LINK_SEARCH }] },
    ),
    post(
      'Live now: your own quarter.\n\nClaim your spot. Your wallet signs one message: no transaction, nothing moves. Your quarter is kept under that wallet. The camera flies to your plot; tap a glowing plot and your Home goes up.',
      { media: { kind: 'shot', shot: 'quarter' }, live: [...reg('CITY-15', 'CITY-14'), { state: STATE_SIGNED_BUILD }] },
    ),
    post(
      'Live now: moment clips.\n\nWhen a new pool rises in the Launch Docks, the city keeps the moment and films a 9:16 clip with the real figure and the time it was read. After your own trade it films a 4:5 clip of your tower in your colour.',
      { media: { kind: 'shot', shot: 'moment' }, live: reg('CITY-26', 'CITY-1') },
    ),
    post(
      'That is what is live. Now what we are building.\n\nThe road runs in five stages with gates, not dates: a step opens when it passes its checks. The map below shows every task and where it stands.',
      { media: { kind: 'map' } },
    ),
    post(
      'Building: launch in the city.\n\nPicture, name, ticker, review, one signature. Your coin rises as a tower in the Launch Docks. Past $75K on its curve it moves into a DAMM v2 pool, and days 7, 30 and 90 become events of the city. Built on {@meteora}.',
      { building: ['CITY-2'] },
    ),
    post(
      'Building: the Harbor and the Arena.\n\nHarbor: put coins in a Meteora DLMM or DAMM v2 pool and take a share of its fees. A pool can also lose, and the city will show that too. Arena: perps on Phoenix, long or short, with TP/SL and account health in view.',
      { building: ['CITY-5b', 'CITY-5d'] },
    ),
    post(
      'Building: agents and the Oracle.\n\nA scout agent flies the city by your rule and brings a find back to you. Nothing is bought until you sign it. The Oracle puts prediction markets above the city as a board, on paper first.',
      { building: ['CITY-4', 'CITY-5c'] },
    ),
    post(
      'Building: the quarter comes alive.\n\nA 20-second "while you were away". Daily tasks that cost nothing. Crew streets you build together. A weekly district war counted in actions, not purchases. Seasons that move active quarters closer to the centre.',
      { building: ['CITY-18', 'CITY-19', 'CITY-20', 'CITY-21', 'CITY-22'] },
    ),
    post(
      'Building: your towers, and the phone.\n\nYour coins glow as your own towers, with what grew and a one-tap sell. A live chart inside each tower. And the same city in the Ryntra app on Seeker, signed with the phone’s wallet.',
      { building: ['CITY-7', 'CITY-5a', 'CITY-6'] },
    ),
    post(
      'How it stays honest.\n\nThe city never moves money: the Ryntra engine builds each trade and you sign it. Ryntra never holds your keys or funds. Every figure has a source and a time. Scores never count trades inside one wallet cluster. We pay no one for posts.',
      { live: reg('CITY-1', 'CITY-24') },
    ),
    post(`Every live feature gets its own video, and every week a "Built this week" post with the road map.\n\n${DISCLOSURE}\n\n${HOME}`),
  ],
};

// ---------- One thread per live feature ----------

const feature = (id: Feature, title: string, posts: PostDraft[]): VisionDraft => ({ id: `feature-${id}`, series: 'feature', title, feature: id, posts });

export const FEATURE_POSTS: readonly VisionDraft[] = [
  feature('city-and-tower', 'The city and the tower', [
    post(
      'How Ryntra City works, part 1: the city and the tower.\n\nThe whole Solana market as one night skyline. Every coin is a tower. Here is what you are looking at, and why it is honest.',
      { media: video('city-and-tower'), live: reg('CITY-12') },
    ),
    post(
      'A tower’s height follows market cap, but never higher than its liquidity can hold. Five districts: Sol Core, DeFi Heights, Meme Strip, Stock Avenue and the Launch Docks, where new pools stand without a name, marked unverified, until Jupiter verifies them.',
      { live: reg('CITY-12') },
    ),
    post(
      'Tap a tower: price, 24h change, market cap, liquidity, traders in the last hour and its rank. A move becomes a city moment only with real liquidity, when two reads a minute apart agree. Data older than 5 minutes triggers nothing, and the top shows DELAYED.',
      { live: reg('CITY-12') },
    ),
    post(`No wallet needed to look around. Open the city:\n\n${HOME}`, { live: reg('CITY-12') }),
  ]),
  feature('buy-from-tower', 'Buy from a tower', [
    post(
      'How Ryntra City works, part 2: buy from a tower.\n\nFrom a tower to a trade, signed in your own wallet. Step by step.',
      { media: video('buy-from-tower'), live: reg('CITY-1') },
    ),
    post(
      '1. Tap a tower, then Buy.\n2. Connect a Solana wallet: Phantom, Solflare or Backpack.\n3. Pay in SOL or USDC. Pick an amount tile or type your own. On a computer the trade card can be dragged and resized.',
      { live: reg('CITY-1', 'CITY-37') },
    ),
    post(
      '4. Before you sign, the card shows the Ryntra fee, the route, the least you get and the price impact. The Ryntra engine builds the quote and the transaction, routed through {@jupiter}.\n5. Confirm in your wallet. One signature.',
      { live: reg('CITY-1') },
    ),
    post(
      'What your wallet signs: one swap transaction from your own wallet. Ryntra never holds your keys or your funds. If a trade reaches the chain and fails, the card says so: only the network fee was spent.',
      { live: reg('CITY-1') },
    ),
    post(
      `After it lands, the result is read back from the chain, your tower glows in your colour and the city films a 4:5 clip of your trade. The transaction is one tap away.\n\n${DISCLOSURE}\n\n${HOME}`,
      { live: reg('CITY-1') },
    ),
  ]),
  feature('link-and-search', 'A link for every coin, and search', [
    post(
      'How Ryntra City works, part 3: a link for every coin, and search.\n\nAny Solana coin, found in seconds and shared with its own card.',
      { media: video('link-and-search'), live: [{ state: STATE_LINK_SEARCH }] },
    ),
    post(
      'Every coin has its own link in the city, built from its mint address. It opens the city on that coin: its tower if it stands in the skyline, its trade card if it does not. Shared on X, the preview is that coin’s own card with its price and 24h change.',
      { live: [{ state: STATE_LINK_SEARCH }] },
    ),
    post(
      'Search sits in the top bar. Type a ticker or a name, or paste a mint address. Each result says whether it stands in the city or is not a tower yet, and coins Jupiter does not verify are marked Unverified. On a tower, Share tower makes its card for X.',
      { live: [{ state: STATE_LINK_SEARCH }] },
    ),
    post(`Here is $JUP, read live. An example of a link, not a pick.\n\n${COIN(JUP)}`, { live: [{ state: STATE_LINK_SEARCH }] }),
  ]),
  feature('your-quarter', 'Your own quarter', [
    post(
      'How Ryntra City works, part 4: your own quarter.\n\nEvery person gets a quarter of the city to build on. The first step:',
      { media: video('your-quarter'), live: reg('CITY-15') },
    ),
    post(
      '1. Tap Claim your spot.\n2. Connect your wallet and sign one message. It proves the wallet is yours: no transaction, nothing moves.\n3. The camera flies to your plot.\n4. Tap a glowing plot and your Home goes up.',
      { live: [...reg('CITY-15'), { state: STATE_SIGNED_BUILD }] },
    ),
    post(
      'Your quarter is kept under your wallet on Ryntra’s world server, so it opens the same on any device. Building costs nothing: there is no transaction for a module.',
      { live: reg('CITY-14', 'CITY-15') },
    ),
    post(
      `Coming to the quarter next: daily tasks that cost nothing and crew streets you build together.\n\nClaim your spot:\n\n${HOME}`,
      { live: reg('CITY-15'), building: ['CITY-19', 'CITY-20'] },
    ),
  ]),
  feature('moment-clip', 'Moment clips', [
    post(
      'How Ryntra City works, part 5: moment clips.\n\nThe city films its own moments, in your browser, with real figures only.',
      { media: video('moment-clip'), live: reg('CITY-26') },
    ),
    post(
      'When a new pool rises in the Launch Docks, the city keeps it as a moment, and the Moments button counts them. Open one and the city films a 9:16 clip: the tower, its real figure and the time it was read. No sound, made to loop on X.',
      { live: reg('CITY-26') },
    ),
    post(
      'After your own trade, the city films a 4:5 clip: the camera flies to your tower, it takes your colour, fireworks go up and the amount counts from zero. Only the trade’s own figures, read from the chain. Post it on X, or save it.',
      { live: reg('CITY-1') },
    ),
    post(`Where a browser cannot film video, you get the card instead.\n\nMake your first clip:\n\n${HOME}`, { live: reg('CITY-26') }),
  ]),
];

// ---------- Built this week ----------

export type WeekItem = Readonly<{ words: string; evidence: Evidence }>;
export type WeekNext = Readonly<{ words: string; task: string }>;

/** Lines of a list, packed into as few posts as X holds, each opening with its heading. */
function packed(heading: string, lines: readonly string[]): string[] {
  const out: string[] = [];
  let current = heading;
  for (const line of lines) {
    const next = `${current}\n— ${line}`;
    if (current !== heading && draftLength(next) > X_MAX) {
      out.push(current);
      current = `${heading}\n— ${line}`;
    } else current = next;
  }
  if (current !== heading) out.push(current);
  return out;
}

/**
 * The weekly post: what went live on ryntra.io this week and what comes next, with a frame of the road map. Every
 * shipped line names its evidence and every next line its registry row, as in the rest of the drafts.
 */
export function builtThisWeek(input: { week: string; shipped: readonly WeekItem[]; next: readonly WeekNext[] }): VisionDraft {
  if (!input.shipped.length) throw new Error('built this week: nothing shipped, no post');
  const live = input.shipped.map((s) => s.evidence);
  const building = input.next.map((n) => n.task);
  return {
    id: `weekly-${input.week.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    series: 'weekly',
    title: `Built this week, ${input.week}`,
    feature: null,
    posts: [
      post(`Built this week in Ryntra City, ${input.week}.\n\nWhat went live on ryntra.io and where we are on the road. Gates, not dates.`, { media: { kind: 'map' }, live }),
      ...packed('Live on ryntra.io:', input.shipped.map((s) => s.words)).map((text) => post(text, { live })),
      ...packed('Next on the road:', input.next.map((n) => n.words)).map((text) => post(text, { building })),
      post(`Every task and where it stands is on the map above. Open the city:\n\n${HOME}`),
    ],
  };
}

/** The week of 27.10, the first «Built this week»: filled from the registry and the production record of that week. */
export const WEEK_OF_OCT_27: VisionDraft = builtThisWeek({
  week: 'week of Oct 27',
  shipped: [
    { words: 'ryntra.io is the city: the Solana market as a living skyline', evidence: { registry: 'CITY-12' } },
    { words: 'Buy and sell from a tower, signed in your own wallet', evidence: { registry: 'CITY-1' } },
    { words: 'Pay in SOL or USDC, type your own amount, drag the trade card', evidence: { registry: 'CITY-37' } },
    { words: 'A link for every coin with its own card, and search', evidence: { state: STATE_LINK_SEARCH } },
    { words: 'Claim your spot and build your Home', evidence: { registry: 'CITY-15' } },
    { words: 'Moment clips: 9:16 from the city, 4:5 after your trade', evidence: { registry: 'CITY-26' } },
  ],
  next: [
    { words: 'Launch in the city', task: 'CITY-2' },
    { words: 'The Harbor: Meteora pools', task: 'CITY-5b' },
    { words: 'Scout agents you confirm with one tap', task: 'CITY-4' },
    { words: 'The city on the phone', task: 'CITY-6a' },
  ],
});

export const ALL_DRAFTS: readonly VisionDraft[] = [VISION_THREAD, ...FEATURE_POSTS, WEEK_OF_OCT_27];

// ---------- Length, tags, words ----------

/** The length X will count once every slot holds the longest handle and every domain is a link. */
export function draftLength(text: string): number {
  const filled = text.replace(SLOT, '@'.padEnd(HANDLE_MAX, 'x')).replace(BARE_LINK, (_, lead: string, link: string) => (/^https?:/i.test(link) ? `${lead}${link}` : `${lead}https://${link}`));
  return xLength(filled);
}

/** The partners a text tags, in order, once each. */
export function partnersIn(text: string): string[] {
  return [...new Set([...text.matchAll(SLOT)].map((m) => m[1]!))];
}

/**
 * The words with every slot holding its handle from the checked list (`handles.ts`, CITY-41): only in a post a person
 * approved, only for a handle checked on its live profile not long before, only where the partner takes part. Refused,
 * with each reason, while any slot cannot be filled; the handles never come from this file.
 */
export function resolveHandles(
  text: string,
  ctx: Omit<MentionContext, 'involvement'>,
): { ok: true; text: string } | { ok: false; missing: string[]; why: string[] } {
  const missing = new Set<string>();
  const why: string[] = [];
  const filled = text.replace(SLOT, (slot, p: string) => {
    if (!(p in PARTNERS)) {
      missing.add(p);
      why.push(`{@${p}} is not a partner of these drafts`);
      return slot;
    }
    try {
      return mention(p, { ...ctx, involvement: [INVOLVED[p as Partner]] });
    } catch (e) {
      if (!(e instanceof HandleError)) throw e;
      missing.add(p);
      why.push(e.message);
      return slot;
    }
  });
  return missing.size ? { ok: false, missing: [...missing], why } : { ok: true, text: filled };
}

/**
 * Words the drafts never use: the product's forbidden words for posts, the brandbook's (docs/city/brand/BRANDBOOK.md)
 * and the promises the CITY-3 queue refuses. «Bot» is never what an agent is called. Other products are never named.
 */
export const FORBIDDEN: readonly RegExp[] = [
  /\bunruggable\b/i, /\bfloor price\b/i, /\bguarantee[ds]?\b/i, /\bpassive income\b/i, /\b\d+0x\b/i, /\bdegen/i, /\bbots?\b/i,
  /\bmoon(ing)?\b/i, /\brisk[- ]?free\b/i, /\briskless\b/i, /\bget rich\b/i, /\blambo\b/i, /\bcan[’']?t lose\b/i, /\bsure thing\b/i,
  /\beasy money\b/i, /\bpump it\b/i, /\bsend it\b/i, /\bnot a scam\b/i, /\bbuy now\b/i, /\bape in\b/i, /\bdon[’']?t miss\b/i,
  /\bGuard\b/, /\bryntra arc\b/i, /\bStarknet\b/i,
];

/** What in a text breaks the voice: a banned word, an exclamation mark, an emoji. */
export function voiceFaults(text: string): string[] {
  const faults = FORBIDDEN.filter((re) => re.test(text)).map((re) => re.source);
  if (text.includes('!')) faults.push('exclamation mark');
  if (/\p{Extended_Pictographic}/u.test(text)) faults.push('emoji');
  return faults;
}

// ---------- Into the queue ----------

export type QueueItem = Readonly<{
  /** One per post: the same post is always one draft. */
  eventId: string;
  draftId: string;
  /** Its place in the thread; 0 is the first post, every other replies to the one before. */
  index: number;
  text: string;
  link: string | null;
  media: Media | null;
}>;

/**
 * A draft as the posts the CITY-3 queue holds. The queue's own kinds today are moments (launch, graduation, a big x,
 * an agent's find); taking these needs a `vision` kind there, a change of that queue's own path.
 */
export function asQueueItems(draft: VisionDraft): QueueItem[] {
  return draft.posts.map((p, index) => ({
    eventId: `vision:${draft.id}:${index}`,
    draftId: draft.id,
    index,
    text: p.text,
    link: p.text.match(/https:\/\/\S+/)?.[0] ?? null,
    media: p.media,
  }));
}

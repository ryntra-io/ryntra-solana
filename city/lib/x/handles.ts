/**
 * The X handles Ryntra may tag (CITY-41). A handle goes into a post only when a person checked it on its live profile
 * not long before, the partner really takes part in what the post shows, and a person approved that post. Everything
 * else is a candidate: written down so nobody has to guess it again, never inserted.
 *
 * How a handle gets checked: open https://x.com/<handle> and the partner's own site; the site links to that profile, the
 * profile is the partner's (name, site field, history), not a fan, a parody or a look-alike. Then set `status`,
 * `checkedAt`, `checkedBy` and `source` here in a PR. A check counts for `HANDLE_FRESH_DAYS`.
 */

/** What a partner does inside Ryntra; a tag needs the post to show one of these. */
export type Involvement =
  | 'own' // Ryntra's own accounts
  | 'launch' // a coin launched on the Meteora curve (Dynamic Bonding Curve)
  | 'graduate' // the curve filled and moved to a Meteora DAMM v2 pool
  | 'pool' // a Meteora pool in the Harbor
  | 'swap' // a buy or sell from a tower, routed by Jupiter
  | 'market-data' // prices and volumes the towers are built from (Jupiter)
  | 'wallet' // a wallet a person signs with
  | 'chain' // Solana itself: a network milestone, an ecosystem event
  | 'rpc' // the node provider the engine reads the chain through
  | 'treasury' // a crew's Squads multisig
  | 'perps' // perpetuals on Phoenix
  | 'phone'; // the Seeker phone

export type HandleStatus = 'verified' | 'needs-check';

export interface Handle {
  /** Our own key; posts name a partner as `{@key}`. */
  key: string;
  /** Without the @. For a `needs-check` row this is a candidate, not a fact. */
  handle: string;
  /** Who it is. */
  who: string;
  /** What they do, in one line. */
  does: string;
  /** Where they take part in Ryntra; a tag outside these is refused. */
  involvedIn: readonly Involvement[];
  status: HandleStatus;
  /** The day of the last check on the live profile (YYYY-MM-DD), or null. */
  checkedAt: string | null;
  /** Who checked it. */
  checkedBy: string | null;
  /** Where the handle comes from: the check itself, or the lead to check. */
  source: string;
  note?: string;
}

/** How long a check on the live profile counts: accounts get renamed, sold and spoofed. */
export const HANDLE_FRESH_DAYS = 30;

export const HANDLES: readonly Handle[] = [
  {
    key: 'ryntra',
    handle: 'Ryntra_io',
    who: 'Ryntra',
    does: 'Our company account; the posts of this playbook go out from it.',
    involvedIn: ['own'],
    status: 'verified',
    checkedAt: '2026-08-06',
    checkedBy: 'the account holder',
    source: 'the product\'s own pages name it (app/seo.ts TWITTER, the X links on /partners and /investors); the live profile read on 2026-08-06',
    note: 'Older than HANDLE_FRESH_DAYS: recheck the profile (bio, name) before the first post of this playbook.',
  },
  {
    key: 'meteora',
    handle: 'MeteoraAG',
    who: 'Meteora',
    does: 'Liquidity layer on Solana: the bonding curve every Ryntra launch starts on, and the DAMM v2 pool it moves to.',
    involvedIn: ['launch', 'graduate', 'pool'],
    status: 'needs-check',
    checkedAt: null,
    checkedBy: null,
    source: 'candidate: seen on its live profile (logged out) in the X research of 2026-10-27 (docs/research/x-marketing-2026-10-27/RESEARCH.md, 1.1); not yet checked against meteora.ag',
  },
  {
    key: 'jupiter',
    handle: 'JupiterExchange',
    who: 'Jupiter',
    does: 'Routes every buy and sell from a tower, and gives the market data the towers are built from.',
    involvedIn: ['swap', 'market-data'],
    status: 'needs-check',
    checkedAt: null,
    checkedBy: null,
    source: 'candidate: seen on its live profile (logged out) in the X research of 2026-10-27 (docs/research/x-marketing-2026-10-27/RESEARCH.md, 1.1); not yet checked against jup.ag',
  },
  {
    key: 'solana',
    handle: 'solana',
    who: 'Solana',
    does: 'The chain the whole city lives on.',
    involvedIn: ['chain'],
    status: 'needs-check',
    checkedAt: null,
    checkedBy: null,
    source: 'candidate: seen on its live profile (logged out) in the X research of 2026-10-27 (docs/research/x-marketing-2026-10-27/RESEARCH.md, 1.1); not yet checked against solana.com',
    note: 'Tag only for an ecosystem moment (a milestone, an event Ryntra takes part in), never on routine posts.',
  },
  {
    key: 'phantom',
    handle: 'phantom',
    who: 'Phantom',
    does: 'A wallet people sign their city trades and launches with (one of several: Solflare and Backpack work too).',
    involvedIn: ['wallet'],
    status: 'needs-check',
    checkedAt: null,
    checkedBy: null,
    source: 'candidate: seen on its live profile (logged out) in the X research of 2026-10-27 (docs/research/x-marketing-2026-10-27/RESEARCH.md, 1.1); not yet checked against phantom.com',
    note: 'Tag only in a post about Phantom specifically; a post about wallets in general tags no wallet.',
  },
  {
    key: 'helius',
    handle: 'heliuslabs',
    who: 'Helius',
    does: 'Solana RPC and data provider.',
    involvedIn: ['rpc'],
    status: 'needs-check',
    checkedAt: null,
    checkedBy: null,
    source: 'doubtful: on 2026-10-27 x.com/heliuslabs answered 404 and @helius_labs carried someone else’s bio (the X research, 1.3); the right handle is unknown',
    note: 'Do not tag until the handle is found through helius.dev. The city does not read the chain through Helius today (only lib/solana/seeker-genesis.server.ts uses it), so no city post qualifies yet.',
  },
  {
    key: 'squads',
    handle: 'SquadsProtocol',
    who: 'Squads',
    does: 'Multisig a crew can hold its treasury in.',
    involvedIn: ['treasury'],
    status: 'needs-check',
    checkedAt: null,
    checkedBy: null,
    source: 'candidate: no check recorded',
  },
  {
    key: 'phoenix',
    handle: 'PhoenixTrade',
    who: 'Phoenix',
    does: 'Perpetuals venue behind the Phoenix district.',
    involvedIn: ['perps'],
    status: 'needs-check',
    checkedAt: null,
    checkedBy: null,
    source: 'candidate: mentioned in repo docs only; no check recorded',
  },
  {
    key: 'solanamobile',
    handle: 'solanamobile',
    who: 'Solana Mobile',
    does: 'The Seeker phone.',
    involvedIn: ['phone'],
    status: 'needs-check',
    checkedAt: null,
    checkedBy: null,
    source: 'candidate: no check recorded',
  },
];

const DAY_MS = 86_400_000;

export function handleByKey(key: string, registry: readonly Handle[] = HANDLES): Handle | undefined {
  return registry.find((h) => h.key === key);
}

/** Why this handle may not go into a post on `at`, or null when it may. */
export function handleProblem(h: Handle, at: Date): string | null {
  if (h.status !== 'verified' || !h.checkedAt) return `@${h.handle} needs a check on its live profile`;
  const checked = Date.parse(`${h.checkedAt}T00:00:00Z`);
  if (!Number.isFinite(checked)) return `@${h.handle} has no readable check date`;
  if (checked > at.getTime()) return `@${h.handle} is checked in the future (${h.checkedAt})`;
  const days = Math.floor((at.getTime() - checked) / DAY_MS);
  if (days > HANDLE_FRESH_DAYS) return `@${h.handle} was checked ${days} days ago; recheck it (counts ${HANDLE_FRESH_DAYS})`;
  return null;
}

export interface MentionContext {
  /** When the post goes out. */
  at: Date;
  /** What the post shows: the partner must take part in at least one. */
  involvement: readonly Involvement[];
  /** The person who approved this post. No approval, no tag. */
  approvedBy: string | null | undefined;
  registry?: readonly Handle[];
}

export class HandleError extends Error {}

/** `@handle` for a partner key, or a HandleError saying why not. The only way a tag gets into a post. */
export function mention(key: string, ctx: MentionContext): string {
  const h = handleByKey(key, ctx.registry);
  if (!h) throw new HandleError(`no handle "${key}" in the registry`);
  if (!ctx.approvedBy?.trim()) throw new HandleError(`@${h.handle}: a tag goes only into a post a person approved`);
  const problem = handleProblem(h, ctx.at);
  if (problem) throw new HandleError(problem);
  if (!h.involvedIn.some((i) => ctx.involvement.includes(i))) {
    throw new HandleError(`@${h.handle} takes no part in what this post shows (${ctx.involvement.join(', ') || 'nothing'})`);
  }
  return `@${h.handle}`;
}

/** `{@key}` slots in a text. */
export const MENTION_SLOT = /\{@([a-z0-9_-]+)\}/g;

export function mentionKeys(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_SLOT)].map((m) => m[1]!))];
}

/** Every `{@key}` replaced by its checked handle; throws on the first one that may not go in. */
export function resolveMentions(text: string, ctx: MentionContext): string {
  return text.replace(MENTION_SLOT, (_, key: string) => mention(key, ctx));
}

/** Raw `@name` written straight into a text (outside a `{@key}` slot): never allowed, it skips every check. */
export function rawMentions(text: string): string[] {
  return [...text.replace(MENTION_SLOT, '').matchAll(/(^|[^A-Za-z0-9_.])@([A-Za-z0-9_]{1,15})\b/g)].map((m) => m[2]!);
}

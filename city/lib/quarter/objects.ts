import { KINDS } from '../../../lib/world/catalog.ts';
import { shownText } from '../../../lib/world/text-safety/clean.ts';
import { digits, num, wordsNow } from '../i18n/dict.ts';
import { pct, usd } from '../launch/format.ts';
import { formatUnits, ticker } from '../trade/format.ts';
import type { Signal } from './kit/blueprint.ts';
import type { BuildingKind, ChainLink, LinkKind } from './types.ts';
import { BUILD_WORDS, OBJECT_WORDS } from './words.ts';

/**
 * What a building on the engine shows: the object it is linked to, read from the engine or the chain each time, never
 * kept or counted by the world. The world holds only the link (`POST /api/world/link`); every figure here comes from
 * one read of the engine's own routes, with the moment that read was made, and a figure the engine did not give is
 * left out rather than shown as zero. Nothing here writes, signs or moves anything.
 *
 *   coin tower   → a coin from Ryntra Launch       /api/v1/launch/{mint} and …/stats
 *   harbor       → a Meteora DLMM or DAMM v2 position   /api/liquidity/positions?owner=
 *   workshop     → a Strategy Lab strategy, on paper    /api/strategy-lab/strategies?id=
 *   crew HQ      → an engine team                   /api/v1/teams/{id}
 *   garage       → an agent (the engine keeps no owner for one yet, so none links)
 *   oracle board → the paper prediction book        /api/predictions/account
 */

/** The buildings the city wires to the engine now, in the picker's order. The showcase comes with its own step. */
export const ENGINE_KINDS: readonly BuildingKind[] = ['coin_tower', 'harbor', 'workshop', 'crew_hq', 'garage', 'oracle'];

/** The engine object a building of this kind shows, or null for a building that shows none (the world's rule). */
export function linkKindOf(kind: BuildingKind): LinkKind | null {
  return ENGINE_KINDS.includes(kind) ? (KINDS[kind].links[0] ?? null) : null;
}

/** Whether a building of this kind stands on the engine. */
export const onEngine = (kind: BuildingKind): boolean => linkKindOf(kind) !== null;

const LINK_KINDS: readonly LinkKind[] = ['mint', 'lp_position', 'strategy', 'team', 'agent', 'prediction_book'];

/** What each link is called on a building's sheet, in the language on screen when it is read (`./words.ts`). */
export const OBJECT_NAMES: Readonly<Record<LinkKind, string>> = (() => {
  const out = {} as Record<LinkKind, string>;
  for (const kind of LINK_KINDS) Object.defineProperty(out, kind, { enumerable: true, get: () => wordsNow(OBJECT_WORDS).objectName(kind) });
  return out;
})();

const w = () => wordsNow(OBJECT_WORDS);

/** A stable key for a link: the same object reads once, whichever building shows it. */
export function linkKey(link: ChainLink): string {
  switch (link.kind) {
    case 'mint':
      return `mint:${link.mint}`;
    case 'lp_position':
      return `lp_position:${link.position}`;
    case 'strategy':
      return `strategy:${link.strategyId}`;
    case 'team':
      return `team:${link.teamId}`;
    case 'agent':
      return `agent:${link.agentId}`;
    case 'prediction_book':
      // The public read leaves the account out; whoever reads it reads their own book.
      return 'prediction_book';
  }
}

export type Figure = Readonly<{ label: string; value: string }>;

/** What a building's one action does: the city's own trade card for a coin, or the engine's page for the object. */
export type ObjectAction =
  | Readonly<{ kind: 'trade'; label: string; mint: string; symbol: string; name: string; icon: string | null }>
  | Readonly<{ kind: 'route'; label: string; href: string }>;

export type ObjectView = Readonly<{
  title: string;
  /** What the object is and where it lives. */
  line: string;
  figures: readonly Figure[];
  /** Where the figures were read. */
  source: string;
  /** When the engine or the chain said it (ISO). */
  at: string;
  signal: Signal;
  action: ObjectAction;
}>;

export type ObjectRead =
  | Readonly<{ state: 'ok'; view: ObjectView }>
  /** The read needs the owner's wallet connected (a position is read by its wallet). */
  | Readonly<{ state: 'wallet' }>
  /** The read needs the wallet's signed proof, or the account it signs in to. */
  | Readonly<{ state: 'proof' }>
  /** The engine answered: no such object for this person (gone, moved, or held by another wallet). */
  | Readonly<{ state: 'gone' }>
  /** The engine or the chain did not answer now. Never turned into a figure. */
  | Readonly<{ state: 'unavailable' }>;

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type Fetcher = (url: string, init?: Readonly<{ headers?: Record<string, string>; credentials?: 'same-origin'; cache?: 'no-store'; signal?: AbortSignal }>) => Promise<Answer>;

export type ReadContext = Readonly<{
  fetch: Fetcher;
  /** The connected wallet's address, when one is connected. */
  wallet: string | null;
  /** The resident's Ryntra account, when they signed in with a wallet. */
  accountId?: string | null;
  now?: () => number;
  /** How long one engine read may take before it counts as unanswered (default `READ_TIMEOUT_MS`). */
  timeoutMs?: number;
}>;

/** One engine read that has not answered by now is said as unavailable, so a building never waits forever. */
export const READ_TIMEOUT_MS = 10_000;

type Got = Readonly<{ status: number; body: Record<string, unknown> | null }>;

/**
 * One engine read: the status and the body, or status 0 when nothing answered — in time, too: a read (or its body)
 * still pending after the timeout is aborted and said as unanswered, whether or not the fetcher honours the signal.
 */
async function get(ctx: ReadContext, url: string): Promise<Got> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, ctx.timeoutMs ?? READ_TIMEOUT_MS);
  });
  try {
    const answer = await Promise.race([ctx.fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', signal: controller.signal }), timedOut]);
    let body: unknown = null;
    try {
      body = await Promise.race([answer.json(), timedOut]);
    } catch {
      // A body that never came, or came broken, is no body; a refusal still counts by its status.
      if (controller.signal.aborted) return { status: 0, body: null };
      body = null;
    }
    return { status: answer.ok ? 200 : answer.status, body: body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const iso = (v: unknown): string | null => (isStr(v) && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const nowIso = (ctx: ReadContext) => new Date(ctx.now?.() ?? Date.now()).toISOString();
/** The older of two moments: a view is only as fresh as its oldest figure. */
const older = (a: string, b: string | null) => (b && b < a ? b : a);

/** A count as the engine gives it: exact, or a floor said as one. */
function count(figure: unknown): string | null {
  const f = obj(figure);
  if (!f || !isNum(f.count)) return null;
  return `${f.atLeast === true ? '≥ ' : ''}${num(f.count)}`;
}

/** A refusal that means «prove who you are first». */
const needsProof = (status: number) => status === 401 || status === 403;

function classify(got: Got): ObjectRead | null {
  if (needsProof(got.status)) return { state: 'proof' };
  if (got.status === 404) return { state: 'gone' };
  if (got.status !== 200 || !got.body) return { state: 'unavailable' };
  return null;
}

/** A coin from Ryntra Launch: who holds it, what it is worth, how far along the curve or on the DEX. */
async function readCoin(mint: string, ctx: ReadContext): Promise<ObjectRead> {
  const [view, stats] = await Promise.all([get(ctx, `/api/v1/launch/${enc(mint)}`), get(ctx, `/api/v1/launch/${enc(mint)}/stats`)]);
  if (view.status === 404) return { state: 'gone' };
  const v = view.body;
  if (view.status !== 200 || !v || !isStr(v.name) || !isStr(v.symbol)) return { state: 'unavailable' };
  /* A creator's name and ticker, shown to every visitor of the quarter: somebody else's text (CITY-73). */
  const symbol = shownText(v.symbol, 'symbol', 32);
  if (!symbol) return { state: 'unavailable' };
  const name = shownText(v.name, 'name') ?? symbol;
  let at = iso(v.observedAt) ?? nowIso(ctx);
  const figures: Figure[] = [];
  const s = stats.status === 200 ? stats.body : null;
  if (s) {
    at = older(at, iso(s.observedAt));
    const holders = count(s.holders);
    if (holders) figures.push({ label: w().holders, value: holders });
    const cap = obj(s.marketCap);
    const pair = obj(s.pair);
    if (cap && isNum(cap.usd)) figures.push({ label: w().marketCap, value: usd(cap.usd) });
    else if (cap && isNum(cap.pair) && pair && isStr(pair.symbol)) figures.push({ label: w().marketCap, value: `${num(Number(cap.pair.toPrecision(3)))} ${pair.symbol}` });
    const day = obj(obj(s.volume)?.day);
    if (day && isStr(day.raw) && pair && isNum(pair.decimals) && isStr(pair.symbol)) figures.push({ label: w().volume24h, value: `${day.atLeast === true ? '≥ ' : ''}${digits(formatUnits(day.raw, pair.decimals))} ${pair.symbol}` });
  }
  if (v.migrated === true) figures.push({ label: w().curve, value: w().onDex });
  else if (isNum(v.progressBps)) figures.push({ label: w().curve, value: pct(v.progressBps) });
  return {
    state: 'ok',
    view: {
      title: name,
      line: w().launchLine(ticker(symbol)),
      figures,
      source: s ? w().launchSource : w().launchSourceNoHolders,
      at,
      signal: null,
      action: { kind: 'trade', label: w().trade(ticker(symbol)), mint, symbol, name, icon: isStr(v.image) ? v.image : null },
    },
  };
}

const VENUES: Record<string, string> = { 'meteora-dlmm': 'Meteora DLMM', 'meteora-damm2': 'Meteora DAMM v2' };

/** A pool position, read by its wallet from the programs' accounts: what it holds, its unclaimed fees, the range. */
async function readPosition(position: string, ctx: ReadContext): Promise<ObjectRead> {
  if (!ctx.wallet) return { state: 'wallet' };
  const got = await get(ctx, `/api/liquidity/positions?owner=${enc(ctx.wallet)}`);
  const refused = classify(got);
  if (refused) return refused.state === 'gone' ? { state: 'unavailable' } : refused;
  const list = Array.isArray(got.body!.positions) ? (got.body!.positions as unknown[]) : null;
  if (!list) return { state: 'unavailable' };
  const p = list.map(obj).find((x) => x?.address === position);
  if (!p) {
    // A venue that did not answer may be the one that holds it: unknown, not gone.
    const venues = obj(got.body!.venues);
    const allRead = venues ? Object.values(venues).every((x) => obj(x)?.ok === true) : false;
    return { state: allRead ? 'gone' : 'unavailable' };
  }
  const figures: Figure[] = [];
  if (isNum(p.valueUsd)) figures.push({ label: w().value, value: usd(p.valueUsd) });
  if (isNum(p.unclaimedUsd)) figures.push({ label: w().unclaimed, value: usd(p.unclaimedUsd) });
  const inRange = p.rangeState === 'in_range';
  if (p.rangeState === 'in_range' || p.rangeState === 'above' || p.rangeState === 'below') figures.push({ label: w().price, value: inRange ? w().inRange : w().outOfRange });
  const at = isNum(p.at) ? new Date(p.at).toISOString() : isNum(got.body!.at) ? new Date(got.body!.at as number).toISOString() : nowIso(ctx);
  return {
    state: 'ok',
    view: {
      title: isStr(p.name) ? p.name : w().poolPosition,
      line: VENUES[String(p.kind)] ?? 'Meteora',
      figures,
      source: isStr(p.pricesAt) ? w().meteoraSource : w().meteoraSourceNoUsd,
      at,
      signal: p.rangeState === undefined ? null : inRange ? 'value' : 'danger',
      action: { kind: 'route', label: w().openPool, href: '/?open=harbor' },
    },
  };
}

/** A strategy kept in Strategy Lab under the person's account: paper first, so its record is its age and its runs. */
async function readStrategy(strategyId: string, ctx: ReadContext): Promise<ObjectRead> {
  const got = await get(ctx, `/api/strategy-lab/strategies?id=${enc(strategyId)}&versionLimit=1&runLimit=100&proposalLimit=1`);
  const refused = classify(got);
  if (refused) return refused;
  const strategy = obj(got.body!.strategy);
  if (!strategy || !isStr(strategy.title)) return { state: 'unavailable' };
  const figures: Figure[] = [];
  if (Array.isArray(got.body!.runs)) figures.push({ label: w().paperRuns, value: got.body!.runs.length >= 100 ? '100+' : String(got.body!.runs.length) });
  const since = iso(strategy.createdAt);
  if (since) figures.push({ label: w().since, value: day(since) });
  const changed = iso(strategy.updatedAt);
  if (changed) figures.push({ label: w().lastChange, value: day(changed) });
  return {
    state: 'ok',
    view: {
      title: strategy.title,
      line: w().strategyLine,
      figures,
      source: 'Strategy Lab',
      at: nowIso(ctx),
      signal: null,
      action: { kind: 'route', label: w().openAgents, href: '/?open=agents' },
    },
  };
}

/** An engine team, as the proven wallet may read it: who is in it, the wallet's role, the treasury. */
async function readTeam(teamId: string, ctx: ReadContext): Promise<ObjectRead> {
  const got = await get(ctx, `/api/v1/teams/${enc(teamId)}`);
  const refused = classify(got);
  if (refused) return refused;
  const team = obj(got.body!.team);
  if (!team || !isStr(team.name)) return { state: 'unavailable' };
  const figures: Figure[] = [];
  if (Array.isArray(team.members)) figures.push({ label: w().members, value: String(team.members.filter((m) => obj(m)?.status === 'ACTIVE').length) });
  const you = obj(team.you);
  if (you && isStr(you.role)) figures.push({ label: w().yourRole, value: w().role(you.role) });
  figures.push({ label: w().treasury, value: isStr(team.treasury) ? 'Squads' : w().notLinkedYet });
  return {
    state: 'ok',
    view: {
      title: team.name,
      line: isStr(team.kind) ? w().teamLine(team.kind) : w().team,
      figures,
      source: w().teamsSource,
      at: nowIso(ctx),
      signal: null,
      action: { kind: 'route', label: w().openTeam, href: '/?open=agents' },
    },
  };
}

/** The paper prediction book: paper cash, open calls, and paper profit or loss — paper, never money. */
async function readPredictions(ctx: ReadContext): Promise<ObjectRead> {
  const got = await get(ctx, '/api/predictions/account');
  const refused = classify(got);
  if (refused) return refused;
  const balance = obj(got.body!.balance);
  // No paper account opened yet, or the venue did not answer.
  if (!balance) return obj(got.body!.link)?.state === 'active' ? { state: 'unavailable' } : { state: 'gone' };
  const figures: Figure[] = [];
  if (isNum(balance.cashBalance)) figures.push({ label: w().paperCash, value: usd(balance.cashBalance) });
  if (Array.isArray(got.body!.positions)) figures.push({ label: w().openCalls, value: String(got.body!.positions.length) });
  // The engine's own total; without it, its two figures side by side — the world never adds money up.
  const signed = (n: number) => `${n < 0 ? '−' : '+'}${usd(Math.abs(n))}`;
  const pnl = isNum(balance.earnings) ? balance.earnings : null;
  if (pnl !== null) figures.push({ label: w().paperPnl, value: signed(pnl) });
  else {
    if (isNum(balance.realizedPnl)) figures.push({ label: w().realized, value: signed(balance.realizedPnl) });
    if (isNum(balance.unrealizedPnl)) figures.push({ label: w().unrealized, value: signed(balance.unrealizedPnl) });
  }
  return {
    state: 'ok',
    view: {
      title: w().paperPredictions,
      line: w().predictionsLine,
      figures,
      source: w().predictionsSource,
      at: iso(got.body!.readAt) ?? nowIso(ctx),
      signal: pnl !== null && pnl > 0 ? 'value' : null,
      action: { kind: 'route', label: w().openPredictions, href: '/?open=oracle' },
    },
  };
}

/** Read the object behind a link, now. */
export async function readObject(link: ChainLink, ctx: ReadContext): Promise<ObjectRead> {
  switch (link.kind) {
    case 'mint':
      return readCoin(link.mint, ctx);
    case 'lp_position':
      return readPosition(link.position, ctx);
    case 'strategy':
      return readStrategy(link.strategyId, ctx);
    case 'team':
      return readTeam(link.teamId, ctx);
    case 'prediction_book':
      return readPredictions(ctx);
    case 'agent':
      // The engine keeps no owner for an agent yet; nothing to read that the world could vouch for.
      return { state: 'unavailable' };
  }
}

/** One of the person's own engine objects a building could show. */
export type Candidate = Readonly<{ link: ChainLink; title: string; line: string }>;

export type CandidateList =
  | Readonly<{ state: 'ok'; items: readonly Candidate[] }>
  | Readonly<{ state: 'wallet' }>
  | Readonly<{ state: 'proof' }>
  /** The engine cannot prove such an object is anyone's yet, so the world links none (an agent). */
  | Readonly<{ state: 'not_yet' }>
  | Readonly<{ state: 'unavailable' }>;

/** The person's own objects of the kind a building shows, from the engine: what they may link it to. */
export async function listMine(kind: BuildingKind, ctx: ReadContext): Promise<CandidateList> {
  switch (linkKindOf(kind)) {
    case 'mint': {
      if (!ctx.wallet) return { state: 'wallet' };
      const got = await get(ctx, `/api/v1/launch/creators/${enc(ctx.wallet)}`);
      if (got.status !== 200 || !got.body || !Array.isArray(got.body.launches)) return { state: 'unavailable' };
      // Only a launch this wallet signed as its creator: the world checks the same.
      const items = got.body.launches
        .map(obj)
        .filter((l): l is Record<string, unknown> => !!l && l.role === 'creator' && isStr(l.token) && isStr(l.symbol))
        .map((l) => ({ link: { kind: 'mint', mint: l.token as string } as ChainLink, title: isStr(l.name) ? l.name : ticker(l.symbol as string), line: w().launchLine(ticker(l.symbol as string)) }));
      return { state: 'ok', items };
    }
    case 'lp_position': {
      if (!ctx.wallet) return { state: 'wallet' };
      const got = await get(ctx, `/api/liquidity/positions?owner=${enc(ctx.wallet)}`);
      if (got.status !== 200 || !got.body || !Array.isArray(got.body.positions)) return { state: 'unavailable' };
      const items = got.body.positions
        .map(obj)
        .filter((p): p is Record<string, unknown> => !!p && isStr(p.address))
        .map((p) => ({ link: { kind: 'lp_position', position: p.address as string } as ChainLink, title: isStr(p.name) ? p.name : w().poolPosition, line: VENUES[String(p.kind)] ?? 'Meteora' }));
      return { state: 'ok', items };
    }
    case 'strategy': {
      const got = await get(ctx, '/api/strategy-lab/strategies?limit=50');
      if (needsProof(got.status)) return { state: 'proof' };
      if (got.status !== 200 || !got.body || !Array.isArray(got.body.strategies)) return { state: 'unavailable' };
      const items = got.body.strategies
        .map(obj)
        .filter((s): s is Record<string, unknown> => !!s && isStr(s.strategyId) && isStr(s.title))
        .map((s) => ({ link: { kind: 'strategy', strategyId: s.strategyId as string } as ChainLink, title: s.title as string, line: w().strategyLine }));
      return { state: 'ok', items };
    }
    case 'team': {
      if (!ctx.wallet) return { state: 'wallet' };
      const got = await get(ctx, '/api/v1/teams');
      if (needsProof(got.status)) return { state: 'proof' };
      if (got.status !== 200 || !got.body || !Array.isArray(got.body.teams)) return { state: 'unavailable' };
      // An invitation is not membership yet; the world links only a team the wallet is active in.
      const items = got.body.teams
        .map(obj)
        .filter((t): t is Record<string, unknown> => !!t && t.status === 'ACTIVE' && isStr(t.id) && isStr(t.name))
        .map((t) => ({ link: { kind: 'team', teamId: t.id as string } as ChainLink, title: t.name as string, line: isStr(t.kind) ? w().teamLine(t.kind) : w().team }));
      return { state: 'ok', items };
    }
    case 'prediction_book':
      // The book is the account's own: there is exactly one, and only an account has it.
      if (!ctx.accountId) return { state: 'proof' };
      return { state: 'ok', items: [{ link: { kind: 'prediction_book', accountId: ctx.accountId }, title: w().yourPaperPredictions, line: w().predictionsLine }] };
    case 'agent':
      return { state: 'not_yet' };
    default:
      return { state: 'not_yet' };
  }
}

/** A day, short and the same on every device: «12 Oct 2026». */
function day(at: string): string {
  return w().day(at);
}

/** How old a read is, the way the city says it, and in its shortest form for a sign; past five minutes it is delayed. */
export function freshness(at: string, now: number): Readonly<{ text: string; short: string; stale: boolean }> {
  const t = Date.parse(at);
  const x = w();
  if (!Number.isFinite(t)) return { text: x.timeUnknown, short: '?', stale: true };
  const s = Math.max(0, Math.round((now - t) / 1000));
  const stale = s > 300;
  if (s < 10) return { text: x.justNow, short: x.now, stale };
  if (s < 60) return { text: x.secondsAgo(s), short: x.secondsShort(s), stale };
  if (s < 3600) return { text: x.minutesAgo(Math.floor(s / 60)), short: x.minutesShort(Math.floor(s / 60)), stale };
  if (s < 86_400) return { text: x.hoursAgo(Math.floor(s / 3600)), short: x.hoursShort(Math.floor(s / 3600)), stale };
  return { text: x.daysAgo(Math.floor(s / 86_400)), short: x.daysShort(Math.floor(s / 86_400)), stale };
}

/** One plain sentence for a link the world refused. */
export function linkRefusalLine(code: string, reason: string | null): string {
  const x = w();
  const b = wordsNow(BUILD_WORDS);
  if (code === 'WALLET_REQUIRED') return x.signInToLink;
  if (code === 'LINK_TAKEN') return x.linkTaken;
  if (code === 'NOT_OWNER') return x.notOwner;
  if (code === 'LINK_REFUSED') {
    if (reason === 'not_yours') return x.notYours;
    if (reason === 'account_required') return x.signInFirst;
    if (reason === 'kind_mismatch') return x.kindMismatch;
    return x.cannotVouch;
  }
  if (code === 'VERSION_CONFLICT') return b.conflict;
  if (code === 'RATE_LIMITED') return b.tooMany;
  if (code === 'UNAVAILABLE' || code === 'OFFLINE') return b.outOfReach;
  return b.notSaved;
}

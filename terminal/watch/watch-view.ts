/**
 * «Watch» — the rules of the screen without React and without a fetch: what a pasted text means, the wallet's answer as
 * the page reads it, the trades of the wallets one watches as one feed, the list kept in this browser, the pace of the
 * reads, and an alert's level. Everything the engine says is read here as it is; nothing is invented, a figure it did
 * not give stays null.
 *
 * Reads only. Nothing here signs, sends or trades.
 */

/* ------------------------------------------------------------- addresses */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/* Inside a link an address stands between marks — `/`, `?`, `=`, `#` — never glued to a letter or a digit: `0x…` of another
   network is not one. */
const BASE58_IN = /(?:^|[^A-Za-z0-9])([1-9A-HJ-NP-Za-km-z]{32,44})(?![A-Za-z0-9])/;

export function isAddress(value: unknown): value is string {
  return typeof value === 'string' && BASE58.test(value);
}

/**
 * The address in what a person pasted: the address itself, or a link with one in it (an explorer's page, another
 * terminal's) — the first run of the address's alphabet as long as an address. Null for anything else.
 */
export function addressIn(text: string): string | null {
  const typed = text.trim();
  if (!typed) return null;
  if (BASE58.test(typed)) return typed;
  if (typed.length > 400) return null;
  const found = BASE58_IN.exec(typed);
  return found ? found[1]! : null;
}

/** A wallet short, as a trader reads it: the first four and the last four. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** The wallet's own page in the terminal. */
export const WALLET_PATH = '/wallet';
export const WATCH_PATH = '/watch';
export const walletHref = (address: string): string => `${WALLET_PATH}/${encodeURIComponent(address)}`;
export const coinPageHref = (mint: string): string => `/coin/${encodeURIComponent(mint)}`;
export const portfolioHref = (owner: string): string => `/portfolio?${new URLSearchParams({ owner })}`;

/** SOL's and USDC's own pictures, kept with the site: the logo routes answer nothing for money that is not a coin of the market. */
const STAPLE_LOGOS: Readonly<Record<string, string>> = {
  So11111111111111111111111111111111111111112: '/site/universe/SOL.png',
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: '/site/universe/USDC.png',
};

/**
 * A coin's logo through Ryntra's own logo routes: SOL's and USDC's kept with the site, the market's picture the engine
 * gave (through its proxy), the engine's logo by the address, the catalogue's; never a picture from elsewhere.
 */
export function logoOf(mint: string, icon: string | null): Readonly<{ src: string; also: readonly string[] }> {
  const market = `/api/icon/${encodeURIComponent(mint)}`;
  const spot = `/api/spot/icon?mint=${encodeURIComponent(mint)}`;
  const queue = icon && /^https:\/\//.test(icon) ? [`${spot}&u=${encodeURIComponent(icon)}`, market] : [market, spot];
  const staple = STAPLE_LOGOS[mint];
  return staple ? { src: staple, also: queue } : { src: queue[0]!, also: queue.slice(1) };
}

/** The market's picture of each coin a wallet traded, as its read gave it: what it holds is drawn by the same picture. */
export function tradeIcons(trades: readonly Readonly<{ mint: string; icon: string | null }>[]): ReadonlyMap<string, string> {
  const icons = new Map<string, string>();
  for (const trade of trades) if (trade.icon && !icons.has(trade.mint)) icons.set(trade.mint, trade.icon);
  return icons;
}

/* ------------------------------------------------------------------ time */

export type Ago = Readonly<{ unit: 's' | 'm' | 'h' | 'd'; n: number }>;

/** How long ago a moment in unix seconds was, short; null when the chain did not say. */
export function agoOf(atS: number | null, nowMs: number): Ago | null {
  if (atS === null || !Number.isFinite(atS)) return null;
  const s = Math.max(0, Math.round(nowMs / 1000 - atS));
  if (s < 60) return { unit: 's', n: s };
  if (s < 3_600) return { unit: 'm', n: Math.floor(s / 60) };
  if (s < 86_400) return { unit: 'h', n: Math.floor(s / 3_600) };
  return { unit: 'd', n: Math.floor(s / 86_400) };
}

/* ------------------------------------------------------- a wallet's read */

export type TradeQuote = 'SOL' | 'USDC' | 'USDT';
export type WalletLabel = 'creator' | 'sniper' | 'bundle';
export const WALLET_LABELS: readonly WalletLabel[] = ['creator', 'sniper', 'bundle'];

export type Trade = Readonly<{
  /** One trade of one wallet: its transaction, its coin and its side. */
  key: string;
  wallet: string;
  signature: string;
  at: number | null;
  side: 'buy' | 'sell';
  mint: string;
  symbol: string | null;
  icon: string | null;
  /** Whole coins. */
  tokens: number | null;
  quote: TradeQuote | null;
  /** In the quote's units: SOL, or dollars. */
  quoteAmount: number | null;
}>;

export type WalletResult = Readonly<{
  /** The result in SOL by the honest count; null when too little of the turnover is priced to call it. */
  result: number | null;
  /** What is known of it: the page's figure when no result is called, always with the share priced beside it. */
  known: number | null;
  realized: number | null;
  unrealized: number | null;
  /** The share of the turnover whose result is known, percent. */
  completenessPct: number | null;
  verdict: 'PLUS' | 'MINUS' | 'FLAT' | 'UNKNOWN' | 'EMPTY';
  /** The trades the result counts. */
  trades: number | null;
  /** Coins closed above their cost, and below. */
  wins: number;
  losses: number;
  /** A dollar leg was counted in SOL at SOL's price now. */
  approx: boolean;
}>;

export type WalletRead = Readonly<{
  wallet: string;
  readAt: string | null;
  /** The oldest transaction read, unix seconds; the result counts from it. */
  oldestAt: number | null;
  /** The read reached the wallet's very first transaction. */
  complete: boolean;
  /** Newest first. */
  trades: readonly Trade[];
  result: WalletResult;
  badges: Readonly<Record<WalletLabel, number>>;
  solUsd: number | null;
}>;

/** What the wallet's read answered: a wallet, a coin (the address is a token's), a text that is no address, too many reads, or nothing read. */
export type WalletAnswer =
  | Readonly<{ kind: 'wallet'; read: WalletRead }>
  | Readonly<{ kind: 'coin'; mint: string; symbol: string; creator: string | null; read: WalletRead | null }>
  | Readonly<{ kind: 'bad' }>
  | Readonly<{ kind: 'busy' }>
  | Readonly<{ kind: 'unread' }>;

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown, max = 64): string | null => (typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null);
const obj = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function tradeOf(raw: unknown, wallet: string): Trade | null {
  const row = obj(raw);
  if (!row) return null;
  const signature = text(row.signature, 120);
  const mint = text(row.mint);
  const side = row.side === 'buy' || row.side === 'sell' ? row.side : null;
  if (!signature || !mint || !isAddress(mint) || !side) return null;
  const decimals = num(row.decimals);
  const raw10 = typeof row.tokensRaw === 'string' && /^\d{1,40}$/.test(row.tokensRaw) ? Number(row.tokensRaw) : null;
  const quote = row.quote === 'SOL' || row.quote === 'USDC' || row.quote === 'USDT' ? row.quote : null;
  const quoteAmount = quote ? num(row.quoteAmount) : null;
  return {
    key: `${wallet}:${signature}:${mint}:${side}`,
    wallet,
    signature,
    at: num(row.at),
    side,
    mint,
    symbol: text(row.symbol, 24),
    icon: text(row.icon, 600),
    tokens: raw10 !== null && decimals !== null && decimals >= 0 && decimals <= 18 ? raw10 / 10 ** decimals : null,
    quote,
    quoteAmount: quoteAmount !== null && quoteAmount >= 0 ? quoteAmount : null,
  };
}

const VERDICTS = new Set(['PLUS', 'MINUS', 'FLAT', 'UNKNOWN', 'EMPTY']);

/** The engine's wallet view (`/api/wallet-watch/wallet`) as the screen reads it; null when it is not one. */
export function walletReadOf(raw: unknown): WalletRead | null {
  const view = obj(raw);
  const wallet = text(view?.wallet);
  if (!view || !wallet || !isAddress(wallet)) return null;
  const trades = (Array.isArray(view.trades) ? view.trades : []).map((row) => tradeOf(row, wallet)).filter((row): row is Trade => row !== null);
  const pnl = obj(view.pnl);
  const whole = obj(obj(obj(view.honest)?.pnl)?.whole);
  const verdict = typeof whole?.verdict === 'string' && VERDICTS.has(whole.verdict) ? (whole.verdict as WalletResult['verdict']) : 'UNKNOWN';
  const badges = obj(view.badges);
  return {
    wallet,
    readAt: text(view.readAt),
    oldestAt: num(view.oldestAt),
    complete: view.complete === true,
    trades,
    result: {
      result: num(whole?.result),
      known: num(whole?.known),
      realized: num(whole?.realized),
      unrealized: num(whole?.unrealized),
      completenessPct: num(whole?.completenessPct),
      verdict,
      trades: num(whole?.trades),
      wins: Math.max(0, num(pnl?.wins) ?? 0),
      losses: Math.max(0, num(pnl?.losses) ?? 0),
      approx: obj(view.honest)?.approx === true || pnl?.approx === true,
    },
    badges: { creator: Math.max(0, num(badges?.creator) ?? 0), sniper: Math.max(0, num(badges?.sniper) ?? 0), bundle: Math.max(0, num(badges?.bundle) ?? 0) },
    solUsd: num(view.solUsd),
  };
}

export type ResultShown = Readonly<{
  /** The page's one figure: the result where the engine calls one, else what is known of it; null — nothing is priced. */
  value: number | null;
  /** The share of the turnover priced, percent, beside a figure that is less than the whole; null — it is the whole. */
  priced: number | null;
}>;

/**
 * What a wallet's page shows as its result. The engine calls a result only when nearly all the turnover is priced; below
 * that the page shows what is known — the same sum the tiles «Closed» and «Still held» add up to — with the share priced
 * beside it, never a bare «—» over tiles that have figures. «—» only when nothing is priced.
 */
export function resultShown(result: WalletResult): ResultShown {
  const pct = result.completenessPct;
  const share = pct !== null && Math.round(pct) < 100 ? Math.max(0, pct) : null;
  if (result.result !== null) return { value: result.result, priced: share };
  if (result.known === null || pct === null || !(pct > 0)) return { value: null, priced: null };
  return { value: result.known, priced: share };
}

/** The share priced as the page says it: whole percent, «<1%» for a sliver — never «0%» beside a figure. */
export function shareText(pct: number): string {
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

/** The wallet's read as it came: its status and body. A text that is no address is a state of the page, not an error. */
export function answerOf(status: number, body: unknown): WalletAnswer {
  const data = obj(body);
  if (status === 400) return { kind: 'bad' };
  if (status === 429) return { kind: 'busy' };
  if (status !== 200 || !data || data.ok !== true) return { kind: 'unread' };
  const read = data.view ? walletReadOf(data.view) : null;
  const token = obj(data.token);
  const mint = text(token?.mint);
  if (token && mint && isAddress(mint)) {
    const creator = text(token.creator);
    return { kind: 'coin', mint, symbol: text(token.symbol, 24) ?? mint.slice(0, 4), creator: creator && isAddress(creator) ? creator : null, read };
  }
  return read ? { kind: 'wallet', read } : { kind: 'unread' };
}

/* ----------------------------------------------------------------- holds */

export type HoldRow = Readonly<{
  id: string;
  /** A coin's mint; null for a position that is not one coin (a pool, a stake, a deposit). */
  mint: string | null;
  symbol: string | null;
  /** A position's own name where it is not a coin. */
  label: string | null;
  /** Whole coins, where the source said. */
  amount: number | null;
  usd: number | null;
}>;

export type Holds = Readonly<{ usd: number | null; complete: boolean; rows: readonly HoldRow[]; more: number }>;

/** How many of the wallet's holdings the page lists; the rest are in the portfolio. */
export const HOLDS_SHOWN = 8;

/** The portfolio's read (`/api/v1/portfolio?owner=`) as the wallet's page lists it: the biggest first, what is borrowed apart. */
export function holdsOf(raw: unknown, owner: string): Holds | null {
  const body = obj(raw);
  if (!body || body.owner !== owner || !Array.isArray(body.positions)) return null;
  const rows: HoldRow[] = [];
  for (const item of body.positions) {
    const position = obj(item);
    if (!position || position.kind === 'borrow' || position.origin === 'projection' || position.state === 'unread') continue;
    const id = text(position.id, 160);
    if (!id) continue;
    const usd = num(obj(position.value)?.usd);
    const coin = position.kind === 'coin' || position.kind === 'lst';
    const held = coin ? (Array.isArray(position.tokens) ? position.tokens.map(obj).find((token) => token?.role === 'held') : null) : null;
    const mint = held && isAddress(held.mint) ? (held.mint as string) : null;
    const decimals = num(held?.decimals);
    const amountRaw = typeof held?.amountRaw === 'string' && /^\d{1,40}$/.test(held.amountRaw) ? Number(held.amountRaw) : null;
    rows.push({
      id,
      mint,
      symbol: text(held?.symbol, 24),
      label: coin ? null : (text(position.label, 80) ?? text(position.platform, 64)),
      amount: amountRaw !== null && decimals !== null ? amountRaw / 10 ** decimals : null,
      usd,
    });
  }
  rows.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const totals = obj(body.totals);
  return { usd: num(totals?.usd), complete: totals?.complete === true, rows: rows.slice(0, HOLDS_SHOWN), more: Math.max(0, rows.length - HOLDS_SHOWN) };
}

/* ------------------------------------------------------------------ feed */

export type Follow = Readonly<{ address: string; name: string | null; since: string }>;

export type FeedRow = Trade & Readonly<{ who: string }>;

/** How many trades the feed shows. */
export const FEED_SHOWN = 60;

/**
 * The trades of the wallets one watches as one feed, newest first: each with the name the person gave the wallet (or
 * its short form). A trade the chain gave no time stands after the timed ones; the same trade is shown once.
 */
export function feedOf(follows: readonly Follow[], reads: ReadonlyMap<string, WalletRead | null>, limit = FEED_SHOWN): FeedRow[] {
  const seen = new Set<string>();
  const rows: FeedRow[] = [];
  for (const follow of follows) {
    const read = reads.get(follow.address);
    if (!read) continue;
    for (const trade of read.trades) {
      if (seen.has(trade.key)) continue;
      seen.add(trade.key);
      rows.push({ ...trade, who: follow.name ?? shortAddress(follow.address) });
    }
  }
  return rows.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.key.localeCompare(b.key)).slice(0, limit);
}

/* ---------------------------------------------------------- the browser's list */

/** The list kept in this browser while no wallet keeps it. */
export const LOCAL_KEY = 'ryntra.watch.wallets.v1';
/** As many as the engine keeps for one wallet. */
export const FOLLOW_LIMIT = 20;
export const NAME_MAX = 32;

/** A name as the person typed it: trimmed, at most 32 letters; nothing is no name. */
export function nameOf(typed: string | null | undefined): string | null {
  const name = (typed ?? '').replace(/\s+/g, ' ').trim();
  return name ? [...name].slice(0, NAME_MAX).join('') : null;
}

/** The browser's list as kept: valid rows only, each wallet once, at most twenty. */
export function localListOf(raw: string | null): Follow[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: Follow[] = [];
  for (const item of parsed) {
    const row = obj(item);
    if (!row || !isAddress(row.address) || seen.has(row.address)) continue;
    seen.add(row.address);
    out.push({ address: row.address, name: nameOf(typeof row.name === 'string' ? row.name : null), since: typeof row.since === 'string' ? row.since : new Date(0).toISOString() });
    if (out.length >= FOLLOW_LIMIT) break;
  }
  return out;
}

export type ListChange = Readonly<{ ok: true; list: Follow[] }> | Readonly<{ ok: false; code: 'LIMIT' }>;

/** A wallet added on top; one already there keeps its place and takes the new name, if one was given. */
export function listAdd(list: readonly Follow[], address: string, name: string | null, nowIso: string): ListChange {
  const at = list.findIndex((row) => row.address === address);
  if (at >= 0) return { ok: true, list: list.map((row, index) => (index === at && name ? { ...row, name } : row)) };
  if (list.length >= FOLLOW_LIMIT) return { ok: false, code: 'LIMIT' };
  return { ok: true, list: [{ address, name, since: nowIso }, ...list] };
}

export function listRemove(list: readonly Follow[], address: string): Follow[] {
  return list.filter((row) => row.address !== address);
}

export function listRename(list: readonly Follow[], address: string, name: string | null): Follow[] {
  return list.map((row) => (row.address === address ? { ...row, name } : row));
}

/** The engine's list (`/api/wallet-watch`) as the screen keeps it. */
export function serverListOf(raw: unknown): Follow[] | null {
  const body = obj(raw);
  if (!body || body.ok !== true || !Array.isArray(body.wallets)) return null;
  return localListOf(JSON.stringify(body.wallets));
}

/** The browser's wallets the engine's list does not hold yet, in order, as many as it has room for. */
export function toMove(local: readonly Follow[], server: readonly Follow[]): Follow[] {
  const held = new Set(server.map((row) => row.address));
  return local.filter((row) => !held.has(row.address)).slice(0, Math.max(0, FOLLOW_LIMIT - server.length));
}

/* ------------------------------------------------------------ the reads' pace */

/**
 * The wallet's read is public and counted per visitor — twenty a minute. The screen keeps under it: a few at once,
 * then one every few seconds; a wallet is not read again sooner than its freshness; a refusal rests the reads.
 */
export const PACE = { burst: 5, everyMs: 4_500, restMs: 30_000 } as const;

export type Pace = Readonly<{ tokens: number; at: number; restUntil: number }>;

export const PACE_START: Pace = { tokens: PACE.burst, at: 0, restUntil: 0 };

/** The bucket refilled to now. */
function filled(pace: Pace, now: number): Pace {
  if (pace.at === 0) return { ...pace, at: now };
  const gained = Math.floor((now - pace.at) / PACE.everyMs);
  if (gained <= 0) return pace;
  return { ...pace, tokens: Math.min(PACE.burst, pace.tokens + gained), at: pace.at + gained * PACE.everyMs };
}

/** Whether a read may start now, and the pace after it; `wait` — how long until the next may. */
export function takeRead(pace: Pace, now: number): Readonly<{ ok: boolean; pace: Pace; wait: number }> {
  if (now < pace.restUntil) return { ok: false, pace, wait: pace.restUntil - now };
  const next = filled(pace, now);
  if (next.tokens >= 1) return { ok: true, pace: { ...next, tokens: next.tokens - 1 }, wait: 0 };
  return { ok: false, pace: next, wait: Math.max(1, next.at + PACE.everyMs - now) };
}

/** A refusal: no read for a while, and the bucket empty after it. */
export function restPace(now: number): Pace {
  return { tokens: 0, at: now + PACE.restMs, restUntil: now + PACE.restMs };
}

/** Which wallet to read next: the one asked first whose last read is oldest past its freshness; null — none is due. */
export function nextDue(asked: readonly string[], lastAt: ReadonlyMap<string, number>, freshMs: ReadonlyMap<string, number>, busy: ReadonlySet<string>, now: number): string | null {
  let best: string | null = null;
  let bestAt = Infinity;
  for (const address of asked) {
    if (busy.has(address)) continue;
    const at = lastAt.get(address) ?? 0;
    if (now - at < (freshMs.get(address) ?? 60_000)) continue;
    if (at < bestAt) {
      best = address;
      bestAt = at;
    }
  }
  return best;
}

/* ----------------------------------------------------------------- alerts */

export type AlertBasis = 'price' | 'cap';

/** A level the person typed: digits and one decimal mark; null for anything else or nothing above zero. */
export function levelOf(typed: string): number | null {
  const plain = typed.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(plain)) return null;
  const value = Number(plain);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export type AlertRule = Readonly<{ kind: 'price'; direction: 'above' | 'below'; level: number }>;

export type RuleOutcome = Readonly<{ ok: true; rule: AlertRule }> | Readonly<{ ok: false; code: 'LEVEL' | 'NOW' | 'SAME' }>;

/**
 * The alert's rule: the price crossing a level. The direction is where the level stands from now — above it rings on
 * the way up, below it on the way down. A cap is watched through the price: with the coins in circulation now, a cap
 * of X is a price of X × price ÷ cap.
 */
export function ruleFor(basis: AlertBasis, level: number | null, now: Readonly<{ price: number | null; cap: number | null }>): RuleOutcome {
  if (level === null || !(level > 0)) return { ok: false, code: 'LEVEL' };
  const price = now.price !== null && now.price > 0 ? now.price : null;
  const cap = now.cap !== null && now.cap > 0 ? now.cap : null;
  if (price === null || (basis === 'cap' && cap === null)) return { ok: false, code: 'NOW' };
  const current = basis === 'cap' ? cap! : price;
  if (Math.abs(level - current) / current < 0.001) return { ok: false, code: 'SAME' };
  const priceLevel = basis === 'cap' ? (level * price) / cap! : level;
  const rounded = Number(priceLevel.toPrecision(6));
  if (!(rounded > 0) || rounded > 1e12) return { ok: false, code: 'LEVEL' };
  return { ok: true, rule: { kind: 'price', direction: level > current ? 'above' : 'below', level: rounded } };
}

/** What the browser remembers of an alert set by a cap, so its row says the cap the person typed. */
export const ALERT_NOTES_KEY = 'ryntra.watch.alerts.v1';
export type AlertNote = Readonly<{ basis: 'cap'; cap: number; level: number }>;

export function alertNotesOf(raw: string | null): Record<string, AlertNote> {
  if (!raw) return {};
  try {
    const parsed = obj(JSON.parse(raw));
    const out: Record<string, AlertNote> = {};
    for (const [id, value] of Object.entries(parsed ?? {})) {
      const note = obj(value);
      const cap = num(note?.cap);
      const level = num(note?.level);
      if (/^wch_[0-9a-f]{24}$/.test(id) && note?.basis === 'cap' && cap !== null && cap > 0 && level !== null && level > 0) out[id] = { basis: 'cap', cap, level };
    }
    return out;
  } catch {
    return {};
  }
}

export type AlertState = 'armed' | 'rang' | 'cooling' | 'unread' | 'learning' | 'paused';

export type AlertRow = Readonly<{
  id: string;
  mint: string;
  symbol: string;
  /** The rule when it is a price crossing; null for the watches set elsewhere (a move, a volume, a liquidity). */
  price: Readonly<{ direction: 'above' | 'below'; level: number }> | null;
  /** The engine's own words for any other rule. */
  ruleText: string;
  state: AlertState;
  createdAt: string;
}>;

export type AlertsRead = Readonly<{
  rows: readonly AlertRow[];
  free: number;
  left: number;
  channels: Readonly<{ telegram: boolean; push: boolean }>;
  perHour: number;
}>;

const ALERT_STATES = new Set(['armed', 'rang', 'cooling', 'unread', 'learning', 'paused']);

/** The person's watches (`/api/v1/assistant/watches`) as the screen lists them. */
export function alertsOf(raw: unknown): AlertsRead | null {
  const body = obj(raw);
  if (!body || !Array.isArray(body.watches)) return null;
  const rows: AlertRow[] = [];
  for (const item of body.watches) {
    const watch = obj(item);
    const id = text(watch?.id);
    const mint = text(watch?.mint);
    if (!watch || !id || !/^wch_[0-9a-f]{24}$/.test(id) || !mint || !isAddress(mint)) continue;
    const rule = obj(watch.rule);
    const level = num(rule?.level);
    const said = rule?.direction;
    const direction = said === 'above' || said === 'below' ? said : null;
    const price: AlertRow['price'] = rule?.kind === 'price' && direction !== null && level !== null ? { direction, level } : null;
    const nowState = text(obj(watch.now)?.state);
    rows.push({
      id,
      mint,
      symbol: text(watch.symbol, 32) ?? mint.slice(0, 4),
      price,
      ruleText: text(watch.ruleText, 120) ?? '',
      state: watch.status === 'paused' ? 'paused' : nowState && ALERT_STATES.has(nowState) ? (nowState as AlertState) : 'unread',
      createdAt: text(watch.createdAt) ?? '',
    });
  }
  const limit = obj(body.limit);
  const channels = obj(body.channels);
  return {
    rows: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    free: Math.max(0, num(limit?.free) ?? 3),
    left: Math.max(0, num(limit?.left) ?? 0),
    channels: { telegram: channels?.telegram === true, push: channels?.push === true },
    perHour: Math.max(1, num(body.deliveriesPerHour) ?? 20),
  };
}

/** Why the engine refused an alert, in the screen's terms. */
export type AlertRefusal = 'proof' | 'limit' | 'coin' | 'price' | 'same' | 'failed';

export function refusalOf(status: number, body: unknown): AlertRefusal {
  const code = text(obj(obj(body)?.error)?.code);
  if (status === 401 || code === 'UNAUTHORIZED') return 'proof';
  if (code === 'WATCH_LIMIT_REACHED') return 'limit';
  if (code === 'ASSET_UNCONFIRMED') return 'coin';
  if (code === 'PRICE_UNAVAILABLE') return 'price';
  if (code === 'VALIDATION_ERROR') return 'same';
  return 'failed';
}

/** A coin of the market for the alert's field: by its ticker first, then by its name; an address is the coin itself. */
export type CoinPick = Readonly<{ mint: string; symbol: string; name: string; icon: string | null }>;

export function coinsMatching(coins: readonly Readonly<{ id: string; symbol: string; name: string; icon: string | null }>[], typed: string, limit = 6): CoinPick[] {
  const query = typed.trim().replace(/^\$/, '').toLowerCase();
  if (!query) return [];
  const starts: CoinPick[] = [];
  const contains: CoinPick[] = [];
  for (const coin of coins) {
    if (!isAddress(coin.id)) continue;
    const pick = { mint: coin.id, symbol: coin.symbol, name: coin.name, icon: coin.icon };
    const symbol = coin.symbol.toLowerCase();
    if (symbol === query || symbol.startsWith(query)) starts.push(pick);
    else if (coin.name.toLowerCase().includes(query)) contains.push(pick);
  }
  starts.sort((a, b) => Number(b.symbol.toLowerCase() === query) - Number(a.symbol.toLowerCase() === query));
  return [...starts, ...contains].slice(0, limit);
}

/** The coin's market read (`/api/spot/market?mint=`): its ticker, name, logo, price and cap; null when it is none. */
export type CoinNow = Readonly<{ mint: string; symbol: string; name: string; icon: string | null; price: number | null; cap: number | null }>;

export function coinNowOf(raw: unknown, mint: string): CoinNow | null {
  const market = obj(obj(raw)?.market);
  if (!market || market.mint !== mint) return null;
  const price = num(market.price);
  const cap = num(market.marketCapUsd);
  return {
    mint,
    symbol: text(market.symbol, 24) ?? mint.slice(0, 4),
    name: text(market.name, 64) ?? '',
    icon: text(market.icon, 600),
    price: price !== null && price > 0 ? price : null,
    cap: cap !== null && cap > 0 ? cap : null,
  };
}

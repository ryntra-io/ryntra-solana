import type { PositionView } from '../../../lib/liquidity/catalog/positions.ts';
import { langNow } from '../i18n/lang.ts';
import type { Note } from '../notify/gate.ts';
import { notify } from '../notify/store.ts';
import { useWallet, type Holdings } from '../trade/wallet.ts';
import { EARN_LOANS, EARN_OPEN } from './flag.ts';
import { LST_BY_MINT, SOL_MINT } from './lst.ts';
import { dividendTells, earnNoteText, loanTells, rangeTells, weekendKey, weekendTell, type EarnEvent, type LoanGrade, type LoanRead, type Locale, type RangeRead, type StockHeld } from './notes.ts';
import { useEarn } from './open.ts';
import { MAX_STOCK_MINTS, type ScaledConfig } from './stocks.ts';
import { useEarnData } from './store.ts';

/**
 * Earn's notes in the city (CITY-100): what the city reads of the connected wallet — its pool positions (SOL-2b's read,
 * through Earn's store, which the window shares), the stocks it holds (the Scaled UI multipliers) — judged by
 * `notes.ts` and told through the notification centre (`notify()`, CITY-87), where the person chose: a banner, the
 * computer, or nowhere. Loan health joins once Earn reads a loan (`EARN_LOANS`).
 *
 * What was told is kept on this device per wallet, so a reload never tells it twice: a position out of range is told
 * once until it is back in range; a dividend date, a dividend added and a weekend once each.
 *
 * While Ryntra is open and in view the source reads now and then by itself — positions every five minutes for a wallet
 * that has some, every half hour for one that has none; the stocks once a visit and then hourly while Earn's window is
 * closed. It also asks Ryntra's server to watch the wallet (`POST /api/city/earn/notes`) once it has something in Earn,
 * so the phone and a connected Telegram hear of it with Ryntra closed — only under the wallet's proof, which the source
 * never asks the wallet for by itself.
 *
 * Reads and tells. Signs, sends and trades nothing.
 */

/** A wallet with positions is read this often; one without, every {@link POSITIONS_NONE_MS}. */
export const POSITIONS_MS = 5 * 60_000;
export const POSITIONS_NONE_MS = 30 * 60_000;
/** The first read after a wallet connects waits for the city's own first reads. */
export const FIRST_READ_MS = 15_000;
/** The stocks are read again this often while Earn's window is closed; a read that failed, after {@link STOCKS_RETRY_MS}. */
export const STOCKS_MS = 60 * 60_000;
export const STOCKS_RETRY_MS = 10 * 60_000;
/** How often the source looks at the clock (the weekend comes by time) and at what is due. */
export const TICK_MS = 60_000;
/** A registration the server refused for want of the wallet's proof is tried again no sooner than this. */
export const REGISTER_RETRY_MS = 2 * 60_000;
const REGISTER_FAILED_MS = 10 * 60_000;

/** Dollars are no stock; SOL and the LSTs are Earn's own. */
const NOT_STOCKS: ReadonlySet<string> = new Set([SOL_MINT, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', ...LST_BY_MINT.keys()]);

export type Register = 'ok' | 'unauthorized' | 'failed';

export type StorageLike = Readonly<{ getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }>;

export type EarnNotesEnv = Readonly<{
  say: (note: Note) => unknown;
  now: () => number;
  storage: () => StorageLike | null;
  visible: () => boolean;
  /** Asks Ryntra's server to watch the wallet for the phone and Telegram. */
  register: (owner: string, locale: Locale) => Promise<Register>;
  /** The wallet's loans, once Earn reads them (E10); null — none read. */
  readLoans: (owner: string) => Promise<readonly LoanRead[] | null>;
}>;

export const TOLD_KEY = 'ryntra.city.earn.told.v1:';
const KEEP_TOLD = 64;

/** What this device told a wallet: the positions told out of range, the dividend dates and weekends told, the loans' grades. */
export type Told = Readonly<{ out: readonly string[]; keys: readonly string[]; loans: Readonly<Record<string, LoanGrade>> }>;

const NONE: Told = { out: [], keys: [], loans: {} };
const GRADES: ReadonlySet<string> = new Set(['ok', 'watch', 'danger']);

export function readTold(raw: unknown): Told {
  if (!raw || typeof raw !== 'object') return NONE;
  const v = raw as Record<string, unknown>;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && s.length <= 200) : []);
  const loans: Record<string, LoanGrade> = {};
  if (v.loans && typeof v.loans === 'object') for (const [id, grade] of Object.entries(v.loans as Record<string, unknown>)) if (typeof grade === 'string' && GRADES.has(grade)) loans[id] = grade as LoanGrade;
  return { out: strings(v.out).slice(0, KEEP_TOLD), keys: strings(v.keys).slice(-KEEP_TOLD), loans };
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The production line to the server: the wallet's own session proves it; the page never asks the wallet here. */
export async function registerOnServer(owner: string, locale: Locale): Promise<Register> {
  try {
    const answer = await fetch('/api/city/earn/notes', {
      method: 'POST',
      headers: { 'X-Ryntra-API': '1', accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ owner, locale }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (answer.status === 401 || answer.status === 403) return 'unauthorized';
    return answer.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

let env: EarnNotesEnv = {
  say: notify,
  now: () => Date.now(),
  storage: browserStorage,
  visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  register: registerOnServer,
  readLoans: async () => null,
};

export function setEarnNotesEnv(next: Partial<EarnNotesEnv>): void {
  env = { ...env, ...next };
}

function toldOf(owner: string): Told {
  try {
    const raw = env.storage()?.getItem(TOLD_KEY + owner);
    return raw ? readTold(JSON.parse(raw)) : NONE;
  } catch {
    return NONE;
  }
}

function keepTold(owner: string, told: Told): void {
  try {
    env.storage()?.setItem(TOLD_KEY + owner, JSON.stringify({ out: told.out.slice(0, KEEP_TOLD), keys: told.keys.slice(-KEEP_TOLD), loans: told.loans }));
  } catch {
    // Without storage a reload may tell it again; nothing worse.
  }
}

const shortMint = (mint: string) => `${mint.slice(0, 4)}…`;

/** A pool position as the note names it: «JitoSOL–SOL». */
export function pairOf(view: PositionView): string {
  return `${view.x.symbol || shortMint(view.x.mint)}–${view.y.symbol || shortMint(view.y.mint)}`;
}

export function rangeReads(views: readonly PositionView[]): RangeRead[] {
  return views.map((view) => ({ address: view.address, pair: pairOf(view), inRange: view.rangeState === 'in_range' }));
}

/** The mints that may be stocks: the wallet's coins and the sides of its pools, past SOL, the LSTs and dollars. */
export function stockCandidates(holdings: Holdings | null, views: readonly PositionView[]): string[] {
  const out = new Set<string>();
  for (const mint of holdings?.tokens.keys() ?? []) if (!NOT_STOCKS.has(mint)) out.add(mint);
  for (const view of views) for (const side of [view.x, view.y]) if (!NOT_STOCKS.has(side.mint)) out.add(side.mint);
  return [...out].sort().slice(0, MAX_STOCK_MINTS);
}

/** The stocks held, with their tickers, and the tickers of every stock the wallet holds or pools. */
export function stocksOf(configs: readonly ScaledConfig[], holdings: Holdings | null, views: readonly PositionView[]): Readonly<{ held: StockHeld[]; exposed: string[] }> {
  const held: StockHeld[] = [];
  const exposed: string[] = [];
  for (const config of configs) {
    const side = views.flatMap((view) => [view.x, view.y]).find((s) => s.mint === config.mint && s.amount > 0);
    const balance = holdings?.tokens.get(config.mint);
    const ticker = holdings?.names?.get(config.mint)?.symbol || side?.symbol || shortMint(config.mint);
    const raw = balance && /^\d+$/.test(balance.spendableRaw) ? BigInt(balance.spendableRaw) : 0n;
    if (raw > 0n && balance) held.push({ mint: config.mint, ticker, raw, decimals: balance.decimals });
    if (raw > 0n || side) exposed.push(ticker);
  }
  return { held, exposed };
}

/** Starts Earn's notes in the city; returns the way to stop them. Nothing starts where Earn is closed. */
export function startEarnNotes(): () => void {
  if (!EARN_OPEN) return () => undefined;
  let owner: string | null = null;
  let since = 0;
  let positionsAsked = 0;
  let stocksAsked = 0;
  let stocksKey: string | null = null;
  let registered: string | null = null;
  let registerAt = 0;
  let registerWait = 0;
  let loans: readonly LoanRead[] | null = null;
  let loansAsked = 0;
  let stopped = false;
  let first: ReturnType<typeof setTimeout> | null = null;

  const say = (event: EarnEvent) => {
    const text = earnNoteText(event, langNow());
    env.say({ kind: event.kind, title: text.title, line: text.line || null });
  };

  const views = (who: string): readonly PositionView[] | null => {
    const positions = useEarnData.getState().positions;
    return positions && positions.owner === who && positions.value.status === 'ready' ? positions.value.value : null;
  };
  const configs = (who: string): readonly ScaledConfig[] | null => {
    const stocks = useEarnData.getState().stocks;
    return stocks && stocks.owner === who && stocks.value.status === 'ready' ? stocks.value.value : null;
  };
  const holdingsOf = (who: string): Holdings | null => {
    const holdings = useWallet.getState().holdings;
    return holdings && holdings.owner === who ? holdings : null;
  };

  /** Everything known now, judged; what is new is told and kept. */
  const judge = () => {
    if (stopped || !owner) return;
    const who = owner;
    const now = env.now();
    let told = toldOf(who);
    const tells: EarnEvent[] = [];
    const pools = views(who);
    if (pools) {
      const range = rangeTells(new Set(told.out), rangeReads(pools));
      tells.push(...range.tell);
      told = { ...told, out: range.out };
    }
    const stocks = configs(who);
    const holdings = holdingsOf(who);
    let exposed = 0;
    if (stocks) {
      const mine = stocksOf(stocks, holdings, pools ?? []);
      exposed = mine.exposed.length;
      for (const event of dividendTells(stocks, mine.held, now)) if (!told.keys.includes(event.id)) tells.push(event);
      const weekend = weekendTell(now, mine.exposed);
      if (weekend && !told.keys.includes(weekend.id)) tells.push(weekend);
    }
    if (EARN_LOANS && loans) {
      const graded = loanTells(told.loans, loans, weekendKey(now) !== null);
      tells.push(...graded.tell);
      told = { ...told, loans: graded.grades };
    }
    const keys = tells.filter((event) => event.kind !== 'range' && event.kind !== 'loan').map((event) => event.id);
    keepTold(who, { ...told, keys: [...told.keys, ...keys] });
    for (const event of tells) say(event);
    // Something in Earn: Ryntra's server watches it too, for the phone and Telegram.
    if ((pools?.length ?? 0) > 0 || exposed > 0 || (loans?.length ?? 0) > 0) void register(who);
  };

  const register = async (who: string) => {
    const locale = langNow();
    const key = `${who}:${locale}`;
    const now = env.now();
    if (registered === key || now - registerAt < registerWait) return;
    registerAt = now;
    registerWait = REGISTER_RETRY_MS;
    const answer = await env.register(who, locale);
    if (owner !== who) return;
    if (answer === 'ok') registered = key;
    else registerWait = answer === 'unauthorized' ? REGISTER_RETRY_MS : REGISTER_FAILED_MS;
  };

  /** What is due now: the positions, the stocks, the loans — each through the store the window shares. */
  const due = () => {
    if (stopped || !owner || !env.visible()) return;
    const who = owner;
    const now = env.now();
    if (now - since < FIRST_READ_MS) return;
    const data = useEarnData.getState();
    const positions = data.positions;
    const read = positions && positions.owner === who ? positions.value : null;
    const last = read?.status === 'ready' ? read.at : positionsAsked;
    const every = read?.status === 'ready' && read.value.length === 0 ? POSITIONS_NONE_MS : POSITIONS_MS;
    if (read?.status !== 'loading' && (positionsAsked === 0 || now - Math.max(last, positionsAsked) >= every)) {
      positionsAsked = now;
      void data.loadPositions(who);
    }
    const holdings = holdingsOf(who);
    if (holdings) {
      const candidates = stockCandidates(holdings, views(who) ?? []);
      const key = candidates.join(',');
      const stocks = data.stocks?.owner === who ? data.stocks.value : null;
      // A read the window made is this source's too: the window reads the stocks itself while it is open.
      if (stocks?.status === 'ready' && stocksKey === null) {
        stocksKey = key;
        stocksAsked = stocks.at;
      }
      const open = useEarn.getState().open;
      const ask =
        candidates.length > 0 &&
        stocks?.status !== 'loading' &&
        (stocks?.status === 'ready' ? !open && (key !== stocksKey || now - stocksAsked >= STOCKS_MS) : stocksAsked === 0 || now - stocksAsked >= STOCKS_RETRY_MS);
      if (ask) {
        stocksAsked = now;
        stocksKey = key;
        void data.loadStocks(who, candidates);
      }
    }
    if (EARN_LOANS && (loansAsked === 0 || now - loansAsked >= POSITIONS_MS)) {
      loansAsked = now;
      void env.readLoans(who).then((read) => {
        if (owner !== who) return;
        loans = read;
        judge();
      });
    }
    judge();
  };

  const follow = (next: string | null) => {
    if (next === owner) return;
    owner = next;
    since = env.now();
    positionsAsked = 0;
    stocksAsked = 0;
    stocksKey = null;
    registered = null;
    registerAt = 0;
    registerWait = 0;
    loans = null;
    loansAsked = 0;
    if (first) clearTimeout(first);
    first = next ? setTimeout(due, FIRST_READ_MS + 50) : null;
  };

  follow(useWallet.getState().connection?.address ?? null);
  const offWallet = useWallet.subscribe((st, before) => {
    if (st.connection?.address !== before.connection?.address) follow(st.connection?.address ?? null);
    else if (st.holdings !== before.holdings) due();
  });
  const offData = useEarnData.subscribe((st, before) => {
    if (st.positions !== before.positions || st.stocks !== before.stocks) judge();
  });
  const timer = setInterval(due, TICK_MS);
  const onVisible = () => env.visible() && due();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    if (first) clearTimeout(first);
    offWallet();
    offData();
    clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}

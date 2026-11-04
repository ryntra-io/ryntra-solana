import { useBeacons } from '../beacon/store.ts';
import { healthOf } from '../exchange/account.ts';
import { EXCHANGE_SHOWN } from '../exchange/flag.ts';
import { useExchange } from '../exchange/store.ts';
import { EX_HEALTH } from '../exchange/words.ts';
import { useFeed } from '../feed/store.ts';
import { retell } from '../feed/words.ts';
import { wordsNow } from '../i18n/dict.ts';
import { langNow } from '../i18n/lang.ts';
import { useSpot } from '../trade/spot-store.ts';
import { useTrade } from '../trade/store.ts';
import type { Note } from './gate.ts';
import { notify } from './store.ts';
import { NOTES } from './words.ts';

/**
 * What the city already knows, said through the centre (CITY-87). Each source tells only what changed after the page
 * opened — the first read of a visit is taken as known, never told:
 *
 * - the live feed (CITY-66): a new event of a market kind the person sends to the computer;
 * - the trade window: a trade that settled or did not go through;
 * - the stops (CITY-149): a stop the engine or the city found reached;
 * - the beacons (CITY-72): a beacon that fired;
 * - the Exchange (Phoenix's margin view): the account entering the critical grade or liquidation — Guard's, never off,
 *   and told even when it was already there at the first read.
 *
 * It listens to the stores that already read; the one read of its own is the futures account, through the Exchange's
 * own `loadAccount`, once a minute when nothing else read it that minute (every ten minutes for a wallet with nothing on
 * Phoenix).
 */

const risky = (state: string | null): boolean => state === 'critical' || state === 'liquidation';

/** How often the centre reads the futures account while its window is closed, and the first read after the page opens. */
const WATCH_MS = 60_000;
const WATCH_FIRST_MS = 8_000;
/** A wallet the last read found nothing on Phoenix for is read again every this many minutes. */
const WATCH_NONE_EVERY = 10;
/** A read this much younger than a minute counts as this minute's. */
const WATCH_SLACK_MS = 5_000;

const ticker = (symbol: string): string => (symbol ? symbol.replace(/^\$/, '') : '');

/** Starts every source; returns the way to stop them all. */
export function startNotifySources(say: (note: Note) => unknown = notify): () => void {
  const offs: (() => void)[] = [];

  // The feed: new events after the visit's first ones.
  let seen: number | null = null;
  const firstFeed = useFeed.getState().memory.events;
  if (firstFeed.length) seen = Math.max(...firstFeed.map((event) => event.id));
  offs.push(
    useFeed.subscribe((st, before) => {
      if (st.memory === before.memory) return;
      const events = st.memory.events;
      if (!events.length) return;
      const newest = Math.max(...events.map((event) => event.id));
      if (seen === null) {
        seen = newest;
        return;
      }
      const fresh = events.filter((event) => event.id > (seen ?? 0)).sort((a, b) => a.id - b.id);
      seen = Math.max(seen, newest);
      const lang = langNow();
      for (const event of fresh) {
        say({ kind: event.kind, title: retell(event.title, lang), line: retell(event.line, lang), tower: 'tower' in event.target ? event.target.tower : null });
      }
    }),
  );

  // The trade window: settled, or not.
  offs.push(
    useTrade.subscribe((st, before) => {
      if (st.phase === before.phase) return;
      const onScreen = st.open && (typeof document === 'undefined' || document.visibilityState === 'visible');
      const w = wordsNow(NOTES);
      if (st.phase === 'done' && st.done) {
        const coin = ticker(st.done.tower.symbol);
        say({ kind: 'trades', title: st.done.side === 'buy' ? w.bought(coin) : w.sold(coin), tower: st.done.tower.mint, onScreen });
      } else if (st.phase === 'failed' && st.tower) {
        say({ kind: 'trades', title: w.tradeFailed(ticker(st.tower.symbol)), tower: st.tower.mint, onScreen });
      }
    }),
  );

  // The stops: one that turned reached.
  const reached = new Set(useSpot.getState().stops.filter((stop) => stop.state === 'reached').map((stop) => stop.id));
  let stopsOwner = useSpot.getState().stops[0]?.owner ?? null;
  offs.push(
    useSpot.subscribe((st, before) => {
      if (st.stops === before.stops) return;
      const owner = st.stops[0]?.owner ?? null;
      // Another wallet's list arriving is its first read: known, not news.
      const first = owner !== stopsOwner;
      stopsOwner = owner ?? stopsOwner;
      for (const stop of st.stops) {
        if (stop.state !== 'reached' || reached.has(stop.id)) continue;
        reached.add(stop.id);
        if (first) continue;
        const w = wordsNow(NOTES);
        say({ kind: 'stops', title: w.stopReached(ticker(stop.base.symbol)), line: w.stopLine, tower: stop.base.mint });
      }
    }),
  );

  // The beacons: one that fired after the page opened, once per firing — a list read again (the server's, another
  // account's) brings back firings that are not news.
  const opened = Date.now();
  const told = new Set<string>();
  offs.push(
    useBeacons.subscribe((st, before) => {
      if (st.states === before.states && st.rules === before.rules) return;
      for (const rule of st.rules) {
        const firedAt = st.states[rule.id]?.state.firedAt ?? null;
        if (firedAt === null || firedAt < opened || st.glow.get(rule.mint) !== 'lit') continue;
        const key = `${rule.id}:${firedAt}`;
        if (told.has(key)) continue;
        told.add(key);
        say({ kind: 'beacons', title: wordsNow(NOTES).beaconLit(ticker(rule.symbol)), tower: rule.mint });
      }
    }),
  );

  // The Exchange: Phoenix's grade crossing into critical or liquidation — Guard's, never off. Only where the Exchange
  // stands at all. The window reads the account while it is open; with it closed the centre reads it now and then while
  // the page is in view, so the risk is told while Ryntra is open, not only while its window is.
  if (EXCHANGE_SHOWN) {
    let grade: string | null = healthOf(useExchange.getState().account, Date.now())?.state ?? null;
    offs.push(
      useExchange.subscribe((st, before) => {
        if (st.account === before.account) return;
        const next = healthOf(st.account, Date.now())?.state ?? null;
        if (next !== null && next !== 'stale' && risky(next) && !risky(grade)) {
          const health = wordsNow(EX_HEALTH);
          say({ kind: 'liquidation', title: wordsNow(NOTES).liquidation, line: next === 'liquidation' ? health.liquidationLine : health.criticalLine });
        }
        // A stale read keeps the grade Phoenix last gave; it does not reset the crossing.
        if (next !== 'stale') grade = next;
      }),
    );
    // A wallet with nothing on Phoenix is asked again only now and then; one with an account, every minute — in a tab
    // behind too (a browser keeps a once-a-minute timer going there), so the computer's notification can tell it.
    let idle = 0;
    const watch = () => {
      const ex = useExchange.getState();
      if (!ex.owner) return;
      // Whoever read the account last minute — the window while it is on screen — has read it: the centre reads only
      // when nobody did (the window closed, behind another tab, under a run or the quarter, out on its own page).
      const at = ex.account.status === 'ready' ? ex.account.at : null;
      if (at !== null && Date.now() - at < WATCH_MS - WATCH_SLACK_MS) return;
      if (ex.account.value?.state === 'none' && ex.account.value.wallet === ex.owner && ++idle % WATCH_NONE_EVERY !== 0) return;
      void ex.loadAccount();
    };
    const first = setTimeout(watch, WATCH_FIRST_MS);
    const timer = setInterval(watch, WATCH_MS);
    offs.push(() => {
      clearTimeout(first);
      clearInterval(timer);
    });
  }

  return () => offs.forEach((off) => off());
}

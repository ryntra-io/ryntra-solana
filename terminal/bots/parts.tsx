'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { lookalikeOf } from '@/lib/world/text-safety/lookalike';
import { bookOf } from '@/city/lib/command/parse';
import { sayCoins } from '@/city/lib/crew/say';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Tower } from '@/city/lib/market/types';
import { spotIcon } from '@/city/lib/search/rank';
import { searchCatalog } from '@/city/lib/search/sources';
import { SOL } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { MenuIcon } from '@/terminal/shell/menu-icons';
import { useDismiss } from '@/terminal/shell/useDismiss';
import { useMarket } from '@/terminal/shell/useMarket';
import { AmountField, Chip, CoinLogo, Icon, Info, Kick, Panel, Search, Title, coinIcon, priceText } from '@/terminal/ui';
import type { BotId } from './kinds';
import { coinChoices, searchable, type ChoiceCoin } from './rows';
import { BOTS } from './words';
import b from './bots.module.css';

/** A coin a bot works on, as its form keeps it; a coin found in the catalogue keeps its name and Jupiter's word on it. */
export type PickedCoin = Readonly<{ mint: string; symbol: string; icon: string | null; name?: string; verified?: boolean | null }>;

/** SOL as a bot shows it before the market's read of it comes: its own logo, its price «—» until then. */
export const SOL_COIN: PickedCoin = { mint: SOL.mint, symbol: SOL.symbol, icon: SOL.icon ?? null, name: SOL.name ?? undefined, verified: true };

export const coinOf = (tower: Pick<Tower, 'id' | 'symbol' | 'icon'> & Partial<Pick<Tower, 'name' | 'verified'>>): PickedCoin => ({ mint: tower.id, symbol: tower.symbol, icon: coinIcon(tower), name: tower.name, verified: tower.verified });

/** The bot's mark, the menu's own line icon in its square; lit for a bot at work. */
export function BotBadge({ id, on = false }: { id: BotId; on?: boolean }) {
  return (
    <span className={b.badge} data-on={on ? '' : undefined}>
      <MenuIcon name={id} />
    </span>
  );
}

/** A bot's head in its panel: its mark, a quiet word over its name, what it does, and its «i». */
export function BotHead({ id, kick, info }: { id: BotId; kick: string; info?: ReactNode }) {
  const w = useWords(BOTS);
  return (
    <div className={b.head}>
      <BotBadge id={id} on />
      <div className={b.headWords}>
        <Kick>{kick}</Kick>
        <Title as="h2" className={b.headTitle}>
          {w[id]}
        </Title>
        <span className={b.job}>{w[`${id}Job`]}</span>
      </div>
      {info}
    </div>
  );
}

/** The «i» of a bot: a few short lines of how it works. */
export function HowInfo({ lines }: { lines: readonly string[] }) {
  const w = useWords(BOTS);
  return (
    <Info label={w.how}>
      <span className={b.facts}>
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    </Info>
  );
}

/** One line a step answered: plain, or warm when it is a «no». Its place is kept, so its coming never moves the action. */
export function Note({ children, warn = false }: { children?: ReactNode; warn?: boolean }) {
  return (
    <p className={`${b.note} ${b.slot}`} data-tone={warn ? 'warn' : undefined} role="status">
      {children}
    </p>
  );
}

/** The market's towers by mint. */
export function useTowers(): ReadonlyMap<string, Tower> {
  const towers = useMarket().towers;
  return useMemo(() => new Map(towers.map((tower) => [tower.id, tower])), [towers]);
}

/** How long typing rests before the engine's search over every Solana coin is asked. */
const FIND_WAIT_MS = 250;

/**
 * What the engine's search over every Solana coin (Jupiter's catalogue, `GET /api/solana/tokens/search`) finds for the
 * words typed or an address pasted — read only, once the typing rests; nothing found, or no answer, is no more coins.
 * A coin the catalogue marks suspicious is not offered, nor one whose ticker passes for a known coin it is not (the
 * city's own guard, `lib/world/text-safety/lookalike.ts`): a bot places real orders on the coin it is given.
 * `waiting` — the words typed are still being asked.
 */
function useFound(query: string, on: boolean): Readonly<{ list: readonly ChoiceCoin[]; waiting: boolean }> {
  const [found, setFound] = useState<Readonly<{ query: string; list: readonly ChoiceCoin[] }>>({ query: '', list: [] });
  const asked = on && searchable(query);
  useEffect(() => {
    if (!asked) return;
    const control = new AbortController();
    const timer = setTimeout(() => {
      searchCatalog(query.trim().replace(/^\$/u, ''), { signal: control.signal })
        .then((rows) => {
          const list = rows.flatMap((row): ChoiceCoin[] =>
            row.symbol && !row.isSuspicious && lookalikeOf(row.symbol, row.mint) === null
              ? [{ id: row.mint, symbol: row.symbol, name: row.name ?? row.symbol, icon: spotIcon(row.mint, row.icon), verified: row.isVerified === true, volume24h: 0 }]
              : [],
          );
          setFound({ query, list });
        })
        .catch(() => {
          if (!control.signal.aborted) setFound({ query, list: [] });
        });
    }, FIND_WAIT_MS);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [query, asked]);
  const answered = found.query === query;
  return { list: on && answered ? found.list : [], waiting: asked && !answered };
}

/**
 * The coins at hand for a bot: SOL, then JUP and MET (decision 108: an example names no other coin), then the coins of
 * the person's own wallet, then the whole market by its day's trading. A search finds any coin of the market — and,
 * with `anyCoin`, any coin of Solana by its ticker, its name or its address.
 */
function useCoinChoices(query: string, anyCoin: boolean): Readonly<{ choices: PickedCoin[]; waiting: boolean }> {
  const towers = useMarket().towers;
  const owner = useWallet((st) => st.connection?.address ?? null);
  const held = useWallet((st) => (st.holdings && st.holdings.owner === owner ? st.holdings.tokens : null));
  const { list: found, waiting } = useFound(query, anyCoin);
  const choices = useMemo(() => {
    const first = [SOL.mint, ...sayCoins(bookOf(towers)).map((coin) => coin.mint)];
    const inMarket = new Map(towers.map((tower) => [tower.id, tower]));
    // A market's coin wears the market's logo; a coin the catalogue found wears the catalogue's, through the engine.
    return coinChoices({ market: towers, first, held: held ? [...held.keys()] : [], found, query }).map((one): PickedCoin => {
      const tower = inMarket.get(one.id);
      return tower ? coinOf(tower) : { mint: one.id, symbol: one.symbol, icon: one.icon, name: one.name, verified: one.verified };
    });
  }, [towers, held, found, query]);
  return { choices, waiting };
}

/**
 * The rows of the list on screen ask for their marks, as they come into view — the first ones as it opens, the next
 * ones as it scrolls — a beat after the list rests. A row asks once while the list is open.
 */
function useShownRows(list: RefObject<HTMLDivElement | null>, open: boolean, key: string, onShown: ((mints: readonly string[]) => void) | undefined): void {
  const heard = useRef(onShown);
  useEffect(() => {
    heard.current = onShown;
  });
  useEffect(() => {
    const root = list.current;
    if (!open || !root || !heard.current || typeof IntersectionObserver === 'undefined') return;
    const asked = new Set<string>();
    let waiting: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const mint = (entry.target as HTMLElement).dataset.mint;
          if (!entry.isIntersecting || !mint || asked.has(mint)) continue;
          asked.add(mint);
          waiting.push(mint);
        }
        if (!waiting.length) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          const now = waiting;
          waiting = [];
          heard.current?.(now);
        }, FIND_WAIT_MS);
      },
      { root },
    );
    for (const row of root.querySelectorAll<HTMLElement>('[data-mint]')) watch.observe(row);
    return () => {
      watch.disconnect();
      clearTimeout(timer);
    };
  }, [list, open, key]);
}

/**
 * The amount and the coin, in one field: the amount in dollars, the coin on the field's own pill — a tap opens the list
 * under it (a search and the coins at hand), a tap on a coin picks it. The list closes on a tap outside and on Escape.
 *
 * `anyCoin` lets the search reach every Solana coin, not only the market's: a bot whose engine works on any coin with a
 * pool (the grid, the ladder) takes it. `mark` puts a word beside a coin of the list (where the bot would work on it),
 * and `onShown` hears which coins the list shows first, so the screen can read their marks.
 */
export function CoinAmount({
  coin,
  amount,
  onAmount,
  onCoin,
  aside,
  anyCoin = false,
  mark,
  onShown,
  openAsk = 0,
}: {
  coin: PickedCoin | null;
  amount: string;
  onAmount: (text: string) => void;
  onCoin: (coin: PickedCoin) => void;
  aside?: string;
  anyCoin?: boolean;
  mark?: (mint: string) => ReactNode;
  onShown?: (mints: readonly string[]) => void;
  /** Each new number opens the list from outside the field — the chart's head, «Choose another coin». */
  openAsk?: number;
}) {
  const w = useWords(BOTS);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!openAsk) return;
    setOpen(true);
    box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [openAsk]);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const listBox = useRef<HTMLDivElement>(null);
  const { choices, waiting } = useCoinChoices(query, anyCoin);
  const towers = useTowers();
  const lang = useLang();
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  useDismiss(open, box, close);
  // The rows on screen ask for their marks as they come into view.
  useShownRows(listBox, open && Boolean(onShown), choices.map((one) => one.mint).join(','), onShown);
  return (
    <div ref={box} className={b.fieldBox}>
      <AmountField
        label={w.amountUsd}
        aside={aside}
        value={amount}
        onChange={onAmount}
        asset={coin ? { symbol: coin.symbol, icon: coin.icon } : { symbol: '—', icon: null }}
        onAsset={() => setOpen((was) => !was)}
        assetLabel={w.pickCoin}
      />
      {open ? (
        <div className={b.menu} role="dialog" aria-label={w.pickCoin}>
          <Search value={query} onChange={setQuery} placeholder={anyCoin ? w.searchAnyCoin : w.searchCoin} />
          <div ref={listBox} className={b.menuList} role="menu" aria-label={w.coinLabel}>
            {choices.length ? (
              choices.map((one) => {
                const tower = towers.get(one.mint);
                return (
                  <button
                    key={one.mint}
                    type="button"
                    role="menuitemradio"
                    aria-checked={one.mint === coin?.mint}
                    className={b.menuRow}
                    onClick={() => {
                      onCoin(one);
                      close();
                    }}
                    data-bot-coin={one.symbol}
                    data-mint={one.mint}
                  >
                    <CoinLogo src={one.icon} symbol={one.symbol} size="s" />
                    <span className={b.menuName}>{one.symbol}</span>
                    {one.verified === false ? (
                      <span className={b.unchecked} role="img" aria-label={w.unchecked} title={w.unchecked}>
                        <Icon name="help" size="s" />
                      </span>
                    ) : null}
                    {mark ? mark(one.mint) : null}
                    {tower && Number.isFinite(tower.price) && tower.price > 0 ? <span className={b.menuAside}>{priceText(tower.price, lang)}</span> : null}
                  </button>
                );
              })
            ) : (
              <p className={b.menuEmpty}>{!query.trim() ? w.listWait : waiting ? w.searching : w.noMatch}</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** «My bots» of one kind: a panel with its name, the working count, and the rows or one quiet line. */
export function MinePanel({ working, empty, children, note }: { working: number; empty: string | null; children?: ReactNode; note?: ReactNode }) {
  const w = useWords(BOTS);
  return (
    // None at work: the name and its one line stand in one row — no wide strip of empty panel (QA 20.11, вада 110).
    <Panel pad="none" label={w.mine} className={empty && !note ? b.mineQuiet : undefined}>
      <div className={b.mineHead}>
        <Title as="h2" className={b.mineTitle}>
          {w.mine}
        </Title>
        {working ? (
          <Chip tone="ok" dot>
            {w.workingCount(String(working))}
          </Chip>
        ) : null}
      </div>
      {empty ? <p className={b.empty}>{empty}</p> : children}
      {note ? <div className={b.notePad}>{note}</div> : null}
    </Panel>
  );
}

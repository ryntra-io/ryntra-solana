'use client';

import { useMemo } from 'react';

import { useWords } from '@/city/lib/i18n/dict';
import { mapCatalogPage } from '@/lib/liquidity/catalog/model';
import type { ProPoolRow } from '@/lib/pro-pools/model';
import type { StoreStates } from '@/lib/pro-pools/store';
import type { PoolFacts } from '@/lib/stocks/pool-facts';
import fixture from '@/lib/stocks/pools-shelf.fixture.json';
import { noShelf, proDaysOf, shelfOf, type PoolsShelf, type ShelfLadder } from '@/lib/stocks/pools-shelf';
import { lookalikeOf } from '@/lib/world/text-safety/lookalike';
import { Kick, Page, PageHead, Panel } from '@/terminal/ui';
import { StockCoinFacts } from '../StockCoinFacts';
import { StockPoolsShelf } from './StockPoolsShelf';
import { STOCK_POOLS_STAND } from './words';
import s from './pools.module.css';

const HOUR = 60 * 60_000;
const BACKPACK = { id: 'backpack', label: 'Backpack Securities' } as const;
const XSTOCKS = { id: 'xstocks', label: 'xStocks · Backed Finance' } as const;
/** Both deposits offered, as with the terminal's switches open: the stand shows every row's action. */
const OPEN = { dlmm: true, pro: true } as const;

type Recorded = Readonly<{
  mint: string;
  symbol: string;
  dlmmPage: unknown;
  pro: readonly unknown[];
  states: Readonly<{ step: StoreStates['step']; pools: readonly Readonly<{ pool: string; writtenAgo: number; summary: unknown }>[] }> | null;
  ladder: ShelfLadder | null;
}>;

/** The shelf the server would answer on the recorded reads (`lib/stocks/pools-shelf.fixture.json`), built the same way. */
function shelfFrom(stock: Recorded, now: number): PoolsShelf {
  const pro = stock.pro as readonly ProPoolRow[];
  const states = stock.states ? ({ step: stock.states.step, pools: new Map(stock.states.pools.map((state) => [state.pool, state])) } as unknown as StoreStates) : null;
  return shelfOf({
    mint: stock.mint,
    symbol: stock.symbol,
    nowMs: now,
    dlmm: mapCatalogPage(stock.dlmmPage, 'dlmm')?.pools ?? null,
    pro,
    proDays: proDaysOf(states, pro.map((row) => row.address)),
    ladder: stock.ladder,
    deposits: { dlmm: true, pro: true },
    passesFor: (symbol, mint) => lookalikeOf(symbol, mint) !== null,
  });
}

function standFacts(now: number): Readonly<{ ant: PoolFacts; tsla: PoolFacts }> {
  return {
    ant: {
      mint: fixture.ant.mint,
      isStock: true,
      issuer: BACKPACK,
      session: 'open',
      nextChangeAt: new Date(now + 3 * HOUR).toISOString(),
      dividendGuard: null,
      termsUrl: 'https://learn.backpack.exchange/articles/what-is-backpack-securities',
      kind: 'listed-equity',
      powers: { take: true, pause: true, paused: false },
      listed: null,
    },
    tsla: {
      mint: fixture.tsla.mint,
      isStock: true,
      issuer: XSTOCKS,
      session: 'closed',
      nextChangeAt: new Date(now + 14 * HOUR).toISOString(),
      dividendGuard: null,
      termsUrl: 'https://assets.backed.fi/legal-documentation',
      kind: 'listed-equity',
      powers: null,
      listed: null,
    },
  };
}

/**
 * The stand's page for the eyes: a stock's pools on the recorded reads — ANT with the exchange open (five
 * DLMM pools and the DLMM Pro pool of its limits), TSLAx with the exchange closed (two DLMM pools), ANT as the coin's
 * column shows it (under the stock's facts, so without its own line), and a stock with no pools (nothing). Each case
 * stands in a column as wide as the coin's ticket. A stand only.
 */
export function StockPoolsStand() {
  const w = useWords(STOCK_POOLS_STAND);
  const now = useMemo(() => Date.now(), []);
  const ant = useMemo(() => shelfFrom(fixture.ant as Recorded, now), [now]);
  const tsla = useMemo(() => shelfFrom(fixture.tsla as Recorded, now), [now]);
  const facts = useMemo(() => standFacts(now), [now]);
  const empty = useMemo(() => ({ ...noShelf(fixture.tsla.mint, now), isStock: true, symbol: 'TSLAx' }), [now]);
  return (
    <Page>
      <PageHead title={w.title} />
      <div className={s.stand}>
        <Panel gap={12} label={w.open('ANT')}>
          <Kick>{w.open('ANT')}</Kick>
          <span className={s.standCase} data-case="ant-open">
            <StockPoolsShelf mint={ant.mint} shelf={ant} stockFacts={facts.ant} screen={OPEN} />
          </span>
        </Panel>
        <Panel gap={12} label={w.closed('TSLAx')}>
          <Kick>{w.closed('TSLAx')}</Kick>
          <span className={s.standCase} data-case="tsla-closed">
            <StockPoolsShelf mint={tsla.mint} shelf={tsla} stockFacts={facts.tsla} screen={OPEN} />
          </span>
        </Panel>
        <Panel gap={12} label={w.coin('ANT')}>
          <Kick>{w.coin('ANT')}</Kick>
          <span className={s.standCase} data-case="ant-coin">
            <StockCoinFacts mint={ant.mint} facts={facts.ant} />
            <StockPoolsShelf mint={ant.mint} shelf={ant} stockFacts={facts.ant} screen={OPEN} facts={false} />
          </span>
        </Panel>
        <Panel gap={12} label={w.none}>
          <Kick>{w.none}</Kick>
          <span className={s.standCase} data-case="none">
            <StockPoolsShelf mint={empty.mint} shelf={empty} stockFacts={facts.tsla} screen={OPEN} />
          </span>
        </Panel>
      </div>
    </Page>
  );
}

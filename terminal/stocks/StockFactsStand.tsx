'use client';

import { useMemo } from 'react';

import { useWords } from '@/city/lib/i18n/dict';
import type { PoolFacts } from '@/lib/stocks/pool-facts';
import { Action, ActionBody, Kick, Page, PageHead, Panel } from '@/terminal/ui';
import { StockPoolFacts } from './StockPoolFacts';
import { useOffHoursRisk } from './useStockPoolFacts';
import { STOCK_FACTS_STAND } from './words';
import s from './stocks.module.css';

const HOUR = 60 * 60_000;
const TSLA = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';
const SPCX = 'Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8';
const SOL = 'So11111111111111111111111111111111111111112';
const TERMS = 'https://assets.backed.fi/legal-documentation';
const ISSUER = { id: 'xstocks', label: 'xStocks · Backed Finance' } as const;

/** The states the eyes check, on the clock of the moment the page opens. */
function standFacts(now: number): Readonly<{ open: PoolFacts; closed: PoolFacts; none: PoolFacts }> {
  const step = now + 30 * HOUR;
  return {
    open: { mint: TSLA, isStock: true, issuer: ISSUER, session: 'open', nextChangeAt: new Date(now + 4 * HOUR).toISOString(), dividendGuard: null, termsUrl: TERMS },
    closed: {
      mint: SPCX,
      isStock: true,
      issuer: ISSUER,
      session: 'closed',
      nextChangeAt: new Date(now + 62 * HOUR).toISOString(),
      dividendGuard: { from: new Date(step - 24 * HOUR).toISOString(), to: new Date(step + 15 * 60_000).toISOString(), step: 'dividend', now: false },
      termsUrl: TERMS,
    },
    none: { mint: SOL, isStock: false, issuer: null, session: 'unknown', nextChangeAt: null, dividendGuard: null, termsUrl: null },
  };
}

/**
 * The stand's page for the eyes: the detail where the pool page will mount it — in the left column of three
 * pools (the exchange open, the exchange closed with a dividend guard ahead, a coin that is no stock) and above the
 * action of a ticket with the risk line — plus one live read of a stock through the public door. A stand only.
 */
export function StockFactsStand() {
  const w = useWords(STOCK_FACTS_STAND);
  const facts = useMemo(() => standFacts(Date.now()), []);
  const risk = useOffHoursRisk(facts.closed.mint, facts.closed);
  return (
    <Page>
      <PageHead title={w.title} />
      <ActionBody
        side={
          <Panel tone="hi" gap={14}>
            <Kick>{w.pool('SPCXx')}</Kick>
            <StockPoolFacts mint={facts.closed.mint} facts={facts.closed} />
            {risk ? <p className={s.risk}>{risk}</p> : null}
            <Action>{w.action}</Action>
          </Panel>
        }
      >
        <div className={s.stand}>
          <Panel gap={12} label={w.pool('TSLAx')}>
            <Kick>{w.pool('TSLAx')}</Kick>
            <StockPoolFacts mint={facts.open.mint} facts={facts.open} />
          </Panel>
          <Panel gap={12} label={w.pool('SPCXx')}>
            <Kick>{w.pool('SPCXx')}</Kick>
            <StockPoolFacts mint={facts.closed.mint} facts={facts.closed} />
          </Panel>
          <Panel gap={12} label={w.pool('SOL')}>
            <Kick>{w.pool('SOL')}</Kick>
            <StockPoolFacts mint={facts.none.mint} facts={facts.none} />
          </Panel>
          <Panel gap={12} label={w.live}>
            <Kick>{w.live}</Kick>
            <StockPoolFacts mint={TSLA} />
          </Panel>
        </div>
      </ActionBody>
    </Page>
  );
}

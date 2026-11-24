'use client';

import { useMemo } from 'react';

import { useWords } from '@/city/lib/i18n/dict';
import type { PoolFacts } from '@/lib/stocks/pool-facts';
import { Action, ActionBody, CoinLogo, Kick, Page, PageHead, Panel } from '@/terminal/ui';
import { IssuerPowers } from './IssuerPowers';
import { StockCoinFacts } from './StockCoinFacts';
import { StockPoolFacts } from './StockPoolFacts';
import { StockPositionLine } from './StockPositionLine';
import { useOffHoursRisk } from './useStockPoolFacts';
import { STOCK_FACTS_STAND } from './words';
import s from './stocks.module.css';

const HOUR = 60 * 60_000;
const TSLA = 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB';
const SPCX = 'Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8';
const SOL = 'So11111111111111111111111111111111111111112';
const TERMS = 'https://assets.backed.fi/legal-documentation';
const ISSUER = { id: 'xstocks', label: 'xStocks · Backed Finance' } as const;
/* ANT by Backpack Securities, and PreStocks' Anthropic token, as the engine answers them on 19.11. */
const ANT = 'ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe';
const ANTHROPIC = 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw';
const BACKPACK = { id: 'backpack', label: 'Backpack Securities' } as const;
const PRESTOCKS = { id: 'prestocks', label: 'PreStocks' } as const;
const BACKPACK_TERMS = 'https://learn.backpack.exchange/articles/what-is-backpack-securities';

/**
 * Three test marks for the logo rule, a stand's own patterns and no coin's logo: dark ink on a clear ground
 * (stands on the light disc), a light mark and a colourful disc (drawn as they are).
 */
const MARKS: readonly Readonly<{ id: string; src: string }>[] = [
  { id: 'ink', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAiUlEQVR42u3POQqAQBQEUWPx/tfVyEzcZv5SUA2d11sW55xzLnDruu0CKuPPC6iMRyLQgKt4FAINuItHINCAN/FtEV/iWyLQgD/xrRBowEh8CwQaMCO+FIEGzIxPR0TEpyLQgMj4FAQakBEfikADMuNDEGhARfxUBBpQGT+M6BA/hMADnHPOPe0A78eNuK4Fg04AAAAASUVORK5CYII=' },
  { id: 'light', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAiElEQVR42u3POQ6AMBTEUO5/39RQ0SG25C+WPNL0ftvmnHPOBW6MsQuojD8voDIeiUADruJRCDTgLh6BQAPexLdFfIlviUAD/sS3QqABM/EtEGjAivhSBBqwMj4dERGfikADIuNTEGhARnwoAg3IjA9BoAEV8UsRaEBl/DSiQ/wUAg9wzjn3tAOb8c8LwgBB9AAAAABJRU5ErkJggg==' },
  { id: 'colour', src: 'data:image/png;base64,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' },
];

/** The states the eyes check, on the clock of the moment the page opens. */
function standFacts(now: number): Readonly<{ open: PoolFacts; closed: PoolFacts; none: PoolFacts; coin: PoolFacts; listed: PoolFacts; antOpen: PoolFacts; antClosed: PoolFacts }> {
  const step = now + 30 * HOUR;
  return {
    coin: {
      mint: ANT,
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
    listed: {
      mint: ANTHROPIC,
      isStock: true,
      issuer: PRESTOCKS,
      session: 'unknown',
      nextChangeAt: null,
      dividendGuard: null,
      termsUrl: 'https://www.prestocks.com/faq',
      kind: 'pre-ipo',
      powers: { take: true, pause: false, paused: null },
      listed: { company: 'Anthropic', ticker: 'ANT', solana: { mint: ANT, symbol: 'ANT' } },
    },
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
    antOpen: { mint: ANT, isStock: true, issuer: BACKPACK, session: 'open', nextChangeAt: new Date(now + 3 * HOUR).toISOString(), dividendGuard: null, termsUrl: BACKPACK_TERMS },
    antClosed: { mint: ANT, isStock: true, issuer: BACKPACK, session: 'closed', nextChangeAt: new Date(now + 14 * HOUR).toISOString(), dividendGuard: null, termsUrl: BACKPACK_TERMS },
  };
}

/**
 * The stand's page for the eyes: the detail where the pool page will mount it — in the left column of three
 * pools (the exchange open, the exchange closed with a dividend guard ahead, a coin that is no stock) and above the
 * action of a ticket with the risk line — plus one live read of a stock through the public door.
 * A stand only.
 * And the one line before a position's signature in a stock's DLMM Pro pool (ANT · SOL), with the exchange
 * open and closed, over the ticket's action.
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
          <Panel gap={12} label={w.position('ANT')}>
            <Kick>{w.position('ANT')}</Kick>
            <StockPositionLine mint={ANT} issuer={BACKPACK.label} facts={facts.antOpen} />
            <Action>{w.action}</Action>
          </Panel>
          <Panel gap={12} label={w.position('ANT')}>
            <Kick>{w.position('ANT')}</Kick>
            <StockPositionLine mint={ANT} issuer={BACKPACK.label} facts={facts.antClosed} />
            <Action>{w.action}</Action>
          </Panel>
          <Panel gap={12} label={w.live}>
            <Kick>{w.live}</Kick>
            <StockPoolFacts mint={TSLA} />
          </Panel>
          {/* The coin's page: the facts block, and the issuer's powers as the «Rights» cell draws them. */}
          <Panel gap={12} label={w.coin('ANT')}>
            <Kick>{w.coin('ANT')}</Kick>
            <StockCoinFacts mint={facts.coin.mint} facts={facts.coin} />
            <span className={s.standRights}>
              <Kick>{w.rights}</Kick>
              <IssuerPowers mint={facts.coin.mint} facts={facts.coin} />
            </span>
          </Panel>
          <Panel gap={12} label={w.coin('ANTHROPIC')}>
            <Kick>{w.coin('ANTHROPIC')}</Kick>
            <StockCoinFacts mint={facts.listed.mint} facts={facts.listed} />
          </Panel>
          <Panel gap={12} label={w.live}>
            <Kick>{w.live}</Kick>
            <StockCoinFacts mint={ANT} />
          </Panel>
          <Panel gap={12} label={w.logos}>
            <Kick>{w.logos}</Kick>
            <span className={s.standLogos}>
              {MARKS.map((mark) => (
                <span key={mark.id} data-mark={mark.id} className={s.standLogos}>
                  <CoinLogo src={mark.src} symbol={mark.id} size="s" eager />
                  <CoinLogo src={mark.src} symbol={mark.id} size="m" eager />
                  <CoinLogo src={mark.src} symbol={mark.id} size="xl" eager />
                </span>
              ))}
            </span>
          </Panel>
        </div>
      </ActionBody>
    </Page>
  );
}

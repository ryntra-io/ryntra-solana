'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import type { DlmmStockRead, DlmmStockReview } from '@/lib/earn-dlmm/stocks';
import type { PoolFacts } from '@/lib/stocks/pool-facts';
import { ActionBody, Kick, Page, PageHead, Panel } from '@/terminal/ui';
import { DlmmStockTicket } from './DlmmStockTicket';
import { stockAddBody, stockChoice, typedAfter } from './model';
import { useDlmmStock } from './store';
import { DLMM_STOCK } from './words';

const HOUR = 60 * 60_000;
const ANT = 'ANTBTZQ1EUuTxUs3tfeampxdqTWPHmwyJmcWj4xoAyNe';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** A stand's own wallet: it signs nothing — the stand never presses the action. */
const STAND = '8dRtxg5xzetRyzYjyWPhcLMAVdyhbPpJo1u1J87Fh9XL';
const POOL = '2rETc69Asd1V1Ea8xopte18cKukaWmrvmNrj7FzYpxQL';
const BACKPACK = { id: 'backpack', label: 'Backpack Securities' } as const;

export type StandState = 'form' | 'review' | 'paused' | 'done';
const STATES: readonly StandState[] = ['form', 'review', 'paused', 'done'];

/** The pool as the server reads it for a wallet, at the made rehearsal's price (bin 2280, a 0.20 % step: 95.15 USDC). */
const READ: DlmmStockRead = {
  pool: POOL,
  stock: { mint: ANT, symbol: 'ANT', issuer: BACKPACK.label, side: 'x', decimals: 6 },
  quote: { kind: 'usdc', mint: USDC, decimals: 6 },
  price: 1.002 ** 2280,
  binStepBps: 20,
  activeBin: 2280,
  paused: false,
  add: 'on',
  stopped: false,
};

/** The engine's Review of «Even», «Medium», 1 ANT, as the made rehearsal built it: one transaction, the position's deposit back on exit. */
function reviewOf(amountX: string, amountY: string): DlmmStockReview {
  const low = 1.002 ** (2280 - 16);
  const high = 1.002 ** (2280 + 16);
  return {
    preview: {
      action: 'add',
      venue: 'meteora-dlmm',
      pool: POOL,
      request: { pool: POOL, owner: STAND, amountX, amountY, slippageBps: 100, shape: 'spot', bins: { lower: 2264, upper: 2296 } },
      opensPosition: true,
      range: { kind: 'bins', lowerBin: 2264, upperBin: 2296, lowerPrice: low.toPrecision(10), upperPrice: high.toPrecision(10) },
      rangeState: 'in_range',
      deposit: { x: { units: amountX, asset: ANT, decimals: 6 }, y: { units: amountY, asset: USDC, decimals: 6 } },
      fees: [],
      rent: [{ what: 'position', direction: 'pay', lamports: '41899840', refundable: true }],
      transactions: 1,
      notices: [],
      price: READ.price.toPrecision(10),
      at: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
    },
    transactions: [{ wireBase64: 'AA==', presigned: [] }],
    position: 'BnyfE5CY6sNx7nWXfS2TqGtqUoSG8ZH8nHAm3uWKpb4E',
    ticket: 'stand',
    expiresAt: Number.MAX_SAFE_INTEGER,
    signableMs: 25_000,
    networkFeeLamports: '10000',
    depositUsd: null,
    stock: { mint: ANT, symbol: 'ANT', issuer: BACKPACK.label, side: 'x', decimals: 6 },
    quote: { kind: 'usdc', mint: USDC, decimals: 6 },
  };
}

/**
 * The stand's page for the eyes (`/terminal/kit/dlmm-stock?state=…`, a stand only): the ticket of a
 * stock's DLMM pool in its column as the pool's page holds it — the form before a wallet (`form`), the Review before the
 * signature with a stand's wallet that signs nothing (`review`), the issuer's pause (`paused`), and an add that landed
 * (`done`). The exchange's facts are given, so no read goes out.
 */
export function DlmmStockStand() {
  const w = useWords(DLMM_STOCK);
  const [state, setState] = useState<StandState | null>(null);
  const facts = useMemo<PoolFacts>(() => ({ mint: ANT, isStock: true, issuer: BACKPACK, session: 'open', nextChangeAt: new Date(Date.now() + 3 * HOUR).toISOString(), dividendGuard: null, termsUrl: 'https://learn.backpack.exchange/articles/what-is-backpack-securities' }), []);
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('state');
    const next: StandState = STATES.includes(asked as StandState) ? (asked as StandState) : 'form';
    const typed = typedAfter(READ, 'stock', '1');
    if (next === 'form') {
      useWallet.setState({ connection: null, holdings: null });
      useDlmmStock.setState({ typed, phase: 'idle', reviewed: null, outcome: null, notice: null });
    } else {
      const holdings = { owner: STAND, sol: { spendableRaw: '2000000000', decimals: 9 }, tokens: new Map([[ANT, { spendableRaw: '5000000', decimals: 6 }], [USDC, { spendableRaw: '600000000', decimals: 6 }]]), complete: true, at: Date.now() };
      useWallet.setState({ connection: { wallet: 'Stand', address: STAND, chains: ['solana:mainnet'] }, holdings });
      const choice = stockChoice(READ, STAND, typed, holdings, 'even', 'balanced');
      const body = stockAddBody(READ, STAND, choice, 'even', 'balanced');
      const reviewed = next === 'review' && choice.key ? { key: choice.key, body, review: reviewOf(choice.x, choice.y), at: Date.now() } : null;
      useDlmmStock.setState({ typed, goal: 'even', style: 'balanced', phase: next === 'done' ? 'done' : 'idle', reviewed, notice: null, outcome: next === 'done' ? { kind: 'done', signatures: ['5BwpmL8SstandSignatureOfTheMadeRehearsal1111111111111111111111111'] } : null });
    }
    setState(next);
  }, []);
  if (!state) return null;
  const read = state === 'paused' ? { ...READ, paused: true, add: 'off' as const } : READ;
  return (
    <Page>
      <PageHead title={w.standTitle} />
      <ActionBody
        side={
          <Panel tone="hi" gap={12} label={w.standPool}>
            <DlmmStockTicket read={read} facts={facts} onConnect={() => undefined} />
          </Panel>
        }
      >
        <Panel gap={12}>
          <Kick>{`state: ${state}`}</Kick>
        </Panel>
      </ActionBody>
    </Page>
  );
}

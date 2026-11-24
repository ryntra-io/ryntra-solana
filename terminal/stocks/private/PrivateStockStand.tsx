'use client';

import { useWords } from '@/city/lib/i18n/dict';
import type { PoolFacts } from '@/lib/stocks/pool-facts';
import { Action, ActionBody, Kick, Page, PageHead, Panel, PrivacyToggle } from '@/terminal/ui';
import { PrivateIncomePart } from './PrivateIncome';
import { PrivateStockPart, STOCK_SCOPE, type ShownFlow, type StockSide } from './PrivateStockBuy';
import { PRIVATE_STOCK_STAND } from './words';

/* NVDAx by xStocks and USDC — shapes for the eyes only; the stand reads and signs nothing. */
const NVDA: StockSide = { mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', symbol: 'NVDAx', decimals: 8 };
const USDC: StockSide = { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 };
const FACTS: PoolFacts = {
  mint: NVDA.mint,
  isStock: true,
  issuer: { id: 'xstocks', label: 'xStocks' },
  session: 'closed',
  nextChangeAt: null,
  dividendGuard: null,
  termsUrl: 'https://assets.backed.fi/legal-documentation',
  kind: 'listed-equity',
  powers: { take: true, pause: true, paused: false },
  listed: null,
};

const flow = (over: Partial<ShownFlow>): ShownFlow => ({ flow: 'buy', path: null, where: null, failure: null, returned: false, stage: null, ...over });
const REVIEW = { transactions: [{ wireBase64: 'AA==', presigned: [] }], preview: { action: 'claim', claimed: { x: { units: '1200000' }, y: { units: '3400000' } } } } as const;

/**
 * A stock bought from the private balance and a pool's fees put back into it, in every state, for the eyes on a
 * stand only (`/terminal/kit/private-stock`, with `NEXT_PUBLIC_RYNTRA_TERMINAL=stand` and `NEXT_PUBLIC_RYNTRA_PRIVATE=devnet`):
 * the part above the ticket's amber button as the coin's ticket mounts it, the exchange closed; then each state a press
 * can end in, and the position's fees. People never see it.
 */
export function PrivateStockStand() {
  const w = useWords(PRIVATE_STOCK_STAND);
  const part = (shown?: ShownFlow, on = true) => <PrivateStockPart stock={NVDA} pay={USDC} on={on} facts={FACTS} shown={shown ?? flow({ flow: null })} />;
  return (
    <Page data-private-stock-stand="">
      <PageHead title={w.page} mode={<PrivacyToggle scope={STOCK_SCOPE} />} />
      <ActionBody
        side={
          <Panel tone="hi" gap={14} label={w.buy(NVDA.symbol)}>
            <Kick>{w.buy(NVDA.symbol)}</Kick>
            {part()}
            <Action>{w.buy(NVDA.symbol)}</Action>
          </Panel>
        }
      >
        {(
          [
            ['soon', flow({ path: { kind: 'refuse', code: 'ELSEWHERE' } })],
            ['landing', flow({ where: { place: 'landing' } })],
            ['wallet', flow({ where: { place: 'wallet', mint: USDC.mint, amount: 25_000_000n } })],
            ['bought', flow({ where: { place: 'bought', received: 14_200_000n } })],
            ['issuer', flow({ path: { kind: 'refuse', code: 'ISSUER' } })],
          ] as const
        ).map(([name, shown]) => (
          <Panel key={name} gap={12} label={w[name]}>
            <Kick>{w[name]}</Kick>
            {part(shown)}
          </Panel>
        ))}
        <Panel gap={12} label={w.income}>
          <Kick>{w.income}</Kick>
          <PrivateIncomePart x={{ mint: NVDA.mint, symbol: NVDA.symbol, unclaimed: 0.012 }} y={{ mint: USDC.mint, symbol: USDC.symbol, unclaimed: 3.4 }} review={REVIEW} on shown={flow({ flow: null })} />
        </Panel>
        <Panel gap={12} label={w.incomeDone}>
          <Kick>{w.incomeDone}</Kick>
          <PrivateIncomePart x={{ mint: NVDA.mint, symbol: NVDA.symbol, unclaimed: 0 }} y={{ mint: USDC.mint, symbol: USDC.symbol, unclaimed: 0 }} review={REVIEW} on shown={flow({ flow: 'income', where: { place: 'private' } })} />
        </Panel>
        <Panel gap={12} label={w.off}>
          <Kick>{w.off}</Kick>
          {part(undefined, false)}
        </Panel>
      </ActionBody>
    </Page>
  );
}

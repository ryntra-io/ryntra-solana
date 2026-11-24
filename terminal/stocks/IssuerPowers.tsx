'use client';

import { useLang } from '@/city/lib/i18n/lang';
import { issuerPowersLine, type PoolFacts } from '@/lib/stocks/pool-facts';
import { useStockPoolFacts } from './useStockPoolFacts';

/**
 * The issuer's powers over a stock's token in the coin page's «Rights», one line beside «Mint» and
 * «Freeze»: «The issuer can pause and take the token», read from the mint's own extensions through the stock's facts
 * (the same read as the facts detail). A coin that is no stock, or a mint that gives its issuer neither, shows nothing.
 * The «Rights» cell mounts it in one line — `<IssuerPowers mint={mint} />` — and its warm tone is the cell's own.
 */
export function IssuerPowers({ mint, facts: given }: { mint: string | null | undefined; facts?: PoolFacts | null }) {
  const facts = useStockPoolFacts(mint, given);
  const lang = useLang();
  const line = facts?.isStock ? issuerPowersLine(facts.powers, lang) : null;
  if (!line) return null;
  return (
    <span data-tone="warn" data-stock-powers="">
      {line}
    </span>
  );
}

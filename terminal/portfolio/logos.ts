import { USDC } from '@/city/lib/trade/tiles';
import { USDC_LOGO, spotLogo } from '@/terminal/coin/staples';
import { logoOf as marketLogo } from '@/terminal/market/depth-view';
import { NATIVE_SOL_MINT, type MarketFact } from './all-view';

/** SOL's own picture, kept with the site — native SOL is no tower, and the logo route answers nothing for it. */
const SOL_LOGO = '/site/universe/SOL.png';

/**
 * A coin's logo and the addresses tried after it, each once (as the pool's desk does): SOL's and USDC's own
 * pictures kept with the site; the picture the market lists for the mint, through the engine's proxy; the engine's
 * logo of a market coin; the catalogue's logo by the mint. The first that loads stands; none — the ticker's letter.
 * Its own module, so the coins and «Clean wallet» draw a coin by the same queue (wSOL in the clean stood as a
 * letter whenever the market was not read).
 */
export function logosFor(mint: string, fact: MarketFact | null = null): readonly string[] {
  const all = [mint === USDC.mint ? USDC_LOGO : null, mint === NATIVE_SOL_MINT ? SOL_LOGO : null, fact?.icon ? marketLogo({ id: mint, icon: fact.icon }) : null, `/api/icon/${mint}`, spotLogo(mint)];
  return [...new Set(all.filter((src): src is string => Boolean(src)))];
}

/** The ticket's own logo address for a coin: the first of its queue. */
export const logoFor = (mint: string, fact: MarketFact | null = null): string | null => logosFor(mint, fact)[0] ?? null;

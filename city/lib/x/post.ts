import { BRAND } from '../brand.ts';
import { X_MAX, xLength } from '../moments/drafts/post.ts';
import { pct, readTime, usd, type Facts } from './facts.ts';

/**
 * The words of a studio post for X: the fact, its window and its source with the read time, one link back to the city.
 * Plain facts in the city's voice — present tense, no promise, no hype word, no emoji, no handle: a partner is tagged
 * only by the person who approves the post (X rules II.B.2), never by the studio.
 */

/** The city, with the tower picked when the post is about one named coin. */
export function studioLink(f: Facts): string {
  const home = `https://${BRAND.domain}/`;
  const coin = f.template === 'hour' || (f.template === 'justin' && f.metric === 'core') ? f.symbol.replace(/^\$/, '') : null;
  return coin ? `${home}?coin=${encodeURIComponent(coin)}` : home;
}

/** "Oct 26 · 11:31 UTC" in a sentence. */
const when = (iso: string) => readTime(iso).replace(/^([A-Z])([A-Z]{2})/, (_, a: string, b: string) => a + b.toLowerCase());
/** "Oct 19". */
const day = (iso: string) => when(iso).split(' · ')[0]!;
const market = (readAt: string) => `Jupiter data, read ${when(readAt)}.`;
const chain = (network: string) => (network === 'solana:devnet' ? 'Both transactions on Solana devnet, in a Ryntra rehearsal.' : 'Both transactions on Solana.');

/** The post's sentence, before the link. */
export function studioWords(f: Facts): string {
  switch (f.template) {
    case 'hour':
      return `Tower of the hour: ${f.symbol} grew ${pct(f.change)} in the last hour, the most of any named tower in the live Solana skyline. ${market(f.readAt)} Not financial advice.`;
    case 'justin':
      return f.metric === 'volume'
        ? `JUST IN: ${usd(f.value)} traded in 24 hours across the ${f.towers} towers of the live Solana skyline. ${market(f.readAt)}`
        : `JUST IN: ${f.symbol} is a new tower in Sol Core, at a ${usd(f.mcap)} market cap. ${market(f.readAt)} Not financial advice.`;
    case 'launch':
      return `Launch Night: a coin launched on Ryntra and graduated into its pool ${f.seconds} s later — the curve filled, the tower left the docks for the skyline. ${chain(f.network)}`;
    case 'billboard': {
      const rows = f.rows.map((r, i) => `${i + 1} ${r.symbol} ${f.ranking === 'week' ? pct(r.value) : usd(r.value)}`).join(' · ');
      return f.ranking === 'week'
        ? `Towers of the week, by price change since ${day(f.from!)}: ${rows}. ${market(f.readAt)} Not financial advice.`
        : `The busiest towers of the live Solana skyline, by 24h volume: ${rows}. ${market(f.readAt)}`;
    }
    case 'banner':
      return `New banner: the live Solana skyline, ${f.towers} towers at the read. ${BRAND.hook}`;
  }
}

/** The post: the words and the link, within what X holds. */
export function studioText(f: Facts, link = studioLink(f)): string {
  const words = studioWords(f);
  const text = `${words} ${link}`;
  if (xLength(text) <= X_MAX) return text;
  // The words are short by design; this only guards a billboard of long tickers.
  return `${[...words].slice(0, X_MAX - 25).join('')}… ${link}`;
}

/** A post the studio may put in the queue: no handle, no hashtag, within 280. */
export function postIsClean(text: string): boolean {
  return xLength(text) <= X_MAX && !/(^|\s)[@#][A-Za-z0-9_]/.test(text);
}

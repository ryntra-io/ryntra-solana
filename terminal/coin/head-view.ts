import type { Lang } from '../../city/lib/i18n/langs.ts';
import type { DepthCoin } from '../../lib/market-depth/model.ts';
import type { SpotMarket } from '../../lib/spot/markets.ts';
import { CREATOR_WARN_PCT, TOP10_WARN_PCT, passportSentence, peopleText, shareText, type CoinPassport, type Right } from './passport/passport-data.ts';
import { PASSPORT } from './passport/words.ts';

/**
 * «About the coin» as the eye reads it: the coin's passport first, the market's and the depth's reads where it says
 * nothing. Pure: the reads come in, the words go out. A figure nobody gave is null and its row is not drawn — the
 * creator above all: a creator no source names leaves no «—» behind (the head's old «Creator —»).
 */

export type AboutFigure = Readonly<{ text: string; warn: boolean }>;
export type AboutRight = Readonly<{ key: 'both' | 'mint' | 'freeze'; text: string; tone: 'ok' | 'warn' }>;

export type About = Readonly<{
  /** One sentence of facts on top, or null when nothing is known to say (a stock says it through its own facts). */
  sentence: string | null;
  holders: number | null;
  top10: AboutFigure;
  /** What the creator's wallet holds; null — no source said, and the row is not drawn. */
  creatorHolds: AboutFigure | null;
  /** «14 · 1 listed»: the coins the creator launched and how many of them listed; null — not drawn. */
  creatorCoins: string | null;
  /** The mint's two rights in plain words; both given up stand as one line. Empty — nothing read. */
  rights: readonly AboutRight[];
}>;

export type AboutInput = Readonly<{ market: SpotMarket | null; depth: DepthCoin | null; passport: CoinPassport | null }>;

const rightOf = (disabled: boolean | null | undefined): Right => (disabled === true ? 'off' : disabled === false ? 'on' : null);

export function aboutOf({ market, depth, passport }: AboutInput, lang: Lang): About {
  const w = PASSPORT[lang];
  const stock = passport?.stock === true || market?.category === 'stock';
  const top = passport?.top10Pct ?? market?.audit.topHoldersPct ?? depth?.topHolders ?? null;
  const holds = stock ? null : (passport?.creator.holdsPct ?? market?.audit.devBalancePct ?? null);
  const launches = stock ? null : (passport?.creator.launches ?? null);
  const listed = passport?.creator.listed ?? null;
  const minting = passport?.minting ?? (market ? rightOf(market.audit.mintAuthorityDisabled) : null) ?? depth?.mint ?? null;
  const freezing = passport?.freezing ?? (market ? rightOf(market.audit.freezeAuthorityDisabled) : null) ?? depth?.freeze ?? null;

  const rights: AboutRight[] = [];
  if (minting === 'off' && freezing === 'off') rights.push({ key: 'both', text: w.rightsOff, tone: 'ok' });
  else {
    if (minting !== null) rights.push({ key: 'mint', text: minting === 'on' ? w.mintOn : w.mintOff, tone: minting === 'on' ? 'warn' : 'ok' });
    if (freezing !== null) rights.push({ key: 'freeze', text: freezing === 'on' ? w.freezeOn : w.freezeOff, tone: freezing === 'on' ? 'warn' : 'ok' });
  }

  return {
    sentence: passportSentence(passport, lang),
    holders: passport?.holders ?? market?.holders ?? depth?.holders ?? null,
    top10: { text: top === null ? w.unknown : shareText(top, lang), warn: top !== null && top >= TOP10_WARN_PCT },
    creatorHolds: holds === null ? null : { text: shareText(holds, lang), warn: holds >= CREATOR_WARN_PCT },
    creatorCoins: launches === null ? null : listed !== null ? w.factLaunchesValue(peopleText(launches, lang), peopleText(listed, lang)) : peopleText(launches, lang),
    rights,
  };
}

import { digits, num } from '../i18n/dict.ts';
import type { Lang } from '../i18n/langs.ts';
import { cardDateText, moneyText, shareText } from './berth-words.ts';
import type { AgentCard, CardTag, CreatorCard, RoundTrip, ShareCard } from './cards.ts';
import { SHARE_CARD } from './words.ts';

/**
 * What a share card says, line by line, in the language on screen (L8 · CITY-145) — the layout the drawing
 * (`card-draw.ts`) puts on the frame: the kicker, the one big figure, the amber line under it and one quiet line. Every
 * figure is the card's own (`cards.ts`), said as the berth says money: rounded down, never up. Pure, so the tests read it.
 */

/** The frame a card stands on: our own docks, our own skyline, or the live city at the tap. */
export type CardFrame = 'docks' | 'skyline' | 'live';

export type CardFace = Readonly<{
  /** One line, or the round trip's two: where it was bought, where it was sold. */
  kicker: readonly string[];
  tone: 'mint' | 'amber' | 'flare';
  /** The one big figure: the ticker, or the round trip's multiple. */
  hero: string;
  /** Under it, in amber: the way to the exit, the time it flew, the gain. Null when not read. */
  unit: string | null;
  /** The quiet line: holders and the day, or what was paid and what came back. Null when nothing was read. */
  line: string | null;
  /** DEVNET or TEST in the corner: test money is never shared as real money. */
  tag: string | null;
  frame: CardFrame;
}>;

export function cardFace(card: ShareCard, lang: Lang): CardFace {
  if (card.kind === 'agent') return agentFace(card, lang);
  return card.kind === 'pnl' ? roundFace(card, lang) : creatorFace(card, lang);
}

/** The agent's card: its multiple big, the gain under it, what went in and what it is worth now in the quiet line. */
function agentFace(card: AgentCard, lang: Lang): CardFace {
  const w = SHARE_CARD[lang];
  const gain = BigInt(card.gainRaw);
  const sign = gain > 0n ? '+' : gain < 0n ? '−' : '';
  const abs = (gain < 0n ? -gain : gain).toString();
  return {
    kicker: [card.span === 'today' ? w.agentToday : card.span === 'away' ? w.agentAway : w.agentKicker],
    tone: card.up ? 'mint' : 'flare',
    hero: multipleText(card.multiple, lang),
    unit: `${sign}${moneyText(abs, card.pair, lang)}`,
    line: w.agentLine(card.coin.symbol, w.agentTrades(card.trades), costText(card.spentRaw, card.pair, lang), moneyText(card.worthRaw, card.pair, lang)),
    tag: tagText(card.tag, lang),
    frame: 'live',
  };
}

function creatorFace(card: CreatorCard, lang: Lang): CardFace {
  const w = SHARE_CARD[lang];
  const date = cardDateText(card.at, lang);
  const holders = card.holders ? holdersText(card.holders, lang) : null;
  const first = card.kind === 'born' ? (card.progressPct !== null ? w.toExit(shareText(card.progressPct * 100, lang)) : null) : card.flewMs !== null ? flewText(card.flewMs, lang) : null;
  return {
    kicker: [card.kind === 'born' ? w.born : w.graduated],
    tone: card.kind === 'born' ? 'mint' : 'amber',
    hero: `$${card.coin.symbol}`,
    unit: first ?? date,
    line: [holders, first ? date : null].filter(Boolean).join(' · ') || null,
    tag: tagText(card.tag, lang),
    frame: card.kind === 'born' ? 'docks' : 'skyline',
  };
}

function roundFace(card: RoundTrip, lang: Lang): CardFace {
  const gain = BigInt(card.gainRaw);
  const sign = gain > 0n ? '+' : gain < 0n ? '−' : '';
  const abs = (gain < 0n ? -gain : gain).toString();
  return {
    kicker: roundKicker(card, lang),
    tone: card.up ? 'mint' : 'flare',
    hero: multipleText(card.multiple, lang),
    unit: `${sign}${moneyText(abs, card.pair, lang)}`,
    line: `$${card.coin.symbol} · ${costText(card.paidRaw, card.pair, lang)} → ${moneyText(card.receivedRaw, card.pair, lang)}`,
    tag: tagText(card.tag, lang),
    frame: 'live',
  };
}

/** The round trip's two halves: «Купив на народженні —» / «продав на виході». */
export function roundKicker(card: Pick<RoundTrip, 'bought' | 'sold'>, lang: Lang): readonly [string, string] {
  const w = SHARE_CARD[lang];
  const bought = card.bought === 'birth' ? w.boughtBirth : card.bought === 'pool' ? w.boughtPool : card.bought === 'curve' ? w.boughtCurve : w.boughtMixed;
  const sold = card.sold === 'exit' ? w.soldExit : card.sold === 'dex' ? w.soldDex : w.soldCurve;
  return [bought, sold];
}

/**
 * What the post says beside the card; the link follows it (`city/lib/share/post.ts`). A test card's post opens with its
 * tag too, so the words never pass for real money even when the picture is left behind.
 */
export function postText(card: ShareCard, lang: Lang): string {
  const w = SHARE_CARD[lang];
  const words =
    card.kind === 'agent'
      ? card.span
        ? (card.span === 'today' ? w.postAgentToday : w.postAgentAway)(agentSummary(card, lang), card.coin.symbol)
        : w.postAgent(multipleText(card.multiple, lang), card.coin.symbol)
      : card.kind !== 'pnl'
      ? card.kind === 'born'
        ? w.postBorn(card.coin.symbol)
        : w.postGraduated(card.coin.symbol, card.flewMs !== null ? flewText(card.flewMs, lang) : '')
      : w.postRound(multipleText(card.multiple, lang), card.coin.symbol, roundKicker(card, lang).join(' '));
  const tag = tagText(card.tag, lang);
  return tag ? `${tag} · ${words}` : words;
}

/** «3 trades, +0.012 SOL»: the span's trades and its gain, as the card's unit says it. */
function agentSummary(card: AgentCard, lang: Lang): string {
  const gain = BigInt(card.gainRaw);
  const sign = gain > 0n ? '+' : gain < 0n ? '−' : '';
  return `${SHARE_CARD[lang].agentTrades(card.trades)}, ${sign}${moneyText((gain < 0n ? -gain : gain).toString(), card.pair, lang)}`;
}

/** A cost in the pair currency, rounded up to the cent: what was paid never reads lower than it was. Counted in whole cents. */
export function costText(raw: string, pair: Readonly<{ symbol: string; decimals: number; dollar: boolean }>, lang: Lang): string {
  const unit = 10n ** BigInt(pair.decimals);
  const cents = (BigInt(raw) * 100n + unit - 1n) / unit;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `${whole}.${(cents % 100n).toString().padStart(2, '0')}`;
  return digits(pair.dollar ? `$${text}` : `${text} ${pair.symbol}`, lang);
}

/**
 * A multiple, rounded down so it never reads better than it is: one place under 100 (7.5×, 0.8×), whole above
 * (142×); the Ukrainian comma.
 */
export function multipleText(multiple: number, lang: Lang): string {
  if (!Number.isFinite(multiple) || multiple < 0) return '—';
  const text = multiple >= 100 ? String(Math.floor(multiple)) : (Math.floor(multiple * 10 + 1e-9) / 10).toFixed(1);
  return `${digits(text, lang)}×`;
}

/** How long the coin took from its launch to the DEX, rounded down: in 42 min · за 23 год · за 3 дні. */
export function flewText(ms: number, lang: Lang): string {
  const w = SHARE_CARD[lang];
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return w.flewMin(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return w.flewHours(hours);
  return w.flewDays(Math.floor(hours / 24));
}

export function holdersText(holders: Readonly<{ count: number; atLeast: boolean }>, lang: Lang): string {
  return SHARE_CARD[lang].holders(`${holders.atLeast ? '≥' : ''}${num(holders.count, undefined, lang)}`, holders.count);
}

function tagText(tag: CardTag, lang: Lang): string | null {
  if (!tag) return null;
  return tag === 'stub' ? SHARE_CARD[lang].stub : SHARE_CARD[lang].devnet;
}

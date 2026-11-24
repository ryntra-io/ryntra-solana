import { digits } from '../../../city/lib/i18n/dict.ts';
import type { Lang } from '../../../city/lib/i18n/langs.ts';
import type { SpotMarket } from '../../../lib/spot/markets.ts';
import { launchpadName } from '../../../lib/spot/pulse.ts';
import type { RiskFact, TokenFacts } from '../../../lib/spot/token-page.ts';
import { changeText, changeTone, usdText } from '../../ui/figures.ts';
import { PASSPORT } from './words.ts';

/**
 * The coin's passport: the three reads the engine already gives of one coin (its market, the token's
 * overview and the facts behind its risk) as one model, and what the screen and the agent say of it — the figures the
 * head lacks, the short line by the buy button with the whole list behind «i», and one sentence of facts. Pure: the
 * reads come in, the words go out; nothing here reads, signs or advises.
 *
 * A figure the sources did not give stays `null` and is drawn «—» only where it is truly unknown. The creator is known
 * when any source names them — their wallet, their share or their coins — and then is never drawn as «—».
 */

export const PASSPORT_WINDOWS = ['m5', 'h1', 'h6', 'h24'] as const;
export type PassportWindow = (typeof PASSPORT_WINDOWS)[number];

/** A right someone holds over the holders: still on, given up, or not read. */
export type Right = 'on' | 'off' | null;

/** How far a launch curve is, where the engine read it (the Pulse row of the coin). */
export type CurveRead = Readonly<{ progressPct: number; complete: boolean }>;

export type PassportCreator = Readonly<{
  /** Some source names the creator: their wallet, their share or their coins. */
  known: boolean;
  /** 0–100: the share of the supply the creator's wallet holds. */
  holdsPct: number | null;
  /** How many coins the creator's wallet launched, this one among them. */
  launches: number | null;
  /** How many of them left their curve for an exchange. */
  listed: number | null;
}>;

export type CoinPassport = Readonly<{
  mint: string;
  /** A tokenized stock: its issuer's rights are the instrument's design, and it has no creator or curve. */
  stock: boolean;
  /** When the coin's first pool opened, else when the coin was made (ms). */
  bornAt: number | null;
  ageMs: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  /** Per cent change of the liquidity over the day. */
  liquidityDayPct: number | null;
  holders: number | null;
  /** The wallets that traded over the day. */
  traders24h: number | null;
  /** Per cent move of the price by window. */
  changes: Readonly<Record<PassportWindow, number | null>>;
  creator: PassportCreator;
  /** 0–100: the share the ten largest holders keep. */
  top10Pct: number | null;
  minting: Right;
  freezing: Right;
  /** The launchpad by the name people know it by; null where no source names one. */
  venue: string | null;
  /** On its launch curve, or listed on an exchange after it; null — no launchpad and no curve is known. */
  stage: 'curve' | 'listed' | null;
  /** 0–100 while on the curve, where it was read. */
  curvePct: number | null;
  listedAt: number | null;
  flagged: boolean;
  /** Whether selling is blocked, as the honeypot check states it; null where not checked. */
  sell: 'ok' | 'blocked' | null;
}>;

export type PassportInput = Readonly<{
  mint: string;
  /** `/api/spot/market` — `market`. */
  market: SpotMarket | null;
  /** `/api/spot/token?part=overview` — `facts`. */
  facts: TokenFacts | null;
  /** `/api/spot/token?part=risk` — `facts`. */
  risk: readonly RiskFact[] | null;
  /** The coin's Pulse row's curve, where it was read. */
  curve?: CurveRead | null;
  now: number;
}>;

const finite = (value: number | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const timeOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
};

/** The three reads as one passport; null when none of them came. */
export function passportOf(input: PassportInput): CoinPassport | null {
  const { market, facts, now } = input;
  const risk = input.risk ?? [];
  if (!market && !facts && !input.risk) return null;
  const fact = (code: RiskFact['code']) => risk.find((row) => row.code === code) ?? null;
  const rightOf = (disabled: boolean | null | undefined, code: 'MINT_AUTHORITY' | 'FREEZE_AUTHORITY'): Right => {
    if (disabled === true) return 'off';
    if (disabled === false) return 'on';
    const state = fact(code)?.state;
    return state === 'revoked' ? 'off' : state === 'active' ? 'on' : null;
  };

  const stock = market?.category === 'stock';
  const born = timeOf(market?.firstPoolAt) ?? timeOf(facts?.createdAt);
  const bornAt = born !== null && born <= now ? born : null;
  const windows = facts?.windows;
  const holdsPct = finite(market?.audit.devBalancePct) ?? finite(fact('CREATOR_HOLDS')?.value);
  const launches = finite(facts?.devMints) ?? finite(fact('CREATOR_TOKENS')?.value);
  const listed = finite(facts?.devMigrations);
  const creatorKnown = !stock && (Boolean(facts?.dev) || holdsPct !== null || launches !== null);

  const venue = stock ? null : launchpadName(facts?.launchpad ?? null);
  const listedAt = timeOf(facts?.graduatedAt);
  const curve = input.curve ?? null;
  const stage: CoinPassport['stage'] = stock ? null : listedAt !== null || curve?.complete ? 'listed' : venue !== null || curve !== null ? 'curve' : null;
  const curvePct = stage === 'curve' && curve ? Math.max(0, Math.min(100, curve.progressPct)) : null;
  const honeypot = risk.find((row) => row.code === 'HONEYPOT')?.state;

  return {
    mint: input.mint,
    stock,
    bornAt,
    ageMs: bornAt === null ? null : now - bornAt,
    marketCapUsd: finite(market?.marketCapUsd),
    fdvUsd: finite(market?.fdvUsd),
    liquidityUsd: finite(market?.liquidityUsd) ?? finite(fact('LIQUIDITY')?.value),
    liquidityDayPct: finite(windows?.h24.liquidityChangePct) ?? finite(fact('LIQUIDITY_CHANGE')?.value),
    holders: finite(market?.holders),
    traders24h: finite(windows?.h24.traders) ?? finite(market?.stats.h24.traders),
    changes: {
      m5: finite(windows?.m5.priceChangePct),
      h1: finite(windows?.h1.priceChangePct) ?? finite(market?.change1hPct),
      h6: finite(windows?.h6.priceChangePct),
      h24: finite(windows?.h24.priceChangePct) ?? finite(market?.change24hPct),
    },
    creator: { known: creatorKnown, holdsPct: stock ? null : holdsPct, launches: stock ? null : launches, listed: stock ? null : listed },
    top10Pct: stock ? null : (finite(market?.audit.topHoldersPct) ?? finite(fact('TOP10')?.value)),
    minting: rightOf(market?.audit.mintAuthorityDisabled, 'MINT_AUTHORITY'),
    freezing: rightOf(market?.audit.freezeAuthorityDisabled, 'FREEZE_AUTHORITY'),
    venue,
    stage,
    curvePct,
    listedAt: stage === 'listed' ? listedAt : null,
    flagged: market?.audit.suspicious === true || fact('FLAGGED') !== null,
    sell: honeypot === 'yes' ? 'blocked' : honeypot === 'no' ? 'ok' : null,
  };
}

/* ------------------------------------------------------------------ words for the eye */

/** A share in per cent, short: 41%, 4.2%, 0.3%, <0.1%; one decimal under ten, none above, no trailing «.0». */
export function shareText(value: number, lang: Lang): string {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.1) return digits('<0.1%', lang);
  const shown = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return digits(`${shown}%`, lang);
}

/** A count of people, short: 812 · 4,120 · 12.3K · 1.4M. */
export function peopleText(value: number, lang: Lang): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value >= 1e6) return digits(`${(value / 1e6).toFixed(1)}M`, lang);
  if (value >= 1e4) return digits(`${(value / 1e3).toFixed(1)}K`, lang);
  return digits(Math.round(value).toLocaleString('en-US'), lang);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How old the coin is, short: 4m · 5h · 12d · 7mo · 2y. */
export function ageText(ms: number, lang: Lang): string {
  const w = PASSPORT[lang];
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < HOUR) return w.ageMin(Math.max(1, Math.floor(ms / MINUTE)));
  if (ms < DAY) return w.ageHour(Math.floor(ms / HOUR));
  const days = ms / DAY;
  if (days < 60) return w.ageDay(Math.floor(days));
  if (days < 730) return w.ageMonth(Math.floor(days / 30.44));
  return w.ageYear(Math.floor(days / 365.25));
}

/* ------------------------------------------------------------------ the head's row */

export type HeadFigureKey = 'fdv' | 'm5' | 'h1' | 'h6' | 'traders' | 'age';

export type HeadFigure = Readonly<{
  key: HeadFigureKey;
  label: string;
  value: string;
  /** A move's tone: growth or fall; nothing for none. */
  tone?: 'up' | 'down';
  /** The figure the row gives up first when it is narrow: 1 stays longest. */
  rank: 1 | 2 | 3;
}>;

/**
 * The figures the coin's head lacks, in the order the best terminals read them: the full value beside the market cap,
 * the moves over five minutes, an hour and six hours (the day's stands by the price), the people who traded in the
 * day, and the age. A stock keeps its moves and its people; it has no curve and no age of a launch to read.
 */
export function headFigures(passport: CoinPassport | null, lang: Lang): HeadFigure[] {
  const w = PASSPORT[lang];
  const p = passport;
  const move = (key: 'm5' | 'h1' | 'h6', label: string, rank: 1 | 2): HeadFigure => {
    const change = p?.changes[key] ?? null;
    const tone = change === null ? undefined : changeTone(change);
    return { key, label, value: change === null ? w.unknown : changeText(change, lang), rank, ...(tone ? { tone } : {}) };
  };
  return [
    { key: 'fdv', label: w.fdv, value: p?.fdvUsd != null ? usdText(p.fdvUsd, lang) : w.unknown, rank: 2 },
    move('m5', w.w5m, 1),
    move('h1', w.w1h, 1),
    move('h6', w.w6h, 2),
    { key: 'traders', label: w.traders, value: p?.traders24h != null ? peopleText(p.traders24h, lang) : w.unknown, rank: 3 },
    { key: 'age', label: w.age, value: p?.ageMs != null ? ageText(p.ageMs, lang) : w.unknown, rank: 1 },
  ];
}

/** Whether the passport knows any of the head's figures: with none, the head has no second row rather than a row of dashes. */
export function headFiguresKnown(passport: CoinPassport | null): boolean {
  if (!passport) return false;
  const { changes } = passport;
  return passport.fdvUsd != null || changes.m5 != null || changes.h1 != null || changes.h6 != null || passport.traders24h != null || passport.ageMs != null;
}

/* ------------------------------------------------------------------ the risk line */

/** Where a concentration starts to be worth a look — the same marks the coin's facts already use (`CoinFacts`). */
export const TOP10_WARN_PCT = 50;
export const CREATOR_WARN_PCT = 10;
/** The most facts the line by the buy button carries. */
export const LINE_MAX = 4;

export type RiskKey = 'flagged' | 'sell' | 'creatorHolds' | 'creatorLaunched' | 'top10' | 'rights' | 'venue';
export type RiskItem = Readonly<{ key: RiskKey; text: string; tone: 'warn' | 'plain' }>;
export type RiskLine = Readonly<{ items: readonly RiskItem[]; attention: boolean }>;

/** Each fact's place in the line as a person reads it. */
const READING: readonly RiskKey[] = ['flagged', 'sell', 'creatorHolds', 'creatorLaunched', 'top10', 'rights', 'venue'];

function venueText(p: CoinPassport, lang: Lang): string | null {
  const w = PASSPORT[lang];
  if (p.stage === 'curve') {
    const pct = p.curvePct !== null ? shareText(p.curvePct, lang) : null;
    if (p.venue) return pct ? w.onCurvePct(p.venue, pct) : w.onCurve(p.venue);
    return pct ? w.onCurveNoVenuePct(pct) : w.onCurveNoVenue;
  }
  if (p.stage === 'listed') return p.venue ? w.listed(p.venue) : w.listedPlain;
  return null;
}

/**
 * The line by the buy button: three or four short facts in plain words — the creator's share and coins, the ten
 * largest holders' share, the mint's rights, the curve — what is worth a look first, then the rest in their order, at
 * most {@link LINE_MAX}. `attention` lights one quiet sign when any fact is worth a look. A stock's rights are its
 * issuer's design: its line is empty and its own facts speak.
 */
export function riskLine(passport: CoinPassport | null, lang: Lang): RiskLine {
  if (!passport || passport.stock) return { items: [], attention: false };
  const w = PASSPORT[lang];
  const p = passport;
  /* Each candidate with its priority: what is worth a look first (0), then by what a trader reads first. */
  const all: { item: RiskItem; rank: number }[] = [];
  const add = (key: RiskKey, text: string | null, tone: RiskItem['tone'], rank: number) => {
    if (text) all.push({ item: { key, text, tone }, rank: tone === 'warn' ? 0 : rank });
  };
  if (p.flagged) add('flagged', w.flagged, 'warn', 0);
  if (p.sell === 'blocked') add('sell', w.sellBlocked, 'warn', 0);
  if (p.creator.holdsPct !== null) add('creatorHolds', w.creatorHolds(shareText(p.creator.holdsPct, lang)), p.creator.holdsPct >= CREATOR_WARN_PCT ? 'warn' : 'plain', 2);
  if (p.creator.launches !== null) {
    const text = p.creator.listed !== null ? w.creatorListed(p.creator.launches, p.creator.listed) : w.creatorLaunched(p.creator.launches);
    add('creatorLaunched', text, 'plain', 4);
  }
  if (p.top10Pct !== null) add('top10', w.top10(shareText(p.top10Pct, lang)), p.top10Pct >= TOP10_WARN_PCT ? 'warn' : 'plain', 1);
  /* The rights in one fact: a right still on is worth a look; both given up say so together. */
  if (p.minting === 'on') add('rights', w.mintOn, 'warn', 0);
  else if (p.freezing === 'on') add('rights', w.freezeOn, 'warn', 0);
  else if (p.minting === 'off' && p.freezing === 'off') add('rights', w.rightsOff, 'plain', 5);
  else if (p.minting === 'off') add('rights', w.mintOff, 'plain', 5);
  else if (p.freezing === 'off') add('rights', w.freezeOff, 'plain', 5);
  add('venue', venueText(p, lang), 'plain', p.stage === 'curve' ? 3 : 6);

  const picked = [...all].sort((a, b) => a.rank - b.rank).slice(0, LINE_MAX);
  const items = picked.map(({ item }) => item).sort((a, b) => READING.indexOf(a.key) - READING.indexOf(b.key));
  /* What is worth a look leads the pick, so the sign lights whenever any of it stands; the list behind «i» names all. */
  return { items, attention: all.some(({ item }) => item.tone === 'warn') };
}

export type FactRow = Readonly<{ key: string; label: string; value: string; tone?: 'warn' | 'ok' }>;

/**
 * Every fact behind «i», a word and its value: who holds, the creator, the rights, where the coin was launched and how
 * far along, its people, liquidity and age, whether selling works. «—» stands only where no source said; the creator's
 * rows show what is known of them, and «not named» only when nothing is.
 */
export function factRows(passport: CoinPassport | null, lang: Lang): FactRow[] {
  const w = PASSPORT[lang];
  const p = passport;
  if (!p) return [];
  const rows: FactRow[] = [];
  const pct = (value: number | null) => (value === null ? w.unknown : shareText(value, lang));
  const right = (value: Right): Pick<FactRow, 'value' | 'tone'> => (value === 'on' ? { value: w.factOn, tone: 'warn' } : value === 'off' ? { value: w.factOff, tone: 'ok' } : { value: w.unknown });
  if (p.flagged) rows.push({ key: 'flag', label: w.factFlag, value: w.factFlagYes, tone: 'warn' });
  if (!p.stock) {
    if (p.creator.holdsPct !== null) rows.push({ key: 'creator', label: w.factCreator, value: pct(p.creator.holdsPct), ...(p.creator.holdsPct >= CREATOR_WARN_PCT ? { tone: 'warn' as const } : {}) });
    if (p.creator.launches !== null) rows.push({ key: 'launches', label: w.factLaunches, value: p.creator.listed !== null ? w.factLaunchesValue(peopleText(p.creator.launches, lang), peopleText(p.creator.listed, lang)) : peopleText(p.creator.launches, lang) });
    if (!p.creator.known) rows.push({ key: 'creator', label: w.factCreator, value: w.creatorUnknown });
    else if (p.creator.holdsPct === null && p.creator.launches === null) rows.push({ key: 'creator', label: w.factCreator, value: w.creatorKnown });
    rows.push({ key: 'top10', label: w.factTop10, value: pct(p.top10Pct), ...(p.top10Pct !== null && p.top10Pct >= TOP10_WARN_PCT ? { tone: 'warn' as const } : {}) });
    rows.push({ key: 'mint', label: w.factMint, ...right(p.minting) });
    rows.push({ key: 'freeze', label: w.factFreeze, ...right(p.freezing) });
  }
  if (p.venue) rows.push({ key: 'venue', label: w.factVenue, value: p.venue });
  if (p.stage === 'curve') rows.push({ key: 'curve', label: w.factCurve, value: p.curvePct !== null ? shareText(p.curvePct, lang) : w.unknown });
  if (p.stage === 'listed') rows.push({ key: 'listed', label: w.factListed, value: w.factListedYes });
  rows.push({ key: 'holders', label: w.factHolders, value: p.holders !== null ? peopleText(p.holders, lang) : w.unknown });
  rows.push({ key: 'liquidity', label: w.factLiquidity, value: p.liquidityUsd !== null ? usdText(p.liquidityUsd, lang) : w.unknown });
  if (p.liquidityDayPct !== null) {
    const tone = changeTone(p.liquidityDayPct);
    rows.push({ key: 'liquidityDay', label: w.factLiquidityDay, value: changeText(p.liquidityDayPct, lang), ...(tone === 'down' && p.liquidityDayPct <= -30 ? { tone: 'warn' as const } : {}) });
  }
  rows.push({ key: 'age', label: w.factAge, value: p.ageMs !== null ? ageText(p.ageMs, lang) : w.unknown });
  if (p.sell !== null) rows.push({ key: 'sell', label: w.factSell, value: p.sell === 'ok' ? w.factSellOk : w.factSellBlocked, tone: p.sell === 'ok' ? 'ok' : 'warn' });
  return rows;
}

/* ------------------------------------------------------------------ the agent's sentence */

/** The most clauses the sentence carries. */
export const SAY_MAX = 3;

/**
 * One sentence of facts about the coin, for the agent's line: «Creator launched 14 coins, 1 listed; top 10 hold 41%».
 * What is worth a look goes in first, then the creator, the holders, the curve, the age — at most {@link SAY_MAX}
 * clauses. Facts only: never «buy» or «sell», no verdict. Null when nothing is known to say, or for a stock.
 */
export function passportSentence(passport: CoinPassport | null, lang: Lang): string | null {
  if (!passport || passport.stock) return null;
  const w = PASSPORT[lang];
  const p = passport;
  const clauses: { text: string; rank: number; at: number }[] = [];
  const add = (text: string, rank: number) => clauses.push({ text, rank, at: clauses.length });
  if (p.creator.launches !== null) add(p.creator.listed !== null ? `${w.sayLaunched(p.creator.launches)}, ${w.sayListed(p.creator.listed)}` : w.sayLaunched(p.creator.launches), 1);
  if (p.creator.holdsPct !== null) add(w.sayHolds(shareText(p.creator.holdsPct, lang)), p.creator.holdsPct >= CREATOR_WARN_PCT ? 0 : 3);
  if (p.top10Pct !== null) add(w.sayTop10(shareText(p.top10Pct, lang)), p.top10Pct >= TOP10_WARN_PCT ? 0 : 2);
  if (p.flagged) add(w.sayFlagged, 0);
  if (p.minting === 'on') add(w.sayMintOn, 0);
  if (p.freezing === 'on') add(w.sayFreezeOn, 0);
  if (p.stage === 'curve' && p.curvePct !== null) add(w.sayCurve(shareText(p.curvePct, lang)), 4);
  if (p.ageMs !== null) add(w.sayAge(ageText(p.ageMs, lang)), 5);
  if (!clauses.length) return null;
  const said = [...clauses]
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .slice(0, SAY_MAX)
    .sort((a, b) => a.at - b.at)
    .map((clause) => clause.text)
    .join('; ');
  return said.charAt(0).toLocaleUpperCase(lang === 'uk' ? 'uk-UA' : 'en-US') + said.slice(1);
}

/**
 * The one sentence of risk over the buy button (and under the price on a phone): the fact worth a look first, as the
 * risk line names it — none stands, no sentence. A company's token says nothing here: its facts already say what its
 * issuer can do.
 */
export function riskSentence(passport: CoinPassport | null, lang: Lang): string | null {
  return riskLine(passport, lang).items.find((item) => item.tone === 'warn')?.text ?? null;
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { dateText, digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { lamportsSol } from '@/city/lib/bots/format';
import type { Tower } from '@/city/lib/market/types';
import { SOL } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import type { ProMarket } from '@/lib/pro-limits/service';
import { classicGrid } from '@/lib/grid/classic';
import { classicView, gridView, gridRefill, type GridRecord, type GridVenue, type GridView } from '@/lib/grid/grid';
import { DEFAULT_TERMS, ladderCosts } from '@/lib/bots/ladder/costs';
import type { LadderPoolInfo } from '@/city/lib/bots/ladder';
import { GRID_MAX_LEVELS, GRID_MIN_LEVELS, gridPlan, gridPrices, gridStep, wholeOf, type GridIssue, type GridPlan } from '@/lib/grid/plan';
import { TIMEFRAME_KEY } from '@/city/lib/chart/candles';
import { CoinChart } from '@/terminal/coin/CoinChart';
import { decimalOf, setLayer, type LayerLine } from '@/terminal/coin/chart-layer';
import { standIn } from '@/terminal/coin/coin-view';
import { useDayMove } from '@/terminal/market/day-move';
import { openPanel } from '@/terminal/shell/frame';
import { NARROW, useNarrow } from '@/terminal/shell/useNarrow';
import { connectWallet } from '@/terminal/shell/Wallet';
import { WALLET } from '@/terminal/shell/words';
import { useOffHoursRisk } from '@/terminal/stocks/useStockPoolFacts';
import { Action, AmountField, Chip, CoinLogo, Figure, Icon, Info, Kick, Panel, Quiet, Shares, Slider, Title, amountOf, changeText, changeTone, priceText, usdText } from '@/terminal/ui';
import { BotBadge, CoinAmount, HowInfo, Note, coinOf, useTowers, type PickedCoin } from './parts';
import { GRID } from './grid-words';
import { CLASSIC_NET, GRID_NET, MET_MINT, WARN_NOTES, netOf, ordersKey, useGrid, type GridAction } from './grid-store';
import { venueOf, type CoinVenue } from './rows';
import b from './bots.module.css';
import g from './grid.module.css';

type W = (typeof GRID)['en'];

/** The grid's screen in its three parts, for the page to lay out: the chart with the grid over it, the form, the person's grids. */
export type GridParts = Readonly<{ chart: ReactNode; form: ReactNode; mine: ReactNode }>;

const MET = MET_MINT;
/** MET and SOL where the market read does not hold them: their names, and their logos through the engine. */
const MET_COIN: PickedCoin = { mint: MET, symbol: 'MET', icon: `/api/icon/${MET}`, name: 'Meteora' };
const SOL_COIN: PickedCoin = { mint: SOL.mint, symbol: 'SOL', icon: `/api/icon/${SOL.mint}`, name: 'Solana' };
/** A pool's price this far from the market's is said before the signature. */
const POOL_APART = 0.03;
/** Which venues this deployment asks: DLMM Pro where its window names a network, the classic pool where the ladder's does. */
const VENUES_OPEN = { pro: GRID_NET !== null, classic: CLASSIC_NET !== null } as const;
/** The band's quick widths, percent either way of the price. */
const BANDS = ['5', '10', '20'] as const;
const START_BAND = 10;
const START_LEVELS = 12;
/** The fewest levels the screen starts with on a classic pool: two on each side and the price between. */
const CLASSIC_FEWEST = 5;
/**
 * A band past these shares of the price is no grid (an upper edge typed by mistake drew «Step 8072%»): the
 * low edge no lower than a fifth of the price, the high one no higher than five times it.
 */
const FAR_LOW = 0.2;
const FAR_HIGH = 5;

/**
 * Where a coin's grid rests on a classic DLMM pool, the screen's own start fits the pool (JUP's bins are 2 %
 * apart, so twelve levels in ±10 % were «too close» before the person touched anything): the starting band, else a wider
 * one, with the most levels — up to the start's twelve — whose prices each stand on a bin of their own.
 */
function classicStart(pool: LadderPoolInfo, basis: Readonly<{ price: number; coinDecimals: number; quoteDecimals: number }>, amount: number): Readonly<{ band: number; levels: number }> | null {
  for (const band of [START_BAND, 20]) {
    for (let levels = START_LEVELS; levels >= CLASSIC_FEWEST; levels -= 1) {
      const plan = gridPlan({ lower: basis.price * (1 - band / 100), upper: basis.price * (1 + band / 100), levels }, amount, basis);
      if (!plan.issue && !classicGrid(plan, pool.activePrice, pool.facts).issue) return { band, levels };
    }
  }
  return null;
}
/** Rent of one order while it rests: its NFT, its head, an entry and a tick a price (`DLMM_PRO_ACCOUNT_BYTES`), at the network's lamports a byte. */
const RENT_PER_BYTE = { mainnet: 5_080, devnet: 6_960 } as const;
const orderRent = (prices: number, network: 'mainnet' | 'devnet') => (600 + 128 + 170 + 128 + 144 + 128 + 184 * prices) * RENT_PER_BYTE[network];
/** Two signatures an order (the wallet and the order's fresh key) and a little for the network's priority. */
const ORDER_FEE = 15_000;

/** A field's number: digits with a point or a comma; null — not a number. */
function typed(text: string): number | null {
  const clean = text.replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d*\.?\d+$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/** A price as a field holds it: six significant digits, plain. */
const fieldOf = (value: number, lang: Lang) => (Number.isFinite(value) && value > 0 ? digits(value.toLocaleString('en-US', { maximumSignificantDigits: 6, useGrouping: false }), lang) : '');
const pctText = (fraction: number, lang: Lang, places = 2) => digits(`${(fraction * 100).toFixed(places)}%`, lang);
/** Dollars with their cents under a thousand — a grid's figures are small and exact; the city's short form above it. */
const cents = (value: number, lang: Lang) => (Math.abs(value) >= 1000 ? usdText(Math.abs(value), lang) : digits(`$${Math.abs(value).toFixed(2)}`, lang));

/**
 * Where the person has not chosen the chart's interval yet, the grid opens on hours: a band of a grid is wider than a
 * day's quarter-hours, and a week of hours fills the chart even on a young coin (MET's candles start on 11.11).
 */
function startOnHours(): void {
  try {
    if (typeof window !== 'undefined' && !window.localStorage.getItem(TIMEFRAME_KEY)) window.localStorage.setItem(TIMEFRAME_KEY, '1h');
  } catch {
    // A browser that keeps nothing: the chart's own default.
  }
}

function issueWord(w: W, issue: GridIssue): string {
  return { range: w.issueRange, levels: w.issueLevels, side: w.issueSide, amount: w.issueAmount, near: w.issueNear }[issue];
}

/** The wallet's door, where this width keeps it: a phone's sections sheet, a desk's header. */
function connect(): void {
  if (window.matchMedia(NARROW).matches) openPanel('sheet');
  connectWallet();
}

/** The coin's market on the grid's network, read now and every half minute while the screen is open. */
function useProMarket(mint: string | null): Readonly<{ market: ProMarket | null; read: 'off' | 'loading' | 'none' | 'closed' | 'failed' | 'ready' }> {
  const known = useGrid((st) => (mint ? st.markets[mint] : undefined));
  useEffect(() => {
    if (!mint || GRID_NET === null) return;
    void useGrid.getState().loadMarket(mint);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void useGrid.getState().loadMarket(mint);
    }, 30_000);
    return () => clearInterval(timer);
  }, [mint]);
  if (GRID_NET === null) return { market: null, read: 'off' };
  if (!known || (known.status === 'loading' && !known.value)) return { market: null, read: 'loading' };
  if (known.value) return { market: known.value, read: 'ready' };
  /* A lane closed here is «not here»; a read that failed is not known — never «no pool». Either way the classic venue
     is asked too. */
  if (known.status === 'failed') return { market: null, read: known.code === 'CAPABILITY_UNAVAILABLE' ? 'closed' : 'failed' };
  return { market: null, read: 'none' };
}

/** Dollar coins a grid may be quoted in: worth a dollar each. */
const DOLLARS = new Set(['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU']);

/** What a quote coin is worth in dollars now: a dollar coin one; another — its row of the market; null — not known. */
function quoteUsd(mint: string | null, towers: ReadonlyMap<string, Tower>): number | null {
  if (!mint) return null;
  if (DOLLARS.has(mint)) return 1;
  const row = towers.get(mint);
  return row && row.price > 0 ? row.price : null;
}

/** The coin's classic DLMM pool, where it has no DLMM Pro one: read now and every half minute while it is asked for. */
function useClassicPool(mint: string | null): Readonly<{ pool: LadderPoolInfo | null; read: 'off' | 'loading' | 'none' | 'failed' | 'ready' }> {
  const known = useGrid((st) => (mint ? st.classic[mint] : undefined));
  useEffect(() => {
    if (!mint || CLASSIC_NET === null) return;
    void useGrid.getState().loadClassic(mint);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void useGrid.getState().loadClassic(mint);
    }, 30_000);
    return () => clearInterval(timer);
  }, [mint]);
  if (CLASSIC_NET === null || !mint) return { pool: null, read: 'off' };
  if (!known || (known.status === 'loading' && !known.value)) return { pool: null, read: 'loading' };
  if (known.value) return { pool: known.value, read: 'ready' };
  return { pool: null, read: known.status === 'failed' ? 'failed' : 'none' };
}

/**
 * «Grid» — a grid of limit orders on Meteora DLMM Pro: buys under the price and sells over it inside a band,
 * placed with one signature, each filling exactly at its price with a share of the pool's fee to the maker. The chart
 * is the coin's own (the Spot's core chart), the band and its levels drawn over the candles as the form moves, its two
 * edges dragged on the chart. Under it, the person's grids: what filled, what they earned, «Take», «Place again», «Stop».
 *
 * Any coin of Solana: the market's, or any the catalogue finds by its ticker or address; each coin of the
 * list says where its grid would rest — DLMM Pro, DLMM, or no pool. MET opens the screen: its pool is DLMM Pro's.
 */
export function GridBot({ lay }: { lay: (parts: GridParts) => ReactNode }) {
  const w = useWords(GRID);
  const wallet = useWords(WALLET);
  const lang = useLang();
  const towers = useTowers();
  useState(startOnHours);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const connection = useWallet((st) => st.connection);
  const phone = useNarrow();

  // MET first where DLMM Pro is open here (its pool is Pro's, with the maker's bonus); SOL — the classic venue's — otherwise.
  const [coin, setCoin] = useState<PickedCoin | null>(null);
  const first = GRID_NET !== null ? (towers.get(MET) ?? null) : (towers.get(SOL.mint) ?? null);
  const shown = coin ?? (first ? coinOf(first) : GRID_NET !== null ? MET_COIN : SOL_COIN);
  /* A coin the market read does not hold stands in the market's own shape, so the chart takes it as the Spot does. */
  const inMarket = towers.get(shown.mint);
  const outside = useMemo(
    () => (inMarket ? null : standIn({ mint: shown.mint, symbol: shown.symbol, name: shown.name ?? shown.symbol, icon: shown.icon, verified: shown.verified ?? null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inMarket === undefined, shown.mint, shown.symbol, shown.name, shown.icon, shown.verified],
  );
  const tower = inMarket ?? outside ?? undefined;
  const { market, read } = useProMarket(shown?.mint ?? null);
  /* One form, two venues: DLMM Pro where the coin has a pool there; the classic DLMM ladder's pool otherwise. */
  const classic = useClassicPool(shown && read !== 'ready' && read !== 'loading' ? shown.mint : null);
  const venue: GridVenue | null = market ? 'pro' : classic.pool ? 'dlmm' : null;
  const marketPrice = market ? market.price : classic.pool ? classic.pool.activePrice : null;
  const decimals = market ? { coin: market.coin.decimals, quote: market.quote.decimals } : classic.pool ? { coin: classic.pool.facts.baseDecimals, quote: classic.pool.facts.quoteDecimals } : null;
  /* Dollars from the venue's own price: the pool's price of the coin times what its quote coin is worth. The market's
     row of the coin is the fallback only for a picture with no venue. */
  const perQuote = quoteUsd(market ? market.quote.mint : classic.pool ? classic.pool.facts.quoteMint : null, towers);
  const towerUsd = tower && tower.price > 0 ? tower.price : null;
  const coinUsd = marketPrice !== null && marketPrice > 0 && perQuote ? marketPrice * perQuote : towerUsd;
  /* Without a venue's market the grid is drawn in dollars on the coin's own price: a picture, and no button that signs. */
  /* A venue without its quote coin's dollars draws nothing: the picture basis is for no venue at all, never a venue's units. */
  const basis = marketPrice !== null ? (perQuote && decimals ? { price: marketPrice, coinDecimals: decimals.coin, quoteDecimals: decimals.quote, perQuote } : null) : coinUsd ? { price: coinUsd, coinDecimals: 6, quoteDecimals: 6, perQuote: 1 } : null;

  const [amount, setAmount] = useState('200');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [levels, setLevels] = useState(START_LEVELS);

  /** A band of `pct` either way of the price now. */
  const band = (pct: number) => {
    if (!coinUsd) return;
    setLow(fieldOf(coinUsd * (1 - pct / 100), lang));
    setHigh(fieldOf(coinUsd * (1 + pct / 100), lang));
  };
  /*
   * A new coin starts on its own band, once its price is known — and again once its venue's own price comes. The start
   * is the same on every screen (it was fitted to the prices the chart showed, so a phone and a desk started
   * on different bands); on a classic pool it fits the pool's bins.
   */
  const started = useRef<string | null>(null);
  /* On a classic pool the fit waits for the quote coin's dollars too: the start is made again once they come. */
  const startKey = shown && coinUsd ? `${shown.mint}:${venue ?? 'none'}${venue === 'dlmm' && basis ? ':fit' : ''}` : null;
  useEffect(() => {
    if (!startKey || started.current === startKey) return;
    started.current = startKey;
    const fit = venue === 'dlmm' && classic.pool && basis ? classicStart(classic.pool, basis, (typed(amount) ?? 0) / basis.perQuote) : null;
    band(fit?.band ?? START_BAND);
    setLevels(fit?.levels ?? START_LEVELS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startKey]);
  /* The person's own band: a typed edge, a quick width, an edge dragged on the chart. */
  const ownLow = setLow;
  const ownHigh = setHigh;
  const ownBand = band;

  const lowUsd = typed(low);
  const highUsd = typed(high);
  const amountUsd = typed(amount);
  const plan = useMemo<GridPlan | null>(() => {
    if (!basis) return null;
    return gridPlan({ lower: (lowUsd ?? Number.NaN) / basis.perQuote, upper: (highUsd ?? Number.NaN) / basis.perQuote, levels }, (amountUsd ?? Number.NaN) / basis.perQuote, basis);
  }, [basis?.price, basis?.perQuote, basis?.coinDecimals, basis?.quoteDecimals, lowUsd, highUsd, levels, amountUsd]); // eslint-disable-line react-hooks/exhaustive-deps
  /* On the classic venue: the same plan as the ladder's two legs, and their exact costs. */
  const legs = useMemo(() => (venue === 'dlmm' && classic.pool && plan && !plan.issue ? classicGrid(plan, classic.pool.activePrice, classic.pool.facts) : null), [venue, classic.pool, plan]);
  const legCosts = useMemo(() => (legs && !legs.issue && classic.pool ? ladderCosts(legs.plans, { existingArrays: new Set(classic.pool.existingArrays), bitmapExtension: classic.pool.bitmapExtension }, classic.pool.terms ?? DEFAULT_TERMS) : null), [legs, classic.pool]);

  const quick = BANDS.find((one) => coinUsd && lowUsd && highUsd && Math.abs(lowUsd - coinUsd * (1 - Number(one) / 100)) / coinUsd < 0.002 && Math.abs(highUsd - coinUsd * (1 + Number(one) / 100)) / coinUsd < 0.002) ?? null;

  const busy = useGrid((st) => st.busy);
  const note = useGrid((st) => (st.note?.id === 'new' ? st.note : null));
  const placing = busy?.id === 'new' ? busy : null;
  const network = venue === 'pro' ? (market?.network ?? GRID_NET) : venue === 'dlmm' ? CLASSIC_NET : (GRID_NET ?? CLASSIC_NET);
  const reading = read === 'loading' || classic.read === 'loading';
  /* The coin's venue by the same rule as its mark in the list: «no pool» only once every venue answered — a read that
     failed (a busy route, a network that did not answer) is said as that, never as «no pool». */
  const venueNow = useGrid((st) => venueOf(st.markets[shown.mint], st.classic[shown.mint], VENUES_OPEN));
  const none = !venue && !reading && venueNow === 'none';
  /* No pool takes the coin's orders: one line, and why behind its «i» — whatever the band, nothing can be placed. A
     DLMM Pro lane closed here, with no classic pool either, is «coming». */
  const noPool = none && read !== 'closed';
  const unreachable = !venue && !reading && venueNow === null && (read === 'failed' || classic.read === 'failed');
  const venueIssue = none && read === 'closed' ? w.soon : unreachable ? w.unreachable : null;
  /* A band far past the price is no grid: said, and no step or earning is counted for it. */
  const far = Boolean(coinUsd && lowUsd !== null && highUsd !== null && (lowUsd < coinUsd * FAR_LOW || highUsd > coinUsd * FAR_HIGH));
  const issue = noPool ? null : (venueIssue ?? (far ? w.issueFar : !plan ? null : plan.issue ? issueWord(w, plan.issue) : legs?.issue ? (legs.issue === 'classicSide' ? w.issueClassicSide : w.issueClassicStep) : market && !market.placing ? w.off : null));
  /* No venue takes the coin's orders: no grid is counted or drawn for it — no step, no cycle, no buys and sells. */
  const bare = noPool || venueIssue !== null;
  // The grid over the candles: buys under the price, sells over it, the band's two edges.
  useGridLayer(shown?.mint ?? null, bare || far ? null : plan, basis?.perQuote ?? null, w, lang, phone);
  /* A stock's coin while its exchange is shut: one line before the signature. */
  const stockRisk = useOffHoursRisk(shown.mint);
  /* A pool whose own price stands away from the market's (a thin pool): said before the signature — its orders fill at
     the pool's price, and the band is drawn around it, not around the market's candles. Said too whenever a buy would
     stand over the market's price or a sell under it, however small the gap. */
  const marketUsd = inMarket && !inMarket.unread?.includes('price') && inMarket.price > 0 ? inMarket.price : null;
  const apart = venue && coinUsd && marketUsd ? coinUsd / marketUsd - 1 : 0;
  const crossing = Boolean(venue && marketUsd && plan && basis && !plan.issue && (plan.split.buys.some((level) => level * basis.perQuote > marketUsd) || plan.split.sells.some((level) => level * basis.perQuote < marketUsd)));
  const apartPct = Math.abs(apart) * 100;
  const apartText = apartPct >= 1 ? String(Math.round(apartPct)) : apartPct >= 0.1 ? apartPct.toFixed(1).replace('.', lang === 'uk' ? ',' : '.') : lang === 'uk' ? '<0,1' : '<0.1';
  const poolRisk = Math.abs(apart) >= POOL_APART || crossing ? w.poolOff(digits(lang === 'uk' ? `${apartText} %` : `${apartText}%`, lang), apart > 0) : null;
  const risk = stockRisk ?? poolRisk;
  // «Choose another coin», the chart's head: the coin list opens from outside its field.
  const [openAsk, setOpenAsk] = useState(0);
  const [why, setWhy] = useState(false);
  useEffect(() => setWhy(false), [shown.mint]);

  // Each coin of the list says where its grid would rest, read once as the list shows it.
  const markOf = (mint: string) => <VenueMark mint={mint} w={w} />;
  const onShown = useCallback((mints: readonly string[]) => {
    for (const mint of mints) void useGrid.getState().knowVenue(mint);
  }, []);
  // The band's edges, dragged on the chart: the field takes the price the hand left it at.
  const onEdge = useCallback(
    (edge: 'low' | 'high', usd: number) => {
      (edge === 'low' ? setLow : setHigh)(fieldOf(usd, lang));
    },
    [lang],
  );

  const step = far ? 0 : (plan?.step ?? 0);
  const perCycleUsd = plan && basis && !far ? plan.perLevel * basis.perQuote * step : null;
  const bonusPct = market ? market.bonus.ownerBps / 100 : null;
  const buyCount = plan?.split.buys.length ?? 0;
  const sellCount = plan?.split.sells.length ?? 0;
  const proNet = venue === 'pro' && network ? network : null;
  const rent = proNet ? (plan?.buy ? orderRent(plan.buy.rungs, proNet) : 0) + (plan?.sell ? orderRent(plan.sell.rungs, proNet) : 0) : legCosts ? legCosts.rentBackLamports : 0;
  /* On the classic venue a new bin array's rent stays with the pool: it is spent, counted with the network's fee. */
  const fee = proNet ? (plan?.buy ? ORDER_FEE : 0) + (plan?.sell ? ORDER_FEE : 0) : legCosts ? legCosts.networkLamports + legCosts.rentKeptLamports : 0;
  const ready = venue === 'pro' ? Boolean(market?.placing && (plan?.buy || plan?.sell)) : venue === 'dlmm' ? Boolean(legs && !legs.issue && legs.legs.length) : false;
  const canPlace = Boolean(owner && plan && !plan.issue && !issue && !busy && ready);

  const place = () => {
    if (!owner) return connect();
    if (!canPlace || !plan || !shown || !decimals) return;
    const shape = { lower: plan.prices[0]!, upper: plan.prices[plan.prices.length - 1]!, levels };
    const total = (amountUsd ?? 0) / (basis?.perQuote ?? 1);
    if (venue === 'pro' && market) {
      void useGrid.getState().place({ owner, market, coin: { mint: shown.mint, symbol: shown.symbol, decimals: market.coin.decimals }, shape, amount: total, intents: { buy: plan.buy, sell: plan.sell } });
      return;
    }
    if (venue === 'dlmm' && classic.pool && connection) {
      const quoteMint = classic.pool.facts.quoteMint;
      void useGrid.getState().placeClassic({ owner, wallet: connection.wallet, pool: classic.pool, coin: { mint: shown.mint, symbol: shown.symbol, decimals: decimals.coin }, quote: { mint: quoteMint, symbol: towers.get(quoteMint)?.symbol ?? 'USDC', decimals: decimals.quote }, shape, amount: total });
    }
  };

  const said = placing ? null : note ? w[note.kind] : null;
  const actionWord = placing ? (placing.phase === 'sending' ? w.sending : w.signing) : !network ? w.soon : w.place;
  /* The venue in the head once it is known: never «DLMM Pro» over a coin whose pool is not read yet. */
  const kick = venue === 'dlmm' ? (network === 'devnet' ? w.testKickDlmm : w.kickDlmm) : venue === 'pro' ? (network === 'devnet' ? w.testKick : w.kick) : w.kickNone;
  const costText = venue === 'dlmm' ? w.costLineDlmm(lamportsSol(fee, lang), lamportsSol(rent, lang)) : w.costLine(lamportsSol(fee, lang), lamportsSol(rent, lang));

  /* The chart's head: the coin the grid stands on, its price and its day — a tap opens the coin list. */
  const headUsd = marketUsd ?? coinUsd;
  /* The day's move as every screen says it: the newest read of it. */
  const moved = useDayMove(shown.mint);
  const chart = (
    <Panel pad="none" label={w.chartTitle} className={g.chartPanel}>
      <button type="button" className={g.chartHead} onClick={() => setOpenAsk((n) => n + 1)} aria-label={`${shown.symbol} · ${w.otherCoin}`} data-grid-head="">
        <CoinLogo src={shown.icon} symbol={shown.symbol} size="s" />
        <span className={g.headSymbol}>{shown.symbol}</span>
        <span className={g.headPrice}>{headUsd ? priceText(headUsd, lang) : '—'}</span>
        {moved !== null ? <span className={changeTone(moved) === 'up' ? g.headUp : changeTone(moved) === 'down' ? g.headDown : g.headFlat}>{changeText(moved, lang)}</span> : null}
        <VenueMark mint={shown.mint} w={w} />
        <Icon name="chevron" size="s" />
      </button>
      <GridChart tower={tower ?? null} sym={shown?.symbol ?? ''} phone={phone} plan={plan} perQuote={basis?.perQuote ?? null} edges={lowUsd !== null && highUsd !== null && highUsd > lowUsd && !far && !bare ? { low: lowUsd, high: highUsd } : null} onEdge={onEdge} />
    </Panel>
  );

  const form = (
    <Panel tone="hi" pad="l" gap={16} label={w.title} className={g.sheet}>
      <div className={b.head}>
        <BotBadge id="grid" on />
        <div className={b.headWords}>
          <Kick>{kick}</Kick>
          <Title as="h2" className={b.headTitle}>
            {w.title}
          </Title>
        </div>
        <HowInfo lines={venue === 'dlmm' ? [w.howOrdersDlmm, w.howCycleDlmm, w.howSafe] : [w.howOrders, w.howCycle, w.howEarned, w.howAuto, w.howSafe]} />
      </div>
      <CoinAmount coin={shown} amount={amount} onAmount={setAmount} onCoin={(next) => setCoin(next)} anyCoin mark={markOf} onShown={onShown} openAsk={openAsk} />
      <div className={g.group}>
        <div className={b.twoUp}>
          <AmountField size="s" label={w.low} unit="$" value={low} onChange={ownLow} />
          <AmountField size="s" label={w.high} unit="$" value={high} onChange={ownHigh} />
        </div>
        {/* The band's width: three quick ones here, any other typed above or dragged on the chart. */}
        <Shares label={w.band} value={quick} onPick={(id) => ownBand(Number(id))} options={BANDS.map((id) => ({ id, label: w.bandValue(digits(id, lang)) }))} />
      </div>
      <div className={g.group}>
        <div className={g.levelsHead}>
          <Kick>{w.levels}</Kick>
          <span className={g.levelsCount} data-grid-levels="">
            {digits(String(levels), lang)}
          </span>
        </div>
        <Slider label={w.levels} min={GRID_MIN_LEVELS} max={GRID_MAX_LEVELS} value={levels} valueText={digits(String(levels), lang)} onChange={(next) => setLevels(Math.round(next))} />
        <LevelStrip plan={bare || far ? null : plan} price={basis?.price ?? null} />
      </div>
      {bare ? null : (
        <>
          <div className={g.threeUp}>
            <Stat label={w.step} value={step > 0 ? pctText(step, lang) : '—'} />
            <Stat label={w.perCycle} value={perCycleUsd !== null && perCycleUsd > 0 ? `+${cents(perCycleUsd, lang)}` : '—'} tone={perCycleUsd ? 'up' : undefined} />
            {venue === 'dlmm' ? <Stat label={w.levels} value={far ? '—' : digits(`${buyCount} · ${sellCount}`, lang)} /> : <Stat label={w.bonus} value={bonusPct !== null ? `+${digits(bonusPct.toFixed(2), lang)}%` : '—'} tone={bonusPct ? 'up' : undefined} />}
          </div>
          {/* Before the signature, one line: real or test money and Ryntra's share; the network and the deposit behind its «i». */}
          <div className={g.costRow}>
            <span className={b.line} data-grid-cost="">
              {[!venue ? null : network === 'mainnet' ? w.realMoney : network === 'devnet' ? w.testMoney : null, plan && venue && fee > 0 ? (venue === 'dlmm' ? w.costShortDlmm : w.costShort) : far ? null : w.levelsOf(digits(String(buyCount), lang), digits(String(sellCount), lang))].filter(Boolean).join(' · ')}
            </span>
            {plan && venue && fee > 0 && !far ? <Info label={w.costHow}>{costText}</Info> : null}
          </div>
        </>
      )}
      {risk ? (
        <p className={b.risk} data-grid-risk="">
          {risk}
        </p>
      ) : null}
      <Note warn={noPool || Boolean(issue) || Boolean(note && WARN_NOTES.has(note.kind))}>
        {noPool ? (
          <span className={g.noPool} data-grid-no-pool="">
            {w.noPoolShort}
            <button type="button" className={g.why} aria-expanded={why} onClick={() => setWhy((was) => !was)}>
              {w.why}
              <Icon name="chevron" size="s" />
            </button>
          </span>
        ) : (
          (issue ?? said ?? (reading ? w.reading : null))
        )}
      </Note>
      {/* Why there is no grid here: opened in place under its line, never over the action. */}
      {noPool && why ? (
        <p className={g.whyText} data-grid-why="">
          {w.noPoolWhy}
        </p>
      ) : null}
      {noPool ? (
        <Quiet full onClick={() => setOpenAsk((n) => n + 1)} data-grid-other="">
          {w.otherCoin}
        </Quiet>
      ) : !owner && network ? (
        <Action onClick={connect} data-grid-connect="">
          {wallet.connect}
        </Action>
      ) : (
        <Action busy={Boolean(placing)} disabled={!canPlace} onClick={place} data-grid-place="">
          {actionWord}
        </Action>
      )}
    </Panel>
  );

  return lay({ chart, form, mine: <MyGrids owner={owner} /> });
}

/** One figure of the grid in small: its name over its number, on one line each at a form's narrowest. */
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className={g.stat}>
      <Kick className={g.statLabel}>{label}</Kick>
      <Figure size="s" value={value} tone={tone} />
    </div>
  );
}

/**
 * Where a coin's grid would rest, beside it in the list: DLMM Pro, DLMM, no pool — nothing while it is read. Each mark
 * reads its own coin's entry of the store, so a read that answers redraws that row alone.
 */
function VenueMark({ mint, w }: { mint: string; w: W }) {
  const venue: CoinVenue | null = useGrid((st) => venueOf(st.markets[mint], st.classic[mint], VENUES_OPEN));
  if (!venue) return null;
  return (
    <span className={g.venue} data-venue={venue}>
      {venue === 'pro' ? w.venuePro : venue === 'dlmm' ? w.venueDlmm : w.venueNone}
    </span>
  );
}

/** The levels in a line under the slider: a mark for each, buys in one colour, sells in the other, the price between. */
function LevelStrip({ plan, price }: { plan: GridPlan | null; price: number | null }) {
  if (!plan || !plan.prices.length || !price) return <div className={g.strip} aria-hidden="true" />;
  const lo = Math.log(plan.prices[0]!);
  const hi = Math.log(plan.prices[plan.prices.length - 1]!);
  const span = hi - lo || 1;
  const x = (value: number) => 2 + ((Math.log(value) - lo) / span) * 96;
  const buys = new Set(plan.split.buys);
  const sells = new Set(plan.split.sells);
  const at = Math.min(98, Math.max(2, x(price)));
  return (
    <svg className={g.strip} viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true" data-grid-strip="">
      {plan.prices.map((level) => (
        <line key={level} x1={x(level)} x2={x(level)} y1={4} y2={16} className={buys.has(level) ? g.buy : sells.has(level) ? g.sell : g.skip} vectorEffect="non-scaling-stroke" />
      ))}
      <line x1={at} x2={at} y1={0} y2={20} className={g.now} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * The grid over the coin's chart: each level a line — buys under the price, sells over it — and the band's two edges
 * with their prices. Written to the chart's own layer (`terminal/coin/chart-layer.ts`), in the chart's dollars.
 */
function useGridLayer(mint: string | null, plan: GridPlan | null, perQuote: number | null, w: W, lang: Lang, phone: boolean): void {
  useEffect(() => {
    if (!mint) return;
    if (!plan || !plan.prices.length || perQuote === null) {
      setLayer(mint, 'ladder', null);
      return;
    }
    const buys = new Set(plan.split.buys);
    const sells = new Set(plan.split.sells);
    const lines: LayerLine[] = plan.prices.map((level, at) => {
      const usd = level * perQuote;
      const edge = at === 0 || at === plan.prices.length - 1;
      return { id: `grid-${at}`, price: usd, tone: buys.has(level) ? 'held' : sells.has(level) ? 'draft' : 'resting', tag: edge ? priceText(usd, lang) : null };
    });
    /* A phone's chart bar has no room for the badge: the form under the chart says the levels. */
    setLayer(mint, 'ladder', { lines, badge: phone ? null : `${w.title} · ${digits(String(plan.prices.length), lang)} ${w.levelsWord(plan.prices.length)}` });
    return () => setLayer(mint, 'ladder', null);
  }, [mint, plan, perQuote, w, lang, phone]);
}

/** One arrow key on an edge's grip moves it this share of its price. */
const GRIP_STEP = 0.005;
/** The two edges never come closer than this share of the price: a band, not a line. */
const GRIP_GAP = 0.002;

/**
 * The coin's chart with the grid over it: the Spot's own chart (`terminal/coin/CoinChart.tsx`), sells in the flare's
 * colour, the band between its edges in a quiet light. The band follows the chart's own lines as it pans and zooms. On
 * a desk the band's two edges carry a grip each: dragged (or moved with the arrows), the form's low or high takes the
 * price — as a grid bot's chart does at Binance, OKX and Pionex. Nothing is placed by a drag.
 */
function GridChart({
  tower,
  sym,
  phone,
  plan,
  perQuote,
  edges,
  onEdge,
}: {
  tower: Tower | null;
  sym: string;
  phone: boolean;
  plan: GridPlan | null;
  perQuote: number | null;
  edges: Readonly<{ low: number; high: number }> | null;
  onEdge: (edge: 'low' | 'high', usd: number) => void;
}) {
  const w = useWords(GRID);
  const box = useRef<HTMLDivElement>(null);
  const at = (value: number | undefined) => (value !== undefined && perQuote !== null ? decimalOf(value * perQuote) : null);
  const low = edges ? at(plan?.prices[0]) : null;
  const high = edges ? at(plan?.prices.at(-1)) : null;
  useBand(box, low, high);
  const grips = !phone && edges && low && high;
  // The sells in the flare's colour, the band's two edges solid: by the line's price, as the chart's own sheet finds a line.
  const sheet = useMemo(() => {
    if (!plan || perQuote === null) return '';
    const row = (price: string | null) => `[data-grid-chart] [data-coin-layer] .ryntra-trade__row--level[data-price="${price}"]`;
    const rules = plan.split.sells.map((level) => `${row(at(level))}{--tone:var(--flare)}`);
    for (const edge of [low, high]) if (edge) rules.push(`${row(edge)}{--tone:var(--lilac)}`, `${row(edge)} .ryntra-trade__rule{border-top-style:solid;opacity:1}`);
    return rules.join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, perQuote, low, high]);
  if (!tower) return <div className={g.chartWait} aria-busy="true" />;
  return (
    <div ref={box} className={g.chart} data-grid-chart="">
      {sheet ? <style>{sheet}</style> : null}
      <CoinChart coin={tower} sym={sym} cap={null} trades={NO_TRADES} phone={phone} />
      <div className={g.bandShade} aria-hidden="true" data-grid-band="" />
      {grips ? (
        <>
          <EdgeGrip edge="high" label={w.dragHigh} edges={edges} box={box} onEdge={onEdge} />
          <EdgeGrip edge="low" label={w.dragLow} edges={edges} box={box} onEdge={onEdge} />
        </>
      ) : null}
    </div>
  );
}

const NO_TRADES: readonly never[] = [];

/**
 * One edge's grip on the chart, placed by the band's light (`useBand` writes where the edges stand). A drag reads the
 * chart's own scale as the edges stood when it began — the price a pixel — and moves only its own edge, never past the
 * other one; the arrow keys move it by half a percent. The grip is the form's field in the hand: it signs nothing.
 */
function EdgeGrip({ edge, label, edges, box, onEdge }: { edge: 'low' | 'high'; label: string; edges: Readonly<{ low: number; high: number }>; box: RefObject<HTMLDivElement | null>; onEdge: (edge: 'low' | 'high', usd: number) => void }) {
  const lang = useLang();
  const held = useRef<Readonly<{ y: number; price: number; perPx: number; other: number }> | null>(null);
  const frame = useRef(0);
  const [moving, setMoving] = useState(false);
  const value = edges[edge];
  const other = edge === 'low' ? edges.high : edges.low;
  /** The price kept on its side of the other edge, and above nothing. */
  const kept = (price: number, against: number) => (edge === 'low' ? Math.min(price, against * (1 - GRIP_GAP)) : Math.max(price, against * (1 + GRIP_GAP)));
  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !box.current) return;
    /* The chart's scale now, from two of its lines on screen — the highest and the lowest price drawn: a price a pixel. */
    const rows = [...box.current.querySelectorAll<HTMLElement>('.ryntra-trade__row--level:not([data-off])')]
      .map((row) => ({ price: Number(row.dataset.price), y: row.getBoundingClientRect().top }))
      .filter((row) => Number.isFinite(row.price) && row.price > 0);
    if (rows.length < 2) return;
    const top = rows.reduce((a, row) => (row.price > a.price ? row : a));
    const bottom = rows.reduce((a, row) => (row.price < a.price ? row : a));
    const span = bottom.y - top.y;
    if (!(span > 0)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    held.current = { y: event.clientY, price: value, perPx: (top.price - bottom.price) / span, other };
    setMoving(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = held.current;
    if (!start) return;
    const next = kept(start.price - (event.clientY - start.y) * start.perPx, start.other);
    if (!(next > 0)) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onEdge(edge, next));
  };
  const drop = () => {
    held.current = null;
    setMoving(false);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    /* Arrows half a percent, Page Up and Page Down five. */
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[event.key] ?? 0;
    if (!step) return;
    event.preventDefault();
    const next = kept(value * (1 + step * GRIP_STEP), other);
    if (next > 0) onEdge(edge, next);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  /* The edge's room: the low one between nothing and the high one, the high one from the low one up. */
  const [min, max] = edge === 'low' ? [0, other] : [other, other * 4];
  return (
    <div
      role="slider"
      tabIndex={0}
      className={g.grip}
      data-grid-grip={edge}
      data-moving={moving ? '' : undefined}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={priceText(value, lang)}
      onPointerDown={grab}
      onPointerMove={move}
      onPointerUp={drop}
      onPointerCancel={drop}
      onLostPointerCapture={drop}
      onKeyDown={key}
    >
      <span className={g.gripLine} aria-hidden="true" />
    </div>
  );
}

/** Where an edge's grip stands: this far left of the plot's right end, so the price's tag beside it stays readable. */
const GRIP_INSET = 96;

/**
 * The band's light between its edges: the core chart places each line by its `top`, so the light reads the two edge
 * lines where they are and stands between them, at every move of the chart. The edges' grips stand on the light's top
 * and bottom.
 */
function useBand(box: RefObject<HTMLDivElement | null>, low: string | null, high: string | null): void {
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const shade = root.querySelector<HTMLElement>('[data-grid-band]');
    if (!shade) return;
    let frame = 0;
    const grips = () => [...root.querySelectorAll<HTMLElement>('[data-grid-grip]')];
    const place = () => {
      frame = 0;
      const hide = () => {
        if (!shade.hidden) shade.hidden = true;
        for (const grip of grips()) if (grip.dataset.placed !== undefined) delete grip.dataset.placed;
      };
      const layer = root.querySelector<HTMLElement>('.ryntra-trade');
      if (!high || !low || !layer) return hide();
      const at = root.getBoundingClientRect();
      const box = layer.getBoundingClientRect();
      const plotTop = parseFloat(layer.style.getPropertyValue('--plot-top'));
      const plotHeight = parseFloat(layer.style.getPropertyValue('--plot-height'));
      const plotLeft = parseFloat(layer.style.getPropertyValue('--plot-left'));
      const plotWidth = parseFloat(layer.style.getPropertyValue('--plot-width'));
      if (![plotTop, plotHeight, plotLeft, plotWidth].every(Number.isFinite)) return hide();
      /* The prices on screen now, by the levels the core draws: an edge it does not draw is past the top or the bottom. */
      const shown = [...layer.querySelectorAll<HTMLElement>('.ryntra-trade__row--level:not([data-off])')].map((row) => Number(row.dataset.price)).filter(Number.isFinite);
      const yOf = (price: string): number | null => {
        const row = layer.querySelector<HTMLElement>(`.ryntra-trade__row--level[data-price="${price}"]`);
        if (!row) return null;
        if (row.dataset.off === undefined) return row.getBoundingClientRect().top - box.top;
        if (!shown.length) return null;
        return Number(price) > Math.max(...shown) ? plotTop : Number(price) < Math.min(...shown) ? plotTop + plotHeight : null;
      };
      const yHigh = yOf(high);
      const yLow = yOf(low);
      if (yHigh === null || yLow === null || yLow <= yHigh) return hide();
      /* An edge past the top or the bottom of the plot has no grip: the light stops at the plot's edge, not at the price. */
      const off = { high: layer.querySelector<HTMLElement>(`.ryntra-trade__row--level[data-price="${high}"]`)?.dataset.off !== undefined, low: layer.querySelector<HTMLElement>(`.ryntra-trade__row--level[data-price="${low}"]`)?.dataset.off !== undefined };
      const gripOn = (grip: HTMLElement) => !off[grip.dataset.gridGrip === 'high' ? 'high' : 'low'];
      const next = `${Math.round(box.left - at.left + plotLeft)},${Math.round(box.top - at.top + yHigh)},${Math.round(plotWidth)},${Math.round(yLow - yHigh)}`;
      /* Written only when it moved: its own writes are style changes the watch below would see again. */
      if (shade.dataset.at === next && !shade.hidden && grips().every((grip) => (grip.dataset.placed !== undefined) === gripOn(grip))) return;
      const [x, y, width, height] = next.split(',').map(Number) as [number, number, number, number];
      shade.dataset.at = next;
      shade.hidden = false;
      shade.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      shade.style.width = `${width}px`;
      shade.style.height = `${height}px`;
      for (const grip of grips()) {
        if (!gripOn(grip)) {
          delete grip.dataset.placed;
          continue;
        }
        const top = grip.dataset.gridGrip === 'high' ? y : y + height;
        grip.style.transform = `translate3d(${Math.max(x, x + width - GRIP_INSET)}px, ${top}px, 0)`;
        grip.dataset.placed = '';
      }
    };
    const ask = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const watch = new MutationObserver(ask);
    watch.observe(root, { subtree: true, attributes: true, attributeFilter: ['style', 'data-edge'], childList: true });
    const resize = new ResizeObserver(ask);
    resize.observe(root);
    ask();
    return () => {
      watch.disconnect();
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [box, low, high]);
}

/* ── the person's grids ─────────────────────────────────────────────────── */

const WHEN: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };

/** The wallet's grids, each on its venue's network, read back from the chain every half minute while one still stands. */
function MyGrids({ owner }: { owner: string | null }) {
  const w = useWords(GRID);
  const lang = useLang();
  const grids = useGrid((st) => st.grids);
  const orders = useGrid((st) => st.orders);
  const reads = useGrid((st) => st.reads);
  useEffect(() => useGrid.getState().hydrate(), []);
  const mine = useMemo(() => (owner ? grids.filter((one) => one.owner === owner && netOf(one.venue) !== null && one.network === netOf(one.venue)) : []), [grids, owner]);
  /* The coins of the grids still standing, and whether any stands on the classic venue: what to read. */
  const coins = useMemo(() => [...new Set(mine.filter((one) => one.stoppedAt === null && one.venue === 'pro').map((one) => one.coin.mint))].join(','), [mine]);
  const classicOpen = mine.some((one) => one.stoppedAt === null && one.venue === 'dlmm');
  useEffect(() => {
    if (!owner || (!coins && !classicOpen)) return;
    const read = () => {
      for (const mint of coins ? coins.split(',') : []) void useGrid.getState().readOrders(owner, mint);
      if (classicOpen) void useGrid.getState().readClassic(owner);
    };
    read();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') read();
    }, 30_000);
    return () => clearInterval(timer);
  }, [owner, coins, classicOpen]);
  const views = mine.map((record) => {
    const read = orders[ordersKey(record.owner, record.coin.mint)];
    const ready = record.venue === 'dlmm' || read?.status === 'ready';
    return { record, ready, view: record.venue === 'dlmm' ? classicView(record, reads) : gridView(record, read?.value ?? []) };
  });
  const working = views.filter(({ view }) => view.state === 'working' || view.state === 'filled').length;
  return (
    <Panel pad="none" label={w.mine}>
      <div className={b.mineHead}>
        <Title as="h2" className={b.mineTitle}>
          {w.mine}
        </Title>
        {working ? (
          <Chip tone="ok" dot>
            {digits(String(working), lang)}
          </Chip>
        ) : null}
      </div>
      {!owner ? (
        <p className={b.empty}>{w.connectToSee}</p>
      ) : !views.length ? (
        <p className={b.empty}>{w.mineEmpty}</p>
      ) : (
        <div className={g.cards}>
          {views.map(({ record, view, ready }) => (
            <GridCard key={record.id} record={record} view={view} ready={ready} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function stateWord(w: W, view: GridView): string {
  return { working: w.stateWorking, filled: w.stateFilled, idle: w.stateIdle, stopped: w.stateStopped }[view.state];
}

/**
 * One grid: its band in small with the price on it, how many prices filled, what it earned and the maker's bonus, and
 * the steps that are the person's to take. A step waits for the chain's read of the grid's orders: nothing is taken,
 * placed or stopped on a read that has not answered. On the classic venue «Place again» takes the grid back and places
 * it again around the price — the classic orders give back what filled only with the order.
 */
function GridCard({ record, view, ready }: { record: GridRecord; view: GridView; ready: boolean }) {
  const w = useWords(GRID);
  const lang = useLang();
  const towers = useTowers();
  const busy = useGrid((st) => st.busy);
  const note = useGrid((st) => (st.note?.id === record.id ? st.note : null));
  const proMarket = useGrid((st) => st.markets[record.coin.mint]?.value ?? null);
  const classicPool = useGrid((st) => st.classic[record.coin.mint]?.value ?? null);
  const wallet = useWallet((st) => st.connection?.wallet ?? null);
  const live = record.stoppedAt === null;
  useEffect(() => {
    if (!live) return;
    if (record.venue === 'dlmm') void useGrid.getState().loadClassic(record.coin.mint);
    else void useGrid.getState().loadMarket(record.coin.mint);
  }, [record.coin.mint, record.venue, live]);
  const tower = towers.get(record.coin.mint);
  const price = record.venue === 'dlmm' ? (classicPool?.activePrice ?? null) : (proMarket?.price ?? null);
  const perQuote = quoteUsd(record.quote.mint, towers);
  const coinUsd = price && perQuote ? price * perQuote : tower && tower.price > 0 ? tower.price : null;
  const refill = record.venue === 'pro' && price ? gridRefill(record, view, price) : { buy: null, sell: null };
  const mine = busy?.id === record.id ? busy : null;
  const inUsd = (raw: bigint, mint: string) => {
    if (mint === record.quote.mint) return perQuote !== null ? wholeOf(raw, record.quote.decimals) * perQuote : null;
    if (mint === record.coin.mint) return coinUsd !== null ? wholeOf(raw, record.coin.decimals) * coinUsd : null;
    return null;
  };
  const earnedUsd = inUsd(view.profitRaw < 0n ? -view.profitRaw : view.profitRaw, record.quote.mint);
  const sign = view.profitRaw < 0n ? '−' : '+';
  const earnedText = view.profitRaw === 0n ? '—' : earnedUsd !== null ? `${sign}${cents(earnedUsd, lang)}` : `${sign}${amountOf(wholeOf(view.profitRaw < 0n ? -view.profitRaw : view.profitRaw, record.quote.decimals), 4, lang)} ${record.quote.symbol}`;
  const bonusUsd = Object.entries(view.bonus).reduce<number | null>((sum, [mint, raw]) => {
    const usd = inUsd(raw, mint);
    return usd === null ? sum : (sum ?? 0) + usd;
  }, null);
  const word = (action: GridAction, idle: string) => (mine?.action === action ? (mine.phase === 'sending' ? w.sending : w.signing) : idle);
  const locked = busy !== null || !ready;
  const chip = (
    <Chip tone={view.state === 'working' ? 'ok' : view.state === 'filled' ? 'warn' : 'plain'} dot={view.state === 'working'}>
      {stateWord(w, view)}
    </Chip>
  );
  const again = () => {
    if (record.venue === 'dlmm') {
      if (wallet) void useGrid.getState().againClassic(record.id, wallet);
      return;
    }
    void useGrid.getState().again(record.id);
  };
  const stop = () => {
    if (record.venue === 'dlmm') {
      if (wallet) void useGrid.getState().stopClassic(record.id, wallet);
      return;
    }
    void useGrid.getState().stop(record.id);
  };
  const canAgain = record.venue === 'dlmm' ? Boolean(classicPool && wallet && (view.waiting > 0 || record.orders.length === 0)) : Boolean(price && (refill.buy || refill.sell));
  return (
    <article className={g.card} aria-label={record.coin.symbol} data-grid-card={view.state}>
      <div className={b.cardHead}>
        <CoinLogo src={`/api/icon/${record.coin.mint}`} symbol={record.coin.symbol} size="l" />
        <span className={b.coinWords}>
          <Title as="h3" className={b.name}>
            {record.coin.symbol}
          </Title>
          <span className={b.sub}>{w.since(dateText(record.createdAt, WHEN, lang))}</span>
        </span>
        {chip}
      </div>
      <MiniGrid record={record} price={price} view={view} />
      <div className={g.threeUp}>
        <span className={b.figureCol}>
          <Kick>{w.filled}</Kick>
          <Figure size="s" value={digits(String(view.filled), lang)} />
        </span>
        {record.venue === 'pro' ? (
          <>
            <span className={b.figureCol}>
              <Kick>{w.earned}</Kick>
              <Figure size="s" value={earnedText} tone={view.profitRaw > 0n ? 'up' : view.profitRaw < 0n ? 'down' : undefined} />
            </span>
            <span className={b.figureCol}>
              <Kick>{w.bonus}</Kick>
              <Figure size="s" value={bonusUsd ? `+${cents(bonusUsd, lang)}` : '—'} tone={bonusUsd ? 'up' : undefined} />
            </span>
          </>
        ) : (
          <span className={b.figureCol}>
            <Kick>{w.resting}</Kick>
            <Figure size="s" value={digits(String(view.resting), lang)} />
          </span>
        )}
      </div>
      {note && !mine ? <Note warn={WARN_NOTES.has(note.kind)}>{w[note.kind]}</Note> : null}
      {live ? (
        <div className={g.cardSteps}>
          {record.venue === 'pro' ? (
            <Quiet size="s" disabled={locked || !view.canTake} onClick={() => void useGrid.getState().take(record.id)} data-grid-take="">
              {word('take', w.take)}
            </Quiet>
          ) : null}
          <Quiet size="s" disabled={locked || !canAgain} onClick={again} data-grid-again="">
            {word('again', w.placeAgain)}
          </Quiet>
          <Quiet size="s" disabled={locked || (record.venue === 'dlmm' && !wallet)} onClick={stop} data-grid-stop="">
            {word('stop', w.stop)}
          </Quiet>
        </div>
      ) : null}
    </article>
  );
}

/** A grid in small: its levels across the band, buys and sells by where the price is now, the price itself, and how much filled. */
function MiniGrid({ record, price, view }: { record: GridRecord; price: number | null; view: GridView }) {
  const prices = gridPrices(record.shape);
  if (!prices.length) return null;
  const lo = Math.log(prices[0]!);
  const hi = Math.log(prices[prices.length - 1]!);
  const pad = (hi - lo) * 0.12 || 0.05;
  const y = (value: number) => 4 + (1 - (Math.log(value) - (lo - pad)) / (hi - lo + 2 * pad)) * 64;
  const step = gridStep(record.shape);
  const done = view.resting + view.waiting > 0 ? view.waiting / (view.resting + view.waiting) : 0;
  return (
    <svg className={g.mini} viewBox="0 0 100 72" preserveAspectRatio="none" aria-hidden="true" data-grid-mini="">
      {prices.map((level) => {
        const side = price === null ? 'skip' : Math.abs(level / price - 1) < step / 2 ? 'skip' : level < price ? 'buy' : 'sell';
        return <line key={level} x1={0} x2={100} y1={y(level)} y2={y(level)} className={side === 'buy' ? g.buy : side === 'sell' ? g.sell : g.skip} vectorEffect="non-scaling-stroke" />;
      })}
      {price !== null ? <line x1={0} x2={100} y1={Math.min(70, Math.max(2, y(price)))} y2={Math.min(70, Math.max(2, y(price)))} className={g.now} vectorEffect="non-scaling-stroke" /> : null}
      <rect x={0} y={70} width={100 * done} height={2} className={g.fill} />
    </svg>
  );
}

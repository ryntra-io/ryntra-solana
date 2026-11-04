'use client';

import { AGENTS_OPEN } from '@/city/lib/agent/flag';
import { GARAGE_OPEN } from '@/city/lib/agent/garage/flag';
import { openGarage } from '@/city/lib/agent/garage/show';
import { isBotTab, openBots, useBotsWindow } from '@/city/lib/bots/open';
import { useTowerChart } from '@/city/lib/chart/store';
import { useCity } from '@/city/lib/city/store';
import { PREDICT_OPEN } from '@/city/lib/districts/predict/flag';
import { usePredict } from '@/city/lib/districts/predict/store';
import { EARN_OPEN } from '@/city/lib/earn/flag';
import { openEarn } from '@/city/lib/earn/open';
import { EXCHANGE_OPEN } from '@/city/lib/exchange/flag';
import { useExchange } from '@/city/lib/exchange/store';
import { useNewLaunches } from '@/city/lib/lens/new-store';
import { useLens } from '@/city/lib/lens/store';
import { GUARD_OPEN } from '@/city/lib/guard/flag';
import { openGuard } from '@/city/lib/guard/store';
import { marketForTower } from '@/city/lib/exchange/markets';
import { launchTowerIn, useLaunch } from '@/city/lib/launch/district';
import { isNamed, type Tower } from '@/city/lib/market/types';
import { isMoneyAsk } from '@/city/lib/money/flag';
import { openMoney, useMoney } from '@/city/lib/money/open';
import { TRADE_OPEN } from '@/city/lib/trade/gates';
import { useTrade, type View } from '@/city/lib/trade/store';
import { SOL } from '@/city/lib/trade/tiles';
import { cleanParams, type Params } from '@/city/lib/window/detach';
import { useWindows } from '@/city/lib/window/store';

/**
 * The windows a layout can open (CITY-84), each through its own owner — exactly as a tap in the city opens it: the
 * chart through the chart's store, the swap through the trade card's, Money through `openMoney`. Each says whether it
 * can open here (its switch, a tower to show) and opens on what the layout kept (a tower, a market) or on the tower in
 * front of the person. Nothing here signs, reads a wallet or moves money.
 */

type Opener = Readonly<{
  can: () => boolean;
  open: (params?: Params) => void;
  /** What the window shows now, for its chip in the tray: the window opens on it again. */
  showing?: () => Params;
  /**
   * The window's owner may hold it open out of sight (the trade card behind the tower's chart): a layout without it lets
   * it go, so it does not come back by itself.
   */
  shut?: () => void;
}>;

const named = () => useCity.getState().layout.towers.filter((t) => isNamed(t.tower)).map((t) => t.tower);

/** The tower a layout opens on: the one kept, the one picked, the trade card's, Solana's own, or the first named. */
function subject(params?: Params): Tower | null {
  const towers = named();
  const find = (id: string | null | undefined) => (id ? (towers.find((t) => t.id === id) ?? null) : null);
  const trade = useTrade.getState();
  return find(params?.tower) ?? find(useCity.getState().selectedId) ?? find(trade.open ? trade.tower?.mint : null) ?? find(SOL.mint) ?? towers[0] ?? null;
}

/**
 * The trade card on a coin, as the plain swap or as spot. A card folded into the tray comes back on its own coin —
 * named or not, standing in the city or not — and a launch's coin on its own curve or pool through the Launch engine,
 * never through Jupiter (CITY-138), as a tap on its tower opens it. A layout opens it on the tower in front of the
 * person, else Solana.
 */
function openTrade(view: View, params?: Params): void {
  const trade = useTrade.getState();
  if (trade.open && trade.tower) return trade.setView(view);
  const mint = params?.tower;
  const standing = mint ? (useCity.getState().layout.towers.find((t) => t.tower.id === mint)?.tower ?? null) : null;
  const kept: Tower | null = standing ?? (mint ? ({ id: mint, symbol: params?.symbol ?? '', name: params?.symbol ?? '', icon: `/api/icon/${mint}` } as Tower) : null);
  const coin = kept ?? subject(params) ?? ({ id: SOL.mint, symbol: SOL.symbol, name: SOL.name ?? SOL.symbol, icon: SOL.icon ?? null } as Tower);
  const launch = params?.launch === '1' || launchTowerIn(useLaunch.getState(), coin.id) !== null;
  // Never through the coin's link: that lets the picked tower go, and the chart with it.
  trade.openFor(coin, 'buy', { view, launch });
}

const NOTHING: Params = {};
const tradeShowing = (): Params => {
  const { tower, launch } = useTrade.getState();
  if (!tower) return NOTHING;
  return { tower: tower.mint, symbol: tower.symbol, ...(launch ? { launch: '1' } : {}) };
};
const tradeShut = () => useTrade.getState().close();

export const OPENERS: Readonly<Record<string, Opener>> = {
  chart: {
    can: () => named().length > 0,
    open: (params) => {
      const tower = subject(params);
      if (tower) useTowerChart.getState().open(tower.id);
    },
    showing: (): Params => {
      const mint = useTowerChart.getState().mint;
      return mint ? { tower: mint } : NOTHING;
    },
  },
  swap: { can: () => TRADE_OPEN, open: (params) => openTrade('swap', params), showing: tradeShowing, shut: tradeShut },
  spot: { can: () => TRADE_OPEN, open: (params) => openTrade('spot', params), showing: tradeShowing, shut: tradeShut },
  exchange: {
    can: () => EXCHANGE_OPEN,
    open: (params) => useExchange.getState().show(params?.symbol ?? null),
    showing: (): Params => {
      const symbol = useExchange.getState().symbol;
      return symbol ? { symbol } : NOTHING;
    },
  },
  predict: { can: () => PREDICT_OPEN, open: () => usePredict.getState().show() },
  // Money's reading tabs are open with the window itself; what moves money stays behind its own switch inside.
  money: { can: () => true, open: (params) => openMoney(isMoneyAsk(params?.tab) ? params.tab : undefined), showing: () => ({ tab: useMoney.getState().tab }) },
  bots: { can: () => AGENTS_OPEN, open: (params) => openBots(isBotTab(params?.tab) ? params.tab : undefined), showing: () => ({ tab: useBotsWindow.getState().tab }) },
  earn: { can: () => EARN_OPEN, open: () => openEarn() },
  // The garage agent (CITY-29): folded into the tray or kept in a layout, it opens again as the Deck's door opens it.
  garage: { can: () => GARAGE_OPEN, open: () => openGarage() },
  guard: { can: () => GUARD_OPEN, open: () => openGuard() },
  // «New launches on Solana» (CITY-191): the list belongs to «New», so its chip picks «New» and opens the list.
  'new-launches': {
    can: () => true,
    open: () => {
      useLens.getState().pick('new');
      useNewLaunches.getState().setList(true);
    },
  },
};

const openerOf = (id: string): Opener | null => (Object.hasOwn(OPENERS, id) ? OPENERS[id]! : null);

/** Whether a layout can open this window here. */
export const canOpen = (id: string): boolean => openerOf(id)?.can() ?? false;

/** A layout's window opened by its owner, on what the layout kept. */
export function openFor(id: string, params?: Params): void {
  if (canOpen(id)) openerOf(id)!.open(params);
}

/** What a window shows now, for its chip: it opens on it again. */
export function showingOf(id: string): Params {
  return cleanParams(openerOf(id)?.showing?.() ?? {});
}

/**
 * What a layout opens its chart and Exchange on, taken before anything closes (closing the trade card lets its tower
 * go): the tower in front of the person, and that coin's perpetual when it has one.
 */
export function layoutSubject(): Params {
  const tower = subject();
  if (!tower) return NOTHING;
  const market = marketForTower(tower, useExchange.getState().markets.value?.markets ?? []);
  return cleanParams({ tower: tower.id, ...(market ? { symbol: market.symbol } : {}) });
}

/** The windows a layout lets go out of sight too: an owner's own hidden window the layout does not have. */
export function shutOutside(wanted: ReadonlySet<string>): void {
  const shut = new Set<() => void>();
  for (const [id, opener] of Object.entries(OPENERS)) if (opener.shut && !wanted.has(id)) shut.add(opener.shut);
  // The trade card's two frames share one owner: it goes only when the layout has neither.
  if (wanted.has('swap') || wanted.has('spot')) shut.delete(tradeShut);
  for (const close of shut) close();
}

/**
 * «Minimise» (CITY-84): the window folds into the tray with what it shows now, closed as its own «Close» closes it —
 * nothing of it stays over the city, its owner knows it is closed.
 */
export function foldWindow(id: string): void {
  useWindows.getState().fold(id, showingOf(id));
}

/** A chip tapped: its window opens again through its owner, on what it showed, where it stood. */
export function unfoldChip(id: string): void {
  const chip = useWindows.getState().chips.find((c) => c.id === id);
  if (!chip) return;
  if (!canOpen(id)) return useWindows.getState().dropChip(id);
  openFor(id, chip.params);
}

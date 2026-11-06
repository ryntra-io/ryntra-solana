import { useAgent } from '../agent/store.ts';
import { AUTOPILOT_NET } from '../autopilot/flag.ts';
import { useAutopilot } from '../autopilot/store.ts';
import { MANDATE_NET } from '../bots/mandate.ts';
import { useAssistant } from '../assistant/store.ts';
import { useTowerChart } from '../chart/store.ts';
import { useCity } from '../city/store.ts';
import { openCoin as openCoinByMint, openTower, openTradeCard } from '../coin/open.ts';
import { HARBOR_OPEN } from '../districts/harbor/flag.ts';
import { useHarbor } from '../districts/harbor/store.ts';
import { EARN_OPEN } from '../earn/flag.ts';
import { DOLLAR_OPEN } from '../earn/dollar-gate.ts';
import { useDollar } from '../earn/dollar-store.ts';
import { PILOT_OPEN, usePilot } from '../pilot/store.ts';
import { solPrice } from '../scouts/view.ts';
import { openEarn } from '../earn/open.ts';
import { ONE_SENTENCE_OPEN } from '../instruct/flag.ts';
import { useInstruct } from '../instruct/store.ts';
import { useExchange } from '../exchange/store.ts';
import { launchOpenHere, launchTowerIn, useLaunch } from '../launch/district.ts';
import { openLearn } from '../learn/store.ts';
import { hire } from '../crew/hire.ts';
import { langNow } from '../i18n/lang.ts';
import type { Tower } from '../market/types.ts';
import { NATIVE_ID } from '../money/assets.ts';
import { MONEY_OPEN } from '../money/flag.ts';
import { openMoney, useMoney } from '../money/open.ts';
import { SPOT_OPEN, TRADE_OPEN } from '../trade/gates.ts';
import { pairKey, useSpot } from '../trade/spot-store.ts';
import { BUSY, useTrade } from '../trade/store.ts';
import { payAssetFor } from '../trade/tiles.ts';
import { useWallet } from '../trade/wallet.ts';
import { useWindows } from '../window/store.ts';
import { aboutSubject, agentCoins, bookOf, isBase, type Book, type Coin, type Context, type Gates } from './parse.ts';

export { agentCoins };
import type { Doors } from './run.ts';

/**
 * The command line's doors in the city (CITY-85): each opens a window through the store that window already listens to,
 * or writes into a field through the same setter the person's own typing uses. The trade window, Money and the launch
 * sheet each refuse a change while their signature is out, and a fill reaches only the window this command opened — a
 * card under a signature for another coin is never written into. Nothing here presses a button, builds an order, asks
 * the wallet for anything or sends anything: the person confirms in the window, then signs in their own wallet.
 */

/**
 * A fill waits this long at most for its window to show the field: a stop's price waits for the ticket, which shows
 * only once a wallet is connected, so the person who connects right away still finds the price they said.
 */
const FILL_WAIT_MS = 60_000;

function towerOf(mint: string): Tower | null {
  return useCity.getState().layout.towers.find((placed) => placed.tower.id === mint)?.tower ?? null;
}

/** The open trade window, idle and on this coin: the only window a fill may write into. */
function tradeOn(mint: string): boolean {
  const trade = useTrade.getState();
  return trade.open && trade.tower?.mint === mint && trade.phase === 'idle' && !trade.held;
}

/** The coin the last `openTrade` opened, so the fills that follow reach that window and no other. */
let opened: string | null = null;

/** Each command is one ticket: a fill still waiting from an earlier command lets go the moment another one runs. */
let ticket = 0;
const nextCommand = () => {
  ticket += 1;
  opened = null;
};

/**
 * One panel at a time, as the menu and the search open a coin: the agent's and the Harbor's step aside, and the launch
 * sheet — unless a launch is on its way (`Hud.tsx` `closable`).
 */
function clearPanels(): void {
  useAgent.getState().closePanel();
  useHarbor.getState().hide();
  const launch = useLaunch.getState();
  if (launch.sheet && (!launch.phase || launch.phase.step === 'done' || launch.phase.step === 'failed')) launch.closeSheet();
}

/**
 * Calls `put` until it says it is done — it wrote the field, or the field is no longer the one this command meant —
 * for as long as the window takes to show it, and never past the next command.
 */
function whenReady(put: () => boolean, subscribe: (listener: () => void) => () => void): void {
  const mine = ticket;
  const step = () => mine !== ticket || put();
  if (step()) return;
  let stop = () => {};
  const timer = setTimeout(() => stop(), FILL_WAIT_MS);
  const unsubscribe = subscribe(() => {
    if (step()) stop();
  });
  stop = () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

/** The Spot ticket's price field for the trade window as it stands: its way, its side, its pair. */
function priceField(): string | null {
  const trade = useTrade.getState();
  if (!trade.tower || trade.mode === 'market') return null;
  const pay = payAssetFor(trade.tower.mint, trade.pay, trade.other);
  return `${trade.mode}|${pairKey(trade.side, trade.tower.mint, pay.mint)}`;
}

export const cityDoors: Doors = {
  openTrade: (coin, side, view, mode) => {
    nextCommand();
    const trade = useTrade.getState();
    // A signature out holds the window as it is: the command opens nothing over it.
    if (trade.open && (BUSY.has(trade.phase) || trade.held)) return;
    useExchange.getState().hide();
    // The chart stands in the trade window's place (`TradeLayer`): the window asked for comes to the front.
    if (useTowerChart.getState().mint) useTowerChart.getState().close();
    const tower = coin.tower ? towerOf(coin.mint) : null;
    if (tower) {
      clearPanels();
      trade.openFor(tower, side, { view, mode, launch: launchTowerIn(useLaunch.getState(), tower.id) !== null });
      // The window follows its tower: the camera flies to it, as a tap on the skyline does.
      if (tradeOn(tower.id)) useCity.getState().select(tower.id);
    } else {
      clearPanels();
      // A picked tower would keep its own window in front: it is let go first.
      useCity.getState().select(null);
      useTrade.getState().openFor({ id: coin.mint, symbol: coin.symbol, name: coin.name, icon: coin.icon }, side, { view, mode });
    }
    if (tradeOn(coin.mint)) opened = coin.mint;
  },

  fillPay: (asset) => {
    if (opened && tradeOn(opened)) useTrade.getState().setPay(asset);
  },

  fillAmount: (text) => {
    if (opened && tradeOn(opened)) useTrade.getState().setTyped(text);
  },

  fillShare: (share) => {
    if (opened && tradeOn(opened)) useTrade.getState().setShare(share);
  },

  fillPrice: (text) => {
    const mint = opened;
    // The field this command meant, fixed now: its coin, its way (limit or stop), its side, priced in USDC.
    const field = mint && tradeOn(mint) ? priceField() : null;
    if (!mint || !field) return;
    // The Spot ticket clears its price for each new pair as it opens (a price is the person's own), and shows only with a
    // wallet that can trade it: the said price is written once the ticket stands on exactly this field. Another side,
    // way or coin chosen meanwhile, another command, an order placed — and the price is let go, never re-aimed.
    whenReady(() => {
      if (!tradeOn(mint) || priceField() !== field) return true;
      const spot = useSpot.getState();
      if (spot.phase !== 'idle') return true;
      if (spot.priceFor !== field) return false;
      spot.setPrice(text);
      return true;
    }, useSpot.subscribe);
  },

  openChart: (coin) => {
    nextCommand();
    const tower = coin.tower ? towerOf(coin.mint) : null;
    if (!tower) return cityDoors.openCoin(coin);
    openTower(tower.id);
    useTowerChart.getState().open(tower.id);
  },

  openCoin: (coin) => {
    nextCommand();
    if (coin.tower && towerOf(coin.mint)) return openTower(coin.mint);
    useExchange.getState().hide();
    openTradeCard({ mint: coin.mint, symbol: coin.symbol, name: coin.name, icon: coin.icon });
  },

  openMint: (mint) => {
    nextCommand();
    void openCoinByMint(mint).catch(() => false);
  },

  openMoney: (place) => {
    nextCommand();
    openMoney(place);
    // Send said is Send to a Solana address: the way to another network is «bridge».
    if (place === 'send') useMoney.getState().setWay('solana');
  },

  fillSend: ({ to, amount, asset }) => {
    const mine = ticket;
    // Send's flows load with the Money window, never with the city: they are fetched here as the window opens.
    void import('../money/store.ts').then(({ useMoneyStore }) => {
      if (mine !== ticket) return;
      // The window reads the wallet as it opens (`follow`); read now, so that opening keeps what is written here.
      useMoneyStore.getState().follow(useWallet.getState().connection?.address ?? null);
      if (useMoneyStore.getState().send.phase !== 'idle') return;
      const id = asset ? (asset.symbol === 'SOL' ? NATIVE_ID : asset.mint) : null;
      if (id) useMoneyStore.getState().setSendAsset(id);
      if (amount && id) {
        useMoneyStore.getState().setAmount(amount);
        // A wallet without that coin puts Send on another: an amount said in SOL never stays standing in USDC.
        whenReady(() => {
          const send = useMoneyStore.getState().send;
          if (send.amount !== amount) return true;
          if (send.assetId !== id) {
            useMoneyStore.getState().setAmount('');
            return true;
          }
          // No wallet, nothing reads it and nothing moves the coin; a wallet connected later starts Send afresh.
          const { owner, walletRead } = useMoneyStore.getState();
          return !owner || walletRead === 'ready' || walletRead === 'failed';
        }, useMoneyStore.subscribe);
      }
      if (to) useMoneyStore.getState().setTo(to);
    });
  },

  openLearn: (chapter) => {
    nextCommand();
    clearPanels();
    openLearn(chapter);
  },

  openEarn: () => {
    nextCommand();
    useAgent.getState().closePanel();
    if (EARN_OPEN) return openEarn();
    useHarbor.getState().show();
  },

  openLaunch: ({ symbol, name }) => {
    nextCommand();
    const launch = useLaunch.getState();
    // A launch on its way keeps its sheet exactly as it is.
    const underWay = launch.phase !== null && launch.phase.step !== 'done' && launch.phase.step !== 'failed';
    launch.openSheet();
    if (underWay || useLaunch.getState().step !== 'form') return;
    const draft = { ...(symbol ? { symbol } : {}), ...(name ? { name } : {}) };
    if (Object.keys(draft).length) useLaunch.getState().setDraft(draft);
  },

  openInstruction: (instruction) => {
    nextCommand();
    clearPanels();
    useInstruct.getState().show(instruction);
  },

  openInstructions: () => {
    nextCommand();
    clearPanels();
    useInstruct.getState().openList();
  },

  openAutopilot: (ask) => {
    nextCommand();
    clearPanels();
    useAutopilot.getState().show(withCoinOnScreen(ask));
  },

  openPilot: (ask) => {
    nextCommand();
    clearPanels();
    // The trade's coin: the one named, else the city's first pick of the agent's coins.
    const first = agentCoins(bookNow())[0] ?? null;
    usePilot.getState().show(ask, solPrice(useCity.getState().snapshot.towers), first ? { mint: first.mint, symbol: first.symbol, icon: first.icon } : null);
  },

  openDollar: (ask) => {
    nextCommand();
    clearPanels();
    // A signature out holds the card as it is: the sentence only opens it.
    useDollar.getState().fromAsk(ask);
    openEarn('shelf', 'dollar');
  },

  openCrew: (role) => {
    nextCommand();
    clearPanels();
    hire(role, bookNow(), langNow() === 'uk' ? 'uk' : 'en', { pilot: (ask) => cityDoors.openPilot(ask) });
  },

  askRyntra: (question) => {
    nextCommand();
    const tower = subjectTower();
    const subject = tower && aboutSubject(question, tower.symbol) ? tower : null;
    const assistant = useAssistant.getState();
    assistant.show(subject);
    void assistant.ask(question, useCity.getState().snapshot.towers);
  },
};

/* ------------------------------------------------------------------------------------------------ What is on screen */

/** The city's coins for the command line: its named towers, best first, and SOL and USDC. */
export function bookNow(): Book {
  return bookOf(useCity.getState().snapshot.towers);
}

/** What this deployment opens, as the menu reads it. */
export function gatesNow(): Gates {
  return {
    trade: TRADE_OPEN,
    spot: SPOT_OPEN,
    money: MONEY_OPEN,
    earn: EARN_OPEN || HARBOR_OPEN,
    launch: launchOpenHere(useLaunch.getState()),
    // The agent's instructions trade through the trade window's engines: shut with them.
    instruct: ONE_SENTENCE_OPEN && TRADE_OPEN,
    // The agent on its word (CITY-175): trading rides on the mandate's devnet switch, launches on the launch district's.
    agentTrade: AUTOPILOT_NET !== null && MANDATE_NET !== null,
    agentLaunch: AUTOPILOT_NET !== null,
    dollar: EARN_OPEN && DOLLAR_OPEN,
    pilot: PILOT_OPEN,
  };
}

function coinOf(ref: Readonly<{ mint: string; symbol: string; name: string; icon: string | null }>): Coin {
  const tower = towerOf(ref.mint);
  return { mint: ref.mint, symbol: ref.symbol.replace(/^\$+/u, '').toUpperCase(), name: ref.name, icon: tower?.verified && tower.icon ? `/api/icon/${tower.id}` : ref.icon, tower: tower !== null };
}

/** The tower a window of the frame is about: the trade window's coin, the chart's. Null for every other window. */
export function towerForWindow(id: string): Tower | null {
  if (id === 'swap' || id === 'spot') {
    const mint = useTrade.getState().tower?.mint;
    return mint ? towerOf(mint) : null;
  }
  if (id === 'chart') {
    const mint = useTowerChart.getState().mint;
    return mint ? towerOf(mint) : null;
  }
  return null;
}

/** A trade ask that names no coin takes the tower on screen, as «buy 50» does (the agent on mainnet buys a named coin). */
export function withCoinOnScreen<A extends Readonly<{ kind: string }>>(ask: A): A {
  if (ask.kind !== 'trade' || (ask as { coin?: unknown }).coin) return ask;
  const subject = contextNow().subject;
  return subject && subject.tower && !isBase(subject) ? { ...ask, coin: subject } : ask;
}

/** The coin on screen: the window in front if it is about one, else the tower picked. «buy 50» means this coin. */
export function contextNow(): Context {
  const front = useWindows.getState().layout.windows.at(-1)?.id ?? null;
  const trade = useTrade.getState();
  if (front && (front === 'swap' || front === 'spot') && trade.open && trade.tower) return { subject: coinOf(trade.tower) };
  const chart = front === 'chart' ? useTowerChart.getState().mint : null;
  const picked = chart ?? useCity.getState().selectedId;
  const tower = picked ? towerOf(picked) : null;
  if (tower && tower.verified) return { subject: coinOf({ mint: tower.id, symbol: tower.symbol, name: tower.name, icon: tower.icon }) };
  if (trade.open && trade.tower) return { subject: coinOf(trade.tower) };
  return { subject: null };
}

/** The tower Ryntra is asked about: the one on screen, when it stands in the city. */
export function subjectTower(): Tower | null {
  const coin = contextNow().subject;
  return coin?.tower ? towerOf(coin.mint) : null;
}

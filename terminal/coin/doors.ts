import type { Doors } from '../../city/lib/command/run.ts';
import { LADDER_BUSY, useLadder } from '../../city/lib/trade/pro-store.ts';
import { fillLadder, setLimitTab } from './ladder/tab.ts';
import { pairKey, useSpot } from '../../city/lib/trade/spot-store.ts';
import { useTrade } from '../../city/lib/trade/store.ts';
import { payAssetFor } from '../../city/lib/trade/tiles.ts';
import { ticketFree } from './ticket-rules.ts';

/**
 * The doors a sentence from the agent's line may knock on at a coin's screen (`city/lib/command/run.ts`): «buy 50»,
 * «sell half», «limit at 0.2» fill the screen's own ticket — its side, what pays, the amount, the price — through the
 * same setters the person's typing uses. A sentence about the chart or the coin itself has nothing to open: the
 * screen already is the coin. No door here builds an order, asks the wallet for anything or sends anything: the
 * person reads the filled ticket and confirms there.
 */

/** A said price waits this long at most for the ticket to show its field (a limit's field stands once its pair is read). */
const FILL_WAIT_MS = 60_000;

const nothing = () => {};

/** Each sentence is one ticket of its own: a fill still waiting from an earlier one lets go the moment another runs. */
let ticket = 0;

/** The doors of the screen that stands on `mint`. */
export function coinDoors(mint: string): Doors {
  /** The ticket on this coin, at rest: the only one a fill may write into. */
  const onCoin = () => {
    const card = useTrade.getState();
    return card.open && card.tower?.mint === mint && card.phase === 'idle' && !card.held;
  };
  return {
    openTrade: (coin, side, _view, mode) => {
      ticket += 1;
      const card = useTrade.getState();
      // A trade under way, or its result, keeps the ticket as it is: the sentence opens nothing over it.
      if (coin.mint !== mint || !ticketFree(card)) return;
      // A ladder under way — its Review, the wallet, the relay, or an order's own action — keeps the Limit tab as it is.
      const ladder = useLadder.getState();
      if (LADDER_BUSY.has(ladder.phase) || (ladder.acting && LADDER_BUSY.has(ladder.acting.phase))) return;
      // A trade said at the market, or a limit or a stop at Jupiter: the ticket shows the fields the sentence fills.
      setLimitTab(mint, false);
      card.openFor({ id: coin.mint, symbol: coin.symbol, name: coin.name, icon: coin.icon }, side, { view: 'spot', mode });
    },
    fillPay: (asset) => {
      if (onCoin()) useTrade.getState().setPay(asset);
    },
    fillAmount: (text) => {
      if (onCoin()) useTrade.getState().setTyped(text);
    },
    fillShare: (share) => {
      if (onCoin()) useTrade.getState().setShare(share);
    },
    fillPrice: (text) => {
      const card = useTrade.getState();
      if (!onCoin() || !card.tower || card.mode === 'market') return;
      // The field this sentence meant, fixed now: its way (limit or stop), its side, its pair.
      const pay = payAssetFor(card.tower.mint, card.pay, card.other);
      const field = `${card.mode}|${pairKey(card.side, card.tower.mint, pay.mint)}`;
      const mine = ticket;
      // The ticket clears its price for each new pair as it opens: the said price is written once the ticket stands on
      // exactly this field. Another side, way or coin chosen meanwhile, or another sentence, and it is let go.
      const put = () => {
        const now = useTrade.getState();
        if (mine !== ticket || !onCoin() || now.mode === 'market') return true;
        const spot = useSpot.getState();
        if (spot.phase !== 'idle') return true;
        if (spot.priceFor !== field) return false;
        spot.setPrice(text);
        return true;
      };
      if (put()) return;
      let stop = () => {};
      const timer = setTimeout(() => stop(), FILL_WAIT_MS);
      const unsubscribe = useSpot.subscribe(() => {
        if (put()) stop();
      });
      stop = () => {
        clearTimeout(timer);
        unsubscribe();
      };
    },
    // The screen is the coin and its chart already.
    openChart: nothing,
    openCoin: nothing,
    openMint: nothing,
    // Sentences of other shelves never lead to a coin's screen.
    openMoney: nothing,
    fillSend: nothing,
    openEarn: nothing,
    openLaunch: nothing,
    askRyntra: nothing,
    openInstruction: nothing,
    openInstructions: nothing,
    openAutopilot: nothing,
    openLearn: nothing,
    openDollar: nothing,
    openPilot: nothing,
    openCrew: nothing,
    // «Buy BONK cheaper», «sell half at 2x»: the ticket's Limit tab, filled; the person reads the ladder and signs there.
    openLadder: (ask) => fillLadder(mint, ask),
  };
}

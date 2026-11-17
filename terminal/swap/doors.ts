import type { Doors } from '../../city/lib/command/run.ts';
import { NATIVE_ID } from '../../city/lib/money/assets.ts';
import { useMoneyStore } from '../../city/lib/money/store.ts';
import { useWallet } from '../../city/lib/trade/wallet.ts';
import { addFill, sayTrade, showMoney } from './state.ts';

/**
 * The doors a sentence from the agent's line may knock on at the Swap screen (`city/lib/command/run.ts`): «swap 1 SOL
 * to JUP» puts the ticket on its coin and side and leaves what pays and the amount for it to write once it stands
 * there; «bridge», «top up» and «send …» turn the money panel to the bridge or to a transfer and fill the transfer's
 * fields through the money store's own setters. No door here builds an order or a transfer, asks the wallet for
 * anything or sends anything: the person reads the filled screen and confirms there.
 */

/** A said transfer waits this long at most for the wallet's coins to be read. */
const FILL_WAIT_MS = 60_000;

const nothing = () => {};

/** Each sentence is one ticket of its own: a fill still waiting from an earlier one lets go the moment another runs. */
let ticket = 0;

export function swapDoors(now: () => number = Date.now): Doors {
  return {
    openTrade: (coin, side, _view, mode) => {
      ticket += 1;
      // A limit or a stop belongs to the coin's own screen; the plain swap is at the market price.
      if (mode !== 'market') return;
      sayTrade({ id: coin.mint, symbol: coin.symbol, name: coin.name, icon: coin.icon }, side, now());
    },
    fillPay: (asset) => addFill({ pay: asset }),
    fillAmount: (text) => addFill({ amount: text }),
    fillShare: (share) => addFill({ share }),
    openMoney: (place) => {
      ticket += 1;
      if (place === 'send') showMoney('send');
      else if (place === 'bridge') showMoney('bridge', 'out');
      else if (place === 'topup') showMoney('bridge', 'in');
    },
    fillSend: ({ to, amount, asset }) => {
      const mine = ticket;
      const store = useMoneyStore.getState();
      // The money store follows the wallet; read now, so what is written here stands on its coins.
      store.follow(useWallet.getState().connection?.address ?? null);
      if (useMoneyStore.getState().send.phase !== 'idle') return;
      const id = asset ? (asset.symbol === 'SOL' ? NATIVE_ID : asset.mint) : null;
      if (to) useMoneyStore.getState().setTo(to);
      if (!id) return;
      // The coin and the amount are written once the wallet's coins are read: a coin the wallet lacks is not chosen,
      // and an amount said in it is not left standing in another.
      // Written once: the writes below are themselves changes the listener hears.
      let written = false;
      const put = () => {
        if (written || mine !== ticket) return true;
        const money = useMoneyStore.getState();
        if (money.owner && money.walletRead !== 'failed' && (money.walletRead !== 'ready' || !money.wallet)) return false;
        written = true;
        if (!money.wallet || money.send.phase !== 'idle' || !money.wallet.assets.some((coin) => coin.id === id)) return true;
        money.setSendAsset(id);
        if (amount) useMoneyStore.getState().setAmount(amount);
        return true;
      };
      if (put()) return;
      let stop = nothing;
      const timer = setTimeout(() => stop(), FILL_WAIT_MS);
      const unsubscribe = useMoneyStore.subscribe(() => {
        if (put()) stop();
      });
      stop = () => {
        clearTimeout(timer);
        unsubscribe();
      };
    },
    // A price said aloud is a limit's, and a chart or a coin is the coin's own screen.
    fillPrice: nothing,
    openChart: nothing,
    openCoin: nothing,
    openMint: nothing,
    // Sentences of other shelves never lead to the Swap screen.
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
    openLadder: nothing,
  };
}

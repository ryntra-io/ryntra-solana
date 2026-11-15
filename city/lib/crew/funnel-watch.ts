import { useAutopilot } from '../autopilot/store.ts';
import { useBotsWindow } from '../bots/open.ts';
import { useMandate } from '../bots/mandate.ts';
import { onDrawn } from '../city/drawn.ts';
import { useCommand } from '../command/store.ts';
import { useTrade } from '../trade/store.ts';
import { useWallet } from '../trade/wallet.ts';
import { forgetPending } from './resume.ts';
import { funnelSay } from './funnel-say.ts';
import type { FunnelWord } from './funnel.ts';

export { funnelSay } from './funnel-say.ts';

/**
 * The first action's funnel in the page: each moment sent once a visit to `/api/track` (`funnel-say.ts`), read
 * from the stores the path already moves — the city's first frame, the line, the agent's card, the wallet, the mandate's
 * signature, a trade's signature. Nothing here changes how any of them works; nothing here reads an address
 * or an amount. Installed once by the first screen (`FirstAction`).
 */

/** The agent's card is on the way: its window from a sentence, or the Trader's card in the bots window. */
const cardOnWay = () => {
  const card = useAutopilot.getState();
  return (card.open && card.ask?.kind === 'trade') || useBotsWindow.getState().open;
};

/** The connected wallet has an agent signed in this browser: its card shows the agent at work, not a budget to sign. */
const atWork = () => {
  const owner = useWallet.getState().connection?.address;
  return Boolean(owner && useMandate.getState().records[owner]);
};

const NO: Readonly<Record<string, FunnelWord>> = { walletNo: 'walletno', refused: 'refused', unreachable: 'unreachable' };

/** The stores' moments, watched while the city's home is up. Returns the undo. */
export function watchFunnel(): () => void {
  let signing = false;
  let trading = false;
  // A connect the person tapped (the store's `connecting`), not a wallet granted before coming back on its own.
  let tapped = false;
  const stops = [
    onDrawn(() => funnelSay('agent_drawn')),
    useCommand.subscribe((st, before) => {
      if (st.open && !before.open) funnelSay('agent_line');
    }),
    useAutopilot.subscribe((st, before) => {
      // A card to sign — from a sentence, or the agent's own address (`/?open=agent`) — never the card of an agent at work.
      if (st.open && st.ask?.kind === 'trade' && (!before.open || before.ask !== st.ask) && !atWork()) funnelSay('agent_card');
    }),
    useWallet.subscribe((st, before) => {
      if (st.connecting && !before.connecting) tapped = true;
      if (st.error && st.error !== before.error) tapped = false;
      if (!st.connection || before.connection) return;
      if (tapped) funnelSay('agent_connect');
      tapped = false;
      if (cardOnWay()) funnelSay('agent_wallet');
    }),
    useMandate.subscribe((st, before) => {
      if (st.busy === 'enable' && before.busy !== 'enable') {
        signing = true;
        funnelSay('agent_sign');
      }
      if (!signing || !st.note || st.note === before.note) return;
      signing = false;
      if (st.note.kind === 'on') {
        funnelSay('agent_signed');
        forgetPending();
      } else if (NO[st.note.kind]) funnelSay('agent_sign_no', NO[st.note.kind]!);
    }),
    // A trade from a tower's card: the wallet asked, then landed — or back to the card with nothing signed or sent.
    useTrade.subscribe((st, before) => {
      if (st.phase === before.phase) return;
      if (st.phase === 'wallet') {
        trading = true;
        funnelSay('agent_trade');
        return;
      }
      if (!trading) return;
      if (st.phase === 'done') {
        trading = false;
        funnelSay('agent_traded');
      } else if (st.phase === 'failed') {
        trading = false;
        funnelSay('agent_trade_no', 'failed');
      } else if (st.phase === 'idle') {
        // Back to the card with nothing landed: refused in the wallet, aged out, or read back as never sent.
        trading = false;
        funnelSay('agent_trade_no', 'refused');
      }
    }),
  ];
  return () => stops.forEach((stop) => stop());
}

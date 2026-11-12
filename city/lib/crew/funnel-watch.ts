import { sendEvent } from '../../../lib/analytics.ts';
import { isRyntraApp } from '../app-mode.ts';
import { useAutopilot } from '../autopilot/store.ts';
import { useBotsWindow } from '../bots/open.ts';
import { useMandate } from '../bots/mandate.ts';
import { useCommand } from '../command/store.ts';
import { langNow } from '../i18n/lang.ts';
import { useWallet } from '../trade/wallet.ts';
import { forgetPending } from './resume.ts';
import { funnelDevice, funnelEvent, onceStore, type FunnelName, type FunnelWord } from './funnel.ts';

/**
 * The first action's funnel in the page (CITY-222): each moment sent once a visit to `/api/track`, read from the stores
 * the path already moves — the line, the agent's card, the wallet, the mandate's signature. Nothing here changes how any
 * of them works; nothing here reads an address or an amount. Installed once by the first screen (`FirstAction`).
 */

let once: ReturnType<typeof onceStore> | null = null;

function device() {
  const coarse = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  return funnelDevice(typeof navigator !== 'undefined' && isRyntraApp(navigator.userAgent), coarse);
}

/** One moment of the path, the first time this visit reaches it. Never throws, never waits. */
export function funnelSay(name: FunnelName, word: FunnelWord | null = null): void {
  try {
    if (typeof window === 'undefined') return;
    once ??= onceStore(window.sessionStorage ?? null);
    if (!once.first(name)) return;
    sendEvent(funnelEvent(name, device(), langNow() === 'uk' ? 'uk' : 'en', word));
  } catch {
    // The funnel never stands in the way of the path.
  }
}

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
  const stops = [
    useCommand.subscribe((st, before) => {
      if (st.open && !before.open) funnelSay('agent_line');
    }),
    useAutopilot.subscribe((st, before) => {
      // A card to sign — from a sentence, or the agent's own address (`/?open=agent`) — never the card of an agent at work.
      if (st.open && st.ask?.kind === 'trade' && (!before.open || before.ask !== st.ask) && !atWork()) funnelSay('agent_card');
    }),
    useWallet.subscribe((st, before) => {
      if (st.connection && !before.connection && cardOnWay()) funnelSay('agent_wallet');
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
  ];
  return () => stops.forEach((stop) => stop());
}

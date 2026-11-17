import { funnelSay, watchFunnel } from '@/city/lib/crew/funnel-watch';
import { useWallet } from '@/city/lib/trade/wallet';
import { SHELVES } from './shelves';

/**
 * The first action's funnel in the terminal: the same moments, counted the same way, now that the
 * terminal is the first screen. The frame says its first screen and its first frame drawn; the city's own watcher
 * (`city/lib/crew/funnel-watch.ts`) says the wallet connected, the sign-in, the agent's budget signed and a trade signed
 * and landed — the terminal's screens move the same stores. The agent's line says its own moments (`AgentLine.tsx`), the
 * Agents screen its card (`terminal/agents/NewAgent.tsx`). Nothing here reads an address or an amount. Returns the undo.
 */
export function startFunnel(): () => void {
  funnelSay('agent_home');
  const frame = requestAnimationFrame(() => funnelSay('agent_drawn'));
  const stop = watchFunnel();
  // A wallet connected on the Agents screen is the wallet the agent's card waits for.
  const wallet = useWallet.subscribe((st, before) => {
    if (st.connection && !before.connection && location.pathname.startsWith(SHELVES.agents.path)) funnelSay('agent_wallet');
  });
  return () => {
    cancelAnimationFrame(frame);
    stop();
    wallet();
  };
}

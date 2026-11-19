import { useEffect } from 'react';
import { syncAgents, useAgents, type EngineNetwork } from '../../city/lib/bots/agents.ts';
import { MANDATE_NET } from '../../city/lib/bots/mandate.ts';
import { useWallet } from '../../city/lib/trade/wallet.ts';

/**
 * How many of the person's bots work now, for the number beside «Bots» (decision 109, p. 2): the engine's one answer
 * about the wallet's agents (`POST /api/bots/agents`, `city/lib/bots/agents.ts`) — the one the Agents screen and the
 * Portfolio already read, asked once a wallet and kept fresh by that store (a second ask within 20 s is the first's).
 * The traders that buy on a budget, the money autopilot and the pool keepers are all rules a person set: bots. Without
 * a wallet, without the agents' network on this deployment, or before the answer, there is no number.
 */

/** The bots at work on one network, as the engine answered: each trader, the autopilot, each pool kept. */
export function botsWorking(network: EngineNetwork | null | undefined): number {
  if (!network || !network.read) return 0;
  const traders = network.mandates.filter((mandate) => !mandate.pilot && mandate.status === 'working').length;
  const pilot = network.pilot?.status === 'working' ? 1 : 0;
  const kept = network.cares.filter((care) => care.status === 'working').length;
  return traders + pilot + kept;
}

export function useBotsWorking(): number {
  const owner = useWallet((st) => st.connection?.address ?? null);
  useEffect(() => {
    if (owner && MANDATE_NET) void syncAgents(owner);
  }, [owner]);
  return useAgents((st) => (owner && MANDATE_NET ? botsWorking(st.byOwner[owner]?.networks[MANDATE_NET]) : 0));
}

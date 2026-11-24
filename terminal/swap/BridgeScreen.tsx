'use client';

import { useEffect } from 'react';
import { run } from '@/city/lib/command/run';
import { useWords } from '@/city/lib/i18n/dict';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { ActionBody, Page, PageHead, Panel } from '@/terminal/ui';
import { BridgeForm } from './BridgeForm';
import { BridgeRoutes } from './BridgeRoutes';
import { BridgeTransfers } from './BridgeTransfers';
import { loadChains, loadTransfers, startFollowing } from './bridge-store';
import { RELAY_BRIDGE } from './bridge-words';
import { swapDoors } from './doors';
import { useLeave } from './useLeave';

/**
 * The Bridge's page: every network Relay
 * carries, any coin into any coin, the sending wallet connected by the press itself. An action page of the one template: its name at the head, the form's panel and «My transfers» beside it, at the top of the working area; under
 * them the popular ways into Solana, one tap each to put on the form. How the bridge works waits behind the form's own
 * «i» (eyes pass 20.11, №19).
 *
 * A sentence for the agent that leads here («bridge», «top up») turns into the Swap's doors as before.
 */
export function BridgeScreen() {
  const w = useWords(RELAY_BRIDGE);
  const go = useLeave('bridge');

  useEffect(() => {
    void loadChains();
    loadTransfers();
    return startFollowing();
  }, []);
  useAskHere((ask) => run(ask.command, swapDoors(Date.now, go)));

  return (
    <Page data-bridge-screen="">
      <PageHead title={w.title} />
      <ActionBody
        side={
          <>
            <BridgeTransfers />
            <BridgeRoutes />
          </>
        }
        sideLabel={w.transfers}
      >
        <Panel tone="hi" pad="l" gap={16} edge label={w.title}>
          <BridgeForm />
        </Panel>
      </ActionBody>
    </Page>
  );
}

'use client';

import { useEffect, useId, useState } from 'react';
import { run } from '@/city/lib/command/run';
import { useWords } from '@/city/lib/i18n/dict';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { useAskHere } from '@/terminal/shell/useAskHere';
import { ActionBody, Page, PageHead, Panel } from '@/terminal/ui';
import { BridgeForm } from './BridgeForm';
import { BridgeTransfers } from './BridgeTransfers';
import { loadChains, loadTransfers, startFollowing } from './bridge-store';
import { RELAY_BRIDGE } from './bridge-words';
import { swapDoors } from './doors';
import { useLeave } from './useLeave';

/**
 * The Bridge's page: every network Relay
 * carries, any coin into any coin, the sending wallet connected by the press itself. An action page of the one template: its name at the head, the form's panel and «My transfers» beside it, at the top of the working area.
 *
 * A sentence for the agent that leads here («bridge», «top up») turns into the Swap's doors as before.
 */
export function BridgeScreen() {
  const w = useWords(RELAY_BRIDGE);
  const go = useLeave('bridge');
  const [how, setHow] = useState(false);
  const howId = useId();

  useEffect(() => {
    void loadChains();
    loadTransfers();
    return startFollowing();
  }, []);
  useAskHere((ask) => run(ask.command, swapDoors(Date.now, go)));

  return (
    <Page data-bridge-screen="">
      <PageHead title={w.title} mark={<ExplainButton label={w.how} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />} />
      <ActionBody side={<BridgeTransfers />} sideLabel={w.transfers}>
        <Panel tone="hi" pad="l" gap={16} edge label={w.title}>
          {how ? (
            <ExplainBox id={howId}>
              <span>{w.howText}</span>
            </ExplainBox>
          ) : null}
          <BridgeForm />
        </Panel>
      </ActionBody>
    </Page>
  );
}

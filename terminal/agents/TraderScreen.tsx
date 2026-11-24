'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { RecurringBot } from '@/terminal/bots/Budget';
import { botDesk } from '@/terminal/bots/BotsScreen';
import { Page, PageHead } from '@/terminal/ui';
import { AgentTabs } from './scout/AgentTabs';
import { SCOUT } from './scout/words';

/**
 * The AI trader: the agent's plan on the Agents shelf, where a
 * sentence such as «Trade JUP every day» opens. The coin, the budget a day, the trade, the term and
 * the fee; «Practice first» on paper with no wallet, then «Connect and give the budget» — one signature in the person's
 * wallet, the engine's mandate as it is. Beside the plan, the coin's chart; under it, the agents at work, each with its
 * own «Stop». The card and its engine are the Recurring buys bot's own (`terminal/bots/Budget.tsx`, `agent`); a regular
 * purchase on a schedule stays that bot's.
 */
export function TraderScreen() {
  const w = useWords(SCOUT);
  return (
    <Page kind="desk" data-agent-trader="">
      <PageHead title={w.agents} tabs={<AgentTabs value="trader" />} />
      <RecurringBot lay={botDesk} agent />
    </Page>
  );
}

'use client';

import { Fragment } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { budgetTotal, type AgentBudget } from '@/lib/mandate/budget';
import { Icon } from '@/terminal/ui';
import { budgetText } from './figures';
import { AGENTS } from './words';
import a from './agents.module.css';

/**
 * The risk's edge in words, before any signature: what the agent can spend at most a day and in all — the
 * day the person wrote and the whole her signature takes (the action's own figure), or «your budget» before she writes
 * one, never a sum of Ryntra's (decision 108) — that it cannot withdraw, and that it stops at any moment. Big, in the
 * card's own type: it is read before the wallet is asked for.
 */
export function Limit({ budget }: { budget: AgentBudget | null }) {
  const w = useWords(AGENTS);
  const lang = useLang();
  return <Edge text={budget ? w.terms(budgetText(budget.perDay, lang), budgetText(budgetTotal(budget), lang)) : w.termsAny} />;
}

/**
 * The edge's one look, on every card that asks for a signature (the trader's, the week on paper, the money autopilot):
 * the shield and the words in the card's body type. A line breaks only before a «·», never after one: each short part
 * keeps its dot in front of it and never breaks inside.
 */
export function Edge({ text }: { text: string }) {
  return (
    <p className={a.limit} data-agent-terms="">
      <Icon name="shield" size="s" />
      <span>
        {text.split(' · ').map((part, at) => (
          <Fragment key={part}>
            {at ? ' ' : null}
            <span className={at ? a.part : undefined}>{at ? `·\u00a0${part}` : part}</span>
          </Fragment>
        ))}
      </span>
    </p>
  );
}

/** What connecting a wallet does, in one calm line beside the step that asks for it. */
export function ConnectOnly() {
  const w = useWords(AGENTS);
  return <span className={a.cap}>{w.connectOnly}</span>;
}

'use client';

import { CREW, type Role } from '@/city/lib/crew/read';
import { useWords } from '@/city/lib/i18n/dict';
import { Panel, Quiet, Title } from '@/terminal/ui';
import { RoleBadge } from './glyphs';
import type { CardState } from './rows';
import { AGENTS } from './words';
import a from './agents.module.css';

/**
 * The agents a person hires — the city's own four, one job each: the Trader, the Autopilot, the pool keeper, the
 * Launcher. A card says its agent's state in one word and has one action: «Hire» opens that agent's card — here for the
 * Trader and the Autopilot, on its own shelf for the keeper's pools and a launch. An agent whose engine is shut on this
 * deployment, or whose shelf is not on yet, says «Coming» — or, with `open`, is not drawn. A card may carry one live fact
 * from the market under its job (the Trader's coin and its day's volume).
 */
export function Crew({ states, onHire, facts = {}, open = false }: { states: Readonly<Record<Role, CardState>>; onHire: (role: Role) => void; facts?: Partial<Record<Role, string>>; open?: boolean }) {
  const w = useWords(AGENTS);
  const label: Readonly<Record<CardState, string>> = { hire: w.hire, chosen: w.chosen, working: w.working, soon: w.soon };
  return (
    <div className={a.crew} role="group" aria-label={w.crew}>
      {CREW.filter((role) => !open || states[role] !== 'soon').map((role) => {
        const state = states[role];
        const fact = facts[role];
        const lit = state === 'chosen' || state === 'working';
        return (
          <Panel key={role} as="article" gap={12} className={lit ? a.crewOn : undefined}>
            <RoleBadge role={role} on={lit} />
            <div className={a.cardWords}>
              <Title as="h2" className={a.cardName}>
                {w[role]}
              </Title>
              <span className={a.job}>{w[`${role}Job`]}</span>
            </div>
            {fact ? <span className={a.crewFact}>{fact}</span> : null}
            <Quiet size="s" full disabled={state === 'soon'} aria-pressed={state === 'chosen' || undefined} onClick={() => onHire(role)} data-agent-role={role} data-agent-state={state}>
              {label[state]}
            </Quiet>
          </Panel>
        );
      })}
    </div>
  );
}

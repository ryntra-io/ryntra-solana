'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { Action, Quiet } from '@/terminal/ui';
import t from '@/terminal/coin/ticket.module.css';
import s from './swap.module.css';

/**
 * Whether a money panel — the bridge, a transfer — is a tab of the Swap screen's one card. There its press is
 * the screen's one amber press; beside another screen's action (the Portfolio's panels) it stays quiet.
 */
export const LeadPress = createContext(false);

/** A money panel's one press: amber on the card, quiet beside another action. The press itself is the panel's own. */
export function MoneyGo({ onClick, disabled = false, busy = false, children }: { onClick: () => void; disabled?: boolean; busy?: boolean; children: ReactNode }) {
  const lead = useContext(LeadPress);
  if (lead) {
    return (
      <Action className={t.go} onClick={onClick} disabled={disabled} busy={busy}>
        {children}
      </Action>
    );
  }
  return (
    <Quiet full className={s.moneyGo} onClick={onClick} disabled={disabled} aria-busy={busy || undefined}>
      {children}
    </Quiet>
  );
}

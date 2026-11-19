'use client';

import { useId, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Chip, Panel } from '@/terminal/ui';
import { privateNetwork } from '@/lib/privacy/network';
import { Glyph } from './glyphs';
import { PrivateBalance } from './private/PrivateBalance';
import { PORTFOLIO } from './words';
import a from './all.module.css';

/**
 * «Private balance», as the approved design draws it (`docs/terminal/design/2026-11-16/`). While the private balance is
 * shut (`NEXT_PUBLIC_RYNTRA_PRIVATE` unset) the block says «Soon» and offers nothing to press; open, it is the private
 * balance itself (`./private/PrivateBalance.tsx`). It stands beside the person's own wallet only — never on a wallet
 * that is only looked at.
 */
export function PrivatePanel() {
  // With the private balance open (a test network for now), the block is the private balance itself.
  if (privateNetwork()) return <PrivateBalance />;
  return <PrivateSoon />;
}

/**
 * The block while it is shut: one quiet line at the foot of the page — its name, «Soon», and how it will work behind
 * «i». Nothing to press, so nothing that looks pressable (QA 19.11: it stood in the top-right corner, a column of its own).
 */
function PrivateSoon() {
  const w = useWords(PORTFOLIO);
  const [how, setHow] = useState(false);
  const howId = useId();
  return (
    <Panel gap={12} edge label={w.privateTitle} className={a.private}>
      <div className={a.privateHead}>
        <span className={a.privateBadge} aria-hidden="true">
          <Glyph name="lock" />
        </span>
        <span className={a.privateName}>{w.privateTitle}</span>
        <Chip>{w.soon}</Chip>
        <span className={a.grow} />
        <ExplainButton label={w.privateInfo} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
      </div>
      {how ? <ExplainBox id={howId}>{w.privateText}</ExplainBox> : null}
    </Panel>
  );
}

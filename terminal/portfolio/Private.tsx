'use client';

import { useId, useState } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { ExplainBox, ExplainButton } from '@/terminal/coin/parts';
import { Chip, Kick, Panel, Quiet } from '@/terminal/ui';
import { Glyph } from './glyphs';
import { PORTFOLIO } from './words';
import a from './all.module.css';
import p from './portfolio.module.css';

/**
 * «Private balance», as the approved design draws it (`docs/terminal/design/2026-11-16/`): a second, encrypted balance in
 * the Solflare wallet. Ryntra has no working path into it yet, so the block says «Soon» and offers nothing to press; what
 * it is waits behind «i». It stands beside the person's own wallet only — never on a wallet that is only looked at.
 */
export function PrivatePanel() {
  const w = useWords(PORTFOLIO);
  const [how, setHow] = useState(false);
  const howId = useId();
  return (
    <Panel gap={12} edge label={w.privateTitle} className={a.private}>
      <div className={a.privateHead}>
        <span className={a.actionBadge}>
          <Glyph name="lock" />
        </span>
        <span className={a.privateWords}>
          <Kick>{w.privateTitle}</Kick>
          <span className={p.dots} aria-label={w.hiddenFigure}>
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </span>
        <Chip tone="warn">{w.soon}</Chip>
      </div>
      <div className={a.privateChips}>
        <Chip>Solflare</Chip>
        <Chip>{w.hidden}</Chip>
        <span className={a.grow} />
        <ExplainButton label={w.privateInfo} open={how} controls={howId} onToggle={() => setHow((was) => !was)} />
      </div>
      {how ? <ExplainBox id={howId}>{w.privateText}</ExplainBox> : null}
      <Quiet full disabled className={a.privateHide}>
        {w.hide}
      </Quiet>
    </Panel>
  );
}

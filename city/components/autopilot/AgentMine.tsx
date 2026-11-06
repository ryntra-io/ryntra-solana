'use client';

import { useEffect } from 'react';
import { MANDATE_NET, useMandate } from '@/city/lib/bots/mandate';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { AUTOPILOT_NET } from '@/city/lib/autopilot/flag';
import { solFigure } from '@/city/lib/autopilot/report';
import { readAgentView, useAutopilot } from '@/city/lib/autopilot/store';
import { AUTOPILOT } from '@/city/lib/autopilot/words';
import { useWallet } from '@/city/lib/trade/wallet';
import { AgentGlyph } from '../instruct/glyphs';
import s from './autopilot.module.css';

/**
 * «My agent» at the top of «Mine» (CITY-175): what the agent earned for this wallet, in one row; a tap opens the agent's
 * card with its trades, «Share» and «Stop». Only where the agent's switch and the mandate's are open, and only for a
 * wallet whose agent this browser turned on.
 */
export function AgentMine({ onOpen }: { onOpen?: () => void }) {
  const w = useWords(AUTOPILOT);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const record = useMandate((st) => (owner ? (st.records[owner] ?? null) : null));
  const view = useAutopilot((st) => (record ? (st.views[record.policy] ?? null) : null));
  useEffect(() => useMandate.getState().hydrate(), []);
  useEffect(() => {
    if (!record) return;
    let live = true;
    void readAgentView(record).then((answer) => {
      if (live && answer) useAutopilot.getState().setView(record.policy, answer);
    });
    return () => {
      live = false;
    };
  }, [record]);
  if (!AUTOPILOT_NET || !MANDATE_NET || !record || !view) return null;
  /* CITY-197: after every fee, when the book counted them. */
  const netRaw = view.net ? view.net.netRaw : view.result.earnedRaw;
  const earned = netRaw === null ? null : BigInt(netRaw);
  const figure = netRaw === null || view.result.trades === 0 ? null : solFigure(netRaw, lang);
  const state = view.status === 'working' ? w.working : view.status === 'paused' ? w.paused : view.status === 'stopped' ? w.noteStopped : w.ended;
  return (
    <button
      type="button"
      className={s.mine}
      onClick={() => {
        onOpen?.();
        useAutopilot.getState().showAgent();
      }}
      data-agent-mine=""
    >
      <span className={s.mineMark}>
        <AgentGlyph />
      </span>
      <span className={s.mineText}>
        <span className={s.mineTitle}>{w.mineRow}</span>
        <span className={s.mineSub}>
          {state}
          {view.result.trades > 0 ? ` · ${w.tradesDone(view.result.trades)}` : ''}
        </span>
      </span>
      {figure ? (
        <span className={s.mineFigure} data-tone={earned !== null && earned < 0n ? 'down' : undefined}>
          {figure}
        </span>
      ) : null}
    </button>
  );
}

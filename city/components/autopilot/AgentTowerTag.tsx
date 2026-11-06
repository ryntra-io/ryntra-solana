'use client';

import { Html } from '@react-three/drei';
import { useMemo } from 'react';
import { useMandate } from '@/city/lib/bots/mandate';
import { useCity } from '@/city/lib/city/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useRun } from '@/city/lib/run/store';
import { AUTOPILOT_NET } from '@/city/lib/autopilot/flag';
import { AGENT_REPORT, AGENT_REPORT_OPEN, solFigure, worthTelling, resultRaw, toneOf } from '@/city/lib/autopilot/report';
import { useAutopilot } from '@/city/lib/autopilot/store';
import { useWallet } from '@/city/lib/trade/wallet';
import s from './autopilot.module.css';

/**
 * The quiet line over the agent's tower (CITY-194): the tower of the coin the person's agent buys says its day — «Today
 * · 3 trades · +0.012 SOL» — from the agent's own book. Nothing when the agent did not trade today, when its coin has
 * no tower in the city, or where the report is shut. It never takes a touch; the tower under it does.
 */
export function AgentTowerTag() {
  return AUTOPILOT_NET && AGENT_REPORT_OPEN ? <TowerTag /> : null;
}

function TowerTag() {
  const w = useWords(AGENT_REPORT);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const record = useMandate((st) => (owner ? (st.records[owner] ?? null) : null));
  const view = useAutopilot((st) => (record ? (st.views[record.policy] ?? null) : null));
  const layout = useCity((st) => st.layout);
  const running = useRun((st) => st.phase !== 'off');
  const tower = useMemo(() => (view ? (layout.towers.find((t) => t.tower.id === view.receiveMint) ?? null) : null), [layout, view]);
  const day = view?.day;
  if (running || !tower || !worthTelling(day)) return null;
  /* CITY-197: after every fee, when the book counted them. */
  const raw = resultRaw(day);
  return (
    <Html position={[tower.x, tower.height + tower.width * 1.6 + 4, tower.z]} center zIndexRange={[4, 0]} pointerEvents="none" className={s.towerWrap}>
      <div className={s.towerTag} data-agent-tower="">
        <span>
          {w.today} · {w.trades(day.trades)}
          {raw !== null ? (
            <>
              {' · '}
              <b data-tone={toneOf(raw)}>{solFigure(raw, lang)}</b>
            </>
          ) : null}
        </span>
      </div>
    </Html>
  );
}

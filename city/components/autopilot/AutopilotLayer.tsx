'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useMandate } from '@/city/lib/bots/mandate';
import { useWords } from '@/city/lib/i18n/dict';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { useAway } from '@/city/lib/quarter/away-store';
import { useWallet } from '@/city/lib/trade/wallet';
import { AUTOPILOT_NET } from '@/city/lib/autopilot/flag';
import { AGENT_REPORT_OPEN } from '@/city/lib/autopilot/report';
import { useAgentReport } from '@/city/lib/autopilot/report-client';
import { useAutopilot } from '@/city/lib/autopilot/store';
import { AUTOPILOT } from '@/city/lib/autopilot/words';
import { useCityWindow } from '../window/useCityWindow';
import { AgentGlyph } from '../instruct/glyphs';
import i from '../instruct/instruct.module.css';

// The card loads the first time it opens: the city's first frame carries none of it.
const AutopilotCard = dynamic(() => import('./AutopilotCard'), { ssr: false, loading: () => <div className={i.pending} aria-busy="true" /> });
// «While you were away» for the agent (CITY-194): loaded only once there is something to tell.
const AgentAway = dynamic(() => import('./AgentAway'), { ssr: false });

const renderCard = () => <AutopilotCard />;
const closeCard = () => useAutopilot.getState().close();

/**
 * The agent on its word in the city's one window frame (CITY-175): «trade 1 SOL a day» or «launch me a token» from the
 * command line or «Ask Ryntra» opens it. A run owns the whole screen and a clip being filmed keeps the frame clean,
 * unless the wallet is mid-way, which the frame holds. Shut unless `NEXT_PUBLIC_RYNTRA_CITY_AUTOPILOT=devnet`.
 */
export function AutopilotLayer() {
  const open = useAutopilot((st) => st.open);
  const busy = useMandate((st) => st.busy !== null);
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const w = useWords(AUTOPILOT);
  const quiet = running || filming;

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || useMandate.getState().busy) return;
      useAutopilot.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);

  const card = useMemo(
    () => ({ id: 'autopilot', title: w.title, icon: <AgentGlyph />, render: renderCard, size: { width: 440, height: 600 }, min: { width: 360, height: 440 }, held: busy, onClose: closeCard }),
    [w.title, busy],
  );
  useCityWindow(Boolean(AUTOPILOT_NET) && open && (!quiet || busy), card);
  return AUTOPILOT_NET && AGENT_REPORT_OPEN ? <AgentReturn quiet={quiet || open} /> : null;
}

/**
 * The agent's day on the person's return (CITY-194): the wallet's mandate read once with when this browser last saw it,
 * and the card «While you were away» when it traded since. It waits for the quarter's own reel, a run and a clip.
 */
function AgentReturn({ quiet }: { quiet: boolean }) {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const record = useMandate((st) => (owner ? (st.records[owner] ?? null) : null));
  const away = useAgentReport((st) => st.away);
  const reel = useAway((st) => st.status === 'playing' || st.status === 'reading');
  useEffect(() => useMandate.getState().hydrate(), []);
  useEffect(() => {
    if (record) void useAgentReport.getState().check(record);
  }, [record]);
  return away && !quiet && !reel ? <AgentAway /> : null;
}

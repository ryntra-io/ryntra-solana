'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { useFilming } from '@/city/lib/moments/MomentsLayer';
import { useRun } from '@/city/lib/run/store';
import { useMandate } from '@/city/lib/bots/mandate';
import { PILOT_OPEN, readPilot, usePilot } from '@/city/lib/pilot/store';
import { PILOT } from '@/city/lib/pilot/words';
import { useWallet } from '@/city/lib/trade/wallet';
import { useCityWindow } from '../window/useCityWindow';
import { AgentGlyph } from '../instruct/glyphs';
import i from '../instruct/instruct.module.css';

// The card loads the first time it opens: the city's first frame carries none of it.
const PilotCard = dynamic(() => import('./PilotCard'), { ssr: false, loading: () => <div className={i.pending} aria-busy="true" /> });

const renderCard = () => <PilotCard />;
const closeCard = () => usePilot.getState().close();

/**
 * The money autopilot in the city's one window frame (CITY-204): «work with my 2 SOL and 100 USDC: some into savings,
 * trade BONK with some, some into pools» from the command line opens it. A run owns the whole screen and a clip being
 * filmed keeps the frame clean, unless the wallet is mid-way, which the frame holds. Shut unless
 * `NEXT_PUBLIC_RYNTRA_CITY_PILOT=open` over the agent's and the mandate's switches.
 */
export function PilotLayer() {
  const open = usePilot((st) => st.open);
  const phase = usePilot((st) => st.phase);
  const busy = useMandate((st) => st.busy !== null) || phase === 'signing' || phase === 'stopping';
  const running = useRun((st) => st.phase !== 'off');
  const filming = useFilming();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const w = useWords(PILOT);
  const quiet = running || filming;

  /* Her plan, read once the wallet is known: the card opens on it from the command line's «autopilot». */
  useEffect(() => {
    if (PILOT_OPEN && owner) void readPilot(owner);
  }, [owner]);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || busy) return;
      usePilot.getState().close();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, busy]);

  const card = useMemo(
    () => ({ id: 'pilot', title: w.title, icon: <AgentGlyph />, render: renderCard, fit: true, size: { width: 460, height: 640 }, min: { width: 360, height: 460 }, held: busy, onClose: closeCard }),
    [w.title, busy],
  );
  useCityWindow(PILOT_OPEN && open && (!quiet || busy), card);
  return null;
}

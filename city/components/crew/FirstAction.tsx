'use client';

import { useCallback, useEffect, useState } from 'react';
import { AUTOPILOT_NET } from '@/city/lib/autopilot/flag';
import { useAutopilot } from '@/city/lib/autopilot/store';
import { readAsk } from '@/city/lib/autopilot/read';
import { useMandate } from '@/city/lib/bots/mandate';
import { useCity } from '@/city/lib/city/store';
import { bookNow, cityDoors } from '@/city/lib/command/doors';
import { openCommand, useCommand } from '@/city/lib/command/store';
import { funnelSay, watchFunnel } from '@/city/lib/crew/funnel-watch';
import { forgetPending, takePending } from '@/city/lib/crew/resume';
import { CREW_WORDS } from '@/city/lib/crew/words';
import { useWords } from '@/city/lib/i18n/dict';
import { useWallet } from '@/city/lib/trade/wallet';
import { useWindows } from '@/city/lib/window/store';
import { SparkGlyph } from '../assistant/AssistantLayer';
import { CloseGlyph } from '../hud/glyphs';
import hud from '../hud/hud.module.css';
import s from './crew.module.css';

/** Closed by its ✕, or an agent signed in this browser: the first screen asks no more. */
const DONE_KEY = 'ryntra.city.firstAction';
/** Tapped this visit: the line it opened stays one tap away in the top bar; the next visit offers it again. */
const SEEN_KEY = 'ryntra.city.firstAction.seen';

const read = (storage: () => Storage, key: string): boolean => {
  try {
    return storage().getItem(key) === '1';
  } catch {
    return false;
  }
};
const write = (storage: () => Storage, key: string): void => {
  try {
    storage().setItem(key, '1');
  } catch {
    /* A private window: the action simply goes for this visit. */
  }
};
const local = () => window.localStorage;
const session = () => window.sessionStorage;

/**
 * The card left for a wallet comes back (CITY-222, `resume.ts`): the sentence read again into the agent's card, or the
 * card with nothing said; the coin that was picked, picked again.
 */
function resumeCard(): void {
  if (!AUTOPILOT_NET) return;
  // A card already open (the wallet app's link opened it) is the one left: it never comes back a second time later.
  if (useAutopilot.getState().open) return void forgetPending();
  const card = takePending();
  if (!card) return;
  const ask = card.said ? readAsk(card.said, bookNow()) : null;
  if (ask?.kind === 'trade') cityDoors.openAutopilot(ask);
  else useAutopilot.getState().show({ kind: 'trade', said: '', perDaySol: null });
  if (card.coin && !useMandate.getState().coin) useMandate.getState().setCoin(card.coin);
}

/**
 * The city's first screen, one action (CITY-222; decision 91: «Say it. Your agent does the rest.»): a newcomer sees the
 * city and one line that hands the work to the agent — a tap opens the line with ready sentences, and a sentence opens
 * the agent's card. It replaces the old «tap a tower» hint: the tower still opens with a tap, but the first thing asked
 * of a person is now the agent. It stands over the Deck, by the Agents (CITY-241): the sky and the coin over the central
 * tower stay clear. Gone with its ✕ or once an agent is signed here; while any window, card or panel is in front, it
 * waits. It also starts the first action's funnel and brings back a card left for a wallet.
 */
export function FirstAction({ hidden }: Readonly<{ hidden: boolean }>) {
  const w = useWords(CREW_WORDS);
  const [show, setShow] = useState(false);
  const line = useCommand((st) => st.open);
  const card = useAutopilot((st) => st.open);
  const windows = useWindows((st) => st.layout.windows.length > 0);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const record = useMandate((st) => (owner ? (st.records[owner] ?? null) : null));
  const hired = record !== null;
  // CITY-222: after the signature the same place says the agent is at work — read from the chain, not assumed.
  const working = useMandate((st) => (record ? st.status[record.policy]?.active === true : false));

  const done = useCallback(() => {
    setShow(false);
    write(local, DONE_KEY);
  }, []);

  useEffect(() => {
    useMandate.getState().hydrate();
    const stop = watchFunnel();
    funnelSay('agent_home');
    // The live city first: a sentence read again needs its towers.
    const timer = setTimeout(resumeCard, 1_200);
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (read(local, DONE_KEY) || read(session, SEEN_KEY)) return;
    const timer = setTimeout(() => setShow(true), 1_800);
    return () => clearTimeout(timer);
  }, []);

  // An agent signed for this wallet: the first action is behind the person.
  useEffect(() => {
    if (hired) done();
  }, [hired, done]);

  // Whether that agent still stands on chain, read once when the wallet's agent is known.
  useEffect(() => {
    if (!record || !AUTOPILOT_NET) return;
    let live = true;
    void import('@/city/lib/bots/mandate-sign')
      .then(({ readStatus }) => readStatus(record))
      .then((answer) => {
        if (live && answer) useMandate.getState().setStatus(record.policy, answer);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [record]);

  // A tower opened from the skyline is the city learned too: the action steps aside for this visit.
  useEffect(
    () =>
      useCity.subscribe((st, before) => {
        if (st.selectedId && st.selectedId !== before.selectedId) setShow(false);
      }),
    [],
  );

  if (hidden || line || card || windows) return null;
  if (working && AUTOPILOT_NET) {
    return (
      <div className={`${hud.panel} ${hud.firstHint} ${s.first}`} role="status" data-city-hint="" data-agent-at-work="">
        <button type="button" className={s.firstGo} onClick={() => useAutopilot.getState().showAgent()}>
          <span className={s.workingDot} aria-hidden="true" />
          <span className={s.firstText}>
            <b>{w.yourAgent}</b> <em className={s.workingWord}>{w.atWork}</em>
          </span>
          <svg className={s.firstArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    );
  }
  if (!show) return null;
  const go = () => {
    funnelSay('agent_hint');
    write(session, SEEN_KEY);
    setShow(false);
    openCommand();
  };
  return (
    <div className={`${hud.panel} ${hud.firstHint} ${s.first}`} role="status" data-city-hint="">
      <button type="button" className={s.firstGo} onClick={go} data-first-action="">
        <span className={s.firstSpark}>
          <SparkGlyph />
        </span>
        <span className={s.firstText}>
          <b>{w.firstLead}</b> <em>{w.firstAccent}</em>
        </span>
        <svg className={s.firstArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
      <button type="button" className={hud.firstHintClose} aria-label={w.firstClose} onClick={done}>
        <CloseGlyph />
      </button>
    </div>
  );
}

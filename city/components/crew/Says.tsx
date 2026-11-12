'use client';

import { useMemo } from 'react';
import { useCity } from '@/city/lib/city/store';
import { gatesNow } from '@/city/lib/command/doors';
import { bookOf } from '@/city/lib/command/parse';
import { firstSentences, type Say } from '@/city/lib/crew/say';
import { CREW_WORDS } from '@/city/lib/crew/words';
import { useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { launchOpenHere, useLaunch } from '@/city/lib/launch/district';
import { SparkGlyph } from '../assistant/AssistantLayer';
import s from './crew.module.css';

/**
 * The first sentences (CITY-222): two or three things a person can say to the agent, each one tap — the line (⌘K,
 * «Ask Ryntra», the first screen's action) and «Your agents» show them where nothing is typed yet. A tap is the person
 * saying it: the agent's card opens with the budget and «Sign», as if typed.
 */
export function Says({ onSay }: Readonly<{ onSay: (say: Say) => void }>) {
  const w = useWords(CREW_WORDS);
  const lang = useLang();
  const towers = useCity((st) => st.snapshot.towers);
  const launchReady = useLaunch(launchOpenHere);
  const says = useMemo(() => {
    const gates = gatesNow();
    return firstSentences(lang, bookOf(towers), { trade: gates.agentTrade === true, launch: gates.agentLaunch === true && launchReady });
  }, [lang, towers, launchReady]);
  if (!says.length) return null;
  return (
    <div className={s.says} role="group" aria-label={w.sayKicker} data-crew-says="">
      {says.map((say) => (
        <button key={say.key} type="button" className={s.say} onClick={() => onSay(say)} data-crew-say={say.key}>
          <SparkGlyph />
          <span className={s.sayText}>{say.text}</span>
          <svg className={s.sayGo} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      ))}
    </div>
  );
}

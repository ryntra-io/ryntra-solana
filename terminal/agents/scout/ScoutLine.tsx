'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { useScout, useScoutCheck } from './store';
import { checkLine, checkTone } from './view';
import { SCOUT } from './words';
import sc from './scout.module.css';

/**
 * The Scout's check beside a coin in the market's «New» column, in one line: what it did with the coin and its first
 * reason — a fact, never a score. The line keeps its place on every card once the Scout is known to run, so a check that
 * arrives does not push the card; where the Scout does not run, there is no line at all.
 */
export function ScoutLine({ mint }: { mint: string }) {
  const w = useWords(SCOUT);
  const check = useScoutCheck(mint);
  const on = useScout((st) => st.on);
  if (!on && !check) return null;
  const line = check ? checkLine(w, check) : null;
  return (
    <span className={sc.checkLine} data-scout-check={check?.outcome ?? ''} data-tone={check ? checkTone(check) : undefined}>
      {line}
    </span>
  );
}

'use client';

import { Html } from '@react-three/drei';
import { useEffect, useState } from 'react';
import { useWords, wordsNow } from '@/city/lib/i18n/dict';
import { freshness, type ObjectRead } from '@/city/lib/quarter/objects';
import type { ReadEntry } from '@/city/lib/quarter/site';
import type { ChainLink } from '@/city/lib/quarter/types';
import q from './quarter.module.css';
import { QUARTER } from './words';

/** The clock the tags count ages by, a tick every 15 s: enough for «2 min ago», cheap for twelve tags. */
export function useNow(stepMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

/** What a building's sheet says for a read that is not a view: always the reason, never a number. */
export function readLine(read: ObjectRead | null | undefined): string {
  const w = wordsNow(QUARTER);
  if (!read) return w.toRead;
  switch (read.state) {
    case 'wallet':
      return w.connectToRead;
    case 'proof':
      return w.signInToRead;
    case 'gone':
      return w.notFoundNow;
    case 'unavailable':
      return w.notReadNow;
    default:
      return '';
  }
}

/** The same reason, in a word or two, for the small sign over the building. */
function shortLine(read: ObjectRead | null | undefined): string {
  const w = wordsNow(QUARTER);
  if (!read) return w.shortReading;
  switch (read.state) {
    case 'wallet':
      return w.shortConnect;
    case 'proof':
      return w.shortSignIn;
    case 'gone':
      return w.shortNotFound;
    case 'unavailable':
      return w.shortNotRead;
    default:
      return '';
  }
}

/**
 * A small sign over a building on the engine, in build mode: its object's name, its first figure and how old that
 * figure is — or, with nothing linked or nothing read, that in a word. It never takes a touch; the plot under it does.
 */
export function BuildingTag({ x, y, z, link, read }: { x: number; y: number; z: number; link: ChainLink | null; read: ReadEntry | null }) {
  const now = useNow();
  const view = read?.read?.state === 'ok' ? read.read.view : null;
  const first = view?.figures[0];
  const age = view ? freshness(view.at, now) : null;
  const w = useWords(QUARTER);
  return (
    <Html position={[x, y, z]} center zIndexRange={[4, 0]} pointerEvents="none" className={q.tagWrap}>
      <div className={`${q.tag} ${!link ? q.tagEmpty : ''} ${view?.signal === 'danger' ? q.tagDanger : view?.signal === 'value' ? q.tagValue : ''}`}>
        {!link ? (
          <span className={q.tagTitle}>{w.notLinked}</span>
        ) : view ? (
          <>
            <span className={q.tagTitle}>{view.title}</span>
            <span className={q.tagLine}>
              {first ? `${first.label} ${first.value}` : view.line}
              {age && <i className={age.stale ? q.tagStale : ''}> · {age.stale ? w.delayed : age.short}</i>}
            </span>
          </>
        ) : (
          <span className={q.tagLine}>{shortLine(read?.read)}</span>
        )}
      </div>
    </Html>
  );
}

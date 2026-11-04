'use client';

import { useEffect, useId, useRef } from 'react';
import { useKeyboardInset } from '@/city/lib/keyboard';
import { top } from '@/city/lib/window/layout';
import { useWindows } from '@/city/lib/window/store';
import { AskInWindow } from '../command/AskInWindow';
import { Body } from './WindowFrame';
import { useWords } from '@/city/lib/i18n/dict';
import { CloseGlyph, ExitFullGlyph, FoldGlyph, FullGlyph } from './glyphs';
import { canOpen, foldWindow } from './openers';
import { WINDOW } from './words';
import s from './window.module.css';

/**
 * The windows on a phone (CITY-65): the front window is a bottom sheet that can take the whole screen; nothing floats
 * or sticks. With more than one open, a row of tabs under the head switches between them. «Minimise» (CITY-84) folds
 * the sheet's window into the tray over the Deck — that window alone — the city in full view again.
 */
export function WindowSheet() {
  const words = useWords(WINDOW);
  const windows = useWindows((st) => st.layout.windows);
  const fullId = useWindows((st) => st.layout.full);
  const specs = useWindows((st) => st.specs);
  const active = useWindows((st) => top(st.layout));
  const inset = useKeyboardInset();
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const full = Boolean(active && fullId === active.id);

  useEffect(() => {
    const node = sheet.current;
    if (node && !node.contains(document.activeElement)) node.focus({ preventScroll: true });
  }, [active?.id, full]);

  const spec = active ? specs[active.id] : undefined;
  const all = [...windows].sort((a, b) => a.seq - b.seq);
  // Every window keeps its contents while another is in front: what was typed is still there.
  const bodies = all.map((w) => {
    const own = specs[w.id];
    return own ? (
      <div key={w.id} className={s.body} hidden={w.id !== active?.id}>
        <Body render={own.render} />
      </div>
    ) : null;
  });
  const actions = useWindows.getState();
  const tabs = all;
  // Switching tabs on the whole screen keeps the whole screen.
  const show = (id: string) => (full ? actions.full(id) : actions.raise(id));
  const on = Boolean(active && spec);

  // One root whatever is shown, the contents always in the same place in it: folding the last window never unmounts what
  // is inside the others.
  return (
    <div
      ref={sheet}
      className={`${s.sheet} ${full ? s.sheetFull : ''}`}
      style={full || !on ? undefined : { bottom: inset }}
      hidden={!on}
      role={on ? 'dialog' : undefined}
      aria-modal={(on && full) || undefined}
      aria-labelledby={on ? titleId : undefined}
      tabIndex={-1}
      data-window={active?.id}
      data-window-full={full ? '' : undefined}
    >
      {active && spec ? (
        <div className={s.sheetHead}>
          {spec.icon && <span className={s.icon}>{spec.icon}</span>}
          <h2 id={titleId} className={s.title}>
            {spec.title}
          </h2>
          <div className={s.tools}>
            <AskInWindow id={active.id} className={`${s.tool} ${s.toolTouch}`} />
            {canOpen(active.id) && (
              <button type="button" className={`${s.tool} ${s.toolTouch}`} aria-label={words.fold} disabled={spec.held} onClick={() => foldWindow(active.id)}>
                <FoldGlyph />
              </button>
            )}
            <button
              type="button"
              className={`${s.tool} ${s.toolTouch}`}
              aria-label={full ? words.exitFull : words.full}
              onClick={() => (full ? actions.exitFull() : actions.full(active.id))}
            >
              {full ? <ExitFullGlyph /> : <FullGlyph />}
            </button>
            <button type="button" className={`${s.tool} ${s.toolTouch}`} aria-label={words.close} disabled={spec.held} onClick={() => actions.dismiss(active.id)}>
              <CloseGlyph />
            </button>
          </div>
        </div>
      ) : null}
      {active && tabs.length > 1 ? (
        <div className={s.tabs} role="tablist" aria-label={words.openWindows}>
          {tabs.map((w) => (
            <button key={w.id} type="button" role="tab" aria-selected={w.id === active.id} className={s.tab} onClick={() => show(w.id)}>
              {specs[w.id]?.title ?? w.id}
            </button>
          ))}
        </div>
      ) : null}
      {bodies}
    </div>
  );
}

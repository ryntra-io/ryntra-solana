'use client';

import { useEffect, useId, useRef } from 'react';
import { useKeyboardInset } from '@/city/lib/keyboard';
import { useWindows } from '@/city/lib/window/store';
import { Body } from './WindowFrame';
import { CloseGlyph, ExitFullGlyph, FullGlyph } from './glyphs';
import s from './window.module.css';

/**
 * The windows on a phone (CITY-65): the front window is a bottom sheet that can take the whole screen; nothing floats
 * or sticks. With more than one open, a row of tabs under the head switches between them.
 */
export function WindowSheet() {
  const windows = useWindows((st) => st.layout.windows);
  const fullId = useWindows((st) => st.layout.full);
  const specs = useWindows((st) => st.specs);
  const inset = useKeyboardInset();
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const active = windows.at(-1) ?? null;
  const full = Boolean(active && fullId === active.id);

  useEffect(() => {
    const node = sheet.current;
    if (node && !node.contains(document.activeElement)) node.focus({ preventScroll: true });
  }, [active?.id, full]);

  const spec = active ? specs[active.id] : undefined;
  if (!active || !spec) return null;
  const actions = useWindows.getState();
  const tabs = [...windows].sort((a, b) => a.seq - b.seq);
  // Switching tabs on the whole screen keeps the whole screen.
  const show = (id: string) => (full ? actions.full(id) : actions.raise(id));

  return (
    <div
      ref={sheet}
      className={`${s.sheet} ${full ? s.sheetFull : ''}`}
      style={full ? undefined : { bottom: inset }}
      role="dialog"
      aria-modal={full || undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      data-window={active.id}
      data-window-full={full ? '' : undefined}
    >
      <div className={s.sheetHead}>
        {spec.icon && <span className={s.icon}>{spec.icon}</span>}
        <h2 id={titleId} className={s.title}>
          {spec.title}
        </h2>
        <div className={s.tools}>
          <button
            type="button"
            className={`${s.tool} ${s.toolTouch}`}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
            onClick={() => (full ? actions.exitFull() : actions.full(active.id))}
          >
            {full ? <ExitFullGlyph /> : <FullGlyph />}
          </button>
          <button type="button" className={`${s.tool} ${s.toolTouch}`} aria-label="Close" disabled={spec.held} onClick={() => actions.dismiss(active.id)}>
            <CloseGlyph />
          </button>
        </div>
      </div>
      {tabs.length > 1 && (
        <div className={s.tabs} role="tablist" aria-label="Open windows">
          {tabs.map((w) => (
            <button key={w.id} type="button" role="tab" aria-selected={w.id === active.id} className={s.tab} onClick={() => show(w.id)}>
              {specs[w.id]?.title ?? w.id}
            </button>
          ))}
        </div>
      )}
      {/* Every open window keeps its contents while another tab is in front: what was typed is still there. */}
      {tabs.map((w) => {
        const own = specs[w.id];
        return own ? (
          <div key={w.id} className={s.body} hidden={w.id !== active.id}>
            <Body render={own.render} />
          </div>
        ) : null;
      })}
    </div>
  );
}

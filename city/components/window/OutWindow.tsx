'use client';

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { comeBack, pipWindowOf } from '@/city/lib/window/out';
import { useWindows, type WindowSpec } from '@/city/lib/window/store';
import { Body } from './WindowFrame';
import { BackGlyph } from './glyphs';
import s from './window.module.css';

/**
 * A window of the city on another screen (CITY-75): the same head as in the city — the glyph, the title — with one
 * quiet button that brings it back, and the window's own contents filling the rest. In Picture-in-Picture a signature
 * asked from inside says, in one line, where the wallet asks: the wallet's own window opens over the city.
 */
export function OutWindow({ spec, onBack, pip }: { spec: WindowSpec; onBack: () => void; pip: boolean }) {
  const titleId = useId();
  return (
    <div className={s.out} role="region" aria-labelledby={titleId} data-window={spec.id} data-window-out={pip ? 'pip' : 'tab'}>
      <div className={s.outHead}>
        {spec.icon && <span className={s.icon}>{spec.icon}</span>}
        <h2 id={titleId} className={s.title}>
          {spec.title}
        </h2>
        <div className={s.tools}>
          {/* A signature out holds the window where it is, as the frame's «Close» waits in the city. */}
          <button type="button" className={s.tool} aria-label="Back to the city" title="Back to the city" disabled={Boolean(spec.held)} onClick={onBack}>
            <BackGlyph />
          </button>
        </div>
      </div>
      {pip && spec.held && (
        <p className={s.outHeld} role="status">
          <span className={s.outDot} aria-hidden="true" />
          Confirm in your wallet
        </p>
      )}
      <div className={s.body}>
        <Body render={spec.render} />
      </div>
    </div>
  );
}

/** Every window out in Picture-in-Picture, its contents drawn there by the city's own React: one tree, one wallet. */
export function OutHosts() {
  const ids = useWindows((st) =>
    Object.entries(st.out)
      .filter(([, out]) => out.via === 'pip')
      .map(([id]) => id)
      .join(' '),
  );
  return ids ? ids.split(' ').map((id) => <PipHost key={id} id={id} />) : null;
}

function PipHost({ id }: { id: string }) {
  const spec = useWindows((st) => st.specs[id]);
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const win = pipWindowOf(id);
    if (!win) return;
    // The page's own root classes: the city's colours, type and fonts, as under the city's windows.
    const main = win.document.createElement('main');
    main.className = `${document.querySelector('main')?.className ?? ''} ${s.outPage}`;
    win.document.body.append(main);
    setRoot(main);
    return () => {
      main.remove();
      setRoot(null);
    };
  }, [id]);

  useEffect(() => {
    const win = pipWindowOf(id);
    if (win && spec) win.document.title = `${spec.title} · Ryntra`;
  }, [id, spec]);

  if (!root || !spec) return null;
  return createPortal(<OutWindow spec={spec} pip onBack={() => comeBack(id)} />, root);
}

/**
 * In the city, the windows that are out: one quiet glass button each — the window's glyph and the arrow home — low on
 * the right; a tap brings that window back where it stood.
 */
export function OutTray() {
  const out = useWindows((st) => st.out);
  const specs = useWindows((st) => st.specs);
  const desk = useWindows((st) => st.desk);
  const ids = Object.keys(out).filter((id) => specs[id]);
  if (!desk || !ids.length) return null;
  return (
    <div className={s.tray} role="group" aria-label="Windows on another screen">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          className={s.trayItem}
          aria-label={`Bring ${specs[id]!.title} back`}
          title={`Bring ${specs[id]!.title} back`}
          disabled={Boolean(specs[id]!.held)}
          onClick={() => comeBack(id)}
        >
          {specs[id]!.icon && <span className={s.icon}>{specs[id]!.icon}</span>}
          <BackGlyph />
        </button>
      ))}
    </div>
  );
}

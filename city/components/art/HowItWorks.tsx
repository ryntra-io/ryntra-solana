'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { AGENTS_OPEN } from '@/city/lib/agent/flag';
import { cityNever, cityRules, districtWords } from '@/city/lib/art/districts';
import { HOW } from '@/city/lib/art/words';
import { useWords } from '@/city/lib/i18n/dict';
import { DISTRICT_FILMS, DISTRICT_IDS, districtFrame, playsFilm, srcSet, type DistrictId, type Film } from '@/city/lib/art/frames';
import { howStore, useHow } from '@/city/lib/art/how';
import { readViewer } from '@/city/lib/art/viewer';
import { HARBOR_OPEN } from '@/city/lib/districts/harbor/flag';
import { launchOpenHere, useLaunch } from '@/city/lib/launch/district';
import { AUTOPILOT_NET } from '@/city/lib/autopilot/flag';
import { RING_DUELS_OPEN, RING_OPEN } from '@/city/lib/ring/flag';
import { RUN_OPEN } from '@/city/lib/run/flag';
import { VAULT_OPEN } from '@/city/lib/vault/flag';
import { CloseGlyph, LockGlyph } from '../hud/glyphs';
import s from '../hud/hud.module.css';
import h from './how.module.css';

/** A plate in the grid is a third of the window on a desk, half on a tablet, the whole screen on a phone. */
const PLATE_SIZES = '(min-width: 1000px) 380px, (min-width: 640px) 50vw, 100vw';
/** The Market's plate leads the grid at three fifths of the window's width on a desk. */
const FEATURE_SIZES = '(min-width: 1000px) 700px, 100vw';

/**
 * «How the city works» (CITY-64), opened from the menu: the city's districts in their cinematic frames, what each is
 * and what you do there, open or soon as the city stands right now. The rules by which the city reads the market wait
 * behind one quiet control at the end. A window over the city, the whole screen on a phone; Escape or its close button
 * closes it.
 */
export function HowItWorks() {
  const open = useHow((st) => st.open);
  return open ? <HowWindow /> : null;
}

function HowWindow() {
  const launchOpen = useLaunch(launchOpenHere);
  // «Open» is what the plate's words say: the agent with a budget, the Ring with its rated fights (CITY-236).
  const opened: Record<DistrictId, boolean> = {
    market: true,
    launch: launchOpen,
    harbor: HARBOR_OPEN,
    agents: AGENTS_OPEN && AUTOPILOT_NET !== null,
    vault: VAULT_OPEN,
    ring: RING_OPEN && RING_DUELS_OPEN,
    home: true,
  };
  const [films] = useState(() => playsFilm(readViewer()));
  const [rules, setRules] = useState(false);
  const w = useWords(HOW);
  const box = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Escape closes this window and nothing under it (the HUD's own Escape steps aside while it is open).
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        howStore.getState().hide();
        return;
      }
      // The window holds the focus while it is open: Tab walks its own controls in a ring, wherever the focus was.
      if (event.key !== 'Tab' || !box.current) return;
      const stops = [...box.current.querySelectorAll<HTMLElement>('button, a[href]')];
      if (!stops.length) return;
      event.preventDefault();
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = at < 0 ? (event.shiftKey ? stops.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
      stops[next]!.focus();
    };
    // Focus that lands outside (a click, a screen reader) comes back to the window.
    const onFocus = (event: FocusEvent) => {
      if (box.current && event.target instanceof Node && !box.current.contains(event.target)) closeButton.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      // Back to the menu's button, where the visitor came from.
      document.querySelector<HTMLElement>('[data-city-menu] button[aria-controls]')?.focus();
    };
  }, []);

  return (
    <div ref={box} className={h.layer} role="dialog" aria-modal="true" aria-labelledby="city-how-title" data-city-how="">
      <div className={h.page}>
        <header className={h.hero}>
          <div className={h.heroShade} />
          <div className={h.heroWords}>
            <h2 id="city-how-title" className={`${s.display} ${h.title}`}>
              {w.title}
            </h2>
            <p className={h.lead}>{w.lead}</p>
          </div>
          <button ref={closeButton} className={h.close} aria-label={w.close} onClick={() => howStore.getState().hide()}>
            <CloseGlyph />
          </button>
        </header>

        <ul className={h.grid} aria-label={w.districts}>
          {DISTRICT_IDS.map((id) => (
            <Plate key={id} id={id} open={opened[id]} film={films ? DISTRICT_FILMS[id] : undefined} root={box} />
          ))}
        </ul>

        {/* A div, not a section: the site's global sheet pads every section (app/globals.css). */}
        <div className={`${s.panel} ${h.rules}`}>
          <button className={h.rulesToggle} aria-expanded={rules} aria-controls="city-how-rules" onClick={() => setRules((v) => !v)}>
            <span className={`${s.display} ${h.rulesTitle}`}>{w.rulesTitle}</span>
            <span className={`${h.chevron} ${rules ? h.chevronOn : ''}`} aria-hidden="true" />
          </button>
          {rules && (
            <div id="city-how-rules" className={h.rulesBody}>
              <div>
                <h3 className={h.rulesHead}>{w.readsHead}</h3>
                <ul className={h.list}>
                  {(RUN_OPEN ? [...cityRules(w), w.runRule] : cityRules(w)).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className={h.rulesHead}>{w.neverHead}</h3>
                <ul className={h.list}>
                  {cityNever(w).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
              <p className={h.source}>{w.source}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One district: its frame with its name and whether it is open, then what it is and what you do there. */
function Plate({ id, open, film, root }: { id: DistrictId; open: boolean; film?: Film; root: RefObject<HTMLDivElement | null> }) {
  const w = useWords(HOW);
  const words = districtWords(w, id);
  const frame = districtFrame(id);
  const feature = id === 'market';
  return (
    <li className={`${s.panel} ${h.plate} ${feature ? h.feature : ''}`} data-district={id}>
      <div className={h.frame}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={h.frameImg} src={frame.files[0]!.src} srcSet={srcSet(frame)} sizes={feature ? FEATURE_SIZES : PLATE_SIZES} alt="" loading="lazy" decoding="async" />
        {film && <PlateFilm film={film} root={root} />}
        <span className={`${h.status} ${open ? h.statusOpen : h.statusSoon}`}>
          {open ? (
            <span className={h.statusDot} aria-hidden="true" />
          ) : (
            <span className={h.statusLock} aria-hidden="true">
              <LockGlyph />
            </span>
          )}
          {open ? w.open : w.soon}
        </span>
        <h3 className={`${s.display} ${h.name}`}>{words.name}</h3>
      </div>
      <div className={h.words}>
        <p className={h.what}>{words.what}</p>
        <p className={h.doing}>{words.doing}</p>
      </div>
    </li>
  );
}

/**
 * A district's film over its still: fetched and played once when most of its plate is in view, shown once it is
 * really playing, and faded back into the still at its end — the films are not loops. The still under it is its
 * poster, so the film carries none of its own to fetch.
 */
function PlateFilm({ film, root }: { film: Film; root: RefObject<HTMLDivElement | null> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'waiting' | 'playing' | 'ended'>('waiting');
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        seen.disconnect();
        void el.play().catch(() => setState('ended'));
      },
      { root: root.current, threshold: 0.6 },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, [root]);
  return (
    <video
      ref={video}
      className={`${h.frameImg} ${h.film} ${state === 'playing' ? h.filmOn : ''}`}
      muted
      playsInline
      preload="none"
      aria-hidden="true"
      onPlaying={() => setState('playing')}
      onEnded={() => setState('ended')}
    >
      <source src={film.webm} type="video/webm" />
      {/* With sources a failed load is the last source's error, not the video's. */}
      <source src={film.mp4} type="video/mp4" onError={() => setState('ended')} />
    </video>
  );
}

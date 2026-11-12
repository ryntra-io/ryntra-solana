'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { PRESET_WINDOWS, PRESETS, presetReady, type DeskKey, type Preset, type Shot, type Slot } from '@/city/lib/window/desks';
import { useWindows } from '@/city/lib/window/store';
import { CloseGlyph } from './glyphs';
import { canOpen, layoutSubject, openFor, shutOutside } from './openers';
import { WINDOW } from './words';
import s from './window.module.css';

/** The windows a layout has, as it would put them on this screen. */
function wantedBy(key: DeskKey): Set<string> {
  if (typeof key !== 'number') return new Set(PRESET_WINDOWS[key].filter((w) => canOpen(w.id)).map((w) => w.id));
  return new Set(useWindows.getState().desks.slots[key]?.windows.map((w) => w.id) ?? []);
}

/**
 * A layout put in use: an owner's window held out of sight that the layout does not have goes first (so it does not
 * come back when the window in its place closes), the windows open move to their places, the rest are opened by their
 * owners where planned.
 */
function apply(key: DeskKey): void {
  // The coin in front of the person, before the trade card lets it go: a preset's chart and Exchange open on it.
  const subject = layoutSubject();
  shutOutside(wantedBy(key));
  for (const p of useWindows.getState().applyDesk(key, canOpen).later) openFor(p.id, p.params ?? subject);
}

/** A layout drawn small: the two bays lit where it puts a window, a floating window as a pane in the middle. */
function Scheme({ left, right, middle }: { left: boolean; right: boolean; middle?: boolean }) {
  return (
    <svg className={s.scheme} viewBox="0 0 30 20" aria-hidden="true">
      <rect x="0.75" y="0.75" width="28.5" height="18.5" rx="1.5" className={s.schemeFrame} />
      <rect x="3" y="3" width="7" height="14" rx="0.5" className={left ? s.schemeOn : s.schemeOff} />
      <rect x="20" y="3" width="7" height="14" rx="0.5" className={right ? s.schemeOn : s.schemeOff} />
      {middle && <rect x="12" y="6" width="6" height="8" rx="0.5" className={s.schemeOn} />}
    </svg>
  );
}

const presetScheme = (preset: Preset) => {
  const shown = PRESET_WINDOWS[preset].filter((w) => canOpen(w.id));
  return { left: shown.some((w) => w.bay === 'left'), right: shown.some((w) => w.bay === 'right') };
};

const shotScheme = (shot: Shot | null) => ({
  left: Boolean(shot?.windows.some((w) => w.bay === 'left')),
  right: Boolean(shot?.windows.some((w) => w.bay === 'right')),
  middle: Boolean(shot?.windows.some((w) => !w.bay)),
});

/**
 * The layouts (CITY-84, helm §4), in the top bar's menu (CITY-241): nothing of them stands on the city or over a window
 * on the whole screen. Ryntra's four layouts — only those whose windows are open here — and the person's four places:
 * an empty one keeps the windows as they stand, a kept one puts them back; the one in use keeps itself with every
 * change, for this wallet. On a computer only (the menu asks `desk`): a phone's windows stand one at a time. `onDone`
 * folds the menu once a layout is in use or a place is kept.
 */
export function LayoutsPicker({ id, onDone }: Readonly<{ id?: string; onDone: () => void }>) {
  const w = useWords(WINDOW);
  const active = useWindows((st) => st.desks.active);
  const slots = useWindows((st) => st.desks.slots);
  const presets = PRESETS.filter((p) => presetReady(p, canOpen));
  const pick = (key: DeskKey) => {
    onDone();
    apply(key);
  };

  return (
    <div id={id} className={s.desksPicker} role="group" aria-label={w.layouts} data-window-desks="">
      {presets.map((preset) => (
        <button key={preset} type="button" className={`${s.preset} ${active === preset ? s.deskOn : ''}`} aria-pressed={active === preset} onClick={() => pick(preset)} data-desk={preset}>
          <Scheme {...presetScheme(preset)} />
          <span>{w[preset]}</span>
        </button>
      ))}
      <div className={s.slots}>
        {slots.map((shot, i) => {
          const slot = i as Slot;
          const n = i + 1;
          return (
            <span key={n} className={s.slotBox}>
              <button
                type="button"
                className={`${s.slot} ${shot ? s.slotKept : ''} ${active === slot ? s.deskOn : ''}`}
                aria-label={shot ? w.slot(n) : w.keepSlot(n)}
                title={shot ? w.slot(n) : w.keepSlot(n)}
                aria-pressed={active === slot}
                onClick={() => (shot ? pick(slot) : (useWindows.getState().keepDesk(slot), onDone()))}
                data-desk-slot={n}
              >
                <Scheme {...shotScheme(shot)} />
                <span className={s.slotNumber}>{n}</span>
              </button>
              {shot && (
                <button type="button" className={s.slotClear} aria-label={w.clearSlot(n)} title={w.clearSlot(n)} onClick={() => useWindows.getState().clearDesk(slot)}>
                  <CloseGlyph />
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { useWords } from '@/city/lib/i18n/dict';
import { privateNetwork } from '@/lib/privacy/network';
import { FRESH, MODE_KEY, choose, modeOf, readMemory, writeMemory, type ModeMemory, type PrivateMode } from './private-mode';
import { cx } from './cx';
import { PRIVATE_KIT } from './words';
import s from './ui.module.css';
import p from './private.module.css';

/* The memory lives in the browser's storage, read through one store so every toggle and every screen of a page agree;
   a storage that throws (a private window, blocked site data) leaves the choice for this page only. */
let held: ModeMemory = FRESH;
let heldText: string | null = null;
const listeners = new Set<() => void>();

function stored(): ModeMemory {
  let text: string | null = heldText;
  try {
    text = window.localStorage.getItem(MODE_KEY);
  } catch {
    return held;
  }
  if (text !== heldText) {
    heldText = text;
    held = readMemory(text);
  }
  return held;
}

function keep(memory: ModeMemory): void {
  held = memory;
  const text = writeMemory(memory);
  heldText = text;
  try {
    window.localStorage.setItem(MODE_KEY, text);
  } catch {
    // The choice holds for this page only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const other = (event: StorageEvent) => {
    if (event.key === MODE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', other);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', other);
  };
}

/** Whether the private mode exists in this build: `NEXT_PUBLIC_RYNTRA_PRIVATE` opens it, nothing else does. */
export function privateModeOpen(): boolean {
  return privateNetwork() !== null;
}

/**
 * The mode a screen is in, and the way to change it — the same answer for the toggle in the page's head and for the
 * screen under it. Remembered per screen (`scope`); private by default once the person has turned it on anywhere. In a
 * build without the private mode it is always public.
 */
export function usePrivateMode(scope: string): readonly [PrivateMode, (mode: PrivateMode) => void] {
  const memory = useSyncExternalStore(subscribe, stored, () => FRESH);
  const set = useCallback((mode: PrivateMode) => keep(choose(stored(), scope, mode)), [scope]);
  return [privateModeOpen() ? modeOf(memory, scope) : 'open', set] as const;
}

/**
 * The toggle «Public ⇄ Private» for the page's head (`PageHead mode={…}`): the two words with the switch between them,
 * one control — a tap anywhere on it turns the mode. Violet is on; amber stays the screen's action. Hidden in a build
 * without the private mode. `on` and `onChange` hold it from outside (the kit's stand); otherwise it keeps `scope`'s
 * choice itself.
 */
export function PrivacyToggle({ scope, on, onChange }: { scope: string; on?: boolean; onChange?: (on: boolean) => void }) {
  const w = useWords(PRIVATE_KIT);
  const [mode, setMode] = usePrivateMode(scope);
  if (!privateModeOpen()) return null;
  const isOn = on ?? mode === 'private';
  const turn = () => {
    if (onChange) onChange(!isOn);
    else setMode(isOn ? 'open' : 'private');
  };
  return (
    <button type="button" role="switch" aria-checked={isOn} aria-label={w.modeName} className={p.toggle} onClick={turn} data-private-mode={isOn ? 'private' : 'open'}>
      <span className={cx(p.toggleWord, !isOn && p.toggleNow)} aria-hidden="true">
        {w.open}
      </span>
      <span className={s.switch} data-on={isOn ? '' : undefined} aria-hidden="true" />
      <span className={cx(p.toggleWord, isOn && p.toggleNow)} aria-hidden="true">
        {w.private}
      </span>
    </button>
  );
}

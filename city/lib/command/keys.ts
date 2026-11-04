import { useAssistant } from '../assistant/store.ts';
import { closeCommand, commandAllowed, toggleCommand, useCommand } from './store.ts';

/**
 * The command line's keys (CITY-85; helm SPEC §9): ⌘K on a Mac, Ctrl+K elsewhere, opens and closes it — never while
 * the keyboard is in another field, so typing an amount is never taken for a command. Escape closes what stands on
 * top: the command line, else Ryntra's panel — one press, one thing.
 *
 * Heard first: installed once when the city's code loads, before any panel's own listener, and an Escape it takes is
 * marked taken and stopped, so the window under it, the HUD and the frame close nothing with the same press.
 */

/** A field the person types into: the keys are theirs there. */
export function typingIn(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.closest('[data-city-command]')) return false;
  return element.isContentEditable || Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
}

/** ⌘K or Ctrl+K, whatever the keyboard's layout writes for the key (a Ukrainian layout writes «л»). */
export function isCommandKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && (event.code === 'KeyK' || event.key.toLowerCase() === 'k');
}

function onKey(event: KeyboardEvent): void {
  if (isCommandKey(event)) {
    if (event.repeat || typingIn(event.target) || (!useCommand.getState().open && !commandAllowed())) return;
    event.preventDefault();
    toggleCommand();
    return;
  }
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (useCommand.getState().open) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeCommand();
  } else if (useAssistant.getState().open) {
    event.preventDefault();
    event.stopImmediatePropagation();
    useAssistant.getState().hide();
  }
}

const INSTALLED = '__ryntraCommandKeys';

/** Once per page, however often the module is evaluated (a development reload evaluates it again). */
export function installCommandKeys(): void {
  if (typeof window === 'undefined') return;
  const page = window as unknown as Record<string, unknown>;
  const before = page[INSTALLED] as ((event: KeyboardEvent) => void) | undefined;
  if (before) window.removeEventListener('keydown', before, true);
  window.addEventListener('keydown', onKey, true);
  page[INSTALLED] = onKey;
}

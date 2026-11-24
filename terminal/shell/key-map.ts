import { COIN_PATH } from './shelves.ts';

/**
 * The terminal's keys on a desk, as the best trading screens have them: «/» — find a coin from anywhere (the agent's
 * line, which names a coin by its ticker); on a coin's screen B and S — buy and sell, 1–4 — the buy's quick sums (a
 * sale's shares); Esc — close what stands open; «?» — the quiet list of keys. A key is never taken while the person
 * types in a field, never with Ctrl, ⌘ or Alt held, and a phone has none. A key only opens or fills: nothing is
 * pressed, built or signed by one.
 *
 * Pure: the frame's listener (`./Keys.tsx`) and the tests read it as it is.
 */

export type KeyHit =
  | Readonly<{ action: 'search' | 'buy' | 'sell' | 'close' | 'help' }>
  /** A quick sum: the first to the fourth. */
  | Readonly<{ action: 'sum'; index: 0 | 1 | 2 | 3 }>;

/** The press, as a keyboard event carries it. `code` is the key's place, so a Ukrainian layout's «и» is still B. */
export type KeyPress = Readonly<{ key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean }>;

/** Where the press lands: in a field the person types in, on a phone, on a coin's screen, with the list of keys open. */
export type KeyPlace = Readonly<{ typing: boolean; narrow: boolean; coin: boolean; listOpen: boolean }>;

const SUMS: Readonly<Record<string, 0 | 1 | 2 | 3>> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };

/** What a press does here, or null when it is not the terminal's to take. */
export function keyHit(press: KeyPress, place: KeyPlace): KeyHit | null {
  if (place.narrow) return null;
  if (press.key === 'Escape') return place.listOpen || !place.typing ? { action: 'close' } : null;
  if (place.typing || press.repeat || press.metaKey || press.ctrlKey || press.altKey) return null;
  if (press.key === '?' || (press.code === 'Slash' && press.shiftKey)) return { action: 'help' };
  if (press.shiftKey) return null;
  if (press.key === '/' || press.code === 'Slash') return { action: 'search' };
  if (!place.coin) return null;
  if (press.code === 'KeyB' || press.key.toLowerCase() === 'b') return { action: 'buy' };
  if (press.code === 'KeyS' || press.key.toLowerCase() === 's') return { action: 'sell' };
  const sum = SUMS[press.code] ?? (/^[1-4]$/u.test(press.key) ? ((Number(press.key) - 1) as 0 | 1 | 2 | 3) : undefined);
  return sum === undefined ? null : { action: 'sum', index: sum };
}

/** The coin a coin's screen stands on, from its address; null elsewhere. */
export function coinAt(pathname: string): string | null {
  const path = pathname.split(/[?#]/)[0] ?? '';
  const found = new RegExp(`^${COIN_PATH}/([^/]+)/?$`, 'u').exec(path);
  if (!found) return null;
  try {
    return decodeURIComponent(found[1]!);
  } catch {
    return null;
  }
}

/** A field the person types into — the agent's line too: «/» typed there is a letter, not a search. */
export function typingAt(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  return element.isContentEditable || Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
}

/** The quiet list's rows, in its order: the keys and what each does (`KEYS_WORDS`). */
export const KEY_LIST = [
  { keys: ['/'], word: 'search' },
  { keys: ['B'], word: 'buy' },
  { keys: ['S'], word: 'sell' },
  { keys: ['1', '4'], word: 'sums' },
  { keys: ['Esc'], word: 'close' },
  { keys: ['?'], word: 'list' },
] as const;

export type KeyWord = (typeof KEY_LIST)[number]['word'];

/** A buy's quick sum or a sale's share for the key pressed: the ticket's own sums (`quickSums`), else none. */
export function sumFor(index: 0 | 1 | 2 | 3, side: 'buy' | 'sell', sums: readonly string[] | null, shares: readonly number[]): Readonly<{ typed: string }> | Readonly<{ share: number }> | null {
  if (side === 'buy') {
    const sum = sums?.[index];
    return sum ? { typed: sum } : null;
  }
  const share = shares[index];
  return share === undefined ? null : { share };
}

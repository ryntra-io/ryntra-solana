/**
 * The memory of the toggle «Public ⇄ Private».
 *
 * - Each screen remembers its own choice (`scope`: «send», «payouts», «invoices», «swap» …).
 * - Until the person has turned private on once, a screen they never chose on opens public.
 * - From the first time they turn it on, private is the default: a screen they never chose on opens private; a screen
 *   they turned back to public keeps its public.
 *
 * Pure: the browser's storage is read and written by the toggle (`PrivacyToggle.tsx`); a choice is a per-viewer
 * convenience, nothing that must survive or travel.
 */

export type PrivateMode = 'open' | 'private';

export type ModeMemory = Readonly<{
  /** The person has turned private on at least once. */
  ever: boolean;
  /** The choice each screen remembers. */
  by: Readonly<Record<string, PrivateMode>>;
}>;

/** Where the browser keeps the memory. */
export const MODE_KEY = 'ryntra.private.mode.v1';

/** A screen's name in the memory: short, lower case. */
const SCOPE = /^[a-z][a-z0-9-]{0,31}$/;
/** No more screens than the terminal has; anything beyond is not kept. */
const MAX_SCOPES = 32;

export const FRESH: ModeMemory = Object.freeze({ ever: false, by: Object.freeze({}) });

export function isScope(value: unknown): value is string {
  return typeof value === 'string' && SCOPE.test(value);
}

/** The mode a screen opens in. */
export function modeOf(memory: ModeMemory, scope: string): PrivateMode {
  const chosen = isScope(scope) && Object.hasOwn(memory.by, scope) ? memory.by[scope] : undefined;
  return chosen ?? (memory.ever ? 'private' : 'open');
}

/** The memory after the person chose a mode on a screen. */
export function choose(memory: ModeMemory, scope: string, mode: PrivateMode): ModeMemory {
  if (!isScope(scope)) return memory;
  const by = { ...memory.by, [scope]: mode };
  const kept = Object.keys(by).length > MAX_SCOPES ? Object.fromEntries(Object.entries(by).slice(-MAX_SCOPES)) : by;
  return Object.freeze({ ever: memory.ever || mode === 'private', by: Object.freeze(kept) });
}

/** The memory as the browser kept it; anything it cannot read is a fresh memory, never an error. */
export function readMemory(text: string | null | undefined): ModeMemory {
  if (!text) return FRESH;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return FRESH;
  }
  if (!raw || typeof raw !== 'object') return FRESH;
  const { ever, by } = raw as { ever?: unknown; by?: unknown };
  const kept: Record<string, PrivateMode> = {};
  if (by && typeof by === 'object' && !Array.isArray(by)) {
    for (const [scope, mode] of Object.entries(by as Record<string, unknown>).slice(0, MAX_SCOPES)) {
      if (isScope(scope) && (mode === 'open' || mode === 'private')) kept[scope] = mode;
    }
  }
  return Object.freeze({ ever: ever === true, by: Object.freeze(kept) });
}

export function writeMemory(memory: ModeMemory): string {
  return JSON.stringify({ ever: memory.ever, by: memory.by });
}

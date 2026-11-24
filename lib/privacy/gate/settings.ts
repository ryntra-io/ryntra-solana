/**
 * The gate's settings — server variables, read as text at the moment of each question, never built into the page.
 *
 * - `RYNTRA_PRIVATE_PAUSE_DEPOSITS` — the one switch that pauses new deposits («Hide»). `1`, `true`, `on` or `yes`
 *   pause them; anything else, or nothing, leaves them open. «Return» is never paused.
 * - `RYNTRA_PRIVATE_CAP_USD` — the starting cap of a person's private balance, in US dollars.
 *   Unset — no cap. Set to something that does not read as an amount above zero — deposits wait with the
 *   «check is not answering» line rather than run without the cap someone meant to set.
 * - `RYNTRA_PRIVATE_GATE_SOURCE` — where the lists of flagged addresses come from. `none` (the default): no list is
 *   connected, nobody is marked — the test network's stand-in, accepted on the test network only. `list`: the addresses
 *   in `RYNTRA_PRIVATE_GATE_LIST` are marked — for trying the gate by hand. `silent`: a source that never answers — for
 *   seeing what a person is told then. Any other name is a source not connected yet and reads as silent, so naming a
 *   provider before its adapter exists holds deposits instead of letting them through unchecked.
 * - `RYNTRA_PRIVATE_GATE_LIST` — addresses for the `list` source, separated by commas, spaces or new lines.
 *
 * A provider's key, when one is chosen, is a server variable of its adapter's own and never reaches this file's answer.
 */

import { ADDRESS } from './core.ts';

export const GATE_ENV = Object.freeze({
  pause: 'RYNTRA_PRIVATE_PAUSE_DEPOSITS',
  capUsd: 'RYNTRA_PRIVATE_CAP_USD',
  source: 'RYNTRA_PRIVATE_GATE_SOURCE',
  list: 'RYNTRA_PRIVATE_GATE_LIST',
});

export type SourceName = 'none' | 'list' | 'silent';

export type GateSettings = Readonly<{
  paused: boolean;
  /** `null` — no cap; `'unreadable'` — a cap was set but does not read as an amount above zero. */
  capUsd: number | 'unreadable' | null;
  source: SourceName;
  list: readonly string[];
}>;

export type Env = Readonly<Record<string, string | undefined>>;

const ON = /^(1|true|on|yes)$/i;

function capOf(text: string | undefined): GateSettings['capUsd'] {
  const clean = text?.trim().replace(/[\s_]/g, '') ?? '';
  if (!clean) return null;
  if (!/^\d+(\.\d+)?$/.test(clean)) return 'unreadable';
  const usd = Number(clean);
  return Number.isFinite(usd) && usd > 0 ? usd : 'unreadable';
}

function sourceOf(text: string | undefined): SourceName {
  const name = text?.trim().toLowerCase() ?? '';
  if (name === '' || name === 'none') return 'none';
  if (name === 'list') return 'list';
  return 'silent';
}

export function gateSettings(env: Env): GateSettings {
  return {
    paused: ON.test(env[GATE_ENV.pause]?.trim() ?? ''),
    capUsd: capOf(env[GATE_ENV.capUsd]),
    source: sourceOf(env[GATE_ENV.source]),
    list: [...new Set((env[GATE_ENV.list] ?? '').split(/[\s,;]+/).filter((a) => ADDRESS.test(a)))],
  };
}

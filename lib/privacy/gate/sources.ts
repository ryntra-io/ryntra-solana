/**
 * Where the lists of flagged addresses come from — one interface, connected separately.
 * Until then the default source is empty, and two test sources
 * let the gate be tried by hand on the test network.
 *
 * A source answers one thing: which of these addresses are flagged. It never says by which list, and neither does the
 * gate's answer: a person is told «flagged», not why. A source that throws, answers `null` or misses the deadline has
 * not answered — every address it was asked about reads `unchecked`, never `clear`.
 */

import type { Mark } from './core.ts';
import type { GateSettings } from './settings.ts';

export type ListSource = Readonly<{
  /** True for the empty default: no list is connected, so nobody is marked. Accepted on the test network only. */
  empty: boolean;
  /** The flagged addresses among those asked; `null` — no answer. The signal ends the call at the deadline. */
  flagged(addresses: readonly string[], signal: AbortSignal): Promise<ReadonlySet<string> | null>;
}>;

/** No list connected: nobody is marked. */
export const EMPTY_SOURCE: ListSource = Object.freeze({ empty: true, flagged: async () => new Set<string>() });

/** A source that does not answer — what a person is told when the real one is down. */
export const SILENT_SOURCE: ListSource = Object.freeze({ empty: false, flagged: async () => null });

/** A fixed list: the addresses given are flagged. For trying the gate by hand and for tests. */
export function listSource(addresses: Iterable<string>): ListSource {
  const marked = new Set(addresses);
  return Object.freeze({ empty: false, flagged: async (asked: readonly string[]) => new Set(asked.filter((a) => marked.has(a))) });
}

export function sourceFor(settings: GateSettings): ListSource {
  if (settings.source === 'list') return listSource(settings.list);
  if (settings.source === 'silent') return SILENT_SOURCE;
  return EMPTY_SOURCE;
}

/** How long a source may take before its silence is taken as no answer. */
export const SCREEN_DEADLINE_MS = 5_000;

/**
 * Marks each address by the source within the deadline. Off the test network the empty source is no answer at all:
 * people's money never runs on a stand-in.
 */
export async function screen(
  source: ListSource,
  addresses: readonly string[],
  opts: Readonly<{ testNetwork: boolean; deadlineMs?: number }>,
): Promise<Record<string, Mark>> {
  const all = (mark: Mark): Record<string, Mark> => Object.fromEntries(addresses.map((a) => [a, mark]));
  if (!addresses.length) return {};
  if (source.empty && !opts.testNetwork) return all('unchecked');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, opts.deadlineMs ?? SCREEN_DEADLINE_MS);
  });
  try {
    const flagged = await Promise.race([source.flagged(addresses, controller.signal), deadline]);
    if (!flagged) return all('unchecked');
    return Object.fromEntries(addresses.map((a) => [a, flagged.has(a) ? 'flagged' : 'clear']));
  } catch {
    return all('unchecked');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The windows' stand (CITY-65): `?windows=demo` opens the city's own windows — the chart (CITY-5a), the Exchange
 * (CITY-5d, where its switch is open) and Money (CITY-63) — stuck into the grid of macet M2, so the frame, the sticking
 * and the whole screen can be seen and filmed with what is really inside them. `&full=<id>` opens one of them on the
 * whole screen (macet M3). Development builds only; it opens the windows as a person's taps do, and signs nothing.
 */
export const DEMO_WINDOWS = ['chart', 'exchange', 'money'] as const;

export function windowsDemo(): { full: string | null } | null {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return null;
  const query = new URLSearchParams(location.search);
  if (query.get('windows') !== 'demo') return null;
  const full = query.get('full');
  return { full: full && (DEMO_WINDOWS as readonly string[]).includes(full) ? full : null };
}

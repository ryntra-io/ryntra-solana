/**
 * Concept screens of Ryntra City, for review only: `?look=home|buy|bought|win|launch|rising|agent` draws the
 * screens still to build (buy, launch, agents) over the live city with illustrative numbers. Development builds
 * only; nothing here trades or signs.
 */
export const LOOKS = ['home', 'buy', 'bought', 'win', 'launch', 'rising', 'agent'] as const;
export type Look = (typeof LOOKS)[number];

export function lookMode(): Look | null {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return null;
  const asked = new URLSearchParams(location.search).get('look') ?? '';
  return (LOOKS as readonly string[]).includes(asked) ? (asked as Look) : null;
}

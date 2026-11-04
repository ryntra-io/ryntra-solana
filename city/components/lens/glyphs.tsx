import type { NewStage } from '@/city/lib/lens/lens';

/** «Маяк»: a lighthouse with its beam, in the city's line weight. */
export function LighthouseGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M9.5 21h5l-1-11h-3z" />
      <path d="M9 10h6M10.4 7.5h3.2l-.4 2.5h-2.4z" />
      <path d="M12 4.5v1.2" />
      <path d="M15.5 7.2 21 5.4M15.5 8.6 21 10.4M8.5 7.2 3 5.4M8.5 8.6 3 10.4" opacity="0.7" />
      <path d="M7 21h10" />
    </svg>
  );
}

/** A ring of «New»: the outer one open, the middle half lit, the inner one whole — the way from the edge to the skyline. */
export function RingGlyph({ stage }: { stage: NewStage }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" data-ring={stage}>
      <circle cx="8" cy="8" r="6" opacity={stage === 'fresh' ? 1 : 0.35} strokeDasharray={stage === 'fresh' ? '2.4 2' : undefined} />
      <circle cx="8" cy="8" r="3.6" opacity={stage === 'near' ? 1 : 0.35} />
      <circle cx="8" cy="8" r="1.4" fill={stage === 'graduated' ? 'currentColor' : 'none'} opacity={stage === 'graduated' ? 1 : 0.35} />
    </svg>
  );
}

/** The toggle by «New»: three rows — the rings as a list. */
export function ListGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M7 5.5h9M7 10h9M7 14.5h9" />
      <circle cx="3.6" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.6" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.6" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The toggle back: the three rings. */
export function RingsGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="10" cy="10" r="8" strokeDasharray="2.6 2.2" />
      <circle cx="10" cy="10" r="5" />
      <circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

import l from './launch.module.css';

export type GlyphName = 'picture' | 'clock' | 'lock' | 'bolt' | 'pool' | 'shield' | 'upload' | 'x' | 'telegram' | 'globe' | 'rocket';

/**
 * The marks the Launch screen draws that the kit has not: a picture, a clock and a lock; for the ready formats a bolt,
 * a pool and a shield; for the launchpad an upload, the links' X, Telegram and globe and a rocket
 * for a coin still without its picture — on the kit's grid, with the kit's stroke.
 */
export function Glyph({ name, small = false, className }: { name: GlyphName; small?: boolean; className?: string }) {
  return (
    <svg className={`${l.glyph} ${small ? l.glyphS : ''} ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === 'picture' ? (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M4 17l4.5-4.5 3.5 3.5 3-3 5 5" />
        </>
      ) : name === 'clock' ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </>
      ) : name === 'bolt' ? (
        <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />
      ) : name === 'pool' ? (
        <>
          <ellipse cx="12" cy="6.5" rx="7" ry="2.5" />
          <path d="M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11" />
          <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
        </>
      ) : name === 'shield' ? (
        <>
          <path d="M12 3l7 3v5.5c0 4.3-3 7.7-7 9.5-4-1.8-7-5.2-7-9.5V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </>
      ) : name === 'upload' ? (
        <path d="M12 15.5V4.5M7.5 9L12 4.5 16.5 9M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
      ) : name === 'x' ? (
        <path d="M4.5 4.5h4.2l10.8 15h-4.2zM19.2 4.5l-6.1 6.8M10.9 12.7l-6.1 6.8" />
      ) : name === 'telegram' ? (
        <path d="M20.5 4.5L3.5 11.2l5.6 2 2 6.3 3.2-4 4.7 3.5 1.5-14.5zM9.1 13.2l8.4-6.2-6.4 7.6" />
      ) : name === 'globe' ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5z" />
        </>
      ) : name === 'rocket' ? (
        <>
          <path d="M12 3c3 2.2 4.5 5.4 4.5 9.2V16h-9v-3.8C7.5 8.4 9 5.2 12 3z" />
          <path d="M7.5 13.5L5 16v3l2.5-1.5M16.5 13.5L19 16v3l-2.5-1.5M10.5 19.5h3" />
          <circle cx="12" cy="9.5" r="1.6" />
        </>
      ) : (
        <>
          <rect x="5.5" y="10.5" width="13" height="9" rx="1.5" />
          <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </>
      )}
    </svg>
  );
}

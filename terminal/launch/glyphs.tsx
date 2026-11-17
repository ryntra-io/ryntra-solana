import l from './launch.module.css';

/**
 * The marks the approved design draws on the Launch screen that the kit has not: a picture, a clock and a lock — and,
 * for the ready formats, a bolt, a pool and a shield — on the kit's grid, with the kit's stroke.
 */
export function Glyph({ name, small = false }: { name: 'picture' | 'clock' | 'lock' | 'bolt' | 'pool' | 'shield'; small?: boolean }) {
  return (
    <svg className={`${l.glyph} ${small ? l.glyphS : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
      ) : (
        <>
          <rect x="5.5" y="10.5" width="13" height="9" rx="1.5" />
          <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </>
      )}
    </svg>
  );
}

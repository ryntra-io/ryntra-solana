/** The few signs the coin's head needs beyond the kit's icons: copy, X, Telegram, a site. In the text's colour. */

type Glyph = 'copy' | 'x' | 'telegram' | 'site' | 'info';

/** Drawn with a stroke. */
const STROKES: Readonly<Partial<Record<Glyph, string>>> = {
  copy: 'M9 9h10v10H9zM5 15V5h10',
  telegram: 'M21 4L3 11l6 2 2 6 3-4 5 4 2-15zM9 13l9-6',
  site: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
};

/** Filled: X's own mark, as a link to it is drawn. */
const FILLS: Readonly<Partial<Record<Glyph, string>>> = {
  x: 'M18.9 1.2h3.7l-8 9.2L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9zM17.6 20.6h2L6.5 3.2H4.3z',
};

export function CoinGlyph({ name, size = 16 }: { name: Glyph; size?: number }) {
  const fill = FILLS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...(fill ? { fill: 'currentColor' } : { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })}>
      <path d={fill ?? STROKES[name]} />
    </svg>
  );
}

/**
 * The mark: the Sol Spire rising through the Eclipse. A black disc in a violet-to-warm corona and an amber spire that
 * breaks out of the ring's top — "up", in one shape.
 */
export function Mark({ size = 40, glow = true }: { size?: number; glow?: boolean }) {
  // Fixed ids, not useId: the definitions are the same in every copy of the mark, so a repeated id draws the same
  // thing, and the id cannot differ between the server's page and the browser's.
  const id = `-mark${glow ? '-glow' : ''}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`ring${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="0.65" stopColor="#C9A2FF" />
          <stop offset="1" stopColor="#FFE7C2" />
        </linearGradient>
        <linearGradient id={`spire${id}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#FFB23F" />
          <stop offset="1" stopColor="#FFF6E6" />
        </linearGradient>
        {glow && (
          <filter id={`glow${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <g filter={glow ? `url(#glow${id})` : undefined}>
        <circle cx="32" cy="34" r="19" fill="none" stroke={`url(#ring${id})`} strokeWidth="4.2" />
        <circle cx="32" cy="34" r="16.6" fill="#0B0A14" />
        <path d="M32 2 L37.2 30 L36.2 60 L27.8 60 L26.8 30 Z" fill={`url(#spire${id})`} />
        <path d="M32 2 L34.2 30 L33.4 60 L30.6 60 L29.8 30 Z" fill="#FFFFFF" opacity="0.35" />
      </g>
    </svg>
  );
}

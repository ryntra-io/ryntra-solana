import type { Role } from '@/city/lib/crew/read';

/**
 * The agents' glyphs (CITY-205), drawn for 24 px like the HUD's: the Trader's candles, the Autopilot's split budget, the
 * pool keeper's two rings, the Launcher's rocket. `CrewGlyph` — the crew together, for the command line's row.
 */
export function RoleGlyph({ role, size = 22 }: Readonly<{ role: Role | null; size?: number }>) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (role) {
    case 'trader':
      return (
        <svg {...common}>
          <path d="M7 4v3M7 15v5M17 3v4M17 13v6" />
          <rect x="5" y="7" width="4" height="8" rx="1" />
          <rect x="15" y="7" width="4" height="6" rx="1" />
          <path d="M11 17l2-3 2 2" />
        </svg>
      );
    case 'pilot':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4v8l6.5 4.5M12 12l-6.8 3.8" />
        </svg>
      );
    case 'keeper':
      return (
        <svg {...common}>
          <circle cx="9" cy="12" r="5" />
          <circle cx="15" cy="12" r="5" />
          <path d="M12 4.5V3M12 21v-1.5" />
        </svg>
      );
    case 'launcher':
      return (
        <svg {...common}>
          <path d="M12 3c3 2.2 4.5 5.5 4.5 9.5l-2 3h-5l-2-3C7.5 8.5 9 5.2 12 3z" />
          <circle cx="12" cy="10" r="1.6" />
          <path d="M9.5 15.5L7 19M14.5 15.5L17 19M12 16v5" />
        </svg>
      );
    default:
      return <CrewGlyph size={size} />;
  }
}

export function CrewGlyph({ size = 22 }: Readonly<{ size?: number }>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M2.5 19c.8-3.3 3-5 5.5-5s4.7 1.7 5.5 5M10.5 19c.8-3.3 3-5 5.5-5s4.7 1.7 5.5 5" />
    </svg>
  );
}

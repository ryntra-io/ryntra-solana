/** The partner window's own glyphs: 24 px, one stroke, the frame's line. */

const Svg = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** Two hands meeting: the programme's mark in the window head and the menu. */
export const PartnersGlyph = () => (
  <Svg>
    <path d="M3 12l4-4 4 3 3-3 7 6" />
    <path d="M7 14l3 3M10 13l3 3M13 12l3 3" />
  </Svg>
);

export const BackGlyph = () => (
  <Svg>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const ArrowGlyph = () => (
  <Svg>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const CopyGlyph = () => (
  <Svg>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </Svg>
);

export const QrGlyph = () => (
  <Svg>
    <rect x="4" y="4" width="6" height="6" />
    <rect x="14" y="4" width="6" height="6" />
    <rect x="4" y="14" width="6" height="6" />
    <path d="M14 14h2v2M20 14v6h-4M14 20h0" />
  </Svg>
);

export const CameraGlyph = () => (
  <Svg>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const DownloadGlyph = () => (
  <Svg>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);

export const LockGlyph = () => (
  <Svg>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const RoleGlyph = ({ role }: { role: string }) => {
  if (role === 'scout')
    return (
      <Svg>
        <path d="M6 21V4" />
        <path d="M6 4h11l-3 4 3 4H6" />
      </Svg>
    );
  if (role === 'builder')
    return (
      <Svg>
        <path d="M3 21h18M5 21V10l7-5 7 5v11" />
        <path d="M10 21v-6h4v6" />
      </Svg>
    );
  if (role === 'host')
    return (
      <Svg>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </Svg>
    );
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </Svg>
  );
};

import type { ReactNode } from 'react';
import { cx } from './cx';
import s from './ui.module.css';

/* The terminal's line icons, drawn on a 24 grid with one stroke, as in the approved design. */
const PATHS = {
  market: (
    <>
      <path d="M6 3v4M6 15v6M12 3v2M12 13v8M18 3v6M18 17v4" />
      <rect x="4" y="7" width="4" height="8" rx="1" />
      <rect x="10" y="5" width="4" height="8" rx="1" />
      <rect x="16" y="9" width="4" height="8" rx="1" />
    </>
  ),
  swap: <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />,
  futures: <path d="M3 17l5-6 4 3 6-8M14.5 6H19v4.5" />,
  predict: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.7 2.2c-.8.4-1.2 1-1.2 1.8M12 16.8h.01" />
    </>
  ),
  earn: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
  agents: <path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />,
  launch: (
    <>
      <path d="M12 2.5c3 2.4 4.5 5.6 4.5 9.5v4h-9v-4c0-3.9 1.5-7.1 4.5-9.5zM7.5 12.5L5 15.5V19l2.5-1.5M16.5 12.5l2.5 3V19l-2.5-1.5M10 20.5h4" />
      <circle cx="12" cy="9.5" r="1.6" />
    </>
  ),
  portfolio: <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5zM16 13.5h.01" />,
  city: <path d="M4 21V9l5-3v15M9 21V4l6 3v14M15 21v-9l5 2v7M2 21h20" />,
  more: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  /* The rail's fold: a panel with its side column and an arrow toward it; mirrored when the rail is folded. */
  railFold: <path d="M4 5h16v14H4zM9 5v14M16 9.5L13.5 12l2.5 2.5" />,
  bell: <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  share: <path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />,
  tools: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  depth: <path d="M20 6h-8M20 10H7M20 14h-5M20 18H10M4 4v16" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  info: <path d="M12 11v6M12 7.5h.01" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="10" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  /* The phone's menu: three lines. */
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" />
    </>
  ),
  book: <path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h9.5" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.2.9-1.2 1.8M12 16.6h.01" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  shield: <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6zM9 12l2 2 4-4" />,
  fold: <path d="M4 5h16v14H4zM15 5v14M8.5 9.5 11 12l-2.5 2.5" />,
  unfold: <path d="M4 5h16v14H4zM15 5v14M11 9.5 8.5 12l2.5 2.5" />,
  undo: <path d="M9 14 4.5 9.5 9 5M4.5 9.5h10a5 5 0 0 1 0 10H11" />,
  redo: <path d="M15 14l4.5-4.5L15 5M19.5 9.5h-10a5 5 0 0 0 0 10H13" />,
  wallet: (
    <>
      <path d="M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V7.5Z" />
      <path d="M4 7.5 15.5 4.5v3" />
      <path d="M16 13.5h.01" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** One of the terminal's icons; sizes `s` 16, `m` 20, `l` 24. Decorative: the control around it carries the name. */
export function Icon({ name, size = 'm', className }: { name: IconName; size?: 's' | 'm' | 'l'; className?: string }) {
  return (
    <svg className={cx(s.icon, size === 's' && s.iconS, size === 'l' && s.iconL, className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

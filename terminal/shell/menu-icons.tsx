import type { ReactNode } from 'react';
import type { MenuGroupId, MenuItemId } from './menu';
import s from './shell.module.css';

/* The menu's line icons, drawn on a 24 grid with one stroke, as in the approved menu (docs/terminal/design/2026-11-17-market/Menu.dc.html). */
const PATHS: Readonly<Record<MenuItemId | `group-${MenuGroupId}` | 'out', ReactNode>> = {
  market: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  swap: <path d="M7 7h13l-4-4M17 17H4l4 4" />,
  spot: (
    <>
      <path d="M7 4v16M17 4v16" />
      <rect x="5" y="8" width="4" height="7" />
      <rect x="15" y="6" width="4" height="9" />
    </>
  ),
  futures: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  predict: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  bridge: <path d="M3 17c3-6 15-6 18 0M6 13v4M18 13v4M12 11v6" />,
  launchNew: (
    <>
      <path d="M5 15c-1.5 1.3-2 4-2 6 2 0 4.7-.5 6-2M9 15l-3-3c1.5-4.5 5-9 13-9 0 8-4.5 11.5-9 13z" />
      <circle cx="15" cy="9" r="1.5" />
    </>
  ),
  launchMine: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M9.5 10.5c0-1 1.1-1.8 2.5-1.8s2.5.8 2.5 1.8-1.1 1.5-2.5 1.5-2.5.6-2.5 1.6 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7" />
    </>
  ),
  recurring: <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />,
  grid: <path d="M4 6h16M4 12h16M4 18h16M8 3v18M16 3v18" />,
  ladder: <path d="M4 20h4v-4h4v-4h4V8h4" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" />
      <path d="M16 8V4H4v12h4" />
    </>
  ),
  signals: (
    <>
      <path d="M4 18l5-6 4 3 7-9" />
      <circle cx="20" cy="6" r="1.5" />
    </>
  ),
  keeper: <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6zM9 12l2 2 4-4" />,
  autopilot: <path d="M4 12h4l3-8 4 16 3-8h2" />,
  aiTrader: <path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" />,
  scout: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4M11 8v6M8 11h6" />
    </>
  ),
  analyst: <path d="M4 5h16v11H9l-5 4zM9 10h6" />,
  ownAi: (
    <>
      <rect x="4" y="7" width="16" height="12" />
      <path d="M12 3v4" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
    </>
  ),
  pools: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
  dlmmPro: <path d="M4 20V14M8 20V9M12 20V5M16 20V10M20 20V15M3 20h18" />,
  staking: <path d="M12 3l8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4" />,
  lending: <path d="M3 10l9-6 9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18" />,
  earnMine: (
    <>
      <rect x="3" y="7" width="18" height="13" />
      <path d="M8 7V4h8v3M3 12h18M11 12v2h2v-2" />
    </>
  ),
  overview: (
    <>
      <rect x="3" y="6" width="18" height="14" />
      <path d="M3 10h18M16 15h2" />
    </>
  ),
  positions: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  history: <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2" />,
  saved: <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z" />,
  send: <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />,
  receive: <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />,
  invoices: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  private: (
    <>
      <rect x="5" y="11" width="14" height="10" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  contacts: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4-6 8-6s7 2 8 6" />
    </>
  ),
  autopay: (
    <>
      <rect x="3" y="5" width="18" height="16" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  points: <path d="M12 3l2.5 5 5.5.8-4 3.9 1 5.5L12 15.6 7 18.2l1-5.5-4-3.9 5.5-.8z" />,
  invite: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M19 8v6M16 11h6" />
    </>
  ),
  partners: <path d="M3 12l4-4 5 3 5-3 4 4M7 8l5 9 5-9" />,
  'group-trade': <path d="M7 7h13l-4-4M17 17H4l4 4" />,
  'group-launch': (
    <>
      <path d="M5 15c-1.5 1.3-2 4-2 6 2 0 4.7-.5 6-2M9 15l-3-3c1.5-4.5 5-9 13-9 0 8-4.5 11.5-9 13z" />
      <circle cx="15" cy="9" r="1.5" />
    </>
  ),
  'group-bots': (
    <>
      <rect x="4" y="7" width="16" height="12" />
      <path d="M12 3v4M9 12v2M15 12v2M2 12v3M22 12v3" />
    </>
  ),
  'group-agents': <path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z" />,
  'group-earn': (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
  'group-portfolio': <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5zM16 13.5h.01" />,
  'group-money': <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />,
  'group-rewards': (
    <>
      <rect x="3" y="9" width="18" height="12" />
      <path d="M3 13h18M12 9v12M12 9c-1.5-3-5-4.5-6-2.5S9 9 12 9zM12 9c1.5-3 5-4.5 6-2.5S15 9 12 9z" />
    </>
  ),
  out: <path d="M8 16L16 8M9.5 8H16v6.5" />,
};

export type MenuIconName = keyof typeof PATHS;

export function MenuIcon({ name, small = false }: { name: MenuIconName; small?: boolean }) {
  return (
    <svg className={small ? s.miS : s.mi} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

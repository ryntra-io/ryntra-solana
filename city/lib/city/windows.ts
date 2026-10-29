import { create } from 'zustand';

/**
 * «A window is open» — one question for the whole home. While any window or panel is open, the HUD's own pieces give way: the event
 * feed and its gear hide, the moment banners wait, the card above the dock and the first-visit hint step aside. Each
 * window keeps its own store; this only reads them. The window frame of CITY-65 can ask the same question.
 */

export type WindowName =
  | 'predict'
  | 'trade'
  | 'money'
  | 'chart'
  | 'exchange'
  | 'harbor'
  | 'mine'
  | 'scouts'
  | 'vault'
  | 'hall'
  | 'agent'
  | 'beacon'
  | 'assistant'
  | 'how'
  | 'moments'
  | 'launch'
  | 'build'
  | 'menu'
  | 'settings';

/** What each window's store says about itself, as the stores hold it. A store not given counts as closed. */
export type WindowSources = Readonly<{
  predict?: Readonly<{ open: boolean }>;
  trade?: Readonly<{ open: boolean }>;
  money?: Readonly<{ open: boolean }>;
  chart?: Readonly<{ mint: string | null }>;
  exchange?: Readonly<{ open: boolean }>;
  harbor?: Readonly<{ open: boolean }>;
  mine?: Readonly<{ open: boolean }>;
  scouts?: Readonly<{ open: boolean }>;
  vault?: Readonly<{ open: boolean }>;
  hall?: Readonly<{ panel: boolean }>;
  agent?: Readonly<{ panel: string }>;
  beacon?: Readonly<{ openFor: string | null }>;
  assistant?: Readonly<{ open: boolean }>;
  how?: Readonly<{ open: boolean }>;
  moments?: Readonly<{ sheet: unknown }>;
  launch?: Readonly<{ sheet: boolean }>;
  build?: Readonly<{ on: boolean }>;
  hud?: Readonly<{ menu: boolean; settings: boolean }>;
}>;

/** The windows in the order they are asked; the first open one is named. */
export const WINDOWS: readonly WindowName[] = ['predict', 'trade', 'money', 'chart', 'exchange', 'harbor', 'mine', 'scouts', 'vault', 'hall', 'agent', 'beacon', 'assistant', 'how', 'moments', 'launch', 'build', 'menu', 'settings'];

const IS_OPEN: Readonly<Record<WindowName, (src: WindowSources) => boolean>> = {
  predict: (s) => !!s.predict?.open,
  trade: (s) => !!s.trade?.open,
  money: (s) => !!s.money?.open,
  chart: (s) => s.chart?.mint != null,
  exchange: (s) => !!s.exchange?.open,
  harbor: (s) => !!s.harbor?.open,
  mine: (s) => !!s.mine?.open,
  scouts: (s) => !!s.scouts?.open,
  vault: (s) => !!s.vault?.open,
  hall: (s) => !!s.hall?.panel,
  agent: (s) => s.agent != null && s.agent.panel !== 'none',
  beacon: (s) => s.beacon?.openFor != null,
  assistant: (s) => !!s.assistant?.open,
  how: (s) => !!s.how?.open,
  moments: (s) => s.moments?.sheet != null && s.moments.sheet !== false,
  launch: (s) => !!s.launch?.sheet,
  build: (s) => !!s.build?.on,
  menu: (s) => !!s.hud?.menu,
  settings: (s) => !!s.hud?.settings,
};

/** The first open window, or null when the city is clear. */
export function openWindow(src: WindowSources): WindowName | null {
  for (const name of WINDOWS) if (IS_OPEN[name](src)) return name;
  return null;
}

/** True while any window or panel is open. */
export function windowOpen(src: WindowSources): boolean {
  return openWindow(src) !== null;
}

/**
 * The HUD's own two panels: the menu (☰) and «Settings» opened from it. One at a time: opening one closes the other.
 */
type HudPanels = Readonly<{
  menu: boolean;
  settings: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;
  openSettings: () => void;
  closeSettings: () => void;
}>;

export const useHudPanels = create<HudPanels>((set) => ({
  menu: false,
  settings: false,
  toggleMenu: () => set((st) => ({ menu: !st.menu, settings: false })),
  closeMenu: () => set({ menu: false }),
  openSettings: () => set({ menu: false, settings: true }),
  closeSettings: () => set({ settings: false }),
}));

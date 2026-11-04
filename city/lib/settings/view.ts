import { create } from 'zustand';
import { useHudPanels } from '../city/windows.ts';

/**
 * The settings window (CITY-87): one window of the city's frame, opened from the avatar (the wallet in the top bar), the
 * menu's «Settings» or `?open=settings`. Whether it is open is the HUD's own `settings` (`../city/windows.ts`), so «a
 * window is open», Escape and «Back» already know it; this keeps which section it shows.
 */

export const SECTIONS = ['wallet', 'trading', 'notifications', 'layouts', 'language', 'sound', 'display', 'security'] as const;
export type Section = (typeof SECTIONS)[number];

type View = { section: Section; show: (section: Section) => void };

export const useSettingsView = create<View>((set) => ({
  section: 'notifications',
  show: (section) => set({ section }),
}));

/** Opens the window on a section, or where it was. */
export function openSettings(section?: Section): void {
  if (section) useSettingsView.setState({ section });
  useHudPanels.getState().openSettings();
}

export function closeSettings(): void {
  useHudPanels.getState().closeSettings();
}

import { create } from 'zustand';

/**
 * Which tower's chart is open (CITY-5a): one at a time, opened from the tower card's «Chart». The window follows the
 * picked tower while it is open and closes with the card; Escape closes the window before anything under it.
 */
type TowerChartState = {
  /** The open chart's mint; null — no chart. */
  mint: string | null;
  open: (mint: string) => void;
  close: () => void;
};

export const useTowerChart = create<TowerChartState>((set) => ({
  mint: null,
  open: (mint) => set({ mint }),
  close: () => set({ mint: null }),
}));

/** Whether a tower's chart is open: the HUD's Escape leaves the tower card alone while it is. */
export const chartOpen = (): boolean => useTowerChart.getState().mint !== null;

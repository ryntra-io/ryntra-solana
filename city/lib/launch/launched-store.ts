import { create } from 'zustand';
import { startDistrict, useLaunch } from './district.ts';

/**
 * «Launched on Ryntra» as a window of the city (CITY-185): whether it is open. Its list is the Launch district's own
 * feed (`district.ts`), started here when it has not been yet; the window reads, it never signs.
 */
type LaunchedState = {
  open: boolean;
  show: () => void;
  close: () => void;
};

export const useLaunched = create<LaunchedState>((set) => ({
  open: false,
  show: () => {
    startDistrict();
    /* One panel at a time: the launch sheet gives way, unless a launch is under way in it. */
    const launch = useLaunch.getState();
    if (launch.sheet && (!launch.phase || launch.phase.step === 'done' || launch.phase.step === 'failed')) launch.closeSheet();
    set({ open: true });
  },
  close: () => set({ open: false }),
}));

/** Opens «Launched on Ryntra»: from its own address (`/launches`) and from `/?open=launches`. */
export function openLaunched(): void {
  useLaunched.getState().show();
}

/* The store for the development stand's shots; never in a production bundle. */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __launched: useLaunched });

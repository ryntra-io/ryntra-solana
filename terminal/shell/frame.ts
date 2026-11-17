import { usePathname } from 'next/navigation';
import { create } from 'zustand';
import { shelfAt, viewOf, type ShelfId, type View } from './shelves.ts';

/**
 * The frame's own state: which of its panels is open — the events, the wallet, «More», the phone's sections sheet.
 * One at a time: opening one closes the other, and moving to another screen closes it.
 */
export type FramePanel = 'events' | 'wallet' | 'more' | 'sheet';

type FrameState = { panel: FramePanel | null };

export const useFrame = create<FrameState>(() => ({ panel: null }));

/**
 * The place a phone's header keeps for the screen in front: a screen that has its own big line for the agent — the
 * Agents screen — puts its name and one quiet control there, and the header's line steps aside for them.
 */
export const PHONE_HEAD = 'terminal-phone-head';

export function openPanel(panel: FramePanel): void {
  useFrame.setState({ panel });
}

export function togglePanel(panel: FramePanel): void {
  useFrame.setState((state) => ({ panel: state.panel === panel ? null : panel }));
}

export function closePanel(panel?: FramePanel): void {
  useFrame.setState((state) => (panel === undefined || state.panel === panel ? { panel: null } : state));
}

/** What the frame shows here and which shelf is in front, read from the address. */
export function useWhere(): Readonly<{ view: View; shelf: ShelfId | null; pathname: string }> {
  const pathname = usePathname() ?? '/';
  return { view: viewOf(pathname), shelf: shelfAt(pathname), pathname };
}

import { create } from 'zustand';

/**
 * Whether «Learn» (CITY-202) is open over the city, and on which chapter. The menu (☰) opens it on the list, the command
 * line on the chapter a question names («how does the agent work» → the agent); the window lives in the city's one frame
 * and closes as every window does. `chapter` null is the list of chapters (on a phone, the first screen).
 */
type LearnState = Readonly<{
  open: boolean;
  chapter: string | null;
  show: (chapter?: string | null) => void;
  go: (chapter: string | null) => void;
  hide: () => void;
}>;

export const useLearn = create<LearnState>((set) => ({
  open: false,
  chapter: null,
  show: (chapter = null) => set({ open: true, chapter }),
  go: (chapter) => set({ chapter }),
  hide: () => set({ open: false }),
}));

export const openLearn = (chapter: string | null = null): void => useLearn.getState().show(chapter);

// The stand and the screens for review (`city/components/learn/learn-shots.mjs`): development builds only.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __learn: useLearn });

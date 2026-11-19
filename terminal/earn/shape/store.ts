import { create } from 'zustand';
import { commit, historyOf, isColumns, presetColumns, readSaved, redo, undo, withSaved, writeSaved, type Columns, type History, type Preset, type SavedShape } from './model.ts';

/**
 * The grid on the ticket and the person's own shapes: what is painted with its strokes back and forth, and
 * the shapes kept in this browser. The grid outlives the ticket for the visit, so the person may look at a goal and
 * come back to their painting; the kept shapes outlive the visit, in this browser alone.
 */
type Store = {
  history: History;
  /** Whether a grid was started in this visit; until then, the goal in force is where it starts. */
  started: boolean;
  saved: readonly SavedShape[] | null;
  /** A grid kept — painted, started from a shape, taken from the person's own. */
  set: (columns: Columns) => void;
  start: (preset: Preset) => void;
  /** Starts from `preset` only if nothing was painted in this visit. */
  begin: (preset: Preset) => Columns;
  undo: () => void;
  redo: () => void;
  load: () => void;
  save: (name: string) => boolean;
  remove: (id: string) => void;
};

let made = 0;
const freshId = (): string => `${Date.now().toString(36)}-${(made += 1).toString(36)}`;

export const useShape = create<Store>((set, get) => ({
  history: historyOf(presetColumns('wave')),
  started: false,
  saved: null,
  set: (columns) => {
    if (!isColumns(columns)) return;
    set({ history: commit(get().history, columns), started: true });
  },
  start: (preset) => set({ history: commit(get().history, presetColumns(preset)), started: true }),
  begin: (preset) => {
    if (!get().started) set({ history: historyOf(presetColumns(preset)), started: true });
    return get().history.present;
  },
  undo: () => set({ history: undo(get().history) }),
  redo: () => set({ history: redo(get().history) }),
  load: () => {
    if (get().saved === null) set({ saved: readSaved() });
  },
  save: (name) => {
    const next = withSaved(get().saved ?? readSaved(), name, get().history.present, freshId());
    set({ saved: next });
    return writeSaved(next);
  },
  remove: (id) => {
    const next = (get().saved ?? []).filter((shape) => shape.id !== id);
    set({ saved: next });
    writeSaved(next);
  },
}));

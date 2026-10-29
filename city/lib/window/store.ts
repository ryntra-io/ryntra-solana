import type { ReactNode } from 'react';
import { create } from 'zustand';
import { windowed, type Guide, type Rect, type Size, type Viewport } from './geometry.ts';
import {
  carryIn,
  closeIn,
  emptyLayout,
  exitFullIn,
  fullIn,
  gridIn,
  openIn,
  placed,
  popOutIn,
  raiseIn,
  type Layout,
} from './layout.ts';
import { readMemory, recall, remember, writeMemory, type Memory } from './memory.ts';
import { readOutMemory, rememberOut, writeOutMemory, type OutMemory, type Out, type Params, type Via } from './detach.ts';

/**
 * The city's windows (CITY-65): one frame for every window over the city — the swap and the spot (CITY-62), the chart
 * (CITY-5a), the futures (CITY-5d), the money (CITY-63). A window plugs in with one line:
 *
 *   openWindow({ id: 'swap', title: 'Swap', icon: <SwapGlyph />, render: () => <SwapPanel />, min: { width: 360, height: 420 } });
 *
 * The frame brings the head with «full screen», «pop out» and «close», the dragging, the sticking and the stretching;
 * the window brings only what is inside it. On a phone the same window is a bottom sheet that can take the whole
 * screen. Where the windows stand is remembered on this device.
 */

export type WindowSpec = Readonly<{
  /** One per window: opening it again brings the open one to the front. */
  id: string;
  /** The words in the head, English: «Swap», «Chart · BONK/USDC». */
  title: string;
  /** A 24 px glyph drawn in the head, in the frame's orange. */
  icon?: ReactNode;
  /** What is inside the window. Called on every draw of the window, never on a drag. */
  render: () => ReactNode;
  /** The least the window shrinks to; 280 × 180 when not given. */
  min?: Partial<Size>;
  /** Its size the first time it opens on this device; 560 × 440 when not given. */
  size?: Size;
  /**
   * While true the person cannot close the window from its frame (a signature is in the wallet, a transaction on its
   * way): «Close» waits. Open the window again with `held: false` when it may close.
   */
  held?: boolean;
  /** Called after the person closes the window from its frame; not on `closeWindow`, whose caller already knows. */
  onClose?: () => void;
  /**
   * The window can go out onto another screen (CITY-75): what its own page needs to show the same thing — `{ tower }`
   * for a tower's chart, `{}` when nothing. Without it the frame has no «Open in a new window».
   */
  detach?: Params;
}>;

/** Where every open window stands, as `layout()` reports it. */
export type WindowPlace = Readonly<{ id: string; rect: Rect; full: boolean; front: boolean }>;

type State = {
  /** What is drawn: the person's layout carried onto this screen, or a drag in progress. */
  layout: Layout;
  /** The layout as the person last set it, on the screen it was set on: a resize carries from here, never from a carried one. */
  base: Layout;
  specs: Readonly<Record<string, WindowSpec>>;
  /** The orange lines while a window is dragged near an edge. */
  guides: readonly Guide[];
  viewport: Viewport;
  /** The windows float and stick (a computer) or stand as the bottom sheet (a phone). */
  desk: boolean;
  /** The windows out on another screen (CITY-75), and how: their specs stay here, the city draws no frame for them. */
  out: Readonly<Record<string, Out>>;
  /** The page is one window on its own (`/window`): nothing it does is remembered as the city's layout. */
  alone: boolean;
  setViewport: (viewport: Viewport) => void;
  open: (spec: WindowSpec) => void;
  /** A new title, contents or hold for an open window, where it stands: never brought to the front, nothing remembered. */
  update: (spec: WindowSpec) => void;
  close: (id: string) => void;
  /** «Close» in the frame: the window closes unless it is held, then tells its owner. */
  dismiss: (id: string) => void;
  raise: (id: string) => void;
  full: (id: string) => void;
  exitFull: () => void;
  popOut: (id: string) => void;
  grid: () => void;
  /** A drag in progress: the layout it has made so far and its guides; nothing is remembered yet. */
  drag: (layout: Layout, guides: readonly Guide[]) => void;
  /** The drag is over: the place is remembered and the guides go. */
  settle: () => void;
  /** An open window goes out onto another screen: its place in the city is remembered, its frame leaves the city. */
  detach: (id: string, via: Via, size: Size) => void;
  /** A window out there comes back to the city where it stood, its size out there remembered for next time. */
  attach: (id: string, size?: Size | null) => void;
};

const FALLBACK: Viewport = { width: 1440, height: 860 };
const viewportNow = (): Viewport => (typeof window === 'undefined' ? FALLBACK : { width: window.innerWidth, height: window.innerHeight });
const local = () => (typeof window === 'undefined' ? null : window.localStorage);

let memory: Memory | null | undefined;
const memoryNow = () => (memory === undefined ? (memory = readMemory(local)) : memory);
let alone = false;
function keep(layout: Layout) {
  if (alone) return;
  memory = remember(memoryNow(), layout);
  writeMemory(local, memory);
}

let outMemory: OutMemory | undefined;
const outMemoryNow = () => (outMemory === undefined ? (outMemory = readOutMemory(local)) : outMemory);
function keepOut(id: string, out: boolean, size?: Size | null) {
  if (alone) return;
  outMemory = rememberOut(outMemoryNow(), id, out, size);
  writeOutMemory(local, outMemory);
}

export const useWindows = create<State>((set, get) => {
  /** A change the person made: drawn, and remembered on this device. */
  const commit = (layout: Layout) => {
    if (layout === get().layout) return;
    set({ layout, base: layout, guides: [] });
    keep(layout);
  };
  const start = viewportNow();
  const first = emptyLayout(start);
  return {
    layout: first,
    base: first,
    specs: {},
    guides: [],
    viewport: start,
    desk: windowed(start),
    out: {},
    alone: false,
    setViewport: (viewport) => {
      const now = get();
      if (now.viewport.width === viewport.width && now.viewport.height === viewport.height) return;
      // The places are carried, not remembered: a narrower window for a moment does not overwrite the person's layout.
      set({ viewport, desk: windowed(viewport), layout: carryIn(now.base, viewport) });
    },
    open: (spec) => {
      const now = get();
      const fresh = !placed(now.layout, spec.id);
      const layout = openIn(now.layout, spec, fresh ? recall(memoryNow(), spec.id, now.layout.area) : null);
      set({ specs: { ...now.specs, [spec.id]: spec } });
      commit(layout);
    },
    update: (spec) => {
      const now = get();
      if ((!placed(now.layout, spec.id) && !now.out[spec.id]) || now.specs[spec.id] === spec) return;
      set({ specs: { ...now.specs, [spec.id]: spec } });
    },
    close: (id) => {
      const now = get();
      if (now.out[id]) {
        // The owner closed a window that is out: it closes out there too. It is still remembered as out, so it goes out
        // again the next time it opens.
        const out = { ...now.out };
        delete out[id];
        const specs = { ...now.specs };
        delete specs[id];
        return set({ out, specs });
      }
      if (!placed(now.layout, id)) return;
      // Remembered while still open, so the closed window keeps its place for next time.
      keep(now.layout);
      const specs = { ...now.specs };
      delete specs[id];
      const layout = closeIn(now.layout, id);
      set({ specs, layout, base: layout, guides: [] });
    },
    // Only the order changes: the person's places stay as they set them.
    dismiss: (id) => {
      const spec = get().specs[id];
      if (!spec || spec.held) return;
      get().close(id);
      spec.onClose?.();
    },
    raise: (id) => {
      const now = get();
      const layout = raiseIn(now.layout, id);
      if (layout !== now.layout) set({ layout, base: raiseIn(now.base, id) });
    },
    full: (id) => commit(fullIn(get().layout, id)),
    exitFull: () => commit(exitFullIn(get().layout)),
    popOut: (id) => commit(popOutIn(get().layout, id)),
    grid: () => commit(gridIn(get().layout)),
    drag: (layout, guides) => set({ layout, guides }),
    settle: () => {
      set({ guides: [], base: get().layout });
      keep(get().layout);
    },
    detach: (id, via, size) => {
      const now = get();
      if (!placed(now.layout, id) || !now.specs[id]?.detach || now.out[id]) return;
      // Remembered while still in the city, so it comes back where it stood.
      keep(now.layout);
      const layout = closeIn(now.layout, id);
      set({ layout, base: layout, guides: [], out: { ...now.out, [id]: { via, size } } });
      keepOut(id, true, size);
    },
    attach: (id, size) => {
      const now = get();
      if (!now.out[id]) return;
      const out = { ...now.out };
      delete out[id];
      set({ out });
      keepOut(id, false, size ?? now.out[id].size);
      const spec = now.specs[id];
      if (spec) commit(openIn(get().layout, spec, recall(memoryNow(), id, get().layout.area)));
    },
  };
});

/** Opens a window over the city, or brings it to the front with its new title and contents if it is open. */
export function openWindow(spec: WindowSpec): void {
  useWindows.getState().open(spec);
}

/**
 * A new title, contents or hold for a window that is open, where it stands and at its depth: what a window's owner calls
 * as its data changes (a price in the title, a signature held), so a live window never jumps to the front by itself.
 * A window that is not open stays closed.
 */
export function updateWindow(spec: WindowSpec): void {
  useWindows.getState().update(spec);
}

export function closeWindow(id: string): void {
  useWindows.getState().close(id);
}

/**
 * Where the open windows stand, bottom to top. `layout('grid')` first sticks them all into one grid over the
 * workspace, in the order they were opened (macet M2).
 */
export function layout(arrange?: 'grid'): WindowPlace[] {
  const state = useWindows.getState();
  if (arrange === 'grid') state.grid();
  const now = useWindows.getState().layout;
  const front = now.windows.at(-1)?.id ?? null;
  return now.windows.map((w) => ({ id: w.id, rect: w.rect, full: now.full === w.id, front: w.id === front }));
}

/** Whether the person had this window out on another screen the last time it was open (CITY-75). */
export function windowWasOut(id: string): boolean {
  return outMemoryNow().out.includes(id);
}

/** The window's last size out on another screen, when it has been out on this device. */
export function outSizeOf(id: string): Size | null {
  return outMemoryNow().sizes[id] ?? null;
}

/**
 * The page is one window on its own (`/window`, CITY-75): it opens its one window through the same store, but nothing
 * it does is remembered as the city's layout — the city's own places stay as the person set them.
 */
export function standAlone(): void {
  alone = true;
  useWindows.setState({ alone: true, desk: true });
}

/** Forgets what this module read from the device, for tests that change the storage under it. */
export function forgetMemoryForTests(): void {
  memory = undefined;
  outMemory = undefined;
  alone = false;
}

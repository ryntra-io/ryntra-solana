import type { ReactNode } from 'react';
import { create } from 'zustand';
import { baysOf, windowed, type Guide, type Rect, type Size, type Viewport } from './geometry.ts';
import {
  carryIn,
  closeIn,
  dropIn,
  emptyLayout,
  exitFullIn,
  framesIn,
  fullIn,
  gridIn,
  openIn,
  placed,
  placeIn,
  popOutIn,
  raiseIn,
  top,
  type Drop,
  type Layout,
  type Recall,
} from './layout.ts';
import { readMemory, recall, remember, writeMemory, type Memory } from './memory.ts';
import { readOutMemory, rememberOut, writeOutMemory, type OutMemory, type Out, type Params, type Via } from './detach.ts';
import {
  desksOf,
  GUEST,
  keepShot,
  mergeShot,
  NO_DESKS,
  presetPlan,
  readDesks,
  shotOf,
  shotPlan,
  withDesks,
  writeDesks,
  type DeskKey,
  type DeskMemory,
  type OwnDesks,
  ownerOf,
  type Planned,
  type Slot,
} from './desks.ts';

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
   * The frame stands as tall as what is inside it, never taller than its place (CITY-201): a card that says one thing —
   * the agent's — in a bay or on a phone's sheet shows no empty glass under its last line; more than fits scrolls.
   */
  fit?: boolean;
  /**
   * While true the person cannot close the window from its frame (a signature is in the wallet, a transaction on its
   * way): «Close» waits. Open the window again with `held: false` when it may close.
   */
  held?: boolean;
  /** Called after the person closes the window from its frame; not on `closeWindow`, whose caller already knows. */
  onClose?: () => void;
  /**
   * The window can go out onto another screen (CITY-75): what its own page needs to show the same thing — `{ tower }`
   * for a tower's chart, `{}` when nothing. Without it the frame has no «Open in a new window». A layout of the person's
   * keeps it too (CITY-84), so the window opens on the same thing again.
   */
  detach?: Params;
  /**
   * The live figure on the window's chip in the tray while it is folded (CITY-84): a price, a balance — an element of a
   * small component of the window's own that reads its own store, given the title for when there is nothing to show
   * yet and what the window showed (`Chip.params`). Without it the chip shows the window's title.
   */
  figure?: (title: string, params: Params) => ReactNode;
}>;

/**
 * A window folded into the tray (CITY-84): closed as its own «Close» would close it, its chip keeping what is needed to
 * open it again on the same thing — the tower, the market, the tab — where it stood.
 */
export type Chip = Readonly<{ id: string; title: string; icon?: ReactNode; figure?: WindowSpec['figure']; params: Params }>;

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
  /** The place a dragged window would land if let go now (CITY-84): a bay, or another frame's head. */
  landing: Drop | null;
  /** A frame is being dragged: what the city does behind the windows waits for the drag to end (`base` until then). */
  moving: boolean;
  viewport: Viewport;
  /** The windows float and stick (a computer) or stand as the bottom sheet (a phone). */
  desk: boolean;
  /** The windows out on another screen (CITY-75), and how: their specs stay here, the city draws no frame for them. */
  out: Readonly<Record<string, Out>>;
  /** The page is one window on its own (`/window`): nothing it does is remembered as the city's layout. */
  alone: boolean;
  /** Whose layouts are in use (CITY-84): the connected wallet's address, or «guest». */
  owner: string;
  /** That wallet's four layouts and the one in use in this visit. */
  desks: OwnDesks;
  /** A layout is being put in place: the frames glide to their new places instead of jumping there. */
  glide: boolean;
  /** Windows a layout placed that their owners are still opening: where each will stand, until when. */
  plan: Readonly<Record<string, Readonly<{ recall: Recall; until: number }>>>;
  /** The tray over the Deck: the folded windows, the one folded first first. A chip goes when its window opens. */
  chips: readonly Chip[];
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
  /** A drag in progress: the layout it has made so far, its guides and where it would land; nothing is remembered yet. */
  drag: (layout: Layout, guides: readonly Guide[], landing?: Drop | null) => void;
  /** The drag is over: the place is remembered and the guides go. */
  settle: () => void;
  /** An open window goes out onto another screen: its place in the city is remembered, its frame leaves the city. */
  detach: (id: string, via: Via, size: Size) => void;
  /** A window out there comes back to the city where it stood, its size out there remembered for next time. */
  attach: (id: string, size?: Size | null) => void;
  /**
   * «Minimise»: the window folds into the tray over the Deck — closed as its own «Close» would close it, so nothing of it
   * stays over the city, its chip keeping `params` to open it again — unless a signature holds it. Its place is
   * remembered; the layout in use keeps it.
   */
  fold: (id: string, params?: Params) => void;
  /** A chip gone without its window opening (its window cannot open here any more). */
  dropChip: (id: string) => void;
  /** A drag let go over a place to land: the window docks in that bay or joins that frame as a tab. */
  drop: (id: string, drop: Drop) => void;
  /**
   * A layout put in use: the windows open in it move to their places and every other one closes as its own «Close»
   * would (a held one stays). Returns the windows still to open, for their owners: each stands where planned when it
   * opens.
   */
  applyDesk: (key: DeskKey, can: (id: string) => boolean) => Readonly<{ later: readonly Planned[]; wanted: readonly string[] }>;
  /** An empty place of the person's tapped: the windows as they stand kept there, and that layout put in use. */
  keepDesk: (slot: Slot) => void;
  /** One of the person's layouts forgotten. */
  clearDesk: (slot: Slot) => void;
  /** The wallet connected or changed: its layouts come into use; no window moves. */
  setOwner: (address: string | null) => void;
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

let deskMemory: DeskMemory | undefined;
const deskMemoryNow = () => (deskMemory === undefined ? (deskMemory = readDesks(local)) : deskMemory);
function keepDesks(owner: string, own: OwnDesks) {
  if (alone) return;
  deskMemory = withDesks(deskMemoryNow(), owner, own);
  writeDesks(local, deskMemory);
}

/** How long a layout waits for a window's owner to open it, and how long the frames glide. */
const PLAN_MS = 4_000;
const GLIDE_MS = 320;
let glideTimer: ReturnType<typeof setTimeout> | undefined;
/** A layout is being put in place: the windows it closes on the way are not a change the layout in use keeps. */
let applying = false;
/** Whose layouts were read last: the wallet's store tells of every change, the layouts are read once per wallet. */
let desksOwner: string | null = null;

let outMemory: OutMemory | undefined;
const outMemoryNow = () => (outMemory === undefined ? (outMemory = readOutMemory(local)) : outMemory);
function keepOut(id: string, out: boolean, size?: Size | null) {
  if (alone) return;
  outMemory = rememberOut(outMemoryNow(), id, out, size);
  writeOutMemory(local, outMemory);
}

export const useWindows = create<State>((set, get) => {
  /**
   * The layout of the person's in use follows the screen, unless a layout is still being put in place: the windows on it
   * as they stand, the ones it had and that are not on the screen now (folded, closed for a run) kept, and a window the
   * person closed (`closed`) let go.
   */
  const follow = (layout: Layout, closed: ReadonlySet<string> = new Set()) => {
    const now = get();
    const slot = now.desks.active;
    if (typeof slot !== 'number' || alone || applying || Object.values(now.plan).some((p) => p.until > Date.now())) return;
    const shot = mergeShot(now.desks.slots[slot] ?? null, shotOf(layout, (id) => now.specs[id]?.detach), closed);
    if (!shot) return;
    const desks = keepShot(now.desks, slot, shot);
    set({ desks });
    keepDesks(now.owner, desks);
  };
  /** A change the person made: drawn, and remembered on this device. */
  const commit = (layout: Layout) => {
    if (layout === get().layout) return set({ moving: false });
    set({ layout, base: layout, guides: [], landing: null, moving: false });
    keep(layout);
    follow(layout);
  };
  /** The frames glide to where a command put them (a layout, a bay, the tray), never during a drag. */
  const glide = () => {
    set({ glide: true });
    clearTimeout(glideTimer);
    glideTimer = setTimeout(() => set({ glide: false }), GLIDE_MS);
  };
  const placeFor = (id: string, layout: Layout): Recall | null => {
    const planned = get().plan[id];
    if (planned) {
      const plan = { ...get().plan };
      delete plan[id];
      set({ plan });
      if (planned.until > Date.now()) return planned.recall;
    }
    const remembered = recall(memoryNow(), id, layout.area);
    // A remembered bay whose frame waits on a signature: the window stands elsewhere rather than hide it as a tab. A bay
    // this screen lacks is the one it has.
    const bay = remembered?.bay ? (baysOf(layout.area).includes(remembered.bay) ? remembered.bay : 'right') : null;
    const holder = bay ? framesIn(layout).find((f) => f.bay === bay) : null;
    if (remembered && !(holder && heldNow(holder.id))) return remembered;
    return null;
  };
  /** A signature holds this window: a new one never hides it as a tab. */
  const heldNow = (id: string) => Boolean(get().specs[id]?.held);
  const start = viewportNow();
  const first = emptyLayout(start);
  return {
    layout: first,
    base: first,
    specs: {},
    guides: [],
    landing: null,
    moving: false,
    viewport: start,
    desk: windowed(start),
    out: {},
    alone: false,
    owner: GUEST,
    desks: NO_DESKS,
    glide: false,
    plan: {},
    chips: [],
    setViewport: (viewport) => {
      const now = get();
      if (now.viewport.width === viewport.width && now.viewport.height === viewport.height) return;
      // The places are carried, not remembered: a narrower window for a moment does not overwrite the person's layout.
      set({ viewport, desk: windowed(viewport), layout: carryIn(now.base, viewport) });
    },
    open: (spec) => {
      const now = get();
      const fresh = !placed(now.layout, spec.id);
      const layout = openIn(now.layout, spec, fresh ? placeFor(spec.id, now.layout) : null);
      // Open again, however it was asked for: its chip leaves the tray.
      set({ specs: { ...now.specs, [spec.id]: spec }, chips: now.chips.filter((c) => c.id !== spec.id) });
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
    // «Close» in the frame is the person's: the layout in use keeps it. A window its owner closes (a run, filming, a
    // tower gone) is not a change to the person's layout.
    dismiss: (id) => {
      const spec = get().specs[id];
      if (!spec || spec.held) return;
      get().close(id);
      spec.onClose?.();
      follow(get().layout, new Set([id]));
    },
    raise: (id) => {
      const now = get();
      const layout = raiseIn(now.layout, id);
      if (layout !== now.layout) set({ layout, base: raiseIn(now.base, id) });
    },
    full: (id) => {
      glide();
      commit(fullIn(get().layout, id));
    },
    exitFull: () => {
      glide();
      commit(exitFullIn(get().layout));
    },
    popOut: (id) => {
      glide();
      commit(popOutIn(get().layout, id));
    },
    grid: () => {
      glide();
      commit(gridIn(get().layout));
    },
    drag: (layout, guides, landing = null) => set({ layout, guides, landing, moving: true }),
    settle: () => {
      set({ guides: [], landing: null, moving: false, base: get().layout });
      keep(get().layout);
      follow(get().layout);
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
    fold: (id, params = {}) => {
      const now = get();
      const spec = now.specs[id];
      // A signature in the wallet keeps its window in sight: the person sees how it ends.
      if (!spec || spec.held || !placed(now.layout, id)) return;
      const chip: Chip = { id, title: spec.title, icon: spec.icon, figure: spec.figure, params };
      set({ chips: [...now.chips.filter((c) => c.id !== id), chip] });
      // Closed as its own «Close» closes it — the owner hears of it — its place remembered for when it opens again.
      get().close(id);
      spec.onClose?.();
    },
    dropChip: (id) => set({ chips: get().chips.filter((c) => c.id !== id) }),
    drop: (id, drop) => {
      const next = dropIn(get().layout, id, drop);
      // Nowhere to land after all: the drag settles where it is.
      if (next === get().layout) return get().settle();
      glide();
      commit(next);
    },
    applyDesk: (key, can) => {
      const now = get();
      const shot = typeof key === 'number' ? now.desks.slots[key] : null;
      if (typeof key === 'number' && !shot) return { later: [], wanted: [] };
      const area = now.layout.area;
      const planned = (shot ? shotPlan(shot, area) : presetPlan(key as Exclude<DeskKey, number>, area, can)).filter((p) => placed(now.layout, p.id) || can(p.id));
      const wanted = new Set(planned.map((p) => p.id));
      // Every window the layout does not have closes, as its own «Close» would — the owner hears of it, so a window one
      // stands in the place of (a chart in the trade card's) lets the other open — unless a signature holds it.
      applying = true;
      try {
        for (const w of now.layout.windows) if (!wanted.has(w.id)) get().dismiss(w.id);
      } finally {
        applying = false;
      }
      let layout: Layout = { ...exitFullIn(get().layout), bays: shot ? shot.bays : get().layout.bays };
      // The ones open move to their places, in order: the last stands in front.
      const later: Planned[] = [];
      for (const p of planned) {
        if (placed(layout, p.id)) layout = placeIn(layout, p.id, p.recall);
        else later.push(p);
      }
      const until = Date.now() + PLAN_MS;
      const plan = { ...get().plan };
      for (const p of later) plan[p.id] = { recall: p.recall, until };
      const desks = { ...get().desks, active: key };
      set({ plan, desks });
      keepDesks(now.owner, desks);
      glide();
      commit(layout);
      return { later, wanted: [...wanted] };
    },
    keepDesk: (slot) => {
      const now = get();
      const shot = shotOf(now.layout, (id) => now.specs[id]?.detach);
      const desks = { ...(shot ? keepShot(now.desks, slot, shot) : now.desks), active: slot };
      // Another layout taken into use: what an earlier one still waited to open stands wherever it opens.
      set({ desks, plan: {} });
      keepDesks(now.owner, desks);
    },
    clearDesk: (slot) => {
      const now = get();
      const desks = { ...keepShot(now.desks, slot, null), active: now.desks.active === slot ? null : now.desks.active };
      set({ desks });
      keepDesks(now.owner, desks);
    },
    setOwner: (address) => {
      const owner = ownerOf(address);
      if (owner === desksOwner) return;
      desksOwner = owner;
      // A new visit starts with no layout in use: the first windows a person opens after a reload are not «a change» to
      // the layout they last used, which would otherwise keep only them.
      set({ owner, desks: { ...desksOf(deskMemoryNow(), owner), active: null } });
    },
  };
});

/**
 * The layout the city behind the windows answers to: the one drawn, or — while a frame is dragged — the one before the
 * drag, so the city neither dims nor sharpens under a frame on its way.
 */
export const settledLayout = (st: Pick<State, 'moving' | 'base' | 'layout'>): Layout => (st.moving ? st.base : st.layout);

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
  const front = top(now)?.id ?? null;
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
  deskMemory = undefined;
  desksOwner = null;
  alone = false;
}

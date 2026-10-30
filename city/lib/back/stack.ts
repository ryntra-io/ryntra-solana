/**
 * «Back» over the city (CITY-6e): every layer the person opens — a window, a sheet, a panel, the tower's card, a window
 * on the whole screen — stands on its own entry of the page's history, so the system «Back» of an Android phone (the
 * Ryntra app's WebView goes back while it can) and a browser's «Back» close the top layer instead of leaving. On the
 * city's own view, with nothing open, there is no entry of ours left: «Back» leaves, as it always did.
 *
 * The layers' own stores stay the truth of what is open; this only follows them:
 * - a layer that opens gets one `pushState` entry (the same address: a deep link keeps its address under it);
 * - a layer that closes from its own button gives its entry back (`history.go(-n)`), so «Back» never lands on nothing;
 * - one layer giving way to another in the same moment (the city keeps one panel at a time) and anything that changes
 *   inside a layer (its tabs) keep the entry as it is — the history never grows from that;
 * - `popstate` closes the layers above the entry it lands on, top first. A layer that will not close (a window held
 *   while the wallet signs) keeps its entry: the one that «Back» took is pushed again, so «Back» waits — it never
 *   leaves the app in the middle of a signature — and once signed, the next «Back» closes it as usual.
 *
 * Pure: the window's history and timers come in, so a test walks it with a history of its own (`stack.test.mjs`).
 */

/** The key of the city's mark in a history entry's state; the rest of the state (Next.js's own) is kept as it is. */
export const BACK_KEY = '__ryntraBack';

/** How long a step back of our own may take before the stack stops waiting for its `popstate`. */
export const TRAVEL_MS = 1_000;

export type BackHistory = {
  readonly state: unknown;
  pushState: (data: unknown, unused: string, url?: string | null) => void;
  replaceState: (data: unknown, unused: string, url?: string | null) => void;
  go: (delta: number) => void;
};

export type BackEnv = Readonly<{
  history: BackHistory;
  location: Readonly<{ href: string }>;
  /** Hears `popstate`; returns the undo. */
  listen: (onPop: (state: unknown) => void) => () => void;
  /** Runs `run` after `ms` (0: after the current task); returns the cancel. */
  later: (run: () => void, ms: number) => () => void;
  /** Tells this page's entries from another load's; random when not given. */
  session?: string;
}>;

export type BackLayers = Readonly<{
  /** The open layers now, in the order to stack the ones opened together (bottom first). */
  read: () => readonly string[];
  /** Closes one layer, as its own close button would. */
  close: (id: string) => void;
}>;

export type BackStack = Readonly<{
  /** Something may have opened or closed: the stack follows after the current task. */
  changed: () => void;
  /** The layers that stand on an entry of their own, bottom to top. */
  layers: () => readonly string[];
  dispose: () => void;
}>;

type Mark = Readonly<{ s: string; d: number }>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function markOf(state: unknown): Mark | null {
  const mark = isRecord(state) ? state[BACK_KEY] : null;
  return isRecord(mark) && typeof mark.s === 'string' && typeof mark.d === 'number' ? { s: mark.s, d: mark.d } : null;
}

export function createBackStack(env: BackEnv, layers: BackLayers): BackStack {
  const { history, location } = env;
  const session = env.session ?? Math.random().toString(36).slice(2);
  /** One layer per entry above the city's own, bottom to top. */
  let stack: string[] = [];
  /** A step back of our own on its way: the address it left from, and the wait's cancel. */
  let travel: { href: string; cancel: () => void } | null = null;
  let pending: (() => void) | null = null;
  let alive = true;

  const entry = (depth: number) => ({ ...(isRecord(history.state) ? history.state : {}), [BACK_KEY]: { s: session, d: depth } });

  const schedule = () => {
    if (!alive || pending) return;
    pending = env.later(follow, 0);
  };

  const back = (steps: number) => {
    travel = { href: location.href, cancel: env.later(arrived, TRAVEL_MS) };
    history.go(-steps);
  };

  /** Our step back has landed (or its wait ran out). */
  function arrived() {
    if (!travel) return;
    const { href, cancel } = travel;
    travel = null;
    cancel();
    // The page changed its address while the layers were open (home, from a deep link, is `/`): the entry it comes back
    // to says the same. Without Next.js's own mark, so its router takes the address too.
    if (location.href !== href) history.replaceState({ [BACK_KEY]: { s: session, d: stack.length } }, '', href);
    schedule();
  }

  /** The entries follow the layers: one pushed per layer opened, given back per layer closed. */
  function follow() {
    pending = null;
    if (!alive || travel) return;
    const open = layers.read();
    const kept = stack.filter((id) => open.includes(id));
    const added = open.filter((id) => !stack.includes(id));
    const depth = stack.length;
    stack = [...kept, ...added];
    for (let d = depth + 1; d <= stack.length; d += 1) history.pushState(entry(d), '');
    if (stack.length < depth) back(depth - stack.length);
  }

  const stop = env.listen((state) => {
    if (!alive) return;
    if (travel) return arrived();
    const mark = markOf(state);
    // An entry without our mark (Next.js may write its own over it, a reload starts a new page) is one step back.
    const depth = mark?.s === session ? mark.d : Math.max(0, stack.length - 1);
    if (depth > stack.length) {
      // «Forward» onto an entry whose layer is gone: back to the top of what stands.
      back(depth - stack.length);
      return;
    }
    for (const id of stack.slice(depth).reverse()) {
      layers.close(id);
      if (!layers.read().includes(id)) continue;
      // Held (the wallet signs): it and the layers under it keep their entries, and the one this «Back» took is pushed
      // again — «Back» waits instead of leaving the app mid-signature. The history does not grow: the push replaces the
      // forward entry the step back left.
      stack = stack.slice(0, stack.indexOf(id) + 1);
      for (let d = depth + 1; d <= stack.length; d += 1) history.pushState(entry(d), '');
      schedule();
      return;
    }
    stack = stack.slice(0, depth);
    schedule();
  });

  schedule();

  return {
    changed: schedule,
    layers: () => stack,
    dispose: () => {
      alive = false;
      pending?.();
      pending = null;
      travel?.cancel();
      travel = null;
      stop();
    },
  };
}

/** The stack on this page's own history and timers. */
export function browserBackStack(layers: BackLayers): BackStack {
  return createBackStack(
    {
      history: window.history,
      location: window.location,
      listen: (onPop) => {
        const hear = (event: PopStateEvent) => onPop(event.state);
        window.addEventListener('popstate', hear);
        return () => window.removeEventListener('popstate', hear);
      },
      later: (run, ms) => {
        const timer = window.setTimeout(run, ms);
        return () => window.clearTimeout(timer);
      },
    },
    layers,
  );
}

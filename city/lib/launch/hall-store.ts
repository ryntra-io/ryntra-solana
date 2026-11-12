import { create } from 'zustand';
import { hallOpen, readHallView, type HallBoardId, type HallView } from './hall.ts';

/**
 * The Hall of Fame in the browser: the week's boards as `/api/city/hall` answers them, read again every few minutes
 * while the page is seen, and the panel that shows them as a table. Closed for people until the deployment's switch
 * says `open`; a development build can stand it in with `?hall=stub` (or `month`, `all`, `empty`), every screen saying so.
 */

export const HALL_SWITCH = hallOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_HALL);
/** The Hall is read again this often; the server keeps one for a few minutes, so sooner would read the same. */
export const HALL_READ_MS = 3 * 60_000;
/** A read still pending after this is said as unanswered: a cold server works the week out first. */
export const HALL_TIMEOUT_MS = 45_000;
/** Without any Hall yet, a failed read is tried again this soon. */
export const HALL_RETRY_MS = 30_000;

type HallState = {
  /** `reading` until the first answer; `live` with a Hall; `off` — closed here, or never answered. */
  status: 'reading' | 'live' | 'off';
  view: HallView | null;
  /** Running on the development stand-in: every screen says so. */
  stub: boolean;
  panel: boolean;
  board: HallBoardId;
  show: (board?: HallBoardId) => void;
  pick: (board: HallBoardId) => void;
  close: () => void;
};

export const useHall = create<HallState>((set) => ({
  status: 'reading',
  view: null,
  stub: false,
  panel: false,
  board: 'catch',
  show: (board) => set((state) => ({ panel: true, board: board ?? state.board })),
  pick: (board) => set({ board }),
  close: () => set({ panel: false }),
}));

/* Development only, as `window.__city`: the shots open the panel on a board without a tap (`hall-230-shots.mjs`). */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __hall: useHall });

/** Whether the Hall stands in the city now: open here (or stood in), and read. */
export const hallShown = (state: Pick<HallState, 'status' | 'view'>) => state.status === 'live' && state.view !== null;

/* The development stand-in, never in a production bundle. */
const loadStub = process.env.NODE_ENV === 'production' ? null : () => import('./hall-stub.ts');
const STUB_ASKED = ['stub', 'month', 'all', 'empty'] as const;
const stubAsked = (): (typeof STUB_ASKED)[number] | null => {
  if (typeof window === 'undefined') return null;
  const asked = new URLSearchParams(window.location.search).get('hall');
  return STUB_ASKED.find((kind) => kind === asked) ?? null;
};

/** One read of the Hall: its answer, `closed` when the deployment keeps it shut, or null when nothing whole came. */
export async function fetchHall(fetcher: typeof fetch = (input, init) => fetch(input, init), timeoutMs: number = HALL_TIMEOUT_MS): Promise<HallView | 'closed' | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('/api/city/hall', { cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
    if (response.status === 404) return 'closed';
    if (!response.ok) return null;
    return readHallView(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let started = false;

/** Start the Hall once for the page: the stand-in in development when asked, else the switch, then the reads. */
export function startHall(): () => void {
  if (started) return () => undefined;
  started = true;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const asked = stubAsked();
  if (loadStub && asked) {
    void loadStub().then((stub) => {
      if (!stopped) useHall.setState({ status: 'live', stub: true, view: stub.stubHall(Date.now(), asked) });
    });
    return () => {
      stopped = true;
      started = false;
    };
  }
  if (!HALL_SWITCH) {
    useHall.setState({ status: 'off' });
    return () => {
      started = false;
    };
  }

  const read = async () => {
    const answer = await fetchHall();
    if (stopped) return;
    if (answer === 'closed') {
      useHall.setState({ status: 'off', view: null, panel: false });
      return;
    }
    /* A read that fails keeps the last Hall with its own read time; with none, the Hall stays out of the city. */
    if (answer) useHall.setState({ status: 'live', view: answer });
    else if (!useHall.getState().view) useHall.setState({ status: 'off' });
    schedule(useHall.getState().view ? HALL_READ_MS : HALL_RETRY_MS);
  };
  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      if (document.visibilityState === 'hidden') schedule(ms);
      else void read();
    }, ms);
  };
  void read();
  return () => {
    stopped = true;
    started = false;
    if (timer) clearTimeout(timer);
  };
}

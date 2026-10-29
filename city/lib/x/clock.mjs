// The studio's clock (CITY-38): the page lives on virtual time, so a city drawn in software at one frame a second
// still films at 60 frames a second, every frame on its exact beat. Installed before any page script (Playwright's
// `addInitScript`); `performance.now`, `Date.now`, `requestAnimationFrame` and the page's timers all read it.
//   * auto — every real frame moves the clock one 60th of a second on: the page loads, the city settles, and its own
//     frame-rate watch sees a smooth 60 and keeps the best quality;
//   * manual — the clock moves only when the studio steps it (`__xclock.step(ms)`), and each step draws one frame.
// Nothing here talks to a server or changes what the city shows: it only decides when "now" is.

/** The function Playwright runs in the page before its scripts. It must stand alone: no closure over this module. */
export function installClock(tickMs = 1000 / 60) {
  if (window.__xclock) return;
  const real = {
    now: performance.now.bind(performance),
    raf: window.requestAnimationFrame.bind(window),
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  };
  const RealDate = Date;
  let now = real.now();
  const epoch = RealDate.now() - now;
  let manual = false;
  let seq = 1;
  /** id → { at, fn, args, every } */
  const timers = new Map();
  let frames = new Map();

  performance.now = () => now;
  Date.now = () => Math.floor(epoch + now);
  // `new Date()` without arguments is "now" too.
  class VirtualDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(Math.floor(epoch + now));
      else super(...args);
    }
    static now() {
      return Math.floor(epoch + now);
    }
  }
  window.Date = VirtualDate;

  const add = (fn, ms, args, every) => {
    const id = seq++;
    const wait = Math.max(0, Number(ms) || 0);
    timers.set(id, { at: now + wait, fn, args, every: every ? Math.max(1, wait) : 0 });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  window.clearTimeout = (id) => void timers.delete(id);
  window.clearInterval = (id) => void timers.delete(id);
  window.requestAnimationFrame = (fn) => {
    const id = seq++;
    frames.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => void frames.delete(id);

  const call = (fn, args) => {
    try {
      if (typeof fn === "function") fn(...args);
      else if (typeof fn === "string") (0, eval)(fn);
    } catch (e) {
      // One failing callback never stops the clock; the page's own error handlers still hear about it.
      real.setTimeout(() => {
        throw e;
      }, 0);
    }
  };

  /** Runs every timer due by `until`, in order, moving the clock to each one's time. */
  const runTimers = (until) => {
    for (let guard = 0; guard < 10_000; guard += 1) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= until && (!next || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      now = Math.max(now, t.at);
      if (t.every) t.at += t.every;
      else timers.delete(id);
      call(t.fn, t.args);
    }
    now = Math.max(now, until);
  };

  /** One frame: the clock moves on, the timers due run, then every frame callback waiting for this frame. */
  const tick = (ms) => {
    runTimers(now + ms);
    const due = frames;
    frames = new Map();
    for (const fn of due.values()) call(fn, [now]);
  };

  const pump = () => {
    if (!manual) tick(tickMs);
    real.raf(pump);
  };
  real.raf(pump);
  // A hidden or throttled page gets no real frames; timers still move in auto mode.
  const idle = () => {
    if (!manual && document.visibilityState === "hidden") tick(tickMs);
    real.setTimeout(idle, 50);
  };
  real.setTimeout(idle, 50);

  window.__xclock = {
    get now() {
      return now;
    },
    get manual() {
      return manual;
    },
    /** Hands the clock to the studio (true) or back to the page's own frames (false). */
    hold(on) {
      manual = !!on;
    },
    /** Moves the clock `ms` on and draws one frame; resolves after the frame, in the same task as its drawing. */
    step(ms = tickMs) {
      tick(ms);
      return now;
    },
    tickMs,
  };
}

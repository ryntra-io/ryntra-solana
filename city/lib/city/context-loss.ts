/**
 * The city's drawing surface comes back after the browser takes it (CITY-200). A phone under memory pressure, a GPU
 * driver reset or a shader compile that runs out of memory loses the WebGL context; the city then stood white with no
 * way back but a reload. Now the loss is claimed (`preventDefault`, so the browser may give the context back), the city
 * holds its night colour, and a fresh canvas is mounted once the context is restored — or after `waitMs` if it never is.
 */

export type Timers = Readonly<{ set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void }>;

const REAL: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export const CONTEXT_WAIT_MS = 2_500;

export function watchContext(canvas: EventTarget, onLost: () => void, onBack: () => void, waitMs = CONTEXT_WAIT_MS, timers: Timers = REAL): () => void {
  let pending: unknown = null;
  const back = () => {
    if (pending === null) return;
    timers.clear(pending);
    pending = null;
    onBack();
  };
  const lost = (event: Event) => {
    event.preventDefault();
    if (pending !== null) return;
    onLost();
    pending = timers.set(back, waitMs);
  };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', back);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', back);
    if (pending !== null) timers.clear(pending);
    pending = null;
  };
}

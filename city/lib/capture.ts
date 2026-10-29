/**
 * Grabbing a frame of the city without keeping the drawing buffer alive (which costs every frame):
 * a request waits until the frame after the composer has rendered, then copies the canvas in the same task.
 * A stream gets every frame the same way, while a clip is being recorded.
 */
type Waiter = (frame: HTMLCanvasElement) => void;
const waiting: Waiter[] = [];
const streams = new Set<Waiter>();

export function requestFrame(): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => waiting.push(resolve));
}

/** Every rendered frame goes to `onFrame` until the returned function is called. Draw from it at once. */
export function streamFrames(onFrame: Waiter): () => void {
  streams.add(onFrame);
  return () => streams.delete(onFrame);
}

export function hasFrameRequests() {
  return waiting.length > 0 || streams.size > 0;
}

/** Called by the scene right after it renders. */
export function deliverFrame(source: HTMLCanvasElement) {
  for (const onFrame of streams) onFrame(source);
  if (!waiting.length) return;
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext('2d')?.drawImage(source, 0, 0);
  for (const resolve of waiting.splice(0)) resolve(copy);
}

import type { Viewer } from './frames.ts';

/** What this browser asks for: less motion, less data. In the browser only; the server draws the full motion. */
export function readViewer(): Viewer {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return { reduced: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, saveData: connection?.saveData === true };
}

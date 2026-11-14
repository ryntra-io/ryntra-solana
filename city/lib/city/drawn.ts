/**
 * Whether the city's first frame is on the screen (CITY-6a). The scene sets it after its first composed frame; a tap
 * before it has nothing to pick, and work that can wait (the score) waits for it. No three.js here, so the page's own
 * bundle can ask.
 */
let drawn = false;
const waiting = new Set<() => void>();

export function cityDrawn(): boolean {
  return drawn;
}

/** Called on every frame; only the first one is news. */
export function markDrawn(): void {
  if (drawn) return;
  drawn = true;
  for (const heard of [...waiting]) {
    waiting.delete(heard);
    try {
      heard();
    } catch {
      /* A listener never stands in the way of the frame. */
    }
  }
}

/** Once, when the first frame is drawn — at once if it already is (CITY-246: the funnel's «the city was seen»). Returns the undo. */
export function onDrawn(heard: () => void): () => void {
  if (drawn) {
    heard();
    return () => {};
  }
  waiting.add(heard);
  return () => {
    waiting.delete(heard);
  };
}

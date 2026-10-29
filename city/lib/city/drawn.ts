/**
 * Whether the city's first frame is on the screen (CITY-6a). The scene sets it after its first composed frame; a tap
 * before it has nothing to pick, and work that can wait (the score) waits for it. No three.js here, so the page's own
 * bundle can ask.
 */
let drawn = false;

export function cityDrawn(): boolean {
  return drawn;
}

export function markDrawn(): void {
  drawn = true;
}

/**
 * Your colour in the city: one of eight lights, picked by your wallet address, so the same wallet glows the same on
 * every device and nobody has to choose. The eight stay clear of the city's meanings: amber is the one action, mint is
 * value going up, red is danger.
 */
export const PLAYER_COLOURS = ['#5CE1FF', '#6FB6FF', '#8C9BFF', '#A98BFF', '#D883FF', '#FF7AC8', '#C8F560', '#E6D4FF'] as const;

/** FNV-1a over the address: small, stable, and the same in every browser. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function colourOf(address: string): string {
  return PLAYER_COLOURS[hash(address) % PLAYER_COLOURS.length]!;
}

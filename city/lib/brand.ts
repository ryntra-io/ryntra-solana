/**
 * The public name lives here and nowhere else, so a rename is one edit. Ryntra City is the face of Ryntra (decision 70).
 */
export const BRAND: Readonly<{ name: string; codename: string; hook: string; line: string; domain: string }> = {
  /** The public name. */
  name: 'Ryntra',
  /** Internal only: the folder of this face in the repo. Never shown to people. */
  codename: 'city',
  /** The first line a visitor reads. */
  hook: 'Every coin is a tower.',
  line: 'The Solana market as a living city. Catch the next tower, launch your own.',
  /** Where the city lives. */
  domain: 'ryntra.io',
};

/** The title for the browser tab and share cards: the name when approved, the hook until then. */
export const brandTitle = (): string => (BRAND.name ? `${BRAND.name} — ${BRAND.hook}` : BRAND.hook);

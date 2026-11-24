/**
 * The site's pages that still described Ryntra as the 3D city — every coin a tower, seven districts, «enter the city» —
 * lead to the documentation of the terminal (`/docs`), which says what Ryntra does today (decision 105: the
 * person sees the terminal; the city is a separate view at `/city`, never a description of the product).
 * Nothing of the old product stays in what people read.
 *
 * - «What we're building» (`/build`), its PDFs and the addresses that led to it (`/investors`, the old
 *   investor decks): a deck of the city's seven places.
 * - «How it works» (`/how-it-works`): films of the city's windows, «try it in the living Solana city».
 * - «Ryntra from A to Z» (`/learn`): the static guide that opens on «The city and its towers».
 *
 * Each for now (307): the page's code stays in the repository, and a page rewritten for the terminal takes its address
 * back by leaving this list. Pure data, no imports: the build's config reads it before anything is compiled.
 */

export type RetiredPage = Readonly<{ source: string; destination: string; permanent: false }>;

const DOCS = '/docs';
const DOCS_UK = '/docs?lang=uk';

export const RETIRED_PAGE_REDIRECTS: readonly RetiredPage[] = [
  { source: '/build', destination: DOCS, permanent: false },
  { source: '/investors', destination: DOCS, permanent: false },
  { source: '/decks/ryntra-investors-:rest', destination: DOCS, permanent: false },
  { source: '/decks/ryntra-what-we-build-:rest', destination: DOCS, permanent: false },
  { source: '/how-it-works', destination: DOCS, permanent: false },
  { source: '/learn', destination: DOCS, permanent: false },
  { source: '/learn/index.html', destination: DOCS, permanent: false },
  { source: '/learn/uk', destination: DOCS_UK, permanent: false },
  { source: '/learn/uk.html', destination: DOCS_UK, permanent: false },
];

/** The addresses this list answers: an older row of the config under one of them is never reached. */
export function retiredPage(source: string): boolean {
  return RETIRED_PAGE_REDIRECTS.some((row) => row.source === source);
}

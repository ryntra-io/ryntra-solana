/**
 * ryntra.io's home page and its door into the app.
 *
 * Since MC-0 (decision 68) `/` is Mission Control's Orbit, with its two scenes `/live` and
 * `/mission/<mint>`.
 * Putting rows back (`{ source, has: RYNTRA_HOST, destination, permanent: false }`) leads the home page into the app
 * again — temporarily, only on ryntra.io; `next.config.ts` puts these rows first and the sitemap stops advertising `/`
 * while any holds.
 */
const RYNTRA_HOST = [{ type: "host" as const, value: "ryntra\\.io" }];

type HostRow = Readonly<{ source: string; has: typeof RYNTRA_HOST; destination: string; permanent: false }>;

export const HOME_TO_APP: readonly HostRow[] = [];

/** Whether ryntra.io's home page is a page today, or the door into the app. */
export const LANDING_IS_LIVE = HOME_TO_APP.length === 0;

/**
 * Mission Control speaks English only: on ryntra.io the Ukrainian home leads to
 * it, temporarily — the Ukrainian landing stays in the code (`app/(home)/uk/page.tsx`). Only on ryntra.io: the other
 * hosts keep their own rules for `/uk` (predict.ryntra.io sends it to ryntra.io itself).
 */
export const HOME_ENGLISH_ONLY: readonly HostRow[] = [
  { source: "/uk", has: RYNTRA_HOST, destination: "/", permanent: false },
  /* `/ua` is `/uk`'s alias elsewhere; here it goes straight home, one hop. */
  { source: "/ua", has: RYNTRA_HOST, destination: "/", permanent: false },
];

/**
 * Which single rail entry is current.
 *
 * **The longest matching href wins, and nothing else decides it.** Every
 * candidate matches on a segment boundary rather than on characters, so
 * `/app/pay` is not a prefix of `/app/payouts`.
 *
 * Two versions of this have shipped wrong, both because a link was asked a
 * question only the rail can answer. An unbounded `startsWith` lit two rows at
 * once. Replacing it with *exact match on these four hrefs, prefix match
 * elsewhere* moved the defect rather than removing it: the four were
 * hand-kept, `/robinhood/workspace` was never added, and every Discover surface under
 * it lit Radar as well as itself — two `aria-current="page"` links on the
 * Screener, the Scanner and the Watchlist alike. Making `/robinhood/workspace` exact
 * instead would have broken the other direction, leaving the Asset Passport
 * with no current entry at all.
 *
 * Longest match needs no list and has no second direction to break:
 * `/robinhood/workspace` wins for the Passport, `/robinhood/workspace/screener` wins for the
 * Screener, and a new child route joins by existing.
 *
 * It lives in its own leaf module rather than inside the shell component for
 * the reason the rest of this repository puts decisions in leaves: a `.tsx`
 * client component cannot be exercised by `node --test`, and a rule with no
 * test is a rule that has already been wrong twice.
 */
export function navActiveHref(pathname: string, hrefs: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (!href) continue;
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}

/**
 * Which word a rail row uses to say it is current, and whether it only contains
 * the open page.
 *
 * The rule lives here rather than inside the shell component for the reason
 * `navActiveHref` does: a `.tsx` client component cannot be exercised by
 * `node --test`, and this rule has now been wrong in both directions.
 *
 * - An **ancestor** of the open page is `within`: a quiet left edge, no
 *   `aria-current`. Lighting `РАДАР` on pages it did not own was the first
 *   defect.
 * - A **domain** the person is standing inside is current but is not the page,
 *   so it takes ARIA's word for the current item of a set, `true`.
 * - A **domain whose href is also a page's** yields `page` to that page. Control
 *   opens on Agent Control's decision queue, so the domain row and the
 *   `Needs a person` row point at one URL and both claimed to be the page.
 * - A domain that is the only match keeps `page`. Home is its own landing and
 *   has nothing to step back for, and the first version of the yield rule took
 *   the word away from it because the domains group was counted as "inside".
 */
export function railCurrent(
  entryHref: string | null | undefined,
  activeHref: string | null,
  /** The winning href *is* the open route, rather than an ancestor of it. */
  activeIsExact: boolean,
  options: { domain?: boolean; pageIsInside?: boolean } = {},
): Readonly<{ current: "page" | "true" | null; within: boolean }> {
  if (!entryHref || entryHref !== activeHref) return { current: null, within: false };
  const exact = activeIsExact;
  const yields = options.domain === true && options.pageIsInside === true;
  if (exact && !yields) return { current: "page", within: false };
  return { current: options.domain === true ? "true" : null, within: true };
}

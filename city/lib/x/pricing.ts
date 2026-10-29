/**
 * What a post costs on X API's pay-per-use plan: $0.015 for a post, $0.20 for a post with a link. These are the
 * figures of the CITY-39 brief (the X marketing research of 27.10); the owner checks them against the Developer
 * Console (Billing → usage) before the first post, and a change is one line here. Every city draft carries a link back
 * to its tower, so a city post is counted at the link price; 4 posts a day ≈ $0.80, a 30-day month ≈ $24.
 */

export const X_PRICE_USD = { post: 0.015, postWithLink: 0.2 } as const;

/**
 * A link as X would make one: a URL, or a bare domain like `ryntra.io` (X links those too). When in doubt it counts
 * as a link: the budget errs on the side of paying more.
 */
export function hasLink(text: string): boolean {
  return /\bhttps?:\/\/\S+/i.test(text) || /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i.test(text);
}

export function postCost(text: string): number {
  return hasLink(text) ? X_PRICE_USD.postWithLink : X_PRICE_USD.post;
}

/** Sums money in cents' thousandths, so $0.015 × n never drifts. */
export function sumUsd(values: readonly number[]): number {
  return Math.round(values.reduce((s, v) => s + Math.round(v * 100_000), 0)) / 100_000;
}

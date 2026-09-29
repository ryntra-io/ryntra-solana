/* Relative rather than the `@/` alias, and deliberately: this module is walked
   by `stellar.test.mjs` under plain `node --test`, which resolves no alias. An
   import the test runner cannot follow would leave the destination list
   unchecked, which is the one thing it exists to prevent. */
import { GUARD_HREF } from "../site/nav.ts";

import { FEATURED_ASSETS, assetHref } from "./workspace/assets/featured.ts";

/**
 * Every internal destination the public Stellar page can send someone to.
 *
 * One list, imported by the page and walked by `stellar.test.mjs`, which
 * resolves each entry against the routes that are actually mounted. Two lists
 * that must agree do not: every time that shape has appeared in this repository
 * it has disagreed silently, and this particular disagreement has already
 * shipped twice — `/stellar/asset/{CODE:ISSUER}`, which four documents said was
 * the Passport URL, and a `/presentation` hero that never existed.
 *
 * The founder's brief named `/developers#stellar` and `/stellar/receipts/{id}`.
 * Neither is mounted — `/developers` carries no Stellar section and receipts are
 * verified by pasting a document rather than by id — so the page points at the
 * surfaces that exist and those two are recorded as follow-up work.
 */
export const STELLAR_DESTINATIONS = {
  /** The workspace: the actual end-user product, not this page. */
  workspace: "/stellar/workspace",
  /** Asset search by exact identity. */
  assets: "/stellar/workspace/assets",
  /** The primary call to action: one real mainnet RWA. */
  passport: assetHref(FEATURED_ASSETS[0].id),
  /** The secondary call to action: recompute a receipt, re-read the ledger. */
  receipts: "/stellar/workspace/receipts",
  /** Every read, its source, and what the adapter refuses. */
  adapter: "/stellar/workspace/developers",
  /** Every registered module and the gate it waits on. */
  map: "/stellar/workspace/map",
  /** The single developer surface for the whole product. */
  developers: GUARD_HREF,
  /** The Handbook, which owns capability status. */
  handbook: "/docs",
} as const;

export type StellarDestination = keyof typeof STELLAR_DESTINATIONS;

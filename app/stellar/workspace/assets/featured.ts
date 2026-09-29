/**
 * A short starting list of real Stellar mainnet assets.
 *
 * Not a ranking, not a recommendation and not a market. It exists because the
 * only other way into a passport is to already know a 56-character issuer
 * address, and a search box with nothing beside it is a dead end for anyone who
 * has not memorised one.
 *
 * Every entry was resolved against Horizon on 2026-08-13. The `note` states what
 * the asset **is**, never whether it is good — an asset list that editorialises
 * becomes a recommendation, and this product does not make those.
 */

export type FeaturedAsset = Readonly<{
  code: string;
  issuer: string;
  /** `CODE:ISSUER`, the canonical identity. */
  id: string;
  /** What it is. Factual, never an opinion about it. */
  note: string;
}>;

const featured = (code: string, issuer: string, note: string): FeaturedAsset => ({
  code,
  issuer,
  id: `${code}:${issuer}`,
  note,
});

export const FEATURED_ASSETS: readonly FeaturedAsset[] = [
  featured(
    "USTRY",
    "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC",
    "Etherfuse Stablebond — issuer states US Treasury Notes as backing",
  ),
  featured(
    "CETES",
    "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC",
    "Etherfuse Stablebond — issuer states Mexican government debt as backing",
  ),
  featured(
    "USDC",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "Circle USDC — the issuer can revoke a holder's authorization",
  ),
  featured(
    "EURC",
    "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
    "Circle EURC — euro-denominated",
  ),
];

/** The passport route for an asset identity. */
export function assetHref(id: string): string {
  return `/stellar/workspace/assets/${encodeURIComponent(id)}`;
}

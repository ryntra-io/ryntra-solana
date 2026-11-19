/**
 * Reaching a wallet from a browser that has none.
 *
 * A phone's Safari or Chrome carries no Solana wallet: the Wallet Standard
 * finds nothing to connect, and a beginner who pressed «Підключити гаманець»
 * there met a sentence about the standard and no way on. Phantom documents one
 * path for exactly this — a link that opens the page inside its own in-app
 * browser, where the wallet is present: `https://phantom.app/ul/browse/<url>
 * ?ref=<ref>`, both parts URL-encoded (docs.phantom.com, «Browse», read
 * 2026-09-24). The payment page uses it, and so do the top-up and the
 * connection panel («Почати з картки»: «Відкрити в Phantom»).
 *
 * A computer is different: a wallet there is an extension, and the one honest
 * step is to install one.
 *
 * Pure and dependency-free: the page decides with the browser's own user
 * agent, and tests read the rules without one.
 */

/** Phantom's own download page (answered 200 on 2026-09-24). */
export const PHANTOM_DOWNLOAD_URL = "https://phantom.com/download";

/** Solflare's and Backpack's download pages (both answered 200 on 2026-10-20) — the other two wallets the panel names. */
export const SOLFLARE_DOWNLOAD_URL = "https://solflare.com/download";
export const BACKPACK_DOWNLOAD_URL = "https://backpack.app/downloads";

/** The link that opens `pageUrl` inside Solflare's in-app browser (its universal link «browse», answered 200 on 2026-10-20). */
export function solflareBrowseUrl(pageUrl: string, origin: string): string {
  return `https://solflare.com/ul/v1/browse/${encodeURIComponent(withoutFragment(pageUrl))}?ref=${encodeURIComponent(origin)}`;
}

/**
 * The page's address without its `#fragment`. A fragment is the browser's own — it never reaches a server — and a page
 * may keep a secret there (a private link's one-time key). Handing the whole address to a wallet's universal link would
 * put that secret into another site's address, so the fragment is always left behind.
 */
export function withoutFragment(pageUrl: string): string {
  const at = pageUrl.indexOf("#");
  return at < 0 ? pageUrl : pageUrl.slice(0, at);
}

/** The link that opens `pageUrl` inside Phantom's in-app browser — without its fragment (`withoutFragment`). */
export function phantomBrowseUrl(pageUrl: string, origin: string): string {
  return `https://phantom.app/ul/browse/${encodeURIComponent(withoutFragment(pageUrl))}?ref=${encodeURIComponent(origin)}`;
}

/**
 * A phone or a tablet, by the browser's own words — the same test the payment
 * page makes. An iPad that reports itself as a Mac is read as a computer,
 * which costs it one extra step (the install link), never a wrong one.
 */
export function isPhoneUserAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && /Android|iPhone|iPad|iPod/i.test(userAgent);
}

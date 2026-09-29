/**
 * Reaching a wallet from a browser that has none.
 *
 * A phone's Safari or Chrome carries no Solana wallet: the Wallet Standard
 * finds nothing to connect, and a beginner who pressed «Під'єднати гаманець»
 * there met a sentence about the standard and no way on. Phantom documents one
 * path for exactly this — a link that opens the page inside its own in-app
 * browser, where the wallet is present: `https://phantom.app/ul/browse/<url>
 * ?ref=<ref>`, both parts URL-encoded (docs.phantom.com, «Browse», read
 * 2026-09-24). The payment page has used it since `RYN-PAY-REQUEST-001`; the
 * top-up and the connection panel use it since `RYN-INVEST-SIMPLE-001`
 * session 5 (canon v5.1 §4 «Почати з картки»: «Відкрити в Phantom»).
 *
 * A computer is different: a wallet there is an extension, and the one honest
 * step is to install one.
 *
 * Pure and dependency-free: the page decides with the browser's own user
 * agent, and tests read the rules without one.
 */

/** Phantom's own download page (answered 200 on 2026-09-24). */
export const PHANTOM_DOWNLOAD_URL = "https://phantom.com/download";

/** The link that opens `pageUrl` inside Phantom's in-app browser. */
export function phantomBrowseUrl(pageUrl: string, origin: string): string {
  return `https://phantom.app/ul/browse/${encodeURIComponent(pageUrl)}?ref=${encodeURIComponent(origin)}`;
}

/**
 * A phone or a tablet, by the browser's own words — the same test the payment
 * page makes. An iPad that reports itself as a Mac is read as a computer,
 * which costs it one extra step (the install link), never a wrong one.
 */
export function isPhoneUserAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && /Android|iPhone|iPad|iPod/i.test(userAgent);
}

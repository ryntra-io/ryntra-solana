"use client";

import { usePathname } from "next/navigation";

/** The shape the asset page accepts; anything else is not echoed back. */
const TICKER = /^[A-Za-z0-9._-]{1,24}$/;

/**
 * The ticker the person asked for, as the crumb after *Stocks*, read back
 * from the address on the not-found page (a not-found boundary receives no
 * params). Only a string shaped like a ticker is shown; React escapes it
 * like any text.
 */
export function MissingTicker({ className }: { className?: string }) {
  const path = usePathname() ?? "";
  const last = path.split("/").filter(Boolean).pop() ?? "";
  let ticker = last;
  try {
    ticker = decodeURIComponent(last);
  } catch {
    return null;
  }
  if (!TICKER.test(ticker) || ticker === "stocks") return null;
  return (
    <>
      <span aria-hidden="true">/</span>
      <span className={className} translate="no">
        {ticker}
      </span>
    </>
  );
}

"use client";

import { useEffect } from "react";

import { Lost } from "@/city/components/open/Lost";
import { LOST } from "@/city/components/open/words";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { PALETTE } from "@/city/lib/palette";

/* The root layout itself broke: this page stands in for the whole document (CITY-159), so it brings its own <html>
   and <body> — the city's 500 alone, its language picked before the first paint as in the city. */

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en" dir="ltr" style={{ background: PALETTE.inkDeep }}>
      <head>
        <title>{LOST.en.brokenTitle}</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content={PALETTE.inkDeep} />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body style={{ margin: 0 }}>
        <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
        <Lost kind="broken" />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";

import { Missing } from "@/city/components/pay/PayerPage";
import { LANG_BOOT_SCRIPT } from "@/city/lib/i18n/langs";
import { PALETTE } from "@/city/lib/palette";
import { payMetadata } from "@/city/lib/pay/meta";
import { CITY_FONTS } from "@/city/styles/fonts";
import s from "@/city/styles/city.module.css";

/* A wrong or retired payment link (CITY-156): the city's window says so in the city's words and leads into the city.
   Its tab carries the same words, never the site's old line. */

export const metadata: Metadata = payMetadata(null);

export const viewport: Viewport = { themeColor: PALETTE.inkDeep, colorScheme: "dark", viewportFit: "cover" };

export default function PayNotFound() {
  return (
    <div className={`${s.root} ${CITY_FONTS.className}`} style={CITY_FONTS.style}>
      <script dangerouslySetInnerHTML={{ __html: LANG_BOOT_SCRIPT }} />
      <Missing />
    </div>
  );
}

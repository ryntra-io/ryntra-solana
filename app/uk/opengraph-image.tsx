import { homepageOpenGraph } from "@/app/brand/homepage-og";
import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";

/* The share card of `/uk` — the same card as `/`, in Ukrainian (plan §6). It
   lives outside the landing's route group on purpose: Next gives a metadata
   image inside a group (`app/(home)/uk/…`) a hashed address
   (`/uk/opengraph-image-<hash>`), and the page names its card at the plain
   `/uk/opengraph-image` (`landingOgImage` in `app/seo.ts`). This folder holds
   the card only; the page is `app/(home)/uk/page.tsx`. */
export const alt = HOMEPAGE_COPY.uk.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return homepageOpenGraph("uk");
}

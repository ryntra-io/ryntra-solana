import { homepageOpenGraph } from "@/app/brand/homepage-og";
import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";

export const alt = HOMEPAGE_COPY.en.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function OpenGraphImage() { return homepageOpenGraph("en"); }

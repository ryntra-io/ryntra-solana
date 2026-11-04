import type { MetadataRoute } from "next";
/* Relative, with the extension, so the SEO tests can read the manifest itself. */
import { BRAND } from "../city/lib/brand.ts";
import { PALETTE } from "../city/lib/palette.ts";
import { CITY_WORDS } from "./seo.ts";

/**
 * The web app manifest — Ryntra City's (CITY-158). The icons are the city's
 * mark on the night tile (`scripts/city/brand.mjs` → `public/brand/city/`):
 * the tile at 192 and 512, and a maskable 512 with the night ground to the
 * edges and the mark inside the safe circle. The colours are the city's ink,
 * the ground its pages paint, so an installed shell never flashes another
 * colour. The installed app opens the city itself, at `/`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: CITY_WORDS.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: PALETTE.inkDeep,
    theme_color: PALETTE.inkDeep,
    icons: [
      { src: "/brand/city/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/city/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/city/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

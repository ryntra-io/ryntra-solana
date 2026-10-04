import { ImageResponse } from "next/og";
import { R_MARK_MATERIAL, R_MARK_MATERIAL_AXIS, R_MARK_PATHS, R_MARK_VIEWBOX, RYNTRA_COLORS, RYNTRA_GRADIENT } from "./mark";
import { WORDMARK_BOX } from "./generated/wordmark-box";
import { WORDMARK_DARK_UI_DATA_URI } from "./generated/wordmark-dark-ui";
import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";

export const HOMEPAGE_OG_SIZE = { width: 1200, height: 630 };

/**
 * The share card. The official wordmark top-left, the two headline lines,
 * the context line, and the standalone R in the master's own ramp as the one
 * brand element on the right: graphite ground with a navy undertone, no
 * halo, no banner.
 *
 * The wordmark is the raster export of the traced lockup (the YNTRA
 * letterforms exist only as the brand's artwork), embedded as a generated
 * data URI because the card is drawn by satori and cannot reference a URL.
 * The R is the canonical geometry — traced from the flat master by the
 * render script — with the material fitted from the same master, as an SVG;
 * the card cannot carry a letter the favicon does not.
 */
export function markDataUri() {
  const stops = R_MARK_MATERIAL.map(([color, offset]) => `<stop offset="${offset}" stop-color="${color}"/>`).join("");
  const { x1, y1, x2, y2 } = R_MARK_MATERIAL_AXIS;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${R_MARK_VIEWBOX}"><defs><linearGradient id="g" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient></defs><path d="${R_MARK_PATHS}" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function homepageOpenGraph(locale: "en" | "uk") {
  const copy = HOMEPAGE_COPY[locale];
  const wordmark = WORDMARK_DARK_UI_DATA_URI;
  /* 720px wide on disk; 60px tall here, at the lockup's own ratio. */
  const wordmarkWidth = Math.round(60 * (WORDMARK_BOX.width / WORDMARK_BOX.height));
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: `radial-gradient(circle at 18% 0%, ${RYNTRA_COLORS.surface} 0%, ${RYNTRA_COLORS.graphite} 58%)`,
        color: RYNTRA_COLORS.text,
        padding: "56px 64px",
        fontFamily: "Geist, Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <img src={wordmark} alt="" width={wordmarkWidth} height={60} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 64, fontSize: 60, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2, maxWidth: 760 }}>
        {copy.ogLines.map((line) => <span key={line}>{line}</span>)}
      </div>
      <div style={{ display: "flex", marginTop: 24, fontSize: 24, lineHeight: 1.4, color: RYNTRA_COLORS.muted, maxWidth: 700 }}>{copy.ogContext}</div>
      <div style={{ display: "flex", marginTop: "auto", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 18, lineHeight: 1.4, color: RYNTRA_COLORS.muted, maxWidth: 640 }}>{copy.availability}</div>
        {/* The mark in the master's ramp: the one place the brand lets the R
            stand large on a marketing surface. `RYNTRA_GRADIENT.to` is the
            ramp's deep end, tinting the shadow; the stops sit inside the SVG. */}
        <img src={markDataUri()} alt="" width={168} height={168} style={{ marginBottom: -8, filter: `drop-shadow(0 12px 28px ${RYNTRA_GRADIENT.to}33)` }} />
      </div>
    </div>,
    HOMEPAGE_OG_SIZE,
  );
}

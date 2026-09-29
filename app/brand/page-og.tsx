import { ImageResponse } from "next/og";

import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";

import { WORDMARK_BOX } from "./generated/wordmark-box";
import { WORDMARK_DARK_UI_DATA_URI } from "./generated/wordmark-dark-ui";
import { markDataUri } from "./homepage-og";
import { RYNTRA_COLORS } from "./mark";
import type { CardLocale, CardSpec } from "./page-card";

export const PAGE_OG_SIZE = { width: 1200, height: 630 };

const ICON_BYTES = 2 * 1024 * 1024;
/* Backpack's logos are small vector drawings (a path or two, under a kilobyte). */
const SVG_ICON_BYTES = 32 * 1024;
const ICON_TIMEOUT_MS = 3_000;

/**
 * A company's picture for its card, as a data address — or nothing.
 *
 * The address is the token catalogue's, written by whoever minted the token,
 * so it is fetched only over https to a public host name (the rule of
 * `/api/spot/icon`), bounded in time and size, and taken only as PNG, JPEG
 * or a small SVG with nothing in it but drawing — no script, no foreign
 * object, no address it would fetch. Any failure draws the company's initial
 * instead: a card is never refused for want of a logo.
 */
async function iconDataUri(address: string | null): Promise<string | null> {
  if (!address) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") || /^[\d.:[\]]+$/.test(host) || /(^|\.)(localhost|local|internal|arpa)$/.test(host)) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS), redirect: "follow" });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "image/png" && type !== "image/jpeg" && type !== "image/svg+xml") return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > (type === "image/svg+xml" ? SVG_ICON_BYTES : ICON_BYTES)) return null;
    if (type === "image/svg+xml" && /<script|<foreignObject|href\s*=\s*["']?(?:https?:|\/\/)/i.test(new TextDecoder().decode(bytes))) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}

/** The card, drawn: the wordmark, the eyebrow in the brand's orange, the headline, the line under it, the promise and the R. */
export async function pageOpenGraph(card: CardSpec, locale: CardLocale): Promise<ImageResponse> {
  const promise = HOMEPAGE_COPY[locale].availability;
  const wordmarkWidth = Math.round(56 * (WORDMARK_BOX.width / WORDMARK_BOX.height));
  const icon = card.token ? await iconDataUri(card.icon) : null;
  const long = card.headline.length > 44;
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
        <img src={WORDMARK_DARK_UI_DATA_URI} alt="" width={wordmarkWidth} height={56} />
      </div>
      <div style={{ display: "flex", marginTop: 52, fontSize: 26, fontWeight: 600, color: RYNTRA_COLORS.orange, letterSpacing: 0.2 }}>{card.eyebrow}</div>
      {card.token ? (
        <div style={{ display: "flex", alignItems: "center", marginTop: 22 }}>
          {icon ? (
            <img src={icon} alt="" width={96} height={96} style={{ borderRadius: 48, marginRight: 28 }} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 96, height: 96, borderRadius: 48, marginRight: 28, background: RYNTRA_COLORS.elevated, border: `2px solid ${RYNTRA_COLORS.border}`, fontSize: 46, fontWeight: 700 }}>
              {card.headline.slice(0, 1)}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 900 }}>
            <div style={{ display: "flex", fontSize: long ? 50 : 62, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.5 }}>{card.headline}</div>
            <div style={{ display: "flex", marginTop: 10, fontSize: 30, color: RYNTRA_COLORS.muted, letterSpacing: 0.5 }}>{card.token}</div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", marginTop: 18, fontSize: long ? 50 : 58, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 1000 }}>{card.headline}</div>
      )}
      {card.context ? (
        <div style={{ display: "flex", marginTop: 22, fontSize: 25, lineHeight: 1.4, color: RYNTRA_COLORS.muted, maxWidth: 900 }}>{card.context}</div>
      ) : null}
      <div style={{ display: "flex", marginTop: "auto", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 18, lineHeight: 1.4, color: RYNTRA_COLORS.muted, maxWidth: 700 }}>{promise}</div>
        <img src={markDataUri()} alt="" width={120} height={120} style={{ marginBottom: -6 }} />
      </div>
    </div>,
    { ...PAGE_OG_SIZE },
  );
}

import { ImageResponse } from "next/og";

import { formatBps, formatPrice } from "@/app/app/launch/launch-format";
import { launchWords, type LaunchWordKey } from "@/app/app/launch/launch-words";
import type { LaunchShareFacts } from "@/lib/launch/share.server";

import { WORDMARK_BOX } from "./generated/wordmark-box";
import { WORDMARK_DARK_UI_DATA_URI } from "./generated/wordmark-dark-ui";
import { markDataUri } from "./homepage-og";
import { RYNTRA_COLORS } from "./mark";
import { PAGE_OG_SIZE } from "./page-og";

/** «19.10 14:05» in UTC — a reader's clock is not the server's, so the card names its zone. */
function utcStamp(at: string): string {
  const date = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getUTCDate())}.${two(date.getUTCMonth() + 1)} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
}

/**
 * A launched token's card for a link preview in X and Telegram (SOL-L1e): its picture and name, the price the chain
 * gave with the minute it was read, the curve's way to the DEX, and the «Чесний лаунч» marks the chain proved now.
 * A part the chain did not give is left off, never guessed; no word of it promises a price. `icon` is the token's
 * picture as a PNG data address (`lib/launch/share-picture.server.ts`), or nothing for the ticker's letter.
 */
export function launchOpenGraph(facts: LaunchShareFacts, locale: "en" | "uk", icon: string | null): ImageResponse {
  const word = launchWords(locale);
  const wordmarkWidth = Math.round(44 * (WORDMARK_BOX.width / WORDMARK_BOX.height));
  const long = facts.name.length > 22;
  const price = facts.price ? formatPrice(facts.price.value, locale).plain : null;
  const pct = facts.dex ? formatBps(facts.dex.bps, locale) : null;
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: `radial-gradient(circle at 18% 0%, ${RYNTRA_COLORS.surface} 0%, ${RYNTRA_COLORS.graphite} 60%)`,
        color: RYNTRA_COLORS.text,
        padding: "48px 60px 40px",
        fontFamily: "Geist, Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <img src={WORDMARK_DARK_UI_DATA_URI} alt="" width={wordmarkWidth} height={44} />
        <div style={{ display: "flex", fontSize: 22, color: RYNTRA_COLORS.muted }}>
          {facts.network === "solana:devnet" ? `Solana ${word("devnet")}` : "Solana"} · Meteora
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 40, flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", width: facts.marks.length ? 620 : 1080 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            {icon ? (
              <img src={icon} alt="" width={104} height={104} style={{ borderRadius: 52, marginRight: 26 }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 104, height: 104, borderRadius: 52, marginRight: 26, background: RYNTRA_COLORS.elevated, border: `2px solid ${RYNTRA_COLORS.border}`, fontSize: 48, fontWeight: 700 }}>
                {facts.symbol.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", maxWidth: facts.marks.length ? 480 : 900 }}>
              <div style={{ display: "flex", fontSize: long ? 44 : 58, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.2 }}>{facts.name.slice(0, 40)}</div>
              <div style={{ display: "flex", marginTop: 8, fontSize: 30, color: RYNTRA_COLORS.muted }}>${facts.symbol}</div>
            </div>
          </div>
          {price && facts.price ? (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 34 }}>
              <div style={{ display: "flex", fontSize: 22, color: RYNTRA_COLORS.muted }}>
                {word("cardPrice")} · {word("cardPriceAt", { time: utcStamp(facts.price.at) })}
              </div>
              <div style={{ display: "flex", marginTop: 4, fontSize: 48, fontWeight: 700, letterSpacing: -0.8 }}>
                {facts.price.dollar ? `$${price}` : `${price} ${facts.price.pair}`}
              </div>
            </div>
          ) : null}
          {facts.dex ? (
            <div style={{ display: "flex", flexDirection: "column", marginTop: price ? 26 : 40 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, color: RYNTRA_COLORS.muted }}>
                <span>{facts.dex.migrated ? word("cardOnDex") : word("progress")}</span>
                {facts.dex.migrated ? null : <span style={{ color: RYNTRA_COLORS.text, fontWeight: 600 }}>{pct}</span>}
              </div>
              <div style={{ display: "flex", marginTop: 10, width: "100%", height: 14, borderRadius: 7, background: RYNTRA_COLORS.elevated, border: `1px solid ${RYNTRA_COLORS.border}` }}>
                <div style={{ display: "flex", width: `${Math.max(2, facts.dex.bps / 100)}%`, height: "100%", borderRadius: 7, background: RYNTRA_COLORS.orange }} />
              </div>
            </div>
          ) : null}
        </div>
        {facts.marks.length ? (
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 50, paddingLeft: 40, borderLeft: `1px solid ${RYNTRA_COLORS.border}`, width: 410 }}>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: RYNTRA_COLORS.orange }}>{word("marks")}</div>
            {facts.marks.map((code) => (
              <div key={code} style={{ display: "flex", alignItems: "flex-start", marginTop: 18, fontSize: 23, lineHeight: 1.3 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" style={{ marginRight: 12, marginTop: 2, flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="11" fill={RYNTRA_COLORS.orange} />
                  <path d="M7 12.5l3.2 3.2L17 9" stroke={RYNTRA_COLORS.graphite} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ display: "flex", maxWidth: 340 }}>{word(`mark_${code}` as LaunchWordKey)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        {/* The market's own disclaimer, word for word: the card never names a price it does not deny promising. */}
        <div style={{ display: "flex", fontSize: 18, lineHeight: 1.4, color: RYNTRA_COLORS.muted, maxWidth: 940 }}>{`${word("cardNoAdvice")} ${word("noGuarantee")}`}</div>
        <img src={markDataUri()} alt="" width={84} height={84} style={{ marginBottom: -6 }} />
      </div>
    </div>,
    { ...PAGE_OG_SIZE },
  );
}

import { lookup } from "node:dns/promises";

import { ImageResponse } from "next/og";
import QRCode from "qrcode";

import { RYNTRA_COLORS } from "@/app/brand/mark";
import { WORDMARK_BOX } from "@/app/brand/generated/wordmark-box";
import { WORDMARK_DARK_UI_DATA_URI } from "@/app/brand/generated/wordmark-dark-ui";
import { rankBadgeSvg } from "@/lib/growth/badges";
import { privateAddress } from "@/lib/growth/public-address";
import { cardDollars, cardPercent, cardPeriod, cardPrice, cardWords, priceDecimals } from "@/lib/growth/card-copy";
import { heldDays, tradeCardPath, unitPrice, type TradeCard } from "@/lib/growth/trade-cards";

/**
 * The picture of a trade card: 1200 × 630, the size X shows large.
 *
 * One dark ground in the brand's graphite whatever the reader's theme — the
 * card is a picture that travels, not a page. The result is the biggest thing
 * on it, in green for a gain and red for a loss at the same size; the brand's
 * orange marks only the offer, as one action would on a screen.
 */

export const CARD_SIZE = { width: 1200, height: 630 } as const;

const PNL_UP = "#19C77A";
const PNL_DOWN = "#FF4D55";

/* ---------- fonts: Geist, as the product draws it, with Cyrillic ---------- */

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" };
const FONT_SPECS = [
  { family: "Geist", weight: 400 },
  { family: "Geist", weight: 600 },
  { family: "Geist Mono", weight: 500 },
] as const;
const FONT_TIMEOUT_MS = 5_000;
let fontCache: Promise<Font[] | null> | null = null;

/**
 * Geist from Google Fonts as TrueType (a request without a browser's agent is
 * answered with `.ttf`, which the drawing engine reads; `.woff2` it cannot).
 * Kept for the life of the instance. Without it the picture still draws, in
 * the engine's own face — and is then not cached for long (see the route).
 */
async function loadFonts(): Promise<Font[] | null> {
  try {
    return await Promise.all(
      FONT_SPECS.map(async ({ family, weight }) => {
        const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`, {
          signal: AbortSignal.timeout(FONT_TIMEOUT_MS),
        }).then((response) => (response.ok ? response.text() : Promise.reject(new Error(`css ${response.status}`))));
        /* One face per subset; the drawing needs them all (Latin, Cyrillic). The last block is Latin. */
        const sources = [...css.matchAll(/src: url\((https:[^)]+)\) format\('(?:truetype|opentype)'\)/g)].map((match) => match[1]);
        if (sources.length === 0) throw new Error("no truetype source");
        const data = await fetch(sources[0], { signal: AbortSignal.timeout(FONT_TIMEOUT_MS) }).then((response) =>
          response.ok ? response.arrayBuffer() : Promise.reject(new Error(`font ${response.status}`)),
        );
        return { name: family, data, weight, style: "normal" as const };
      }),
    );
  } catch {
    return null;
  }
}

export function cardFonts(): Promise<Font[] | null> {
  if (!fontCache) {
    fontCache = loadFonts().then((fonts) => {
      if (!fonts) fontCache = null; /* try again on the next picture */
      return fonts;
    });
  }
  return fontCache;
}

/* ---------- the token's picture, fetched as carefully as an outsider's address deserves ---------- */

const ICON_BYTES = 1024 * 1024;
const ICON_TIMEOUT_MS = 3_000;
const ICON_REDIRECTS = 2;

/** https to a public host name, never an IP literal or a private suffix — and every address the name resolves to is public. */
async function publicHttps(url: URL): Promise<boolean> {
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") || /^[\d.:[\]]+$/.test(host) || /(^|\.)(localhost|local|internal|arpa)$/.test(host)) return false;
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => !privateAddress(entry.address));
  } catch {
    return false;
  }
}

/** The body, read as it arrives and abandoned past `cap` bytes — a film is never read whole to find out it is one. */
async function readCapped(response: Response, cap: number): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

/**
 * The token's own picture, as a data address — or nothing. The address is the
 * catalogue's, written by whoever minted the token, and this route is public:
 * every hop (at most two redirects, followed by hand) must be https to a
 * public host whose addresses are all public; bounded in time and size; PNG
 * or JPEG only. Any failure draws the symbol's first letter instead.
 */
async function iconDataUri(address: string | null): Promise<string | null> {
  if (!address) return null;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  try {
    for (let hop = 0; hop <= ICON_REDIRECTS; hop += 1) {
      if (!(await publicHttps(url))) return null;
      const response = await fetch(url, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS), redirect: "manual" });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        if (!next) return null;
        url = new URL(next, url);
        continue;
      }
      if (!response.ok) return null;
      const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (type !== "image/png" && type !== "image/jpeg") return null;
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > ICON_BYTES) return null;
      const bytes = await readCapped(response, ICON_BYTES);
      if (!bytes || bytes.byteLength === 0) return null;
      return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
    }
    return null;
  } catch {
    return null;
  }
}

function svgUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/* ---------- the drawing ---------- */

/**
 * A centred line that may wrap. The drawing engine measures a wrapped text's
 * height only when the text itself has a width, so the text sits in a span
 * of a fixed width inside its own block.
 */
function Centered({ width, style, children }: { width: number; style: Record<string, string | number>; children: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", width, textAlign: "center", ...style }}>
      <span style={{ display: "flex", justifyContent: "center", width, textAlign: "center" }}>{children}</span>
    </div>
  );
}

/** `whole`: drawn with the brand's face and, where the token has one, its picture — the only picture worth caching for good. */
export type DrawnCard = Readonly<{ image: ImageResponse; whole: boolean }>;

export async function drawTradeCard(card: TradeCard, origin: string): Promise<DrawnCard> {
  const word = cardWords(card.locale);
  const locale = card.locale;
  const trade = card.trade;
  const sell = trade.kind === "SELL";
  const cost = BigInt(trade.costMicros);
  const proceeds = trade.proceedsMicros === null ? null : BigInt(trade.proceedsMicros);
  const quantity = BigInt(trade.quantityRaw);
  const result = sell && trade.resultBps !== null ? trade.resultBps : null;
  const tone = result === null ? RYNTRA_COLORS.text : result > 0 ? PNL_UP : result < 0 ? PNL_DOWN : RYNTRA_COLORS.text;
  const entry = unitPrice(cost, quantity, trade.decimals);
  const exit = proceeds === null ? null : unitPrice(proceeds, quantity, trade.decimals);
  const days = sell ? heldDays(trade.openedAt, trade.at) : null;
  const period = sell ? cardPeriod(trade.openedAt, trade.at, locale) : cardPeriod(null, trade.at, locale);

  const link = `${origin}${tradeCardPath(card)}`;
  const shownLink = `${origin.replace(/^https?:\/\//, "")}/r/${card.code}`;
  const [fonts, icon, qr] = await Promise.all([
    cardFonts(),
    iconDataUri(card.token.icon),
    QRCode.toString(link, { type: "svg", errorCorrectionLevel: "M", margin: 0, color: { dark: "#080D13", light: "#FFFFFF" } }),
  ]);
  const wordmarkHeight = 40;
  const wordmarkWidth = Math.round(wordmarkHeight * (WORDMARK_BOX.width / WORDMARK_BOX.height));
  const sans = "Geist";
  const mono = fonts ? "Geist Mono" : "Geist";

  /* One count of decimals for entry and exit, so the two read alike. */
  const decimals = entry !== null && exit !== null ? priceDecimals([entry, exit]) : undefined;
  const headline = sell && result !== null ? cardPercent(result, locale) : entry !== null ? cardPrice(entry, locale, decimals) : card.token.symbol;
  const headlineSize = headline.length > 9 ? 112 : 132;

  const facts: { label: string; value: string }[] = [];
  if (sell) {
    if (entry !== null) facts.push({ label: word.entry, value: cardPrice(entry, locale, decimals) });
    if (exit !== null) facts.push({ label: word.exit, value: cardPrice(exit, locale, decimals) });
  }
  if (card.amounts) {
    if (sell && proceeds !== null) facts.push({ label: word.pnl, value: cardDollars(proceeds - cost, locale, true) });
    if (!sell) facts.push({ label: word.paid, value: cardDollars(cost, locale) });
  }

  const image = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "48px 56px 40px",
        backgroundColor: RYNTRA_COLORS.graphite,
        backgroundImage: "radial-gradient(circle at 92% 0%, rgba(255,104,28,0.16), rgba(8,13,19,0) 46%)",
        color: RYNTRA_COLORS.text,
        fontFamily: sans,
      }}
    >
      {/* The brand, and the rank of the moment the card was made. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={WORDMARK_DARK_UI_DATA_URI} width={wordmarkWidth} height={wordmarkHeight} alt="" />
        {card.rank ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24, color: RYNTRA_COLORS.muted }}>{word.rank(card.rank)}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgUri(rankBadgeSvg(card.rank, { id: "card", size: 52 }))} width={52} height={52} alt="" />
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", flex: 1, marginTop: 36, gap: 48 }}>
        {/* The trade. */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} width={60} height={60} style={{ borderRadius: 30 }} alt="" />
            ) : (
              <div style={{ display: "flex", width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", backgroundColor: RYNTRA_COLORS.elevated, border: `1px solid ${RYNTRA_COLORS.border}`, fontSize: 28, fontWeight: 600 }}>
                {(card.token.symbol.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase()}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 22, color: RYNTRA_COLORS.muted }}>{word.kind[trade.kind]}</span>
              <span style={{ fontSize: 40, fontWeight: 600, letterSpacing: -0.5 }}>{card.token.symbol}</span>
            </div>
          </div>

          {!sell ? <div style={{ display: "flex", marginTop: 18, fontSize: 20, color: RYNTRA_COLORS.muted }}>{word.price}</div> : null}
          <div style={{ display: "flex", marginTop: sell ? 14 : 0, fontFamily: mono, fontWeight: 500, fontSize: headlineSize, lineHeight: 1.05, letterSpacing: -4, color: tone }}>
            {headline}
          </div>

          <div style={{ display: "flex", gap: 36, marginTop: 18 }}>
            {facts.map((fact) => (
              <div key={fact.label} style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 18, color: RYNTRA_COLORS.muted }}>{fact.label}</span>
                <span style={{ fontFamily: mono, fontWeight: 500, fontSize: 28, marginTop: 4 }}>{fact.value}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", marginTop: "auto", fontSize: 22, color: RYNTRA_COLORS.muted }}>
            {days !== null ? `${period} · ${word.held(days)}` : period}
          </div>
        </div>

        {/* The way in: the code, the link, the offer — each line a block of the panel's whole width, so nothing wraps into its neighbour. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 320,
            padding: "24px 22px 22px",
            borderRadius: 24,
            backgroundColor: RYNTRA_COLORS.surface,
            border: `1px solid ${RYNTRA_COLORS.border}`,
          }}
        >
          <div style={{ display: "flex", padding: 12, borderRadius: 16, backgroundColor: "#FFFFFF" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={svgUri(qr)} width={128} height={128} alt="" />
          </div>
          <Centered width={276} style={{ marginTop: 12, fontSize: 17, lineHeight: 1.3, color: RYNTRA_COLORS.muted }}>{word.join}</Centered>
          <Centered width={276} style={{ marginTop: 2, fontFamily: mono, fontWeight: 500, fontSize: 17, lineHeight: 1.3, letterSpacing: -0.3 }}>{shownLink}</Centered>
          <div style={{ display: "flex", width: "100%", height: 1, marginTop: 14, backgroundColor: RYNTRA_COLORS.border }} />
          <Centered width={276} style={{ marginTop: 14, fontSize: 19, fontWeight: 600, lineHeight: 1.25, color: RYNTRA_COLORS.orange }}>{word.offer}</Centered>
          <Centered width={276} style={{ marginTop: 4, fontSize: 15, lineHeight: 1.3, color: RYNTRA_COLORS.muted }}>{word.offerWhy}</Centered>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, fontSize: 19, color: RYNTRA_COLORS.muted }}>
        <span>{word.through}</span>
        <span>{card.token.stock ? word.riskStock : word.risk}</span>
      </div>
    </div>,
    { ...CARD_SIZE, ...(fonts ? { fonts } : {}) },
  );
  return { image, whole: fonts !== null && (icon !== null || card.token.icon === null) };
}

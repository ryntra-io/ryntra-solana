import { ImageResponse } from "next/og";

import { WORDMARK_BOX } from "@/app/brand/generated/wordmark-box";
import { WORDMARK_DARK_UI_DATA_URI } from "@/app/brand/generated/wordmark-dark-ui";
import { cardFace, type CardFace } from "@/lib/growth/card-face";
import { cardIconDataUri } from "@/lib/growth/card-icon.server";
import { moodOf, moodScene, moodSvg } from "@/lib/growth/card-mood";
import { CARD, CARD_COLORS, PERIOD_PILL, STILL, cardBackdropSvg, headlineColor, headlineSize, ladderWidths, toneColor, toneGlow } from "@/lib/growth/card-scene";
import type { TradeCard } from "@/lib/growth/trade-cards";

/**
 * The still picture of a trade card: 1200 × 630, the size X shows large under
 * a link — the last frame of the live card.
 *
 * Every block sits at the numbers in `CARD` (`card-scene.ts`), which the
 * canvas draws from too; the backdrop and the emotion are the same SVG the
 * canvas reads. One dark ground in the brand's graphite whatever the reader's
 * theme — the card is a picture that travels, not a page.
 */

export const CARD_SIZE = { width: CARD.width, height: CARD.height } as const;

/* ---------- fonts: Geist, as the product draws it, with Cyrillic ---------- */

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" };
/** Vercel's own static faces of Geist, from the published package — full Latin and Cyrillic in one file each. */
const GEIST_PACKAGE = "https://cdn.jsdelivr.net/npm/geist@1.7.2/dist/fonts";
const FONT_SPECS = [
  { family: "Geist", weight: 400, file: "geist-sans/Geist-Regular.ttf" },
  { family: "Geist", weight: 600, file: "geist-sans/Geist-SemiBold.ttf" },
  { family: "Geist Mono", weight: 500, file: "geist-mono/GeistMono-Medium.ttf" },
] as const;
const FONT_TIMEOUT_MS = 5_000;
let fontCache: Promise<Font[] | null> | null = null;

function fontBytes(url: string): Promise<ArrayBuffer> {
  return fetch(url, { signal: AbortSignal.timeout(FONT_TIMEOUT_MS) }).then((response) =>
    response.ok ? response.arrayBuffer() : Promise.reject(new Error(`font ${response.status}`)),
  );
}

/** The same face from Google Fonts as TrueType (a request without a browser's agent is answered with `.ttf`; `.woff2` the engine cannot read). */
async function googleFace(family: string, weight: number): Promise<ArrayBuffer> {
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`, {
    signal: AbortSignal.timeout(FONT_TIMEOUT_MS),
  }).then((response) => (response.ok ? response.text() : Promise.reject(new Error(`css ${response.status}`))));
  const source = css.match(/src: url\((https:[^)]+)\) format\('(?:truetype|opentype)'\)/)?.[1];
  if (!source) throw new Error("no truetype source");
  return fontBytes(source);
}

/**
 * Geist as TrueType: the package's static faces, else Google's. Kept for the
 * life of the instance. Without either the picture still draws, in the
 * engine's own face — and is then not cached for long (see the route).
 */
async function loadFonts(): Promise<Font[] | null> {
  try {
    return await Promise.all(
      FONT_SPECS.map(async ({ family, weight, file }) => {
        const data = await fontBytes(`${GEIST_PACKAGE}/${file}`).catch(() => googleFace(family, weight));
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

function svgUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** The QR as SVG, from the face's modules: dark squares on nothing (the box behind is white). */
export function qrSvg(face: Pick<CardFace, "qr">): string {
  const { size, bits } = face.qr;
  let body = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) if (bits[row * size + col] === "1") body += `M${col} ${row}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path d="${body}" fill="${CARD_COLORS.ground}"/></svg>`;
}

/** The result's glow and the lit top edge, at rest — what the canvas draws once the entrance ends. */
function glowSvg(face: CardFace): string {
  const { width: w, height: h } = CARD;
  const tone = face.tone;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><radialGradient id="r" gradientUnits="userSpaceOnUse" cx="300" cy="260" r="560"><stop offset="0" stop-color="${toneGlow(tone, 0.24)}"/><stop offset="0.55" stop-color="${toneGlow(tone, 0.067)}"/><stop offset="1" stop-color="${toneGlow(tone, 0)}"/></radialGradient><linearGradient id="e" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${toneGlow(tone, 0)}"/><stop offset="0.5" stop-color="${toneGlow(tone, 0.9)}"/><stop offset="1" stop-color="${toneGlow(tone, 0)}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#r)"/><rect width="${w}" height="2" fill="url(#e)"/></svg>`;
}

type Style = Record<string, string | number>;

/*
 * The drawing engine leaves a wide gap after some Cyrillic letters of Geist
 * («к», «у», «т») when a plain or no-break space follows; a punctuation space
 * (U+2008) it sets evenly, and every line on the card is one line, so no
 * break is lost.
 */
const EVEN_SPACE = String.fromCharCode(0x2008);
const SPACES = new RegExp(`[ ${String.fromCharCode(0xa0)}]`, "g");
const plain = (text: string) => text.replace(SPACES, EVEN_SPACE);
/* Every line on the card is one line: told so, the engine never weighs a break and never leaves a wide gap where it would have been. */
const abs = (style: Style): Style => ({ position: "absolute", display: "flex", whiteSpace: "nowrap", ...style });

/** `whole`: drawn with the brand's face and, where the token has one, its picture — the only picture worth caching for good. */
export type DrawnCard = Readonly<{ image: ImageResponse; whole: boolean }>;

export async function drawTradeCard(card: TradeCard, origin: string): Promise<DrawnCard> {
  const [fonts, icon] = await Promise.all([cardFonts(), cardIconDataUri(card.token.icon)]);
  const written = cardFace(card, origin, icon);
  const face = {
    ...written,
    kindLabel: plain(written.kindLabel),
    headline: plain(written.headline),
    period: plain(written.period),
    offer: plain(written.offer),
    offerWhy: plain(written.offerWhy),
    seal: plain(written.seal),
    risk: plain(written.risk),
    facts: written.facts.map((fact) => ({ ...fact, label: plain(fact.label), value: plain(fact.value) })),
    join: plain(written.join),
    headlineLabel: written.headlineLabel === null ? null : plain(written.headlineLabel),
    rank: written.rank ? { ...written.rank, name: plain(written.rank.name) } : null,
    ladder: written.ladder
      ? { ...written.ladder, entryLabel: plain(written.ladder.entryLabel), entry: plain(written.ladder.entry), exitLabel: plain(written.ladder.exitLabel), exit: plain(written.ladder.exit) }
      : null,
  };
  const sans = "Geist";
  const mono = fonts ? "Geist Mono" : "Geist";
  const tone = toneColor(face.tone);
  const size = headlineSize(face.headline, face.headlineLabel !== null);
  const wordmarkWidth = Math.round(CARD.wordmark.height * (WORDMARK_BOX.width / WORDMARK_BOX.height));
  const mood = moodSvg(moodScene(moodOf(face.kind, face.resultBps), STILL, tone));
  const widths = face.ladder ? ladderWidths(face.ladder.ratio) : null;
  const ld = CARD.ladder;
  const st = CARD.strip;
  const qrX = st.x + (st.height - CARD.qr.box) / 2 + 4;
  const qrY = st.y + (st.height - CARD.qr.box) / 2;
  const middle = (y: number, height: number): Style => ({ top: y - height / 2, height, alignItems: "center" });

  const image = new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", backgroundColor: CARD_COLORS.ground, color: CARD_COLORS.text, fontFamily: sans, whiteSpace: "nowrap" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={svgUri(cardBackdropSvg())} width={CARD.width} height={CARD.height} style={abs({ left: 0, top: 0 })} alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={svgUri(glowSvg(face))} width={CARD.width} height={CARD.height} style={abs({ left: 0, top: 0 })} alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={svgUri(mood)} width={CARD.mood.width} height={CARD.mood.height} style={abs({ left: CARD.mood.x, top: CARD.mood.y })} alt="" />

      {/* The brand, and the rank of the moment the card was made. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={WORDMARK_DARK_UI_DATA_URI} width={wordmarkWidth} height={CARD.wordmark.height} style={abs({ left: CARD.wordmark.x, top: CARD.wordmark.y })} alt="" />
      {face.rank ? (
        <div style={abs({ right: CARD.width - CARD.rank.right, top: CARD.rank.y, height: CARD.rank.badge, alignItems: "center", gap: CARD.rank.gap })}>
          <span style={{ fontSize: CARD.rank.size, color: CARD_COLORS.muted }}>{face.rank.name}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={face.rank.badge} width={CARD.rank.badge} height={CARD.rank.badge} alt="" />
        </div>
      ) : null}

      {/* The token. */}
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} width={CARD.token.icon} height={CARD.token.icon} style={abs({ left: CARD.token.x, top: CARD.token.y, borderRadius: CARD.token.icon / 2 })} alt="" />
      ) : (
        <div style={abs({ left: CARD.token.x, top: CARD.token.y, width: CARD.token.icon, height: CARD.token.icon, borderRadius: CARD.token.icon / 2, alignItems: "center", justifyContent: "center", backgroundColor: "#131E2A", border: "1px solid #22303E", fontSize: 26, fontWeight: 600 })}>
          {face.letter}
        </div>
      )}
      <div style={abs({ left: CARD.token.textX, top: CARD.token.kindY, fontSize: CARD.token.kindSize, lineHeight: 1, color: CARD_COLORS.muted })}>{face.kindLabel}</div>
      <div style={abs({ left: CARD.token.textX, top: CARD.token.symbolY, fontSize: CARD.token.symbolSize, lineHeight: 1, fontWeight: 600, letterSpacing: -0.5 })}>{face.symbol}</div>

      {/* The figure. */}
      {face.headlineLabel ? <div style={abs({ left: CARD.pad, top: CARD.headline.labelY, fontSize: CARD.headline.labelSize, lineHeight: 1, color: CARD_COLORS.muted })}>{face.headlineLabel}</div> : null}
      <div
        style={abs({
          left: CARD.headline.x,
          top: face.headlineLabel ? CARD.headline.buyY : CARD.headline.y,
          fontFamily: mono,
          fontWeight: 500,
          fontSize: size,
          lineHeight: 1,
          letterSpacing: -size * 0.03,
          color: headlineColor(face.tone),
          textShadow: `0 0 36px ${toneGlow(face.tone, face.tone === "up" || face.tone === "down" ? 0.42 : 0.18)}`,
        })}
      >
        {face.headline}
      </div>

      {/* Entry and exit. */}
      {face.ladder && widths
        ? [
            { label: face.ladder.entryLabel, price: face.ladder.entry, width: widths.entry, fill: "rgba(159,176,196,0.42)", cut: false },
            { label: face.ladder.exitLabel, price: face.ladder.exit, width: widths.exit, fill: `linear-gradient(90deg, ${toneGlow(face.tone, 0.45)}, ${toneGlow(face.tone, 1)})`, cut: widths.cut },
          ].map((row, index) => {
            const y = ld.rows[index] + 12;
            return (
              <div key={row.label} style={abs({ left: 0, top: 0, width: CARD.width, height: CARD.height })}>
                <div style={abs({ left: CARD.pad, ...middle(y, 24), fontSize: ld.labelSize, color: CARD_COLORS.muted })}>{row.label}</div>
                <div
                  style={abs({
                    left: ld.barX,
                    top: y - ld.barHeight / 2,
                    width: row.width,
                    height: ld.barHeight,
                    borderRadius: ld.barHeight / 2,
                    ...(index === 1 ? { backgroundImage: row.fill } : { backgroundColor: row.fill }),
                  })}
                />
                {row.cut
                  ? [-46, -38].map((dx) => (
                      <div key={dx} style={abs({ left: ld.barX + row.width + dx - 1.5, top: y - 10, width: 3, height: 20, backgroundColor: CARD_COLORS.ground, transform: "rotate(24deg)" })} />
                    ))
                  : null}
                <div style={abs({ left: ld.barX + row.width + 16, ...middle(y, 30), fontFamily: mono, fontWeight: 500, fontSize: ld.priceSize })}>{row.price}</div>
              </div>
            );
          })
        : null}

      {/* The period, and the dollar result beside it when the person chose it. */}
      <div style={abs({ left: CARD.period.x, top: CARD.period.y, alignItems: "center", gap: 24 })}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: CARD.period.height,
            padding: `0 ${PERIOD_PILL.padRight}px 0 ${PERIOD_PILL.padLeft}px`,
            gap: PERIOD_PILL.gap,
            borderRadius: CARD.period.height / 2,
            backgroundColor: CARD_COLORS.elevated,
            border: `1px solid ${CARD_COLORS.border}`,
            fontSize: CARD.period.size,
          }}
        >
          <div style={{ display: "flex", width: PERIOD_PILL.dot, height: PERIOD_PILL.dot, borderRadius: PERIOD_PILL.dot / 2, backgroundColor: tone }} />
          <span>{face.period}</span>
        </div>
        {face.kind === "SELL"
          ? face.facts.map((fact) => (
              <div key={fact.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: CARD.facts.labelSize, color: CARD_COLORS.muted }}>{fact.label}</span>
                <span style={{ fontFamily: mono, fontWeight: 500, fontSize: CARD.facts.valueSize, color: fact.tone === "up" || fact.tone === "down" ? toneColor(fact.tone) : CARD_COLORS.text }}>{fact.value}</span>
              </div>
            ))
          : null}
      </div>
      {face.kind === "BUY"
        ? face.facts.map((fact) => (
            <div key={fact.label} style={abs({ left: CARD.pad, top: CARD.facts.buyY, flexDirection: "column" })}>
              <span style={{ fontSize: CARD.facts.labelSize, lineHeight: 1, color: CARD_COLORS.muted }}>{fact.label}</span>
              <span style={{ marginTop: 7, fontFamily: mono, fontWeight: 500, fontSize: CARD.facts.valueSize + 4, lineHeight: 1 }}>{fact.value}</span>
            </div>
          ))
        : null}

      {/* The way in: the QR of this card's page, the link, the offer. */}
      <div style={abs({ left: st.x, top: st.y, width: st.width, height: st.height, borderRadius: st.radius, backgroundColor: CARD_COLORS.surface, border: `1px solid ${CARD_COLORS.border}` })} />
      <div style={abs({ left: st.x + st.radius, top: st.y, width: st.width - st.radius * 2, height: 1, backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.2), rgba(255,255,255,0))" })} />
      <div style={abs({ left: qrX, top: qrY, width: CARD.qr.box, height: CARD.qr.box, padding: CARD.qr.quiet, borderRadius: 10, backgroundColor: "#FFFFFF" })}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={svgUri(qrSvg(face))} width={CARD.qr.box - CARD.qr.quiet * 2} height={CARD.qr.box - CARD.qr.quiet * 2} alt="" />
      </div>
      <div style={abs({ left: CARD.stripText.x, ...middle(st.y + st.height / 2 - 13, 20), fontSize: CARD.stripText.joinSize, color: CARD_COLORS.muted })}>{face.join}</div>
      <div style={abs({ left: CARD.stripText.x, ...middle(st.y + st.height / 2 + 12, 26), fontFamily: mono, fontWeight: 500, fontSize: CARD.stripText.linkSize })}>{face.link}</div>
      <div style={abs({ right: CARD.width - (st.x + st.width - 28), ...middle(st.y + st.height / 2 - 12, 26), fontSize: CARD.stripText.offerSize, fontWeight: 600, color: CARD_COLORS.orange })}>{face.offer}</div>
      <div style={abs({ right: CARD.width - (st.x + st.width - 28), ...middle(st.y + st.height / 2 + 13, 20), fontSize: CARD.stripText.whySize, color: CARD_COLORS.muted })}>{face.offerWhy}</div>

      {/* Where the figures come from, and the risk. */}
      <div style={abs({ left: CARD.pad, ...middle(CARD.foot.y + 9, 22), gap: 9, fontSize: CARD.foot.size, color: CARD_COLORS.muted })}>
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="7.2" fill="none" stroke={CARD_COLORS.muted} strokeWidth="1.6" />
          <path d="M4.5 8.5L7.2 11.2L12 5.5" fill="none" stroke={CARD_COLORS.muted} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>{face.seal}</span>
      </div>
      <div style={abs({ right: CARD.pad, ...middle(CARD.foot.y + 9, 22), fontSize: CARD.foot.size, color: CARD_COLORS.muted })}>{face.risk}</div>
    </div>,
    { ...CARD_SIZE, ...(fonts ? { fonts } : {}) },
  );
  return { image, whole: fonts !== null && (icon !== null || card.token.icon === null) };
}

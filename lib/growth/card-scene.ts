import { cardPercent } from "./card-copy.ts";
import type { CardFace, CardTone } from "./card-face.ts";
import { drawMood, moodOf, moodScene } from "./card-mood.ts";

/**
 * The trade card in motion — one drawing for the live card and the film.
 *
 * ## One layout, three renderings
 *
 * `CARD` holds every position and size of the card. The still picture for X
 * (`card-art.tsx`, Satori) places its blocks at the same numbers, and the
 * canvas here draws the same blocks frame by frame; the still is the last
 * frame. The backdrop — the grid, the grain, the brand's glow — and the
 * emotion (`card-mood.ts`) are SVG both read.
 *
 * ## The same show for a loss
 *
 * The choreography does not know the sign: a gain and a loss appear in the
 * same order, at the same pace and size, glow alike and settle alike — the
 * colour, the sign and the emotion differ, never the prominence. The figure
 * is counted from zero to the receipts' result and stays there; a buy has no
 * result, so its price simply arrives. No confetti, no rolling digits, no
 * sound: one entrance, then only the emotion keeps living.
 *
 * Pure and client-safe: it draws on whatever 2D context it is given.
 */

export const CARD = {
  width: 1200,
  height: 630,
  pad: 56,
  wordmark: { x: 56, y: 50, height: 32 },
  rank: { right: 1144, y: 42, badge: 48, gap: 14, size: 22 },
  token: { x: 56, y: 114, icon: 56, textX: 128, kindY: 114, kindSize: 20, symbolY: 138, symbolSize: 36 },
  headline: { x: 52, y: 186, labelY: 186, labelSize: 20, buyY: 212, buyMax: 116 },
  ladder: { rows: [346, 386], labelSize: 17, barX: 200, barBase: 200, barMax: 300, barHeight: 14, priceSize: 22 },
  facts: { buyY: 344, labelSize: 15, valueSize: 22 },
  period: { x: 56, y: 424, height: 38, size: 18 },
  mood: { x: 704, y: 92, width: 440, height: 372 },
  strip: { x: 56, y: 476, width: 1088, height: 94, radius: 22 },
  qr: { box: 72, quiet: 7 },
  stripText: { x: 162, joinSize: 14, linkSize: 18, offerSize: 19, whySize: 14 },
  foot: { y: 590, size: 15 },
} as const;

export const CARD_COLORS = {
  ground: "#080D13",
  surface: "rgba(14,22,32,0.84)",
  elevated: "rgba(19,30,42,0.88)",
  border: "rgba(255,255,255,0.09)",
  text: "#F5F7FA",
  muted: "#91A0B2",
  orange: "#FF681C",
  up: "#19C77A",
  down: "#FF4D55",
  neutral: "#9FB0C4",
} as const;

/** The colour a tone is drawn in: the figure, its glow, its bar. */
export function toneColor(tone: CardTone): string {
  return tone === "up" ? CARD_COLORS.up : tone === "down" ? CARD_COLORS.down : CARD_COLORS.neutral;
}

/** The figure's colour: a buy's price and a flat result are plain text. */
export function headlineColor(tone: CardTone): string {
  return tone === "up" || tone === "down" ? toneColor(tone) : CARD_COLORS.text;
}

/** The headline's size: as large as its length allows beside the emotion; a buy's price leaves room for what was paid under it. */
export function headlineSize(text: string, buy = false): number {
  const length = [...text].length;
  const size = length <= 7 ? 150 : length <= 9 ? 124 : length <= 11 ? 104 : 88;
  return buy ? Math.min(size, CARD.headline.buyMax) : size;
}

/** The exit bar beside an entry bar of `barBase`: its width, and whether it was cut to fit. */
export function ladderWidths(ratio: number): { entry: number; exit: number; cut: boolean } {
  const { barBase, barMax } = CARD.ladder;
  const raw = barBase * ratio;
  return { entry: barBase, exit: Math.max(12, Math.min(barMax, raw)), cut: raw > barMax };
}

/** The tone as an rgba. */
export function toneGlow(tone: CardTone, alpha: number): string {
  const hex = toneColor(tone);
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * The still layers both renderings share: a faint grid that fades out from
 * the figure, a fine grain, the brand's glow in the far corner and a dark
 * edge. Plain SVG — no text, no fonts.
 */
export function cardBackdropSvg(): string {
  const { width: w, height: h } = CARD;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><pattern id="g" width="42" height="42" patternUnits="userSpaceOnUse"><path d="M42 0H0V42" fill="none" stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="1"/></pattern><radialGradient id="gm" cx="0.42" cy="0.45" r="0.6"><stop offset="0" stop-color="#FFFFFF" stop-opacity="1"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient><mask id="m"><rect width="${w}" height="${h}" fill="url(#gm)"/></mask><radialGradient id="b" cx="1" cy="0" r="0.62"><stop offset="0" stop-color="#FF681C" stop-opacity="0.18"/><stop offset="0.55" stop-color="#FF681C" stop-opacity="0.04"/><stop offset="1" stop-color="#FF681C" stop-opacity="0"/></radialGradient><radialGradient id="v" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.45"/></radialGradient><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0"/></filter></defs><rect width="${w}" height="${h}" fill="#080D13"/><rect width="${w}" height="${h}" fill="url(#b)"/><rect width="${w}" height="${h}" fill="url(#g)" mask="url(#m)"/><rect width="${w}" height="${h}" filter="url(#n)"/><rect width="${w}" height="${h}" fill="url(#v)"/></svg>`;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ---------- the timeline ---------- */

/** The entrance, in milliseconds; after it only the emotion moves. */
export const INTRO_MS = 3_300;
/**
 * The film: the finished card first — the frame X shows before it plays, and
 * the frame a loop returns to — a short fade to the bare ground, then the
 * entrance, a pause on the figure, a second light, a pause.
 */
export const FILM_COVER_MS = 600;
export const FILM_FADE_MS = 300;
export const FILM_MS = FILM_COVER_MS + FILM_FADE_MS + 6_400;
export const FILM_FPS = 30;
const SHEENS_LIVE = [2_500];
const SHEENS_FILM = [2_500, 4_900];
const SHEEN_MS = 800;

const clamp = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const easeOut = (p: number) => 1 - (1 - p) ** 3;
const easeInOut = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
/** How far an element is through its own part of the entrance, eased. */
const part = (t: number, start: number, length: number) => easeOut(clamp((t - start) / length));

export type ScenePhase = Readonly<{
  ground: number;
  edge: number;
  brand: number;
  token: number;
  headline: number;
  count: number;
  glow: number;
  entryBar: number;
  exitBar: number;
  ladderText: number;
  facts: number;
  period: number;
  strip: number;
  qr: number;
  link: number;
  offer: number;
  foot: number;
  /** Where the band of light is, 0 → 1 across the card; null when none passes. */
  sheen: number | null;
}>;

/** Every element's progress at `t` ms; `t` = `STILL` gives the still. */
export function sceneAt(t: number, film = false): ScenePhase {
  const sheenStarts = film ? SHEENS_FILM : SHEENS_LIVE;
  const passing = sheenStarts.find((start) => t >= start && t < start + SHEEN_MS);
  const settle = clamp((t - 1_950) / 600);
  return {
    ground: part(t, 0, 500),
    edge: part(t, 0, 900),
    brand: part(t, 150, 500),
    token: part(t, 300, 500),
    headline: part(t, 550, 350),
    count: easeOut(clamp((t - 550) / 1_500)),
    /* The glow rises with the figure and swells once, softly, as the count lands. */
    glow: part(t, 200, 1_200) + (Number.isFinite(t) ? 0.35 * Math.sin(Math.PI * settle) : 0),
    entryBar: part(t, 1_100, 500),
    exitBar: part(t, 1_300, 700),
    ladderText: part(t, 1_500, 500),
    facts: part(t, 1_900, 400),
    period: part(t, 1_700, 500),
    strip: part(t, 1_500, 600),
    /* The QR's modules start with its white box, so the box is never seen empty for long. */
    qr: easeInOut(clamp((t - 1_550) / 750)),
    link: part(t, 2_000, 400),
    offer: part(t, 2_200, 400),
    foot: part(t, 2_400, 400),
    sheen: passing === undefined ? null : easeInOut((t - passing) / SHEEN_MS),
  };
}

/** The still: every element in place, no light passing. */
export const STILL = Number.POSITIVE_INFINITY;

/** The figure at `phase`: counted toward the receipts' result, the result itself at the end. */
export function headlineAt(face: CardFace, phase: ScenePhase): string {
  if (face.resultBps === null || phase.count >= 1) return face.headline;
  /* A loss carries its sign from the first frame: «−0.0%», never a bare «0.0%». */
  const counted = Math.round(face.resultBps * phase.count);
  return cardPercent(counted === 0 ? Math.sign(face.resultBps) : counted, face.locale);
}

/*
 * The figure's spaces as the still picture sets them: a punctuation space
 * (U+2008), so «−17,5 %» reads the same in the live card, the film and the
 * picture — a no-break space in a monospaced face is a whole figure wide.
 */
const FIGURE_SPACE = String.fromCharCode(0x2008);
const FIGURE_SPACES = new RegExp(`[ ${String.fromCharCode(0xa0)}]`, "g");
export function figureSpaces(text: string): string {
  return text.replace(FIGURE_SPACES, FIGURE_SPACE);
}

/* ---------- the canvas ---------- */

export type SceneAssets = Readonly<{
  backdrop: CanvasImageSource;
  wordmark: CanvasImageSource;
  wordmarkRatio: number;
  badge: CanvasImageSource | null;
  icon: CanvasImageSource | null;
}>;

/** The families the page's fonts load under (`--font-geist`, `--font-geist-mono`). */
export type SceneFonts = Readonly<{ sans: string; mono: string }>;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function setSpacing(ctx: Ctx, px: number) {
  if ("letterSpacing" in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** The period pill's width for `text` at the pill's size (measured with the pill's font set). */
export const PERIOD_PILL = { padLeft: 16, dot: 10, gap: 12, padRight: 18 } as const;

/**
 * One frame of the card at `t` ms, on a context already scaled so that one
 * unit is one pixel of the 1200 × 630 card.
 */
export function drawCardScene(ctx: Ctx, face: CardFace, assets: SceneAssets, fonts: SceneFonts, t: number, film = false): void {
  const phase = sceneAt(t, film);
  const tone = face.tone;
  const color = toneColor(tone);
  const { width: W, height: H } = CARD;

  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = CARD_COLORS.ground;
  ctx.fillRect(0, 0, W, H);

  /* The ground. */
  ctx.globalAlpha = phase.ground;
  ctx.drawImage(assets.backdrop, 0, 0, W, H);
  ctx.globalAlpha = 1;

  /* The glow of the result, behind everything that is said. */
  const glowAlpha = 0.24 * Math.max(0, phase.glow);
  if (glowAlpha > 0) {
    const glow = ctx.createRadialGradient(300, 260, 0, 300, 260, 560);
    glow.addColorStop(0, toneGlow(tone, glowAlpha));
    glow.addColorStop(0.55, toneGlow(tone, glowAlpha * 0.28));
    glow.addColorStop(1, toneGlow(tone, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  }

  /* The lit top edge, drawn out from the middle. */
  if (phase.edge > 0) {
    const half = (W / 2) * phase.edge;
    const edge = ctx.createLinearGradient(W / 2 - half, 0, W / 2 + half, 0);
    edge.addColorStop(0, toneGlow(tone, 0));
    edge.addColorStop(0.5, toneGlow(tone, 0.9));
    edge.addColorStop(1, toneGlow(tone, 0));
    ctx.fillStyle = edge;
    ctx.fillRect(W / 2 - half, 0, half * 2, 2);
  }

  /* The emotion: Ryntra's own figure, the same size for a gain and a loss. */
  {
    const md = CARD.mood;
    ctx.save();
    ctx.translate(md.x, md.y);
    drawMood(ctx, moodScene(moodOf(face.kind, face.resultBps), t, color));
    ctx.restore();
  }

  /* The brand and the rank of the moment. */
  if (phase.brand > 0) {
    ctx.globalAlpha = phase.brand;
    const lift = (1 - phase.brand) * 10;
    const wm = CARD.wordmark;
    ctx.drawImage(assets.wordmark, wm.x, wm.y + lift, Math.round(wm.height * assets.wordmarkRatio), wm.height);
    if (face.rank && assets.badge) {
      const r = CARD.rank;
      ctx.drawImage(assets.badge, r.right - r.badge, r.y + lift, r.badge, r.badge);
      ctx.font = `400 ${r.size}px ${fonts.sans}`;
      ctx.fillStyle = CARD_COLORS.muted;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(face.rank.name, r.right - r.badge - r.gap, r.y + r.badge / 2 + lift);
    }
    ctx.globalAlpha = 1;
  }

  /* The token. */
  if (phase.token > 0) {
    const tk = CARD.token;
    const shift = (1 - phase.token) * -14;
    ctx.globalAlpha = phase.token;
    const scale = 0.8 + 0.2 * phase.token;
    const radius = (tk.icon / 2) * scale;
    const cx = tk.x + tk.icon / 2;
    const cy = tk.y + tk.icon / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    if (assets.icon) {
      ctx.clip();
      ctx.drawImage(assets.icon, cx - radius, cy - radius, radius * 2, radius * 2);
    } else {
      ctx.fillStyle = "#131E2A";
      ctx.fill();
      ctx.strokeStyle = "#22303E";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = `600 ${Math.round(26 * scale)}px ${fonts.sans}`;
      ctx.fillStyle = CARD_COLORS.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(face.letter, cx, cy + 1);
    }
    ctx.restore();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `400 ${tk.kindSize}px ${fonts.sans}`;
    ctx.fillStyle = CARD_COLORS.muted;
    ctx.fillText(face.kindLabel, tk.textX + shift, tk.kindY);
    ctx.font = `600 ${tk.symbolSize}px ${fonts.sans}`;
    ctx.fillStyle = CARD_COLORS.text;
    setSpacing(ctx, -0.5);
    ctx.fillText(face.symbol, tk.textX + shift, tk.symbolY);
    setSpacing(ctx, 0);
    ctx.globalAlpha = 1;
  }

  /* The figure: counted to the receipts' result, glowing in its tone. */
  if (phase.headline > 0) {
    const hl = CARD.headline;
    /* The film shows the figure whole from its first frame: a file that is posted carries no number but the receipts'. */
    const text = figureSpaces(film ? face.headline : headlineAt(face, phase));
    const size = headlineSize(face.headline, face.headlineLabel !== null);
    const top = face.headlineLabel ? hl.buyY : hl.y;
    ctx.globalAlpha = phase.headline;
    if (face.headlineLabel) {
      ctx.font = `400 ${hl.labelSize}px ${fonts.sans}`;
      ctx.fillStyle = CARD_COLORS.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(face.headlineLabel, CARD.pad, hl.labelY);
    }
    ctx.save();
    /* A buy has nothing to count, and the film counts nothing: the figure settles into place instead. */
    if (face.resultBps === null || film) {
      const grow = 0.94 + 0.06 * phase.headline;
      ctx.translate(hl.x, top);
      ctx.scale(grow, grow);
      ctx.translate(-hl.x, -top);
    }
    ctx.font = `500 ${size}px ${fonts.mono}`;
    setSpacing(ctx, -size * 0.03);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const shine = Math.min(1.35, Math.max(0, phase.glow));
    ctx.shadowColor = toneGlow(tone, tone === "up" || tone === "down" ? 0.42 * shine : 0.18 * shine);
    ctx.shadowBlur = 36;
    ctx.fillStyle = headlineColor(tone);
    /* Word by word with a narrow gap, as the still picture sets «−17,5 %»: a space in a monospaced face is a whole figure wide, and not every face has the narrow one. */
    const words = text.split(FIGURE_SPACE);
    const gap = size * 0.16;
    const write = () => {
      let x: number = hl.x;
      for (const word of words) {
        ctx.fillText(word, x, top);
        x += ctx.measureText(word).width + gap;
      }
    };
    write();
    ctx.shadowBlur = 0;
    write();
    setSpacing(ctx, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* Entry and exit: two bars, the exit's length the exit price over the entry's. */
  if (face.ladder) {
    const ld = CARD.ladder;
    const widths = ladderWidths(face.ladder.ratio);
    const rows = [
      { label: face.ladder.entryLabel, price: face.ladder.entry, width: widths.entry, grow: phase.entryBar, cut: false },
      { label: face.ladder.exitLabel, price: face.ladder.exit, width: widths.exit, grow: phase.exitBar, cut: widths.cut },
    ];
    rows.forEach((row, index) => {
      const y = ld.rows[index] + 12;
      if (row.grow <= 0) return;
      ctx.globalAlpha = Math.min(1, row.grow * 2);
      ctx.font = `400 ${ld.labelSize}px ${fonts.sans}`;
      ctx.fillStyle = CARD_COLORS.muted;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(row.label, CARD.pad, y);
      const w = Math.max(ld.barHeight, row.width * row.grow);
      if (index === 1) {
        const bar = ctx.createLinearGradient(ld.barX, 0, ld.barX + row.width, 0);
        bar.addColorStop(0, toneGlow(tone, 0.45));
        bar.addColorStop(1, toneGlow(tone, 1));
        ctx.fillStyle = bar;
      } else {
        ctx.fillStyle = "rgba(159,176,196,0.42)";
      }
      roundRect(ctx, ld.barX, y - ld.barHeight / 2, w, ld.barHeight, ld.barHeight / 2);
      ctx.fill();
      if (row.cut && row.grow >= 1) {
        /* Longer than the card holds: a break in the bar says so. */
        ctx.strokeStyle = CARD_COLORS.ground;
        ctx.lineWidth = 3;
        for (const dx of [-46, -38]) {
          ctx.beginPath();
          ctx.moveTo(ld.barX + w + dx - 4, y + 9);
          ctx.lineTo(ld.barX + w + dx + 4, y - 9);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = phase.ladderText;
      ctx.font = `500 ${ld.priceSize}px ${fonts.mono}`;
      ctx.fillStyle = CARD_COLORS.text;
      ctx.fillText(row.price, ld.barX + row.width + 16, y);
      ctx.globalAlpha = 1;
    });
  }

  /* The period, as a pill — and beside it the dollar result, only when the person chose it. */
  let pillEnd: number = CARD.period.x;
  if (phase.period > 0) {
    const pd = CARD.period;
    ctx.globalAlpha = phase.period;
    ctx.font = `400 ${pd.size}px ${fonts.sans}`;
    const textWidth = ctx.measureText(face.period).width;
    const width = PERIOD_PILL.padLeft + PERIOD_PILL.dot + PERIOD_PILL.gap + textWidth + PERIOD_PILL.padRight;
    pillEnd = pd.x + width;
    const y = pd.y + (1 - phase.period) * 8;
    ctx.fillStyle = CARD_COLORS.elevated;
    roundRect(ctx, pd.x, y, width, pd.height, pd.height / 2);
    ctx.fill();
    ctx.strokeStyle = CARD_COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pd.x + PERIOD_PILL.padLeft + PERIOD_PILL.dot / 2, y + pd.height / 2, PERIOD_PILL.dot / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CARD_COLORS.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(face.period, pd.x + PERIOD_PILL.padLeft + PERIOD_PILL.dot + PERIOD_PILL.gap, y + pd.height / 2 + 1);
    ctx.globalAlpha = 1;
  }
  if (face.facts.length > 0 && phase.facts > 0) {
    const fc = CARD.facts;
    ctx.globalAlpha = phase.facts;
    ctx.textAlign = "left";
    if (face.ladder || face.kind === "SELL") {
      /* A sale: inline after the period. */
      let x = pillEnd + 24;
      const y = CARD.period.y + CARD.period.height / 2 + 1;
      ctx.textBaseline = "middle";
      for (const fact of face.facts) {
        ctx.font = `400 ${fc.labelSize}px ${fonts.sans}`;
        ctx.fillStyle = CARD_COLORS.muted;
        ctx.fillText(fact.label, x, y);
        x += ctx.measureText(fact.label).width + 10;
        ctx.font = `500 ${fc.valueSize}px ${fonts.mono}`;
        ctx.fillStyle = fact.tone === "up" || fact.tone === "down" ? toneColor(fact.tone) : CARD_COLORS.text;
        ctx.fillText(fact.value, x, y);
        x += ctx.measureText(fact.value).width + 24;
      }
    } else {
      /* A buy: where a sale's bars would be. */
      ctx.textBaseline = "top";
      for (const fact of face.facts) {
        ctx.font = `400 ${fc.labelSize}px ${fonts.sans}`;
        ctx.fillStyle = CARD_COLORS.muted;
        ctx.fillText(fact.label, CARD.pad, fc.buyY);
        ctx.font = `500 ${fc.valueSize + 4}px ${fonts.mono}`;
        ctx.fillStyle = CARD_COLORS.text;
        ctx.fillText(fact.value, CARD.pad, fc.buyY + 22);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* The way in: the QR of this card's page, the link, the offer — one strip along the foot. */
  if (phase.strip > 0) {
    const st = CARD.strip;
    const lift = (1 - phase.strip) * 16;
    ctx.save();
    ctx.translate(0, lift);
    ctx.globalAlpha = phase.strip;
    ctx.fillStyle = CARD_COLORS.surface;
    roundRect(ctx, st.x, st.y, st.width, st.height, st.radius);
    ctx.fill();
    ctx.strokeStyle = CARD_COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    /* A glint along the strip's top. */
    const glint = ctx.createLinearGradient(st.x, 0, st.x + st.width, 0);
    glint.addColorStop(0, "rgba(255,255,255,0)");
    glint.addColorStop(0.5, "rgba(255,255,255,0.2)");
    glint.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glint;
    ctx.fillRect(st.x + st.radius, st.y, st.width - st.radius * 2, 1);

    const q = CARD.qr;
    const boxX = st.x + (st.height - q.box) / 2 + 4;
    const boxY = st.y + (st.height - q.box) / 2;
    ctx.fillStyle = "#FFFFFF";
    roundRect(ctx, boxX, boxY, q.box, q.box, 10);
    ctx.fill();
    /* The QR arrives corner to corner. */
    const inner = q.box - q.quiet * 2;
    const cell = inner / face.qr.size;
    ctx.fillStyle = CARD_COLORS.ground;
    for (let row = 0; row < face.qr.size; row += 1) {
      for (let col = 0; col < face.qr.size; col += 1) {
        if (face.qr.bits[row * face.qr.size + col] !== "1") continue;
        if ((row + col) / (2 * face.qr.size - 2) > phase.qr) continue;
        ctx.fillRect(boxX + q.quiet + col * cell, boxY + q.quiet + row * cell, cell + 0.3, cell + 0.3);
      }
    }

    const sx = CARD.stripText;
    const mid = st.y + st.height / 2;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = phase.strip * phase.link;
    ctx.font = `400 ${sx.joinSize}px ${fonts.sans}`;
    ctx.fillStyle = CARD_COLORS.muted;
    ctx.fillText(face.join, sx.x, mid - 13);
    ctx.font = `500 ${sx.linkSize}px ${fonts.mono}`;
    ctx.fillStyle = CARD_COLORS.text;
    ctx.fillText(face.link, sx.x, mid + 12);

    ctx.globalAlpha = phase.strip * phase.offer;
    const right = st.x + st.width - 28;
    const rise = (1 - phase.offer) * 6;
    ctx.textAlign = "right";
    ctx.font = `600 ${sx.offerSize}px ${fonts.sans}`;
    ctx.fillStyle = CARD_COLORS.orange;
    ctx.fillText(face.offer, right, mid - 12 + rise);
    ctx.font = `400 ${sx.whySize}px ${fonts.sans}`;
    ctx.fillStyle = CARD_COLORS.muted;
    ctx.fillText(face.offerWhy, right, mid + 13 + rise);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* Where the figures come from, and the risk. */
  if (phase.foot > 0) {
    const ft = CARD.foot;
    ctx.globalAlpha = phase.foot;
    /* The mark of «from the receipts» is the same for every card: a red tick would read as an error. */
    ctx.strokeStyle = CARD_COLORS.muted;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(CARD.pad + 8, ft.y + 9, 7.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CARD.pad + 4.5, ft.y + 9.5);
    ctx.lineTo(CARD.pad + 7.2, ft.y + 12.2);
    ctx.lineTo(CARD.pad + 12, ft.y + 6.5);
    ctx.stroke();
    ctx.font = `400 ${ft.size}px ${fonts.sans}`;
    ctx.fillStyle = CARD_COLORS.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(face.seal, CARD.pad + 24, ft.y + 9);
    ctx.textAlign = "right";
    ctx.fillText(face.risk, W - CARD.pad, ft.y + 9);
    ctx.globalAlpha = 1;
  }

  /* A band of light across the whole card — the same for a gain and a loss. */
  if (phase.sheen !== null) {
    const x = -500 + phase.sheen * (W + 1000);
    const band = ctx.createLinearGradient(x - 220, 0, x + 220, H * 0.35);
    band.addColorStop(0, "rgba(255,255,255,0)");
    band.addColorStop(0.5, "rgba(255,255,255,0.10)");
    band.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
}

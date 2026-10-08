import { R_MARK_MATERIAL, R_MARK_PATHS } from "../../app/brand/mark.ts";

/**
 * The card's emotion — Ryntra's own figures, not anyone's mascot.
 *
 * A gain is a rocket in the brand's colours with the R on its hull; a gain
 * past +100 % flies to the Moon. A loss is a Ryntra coin that cries — a few
 * tears, past −15 % sobbing, past −50 % under its own rain cloud. A sale at
 * cost keeps a straight face; a buy, which has no result yet, is Ryntra's R
 * coin turning — nothing about what comes next. Each emotion is drawn the same size, in the same place,
 * with as much movement as its opposite: a loss is as visible as a gain.
 *
 * ## One figure, two renderings
 *
 * A figure is a small tree of SVG paths (`MoodNode`) built for a moment `t`.
 * `moodSvg` writes it as SVG — the still picture for X embeds it as an image —
 * and `drawMood` fills the same paths on a canvas (`Path2D` takes SVG path
 * data), frame by frame, for the live card and the film. Gradients live in the
 * shape's own coordinates in both, so the two agree.
 *
 * Pure and client-safe.
 */

export type Mood = "moon" | "rocket" | "flat" | "tear" | "cry" | "storm" | "coin";

/** The emotion of a card: by the sign, and by how far — a doubling and a halving are alike. */
export function moodOf(kind: "SELL" | "BUY", resultBps: number | null): Mood {
  if (kind !== "SELL" || resultBps === null) return "coin";
  if (resultBps >= 10_000) return "moon";
  if (resultBps > 0) return "rocket";
  if (resultBps === 0) return "flat";
  if (resultBps <= -5_000) return "storm";
  if (resultBps <= -1_500) return "cry";
  return "tear";
}

/** The box the figure is drawn in, in the card's own units. */
export const MOOD_BOX = { width: 440, height: 372 } as const;

type Stop = readonly [number, string];
export type Paint =
  | string
  | Readonly<{ x1: number; y1: number; x2: number; y2: number; stops: readonly Stop[] }>
  | Readonly<{ cx: number; cy: number; r: number; stops: readonly Stop[] }>;

export type MoodShape = Readonly<{ d: string; fill?: Paint; stroke?: Paint; width?: number; opacity?: number }>;
export type MoodGroup = Readonly<{ group: readonly MoodNode[]; x?: number; y?: number; rotate?: number; sx?: number; sy?: number; opacity?: number }>;
export type MoodNode = MoodShape | MoodGroup;

/* ---------- shapes ---------- */

const n = (value: number) => Math.round(value * 100) / 100;

export function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

function sparkle(size: number): string {
  const s = size;
  const k = s * 0.26;
  return `M0 ${-s}L${n(k)} ${n(-k)}L${s} 0L${n(k)} ${n(k)}L0 ${s}L${n(-k)} ${n(k)}L${-s} 0L${n(-k)} ${n(-k)}Z`;
}

const DROP = "M0 -11C7 -1 9 6 0 12C-9 6 -7 -1 0 -11Z";
const TEAR_FILL: Paint = { x1: 0, y1: -11, x2: 0, y2: 12, stops: [[0, "#D6EEFF"], [1, "#5AB0FF"]] };

/** The R, centred on the origin, `size` units tall, in the master's own ramp. */
function brandR(size: number, opacity = 1): MoodGroup {
  const scale = size / 790.65;
  const ramp: Paint = { x1: 240, y1: 242, x2: 1012, y2: 1033, stops: R_MARK_MATERIAL.map(([color, offset]) => [offset, color] as const) };
  return { group: [{ group: [{ d: R_MARK_PATHS, fill: ramp }], x: -626.1, y: -637.6 }], sx: scale, sy: scale, opacity };
}

/** `#RRGGBB` at `alpha`. */
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ---------- time ---------- */

const clamp = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const easeOut = (p: number) => 1 - (1 - p) ** 3;
/** The figure arrives after the card's ground and the token. */
const ENTER_AT = 700;
const ENTER_MS = 1_000;
/** The clock the still is drawn at: tears mid-fall, the flame at full. */
const STILL_CLOCK = 1_234;

type Clock = Readonly<{ enter: number; loop: number }>;

function clockAt(t: number): Clock {
  if (!Number.isFinite(t)) return { enter: 1, loop: STILL_CLOCK };
  return { enter: easeOut(clamp((t - ENTER_AT) / ENTER_MS)), loop: t };
}

/** Where in its own cycle of `period` ms something is, shifted by `offset` of a cycle. */
const cycle = (loop: number, period: number, offset = 0) => (((loop / period + offset) % 1) + 1) % 1;

/* ---------- the figures ---------- */

const STARS: readonly (readonly [number, number, number])[] = [
  [42, 64, 7],
  [128, 30, 5],
  [396, 222, 6],
  [64, 214, 5],
  [300, 334, 6],
  [24, 330, 4],
  [416, 300, 4],
];

function stars(loop: number, enter: number): MoodNode[] {
  return STARS.map(([x, y, size], i) => {
    const twinkle = 0.5 + 0.5 * Math.sin(loop / 420 + i * 1.9);
    return { group: [{ d: sparkle(size), fill: "#F5F7FA" }], x, y, sx: 0.7 + 0.5 * twinkle, sy: 0.7 + 0.5 * twinkle, opacity: enter * (0.25 + 0.55 * twinkle) };
  });
}

function rocketBody(loop: number): MoodNode[] {
  const flicker = 1 + 0.16 * Math.sin(loop / 70) + 0.08 * Math.sin(loop / 31);
  return [
    {
      group: [
        { d: "M-21 0C-25 40 -10 80 0 116C10 80 25 40 21 0Z", fill: { x1: 0, y1: 0, x2: 0, y2: 116, stops: [[0, "#FFE29A"], [0.32, "#FF9A3C"], [0.7, "#FF681C"], [1, "rgba(255,104,28,0)"]] } },
        { d: "M-9 0C-10 22 -4 44 0 64C4 44 10 22 9 0Z", fill: "#FFF6DD" },
      ],
      y: 66,
      sy: flicker,
      sx: 1 - (flicker - 1) * 0.4,
    },
    { d: "M-34 16C-60 28 -68 52 -66 78L-34 56Z", fill: { x1: -66, y1: 16, x2: -34, y2: 78, stops: [[0, "#FF7A2F"], [1, "#F24C0C"]] } },
    { d: "M34 16C60 28 68 52 66 78L34 56Z", fill: { x1: 66, y1: 16, x2: 34, y2: 78, stops: [[0, "#FF7A2F"], [1, "#F24C0C"]] } },
    { d: "M-22 58L22 58L18 70L-18 70Z", fill: "#22303E" },
    { d: "M0 -114C31 -86 41 -42 39 10L35 60L-35 60L-39 10C-41 -42 -31 -86 0 -114Z", fill: { x1: -39, y1: 0, x2: 39, y2: 0, stops: [[0, "#FFFFFF"], [0.55, "#E3E9F0"], [1, "#9DAABA"]] } },
    { d: "M-23 -82C-12 -75 12 -75 23 -82C17 -97 9 -107 0 -114C-9 -107 -17 -97 -23 -82Z", fill: { x1: -23, y1: -114, x2: 23, y2: -76, stops: [[0, "#FF7A2F"], [1, "#F24C0C"]] } },
    { d: "M-4 -30L4 -30L4 60L-4 60Z", fill: "rgba(13,22,32,0.08)" },
    { d: circle(0, -30, 18), fill: "#0E1620", stroke: "#FF681C", width: 6 },
    { d: circle(-5, -36, 5), fill: "rgba(255,255,255,0.75)" },
    { group: [brandR(30)], y: 28 },
  ];
}

const ROCKET_SCALE = 1.2;

function rocket(t: number, moon: boolean, tone: string): MoodNode[] {
  const { enter, loop } = clockAt(t);
  const angle = moon ? 34 : 40;
  const rad = (angle * Math.PI) / 180;
  const dir = { x: Math.sin(rad), y: -Math.cos(rad) };
  const from = { x: 90, y: 470 };
  const to = moon ? { x: 190, y: 206 } : { x: 214, y: 178 };
  const bob = Math.sin(loop / 560) * 5;
  const pos = { x: from.x + (to.x - from.x) * enter - dir.y * bob, y: from.y + (to.y - from.y) * enter + dir.x * bob };
  const nozzle = { x: pos.x - dir.x * 66 * ROCKET_SCALE, y: pos.y - dir.y * 66 * ROCKET_SCALE };
  const nodes: MoodNode[] = [];
  if (moon) {
    const cx = 352;
    const cy = 76;
    nodes.push(
      { d: circle(cx, cy, 92), fill: { cx, cy, r: 92, stops: [[0.45, "rgba(245,247,250,0.16)"], [1, "rgba(245,247,250,0)"]] }, opacity: enter },
      { d: circle(cx, cy, 52), fill: { x1: cx - 52, y1: cy - 52, x2: cx + 52, y2: cy + 52, stops: [[0, "#FFFFFF"], [1, "#AEB9C6"]] }, opacity: enter },
      { d: circle(cx - 16, cy - 10, 11), fill: "rgba(80,94,110,0.28)", opacity: enter },
      { d: circle(cx + 18, cy + 14, 8), fill: "rgba(80,94,110,0.24)", opacity: enter },
      { d: circle(cx + 4, cy - 26, 5), fill: "rgba(80,94,110,0.22)", opacity: enter },
    );
  }
  nodes.push(...stars(loop, enter));
  /* Smoke, drawn out behind the nozzle. */
  for (let i = 0; i < 7; i += 1) {
    const k = cycle(loop, 1_000, i / 7);
    const distance = 24 + k * 200;
    const drift = Math.sin(i * 1.7) * k * 26;
    nodes.push({
      d: circle(nozzle.x - dir.x * distance - dir.y * drift, nozzle.y - dir.y * distance + dir.x * drift, 9 + k * 26),
      fill: "#C9D3DE",
      opacity: enter * (1 - k) * 0.3,
    });
  }
  /* Speed lines in the result's colour. */
  [-74, -38, 38, 74].forEach((offset, i) => {
    const k = cycle(loop, 520, i * 0.27);
    const start = 70 + k * 120;
    const a = { x: pos.x - dir.x * start - dir.y * offset, y: pos.y - dir.y * start + dir.x * offset };
    const b = { x: a.x - dir.x * 56, y: a.y - dir.y * 56 };
    nodes.push({ d: `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`, stroke: tone, width: 4, opacity: enter * 0.7 * (1 - k) });
  });
  nodes.push({ group: rocketBody(loop), x: pos.x, y: pos.y, rotate: angle, sx: ROCKET_SCALE, sy: ROCKET_SCALE, opacity: Math.min(1, enter * 1.6) });
  return nodes;
}

/** A Ryntra coin: graphite with the brand's orange rim. */
function coinBase(tone: string): MoodNode[] {
  return [
    { d: circle(0, 0, 160), fill: { cx: 0, cy: 0, r: 160, stops: [[0.5, rgba(tone, 0.22)], [1, rgba(tone, 0)]] } },
    { d: circle(0, 0, 116), fill: { cx: -34, cy: -44, r: 170, stops: [[0, "#26364A"], [1, "#0E1620"]] }, stroke: "#FF681C", width: 7 },
    { d: circle(0, 0, 99), stroke: "rgba(255,255,255,0.07)", width: 2 },
    { d: "M-92 -50A106 106 0 0 1 -42 -96", stroke: "rgba(255,255,255,0.28)", width: 3 },
  ];
}

const FACE_STROKE = "#F5F7FA";

function tears(loop: number, count: number, period: number): MoodNode[] {
  const nodes: MoodNode[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i += 1) {
      const k = cycle(loop, period, i / count + (side > 0 ? 0.5 / count : 0));
      nodes.push({
        group: [{ d: DROP, fill: TEAR_FILL }],
        /* Each drop runs down the cheek and is gone by the rim — none falls off the coin. */
        x: side * (48 + k * 22),
        y: 6 + k * 112,
        sx: 0.8 + 0.4 * (1 - k),
        sy: 0.8 + 0.5 * (1 - k),
        opacity: (1 - k) ** 1.5,
      });
    }
  }
  return nodes;
}

function face(mood: Mood, loop: number): MoodNode[] {
  if (mood === "flat") {
    return [
      { d: circle(-40, -16, 8), fill: FACE_STROKE },
      { d: circle(40, -16, 8), fill: FACE_STROKE },
      { d: "M-32 44L32 44", stroke: FACE_STROKE, width: 8 },
    ];
  }
  const sob = Math.sin(loop / 130);
  const nodes: MoodNode[] = [
    { d: "M-70 -40L-30 -54", stroke: FACE_STROKE, width: 7 },
    { d: "M30 -54L70 -40", stroke: FACE_STROKE, width: 7 },
    { d: "M-66 -8Q-48 -26 -28 -8", stroke: FACE_STROKE, width: 8 },
    { d: "M28 -8Q48 -26 66 -8", stroke: FACE_STROKE, width: 8 },
  ];
  if (mood === "tear") {
    /* A small loss trembles as much as a small gain flies: the lip quivers with the sob. */
    nodes.push({ group: [{ d: "M-30 10Q0 -10 30 10", stroke: FACE_STROKE, width: 8 }], y: 42, sy: 1 + 0.12 * sob });
  } else {
    /* Streams down both cheeks, and a mouth that sobs. */
    nodes.push(
      { d: "M-48 2C-52 34 -56 70 -60 104", stroke: "rgba(124,196,255,0.5)", width: 9 },
      { d: "M48 2C52 34 56 70 60 104", stroke: "rgba(124,196,255,0.5)", width: 9 },
      { group: [{ d: "M-36 58Q0 14 36 58Q0 72 -36 58Z", fill: "#080D13", stroke: FACE_STROKE, width: 6 }], y: 0, sy: 1 + 0.07 * sob },
    );
  }
  return nodes;
}

function crying(t: number, mood: Mood, tone: string): MoodNode[] {
  const { enter, loop } = clockAt(t);
  const drop = (1 - enter) * -70;
  const landing = clamp((t - ENTER_AT - ENTER_MS * 0.55) / 260);
  const squash = Number.isFinite(t) ? 1 - 0.07 * Math.sin(Math.PI * landing) : 1;
  /* Every crying coin sobs and floats as the rocket bobs; the straight face only floats. */
  const wobble = mood === "flat" ? 0 : Math.sin(loop / 170) * 3;
  const float = Number.isFinite(t) ? Math.sin(loop / 560) * 5 : 0;
  const nodes: MoodNode[] = [];
  const cx = 220;
  const cy = 214;
  nodes.push({
    group: [...coinBase(tone), { group: face(mood, loop), rotate: wobble }, ...(mood === "flat" ? [] : tears(loop, mood === "tear" ? 2 : 3, mood === "tear" ? 1_150 : 1_050))],
    x: cx,
    y: cy + drop + float,
    sx: 2 - squash,
    sy: squash,
    opacity: enter,
  });
  if (mood === "storm") {
    const sway = Math.sin(loop / 700) * 6;
    const rain: MoodNode[] = [];
    for (let i = 0; i < 9; i += 1) {
      const k = cycle(loop, 640, i / 9 + (i % 2) * 0.13);
      const x = -78 + i * 19.5;
      const y = 26 + k * 132;
      rain.push({ d: `M${n(x)} ${n(y)}L${n(x - 5)} ${n(y + 18)}`, stroke: "#7CC4FF", width: 3, opacity: (1 - k) * 0.8 });
    }
    nodes.push({
      group: [
        ...rain,
        {
          d: "M-92 22C-114 22 -116 -12 -90 -16C-88 -46 -50 -56 -32 -36C-20 -66 32 -66 42 -34C66 -48 98 -30 90 -6C114 -2 112 26 88 26Z",
          fill: { x1: 0, y1: -60, x2: 0, y2: 26, stops: [[0, "#465567"], [1, "#253140"]] },
          stroke: "rgba(255,255,255,0.14)",
          width: 2,
        },
      ],
      x: cx + sway,
      y: 54 + drop * 0.6,
      opacity: enter,
    });
  }
  nodes.push(...stars(loop, enter * 0.5).slice(0, 4));
  return nodes;
}

function buyCoin(t: number, tone: string): MoodNode[] {
  const { enter, loop } = clockAt(t);
  /* The coin turns slowly; the R faces the reader at the still. */
  const turn = Number.isFinite(t) ? Math.cos(((loop - ENTER_AT) / 3_200) * Math.PI * 2) : 1;
  const width = 0.18 + 0.82 * Math.abs(turn);
  const grow = 0.6 + 0.4 * enter;
  return [
    ...stars(loop, enter),
    {
      group: [
        { group: coinBase(tone).slice(0, 1) },
        { group: coinBase(tone).slice(1), sx: width },
        { group: [brandR(118)], sx: width },
      ],
      x: 220,
      y: 196,
      sx: grow,
      sy: grow,
      opacity: enter,
    },
  ];
}

/** The figure of `mood` at `t` ms of the card's entrance (`Infinity` for the still), in its own box. */
export function moodScene(mood: Mood, t: number, tone: string): MoodNode[] {
  if (mood === "rocket" || mood === "moon") return rocket(t, mood === "moon", tone);
  if (mood === "coin") return buyCoin(t, tone);
  return crying(t, mood, tone);
}

/* ---------- SVG ---------- */

function isGroup(node: MoodNode): node is MoodGroup {
  return "group" in node;
}

function transformOf(node: MoodGroup): string {
  const parts: string[] = [];
  if (node.x || node.y) parts.push(`translate(${n(node.x ?? 0)} ${n(node.y ?? 0)})`);
  if (node.rotate) parts.push(`rotate(${n(node.rotate)})`);
  if ((node.sx ?? 1) !== 1 || (node.sy ?? 1) !== 1) parts.push(`scale(${n(node.sx ?? 1)} ${n(node.sy ?? 1)})`);
  return parts.join(" ");
}

/** The figure as an SVG document of the mood box. */
export function moodSvg(nodes: readonly MoodNode[]): string {
  const defs: string[] = [];
  const paint = (value: Paint | undefined): string => {
    if (value === undefined) return "none";
    if (typeof value === "string") return value;
    const id = `p${defs.length}`;
    const stops = value.stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join("");
    defs.push(
      "r" in value
        ? `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(value.cx)}" cy="${n(value.cy)}" r="${n(value.r)}">${stops}</radialGradient>`
        : `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(value.x1)}" y1="${n(value.y1)}" x2="${n(value.x2)}" y2="${n(value.y2)}">${stops}</linearGradient>`,
    );
    return `url(#${id})`;
  };
  const write = (node: MoodNode): string => {
    if (isGroup(node)) {
      const transform = transformOf(node);
      const attrs = `${transform ? ` transform="${transform}"` : ""}${node.opacity !== undefined && node.opacity < 1 ? ` opacity="${n(Math.max(0, node.opacity))}"` : ""}`;
      return `<g${attrs}>${node.group.map(write).join("")}</g>`;
    }
    const stroke = node.stroke === undefined ? "" : ` stroke="${paint(node.stroke)}" stroke-width="${node.width ?? 1}" stroke-linecap="round" stroke-linejoin="round"`;
    const opacity = node.opacity !== undefined && node.opacity < 1 ? ` opacity="${n(Math.max(0, node.opacity))}"` : "";
    return `<path d="${node.d}" fill="${paint(node.fill)}"${stroke}${opacity}/>`;
  };
  const body = nodes.map(write).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MOOD_BOX.width}" height="${MOOD_BOX.height}" viewBox="0 0 ${MOOD_BOX.width} ${MOOD_BOX.height}"><defs>${defs.join("")}</defs>${body}</svg>`;
}

/* ---------- canvas ---------- */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const PATHS = new Map<string, Path2D>();
function path2d(d: string): Path2D {
  let found = PATHS.get(d);
  if (!found) {
    found = new Path2D(d);
    if (PATHS.size > 4_000) PATHS.clear();
    PATHS.set(d, found);
  }
  return found;
}

function canvasPaint(ctx: Ctx, value: Paint): string | CanvasGradient {
  if (typeof value === "string") return value;
  const gradient = "r" in value ? ctx.createRadialGradient(value.cx, value.cy, 0, value.cx, value.cy, value.r) : ctx.createLinearGradient(value.x1, value.y1, value.x2, value.y2);
  for (const [offset, color] of value.stops) gradient.addColorStop(offset, color);
  return gradient;
}

/** The figure on a canvas, at the current transform (the mood box's origin). */
export function drawMood(ctx: Ctx, nodes: readonly MoodNode[]): void {
  const draw = (node: MoodNode) => {
    ctx.save();
    if (node.opacity !== undefined) ctx.globalAlpha *= Math.max(0, Math.min(1, node.opacity));
    if (isGroup(node)) {
      if (node.x || node.y) ctx.translate(node.x ?? 0, node.y ?? 0);
      if (node.rotate) ctx.rotate((node.rotate * Math.PI) / 180);
      if ((node.sx ?? 1) !== 1 || (node.sy ?? 1) !== 1) ctx.scale(node.sx ?? 1, node.sy ?? 1);
      node.group.forEach(draw);
    } else {
      const shape = path2d(node.d);
      if (node.fill !== undefined) {
        ctx.fillStyle = canvasPaint(ctx, node.fill);
        ctx.fill(shape);
      }
      if (node.stroke !== undefined) {
        ctx.strokeStyle = canvasPaint(ctx, node.stroke);
        ctx.lineWidth = node.width ?? 1;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke(shape);
      }
    }
    ctx.restore();
  };
  nodes.forEach(draw);
}

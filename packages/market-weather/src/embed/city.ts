/**
 * `<market-weather-city>`: the market's weather drawn as a city, for any web page or a phone's WebView (Seeker).
 *
 * One custom element, Canvas 2D, no dependencies. It draws a `MarketWeather` it is given three ways:
 *
 *   el.weather = weather;                                  // a property
 *   <market-weather-city src="/api/market-weather">        // a JSON file it reads (GET) every `refresh` seconds
 *   <market-weather-city listen>                           // messages { type: "market-weather", weather } from the host
 *                                                          // (the page itself or the frame that embeds it, no one else)
 *
 * Whatever arrives from outside the page passes `acceptWeather` first, and text is set with `textContent` only.
 * The element reads and draws; it has no wallet, signs nothing, and sends nothing anywhere.
 *
 * Tap a tower and a small card opens with its ticker, price, move and issuer badges; the element also raises
 * `market-weather-select` with the asset, so the host can open its own page. With reduced motion asked for, the city is
 * drawn still.
 */

import { ACCENT, acceptWeather, hash, layoutCity, towerAt } from "./layout.ts";
import type { Scene, SceneTower } from "./layout.ts";
import type { MarketWeather } from "../weather.ts";

const TONES: Readonly<Record<SceneTower["tone"], string>> = { up: ACCENT, down: "#8ea3c7", flat: "#d5d9e2", unknown: "#4a505d" };

type Drop = { x: number; y: number; v: number };
type Box = { x: number; y: number; w: number; h: number };

/** A tower as boxes: the shaft, and for a stepped crown a narrower top. Windows and outlines follow the boxes. */
function sections(scene: Scene, tower: SceneTower): Box[] {
  const top = scene.ground - tower.h;
  if (tower.crown !== "step" || tower.h < 60) return [{ x: tower.x, y: top, w: tower.w, h: tower.h }];
  const crown = Math.min(tower.h * 0.22, 70);
  const inset = tower.w * 0.16;
  return [
    { x: tower.x, y: top + crown, w: tower.w, h: tower.h - crown },
    { x: tower.x + inset, y: top, w: tower.w - inset * 2, h: crown },
  ];
}

/** The top of a tower's highest box, where its roof marks stand. */
const roofOf = (scene: Scene, tower: SceneTower): number => scene.ground - tower.h;

function windows(ctx: CanvasRenderingContext2D, tower: SceneTower, box: Box, part: number, t: number, motion: boolean): void {
  const cols = Math.max(2, Math.floor(box.w / 7));
  const rows = Math.max(1, Math.floor((box.h - 8) / 9));
  const gapX = box.w / cols;
  const lit = tower.tone === "unknown" ? 0.06 : tower.tone === "flat" ? 0.22 : 0.25 + 0.6 * tower.intensity;
  const colour = TONES[tower.tone];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const n = hash(tower.asset, r + part * 101, c);
      const flicker = motion && n > 0.985 ? 0.5 + 0.5 * Math.sin(t / 400 + n * 50) : 1;
      const on = n < lit;
      ctx.globalAlpha = on ? (0.55 + 0.4 * tower.intensity) * flicker : 0.05;
      ctx.fillStyle = on ? colour : "#ffffff";
      ctx.fillRect(box.x + gapX * c + gapX * 0.3, box.y + 6 + r * 9, Math.max(1.5, gapX * 0.4), 4);
    }
  }
  ctx.globalAlpha = 1;
}

function towerBody(ctx: CanvasRenderingContext2D, scene: Scene, tower: SceneTower, t: number, motion: boolean): void {
  if (tower.scaffold) {
    const top = scene.ground - tower.h;
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    ctx.fillRect(tower.x, top, tower.w, tower.h);
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(tower.x + 0.5, top + 0.5, tower.w - 1, tower.h - 1);
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    for (let y = top + 14; y < scene.ground; y += 14) {
      ctx.beginPath();
      ctx.moveTo(tower.x, y - 14);
      ctx.lineTo(tower.x + tower.w, y);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  sections(scene, tower).forEach((box, part) => {
    const glass = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y);
    glass.addColorStop(0, "#1b1f29");
    glass.addColorStop(0.5, "#12151c");
    glass.addColorStop(1, "#0b0d12");
    ctx.fillStyle = glass;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    /* A lit edge on the side that faces the glow. */
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(box.x, box.y, 1, box.h);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    windows(ctx, tower, box, part, t, motion);
    if (tower.tone === "up" || tower.tone === "down") {
      ctx.fillStyle = TONES[tower.tone];
      ctx.globalAlpha = (0.35 + 0.6 * tower.intensity) * (part === 0 && tower.crown === "step" ? 0.5 : 1);
      ctx.fillRect(box.x, box.y, box.w, 2);
      ctx.globalAlpha = 1;
    }
  });
}

function roof(ctx: CanvasRenderingContext2D, scene: Scene, tower: SceneTower, t: number): void {
  let top = roofOf(scene, tower);
  const cx = tower.x + tower.w / 2;
  if (tower.crown === "spire") {
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, top - 26);
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(t / 900));
    ctx.beginPath();
    ctx.arc(cx, top - 27, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    top -= 26;
  }
  if (tower.launch === "graduated") {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(tower.x + tower.w * 0.75, top);
    ctx.lineTo(tower.x + tower.w * 0.75, top - 12);
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.fillRect(tower.x + tower.w * 0.75 - 1.5, top - 14, 3, 3);
  } else if (tower.launch === "curve") {
    /* A crane: the launch is still being built on its curve. */
    ctx.strokeStyle = "rgba(255,104,28,0.6)";
    ctx.beginPath();
    ctx.moveTo(tower.x + 2, top);
    ctx.lineTo(tower.x + 2, top - 18);
    ctx.lineTo(tower.x + tower.w * 1.1, top - 18);
    ctx.moveTo(tower.x + tower.w * 0.9, top - 18);
    ctx.lineTo(tower.x + tower.w * 0.9, top - 8);
    ctx.stroke();
  }
  /* Issuer badges: mint left, freeze right. Revoked draws nothing: a clean roof is the good news. */
  const marks: Array<["mint" | "freeze", string]> = [
    ["mint", tower.badges.mint],
    ["freeze", tower.badges.freeze],
  ];
  const shown = marks.filter(([, state]) => state !== "revoked");
  shown.forEach(([kind, state], index) => {
    const x = cx + (shown.length === 1 ? 0 : index === 0 ? -7 : 7);
    const y = top - (tower.launch ? 26 : 10);
    ctx.lineWidth = 1.2;
    if (state === "not_measured") {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    if (state === "disputed") {
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "mint") {
      ctx.moveTo(x - 2.5, y);
      ctx.lineTo(x + 2.5, y);
      ctx.moveTo(x, y - 2.5);
      ctx.lineTo(x, y + 2.5);
      ctx.stroke();
    } else {
      for (let k = 0; k < 3; k += 1) {
        const a = (Math.PI / 3) * k;
        ctx.moveTo(x - Math.cos(a) * 2.8, y - Math.sin(a) * 2.8);
        ctx.lineTo(x + Math.cos(a) * 2.8, y + Math.sin(a) * 2.8);
      }
      ctx.stroke();
    }
  });
  ctx.lineWidth = 1;
}

/** The far city: a hazy back row with a few dim lights, for depth. Not data; the same on every frame. */
function backRow(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { width, ground } = scene;
  let x = -10;
  let i = 0;
  while (x < width) {
    const w = 18 + 34 * hash("far", i, 0);
    const h = ground * (0.12 + 0.36 * hash("far", i, 1) ** 1.6);
    ctx.fillStyle = "rgba(24,27,36,0.82)";
    ctx.fillRect(x, ground - h, w, h);
    ctx.fillStyle = scene.state === "sun" ? "rgba(255,150,90,0.18)" : "rgba(210,220,240,0.10)";
    for (let r = 0; r < h / 11; r += 1) {
      for (let c = 0; c < w / 8; c += 1) if (hash("far", i * 97 + r, c) < 0.1) ctx.fillRect(x + 3 + c * 8, ground - h + 5 + r * 11, 2, 3);
    }
    x += w + 3 + 10 * hash("far", i, 2);
    i += 1;
  }
}

/** Draw one frame. `t` is milliseconds; `drops` is the rain the caller keeps between frames. */
export function drawCity(ctx: CanvasRenderingContext2D, scene: Scene, t: number, drops: Drop[], selected: string | null, motion: boolean): void {
  const { width, height, ground, sky } = scene;
  const air = ctx.createLinearGradient(0, 0, 0, ground);
  air.addColorStop(0, sky.top);
  air.addColorStop(1, sky.bottom);
  ctx.fillStyle = air;
  ctx.fillRect(0, 0, width, ground);
  const glow = ctx.createRadialGradient(width / 2, ground, 0, width / 2, ground, Math.max(width, ground) * 0.75);
  glow.addColorStop(0, sky.glow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = sky.glowStrength;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, ground);
  ctx.globalAlpha = 1;
  if (scene.state === "clear" || scene.state === "sun") {
    for (let i = 0; i < 70; i += 1) {
      ctx.globalAlpha = 0.12 + 0.35 * hash("star", i, 1);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(hash("star", i, 2) * width, hash("star", i, 3) * ground * 0.55, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  backRow(ctx, scene);
  /* A haze between the far row and the near towers. */
  const haze = ctx.createLinearGradient(0, ground * 0.55, 0, ground);
  haze.addColorStop(0, "rgba(0,0,0,0)");
  haze.addColorStop(1, sky.bottom);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = haze;
  ctx.fillRect(0, ground * 0.55, width, ground * 0.45);
  ctx.globalAlpha = 1;
  /* Water. */
  const water = ctx.createLinearGradient(0, ground, 0, height);
  water.addColorStop(0, "#0c0e13");
  water.addColorStop(1, "#060709");
  ctx.fillStyle = water;
  ctx.fillRect(0, ground, width, height - ground);
  /* Reflection, then the towers. */
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, ground, width, height - ground);
  ctx.clip();
  ctx.translate(0, ground * 2);
  ctx.scale(1, -1);
  ctx.globalAlpha = 0.16;
  for (const tower of scene.towers) towerBody(ctx, scene, tower, t, false);
  ctx.restore();
  const fade = ctx.createLinearGradient(0, ground, 0, height);
  fade.addColorStop(0, "rgba(6,7,9,0.1)");
  fade.addColorStop(1, "rgba(6,7,9,0.95)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, ground, width, height - ground);
  for (const tower of scene.towers) towerBody(ctx, scene, tower, t, motion);
  for (const tower of scene.towers) roof(ctx, scene, tower, motion ? t : 0);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, ground, width, 1);
  const chosen = scene.towers.find((tower) => tower.asset === selected);
  if (chosen) {
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    for (const box of sections(scene, chosen)) ctx.strokeRect(box.x - 1, box.y - 1, box.w + 2, box.h + 1);
    ctx.lineWidth = 1;
  }
  /* Weather over the city. */
  if (scene.rain > 0) {
    const want = Math.round(160 * scene.rain);
    while (drops.length < want) drops.push({ x: Math.random() * width, y: Math.random() * height, v: 0.5 + Math.random() * 0.6 });
    drops.length = want;
    ctx.strokeStyle = "rgba(190,205,230,0.28)";
    ctx.beginPath();
    for (const drop of drops) {
      if (motion) {
        drop.y += 9 * drop.v;
        drop.x -= 2 * drop.v;
        if (drop.y > height) {
          drop.y = -10;
          drop.x = Math.random() * width * 1.1;
        }
      }
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x + 3, drop.y - 11);
    }
    ctx.stroke();
  }
  if (scene.lightning && motion && t % 7000 < 110) {
    ctx.fillStyle = "rgba(220,215,255,0.13)";
    ctx.fillRect(0, 0, width, height);
  }
  if (scene.fog > 0) {
    for (let band = 0; band < 4; band += 1) {
      const y = ground - ground * 0.12 * band;
      const drift = motion ? Math.sin(t / 5000 + band) * width * 0.05 : 0;
      const mist = ctx.createLinearGradient(0, y - 60, 0, y + 30);
      mist.addColorStop(0, "rgba(200,204,212,0)");
      mist.addColorStop(0.6, `rgba(200,204,212,${0.22 * scene.fog})`);
      mist.addColorStop(1, "rgba(200,204,212,0)");
      ctx.fillStyle = mist;
      ctx.fillRect(drift - width * 0.1, y - 60, width * 1.2, 90);
    }
  }
}

const STYLE = `
:host { display: block; position: relative; overflow: hidden; background: #0a0b0e; aspect-ratio: 16 / 10; border-radius: 16px;
  font-family: Geist, "Geist Sans", Inter, system-ui, -apple-system, sans-serif; color: #f2f3f5; -webkit-tap-highlight-color: transparent; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; }
.pill { position: absolute; top: 12px; left: 12px; padding: 6px 12px; border-radius: 999px; font-size: 12px; letter-spacing: .02em;
  background: rgba(20,22,28,.62); border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.pill[hidden], .card[hidden] { display: none; }
.pill i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${ACCENT}; margin-right: 8px; vertical-align: 1px; }
.card { position: absolute; left: 12px; right: 12px; bottom: 12px; max-width: 320px; padding: 14px 16px; border-radius: 14px;
  background: rgba(16,18,24,.72); border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
.card b { display: block; font-size: 13px; font-weight: 500; opacity: .72; }
.card strong { display: block; font-size: 26px; font-weight: 600; margin: 2px 0 6px; font-variant-numeric: tabular-nums; }
.card .move { font-size: 13px; font-variant-numeric: tabular-nums; }
.card .up { color: ${ACCENT}; } .card .down { color: #8ea3c7; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chips span { font-size: 11px; padding: 4px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); opacity: .85; }
.chips span.warn { border-color: rgba(255,104,28,.6); color: ${ACCENT}; opacity: 1; }
`;

const money = (value: number): string =>
  value >= 1 ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${value.toPrecision(3)}`;

const BADGE_WORDS = {
  mint: { active: "Can mint more", disputed: "Mint authority disputed", not_measured: "Mint authority not measured", revoked: "Mint revoked" },
  freeze: { active: "Can freeze", disputed: "Freeze authority disputed", not_measured: "Freeze authority not measured", revoked: "Freeze revoked" },
} as const;

/** Define `<market-weather-city>` once. Safe to call more than once and on a server, where it does nothing. */
export function defineMarketWeatherCity(tag = "market-weather-city"): void {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;

  class MarketWeatherCity extends HTMLElement {
    static get observedAttributes(): string[] {
      return ["src", "refresh", "listen"];
    }
    #weather: MarketWeather | null = null;
    #scene: Scene | null = null;
    #canvas: HTMLCanvasElement;
    #pill: HTMLDivElement;
    #card: HTMLDivElement;
    #drops: Drop[] = [];
    #selected: string | null = null;
    #frame = 0;
    #last = 0;
    #timer: ReturnType<typeof setInterval> | null = null;
    #clock: ReturnType<typeof setInterval> | null = null;
    #resize: ResizeObserver | null = null;
    #visible = true;
    #motion = true;
    #onMessage = (event: MessageEvent): void => {
      /* Only the page itself (a WebView host injecting a message) or the frame that embeds it may set the weather. */
      if (event.source !== window && (window.parent === window || event.source !== window.parent)) return;
      const data = event.data as { type?: unknown; weather?: unknown } | null;
      if (data && data.type === "market-weather") this.weather = acceptWeather(data.weather);
    };

    constructor() {
      super();
      const root = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = STYLE;
      this.#canvas = document.createElement("canvas");
      this.#pill = document.createElement("div");
      this.#pill.className = "pill";
      this.#pill.hidden = true;
      this.#card = document.createElement("div");
      this.#card.className = "card";
      this.#card.hidden = true;
      root.append(style, this.#canvas, this.#pill, this.#card);
      this.#canvas.addEventListener("click", (event) => this.#tap(event));
    }

    get weather(): MarketWeather | null {
      return this.#weather;
    }

    set weather(value: MarketWeather | null) {
      this.#weather = value ? acceptWeather(value) : null;
      this.#layout();
    }

    connectedCallback(): void {
      this.#motion = !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
      this.#resize = new ResizeObserver(() => this.#layout());
      this.#resize.observe(this);
      document.addEventListener("visibilitychange", this.#wake);
      this.#configure();
      /* Re-judge the sky's age every 15 s: a feed that stops turns the city to fog on its own. */
      this.#clock = setInterval(() => this.#layout(), 15_000);
      this.#loop(0);
    }

    disconnectedCallback(): void {
      cancelAnimationFrame(this.#frame);
      this.#resize?.disconnect();
      document.removeEventListener("visibilitychange", this.#wake);
      window.removeEventListener("message", this.#onMessage);
      if (this.#timer) clearInterval(this.#timer);
      if (this.#clock) clearInterval(this.#clock);
    }

    attributeChangedCallback(): void {
      if (this.isConnected) this.#configure();
    }

    #wake = (): void => {
      this.#visible = document.visibilityState !== "hidden";
    };

    #configure(): void {
      window.removeEventListener("message", this.#onMessage);
      if (this.hasAttribute("listen")) window.addEventListener("message", this.#onMessage);
      if (this.#timer) clearInterval(this.#timer);
      this.#timer = null;
      const src = this.getAttribute("src");
      if (!src) return;
      const seconds = Math.max(15, Number(this.getAttribute("refresh")) || 60);
      const read = (): void => {
        fetch(src, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin" })
          .then((response) => (response.ok ? response.json() : null))
          .then((body: unknown) => {
            if (body) this.weather = acceptWeather(body);
          })
          .catch(() => undefined);
      };
      read();
      this.#timer = setInterval(read, seconds * 1000);
    }

    #layout(): void {
      const box = this.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.#canvas.width = Math.max(1, Math.round(box.width * dpr));
      this.#canvas.height = Math.max(1, Math.round(box.height * dpr));
      this.#scene = this.#weather ? layoutCity(this.#weather, { width: box.width, height: box.height, now: Date.now() }) : null;
      const pill = this.#scene?.delayed ? "Data delayed" : this.#scene?.state === "not_measured" ? "Not measured" : null;
      this.#pill.hidden = pill === null;
      this.#pill.replaceChildren(document.createElement("i"), document.createTextNode(pill ?? ""));
      if (this.#selected && !this.#scene?.towers.some((tower) => tower.asset === this.#selected)) this.#close();
      this.#draw(performance.now());
    }

    #draw(t: number): void {
      const ctx = this.#canvas.getContext("2d");
      if (!ctx) return;
      const dpr = this.#canvas.width / Math.max(1, this.getBoundingClientRect().width);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!this.#scene) {
        ctx.fillStyle = "#0a0b0e";
        ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
        return;
      }
      drawCity(ctx, this.#scene, t, this.#drops, this.#selected, this.#motion);
    }

    #loop = (t: number): void => {
      this.#frame = requestAnimationFrame(this.#loop);
      if (!this.#motion || !this.#visible || !this.#scene) return;
      /* 30 frames a second in rain and fog, 12 in still air: a phone's battery is part of the design. */
      const busy = this.#scene.rain > 0 || this.#scene.fog > 0;
      if (t - this.#last < (busy ? 33 : 83)) return;
      this.#last = t;
      this.#draw(t);
    };

    #tap(event: MouseEvent): void {
      if (!this.#scene) return;
      const box = this.#canvas.getBoundingClientRect();
      const tower = towerAt(this.#scene, event.clientX - box.left, event.clientY - box.top);
      if (!tower || tower.asset === this.#selected) return this.#close();
      this.#selected = tower.asset;
      this.#open(tower);
      this.dispatchEvent(new CustomEvent("market-weather-select", { detail: { asset: tower.asset }, bubbles: true, composed: true }));
    }

    #open(tower: SceneTower): void {
      const name = document.createElement("b");
      name.textContent = tower.label ?? "Unverified token";
      const price = document.createElement("strong");
      price.textContent = tower.priceUsd === null ? "Not measured" : money(tower.priceUsd);
      const parts: Node[] = [name, price];
      if (tower.changePct !== null) {
        const move = document.createElement("div");
        move.className = `move ${tower.changePct >= 0 ? "up" : "down"}`;
        move.textContent = `${tower.changePct >= 0 ? "+" : ""}${tower.changePct.toFixed(2)}% · 24h`;
        parts.push(move);
      }
      const chips = document.createElement("div");
      chips.className = "chips";
      for (const kind of ["mint", "freeze"] as const) {
        const state = tower.badges[kind];
        const chip = document.createElement("span");
        if (state === "active" || state === "disputed") chip.className = "warn";
        chip.textContent = BADGE_WORDS[kind][state];
        chips.append(chip);
      }
      parts.push(chips);
      this.#card.replaceChildren(...parts);
      this.#card.hidden = false;
      this.#draw(performance.now());
    }

    #close(): void {
      this.#selected = null;
      this.#card.hidden = true;
      this.#draw(performance.now());
    }
  }

  customElements.define(tag, MarketWeatherCity);
}

/*
 * Ryntra Launch — Control Room (concept B, MC-0, decision 68): a mission's own page. The night control room looks
 * through its giant window at that mission's launch pad; consoles, a countdown board, two tall telemetry screens
 * and a holo-table orbit map around it. Ported from docs/research/ryntra-launch-2026-10-25/concepts/control-room.html.
 *
 * LIVE draws only what `setSnapshot` / `emit` carry, for the mission named by `options.focusId`; `playDemo` runs the
 * concept's own seeded show ($MOTH, T-10, liftoff through the window, ORBIT and crew shares) and says DEMO.
 * Never the two at once.
 */
import * as THREE from "three-r147";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const ROOT_CLASS = "mc-control-room";
const TEST_TITLE = "Ryntra's own launch — technical validation, not demand";
/* MC-2: a crew of 2–5 shares the creator's fees on chain (Meteora Dynamic Fee Sharing), each member by their own yes. */
const CREW_LINE = "A crew of 2–5 shares the creator's fees on chain.";

/* ------------------------------ small helpers (the concept's) ------------------------------ */
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sat = (x) => clamp(x, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const eOut = (t) => { t = sat(t); return 1 - Math.pow(1 - t, 3); };
const eInOut = (t) => { t = sat(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (v) => "$" + nf0.format(Math.round(v));
const usd2 = (v) => "$" + nf2.format(v);
const kusd = (v) => (v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "k" : "$" + Math.round(v));
const p2 = (n) => (n < 10 ? "0" : "") + n;
const hms = (s) => { s = Math.max(0, Math.ceil(s - 1e-6)); return p2(Math.floor(s / 3600)) + ":" + p2(Math.floor(s / 60) % 60) + ":" + p2(s % 60); };
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const isNum = (v) => typeof v === "number" && isFinite(v);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
const B58 = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789";
function wallet(r) { let s = ""; for (let i = 0; i < 4; i++) s += B58[Math.floor(r() * 58)]; s += "…"; for (let j = 0; j < 3; j++) s += B58[Math.floor(r() * 58)]; return s; }
function rmItem(arr, x) { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); }
function shortSig(s) { return typeof s === "string" && s.length > 9 ? s.slice(0, 4) + "…" + s.slice(-3) : (s || ""); }
const CHECK_DAYS = [7, 30, 90];

const ICON_REPLAY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8"/><path d="M2.6 2.2v2.6h2.6"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3.2v9.6L12.6 8z"/></svg>';
const ICON_LIVE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2"/><path d="M4.6 4.6a4.8 4.8 0 0 0 0 6.8M11.4 4.6a4.8 4.8 0 0 1 0 6.8"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6h2.4l3.3-2.7v9.4L4.9 10H2.5z"/><path data-cr="sndX" d="M10.6 6.2l3.4 3.6M14 6.2l-3.4 3.6"/><path data-cr="sndW" d="M10.7 5.6a3.4 3.4 0 0 1 0 4.8M12.4 4a5.6 5.6 0 0 1 0 8" style="display:none"/></svg>';

const TEMPLATE = `
<canvas class="cr-gl" data-cr="gl" aria-hidden="true"></canvas>
<div class="cr-veil" aria-hidden="true"></div>
<header class="cr-top">
  <div class="cr-brand"><img class="cr-word" src="/brand/ryntra-wordmark-dark.svg" alt="Ryntra" width="83" height="21"><span class="cr-ltag">LAUNCH</span></div>
  <a class="cr-back cr-glass" href="/" data-only="live">← Back to sky</a>
  <div class="cr-mission" data-only="live"><span class="cr-mtk" data-cr="mTk">—</span><span class="cr-mname" data-cr="mName"></span><span class="cr-test" data-cr="mTest" hidden title="${TEST_TITLE}">RYNTRA TEST</span></div>
  <span class="cr-pill cr-live cr-glass"><i class="cr-livedot"></i><span data-cr="livePill">LIVE</span></span>
  <div class="cr-stats" data-only="live" aria-label="Mission numbers">
    <div class="cr-stat"><span class="cr-k">ALTITUDE</span><span class="cr-v" data-cr="lAlt">—</span></div>
    <div class="cr-stat"><span class="cr-k">HOLDERS</span><span class="cr-v" data-cr="lHold">—</span></div>
    <div class="cr-stat cr-opt2"><span class="cr-k">DAY</span><span class="cr-v" data-cr="lDay">—</span></div>
    <div class="cr-stat cr-opt"><span class="cr-k">IN FLIGHT</span><span class="cr-v" data-cr="lSky">—</span></div>
  </div>
  <div class="cr-stats" data-only="demo" aria-label="Live numbers">
    <div class="cr-stat"><span class="cr-k">NEXT WINDOW</span><span class="cr-v" data-cr="sNext">00:00:18</span></div>
    <div class="cr-stat"><span class="cr-k">IN FLIGHT</span><span class="cr-v" data-cr="sFlight">7</span></div>
    <div class="cr-stat cr-opt2"><span class="cr-k">IN ORBIT</span><span class="cr-v" data-cr="sOrbit">23</span></div>
    <div class="cr-stat cr-opt"><span class="cr-k">CREATOR FEES</span><span class="cr-v cr-gold" data-cr="sPaid">$4,812</span></div>
  </div>
  <div class="cr-actions">
    <button class="cr-tbtn cr-glass" type="button" data-cr="btnOrbitReplay" data-only="live" hidden aria-label="Replay orbit insertion">${ICON_REPLAY}<span class="cr-long">Replay orbit insertion</span><span class="cr-short" aria-hidden="true">Replay</span></button>
    <button class="cr-tbtn cr-glass" type="button" data-cr="btnDemo" data-only="live" aria-label="Watch the demo">${ICON_PLAY}<span class="cr-long">Watch the demo</span><span class="cr-short" aria-hidden="true">Demo</span></button>
    <button class="cr-tbtn cr-glass" type="button" data-cr="btnReplay" data-only="demo" aria-label="Replay liftoff">${ICON_REPLAY}<span class="cr-long">Replay liftoff</span><span class="cr-short" aria-hidden="true">Replay</span></button>
    <button class="cr-tbtn cr-glass" type="button" data-cr="btnLive" data-only="demo" aria-label="Back to live">${ICON_LIVE}<span class="cr-long">Back to live</span><span class="cr-short" aria-hidden="true">Live</span></button>
    <button class="cr-tbtn cr-glass" type="button" data-cr="btnSound" aria-pressed="false" aria-label="Sound off">${ICON_SOUND}<span class="cr-long" data-cr="sndLbl">SOUND OFF</span><span class="cr-short" data-cr="sndLblS" aria-hidden="true">OFF</span></button>
  </div>
</header>
<div class="cr-pill cr-demo cr-glass" role="note" data-only="demo"><b>DEMO</b> · simulated flights · no real tokens</div>
<section class="cr-hero" data-only="live" aria-label="Mission">
  <div class="cr-eyebrow"><i></i><span data-cr="hEye">Control room</span><span class="cr-test" data-cr="hTest" hidden title="${TEST_TITLE}">RYNTRA TEST</span></div>
  <h1 data-cr="hTitle" class="cr-h1-sm">Reading the chain…</h1>
  <p data-cr="hText">Mission control is reading this mission from the chain.</p>
  <div class="cr-cta" data-cr="hCta"></div>
</section>
<section class="cr-hero" data-only="demo" aria-label="Demo">
  <div class="cr-eyebrow"><i></i>Mission control · window 21:00 UTC</div>
  <h1>LAUNCH IS JUST THE BEGINNING.</h1>
  <p>Every token on Ryntra is a mission: a crew, a ship, a public flight to orbit and a 90-day course checked on chain at days 7, 30 and 90.</p>
  <div class="cr-cta">
    <button class="cr-btn cr-btn-ghost" data-cr="btnWatch" type="button">Watch Launch Night</button>
  </div>
</section>
<aside class="cr-queue cr-glass" data-only="live" aria-label="Crew">
  <div class="cr-qhead"><div><div class="cr-k">Crew</div><div class="cr-qsub cr-qsub-keep">${CREW_LINE}</div></div></div>
  <ol class="cr-qlist" data-cr="crewList"></ol>
</aside>
<aside class="cr-queue cr-glass" data-only="demo" aria-label="Tonight's window">
  <div class="cr-qhead">
    <div><div class="cr-k">Tonight's window</div><div class="cr-qsub" data-cr="qSub">6 missions · fair start · lift off together</div></div>
    <div class="cr-qwin">21:00 UTC</div>
  </div>
  <ol class="cr-qlist" data-cr="qList"></ol>
  <button class="cr-btn cr-btn-ghost cr-btn-call" data-cr="btnCall" type="button">Make a flight call</button>
</aside>
<div class="cr-feed cr-glass">
  <div class="cr-lbl"><i class="cr-livedot"></i>LIVE FEED</div>
  <div class="cr-track-wrap"><div class="cr-track" data-cr="track"></div></div>
</div>
<section class="cr-fallback cr-glass" data-cr="fallback" hidden aria-label="Live board">
  <p class="cr-fb-k">3D needs WebGL — here is the live board</p>
  <div class="cr-fb-board">
    <div class="cr-fb-row"><span data-cr="fbA"></span><span data-cr="fbB"></span></div>
    <div class="cr-fb-count" data-cr="fbCount"></div>
    <div class="cr-fb-alt" data-cr="fbAlt"></div>
  </div>
</section>
<div class="cr-card cr-glass" data-cr="card" hidden role="dialog" aria-label="Mission on the orbit map"></div>
<div class="cr-evt" data-cr="evt" aria-hidden="true"><div class="cr-evt-title" data-cr="evtTitle"></div><div class="cr-evt-sub" data-cr="evtSub"></div></div>
<div class="cr-payout" data-cr="payout" aria-hidden="true"><span class="cr-amt" data-cr="payAmt"></span><span class="cr-to" data-cr="payTo"></span></div>
<div class="cr-toast cr-glass" data-cr="toast" role="status" aria-live="polite"></div>
<div class="cr-sr" data-cr="srLive" aria-live="polite"></div>
<div class="cr-cut" data-cr="cut" aria-hidden="true"></div>
`;

/** @type {import("../types").MountScene} */
export function mount(root, options) {
  const opts = options || {};
  const D = document, W = window;
  const RM = !!opts.reducedMotion;
  const MIN_FPS = isNum(opts.minFps) ? opts.minFps : 30;
  const MAX_PR = isNum(opts.maxPixelRatio) ? opts.maxPixelRatio : 1.75;
  const FOCUS = typeof opts.focusId === "string" && opts.focusId ? opts.focusId : null;
  const call = (name, a, b) => { const f = opts[name]; if (typeof f === "function") { try { f(a, b); } catch { /* the page's handler */ } } };

  /* everything this engine adds, so dispose() can take it all back */
  let disposed = false;
  const offs = [];
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); offs.push(() => target.removeEventListener(type, fn, o)); };
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms); timers.add(id); return id; };
  const cancel = (id) => { if (id) { clearTimeout(id); timers.delete(id); } };

  let QS; try { QS = new URLSearchParams(W.location.search); } catch { QS = { get: () => null }; }
  const COARSE = W.matchMedia ? W.matchMedia("(pointer: coarse)").matches : false;
  const STACKED = W.matchMedia ? W.matchMedia("(max-width:760px), (max-aspect-ratio:4/5)") : { matches: false };
  const clock = { T: 0 };

  const hadClass = root.classList.contains(ROOT_CLASS);
  root.classList.add(ROOT_CLASS);
  if (RM) root.classList.add("is-rm");
  const layer = D.createElement("div");
  layer.className = "cr-layer";
  layer.innerHTML = TEMPLATE;
  root.appendChild(layer);
  const $ = (name) => layer.querySelector('[data-cr="' + name + '"]');
  const view = { w: Math.max(1, root.clientWidth), h: Math.max(1, root.clientHeight) };

  /* canvas fonts: the app's Geist through its CSS variables, the concept's stack after it */
  const cssVar = (n) => { try { return getComputedStyle(root).getPropertyValue(n).trim(); } catch { return ""; } };
  const gSans = cssVar("--font-geist-sans"), gMono = cssVar("--font-geist-mono");
  const MONO = (gMono ? gMono + ", " : "") + '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  const SANS = (gSans ? gSans + ", " : "") + '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif';

  /* ============================== DEMO SIMULATOR (the concept's, seeded) ============================== */
  const GRAD = 15454, PAYOUT = 123.64, PACE = 1.5;
  const PRE = 8;                 // seconds after the demo starts when the T-10 countdown starts
  const WIN_UTC = 21 * 3600;     // tonight's window opens 21:00 UTC
  const NAMES = ["Ives", "Tamsin", "Rafe O.", "Noor", "Kai T.", "Sol B.", "Ada P.", "Wren", "Pell", "Ilse M.", "Bo", "Cass D.", "Yara", "Emil S.", "Fen", "Lio", "Remy", "Hana", "Dov", "Asa", "Nell", "Teo", "Rune K.", "Vik"];
  const SPLITS = { 2: [60, 40], 3: [40, 35, 25], 4: [35, 25, 25, 15], 5: [30, 20, 20, 15, 15] };
  const AVC = ["#F5F7FA", "#D6E6FF", "#9FD4FF", "#5CBDFF", "#F5B544", "#FFC7A1", "#B9C6D6", "#E8DCC8"];
  const SEED = 20261025;
  const MOTH_PAY = [43.27, 30.91, 30.91, 18.55]; // 35/25/25/15 of +$123.64
  const mcapOf = (alt) => 5000 * Math.pow(15, clamp(alt, 0, 1));
  let rng = mulberry32(SEED);
  const rnd = (a, b) => a + (b - a) * rng();
  const pick = (a) => a[Math.floor(rng() * a.length)];
  function pushHist(m, v) { m.hist.push(v); if (m.hist.length > 64) m.hist.shift(); }

  let mid = 0;
  function mission(tk, n, state, alt, names) {
    const crew = [], used = {};
    for (let i = 0; i < n; i++) {
      let nm = names ? names[i] : null;
      while (!nm || used[nm]) nm = pick(NAMES);
      used[nm] = 1;
      crew.push({ name: nm, split: SPLITS[n][i], color: AVC[(mid * 3 + i * 2 + 1) % AVC.length] });
    }
    const m = { id: mid++, tk: tk, crew: crew, n: n, state: state, alt: alt || 0, holders: Math.round(30 + (alt || 0) * 420 + rnd(0, 50)),
      calls: Math.round(rnd(90, 420)), power: Math.round(rnd(58, 92)), ang: rng() * Math.PI * 2, day: 0, hist: [],
      mcap: 0, pool: 0, warm: 0, lostT: 0, liftT: -1, flash: 0, flashCol: 0, halo: 0 };
    m.mcap = mcapOf(m.alt);
    let a = Math.max(0, m.alt - rnd(0.08, 0.25));
    for (let k = 0; k < 48; k++) { a = clamp(a + (m.alt - a) * 0.08 + rnd(-0.006, 0.01), 0, 1); m.hist.push(a); }
    return m;
  }
  function buildScript(seed) {
    const r = mulberry32(seed), N = 430, raw = []; let sum = 0, i;
    for (i = 0; i < N; i++) { const x = 6 + 894 * Math.pow(r(), 9); raw.push(x); sum += x; }
    const amts = raw.map((x) => clamp(Math.round(x / sum * GRAD), 5, 900));
    let tot = amts.reduce((a, b) => a + b, 0), diff = GRAD - tot, guard = 0;
    while (diff !== 0 && guard++ < 200000) { const j = Math.floor(r() * N), st = diff > 0 ? 1 : -1; if (amts[j] + st >= 5 && amts[j] + st <= 900) { amts[j] += st; diff -= st; } }
    const repeat = {}; for (i = 0; i < 18; i++) repeat[60 + Math.floor(r() * (N - 61))] = 1;
    const out = []; let cum = 0, holders = 0;
    for (i = 0; i < N; i++) {
      cum += amts[i]; if (!repeat[i]) holders++;
      out.push({ t: 0.25 + 11.75 * Math.pow((i + 1) / N, 0.72), amt: amts[i], cum: cum, holders: Math.min(412, holders), w: wallet(r) });
    }
    out[N - 1].t = 12; out[N - 1].cum = GRAD; out[N - 1].holders = 412;
    return out;
  }

  /* the whole DEMO world, rebuilt from the seed every time the demo starts — the same show every time */
  const demo = { on: false };
  let WIN = [], MOTH = null, sim = null;
  let Show = { state: "off", start: 0, t0: 0, replay: false, e: -99, script: [], i: 0, sec: 11, flags: {}, alt: 0, hold: 0, lastFeed: -9, altHist: [] };
  function makeDemoWorld() {
    rng = mulberry32(SEED); mid = 0;
    WIN = [
      mission("MOTH", 4, "queued", 0, ["Mira K.", "Oto", "Lea V.", "Juno R."]),
      mission("EMBER", 3, "queued", 0), mission("HALO", 2, "queued", 0), mission("PIXEL", 5, "queued", 0),
      mission("ORCA", 3, "queued", 0), mission("FERN", 4, "queued", 0)
    ];
    MOTH = WIN[0];
    MOTH.calls = 312; MOTH.holders = 0; MOTH.power = 78; MOTH.hist = [];
    for (let wi = 0; wi < WIN.length; wi++) { WIN[wi].holders = 0; WIN[wi].hist = []; WIN[wi].ang = -0.5 + wi * 0.38; }
    sim = { t: 0, nextTrade: 0.8, nextCheck: 13, nextCall: 5.5, checks: 0, paid: 4812, flight: [], orbit: [], stars: [], lost: [], tape: [], viewerCalls: 0 };
    [["KITE", 0.63], ["NOVA", 0.88], ["LUMEN", 0.55], ["QUILL", 0.12], ["RIVET", 0.71], ["SABLE", 0.34], ["GLINT", 0.47]].forEach((d) => {
      sim.flight.push(mission(d[0], 2 + Math.floor(rng() * 4), "flight", d[1]));
    });
    ["TIDE", "ZINC", "VELA", "ONYX", "AERO", "COMET", "DRIFT", "MOSS", "OPAL", "WISP", "BRAM", "CRUX", "DUNE", "ECHO", "FLINT", "GALE", "HAZE", "IRIS", "JADE", "LARK", "MESA", "PRISM", "RUNE"].forEach((tk, i) => {
      const m = mission(tk, 2 + Math.floor(rng() * 4), "orbit", 1);
      m.day = tk === "TIDE" ? 6 : tk === "ZINC" ? 29 : 1 + Math.floor(rng() * 88);
      m.pool = 75000 * rnd(0.7, 2.6); m.mcap = m.pool; m.ang = (i / 23) * Math.PI * 2 + rnd(-0.08, 0.08);
      m.hist = []; for (let k = 0; k < 48; k++) m.hist.push(rnd(0.6, 1));
      sim.orbit.push(m);
    });
    Show = { state: "pre", start: clock.T + PRE, t0: clock.T + PRE + 10, replay: false, e: -PRE, script: buildScript(SEED ^ 0x5eed), i: 0, sec: 11, flags: {}, alt: 0, hold: 0, lastFeed: -9, altHist: [] };
  }
  function findTk(tk) { const all = sim.orbit.concat(sim.flight, WIN); for (let i = 0; i < all.length; i++) if (all[i].tk === tk) return all[i]; return null; }

  /* the DEMO event bus (the concept's) — never fed by live data */
  const demoListeners = [];
  const onDemo = (f) => { demoListeners.push(f); };
  function demoEmit(e) { e.T = clock.T; for (let i = 0; i < demoListeners.length; i++) demoListeners[i](e); }

  function tapePush(m, buy, amt, w) { sim.tape.unshift({ tk: m.tk, buy: buy, amt: amt, w: w, T: clock.T, own: m === MOTH }); if (sim.tape.length > 24) sim.tape.pop(); }
  function simTrade() {
    const busy = Show.state === "run" && !Show.flags.orbit;
    const fl = sim.flight.filter((m) => !(busy && m === MOTH));
    const useFlight = fl.length > 0 && (rng() < 0.8 || !sim.orbit.length);
    const m = useFlight ? pick(fl) : pick(sim.orbit);
    if (!m) return;
    const buy = rng() < (useFlight ? 0.73 : 0.6);
    const amt = buy ? Math.round(5 + 895 * Math.pow(rng(), 2.6)) : Math.round(5 + 380 * Math.pow(rng(), 2.2));
    if (useFlight) {
      m.alt = clamp(m.alt + (buy ? 1 : -1) * amt / GRAD * PACE, 0.01, 1);
      m.mcap = mcapOf(m.alt);
      if (buy && rng() < 0.45) m.holders++;
      pushHist(m, m.alt);
    } else {
      m.pool = Math.max(30000, m.pool * (1 + (buy ? 1 : -1) * amt / 52000));
      m.mcap = m.pool; pushHist(m, m.pool / 75000);
    }
    const w = wallet(rng);
    tapePush(m, buy, amt, w);
    demoEmit({ type: buy ? "buy" : "sell", m: m, amt: amt, alt: m.alt, orbit: !useFlight, w: w });
    if (useFlight && m.alt >= 1) simOrbit(m);
  }
  function simOrbit(m) {
    m.state = "orbit"; m.alt = 1; m.day = 0; m.pool = 75000; m.mcap = 75000; m.warm = 1;
    rmItem(sim.flight, m); sim.orbit.push(m); sim.paid += PAYOUT;
    demoEmit({ type: "orbit", m: m, amt: PAYOUT });
  }
  function simCheck() {
    sim.checks++;
    let m, lost = false;
    if (sim.checks === 1) m = findTk("TIDE");
    else if (sim.checks === 2) { m = findTk("ZINC"); lost = true; }
    else { m = pick(sim.orbit.filter((x) => x !== MOTH)); lost = rng() < 0.1; }
    if (!m || m.state !== "orbit") return;
    const next = m.day < 7 ? 7 : m.day < 30 ? 30 : 90;
    m.day = next;
    if (lost) {
      m.state = "lost"; m.lostT = clock.T; rmItem(sim.orbit, m); sim.lost.push(m);
      demoEmit({ type: "lost", m: m, day: next, reason: "liquidity under floor" });
      return;
    }
    /* A check pays nothing in the demo: money for surviving is the Orbit Bonus — MC-3, after the lawyer and the operator's rates. */
    if (next === 90) { m.state = "star"; rmItem(sim.orbit, m); sim.stars.push(m); demoEmit({ type: "star", m: m }); }
    else demoEmit({ type: "check", m: m, day: next });
  }
  function simCall(viewerMission) {
    let m = viewerMission;
    if (!m) { const c = WIN.filter((x) => x.state === "queued" || x.state === "flight"); m = pick(c.length ? c : sim.flight); }
    if (!m) return;
    m.calls++;
    demoEmit({ type: "call", m: m, calls: m.calls, viewer: !!viewerMission });
  }
  function simUpdate(dt) {
    sim.t += dt;
    if (sim.t >= sim.nextTrade) { simTrade(); sim.nextTrade = sim.t + rnd(0.55, 1.7); }
    if (sim.t >= sim.nextCheck) { simCheck(); sim.nextCheck = sim.t + (sim.checks === 1 ? 33 : rnd(16, 28)); }
    if (sim.t >= sim.nextCall) { simCall(null); sim.nextCall = sim.t + rnd(5, 11); }
  }

  /* ------------------------------ THE SHOW (the concept's central event) ------------------------------ */
  function showBegin(replay) {
    if (!replay && Show.state === "pre") { Show.t0 = clock.T + 10; }
    Show.state = "run"; Show.replay = replay; Show.start = clock.T; Show.e = 0; Show.i = 0; Show.sec = 11;
    Show.flags = replay ? { replayOf: true } : {}; Show.alt = 0; Show.hold = 0; Show.lastFeed = -9; Show.altHist = [0];
    root.classList.add("in-event");
    demoEmit({ type: "count", m: MOTH, replay: replay });
  }
  function showUpdate() {
    if (Show.state === "pre") { Show.e = clock.T - Show.start; if (clock.T >= Show.start) showBegin(false); return; }
    const e = Show.e = clock.T - Show.start;
    if (Show.state !== "run") return;
    if (e < 10) { const s = 10 - Math.floor(e); if (s !== Show.sec) { Show.sec = s; demoEmit({ type: "tick", n: s, m: MOTH, replay: Show.replay }); } }
    if (!Show.flags.lift && e >= 10) { Show.flags.lift = true; doLiftoff(); }
    while (Show.i < Show.script.length && e >= 10 + Show.script[Show.i].t) doScriptBuy(Show.script[Show.i++]);
    if (!Show.flags.orbit && e >= 22) { Show.flags.orbit = true; doShowOrbit(); }
    if (e >= 34) { Show.state = "done"; root.classList.remove("in-event"); demoEmit({ type: "showdone", replay: Show.replay }); }
  }
  function liftWindow() {
    WIN.forEach((m) => { if (m.state === "queued") { m.state = "flight"; m.alt = 0; m.mcap = 5000; m.liftT = clock.T; m.holders = 0; m.hist = [0]; sim.flight.push(m); } });
  }
  function doLiftoff() {
    if (!Show.replay) liftWindow();
    demoEmit({ type: "liftoff", m: MOTH, replay: Show.replay });
  }
  function doScriptBuy(b) {
    const rp = Show.replay;
    Show.alt = b.cum / GRAD; Show.hold = b.holders;
    if (Show.altHist.length < 200 && (Show.altHist.length < 2 || Show.alt - Show.altHist[Show.altHist.length - 1] > 0.004)) Show.altHist.push(Show.alt);
    if (!rp) { MOTH.alt = Show.alt; MOTH.mcap = mcapOf(MOTH.alt); MOTH.holders = b.holders; pushHist(MOTH, MOTH.alt); }
    const showFeed = b.amt >= 110 && (clock.T - Show.lastFeed) > 0.55;
    if (showFeed) Show.lastFeed = clock.T;
    if (b.amt >= 25) tapePush(MOTH, true, b.amt, b.w);
    demoEmit({ type: "buy", m: MOTH, amt: b.amt, alt: Show.alt, holders: b.holders, w: b.w, replay: rp, script: true, quiet: !showFeed });
  }
  function mothToOrbit() {
    MOTH.state = "orbit"; MOTH.alt = 1; MOTH.pool = 75000; MOTH.mcap = 75000; MOTH.day = 0; MOTH.warm = 1; MOTH.holders = 412;
    rmItem(sim.flight, MOTH); if (sim.orbit.indexOf(MOTH) < 0) sim.orbit.push(MOTH); sim.paid += PAYOUT;
  }
  function doShowOrbit() {
    if (!Show.replay) mothToOrbit();
    Show.alt = 1;
    demoEmit({ type: "orbit", m: MOTH, amt: PAYOUT, replay: Show.replay, show: true });
  }
  function finishLive() {
    // apply what is left of the first run silently, so a replay never double-counts
    if (!Show.flags.lift) { Show.flags.lift = true; liftWindow(); }
    if (!Show.flags.orbit) {
      Show.flags.orbit = true; mothToOrbit();
      demoEmit({ type: "orbit", m: MOTH, amt: PAYOUT, replay: false, silent: true });
    }
  }
  let cutBusy = false;
  function requestReplay() {
    if (!demo.on) return;
    if (Show.state === "pre") { showBegin(false); return; }
    if (cutBusy) return;
    if (Show.state === "run" && !Show.replay) finishLive();
    if (RM) { showBegin(true); return; }
    cutBusy = true;
    const cut = $("cut"); cut.classList.add("on");
    later(() => { cutBusy = false; cut.classList.remove("on"); if (demo.on) showBegin(true); }, 300);
  }

  /* ============================== LIVE STATE (only what setSnapshot / emit carry) ============================== */
  const live = {
    ready: false, snap: null, network: null, recs: new Map(), list: [], focus: null, missing: false,
    tape: [], log: [], stars: 0, sel: null,
    liftT: -99, exitT: -99, exitRise: 0, surge: 0, riseS: null, orbitFxT: -99, orbitFxReplay: false
  };

  /* ============================== SOUND (the concept's WebAudio synth, off until a tap) ============================== */
  const Sound = {
    on: false, ctx: null, out: null, noise: null, lastTick: 0,
    ensure: function () {
      if (this.ctx) return true;
      const AC = W.AudioContext || W.webkitAudioContext; if (!AC) return false;
      try { this.ctx = new AC(); } catch { return false; }
      const c = this.ctx, comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
      this.out = c.createGain(); this.out.gain.value = 0.55; this.out.connect(comp); comp.connect(c.destination);
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0); let b = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5 + w * 0.12; }
      this.noise = buf; return true;
    },
    ready: function () { return this.on && this.ctx && this.ctx.state === "running"; },
    setOn: function (v) {
      this.on = !!v;
      if (this.on && this.ensure()) { try { this.ctx.resume(); } catch { /* blocked */ } later(() => { this.blip(880, 0.08, 0.06); }, 30); }
      else if (this.ctx) { try { this.ctx.suspend(); } catch { /* closed */ } }
      syncSoundBtn();
    },
    blip: function (f, dur, vol, type) {
      if (!this.ready()) return;
      const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = type || "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.03);
    },
    tick: function (buy) { const n = performance.now(); if (n - this.lastTick < 150) return; this.lastTick = n; this.blip(buy ? 2300 : 1150, 0.035, 0.045, "triangle"); },
    beep: function (n) { this.blip(n <= 0 ? 523 : (n <= 3 ? 1318 : 1046), n <= 0 ? 0.5 : 0.1, 0.08); },
    rumble: function () {
      if (!this.ready()) return;
      const c = this.ctx, t = c.currentTime, src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.8;
      lp.frequency.setValueAtTime(60, t); lp.frequency.exponentialRampToValueAtTime(900, t + 1.6); lp.frequency.exponentialRampToValueAtTime(130, t + 11);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.0, t + 0.5); g.gain.setValueAtTime(1.0, t + 4); g.gain.exponentialRampToValueAtTime(0.0001, t + 12);
      src.connect(lp); lp.connect(g); g.connect(this.out); src.start(t); src.stop(t + 12.2);
      const o = c.createOscillator(), og = c.createGain(); o.type = "sine"; o.frequency.setValueAtTime(44, t); o.frequency.exponentialRampToValueAtTime(30, t + 10);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.5, t + 0.7); og.gain.exponentialRampToValueAtTime(0.0001, t + 10);
      o.connect(og); og.connect(this.out); o.start(t); o.stop(t + 10.2);
    },
    chime: function () {
      if (!this.ready()) return;
      const c = this.ctx, t = c.currentTime, notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      const dl = c.createDelay(); dl.delayTime.value = 0.19; const fb = c.createGain(); fb.gain.value = 0.3; dl.connect(fb); fb.connect(dl);
      const wet = c.createGain(); wet.gain.value = 0.3; dl.connect(wet); wet.connect(this.out);
      const out = this.out;
      notes.forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain(), s = t + i * 0.11; o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.15, s + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, s + 1.3);
        o.connect(g); g.connect(out); g.connect(dl); o.start(s); o.stop(s + 1.35);
      });
    },
    close: function () { if (this.ctx) { try { this.ctx.close(); } catch { /* already closed */ } this.ctx = null; } }
  };
  function syncSoundBtn() {
    const b = $("btnSound"); b.setAttribute("aria-pressed", Sound.on ? "true" : "false"); b.setAttribute("aria-label", Sound.on ? "Sound on" : "Sound off");
    $("sndLbl").textContent = Sound.on ? "SOUND ON" : "SOUND OFF"; $("sndLblS").textContent = Sound.on ? "ON" : "OFF";
    $("sndX").style.display = Sound.on ? "none" : ""; $("sndW").style.display = Sound.on ? "" : "none";
  }

  /* ============================== HUD — DEMO (the concept's) ============================== */
  const H = { next: $("sNext"), flight: $("sFlight"), orbit: $("sOrbit"), paid: $("sPaid"), paidShown: 4812, acc: 0, lastNext: "", lastFl: -1, lastOr: -1 };
  function initials(n) { const p = n.replace(".", "").split(" "); return (p[0][0] + (p[1] ? p[1][0] : "")).toUpperCase(); }
  function avatars(m) { return m.crew.map((c, i) => '<i style="--c:' + c.color + ';z-index:' + (9 - i) + '" title="' + esc(c.name) + " · " + c.split + '%">' + esc(initials(c.name)) + "</i>").join(""); }
  function buildQueue() {
    const ol = $("qList"); ol.innerHTML = "";
    WIN.forEach((m) => {
      const li = D.createElement("li"); li.className = "cr-qrow" + (m === MOTH ? " cr-own" : "");
      li.innerHTML = '<span class="cr-av" aria-label="Crew of ' + m.n + '">' + avatars(m) + "</span>" +
        '<span class="cr-qmain"><span class="cr-qtk">$' + m.tk + "<em>crew " + m.n + '</em></span><span class="cr-qbar"><i></i></span></span>' +
        '<span class="cr-qside"><span class="cr-qst go">GO</span><span class="cr-qmeta">' + m.calls + " calls</span></span>";
      ol.appendChild(li);
      m.el = { row: li, bar: li.querySelector(".cr-qbar i"), st: li.querySelector(".cr-qst"), meta: li.querySelector(".cr-qmeta"), last: "" };
    });
    const cc = D.createElement("li"); cc.className = "cr-qrow cr-callcard";
    cc.innerHTML = '<button class="cr-btn cr-btn-ghost" type="button" data-call="1">Make a flight call</button>';
    ol.appendChild(cc);
  }
  function rowState(m) {
    const inRun = Show.state === "run", e = Show.e;
    if (m === MOTH && Show.replay && inRun && e < 22) {
      if (e < 10) return ["cd", "T-" + Math.max(1, 10 - Math.floor(e)), MOTH.calls + " calls", 0];
      return ["alt", "ALT " + Math.floor(Show.alt * 100) + "%", kusd(mcapOf(Show.alt)) + " · ×" + Math.pow(15, Show.alt).toFixed(1), Show.alt];
    }
    if (m.state === "queued") {
      if (inRun && e < 10) return ["cd", "T-" + Math.max(1, 10 - Math.floor(e)), m.calls + " calls", 0];
      return ["go", "GO", m.calls + " calls", 0];
    }
    if (m.state === "flight") return ["alt", "ALT " + Math.floor(m.alt * 100) + "%", kusd(m.mcap) + " · ×" + (m.mcap / 5000).toFixed(1), m.alt];
    if (m.state === "orbit") return ["orbit", "ORBIT", kusd(m.mcap) + " · ×" + (m.mcap / 5000).toFixed(1), 1];
    if (m.state === "star") return ["orbit", "STAR", "Day 90", 1];
    return ["alt", "SIGNAL LOST", "", 0];
  }
  function updateQueue() {
    WIN.forEach((m) => {
      if (!m.el) return;
      const s = rowState(m), key = s.join("|");
      if (key === m.el.last) return; m.el.last = key;
      m.el.st.className = "cr-qst " + s[0]; m.el.st.textContent = s[1]; m.el.meta.textContent = s[2];
      m.el.bar.style.width = (s[3] * 100).toFixed(1) + "%";
      m.el.row.classList.toggle("cr-orbit", s[0] === "orbit" && m !== MOTH);
    });
    const lifted = WIN[1] && WIN[1].state !== "queued";
    $("qSub").textContent = lifted ? "6 missions lifted off together · fair start" : "6 missions · fair start · lift off together";
  }
  function utcNow() { return WIN_UTC + (clock.T - Show.t0); }
  function nextWindowIn() { const u = utcNow(); if (u < WIN_UTC) return WIN_UTC - u; return Math.ceil((u - WIN_UTC + 1e-3) / 900) * 900 - (u - WIN_UTC); }
  function hudUpdateDemo(dt) {
    H.acc += dt;
    const nx = hms(nextWindowIn()); if (nx !== H.lastNext) { H.next.textContent = nx; H.lastNext = nx; }
    if (sim.flight.length !== H.lastFl) { H.flight.textContent = sim.flight.length; H.lastFl = sim.flight.length; }
    if (sim.orbit.length !== H.lastOr) { H.orbit.textContent = sim.orbit.length; H.lastOr = sim.orbit.length; }
    if (Math.abs(H.paidShown - sim.paid) > 0.01) {
      H.paidShown = RM ? sim.paid : lerp(H.paidShown, sim.paid, 1 - Math.exp(-dt * 2.2));
      if (Math.abs(H.paidShown - sim.paid) < 0.5) H.paidShown = sim.paid;
      H.paid.textContent = usd0(H.paidShown);
    }
    if (H.acc > 0.25) { H.acc = 0; updateQueue(); }
  }
  function bump(el) { el.classList.remove("cr-bump"); void el.offsetWidth; el.classList.add("cr-bump"); }

  /* ------------------------------ feed ticker ------------------------------ */
  const Feed = { track: $("track"), items: [], x: 0, speed: 52 };
  function feedPush(html) {
    const el = D.createElement("span"); el.className = "cr-fi"; el.innerHTML = html;
    Feed.track.appendChild(el); Feed.items.push(el);
    if (Feed.items.length > 60) { const old = Feed.items.shift(); Feed.x += old.offsetWidth + 38; Feed.track.removeChild(old); }
  }
  function feedClear() { Feed.items.forEach((el) => { if (el.parentNode) el.parentNode.removeChild(el); }); Feed.items = []; Feed.x = 0; Feed.track.style.transform = ""; }
  function feedUpdate(dt) {
    if (RM) return;
    Feed.x -= Feed.speed * dt;
    const first = Feed.items[0];
    if (first) { const w = first.offsetWidth + 38; if (Feed.x + w < 0) { Feed.track.removeChild(first); Feed.items.shift(); Feed.x += w; } }
    const vis = Feed.track.parentNode.clientWidth, backlog = Feed.x + Feed.track.scrollWidth - vis;
    const target = backlog > vis * 1.6 ? 150 : backlog > vis * 0.7 ? 92 : 52;
    Feed.speed = lerp(Feed.speed, target, 1 - Math.exp(-dt * 1.5));
    Feed.track.style.transform = "translate3d(" + Feed.x.toFixed(1) + "px,0,0)";
  }
  const tkb = (m) => "<b>$" + m.tk + "</b>";
  function feedLineDemo(e) {
    const rp = e.replay ? '<span class="cr-rp">REPLAY</span>' : "", m = e.m;
    switch (e.type) {
      case "buy": return e.quiet ? null : rp + tkb(m) + '<span class="cr-up">buy ' + usd0(e.amt) + "</span> · " + (e.orbit ? "in orbit" : "altitude " + Math.floor(e.alt * 100) + "%");
      case "sell": return rp + tkb(m) + '<span class="cr-dn">sell ' + usd0(e.amt) + "</span> · " + (e.orbit ? "in orbit" : "altitude " + Math.floor(e.alt * 100) + "%");
      case "count": return rp + tkb(m) + '<span class="cr-hi">T-10</span> · crew of 4 · window 21:00 UTC';
      case "liftoff": return rp + tkb(m) + '<span class="cr-hi">LIFTOFF</span> · $EMBER $HALO $PIXEL $ORCA $FERN lift off together';
      case "orbit": return e.silent ? null : rp + tkb(m) + '<span class="cr-gold">ORBIT</span> · +' + usd2(e.amt) + " to the creator";
      case "check": return tkb(m) + '<span class="cr-info">Day ' + e.day + " check passed</span>";
      case "star": return tkb(m) + '<span class="cr-gold">Day 90 check passed · now a star</span>';
      case "lost": return tkb(m) + '<span class="cr-mut">Signal lost · ' + e.reason + "</span>";
      case "call": return tkb(m) + (e.viewer ? '<span class="cr-info">your flight call</span>' : "flight call") + " · " + e.calls + " calls";
    }
    return null;
  }
  function sr(t) { $("srLive").textContent = t; }
  onDemo((e) => {
    const line = feedLineDemo(e); if (line) feedPush('<span class="cr-rp">DEMO</span>' + line);
    if (e.type === "orbit" && !e.replay && !e.silent) { bump(H.orbit); bump(H.paid); }
    if (e.type === "liftoff" && !e.replay) bump(H.flight);
    if (e.type === "count") sr("Demo: countdown started for $MOTH, crew of 4.");
    if (e.type === "liftoff") { sr("Demo: liftoff. $MOTH and five more missions lifted off together."); Sound.rumble(); }
    if (e.type === "orbit" && e.show) { sr("Demo: orbit. Plus $123.64 to the creator."); Sound.chime(); }
    if (e.type === "tick") Sound.beep(e.n);
    if ((e.type === "buy" || e.type === "sell") && !e.quiet) Sound.tick(e.type === "buy");
  });

  /* ------------------------------ event titles ------------------------------ */
  let titleTimer = 0;
  function showTitle(word, sub, high) {
    const el = $("evtTitle"), box = $("evt"); el.innerHTML = "";
    for (let i = 0; i < word.length; i++) { const s = D.createElement("span"); s.textContent = word[i]; s.style.setProperty("--i", i); el.appendChild(s); }
    $("evtSub").textContent = sub || "";
    box.classList.remove("show", "out"); box.classList.toggle("hi", !!high); void box.offsetWidth; box.classList.add("show");
    cancel(titleTimer); titleTimer = later(() => { box.classList.add("out"); }, 2500 + word.length * 70);
  }
  function clearTitle() { cancel(titleTimer); $("evt").classList.remove("show", "out", "hi"); $("evtTitle").textContent = ""; $("evtSub").textContent = ""; }
  onDemo((e) => {
    if (e.type === "liftoff") showTitle("LIFTOFF", (e.replay ? "Replay · " : "") + "$MOTH · crew of 4 · window 21:00 UTC · DEMO", false);
    if (e.type === "orbit" && e.show) { showTitle("ORBIT", (e.replay ? "Replay · " : "") + "$MOTH · Meteora DAMM v2 pool live · DEMO", true); payShow("+$123.64", "to the creator"); }
  });

  /* ------------------------------ payout "+$" rising over the holo-table ------------------------------ */
  const Pay = { el: $("payout"), t: -1 };
  function payShow(amt, to) { $("payAmt").textContent = amt; $("payTo").textContent = to; Pay.t = 0; }
  function payClear() { Pay.t = -1; Pay.el.style.opacity = 0; }
  function payUpdate(dt) {
    if (Pay.t < 0) return;
    Pay.t += dt;
    const t = Pay.t, d = 0.35;               // starts right after the orbit flash
    if (t < d) { Pay.el.style.opacity = 0; return; }
    const k = t - d, op = k < 0.35 ? k / 0.35 : (k < 3.4 ? 1 : 1 - (k - 3.4) / 0.8);
    const rise = RM ? 0 : eOut(k / 2.6) * 60;
    const a = GL ? GL.anchor() : null, vw = view.w, vh = view.h;
    let x = a ? a.x : vw / 2, y = a ? a.y : vh * 0.42;
    if (STACKED.matches) { x = vw / 2; y = vh * 0.6; } else if (vh <= 520) { y = clamp(y, vh * 0.3, vh * 0.6); }
    Pay.el.style.opacity = clamp(op, 0, 1).toFixed(3);
    Pay.el.style.transform = "translate(" + x.toFixed(1) + "px," + (y - rise).toFixed(1) + "px) translate(-50%,-50%)";
    if (k > 4.2) payClear();
  }

  /* ------------------------------ toast ------------------------------ */
  let toastTimer = 0;
  function toast(html) { const t = $("toast"); t.innerHTML = html; t.classList.add("on"); cancel(toastTimer); toastTimer = later(() => { t.classList.remove("on"); }, 3600); }
  function toastClear() { cancel(toastTimer); $("toast").classList.remove("on"); }

  /* ------------------------------ buttons ------------------------------ */
  let callIdx = 1;
  function flightCall() {
    if (!demo.on) return;
    const m = WIN[callIdx % WIN.length]; callIdx++;
    simCall(m);
    toast("<b>DEMO</b>Flight call placed: $" + m.tk + " reaches orbit tonight. Free, no tokens.");
  }
  listen($("btnWatch"), "click", () => { if (!demo.on) return; toast("<b>DEMO</b>Launch Night runs weekly. Replaying tonight’s liftoff."); requestReplay(); });
  listen($("btnReplay"), "click", requestReplay);
  listen($("btnSound"), "click", () => { Sound.setOn(!Sound.on); });
  listen($("btnCall"), "click", flightCall);
  listen($("qList"), "click", (ev) => { const t = ev.target; if (t && t.closest && t.closest("[data-call]")) flightCall(); });
  listen($("btnDemo"), "click", () => { startDemo(); });
  listen($("btnLive"), "click", () => { endDemo(); });
  listen($("btnOrbitReplay"), "click", () => { const f = live.focus; if (!demo.on && f && f.phase === "orbit") orbitMoment(f, null, true, false); });

  /* ============================== WEBGL SCENE (the concept's room, field and holo-table) ============================== */
  let GL = null;
  const demoGLListeners = [];
  function initGL() {
    const canvas = $("gl");
    var probe = D.createElement("canvas"), ctx = null;
    try { ctx = probe.getContext("webgl2") || probe.getContext("webgl") || probe.getContext("experimental-webgl"); } catch { ctx = null; }
    if (!ctx) return null;
    try { const lose = ctx.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); } catch { /* probe only */ }
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" }); }
    catch { return null; }
    var isGL2 = renderer.capabilities.isWebGL2;
    var C = function (h) { return new THREE.Color(h).convertSRGBToLinear(); };
    var V3 = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    renderer.setClearColor(0x04070B, 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    var maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    var scene = new THREE.Scene();
    var FOG = C("#0B1524");
    scene.fog = new THREE.FogExp2(FOG, 0.00085);
    var camera = new THREE.PerspectiveCamera(52, 1, 0.3, 9000);
    var texList = [];

    /* ---------- quality tiers ---------- */
    var qParam = QS.get("quality") || QS.get("q");
    var qForced = (qParam === "high" || qParam === "medium" || qParam === "low") ? qParam : null;
    var tier = qForced || (COARSE || Math.min(W.screen.width, W.screen.height) < 700 ? "medium" : "high");
    var TIER = { high: { pr: 1.75, fx: 1, bloom: 1 }, medium: { pr: 1.25, fx: 0.62, bloom: 0.5 }, low: { pr: 1, fx: 0.36, bloom: 0 } };
    var canHalf = isGL2 && (renderer.extensions.has("EXT_color_buffer_float") || renderer.extensions.has("EXT_color_buffer_half_float"));
    var composer = null, bloom = null, finalPass = null;
    var FinalShader = {
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.03 }, uVig: { value: 0.95 }, uTint: { value: new THREE.Vector3(1, 1, 1) } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVig; uniform vec3 uTint; varying vec2 vUv;",
        "float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
        "void main(){",
        "  vec3 c = texture2D(tDiffuse, vUv).rgb * uTint;",
        "  vec2 d = vUv - 0.5; c *= clamp(1.0 - dot(d, d) * uVig, 0.0, 1.0);",
        "  float g = h(vUv * vec2(1733.0, 977.0) + fract(uTime * 3.17) * 31.0) - 0.5;",
        "  c += g * uGrain * (0.05 + 0.6 * sqrt(max(c, vec3(0.0))));",
        "  gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);",
        "  #include <encodings_fragment>",
        "}"].join("\n")
    };
    function buildComposer() {
      if (composer) { composer.dispose(); if (bloom) bloom.dispose(); if (finalPass) finalPass.dispose(); composer = null; bloom = null; finalPass = null; }
      if (TIER[tier].bloom === 0) return;
      var rt = new THREE.WebGLRenderTarget(16, 16, { type: canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: (tier === "high" && isGL2) ? 4 : 0 });
      composer = new EffectComposer(renderer, rt);
      composer.addPass(new RenderPass(scene, camera));
      bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.6, 0.8);
      composer.addPass(bloom);
      finalPass = new ShaderPass(FinalShader);
      composer.addPass(finalPass);
    }

    /* ---------- generated textures (once) ---------- */
    function cvs(w, h) { var c = D.createElement("canvas"); c.width = w; c.height = h; return c; }
    function tex(c, srgb) { var t = new THREE.CanvasTexture(c); if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = maxAniso; texList.push(t); return t; }
    function hsh(i, j) { var s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }
    var NP = new Uint8Array(512), NV = new Float32Array(256);
    (function () { var r = mulberry32(1234), p = [], i, j, t; for (i = 0; i < 256; i++) { p.push(i); NV[i] = r(); } for (i = 255; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = p[i]; p[i] = p[j]; p[j] = t; } for (i = 0; i < 512; i++) NP[i] = p[i & 255]; })();
    function vnoise(x, y, p) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), x1 = xi + 1, y1 = yi + 1;
      if (p) { xi = ((xi % p) + p) % p; yi = ((yi % p) + p) % p; x1 = x1 % p; y1 = y1 % p; }
      xi &= 255; yi &= 255; x1 &= 255; y1 &= 255;
      var a = NV[NP[NP[xi] + yi]], b = NV[NP[NP[x1] + yi]], c = NV[NP[NP[xi] + y1]], d = NV[NP[NP[x1] + y1]];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function fbm(x, y, o, p) { var s = 0, a = 0.5, f = 1, n = 0; for (var i = 0; i < o; i++) { s += a * vnoise(x * f, y * f, p ? p * f : 0); n += a; a *= 0.5; f *= 2; } return s / n; }
    function imgTex(w, h, fn, srgb, wrap) {
      var c = cvs(w, h), g = c.getContext("2d"), im = g.createImageData(w, h), d = im.data, o = [255, 255, 255, 0];
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { fn(x, y, o); var k = (y * w + x) * 4; d[k] = o[0]; d[k + 1] = o[1]; d[k + 2] = o[2]; d[k + 3] = o[3]; }
      g.putImageData(im, 0, 0); var t = tex(c, srgb);
      if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      return t;
    }
    function white(o, a) { o[0] = 255; o[1] = 255; o[2] = 255; o[3] = 255 * a; }
    var TX = {};
    TX.glow = (function () { var c = cvs(128, 128), g = c.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.1, "rgba(255,255,255,0.75)"); r.addColorStop(0.3, "rgba(255,255,255,0.2)"); r.addColorStop(0.62, "rgba(255,255,255,0.05)"); r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r; g.fillRect(0, 0, 128, 128); return tex(c, false); })();
    TX.soft = imgTex(64, 64, function (x, y, o) { var dx = (x + 0.5) / 32 - 1, dy = (y + 0.5) / 32 - 1, r = Math.sqrt(dx * dx + dy * dy); white(o, Math.exp(-r * r * 3.2) * sstep(1, 0.7, r)); }, false);
    TX.smoke = imgTex(128, 128, function (x, y, o) {
      var dx = (x + 0.5) / 64 - 1, dy = (y + 0.5) / 64 - 1, r = Math.sqrt(dx * dx + dy * dy);
      var n = fbm(x / 128 * 4 + 3.1, y / 128 * 4 + 1.7, 4), fall = sstep(1.0, 0.18, r + (n - 0.5) * 0.45);
      var a = clamp(fall * (0.5 + 0.8 * n), 0, 1), sh = 200 + 55 * n; o[0] = o[1] = o[2] = sh; o[3] = 255 * a * a; }, false);
    TX.ring = (function () { var c = cvs(128, 128), g = c.getContext("2d");
      g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 5; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.25)"; g.lineWidth = 14; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke(); return tex(c, false); })();
    TX.fog = imgTex(128, 64, function (x, y, o) { white(o, sstep(0.36, 0.8, fbm(x / 128 * 6, y / 64 * 3, 3, 6))); }, false, true);
    TX.beam = imgTex(32, 128, function (x, y, o) { var u = (x + 0.5) / 32 - 0.5, v = (y + 0.5) / 128; white(o, Math.exp(-u * u * 26) * Math.pow(1 - v, 1.6) * sstep(0, 0.06, v)); }, false);
    TX.cone = imgTex(8, 128, function (x, y, o) { white(o, Math.pow(1 - (y + 0.5) / 128, 2.2)); }, false);
    TX.ground = imgTex(128, 128, function (x, y, o) { var s = 30 + fbm(x / 128 * 8, y / 128 * 8, 4, 8) * 40; o[0] = s; o[1] = s + 3; o[2] = s + 8; o[3] = 255; }, true, true);
    TX.ground.repeat.set(160, 160);
    TX.grid = (function () { var c = cvs(512, 512), g = c.getContext("2d"); g.translate(256, 256);
      var rg = g.createRadialGradient(0, 0, 0, 0, 0, 256); rg.addColorStop(0, "rgba(255,255,255,0.32)"); rg.addColorStop(0.75, "rgba(255,255,255,0.08)"); rg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rg; g.fillRect(-256, -256, 512, 512);
      g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 1.5;
      for (var r = 40; r < 250; r += 34) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
      g.strokeStyle = "rgba(255,255,255,0.22)"; g.lineWidth = 1;
      for (var a = 0; a < 24; a++) { var an = a / 24 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(an) * 40, Math.sin(an) * 40); g.lineTo(Math.cos(an) * 246, Math.sin(an) * 246); g.stroke(); }
      g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 250, 0, Math.PI * 2); g.stroke();
      for (var t = 0; t < 120; t++) { var at = t / 120 * Math.PI * 2, l = t % 10 === 0 ? 16 : 7; g.lineWidth = t % 10 === 0 ? 2.5 : 1.2; g.beginPath(); g.moveTo(Math.cos(at) * 238, Math.sin(at) * 238); g.lineTo(Math.cos(at) * (238 - l), Math.sin(at) * (238 - l)); g.stroke(); }
      return tex(c, false); })();
    var MULL = [-11.5, -6.9, -2.3, 2.3, 6.9, 11.5];
    TX.floorWin = imgTex(256, 128, function (x, y, o) {
      var u = (x + 0.5) / 256, v = (y + 0.5) / 128, X = (u - 0.5) * 23, m = 1;
      for (var i = 0; i < 6; i++) m *= sstep(0.1, 0.42, Math.abs(X - MULL[i]));
      white(o, m * sstep(0, 0.04, u) * sstep(1, 0.96, u) * Math.pow(1 - v, 1.3) * (0.6 + 0.4 * vnoise(x * 1.8, y * 0.06, 0))); }, false);
    TX.glass = imgTex(128, 128, function (x, y, o) { var d = (x * 0.7 + y) / 128; white(o, Math.pow(Math.max(0, Math.sin(d * 9.0 + Math.sin(d * 3.1) * 1.5)), 14) * (0.6 + 0.4 * fbm(x / 32, y / 32, 3))); }, false);
    TX.apron = (function () { var c = cvs(256, 256), g = c.getContext("2d"), r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      r.addColorStop(0, "rgba(255,255,255,0.9)"); r.addColorStop(0.35, "rgba(255,255,255,0.4)"); r.addColorStop(0.7, "rgba(255,255,255,0.08)"); r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r; g.fillRect(0, 0, 256, 256); return tex(c, false); })();

    /* ---------- billboard batches (glows, particles) ---------- */
    var BB_VS = [
      "attribute vec3 iPos; attribute vec4 iCol; attribute vec3 iSz; uniform float uPx;",
      "varying vec2 vUv; varying vec4 vCol;",
      "void main(){ vUv = uv; vCol = iCol; vec4 mv = modelViewMatrix * vec4(iPos, 1.0);",
      "  float s = max(iSz.x, iSz.z * (-mv.z) * uPx); float c = cos(iSz.y), sn = sin(iSz.y);",
      "  vec2 p = position.xy * s; mv.xy += vec2(c * p.x - sn * p.y, sn * p.x + c * p.y);",
      "  gl_Position = projectionMatrix * mv; }"].join("\n");
    var BB_FS = [
      "uniform sampler2D uMap; varying vec2 vUv; varying vec4 vCol;",
      "void main(){ vec4 t = texture2D(uMap, vUv); gl_FragColor = vec4(vCol.rgb * t.rgb, t.a * vCol.a);",
      "  #include <encodings_fragment>",
      "}"].join("\n");
    var pxUniforms = [];
    function Batch(max, map, blending, order) {
      this.max = max; this.n = 0;
      var g = new THREE.InstancedBufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.sz = new Float32Array(max * 3);
      this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
      this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
      this.aSz = new THREE.InstancedBufferAttribute(this.sz, 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("iPos", this.aPos); g.setAttribute("iCol", this.aCol); g.setAttribute("iSz", this.aSz);
      g.instanceCount = 0; this.geo = g;
      var u = { uMap: { value: map }, uPx: { value: 0.001 } }; pxUniforms.push(u.uPx);
      this.mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: BB_VS, fragmentShader: BB_FS, transparent: true, depthWrite: false, blending: blending });
      this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = order || 0;
    }
    Batch.prototype.begin = function () { this.n = 0; };
    Batch.prototype.push = function (x, y, z, r, g, b, a, size, rot, minPx) {
      if (this.n >= this.max || a <= 0.002) return; var i = this.n++, p = i * 3, c = i * 4;
      this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
      this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b; this.col[c + 3] = a;
      this.sz[p] = size; this.sz[p + 1] = rot || 0; this.sz[p + 2] = minPx || 0;
    };
    Batch.prototype.end = function () {
      var n = this.n; this.geo.instanceCount = n;
      this.aPos.updateRange.count = n * 3; this.aCol.updateRange.count = n * 4; this.aSz.updateRange.count = n * 3;
      this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSz.needsUpdate = true;
    };
    var glows = new Batch(620, TX.glow, THREE.AdditiveBlending, 6);
    var rings = new Batch(60, TX.ring, THREE.AdditiveBlending, 7);
    var fireB = new Batch(1400, TX.soft, THREE.AdditiveBlending, 5);
    var smokeB = new Batch(1100, TX.smoke, THREE.NormalBlending, 4);
    scene.add(glows.mesh, rings.mesh, fireB.mesh, smokeB.mesh);

    /* particle pools (CPU) */
    function Pool(max) { this.max = max; this.n = 0; this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.age = new Float32Array(max); this.life = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.rot = new Float32Array(max); this.vr = new Float32Array(max); this.k = new Uint8Array(max); this.sd = new Float32Array(max); }
    Pool.prototype.spawn = function (x, y, z, vx, vy, vz, life, s0, s1, k) {
      if (this.n >= this.max) return; var i = this.n++, p = i * 3;
      this.p[p] = x; this.p[p + 1] = y; this.p[p + 2] = z; this.v[p] = vx; this.v[p + 1] = vy; this.v[p + 2] = vz;
      this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.rot[i] = Math.random() * 6.283; this.vr[i] = (Math.random() - 0.5) * 0.6; this.k[i] = k; this.sd[i] = Math.random();
    };
    Pool.prototype.kill = function (i) {
      var j = --this.n; if (i === j) return; var a = i * 3, b = j * 3;
      this.p[a] = this.p[b]; this.p[a + 1] = this.p[b + 1]; this.p[a + 2] = this.p[b + 2]; this.v[a] = this.v[b]; this.v[a + 1] = this.v[b + 1]; this.v[a + 2] = this.v[b + 2];
      this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j]; this.rot[i] = this.rot[j]; this.vr[i] = this.vr[j]; this.k[i] = this.k[j]; this.sd[i] = this.sd[j];
    };
    var fireP = new Pool(1400), smokeP = new Pool(1100);

    /* ---------- materials ---------- */
    var M = {
      wall: new THREE.MeshStandardMaterial({ color: C("#0C131C"), roughness: 0.92, metalness: 0.08 }),
      wallDark: new THREE.MeshStandardMaterial({ color: C("#070B10"), roughness: 0.8, metalness: 0.2 }),
      floor: new THREE.MeshStandardMaterial({ color: C("#070B11"), roughness: 0.2, metalness: 0.7 }),
      tier: new THREE.MeshStandardMaterial({ color: C("#0A1018"), roughness: 0.3, metalness: 0.6 }),
      console: new THREE.MeshStandardMaterial({ color: C("#1A2635"), roughness: 0.48, metalness: 0.55 }),
      person: new THREE.MeshStandardMaterial({ color: C("#0B1017"), roughness: 0.9, metalness: 0.0 }),
      frame: new THREE.MeshStandardMaterial({ color: C("#0E151E"), roughness: 0.5, metalness: 0.7 }),
      steel: new THREE.MeshLambertMaterial({ color: C("#3A4554") }),
      concrete: new THREE.MeshLambertMaterial({ color: C("#3B414A") }),
      ground: new THREE.MeshLambertMaterial({ color: C("#6A7684"), map: TX.ground }),
      shipWhite: new THREE.MeshStandardMaterial({ color: C("#BFC8D3"), roughness: 0.52, metalness: 0.06, emissive: C("#1A222D"), emissiveIntensity: 1 }),
      shipDark: new THREE.MeshStandardMaterial({ color: C("#1C232C"), roughness: 0.55, metalness: 0.35 }),
      bell: new THREE.MeshStandardMaterial({ color: C("#2A2F36"), roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide })
    };
    function box(w, h, d, mat, x, y, z, parent) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); (parent || scene).add(m); return m; }

    /* ---------- lights ---------- */
    var hemi = new THREE.HemisphereLight(C("#33475F"), C("#05080C"), 0.55); scene.add(hemi);
    var winLight = new THREE.DirectionalLight(C("#7FA8D6"), 0.5); winLight.position.set(0, 12, -24); winLight.target.position.set(0, 0, 14); scene.add(winLight, winLight.target);
    var winFill = new THREE.PointLight(C("#5C86B5"), 0.9, 48, 1.2); winFill.position.set(0, 7, -13); scene.add(winFill);
    var holoLight = new THREE.PointLight(C("#4FB8FF"), 1.8, 15, 1.6); holoLight.position.set(0, 3.8, -5.5); scene.add(holoLight);
    var backFill = new THREE.PointLight(C("#7D97BC"), 0.45, 40, 1.0); backFill.position.set(0, 13, 22); scene.add(backFill);
    var flood1 = new THREE.SpotLight(C("#FFF0DC"), 2.2, 0, 0.42, 0.5, 0); flood1.position.set(-58, 20, -158); scene.add(flood1, flood1.target);
    var flood2 = new THREE.SpotLight(C("#FFF0DC"), 1.8, 0, 0.42, 0.5, 0); flood2.position.set(55, 20, -164); scene.add(flood2, flood2.target);
    var exLight = new THREE.PointLight(C("#FF7A2A"), 0, 520, 1.3); exLight.position.set(0, -2, -195); scene.add(exLight);
    var COL = { winCool: C("#7FA8D6"), winWarm: C("#FF7A2E"), fillCool: C("#5C86B5"), fillWarm: C("#FF8A3D"), holo: C("#4FB8FF"), gold: C("#F5B544"), hemiSky: C("#33475F"), hemiWarm: C("#7A4A2E"),
      fire1: C("#FC9D01"), fire2: C("#FC5501"), fire3: C("#FA260F"), fire4: C("#F30D1D"), info: C("#4FB8FF"), up: C("#22C55E"), down: C("#EF4444"), warn: C("#F5B544"), brand: C("#FF681C"), white: C("#F5F7FA"), pale: C("#D6E6FF"), lamp: C("#FFE7C4"), red: C("#FF2A1E"),
      shaft: C("#9FC4EA"), mote: C("#CFE4FA"), moteWarm: C("#FFB37A"), glassCool: C("#8FB7E0") };

    /* ====================== ROOM ====================== */
    var ROOM = { z: -16, wx: 11.5, wy0: 1.6, wy1: 14.6, ceil: 20.5 };
    (function buildRoom() {
      var fl = new THREE.Mesh(new THREE.PlaneGeometry(41, 44), M.floor); fl.rotation.x = -Math.PI / 2; fl.position.set(0, 0, 5.5); scene.add(fl);
      box(25.2, 2.6, 0.6, M.wall, 0, 0.3, -16);
      box(25.2, 5.9, 0.6, M.wall, 0, 17.55, -16);
      box(1.1, 13, 0.6, M.wall, -12.05, 8.1, -16);
      box(1.1, 13, 0.6, M.wall, 12.05, 8.1, -16);
      [-11.5, -6.9, -2.3, 2.3, 6.9, 11.5].forEach(function (x) { box(0.24, 13, 0.55, M.frame, x, 8.1, -15.86); });
      box(23.6, 0.24, 1.1, M.frame, 0, 1.5, -15.55);
      box(23.6, 0.32, 0.8, M.frame, 0, 14.76, -15.66);
      [-1, 1].forEach(function (s) {
        var ch = box(10.19, 20.5, 0.4, M.wall, s * 16.3, 10.25, -12.5); ch.rotation.y = -s * 0.7573;
        box(0.4, 20.5, 36, M.wall, s * 20.2, 10.25, 9);
      });
      box(40.8, 20.5, 0.4, M.wall, 0, 10.25, 27.2);
      var ce = new THREE.Mesh(new THREE.PlaneGeometry(41, 44), M.wallDark); ce.rotation.x = Math.PI / 2; ce.position.set(0, ROOM.ceil, 5.5); scene.add(ce);
      for (var bx = -16; bx <= 16; bx += 8) box(0.5, 0.9, 43, M.wallDark, bx, ROOM.ceil - 0.45, 5.5);
      var stripMat = new THREE.MeshBasicMaterial({ color: C("#9FD4FF").multiplyScalar(0.55), toneMapped: false, fog: false });
      for (var sx = -12; sx <= 12; sx += 8) box(0.07, 0.04, 40, stripMat, sx, ROOM.ceil - 0.06, 6);
    })();

    /* ---------- tiers ---------- */
    var AMPHI_Z = -42;
    var ROWS = [{ R: 43.5, y: 0.85, n: 5 }, { R: 49, y: 1.7, n: 6 }, { R: 54.5, y: 2.55, n: 6 }];
    function sectorShape(r0, r1, a0, a1) {
      var s = new THREE.Shape(), n = 48, i, a;
      for (i = 0; i <= n; i++) { a = a0 + (a1 - a0) * i / n; if (i === 0) s.moveTo(r0 * Math.sin(a), -r0 * Math.cos(a)); else s.lineTo(r0 * Math.sin(a), -r0 * Math.cos(a)); }
      for (i = n; i >= 0; i--) { a = a0 + (a1 - a0) * i / n; s.lineTo(r1 * Math.sin(a), -r1 * Math.cos(a)); }
      return s;
    }
    (function buildTiers() {
      var stepMat = new THREE.MeshBasicMaterial({ color: C("#9FD4FF").multiplyScalar(0.9), toneMapped: false, fog: false });
      ROWS.forEach(function (row, i) {
        var r0 = row.R - 1.35, r1 = i < 2 ? ROWS[i + 1].R - 1.35 : 72;
        var g = new THREE.ExtrudeGeometry(sectorShape(r0, r1, -0.52, 0.52), { depth: row.y, bevelEnabled: false, curveSegments: 1 });
        g.rotateX(-Math.PI / 2); g.translate(0, 0, AMPHI_Z);
        scene.add(new THREE.Mesh(g, M.tier));
        var sg = new THREE.ShapeGeometry(sectorShape(r0 + 0.04, r0 + 0.1, -0.5, 0.5));
        sg.rotateX(-Math.PI / 2); sg.translate(0, row.y + 0.012, AMPHI_Z);
        scene.add(new THREE.Mesh(sg, stepMat));
      });
    })();

    /* ---------- consoles, screens (atlas), people, LEDs ---------- */
    var consoles = [];
    ROWS.forEach(function (row, ri) {
      var pitch = 1.86;
      [-1, 1].forEach(function (side) {
        for (var k = 0; k < row.n; k++) {
          var along = 1.55 + pitch * 0.5 + k * pitch, th = side * along / row.R;
          consoles.push({ x: row.R * Math.sin(th), y: row.y, z: AMPHI_Z + row.R * Math.cos(th), rot: th, row: ri, k: k, side: side });
        }
      });
    });
    var NCON = consoles.length;
    var conGeo = (function () {
      var s = new THREE.Shape(), P = [[0.45, 0.70], [0.45, 0.78], [-0.18, 0.78], [-0.40, 1.34], [-0.56, 1.34], [-0.56, 0.0], [0.15, 0.0], [0.15, 0.70]];
      s.moveTo(P[0][0], P[0][1]); for (var i = 1; i < P.length; i++) s.lineTo(P[i][0], P[i][1]); s.closePath();
      var g = new THREE.ExtrudeGeometry(s, { depth: 1.66, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 2, curveSegments: 1 });
      g.rotateY(-Math.PI / 2); g.translate(0.83, 0, 0); return g;
    })();
    var conMesh = new THREE.InstancedMesh(conGeo, M.console, NCON);
    var tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), YAX = new THREE.Vector3(0, 1, 0);
    var conMats = consoles.map(function (c, i) {
      var m = new THREE.Matrix4().compose(V3(c.x, c.y, c.z), new THREE.Quaternion().setFromAxisAngle(YAX, c.rot), V3(1, 1, 1));
      conMesh.setMatrixAt(i, m); return m;
    });
    scene.add(conMesh);
    var AT = { c: cvs(1024, 1024) }; AT.g = AT.c.getContext("2d"); AT.tex = tex(AT.c, true);
    var scrMat = new THREE.MeshBasicMaterial({ map: AT.tex, toneMapped: false, fog: false });
    (function buildScreens() {
      var pos = [], uv = [], idx = [], local = new THREE.Matrix4().compose(V3(0, 1.075, -0.255), new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), -0.379), V3(1, 1, 1));
      consoles.forEach(function (c, i) {
        var s = i % 32, col = s % 4, row = Math.floor(s / 4), inset = 2 / 1024;
        var u0 = col * 0.25 + inset, u1 = (col + 1) * 0.25 - inset, vT = 1 - row * 0.125 - inset, vB = 1 - (row + 1) * 0.125 + inset;
        var w = conMats[i].clone().multiply(local), base = pos.length / 3;
        [[-0.76, -0.25, u0, vB], [0.76, -0.25, u1, vB], [0.76, 0.25, u1, vT], [-0.76, 0.25, u0, vT]].forEach(function (q) {
          tmpV.set(q[0], q[1], 0).applyMatrix4(w); pos.push(tmpV.x, tmpV.y, tmpV.z); uv.push(q[2], q[3]);
        });
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      });
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      var mesh = new THREE.Mesh(g, scrMat); scene.add(mesh); AT.mesh = mesh;
    })();
    var people = consoles.filter(function (c, i) { return hsh(i, 7) < 0.55 && c.row < 2; });
    (function buildPeople() {
      var torso = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.34, 4, 10), M.person, people.length);
      var head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.115, 12, 10), M.person, people.length);
      var chair = new THREE.InstancedMesh(new THREE.BoxGeometry(0.52, 0.72, 0.09), M.wallDark, people.length);
      people.forEach(function (c, i) {
        var q = new THREE.Quaternion().setFromAxisAngle(YAX, c.rot), off = hsh(i, 3) - 0.5;
        var b = new THREE.Matrix4().compose(V3(c.x, c.y, c.z), q, V3(1, 1, 1));
        tmpM.compose(V3(off * 0.3, 1.02, 0.86), new THREE.Quaternion(), V3(1.25, 1, 0.68)); torso.setMatrixAt(i, b.clone().multiply(tmpM));
        tmpM.compose(V3(off * 0.3 + (hsh(i, 9) - 0.5) * 0.06, 1.48, 0.82), new THREE.Quaternion(), V3(1, 1.1, 1)); head.setMatrixAt(i, b.clone().multiply(tmpM));
        tmpM.compose(V3(off * 0.3, 0.86, 1.08), new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), 0.12), V3(1, 1, 1)); chair.setMatrixAt(i, b.clone().multiply(tmpM));
      });
      scene.add(torso, head, chair);
    })();
    var leds = consoles.map(function (c, i) {
      var arr = [];
      for (var j = 0; j < 3; j++) { tmpV.set(0.42 + j * 0.09, 0.83, -0.06).applyMatrix4(conMats[i]); arr.push(tmpV.clone()); }
      return { p: arr, flash: 0, flashCol: 0, last: -9, phase: hsh(i, 1) * 6.28, rate: 0.6 + hsh(i, 2) * 1.6 };
    });

    /* ---------- tall telemetry screens (left: altitude + crew, right: flight data + tape) ---------- */
    var TS = [];
    [-1, 1].forEach(function (s) {
      var c = cvs(512, 1024), t = tex(c, true);
      var m = new THREE.Mesh(new THREE.PlaneGeometry(5, 10), new THREE.MeshBasicMaterial({ map: t, toneMapped: false, fog: false }));
      m.position.set(s * 16.13, 9.0, -12.32); m.rotation.y = -s * 0.7573; scene.add(m);
      box(5.36, 10.36, 0.12, M.frame, 0, 0, -0.08, m);
      TS.push({ c: c, g: c.getContext("2d"), t: t, mesh: m, side: s });
    });

    /* ---------- LED countdown board ---------- */
    var BRD = { main: cvs(2048, 512), tick: cvs(2048, 64), src: cvs(256, 64), tsrc: cvs(2600, 8), last: "", scroll: 0, tickText: "", tickW: 0 };
    BRD.mg = BRD.main.getContext("2d"); BRD.kg = BRD.tick.getContext("2d"); BRD.sg = BRD.src.getContext("2d", { willReadFrequently: true }); BRD.tg = BRD.tsrc.getContext("2d");
    BRD.mainTex = tex(BRD.main, true); BRD.tickTex = tex(BRD.tick, true);
    box(13.8, 4.15, 0.5, M.frame, 0, 16.92, -15.75);
    BRD.mainMat = new THREE.MeshBasicMaterial({ map: BRD.mainTex, toneMapped: false, fog: false });
    BRD.tickMat = new THREE.MeshBasicMaterial({ map: BRD.tickTex, toneMapped: false, fog: false });
    var bm = new THREE.Mesh(new THREE.PlaneGeometry(12.8, 3.2), BRD.mainMat); bm.position.set(0, 17.35, -15.49); scene.add(bm);
    var bt = new THREE.Mesh(new THREE.PlaneGeometry(12.8, 0.4), BRD.tickMat); bt.position.set(0, 15.42, -15.49); scene.add(bt);
    function dotCanvas(w, h, cell, rad, color) { var c = cvs(w, h), g = c.getContext("2d"); g.fillStyle = color; for (var y = 0; y < h; y += cell) for (var x = 0; x < w; x += cell) { g.beginPath(); g.arc(x + cell / 2, y + cell / 2, rad, 0, 6.2832); g.fill(); } return c; }
    BRD.unlit = dotCanvas(2048, 512, 8, 2.6, "#0F161F"); BRD.unlitT = dotCanvas(2048, 64, 8, 2.6, "#0F161F");
    BRD.mask = (function () { var c = cvs(8, 8), g = c.getContext("2d"); var r = g.createRadialGradient(4, 4, 0, 4, 4, 3.6); r.addColorStop(0, "#fff"); r.addColorStop(0.7, "#fff"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 8, 8); return c; })();
    BRD.up = cvs(2048, 512); BRD.ug = BRD.up.getContext("2d");
    BRD.upT = cvs(2048, 64); BRD.utg = BRD.upT.getContext("2d");
    function ledText(g, str, x, y, color, sc) {
      sc = sc || 1; g.fillStyle = color;
      for (var i = 0; i < str.length; i++) { var gl = F5[str[i]] || F5[" "]; for (var b = 0; b < 35; b++) if (gl.charCodeAt(b) === 49) g.fillRect(x + (b % 5) * sc, y + Math.floor(b / 5) * sc, sc, sc); x += 6 * sc; }
      return x;
    }
    function drawBoard(st) {
      var g = BRD.sg; g.clearRect(0, 0, 256, 64);
      var a = st.a || "", b = st.b || "";
      while (a.length > 1 && ledW(a) + (b ? ledW(b) + 12 : 0) > 248) a = a.slice(0, -1);
      ledText(g, a, 4, 3, st.aCol || "#F5B544");
      if (b) ledText(g, b, 252 - ledW(b), 3, st.bCol || "#C9D6E6");
      // big line: vector font, thresholded to whole LEDs (shrunk to fit the board when it is long)
      var size = st.bigSize || 40;
      g.font = "600 " + size + "px " + MONO; g.textAlign = "center"; g.textBaseline = "alphabetic"; g.fillStyle = st.bigCol;
      var tw = g.measureText(st.big).width;
      if (tw > 246) { size = Math.max(14, Math.floor(size * 246 / tw)); g.font = "600 " + size + "px " + MONO; }
      g.fillText(st.big, 128, size >= 40 ? 56 : 56 - Math.round((40 - size) * 0.35));
      var im = g.getImageData(0, 13, 256, 51), d = im.data;
      for (var i = 3; i < d.length; i += 4) d[i] = d[i] > 120 ? 255 : 0;
      g.putImageData(im, 0, 13);
      var u = BRD.ug; u.globalCompositeOperation = "source-over"; u.imageSmoothingEnabled = false; u.clearRect(0, 0, 2048, 512);
      u.drawImage(BRD.src, 0, 0, 2048, 512);
      u.globalCompositeOperation = "destination-in"; u.fillStyle = u.createPattern(BRD.mask, "repeat"); u.fillRect(0, 0, 2048, 512); u.globalCompositeOperation = "source-over";
      var m = BRD.mg; m.fillStyle = "#05080C"; m.fillRect(0, 0, 2048, 512); m.drawImage(BRD.unlit, 0, 0); m.drawImage(BRD.up, 0, 0);
      BRD.mainTex.needsUpdate = true;
    }
    function drawTicker() {
      var u = BRD.utg, w = 256;
      u.globalCompositeOperation = "source-over"; u.imageSmoothingEnabled = false; u.clearRect(0, 0, 2048, 64);
      var off = BRD.scroll % BRD.tickW;
      u.drawImage(BRD.tsrc, off, 0, Math.min(w, BRD.tickW - off), 8, 0, 0, Math.min(w, BRD.tickW - off) * 8, 64);
      if (BRD.tickW - off < w) u.drawImage(BRD.tsrc, 0, 0, w - (BRD.tickW - off), 8, (BRD.tickW - off) * 8, 0, (w - (BRD.tickW - off)) * 8, 64);
      u.globalCompositeOperation = "destination-in"; u.fillStyle = u.createPattern(BRD.mask, "repeat"); u.fillRect(0, 0, 2048, 64); u.globalCompositeOperation = "source-over";
      var k = BRD.kg; k.fillStyle = "#05080C"; k.fillRect(0, 0, 2048, 64); k.drawImage(BRD.unlitT, 0, 0); k.drawImage(BRD.upT, 0, 0);
      BRD.tickTex.needsUpdate = true;
    }
    function setTickerParts(parts) {
      var g = BRD.tg; g.clearRect(0, 0, 2600, 8); var x = 0;
      parts.forEach(function (p) { if (x < 2600) x = ledText(g, p[0].toUpperCase(), x, 0, p[1]); });
      BRD.tickW = Math.max(260, Math.min(2600, x)); BRD.tickText = parts.map(function (p) { return p[0]; }).join("");
    }
    function buildTickerDemo() {
      var parts = [];
      sim.flight.slice().sort(function (a, b) { return b.alt - a.alt; }).forEach(function (m) { var up = m.hist.length > 2 && m.hist[m.hist.length - 1] >= m.hist[m.hist.length - 3]; parts.push(["$" + m.tk + " ALT " + Math.floor(m.alt * 100) + "%", m === MOTH ? "#FF8A4C" : "#E6EEF8"], [up ? " ▲" : " ▼", up ? "#22C55E" : "#EF4444"], ["   ·   ", "#56657A"]); });
      parts.push(["IN ORBIT " + sim.orbit.length, "#4FB8FF"], ["   ·   ", "#56657A"], ["CREATOR FEES " + usd0(sim.paid), "#F5B544"], ["   ·   ", "#56657A"], ["DEMO · SIMULATED FLIGHTS", "#8A97A8"], ["   ·   ", "#56657A"]);
      setTickerParts(parts);
    }
    function buildTickerLive() {
      var parts = [], sep = ["   ·   ", "#56657A"];
      if (!live.ready) parts.push(["READING THE CHAIN...", "#8A97A8"], sep);
      else if (!live.list.length) parts.push(["NO MISSIONS IN FLIGHT RIGHT NOW", "#8A97A8"], sep);
      else {
        live.list.slice(0, 28).forEach(function (r) {
          var own = r === live.focus, col = own ? "#FF8A4C" : "#E6EEF8";
          if (r.phase === "ascent") {
            parts.push([r.ticker + " ALT " + (r.altPct == null ? "-" : Math.floor(r.altPct) + "%"), col]);
            var h = r.hist; if (h.length > 2) { var up = h[h.length - 1] >= h[h.length - 3]; parts.push([up ? " ▲" : " ▼", up ? "#22C55E" : "#EF4444"]); }
          } else if (r.phase === "orbit") parts.push([r.ticker + " ORBIT" + (r.day != null ? " D" + r.day : ""), own ? "#FF8A4C" : "#4FB8FF"]);
          else if (r.phase === "star") parts.push([r.ticker + " STAR", "#F5B544"]);
          else if (r.phase === "lost") parts.push([r.ticker + " SIGNAL LOST", "#8A97A8"]);
          else parts.push([r.ticker + " ON THE PAD", col]);
          parts.push(sep);
        });
        parts.push(["IN FLIGHT " + live.list.filter(function (r) { return r.phase === "ascent"; }).length, "#E6EEF8"], sep, ["IN ORBIT " + live.list.filter(function (r) { return r.phase === "orbit"; }).length, "#4FB8FF"], sep);
      }
      parts.push([livePillText(), "#8A97A8"], sep);
      setTickerParts(parts);
    }

    /* ---------- holo-table ---------- */
    var HOLO = { c: V3(0, 0, -5.5), y: 3.9, ringR: 2.75, planetR: 0.82 };
    var holoGrp = new THREE.Group(); holoGrp.position.copy(HOLO.c); scene.add(holoGrp);
    (function buildTable() {
      var tbl = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.35, 1.05, 72), M.console); tbl.position.y = 0.525; holoGrp.add(tbl);
      var lip = new THREE.Mesh(new THREE.TorusGeometry(3.12, 0.035, 8, 120), new THREE.MeshBasicMaterial({ color: C("#4FB8FF").multiplyScalar(1.6), toneMapped: false, fog: false })); lip.rotation.x = Math.PI / 2; lip.position.y = 1.06; holoGrp.add(lip);
      var top = new THREE.Mesh(new THREE.CircleGeometry(3.05, 72), new THREE.MeshBasicMaterial({ map: TX.grid, color: C("#4FB8FF").multiplyScalar(0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      top.rotation.x = -Math.PI / 2; top.position.y = 1.065; holoGrp.add(top);
    })();
    var HOLO_VS = "varying vec3 vN; varying vec3 vP; varying float vY; varying vec2 vUv; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vP = position; vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }";
    var beamMat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: COL.info.clone() }, uTime: { value: 0 }, uAmp: { value: 1 } }, vertexShader: HOLO_VS,
      fragmentShader: "uniform vec3 uCol; uniform float uTime, uAmp; varying vec2 vUv; varying float vY; varying vec3 vN;\nvoid main(){ float yy = clamp(1.0 - vUv.y, 0.0, 1.0); float a = pow(yy, 1.6) * 0.16 + pow(yy, 6.0) * 0.25; float s = 0.65 + 0.35 * sin(vY * 34.0 - uTime * 3.0); float e = pow(clamp(1.0 - abs(vN.z), 0.0, 1.0), 1.5); gl_FragColor = vec4(max(uCol * a * s * (0.5 + e) * uAmp, vec3(0.0)), 1.0);\n#include <encodings_fragment>\n}",
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.75, 3.6, 64, 1, true), beamMat); beam.position.y = 1.06 + 1.8; holoGrp.add(beam);
    var tilt = new THREE.Group(); tilt.position.y = HOLO.y; tilt.rotation.set(0.36, 0, 0.1); holoGrp.add(tilt);
    var spin = new THREE.Group(); tilt.add(spin);
    var planetMat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: COL.info.clone() }, uGold: { value: COL.gold.clone() }, uGoldAmt: { value: 0 }, uTime: { value: 0 }, uAmp: { value: 1 } },
      vertexShader: HOLO_VS,
      fragmentShader: [
        "uniform vec3 uCol, uGold; uniform float uGoldAmt, uTime, uAmp; varying vec3 vN; varying vec3 vP; varying float vY;",
        "float hs(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }",
        "float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);",
        "  return mix(mix(mix(hs(i), hs(i + vec3(1,0,0)), f.x), mix(hs(i + vec3(0,1,0)), hs(i + vec3(1,1,0)), f.x), f.y), mix(mix(hs(i + vec3(0,0,1)), hs(i + vec3(1,0,1)), f.x), mix(hs(i + vec3(0,1,1)), hs(i + vec3(1,1,1)), f.x), f.y), f.z); }",
        "void main(){ vec3 p = normalize(vP); float f = pow(clamp(1.0 - abs(vN.z), 0.0, 1.0), 2.0);",
        "  float lat = asin(clamp(p.y, -1.0, 1.0)), lon = atan(p.z, p.x);",
        "  float gl = abs(fract(lat * 3.8197) - 0.5), gL = abs(fract(lon * 1.9099) - 0.5);",
        "  float grid = smoothstep(0.455, 0.5, max(gl, gL));",
        "  float land = smoothstep(0.52, 0.6, vn(p * 3.2 + 1.7) * 0.7 + vn(p * 7.0) * 0.3);",
        "  vec2 cell = vec2(lon * 14.0, lat * 14.0); float dots = land * smoothstep(0.32, 0.12, length(fract(cell) - 0.5));",
        "  float scan = 0.62 + 0.38 * sin(vY * 70.0 - uTime * 4.0);",
        "  vec3 col = mix(uCol, uGold, uGoldAmt);",
        "  float a = (0.06 + f * 1.15 + grid * 0.42 + dots * 0.85) * scan * uAmp;",
        "  gl_FragColor = vec4(col * a, 1.0);",
        "  #include <encodings_fragment>",
        "}"].join("\n"),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    var planet = new THREE.Mesh(new THREE.SphereGeometry(HOLO.planetR, 48, 32), planetMat); spin.add(planet);
    var ringMat = new THREE.MeshBasicMaterial({ color: C("#4FB8FF").multiplyScalar(1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    var orbitRing = new THREE.Mesh(new THREE.TorusGeometry(HOLO.ringR, 0.026, 6, 220), ringMat); orbitRing.rotation.x = Math.PI / 2; spin.add(orbitRing);
    var ring2 = new THREE.Mesh(new THREE.RingGeometry(HOLO.ringR - 0.12, HOLO.ringR + 0.12, 160), new THREE.MeshBasicMaterial({ color: C("#4FB8FF").multiplyScalar(0.22), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    ring2.rotation.x = -Math.PI / 2; spin.add(ring2);
    var pulseMat = new THREE.MeshBasicMaterial({ color: C("#F5B544").multiplyScalar(2.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    var pulseRing = new THREE.Mesh(new THREE.RingGeometry(HOLO.ringR - 0.06, HOLO.ringR + 0.06, 160), pulseMat); pulseRing.rotation.x = -Math.PI / 2; spin.add(pulseRing);
    // the room's mission trajectory line on the hologram ($MOTH in the demo, the focus mission live)
    var trajN = 90, trajPos = new Float32Array(trajN * 3);
    var trajGeo = new THREE.BufferGeometry(); trajGeo.setAttribute("position", new THREE.BufferAttribute(trajPos, 3)); trajGeo.setDrawRange(0, 0);
    var trajMat = new THREE.LineBasicMaterial({ color: C("#FF681C").multiplyScalar(1.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    var traj = new THREE.Line(trajGeo, trajMat); spin.add(traj);
    function holoLocal(ang, alt, out) { var r = HOLO.planetR * 1.02 + (HOLO.ringR - HOLO.planetR * 1.02) * Math.pow(alt, 0.85), a = ang + alt * 1.4, y = Math.sin(Math.PI * alt) * 0.35 * (1 - alt) + (1 - alt) * 0.32; return out.set(Math.cos(a) * r, y * (alt < 1 ? 1 : 0), Math.sin(a) * r); }
    var trajAng = null;
    function setTraj(ang) { if (ang === trajAng) return; trajAng = ang; for (var i = 0; i < trajN; i++) { holoLocal(ang, i / (trajN - 1), tmpV); trajPos[i * 3] = tmpV.x; trajPos[i * 3 + 1] = tmpV.y; trajPos[i * 3 + 2] = tmpV.z; } trajGeo.attributes.position.needsUpdate = true; }
    var holoPings = [];   // {ang, rot, alt, col, big, t}
    var holoState = { gold: 0, flash: 0, mothAlt: 0, mothOrbitT: -9, stream: -1, screenFlash: 0, fxAng: 0, flashed: false };
    var sA = new THREE.Vector3(), sB = new THREE.Vector3(), sC = new THREE.Vector3(), sP = new THREE.Vector3();

    /* ====================== OUTSIDE: sky, stars, mountains, field ====================== */
    var CAM_REF = V3(0, 7, 19);
    var skyMat = new THREE.ShaderMaterial({
      uniforms: { uZen: { value: C("#03060A") }, uHor: { value: C("#16283F") }, uGlowCol: { value: C("#3A4A5E") }, uGlowDir: { value: V3(0, 0, -1) }, uGlow: { value: 1 }, uIgn: { value: 0 }, uIgnCol: { value: C("#FF6A1E") }, uBand: { value: V3(0, 0, 1) } },
      vertexShader: "varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }",
      fragmentShader: [
        "uniform vec3 uZen, uHor, uGlowCol, uGlowDir, uIgnCol, uBand; uniform float uGlow, uIgn; varying vec3 vDir;",
        "float hs(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }",
        "float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);",
        "  return mix(mix(mix(hs(i), hs(i + vec3(1,0,0)), f.x), mix(hs(i + vec3(0,1,0)), hs(i + vec3(1,1,0)), f.x), f.y), mix(mix(hs(i + vec3(0,0,1)), hs(i + vec3(1,0,1)), f.x), mix(hs(i + vec3(0,1,1)), hs(i + vec3(1,1,1)), f.x), f.y), f.z); }",
        "void main(){ vec3 d = normalize(vDir); float h = d.y;",
        "  vec3 col = mix(uHor, uZen, smoothstep(-0.02, 0.32, h));",
        "  float az = max(dot(normalize(vec3(d.x, 0.0, d.z)), uGlowDir), 0.0);",
        "  float g = pow(az, 5.0) * exp(-max(h, 0.0) * 16.0);",
        "  col += uGlowCol * g * uGlow;",
        "  float gi = pow(max(dot(d, normalize(uGlowDir + vec3(0.0, 0.05, 0.0))), 0.0), 60.0);",
        "  float gh = pow(az, 12.0) * exp(-max(h, 0.0) * 30.0);",
        "  col += uIgnCol * (gi * 0.22 + gh * 0.55) * uIgn;",
        "  float band = exp(-pow(dot(d, uBand) / 0.13, 2.0));",
        "  float n = vn(d * 16.0) * 0.6 + vn(d * 42.0) * 0.4;",
        "  col += vec3(0.022, 0.028, 0.044) * band * (0.25 + n * 1.1) * smoothstep(0.0, 0.1, h);",
        "  gl_FragColor = vec4(col, 1.0);",
        "  #include <encodings_fragment>",
        "}"].join("\n"),
      side: THREE.BackSide, depthWrite: false
    });
    (function () { var d0 = V3(0, 0.12, -1).normalize(), d1 = V3(-0.7, 0.55, -0.45).normalize(); skyMat.uniforms.uBand.value.copy(d0.clone().cross(d1).normalize()); })();
    var sky = new THREE.Mesh(new THREE.SphereGeometry(5200, 48, 24), skyMat); sky.renderOrder = -100; sky.position.copy(CAM_REF); scene.add(sky);
    var starMat;
    (function buildStars() {
      var N = 2600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N), r = mulberry32(77), bandN = skyMat.uniforms.uBand.value;
      for (var i = 0; i < N; i++) {
        var az, el, tries = 0, dd;
        do { az = (r() - 0.5) * 1.7; el = Math.pow(r(), 1.5) * 0.62 + 0.004; dd = V3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)); tries++; }
        while (tries < 4 && Math.abs(dd.dot(bandN)) > 0.16 && r() < 0.45);
        var R = 4700; pos[i * 3] = CAM_REF.x + Math.sin(az) * Math.cos(el) * R; pos[i * 3 + 1] = CAM_REF.y + Math.sin(el) * R; pos[i * 3 + 2] = CAM_REF.z - Math.cos(az) * Math.cos(el) * R;
        var warm = r() < 0.18, b = 0.45 + Math.pow(r(), 3) * 1.6;
        col[i * 3] = b * (warm ? 1.0 : 0.82); col[i * 3 + 1] = b * (warm ? 0.86 : 0.9); col[i * 3 + 2] = b * (warm ? 0.72 : 1.0);
        size[i] = 0.9 + Math.pow(r(), 5) * 2.6; ph[i] = r();
      }
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aCol", new THREE.BufferAttribute(col, 3)); g.setAttribute("aSize", new THREE.BufferAttribute(size, 1)); g.setAttribute("aPh", new THREE.BufferAttribute(ph, 1));
      starMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPR: { value: 1 }, uDim: { value: 1 } },
        vertexShader: "attribute vec3 aCol; attribute float aSize, aPh; uniform float uTime, uPR, uDim; varying vec3 vC; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float tw = 0.78 + 0.22 * sin(uTime * (0.5 + aPh * 1.6) + aPh * 40.0); vC = aCol * tw * uDim; gl_PointSize = aSize * uPR; }",
        fragmentShader: "varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vC * a, 1.0);\n#include <encodings_fragment>\n}",
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      });
      var pts = new THREE.Points(g, starMat); pts.renderOrder = -90; pts.frustumCulled = false; scene.add(pts);
    })();
    // mission stars (Day 90 survivors): persistent glows in the window's sky
    function skyDir(az, el, R) { return V3(CAM_REF.x + Math.sin(az) * Math.cos(el) * R, CAM_REF.y + Math.sin(el) * R, CAM_REF.z - Math.cos(az) * Math.cos(el) * R); }
    var mStars = [];
    function demoStars() { var out = [], r = mulberry32(9); for (var i = 0; i < 7; i++) out.push({ p: skyDir((r() - 0.5) * 0.52, 0.09 + r() * 0.1, 4500), born: -99, b: 0.7 + r() * 0.5 }); return out; }
    // live: one glow per Day 90 star the snapshot names (the focus mission's own star first, brighter)
    var liveStarPos = (function () { var out = [], r = mulberry32(9); for (var i = 0; i < 96; i++) { var spread = i < 7 ? 1 : 1 + Math.min(1.6, (i - 7) / 30); out.push(skyDir((r() - 0.5) * 0.52 * spread, 0.09 + r() * 0.1 * spread, 4500)); } return out; })();
    function syncLiveStars(n, focusStar, bornFocus, bornLast) {
      n = clamp(Math.floor(n), 0, liveStarPos.length);
      var next = [];
      for (var i = 0; i < n; i++) {
        var old = mStars[i];
        var isF = focusStar && i === 0;
        next.push({ p: liveStarPos[i], born: old && old.born !== undefined ? old.born : -99, b: isF ? 1.6 : 0.7 + hsh(i, 6) * 0.5, focus: isF });
      }
      if (bornFocus && next[0]) next[0].born = clock.T;
      if (bornLast && next.length && !(focusStar && next.length === 1)) next[next.length - 1].born = clock.T;
      mStars = next;
    }
    (function buildMountains() {
      [[2300, 0.014, 0.05, "#060C14", "#0C1726", 11], [3100, 0.02, 0.066, "#081120", "#0D1A2B", 23], [4000, 0.026, 0.085, "#0B1626", "#10203A", 37]].forEach(function (L) {
        var n = 260, pos = [], col = [], idx = [], top = C(L[3]), bot = C(L[4]), D0 = L[0];
        for (var i = 0; i <= n; i++) {
          var az = -1.35 + 2.7 * i / n, x = az * 6 + L[5];
          var ridge = 1 - Math.abs(vnoise(x, 0.5, 0) * 2 - 1); ridge = 0.55 * ridge + 0.45 * fbm(x * 0.5 + 3, 1.3, 3);
          var el = L[1] + (L[2] - L[1]) * Math.pow(ridge, 1.6);
          var h = CAM_REF.y + Math.tan(el) * D0;
          pos.push(CAM_REF.x + Math.sin(az) * D0, h, CAM_REF.z - Math.cos(az) * D0, CAM_REF.x + Math.sin(az) * D0, -160, CAM_REF.z - Math.cos(az) * D0);
          col.push(top.r, top.g, top.b, bot.r, bot.g, bot.b);
          if (i < n) { var a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        }
        var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
        var mm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide })); mm.renderOrder = -80; scene.add(mm);
      });
    })();
    var GY = -8;
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), M.ground); ground.rotation.x = -Math.PI / 2; ground.position.set(0, GY, -1800); scene.add(ground);
    (function fieldLights() {
      var r = mulberry32(31), pos = [], col = [], amber = C("#F5B544"), whiteC = C("#D6E6FF");
      function road(x0, z0, x1, z1, step, c) { var len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / step); for (var i = 0; i <= n; i++) { var t = i / n; pos.push(lerp(x0, x1, t) + (r() - 0.5) * 2, GY + 1.2, lerp(z0, z1, t)); var b = 0.6 + r() * 0.8; col.push(c.r * b, c.g * b, c.b * b); } }
      road(-30, -170, -420, -900, 22, amber); road(30, -230, 520, -1100, 26, amber); road(-600, -330, 700, -360, 30, whiteC);
      road(-140, -560, 300, -720, 24, amber); road(-900, -1300, 900, -1250, 40, whiteC);
      for (var i = 0; i < 70; i++) { pos.push((r() - 0.5) * 2600, GY + 1, -260 - r() * 1700); var b = 0.4 + r(); var c = r() < 0.6 ? amber : whiteC; col.push(c.r * b, c.g * b, c.b * b); }
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      var p = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); scene.add(p);
    })();

    /* ---------- launch field: pads, ships, gantry, masts, floods ---------- */
    var PAD = V3(0, GY, -195), PADTOP = -5.2;
    box(42, 2.8, 34, M.concrete, PAD.x, PADTOP - 1.4, PAD.z);
    box(9, 0.4, 36, M.wallDark, PAD.x, PADTOP + 0.05, PAD.z);
    function lathe(points, seg) { return new THREE.LatheGeometry(points.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), seg || 32); }
    /* the concept's ship; live, its hull, trim, fins, proportions and nose come from the mission's genome,
       and three booster pods appear as the curve passes 25, 50 and 75 % */
    function buildShip(spec) {
      var g = new THREE.Group(), own = [], R = spec.R, Hh = spec.H, H1 = Hh * 0.56, IS = Hh * 0.035, H2 = Hh * 0.22, HN = Hh - H1 - IS - H2;
      var hull = M.shipWhite;
      if (spec.hull) { hull = new THREE.MeshStandardMaterial({ color: C(spec.hull), roughness: 0.52, metalness: 0.06, emissive: C("#1A222D"), emissiveIntensity: 1 }); own.push(hull); }
      var accent = new THREE.MeshStandardMaterial({ color: C(spec.accent), roughness: 0.5, metalness: 0.1, emissive: C(spec.accent), emissiveIntensity: 0.18 }); own.push(accent);
      function cyl(r0, r1, h, mat, y, open, parent) { var m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 28, 1, !!open), mat); m.position.y = y; (parent || g).add(m); return m; }
      cyl(R, R, H1, hull, H1 / 2);
      cyl(R * 1.012, R * 1.012, IS, M.shipDark, H1 + IS / 2, true);
      cyl(R * 0.97, R * 0.97, H2, hull, H1 + IS + H2 / 2);
      cyl(R * 0.985, R * 0.985, Hh * 0.024, accent, H1 + IS + H2 * 0.55, true);
      cyl(R * 1.01, R * 1.01, Hh * 0.016, accent, H1 * 0.84, true);
      var noseK = spec.noseK || 0.62, np = []; for (var i = 0; i <= 18; i++) { var t = i / 18; np.push([R * 0.97 * Math.pow(1 - t * t, noseK), H1 + IS + H2 + t * HN]); }
      g.add(new THREE.Mesh(lathe(np, 28), hull));
      cyl(R * 1.06, R, Hh * 0.03, M.shipDark, Hh * 0.015, true);
      var bellLen = Hh * 0.06, bells = [], bp = [[R * 0.16, 0], [R * 0.2, -bellLen * 0.25], [R * 0.3, -bellLen * 0.6], [R * 0.42, -bellLen]];
      var bellPos = spec.bells === 3 ? [[0, 0], [R * 0.5, 0], [-R * 0.5, 0]] : [[0, 0]];
      bellPos.forEach(function (b) { var m = new THREE.Mesh(lathe(bp, 20), M.bell); m.position.set(b[0], 0, b[1]); g.add(m); bells.push(V3(b[0], -bellLen, b[1])); });
      var noz = bells.slice(), pods = [];
      var rb = R * 0.52, hb = Hh * 0.52;
      function booster(parent, bx, bz) {
        var m1 = new THREE.Mesh(new THREE.CylinderGeometry(rb, rb, hb, 22), hull); m1.position.set(bx, hb / 2, bz); parent.add(m1);
        var cp = []; for (var i = 0; i <= 12; i++) { var t = i / 12; cp.push([rb * Math.pow(1 - t, 0.75), hb + t * rb * 2.6]); }
        var m2 = new THREE.Mesh(lathe(cp, 22), hull); m2.position.set(bx, 0, bz); parent.add(m2);
        var m3 = new THREE.Mesh(new THREE.CylinderGeometry(rb * 1.02, rb * 1.02, Hh * 0.016, 22, 1, true), M.shipDark); m3.position.set(bx, hb * 0.82, bz); parent.add(m3);
        var bb = new THREE.Mesh(lathe([[rb * 0.3, 0], [rb * 0.5, -bellLen * 0.6], [rb * 0.7, -bellLen * 0.9]], 18), M.bell); bb.position.set(bx, 0, bz); parent.add(bb);
      }
      if (spec.boosters) {
        [-1, 1].forEach(function (s) { var bx = s * (R + rb + 0.12); booster(g, bx, 0); noz.push(V3(bx, -bellLen * 0.9, 0)); });
      } else {
        var nf = spec.fins === 3 ? 3 : 4;
        for (var f = 0; f < nf; f++) { var fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, Hh * 0.12, R * 0.9), M.shipDark); var a = f * Math.PI * 2 / nf + Math.PI / 4; fin.position.set(Math.cos(a) * R * 1.3, Hh * 0.06, Math.sin(a) * R * 1.3); fin.rotation.y = -a; g.add(fin); }
      }
      if (spec.pods) {
        [Math.PI / 2 + Math.PI * 2 / 3, Math.PI / 2 + Math.PI * 4 / 3, Math.PI / 2].forEach(function (a) {
          var pod = new THREE.Group(), d = R + rb + 0.12; pod.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); booster(pod, 0, 0);
          pod.visible = false; pod.userData.noz = V3(0, -bellLen * 0.9, 0); g.add(pod); pods.push(pod);
        });
      }
      g.userData = { nozzles: noz, bellLen: bellLen, H: Hh, R: R, pods: pods };
      var flames = [];
      noz.forEach(function (n, i) { flames.push(addFlame(g, n, i < bells.length ? R * 0.4 : R * 0.34, i < bells.length ? 17 : 12, own)); });
      pods.forEach(function (pod) { var fm = addFlame(pod, pod.userData.noz, R * 0.34, 12, own); flames.push(fm); });
      var rig = { ship: g, flames: flames, pods: pods, own: own, base: PADTOP + bellLen + 0.5, podsOn: 0, active: noz.slice() };
      g.position.set(PAD.x, rig.base, PAD.z);
      return rig;
    }
    var flameMat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 }, uTime: { value: 0 }, c0: { value: COL.fire1 }, c1: { value: COL.fire2 }, c2: { value: COL.fire3 } },
      vertexShader: "varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform float uI, uTime; uniform vec3 c0, c1, c2; varying vec2 vUv; varying vec3 vN;",
        "void main(){ float y = vUv.y; float e = pow(clamp(abs(vN.z), 0.0, 1.0), 1.2); vec3 hot = vec3(2.4, 2.0, 1.4);",
        "  vec3 col = y < 0.12 ? mix(hot, c0 * 2.0, y / 0.12) : (y < 0.5 ? mix(c0 * 2.0, c1 * 1.6, (y - 0.12) / 0.38) : mix(c1 * 1.6, c2 * 0.8, (y - 0.5) / 0.5));",
        "  float a = (1.0 - smoothstep(0.42, 1.0, y)) * (0.3 + 0.7 * e) * uI * (0.92 + 0.08 * sin(uTime * 16.0 + y * 18.0));",
        "  gl_FragColor = vec4(col * a * 0.5, 1.0);",
        "  #include <encodings_fragment>",
        "}"].join("\n"),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    function addFlame(parent, n, r0, Lf, own) {
      var mat = flameMat.clone(); own.push(mat);
      var m = new THREE.Mesh(lathe([[r0 * 0.9, 0], [r0 * 1.25, -Lf * 0.12], [r0 * 1.3, -Lf * 0.3], [r0 * 1.05, -Lf * 0.55], [r0 * 0.6, -Lf * 0.8], [0.05, -Lf]], 20), mat);
      m.position.copy(n); m.visible = false; m.renderOrder = 6; parent.add(m); return m;
    }
    function setPods(rig, n) {
      n = clamp(n, 0, rig.pods.length); if (n === rig.podsOn) return false;
      rig.podsOn = n; rig.active = rig.ship.userData.nozzles.slice();
      rig.pods.forEach(function (pod, i) { pod.visible = i < n; if (i < n) rig.active.push(V3(pod.position.x, pod.userData.noz.y, pod.position.z)); });
      return true;
    }
    function disposeRig(rig) {
      if (!rig) return;
      if (rig.ship.parent) rig.ship.parent.remove(rig.ship);
      rig.ship.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
      rig.own.forEach(function (m) { m.dispose(); });
    }
    var demoRig = buildShip({ R: 2.5, H: 44, boosters: true, bells: 3, accent: "#FF681C" });
    demoRig.ship.visible = false; scene.add(demoRig.ship);
    var liveRig = null, liveRigId = null;
    var HEX = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
    function genomeSpec(gn) {
      gn = gn || {};
      return { R: 2.5 * clamp(isNum(gn.radius) ? gn.radius : 1, 0.7, 1.4), H: 44 * clamp(isNum(gn.length) ? gn.length : 1, 0.75, 1.3), boosters: false, pods: true, bells: 3,
        accent: HEX.test(gn.accent || "") ? gn.accent : "#FF681C", hull: HEX.test(gn.base || "") ? gn.base : "#BFC8D3", fins: gn.fins === 3 ? 3 : 4, noseK: lerp(0.4, 0.95, sat(isNum(gn.nose) ? gn.nose : 0.5)) };
    }
    function setFocusShip(rec) {
      var id = rec ? rec.id : null;
      if (id === liveRigId) return;
      disposeRig(liveRig); liveRig = null; liveRigId = id;
      if (!rec) return;
      liveRig = buildShip(genomeSpec(rec.ship));
      liveRig.ship.visible = false; scene.add(liveRig.ship);
      fireP.n = 0; smokeP.n = 0;
    }
    // gantry tower (instanced struts)
    var gantry = new THREE.Group(); scene.add(gantry);
    var GX = 11.5, GZ = PAD.z - 1, GH = 54, GW = 6;
    (function buildGantry() {
      var list = [];
      function strut(a, b, t) { list.push([a, b, t]); }
      var hw = GW / 2, cs = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
      cs.forEach(function (c) { strut(V3(GX + c[0], GY, GZ + c[1]), V3(GX + c[0], GY + GH, GZ + c[1]), 0.45); });
      for (var y = GY + 3; y < GY + GH; y += 4.2) {
        for (var i = 0; i < 4; i++) { var a = cs[i], b = cs[(i + 1) % 4]; strut(V3(GX + a[0], y, GZ + a[1]), V3(GX + b[0], y, GZ + b[1]), 0.3); strut(V3(GX + a[0], y, GZ + a[1]), V3(GX + b[0], y + 4.2, GZ + b[1]), 0.18); }
      }
      strut(V3(GX, GY + GH, GZ), V3(GX, GY + GH + 9, GZ), 0.35);
      var im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.steel, list.length);
      list.forEach(function (s, i) { var d = s[1].clone().sub(s[0]), L = d.length(); tmpQ.setFromUnitVectors(YAX, d.normalize()); tmpM.compose(s[0].clone().add(s[1]).multiplyScalar(0.5), tmpQ, V3(s[2], L, s[2])); im.setMatrixAt(i, tmpM); });
      gantry.add(im);
    })();
    var arms = [];
    [24, 37].forEach(function (h) {
      var pivot = new THREE.Group(); pivot.position.set(GX - GW / 2, GY + h, GZ + 1); scene.add(pivot);
      var len = GX - GW / 2 - 2.5 - 0.4;
      box(len, 1.3, 1.6, M.steel, -len / 2, 0, 0, pivot);
      arms.push({ pivot: pivot, h: h });
    });
    var masts = [V3(-26, GY, -178), V3(28, GY, -214), V3(-10, GY, -236)];
    masts.forEach(function (p) { var m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 66, 8), M.steel); m.position.set(p.x, GY + 33, p.z); scene.add(m); });
    (function wires() {
      var pts = [], wm = new THREE.LineBasicMaterial({ color: C("#5A6A80"), transparent: true, opacity: 0.5 });
      for (var i = 0; i < 3; i++) { var a = masts[i], b = masts[(i + 1) % 3]; for (var k = 0; k < 24; k++) { var t0 = k / 24, t1 = (k + 1) / 24; [t0, t1].forEach(function (t) { pts.push(lerp(a.x, b.x, t), GY + 66 - Math.sin(Math.PI * t) * 9, lerp(a.z, b.z, t)); }); } }
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); scene.add(new THREE.LineSegments(g, wm));
    })();
    var floods = [V3(-58, GY, -158), V3(55, GY, -164), V3(-52, GY, -246), V3(63, GY, -240)];
    var coneMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: TX.cone }, uCol: { value: C("#FFE9CF") }, uI: { value: 1 } },
      vertexShader: "varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform sampler2D uMap; uniform vec3 uCol; uniform float uI; varying vec2 vUv; varying vec3 vN; void main(){ float e = pow(clamp(abs(vN.z), 0.0, 1.0), 1.6); float a = texture2D(uMap, vec2(0.5, 1.0 - vUv.y)).a; gl_FragColor = vec4(uCol * a * e * 0.075 * uI, 1.0);\n#include <encodings_fragment>\n}",
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    floods.forEach(function (p, i) {
      var t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 26, 6), M.steel); t.position.set(p.x, GY + 13, p.z); scene.add(t);
      box(4, 1.6, 1.2, M.steel, p.x, GY + 26.6, p.z);
      var lamp = V3(p.x, GY + 26.6, p.z), target = V3(PAD.x + (i % 2 ? -3 : 3), 8 + i * 3, PAD.z), dir = lamp.clone().sub(target), L = dir.length();
      var cm = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 13, L, 24, 1, true), coneMat); cm.position.copy(lamp.clone().add(target).multiplyScalar(0.5)); cm.quaternion.setFromUnitVectors(YAX, dir.normalize()); scene.add(cm);
    });
    flood1.target.position.set(PAD.x, 19, PAD.z); flood2.target.position.set(PAD.x, 23, PAD.z);
    var DIST = [[-0.227, 560, 30], [-0.105, 960, 26], [0.131, 720, 28], [0.253, 1150, 30], [0.031, 1480, 26]].map(function (d, i) {
      return { p: V3(CAM_REF.x + Math.sin(d[0]) * d[1], GY, CAM_REF.z - Math.cos(d[0]) * d[1]), H: d[2], i: i, a: 2.0 + hsh(i, 4) * 1.1 };
    });
    var apronMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: TX.apron }, uI: { value: [1, 1, 1, 1, 1, 1] }, uFire: { value: [0, 0, 0, 0, 0, 0] }, uLamp: { value: C("#FFE2BE") }, uHot: { value: C("#FF6A1E") } },
      vertexShader: "attribute float aPad; varying vec2 vUv; varying float vPad; void main(){ vUv = uv; vPad = aPad; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform sampler2D uMap; uniform float uI[6]; uniform float uFire[6]; uniform vec3 uLamp, uHot; varying vec2 vUv; varying float vPad;\nvoid main(){ int k = int(vPad + 0.5); float I = 0.0, F = 0.0; for (int j = 0; j < 6; j++){ if (j == k){ I = uI[j]; F = uFire[j]; } } float a = texture2D(uMap, vUv).a; gl_FragColor = vec4((uLamp * I * 0.55 + uHot * F * 2.2) * a, 1.0);\n#include <encodings_fragment>\n}",
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    (function buildAprons() {
      var pos = [], uv = [], pad = [], idx = [];
      var list = [{ p: PAD, s: 150 }].concat(DIST.map(function (d) { return { p: d.p, s: 70 }; }));
      list.forEach(function (it, k) { var b = pos.length / 3, h = it.s / 2; [[-h, -h, 0, 0], [h, -h, 1, 0], [h, h, 1, 1], [-h, h, 0, 1]].forEach(function (q) { pos.push(it.p.x + q[0], GY + 0.15, it.p.z + q[1]); uv.push(q[2], q[3]); pad.push(k); }); idx.push(b, b + 2, b + 1, b, b + 3, b + 2); });
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("aPad", new THREE.Float32BufferAttribute(pad, 1)); g.setIndex(idx);
      var m = new THREE.Mesh(g, apronMat); m.renderOrder = 2; scene.add(m);
    })();
    // distant ships (DEMO: the window's fair start — they lift off at the same T-0; live, the far pads stand empty)
    var ACC = ["#5CBDFF", "#F5B544", "#FFC7A1", "#B9C6D6", "#E8DCC8"], distOwn = [];
    DIST.forEach(function (d, i) {
      var rig = buildShip({ R: 1.8, H: d.H, boosters: i % 2 === 0, bells: 1, accent: ACC[i] });
      rig.flames.forEach(function (f) { f.parent.remove(f); f.geometry.dispose(); }); distOwn = distOwn.concat(rig.own);
      var s = rig.ship; d.base = GY + 2.2 + s.userData.bellLen; s.position.set(d.p.x, d.base, d.p.z); s.visible = false; scene.add(s); d.ship = s;
      box(16, 2.2, 16, M.concrete, d.p.x, GY + 1.1, d.p.z);
      box(2.6, d.H * 1.1, 2.6, M.steel, d.p.x + 4.5, GY + d.H * 0.55, d.p.z - 0.5);
    });
    var fogMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: TX.fog }, uTime: { value: 0 }, uCol: { value: C("#4E6079") }, uHot: { value: C("#FF7A33") }, uIgn: { value: 0 }, uFlood: { value: 1 }, uPad: { value: new THREE.Vector2(PAD.x, PAD.z) }, uOp: { value: 0.12 }, uSpd: { value: 1 } },
      vertexShader: "varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: "uniform sampler2D uMap; uniform float uTime, uIgn, uFlood, uOp, uSpd; uniform vec3 uCol, uHot; uniform vec2 uPad; varying vec2 vUv; varying vec3 vW;\nvoid main(){ vec2 q = vUv * vec2(3.0, 1.6); float a = texture2D(uMap, q + vec2(uTime * 0.004 * uSpd, 0.0)).a * texture2D(uMap, q * 0.55 + vec2(-uTime * 0.0025 * uSpd, 0.3)).a * 1.7; float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.7, vUv.y); float dp = length(vW.xz - uPad); vec3 c = uCol * (0.45 + 0.55 * uFlood) * (0.6 + 0.6 * exp(-dp / 180.0)) + uHot * uIgn * exp(-dp / 95.0) * 0.85; gl_FragColor = vec4(c, a * edge * uOp);\n#include <encodings_fragment>\n}",
      transparent: true, depthWrite: false
    });
    var fogLayers = [];
    [[-7.0, 0.12, 1], [-5.4, 0.1, -0.8], [-3.6, 0.075, 1.3], [-1.8, 0.05, -1.1]].forEach(function (f) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(1600, 900), fogMat.clone()); m.material.uniforms.uMap.value = TX.fog;
      m.material.uniforms.uOp.value = f[1]; m.material.uniforms.uSpd.value = f[2];
      m.rotation.x = -Math.PI / 2; m.position.set(0, f[0], -480); m.renderOrder = 3; scene.add(m); fogLayers.push(m);
    });

    /* ---------- static light points (gantry, masts, floods, distant pads) ---------- */
    var lamps = [];
    for (var gy = 6; gy < GH; gy += 8) lamps.push({ p: V3(GX - GW / 2 - 0.3, GY + gy, GZ + GW / 2 + 0.3), col: COL.lamp, size: 1.6, minPx: 3, kind: "steady", grp: "gantry" });
    lamps.push({ p: V3(GX, GY + GH + 9.3, GZ), col: COL.red, size: 2.4, minPx: 5, kind: "blink", hz: 1, ph: 0, grp: "beacon" });
    masts.forEach(function (m, i) { lamps.push({ p: V3(m.x, GY + 66.5, m.z), col: COL.red, size: 2.2, minPx: 4, kind: "blink", hz: 0.5, ph: i * 0.33, grp: "beacon" }); });
    arms.forEach(function (a) { lamps.push({ p: V3(GX - GW / 2 - 1, GY + a.h + 0.9, GZ + 1.2), col: COL.warn, size: 1.2, minPx: 3, kind: "steady", grp: "gantry" }); });
    floods.forEach(function (p) { for (var k = -1; k <= 1; k++) lamps.push({ p: V3(p.x + k * 1.3, GY + 26.6, p.z + 0.8), col: COL.lamp, size: 3.2, minPx: 6, kind: "steady", grp: "flood" }); });
    DIST.forEach(function (d, i) {
      lamps.push({ p: V3(d.p.x + 4.5, GY + d.H * 1.12, d.p.z), col: COL.red, size: 3, minPx: 3, kind: "blink", hz: 0.5, ph: i * 0.21, grp: "beacon" });
      lamps.push({ p: V3(d.p.x - 7, GY + 10, d.p.z + 6), col: COL.lamp, size: 5, minPx: 4, kind: "steady", grp: "flood" });
      lamps.push({ p: V3(d.p.x + 8, GY + 9, d.p.z + 5), col: COL.lamp, size: 5, minPx: 4, kind: "steady", grp: "flood" });
    });

    /* ---------- light shafts + dust motes (room) ---------- */
    var shaftMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: TX.beam }, uCol: { value: C("#9FC4EA") }, uI: { value: 0.25 }, uTime: { value: 0 } },
      vertexShader: "varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
      fragmentShader: "uniform sampler2D uMap; uniform vec3 uCol; uniform float uI, uTime; varying vec2 vUv; varying vec3 vW;\nvoid main(){ float a = texture2D(uMap, vUv).a; float n = 0.82 + 0.18 * sin(vW.y * 1.7 + vW.x * 0.6 + uTime * 0.35); gl_FragColor = vec4(uCol * a * n * uI * 0.32, 1.0);\n#include <encodings_fragment>\n}",
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    var SHAFTS = [];
    (function buildShafts() {
      var pos = [], uv = [], idx = [];
      function quad(A, B, side, wA, wB) { var b = pos.length / 3; [[A, -wA, 0, 0], [A, wA, 1, 0], [B, wB, 1, 1], [B, -wB, 0, 1]].forEach(function (q) { var p = q[0].clone().addScaledVector(side, q[1]); pos.push(p.x, p.y, p.z); uv.push(q[2], q[3]); }); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
      [-9.2, -4.6, 0, 4.6, 9.2].forEach(function (x) {
        var A = V3(x, 12.2, -15.6), B = V3(x * 1.2, 0.2, 2.5), axis = B.clone().sub(A).normalize();
        var s1 = V3(1, 0, 0), s2 = axis.clone().cross(s1).normalize();
        quad(A, B, s1, 1.25, 2.3); quad(A, B, s2, 1.25, 2.3);
        SHAFTS.push({ A: A, B: B });
      });
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      var m = new THREE.Mesh(g, shaftMat); m.renderOrder = 8; scene.add(m);
    })();
    var moteMat;
    (function buildMotes() {
      var N = 900, pos = new Float32Array(N * 3), ph = new Float32Array(N), t = new Float32Array(N), r = mulberry32(5);
      for (var i = 0; i < N; i++) { var s = SHAFTS[Math.floor(r() * SHAFTS.length)], k = Math.pow(r(), 0.8); var p = s.A.clone().lerp(s.B, k); var w = lerp(1.6, 2.8, k); pos[i * 3] = p.x + (r() - 0.5) * w * 1.6; pos[i * 3 + 1] = p.y + (r() - 0.5) * w; pos[i * 3 + 2] = p.z + (r() - 0.5) * w; ph[i] = r(); t[i] = k; }
      var g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("aPh", new THREE.BufferAttribute(ph, 1)); g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
      moteMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uI: { value: 0.3 }, uCol: { value: C("#CFE4FA") }, uPR: { value: 1 }, uCount: { value: 1 } },
        vertexShader: "attribute float aPh, aT; uniform float uTime, uI, uPR, uCount; varying float vA; void main(){ vec3 p = position + vec3(sin(uTime * 0.13 + aPh * 30.0), sin(uTime * 0.09 + aPh * 17.0) * 0.6, cos(uTime * 0.11 + aPh * 23.0)) * 0.55; vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; float tw = 0.5 + 0.5 * sin(uTime * (0.4 + aPh) + aPh * 50.0); vA = uI * tw * (1.0 - aT * 0.6) * step(aPh, uCount); gl_PointSize = clamp(uPR * 34.0 / -mv.z, 1.0, 5.0); }",
        fragmentShader: "uniform vec3 uCol; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(uCol * a, 1.0);\n#include <encodings_fragment>\n}",
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      });
      var motes = new THREE.Points(g, moteMat); motes.frustumCulled = false; motes.renderOrder = 9; scene.add(motes);
    })();

    /* ---------- glass + floor reflections ---------- */
    var glassMat = new THREE.MeshBasicMaterial({ map: TX.glass, color: C("#8FB7E0").multiplyScalar(0.08), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    var glass = new THREE.Mesh(new THREE.PlaneGeometry(23, 13), glassMat); glass.position.set(0, 8.1, -15.7); glass.renderOrder = 10; scene.add(glass);
    var floorWinMat = new THREE.MeshBasicMaterial({ map: TX.floorWin, color: C("#7FA8D6").multiplyScalar(0.18), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    var floorWin = new THREE.Mesh(new THREE.PlaneGeometry(23, 15), floorWinMat); floorWin.rotation.x = -Math.PI / 2; floorWin.position.set(0, 0.01, -15.6 + 7.5); floorWin.renderOrder = 1; scene.add(floorWin);
    var holoFloorMat = new THREE.MeshBasicMaterial({ map: TX.apron, color: C("#4FB8FF").multiplyScalar(0.22), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    var holoFloor = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), holoFloorMat); holoFloor.rotation.x = -Math.PI / 2; holoFloor.position.set(HOLO.c.x, 0.012, HOLO.c.z); holoFloor.renderOrder = 1; scene.add(holoFloor);
    [-1, 1].forEach(function (s) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(5, 9), new THREE.MeshBasicMaterial({ map: TX.floorWin, color: C("#4FB8FF").multiplyScalar(0.07), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
      m.rotation.set(-Math.PI / 2, 0, -s * 0.7573); m.position.set(s * 14.3, 0.012, -10.0); m.renderOrder = 1; scene.add(m);
    });

    /* ====================== CANVAS UIs (screens) ====================== */
    function chart(g, x, y, w, h, data, color, fill, lo, hi) {
      if (!data || data.length < 2) return;
      var mn = lo !== undefined ? lo : Math.min.apply(null, data), mx = hi !== undefined ? hi : Math.max.apply(null, data); if (mx - mn < 1e-4) { mx += 0.01; mn -= 0.01; }
      g.beginPath();
      for (var i = 0; i < data.length; i++) { var px = x + w * i / (data.length - 1), py = y + h - (data[i] - mn) / (mx - mn) * h; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
      if (fill) { g.save(); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); var gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, fill); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fill(); g.restore();
        g.beginPath(); for (var j = 0; j < data.length; j++) { var qx = x + w * j / (data.length - 1), qy = y + h - (data[j] - mn) / (mx - mn) * h; if (j) g.lineTo(qx, qy); else g.moveTo(qx, qy); } }
      g.strokeStyle = color; g.lineWidth = 2.4; g.lineJoin = "round"; g.stroke();
    }
    function fitText(g, text, weight, size, family, maxW) { g.font = weight + " " + size + "px " + family; var w = g.measureText(text).width; if (w > maxW) { size = Math.max(10, Math.floor(size * maxW / w)); g.font = weight + " " + size + "px " + family; } return size; }
    function slotBg(g) { var bg = g.createLinearGradient(0, 0, 0, 128); bg.addColorStop(0, "#0B1826"); bg.addColorStop(1, "#060C14"); g.fillStyle = bg; g.fillRect(0, 0, 256, 128); g.textBaseline = "alphabetic"; g.textAlign = "left"; }
    var STATUS = ["WINDOW 21:00 UTC", "PAD 1 · $MOTH", "RANGE", "CURVE · CLASSIC", "FAIR START", "CREW 4/4"];
    function drawSlotDemo(g, x, y, s, mode) {
      g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, 256, 128); g.clip();
      slotBg(g);
      var e = Show.e, L = e - 10;
      if (mode === "count") {
        var n = Math.max(0, 10 - Math.floor(e)), pulseCol = n <= 3 ? "#FFB062" : "#F5B544";
        g.fillStyle = "#8A97A8"; g.font = "600 13px " + MONO; g.fillText(STATUS[s % STATUS.length], 12, 22);
        g.fillStyle = "#22C55E"; g.textAlign = "right"; g.fillText("GO", 244, 22); g.textAlign = "left";
        g.fillStyle = pulseCol; g.font = "700 58px " + SANS; g.fillText("T-" + p2(n), 12, 92);
        g.fillStyle = "#C9D6E6"; g.font = "500 12px " + MONO; g.fillText("$MOTH · CREW OF 4", 12, 116);
      } else if (mode === "ascent") {
        g.fillStyle = "#FF9A5C"; g.font = "600 13px " + MONO; g.fillText("ASCENT · $MOTH", 12, 22);
        g.fillStyle = "#8A97A8"; g.textAlign = "right"; g.fillText("T+" + p2(Math.max(0, Math.floor(L))), 244, 22); g.textAlign = "left";
        g.fillStyle = "#F5F7FA"; g.font = "700 46px " + SANS; g.fillText(Math.floor(Show.alt * 100) + "%", 12, 76);
        g.fillStyle = "#8A97A8"; g.font = "500 12px " + MONO; g.fillText("HOLDERS " + Show.hold, 12, 112);
        chart(g, 130, 34, 114, 80, Show.altHist, "#FF8A4C", "rgba(255,104,28,0.35)", 0, 1);
      } else if (mode === "orbit") {
        g.fillStyle = "#F5B544"; g.font = "600 13px " + MONO; g.fillText("ORBIT · $MOTH", 12, 22);
        g.font = "700 50px " + SANS; g.fillText("ORBIT", 12, 80);
        g.font = "600 13px " + MONO; g.fillText("+$123.64 TO CREW OF 4", 12, 112);
      } else {
        var kind = [0, 0, 1, 0, 2, 3, 0, 4][s % 8], fl = sim.flight.length ? sim.flight : sim.orbit, m = fl[(s * 5 + 3) % fl.length];
        if (kind === 0 && m) {
          g.fillStyle = "#F5F7FA"; g.font = "700 17px " + SANS; g.fillText("$" + m.tk, 12, 26);
          g.fillStyle = m.state === "orbit" ? "#F5B544" : "#4FB8FF"; g.font = "600 13px " + MONO; g.textAlign = "right";
          g.fillText(m.state === "orbit" ? "ORBIT · D" + m.day : "ALT " + Math.floor(m.alt * 100) + "%", 244, 26); g.textAlign = "left";
          g.strokeStyle = "rgba(255,255,255,0.06)"; g.lineWidth = 1; for (var gl = 0; gl < 4; gl++) { g.beginPath(); g.moveTo(12, 40 + gl * 18); g.lineTo(244, 40 + gl * 18); g.stroke(); }
          var h = m.hist, up = h[h.length - 1] >= h[Math.max(0, h.length - 8)];
          chart(g, 12, 38, 232, 58, h.slice(-40), up ? "#22C55E" : "#EF4444", up ? "rgba(34,197,94,0.28)" : "rgba(239,68,68,0.25)");
          g.fillStyle = "#8A97A8"; g.font = "500 12px " + MONO; g.fillText("MCAP " + kusd(m.mcap) + "  ×" + (m.mcap / 5000).toFixed(1), 12, 116);
        } else if (kind === 1) {
          g.fillStyle = "#8A97A8"; g.font = "600 12px " + MONO; g.fillText("GO / NO-GO · WINDOW 21:00", 12, 22);
          for (var k = 0; k < 4; k++) { var lab = STATUS[(s + k) % STATUS.length]; g.fillStyle = "#C9D6E6"; g.font = "500 12px " + MONO; g.fillText(lab, 26, 46 + k * 21); g.fillStyle = "#22C55E"; g.beginPath(); g.arc(15, 42 + k * 21, 4, 0, 6.283); g.fill(); g.textAlign = "right"; g.fillText("GO", 244, 46 + k * 21); g.textAlign = "left"; }
        } else if (kind === 2) {
          g.fillStyle = "#8A97A8"; g.font = "600 12px " + MONO; g.fillText("TAPE · ALL MISSIONS", 12, 22);
          for (var t = 0; t < 4 && t < sim.tape.length; t++) { var tr = sim.tape[t]; g.fillStyle = "#E6EEF8"; g.font = "600 12px " + MONO; g.fillText("$" + tr.tk, 12, 46 + t * 21); g.fillStyle = tr.buy ? "#22C55E" : "#EF4444"; g.fillText((tr.buy ? "BUY " : "SELL ") + usd0(tr.amt), 104, 46 + t * 21); }
        } else if (kind === 3 && m) {
          g.fillStyle = "#8A97A8"; g.font = "600 12px " + MONO; g.fillText("$" + m.tk + " · CREW SPLIT", 12, 22);
          m.crew.slice(0, 4).forEach(function (c, i) { g.fillStyle = "#C9D6E6"; g.font = "500 12px " + MONO; g.fillText(c.name, 12, 46 + i * 20); g.fillStyle = "rgba(79,184,255,0.25)"; g.fillRect(110, 38 + i * 20, 120, 7); g.fillStyle = "#4FB8FF"; g.fillRect(110, 38 + i * 20, 120 * c.split / 60, 7); });
        } else {
          g.fillStyle = "#8A97A8"; g.font = "600 12px " + MONO; g.fillText("IN ORBIT · " + sim.orbit.length + " MISSIONS", 12, 22);
          sim.orbit.slice(-4).reverse().forEach(function (o, i) { g.fillStyle = "#E6EEF8"; g.font = "600 12px " + MONO; g.fillText("$" + o.tk, 12, 46 + i * 21); g.fillStyle = "#4FB8FF"; g.fillText("DAY " + o.day, 110, 46 + i * 21); g.fillStyle = "#8A97A8"; g.textAlign = "right"; g.fillText(kusd(o.mcap), 244, 46 + i * 21); g.textAlign = "left"; });
        }
      }
      g.fillStyle = "rgba(245,181,68,0.85)"; g.font = "600 9px " + MONO; g.textAlign = "right"; g.fillText("DEMO", 248, 124); g.textAlign = "left";
      g.restore();
    }
    var PHASE_WORD = { pad: "ON THE PAD", ascent: "ASCENT", orbit: "ORBIT", star: "STAR", lost: "SIGNAL LOST" };
    var PHASE_COL = { pad: "#8A97A8", ascent: "#FF9A5C", orbit: "#F5B544", star: "#F5B544", lost: "#B9C6D6" };
    var CHECK_WORD = { alive: "PASSED", quiet: "SIGNAL LOST", young: "AHEAD", unread: "NOT READ" };
    var CHECK_COL = { alive: "#22C55E", quiet: "#B9C6D6", young: "#8A97A8", unread: "#56657A" };
    function holdTxt(r) { return r.holders == null ? "—" : nf0.format(r.holders) + (r.holdersAtLeast ? "+" : ""); }
    function drawSlotLive(g, x, y, s) {
      g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, 256, 128); g.clip();
      slotBg(g);
      var f = live.focus, list = live.list;
      if (!live.ready || !list.length) {
        g.fillStyle = "#8A97A8"; g.font = "600 12px " + MONO; g.fillText(live.ready ? "THE SKY · " + livePillText() : "MISSION CONTROL", 12, 22);
        g.fillStyle = "#C9D6E6"; g.font = "600 17px " + SANS; g.fillText(live.ready ? "No missions in flight" : "Reading the chain…", 12, 70);
        if (live.ready) { g.fillStyle = "#8A97A8"; g.font = "500 12px " + MONO; g.fillText("RIGHT NOW", 12, 92); }
        g.restore(); return;
      }
      if (f && s % 2 === 0) {
        var pc = PHASE_COL[f.phase] || "#8A97A8";
        g.fillStyle = pc; fitText(g, PHASE_WORD[f.phase] + " · " + f.ticker, "600", 13, MONO, 170); g.fillText(PHASE_WORD[f.phase] + " · " + f.ticker, 12, 22);
        g.fillStyle = "#8A97A8"; g.font = "600 13px " + MONO; g.textAlign = "right"; g.fillText(f.day != null ? "DAY " + f.day : "", 244, 22); g.textAlign = "left";
        if (f.phase === "ascent" || f.phase === "pad") {
          g.fillStyle = "#F5F7FA"; g.font = "700 46px " + SANS; g.fillText(f.altPct == null ? "—" : Math.floor(f.altPct) + "%", 12, 76);
          g.fillStyle = "#8A97A8"; g.font = "500 12px " + MONO; g.fillText("HOLDERS " + holdTxt(f), 12, 112);
          chart(g, 130, 34, 114, 80, f.hist, "#FF8A4C", "rgba(255,104,28,0.35)", 0, 1);
        } else {
          g.fillStyle = pc; g.font = "700 40px " + SANS; g.fillText(f.phase === "star" ? "DAY 90" : f.phase === "lost" ? "LOST" : "ORBIT", 12, 74);
          g.font = "600 12px " + MONO;
          for (var c = 0; c < 3; c++) { var st = f.checks[c]; g.fillStyle = CHECK_COL[st] || "#56657A"; g.fillText("D" + CHECK_DAYS[c] + " " + (st === "alive" ? "✓" : st === "quiet" ? "×" : "·"), 12 + c * 76, 110); }
        }
        g.restore(); return;
      }
      var kind = [0, 0, 1, 0, 2, 3, 0, 4][s % 8], m = list[(s * 5 + 3) % list.length];
      if (kind === 0 && m) {
        g.fillStyle = "#F5F7FA"; fitText(g, m.ticker, "700", 17, SANS, 140); g.fillText(m.ticker, 12, 26);
        g.fillStyle = m.phase === "ascent" ? "#4FB8FF" : (PHASE_COL[m.phase] || "#8A97A8"); g.font = "600 13px " + MONO; g.textAlign = "right";
        g.fillText(m.phase === "ascent" ? "ALT " + (m.altPct == null ? "—" : Math.floor(m.altPct) + "%") : m.phase === "orbit" ? "ORBIT" + (m.day != null ? " · D" + m.day : "") : PHASE_WORD[m.phase], 244, 26); g.textAlign = "left";
        g.strokeStyle = "rgba(255,255,255,0.06)"; g.lineWidth = 1; for (var gl2 = 0; gl2 < 4; gl2++) { g.beginPath(); g.moveTo(12, 40 + gl2 * 18); g.lineTo(244, 40 + gl2 * 18); g.stroke(); }
        var h = m.hist;
        if (h.length > 1) { var up = h[h.length - 1] >= h[Math.max(0, h.length - 8)]; chart(g, 12, 38, 232, 58, h.slice(-40), up ? "#22C55E" : "#EF4444", up ? "rgba(34,197,94,0.28)" : "rgba(239,68,68,0.25)", 0, 1); }
        g.fillStyle = "#8A97A8"; g.font = "500 12px " + MONO;
        g.fillText("HOLDERS " + holdTxt(m) + (isNum(m.marketCapUsd) ? "  MCAP " + kusd(m.marketCapUsd) : ""), 12, 116);
      } else if (kind === 1) {
        var r = f || list[0];
        g.fillStyle = "#8A97A8"; g.font = "600 12px " + MONO; g.fillText("STATUS · " + r.ticker, 12, 22);
        var rows = [["NETWORK", livePillText().replace("LIVE · ", "") || "—"], ["PHASE", PHASE_WORD[r.phase]], ["ALTITUDE", r.altPct == null ? "—" : r.altPct.toFixed(1) + "%"], ["HOLDERS", holdTxt(r)]];
        rows.forEach(function (row, k) { g.fillStyle = "#4FB8FF"; g.beginPath(); g.arc(15, 42 + k * 21, 4, 0, 6.283); g.fill(); g.fillStyle = "#C9D6E6"; g.font = "500 12px " + MONO; g.fillText(row[0], 26, 46 + k * 21); g.textAlign = "right"; g.fillStyle = "#E6EEF8"; g.fillText(row[1], 244, 46 + k * 21); g.textAlign = "left"; });
      } else if (kind === 2) {
        g.fillStyle = "#8A97A8"; g.font = "600 12px " + MONO; g.fillText("TAPE · ALL MISSIONS", 12, 22);
        if (!live.tape.length) { g.fillStyle = "#56657A"; g.fillText("WAITING FOR THE NEXT TRADE", 12, 50); }
        for (var t = 0; t < 4 && t < live.tape.length; t++) { var tr = live.tape[t]; g.fillStyle = tr.own ? "#FF9A5C" : "#E6EEF8"; g.font = "600 12px " + MONO; g.fillText(tr.tk.slice(0, 11), 12, 46 + t * 21); g.fillStyle = tr.buy ? "#22C55E" : "#EF4444"; g.fillText((tr.buy ? "BUY " : "SELL ") + (tr.usd == null ? "" : usd0(tr.usd)), 112, 46 + t * 21); }
      } else if (kind === 3 && m) {
        g.fillStyle = "#8A97A8"; g.font = "600 12px " + MONO; g.fillText(m.ticker + " · CREW", 12, 22);
        if (!m.crew.length) { g.fillStyle = "#56657A"; g.fillText("—", 12, 46); }
        m.crew.slice(0, 4).forEach(function (cr, i) { g.fillStyle = "#C9D6E6"; g.font = "500 12px " + MONO; g.fillText(cr, 12, 46 + i * 20); });
      } else {
        var orb = list.filter(function (o) { return o.phase === "orbit"; });
        g.fillStyle = "#8A97A8"; g.font = "600 12px " + MONO; g.fillText("IN ORBIT · " + orb.length + (orb.length === 1 ? " MISSION" : " MISSIONS"), 12, 22);
        orb.slice(0, 4).forEach(function (o, i) { g.fillStyle = "#E6EEF8"; g.font = "600 12px " + MONO; g.fillText(o.ticker.slice(0, 11), 12, 46 + i * 21); g.fillStyle = "#4FB8FF"; g.fillText(o.day != null ? "DAY " + o.day : "", 110, 46 + i * 21); g.fillStyle = "#8A97A8"; g.textAlign = "right"; g.fillText(isNum(o.liquidityUsd) ? kusd(o.liquidityUsd) : "—", 244, 46 + i * 21); g.textAlign = "left"; });
      }
      g.restore();
    }
    function drawAtlas(mode) {
      for (var s = 0; s < 32; s++) { if (demo.on) drawSlotDemo(AT.g, (s % 4) * 256, Math.floor(s / 4) * 128, s, mode); else drawSlotLive(AT.g, (s % 4) * 256, Math.floor(s / 4) * 128, s); }
      AT.tex.needsUpdate = true;
    }
    function screenBg(g) { var bg = g.createLinearGradient(0, 0, 0, 1024); bg.addColorStop(0, "#0B1726"); bg.addColorStop(1, "#050A11"); g.fillStyle = bg; g.fillRect(0, 0, 512, 1024); g.textBaseline = "alphabetic"; g.textAlign = "left"; }
    function demoMark(g) { g.fillStyle = "rgba(245,181,68,0.9)"; g.font = "600 15px " + MONO; g.textAlign = "right"; g.fillText("DEMO · SIMULATED", 478, 1004); g.textAlign = "left"; }
    function drawLeftDemo() {
      var c = TS[0], g = c.g, e = Show.e, run = Show.state !== "pre";
      var alt = run && (Show.state === "run" || e < 40) ? Show.alt : (MOTH.state === "orbit" ? 1 : MOTH.alt);
      var st = !run || e < 10 ? "PRE-LAUNCH" : (e < 22 ? "ASCENT" : "ORBIT"), stCol = st === "ORBIT" ? "#F5B544" : st === "ASCENT" ? "#FF9A5C" : "#8A97A8";
      if (run && e >= 40 && MOTH.state === "orbit") { st = "ORBIT"; stCol = "#F5B544"; }
      screenBg(g);
      g.fillStyle = "#F5F7FA"; g.font = "700 46px " + SANS; g.fillText("$MOTH", 34, 70);
      g.font = "600 18px " + MONO; g.textAlign = "right"; g.fillStyle = stCol; g.fillText(st, 478, 64); g.textAlign = "left";
      g.fillStyle = "#8A97A8"; g.font = "500 17px " + MONO; g.fillText("ALTITUDE · CLASSIC CURVE", 34, 108);
      g.fillStyle = st === "ORBIT" ? "#F5B544" : "#F5F7FA"; g.font = "800 150px " + SANS; g.fillText(Math.floor(alt * 100) + "%", 28, 262);
      g.fillStyle = "#B9C6D6"; g.font = "500 19px " + MONO; g.fillText(nf0.format(Math.round(alt * GRAD)) + " / 15,454 USDC", 34, 302);
      var cx = 34, cy = 336, cw = 444, ch = 290;
      g.strokeStyle = "rgba(255,255,255,0.07)"; g.lineWidth = 1.5;
      for (var i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(cx, cy + ch * i / 4); g.lineTo(cx + cw, cy + ch * i / 4); g.stroke(); }
      g.setLineDash([10, 8]); g.strokeStyle = "rgba(245,181,68,0.85)"; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + cw, cy); g.stroke(); g.setLineDash([]);
      g.fillStyle = "#F5B544"; g.font = "600 15px " + MONO; g.textAlign = "right"; g.fillText("ORBIT · 100%", cx + cw, cy - 10); g.textAlign = "left";
      var data = run ? Show.altHist.slice() : [0, 0];
      if (data.length > 1) {
        g.save(); g.beginPath();
        var frac = run ? sat((e - 10) / 12) : 0, wspan = Math.max(0.06, frac) * cw;
        for (var j = 0; j < data.length; j++) { var px = cx + wspan * j / (data.length - 1), py = cy + ch - data[j] * ch; if (j) g.lineTo(px, py); else g.moveTo(px, py); }
        var lx = cx + wspan, ly = cy + ch - data[data.length - 1] * ch;
        g.lineTo(lx, cy + ch); g.lineTo(cx, cy + ch); g.closePath();
        var gr = g.createLinearGradient(0, cy, 0, cy + ch); gr.addColorStop(0, "rgba(255,104,28,0.42)"); gr.addColorStop(1, "rgba(255,104,28,0)"); g.fillStyle = gr; g.fill();
        g.beginPath(); for (var j2 = 0; j2 < data.length; j2++) { var qx = cx + wspan * j2 / (data.length - 1), qy = cy + ch - data[j2] * ch; if (j2) g.lineTo(qx, qy); else g.moveTo(qx, qy); }
        g.strokeStyle = "#FF8A4C"; g.lineWidth = 4; g.stroke();
        g.fillStyle = "#FFE1C8"; g.beginPath(); g.arc(lx, ly, 7, 0, 6.283); g.fill(); g.restore();
      }
      g.fillStyle = "#8A97A8"; g.font = "600 17px " + MONO; g.fillText("CREW OF 4 · FEE SPLIT", 34, 690);
      var inWin = run && (Show.state === "run" || e < 60), paid = inWin ? e >= 23.9 : MOTH.state === "orbit";
      MOTH.crew.forEach(function (cr, k) {
        var yy = 740 + k * 66;
        g.fillStyle = cr.color; g.beginPath(); g.arc(56, yy - 6, 20, 0, 6.283); g.fill();
        g.fillStyle = "#080D13"; g.font = "700 14px " + MONO; g.textAlign = "center"; g.fillText(initials(cr.name), 56, yy - 1); g.textAlign = "left";
        g.fillStyle = "#F5F7FA"; g.font = "600 24px " + SANS; g.fillText(cr.name, 92, yy + 2);
        g.fillStyle = "#B9C6D6"; g.font = "500 20px " + MONO; g.textAlign = "right"; g.fillText(cr.split + "%", paid ? 360 : 478, yy + 2); g.textAlign = "left";
        g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(92, yy + 14, 260, 5); g.fillStyle = k === 0 ? "#FF681C" : "#4FB8FF"; g.fillRect(92, yy + 14, 260 * cr.split / 35, 5);
        if (paid) { g.fillStyle = "#F5B544"; g.font = "700 22px " + MONO; g.textAlign = "right"; g.fillText("+" + usd2(MOTH_PAY[k]), 478, yy + 2); g.textAlign = "left"; }
      });
      g.fillStyle = "#8A97A8"; g.font = "500 15px " + MONO; g.fillText(paid ? "PAID AT ORBIT · 40% OF 2% FEE" : "CREATOR GETS 40% OF THE 2% ORBIT FEE", 34, 980);
      demoMark(g);
      c.t.needsUpdate = true;
    }
    function drawRightDemo() {
      var c = TS[1], g = c.g, run = Show.state !== "pre", e = Show.e;
      var useShow = run && (Show.state === "run" || e < 40);
      var hold = useShow ? Show.hold : MOTH.holders, mc = useShow ? mcapOf(Show.alt) : MOTH.mcap;
      screenBg(g);
      g.fillStyle = "#8A97A8"; g.font = "600 18px " + MONO; g.fillText("FLIGHT DATA", 34, 58);
      g.fillStyle = "#F5F7FA"; g.font = "700 46px " + SANS; g.textAlign = "right"; g.fillText("$MOTH", 478, 64); g.textAlign = "left";
      g.fillStyle = "#8A97A8"; g.font = "600 17px " + MONO; g.fillText("HOLDERS", 34, 128); g.fillText("CREW POWER", 270, 128);
      g.fillStyle = "#F5F7FA"; g.font = "800 92px " + SANS; g.fillText(String(hold), 30, 224);
      g.fillStyle = "#4FB8FF"; g.fillText(String(MOTH.power), 266, 224);
      g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(270, 244, 208, 8); g.fillStyle = "#4FB8FF"; g.fillRect(270, 244, 208 * MOTH.power / 100, 8);
      g.fillStyle = "#B9C6D6"; g.font = "500 20px " + MONO; g.fillText("MCAP " + kusd(mc), 34, 300);
      g.fillStyle = "#F5F7FA"; g.textAlign = "right"; g.fillText("×" + (mc / 5000).toFixed(1) + " since liftoff", 478, 300); g.textAlign = "left";
      g.fillStyle = "#8A97A8"; g.font = "600 17px " + MONO; g.fillText("BUY / SELL TAPE · LIVE", 34, 360);
      g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(34, 376); g.lineTo(478, 376); g.stroke();
      for (var i = 0; i < 12 && i < sim.tape.length; i++) {
        var tr = sim.tape[i], yy = 416 + i * 46, age = clock.T - tr.T;
        if (i === 0 && age < 0.4) { g.fillStyle = tr.buy ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)"; g.fillRect(28, yy - 30, 456, 42); }
        g.fillStyle = tr.own ? "#FF9A5C" : "#E6EEF8"; g.font = "600 20px " + MONO; g.fillText("$" + tr.tk, 34, yy);
        g.fillStyle = tr.buy ? "#22C55E" : "#EF4444"; g.fillText(tr.buy ? "BUY" : "SELL", 170, yy);
        g.fillStyle = "#F5F7FA"; g.fillText(usd0(tr.amt), 246, yy);
        g.fillStyle = "#6F7E92"; g.font = "500 17px " + MONO; g.textAlign = "right"; g.fillText(tr.w, 478, yy); g.textAlign = "left";
      }
      demoMark(g);
      c.t.needsUpdate = true;
    }
    function avColor(s) { return AVC[hashStr(s) % AVC.length]; }
    function drawLeftLive() {
      var c = TS[0], g = c.g, f = live.focus;
      screenBg(g);
      if (!f) {
        g.fillStyle = "#8A97A8"; g.font = "600 18px " + MONO; g.fillText("MISSION CONTROL", 34, 64);
        g.fillStyle = "#C9D6E6"; g.font = "700 40px " + SANS;
        if (!live.ready) g.fillText("Reading the chain…", 34, 300);
        else { g.fillText("This mission is not", 34, 280); g.fillText("in the sky now", 34, 330); }
        c.t.needsUpdate = true; return;
      }
      var orbited = f.phase === "orbit" || f.phase === "star";
      g.fillStyle = "#F5F7FA"; fitText(g, f.ticker, "700", 46, SANS, 300); g.fillText(f.ticker, 34, 70);
      g.font = "600 18px " + MONO; g.textAlign = "right"; g.fillStyle = PHASE_COL[f.phase]; g.fillText(PHASE_WORD[f.phase], 478, 64); g.textAlign = "left";
      g.fillStyle = "#8A97A8"; g.font = "500 17px " + MONO; g.fillText("ALTITUDE · CURVE TO THE DEX", 34, 108);
      g.fillStyle = orbited ? "#F5B544" : f.phase === "lost" ? "#8A97A8" : "#F5F7FA"; g.font = "800 150px " + SANS;
      g.fillText(orbited ? "100%" : f.altPct == null ? "—" : Math.floor(f.altPct) + "%", 28, 262);
      g.fillStyle = "#B9C6D6"; g.font = "500 19px " + MONO; g.fillText(f.altPct == null || orbited ? (f.day != null ? "DAY " + f.day : "") : f.altPct.toFixed(1) + "% OF THE CURVE" + (f.day != null ? " · DAY " + f.day : ""), 34, 302);
      var cx = 34, cy = 336, cw = 444, ch = 290;
      if (f.phase === "ascent" || f.phase === "pad") {
        g.strokeStyle = "rgba(255,255,255,0.07)"; g.lineWidth = 1.5;
        for (var i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(cx, cy + ch * i / 4); g.lineTo(cx + cw, cy + ch * i / 4); g.stroke(); }
        g.setLineDash([10, 8]); g.strokeStyle = "rgba(245,181,68,0.85)"; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + cw, cy); g.stroke(); g.setLineDash([]);
        g.fillStyle = "#F5B544"; g.font = "600 15px " + MONO; g.textAlign = "right"; g.fillText("ORBIT · 100%", cx + cw, cy - 10); g.textAlign = "left";
        var data = f.hist;
        if (data.length > 1) {
          g.save(); g.beginPath();
          for (var j = 0; j < data.length; j++) { var px = cx + cw * j / (data.length - 1), py = cy + ch - data[j] * ch; if (j) g.lineTo(px, py); else g.moveTo(px, py); }
          var ly = cy + ch - data[data.length - 1] * ch;
          g.lineTo(cx + cw, cy + ch); g.lineTo(cx, cy + ch); g.closePath();
          var gr = g.createLinearGradient(0, cy, 0, cy + ch); gr.addColorStop(0, "rgba(255,104,28,0.42)"); gr.addColorStop(1, "rgba(255,104,28,0)"); g.fillStyle = gr; g.fill();
          g.beginPath(); for (var j2 = 0; j2 < data.length; j2++) { var qx = cx + cw * j2 / (data.length - 1), qy = cy + ch - data[j2] * ch; if (j2) g.lineTo(qx, qy); else g.moveTo(qx, qy); }
          g.strokeStyle = "#FF8A4C"; g.lineWidth = 4; g.stroke();
          g.fillStyle = "#FFE1C8"; g.beginPath(); g.arc(cx + cw, ly, 7, 0, 6.283); g.fill(); g.restore();
        } else { g.fillStyle = "#56657A"; g.font = "500 17px " + MONO; g.fillText("THE LINE GROWS WITH EACH TRADE READ", cx, cy + ch / 2); }
      } else {
        g.fillStyle = "#8A97A8"; g.font = "600 17px " + MONO; g.fillText("CHECKS · DAYS 7, 30, 90", cx, cy + 6);
        for (var k = 0; k < 3; k++) {
          var st = f.checks[k], yy = cy + 74 + k * 74, col = CHECK_COL[st] || "#56657A";
          g.fillStyle = col; g.beginPath(); g.arc(cx + 16, yy - 9, 11, 0, 6.283); g.fill();
          g.fillStyle = "#F5F7FA"; g.font = "700 34px " + SANS; g.fillText("DAY " + CHECK_DAYS[k], cx + 44, yy + 2);
          g.fillStyle = col; g.font = "600 19px " + MONO; g.textAlign = "right"; g.fillText(CHECK_WORD[st] || "—", cx + cw, yy); g.textAlign = "left";
        }
      }
      g.fillStyle = "#8A97A8"; g.font = "600 17px " + MONO; g.fillText("CREW", 34, 690);
      if (!f.crew.length) { g.fillStyle = "#56657A"; g.font = "500 20px " + MONO; g.fillText("—", 34, 740); }
      f.crew.slice(0, 4).forEach(function (cr, k) {
        var yy = 740 + k * 66;
        g.fillStyle = avColor(cr); g.beginPath(); g.arc(56, yy - 6, 20, 0, 6.283); g.fill();
        g.fillStyle = "#080D13"; g.font = "700 14px " + MONO; g.textAlign = "center"; g.fillText(cr.slice(0, 2).toUpperCase(), 56, yy - 1); g.textAlign = "left";
        g.fillStyle = "#F5F7FA"; fitText(g, cr, "600", 24, MONO, 380); g.fillText(cr, 92, yy + 2);
      });
      g.fillStyle = "#8A97A8"; g.font = "500 15px " + MONO; g.fillText(CREW_LINE, 34, 1000);
      c.t.needsUpdate = true;
    }
    function drawRightLive() {
      var c = TS[1], g = c.g, f = live.focus;
      screenBg(g);
      g.fillStyle = "#8A97A8"; g.font = "600 18px " + MONO; g.fillText("FLIGHT DATA", 34, 58);
      if (f) { g.fillStyle = "#F5F7FA"; fitText(g, f.ticker, "700", 46, SANS, 260); g.textAlign = "right"; g.fillText(f.ticker, 478, 64); g.textAlign = "left"; }
      g.fillStyle = "#8A97A8"; g.font = "600 17px " + MONO; g.fillText("HOLDERS", 34, 128); g.fillText("DAY", 300, 128);
      g.fillStyle = "#F5F7FA"; fitText(g, f ? holdTxt(f) : "—", "800", 92, SANS, 250); g.fillText(f ? holdTxt(f) : "—", 30, 224);
      g.fillStyle = "#4FB8FF"; g.font = "800 92px " + SANS; g.fillText(f && f.day != null ? String(f.day) : "—", 296, 224);
      var ly = 300;
      if (f && isNum(f.marketCapUsd)) { g.fillStyle = "#B9C6D6"; g.font = "500 20px " + MONO; g.fillText("MCAP " + kusd(f.marketCapUsd), 34, ly); }
      if (f && isNum(f.sinceLiftoff)) { g.fillStyle = "#F5F7FA"; g.font = "500 20px " + MONO; g.textAlign = "right"; g.fillText("×" + f.sinceLiftoff.toFixed(1) + " since liftoff", 478, ly); g.textAlign = "left"; }
      if (f && (f.phase === "orbit" || f.phase === "star") && isNum(f.liquidityUsd)) { g.fillStyle = "#B9C6D6"; g.font = "500 20px " + MONO; g.fillText("POOL " + kusd(f.liquidityUsd), 34, 330); }
      g.fillStyle = "#8A97A8"; g.font = "600 17px " + MONO; g.fillText("BUY / SELL TAPE · LIVE", 34, 360);
      g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(34, 376); g.lineTo(478, 376); g.stroke();
      if (!live.tape.length) { g.fillStyle = "#56657A"; g.font = "500 18px " + MONO; g.fillText(live.ready ? "WAITING FOR THE NEXT TRADE" : "READING THE CHAIN…", 34, 420); }
      for (var i = 0; i < 13 && i < live.tape.length; i++) {
        var tr = live.tape[i], yy = 416 + i * 46, age = clock.T - tr.T;
        if (i === 0 && age < 0.4) { g.fillStyle = tr.buy ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)"; g.fillRect(28, yy - 30, 456, 42); }
        g.fillStyle = tr.own ? "#FF9A5C" : "#E6EEF8"; g.font = "600 20px " + MONO; g.fillText(tr.tk.slice(0, 9), 34, yy);
        g.fillStyle = tr.buy ? "#22C55E" : "#EF4444"; g.fillText(tr.buy ? "BUY" : "SELL", 170, yy);
        g.fillStyle = "#F5F7FA"; g.fillText(tr.usd == null ? "—" : usd0(tr.usd), 246, yy);
        g.fillStyle = "#6F7E92"; g.font = "500 17px " + MONO; g.textAlign = "right"; g.fillText(shortSig(tr.sig), 478, yy); g.textAlign = "left";
      }
      c.t.needsUpdate = true;
    }

    /* ====================== EVENTS -> 3D ====================== */
    var pulse = { beat: 0 };
    function ledFlash(key, buy) {
      var base = key % NCON;
      for (var i = 0; i < 3; i++) { var L = leds[(base + i * 11) % NCON]; if (clock.T - L.last > 0.34) { L.flash = 1; L.flashCol = buy ? 1 : 2; L.last = clock.T; } }
    }
    function ping(ang, rot, alt, col, big) { if (holoPings.length < 24) holoPings.push({ ang: ang, rot: rot, alt: alt, col: col, big: !!big, t: 0 }); }
    function orbitFx(ang, stream) { holoState.gold = 1; holoState.flash = 1; holoState.mothOrbitT = clock.T; holoState.fxAng = ang; holoState.stream = stream ? 0 : -1; holoState.flashed = false; }
    var ventOn = true;
    function resetLaunch() {
      fireP.n = 0; smokeP.n = 0; ventOn = true;
      demoRig.ship.position.set(PAD.x, demoRig.base, PAD.z); demoRig.ship.rotation.set(0, 0, 0);
      DIST.forEach(function (d) { d.ship.position.set(d.p.x, d.base, d.p.z); });
      arms.forEach(function (a) { a.pivot.rotation.y = 0; });
      holoState.gold = 0; holoState.mothOrbitT = -9;
    }
    var demoGL = function (e) {
      if (!demo.on) return;
      var m = e.m;
      if (e.type === "buy" || e.type === "sell") {
        ledFlash(m.id * 7, e.type === "buy");
        if (m.state === "flight" || (m === MOTH && e.script)) { if (!e.script || hsh(e.T * 13.1, e.amt) < 0.18 || e.amt > 150) ping(m.ang, false, e.script ? Show.alt : m.alt, e.type === "buy" ? 1 : 2, false); }
      }
      if (e.type === "tick") pulse.beat = 1;
      if (e.type === "orbit") { ping(m.ang, m.state === "orbit" && m !== MOTH, 1, 3, true); if (e.show) orbitFx(MOTH.ang, true); }
      if (e.type === "check") ping(m.ang, true, 1, 4, false);
      if (e.type === "star") { mStars.push({ p: skyDir((hsh(mStars.length, 2) - 0.5) * 0.5, 0.1 + hsh(mStars.length, 5) * 0.09, 4500), born: clock.T, b: 1.1 }); ping(m.ang, false, 1, 3, false); }
      if (e.type === "count") resetLaunch();
      if (e.type === "liftoff") ventOn = false;
    };
    onDemo(demoGL); demoGLListeners.push(demoGL);

    /* ====================== CAMERA ====================== */
    var rig = { mx: 0, my: 0, sx: 0, sy: 0, sel: 0 };
    var rootRect = root.getBoundingClientRect();
    listen(root, "pointermove", function (ev) { if (ev.pointerType === "mouse") { rig.mx = (ev.clientX - rootRect.left) / Math.max(1, size.w) * 2 - 1; rig.my = (ev.clientY - rootRect.top) / Math.max(1, size.h) * 2 - 1; } }, { passive: true });
    function framing() {
      var a = size.w / size.h, t = sat((1.45 - a) / (1.45 - 0.5));
      var wide = sat((a - 1.75) / 0.6), short = sat((560 - size.h) / 160) * wide;
      return { pos: V3(0, lerp(7.0, 6.9, t), lerp(19.0, 11.0, t)), tgt: V3(0, lerp(5.9, 6.6, t) + wide * 1.9 + short * 1.6, -16), fov: lerp(52, 74, t) + short * 4, t: t };
    }
    var SEL_POS = V3(0, 8.0, 5.5), SEL_TGT = V3(0, 4.6, -5.5);

    /* ====================== RESIZE / TIER ====================== */
    var size = { w: 1, h: 1, pr: 1 };
    function resize() {
      var w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight), pr = Math.min(W.devicePixelRatio || 1, TIER[tier].pr, MAX_PR);
      size.w = w; size.h = h; size.pr = pr; rootRect = root.getBoundingClientRect();
      renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      if (composer) {
        composer.setPixelRatio(pr); composer.setSize(w, h);
        if (TIER[tier].bloom < 1) bloom.setSize(Math.round(w * pr * TIER[tier].bloom), Math.round(h * pr * TIER[tier].bloom));
      }
      starMat.uniforms.uPR.value = pr; moteMat.uniforms.uPR.value = pr * (h / 900);
    }
    function applyTier() { buildComposer(); resize(); moteMat.uniforms.uCount.value = TIER[tier].fx; }
    var perf = { phase: "warm", t: 0, frames: 0, fps: 0, probes: 0 };
    function perfTick(dt) {
      if (qForced || perf.phase === "done") return;
      perf.t += dt;
      if (perf.phase === "warm") { if (perf.t > 1.2) { perf.phase = "probe"; perf.t = 0; perf.frames = 0; } return; }
      perf.frames++;
      if (perf.t >= 2) {
        perf.fps = perf.frames / perf.t; perf.probes++;
        var need = COARSE ? MIN_FPS : Math.max(MIN_FPS, 45);
        if (perf.fps < need && tier !== "low") { tier = tier === "high" ? "medium" : "low"; applyTier(); perf.phase = perf.probes < 3 ? "warm" : "done"; perf.t = 0; }
        else perf.phase = "done";
        call("onQuality", tier, perf.fps);
      }
    }

    /* ====================== ENVELOPES: the show (DEMO) or the focus mission (LIVE) ====================== */
    function envDemo() {
      var inShow = Show.state !== "pre", E = inShow ? Show.e : -99, L = E - 10;
      var e = { inShow: inShow, E: E, L: L, flood: 1, ign: 0, dolly: 0, push: 0, rise: 0, tilt: 0, flame: 0, pad: 0, arm0: 0, arm1: 0, shipOn: true, rig: demoRig, dist: inShow ? L : -99 };
      if (inShow) e.flood = E < 10 ? lerp(1, 0.25, sstep(1.5, 9.4, E)) : lerp(0.25, 1, sstep(13, 21, L));
      if (inShow && L > -1.8) e.ign = L < 0 ? 0.1 * sstep(-1.8, 0, L) : (L < 0.9 ? lerp(0.1, 1, eOut(L / 0.9)) : (L < 6.5 ? 1 : lerp(1, 0, sstep(6.5, 17, L))));
      if (inShow && !RM) {
        e.dolly = E < 10 ? eInOut(E / 10) : (L > 15 ? 1 - eInOut((L - 15) / 2.6) : 1);
        e.push = L > 1.3 ? (L > 15 ? 1 - eInOut((L - 15) / 2.6) : eOut((L - 1.3) / 2.5)) : 0;
      }
      if (inShow && L > 0.6) { var tt = L - 0.6; e.rise = 0.5 * 2.7 * tt * tt + 0.11 * tt * tt * tt; }
      e.tilt = inShow ? sstep(3.5, 11, L) * 0.1 : 0;
      e.arm0 = inShow ? -eInOut((E - 4) / 2) * 1.35 : 0; e.arm1 = inShow ? -eInOut((E - 6.5) / 2) * 1.35 : 0;
      if (inShow && L > -1.6) e.flame = L < 0 ? 0.3 * sstep(-1.6, 0, L) : (L < 0.6 ? lerp(0.3, 1, L / 0.6) : 1);
      e.pad = L < 0 ? 0.35 * sstep(-1.2, 0, L) : (L < 4.5 ? 1 : Math.max(0, 1 - (L - 4.5) / 3));
      e.vent = ventOn;
      return e;
    }
    function envLive(dt) {
      var T = clock.T, f = live.focus, ph = f ? f.phase : null;
      var e = { inShow: false, E: -99, L: -99, flood: 1, ign: 0, dolly: 0, push: 0, rise: 0, tilt: 0, flame: 0, pad: 0, arm0: 0, arm1: 0, shipOn: false, rig: liveRig, dist: -99, vent: false };
      live.surge = Math.max(0, live.surge - dt * 1.2);
      if (!f || !liveRig) return e;
      if (ph === "pad") { e.shipOn = true; e.vent = !RM; return e; }
      if (ph === "ascent") {
        var tgt = lerp(8, 38, f.alt == null ? 0 : f.alt), s = live.surge;
        live.riseS = live.riseS == null || RM ? tgt : lerp(live.riseS, tgt, 1 - Math.exp(-dt * 1.4));
        var r = live.riseS + (RM ? 0 : s * 1.6);
        e.shipOn = true; e.flame = 0.82 + 0.18 * s; e.ign = 0.2 + 0.4 * s; e.flood = 0.92; e.push = 0.7; e.tilt = 0.035; e.arm0 = e.arm1 = -1.35;
        var Lc = T - live.liftT;
        if (Lc >= 0 && Lc < 16) {     // a live ignite: the concept's liftoff, without its countdown, settling at the curve's altitude
          var cr = Lc > 0.6 ? 0.5 * 2.7 * (Lc - 0.6) * (Lc - 0.6) + 0.11 * Math.pow(Lc - 0.6, 3) : 0;
          r = Math.min(r, cr);
          e.ign = Math.max(e.ign, Lc < 0.9 ? lerp(0.1, 1, eOut(Lc / 0.9)) : (Lc < 6.5 ? 1 : lerp(1, 0, sstep(6.5, 17, Lc))));
          e.flame = Lc < 0.6 ? lerp(0.3, 1, Lc / 0.6) : Math.max(e.flame, 1 - sstep(4, 10, Lc) * 0.18);
          e.push = RM ? 0.7 : (Lc > 1.3 ? 0.7 * eOut((Lc - 1.3) / 2.5) : 0);
          e.arm0 = -eInOut(Lc / 1.5) * 1.35; e.arm1 = -eInOut((Lc - 0.3) / 1.5) * 1.35;
          e.pad = Lc < 4.5 ? 1 : Math.max(0, 1 - (Lc - 4.5) / 3);
          e.flood = lerp(0.6, 0.92, sstep(2, 10, Lc));
        }
        e.rise = r; live.lastRise = r;
        return e;
      }
      var Xc = T - live.exitT;   // a live orbit: the ship climbs out of the window
      if (Xc >= 0 && Xc < 5) {
        e.shipOn = true; e.rise = live.exitRise + (RM ? 0 : 0.5 * 90 * Xc * Xc + 25 * Xc); e.flame = RM ? 0 : 1; e.ign = RM ? 0 : lerp(0.6, 0, sstep(0, 4.5, Xc));
        e.push = 0.7 * (1 - sstep(2.5, 5, Xc)); e.arm0 = e.arm1 = -1.35; e.tilt = 0.035;
        if (RM) e.shipOn = false;
      }
      return e;
    }

    /* ====================== PER-FRAME ====================== */
    var acc = { atlas: 9, screens: 9, board: 9, tick: 0, tickText: 9 };
    var anchorV = new THREE.Vector3(), lastAnchor = { x: 0, y: 0 }, projV = new THREE.Vector3();
    var frustum = new THREE.Frustum(), projM = new THREE.Matrix4();
    var flameCol = [COL.fire1, COL.fire2, COL.fire3, COL.fire4];
    function fireColor(t, out) {
      if (t < 0.07) { var k = t / 0.07; out[0] = lerp(2.2, COL.fire1.r * 1.9, k); out[1] = lerp(1.8, COL.fire1.g * 1.9, k); out[2] = lerp(1.1, COL.fire1.b * 1.9, k); return; }
      var u = (t - 0.07) / 0.93 * 3, i = Math.min(2, Math.floor(u)), f = u - i, a = flameCol[i], b = flameCol[i + 1], s = lerp(1.9, 0.5, sat(u / 3));
      out[0] = lerp(a.r, b.r, f) * s; out[1] = lerp(a.g, b.g, f) * s; out[2] = lerp(a.b, b.b, f) * s;
    }
    var fc = [0, 0, 0], nozW = V3(0, 0, 0), tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
    var emitAcc = { pad: 0, trail: 0, fire: 0, vent: 0 };
    var podFlash = 0;

    function update(dt) {
      var T = clock.T, fx = TIER[tier].fx, DM = demo.on;
      var env = DM ? envDemo() : envLive(dt);
      var inShow = env.inShow, E = env.E, L = env.L, flood = env.flood, ign = env.ign, dolly = env.dolly, push = env.push;
      var flick = RM ? 1 : 0.95 + 0.05 * Math.sin(T * 9.0) * Math.sin(T * 5.1 + 1.3);
      var ignF = ign * flick;
      pulse.beat = Math.max(0, pulse.beat - dt * 2.6);
      var beat = (DM && inShow && E < 10.2) ? pulse.beat : 0;
      var orbitGlow = holoState.gold;
      holoState.gold = Math.max(0, holoState.gold - dt / 1.6);
      holoState.flash = Math.max(0, holoState.flash - dt * 2.2);

      /* ---- camera (selecting a mission brings it to the holo-table) ---- */
      var fr = framing();
      rig.sx = lerp(rig.sx, RM ? 0 : rig.mx, 1 - Math.exp(-dt * 2)); rig.sy = lerp(rig.sy, RM ? 0 : rig.my, 1 - Math.exp(-dt * 2));
      var selT = (!DM && live.sel) ? 1 : 0; rig.sel = RM ? selT : lerp(rig.sel, selT, 1 - Math.exp(-dt * 2.4));
      var sk = eInOut(rig.sel), sway = RM ? 0 : 1, phone = fr.t > 0.6;
      camera.position.set(
        fr.pos.x + rig.sx * 0.9 * (1 - fr.t) + Math.sin(T * 0.11) * 0.22 * sway,
        fr.pos.y - rig.sy * 0.35 * (1 - fr.t) + Math.sin(T * 0.083) * 0.1 * sway - push * (phone ? 0.3 : 0.7),
        fr.pos.z - dolly * 1.3 - push * (phone ? 2.2 : 4.0));
      if (sk > 0) camera.position.lerp(tmpV.set(SEL_POS.x, SEL_POS.y + (phone ? 1.2 : 0), SEL_POS.z + (phone ? 3.5 : 0)), sk);
      camera.fov = fr.fov; camera.updateProjectionMatrix();
      tmpV.set(fr.tgt.x + rig.sx * 0.5 * (1 - fr.t), fr.tgt.y - rig.sy * 0.25, fr.tgt.z);
      if (sk > 0) tmpV.lerp(SEL_TGT, sk);
      camera.lookAt(tmpV);
      camera.rotateX(THREE.MathUtils.degToRad(8) * push * (1 - sk));
      var pxs = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / size.h;
      for (var pu = 0; pu < pxUniforms.length; pu++) pxUniforms[pu].value = pxs;

      /* ---- room light ---- */
      winLight.color.copy(COL.winCool).lerp(COL.winWarm, ign); winLight.intensity = lerp(0.42, 3.4, ignF) * lerp(0.75, 1, flood);
      winFill.color.copy(COL.fillCool).lerp(COL.fillWarm, ign); winFill.intensity = lerp(0.85, 9.0, ignF) * lerp(0.7, 1, Math.max(flood, ign));
      hemi.color.copy(COL.hemiSky).lerp(COL.hemiWarm, ign * 0.8); hemi.intensity = 0.5 + ign * 0.4;
      backFill.intensity = 0.42 + beat * 0.25;
      holoLight.color.copy(COL.holo).lerp(COL.gold, orbitGlow); holoLight.intensity = 1.8 + orbitGlow * 4 + holoState.flash * 3;
      shaftMat.uniforms.uCol.value.copy(COL.shaft).lerp(COL.fillWarm, ign); shaftMat.uniforms.uI.value = 0.13 * flood + 1.0 * ignF; shaftMat.uniforms.uTime.value = T;
      moteMat.uniforms.uI.value = 0.35 * flood + 1.4 * ignF; moteMat.uniforms.uCol.value.copy(COL.mote).lerp(COL.moteWarm, ign); moteMat.uniforms.uTime.value = T;
      floorWinMat.color.copy(COL.winCool).multiplyScalar(0.3 * lerp(0.6, 1, flood)).lerp(tmpC.copy(COL.winWarm).multiplyScalar(0.5), ignF);
      glassMat.color.copy(COL.glassCool).multiplyScalar(0.07).lerp(tmpC.copy(COL.winWarm).multiplyScalar(0.16), ign);
      holoFloorMat.color.copy(COL.holo).lerp(COL.gold, orbitGlow).multiplyScalar(0.2 + orbitGlow * 0.3);
      scrMat.color.setScalar(1.05 + beat * 0.9);
      BRD.mainMat.color.setScalar(1.25 + beat * 0.45 + (inShow && L > 0 && L < 3 ? 0.3 : 0));
      if (composer) {
        bloom.strength = 0.8 + 0.85 * ignF + orbitGlow * 0.35;
        bloom.threshold = lerp(0.82, 0.7, ign);
        finalPass.uniforms.uTime.value = T; finalPass.uniforms.uGrain.value = tier === "high" ? 0.03 : 0.0;
        finalPass.uniforms.uTint.value.set(1 + ign * 0.05, 1, 1 - ign * 0.06);
      }

      /* ---- outside ---- */
      skyMat.uniforms.uIgn.value = ignF; skyMat.uniforms.uGlow.value = 0.5 + 0.5 * flood;
      starMat.uniforms.uTime.value = T; starMat.uniforms.uDim.value = 1 - ign * 0.55;
      flood1.intensity = 1.05 * flood; flood2.intensity = 0.85 * flood;
      coneMat.uniforms.uI.value = flood;
      for (var f = 0; f < fogLayers.length; f++) { var fu = fogLayers[f].material.uniforms; fu.uTime.value = T; fu.uIgn.value = ignF; fu.uFlood.value = flood; }

      /* ---- the room's ship: $MOTH in the demo, the focus mission's own ship live ---- */
      var R0 = env.rig;
      demoRig.ship.visible = false; if (liveRig) liveRig.ship.visible = false;
      var rise = env.rise, tiltA = env.tilt, ship = null, flame = 0, sp = null, nz = null;
      if (R0 && env.shipOn) {
        ship = R0.ship;
        ship.position.set(PAD.x + tiltA * rise * 0.45, R0.base + rise, PAD.z); ship.rotation.set(0, 0, -tiltA);
        ship.visible = rise < 1400;
        if (ship.visible) { flame = env.flame; sp = ship.position; nz = R0.active; }
        if (R0 === liveRig && live.focus) { if (setPods(liveRig, podsFor(live.focus)) && liveRig.podsSeen) podFlash = 1; liveRig.podsSeen = true; }
      }
      podFlash = Math.max(0, podFlash - dt * 1.5);
      var aI = apronMat.uniforms.uI.value, aF = apronMat.uniforms.uFire.value;
      aI[0] = flood; aF[0] = ignF * (ship && ship.visible ? Math.exp(-Math.max(0, rise) / 90) : 0) + ign * 0.15;
      for (var ai = 0; ai < arms.length; ai++) arms[ai].pivot.rotation.y = ai === 0 ? env.arm0 : env.arm1;
      exLight.position.set(sp ? sp.x : PAD.x, (sp ? sp.y : PAD.y) - 6, (sp ? sp.z : PAD.z) + 6);
      exLight.intensity = flame * 9 * flick;
      DIST.forEach(function (d, i) {
        var r2 = 0; if (env.dist > 0.4) { var t2 = env.dist - 0.4; r2 = 0.5 * d.a * t2 * t2 + 0.1 * t2 * t2 * t2; }
        d.ship.position.y = d.base + r2; d.ship.visible = DM && r2 < 1800; d.rise = r2;
        d.fl = (DM && env.dist > -0.8 && d.ship.visible) ? (env.dist < 0.4 ? 0.4 * sstep(-0.8, 0.4, env.dist) : 1) : 0;
        aI[i + 1] = 0.5 + 0.5 * flood; aF[i + 1] = d.fl * Math.exp(-r2 / 70) * 0.8;
      });

      /* ---- particles: emit ---- */
      [demoRig, liveRig].forEach(function (rr) {
        if (!rr) return;
        for (var fm = 0; fm < rr.flames.length; fm++) { var fl = rr.flames[fm]; var on = rr === R0 && flame > 0.01; fl.visible = on; if (!on) continue; fl.material.uniforms.uI.value = flame * flick; fl.material.uniforms.uTime.value = T; var fl2 = 1 + Math.min(1.2, rise / 260); fl.scale.set(1 + (fl2 - 1) * 0.5, fl2, 1 + (fl2 - 1) * 0.5); }
      });
      if (flame > 0 && sp) {
        emitAcc.fire += dt * 240 * fx * flame;
        while (emitAcc.fire >= 1) { emitAcc.fire -= 1; var nzz = nz[Math.floor(Math.random() * nz.length)]; nozW.copy(nzz).applyEuler(ship.rotation).add(sp);
          fireP.spawn(nozW.x + (Math.random() - 0.5) * 0.9, nozW.y - 1, nozW.z + (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 5 + Math.sin(ship.rotation.z) * 40, -58 - Math.random() * 34, (Math.random() - 0.5) * 5, 0.22 + Math.random() * 0.26, 2.2, rise < 30 ? 7 : 5.5, 0); }
        emitAcc.pad += dt * 42 * fx * env.pad;
        while (emitAcc.pad >= 1) { emitAcc.pad -= 1; var sd = Math.random() < 0.5 ? -1 : 1;
          smokeP.spawn(PAD.x + sd * (5 + Math.random() * 9), PADTOP + 1.5 + Math.random() * 3, PAD.z + (Math.random() - 0.5) * 16, sd * (16 + Math.random() * 24), 2 + Math.random() * 6, (Math.random() - 0.3) * 8, 7.5 + Math.random() * 4, 8, 30 + Math.random() * 16, 1); }
        if (rise > 2 && rise < 700) { emitAcc.trail += dt * 40 * fx; while (emitAcc.trail >= 1) { emitAcc.trail -= 1; smokeP.spawn(sp.x + (Math.random() - 0.5) * 3, sp.y - 8 - Math.random() * 12, sp.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2.5, -4 - Math.random() * 3, (Math.random() - 0.5) * 2.5, 6.5 + Math.random() * 3, 7, 15 + Math.random() * 8, 2); } }
      }
      if (env.vent && ship && ship.visible && !RM) { emitAcc.vent += dt * 7 * fx; while (emitAcc.vent >= 1) { emitAcc.vent -= 1; var vh = Math.random() < 0.5 ? 0.62 : 0.86; smokeP.spawn(ship.position.x + (Math.random() < 0.5 ? -1 : 1) * R0.ship.userData.R * 1.04, ship.position.y + R0.ship.userData.H * vh, ship.position.z + 1, (Math.random() - 0.5) * 3, -0.8, 1.2, 2.6, 1.5, 7, 3); } }
      DIST.forEach(function (d) {
        if (d.fl <= 0) return;
        d.acc = (d.acc || 0) + dt * 26 * fx * d.fl;
        while (d.acc >= 1) { d.acc -= 1; var p = d.ship.position; fireP.spawn(p.x, p.y - 2, p.z, (Math.random() - 0.5) * 3, -40 - Math.random() * 20, (Math.random() - 0.5) * 3, 0.25 + Math.random() * 0.25, 3, 8, 1);
          if (d.rise > 1 && Math.random() < 0.6) smokeP.spawn(p.x + (Math.random() - 0.5) * 2, p.y - 7, p.z, (Math.random() - 0.5) * 1.5, -2, (Math.random() - 0.5) * 1.5, 6 + Math.random() * 3, 7, 22, 4);
          if (d.rise < 8 && Math.random() < 0.6) smokeP.spawn(p.x + (Math.random() - 0.5) * 10, GY + 3, p.z, (Math.random() - 0.5) * 16, 2, (Math.random() - 0.5) * 6, 5 + Math.random() * 3, 6, 24, 1); }
      });

      /* ---- particles: simulate + draw ---- */
      fireB.begin();
      for (var i = fireP.n - 1; i >= 0; i--) {
        fireP.age[i] += dt; if (fireP.age[i] >= fireP.life[i]) { fireP.kill(i); continue; }
        var p3 = i * 3, v = fireP.v;
        fireP.p[p3] += v[p3] * dt; fireP.p[p3 + 1] += v[p3 + 1] * dt; fireP.p[p3 + 2] += v[p3 + 2] * dt;
        if (fireP.p[p3 + 1] < PADTOP + 0.6 && fireP.k[i] === 0) { fireP.p[p3 + 1] = PADTOP + 0.6; var sgn = fireP.p[p3] - PAD.x >= 0 ? 1 : -1; v[p3] = sgn * (34 + Math.random() * 26); v[p3 + 1] = 3; v[p3 + 2] *= 1.5; }
        v[p3] *= 1 - dt * 1.6; v[p3 + 1] *= 1 - dt * 1.6; v[p3 + 2] *= 1 - dt * 1.6;
        var tl = fireP.age[i] / fireP.life[i]; fireColor(tl, fc);
        var a = Math.pow(1 - tl, 1.5) * (fireP.k[i] === 1 ? 0.8 : 0.5);
        fireB.push(fireP.p[p3], fireP.p[p3 + 1], fireP.p[p3 + 2], fc[0], fc[1], fc[2], a, lerp(fireP.s0[i], fireP.s1[i], Math.sqrt(tl)), fireP.rot[i], fireP.k[i] === 1 ? 2.5 : 0);
      }
      var gk = composer ? 1 : 1.5;
      if (flame > 0 && sp) {
        for (var nn = 0; nn < nz.length; nn++) { nozW.copy(nz[nn]).applyEuler(ship.rotation).add(sp); fireB.push(nozW.x, nozW.y - 1.5, nozW.z, 2.2 * flick, 1.8, 1.15, 0.9 * flame, 4.5, 0, 3); fireB.push(nozW.x, nozW.y - 7, nozW.z, 1.5, 0.62, 0.18, 0.5 * flame * gk, 12, 0, 5); }
        fireB.push(sp.x, sp.y - 18, sp.z + 2, 1.1, 0.4, 0.1, 0.22 * flame * flick * gk, 34, 0, 0);
      }
      DIST.forEach(function (d) { if (d.fl > 0) { var p = d.ship.position; fireB.push(p.x, p.y - 2, p.z, 2.6, 2.0, 1.3, d.fl, 5, 0, 7); fireB.push(p.x, p.y - 7, p.z, 1.6, 0.66, 0.2, 0.6 * d.fl * gk, 24, 0, 13); } });
      fireB.end();
      smokeB.begin();
      var smokeBase = 0.045 + 0.085 * flood, spx = sp ? sp.x : PAD.x, spy = sp ? sp.y : PAD.y, spz = sp ? sp.z : PAD.z;
      for (var j = smokeP.n - 1; j >= 0; j--) {
        smokeP.age[j] += dt; if (smokeP.age[j] >= smokeP.life[j]) { smokeP.kill(j); continue; }
        var q = j * 3, vv = smokeP.v, kk = smokeP.k[j];
        var drag = kk === 1 ? 0.55 : 0.35;
        vv[q] *= 1 - dt * drag; vv[q + 2] *= 1 - dt * drag; vv[q + 1] = vv[q + 1] * (1 - dt * 0.4) + dt * (kk === 1 ? 1.5 : (kk === 3 ? -0.3 : 0.4));
        smokeP.p[q] += vv[q] * dt; smokeP.p[q + 1] += vv[q + 1] * dt; smokeP.p[q + 2] += vv[q + 2] * dt;
        smokeP.rot[j] += smokeP.vr[j] * dt;
        var ts = smokeP.age[j] / smokeP.life[j];
        var dx = smokeP.p[q] - spx, dy = smokeP.p[q + 1] - (spy - 12), dz = smokeP.p[q + 2] - spz, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var lit = flame * 2.6 * Math.exp(-dist / 26) + ign * 0.2 * Math.exp(-Math.abs(smokeP.p[q + 1] - PADTOP) / 70) * (0.5 + smokeP.sd[j]) + ignF * 0.03;
        var sh = smokeBase * (0.7 + 0.6 * smokeP.sd[j]);
        if (kk === 3) sh = 0.5 * flood + 0.08;
        if (kk === 4) { lit = 0.6 * Math.exp(-ts * 6) * flame; sh = 0.05 + 0.05 * flood; }
        var al = Math.pow(Math.sin(Math.PI * Math.min(1, ts * 1.15)), 0.8) * (kk === 2 ? 0.4 : (kk === 3 ? 0.26 : (kk === 4 ? 0.34 : 0.66)));
        smokeB.push(smokeP.p[q], smokeP.p[q + 1], smokeP.p[q + 2], sh + COL.fire2.r * lit * 1.3, sh * 1.04 + COL.fire2.g * lit * 1.15, sh * 1.16 + COL.fire2.b * lit, al, lerp(smokeP.s0[j], smokeP.s1[j], Math.sqrt(ts)), smokeP.rot[j], 0);
      }
      smokeB.end();

      /* ---- glows: lamps, LEDs, holo dots, stars ---- */
      glows.begin();
      for (var li = 0; li < lamps.length; li++) {
        var lp = lamps[li], k = 1;
        if (lp.kind === "blink") { var ph = (T * lp.hz + lp.ph) % 1; k = ph < 0.18 ? 1 : (ph < 0.32 ? 1 - (ph - 0.18) / 0.14 : 0.06); }
        if (lp.grp === "flood") k *= 0.25 + 0.75 * flood;
        if (lp.grp === "gantry") k *= 0.4 + 0.6 * flood;
        glows.push(lp.p.x, lp.p.y, lp.p.z, lp.col.r * 2.2 * k, lp.col.g * 2.2 * k, lp.col.b * 2.2 * k, 1, lp.size, 0, lp.minPx);
      }
      for (var si = 0; si < mStars.length; si++) {
        var ms = mStars[si], age = T - ms.born, fade = ms.born < 0 ? 1 : sat(age / 2.6), bump2 = ms.born < 0 ? 0 : Math.exp(-Math.pow((age - 1.2) / 0.7, 2)) * 1.5;
        glows.push(ms.p.x, ms.p.y, ms.p.z, 1.5 * ms.b * (fade + bump2), 1.25 * ms.b * (fade + bump2), 0.85 * ms.b * (fade + bump2), 1, 1, 0, (ms.focus ? 9 : 7) + bump2 * 6);
      }
      if (podFlash > 0 && ship && ship.visible && R0.podsOn > 0) { var pod = R0.pods[R0.podsOn - 1]; tmpV.copy(pod.position).setY(R0.ship.userData.H * 0.3).applyEuler(ship.rotation).add(ship.position); glows.push(tmpV.x, tmpV.y, tmpV.z, 2.6 * podFlash, 2.0 * podFlash, 1.2 * podFlash, 1, 9, 0, 8); }
      var stCount = DM && inShow && E < 10, asc = DM ? (inShow && L >= 0 && L < 12) : (live.focus && live.focus.phase === "ascent");
      for (var ci = 0; ci < NCON; ci++) {
        var ld = leds[ci]; ld.flash = Math.max(0, ld.flash - dt * 4);
        var s0 = stCount ? COL.warn : COL.up, skk = stCount ? 0.5 + 1.5 * beat : 0.75;
        if (asc) { s0 = COL.fire1; skk = DM ? 0.9 : 0.6; }
        glows.push(ld.p[0].x, ld.p[0].y, ld.p[0].z, s0.r * skk * 2, s0.g * skk * 2, s0.b * skk * 2, 1, 0.07, 0, 2.2);
        var fcl = ld.flashCol === 1 ? COL.up : COL.down, fk = ld.flash;
        glows.push(ld.p[1].x, ld.p[1].y, ld.p[1].z, 0.15 + fcl.r * fk * 3, 0.18 + fcl.g * fk * 3, 0.22 + fcl.b * fk * 3, 1, 0.07, 0, 2.2);
        var cph = (T * ld.rate + ld.phase) % 1, ck = cph < 0.5 ? 1 : 0.15;
        glows.push(ld.p[2].x, ld.p[2].y, ld.p[2].z, COL.info.r * ck * 1.6, COL.info.g * ck * 1.6, COL.info.b * ck * 1.6, 1, 0.07, 0, 2.2);
      }
      /* holo: spin + dots + pings */
      spin.rotation.y += dt * (RM ? 0.05 : 0.16);
      planetMat.uniforms.uTime.value = T; planetMat.uniforms.uGoldAmt.value = orbitGlow * 0.85; beamMat.uniforms.uTime.value = T;
      ringMat.color.copy(COL.info).lerp(COL.gold, orbitGlow).multiplyScalar(1.5 + orbitGlow * 1.5);
      spin.updateMatrixWorld(true);
      var mw = spin.matrixWorld;
      function dot(ang, alt, col, kd, sizeW, minPx) { holoLocal(ang, alt, tmpV); tmpV.applyMatrix4(mw); glows.push(tmpV.x, tmpV.y, tmpV.z, col.r * kd, col.g * kd, col.b * kd, 1, sizeW, 0, minPx); return tmpV; }
      function lostDot(ang, ag) {
        var agE = Math.min(ag, 5.6), k2 = Math.max(0.25, 1 - ag / 7.5);
        holoLocal(ang + T * 0.03, 1, tmpV); tmpV.multiplyScalar(1 + agE * 0.09); tmpV.y -= agE * 0.05; tmpV.applyMatrix4(mw);
        tmpC2.copy(COL.info).lerp(COL.down, sat(ag / 2.5));
        glows.push(tmpV.x, tmpV.y, tmpV.z, tmpC2.r * 1.6 * k2, tmpC2.g * 1.6 * k2, tmpC2.b * 1.6 * k2, 1, 0.07, 0, 3.4 * k2 + 0.5); return tmpV;
      }
      function mark(r, v) { projV.copy(v).project(camera); r.sx = (projV.x * 0.5 + 0.5) * size.w; r.sy = (-projV.y * 0.5 + 0.5) * size.h; r.onMap = projV.z < 1; }
      var trajOpacity = 0, trajAlt = 0;
      if (DM) {
        var mothAlt = (inShow && (Show.state === "run" || E < 40)) ? Show.alt : (MOTH.state === "orbit" ? 1 : MOTH.alt);
        holoState.mothAlt = lerp(holoState.mothAlt, mothAlt, 1 - Math.exp(-dt * 6));
        sim.orbit.forEach(function (m) { if (m === MOTH) return; m.warm = Math.max(0, m.warm - dt / 8); var c = m.warm > 0 ? COL.gold : COL.info; dot(m.ang + T * 0.03, 1, c, 1.6 + m.warm * 1.4, 0.07, 3.5); });
        sim.flight.forEach(function (m) { if (m === MOTH) return; dot(m.ang, m.alt, COL.pale, 1.7, 0.07, 3.2); });
        WIN.forEach(function (m) { if (m === MOTH || m.state !== "queued") return; dot(m.ang, 0, COL.pale, 1.2 + 0.4 * beat, 0.06, 3); });
        sim.lost.forEach(function (m) { var ag = T - m.lostT; if (ag > 7.5) return; var k2 = 1 - ag / 7.5; holoLocal(m.ang + T * 0.03, 1, tmpV); tmpV.multiplyScalar(1 + ag * 0.09); tmpV.y -= ag * 0.05; tmpV.applyMatrix4(mw); tmpC2.copy(COL.info).lerp(COL.down, sat(ag / 2.5)); glows.push(tmpV.x, tmpV.y, tmpV.z, tmpC2.r * 1.6 * k2, tmpC2.g * 1.6 * k2, tmpC2.b * 1.6 * k2, 1, 0.07, 0, 3.4 * k2 + 0.5); });
        if (MOTH.state !== "lost") {
          var orbitedD = holoState.mothAlt > 0.995;
          var mcD = orbitedD ? tmpC.copy(COL.gold).lerp(COL.brand, 0.35) : COL.brand, mkD = 2.4 + (stCount ? beat * 1.2 : 0);
          var mangD = MOTH.ang + (orbitedD ? (T - holoState.mothOrbitT) * 0.03 : 0); dot(mangD, holoState.mothAlt, mcD, mkD, 0.12, 7); dot(mangD, holoState.mothAlt, mcD, 0.35 + orbitGlow * 0.6, 0.55, 18);
        }
        setTraj(MOTH.ang); trajAlt = holoState.mothAlt;
        trajOpacity = inShow && (Show.state === "run" || E < 30) ? (E < 22 ? 1 : 1 - sat((E - 22) / 6)) : 0;
      } else {
        live.list.forEach(function (r) {
          r.holoAlt = r.holoAlt == null || RM ? (r.alt == null ? 0 : r.alt) : lerp(r.holoAlt, r.alt == null ? 0 : r.alt, 1 - Math.exp(-dt * 6));
          var v = null, isF = r === live.focus;
          if (r.phase === "orbit") {
            r.warm = Math.max(0, r.warm - dt / 8);
            if (isF) { tmpC.copy(COL.gold).lerp(COL.brand, 0.35); v = dot(r.ang + T * 0.03, 1, tmpC, 2.4, 0.12, 7); mark(r, v); dot(r.ang + T * 0.03, 1, tmpC, 0.35 + orbitGlow * 0.6, 0.55, 18); }
            else { v = dot(r.ang + T * 0.03, 1, r.warm > 0 ? COL.gold : COL.info, 1.6 + r.warm * 1.4, 0.07, 3.5); mark(r, v); }
          } else if (r.phase === "ascent") {
            if (isF) { v = dot(r.ang, r.holoAlt, COL.brand, 2.4, 0.12, 7); mark(r, v); dot(r.ang, r.holoAlt, COL.brand, 0.35, 0.55, 18); }
            else { v = dot(r.ang, r.holoAlt, COL.pale, 1.7, 0.07, 3.2); mark(r, v); }
          } else if (r.phase === "pad") { v = dot(r.ang, 0, isF ? COL.brand : COL.pale, isF ? 2.0 : 1.2, 0.06, isF ? 5 : 3); mark(r, v); }
          else if (r.phase === "lost") { v = lostDot(r.ang, T - r.lostT); mark(r, v); }
          else { r.onMap = false; }   // a star shines in the window's sky, not on the map
          if (v && (r.id === live.sel || (isF && (r.phase === "orbit" || r.phase === "star")))) {
            var wx = tmpV.x, wy = tmpV.y, wz = tmpV.z;
            if (r.id === live.sel) selRings.push([wx, wy, wz, 0]);
            if (isF) for (var c = 0; c < 3; c++) if (r.checks[c] === "alive") selRings.push([wx, wy, wz, c + 1]);
          }
        });
        var fo = live.focus;
        if (fo && (fo.phase === "ascent" || fo.phase === "pad")) { setTraj(fo.ang); trajAlt = fo.holoAlt || 0; trajOpacity = 0.85; }
      }
      trajGeo.setDrawRange(0, Math.max(0, Math.floor(trajAlt * (trajN - 1)) + 1));
      trajMat.opacity = trajOpacity;
      pulseMat.opacity = orbitGlow; var ps = 1 + (1 - orbitGlow) * 0.75; pulseRing.scale.set(ps, ps, ps);
      // payout: a 1.5 s gold stream from the orbit point to the crew screen (only where a payout is real or DEMO)
      if (holoState.stream >= 0) {
        holoState.stream += dt; var st2 = holoState.stream - 0.35;
        if (st2 > 0) {
          holoLocal(holoState.fxAng, 1, sA); sA.applyMatrix4(mw);
          sB.set(0, -2.9, 0.15); TS[0].mesh.localToWorld(sB);
          sC.copy(sA).add(sB).multiplyScalar(0.5); sC.y += 5.5;
          for (var sk2 = 0; sk2 < 46; sk2++) {
            var tk = st2 / 1.5 - sk2 * 0.022; if (tk <= 0 || tk >= 1) continue;
            var e2 = eInOut(tk), i1 = 1 - e2;
            sP.set(i1 * i1 * sA.x + 2 * i1 * e2 * sC.x + e2 * e2 * sB.x, i1 * i1 * sA.y + 2 * i1 * e2 * sC.y + e2 * e2 * sB.y, i1 * i1 * sA.z + 2 * i1 * e2 * sC.z + e2 * e2 * sB.z);
            var ga = Math.sin(Math.PI * tk); glows.push(sP.x, sP.y, sP.z, COL.gold.r * 2.6 * ga, COL.gold.g * 2.6 * ga, COL.gold.b * 2.6 * ga, 1, 0.22, 0, 4.5);
          }
          if (st2 > 1.5 && !holoState.flashed) { holoState.flashed = true; holoState.screenFlash = 1; acc.screens = 9; }
          if (st2 > 1.5 + 46 * 0.022 * 1.5 + 0.2) holoState.stream = -1;
        }
      }
      holoState.screenFlash = Math.max(0, holoState.screenFlash - dt / 1.2);
      TS[0].mesh.material.color.setRGB(1 + holoState.screenFlash * 0.5, 1 + holoState.screenFlash * 0.38, 1 + holoState.screenFlash * 0.05);
      if (holoState.flash > 0) { holoLocal(holoState.fxAng, 1, tmpV); tmpV.applyMatrix4(mw); glows.push(tmpV.x, tmpV.y, tmpV.z, 3 * holoState.flash, 2.4 * holoState.flash, 1.2 * holoState.flash, 1, 2.6, 0, 0); }
      glows.end();
      rings.begin();
      for (var pi = holoPings.length - 1; pi >= 0; pi--) {
        var pg = holoPings[pi]; pg.t += dt; var dur = pg.big ? 1.6 : 1.1;
        if (pg.t > dur) { holoPings.splice(pi, 1); continue; }
        var kq = pg.t / dur, ang = pg.rot ? pg.ang + T * 0.03 : pg.ang;
        holoLocal(ang, pg.alt, tmpV); tmpV.applyMatrix4(mw);
        var cc = pg.col === 1 ? COL.up : pg.col === 2 ? COL.down : pg.col === 3 ? COL.gold : COL.info, ia = (1 - kq) * (1 - kq) * 1.8;
        rings.push(tmpV.x, tmpV.y, tmpV.z, cc.r * ia, cc.g * ia, cc.b * ia, 1, (pg.big ? 0.4 : 0.18) + kq * (pg.big ? 2.2 : 0.75), 0, 0);
      }
      // the selected mission's ring and the focus mission's day rings (one per check passed)
      for (var sr2 = 0; sr2 < selRings.length; sr2++) {
        var R1 = selRings[sr2];
        if (R1[3] === 0) { var pk = 0.75 + 0.25 * Math.sin(T * 3); rings.push(R1[0], R1[1], R1[2], COL.white.r * pk, COL.white.g * pk, COL.white.b * pk, 1, 0.42, 0, 0); }
        else rings.push(R1[0], R1[1], R1[2], COL.info.r * 0.9, COL.info.g * 0.9, COL.info.b * 0.9, 1, 0.16 + R1[3] * 0.08, 0, 0);
      }
      selRings.length = 0;
      rings.end();

      /* ---- canvases ---- */
      var mode = !DM || !inShow ? "idle" : (E < 10 ? "count" : (E < 22 ? "ascent" : (E < 27 ? "orbit" : "idle")));
      acc.atlas += dt; acc.screens += dt; acc.board += dt; acc.tick += dt; acc.tickText += dt;
      projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projM);
      var atlasRate = mode === "idle" ? 0.34 : (mode === "count" ? 0.12 : 0.2);
      if (acc.atlas > atlasRate && frustum.intersectsObject(AT.mesh)) { acc.atlas = 0; drawAtlas(mode); }
      if (acc.screens > 0.22) {
        acc.screens = 0;
        if (frustum.intersectsObject(TS[0].mesh)) { if (DM) drawLeftDemo(); else drawLeftLive(); }
        if (frustum.intersectsObject(TS[1].mesh)) { if (DM) drawRightDemo(); else drawRightLive(); }
      }
      var bs = DM ? boardDemo(E, L) : boardLive();
      var bkey = bs.a + "|" + bs.b + "|" + bs.big + "|" + bs.bigCol;
      if (bkey !== BRD.last && acc.board > 0.2) { acc.board = 0; BRD.last = bkey; drawBoard(bs); }
      if (acc.tickText > 6 || !BRD.tickW) { acc.tickText = 0; if (DM) buildTickerDemo(); else buildTickerLive(); }
      if (acc.tick > (RM ? 0.5 : 1 / 14)) { acc.tick = 0; if (!RM) BRD.scroll = (BRD.scroll + 1) % Math.max(1, BRD.tickW); drawTicker(); }

      /* ---- payout anchor (screen position over the holo-table) ---- */
      anchorV.set(HOLO.c.x, HOLO.y + 0.2, HOLO.c.z).project(camera);
      lastAnchor.x = (anchorV.x * 0.5 + 0.5) * size.w; lastAnchor.y = (-anchorV.y * 0.5 + 0.5) * size.h;

      /* ---- render ---- */
      if (composer) composer.render(dt); else renderer.render(scene, camera);
      perfTick(dt);
    }
    var selRings = [];

    applyTier();
    call("onQuality", tier, 0);
    if (D.fonts && D.fonts.load) { Promise.all([D.fonts.load("600 20px " + MONO), D.fonts.load("700 20px " + SANS), D.fonts.load("800 20px " + SANS)]).then(function () { BRD.last = ""; acc.atlas = acc.screens = acc.tickText = 9; }).catch(function () { /* fonts optional */ }); }

    return {
      update: update,
      resize: resize,
      anchor: function () { return lastAnchor; },
      /* DEMO enters: the concept's opening scene */
      enterDemo: function () { fireP.n = 0; smokeP.n = 0; holoPings.length = 0; holoState.gold = 0; holoState.flash = 0; holoState.stream = -1; holoState.mothAlt = 0; podFlash = 0; mStars = demoStars(); resetLaunch(); acc.atlas = acc.screens = acc.tickText = 9; BRD.last = ""; },
      /* LIVE returns: no simulated trace left behind */
      exitDemo: function () { fireP.n = 0; smokeP.n = 0; holoPings.length = 0; holoState.gold = 0; holoState.flash = 0; holoState.stream = -1; ventOn = false; mStars = []; acc.atlas = acc.screens = acc.tickText = 9; BRD.last = ""; },
      touch: function () { acc.atlas = acc.screens = acc.tickText = 9; },
      setFocusShip: setFocusShip,
      syncStars: syncLiveStars,
      led: ledFlash,
      ping: ping,
      orbitFx: orbitFx,
      exitClip: function () { live.exitRise = live.lastRise || 0; },
      dispose: function () {
        disposeRig(liveRig); liveRig = null;
        disposeRig(demoRig);
        distOwn.forEach(function (m) { m.dispose(); });
        scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { m.dispose(); }); }
        });
        Object.keys(M).forEach(function (k) { M[k].dispose(); });
        [flameMat, fogMat, beamMat, planetMat, coneMat, apronMat, shaftMat, moteMat, starMat, skyMat].forEach(function (m) { m.dispose(); });
        texList.forEach(function (t) { t.dispose(); });
        if (composer) { composer.dispose(); if (bloom) bloom.dispose(); if (finalPass) finalPass.dispose(); composer = null; }
        renderer.dispose();
        try { renderer.forceContextLoss(); } catch { /* already lost */ }
      }
    };
  }

  /* ============================== BOARDS (the LED board and the 2D fallback read the same words) ============================== */
  function livePillText() { return live.network === "devnet" ? "LIVE · DEVNET" : live.network === "mainnet" ? "LIVE · SOLANA" : "LIVE"; }
  function boardDemo(E, L) {
    if (Show.state === "pre") return { a: "DEMO · NEXT · $MOTH · CREW 4", b: "WINDOW 21:00 UTC", big: "T-" + hms(nextWindowIn()), bigCol: "#FFE9C9" };
    if (E < 10) { const n = Math.max(0, 10 - Math.floor(E)); return { a: Show.replay ? "REPLAY · $MOTH · CREW 4" : "$MOTH · CREW OF 4", b: "WINDOW 21:00 UTC", big: "T-00:00:" + p2(n), bigCol: n <= 3 ? "#FFB062" : "#F5B544" }; }
    if (E < 22) return { a: Show.replay ? "REPLAY · $MOTH" : "$MOTH · ASCENT", b: "ALT " + Math.floor(Show.alt * 100) + "% · HOLDERS " + Show.hold, big: L < 3 ? "LIFTOFF" : "T+" + hms(L), bigCol: L < 3 ? "#FC9D01" : "#FFE9C9", aCol: "#FF9A5C" };
    if (E < 32) return { a: Show.replay ? "REPLAY · ORBIT" : "$MOTH · ORBIT", b: "+$123.64 TO CREW OF 4", big: "ORBIT", bigCol: "#F5B544", bCol: "#F5B544" };
    return { a: "DEMO · IN FLIGHT " + sim.flight.length + " · ORBIT " + sim.orbit.length, b: "WINDOW 21:15 UTC", big: "T-" + hms(nextWindowIn()), bigCol: "#FFE9C9" };
  }
  const CHECK_SYM = { alive: "✓", quiet: "×", young: "·", unread: "-" };
  function checksLine(r) { return CHECK_DAYS.map((d, i) => "D" + d + " " + (CHECK_SYM[r.checks[i]] || "-")).join("  "); }
  function holdLed(r) { return r.holders == null ? "-" : String(r.holders) + (r.holdersAtLeast ? "+" : ""); }
  function fmtAlt(r) { return r.altPct == null ? "—" : r.altPct.toFixed(1) + "%"; }
  /* The day of the check that went quiet — «SIGNAL LOST · DAY 30» — never the mission's age now. */
  function lostDayOf(r) { if (r.lostDay != null) return r.lostDay; const i = r.checks.indexOf("quiet"); if (i >= 0) return CHECK_DAYS[i]; return r.day != null ? r.day : null; }
  function boardLive() {
    const f = live.focus, T = clock.T;
    if (!live.ready) return { a: "MISSION CONTROL", b: "", big: "READING THE CHAIN", bigCol: "#FFE9C9" };
    if (!f) return { a: "THIS MISSION IS", b: "", big: "NOT IN THE SKY NOW", bigCol: "#C9D6E6", aCol: "#8A97A8" };
    const tk = f.ticker.toUpperCase();
    if (T - live.orbitFxT < 9) return { a: (live.orbitFxReplay ? "REPLAY · " : "") + tk + " · ORBIT", b: "DAMM V2 POOL OPEN", big: "ORBIT", bigCol: "#F5B544", bCol: "#F5B544" };
    if (f.phase === "ascent" && T >= live.liftT && T - live.liftT < 3) return { a: tk + " · ASCENT", b: "HOLDERS " + holdLed(f), big: "LIFTOFF", bigCol: "#FC9D01", aCol: "#FF9A5C" };
    if (f.phase === "ascent") return { a: tk + " · ASCENT", aCol: "#FF9A5C", b: "HOLDERS " + holdLed(f) + (f.day != null ? " · DAY " + f.day : ""), big: "IN FLIGHT · " + fmtAlt(f), bigCol: "#FFE9C9" };
    if (f.phase === "orbit") return { a: tk + " · ORBIT", aCol: "#F5B544", b: checksLine(f), big: "IN ORBIT" + (f.day != null ? " · DAY " + f.day : ""), bigCol: "#F5B544" };
    if (f.phase === "star") return { a: tk + " · STAR", aCol: "#F5B544", b: checksLine(f), big: "DAY 90 · STAR", bigCol: "#F5B544" };
    if (f.phase === "lost") { const d = lostDayOf(f); return { a: tk + " · SIGNAL LOST", aCol: "#8A97A8", b: checksLine(f), big: "SIGNAL LOST" + (d != null ? " · DAY " + d : ""), bigCol: "#B9C6D6" }; }
    return { a: tk + " · ON THE PAD", b: "HOLDERS " + holdLed(f), big: "ON THE PAD", bigCol: "#FFE9C9" };
  }
  function fallbackUpdate() {
    let a, b, big, alt;
    if (demo.on) {
      const E = Show.e, L = E - 10, bs = boardDemo(E, L);
      a = bs.a; b = bs.b; big = bs.big;
      const al = Show.state === "pre" ? 0 : (Show.state === "run" || E < 40 ? Show.alt : MOTH.alt);
      alt = "DEMO · ALTITUDE " + Math.floor(al * 100) + "% · HOLDERS " + (Show.state === "pre" ? 0 : Show.hold || MOTH.holders);
    } else {
      const bs = boardLive(), f = live.focus;
      a = bs.a; b = bs.b; big = bs.big;
      alt = f ? "ALTITUDE " + (f.phase === "orbit" || f.phase === "star" ? "100%" : fmtAlt(f)) + " · HOLDERS " + holdLed(f) : (live.ready && !live.list.length ? "NO MISSIONS IN FLIGHT RIGHT NOW" : livePillText());
    }
    $("fbA").textContent = a; $("fbB").textContent = b; $("fbCount").textContent = big; $("fbAlt").textContent = alt;
  }

  /* ============================== LIVE: the roster from setSnapshot ============================== */
  const PHASES = { pad: 1, ascent: 1, orbit: 1, star: 1, lost: 1 };
  const DEMO_ONLY = { countdown: 1, window: 1, rollout: 1, approach: 1, fee: 1 };
  const CHECKS_OK = { young: 1, alive: 1, quiet: 1, unread: 1 };
  const tickerOf = (t) => { t = String(t == null ? "" : t).trim() || "$—"; return t[0] === "$" ? t : "$" + t; };
  function pushH(r, v) { const h = r.hist; if (h.length && Math.abs(h[h.length - 1] - v) < 1e-6) return; h.push(v); if (h.length > 64) h.shift(); }
  function podsFor(r) { const a = r.phase === "orbit" || r.phase === "star" ? 1 : (r.alt == null ? 0 : r.alt); return Math.max(r.boosters || 0, a >= 0.75 ? 3 : a >= 0.5 ? 2 : a >= 0.25 ? 1 : 0); }
  function recFrom(m, prev) {
    const r = prev || { id: m.id, hist: [], warm: 0, lostT: -99, holoAlt: null, sx: 0, sy: 0, onMap: false, boosters: 0, lostDay: null };
    r.ticker = tickerOf(m.ticker); r.name = String(m.name == null ? "" : m.name);
    r.phase = PHASES[m.phase] ? m.phase : "ascent";
    r.altPct = isNum(m.altitude) ? clamp(m.altitude, 0, 100) : null;
    if (r.phase === "orbit" || r.phase === "star") r.altPct = 100;
    r.alt = r.altPct == null ? null : r.altPct / 100;
    if (r.alt != null) pushH(r, r.alt);
    r.day = isNum(m.day) ? m.day : null;
    const ch = Array.isArray(m.checks) ? m.checks : [];
    r.checks = [0, 1, 2].map((i) => (CHECKS_OK[ch[i]] ? ch[i] : "unread"));
    r.holders = isNum(m.holders) ? m.holders : null; r.holdersAtLeast = m.holdersAtLeast === true;
    r.crew = Array.isArray(m.crew) ? m.crew.map((c) => String(c)) : [];
    /* MC-3: why the signal was lost, in the scene's own calm words (`signalLost` in scene.ts). */
    r.signal = r.phase === "lost" && m.signal && typeof m.signal.reason === "string" ? { day: isNum(m.signal.day) ? m.signal.day : null, reason: m.signal.reason, line: typeof m.signal.line === "string" ? m.signal.line : m.signal.reason, short: typeof m.signal.short === "string" ? m.signal.short : "" } : null;
    if (r.signal && r.signal.day != null) r.lostDay = r.signal.day;
    r.test = m.ryntraTest === true; r.ship = m.ship || null;
    r.href = typeof m.href === "string" && (/^\/(?!\/)/.test(m.href) || /^https:\/\//.test(m.href)) ? m.href : null;
    r.marketCapUsd = isNum(m.marketCapUsd) ? m.marketCapUsd : null; r.sinceLiftoff = isNum(m.sinceLiftoff) ? m.sinceLiftoff : null; r.liquidityUsd = isNum(m.liquidityUsd) ? m.liquidityUsd : null;
    if (!prev) { const seed = r.ship && isNum(r.ship.seed) ? (r.ship.seed >>> 0) : hashStr(r.id); r.ang = mulberry32(seed || 1)() * Math.PI * 2; }
    return r;
  }
  const PH_ORDER = { ascent: 0, pad: 1, orbit: 2, star: 3, lost: 4 };
  function sortList() {
    live.list = Array.from(live.recs.values()).sort((a, b) => {
      if (a === live.focus) return -1; if (b === live.focus) return 1;
      const d = PH_ORDER[a.phase] - PH_ORDER[b.phase]; if (d) return d;
      return (b.alt || 0) - (a.alt || 0);
    });
  }
  function starCount() { let n = isNum(live.snap && live.snap.stars) ? Math.max(0, Math.floor(live.snap.stars)) : 0; live.recs.forEach((r) => { if (r.phase === "star") n++; }); return n; }
  function applySnapshot(s) {
    live.ready = true;
    live.network = s.network === "mainnet" || s.network === "devnet" ? s.network : null;
    const seen = new Set();
    s.missions.forEach((m) => {
      if (!m || typeof m.id !== "string") return;
      seen.add(m.id);
      live.recs.set(m.id, recFrom(m, live.recs.get(m.id)));
    });
    Array.from(live.recs.keys()).forEach((id) => { if (!seen.has(id)) live.recs.delete(id); });
    const prevFocus = live.focus;
    live.focus = FOCUS ? live.recs.get(FOCUS) || null : null;
    if (live.focus !== prevFocus) live.riseS = null;
    if (live.sel && !live.recs.has(live.sel)) live.sel = null;
    sortList();
    if (GL) { GL.setFocusShip(live.focus); GL.syncStars(starCount(), !!(live.focus && live.focus.phase === "star"), false, false); GL.touch(); }
    liveHud();
  }
  function logLine(html) { live.log.push(html); if (live.log.length > 40) live.log.shift(); if (!demo.on) feedPush(html); }

  /* ------------------------------ LIVE events (a quiet one is history: its line and its numbers, no effect) ------------------------------ */
  function liveFeedLine(ev, r) {
    const tk = "<b>" + esc(r.ticker) + "</b>";
    const altTxt = r.phase === "orbit" || r.phase === "star" ? "in orbit" : r.altPct == null ? "" : "altitude " + Math.floor(r.altPct) + "%";
    switch (ev.type) {
      case "buy": return tk + '<span class="cr-up">buy' + (isNum(ev.usd) ? " " + usd0(ev.usd) : "") + "</span>" + (altTxt ? " · " + altTxt : "");
      case "sell": return tk + '<span class="cr-dn">sell' + (isNum(ev.usd) ? " " + usd0(ev.usd) : "") + "</span>" + (altTxt ? " · " + altTxt : "");
      case "ignite": return tk + '<span class="cr-hi">LIFTOFF</span> · created on its curve';
      case "booster": return tk + '<span class="cr-hi">BOOSTER ' + ev.n + "</span> · altitude " + ([25, 50, 75][ev.n - 1] || "") + "%";
      case "orbit": return tk + '<span class="cr-gold">ORBIT</span> · DAMM v2 pool open' + (isNum(ev.payoutUsd) ? " · +" + usd2(ev.payoutUsd) + " to the creator" : "");
      case "check": return tk + '<span class="cr-info">Day ' + ev.day + " check passed</span>";
      case "lost": return tk + '<span class="cr-mut">Signal lost · Day ' + ev.day + " check" + (typeof ev.reason === "string" && ev.reason ? " · " + esc(ev.reason) : "") + "</span>";
      case "star": return tk + '<span class="cr-gold">Day 90 check passed · now a star</span>';
    }
    return null;
  }
  function startLiftoff(r) {
    if (r.phase === "pad") r.phase = "ascent";
    if (r.phase !== "ascent") return;
    live.liftT = clock.T; live.riseS = null;
    showTitle("LIFTOFF", r.ticker + " · created on its curve", false);
    Sound.rumble(); sr("Liftoff. " + r.ticker + " lifted off on its curve.");
  }
  function orbitMoment(r, payout, replay, fromAscent) {
    const pay = isNum(payout) ? payout : null;
    showTitle("ORBIT", (replay ? "Replay · " : "") + r.ticker + " reached orbit · DAMM v2 pool open" + (pay != null ? " · +" + usd2(pay) + " to the creator" : ""), true);
    live.orbitFxT = clock.T; live.orbitFxReplay = !!replay;
    if (GL) {
      GL.ping(r.ang, true, 1, 3, true);
      GL.orbitFx(r.ang + clock.T * 0.03, pay != null);
      if (fromAscent) { GL.exitClip(); live.exitT = clock.T; }
    }
    if (pay != null) payShow("+" + usd2(pay), "to the creator");
    Sound.chime();
    sr((replay ? "Replay. " : "Orbit. ") + r.ticker + " reached orbit. Its DAMM v2 pool is open.");
    if (replay) logLine('<span class="cr-rp">REPLAY</span><b>' + esc(r.ticker) + '</b><span class="cr-gold">ORBIT</span> · DAMM v2 pool open');
    if (GL) GL.touch();
    liveHud();
  }
  function liveEmit(ev) {
    if (!ev || typeof ev.type !== "string" || DEMO_ONLY[ev.type]) return;
    const r = typeof ev.id === "string" ? live.recs.get(ev.id) : null;
    if (!r) return;
    const fx = ev.quiet !== true, isF = r === live.focus, big = fx && isF, prevPhase = r.phase;
    switch (ev.type) {
      case "ignite":
        if (big) startLiftoff(r);
        break;
      case "buy": case "sell": {
        const buy = ev.type === "buy";
        if (isNum(ev.altitude) && (r.phase === "ascent" || r.phase === "pad")) { r.altPct = clamp(ev.altitude, 0, 100); r.alt = r.altPct / 100; pushH(r, r.alt); }
        live.tape.unshift({ tk: r.ticker, buy: buy, usd: isNum(ev.usd) ? ev.usd : null, sig: ev.signature, T: fx ? clock.T : -9, own: isF });
        if (live.tape.length > 24) live.tape.pop();
        if (fx && GL) {
          GL.led(hashStr(r.id), buy);
          if (r.phase === "ascent") GL.ping(r.ang, false, r.alt == null ? 0 : r.alt, buy ? 1 : 2, false);
          else if (r.phase === "orbit") GL.ping(r.ang, true, 1, buy ? 1 : 2, false);
        }
        if (big) { if (buy) live.surge = Math.min(1, live.surge + 0.55); Sound.tick(buy); }
        break;
      }
      case "booster":
        if (ev.n === 1 || ev.n === 2 || ev.n === 3) r.boosters = Math.max(r.boosters || 0, ev.n);
        if (fx && GL) GL.led(hashStr(r.id), true);
        break;
      case "orbit":
        r.phase = "orbit"; r.altPct = 100; r.alt = 1; pushH(r, 1); r.warm = fx ? 1 : 0;
        if (big) orbitMoment(r, ev.payoutUsd, false, prevPhase === "ascent" || prevPhase === "pad");
        else if (fx && GL) GL.ping(r.ang, true, 1, 3, true);
        break;
      case "check": {
        const i = CHECK_DAYS.indexOf(ev.day); if (i >= 0) r.checks[i] = "alive";
        if (isNum(ev.day) && (r.day == null || r.day < ev.day)) r.day = ev.day;
        if (fx && GL) GL.ping(r.ang, r.phase === "orbit", 1, 4, false);
        break;
      }
      case "lost": {
        const i = CHECK_DAYS.indexOf(ev.day); if (i >= 0) r.checks[i] = "quiet";
        r.phase = "lost"; r.lostDay = isNum(ev.day) ? ev.day : null; r.lostT = fx ? clock.T : -99;
        if (big) sr("Signal lost. " + r.ticker + " at the Day " + ev.day + " check" + (typeof ev.reason === "string" && ev.reason ? ": " + ev.reason : "") + ".");
        break;
      }
      case "star":
        r.phase = "star"; r.checks[2] = "alive"; r.altPct = 100; r.alt = 1;
        if (fx && GL) GL.ping(r.ang, false, 1, 3, false);
        if (big) sr("Day 90 passed. " + r.ticker + " is a star.");
        break;
      default: return;
    }
    const line = liveFeedLine(ev, r);
    if (line) logLine(line);
    if (r.phase !== prevPhase || ev.type === "check" || ev.type === "star") {
      sortList();
      if (GL) GL.syncStars(starCount(), !!(live.focus && live.focus.phase === "star"), big && ev.type === "star", fx && !isF && ev.type === "star");
    }
    if (GL) GL.touch();
    liveHud();
  }

  /* ------------------------------ LIVE HUD: the top bar, the hero, the crew panel, the card ------------------------------ */
  const hudMemo = {};
  function setText(name, text) { if (hudMemo[name] === text) return; hudMemo[name] = text; $(name).textContent = text; }
  const PHASE_SENT = { ascent: "in flight on its curve to the DEX.", orbit: "in orbit: its DAMM v2 pool is open.", star: "Day 90 passed: it is a star.", lost: "signal lost at a check.", pad: "on the pad." };
  function tradeHref(id) { return "/app/launch/" + encodeURIComponent(id); }
  function liveHud() {
    if (disposed) return;
    const f = live.focus;
    setText("livePill", demo.on ? "DEMO" : livePillText());
    setText("mTk", f ? f.ticker : "—");
    setText("mName", f ? f.name : "");
    $("mTest").hidden = !(f && f.test); $("hTest").hidden = !(f && f.test);
    setText("lAlt", f ? (f.phase === "orbit" || f.phase === "star" ? "100%" : fmtAlt(f)) : "—");
    setText("lHold", f ? (f.holders == null ? "—" : nf0.format(f.holders) + (f.holdersAtLeast ? "+" : "")) : "—");
    setText("lDay", f && f.day != null ? String(f.day) : "—");
    setText("lSky", live.ready ? String(live.list.filter((r) => r.phase === "ascent").length) : "—");
    setText("hEye", "Control room" + (live.network ? " · " + (live.network === "devnet" ? "Devnet" : "Solana") : ""));
    const title = !live.ready ? "Reading the chain…" : !f ? "This mission is not in the sky now" : f.ticker;
    setText("hTitle", title);
    $("hTitle").classList.toggle("cr-h1-sm", !f);
    setText("hText", !live.ready ? "Mission control is reading this mission from the chain." : !f ? (live.list.length ? "The missions in the sky now are on the orbit map." : "No missions in flight right now.") : (f.phase === "lost" && f.signal ? f.signal.line : (f.name ? f.name + " — " : "") + PHASE_SENT[f.phase]));
    const ctaKey = f && f.id.indexOf("demo:") !== 0 ? f.id : "";
    if (hudMemo.cta !== ctaKey) {
      hudMemo.cta = ctaKey;
      $("hCta").innerHTML = ctaKey ? '<a class="cr-btn cr-btn-primary" href="' + esc(tradeHref(ctaKey)) + '">Trade</a>' : "";
    }
    const crewKey = f ? f.crew.join("|") : "-";
    if (hudMemo.crew !== crewKey) {
      hudMemo.crew = crewKey;
      const ol = $("crewList"); ol.textContent = "";
      const list = f ? f.crew : [];
      if (!list.length) { const li = D.createElement("li"); li.className = "cr-qrow cr-crew cr-crew-empty"; li.textContent = "—"; ol.appendChild(li); }
      list.forEach((c) => {
        const li = D.createElement("li"); li.className = "cr-qrow cr-crew";
        const av = D.createElement("span"); av.className = "cr-av"; const i = D.createElement("i"); i.style.setProperty("--c", AVC[hashStr(c) % AVC.length]); i.textContent = c.slice(0, 2).toUpperCase(); av.appendChild(i);
        const tk = D.createElement("span"); tk.className = "cr-qmain"; const t = D.createElement("span"); t.className = "cr-qtk"; t.textContent = c; tk.appendChild(t);
        li.appendChild(av); li.appendChild(tk); ol.appendChild(li);
      });
    }
    $("btnOrbitReplay").hidden = !(f && f.phase === "orbit");
    renderCard();
    if (!GL) fallbackUpdate();
  }
  function phaseLine(r) {
    const hold = r.holders == null ? "" : " · holders " + nf0.format(r.holders) + (r.holdersAtLeast ? "+" : "");
    if (r.phase === "ascent") return "In flight · altitude " + fmtAlt(r) + (r.day != null ? " · day " + r.day : "") + hold;
    if (r.phase === "orbit") return "In orbit" + (r.day != null ? " · day " + r.day : "") + " · DAMM v2 pool open" + hold;
    if (r.phase === "star") return "A star · Day 90 passed" + hold;
    if (r.phase === "lost") { const d = lostDayOf(r); return "Signal lost" + (d != null ? " · day " + d : "") + hold; }
    return "On the pad" + hold;
  }
  function renderCard() {
    const card = $("card"), r = !demo.on && live.sel ? live.recs.get(live.sel) : null;
    const key = r ? [r.id, r.ticker, r.name, r.test, phaseLine(r), r.href].join("|") : "";
    if (hudMemo.card === key) return; hudMemo.card = key;
    if (!r) { card.hidden = true; card.textContent = ""; return; }
    let acts = "";
    if (r.href && r.id !== FOCUS) acts += '<a class="cr-btn cr-btn-ghost cr-btn-sm" href="' + esc(r.href) + '">Open Control Room</a>';
    if (r.id.indexOf("demo:") !== 0) acts += '<a class="cr-btn cr-btn-primary cr-btn-sm" href="' + esc(tradeHref(r.id)) + '">Trade</a>';
    card.innerHTML = '<button class="cr-card-x" type="button" data-close="1" aria-label="Close">×</button>' +
      '<div class="cr-card-tk"><b>' + esc(r.ticker) + "</b>" + (r.test ? '<span class="cr-test" title="' + TEST_TITLE + '">RYNTRA TEST</span>' : "") + "</div>" +
      (r.name ? '<div class="cr-card-name">' + esc(r.name) + "</div>" : "") +
      '<div class="cr-card-line">' + esc(phaseLine(r)) + "</div>" +
      (acts ? '<div class="cr-card-acts">' + acts + "</div>" : "");
    card.hidden = false;
  }
  function setSelected(id, fromScene) {
    const next = !demo.on && typeof id === "string" && live.recs.has(id) ? id : null;
    const changed = next !== live.sel;
    live.sel = next;
    renderCard();
    if (fromScene && changed) call("onSelect", next);
  }
  listen($("card"), "click", (ev) => { const t = ev.target; if (t && t.closest && t.closest("[data-close]")) setSelected(null, true); });
  listen($("gl"), "click", (ev) => {
    if (demo.on || !GL || !live.ready) return;
    const rect = root.getBoundingClientRect(), x = ev.clientX - rect.left, y = ev.clientY - rect.top, rad = COARSE ? 30 : 20;
    let best = null, bd = rad * rad;
    live.list.forEach((r) => { if (!r.onMap) return; const dx = r.sx - x, dy = r.sy - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = r; } });
    if (best) setSelected(best.id, true);
    else if (live.sel) setSelected(null, true);
  });

  /* ============================== DEMO on / off ============================== */
  function startDemo() {
    if (disposed || demo.on) return;
    demo.on = true;
    setSelected(null, false);
    root.classList.add("is-demo");
    clearTitle(); payClear(); toastClear(); feedClear();
    makeDemoWorld();
    buildQueue();
    H.paidShown = sim.paid; H.lastNext = ""; H.lastFl = -1; H.lastOr = -1; H.paid.textContent = usd0(sim.paid);
    if (GL) GL.enterDemo();
    for (let i = 0; i < 7; i++) simTrade();
    simCall(null);
    updateQueue();
    setText("livePill", "DEMO");
    call("onSource", "demo");
    if (!GL) fallbackUpdate();
  }
  function endDemo() {
    if (disposed || !demo.on) return;
    demo.on = false;
    root.classList.remove("is-demo", "in-event");
    clearTitle(); payClear(); toastClear(); feedClear();
    $("cut").classList.remove("on"); cutBusy = false;
    Show = { state: "off", start: 0, t0: 0, replay: false, e: -99, script: [], i: 0, sec: 11, flags: {}, alt: 0, hold: 0, lastFeed: -9, altHist: [] };
    WIN = []; MOTH = null; sim = null; $("qList").textContent = "";
    if (GL) GL.exitDemo();
    live.log.slice(-14).forEach((html) => feedPush(html));
    if (live.snap) applySnapshot(live.snap); else liveHud();
    call("onSource", "live");
  }

  /* ============================== BOOT ============================== */
  syncSoundBtn();
  liveHud();
  let fellBack = false;
  function toFallback() {
    if (fellBack) return;
    fellBack = true;
    const g = GL; GL = null;
    if (g) { try { g.dispose(); } catch { /* the context is gone */ } }
    root.classList.add("no-gl");
    $("fallback").hidden = false;
    fallbackUpdate();
    call("onRenderer", "2d");
  }
  try { GL = initGL(); } catch { GL = null; }
  if (GL) {
    call("onRenderer", "webgl");
    listen($("gl"), "webglcontextlost", (ev) => { ev.preventDefault(); toFallback(); });
  } else toFallback();
  call("onSource", "live");

  let ro = null;
  const onResize = () => { view.w = Math.max(1, root.clientWidth); view.h = Math.max(1, root.clientHeight); if (GL) GL.resize(); };
  if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(onResize); ro.observe(root); } else listen(W, "resize", onResize);

  // the clock: real time since mount minus time the tab was hidden; effects use a clamped per-frame dt
  const boot = performance.now();
  let raf = 0, hiddenAt = 0, hiddenAcc = 0, prevT = 0, fbAcc = 0, firstFrame = true;
  listen(D, "visibilitychange", () => {
    if (D.hidden) hiddenAt = performance.now();
    else if (hiddenAt) { hiddenAcc += performance.now() - hiddenAt; hiddenAt = 0; }
  });
  function frame() {
    raf = W.requestAnimationFrame(frame);
    if (D.hidden || disposed) return;
    const T = Math.max(prevT, (performance.now() - boot - hiddenAcc) / 1000);
    const warm = firstFrame; firstFrame = false;   // the first render compiles shaders
    const dt = Math.min(0.1, T - prevT); prevT = T;
    clock.T = T;
    if (demo.on) { simUpdate(dt); if (!warm) showUpdate(); hudUpdateDemo(dt); }
    feedUpdate(dt);
    payUpdate(dt);
    if (GL) { try { GL.update(dt); } catch { toFallback(); } }
    else { fbAcc += dt; if (fbAcc > 0.2) { fbAcc = 0; fallbackUpdate(); } }
  }
  raf = W.requestAnimationFrame(frame);

  return {
    setSnapshot(snapshot) {
      if (disposed || !snapshot || !Array.isArray(snapshot.missions)) return;
      live.snap = snapshot;
      if (!demo.on) applySnapshot(snapshot);
    },
    emit(event) {
      if (disposed || demo.on) return;
      liveEmit(event);
    },
    select(id) { if (!disposed) setSelected(id, false); },
    playDemo() { startDemo(); },
    stopDemo() { endDemo(); },
    setSound(on) { if (!disposed) Sound.setOn(!!on); },
    dispose() {
      if (disposed) return;
      disposed = true;
      W.cancelAnimationFrame(raf);
      offs.forEach((off) => off()); offs.length = 0;
      if (ro) { ro.disconnect(); ro = null; }
      timers.forEach((id) => clearTimeout(id)); timers.clear();
      Sound.close();
      if (GL) { try { GL.dispose(); } catch { /* already gone */ } GL = null; }
      demoListeners.length = 0;
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      root.classList.remove("is-rm", "is-demo", "in-event", "no-gl");
      if (!hadClass) root.classList.remove(ROOT_CLASS);
    }
  };
}

/* the board's 5×7 LED font (the concept's, plus ✓ for a passed check) */
const F5 = {
  "0": "01110100011001110101110011000101110", "1": "00100011000010000100001000010001110", "2": "01110100010000100010001000100011111", "3": "11111000100010000010000011000101110",
  "4": "00010001100101010010111110001000010", "5": "11111100001111000001000011000101110", "6": "00110010001000011110100011000101110", "7": "11111000010001000100010000100001000",
  "8": "01110100011000101110100011000101110", "9": "01110100011000101111000010001001100", "A": "01110100011000111111100011000110001", "B": "11110100011000111110100011000111110",
  "C": "01110100011000010000100001000101110", "D": "11100100101000110001100011001011100", "E": "11111100001000011110100001000011111", "F": "11111100001000011110100001000010000",
  "G": "01110100011000010111100011000101111", "H": "10001100011000111111100011000110001", "I": "01110001000010000100001000010001110", "J": "00111000100001000010000101001001100",
  "K": "10001100101010011000101001001010001", "L": "10000100001000010000100001000011111", "M": "10001110111010110101100011000110001", "N": "10001100011100110101100111000110001",
  "O": "01110100011000110001100011000101110", "P": "11110100011000111110100001000010000", "Q": "01110100011000110001101011001001101", "R": "11110100011000111110101001001010001",
  "S": "01111100001000001110000010000111110", "T": "11111001000010000100001000010000100", "U": "10001100011000110001100011000101110", "V": "10001100011000110001100010101000100",
  "W": "10001100011000110101101011010101010", "X": "10001100010101000100010101000110001", "Y": "10001100011000101010001000010000100", "Z": "11111000010001000100010001000011111",
  "$": "00100011111010001110001011111000100", ":": "00000011000110000000011000110000000", "-": "00000000000000011111000000000000000", "+": "00000001000010011111001000010000000",
  ".": "00000000000000000000000000110001100", ",": "00000000000000000000011000010001000", "%": "11000110010001000100010001001100011", "/": "00000000010001000100010001000000000",
  "·": "00000000000000001100011000000000000", "×": "00000100010101000100010101000100000", "▲": "00000001000111011111000000000000000", "▼": "00000111110111000100000000000000000",
  "✓": "00000000010000100010100100110000100", " ": "00000000000000000000000000000000000"
};
function ledW(str, sc) { return str.length * 6 * (sc || 1) - (sc || 1); }

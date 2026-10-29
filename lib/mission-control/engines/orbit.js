/* =====================================================================
   RYNTRA MISSION CONTROL · ORBIT — concept A (ryntra.io's home), as a product renderer.
   Port of docs/research/ryntra-launch-2026-10-25/concepts/orbit.html: the same sky, planet, ring, ships, camera,
   synth, quality tiers and 2D board — driven by `setSnapshot` / `emit` (LIVE) or by the concept's own simulator
   (`playDemo`, and the whole scene says DEMO). Never both at once.
   ===================================================================== */
import * as THREE from "three-r147";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/* ---------- math & format helpers ---------- */
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sat = (x) => clamp(x, 0, 1);
const easeOut3 = (t) => 1 - Math.pow(1 - sat(t), 3);
const easeInOut3 = (t) => { t = sat(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const easeIn2 = (t) => sat(t) * sat(t);
const num = (v) => typeof v === 'number' && isFinite(v);
const fmt0 = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmt2 = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n);
const fmtAlt = (a) => (a >= 99.95 ? '100' : a.toFixed(1)) + '%';
const fmtX = (x) => '×' + (x < 10 ? x.toFixed(1) : Math.round(x).toString());
const fmtUsd = (n) => n >= 1000 ? '$' + Math.round(n).toLocaleString('en-US') : n >= 10 ? '$' + Math.round(n) : '$' + n.toFixed(2);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = (s) => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const DASH = '—';
const TEST_TITLE = 'Ryntra’s own launch — technical validation, not demand';
const CHECK_DAYS = [7, 30, 90];
const CHECK_IX = { 7: 0, 30: 1, 90: 2 };
const LIVE_TYPES = new Set(['ignite', 'buy', 'sell', 'booster', 'orbit', 'check', 'lost', 'star']);
const PHASES = new Set(['pad', 'ascent', 'orbit', 'star', 'lost']);
const safeHref = (h) => (typeof h === 'string' && (/^\/(?!\/)/.test(h) || /^https:\/\//.test(h))) ? h : null;

/* ---------- product constants (DEMO simulator only: Classic curve) ---------- */
const GRAD_USDC = 15454, MC0 = 5000, MC1 = 75000;
const CK = Math.sqrt(MC1 / MC0) - 1;
const mcapAt = (alt) => MC0 * Math.pow(1 + (clamp(alt, 0, 100) / 100) * CK, 2);
const PAYOUT = 123.64;                 // demo: crew's 40% of the 2% graduation fee
const WINDOW_EVERY = 90;               // demo: a Launch Window every 90 s
const DAY_SECONDS = 8;                 // demo clock: 1 mission day = 8 s

/* ---------- palette ---------- */
const NEUTRAL = ['#F5F7FA', '#D6E6FF', '#9FD4FF', '#5CBDFF', '#F5B544', '#FFC7A1', '#B9C6D6', '#E8DCC8'];
const AVC = ['#9FD4FF', '#FFC7A1', '#D6E6FF', '#F5B544', '#B9C6D6', '#E8DCC8', '#5CBDFF'];
const CREW_POOL = ['Mira K.', 'Oto', 'Lea V.', 'Juno P.', 'Ada R.', 'Kai', 'Rin S.', 'Tomas B.', 'Nia', 'Ezra L.', 'Sana M.', 'Ivo',
  'Maya T.', 'Ren', 'Lio D.', 'Yara', 'Pim', 'Oda N.', 'Cleo', 'Bas R.', 'Iris', 'Teo M.', 'Noor', 'Vik', 'Elin', 'Ravi P.'];
const NEW_TICKERS = ['$LUMA', '$VOLT', '$ECHO', '$PRISM', '$DRIFT', '$COMET', '$ONYX', '$JADE', '$RUNE', '$CREST', '$WISP', '$NIMBUS',
  '$BOLT', '$PEBBLE', '$SPARROW', '$MOSS', '$CINDER', '$ASTRA', '$DUSK', '$FABLE'];
const initials = (n, live) => {
  if (n === 'You') return 'YOU';
  const w = String(n).trim().split(/\s+/).filter(Boolean);
  if (live && w.length === 1) return w[0].replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  return w.map((x) => x[0]).join('').replace('.', '').slice(0, 2).toUpperCase();
};
const avColor = (name, i) => name === 'You' ? '#FF681C' : AVC[(hashStr(String(name)) + i) % AVC.length];
const avatars = (m, max) => m.crew.slice(0, max || 5).map((n, i) => `<span class="av${n === 'You' ? ' you' : ''}" style="background:${avColor(n, i)}">${esc(initials(n, m.live))}</span>`).join('');
const nextCheck = (m) => m.day < 7 ? 7 : m.day < 30 ? 30 : 90;

/* ---------- 3D constants ---------- */
const R = 40;
const RING_R = R * 1.42;
const TIER_ORDER = ['high', 'medium', 'low'];
const PR_BY_TIER = { high: 1.75, medium: 1.25, low: 1 };
const PAD_DEF = [[-21, 55], [-14, 61], [-7, 52.5], [0, 58.5], [7, 52.5], [14, 61], [21, 55]];
const SHIP_SCALE = 1.3;
const ORBIT_W = (Math.PI * 2) / 80;      // one lap of the orbit ring ≈ 80 s
const DAY_COL = [0x9fd4ff, 0xd6e6ff, 0xfc5501];
const STAR_CAP = 60;
// named-star slots in normalised screen space of the home view (x: -1..1, y: -1..1), kept clear of the top bar
const STAR_SLOTS_DESK = [[-0.2, 0.5], [0.02, 0.63], [0.2, 0.47], [-0.07, 0.36], [0.33, 0.6], [0.1, 0.74], [-0.3, 0.68], [0.42, 0.42], [-0.15, 0.78], [0.27, 0.78]];
const STAR_SLOTS_PHONE = [[-0.55, 0.12], [0.5, 0.05], [-0.15, 0.2], [0.7, 0.25], [0.2, 0.14], [-0.7, 0.3], [0.05, 0.3], [-0.4, 0.02], [0.45, 0.32], [0.8, 0.1]];

/* ---------- shaders ---------- */
const NOISE_GLSL = `
float hash3(vec3 p){ p = fract(p*0.3183099 + vec3(0.71,0.113,0.419)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i),hash3(i+vec3(1.,0.,0.)),f.x),mix(hash3(i+vec3(0.,1.,0.)),hash3(i+vec3(1.,1.,0.)),f.x),f.y),
             mix(mix(hash3(i+vec3(0.,0.,1.)),hash3(i+vec3(1.,0.,1.)),f.x),mix(hash3(i+vec3(0.,1.,1.)),hash3(i+vec3(1.,1.,1.)),f.x),f.y),f.z); }
float fbm4(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
float fbm3(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=p*2.07+vec3(5.1,1.3,7.7); a*=0.5; } return s/0.875; }
`;
const PLANET_VS = `varying vec3 vN; varying vec3 vP;
void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*wp; }`;
const PLANET_FS = `uniform vec3 uSun; uniform vec3 uCam; uniform float uTime; uniform vec4 uFlare[4]; uniform vec3 uPads[7]; uniform float uPadGlow;
varying vec3 vN; varying vec3 vP;
${NOISE_GLSL}
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(uCam - vP); vec3 sp = normalize(vP);
  float ndl = dot(N, uSun);
  float cont = fbm4(sp*2.4 + vec3(3.0,1.0,0.0));
  float det = fbm3(sp*9.0 + 4.0);
  float land = smoothstep(0.46, 0.55, cont);
  vec3 ocean = vec3(0.010, 0.019, 0.034);
  vec3 ground = vec3(0.030, 0.042, 0.058) + (det-0.5)*0.035;
  vec3 col = mix(ocean, ground, land);
  float day = smoothstep(-0.06, 0.5, ndl);
  vec3 dcol = mix(vec3(0.06,0.11,0.18), mix(vec3(0.26,0.30,0.34), vec3(0.55,0.53,0.48), det)*0.8, land);
  float cl = smoothstep(0.52, 0.8, fbm3(sp*4.2 + vec3(uTime*0.006, 0.0, uTime*0.004)));
  dcol = mix(dcol, vec3(0.86,0.9,0.95), cl*0.6);
  col = mix(col, dcol, day);
  col += vec3(0.95,0.40,0.10) * exp(-pow((ndl-0.03)*7.0, 2.0)) * 0.12;
  float night = 1.0 - smoothstep(-0.2, 0.06, ndl);
  float c1 = vnoise(sp*34.0);
  float c2 = vnoise(sp*118.0 + 3.0);
  float city = smoothstep(0.64, 0.8, c1) * smoothstep(0.5, 0.88, c2) * land;
  col += vec3(1.0, 0.70, 0.42) * city * night * 1.1;
  for(int i=0;i<7;i++){ float d = distance(vP, uPads[i]); col += vec3(0.30,0.66,1.0) * (exp(-d*d*0.22)*0.55 + exp(-d*0.55)*0.06) * uPadGlow; }
  for(int i=0;i<4;i++){ float d = distance(vP, uFlare[i].xyz); col += vec3(1.0,0.48,0.12) * uFlare[i].w * (exp(-d*d*0.07)*0.75 + exp(-d*0.45)*0.18); }
  float fr = 1.0 - max(dot(N, V), 0.0);
  float rim = pow(fr, 3.2);
  float lit = 0.32 + 0.68*smoothstep(-0.5, 0.6, ndl);
  vec3 rimCol = mix(vec3(0.31,0.72,1.0), vec3(1.0), pow(fr, 9.0));
  col += rimCol * rim * lit * 1.05;
  gl_FragColor = vec4(col, 1.0);
}`;
const ATMO_VS = `varying vec3 vP; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vP = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`;
const ATMO_FS = `uniform vec3 uCam; uniform vec3 uSun; uniform float uR; uniform float uRa; uniform float uBoost; varying vec3 vP;
void main(){
  vec3 rd = normalize(vP - uCam);
  float tca = dot(-uCam, rd);
  vec3 pc = uCam + rd * tca;
  float b = length(pc);
  float h = (b - uR) / (uRa - uR);
  if (h < 0.0 || tca < 0.0) discard;
  float dens = exp(-h * 4.2) * (1.0 - smoothstep(0.75, 1.0, h));
  vec3 n = normalize(pc);
  float sunF = dot(n, uSun);
  float lit = 0.30 + 0.70 * smoothstep(-0.6, 0.7, sunF);
  vec3 col = mix(vec3(0.31,0.72,1.0), vec3(1.0), exp(-h * 10.0));
  col = mix(col, vec3(0.16,0.26,0.85), smoothstep(0.2, 0.7, h));
  float fwd = pow(max(dot(rd, uSun), 0.0), 6.0);
  col += vec3(1.0, 0.50, 0.12) * fwd * exp(-h*2.5) * 1.2;
  gl_FragColor = vec4(col * dens * lit * uBoost, 1.0);
}`;
const STAR_VS = `attribute float aSize; attribute float aSeed; attribute vec3 aColor; uniform float uTime; uniform float uPR;
varying vec3 vC; varying float vA;
void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
  float tw = 0.62 + 0.38*sin(uTime*(0.5+aSeed*2.2) + aSeed*53.0);
  vC = aColor; vA = tw; gl_PointSize = aSize*uPR*(0.8+0.2*tw); }`;
const STAR_FS = `varying vec3 vC; varying float vA;
void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); float a = smoothstep(0.5, 0.0, d); a *= a; gl_FragColor = vec4(vC, a*vA); }`;
const RING_VS = `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vec4 wp = modelMatrix*vec4(position,1.0); vP = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`;
const RING_FS = `uniform float uTime; uniform float uWaveU; uniform float uWaveT; uniform float uFade; uniform float uPulseU; uniform float uPulseT; varying vec2 vUv; varying vec3 vP;
void main(){
  float u = vUv.x;
  float dp = abs(u - uPulseU); dp = min(dp, 1.0-dp);
  float pulse = exp(-pow((dp - uPulseT*0.5)/0.012, 2.0)) * (1.0 - uPulseT) * step(0.0001, uPulseT);
  float du = abs(u - uWaveU); du = min(du, 1.0-du);
  float front = uWaveT * 0.5;
  float w = exp(-pow((du - front)/0.02, 2.0)) * (1.0 - uWaveT) * step(0.0001, uWaveT);
  float trail = smoothstep(front, 0.0, du) * (1.0-uWaveT) * 0.35 * step(0.0001, uWaveT);
  vec3 col = vec3(0.31,0.72,1.0) * (0.75 + pulse*2.2) + vec3(1.0,0.78,0.35) * (w*3.0 + trail);
  gl_FragColor = vec4(col, uFade);
}`;
const BAND_VS = `varying vec2 vL; varying vec3 vW; void main(){ vL = position.xy; vW = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const BAND_FS = `uniform float uR; uniform float uTime; uniform float uFade; varying vec2 vL; varying vec3 vW;
void main(){
  float r = length(vL); float a = atan(vL.y, vL.x);
  float d = r - uR;
  float glow = exp(-pow(d/0.55, 2.0)) * 0.30 + exp(-pow(d/2.2, 2.0)) * 0.07;
  float f = fract(a / 6.2831853 * 120.0);
  float tk = smoothstep(0.93, 1.0, 1.0-abs(f-0.5)*2.0);
  float tickBand = smoothstep(0.35, 0.5, d) * (1.0 - smoothstep(0.95, 1.1, d));
  float majTick = smoothstep(0.975, 1.0, 1.0-abs(fract(a / 6.2831853 * 24.0)-0.5)*2.0) * smoothstep(0.35, 0.5, d) * (1.0 - smoothstep(1.7, 1.85, d));
  float t = (tk * tickBand * 0.3 + majTick * 0.45) * smoothstep(16.0, 46.0, distance(cameraPosition, vW));
  vec3 col = vec3(0.31,0.72,1.0) * (glow + t*0.55);
  gl_FragColor = vec4(col, uFade);
}`;
const FINAL_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uCA: { value: 0.0016 }, uVig: { value: 0.32 }, uFlash: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uCA; uniform float uVig; uniform float uFlash; varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
  void main(){
    vec2 c = vUv - 0.5; float r2 = dot(c,c);
    vec2 off = c * uCA * (0.4 + r2*4.0);
    vec3 col; col.r = texture2D(tDiffuse, vUv + off).r; col.g = texture2D(tDiffuse, vUv).g; col.b = texture2D(tDiffuse, vUv - off).b;
    col = col / (1.0 + col*0.18) * 1.12;
    col *= 1.0 - uVig * smoothstep(0.08, 0.62, r2);
    col += (h(vUv*vec2(1733.0, 977.0) + fract(uTime*7.0)) - 0.5) * 0.022;
    col += vec3(1.0, 0.96, 0.9) * uFlash;
    gl_FragColor = vec4(col, 1.0);
  }`
};
const P_VS = `attribute vec3 aVel; attribute float aBirth; attribute float aLife; attribute float aSize; attribute float aKind;
uniform float uTime; uniform float uScale; varying float vT; varying float vK;
void main(){
  float age = uTime - aBirth; float t = age / aLife;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; vT = 1.0; vK = 0.0; return; }
  float drag = (1.0 - exp(-2.0*age)) / 2.0;
  vec3 p = position + aVel * drag;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * (1.0 + t*1.3) * uScale / max(0.1, -mv.z), 90.0);
  vT = t; vK = aKind;
}`;
const P_FS = `varying float vT; varying float vK;
vec3 fire(float t){
  vec3 c0 = vec3(1.0,0.96,0.84), c1 = vec3(0.988,0.616,0.004), c2 = vec3(0.988,0.333,0.004), c3 = vec3(0.98,0.149,0.059), c4 = vec3(0.953,0.051,0.114);
  if (t < 0.1) return mix(c0, c1, t/0.1);
  if (t < 0.32) return mix(c1, c2, (t-0.1)/0.22);
  if (t < 0.62) return mix(c2, c3, (t-0.32)/0.30);
  return mix(c3, c4, (t-0.62)/0.38);
}
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  float a = smoothstep(0.5, 0.0, d); a *= a;
  vec3 col;
  if (vK < 0.5) { col = fire(vT); a *= pow(1.0 - vT, 1.4); }
  else if (vK < 1.5) { col = mix(vec3(1.0,0.95,0.75), vec3(0.96,0.71,0.27), vT); a *= (1.0 - vT); }
  else { col = mix(vec3(0.9,0.97,1.0), vec3(0.31,0.72,1.0), vT); a *= (1.0 - vT) * 0.85; }
  gl_FragColor = vec4(col, a);
}`;
const FLAME_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const FLAME_FS = `uniform float uTime; uniform float uPow; varying vec2 vUv;
void main(){
  float t = 1.0 - vUv.y;
  vec3 c0 = vec3(1.0,0.97,0.88), c1 = vec3(0.988,0.616,0.004), c2 = vec3(0.988,0.333,0.004), c3 = vec3(0.98,0.149,0.059);
  vec3 col = t < 0.2 ? mix(c0, c1, t/0.2) : t < 0.55 ? mix(c1, c2, (t-0.2)/0.35) : mix(c2, c3, (t-0.55)/0.45);
  float flick = 0.82 + 0.18*sin(uTime*31.0 + vUv.x*18.0) * sin(uTime*17.0);
  float a = pow(1.0 - t, 1.6) * flick * uPow;
  gl_FragColor = vec4(col, a);
}`;
const WAVE_FS = `uniform float uT; uniform vec3 uCol; varying vec2 vUv;
void main(){ float r = length(vUv - 0.5) * 2.0; float ring = exp(-pow((r - 0.95)/0.018, 2.0)) * 1.3 + exp(-pow((r - 0.92)/0.09, 2.0))*0.35 + smoothstep(0.95, 0.0, r) * 0.05;
  float a = ring * pow(1.0 - uT, 1.3); gl_FragColor = vec4(uCol * 1.5, a); }`;
const PATH_VS = `attribute float aU; varying float vU; void main(){ vU = aU; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const PATH_FS = `uniform float uProg; uniform vec3 uCol; uniform float uA; varying float vU;
void main(){
  float done = step(vU, uProg);
  float dash = step(0.55, fract(vU*52.0));
  float a = mix(dash*0.5, 0.75, done) * uA * smoothstep(0.0, 0.05, vU);
  gl_FragColor = vec4(mix(vec3(0.31,0.72,1.0), uCol, done), a);
}`;

/* ---------- HUD template ---------- */
const ICON_REPLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>';
const HUD_HTML = `
  <header class="top">
    <div class="brand"><img class="word" src="/brand/ryntra-wordmark-dark.svg" alt="Ryntra" width="91" height="23"><span class="tag">LAUNCH</span></div>
    <span class="pill reading" data-k="pill"><i class="dot"></i><span data-k="pill-t">READING THE CHAIN</span></span>
    <dl class="stats" data-k="stats"></dl>
    <button type="button" class="btn-sound" data-k="sound" aria-pressed="false" aria-label="Sound off. Turn sound on">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path data-k="snd-x" d="M16 9.5l5 5M21 9.5l-5 5"/><path data-k="snd-w" d="M16 9a4.2 4.2 0 0 1 0 6M18.6 6.5a7.8 7.8 0 0 1 0 11" style="display:none"/></svg>
      <span data-k="snd-t">SOUND OFF</span>
    </button>
  </header>
  <button type="button" class="btn ghost small back" data-k="back" hidden>&larr; Back to sky</button>
  <aside class="feed glass" data-k="feed" aria-label="Flight log">
    <header><span>FLIGHT LOG</span><span class="muted" data-k="feed-src">ON-CHAIN</span></header>
    <ol data-k="feed-list" aria-live="polite"></ol>
  </aside>
  <div class="ticker" data-k="ticker" aria-hidden="true"><span class="tl">LOG</span><span class="tk-line" data-k="tk-line"></span></div>
  <div class="replays" data-k="replays"></div>
  <section class="strip" data-k="strip" aria-label="Missions"></section>
  <div class="strip-note glass" data-k="strip-note" hidden><i></i><span data-k="strip-note-t"></span></div>
  <div class="demo" data-k="demo" hidden>DEMO &#xB7; simulated flights &#xB7; no real tokens<span class="demo-next"><span class="demo-sep"> &#xB7; </span>real launch windows open hourly, UTC</span></div>
  <aside class="panel glass" data-k="panel" hidden aria-label="Mission details">
    <div class="p-head"><div><div class="p-tk" data-k="p-tk"></div><div class="p-name" data-k="p-name"></div><div class="p-chips" data-k="p-chips"></div></div></div>
    <div class="p-crew"><div class="avs" data-k="p-avs"></div><p data-k="p-crew"></p></div>
    <dl class="p-grid" data-k="p-grid"></dl>
    <p class="p-note" data-k="p-note"></p>
    <div class="p-actions" data-k="p-actions"></div>
    <div class="p-demo" data-k="p-demo" hidden>DEMO &#xB7; NO REAL TRADES</div>
  </aside>
  <div class="countdown" data-k="countdown" aria-hidden="true"><span class="cl" data-k="cd-l"></span><span class="cv" data-k="cd-v"></span></div>
  <div class="event" data-k="event" aria-live="polite"><div class="ev-title" data-k="ev-title"></div><div class="ev-sub mono" data-k="ev-sub"></div></div>
  <div class="labels" data-k="labels" aria-hidden="true"></div>
  <div class="floats" data-k="floats" aria-hidden="true"></div>
  <div class="tip glass" data-k="tip" hidden></div>
  <div class="toast" data-k="toast" role="status"></div>
  <section class="board glass" data-k="board" hidden aria-label="Live board">
    <h2>3D needs WebGL &#x2014; here is the live board</h2>
    <p data-k="board-p"></p>
    <div data-k="board-rows"></div>
  </section>`;

/* =====================================================================
   mount — one scene in `root`. LIVE on arrival (empty roster, "Reading the chain…"); DEMO only via playDemo().
   ===================================================================== */
/** @type {import("../types").MountScene} */
export function mount(root, options) {
  const opts = options || {};
  const REDUCED = !!opts.reducedMotion;
  const MIN_FPS = num(opts.minFps) ? opts.minFps : 30;
  const MAX_PR = num(opts.maxPixelRatio) ? opts.maxPixelRatio : 1.75;
  const notify = (name, a, b) => { const f = opts[name]; if (typeof f === 'function') { try { f(a, b); } catch (_e) { /* the page's own callback */ } } };
  const mq = (q) => { try { return typeof matchMedia === 'function' && matchMedia(q).matches; } catch (_e) { return false; } };
  const COARSE = mq('(pointer: coarse)');
  let QUALITY = null;
  try { QUALITY = new URLSearchParams(window.location.search).get('quality'); } catch (_e) { QUALITY = null; }
  let VW = Math.max(1, root.clientWidth || window.innerWidth || 1);
  let VH = Math.max(1, root.clientHeight || window.innerHeight || 1);
  const isPhone = () => VW < 760;
  const PHONE_START = COARSE || VW < 760;
  let disposed = false;

  /* ---------- timers & listeners (all undone by dispose) ---------- */
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms); timers.add(id); return id; };
  const cancel = (id) => { if (id != null) { clearTimeout(id); timers.delete(id); } };
  const offs = [];
  const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); offs.push(() => t.removeEventListener(ev, fn, o)); };

  /* ---------- layers ---------- */
  root.classList.add('mc-orbit');
  if (REDUCED) root.classList.add('reduced');
  const canvas = document.createElement('canvas'); canvas.className = 'gl'; canvas.setAttribute('aria-hidden', 'true');
  const veil = document.createElement('div'); veil.className = 'veil';
  const hudEl = document.createElement('div'); hudEl.className = 'hud'; hudEl.innerHTML = HUD_HTML;
  root.appendChild(canvas); root.appendChild(veil); root.appendChild(hudEl);
  const q = (k) => hudEl.querySelector(`[data-k="${k}"]`);
  const E = {};
  ['pill', 'pill-t', 'stats', 'sound', 'snd-x', 'snd-w', 'snd-t', 'back', 'feed', 'feed-src', 'feed-list', 'ticker', 'tk-line', 'replays', 'strip',
    'strip-note', 'strip-note-t', 'demo', 'panel', 'p-tk', 'p-name', 'p-chips', 'p-avs', 'p-crew', 'p-grid', 'p-note', 'p-actions', 'p-demo',
    'countdown', 'cd-l', 'cd-v', 'event', 'ev-title', 'ev-sub', 'labels', 'floats', 'tip', 'toast', 'board', 'board-p', 'board-rows'].forEach((k) => { E[k] = q(k); });
  const heroEl = () => root.querySelector('[data-mc-hero]');
  let RR = { left: 0, top: 0 };
  const rootRect = () => { const r = root.getBoundingClientRect(); RR = r; return r; };
  const relRect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left - RR.left, top: r.top - RR.top, right: r.right - RR.left, bottom: r.bottom - RR.top, width: r.width, height: r.height }; };
  rootRect();

  /* ---------- scene state ---------- */
  let mode = 'live';            // 'live' | 'demo' — never mixed
  let liveSnap = null, gotSnap = false, network = null, extraStars = 0;
  let missions = [];
  let demo = null;
  let MID = 0;
  const liveLog = [];           // the live flight log, restored after the demo

  /* ---------- event bus ---------- */
  const handlers = {};
  const on = (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); };
  const fire = (type, d) => { (handlers[type] || []).forEach((fn) => { try { fn(d); } catch (_e) { /* keep the show running */ } }); };

  /* =====================================================================
     DEMO SIMULATOR — the concept's own show; every visible effect is driven by one of its events.
     ===================================================================== */
  function createDemo() {
    const rnd = mulberry32(20261025);
    const rr = (a, b) => a + (b - a) * rnd();
    let newTickerIx = 0;
    const D = { stats: { win: 14, hiddenOrbit: 13, crewsPaid: 4812.0 }, DEEP: [], NOVA: null, sim: null };
    const byTicker = (t) => missions.find((m) => m.ticker === t);
    function crewFor(r, n) {
      const pool = CREW_POOL.slice(); const out = [];
      for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
      return out;
    }
    function makeMission(o) {
      const seed = hashStr(o.ticker);
      const r = mulberry32(seed);
      const crewSize = o.crew ? o.crew.length : (o.crewSize || 2 + Math.floor(r() * 4));
      const crew = o.crew || crewFor(r, crewSize);
      let base = NEUTRAL[Math.floor(r() * NEUTRAL.length)];
      let accent = NEUTRAL[Math.floor(r() * NEUTRAL.length)];
      if (accent === base) accent = NEUTRAL[(NEUTRAL.indexOf(base) + 3) % NEUTRAL.length];
      if (o.mine) { base = '#FF681C'; accent = '#F5F7FA'; }
      const m = Object.assign({
        id: 'demo:' + (++MID), live: false, seed, base, accent, crew, state: 'ascent', alt: 0, day: 0, holders: 0, mc: MC0, pad: 0, path: null,
        phi: 0, fins: 3 + Math.floor(r() * 2), lenS: 0.9 + r() * 0.24, radS: 0.88 + r() * 0.22, nose: r(), mine: false, locked: false,
        checks: 0, gone: false, orbitMc: 0
      }, o);
      m.crewSize = m.crew.length;
      m.holders = o.holders || Math.round(8 + m.alt * 2.6 + r() * 20);
      missions.push(m);
      return m;
    }
    function nextNewTicker() {
      for (let i = 0; i < NEW_TICKERS.length; i++) {
        const t = NEW_TICKERS[(newTickerIx + i) % NEW_TICKERS.length];
        if (!missions.some((m) => m.ticker === t && !m.gone)) { newTickerIx = (newTickerIx + i + 1) % NEW_TICKERS.length; return t; }
      }
      return '$M' + (100 + MID);
    }
    // initial roster
    const NOVA_CREW = ['Mira K.', 'Oto', 'Lea V.', 'Juno P.'];
    makeMission({ ticker: '$NOVA', alt: 96.0, pad: 3, crew: NOVA_CREW, locked: true, holders: 291 });
    makeMission({ ticker: '$TIDE', alt: 78.4, pad: 5, crewSize: 3 });
    makeMission({ ticker: '$KITE', alt: 63.1, pad: 1, crew: ['Ada R.', 'Kai', 'Oto'] });
    makeMission({ ticker: '$ORCA', alt: 52.6, pad: 6, crewSize: 4 });
    makeMission({ ticker: '$MOTH', alt: 41.2, pad: 0, crewSize: 2 });
    makeMission({ ticker: '$PIXEL', alt: 27.5, pad: 4, crewSize: 5 });
    makeMission({ ticker: '$FERN', alt: 12.3, pad: 2, crewSize: 2 });
    makeMission({ ticker: '$LUMA', state: 'pad', pad: 2, crewSize: 3, alt: 0 });
    makeMission({ ticker: '$VOLT', state: 'pad', pad: 4, crewSize: 2, alt: 0 });
    makeMission({ ticker: '$ECHO', state: 'pad', pad: 0, crewSize: 4, alt: 0 });
    newTickerIx = 3;
    [['$HALO', 27.2, 3], ['$EMBER', 61.0, 3], ['$ZINC', 25.1, 2], ['$QUILL', 3.3, 4], ['$DUNE', 19.0, 2],
      ['$LYRA', 5.1, 3], ['$ATLAS', 44.0, 5], ['$BRIO', 82.6, 3], ['$MARU', 1.2, 2]].forEach(([t, d, c], i) => {
      const m = makeMission({ ticker: t, state: 'orbit', alt: 100, day: d, crewSize: c });
      m.checks = d >= 30 ? 2 : d >= 7 ? 1 : 0;
      m.orbitMc = 76000 + (hashStr(t) % 1000) / 1000 * 120000;
      m.phi = (i / 9) * Math.PI * 2 + 0.35;
      m.holders = 380 + Math.round((hashStr(t) % 900));
    });
    const NOVA = byTicker('$NOVA'); D.NOVA = NOVA;
    byTicker('$ZINC').doomed = true;   // its Day 30 check will fail (demo beat)
    D.DEEP = [['$ASTER', 3], ['$CORAL', 2], ['$GLINT', 4], ['$OPAL', 3], ['$WREN', 5], ['$SAGE', 3]].map(([t, c]) => ({ ticker: t, crew: c }));
    const stats = D.stats;
    const inFlight = () => missions.filter((m) => m.state === 'ascent' && !m.gone).length;
    const inOrbitVisible = () => missions.filter((m) => m.state === 'orbit' && !m.gone).length;
    D.inFlight = inFlight;
    D.inOrbitTotal = () => stats.hiddenOrbit + inOrbitVisible();

    const sim = {
      t: 0, nextTrade: 2.2, nextWinAt: 8.0, cdFired: -1, beats: [], nextFee: 14, active: null, camEvent: true,
      at(dt, fn, kind) { this.beats.push({ at: this.t + dt, fn, kind }); this.beats.sort((a, b) => a.at - b.at); },
      update(dt) {
        this.t += dt;
        while (this.beats.length && this.beats[0].at <= this.t) { const b = this.beats.shift(); b.fn(); }
        const left = this.nextWinAt - this.t;
        const sec = Math.ceil(left);
        if (left > 0 && sec <= 5 && sec !== this.cdFired) { this.cdFired = sec; fire('countdown', { sec, win: stats.win }); }
        if (left <= 0) this.fireWindow();
        if (this.t >= this.nextTrade) { this.nextTrade = this.t + rr(0.45, 1.35); this.randomTrade(); }
        missions.forEach((m) => {
          if (m.state !== 'orbit' || m.gone || m.leaving) return;
          const before = m.day; m.day += dt / DAY_SECONDS;
          [7, 30, 90].forEach((d) => { if (before < d && m.day >= d) this.check(m, d); });
        });
        if (this.t >= this.nextFee) { this.nextFee = this.t + rr(11, 19); this.fee(); }
      },
      randomTrade() {
        const pool = missions.filter((m) => m.state === 'ascent' && !m.locked && !m.gone);
        if (!pool.length) return;
        const m = pool[Math.floor(rnd() * pool.length)];
        let buy = rnd() < (m.alt > 95 ? 0.42 : 0.7);
        const usd = Math.round(Math.exp(rr(Math.log(5), Math.log(900))));
        const d = (usd / GRAD_USDC) * 100;
        if (buy && m.alt + d > 99.3) buy = false;
        if (!buy && m.alt - d < 0.8) buy = true;
        this.trade(m, buy, usd);
      },
      trade(m, buy, usd) {
        const before = m.alt;
        const d = (usd / GRAD_USDC) * 100;
        m.alt = clamp(m.alt + (buy ? d : -d), 0.5, 100);
        m.holders += buy ? (rnd() < 0.6 ? 1 : 0) : (rnd() < 0.3 ? -1 : 0);
        fire(buy ? 'buy' : 'sell', { m, usd, alt: m.alt });
        [25, 50, 75].forEach((qq, i) => { if (before < qq && m.alt >= qq) fire('booster', { m, n: i + 1 }); });
        if (m.alt >= 100 && m.state === 'ascent') this.orbit(m);
      },
      fireWindow() {
        const T = this.nextWinAt;
        this.nextWinAt = T + WINDOW_EVERY;
        this.cdFired = -1;
        const n = stats.win;
        const ready = missions.filter((m) => m.state === 'pad' && !m.gone);
        this.lastIgnited = ready.slice();
        fire('window', { win: n, count: ready.length });
        ready.forEach((m, i) => this.at(0.15 * i, () => { if (m.state !== 'pad') return; m.state = 'ascent'; m.alt = Math.round(rr(2.2, 5.6) * 10) / 10; m.liftT = this.t; fire('ignite', { m }); }, 'ins'));
        let ins = this.active;
        if (!ins) {
          const top = missions.filter((m) => m.state === 'ascent' && !m.gone && m.alt >= 93).sort((a, b) => b.alt - a.alt)[0];
          ins = top || null;
        }
        const cam = this.camEvent;
        this.active = null; this.camEvent = false;
        if (ins) {
          ins.locked = true; ins.central = cam;
          fire('approach', { m: ins, cam });
          const need = Math.max(0, (100 - ins.alt) / 100 * GRAD_USDC);
          const parts = ins === NOVA && Math.abs(need - 618.16) < 2 ? [214, 187] : [need * 0.35, need * 0.3];
          const amounts = [Math.round(parts[0]), Math.round(parts[1])];
          amounts.push(Math.max(1, Math.ceil(need - amounts[0] - amounts[1])));
          amounts.forEach((usd, i) => this.at(1.5 + i * 0.9, () => {
            if (ins.state !== 'ascent') return;
            if (i === 2) { ins.alt = 100 - (usd / GRAD_USDC) * 100; }
            this.trade(ins, true, usd);
          }, 'ins'));
        }
        this.at(WINDOW_EVERY - 30, () => this.rollout());
        stats.win = n + 1;
      },
      rollout(force) {
        const want = force || clamp(10 - inFlight(), 1, 3);
        const used = new Set(missions.filter((m) => m.state === 'pad' && !m.gone).map((m) => m.pad));
        const free = [0, 1, 2, 3, 4, 5, 6].filter((p) => !used.has(p));
        for (let i = 0; i < want && free.length; i++) {
          const pad = free.splice(Math.floor(rnd() * free.length), 1)[0];
          const m = makeMission({ ticker: nextNewTicker(), state: 'pad', pad, alt: 0 });
          fire('rollout', { m, win: stats.win });
        }
      },
      orbit(m) {
        m.state = 'orbit'; m.alt = 100; m.day = 0; m.checks = 0; m.locked = false; m.orbitMc = MC1 * rr(1.0, 1.12);
        stats.crewsPaid += PAYOUT;
        fire('orbit', { m, payout: PAYOUT, central: !!m.central }); m.central = false;
        this.at(1.3, () => fire('pool', { m }));
      },
      check(m, d) {
        if (d === 90) {
          m.checks = 3; m.leaving = true;
          fire('check', { m, day: 90 });
          this.at(0.9, () => fire('star', { m }));
          this.at(4.6, () => { m.gone = true; m.state = 'star'; D.DEEP.push({ ticker: m.ticker, crew: m.crewSize, born: true }); fire('starborn', { m }); });
          return;
        }
        const fail = m.doomed && d === 30;
        if (fail) {
          m.leaving = true; m.lostReason = 'liquidity under floor';
          fire('lost', { m, reason: m.lostReason });
          this.at(7.5, () => { m.gone = true; m.state = 'lost'; fire('removed', { m }); });
          return;
        }
        m.checks = d >= 30 ? 2 : 1;
        fire('check', { m, day: d });
      },
      fee() {
        const pool = missions.filter((m) => m.state === 'orbit' && !m.gone && !m.leaving);
        if (!pool.length) return;
        const m = pool[Math.floor(rnd() * pool.length)];
        const usd = Math.round(rr(4, 38) * 100) / 100;
        stats.crewsPaid += usd;
        fire('fee', { m, usd });
      },
      replay() {
        if (NOVA.state === 'orbit' && !NOVA.leaving) stats.crewsPaid -= PAYOUT;
        NOVA.state = 'ascent'; NOVA.alt = 96.0; NOVA.leaving = false; NOVA.gone = false; NOVA.locked = true; NOVA.day = 0; NOVA.checks = 0;
        fire('reset', { m: NOVA });
        this.beats = this.beats.filter((b) => b.kind !== 'ins');
        (this.lastIgnited || []).forEach((m) => {
          if (m.gone || m.state !== 'ascent' || missions.some((o) => o !== m && o.state === 'pad' && !o.gone && o.pad === m.pad)) return;
          m.state = 'pad'; m.alt = 0; m.path = null; m.locked = false; fire('repad', { m });
        });
        let onPads = missions.filter((m) => m.state === 'pad' && !m.gone).length;
        while (onPads < 3 && onPads < 7) { const before = MID; this.rollout(1); if (MID === before) break; onPads++; }
        this.active = NOVA; this.camEvent = true;
        this.nextWinAt = this.t + 5.05; this.cdFired = -1;
        fire('replay', {});
      }
    };
    D.sim = sim;
    return D;
  }

  /* =====================================================================
     LIVE missions — what the chain carries, nothing else
     ===================================================================== */
  function liveMission(sm) {
    const ship = sm.ship || {};
    const seed = num(ship.seed) ? (ship.seed >>> 0) : hashStr(sm.id);
    const m = {
      id: sm.id, live: true, seed, base: typeof ship.base === 'string' ? ship.base : '#B9C6D6', accent: typeof ship.accent === 'string' ? ship.accent : '#F5F7FA',
      fins: ship.fins === 4 ? 4 : 3, lenS: num(ship.length) ? clamp(ship.length, 0.75, 1.3) : 1, radS: num(ship.radius) ? clamp(ship.radius, 0.75, 1.3) : 1,
      nose: num(ship.nose) ? sat(ship.nose) : 0.5, mine: false, locked: false, pad: seed % 7, path: null,
      phi: ((seed >>> 7) % 1000) / 1000 * Math.PI * 2, gone: false, state: 'ascent', alt: 0, altKnown: false, day: 0, dayN: null,
      ck: [false, false, false], cks: ['unread', 'unread', 'unread'], lostDay: null, crew: [], crewSize: 0
    };
    updateLive(m, sm);
    return m;
  }
  function updateLive(m, sm) {
    m.sm = sm;
    m.ticker = typeof sm.ticker === 'string' ? sm.ticker : '$?';
    m.name = typeof sm.name === 'string' ? sm.name : '';
    m.crew = Array.isArray(sm.crew) ? sm.crew.map(String) : [];
    m.crewSize = m.crew.length;
    m.state = PHASES.has(sm.phase) ? sm.phase : 'ascent';
    m.altKnown = num(sm.altitude);
    if (m.altKnown) m.alt = clamp(sm.altitude, 0, 100);
    else if (m.state === 'orbit' || m.state === 'star') m.alt = 100;
    m.dayN = num(sm.day) ? sm.day : null;
    m.day = m.dayN != null ? m.dayN : 0;
    const c = Array.isArray(sm.checks) ? sm.checks : [];
    m.cks = [0, 1, 2].map((k) => (typeof c[k] === 'string' ? c[k] : 'unread'));
    m.ck = m.cks.map((s) => s === 'alive');
    const qi = m.cks.indexOf('quiet');
    m.lostDay = m.state === 'lost' ? (qi >= 0 ? CHECK_DAYS[qi] : m.lostDay) : null;
    /* MC-3: why the signal was lost, in the scene's own calm words (`signalLost` in scene.ts). */
    const sig = sm.signal;
    m.signal = m.state === 'lost' && sig && typeof sig.reason === 'string' ? { day: CHECK_DAYS.includes(sig.day) ? sig.day : m.lostDay, reason: sig.reason, short: typeof sig.short === 'string' ? sig.short : '' } : null;
    m.holders = num(sm.holders) ? sm.holders : null;
    m.holdersAtLeast = !!sm.holdersAtLeast;
    m.ryntraTest = sm.ryntraTest === true;
    m.href = safeHref(sm.href);
    m.mcap = num(sm.marketCapUsd) ? sm.marketCapUsd : null;
    m.since = num(sm.sinceLiftoff) ? sm.sinceLiftoff : null;
    m.liq = num(sm.liquidityUsd) ? sm.liquidityUsd : null;
    /* MC-2: the launch window its creation landed in, by id `2026-10-25T20:00Z`; null between windows. */
    m.window = typeof sm.window === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:00Z$/.test(sm.window) ? sm.window : null;
  }
  const holdersTxt = (m) => m.holders == null ? DASH : (m.holdersAtLeast ? '≥' : '') + Math.round(m.holders).toLocaleString('en-US');
  const altTxt = (m) => m.altKnown ? fmtAlt(m.alt) : DASH;
  const txUrl = (sig) => 'https://solscan.io/tx/' + encodeURIComponent(sig) + (network === 'devnet' ? '?cluster=devnet' : '');
  const ringsHTML = (m) => [0, 1, 2].map((k) => `<i class="${m.cks[k] === 'alive' ? 'on' + (k === 2 ? ' d90' : '') : m.cks[k] === 'quiet' ? 'off' : ''}"></i>`).join('');

  /* =====================================================================
     3D — renderer, planet, atmosphere, starfield, sun, orbit ring, pads
     ===================================================================== */
  let GL = null;
  function webglOK() {
    if (QUALITY === '2d' || typeof THREE.WebGLRenderer !== 'function') return false;
    try {
      const c = document.createElement('canvas');
      const ctx = c.getContext('webgl2') || c.getContext('webgl');
      if (!ctx) return false;
      const lose = ctx.getExtension && ctx.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      return true;
    } catch (_e) { return false; }
  }
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
  }
  function radialTex(stops, size = 256) {
    return canvasTex(size, size, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      stops.forEach(([o, c]) => gr.addColorStop(o, c)); g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
  }
  function makeTextures() {
    const T = {};
    T.glow = radialTex([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,236,200,0.95)'], [0.3, 'rgba(252,157,1,0.45)'], [0.6, 'rgba(250,38,15,0.10)'], [1, 'rgba(243,13,29,0)']]);
    T.soft = radialTex([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']], 128);
    T.sun = radialTex([[0, 'rgba(255,255,255,1)'], [0.05, 'rgba(255,248,230,1)'], [0.11, 'rgba(255,214,140,0.9)'], [0.2, 'rgba(252,157,1,0.45)'],
      [0.34, 'rgba(252,85,1,0.16)'], [0.55, 'rgba(250,38,15,0.05)'], [1, 'rgba(243,13,29,0)']], 512);
    T.streak = canvasTex(512, 32, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(252,85,1,0)'); gr.addColorStop(0.42, 'rgba(252,157,1,0.25)'); gr.addColorStop(0.5, 'rgba(255,240,215,0.9)');
      gr.addColorStop(0.58, 'rgba(252,157,1,0.25)'); gr.addColorStop(1, 'rgba(252,85,1,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const v = g.createLinearGradient(0, 0, 0, h); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = v; g.fillRect(0, 0, w, h);
    });
    T.ring = canvasTex(256, 256, (g, w) => {
      g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 7; g.shadowColor = 'rgba(255,255,255,1)'; g.shadowBlur = 14;
      g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 22, 0, Math.PI * 2); g.stroke();
    });
    T.pad = canvasTex(256, 256, (g, w) => {
      const c = w / 2;
      const gr = g.createRadialGradient(c, c, 0, c, c, c); gr.addColorStop(0, 'rgba(160,215,255,0.55)'); gr.addColorStop(0.3, 'rgba(79,184,255,0.12)'); gr.addColorStop(1, 'rgba(79,184,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
      g.strokeStyle = 'rgba(150,210,255,0.95)'; g.lineWidth = 5; g.beginPath(); g.arc(c, c, c * 0.62, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 3; g.setLineDash([10, 9]); g.beginPath(); g.arc(c, c, c * 0.84, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.lineWidth = 4; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.beginPath(); g.moveTo(c + Math.cos(a) * c * 0.68, c + Math.sin(a) * c * 0.68); g.lineTo(c + Math.cos(a) * c * 0.96, c + Math.sin(a) * c * 0.96); g.stroke(); }
      g.fillStyle = 'rgba(220,240,255,0.9)'; g.beginPath(); g.arc(c, c, 7, 0, Math.PI * 2); g.fill();
    });
    T.glint = canvasTex(128, 128, (g, w) => {
      const c = w / 2; g.globalCompositeOperation = 'lighter';
      const core = g.createRadialGradient(c, c, 0, c, c, c * 0.5); core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.25, 'rgba(255,255,255,0.5)'); core.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = core; g.fillRect(0, 0, w, w);
      [[w, 3], [3, w]].forEach(([sw, sh]) => { const lg = g.createRadialGradient(c, c, 0, c, c, c); lg.addColorStop(0, 'rgba(255,255,255,0.95)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(c - sw / 2, c - sh / 2, sw, sh); });
    });
    T.solar = canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#0a1f36'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(92,189,255,0.85)'; g.lineWidth = 1.5;
      for (let x = 0; x <= w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y <= h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.strokeStyle = '#D6E6FF'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
    });
    T.nebula = canvasTex(1024, 512, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      const r = mulberry32(77); g.globalCompositeOperation = 'lighter';
      const cols = [[30, 60, 130], [60, 40, 120], [20, 90, 140], [90, 50, 60]];
      for (let i = 0; i < 520; i++) {
        const x = r() * w; const band = h * 0.42 + Math.sin(x / w * Math.PI * 2 + 0.6) * h * 0.16;
        const y = band + (r() - 0.5) * h * 0.22 * (0.4 + r());
        const s = 14 + r() * 70; const c = cols[Math.floor(r() * cols.length)];
        const gr = g.createRadialGradient(x, y, 0, x, y, s);
        gr.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.05 + r() * 0.06})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2);
      }
      g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 260; i++) { const x = r() * w, y = h * 0.42 + Math.sin(x / w * Math.PI * 2 + 0.6) * h * 0.16 + (r() - 0.5) * 30; g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.2})`; g.beginPath(); g.arc(x, y, 4 + r() * 16, 0, Math.PI * 2); g.fill(); }
    });
    return T;
  }

  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  function ringBasis() {
    const D = THREE.MathUtils.degToRad;
    const qy = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), D(40));
    const qx = new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), D(8));
    const qz = new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), D(-18));
    const qq = qy.multiply(qx).multiply(qz);
    return { U: V3(1, 0, 0).applyQuaternion(qq), V: V3(0, 1, 0).applyQuaternion(qq), N: V3(0, 0, 1).applyQuaternion(qq), q: qq };
  }
  function padNormal(bDeg, aDeg) {
    const b = THREE.MathUtils.degToRad(bDeg), a = THREE.MathUtils.degToRad(aDeg);
    return V3(Math.sin(b), Math.cos(b) * Math.sin(a), Math.cos(b) * Math.cos(a)).normalize();
  }

  function buildWorld(tier) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'high', powerPreference: 'high-performance', alpha: false, stencil: false });
    renderer.setClearColor(0x04070B, 1);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x04070B, 0.0034);
    const camera = new THREE.PerspectiveCamera(40, VW / VH, 0.1, 4000);
    const W = { renderer, scene, camera, T: null, tier, time: 0 };
    GL = W;                     // so a throw below is still disposed
    const T = makeTextures(); W.T = T;
    W.sunDir = V3(0.24, 0.31, -0.92).normalize();
    const sunLight = new THREE.DirectionalLight(0xfff1e0, 2.4); sunLight.position.copy(W.sunDir).multiplyScalar(300); scene.add(sunLight);
    scene.add(new THREE.HemisphereLight(0x4fb8ff, 0x080d13, 0.42));
    scene.add(new THREE.AmbientLight(0x8a97a8, 0.16));
    const fill = new THREE.DirectionalLight(0x9fd4ff, 0.55); fill.position.set(-120, 60, 160); scene.add(fill);
    // starfield
    {
      const n = tier === 'high' ? 7000 : tier === 'medium' ? 4500 : 3000;
      const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n), col = new Float32Array(n * 3);
      const r = mulberry32(9);
      const palette = [[0.84, 0.9, 1.0], [1, 1, 1], [1, 0.82, 0.68], [0.62, 0.83, 1.0]];
      for (let i = 0; i < n; i++) {
        let x, y, z; do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < 0.01);
        const l = Math.hypot(x, y, z); const rad = 1100 + r() * 300;
        pos[i * 3] = x / l * rad; pos[i * 3 + 1] = y / l * rad; pos[i * 3 + 2] = z / l * rad;
        const big = r(); size[i] = big > 0.985 ? 3.6 + r() * 2.2 : big > 0.9 ? 2.2 + r() * 1.2 : 1.0 + r() * 1.3;
        seed[i] = r(); const c = palette[r() < 0.62 ? 0 : r() < 0.55 ? 1 : r() < 0.5 ? 2 : 3]; const b = 0.55 + r() * 0.45;
        col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      W.starMat = new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uPR: { value: 1 } }, fog: false });
      const pts = new THREE.Points(g, W.starMat); pts.frustumCulled = false; pts.renderOrder = -10; scene.add(pts); W.stars = pts;
    }
    // nebula band
    {
      const mat = new THREE.MeshBasicMaterial({ map: T.nebula, side: THREE.BackSide, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const s = new THREE.Mesh(new THREE.SphereGeometry(1600, 48, 24), mat); s.rotation.set(0.5, 0.9, 0.35); s.renderOrder = -11; scene.add(s);
    }
    // sun — the distant Ryntra star
    {
      W.sunPos = W.sunDir.clone().multiplyScalar(980);
      const mk = (tex, sx, sy, op, color) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); s.scale.set(sx, sy, 1); s.position.copy(W.sunPos); scene.add(s); return s; };
      W.sunCorona = mk(T.sun, 900, 900, 0.55, 0xffffff);
      W.sunCore = mk(T.sun, 230, 230, 1.0, 0xffffff);
      W.sunStreak = mk(T.streak, 1500, 30, 0.75, 0xffffff);
      W.flares = [0.35, 0.62, 1.15, 1.45].map((k, i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.soft, color: [0xfc9d01, 0x4fb8ff, 0xfc5501, 0x9fd4ff][i], transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false })); s.userData.k = k; s.userData.s = [26, 12, 40, 18][i]; scene.add(s); return s; });
    }
    // planet
    const segs = tier === 'low' ? [96, 64] : [160, 112];
    W.pads = PAD_DEF.map(([b, a], i) => { const n = padNormal(b, a); return { i, n, pos: n.clone().multiplyScalar(R), stand: n.clone().multiplyScalar(R + 0.95), launches: 0 }; });
    W.flareU = [0, 1, 2, 3].map(() => new THREE.Vector4(0, -999, 0, 0));
    W.planetMat = new THREE.ShaderMaterial({ vertexShader: PLANET_VS, fragmentShader: PLANET_FS, fog: false,
      uniforms: { uSun: { value: W.sunDir }, uCam: { value: camera.position }, uTime: { value: 0 }, uFlare: { value: W.flareU }, uPads: { value: W.pads.map((p) => p.pos) }, uPadGlow: { value: 1 } } });
    W.planet = new THREE.Mesh(new THREE.SphereGeometry(R, segs[0], segs[1]), W.planetMat); scene.add(W.planet);
    W.atmoMat = new THREE.ShaderMaterial({ vertexShader: ATMO_VS, fragmentShader: ATMO_FS, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uCam: { value: camera.position }, uSun: { value: W.sunDir }, uR: { value: R }, uRa: { value: R * 1.075 }, uBoost: { value: 1.25 } } });
    W.atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.075, 96, 64), W.atmoMat); W.atmo.renderOrder = 2; scene.add(W.atmo);
    // pads
    W.padMeshes = W.pads.map((p) => {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: T.pad, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x9fd4ff, fog: false }));
      disc.position.z = 0.06; g.add(disc);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.22, 5, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x4fb8ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      beam.rotation.x = Math.PI / 2; beam.position.z = 2.5; g.add(beam);
      g.position.copy(p.pos); g.lookAt(p.pos.clone().multiplyScalar(2)); scene.add(g);
      return { g, disc, beam };
    });
    // orbit ring
    const B = ringBasis(); W.ring = B;
    class RingCurve extends THREE.Curve { getPoint(t, target = new THREE.Vector3()) { const a = t * Math.PI * 2; return target.copy(B.U).multiplyScalar(Math.cos(a) * RING_R).addScaledVector(B.V, Math.sin(a) * RING_R); } }
    W.ringMat = new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uWaveU: { value: 0 }, uWaveT: { value: 0 }, uFade: { value: 1 }, uPulseU: { value: 0 }, uPulseT: { value: 0 } } });
    W.ringTube = new THREE.Mesh(new THREE.TubeGeometry(new RingCurve(), 720, 0.085, 6, true), W.ringMat); scene.add(W.ringTube);
    W.bandMat = new THREE.ShaderMaterial({ vertexShader: BAND_VS, fragmentShader: BAND_FS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: { uR: { value: RING_R }, uTime: { value: 0 }, uFade: { value: 1 } } });
    W.band = new THREE.Mesh(new THREE.RingGeometry(RING_R - 3, RING_R + 3, 512, 1), W.bandMat); W.band.quaternion.copy(B.q); scene.add(W.band);
    return W;
  }
  function ringPoint(phi, out = new THREE.Vector3()) { const B = GL.ring; return out.copy(B.U).multiplyScalar(Math.cos(phi) * RING_R).addScaledVector(B.V, Math.sin(phi) * RING_R); }
  function ringTangent(phi, out = new THREE.Vector3()) { const B = GL.ring; return out.copy(B.U).multiplyScalar(-Math.sin(phi)).addScaledVector(B.V, Math.cos(phi)).normalize(); }
  function ringPhiOf(p) { const B = GL.ring; return Math.atan2(p.dot(B.V), p.dot(B.U)); }

  /* ---------- ascent path: pad → orbit ring, arc-length parameterised ---------- */
  function makePath(padIx, phiT) {
    const pad = GL.pads[padIx];
    const p0 = pad.stand.clone(), n0 = pad.n.clone();
    const p3 = ringPoint(phiT), t3 = ringTangent(phiT);
    const L = p0.distanceTo(p3);
    const p1 = p0.clone().addScaledVector(n0, L * 0.55);
    const p2 = p3.clone().addScaledVector(t3, -L * 0.5);
    const N = 140, pts = [], cum = [0];
    const bz = (t, o) => { const u = 1 - t; return o.set(0, 0, 0).addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * t).addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t); };
    for (let i = 0; i <= N; i++) { pts.push(bz(i / N, new THREE.Vector3())); if (i) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1])); }
    const total = cum[N];
    return {
      pad: padIx, phiT, pts, total,
      at(f, out = new THREE.Vector3()) {
        const d = clamp(f, 0, 1) * total; let lo = 0, hi = N;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] < d) lo = mid; else hi = mid; }
        const k = (d - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
        return out.copy(pts[lo]).lerp(pts[hi], k);
      },
      dir(f, out = new THREE.Vector3()) { const a = this.at(Math.max(0, f - 0.004)), b = this.at(Math.min(1, f + 0.004)); return out.copy(b).sub(a).normalize(); }
    };
  }
  function assignPath(m) {
    const pad = GL.pads[m.pad];
    const phiAbove = Math.acos(clamp(pad.stand.dot(GL.ring.U) / RING_R, -1, 1));
    const phiT = phiAbove + 0.3 + ((pad.launches++ % 3) - 1) * 0.07;
    m.path = makePath(m.pad, phiT);
  }

  /* =====================================================================
     Ships (procedural, from the mission's genome), fire trails, pings, waves
     ===================================================================== */
  function syncPathLine(s) {
    const m = s.m, want = (s.mode === 'liftoff' || s.mode === 'ascent') && m.path;
    if (s.pathLine && (!want || s.pathLine.userData.path !== m.path)) { GL.scene.remove(s.pathLine); s.pathLine.geometry.dispose(); s.pathLine.material.dispose(); s.pathLine = null; }
    if (!want || s.pathLine) return;
    const P = m.path, n = P.pts.length, pos = new Float32Array(n * 3), u = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) { const p = P.pts[i]; pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; if (i) acc += p.distanceTo(P.pts[i - 1]); u[i] = acc / P.total; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    const mat = new THREE.ShaderMaterial({ vertexShader: PATH_VS, fragmentShader: PATH_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uProg: { value: 0 }, uCol: { value: new THREE.Color(m.mine ? 0xff681c : 0xffc7a1) }, uA: { value: m.mine ? 0.55 : 0.3 } } });
    const line = new THREE.Line(g, mat); line.userData.path = P; line.renderOrder = 1; line.frustumCulled = false;
    GL.scene.add(line); s.pathLine = line;
  }
  function shipGeometry() {
    const G = {};
    const prof = [[0, -1.08], [0.15, -1.07], [0.24, -0.97], [0.29, -0.72], [0.3, -0.25], [0.29, 0.2], [0.26, 0.5], [0.2, 0.77], [0.12, 0.97], [0.045, 1.1], [0, 1.13]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    G.body = new THREE.LatheGeometry(prof, 24);
    G.band = new THREE.CylinderGeometry(0.296, 0.296, 0.08, 24, 1, true); G.band.translate(0, 0.32, 0);
    G.band2 = new THREE.CylinderGeometry(0.302, 0.302, 0.05, 24, 1, true); G.band2.translate(0, -0.55, 0);
    G.nozzle = new THREE.CylinderGeometry(0.13, 0.21, 0.2, 18, 1, true); G.nozzle.translate(0, -1.16, 0);
    const shape = new THREE.Shape(); shape.moveTo(0, -0.4); shape.lineTo(0.36, -0.9); shape.lineTo(0.42, -1.22); shape.lineTo(0, -1.02); shape.closePath();
    const fin = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false }); fin.translate(0.24, 0, -0.02);
    G.fins = {};
    [3, 4].forEach((n) => {
      const parts = []; for (let k = 0; k < n; k++) { const f = fin.clone(); f.rotateY((k / n) * Math.PI * 2 + Math.PI / 4); const nf = f.index ? f.toNonIndexed() : f; if (nf !== f) f.dispose(); parts.push(nf); }
      let total = 0; parts.forEach((p) => { total += p.attributes.position.count; });
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3); let o = 0;
      parts.forEach((p) => { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; p.dispose(); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      G.fins[n] = g;
    });
    fin.dispose();
    G.flame = new THREE.ConeGeometry(0.16, 1, 18, 1, true); G.flame.rotateX(Math.PI); G.flame.translate(0, -0.5, 0);
    G.booster = new THREE.TorusGeometry(0.4, 0.045, 8, 36); G.booster.rotateX(Math.PI / 2);
    G.wing = new THREE.BoxGeometry(1.3, 0.025, 0.44); G.wing.translate(0.65, 0, 0);
    G.strut = new THREE.CylinderGeometry(0.018, 0.018, 0.3, 6); G.strut.rotateZ(Math.PI / 2); G.strut.translate(0.15, 0, 0);
    G.dayRing = new THREE.TorusGeometry(1, 0.013, 6, 96); G.dayRing.rotateX(Math.PI / 2);
    return G;
  }
  function initFX(W) {
    W.SG = shipGeometry();
    W.metal = new THREE.MeshStandardMaterial({ color: 0x2b3c51, metalness: 0.85, roughness: 0.3 });
    W.flameMat = new THREE.ShaderMaterial({ vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: { value: 0 }, uPow: { value: 1 } } });
    W.solarMat = new THREE.MeshStandardMaterial({ map: W.T.solar, metalness: 0.4, roughness: 0.45, emissive: 0x0e3a66, emissiveIntensity: 0.6 });
    const max = W.tier === 'high' ? 6000 : 3600;
    const g = new THREE.BufferGeometry();
    const A = {
      position: new THREE.BufferAttribute(new Float32Array(max * 3), 3), aVel: new THREE.BufferAttribute(new Float32Array(max * 3), 3),
      aBirth: new THREE.BufferAttribute(new Float32Array(max).fill(-1e4), 1), aLife: new THREE.BufferAttribute(new Float32Array(max).fill(1), 1),
      aSize: new THREE.BufferAttribute(new Float32Array(max), 1), aKind: new THREE.BufferAttribute(new Float32Array(max), 1)
    };
    Object.keys(A).forEach((k) => { A[k].setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, A[k]); });
    W.pMat = new THREE.ShaderMaterial({ vertexShader: P_VS, fragmentShader: P_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 } } });
    const pts = new THREE.Points(g, W.pMat); pts.frustumCulled = false; pts.renderOrder = 6; W.scene.add(pts);
    W.P = { max, head: 0, A, lo: Infinity, hi: -1, wrap: false };
    W.pings = []; for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: W.T.ring, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.visible = false; s.renderOrder = 7; W.scene.add(s); W.pings.push({ s, t: 1, dur: 1, size: 1, live: false });
    }
    W.flashes = []; for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: W.T.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.visible = false; s.renderOrder = 8; W.scene.add(s); W.flashes.push({ s, t: 1, dur: 1, size: 1, live: false });
    }
    W.waves = []; for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({ vertexShader: FLAME_VS, fragmentShader: WAVE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        uniforms: { uT: { value: 1 }, uCol: { value: new THREE.Color(0xf5b544) } } });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); mesh.visible = false; mesh.renderOrder = 7; W.scene.add(mesh);
      W.waves.push({ mesh, mat, t: 1, dur: 1.6, size: 40, live: false });
    }
    W.ships = new Map();
    W.named = []; W.streams = []; W.hoverStar = null; W.gap = null; W.pulse = null; W.ringWave = null;
  }
  function emitP(p, v, life, size, kind) {
    const P = GL.P, i = P.head, A = P.A;
    A.position.array[i * 3] = p.x; A.position.array[i * 3 + 1] = p.y; A.position.array[i * 3 + 2] = p.z;
    A.aVel.array[i * 3] = v.x; A.aVel.array[i * 3 + 1] = v.y; A.aVel.array[i * 3 + 2] = v.z;
    A.aBirth.array[i] = GL.time; A.aLife.array[i] = life; A.aSize.array[i] = size; A.aKind.array[i] = kind;
    if (i < P.lo) P.lo = i; if (i > P.hi) P.hi = i;
    P.head = (i + 1) % P.max; if (P.head === 0) P.wrap = true;
  }
  function flushP() {
    const P = GL.P; if (P.hi < 0) return;
    Object.keys(P.A).forEach((k) => {
      const a = P.A[k];
      if (P.wrap) { a.updateRange.offset = 0; a.updateRange.count = -1; }
      else { a.updateRange.offset = P.lo * a.itemSize; a.updateRange.count = (P.hi - P.lo + 1) * a.itemSize; }
      a.needsUpdate = true;
    });
    P.lo = Infinity; P.hi = -1; P.wrap = false;
  }
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
  function rndUnit(out) { do { out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); } while (out.lengthSq() > 1 || out.lengthSq() < 1e-4); return out.normalize(); }
  function ping(pos, color, size, dur) {
    const p = GL.pings.find((x) => !x.live) || GL.pings[0];
    p.live = true; p.t = 0; p.dur = dur; p.size = size; p.s.visible = true; p.s.position.copy(pos); p.s.material.color.set(color);
  }
  function flash(pos, size, dur, color) {
    const f = GL.flashes.find((x) => !x.live) || GL.flashes[0];
    f.live = true; f.t = 0; f.dur = dur; f.size = size; f.s.visible = true; f.s.position.copy(pos); f.s.material.color.set(color || 0xffffff);
  }
  function wave(pos, delay, size, color) {
    const w = GL.waves.find((x) => !x.live) || GL.waves[0];
    w.live = true; w.t = -delay; w.size = size; w.mesh.position.copy(pos); w.mesh.quaternion.copy(GL.ring.q); w.mat.uniforms.uCol.value.set(color || 0xf5b544);
  }
  function updateFX(dt) {
    GL.pings.forEach((p) => {
      if (!p.live) return; p.t += dt / p.dur;
      if (p.t >= 1) { p.live = false; p.s.visible = false; return; }
      const e = easeOut3(p.t); const s = p.size * (0.25 + e); p.s.scale.set(s, s, 1); p.s.material.opacity = (1 - p.t) * 0.95;
    });
    GL.flashes.forEach((f) => {
      if (!f.live) return; f.t += dt / f.dur;
      if (f.t >= 1) { f.live = false; f.s.visible = false; return; }
      const s = f.size * (0.3 + easeOut3(f.t) * 0.9); f.s.scale.set(s, s, 1); f.s.material.opacity = Math.pow(1 - f.t, 1.6);
    });
    GL.waves.forEach((w) => {
      if (!w.live) return; w.t += dt / w.dur;
      if (w.t < 0) { w.mesh.visible = false; return; }
      if (w.t >= 1) { w.live = false; w.mesh.visible = false; return; }
      w.mesh.visible = true; const s = 0.5 + easeOut3(w.t) * w.size; w.mesh.scale.set(s, s, s); w.mat.uniforms.uT.value = w.t;
    });
  }

  /* ---------- one ship ---------- */
  function stdMat(hex, emiss) {
    const c = new THREE.Color(hex);
    return new THREE.MeshStandardMaterial({ color: c, metalness: 0.5, roughness: 0.34, emissive: c.clone().multiplyScalar(emiss) });
  }
  const orbitish = (m) => m.state === 'orbit' || (m.state === 'lost' && m.alt >= 100);
  function makeShip(m) {
    const G = GL.SG;
    const g = new THREE.Group();
    const core = new THREE.Group(); core.scale.set(m.radS, m.lenS, m.radS); g.add(core);
    const bodyMat = stdMat(m.base, m.mine ? 0.28 : 0.07);
    const accMat = stdMat(m.accent, 0.35);
    const body = new THREE.Mesh(G.body, bodyMat); core.add(body);
    core.add(new THREE.Mesh(G.band, accMat)); core.add(new THREE.Mesh(G.band2, accMat));
    core.add(new THREE.Mesh(G.nozzle, GL.metal));
    core.add(new THREE.Mesh(G.fins[m.fins], accMat));
    const flame = new THREE.Mesh(G.flame, GL.flameMat); flame.position.y = -1.22 * m.lenS; g.add(flame);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.T.glow, color: 0xffc58a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    glow.position.y = -1.3 * m.lenS; g.add(glow);
    const rings = new THREE.Group(); g.add(rings);
    g.scale.setScalar(SHIP_SCALE);
    GL.scene.add(g);
    const s = { m, g, core, body, bodyMat, accMat, flame, glow, rings, boosters: [], wings: null, dayRings: [],
      mode: m.state === 'lost' ? 'lost' : m.state, dispAlt: m.alt, thrust: 0.5, burst: 0, sink: 0, emitAcc: 0, q: new THREE.Quaternion(), pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 1, 0),
      t: 0, dim: 0, scaleK: 1, phi: m.phi, wingK: 0, pops: [] };
    const orb = orbitish(m);
    addBoostersTo(s, orb ? 3 : Math.floor(m.alt / 25), false);
    if (orb) addWings(s, false);
    if (m.live) { for (let k = 0; k < 3; k++) if (m.ck[k]) addDayRing(s, k, false); }
    else if (m.state === 'orbit') { for (let k = 0; k < m.checks; k++) addDayRing(s, k, false); }
    GL.ships.set(m.id, s);
    placeShip(s, 0);
    s.g.quaternion.copy(s.q);
    return s;
  }
  function addBooster(s, n, pop) {
    if (s.boosters.length >= n) return;
    const b = new THREE.Mesh(GL.SG.booster, s.accMat); b.position.y = [-0.78, -0.48, -0.18][n - 1];
    s.core.add(b); s.boosters.push(b);
    if (pop) { b.scale.setScalar(0.01); s.pops.push({ o: b, t: 0, to: 1 }); }
  }
  function addBoostersTo(s, n, pop) { n = clamp(n | 0, 0, 3); for (let i = s.boosters.length + 1; i <= n; i++) addBooster(s, i, pop && i === n); }
  function addWings(s, pop) {
    if (s.wings) return;
    const w = new THREE.Group();
    [1, -1].forEach((side) => {
      const piv = new THREE.Group(); piv.position.set(0.27 * side, 0.05, 0); piv.rotation.y = side < 0 ? Math.PI : 0;
      piv.add(new THREE.Mesh(GL.SG.strut, GL.metal));
      const panel = new THREE.Mesh(GL.SG.wing, GL.solarMat); panel.position.x = 0.28; piv.add(panel);
      w.add(piv);
    });
    s.core.add(w); s.wings = w;
    s.wingK = pop ? 0 : 1; w.scale.set(s.wingK + 0.001, 1, 1);
  }
  function addDayRing(s, k, pop) {
    if (s.dayRings[k]) return;
    const mat = new THREE.MeshBasicMaterial({ color: DAY_COL[k], transparent: true, opacity: k === 2 ? 1 : 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const r = new THREE.Mesh(GL.SG.dayRing, mat);
    const rad = 0.86 + k * 0.2; r.userData.rad = rad;
    r.rotation.set(0.35 - k * 0.12, 0, 0.18 * (k - 1));
    r.scale.setScalar(pop ? 0.01 : rad);
    s.rings.add(r); s.dayRings[k] = r;
    if (pop) s.pops.push({ o: r, t: 0, to: rad });
  }
  const UPV = new THREE.Vector3(0, 1, 0);
  function placeShip(s, dt) {
    const m = s.m;
    if ((s.mode === 'ascent' || s.mode === 'liftoff' || s.mode === 'lostpath') && !m.path) assignPath(m);
    if (s.mode === 'pad') {
      const pad = GL.pads[m.pad];
      s.pos.copy(pad.n).multiplyScalar(R + 1.12 * m.lenS * SHIP_SCALE); s.dir.copy(pad.n);
    } else if (s.mode === 'liftoff') {
      const k = s.t / (REDUCED ? 0.3 : 2.9);
      const f = easeIn2(Math.min(1, k)) * Math.max(0.012, s.liftTo / 100);
      s.dispAlt = f * 100;
      m.path.at(f, s.pos); m.path.dir(Math.max(0.002, f), s.dir);
      if (k >= 1) s.mode = 'ascent';
    } else if (s.mode === 'ascent') {
      s.dispAlt += (m.alt - s.dispAlt) * (1 - Math.exp(-dt * 2.6));
      const f = clamp(s.dispAlt / 100, 0, 1);
      m.path.at(f, s.pos); m.path.dir(Math.max(0.002, f), s.dir);
      if (s.sink > 0.001) { s.pos.addScaledVector(s.dir, -s.sink); }
    } else if (s.mode === 'lostpath') {   // live: signal lost while still on the curve — the ship dims where it stands
      const f = clamp(s.dispAlt / 100, 0, 1);
      m.path.at(f, s.pos); m.path.dir(Math.max(0.002, f), s.dir);
      const k = Math.min(1, s.t / 2.5);
      s.dim = k; s.scaleK = 1 - k * 0.3;
    } else if (s.mode === 'insert') {
      const k = s.t / (REDUCED ? 0.2 : 0.75);
      const kk = Math.min(1, k);
      s.phi = s.phi0 + ORBIT_W * 2.2 * s.t * (1 - kk * 0.4);
      ringPoint(s.phi, s.pos); ringTangent(s.phi, s.dir);
      const out = _u.copy(s.pos).normalize();
      s.pos.addScaledVector(out, Math.sin(Math.PI * kk) * 2.2);
      if (k >= 1) { s.mode = 'orbit'; }
    } else if (s.mode === 'orbit') {
      let w = ORBIT_W * (REDUCED ? 0.5 : 1);
      const g = GL.gap;
      if (g && GL.time < g.until && g.id !== m.id) {
        const d = ((s.phi - g.phi + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        if (Math.abs(d) < 0.6) w = d >= 0 ? w + 0.1 * (1 - Math.abs(d) / 0.6) : Math.max(0.008, w - 0.09 * (1 - Math.abs(d) / 0.6));
      }
      s.phi += w * dt;
      ringPoint(s.phi, s.pos); ringTangent(s.phi, s.dir);
    } else if (s.mode === 'lost') {
      s.phi += ORBIT_W * dt * Math.max(0, 1 - s.t / 3);
      ringPoint(s.phi, s.pos); ringTangent(s.phi, s.dir);
      const out = _u.copy(s.pos).normalize();
      const k = s.t / 7.5;
      s.pos.addScaledVector(out, easeIn2(k) * 26).addScaledVector(GL.ring.N, -easeIn2(k) * 10);
      s.dir.lerp(out, Math.min(1, k * 1.2)).normalize();
      s.dim = Math.min(1, k * 1.6);
      s.scaleK = 1 - easeIn2(k) * 0.6;
    } else if (s.mode === 'star') {
      s.phi += ORBIT_W * dt * Math.max(0, 1 - s.t);
      ringPoint(s.phi, s.pos); ringTangent(s.phi, s.dir);
      const k = Math.min(1, s.t / 3.6);
      const away = _u.copy(s.starTarget).sub(s.pos);
      s.pos.addScaledVector(away, easeIn2(k));
      s.dir.lerp(away.normalize(), Math.min(1, k * 3)).normalize();
      s.scaleK = 1 - k * 0.92;
    }
  }
  const _q = new THREE.Quaternion();
  const _cRed = new THREE.Color(0x4a1414), _cDark = new THREE.Color(0x1c2a3a);
  function updateShip(s, dt) {
    s.t += dt;
    placeShip(s, dt);
    syncPathLine(s);
    if (s.pathLine) s.pathLine.material.uniforms.uProg.value = clamp(s.dispAlt / 100, 0, 1);
    _q.setFromUnitVectors(UPV, s.dir);
    if (s.g.quaternion.angleTo(_q) > 1.2) s.g.quaternion.copy(_q); else s.g.quaternion.slerp(_q, 1 - Math.exp(-dt * 8));
    s.g.position.copy(s.pos);
    s.g.scale.setScalar(SHIP_SCALE * s.scaleK);
    const base = s.mode === 'pad' ? 0 : s.mode === 'liftoff' ? 2.6 - Math.min(1, s.t / 2.9) * 1.6 : s.mode === 'ascent' ? 0.62 : s.mode === 'insert' ? 1.6
      : (s.mode === 'lost' || s.mode === 'lostpath') ? 0 : s.mode === 'star' ? 1.4 : 0.32;
    s.burst = Math.max(0, s.burst - dt * 2.2);
    s.sink = Math.max(0, s.sink - dt * 0.9);
    const target = base + s.burst * 1.4 - (s.sink > 0.05 ? 0.3 : 0);
    s.thrust += (Math.max(0, target) - s.thrust) * (1 - Math.exp(-dt * 10));
    const th = s.thrust;
    s.flame.visible = th > 0.04;
    s.flame.scale.set(0.8 + th * 0.35, 0.35 + th * 1.25, 0.8 + th * 0.35);
    const gs = (0.9 + th * 1.5) * (GL.tier === 'low' ? 1.6 : 1);
    s.glow.scale.set(gs, gs, 1); s.glow.material.opacity = Math.min(1, 0.25 + th * 0.6) * (1 - s.dim);
    if (s.mode === 'pad') { s.glow.material.opacity = 0.18; s.glow.scale.set(0.8, 0.8, 1); }
    if (s.dim > 0) {
      s.bodyMat.color.lerp(_cRed, dt * 0.6); s.bodyMat.emissive.setRGB(0.25 * s.dim, 0.02, 0.02);
      s.accMat.color.lerp(_cDark, dt * 0.6); s.accMat.emissive.multiplyScalar(1 - dt);
    }
    if (s.wings && s.wingK < 1) { s.wingK = Math.min(1, s.wingK + dt / 0.7); s.wings.scale.set(easeOut3(s.wingK) + 0.001, 1, 1); }
    for (let i = s.pops.length - 1; i >= 0; i--) {
      const p = s.pops[i]; p.t += dt / 0.45; const k = Math.min(1, p.t);
      const e = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.35 : 1; p.o.scale.setScalar(Math.max(0.01, p.to * easeOut3(k) * e));
      if (k >= 1) s.pops.splice(i, 1);
    }
    s.rings.rotation.y += dt * 0.25;
    if (th > 0.05 && s.scaleK > 0.15) {
      const rate = s.mode === 'orbit' ? 26 : 18 + th * 70;
      s.emitAcc += rate * dt;
      const tail = _w.copy(s.dir).multiplyScalar(-1.3 * s.m.lenS * SHIP_SCALE * s.scaleK).add(s.pos);
      const life = s.mode === 'orbit' ? 0.55 : 1.1;
      while (s.emitAcc >= 1) {
        s.emitAcc -= 1;
        rndUnit(_v);
        const vel = _u.copy(s.dir).multiplyScalar(-(2.2 + th * 5.5)).addScaledVector(_v, 0.5 + th * 0.4);
        const jitter = _v.multiplyScalar(0.12);
        emitP(jitter.add(tail), vel, life * (0.75 + Math.random() * 0.5), (0.36 + th * 0.2) * SHIP_SCALE * s.scaleK, 0);
      }
    } else s.emitAcc = 0;
  }
  function removeShip(s) {
    if (s.pathLine) { GL.scene.remove(s.pathLine); s.pathLine.geometry.dispose(); s.pathLine.material.dispose(); s.pathLine = null; }
    GL.scene.remove(s.g);
    const seen = new Set();
    s.g.traverse((o) => { const mt = o.material; if (mt && !seen.has(mt) && mt !== GL.metal && mt !== GL.flameMat && mt !== GL.solarMat) { seen.add(mt); mt.dispose(); } });
    GL.ships.delete(s.m.id);
  }

  /* =====================================================================
     Camera director, deep-space stars, labels
     ===================================================================== */
  const camState = {
    mode: 'home', focusId: null, frameDist: 34, flight: null, userLocked: false, eventCam: false,
    pos: null, target: null, up: null, fov: 40, drift: 0, px: 0, py: 0, ppx: 0, ppy: 0,
    shift: { x: 0, y: 0 }, shiftTo: { x: 0, y: 0 }, t1: null, t2: null
  };
  const HOME = { pos: null, target: null, up: null, fov: 40 };
  const GOAL = { pos: null, target: null, up: null, fov: 40 };
  function poseInit() { [camState, HOME, GOAL].forEach((o) => { o.pos = new THREE.Vector3(); o.target = new THREE.Vector3(); o.up = new THREE.Vector3(0, 1, 0); }); }
  function computeHome(out, t) {
    const aspect = VW / VH;
    const k = clamp((aspect - 0.5) / (1.55 - 0.5), 0, 1);
    const d = lerp(2.75, 2.0, k) * R;
    const el = THREE.MathUtils.degToRad(lerp(7, 10, k));
    const fov = lerp(58, 40, k);
    const f = lerp(0.42, 0.4, k);
    out.pos.set(0, Math.sin(el) * d, Math.cos(el) * d);
    const alpha = Math.asin(R / d);
    const limb = -el + alpha;
    const look = limb + Math.atan((1 - 2 * f) * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    out.target.set(0, Math.sin(look), -Math.cos(look)).multiplyScalar(d).add(out.pos);
    out.fov = fov; out.up.set(0, 1, 0);
    if (!REDUCED) {
      out.pos.x += Math.sin(t * 0.071) * 2.2 + camState.ppx * 2.6;
      out.pos.y += Math.sin(t * 0.053) * 1.1 - camState.ppy * 1.4;
      out.pos.z += Math.cos(t * 0.061) * 1.6;
    }
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  function focusGoal(s, dist, out) {
    const S = s.pos, o = _a.copy(S).normalize();
    const toHome = _b.copy(HOME.pos).sub(S).normalize();
    const w = (s.mode === 'orbit' || s.mode === 'insert' || s.mode === 'star' || s.mode === 'lost') ? 0.9 : 0.5;
    const d = _c.copy(o).multiplyScalar(w).addScaledVector(toHome, 0.8).normalize();
    out.pos.copy(S).addScaledVector(d, dist);
    out.target.copy(S).addScaledVector(o, dist * 0.04);
    out.up.copy(o).lerp(UPV, 0.45).normalize();
    out.fov = isPhone() ? 52 : 34;
  }
  function flyTo(m, dur) {
    if (!GL) return;
    const instant = REDUCED || dur === 0;
    camState.flight = instant ? null : { t: 0, dur, from: { pos: GL.camera.position.clone(), target: camState.target.clone(), up: GL.camera.up.clone(), fov: GL.camera.fov } };
    camState.mode = m;
    if (instant) camState.snap = true;
  }
  function startIntro() {
    computeHome(HOME, 0);
    camState.target.copy(HOME.target);
    if (REDUCED) { GL.camera.position.copy(HOME.pos); GL.camera.fov = HOME.fov; camState.mode = 'home'; return; }
    GL.camera.position.set(90, 420, 900); camState.target.set(0, 30, 0); GL.camera.fov = 26;
    camState.flight = { t: 0, dur: 2.5, intro: true, from: { pos: GL.camera.position.clone(), target: camState.target.clone(), up: new THREE.Vector3(0, 1, 0), fov: 26 } };
    camState.mode = 'home';
  }
  let _fcs = { w: -1, v: 0 };
  function freeCenterShift(W) {   // centre the scene in the gap between the hero and the flight log
    if (_fcs.w === W) return _fcs.v;
    const h = heroEl();
    const hero = h ? relRect(h) : null, feed = relRect(E.feed);
    const l = hero && hero.width ? hero.right : 0, r = feed.width ? feed.left : W;
    _fcs = { w: W, v: clamp((l + r) / 2 - W / 2, -W * 0.18, W * 0.18) };
    return _fcs.v;
  }
  function updateCamera(dt, t) {
    camState.ppx += (camState.px - camState.ppx) * (1 - Math.exp(-dt * 2));
    camState.ppy += (camState.py - camState.ppy) * (1 - Math.exp(-dt * 2));
    computeHome(HOME, t);
    let goal = HOME;
    const s = camState.focusId != null ? GL.ships.get(camState.focusId) : null;
    if ((camState.mode === 'focus' || camState.mode === 'frame') && s) {
      focusGoal(s, camState.mode === 'frame' ? camState.frameDist : (isPhone() ? 19 : 15), GOAL); goal = GOAL;
    } else if (camState.mode !== 'home') { camState.mode = 'home'; }
    const C = GL.camera;
    if (camState.flight) {
      const F = camState.flight; F.t += dt / F.dur;
      const e = F.intro ? easeInOut3(F.t) * 0.35 + easeOut3(F.t) * 0.65 : easeOut3(F.t);
      C.position.copy(F.from.pos).lerp(goal.pos, e);
      camState.target.copy(F.from.target).lerp(goal.target, e);
      C.up.copy(F.from.up).lerp(goal.up, e).normalize();
      C.fov = lerp(F.from.fov, goal.fov, e);
      if (F.t >= 1) camState.flight = null;
    } else {
      const k = camState.snap ? 1 : 1 - Math.exp(-dt * (goal === HOME ? 3 : 7));
      camState.snap = false;
      C.position.lerp(goal.pos, k); camState.target.lerp(goal.target, k);
      C.up.lerp(goal.up, k).normalize(); C.fov = lerp(C.fov, goal.fov, k);
    }
    C.lookAt(camState.target);
    const W = VW, H = VH;
    const panelOpen = !E.panel.hidden;
    const framing = camState.mode === 'frame' && camState.focusId != null;
    if (isPhone()) { camState.shiftTo.x = 0; camState.shiftTo.y = panelOpen ? H * 0.2 : framing ? -H * 0.08 : -H * 0.015; }
    else { camState.shiftTo.y = framing ? -H * 0.11 : panelOpen ? H * 0.07 : 0; camState.shiftTo.x = panelOpen ? 200 : -freeCenterShift(W); }
    const sk = 1 - Math.exp(-dt * 4);
    camState.shift.x += (camState.shiftTo.x - camState.shift.x) * sk; camState.shift.y += (camState.shiftTo.y - camState.shift.y) * sk;
    C.setViewOffset(W, H, camState.shift.x, camState.shift.y, W, H);
    C.updateProjectionMatrix();
  }

  /* ---------- deep space: Day 90 stars ---------- */
  function slotDir(i) {
    const S = isPhone() ? STAR_SLOTS_PHONE : STAR_SLOTS_DESK;
    let x, y;
    if (i < S.length * 2) { [x, y] = S[i % S.length]; if (i >= S.length) { x += 0.06; y -= 0.05; } }
    else { const r = mulberry32(7919 * i + 13); [x, y] = S[i % S.length]; x = clamp(x + (r() - 0.5) * 0.2, -0.95, 0.95); y = clamp(y + (r() - 0.5) * 0.16, -0.1, 0.85); }
    computeHome(HOME, 0);
    const cam = new THREE.PerspectiveCamera(HOME.fov, VW / VH, 0.1, 10);
    cam.position.copy(HOME.pos); cam.lookAt(HOME.target); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const p = new THREE.Vector3(x, y, 0.5).unproject(cam);
    return p.sub(HOME.pos).normalize();
  }
  function makeNamedStar(d, i, born, key) {
    computeHome(HOME, 0);
    const pos = slotDir(i).multiplyScalar(1000).add(HOME.pos);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.T.glint, color: 0xffe6b8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    sp.position.copy(pos); sp.renderOrder = -5; GL.scene.add(sp);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GL.T.ring, color: 0xfc9d01, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.position.copy(pos); halo.scale.set(30, 30, 1); GL.scene.add(halo);
    const hk = hashStr(String(d.ticker || key));
    const st = { d, sp, halo, pos, key, slot: i, base: 15 + (hk % 6), born: born ? 0 : 1, seed: (hk % 100) / 100 };
    GL.named.push(st); return st;
  }
  function disposeNamed(st) { GL.scene.remove(st.sp); GL.scene.remove(st.halo); st.sp.material.dispose(); st.halo.material.dispose(); }
  function updateNamed(dt, t) {
    GL.named.forEach((st) => {
      if (st.born < 1) st.born = Math.min(1, st.born + dt / 2.2);
      const b = easeOut3(st.born);
      const tw = 1 + 0.12 * Math.sin(t * (0.7 + st.seed) + st.seed * 30);
      const hov = GL.hoverStar === st ? 1.35 : 1;
      const sz = st.base * tw * hov * (st.born < 1 ? 0.2 + b * 1.6 - Math.max(0, b - 0.6) * 1.0 : 1);
      st.sp.scale.set(sz, sz, 1);
      st.halo.material.opacity = (GL.hoverStar === st ? 0.7 : 0.08) * (st.born < 1 ? 1 - b * 0.4 : 1);
      const hs = st.base * 1.25 * hov; st.halo.scale.set(hs, hs, 1);
    });
  }
  function freeSlot() {
    const used = new Set(GL.named.map((st) => st.slot));
    GL.ships.forEach((s) => { if (s.mode === 'star' && s.m.starSlot != null) used.add(s.m.starSlot); });
    let i = 0; while (used.has(i)) i++; return i;
  }
  // live: one star per Day 90 mission (not mid-flight to its slot) plus snapshot.stars unnamed ones
  function syncStars() {
    if (!GL || mode !== 'live') return;
    const want = new Map();
    missions.forEach((m) => { if (m.state !== 'star') return; const s = GL.ships.get(m.id); if (s && s.mode === 'star') return; want.set('m:' + m.id, m); });
    const room = Math.max(0, STAR_CAP - want.size);
    for (let i = 0; i < Math.min(extraStars, room); i++) want.set('x:' + i, null);
    for (let i = GL.named.length - 1; i >= 0; i--) {
      const st = GL.named[i];
      if (!want.has(st.key)) { if (GL.hoverStar === st) showTip(null); disposeNamed(st); GL.named.splice(i, 1); }
      else if (st.d.m) { st.d.ticker = st.d.m.ticker; st.d.crew = st.d.m.crewSize; st.d.names = st.d.m.crew; }
    }
    const have = new Set(GL.named.map((st) => st.key));
    want.forEach((m, key) => {
      if (have.has(key)) return;
      const slot = m && m.starSlot != null && !GL.named.some((st) => st.slot === m.starSlot) ? m.starSlot : freeSlot();
      const d = m ? { ticker: m.ticker, crew: m.crewSize, names: m.crew, m } : { ticker: null, crew: 0, m: null };
      const born = !!(m && m.bornPending); if (m) m.bornPending = false;
      const st = makeNamedStar(d, slot, born, key);
      if (born) flash(st.pos, 120, 1.4, 0xffe6b8);
    });
  }

  /* ---------- ship labels (HTML over the canvas) ---------- */
  const labels = new Map();
  const _p = new THREE.Vector3();
  function occluded(p) {
    const o = GL.camera.position; const d = _p.copy(p).sub(o); const L = d.length(); d.divideScalar(L);
    const b = o.dot(d); const c = o.lengthSq() - R * R * 0.995; const disc = b * b - c; if (disc < 0) return false;
    const tt = -b - Math.sqrt(disc); return tt > 0 && tt < L;
  }
  function toScreen(p, out) {
    _p.copy(p).project(GL.camera);
    out.x = (_p.x * 0.5 + 0.5) * VW; out.y = (-_p.y * 0.5 + 0.5) * VH; out.z = _p.z;
    return out;
  }
  const SCR = { x: 0, y: 0, z: 0 };
  function lblRank(s) { const m = s.m; return (camState.focusId === m.id ? 1000 : 0) + (m.mine ? 500 : 0) + (s.flagUntil && s.flagUntil > GL.time ? 300 : 0) + (s.mode === 'pad' ? 10 : m.alt); }
  const placed = [];
  function updateLabels(now) {
    const box = E.labels;
    const seen = new Set();
    placed.length = 0;
    rootRect();
    const floor = relRect(isPhone() ? E.ticker : E.strip).top - 8;
    [E.feed, E.replays, E.panel, E.countdown].forEach((el) => {
      if (!el || el.hidden || el.classList.contains('away')) return;
      if (el === E.countdown && !el.classList.contains('on')) return;
      const r = relRect(el); if (r.width) placed.push({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 });
    });
    /* A gold plate (a fee share, a check) owns its spot while it is up: no ship's label lands on it. */
    for (const el of E.floats.children) { const r = relRect(el); if (r.width) placed.push({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 }); }
    const h = heroEl();
    if (h && !root.classList.contains('panel-open') && !root.classList.contains('ev-on')) {
      h.querySelectorAll('.eyebrow, h1, .lede, .cta').forEach((el) => { const r = relRect(el); if (r.width) placed.push({ x: r.left - 14, y: r.top - 10, w: r.width + 28, h: r.height + 20 }); });
    }
    const order = [...GL.ships.values()].sort((a, b) => lblRank(b) - lblRank(a));
    order.forEach((s) => {
      const m = s.m;
      const show = (s.mode === 'pad' || s.mode === 'liftoff' || s.mode === 'ascent' || camState.focusId === m.id || (s.flagUntil && s.flagUntil > now)) && !(camState.focusId === m.id && camState.mode === 'focus');
      if (!show) return;
      toScreen(s.pos, SCR);
      const off = SCR.z > 1 || SCR.x < -40 || SCR.x > VW + 40 || SCR.y < 40 || SCR.y > VH || occluded(s.pos);
      let el = labels.get(m.id);
      if (!el) {
        el = document.createElement('div'); el.className = 'lbl' + (m.mine ? ' mine' : ''); el.innerHTML = '<b></b><em></em>'; box.appendChild(el); labels.set(m.id, el);
        el._b = el.firstChild; el._e = el.lastChild; el._t = -1;
      }
      seen.add(m.id);
      if (now - el._t > 0.2) {
        el._t = now;
        el._b.textContent = m.ticker.replace(/^\$/, '');
        el._e.textContent = s.mode === 'pad' ? 'READY' : s.mode === 'orbit' || s.mode === 'insert' ? 'ORBIT' : s.mode === 'star' ? 'DAY 90'
          : (s.mode === 'lost' || s.mode === 'lostpath') ? 'SIGNAL LOST' : (m.live && !m.altKnown) ? DASH : fmtAlt(Math.min(m.alt, s.dispAlt + 0.05));
        el.classList.toggle('orb', s.mode === 'orbit' || s.mode === 'insert' || s.mode === 'star'); el.classList.toggle('lost', s.mode === 'lost' || s.mode === 'lostpath');
        /* The label's own size, read when its words change: «LUMA READY» is wider than «FERN 12%», and a fixed box let them overlap. */
        el._w = el.offsetWidth || el._w; el._h = el.offsetHeight || el._h;
      }
      const w = (el._w || (isPhone() ? 92 : 108)) + 6, hh = (el._h || (isPhone() ? 18 : 22)) + 4;
      /* A label that would leave the screen on the right flips to the ship's left. */
      let x = SCR.x + 16; const y = SCR.y - 22;
      const flip = x + w > VW - 6;
      if (flip) x = Math.max(6, SCR.x - w - 16);
      el.classList.toggle('flip', flip);
      const clash = placed.some((p) => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + hh > p.y);
      const hidden = off || clash || y + hh > floor;
      if (!hidden) placed.push({ x, y, w, h: hh });
      el.classList.toggle('hide', hidden);
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    });
    labels.forEach((el, id) => { if (!seen.has(id)) { el.remove(); labels.delete(id); } });
  }
  function clearLabels() { labels.forEach((el) => el.remove()); labels.clear(); }

  /* ---------- lens flare ghosts from the Ryntra star ---------- */
  const _s = new THREE.Vector3();
  function updateFlares() {
    const vis = !REDUCED && GL.tier !== 'low';
    _s.copy(GL.sunPos).project(GL.camera);
    const onScreen = vis && _s.z < 1 && Math.abs(_s.x) < 1.2 && Math.abs(_s.y) < 1.2 && !occluded(GL.sunPos);
    GL.flares.forEach((f) => {
      if (!onScreen) { f.visible = false; return; }
      f.visible = true;
      const k = f.userData.k;
      _p.set(_s.x * (1 - k * 1.6), _s.y * (1 - k * 1.6), 0.15).unproject(GL.camera);
      f.position.copy(_p);
      const dist = _p.distanceTo(GL.camera.position);
      const sc = f.userData.s * dist * 0.0016; f.scale.set(sc, sc, 1);
      f.material.opacity = 0.16 * (1 - Math.min(1, Math.hypot(_s.x, _s.y) * 0.6));
    });
    GL.sunStreak.visible = !occluded(GL.sunPos);
  }

  /* ---------- scene reactions to events (shared by the simulator and the chain) ---------- */
  function shipOf(m) { return GL ? GL.ships.get(m.id) : null; }
  function flareAt(pos, amt) { const f = GL.flareU.reduce((a, b) => (a.w < b.w ? a : b)); f.set(pos.x, pos.y, pos.z, amt); }
  function goldStream(s, dur) { GL.streams.push({ s, t: 0, dur, acc: 0 }); }
  function ringPulse(s) { if (s.mode !== 'orbit' && s.mode !== 'insert') return; GL.pulse = { u: ((s.phi / (Math.PI * 2)) % 1 + 1) % 1, t: 0 }; }
  function bindSceneEvents() {
    on('buy', ({ m, usd }) => {
      if (!GL) return; const s = shipOf(m); if (!s) return;
      s.burst = Math.min(1.6, s.burst + 0.6 + usd / 900);
      if (!REDUCED) ping(s.pos, usd >= 300 ? 0x9fd4ff : 0x4fb8ff, 3.2 + Math.min(4, usd / 160), 0.85 + Math.min(0.5, usd / 1800));
    });
    on('sell', ({ m }) => { if (!GL) return; const s = shipOf(m); if (!s) return; s.sink = 1.1; });
    on('booster', ({ m, n }) => { if (!GL) return; const s = shipOf(m); if (!s) return; addBoostersTo(s, n, true); ping(s.pos, 0xd6e6ff, 7, 1.0); });
    on('rollout', ({ m }) => {
      if (!GL) return;
      const s = makeShip(m); s.scaleK = 0.01; s.pops.push({ o: { scale: { setScalar: (v) => { s.scaleK = Math.max(0.01, v); } } }, t: 0, to: 1 });
      ping(GL.pads[m.pad].stand, 0x4fb8ff, 9, 1.2);
    });
    on('ignite', ({ m }) => {
      if (!GL) return;
      const s = shipOf(m) || makeShip(m);
      if (!m.path) assignPath(m);
      s.mode = 'liftoff'; s.t = 0; s.liftTo = m.alt;
      const pad = GL.pads[m.pad];
      flareAt(pad.pos, 0.75);
      if (!REDUCED) flash(pad.stand, 8, 0.8, 0xffb070);
      if (!REDUCED) {
        for (let i = 0; i < 90; i++) {
          rndUnit(_v); _v.addScaledVector(pad.n, -_v.dot(pad.n)).normalize();
          const vel = _u.copy(_v).multiplyScalar(3 + Math.random() * 7).addScaledVector(pad.n, 0.4 + Math.random() * 2.2);
          emitP(_w.copy(pad.pos).addScaledVector(pad.n, 0.4), vel, 1.2 + Math.random() * 1.1, 0.6 + Math.random() * 0.6, 0);
        }
      }
      sfx.rumble();
    });
    on('approach', ({ m, cam }) => {
      if (!GL) return;
      const s = shipOf(m); if (s) s.flagUntil = GL.time + 14;
      if (m.path) GL.gap = { id: m.id, phi: m.path.phiT, until: GL.time + 9 };
      if (cam && !camState.userLocked && !REDUCED) { camState.focusId = m.id; camState.frameDist = isPhone() ? 42 : 40; camState.eventCam = true; cancel(camState.t1); camState.t1 = later(() => flyTo('frame', 1.6), 900); }
    });
    on('orbit', ({ m }) => {
      if (!GL) return; const s = shipOf(m); if (!s) return;
      s.mode = 'insert'; s.t = 0; s.phi0 = m.path ? m.path.phiT : ringPhiOf(s.pos); s.phi = s.phi0;
      m.phi = s.phi0; s.flagUntil = GL.time + 8;
      addWings(s, true);
      const p = s.pos.clone();
      if (!REDUCED) { flash(p, 11, 0.45, 0xffffff); flash(p, 5, 0.22, 0xffffff); }
      if (!REDUCED) { wave(p, 0, 36, 0xf5b544); wave(p, 0.22, 22, 0xffc65a); GL.ringWave = { u: ((s.phi0 / (Math.PI * 2)) % 1 + 1) % 1, t: 0 }; }
      for (let i = 0; i < (REDUCED ? 0 : 90); i++) { rndUnit(_v); emitP(p, _v.multiplyScalar(4 + Math.random() * 9), 0.8 + Math.random() * 0.7, 0.5, 2); }
      if (!REDUCED) goldStream(s, 1.5);
      sfx.chime();
      if (camState.eventCam && !camState.userLocked) {
        cancel(camState.t2);
        camState.t2 = later(() => { if (GL && !camState.userLocked && camState.eventCam) { camState.eventCam = false; camState.focusId = null; flyTo('home', 1.6); } }, 6200);
      }
    });
    on('check', ({ m, day }) => {
      if (!GL) return; const s = shipOf(m); if (!s) return;
      const k = day === 7 ? 0 : day === 30 ? 1 : 2;
      addDayRing(s, k, true); s.flagUntil = GL.time + 5; ringPulse(s);
      ping(s.pos, day === 90 ? 0xfc9d01 : 0x9fd4ff, 9, 1.3);
    });
    on('star', ({ m }) => {
      if (!GL) return; const s = shipOf(m); if (!s) return;
      const i = m.live ? freeSlot() : GL.named.length;
      m.starSlot = i;
      s.mode = 'star'; s.t = 0; s.starTarget = slotDir(i).multiplyScalar(420).add(HOME.pos);
      flash(s.pos, 10, 0.6, 0xffd27a);
    });
    on('starborn', ({ m }) => {   // DEMO
      if (!GL || !demo) return;
      const s = shipOf(m); if (s) removeShip(s);
      const d = demo.DEEP[demo.DEEP.length - 1];
      const st = makeNamedStar(d, GL.named.length, true, 'd:' + GL.named.length);
      flash(st.pos, 120, 1.4, 0xffe6b8);
      if (camState.focusId === m.id) backToSky(false);
    });
    on('lost', ({ m }) => { if (!GL) return; const s = shipOf(m); if (!s) return; s.mode = 'lost'; s.t = 0; s.flagUntil = GL.time + 7.5; });
    on('removed', ({ m }) => { if (GL) { const s = shipOf(m); if (s) removeShip(s); } if (camState.focusId === m.id || hud.panelId === m.id) backToSky(false); });
    on('fee', ({ m }) => { if (!GL) return; const s = shipOf(m); if (!s) return; goldStream(s, 0.9); ringPulse(s); });
    on('repad', ({ m }) => {
      if (!GL) return; const s = shipOf(m); if (!s) return;
      s.mode = 'pad'; s.dispAlt = 0; s.t = 0; s.burst = 0; s.sink = 0;
      s.boosters.forEach((b) => s.core.remove(b)); s.boosters = [];
      ping(GL.pads[m.pad].stand, 0x4fb8ff, 7, 1.0);
    });
    on('reset', ({ m }) => {
      if (!GL) return;
      let s = shipOf(m);
      if (!s) s = makeShip(m);
      if (!m.path) assignPath(m);
      s.mode = 'ascent'; s.dispAlt = m.alt; s.scaleK = 1; s.dim = 0; s.t = 0;
      if (s.wings) { s.core.remove(s.wings); s.wings = null; }
      s.dayRings.forEach((r) => { if (r) { s.rings.remove(r); r.material.dispose(); } }); s.dayRings = [];
      s.bodyMat.color.set(m.base); s.accMat.color.set(m.accent);
    });
  }
  function updateStreams(dt) {
    for (let i = GL.streams.length - 1; i >= 0; i--) {
      const st = GL.streams[i]; st.t += dt;
      if (st.t > st.dur || !GL.ships.has(st.s.m.id)) { GL.streams.splice(i, 1); continue; }
      st.acc += dt * 90;
      const out = _a.copy(st.s.pos).normalize();
      while (st.acc >= 1) {
        st.acc -= 1; rndUnit(_v);
        const vel = _u.copy(out).multiplyScalar(5 + Math.random() * 4).addScaledVector(_v, 1.6);
        emitP(_w.copy(st.s.pos).addScaledVector(_v, 0.4), vel, 1.1 + Math.random() * 0.5, 0.42, 1);
      }
    }
  }
  function backToSky(user) {
    camState.userLocked = false; camState.eventCam = false; camState.focusId = null;
    cancel(camState.t1); cancel(camState.t2);
    flyTo('home', 1.6);
    const had = hud.panelId != null;
    hud.closePanel();
    if (user && had) notify('onSelect', null);
  }
  function focusMission(m, user) {
    const s = shipOf(m);
    if (s) {
      camState.userLocked = true; camState.eventCam = false; camState.focusId = m.id;
      cancel(camState.t1); cancel(camState.t2);
      flyTo('focus', 1.6);
    } else if (GL && camState.focusId != null) { camState.focusId = null; flyTo('home', 1.6); }
    hud.openPanel(m);
    if (user) notify('onSelect', m.id);
  }

  /* =====================================================================
     Sound (WebAudio synth only, off until a person turns it on)
     ===================================================================== */
  const sfx = (() => {
    let ctx = null, master = null, noise = null, onS = false, lastTick = 0, droneG = null, dly = null;
    function ensure() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
      const len = ctx.sampleRate * 2; noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0); let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      droneG = ctx.createGain(); droneG.gain.value = 0; droneG.connect(master);
      [55, 82.4, 110.2].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = [0.05, 0.028, 0.014][i]; o.connect(g); g.connect(droneG); o.start(); });
      dly = ctx.createDelay(); dly.delayTime.value = 0.19; const fb = ctx.createGain(); fb.gain.value = 0.34; dly.connect(fb); fb.connect(dly);
      const wet = ctx.createGain(); wet.gain.value = 0.32; dly.connect(wet); wet.connect(master);
      return true;
    }
    function ui() {
      const b = E.sound; b.setAttribute('aria-pressed', onS ? 'true' : 'false');
      b.setAttribute('aria-label', onS ? 'Sound on. Turn sound off' : 'Sound off. Turn sound on');
      E['snd-t'].textContent = onS ? 'SOUND ON' : 'SOUND OFF';
      E['snd-x'].style.display = onS ? 'none' : ''; E['snd-w'].style.display = onS ? '' : 'none';
    }
    function set(v) {
      onS = !!v;
      try { if (onS && !ensure()) onS = false; } catch (_e) { onS = false; }
      if (ctx) { const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(onS ? 0.55 : 0, t, 0.08); droneG.gain.setTargetAtTime(onS ? 1 : 0, t, 0.8); }
      ui();
    }
    function rumble() {
      if (!onS || !ctx) return; const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
      lp.frequency.setValueAtTime(60, t); lp.frequency.exponentialRampToValueAtTime(560, t + 1.0); lp.frequency.exponentialRampToValueAtTime(80, t + 3.2);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.85, t + 0.22); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.3);
      src.connect(lp); lp.connect(g); g.connect(master); src.start(t); src.stop(t + 3.4);
    }
    function chime() {
      if (!onS || !ctx) return; const t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = ctx.createGain(); const st = t + i * 0.085;
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.19, st + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, st + 1.5);
        o.connect(g); g.connect(master); g.connect(dly); o.start(st); o.stop(st + 1.6);
      });
    }
    function tick(hi) {
      if (!onS || !ctx) return; const t = ctx.currentTime; if (t - lastTick < 0.07) return; lastTick = t;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(hi ? 2600 : 1900, t); o.frequency.exponentialRampToValueAtTime(hi ? 1500 : 1100, t + 0.03);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.06);
    }
    function close() { if (ctx) { try { ctx.close(); } catch (_e) { /* already closed */ } ctx = null; } onS = false; }
    return { get on() { return onS; }, toggle() { set(!onS); }, set, rumble, chime, tick, ui, close };
  })();

  /* =====================================================================
     HUD — top bar, feed, ticker, cards, mission panel, event title, board
     ===================================================================== */
  const hud = {
    cards: new Map(), lastCards: 0, panelId: null, lastPanel: 0, tickHold: 0, titleBusy: false, floats: [], last: {}, titleT: [], toastT: null, cdT: null,
    log(tk, html, cls, important, href) {
      const ol = E['feed-list'];
      const em = ol.querySelector('li.empty'); if (em) em.remove();
      const li = document.createElement('li'); li.className = ((cls || '') + (href ? ' tx' : '')).trim();
      const inner = `<b>${esc(tk)}</b><span>${html}</span>`;
      li.innerHTML = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="Open the transaction on Solscan">${inner}</a>` : inner;
      ol.insertBefore(li, ol.firstChild);
      while (ol.children.length > 12) ol.removeChild(ol.lastChild);
      const now = performance.now();
      if (important || now > this.tickHold) {
        const tl = E['tk-line']; tl.innerHTML = `<b>${esc(tk)}</b>&nbsp; ${html}`;
        tl.style.animation = 'none'; void tl.offsetWidth; tl.style.animation = '';
        E.ticker.classList.toggle('ev', !!important);
        if (important) this.tickHold = now + 3200;
      }
    },
    feedEmpty() {
      if (mode !== 'live' || E['feed-list'].children.length) return;
      E['feed-list'].innerHTML = '<li class="sys empty">No events yet — the log fills from the chain.</li>';
      E['tk-line'].textContent = 'No events yet'; E.ticker.classList.remove('ev');
    },
    clearFeed() { E['feed-list'].innerHTML = ''; E['tk-line'].textContent = ''; E.ticker.classList.remove('ev'); this.tickHold = 0; },
    toast(msg) {
      const t = E.toast; t.textContent = msg; t.classList.add('on');
      cancel(this.toastT); this.toastT = later(() => t.classList.remove('on'), 2400);
    },
    statsSkeleton() {
      E.stats.innerHTML = mode === 'demo'
        ? '<div class="stat keep"><dt>DEMO WINDOW</dt><dd data-s="next">00:08</dd></div><div class="stat"><dt>IN FLIGHT</dt><dd data-s="flight"></dd></div><div class="stat"><dt>IN ORBIT</dt><dd data-s="orbit"></dd></div><div class="stat opt"><dt>CREATOR FEES</dt><dd data-s="paid" class="gold"></dd></div>'
        : '<div class="stat keep"><dt>IN FLIGHT</dt><dd data-s="flight">—</dd></div><div class="stat"><dt>IN ORBIT</dt><dd data-s="orbit">—</dd></div><div class="stat"><dt>DAY 90 STARS</dt><dd data-s="stars" class="gold">—</dd></div><div class="stat opt"><dt>HOLDERS</dt><dd data-s="holders">—</dd></div>';
      this.last = {};
    },
    stats(force) {
      const set = (k, v, fl) => {
        if (this.last[k] === v && !force) return;
        const el = E.stats.querySelector(`[data-s="${k}"]`); if (!el) return;
        el.textContent = v;
        if (fl && this.last[k] !== undefined && this.last[k] !== v) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
        this.last[k] = v;
      };
      if (mode === 'demo') {
        if (!demo) return;
        set('next', mmss(demo.sim.nextWinAt - demo.sim.t));
        set('flight', String(demo.inFlight()));
        set('orbit', String(demo.inOrbitTotal()), true);
        set('paid', fmt0(demo.stats.crewsPaid), true);
        return;
      }
      if (!gotSnap) { ['flight', 'orbit', 'stars', 'holders'].forEach((k) => set(k, DASH)); return; }
      let fl = 0, orb = 0, st = 0, hs = 0, hk = 0, ge = false;
      missions.forEach((m) => {
        if (m.state === 'ascent') fl++; else if (m.state === 'orbit') orb++; else if (m.state === 'star') st++;
        if (m.holders != null) { hs += m.holders; hk++; if (m.holdersAtLeast) ge = true; }
      });
      set('flight', String(fl)); set('orbit', String(orb), true); set('stars', String(st + extraStars), true);
      set('holders', hk ? (ge ? '≥' : '') + Math.round(hs).toLocaleString('en-US') : DASH, true);
    },
    demoCardHTML(m) {
      const you = m.mine ? '<span class="chip you">YOU</span>' : '';
      if (m.state === 'orbit' && m.lostReason) {
        return `<span class="r1"><span class="tk">${m.ticker}</span><span class="chip lost">SIGNAL LOST</span></span>
        <span class="crew"><span class="avs">${avatars(m, 4)}</span>crew of ${m.crewSize}</span>
        <span class="rings"><span>${esc(m.lostReason)}</span></span>
        <span class="r4"><span>Day ${Math.floor(m.day)}</span><small>drifting out of orbit</small></span>`;
      }
      if (m.state === 'orbit') {
        const day = Math.floor(m.day), nc = nextCheck(m);
        const dots = [0, 1, 2].map((k) => `<i class="${m.checks > k ? 'on' + (k === 2 ? ' d90' : '') : ''}"></i>`).join('');
        const mc = m.orbitMc * (1 + Math.sin(demo.sim.t * 0.05 + m.seed) * 0.03);
        return `<span class="r1"><span class="tk">${m.ticker}</span>${you}<span class="chip orb">ORBIT · D${day}</span></span>
        <span class="crew"><span class="avs">${avatars(m, 4)}</span>crew of ${m.crewSize}</span>
        <span class="rings">${dots}<span>&nbsp;next check Day ${nc}</span></span>
        <span class="r4"><span>${fmtK(mc)}</span><small>${m.holders} holders</small></span>`;
      }
      if (m.state === 'pad') {
        return `<span class="r1"><span class="tk">${m.ticker}</span>${you}<span class="chip pad">READY</span></span>
        <span class="crew"><span class="avs">${avatars(m, 4)}</span>crew of ${m.crewSize}</span>
        <span class="bar"><i style="width:0%"></i></span>
        <span class="r4"><span>${fmtK(MC0)}</span><small>liftoff at T-0</small></span>`;
      }
      const mc = mcapAt(m.alt);
      return `<span class="r1"><span class="tk">${m.ticker}</span>${you}<span class="chip asc">${fmtAlt(m.alt)}</span></span>
      <span class="crew"><span class="avs">${avatars(m, 4)}</span>crew of ${m.crewSize}</span>
      <span class="bar"><i style="width:${m.alt.toFixed(1)}%"></i></span>
      <span class="r4"><span>${fmtK(mc)}</span><small>${m.holders} holders</small></span>`;
    },
    liveCardHTML(m) {
      const tk = esc(m.ticker);
      const test = m.ryntraTest ? `<span class="chip test" title="${esc(TEST_TITLE)}">RYNTRA TEST</span>` : '';
      const crew = `<span class="crew"><span class="avs">${avatars(m, 4)}</span>${test || (m.crewSize > 1 ? `crew of ${m.crewSize}` : 'creator')}</span>`;
      const st = m.state;
      const chip = st === 'ascent' ? `<span class="chip asc">${altTxt(m)}</span>` : st === 'pad' ? '<span class="chip pad">READY</span>'
        : st === 'orbit' ? `<span class="chip orb">ORBIT${m.dayN != null ? ' · D' + Math.floor(m.day) : ''}</span>`
          : st === 'lost' ? '<span class="chip lost">SIGNAL LOST</span>' : '<span class="chip orb">DAY 90</span>';
      let row3;
      if (st === 'ascent' || st === 'pad') row3 = `<span class="bar"><i style="width:${(m.altKnown ? m.alt : 0).toFixed(1)}%"></i></span>`;
      else if (st === 'orbit') row3 = `<span class="rings">${ringsHTML(m)}${m.dayN != null ? `<span>&nbsp;next check Day ${nextCheck(m)}</span>` : ''}</span>`;
      else if (st === 'lost') row3 = `<span class="rings">${ringsHTML(m)}<span>&nbsp;${m.lostDay ? 'signal lost at Day ' + m.lostDay : 'signal lost'}</span></span>`;
      else row3 = `<span class="rings">${ringsHTML(m)}<span>&nbsp;Day 90 passed</span></span>`;
      const h = holdersTxt(m);
      let left, right;
      if (m.mcap != null) { left = fmtK(m.mcap); right = m.since != null ? `${fmtX(m.since)} since liftoff` : `${h} holders`; }
      else {
        left = `${h}<small> holders</small>`;
        right = m.since != null ? `${fmtX(m.since)} since liftoff` : (st === 'orbit' && m.liq != null) ? `${fmtK(m.liq)} liquidity` : m.dayN != null ? `day ${Math.floor(m.day)}` : '';
      }
      return `<span class="r1"><span class="tk">${tk}</span>${chip}</span>${crew}${row3}<span class="r4"><span>${left}</span><small>${right}</small></span>`;
    },
    renderCards() {
      const strip = E.strip; const sl = strip.scrollLeft;
      let list;
      if (mode === 'demo') {
        const rank = (m) => m.state === 'ascent' ? 0 : m.state === 'pad' ? 1 : 2;
        list = missions.filter((m) => !m.gone && (m.state === 'ascent' || m.state === 'pad' || m.state === 'orbit'))
          .sort((a, b) => rank(a) - rank(b) || (a.state === 'ascent' ? b.alt - a.alt : a.state === 'orbit' ? b.day - a.day : 0));
      } else {
        const RK = { ascent: 0, pad: 1, orbit: 2, lost: 3, star: 4 };
        list = missions.slice().sort((a, b) => RK[a.state] - RK[b.state] || (a.state === 'ascent' ? b.alt - a.alt : b.day - a.day));
      }
      const keep = new Set(list.map((m) => m.id));
      this.cards.forEach((el, id) => { if (!keep.has(id)) { el.remove(); this.cards.delete(id); } });
      let prev = null;
      list.forEach((m) => {
        let el = this.cards.get(m.id);
        if (!el) { el = document.createElement('button'); el.className = 'card'; el.type = 'button'; el.dataset.id = m.id; this.cards.set(m.id, el); }
        el.classList.toggle('mine', !!m.mine); el.classList.toggle('sel', this.panelId === m.id); el.classList.toggle('lost', !!m.live && m.state === 'lost');
        const where = m.live
          ? (m.state === 'orbit' ? 'in orbit' + (m.dayN != null ? ', day ' + Math.floor(m.day) : '') : m.state === 'lost' ? 'signal lost' : m.state === 'star' ? 'Day 90 star' : m.state === 'pad' ? 'on the pad' : 'altitude ' + altTxt(m))
          : (m.state === 'orbit' ? 'in orbit, day ' + Math.floor(m.day) : m.state === 'pad' ? 'ready on pad' : 'altitude ' + fmtAlt(m.alt));
        el.setAttribute('aria-label', `${m.ticker}, ${where}${m.crewSize ? ', crew of ' + m.crewSize : ''}${m.ryntraTest ? ', Ryntra test launch' : ''}`);
        const html = m.live ? this.liveCardHTML(m) : this.demoCardHTML(m);
        if (el._h !== html) { el.innerHTML = html; el._h = html; }
        const want = prev ? prev.nextSibling : strip.firstChild;
        if (want !== el) strip.insertBefore(el, want);
        prev = el;
      });
      if (strip.scrollLeft !== sl) strip.scrollLeft = sl;
      const note = mode === 'live' && list.length === 0;
      E['strip-note'].hidden = !note || strip.classList.contains('away');
      if (note) { const t = gotSnap ? 'No missions in flight right now' : 'Reading the chain…'; if (E['strip-note-t'].textContent !== t) E['strip-note-t'].textContent = t; }
    },
    openPanel(m) {
      this.panelId = m.id; E.panel.hidden = false;
      root.classList.add('panel-open'); E.feed.classList.add('away'); E.back.hidden = false;
      if (isPhone()) E.strip.classList.add('away');
      this.fillPanel();
      this.renderCards();
    },
    closePanel() {
      this.panelId = null; E.panel.hidden = true;
      root.classList.remove('panel-open'); E.feed.classList.remove('away'); E.strip.classList.remove('away'); E.back.hidden = true;
      this.renderCards();
    },
    setHTML(el, html) { if (el._h !== html) { el.innerHTML = html; el._h = html; } },
    setGrid(items) {
      const g = E['p-grid'];
      const key = items.map((it) => (it.wide ? 'W' : 'k') + (it.sm ? 's' : '')).join('');
      if (g._k !== key) {
        g.innerHTML = items.map((it, i) => it.wide
          ? `<div class="kv wide"><dt data-i="${i}l"></dt><dd class="p-alt" data-i="${i}"></dd><div class="bar p-bar"><i></i></div></div>`
          : `<div class="kv"><dt data-i="${i}l"></dt><dd data-i="${i}"${it.sm ? ' class="sm"' : ''}></dd></div>`).join('');
        g._k = key; g._v = [];
      }
      items.forEach((it, i) => {
        const dt = g.querySelector(`[data-i="${i}l"]`), dd = g.querySelector(`[data-i="${i}"]`);
        if (dt.textContent !== it.l) dt.textContent = it.l;
        if (g._v[i] !== it.v) { dd.innerHTML = it.v; g._v[i] = it.v; }
        if (it.wide) { const bar = dd.parentNode.querySelector('.p-bar'); bar.classList.toggle('mine', !!it.mine); bar.firstChild.style.width = clamp(it.bar || 0, 0, 100).toFixed(1) + '%'; }
      });
    },
    setActions(m) {
      const key = mode + '|' + m.id + '|' + (m.href || '');
      const a = E['p-actions']; if (a._k === key) return; a._k = key;
      if (mode === 'demo') a.innerHTML = '';
      else a.innerHTML = (m.href ? `<a class="btn secondary" href="${esc(m.href)}">Open Control Room</a>` : '') + `<a class="btn ghost" href="/app/launch/${encodeURIComponent(m.id)}">Trade</a>`;
    },
    fillPanel() {
      const m = missions.find((x) => x.id === this.panelId); if (!m) return;
      E['p-tk'].textContent = m.ticker;
      this.setActions(m);
      if (m.live) this.fillLive(m); else this.fillDemo(m);
    },
    fillDemo(m) {
      E['p-name'].textContent = '';
      const chip = m.lostReason ? '<span class="chip lost">SIGNAL LOST</span>' : m.state === 'orbit' ? `<span class="chip orb">IN ORBIT · DAY ${Math.floor(m.day)}</span>` : m.state === 'pad' ? '<span class="chip pad">READY ON PAD</span>'
        : m.state === 'ascent' ? '<span class="chip asc">ASCENT</span>' : m.state === 'lost' ? '<span class="chip">SIGNAL LOST</span>' : '<span class="chip orb">DEEP SPACE</span>';
      this.setHTML(E['p-chips'], chip + (m.mine ? '<span class="chip you">YOUR MISSION</span>' : '') + `<span class="chip">CREW OF ${m.crewSize}</span>`);
      this.setHTML(E['p-avs'], avatars(m, 5));
      this.setHTML(E['p-crew'], `<b>${esc(m.crew.join(' · '))}</b>Crew of ${m.crewSize} · simulated`);
      let mc, alt, altL, bar, next, note;
      const small = (s) => `<br><small style="font-size:11px;color:#8A97A8;margin-left:0">${s}</small>`;
      if (m.lostReason) {
        mc = m.orbitMc * 0.4; altL = 'SIGNAL LOST'; alt = `DAY ${Math.floor(m.day)}<small> / 90</small>`; bar = m.day / 90 * 100;
        next = DASH + small(esc(m.lostReason));
        note = 'The Day 30 check failed: liquidity fell under the floor. The ship dims and drifts out of orbit; the crew keeps what was already paid.';
      } else if (m.state === 'orbit') {
        mc = m.orbitMc * (1 + Math.sin(demo.sim.t * 0.05 + m.seed) * 0.03);
        altL = 'ON THE 90-DAY COURSE'; alt = `DAY ${Math.floor(m.day)}<small> / 90</small>`; bar = m.day / 90 * 100;
        const nc = nextCheck(m); next = `Day ${nc} check` + small(`in ${Math.max(0, nc - m.day).toFixed(1)} days`);
        note = 'Orbit = graduated to a Meteora DAMM v2 pool. Pass the Day 7, 30 and 90 checks; Day 90 survivors become stars. Demo clock: 1 day = 8 s.';
      } else if (m.state === 'pad') {
        mc = MC0; altL = 'ALTITUDE'; alt = '0.0<small>%</small>'; bar = 0;
        next = 'Liftoff at T-0' + small('a falling fee for the first minutes');
        note = 'Ready for the next Launch Window. Every mission in the window lifts off together.';
      } else {
        mc = mcapAt(m.alt); altL = `ALTITUDE · ${Math.round(m.alt / 100 * GRAD_USDC).toLocaleString('en-US')} / 15,454 USDC`;
        alt = `${m.alt >= 99.95 ? '100' : m.alt.toFixed(1)}<small>%</small>`; bar = m.alt;
        const togo = Math.max(0, (100 - m.alt) / 100 * GRAD_USDC);
        next = 'Orbit at 100%' + small(`${Math.round(togo).toLocaleString('en-US')} USDC to go`);
        note = 'Altitude = bonding-curve progress. At 15,454 USDC raised the mission graduates and enters Orbit.';
      }
      this.setGrid([
        { wide: true, l: altL, v: alt, bar, mine: m.mine },
        { l: 'MARKET CAP', v: fmt0(mc) },
        { l: 'HOLDERS', v: String(m.holders) },
        { l: 'NEXT CHECK', v: next, sm: true }
      ]);
      E['p-note'].textContent = note;
    },
    fillLive(m) {
      E['p-name'].textContent = m.name && m.name !== m.ticker ? m.name : '';
      const st = m.state;
      const chip = st === 'ascent' ? '<span class="chip asc">ASCENT</span>' : st === 'pad' ? '<span class="chip pad">ON THE PAD</span>'
        : st === 'orbit' ? `<span class="chip orb">IN ORBIT${m.dayN != null ? ' · DAY ' + Math.floor(m.day) : ''}</span>`
          : st === 'lost' ? '<span class="chip lost">SIGNAL LOST</span>' : '<span class="chip orb">DAY 90 STAR</span>';
      const test = m.ryntraTest ? `<span class="chip test" title="${esc(TEST_TITLE)}">RYNTRA TEST</span>` : '';
      const win = m.window ? `<span class="chip">WINDOW ${m.window.slice(11, 16)} UTC</span>` : '';
      this.setHTML(E['p-chips'], chip + test + win + (m.crew && m.crew[0] ? `<span class="chip">CREATOR ${esc(m.crew[0])}</span>` : ''));
      this.setHTML(E['p-avs'], avatars(m, 5));
      this.setHTML(E['p-crew'], m.crewSize ? `<b>${esc(m.crew.join(' · '))}</b>${m.crewSize > 1 ? `Crew of ${m.crewSize}` : 'Creator'}` : `<b>${DASH}</b>Creator not read`);
      const items = [];
      if (st === 'ascent' || st === 'pad') items.push({ wide: true, l: 'ALTITUDE', v: m.altKnown ? `${m.alt >= 99.95 ? '100' : m.alt.toFixed(1)}<small>%</small>` : DASH, bar: m.altKnown ? m.alt : 0 });
      else items.push({ wide: true, l: 'DAY', v: m.dayN != null ? `DAY ${Math.floor(m.day)}<small> / 90</small>` : DASH, bar: m.dayN != null ? Math.min(90, m.day) / 90 * 100 : 0 });
      items.push({ l: 'HOLDERS', v: esc(holdersTxt(m)) });
      if (st === 'ascent' || st === 'pad') items.push({ l: 'DAY', v: m.dayN != null ? String(Math.floor(m.day)) : DASH });
      if (st === 'orbit') items.push({ l: 'LIQUIDITY', v: m.liq != null ? fmt0(m.liq) : DASH });
      if (m.mcap != null) items.push({ l: 'MARKET CAP', v: fmt0(m.mcap) });
      if (m.since != null) items.push({ l: 'SINCE LIFTOFF', v: `${fmtX(m.since)}<small>since liftoff</small>` });
      items.push({ l: 'CHECKS', v: `<span class="rings">${ringsHTML(m)}<span>&nbsp;Day 7 · 30 · 90</span></span>`, sm: true });
      this.setGrid(items);
      let note = st === 'ascent' ? 'Altitude is how far the token has climbed its price curve. At 100% it moves into its own trading pool on Meteora — orbit.'
        : st === 'pad' ? 'On the pad.'
          : st === 'orbit' ? 'In orbit: the token trades in its own pool. On days 7, 30 and 90 the chain answers one question: is anyone besides the creator and Ryntra still trading it?'
            : st === 'lost' ? (m.signal ? m.signal.reason : 'Signal lost: for a whole week nobody besides the creator and Ryntra traded it.')
              : 'Day 90 passed: the mission became a star.';
      if (m.ryntraTest) note += ' ' + TEST_TITLE + '.';
      E['p-note'].textContent = note;
    },
    countdown(sec, win) {
      const c = E.countdown; c.classList.add('on'); c.classList.remove('go');
      /* On a phone the countdown stands under the hero's buttons, never on them: 24 px below them, wherever they ended up. */
      const cta = isPhone() ? heroEl()?.querySelector('.cta') : null;
      if (cta) { rootRect(); const r = relRect(cta); c.style.top = r.height ? `${Math.round(r.bottom + 24)}px` : ''; } else c.style.top = '';
      E['cd-l'].textContent = `LAUNCH WINDOW ${win}`; E['cd-v'].textContent = `T-${sec}`;
    },
    ignition() {
      const c = E.countdown; E['cd-v'].textContent = 'T-0'; c.classList.add('go', 'on');
      cancel(this.cdT); this.cdT = later(() => c.classList.remove('on', 'go'), 1500);
    },
    title(word, sub) {
      if (this.titleBusy) return; this.titleBusy = true; root.classList.add('ev-on');
      const t = E['ev-title'], s = E['ev-sub'];
      t.className = 'ev-title'; t.innerHTML = word.split('').map((ch, i) => `<span style="animation-delay:${i * 42}ms">${esc(ch)}</span>`).join('');
      t.setAttribute('aria-label', word);
      void t.offsetWidth; t.classList.add(REDUCED ? 'still' : 'play');
      s.textContent = sub;
      this.titleT = [
        later(() => s.classList.add('on'), REDUCED ? 0 : 700),
        later(() => { t.classList.add('out'); s.classList.remove('on'); }, 3600),
        later(() => this.titleReset(), 4300)
      ];
    },
    titleReset() {
      this.titleT.forEach(cancel); this.titleT = [];
      E['ev-title'].innerHTML = ''; E['ev-title'].className = 'ev-title'; E['ev-sub'].classList.remove('on'); E['ev-sub'].textContent = '';
      this.titleBusy = false; root.classList.remove('ev-on');
    },
    gold(m, text, sub, dur) {
      const el = document.createElement('div'); el.className = 'gfloat'; el.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
      E.floats.appendChild(el); this.floats.push({ el, m, t: 0, dur });
    },
    frame(dt, now) {
      this.stats();
      if (now - this.lastCards > 0.3) { this.lastCards = now; this.renderCards(); if (!GL) this.board(); }
      if (this.panelId != null && now - this.lastPanel > 0.25) { this.lastPanel = now; this.fillPanel(); }
      const zones = [];
      if (this.floats.length) {
        rootRect();
        const hero = heroEl();
        if (hero) hero.querySelectorAll('.eyebrow, h1, .lede, .lede-short, .cta').forEach((el) => { const r = relRect(el); if (r.width) zones.push({ left: r.left - 12, top: r.top - 10, right: r.right + 12, bottom: r.bottom + 10 }); });
        if (E.countdown.classList.contains('on')) { const r = relRect(E.countdown); zones.push({ left: r.left - 8, top: r.top - 8, right: r.right + 8, bottom: r.bottom + 8 }); }
      }
      for (let i = this.floats.length - 1; i >= 0; i--) {
        const f = this.floats[i]; f.t += dt;
        const k = f.t / f.dur;
        if (k >= 1) { f.el.remove(); this.floats.splice(i, 1); continue; }
        let x = VW / 2, y = VH * 0.55;
        const s = GL && GL.ships.get(f.m.id);
        if (s) { toScreen(s.pos, SCR); x = SCR.x; y = SCR.y; }
        const rise = (REDUCED ? 0 : easeOut3(k)) * (isPhone() ? 64 : 104);
        let fy = y - 36 - rise;
        if (this.titleBusy) { const tr = relRect(E.event); if (fy < tr.bottom + 16 && fy > tr.top - 40) fy = tr.bottom + 22; }
        x = clamp(x, 150, VW - 150);
        /* The hero's words and buttons and the countdown are no-go zones: a desk moves the plate to their right, a phone
           below them. */
        const w = f.el.offsetWidth, h = f.el.offsetHeight;
        for (const z of zones) {
          if (x + w / 2 < z.left || x - w / 2 > z.right || fy + h < z.top || fy > z.bottom) continue;
          if (!isPhone() && z.right + 16 + w <= VW - 8) x = z.right + 16 + w / 2;
          else fy = z.bottom + 12;
        }
        f.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(fy)}px) translateX(-50%)`;
        f.el.style.opacity = String(k < 0.1 ? k / 0.1 : k > 0.75 ? (1 - k) / 0.25 : 1);
      }
    },
    board() {
      let rows;
      if (mode === 'demo') {
        rows = missions.filter((m) => !m.gone && m.state !== 'star').map((m) => {
          const mc = m.state === 'orbit' ? m.orbitMc : mcapAt(m.alt);
          const pct = m.state === 'orbit' ? 100 : m.alt;
          return `<div class="row"><b>${m.ticker}</b><span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span><span>${m.state === 'orbit' ? 'ORBIT D' + Math.floor(m.day) : m.state === 'pad' ? 'READY' : fmtAlt(m.alt)}</span><span>${fmtX(mc / MC0)}</span></div>`;
        }).join('');
      } else if (!gotSnap) rows = '<div class="row none">Reading the chain…</div>';
      else if (!missions.length) rows = '<div class="row none">No missions in flight right now</div>';
      else {
        rows = missions.map((m) => {
          const pct = m.state === 'ascent' || m.state === 'pad' ? (m.altKnown ? m.alt : 0) : 100;
          const status = m.state === 'ascent' ? altTxt(m) : m.state === 'orbit' ? 'ORBIT' + (m.dayN != null ? ' D' + Math.floor(m.day) : '') : m.state === 'lost' ? 'LOST' : m.state === 'star' ? 'DAY 90' : 'READY';
          const last = m.since != null ? fmtX(m.since) : holdersTxt(m);
          return `<div class="row"${m.ryntraTest ? ` title="${esc(TEST_TITLE)}"` : ''}><b>${esc(m.ticker)}</b><span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span><span>${status}</span><span>${esc(last)}</span></div>`;
        }).join('');
      }
      if (this._board !== rows) { E['board-rows'].innerHTML = rows; this._board = rows; }
    }
  };

  /* ---------- the marks that say where the numbers come from ---------- */
  let marksKey = '', statsMode = '';
  function renderMarks() {
    const key = mode + '|' + (gotSnap ? 1 : 0) + '|' + network;
    if (key === marksKey) return; marksKey = key;
    const pill = E.pill;
    if (mode === 'demo') { pill.className = 'pill'; pill.title = 'All activity on this page is simulated'; E['pill-t'].textContent = 'DEMO'; }
    else if (!gotSnap) { pill.className = 'pill reading'; pill.title = 'Reading the chain…'; E['pill-t'].textContent = 'READING THE CHAIN'; }
    else { pill.className = 'pill live'; pill.title = 'Every number here is read from the chain'; E['pill-t'].textContent = network === 'devnet' ? 'LIVE · DEVNET' : 'LIVE · SOLANA'; }
    if (statsMode !== mode) { statsMode = mode; hud.statsSkeleton(); }
    E['feed-src'].textContent = mode === 'demo' ? 'DEMO' : 'ON-CHAIN';
    E.demo.hidden = mode !== 'demo';
    E['p-demo'].hidden = mode !== 'demo';
    E['board-p'].textContent = mode === 'demo' ? 'Same simulated missions, numbers and buttons. DEMO · no real tokens.' : 'Same missions and numbers, read from the chain.';
    E.replays.innerHTML = mode === 'demo'
      ? `<button type="button" class="btn ghost replay" data-a="replay" aria-label="Replay orbit insertion">${ICON_REPLAY}<span class="long">Replay orbit insertion</span><span class="short">Replay</span></button><button type="button" class="btn ghost replay" data-a="live" aria-label="Back to live"><span class="long">Back to live</span><span class="short">Live</span></button>`
      : `<button type="button" class="btn ghost replay" data-a="demo">${ICON_PLAY}Watch the demo</button>`;
    E['p-actions']._k = null;
    hud._board = null;
    hud.stats(true);
  }

  /* ---------- DEMO flight log (the concept's words) ---------- */
  function bindHudEvents() {
    const D = () => mode === 'demo' && demo;
    on('buy', ({ m, usd, alt }) => { if (!D()) return; hud.log(m.ticker, `buy <em class="up" style="font-style:normal">$${usd}</em> · altitude ${fmtAlt(alt)}`); sfx.tick(usd > 300); });
    on('sell', ({ m, usd, alt }) => { if (!D()) return; hud.log(m.ticker, `sell <em class="down" style="font-style:normal">$${usd}</em> · altitude ${fmtAlt(alt)}`); });
    on('booster', ({ m, n }) => { if (!D()) return; hud.log(m.ticker, `passes ${n * 25}% · booster ring ${n}`, 'sys'); });
    on('countdown', ({ sec, win }) => { if (!D()) return; hud.countdown(sec, win); if (sec === 5) { const n = missions.filter((x) => x.state === 'pad' && !x.gone).length; hud.log('WINDOW', `${win} · T-5 · ${n} mission${n === 1 ? '' : 's'} on pads`, 'sys'); } });
    on('window', ({ win, count }) => { if (!D()) return; demo.sim.lastWinT = demo.sim.t; hud.ignition(); hud.log('WINDOW', `${win} · T-0 · ${count} mission${count === 1 ? '' : 's'} ${count === 1 ? 'ignites' : 'ignite'}`, 'sys', true); });
    on('ignite', ({ m }) => { if (!D()) return; hud.log(m.ticker, `liftoff · crew of ${m.crewSize}`); });
    on('approach', ({ m }) => { if (!D()) return; hud.log(m.ticker, `final approach · altitude ${fmtAlt(m.alt)}`, 'sys', true); });
    on('orbit', ({ m, payout, central }) => {
      if (!D()) return;
      hud.log(m.ticker, `ORBIT · +${fmt2(payout)} to the creator`, 'ev', true);
      if (central || !GL) hud.title('ORBIT', `${m.ticker} · LAUNCH ONCE. STAY IN ORBIT.`);
      hud.gold(m, `+${fmt2(payout)} to the creator`, 'GRADUATION FEE SHARE', 2.6);
    });
    on('pool', ({ m }) => { if (!D()) return; hud.log(m.ticker, 'pool live · Meteora DAMM v2', 'sys'); });
    on('check', ({ m, day }) => { if (!D()) return; hud.log(m.ticker, day === 90 ? 'Day 90 check passed · becomes a star' : `Day ${day} check passed`, day === 90 ? 'ev' : 'sys', day === 90); });
    on('starborn', ({ m }) => { if (!D()) return; hud.log(m.ticker, `joins Deep Space · crew of ${m.crewSize}`, 'ev'); });
    on('lost', ({ m, reason }) => { if (!D()) return; hud.log(m.ticker, `Signal lost · ${reason}`, 'lost', true); });
    on('fee', ({ m, usd }) => { if (!D()) return; hud.log(m.ticker, `creator fee · <span class="gold">+${fmt2(usd)}</span>`); hud.gold(m, `+${fmt2(usd)}`, '', 1.6); });
    on('rollout', ({ m, win }) => { if (!D()) return; hud.log(m.ticker, `on pad ${m.pad + 1} · crew of ${m.crewSize} · window ${win}`, 'sys'); });
    on('replay', () => { if (!D()) return; hud.log('REPLAY', 'orbit insertion · window ' + demo.stats.win, 'sys', true); });
  }

  /* =====================================================================
     LIVE — snapshots and events from the chain
     ===================================================================== */
  const PATHISH = new Set(['pad', 'liftoff', 'ascent']);
  function liveShip(m) {
    if (!GL || m.state === 'star') return null;
    const have = GL.ships.get(m.id); if (have) return have;
    if (m.state !== 'orbit' && !(m.state === 'lost' && m.alt >= 100) && !m.path) assignPath(m);
    const s = makeShip(m);
    if (m.state === 'lost') {
      if (m.alt < 100) { s.mode = 'lostpath'; s.dispAlt = m.alt; s.t = 2.5; } else { s.mode = 'lost'; s.t = 7.5; }
      s.dim = 1; placeShip(s, 0); s.g.position.copy(s.pos);
    }
    return s;
  }
  function refreshShip(s, m) {
    addBoostersTo(s, orbitish(m) ? 3 : Math.floor(m.alt / 25), false);
    for (let k = 0; k < 3; k++) if (m.ck[k]) addDayRing(s, k, false);
    if (m.state === 'orbit') addWings(s, false);
  }
  // a phase that changed without its event: move the ship there quietly
  function placeQuiet(m) {
    if (!GL) return;
    const s = GL.ships.get(m.id);
    if (m.state === 'star') { if (s && s.mode !== 'star') removeShip(s); return; }
    if (!s) { liveShip(m); return; }
    const md = s.mode;
    if (m.state === 'ascent' || m.state === 'pad') {
      if (PATHISH.has(md)) { if (md === 'pad' && m.state === 'ascent') s.mode = 'ascent'; refreshShip(s, m); return; }
    } else if (m.state === 'orbit') {
      if (md === 'orbit' || md === 'insert') { refreshShip(s, m); return; }
      if (PATHISH.has(md)) { s.mode = 'orbit'; s.phi = m.path ? m.path.phiT : m.phi; m.phi = s.phi; s.t = 0; refreshShip(s, m); return; }
    } else if (m.state === 'lost') {
      if (md === 'lost' || md === 'lostpath') { refreshShip(s, m); return; }
      if (PATHISH.has(md)) { s.mode = 'lostpath'; s.t = 2.5; refreshShip(s, m); return; }
      if (md === 'orbit' || md === 'insert') { s.mode = 'lost'; s.t = 7.5; refreshShip(s, m); return; }
    }
    removeShip(s); liveShip(m);
  }
  function applyLive(snap) {
    gotSnap = true;
    network = snap.network === 'devnet' || snap.network === 'mainnet' ? snap.network : null;
    const list = Array.isArray(snap.missions) ? snap.missions : [];
    const want = new Map();
    list.forEach((sm) => { if (sm && typeof sm.id === 'string' && !want.has(sm.id)) want.set(sm.id, sm); });
    const keepList = [];
    missions.forEach((m) => {
      if (want.has(m.id)) { keepList.push(m); return; }
      if (GL) { const s = GL.ships.get(m.id); if (s) removeShip(s); if (GL.gap && GL.gap.id === m.id) GL.gap = null; }
      if (hud.panelId === m.id || camState.focusId === m.id) backToSky(false);
    });
    missions = keepList;
    const byId = new Map(missions.map((m) => [m.id, m]));
    want.forEach((sm, id) => {
      let m = byId.get(id);
      if (!m) { m = liveMission(sm); missions.push(m); placeQuiet(m); return; }
      const prev = m.state;
      updateLive(m, sm);
      if (prev !== m.state || (GL && !GL.ships.has(m.id) && m.state !== 'star')) placeQuiet(m);
      else if (GL) { const s = GL.ships.get(m.id); if (s) refreshShip(s, m); }
    });
    extraStars = clamp(Math.floor(num(snap.stars) ? snap.stars : 0), 0, STAR_CAP);
    syncStars();
    renderMarks();
    hud.renderCards(); hud.stats(true);
    if (hud.panelId != null) hud.fillPanel();
    if (!GL) hud.board();
  }
  function liveLine(ev, m) {
    const tk = m.ticker; let label = tk, html = '', cls = '', imp = false;
    const href = typeof ev.signature === 'string' && ev.signature ? txUrl(ev.signature) : null;
    const buy = ev.type === 'buy';
    switch (ev.type) {
      case 'ignite': label = 'LAUNCH'; html = `${esc(tk)} lifted off`; imp = true; break;
      case 'buy': case 'sell': {
        const head = (buy ? 'buy' : 'sell') + (num(ev.usd) ? ` <em class="${buy ? 'up' : 'down'}" style="font-style:normal">${fmtUsd(Math.abs(ev.usd))}</em>` : '');
        html = head + (num(ev.altitude) ? ' · altitude ' + fmtAlt(clamp(ev.altitude, 0, 100)) : '');
        break;
      }
      case 'booster': html = `passes ${clamp(ev.n | 0, 1, 3) * 25}% · booster ring ${clamp(ev.n | 0, 1, 3)}`; cls = 'sys'; break;
      case 'orbit': html = 'ORBIT · DAMM v2 pool open' + (num(ev.payoutUsd) ? ` · <span class="gold">+${fmt2(ev.payoutUsd)}</span> to the creator`: ''); cls = 'ev'; imp = true; break;
      case 'check': html = `passed Day ${ev.day}`; cls = ev.day === 90 ? 'ev' : 'sys'; imp = ev.day === 90; break;
      case 'lost': html = `signal lost at Day ${ev.day}` + (typeof ev.reason === 'string' && ev.reason ? ` · ${esc(ev.reason)}` : ''); cls = 'lost'; imp = true; break;
      case 'star': html = 'Day 90 · becomes a star'; cls = 'ev'; imp = true; break;
      default: return;
    }
    if (ev.quiet === true) imp = false;
    liveLog.push({ tk: label, html, cls, href }); while (liveLog.length > 12) liveLog.shift();
    hud.log(label, html, cls, imp, href);
  }
  function liveStarborn(m) {
    if (mode !== 'live' || !missions.includes(m) || m.state !== 'star') return;
    const s = shipOf(m); if (s) removeShip(s);
    m.bornPending = true;
    syncStars();
    if (camState.focusId === m.id) backToSky(false);
  }
  function liveEvent(ev, m) {
    const quiet = ev.quiet === true;
    const fx = !quiet && !!GL;
    switch (ev.type) {
      case 'ignite':
        if (m.state === 'pad') m.state = 'ascent';
        if (fx && m.state === 'ascent') { liveShip(m); fire('ignite', { m }); }
        break;
      case 'buy': case 'sell': {
        if (num(ev.altitude)) { m.alt = clamp(ev.altitude, 0, 100); m.altKnown = true; }
        const s = shipOf(m);
        if (m.state === 'ascent' && s) {
          if (fx) fire(ev.type, { m, usd: num(ev.usd) ? Math.abs(ev.usd) : 120 });
          addBoostersTo(s, Math.floor(m.alt / 25), fx);
        }
        if (!quiet && ev.type === 'buy') sfx.tick(num(ev.usd) && ev.usd > 300);
        break;
      }
      case 'booster': {
        const n = clamp(ev.n | 0, 1, 3); const s = shipOf(m);
        if (s && m.state === 'ascent') { if (fx) fire('booster', { m, n }); else addBoostersTo(s, n, false); }
        break;
      }
      case 'orbit': {
        const before = m.state;
        m.state = 'orbit'; m.alt = 100; m.altKnown = true;
        if (fx && (before === 'ascent' || before === 'pad')) {
          const s = shipOf(m) || liveShip(m);
          if (s) { if (!m.path) assignPath(m); addBoostersTo(s, 3, true); if (s.mode === 'pad' || s.mode === 'liftoff') s.mode = 'ascent'; fire('orbit', { m }); }
        } else placeQuiet(m);
        if (!quiet) {
          hud.title('ORBIT', `${m.ticker} reached orbit · DAMM v2 pool open` + (num(ev.payoutUsd) ? ` · +${fmt2(ev.payoutUsd)} to the creator` : ''));
          if (num(ev.payoutUsd)) hud.gold(m, `+${fmt2(ev.payoutUsd)} to the creator`, '', 2.6);
        }
        break;
      }
      case 'check': {
        const k = CHECK_IX[ev.day]; if (k == null) break;
        m.ck[k] = true; m.cks[k] = 'alive';
        const s = shipOf(m);
        if (s) { if (fx) fire('check', { m, day: ev.day }); else addDayRing(s, k, false); }
        break;
      }
      case 'lost': {
        const k = CHECK_IX[ev.day];
        if (k != null) { m.cks[k] = 'quiet'; m.ck[k] = false; m.lostDay = ev.day; }
        m.state = 'lost';
        const s = shipOf(m);
        if (fx && s) {
          if (PATHISH.has(s.mode) || s.mode === 'lostpath') s.mode = 'lostpath'; else s.mode = 'lost';
          s.t = 0; s.flagUntil = GL.time + 7.5;
        } else placeQuiet(m);
        break;
      }
      case 'star': {
        m.state = 'star'; m.ck[2] = true; m.cks[2] = 'alive'; m.alt = 100;
        const s = shipOf(m);
        if (fx && s) { fire('star', { m }); later(() => liveStarborn(m), 4600); }
        else { placeQuiet(m); syncStars(); }
        break;
      }
      default: return;
    }
    liveLine(ev, m);
    hud.renderCards(); hud.stats();
    if (hud.panelId === m.id) hud.fillPanel();
    if (!GL) hud.board();
  }

  /* =====================================================================
     Switching shows: clear everything one source drew before the other draws
     ===================================================================== */
  function clearScene() {
    if (hud.panelId != null) hud.closePanel();
    cancel(camState.t1); cancel(camState.t2);
    if (GL) {
      [...GL.ships.values()].forEach(removeShip);
      GL.named.forEach(disposeNamed); GL.named = [];
      GL.streams = []; GL.gap = null; GL.pulse = null; GL.ringWave = null;
      GL.ringMat.uniforms.uPulseT.value = 0; GL.ringMat.uniforms.uWaveT.value = 0;
      [GL.pings, GL.flashes].forEach((pool) => pool.forEach((p) => { p.live = false; p.s.visible = false; }));
      GL.waves.forEach((w) => { w.live = false; w.mesh.visible = false; });
      GL.flareU.forEach((f) => { f.w = 0; });
      GL.P.A.aBirth.array.fill(-1e4); GL.P.wrap = true; GL.P.hi = GL.P.max - 1; flushP();
      showTip(null);
      camState.focusId = null; camState.eventCam = false; camState.userLocked = false;
      flyTo('home', 1.2);
    }
    clearLabels();
    hud.cards.forEach((el) => el.remove()); hud.cards.clear();
    hud.floats.forEach((f) => f.el.remove()); hud.floats = [];
    hud.clearFeed();
    hud.titleReset();
    cancel(hud.cdT); E.countdown.classList.remove('on', 'go');
    missions = [];
  }
  function restoreLiveLog() {
    hud.clearFeed();
    liveLog.forEach((l) => hud.log(l.tk, l.html, l.cls, false, l.href));
    hud.feedEmpty();
  }
  function startDemo() {
    clearScene();
    mode = 'demo';
    demo = createDemo();
    if (GL) {
      missions.forEach((m) => { if (!m.gone && (m.state === 'ascent' || m.state === 'pad' || m.state === 'orbit')) { if (m.state === 'ascent') assignPath(m); makeShip(m); } });
      demo.DEEP.forEach((d, i) => makeNamedStar(d, i, false, 'd:' + i));
    }
    renderMarks();
    hud.renderCards(); hud.stats(true);
    hud.log('RYNTRA', 'Mission Control · DEMO · simulated flights', 'sys');
    notify('onSource', 'demo');
  }
  function endDemo() {
    clearScene();
    mode = 'live'; demo = null;
    renderMarks();
    restoreLiveLog();
    if (liveSnap) applyLive(liveSnap); else { hud.renderCards(); hud.stats(true); }
    notify('onSource', 'live');
  }
  function replay() {
    if (mode !== 'demo' || !demo) return;
    cancel(camState.t1); cancel(camState.t2);
    if (hud.panelId != null) backToSky(false);
    camState.userLocked = false;
    demo.sim.replay();
  }

  /* =====================================================================
     Quality tiers, post-processing, input, main loop
     ===================================================================== */
  function disposeComposer() {
    if (!GL || !GL.composer) return;
    try { GL.composer.dispose(); } catch (_e) { GL.composer.renderTarget1.dispose(); GL.composer.renderTarget2.dispose(); }
    try { GL.bloom.dispose(); } catch (_e) { /* r147 has it */ }
    try { GL.fin.dispose(); } catch (_e) { /* r147 has it */ }
    GL.composer = null; GL.bloom = null; GL.fin = null;
  }
  function applyTier(tier) {
    GL.tier = tier;
    GL.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PR_BY_TIER[tier], MAX_PR));
    GL.renderer.setSize(VW, VH, false);
    disposeComposer();
    if (tier !== 'low') {
      const size = GL.renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { samples: tier === 'high' && GL.renderer.capabilities.isWebGL2 ? 4 : 0 });
      const comp = new EffectComposer(GL.renderer, rt);
      comp.setPixelRatio(GL.renderer.getPixelRatio()); comp.setSize(VW, VH);
      comp.addPass(new RenderPass(GL.scene, GL.camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(VW, VH), 1.0, 0.6, 0.6);
      if (tier === 'medium') { const ss = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => ss(Math.max(2, Math.round(w / 2)), Math.max(2, Math.round(h / 2))); comp.setSize(VW, VH); }
      comp.addPass(bloom);
      const fin = new ShaderPass(FINAL_SHADER); comp.addPass(fin);
      GL.composer = comp; GL.bloom = bloom; GL.fin = fin;
    }
    GL.starMat.uniforms.uPR.value = GL.renderer.getPixelRatio();
  }
  function onResize() {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    VW = w; VH = h; _fcs.w = -1; rootRect();
    if (!GL) return;
    GL.camera.aspect = VW / VH;
    GL.renderer.setSize(VW, VH, false);
    if (GL.composer) GL.composer.setSize(VW, VH);
    GL.camera.updateProjectionMatrix();
  }

  /* ---------- picking ---------- */
  function pickShip(x, y) {
    let best = null, bd = PHONE_START ? 42 : 30;
    GL.ships.forEach((s) => {
      if (s.mode === 'lost' || s.mode === 'lostpath' || s.mode === 'star') return;
      toScreen(s.pos, SCR); if (SCR.z > 1 || occluded(s.pos)) return;
      const d = Math.hypot(SCR.x - x, SCR.y - y); if (d < bd) { bd = d; best = s; }
    });
    return best;
  }
  function pickStar(x, y) {
    let best = null, bd = PHONE_START ? 34 : 26;
    GL.named.forEach((st) => { toScreen(st.pos, SCR); if (SCR.z > 1) return; const d = Math.hypot(SCR.x - x, SCR.y - y); if (d < bd) { bd = d; best = st; } });
    return best;
  }
  function showTip(st) {
    const tip = E.tip;
    if (!st || !GL) { tip.hidden = true; if (GL) GL.hoverStar = null; return; }
    GL.hoverStar = st;
    const d = st.d;
    /* MC-3: a live star names its crew as the sky does — the creator and the vault's rows by short address. */
    const names = Array.isArray(d.names) && d.names.length ? d.names.slice(0, 5).map(esc).join(' · ') : '';
    const html = d.ticker
      ? `<b>${esc(d.ticker)}</b><span>Day 90${names ? ' · ' + (d.crew > 1 ? 'crew ' : 'creator ') + names : d.crew ? ' · crew of ' + d.crew : ''}</span><i>DEEP SPACE · SURVIVED THE COURSE</i>`
      : '<b>DAY 90 STAR</b><i>DEEP SPACE · SURVIVED THE COURSE</i>';
    if (tip._h !== html) { tip.innerHTML = html; tip._h = html; }
    toScreen(st.pos, SCR);
    tip.hidden = false;
    const w = tip.offsetWidth || 180;
    const x = clamp(SCR.x + 18, 12, VW - w - 12), y = clamp(SCR.y - 18, 70, VH - 80);
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  let tipT = null;
  function bindInput() {
    let down = null;
    const local = (e) => { rootRect(); return { x: e.clientX - RR.left, y: e.clientY - RR.top }; };
    listen(canvas, 'pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    listen(canvas, 'pointerup', (e) => {
      if (!down || !GL) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); const dt = performance.now() - down.t; down = null;
      if (moved > 10 || dt > 700) return;
      const p = local(e);
      const s = pickShip(p.x, p.y);
      if (s) { showTip(null); focusMission(s.m, true); return; }
      const st = pickStar(p.x, p.y);
      if (st) {
        if (st.d.m && missions.includes(st.d.m)) { showTip(null); focusMission(st.d.m, true); return; }
        showTip(st); cancel(tipT); tipT = later(() => showTip(null), 2800); return;
      }
      showTip(null);
    });
    listen(canvas, 'pointermove', (e) => {
      if (!GL || e.pointerType !== 'mouse') return;
      const p = local(e);
      camState.px = (p.x / VW - 0.5) * 2; camState.py = (p.y / VH - 0.5) * 2;
      const st = pickStar(p.x, p.y); showTip(st);
      canvas.style.cursor = st || pickShip(p.x, p.y) ? 'pointer' : 'default';
    });
    listen(canvas, 'pointerleave', () => { if (GL) showTip(null); });
    listen(canvas, 'webglcontextlost', (e) => { e.preventDefault(); toFallback(); });
    listen(window, 'keydown', (e) => { if (e.key === 'Escape' && hud.panelId != null) backToSky(true); });
    listen(E.back, 'click', () => backToSky(true));
    listen(E.sound, 'click', () => sfx.toggle());
    listen(E.strip, 'click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('.card') : null; if (!el) return;
      const m = missions.find((x) => x.id === el.dataset.id); if (m) focusMission(m, true);
    });
    listen(E['p-actions'], 'click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-a="demo"]') : null;
      if (b && mode === 'demo') hud.toast('Demo: no real trades');
    });
    listen(E.replays, 'click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-a]') : null; if (!b) return;
      const a = b.getAttribute('data-a');
      if (a === 'demo') startDemo(); else if (a === 'replay') replay(); else if (a === 'live') endDemo();
    });
  }

  /* ---------- main loop ---------- */
  const probe = { t: 0, n: 0, from: 0, done: TIER_ORDER.includes(QUALITY), rounds: 0 };
  let lastT = 0, clock = 0, raf = 0;
  const _dbs = new THREE.Vector2();
  function renderGL(dt, raw) {
    GL.time += dt; const t = GL.time;
    /* Reduced motion: the stars stop twinkling and the film grain holds still — nothing on screen flickers. */
    GL.starMat.uniforms.uTime.value = REDUCED ? 0 : t; GL.planetMat.uniforms.uTime.value = t; GL.ringMat.uniforms.uTime.value = t;
    GL.flameMat.uniforms.uTime.value = t; GL.pMat.uniforms.uTime.value = t;
    GL.flareU.forEach((f) => { f.w = Math.max(0, f.w - dt * 0.55); });
    if (GL.pulse) { GL.pulse.t += dt / 2.4; GL.ringMat.uniforms.uPulseU.value = GL.pulse.u; GL.ringMat.uniforms.uPulseT.value = Math.min(1, GL.pulse.t); if (GL.pulse.t >= 1) { GL.pulse = null; GL.ringMat.uniforms.uPulseT.value = 0; } }
    if (GL.ringWave) { GL.ringWave.t += dt / 1.6; GL.ringMat.uniforms.uWaveU.value = GL.ringWave.u; GL.ringMat.uniforms.uWaveT.value = Math.min(1, GL.ringWave.t); if (GL.ringWave.t >= 1) { GL.ringWave = null; GL.ringMat.uniforms.uWaveT.value = 0; } }
    GL.ships.forEach((s) => updateShip(s, dt));
    updateStreams(dt); updateFX(dt); flushP();
    updateCamera(dt, t);
    GL.pMat.uniforms.uScale.value = GL.renderer.getDrawingBufferSize(_dbs).y / (2 * Math.tan(THREE.MathUtils.degToRad(GL.camera.fov) / 2));
    updateNamed(dt, t); updateFlares();
    const sunS = 1 + Math.sin(t * 0.8) * 0.015; GL.sunCore.scale.set(230 * sunS, 230 * sunS, 1);
    if (GL.fin) GL.fin.uniforms.uTime.value = REDUCED ? 0 : t;
    if (GL.composer) GL.composer.render(); else GL.renderer.render(GL.scene, GL.camera);
    updateLabels(t);
    if (GL.hoverStar && !E.tip.hidden) showTip(GL.hoverStar);
    // FPS probe → quality tier (floor: options.minFps)
    if (!probe.done && t > (probe.from || (REDUCED ? 1.5 : 3.2)) && raw < 0.25) {
      probe.t += raw; probe.n++;
      if (probe.t >= 2) {
        const fps = probe.n / probe.t;
        const i = TIER_ORDER.indexOf(GL.tier);
        if (fps < MIN_FPS && i < TIER_ORDER.length - 1) { applyTier(TIER_ORDER[i + 1]); probe.rounds++; probe.t = 0; probe.n = 0; probe.from = t + 1; if (probe.rounds >= 2) probe.done = true; }
        else probe.done = true;
        notify('onQuality', GL.tier, Math.round(fps));
      }
    }
  }
  let onScreen = true;
  let io = null;
  function frame(nowMs) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const raw = (nowMs - lastT) / 1000; lastT = nowMs;
    const dt = Math.min(0.05, Math.max(0, raw));
    clock += dt;
    /* Out of view (the home page scrolled to its sections) the sky stops: nothing drawn, and the demo waits instead of
       playing beats nobody sees. */
    if (!onScreen) return;
    if (mode === 'demo' && demo) demo.sim.update(dt);
    if (GL) { try { renderGL(dt, raw); } catch (_e) { toFallback(); } }
    hud.frame(dt, clock);
  }

  function disposeGL() {
    const W = GL; if (!W) return;
    GL = null;
    try { if (W.composer) { try { W.composer.dispose(); } catch (_e) { /* ignore */ } try { W.bloom.dispose(); } catch (_e) { /* ignore */ } try { W.fin.dispose(); } catch (_e) { /* ignore */ } } } catch (_e) { /* ignore */ }
    const geos = new Set(), mats = new Set(), texs = new Set();
    try {
      W.scene.traverse((o) => {
        if (o.geometry) geos.add(o.geometry);
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => mats.add(mt));
      });
      if (W.SG) Object.keys(W.SG).forEach((k) => { const g = W.SG[k]; if (g && g.isBufferGeometry) geos.add(g); else if (g) Object.values(g).forEach((x) => x && x.isBufferGeometry && geos.add(x)); });
      [W.metal, W.flameMat, W.solarMat].forEach((mt) => mt && mats.add(mt));
      mats.forEach((mt) => {
        Object.keys(mt).forEach((k) => { const v = mt[k]; if (v && v.isTexture) texs.add(v); });
        if (mt.uniforms) Object.values(mt.uniforms).forEach((u) => { if (u && u.value && u.value.isTexture) texs.add(u.value); });
        mt.dispose();
      });
      if (W.T) Object.values(W.T).forEach((tx) => tx && texs.add(tx));
      texs.forEach((tx) => tx.dispose());
      geos.forEach((g) => g.dispose());
    } catch (_e) { /* best effort */ }
    try { W.renderer.renderLists.dispose(); } catch (_e) { /* ignore */ }
    try { W.renderer.dispose(); } catch (_e) { /* ignore */ }
    try { W.renderer.forceContextLoss(); } catch (_e) { /* ignore */ }
  }
  function enterFallback() {
    root.classList.add('no-gl');
    E.board.hidden = false; canvas.style.display = 'none';
    E.tip.hidden = true;
  }
  let fellBack = false;
  function toFallback() {
    if (fellBack || disposed) return; fellBack = true;
    clearLabels();
    disposeGL();
    enterFallback();
    hud._board = null; hud.board();
    notify('onRenderer', '2d');
  }

  /* ---------- boot ---------- */
  bindHudEvents();
  bindSceneEvents();
  let ok = webglOK();
  if (ok) {
    try {
      const tier = TIER_ORDER.includes(QUALITY) ? QUALITY : PHONE_START ? 'medium' : 'high';
      buildWorld(tier);
      initFX(GL); poseInit();
      applyTier(tier);
      GL.camera.aspect = VW / VH;
      startIntro();
      updateCamera(0, 0);
    } catch (_e) {
      ok = false;
      disposeGL();
    }
  }
  if (!ok) { fellBack = true; enterFallback(); }
  bindInput();
  let ro = null;
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => onResize()); ro.observe(root); } else listen(window, 'resize', onResize);
  if (typeof IntersectionObserver === 'function') { io = new IntersectionObserver((entries) => { onScreen = entries.some((e) => e.isIntersecting); }); io.observe(root); }
  renderMarks();
  hud.renderCards();
  hud.feedEmpty();
  sfx.ui();
  if (!ok) hud.board();
  notify('onRenderer', ok ? 'webgl' : '2d');
  notify('onSource', 'live');
  if (ok && GL) notify('onQuality', GL.tier, 0);
  raf = requestAnimationFrame((t) => { lastT = t; frame(t); });

  /* ---------- the launch windows (MC-2): T-10 … T-1, the opening, the closing with its count from the chain ---------- */
  function liveWindow(ev) {
    const clock = esc(ev.clock);
    if (ev.type === 'countdown') {
      const sec = clamp(ev.sec | 0, 1, 10);
      hud.countdown(sec, clock);
      if (sec === 10) hud.log('WINDOW', `${clock} · T-10`, 'sys');
      return;
    }
    if (ev.state === 'open') { hud.ignition(); hud.log('WINDOW', `${clock} · open · equal start: every curve opens with its anti-sniper fee`, 'sys', true); return; }
    const n = Math.max(0, ev.count | 0);
    hud.log('WINDOW', `${clock} · closed · ${n} mission${n === 1 ? '' : 's'} lifted off in it`, 'sys');
  }

  /* ---------- the engine ---------- */
  return {
    setSnapshot(snapshot) {
      if (disposed || !snapshot || typeof snapshot !== 'object') return;
      liveSnap = snapshot;
      if (mode !== 'live') return;
      try { applyLive(snapshot); } catch (_e) { /* a malformed snapshot never takes the scene down */ }
    },
    emit(event) {
      /* MC-2: the launch windows' beats come from the published schedule, not a mission — the countdown and the log. */
      if (!disposed && mode === 'live' && event && (event.type === 'countdown' || event.type === 'window') && typeof event.clock === 'string') {
        try { liveWindow(event); } catch (_e) { /* keep the scene running */ }
        return;
      }
      if (disposed || mode !== 'live' || !event || !LIVE_TYPES.has(event.type) || typeof event.id !== 'string') return;
      const m = missions.find((x) => x.id === event.id); if (!m) return;
      try { liveEvent(event, m); } catch (_e) { /* keep the scene running */ }
    },
    select(id) {
      if (disposed) return;
      if (id == null) { if (hud.panelId != null || camState.focusId != null) backToSky(false); return; }
      const m = missions.find((x) => x.id === id); if (m) focusMission(m, false);
    },
    playDemo() { if (!disposed) startDemo(); },
    stopDemo() { if (!disposed && mode === 'demo') endDemo(); },
    setSound(v) { if (!disposed) sfx.set(!!v); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      timers.forEach((id) => clearTimeout(id)); timers.clear();
      offs.forEach((off) => off()); offs.length = 0;
      if (ro) { ro.disconnect(); ro = null; }
      if (io) { io.disconnect(); io = null; }
      sfx.close();
      clearLabels();
      disposeGL();
      canvas.remove(); veil.remove(); hudEl.remove();
      root.classList.remove('mc-orbit', 'reduced', 'no-gl', 'ev-on', 'panel-open');
      missions = []; demo = null;
    }
  };
}

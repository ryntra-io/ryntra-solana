// Run from repo root: node --test --test-isolation=none lib/design-debt.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const admin = readFileSync(new URL("../app/admin/panel.tsx", import.meta.url), "utf8");
const adminOps = readFileSync(new URL("../app/admin/operations/operations-panel.tsx", import.meta.url), "utf8");
const adminUsers = readFileSync(new URL("../app/admin/users/users-panel.tsx", import.meta.url), "utf8");
const adminSurface = admin + adminOps + adminUsers;
const demo = readFileSync(new URL("../app/demo/terminal.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../app/app/settings/settings-form.tsx", import.meta.url), "utf8");
const privacy = readFileSync(new URL("../app/legal/privacy/page.tsx", import.meta.url), "utf8");
const swap = readFileSync(new URL("../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/home-client.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const connectCopy = readFileSync(new URL("../app/app/copy.ts", import.meta.url), "utf8");
const connectFlow = readFileSync(new URL("../app/app/connect/connect-flow.tsx", import.meta.url), "utf8");
const beta = readFileSync(new URL("../app/beta/page.tsx", import.meta.url), "utf8");
const publicDemo = readFileSync(new URL("../app/demo/public-tour.tsx", import.meta.url), "utf8");
const workspaceTheme = readFileSync(new URL("../app/app/theme.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const landingCss = readFileSync(new URL("../app/landing/landing.css", import.meta.url), "utf8");
/* `/methodology` is gone — it was one of four public documents restating the
   same boundaries and now redirects into the Handbook. Its stylesheet and
   components went with it, so the assertions that were about *that page's*
   dark style are removed rather than retargeted: the Handbook is built on
   `site.css`, which has its own coverage in `app/site/site.test.mjs`. Only the
   translations survive, as data — see app/methodology/README.md. */
const tickerUrl = new URL("../app/robinhood/workspace/swap/market-ticker.tsx", import.meta.url);
const mobileTightUrl = new URL("../app/landing/mobile-tight.css", import.meta.url);

test("admin actions use accessible icons, action names, and busy names", () => {
  assert.match(adminSurface, /from "@phosphor-icons\/react"/);
  for (const icon of ["ArrowClockwise", "EnvelopeSimple", "Megaphone"]) {
    assert.ok(adminSurface.includes(icon), `missing icon: ${icon}`);
  }
  assert.match(adminOps, /aria-busy=\{busy\}/);
  assert.ok(adminOps.includes('"Перевіряю…"'), "busy state needs its own visible name");
  assert.ok(adminOps.includes('"Перевірити виконання"'));
  assert.match(adminUsers, /aria-label="Пряме повідомлення"/);
  assert.doesNotMatch(adminSurface, /⏳ Fill-check|📣|✉/);
  assert.doesNotMatch(adminSurface, /<(ArrowClockwise|EnvelopeSimple|Megaphone|Warning)(?![^>]*aria-hidden)[^>]*\/>/);
});

test("demo and settings use the fixed workbench accent; live-account failures settle with latest-address recovery", () => {
  for (const source of [demo, settings]) {
    assert.ok(!source.includes("const ACCENTS"));
    assert.ok(!source.includes("ryntra-demo-accent"));
    assert.ok(!source.includes('aria-label="Accent"'));
  }
  assert.doesNotMatch(css, /\.dm-acc(?:ents)?(?:\.|\s|\{)/);
  assert.doesNotMatch(privacy, /accent color/i);

  assert.match(demo, /createLatestAccountRequestGate/);
  assert.match(demo, /const currentAddressRef = useRef\(addr\)/);
  assert.match(demo, /fetch\(`\/api\/arcus\?kind=account&address=\$\{a\}`, \{ signal: ticket\.signal \}\)/);
  assert.ok((demo.match(/gate\.accepts\(ticket, currentAddressRef\.current\)/g) ?? []).length >= 4);
  assert.match(demo, /if \(!\/\^0x\[a-fA-F0-9\]\{40\}\$\/\.test\(a\)\) \{[\s\S]*setLoading\(false\);[\s\S]*return;/);
  assert.match(demo, /const nextAddress = addrIn\.trim\(\);[\s\S]*currentAddressRef\.current = nextAddress;[\s\S]*void load\(nextAddress\);/);
  assert.match(demo, /finally \{[\s\S]*if \(gate\.accepts\(ticket, currentAddressRef\.current\)\) setLoading\(false\)/);
  assert.match(demo, /requestGateRef\.current\?\.cancel\(\)/);

  assert.match(demo, /const \[lastLoadedAt, setLastLoadedAt\] = useState<number \| null>\(null\)/);
  assert.match(demo, /setLastLoadedAt\(Date\.now\(\)\)/);
  assert.match(demo, /className="dm-stale-state" role="status"/);
  assert.match(demo, /<time dateTime=\{new Date\(lastLoadedAt\)\.toISOString\(\)\}>/);
  assert.match(demo, /these values are stale until retry succeeds/);
  assert.match(css, /\.dm-stale-state\s*\{[\s\S]*var\(--warning-soft\)[\s\S]*var\(--warning\)/);

  assert.match(demo, /setInterval\(\(\) => void load\(addr, false\), 8000\)/);
  assert.match(demo, /className="dm-error-state" role="alert"/);
  assert.match(demo, /\{loading \? "Retrying…" : "Retry"\}/);
  assert.match(demo, /loading && addr \? <p className="dm-empty" role="status">Loading account data…<\/p>/);
  assert.match(demo, /Live execution · unavailable/);
  assert.match(demo, /className="dm-mode-boundary"/);
  assert.match(demo, /provider, legal, security, reliability, eligibility, release, and explicit human-authorization gates/);
  assert.match(demo, /Select market first|Waiting for price/);
  assert.doesNotMatch(demo, /Live trading · soon|ships after the beta validation gate|Live execution · after gate/);
});

test("connect setup and public information shells state exact boundaries accessibly", () => {
  assert.doesNotMatch(connectCopy, /LIVE-READY|live-ready|ships next/i);
  assert.match(connectCopy, /trade-key setup adds no execution path/i);
  assert.match(connectCopy, /wallet-signed Arcus spot RFQ is unchanged/i);
  assert.match(connectCopy, /provider, legal, security, reliability, eligibility, release, and explicit human-authorization gates/i);
  assert.match(connectFlow, />KEY ACTIVE</);
  // The legal links moved into the shared site footer with the rest of the
  // chrome, so /beta must mount that footer rather than carry its own nav.
  assert.match(beta, /<FrozenFooter/);
  assert.match(beta, /<PublicHeader/);
  assert.doesNotMatch(beta, /className="bg-legal-links"/);
  assert.match(beta, /FREE BETA ACCESS/);
  // One action on the page. The three-task checklist and the six-rung ladder
  // were what made it unreadable: only one task opened anything, and the ladder
  // described states of a machine the visitor had not started.
  assert.doesNotMatch(beta, /STATUS_LADDER/);
  assert.doesNotMatch(beta, /stepArcus|stepX/);
  assert.match(css, /\.legal a\s*\{[^}]*text-decoration:\s*underline/);
});

test("swap no longer mounts or styles an automatic market marquee", () => {
  assert.equal(existsSync(tickerUrl), false);
  assert.ok(!swap.includes("MarketTicker"));
  assert.doesNotMatch(css, /\.tkr(?:-|\s|\{)/);
  assert.ok(!css.includes("@keyframes tkr-scroll"));
});

test("dead CSS is gone and authenticated workspaces expose focus rings", () => {
  for (const selector of [".hero-grid", ".cockpit", ".tstrip-grid", ".allin-grid", ".mod-grid", ".flow-track", ".cmp-wrap", ".beta-panel", ".ready-eye"]) {
    assert.ok(!css.includes(selector), `dead selector remains: ${selector}`);
  }
  assert.equal(existsSync(mobileTightUrl), false);
  assert.match(css, /\.cbs-root :where\(a, button, input, select, textarea\):focus-visible/);
  assert.match(css, /\.dm-root :where\(a, button, input, select, textarea\):focus-visible/);
  assert.match(css, /outline:\s*3px solid var\(--accent-2\)/);
});

test("landing preserves audience hierarchy, numeric truth, mobile navigation, and narrow zoom controls", () => {
  // Audience/mode depth moved off the landing.
  assert.match(home, /HomeCopy/);
  // The chrome lives in app/components/site-chrome.tsx, shared with methodology,
  // so the mobile CTA is asserted where it is now defined.
  const chrome = readFileSync(new URL("../app/components/site-chrome.tsx", import.meta.url), "utf8");
  assert.match(chrome, /className="btn btn-primary lp-mobile-cta"/);
  assert.match(landingCss, /\.lp-audience-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
  assert.match(landingCss, /font-variant-numeric:\s*tabular-nums/);
  assert.match(landingCss, /repeat\(auto-fit, minmax\(44px, 1fr\)\)/);
  assert.match(landingCss, /repeat\(auto-fit, minmax\(48px, 1fr\)\)/);
  assert.doesNotMatch(landingCss, /\.lp-trust-points[^}]*display:\s*none/);
  assert.doesNotMatch(landingCss, /\.lp-header-cta[^}]*text-overflow:\s*ellipsis/);

  // The living hero adds parallax, drifting layers and a market ticker. The
  // ticker may never widen the document, and every one of those layers has to
  // stand still under prefers-reduced-motion.
  assert.match(landingCss, /\.lp3-rail\s*\{[^}]*overflow:\s*hidden/);
  assert.match(landingCss, /\.lp3-strip\s*\{[^}]*overflow:\s*hidden/);

  // Reveal-on-scroll is progressive enhancement: the hidden start state only
  // exists under the client-set html.rv gate, so a blocked script leaves a
  // readable page instead of blank sections below the fold.
  assert.match(landingCss, /\.rv \.lp2-rv\s*\{[^}]*opacity:\s*0/);
  assert.doesNotMatch(landingCss, /(^|\n)\.lp2-rv\s*\{[^}]*opacity:\s*0/);
  assert.doesNotMatch(landingCss, /(^|\n)\.lp2-stagger > \*\s*\{[^}]*opacity:\s*0/);
  const observerGuard = home.indexOf('if (typeof IntersectionObserver === "undefined")');
  const observeAll = home.indexOf('nodes.forEach((node) => observer.observe(node))');
  const revealGate = home.indexOf('root.classList.add("rv")');
  assert.ok(observerGuard >= 0 && observeAll > observerGuard && revealGate > observeAll,
    "the page may be hidden only after observer construction and registration succeed");
  assert.match(home, /catch\s*\{[\s\S]*?root\.classList\.remove\("rv"\);[\s\S]*?return;/,
    "observer failure must leave the document visible");

  const livingMotion = landingCss.slice(landingCss.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  for (const stopped of [".lp3-float", ".lp3-final-aurora", ".lp3-track", ".lp3-plane", ".lp3-layer"]) {
    assert.ok(livingMotion.includes(stopped), `reduced motion must settle ${stopped}`);
  }
  assert.match(livingMotion, /\.lp3-layer\s*\{[^}]*transform:\s*none/);

  assert.equal(count(landingCss, "{"), count(landingCss, "}"), "landing CSS braces must stay balanced");
  const tinyStart = landingCss.indexOf("@media (max-width: 260px)");
  const reducedMotionStart = landingCss.indexOf("@media (prefers-reduced-motion: reduce)", tinyStart);
  assert.ok(tinyStart >= 0 && reducedMotionStart > tinyStart, "missing bounded ultra-narrow public demo rules");
  const tiny = landingCss.slice(tinyStart, reducedMotionStart);
  assert.match(tiny, /\.public-demo-header[\s\S]*min-height:\s*0/);
  assert.match(tiny, /\.public-demo-header \.container[\s\S]*flex-direction:\s*column/);
  assert.match(tiny, /\.public-demo-actions \.btn[\s\S]*width:\s*100%[\s\S]*white-space:\s*normal/);
});

test("public identity uses the dark premium shell while workspace keeps its own rendered palettes", () => {
  const publicSources = [home, layout, publicDemo, landingCss].join("\n");
  assert.doesNotMatch(publicSources, /ryntra-public-theme|data-public-theme|lp-theme-row/);
  assert.doesNotMatch(home, /toggleTheme|copy\.nav\.theme|\bMoon\b|\bSun\b/);
  // The public landing is dark-premium only; workspace palettes stay independent.
  assert.match(landingCss, /\.lp-root\s*\{[\s\S]*color-scheme:\s*dark/);
  assert.match(landingCss, /--bg:\s*#0a0e1a/);

  assert.match(workspaceTheme, /export type ThemePref = "dark" \| "light"/);
  assert.doesNotMatch(workspaceTheme, /export type ThemePref = "system"/);
  assert.match(workspaceTheme, /document\.documentElement\.setAttribute\("data-theme", resolved\)/);
  assert.match(css, /\[data-theme="light"\]\s*\{/);
});

test("dark public status text keeps WCAG AA contrast on its actual soft surfaces", () => {
  const publicTheme = variableBlock(landingCss, /\.lp-root\s*\{/);
  const faint = parseHex(customProperty(publicTheme, "--text-faint"));
  const warning = parseHex(customProperty(publicTheme, "--warning"));
  const warningSoft = parseRgba(customProperty(publicTheme, "--warning-soft"));
  const backgrounds = [parseHex(customProperty(publicTheme, "--bg")), parseHex(customProperty(publicTheme, "--panel"))];

  for (const background of backgrounds) {
    assert.ok(contrast(faint, background) >= 4.5, "public faint text falls below 4.5:1");
    assert.ok(contrast(warning, composite(warningSoft, background)) >= 4.5, "public warning text falls below 4.5:1");
  }

  assert.match(landingCss, /\.lp-maturity-paper,[\s\S]*color:\s*var\(--warning\)/);
  assert.match(landingCss, /\.lp-maturity-planned,[\s\S]*color:\s*var\(--text-faint\)/);
});

function count(value, token) {
  return value.split(token).length - 1;
}

function variableBlock(source, selector) {
  const start = source.search(selector);
  assert.ok(start >= 0, `missing variable block ${selector}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

function customProperty(block, property) {
  const match = block.match(new RegExp(`${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`));
  assert.ok(match, `missing ${property}`);
  return match[1].trim();
}

function parseHex(value) {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  assert.ok(match, `expected six-digit hex, received ${value}`);
  const packed = Number.parseInt(match[1], 16);
  return { r: (packed >> 16) & 255, g: (packed >> 8) & 255, b: packed & 255, a: 1 };
}

function parseRgba(value) {
  const match = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i);
  assert.ok(match, `expected rgba(), received ${value}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4]) };
}

function composite(foreground, background) {
  const a = foreground.a;
  return {
    r: foreground.r * a + background.r * (1 - a),
    g: foreground.g * a + background.g * (1 - a),
    b: foreground.b * a + background.b * (1 - a),
    a: 1,
  };
}

function luminance(color) {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

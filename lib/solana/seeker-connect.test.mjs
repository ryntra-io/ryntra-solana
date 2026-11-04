import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SeekerConnectError } from "@solana-mobile/seeker-connect-wallet-standard";

import {
  DEFAULT_SEEKER_RELAY_DOMAIN,
  isAndroidUserAgent,
  SEEKER_CHAIN,
  SEEKER_CONNECT_WALLET,
  seekerFailureCode,
  seekerRelayDomain,
  seekerConnectEvent,
  seekerConnectOutcome,
  seekerEventPath,
  seekerRelayCspSources,
  seekerTrackRow,
  SEEKER_COUNT_REASONS,
  seekerRelayOrigin,
  signedMessageText,
  SEEKER_CONNECT_EVENT_NAMES,
  SEEKER_CONNECT_EVENTS,
  SOLANA_MOBILE_SEEKER_RELAY_DOMAIN,
} from "./seeker-connect.ts";
import { looksLikeSeeker, onSeekerLikely, pagePresenter, pageTheme, registerSeekerConnectOnce, resetSeekerRegistrationForTests, seekerLikely, SEEKER_AUTHORIZATION_KEY } from "./seeker-connect.client.ts";
/* The relay variable of the shell running the tests must not decide them: every test below that wants it sets it. */
delete process.env.NEXT_PUBLIC_SEEKER_RELAY_DOMAIN;
const { default: nextConfig } = await import("../../next.config.ts");

/** Seeker Connect's registration, relay and failure codes (SKR-1). */

const ANDROID = "Mozilla/5.0 (Linux; Android 15; Seeker) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("the relay is Primal's until the variable names another bare host", () => {
  assert.equal(DEFAULT_SEEKER_RELAY_DOMAIN, "relay.primal.net");
  assert.equal(seekerRelayDomain(undefined), "relay.primal.net");
  assert.equal(seekerRelayDomain(""), "relay.primal.net");
  assert.equal(seekerRelayDomain("relay.solanamobile.com"), "relay.solanamobile.com");
  assert.equal(seekerRelayDomain(" Relay.SolanaMobile.com "), "relay.solanamobile.com");
  /* The SDK adds the scheme itself: one given is taken off, not doubled. */
  assert.equal(seekerRelayDomain("wss://relay.solanamobile.com/"), "relay.solanamobile.com");
  /* Nothing that is not a bare host reaches the CSP header. */
  for (const bad of ["relay.example.com:443", "relay.example.com/path", "*.example.com", "localhost", "relay example.com", "https://a.b/c d", "relay.example.com; script-src *"]) {
    assert.equal(seekerRelayDomain(bad), "relay.primal.net", bad);
  }
  assert.equal(seekerRelayOrigin("relay.solanamobile.com"), "wss://relay.solanamobile.com");
});

/* The site policy's connect-src, from a config read with the given relay variable. */
async function siteConnectSrc(relay) {
  const before = process.env.NEXT_PUBLIC_SEEKER_RELAY_DOMAIN;
  if (relay === undefined) delete process.env.NEXT_PUBLIC_SEEKER_RELAY_DOMAIN;
  else process.env.NEXT_PUBLIC_SEEKER_RELAY_DOMAIN = relay;
  try {
    /* A fresh module each time: the policy is built when next.config.ts loads. */
    const config = relay === undefined ? nextConfig : (await import(`../../next.config.ts?relay=${encodeURIComponent(relay)}`)).default;
    const rows = await config.headers();
    const site = rows.find((row) => row.source === "/:path*" && !row.has)?.headers.find((header) => header.key === "Content-Security-Policy")?.value
      ?? rows.flatMap((row) => row.headers).find((header) => header.key === "Content-Security-Policy" && header.value.includes("arcus"))?.value;
    assert.ok(site, "the site policy is served");
    return site.split("; ").find((directive) => directive.startsWith("connect-src ")).split(" ");
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_SEEKER_RELAY_DOMAIN;
    else process.env.NEXT_PUBLIC_SEEKER_RELAY_DOMAIN = before;
  }
}

test("the site's connect-src lets both relays' WebSockets through — Primal's and Solana Mobile's — and nothing wider", async () => {
  assert.equal(SOLANA_MOBILE_SEEKER_RELAY_DOMAIN, "relay.solanamobile.com");
  /* The variable unset (as in production until the operator sets it): both are allowed, so switching needs no header change. */
  const unset = await siteConnectSrc(undefined);
  assert.ok(unset.includes("wss://relay.primal.net"), unset.join(" "));
  assert.ok(unset.includes("wss://relay.solanamobile.com"), unset.join(" "));
  assert.ok(unset.includes(seekerRelayOrigin()), "the relay the page actually uses");
  assert.doesNotMatch(unset.join(" "), /wss:\/\/\*|\swss:(\s|$)/, "no wildcard WebSocket grant");
  assert.equal(unset.filter((source) => source.startsWith("wss://relay.")).length, 2, "exactly the two relays");
  /* The variable set to the target: still the same two, no duplicate. */
  const target = await siteConnectSrc("relay.solanamobile.com");
  assert.deepEqual(target.filter((source) => source.startsWith("wss://relay.")), ["wss://relay.primal.net", "wss://relay.solanamobile.com"]);
  /* A third relay the variable names is added beside them; a malformed value never reaches the header. */
  const third = await siteConnectSrc("relay.example.org");
  assert.ok(third.includes("wss://relay.example.org"), third.join(" "));
  assert.ok(third.includes("wss://relay.primal.net") && third.includes("wss://relay.solanamobile.com"));
  const bad = await siteConnectSrc("relay.example.com; script-src *");
  assert.equal(bad.filter((source) => source.startsWith("wss://relay.")).length, 2);
  assert.ok(!bad.join(" ").includes("script-src"));
  const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
  assert.match(config, /const SEEKER_RELAY = seekerRelayCspSources\(process\.env\.NEXT_PUBLIC_SEEKER_RELAY_DOMAIN\);/);
  /* The target is named in the policy only — never set as the relay the page uses. */
  assert.equal(DEFAULT_SEEKER_RELAY_DOMAIN, "relay.primal.net");
  assert.equal(seekerRelayCspSources(), "wss://relay.primal.net wss://relay.solanamobile.com");
});

test("only Android is a place a Seeker can answer", () => {
  assert.equal(isAndroidUserAgent(ANDROID), true);
  assert.equal(isAndroidUserAgent(DESKTOP), false);
  assert.equal(isAndroidUserAgent(IPHONE), false);
  assert.equal(isAndroidUserAgent(undefined), false);
});

test("failures are read by the package's own codes, and a plain error has none", () => {
  for (const code of ["association-failed", "authorization-declined", "request-declined", "session-closed", "cancelled", "wallet-error"]) {
    assert.equal(seekerFailureCode(new SeekerConnectError(code, code)), code);
  }
  assert.equal(seekerFailureCode(new Error("plain")), null);
  assert.equal(seekerFailureCode({ code: 4001, message: "rejected" }), null, "an extension's EIP-1193 code is not Seeker's");
  assert.equal(seekerFailureCode({ name: "SeekerConnectError", code: "made-up" }), null);
  assert.equal(seekerFailureCode(null), null);
});

test("the text a Mobile Wallet Adapter wallet signed is the text, without the signature it appends", () => {
  const message = new TextEncoder().encode("ryntra.io wants you to sign in");
  const signature = Uint8Array.from({ length: 64 }, (_, index) => index + 1);
  const appended = Uint8Array.from([...message, ...signature]);
  assert.deepEqual(signedMessageText(message, appended, signature), message);
  /* A wallet that answers with the text alone is passed through. */
  assert.deepEqual(signedMessageText(message, message, signature), message);
  /* Anything else goes to the server as it came: this never makes a signature valid. */
  const other = Uint8Array.from([...message.slice(0, -1), 0x21, ...signature]);
  assert.equal(signedMessageText(message, other, signature), other);
  const otherSignature = Uint8Array.from([...message, ...signature.map((byte) => byte ^ 1)]);
  assert.equal(signedMessageText(message, otherSignature, signature), otherSignature);
});

test("under SSR nothing registers and the package is never loaded", async () => {
  resetSeekerRegistrationForTests();
  assert.equal(typeof window, "undefined");
  let loaded = 0;
  const registered = await registerSeekerConnectOnce({ load: async () => { loaded++; return {}; }, loadUi: async () => { loaded++; return {}; } });
  assert.equal(registered, false);
  assert.equal(loaded, 0);
});

test("in an Android browser it registers once, as Ryntra, on this origin, on the registered network, through the relay", async () => {
  resetSeekerRegistrationForTests();
  globalThis.window = { navigator: { userAgent: ANDROID }, location: { origin: "https://app.ryntra.io" } };
  try {
    const seen = [];
    const deps = {
      likely: async () => false,
      load: async () => ({ registerSeekerConnect: (options) => seen.push(options) }),
      loadUi: async () => ({ createSeekerConnectPresenter: () => ({ interactionStarted: () => () => undefined, interactionFailed: () => undefined }) }),
    };
    assert.equal(await registerSeekerConnectOnce(deps), true);
    assert.equal(await registerSeekerConnectOnce(deps), true);
    assert.equal(seen.length, 1, "once per page");
    const [options] = seen;
    assert.deepEqual(options.identity, { name: "Ryntra", uri: "https://app.ryntra.io", icon: "/brand/city/icon-192.png" });
    assert.equal(options.relayDomain, "relay.primal.net");
    assert.equal(options.chain, SEEKER_CHAIN);
    assert.equal(options.chain, "solana:mainnet");
    assert.equal(options.firstConnectWalletBaseUri, undefined, "the package's own first-connect link, never a host of ours");
    assert.equal(options.seekerLink, undefined, "the package's own transport");
    assert.equal(typeof options.presenter.interactionStarted, "function");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(seekerLikely(), false, "registered is not offered: no Seeker is likely on this phone");
  } finally {
    delete globalThis.window;
    resetSeekerRegistrationForTests();
  }
});

test("a phone that names itself a Seeker, or holds a Seeker authorization, makes Seeker Connect offered", async () => {
  resetSeekerRegistrationForTests();
  globalThis.window = { navigator: { userAgent: ANDROID }, location: { origin: "https://ryntra.io" } };
  try {
    let told = 0;
    const off = onSeekerLikely(() => told++);
    const ui = async () => ({ createSeekerConnectPresenter: () => ({}) });
    assert.equal(await registerSeekerConnectOnce({ likely: async () => true, load: async () => ({ registerSeekerConnect: () => undefined }), loadUi: ui }), true);
    await new Promise((resolve) => setImmediate(resolve));
    off();
    assert.equal(seekerLikely(), true);
    assert.equal(told, 1);
  } finally {
    delete globalThis.window;
    resetSeekerRegistrationForTests();
  }
  /* What counts as the phone's own word. */
  assert.equal(SEEKER_AUTHORIZATION_KEY, "SeekerConnectAuthorizationCache");
  assert.equal(await looksLikeSeeker({ storage: () => '{"version":1}' }), true, "a cached Seeker authorization");
  assert.equal(await looksLikeSeeker({ hints: { getHighEntropyValues: async () => ({ model: "Seeker" }) } }), true, "the model client hint");
  assert.equal(await looksLikeSeeker({ hints: { getHighEntropyValues: async () => ({ model: "Pixel 9" }) }, userAgent: "Mozilla/5.0 (Linux; Android 10; K)" }), false);
  assert.equal(await looksLikeSeeker({ storage: () => { throw new Error("blocked"); }, hints: { getHighEntropyValues: async () => { throw new Error("no hints"); } } }), false);
  assert.equal(await looksLikeSeeker({ userAgent: ANDROID }), true, "a user agent that still names the model");
  assert.equal(await looksLikeSeeker({}), false);
});

test("on a computer or an iPhone it does not register, so their wallet lists stay as they were", async () => {
  for (const userAgent of [DESKTOP, IPHONE]) {
    resetSeekerRegistrationForTests();
    globalThis.window = { navigator: { userAgent }, location: { origin: "https://ryntra.io" } };
    let loaded = 0;
    try {
      assert.equal(await registerSeekerConnectOnce({ load: async () => { loaded++; return {}; } }), false);
      assert.equal(loaded, 0, userAgent);
    } finally {
      delete globalThis.window;
    }
  }
  resetSeekerRegistrationForTests();
});

test("a package that fails to load leaves the other wallets as all there is", async () => {
  resetSeekerRegistrationForTests();
  globalThis.window = { navigator: { userAgent: ANDROID }, location: { origin: "https://ryntra.io" } };
  try {
    assert.equal(await registerSeekerConnectOnce({ load: async () => { throw new Error("chunk failed"); }, loadUi: async () => ({}) }), false);
  } finally {
    delete globalThis.window;
    resetSeekerRegistrationForTests();
  }
});

test("the overlay follows the page's theme, and a launch nothing answered gets no dialog of its own", () => {
  const made = [];
  const failed = [];
  const ui = {
    createSeekerConnectPresenter: (options) => {
      made.push(options.theme);
      return { interactionStarted: () => () => undefined, interactionFailed: (error) => failed.push(error.code) };
    },
  };
  let theme = "dark";
  const presenter = pagePresenter(ui, () => theme);
  presenter.interactionStarted(() => undefined);
  theme = "light";
  presenter.interactionStarted(() => undefined);
  assert.deepEqual(made, ["dark", "light"], "read at each interaction, so a theme switch is followed");
  presenter.interactionFailed(new SeekerConnectError("association-failed", "nothing answered"));
  presenter.interactionFailed(new SeekerConnectError("request-declined", "declined"));
  assert.deepEqual(failed, ["request-declined"]);
});

test("the page's theme is read the way the cabinet and the site write it", () => {
  const cases = [
    [{ "data-theme": "porcelain", "data-ry-theme": "light" }, "light"],
    [{ "data-theme": "graphite", "data-ry-theme": "dark" }, "dark"],
    [{ "data-theme": "light" }, "light"],
    [{ "data-theme": "dark" }, "dark"],
    [{ "data-theme": "porcelain" }, "light"],
    [{}, "dark"],
  ];
  try {
    for (const [attributes, expected] of cases) {
      globalThis.document = { documentElement: { getAttribute: (name) => attributes[name] ?? null } };
      assert.equal(pageTheme(), expected, JSON.stringify(attributes));
    }
  } finally {
    delete globalThis.document;
  }
  assert.equal(pageTheme(), "dark", "no document: Graphite, the default");
});

test("the wallet name this product keys on is the package's", async () => {
  const { SeekerConnectWalletName } = await import("@solana-mobile/seeker-connect-wallet-standard");
  assert.equal(SEEKER_CONNECT_WALLET, SeekerConnectWalletName);
});

test("wallet.client.ts registers Seeker Connect when discovery starts, and asks only for signTransaction", () => {
  const source = readFileSync(new URL("./wallet.client.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.match(code, /void registerSeekerConnectOnce\(\);/);
  assert.doesNotMatch(code, /signAndSendTransaction/, "no code path names sign-and-send");
});

test("the connection count: worked, cancelled, did not connect — with no address, message or referrer", () => {
  assert.deepEqual(SEEKER_CONNECT_EVENTS, { connected: "seeker_connect_ok", cancelled: "seeker_connect_cancelled", failed: "seeker_connect_failed" });
  assert.deepEqual([...SEEKER_CONNECT_EVENT_NAMES], ["seeker_connect_ok", "seeker_connect_cancelled", "seeker_connect_failed"]);
  assert.equal(seekerConnectOutcome({ ok: true }), "connected");
  /* Closing the overlay and declining in the wallet are both the person's choice. */
  assert.equal(seekerConnectOutcome({ ok: false, state: "CANCELLED" }), "cancelled");
  assert.equal(seekerConnectOutcome({ ok: false, state: "REFUSED" }), "cancelled");
  for (const state of ["UNREACHABLE", "FAILED", "PENDING", "UNSUPPORTED", "NO_WALLET", undefined]) {
    assert.equal(seekerConnectOutcome({ ok: false, state }), "failed", String(state));
  }
  const ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  assert.deepEqual(seekerConnectEvent({ ok: true }, { pathname: `/app/markets/pools/${ADDRESS}`, locale: "uk" }), {
    name: "seeker_connect_ok", placement: null, locale: "uk", path: "/app/markets", ref: null,
  });
  assert.deepEqual(seekerConnectEvent({ ok: false, state: "UNREACHABLE", code: "association-failed" }, { pathname: "/app/launch", locale: "en" }), {
    name: "seeker_connect_failed", placement: "association-failed", locale: "en", path: "/app/launch", ref: null,
  });
  assert.equal(seekerConnectEvent({ ok: false, state: "CANCELLED", code: "cancelled" }).placement, "cancelled");
  assert.equal(seekerConnectEvent({ ok: false, state: "UNSUPPORTED" }).placement, "unsupported");
  /* A reason is never a free-form string: anything off the vocabulary is dropped. */
  assert.equal(seekerConnectEvent({ ok: false, state: `wallet ${ADDRESS} said no` }).placement, null);
  assert.equal(seekerConnectEvent({ ok: true }, { locale: "<script>" }).locale, null);
  /* Where, never whose: an address, a mint, an id or a ticker never survives in the path. */
  assert.equal(seekerEventPath(`/app/launch/creator/${ADDRESS}`), "/app/launch");
  assert.equal(seekerEventPath(`/app/token/${ADDRESS}`), "/app/token");
  assert.equal(seekerEventPath(`/pay/a1b2c3`), "/pay");
  assert.equal(seekerEventPath(`/${ADDRESS.toLowerCase()}`), null);
  assert.equal(seekerEventPath("/"), null);
  assert.equal(seekerEventPath(undefined), null);
  const payload = JSON.stringify(seekerConnectEvent({ ok: false, state: "FAILED", code: "wallet-error" }, { pathname: `/app/swap/${ADDRESS}`, locale: "en" }));
  assert.ok(!payload.includes(ADDRESS), payload);
});

test("a crafted request cannot put an address in a Seeker count: every field is held to its vocabulary", () => {
  const ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const hostile = {
    name: "seeker_connect_failed",
    placement: ADDRESS.slice(0, 32),
    locale: ADDRESS.slice(0, 12),
    path: `/app/pools/${ADDRESS}`,
    ref: `https://example.com/?wallet=${ADDRESS}`,
    extra: ADDRESS,
  };
  const row = seekerTrackRow(hostile);
  assert.deepEqual(row, { name: "seeker_connect_failed", placement: null, locale: null, path: "/app/pools", ref: null });
  assert.ok(!JSON.stringify(row).includes(ADDRESS.slice(0, 8)));
  assert.deepEqual(seekerTrackRow({ name: "seeker_connect_cancelled", placement: "authorization-declined", locale: "uk", path: "/app/swap" }), {
    name: "seeker_connect_cancelled", placement: "authorization-declined", locale: "uk", path: "/app/swap", ref: null,
  });
  for (const reason of ["cancelled", "association-failed", "session-closed", "wallet-error", "unsupported", "pending", "no_wallet"]) {
    assert.ok(SEEKER_COUNT_REASONS.has(reason), reason);
  }
  /* Not a Seeker count: the route stores it as it always did. */
  assert.equal(seekerTrackRow({ name: "telegram_cta_click", placement: "hero" }), null);
  assert.equal(seekerTrackRow({ name: 42 }), null);
  assert.equal(seekerTrackRow({}), null);
  /* What the browser writes passes the server's own check unchanged. */
  const browser = seekerConnectEvent({ ok: false, state: "UNREACHABLE", code: "association-failed" }, { pathname: "/app/launch", locale: "en" });
  assert.deepEqual(seekerTrackRow(browser), browser);
});

test("/api/track stores a Seeker count only through that check, and the admin catalog lists the three", async () => {
  const route = readFileSync(new URL("../../app/api/track/route.ts", import.meta.url), "utf8");
  assert.match(route, /SEEKER_CONNECT_EVENT_NAMES/);
  assert.match(route, /SEEKER_EVENTS\.has\(name\) \? seekerTrackRow\(body/);
  assert.match(route, /insertEvent\(\s*seeker \?\?/);
  const { FIRST_PARTY_EVENT_CATALOG } = await import("../admin/insights.ts");
  for (const name of SEEKER_CONNECT_EVENT_NAMES) assert.ok(FIRST_PARTY_EVENT_CATALOG.includes(name), name);
});

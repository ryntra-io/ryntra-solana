import { test } from "node:test";
import assert from "node:assert/strict";

// A window going out onto another screen and back (CITY-75), over a browser stand-in: a screen, a storage, Document
// Picture-in-Picture, window.open and a BroadcastChannel, each with the behaviour of a real one that matters here.

const items = new Map();
const bus = new Set();
class FakeChannel {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.sent = [];
    bus.add(this);
  }
  postMessage(data) {
    this.sent.push(data);
    for (const other of bus) if (other !== this && other.name === this.name) other.onmessage?.({ data: structuredClone(data) });
  }
  close() {
    bus.delete(this);
  }
}
globalThis.BroadcastChannel = FakeChannel;
/** A page of this site on its own (the second way): it hears the channel as `/window` does. */
function farPage() {
  const ch = new FakeChannel("ryntra.city.windows.v1");
  ch.heard = [];
  ch.onmessage = (event) => ch.heard.push(event.data);
  return ch;
}

class FakeWindow {
  constructor(width, height) {
    this.innerWidth = width;
    this.innerHeight = height;
    this.closed = false;
    this.listeners = {};
    const node = () => ({ append() {}, style: {} });
    this.document = { title: "", visibilityState: "visible", documentElement: {}, head: node(), body: node(), createElement: () => node() };
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.listeners.pagehide ?? []) fn();
  }
}

let pipOn = true;
let activation = true;
const pip = {
  window: null,
  requests: [],
  async requestWindow(size) {
    this.requests.push(size);
    const win = new FakeWindow(size.width, size.height);
    this.window = win;
    win.addEventListener("pagehide", () => (this.window = null));
    return win;
  },
};
const opened = [];
const win = {
  innerWidth: 1440,
  innerHeight: 860,
  localStorage: { getItem: (k) => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) },
  open(url, name, features) {
    const w = new FakeWindow(720, 560);
    opened.push({ url, name, features, w });
    return w;
  },
  addEventListener() {},
  removeEventListener() {},
};
Object.defineProperty(win, "documentPictureInPicture", { get: () => (pipOn ? pip : undefined) });
globalThis.window = win;
globalThis.screen = { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1400 };
let agent = "Mozilla/5.0 Chrome/131";
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { get userAgent() { return agent; }, userActivation: { get isActive() { return activation; } } } });
globalThis.document = { visibilityState: "visible", baseURI: "http://localhost/", documentElement: {}, body: {}, head: { querySelectorAll: () => [] } };
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.HTMLStyleElement = class {};
globalThis.HTMLLinkElement = class {};

const { forgetMemoryForTests, layout, openWindow, closeWindow, updateWindow, useWindows } = await import("./store.ts");
const { canGoOut, cityInView, comeBack, forgetOutForTests, goOut, goOutAgain, pipWindowOf, startOut } = await import("./out.ts");
const { DETACH_KEY } = await import("./detach.ts");
const { emptyLayout } = await import("./layout.ts");

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const OTHER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const render = () => null;
const CHART = { id: "chart", title: "Chart", render, size: { width: 720, height: 600 }, detach: { tower: MINT } };
const EXCHANGE = { id: "exchange", title: "Exchange", render, size: { width: 860, height: 640 }, detach: {} };
const MONEY = { id: "money", title: "Money", render };

let stop = () => {};
/** A page loaded again: nothing open, nothing out, the device's memory read afresh. */
function reload({ pipAvailable = true } = {}) {
  stop();
  forgetOutForTests();
  forgetMemoryForTests();
  for (const ch of [...bus]) ch.close();
  pipOn = pipAvailable;
  pip.window = null;
  pip.requests.length = 0;
  opened.length = 0;
  activation = true;
  agent = "Mozilla/5.0 Chrome/131";
  const first = emptyLayout({ width: 1440, height: 860 });
  useWindows.setState({ layout: first, base: first, specs: {}, guides: [], viewport: { width: 1440, height: 860 }, desk: true, out: {}, alone: false });
  stop = startOut();
}
const memory = () => JSON.parse(items.get(DETACH_KEY));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("out in Picture-in-Picture: the frame leaves the city, the contents live there; back in one tap, where it stood", async () => {
  items.clear();
  reload();
  openWindow(CHART);
  openWindow(MONEY);
  const stood = layout().find((p) => p.id === "chart").rect;
  assert.equal(canGoOut(), true);
  assert.equal(await goOut("chart"), "pip");
  assert.deepEqual(pip.requests, [{ width: 720, height: 600 }], "the window's own size, the first time");
  assert.deepEqual(layout().map((p) => p.id), ["money"], "no frame of it in the city");
  assert.equal(useWindows.getState().out.chart.via, "pip");
  assert.ok(useWindows.getState().specs.chart, "its contents are still the city's");
  assert.ok(pipWindowOf("chart"));
  assert.deepEqual(memory().out, ["chart"]);

  // The window's data changes while it is out: its spec follows there.
  updateWindow({ ...CHART, title: "Chart · BONK" });
  assert.equal(useWindows.getState().specs.chart.title, "Chart · BONK");

  const out = pipWindowOf("chart");
  out.innerWidth = 900;
  out.innerHeight = 640;
  comeBack("chart");
  assert.equal(out.closed, true, "the window out there closes");
  assert.equal(useWindows.getState().out.chart, undefined);
  assert.deepEqual(layout().find((p) => p.id === "chart").rect, stood, "back where it stood");
  assert.deepEqual(memory(), { v: 1, out: [], sizes: { chart: { width: 900, height: 640 } } }, "its size out there remembered");
  assert.equal(await goOut("chart"), "pip");
  assert.deepEqual(pip.requests.at(-1), { width: 900, height: 640 }, "out again at the size the person gave it");
});

test("the person closes the window out there: its contents come back to the city by themselves", async () => {
  reload();
  openWindow(CHART);
  await goOut("chart");
  const out = pipWindowOf("chart");
  out.innerWidth = 760;
  out.close();
  assert.ok(layout().some((p) => p.id === "chart"));
  assert.equal(useWindows.getState().out.chart, undefined);
  assert.equal(memory().sizes.chart.width, 760);
  assert.deepEqual(memory().out, []);
});

test("the owner closes a window that is out: it closes out there too, and goes out again the next time it opens", async () => {
  reload();
  openWindow(CHART);
  await goOut("chart");
  const out = pipWindowOf("chart");
  closeWindow("chart");
  assert.equal(out.closed, true);
  assert.equal(useWindows.getState().specs.chart, undefined);
  assert.equal(layout().length, 0);
  assert.deepEqual(memory().out, ["chart"], "still remembered as out");

  // The page loads again; the chart opens from a tap: out again by itself.
  reload();
  openWindow(CHART);
  goOutAgain("chart");
  await tick();
  assert.equal(useWindows.getState().out.chart?.via, "pip");

  // Without a tap that still counts the browser would refuse: it stays in the city, nothing asked.
  reload();
  activation = false;
  openWindow(CHART);
  goOutAgain("chart");
  await tick();
  assert.equal(useWindows.getState().out.chart, undefined);
  assert.equal(pip.requests.length, 0);
  assert.ok(layout().some((p) => p.id === "chart"));
});

test("only windows that say how, only on a computer's browser: no button on a phone, in the app, or for Money", async () => {
  reload();
  openWindow(MONEY);
  assert.equal(await goOut("money"), null);
  assert.deepEqual(layout().map((p) => p.id), ["money"]);
  openWindow(CHART);
  useWindows.getState().setViewport({ width: 390, height: 844 });
  assert.equal(canGoOut(), false);
  assert.equal(await goOut("chart"), null);
  useWindows.getState().setViewport({ width: 1440, height: 860 });
  agent = "Mozilla/5.0 RyntraApp/1.4.0";
  assert.equal(canGoOut(), false);
  assert.equal(await goOut("chart"), null);
  assert.equal(pip.requests.length + opened.length, 0);
});

test("the second way: a browser window on the city's route, the same wallet and reads; closed or taken back over the channel", async () => {
  items.clear();
  reload({ pipAvailable: false });
  openWindow(CHART);
  assert.equal(await goOut("chart"), "tab");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].url, `/window?id=chart&tower=${MINT}`);
  assert.equal(opened[0].name, "ryntra-window-chart", "one page per window: opening it again reuses it");
  assert.match(opened[0].features, /^popup=yes,width=720,height=600,/);
  assert.equal(useWindows.getState().out.chart.via, "tab");
  assert.equal(layout().length, 0);

  // Another tower picked in the city: the page out there follows.
  const far = farPage();
  updateWindow({ ...CHART, detach: { tower: OTHER } });
  assert.deepEqual(far.heard.at(-1), { t: "follow", id: "chart", params: { tower: OTHER } });

  // Closed there by the person: the page says so, and the chart is back in the city at the size it had.
  far.postMessage({ t: "gone", id: "chart", size: { width: 1000, height: 700 } });
  assert.equal(useWindows.getState().out.chart, undefined);
  assert.ok(layout().some((p) => p.id === "chart"));
  assert.deepEqual(memory().sizes.chart, { width: 1000, height: 700 });

  // Out again and taken back from the city's tray: the page is asked, and the window comes back once it has gone —
  // never a second copy in the city while the page out there may hold a signature.
  await goOut("chart");
  comeBack("chart");
  assert.deepEqual(far.heard.at(-1), { t: "return", id: "chart" });
  assert.equal(useWindows.getState().out.chart?.via, "tab", "the city waits for the page");
  assert.equal(layout().length, 0);
  far.postMessage({ t: "gone", id: "chart", size: { width: 900, height: 650 } });
  assert.equal(useWindows.getState().out.chart, undefined);
  assert.ok(layout().some((p) => p.id === "chart"));
});

test("taken back from the tray while the page out there is closed already: back at once", async () => {
  reload({ pipAvailable: false });
  openWindow(CHART);
  await goOut("chart");
  opened[0].w.closed = true;
  comeBack("chart");
  assert.equal(useWindows.getState().out.chart, undefined);
  assert.ok(layout().some((p) => p.id === "chart"));
});

test("an adopted page that never answers «back»: the city takes its window anyway", async () => {
  reload({ pipAvailable: false });
  const far = farPage();
  openWindow(CHART);
  far.postMessage({ t: "here", id: "chart", params: { tower: MINT } });
  assert.equal(useWindows.getState().out.chart?.via, "tab");
  comeBack("chart");
  assert.equal(useWindows.getState().out.chart?.via, "tab");
  await new Promise((resolve) => setTimeout(resolve, 2_700));
  assert.equal(useWindows.getState().out.chart, undefined);
  assert.ok(layout().some((p) => p.id === "chart"));
});

test("the second way without a message: a page closed with the city's handle is noticed and its window comes back", async () => {
  reload({ pipAvailable: false });
  openWindow(CHART);
  await goOut("chart");
  opened[0].w.closed = true;
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(useWindows.getState().out.chart, undefined);
  assert.ok(layout().some((p) => p.id === "chart"));
});

test("one Picture-in-Picture per page: a second window goes out as a page of its own", async () => {
  reload();
  openWindow(CHART);
  openWindow(EXCHANGE);
  assert.equal(await goOut("chart"), "pip");
  assert.equal(await goOut("exchange"), "tab");
  assert.equal(opened[0].url, "/window?id=exchange");
  assert.equal(layout().length, 0);
});

test("a page left out before the city reloaded is that window: the frame leaves the city when it says it is there", async () => {
  reload({ pipAvailable: false });
  const far = farPage();
  far.onmessage = (event) => {
    far.heard.push(event.data);
    if (event.data.t === "hello") far.postMessage({ t: "here", id: "chart", params: { tower: OTHER } });
  };
  openWindow(CHART);
  far.postMessage({ t: "here", id: "chart", params: { tower: OTHER } });
  assert.equal(useWindows.getState().out.chart?.via, "tab");
  assert.deepEqual(far.heard.at(-1), { t: "follow", id: "chart", params: { tower: MINT } }, "and shows what the city shows");
  comeBack("chart");
  assert.deepEqual(far.heard.at(-1), { t: "return", id: "chart" });
  far.postMessage({ t: "gone", id: "chart", size: null });
  assert.equal(useWindows.getState().out.chart, undefined);
});

test("the city is in view while a window out in Picture-in-Picture is, though its tab is behind another", async () => {
  reload();
  openWindow(CHART);
  await goOut("chart");
  document.visibilityState = "hidden";
  assert.equal(cityInView(), true);
  pipWindowOf("chart").document.visibilityState = "hidden";
  assert.equal(cityInView(), false);
  document.visibilityState = "visible";
  assert.equal(cityInView(), true);
});

test("a page that is one window on its own remembers nothing of the city's layout", async () => {
  items.clear();
  reload();
  const { standAlone } = await import("./store.ts");
  standAlone();
  openWindow(CHART);
  assert.equal(items.size, 0);
  assert.equal(canGoOut(), false, "and sends nothing further out");
  forgetMemoryForTests();
});

test("a sheet written into Picture-in-Picture keeps its fonts and pictures: relative addresses made whole", async () => {
  const { sheetText } = await import("./out.ts");
  const href = "http://localhost:3000/_next/static/css/app/page.css";
  const text = sheetText(
    [
      { cssText: '@font-face { src: url("../media/geist.woff2") format("woff2"); }' },
      { cssText: ".a { background: url(/city/art/x.webp), url(data:image/png;base64,AA), url('img/y.png'); }" },
    ],
    href,
  );
  assert.match(text, /url\("http:\/\/localhost:3000\/_next\/static\/css\/media\/geist\.woff2"\)/);
  assert.match(text, /url\(\/city\/art\/x\.webp\)/, "a path from the root stays: the window's base is the city's");
  assert.match(text, /url\(data:image\/png;base64,AA\)/);
  assert.match(text, /url\('http:\/\/localhost:3000\/_next\/static\/css\/app\/img\/y\.png'\)/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { BACK_KEY, createBackStack, TRAVEL_MS } from "./stack.ts";

// CITY-6e: «Back» over the city. The system «Back» of the Ryntra app on Android goes back in the WebView while it can
// and leaves the app when it cannot (apps/mobile, screens/city); a browser's «Back» is the same walk. Here a history of
// our own stands in for the page's — entries, forward entries kept, traversals and `popstate` after the current task,
// Next.js's own mark on every entry — and a city of layers stands in for the windows' stores.

/** The page's history: one entry per load, like a browser's, with its traversals after the current task. */
function page(url = "https://ryntra.io/") {
  const entries = [{ state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["", {}] }, url }];
  let index = 0;
  let left = false;
  let clock = 0;
  let seq = 0;
  const tasks = new Map();
  const listeners = new Set();
  const task = (run, ms) => {
    const id = ++seq;
    tasks.set(id, { at: clock + ms, seq: id, run });
    return () => tasks.delete(id);
  };
  const traverse = (delta) => {
    const target = index + delta;
    if (target < 0) {
      left = true;
      return;
    }
    if (target >= entries.length) return;
    index = target;
    for (const hear of [...listeners]) hear(entries[index].state);
  };
  const copy = (data) => (data === undefined ? null : structuredClone(data));
  const history = {
    get state() {
      return entries[index].state;
    },
    pushState(data, _unused, next) {
      entries.splice(index + 1);
      entries.push({ state: copy(data), url: next ? new URL(next, entries[index].url).href : entries[index].url });
      index += 1;
    },
    replaceState(data, _unused, next) {
      entries[index] = { state: copy(data), url: next ? new URL(next, entries[index].url).href : entries[index].url };
    },
    go(delta) {
      task(() => traverse(delta), 0);
    },
  };
  const env = {
    history,
    location: {
      get href() {
        return entries[index].url;
      },
    },
    listen: (hear) => {
      listeners.add(hear);
      return () => listeners.delete(hear);
    },
    later: task,
    session: "test",
  };
  /** Runs every task that is due, in order, the timers' own waits included. */
  const flush = () => {
    for (let guard = 0; tasks.size && guard < 1_000; guard += 1) {
      const [id, next] = [...tasks].sort(([, a], [, b]) => a.at - b.at || a.seq - b.seq)[0];
      tasks.delete(id);
      clock = Math.max(clock, next.at);
      next.run();
    }
  };
  return {
    env,
    flush,
    /** The Android app's «Back»: back in the WebView while it can go back, else the app is left. */
    back() {
      if (index > 0) history.go(-1);
      else left = true;
      flush();
    },
    forward() {
      history.go(1);
      flush();
    },
    get left() {
      return left;
    },
    get index() {
      return index;
    },
    get length() {
      return entries.length;
    },
    get url() {
      return entries[index].url;
    },
    get state() {
      return entries[index].state;
    },
    listeners: () => listeners.size,
  };
}

/** The city's layers as their stores hold them: what is open, in its order, and what refuses to close. */
function city(order = ["tower", "quarter", "trade", "chart", "money", "menu", "settings", "full"]) {
  const open = new Set();
  const refusing = new Set();
  let stack = null;
  const changed = () => stack?.changed();
  return {
    layers: {
      read: () => order.filter((id) => open.has(id)),
      close: (id) => {
        if (refusing.has(id)) return;
        open.delete(id);
        changed();
      },
    },
    attach(next) {
      stack = next;
    },
    open(...ids) {
      for (const id of ids) open.add(id);
      changed();
    },
    /** The layer's own close button. */
    shut(...ids) {
      for (const id of ids) open.delete(id);
      changed();
    },
    refuse(id, on = true) {
      if (on) refusing.add(id);
      else refusing.delete(id);
    },
    has: (id) => open.has(id),
    open_: () => order.filter((id) => open.has(id)),
  };
}

function scene(url) {
  const p = page(url);
  const c = city();
  const stack = createBackStack(p.env, c.layers);
  c.attach(stack);
  p.flush();
  return { p, c, stack };
}

test("open a window → Back closes it → Back again leaves the app", () => {
  const { p, c } = scene();
  c.open("chart");
  p.flush();
  assert.equal(p.length, 2, "the window stands on an entry of its own");
  assert.equal(p.url, "https://ryntra.io/", "with the same address");

  p.back();
  assert.equal(c.has("chart"), false, "Back closed the window");
  assert.equal(p.left, false, "and stayed in the city");
  assert.equal(p.index, 0);

  p.back();
  assert.equal(p.left, true, "the next Back leaves");
});

test("on the city's own view Back leaves at once: nothing is pushed while nothing is open", () => {
  const { p, c } = scene();
  c.open();
  p.flush();
  assert.equal(p.length, 1);
  p.back();
  assert.equal(p.left, true);
});

test("layers stack: each Back closes the top one, the window on the whole screen first", () => {
  const { p, c, stack } = scene();
  c.open("tower");
  p.flush();
  c.open("trade");
  p.flush();
  c.open("full");
  p.flush();
  assert.deepEqual(stack.layers(), ["tower", "trade", "full"]);
  assert.equal(p.index, 3);

  p.back();
  assert.deepEqual(c.open_(), ["tower", "trade"]);
  p.back();
  assert.deepEqual(c.open_(), ["tower"]);
  p.back();
  assert.deepEqual(c.open_(), []);
  assert.equal(p.left, false);
  p.back();
  assert.equal(p.left, true);
});

test("a layer closed by its own button gives its entry back: the next Back is never a dead press", () => {
  const { p, c } = scene();
  c.open("chart");
  p.flush();
  c.shut("chart");
  p.flush();
  assert.equal(p.index, 0, "back on the city's own entry");
  p.back();
  assert.equal(p.left, true);
});

test("a layer under another closed by its button: the entries follow, the top still closes first", () => {
  const { p, c, stack } = scene();
  c.open("tower");
  p.flush();
  c.open("chart");
  p.flush();
  c.shut("tower");
  p.flush();
  assert.deepEqual(stack.layers(), ["chart"]);
  assert.equal(p.index, 1);
  p.back();
  assert.equal(c.has("chart"), false);
  p.back();
  assert.equal(p.left, true);
});

test("one panel giving way to another, and tabs inside a window, never grow the history", () => {
  const { p, c, stack } = scene();
  c.open("menu");
  p.flush();
  assert.equal(p.length, 2);
  // «Settings» from the menu: the menu closes and the settings open in the same moment.
  c.shut("menu");
  c.open("settings");
  p.flush();
  assert.equal(p.length, 2, "the entry is the settings' now");
  assert.deepEqual(stack.layers(), ["settings"]);
  // A tab switched inside an open window: its store changes, the open layers do not.
  for (let i = 0; i < 5; i += 1) stack.changed();
  p.flush();
  assert.equal(p.length, 2);
  p.back();
  assert.equal(c.has("settings"), false);
  p.back();
  assert.equal(p.left, true);
});

test("layers opened together stack in the city's order: a coin's link opens its tower and its trade card", () => {
  const { p, c, stack } = scene("https://ryntra.io/c/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump");
  c.open("trade", "tower");
  p.flush();
  assert.deepEqual(stack.layers(), ["tower", "trade"]);
  p.back();
  assert.deepEqual(c.open_(), ["tower"]);
});

test("a deep link keeps its address: the layer it opened closes on Back and the link stays as it was", () => {
  const link = "https://ryntra.io/c/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
  const p = page(link);
  const c = city();
  // The coin's tower is already open when the stack starts (CoinOpener on `/c/<mint>`).
  c.open("tower");
  const stack = createBackStack(p.env, c.layers);
  c.attach(stack);
  p.flush();
  assert.equal(p.length, 2);
  assert.equal(p.url, link);
  p.back();
  assert.equal(c.has("tower"), false);
  assert.equal(p.url, link);
  p.back();
  assert.equal(p.left, true);
});

test("home from a deep link: the address the page set (`/`) is what the city's entry says after the layers give theirs back", () => {
  const p = page("https://ryntra.io/c/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump");
  const c = city();
  c.open("tower");
  const stack = createBackStack(p.env, c.layers);
  c.attach(stack);
  p.flush();
  c.open("chart");
  p.flush();
  // goHome(): the address becomes `/`, then every layer shuts.
  p.env.history.replaceState(p.state, "", "/");
  c.shut("chart", "tower");
  p.flush();
  assert.equal(p.index, 0);
  assert.equal(p.url, "https://ryntra.io/");
  assert.equal(p.state.__NA, undefined, "written without Next.js's own mark, so its router takes the address too");
  p.back();
  assert.equal(p.left, true);
});

test("a window held while the wallet signs: Back waits — it keeps its entry, never leaves the app, and closes it once signed", () => {
  const { p, c, stack } = scene();
  c.open("trade");
  p.flush();
  assert.equal(p.index, 1);
  const length = p.length;
  c.refuse("trade");
  for (let i = 0; i < 5; i += 1) {
    p.back();
    assert.equal(p.left, false, "Back never leaves the app mid-signature");
    assert.equal(c.has("trade"), true, "the held window stays");
    assert.deepEqual(stack.layers(), ["trade"], "with its entry");
    assert.equal(p.index, 1, "its entry is pushed again");
    assert.equal(p.length, length, "the history does not grow over repeated Backs");
  }
  // Signed: the window may close now, and the next Back closes it as usual.
  c.refuse("trade", false);
  p.back();
  assert.equal(c.has("trade"), false);
  assert.deepEqual(stack.layers(), []);
  assert.equal(p.index, 0);
  p.back();
  assert.equal(p.left, true, "on the clean city Back leaves");
});

test("held over another layer: the layers under it keep their entries, the ones above it close", () => {
  const { p, c, stack } = scene();
  c.open("tower");
  p.flush();
  c.open("trade");
  p.flush();
  c.open("menu");
  p.flush();
  assert.equal(p.index, 3);
  c.refuse("trade");
  p.back();
  assert.equal(c.has("menu"), false, "the menu above closes");
  assert.deepEqual(stack.layers(), ["tower", "trade"]);
  assert.equal(p.index, 2);
  p.back();
  assert.equal(c.has("trade"), true, "the held window waits");
  assert.equal(c.has("tower"), true, "and the tower under it is not closed from under it");
  assert.equal(p.index, 2);
  c.refuse("trade", false);
  p.back();
  assert.equal(c.has("trade"), false);
  assert.equal(c.has("tower"), true);
  assert.equal(p.index, 1);
  p.back();
  assert.equal(c.has("tower"), false);
  p.back();
  assert.equal(p.left, true);
});

test("an entry whose mark Next.js wrote over still closes one layer, not all", () => {
  const { p, c } = scene();
  c.open("tower");
  p.flush();
  c.open("chart");
  p.flush();
  // Next.js's router replaces the state of the entry under the top one with its own (a refresh, a server action).
  p.env.history.go(-1);
  p.flush();
  assert.deepEqual(c.open_(), ["tower"]);
  p.env.history.replaceState({ __NA: true }, "");
  c.open("chart");
  p.flush();
  assert.equal(p.index, 2);
  p.env.history.replaceState({ __NA: true }, "");
  p.back();
  assert.deepEqual(c.open_(), ["tower"]);
  p.back();
  assert.deepEqual(c.open_(), []);
  p.back();
  assert.equal(p.left, true);
});

test("each entry carries the city's mark beside Next.js's own state", () => {
  const { p, c } = scene();
  c.open("chart");
  p.flush();
  assert.equal(p.state.__NA, true);
  assert.deepEqual(p.state[BACK_KEY], { s: "test", d: 1 });
});

test("a browser's Forward onto an entry whose layer is gone steps back to the top of what stands", () => {
  const { p, c } = scene();
  c.open("chart");
  p.flush();
  p.back();
  assert.equal(c.has("chart"), false);
  p.forward();
  assert.equal(p.index, 0, "the stale entry is stepped off");
  assert.equal(c.has("chart"), false);
  p.back();
  assert.equal(p.left, true);
});

test("a step back whose popstate never comes stops waiting", () => {
  const p = page();
  const c = city();
  const go = p.env.history.go;
  let swallow = true;
  p.env.history.go = (delta) => (swallow ? undefined : go(delta));
  const stack = createBackStack(p.env, c.layers);
  c.attach(stack);
  c.open("chart");
  p.flush();
  c.shut("chart");
  p.flush();
  assert.ok(TRAVEL_MS > 0);
  swallow = false;
  c.open("money");
  p.flush();
  assert.deepEqual(stack.layers(), ["money"], "the stack follows again after the wait");
});

test("disposed: the stack hears nothing and writes nothing", () => {
  const { p, c, stack } = scene();
  stack.dispose();
  assert.equal(p.listeners(), 0);
  c.open("chart");
  p.flush();
  assert.equal(p.length, 1);
});

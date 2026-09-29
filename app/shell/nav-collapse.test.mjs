import assert from "node:assert/strict";
import test from "node:test";

import {
  NAV_COLLAPSE_KEY,
  openGroupOfActive,
  readCollapsedGroups,
  writeCollapsedGroups,
} from "./nav-collapse.ts";

/** A storage that can be told to fail, because a real one can. */
function storage(initial = null, { broken = false } = {}) {
  let value = initial;
  return {
    getItem: (key) => {
      if (broken) throw new Error("site data blocked");
      return key === NAV_COLLAPSE_KEY ? value : null;
    },
    setItem: (key, next) => {
      if (broken) throw new Error("site data blocked");
      if (key === NAV_COLLAPSE_KEY) value = next;
    },
    read: () => value,
  };
}

const group = (id, ...hrefs) => ({ id, entries: hrefs.map((href) => ({ href })) });

test("a closed group survives the next page, which is the whole point of the arrow", () => {
  const store = storage();
  writeCollapsedGroups(store, new Set(["domains-strategies", "domains-trade"]));
  /* Sorted on the way out so the stored value does not churn on re-write. */
  assert.equal(store.read(), '["domains-strategies","domains-trade"]');
  assert.deepEqual([...readCollapsedGroups(store)].sort(), ["domains-strategies", "domains-trade"]);
});

test("nothing stored, nothing unreadable and nothing of the wrong shape closes a group", () => {
  assert.equal(readCollapsedGroups(storage()).size, 0);
  assert.equal(readCollapsedGroups(storage("not json")).size, 0);
  assert.equal(readCollapsedGroups(storage('{"domains-trade":true}')).size, 0);
  /* A list with junk in it keeps the strings and drops the rest rather than
     throwing the whole preference away. */
  assert.deepEqual([...readCollapsedGroups(storage('["domains-trade",7,null]'))], ["domains-trade"]);
});

test("a browser with site data blocked still navigates; it just does not remember", () => {
  const broken = storage(null, { broken: true });
  assert.equal(readCollapsedGroups(broken).size, 0);
  assert.doesNotThrow(() => writeCollapsedGroups(broken, new Set(["domains-money"])));
});

test("a group is never closed over the page you are on", () => {
  const groups = [
    group("domains-trade", "/app/swap", "/app/spot"),
    group("domains-money", "/app/send", "/app/receive"),
  ];
  const closed = new Set(["domains-trade", "domains-money"]);

  /* Arriving on Swap opens Trade and leaves Money exactly as the person left it. */
  const opened = openGroupOfActive(closed, groups, "/app/swap");
  assert.deepEqual([...opened], ["domains-money"]);

  /* And it is the same set — by identity — when it changes nothing, which is
     what stops the effect that calls this from looping. */
  assert.equal(openGroupOfActive(opened, groups, "/app/swap"), opened);
  assert.equal(openGroupOfActive(closed, groups, null), closed);
  assert.equal(openGroupOfActive(closed, groups, "/app/settings"), closed);
  assert.equal(openGroupOfActive(new Set(), groups, "/app/swap").size, 0);
});

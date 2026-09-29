import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_VERBS,
  HOME_COMMANDS,
  PALETTE_AUTHORITY,
  commandsFor,
  searchCommands,
} from "./commands.ts";

test("the palette navigates and nothing else", () => {
  assert.equal(PALETTE_AUTHORITY, "NAVIGATION_ONLY");
  for (const command of HOME_COMMANDS) {
    assert.match(command.href, /^\/(app|agents|docs)/, command.id + " must be a route");
    assert.equal("run" in command, false, command.id + " must not carry a callback");
    assert.equal("action" in command, false, command.id + " must not carry an action");
  }
});

test("no entry carries an action verb in its id, label or keywords", () => {
  for (const command of HOME_COMMANDS) {
    const haystack = [command.id, command.label, ...command.keywords].join(" ").toLowerCase();
    for (const verb of ACTION_VERBS) {
      assert.equal(
        new RegExp("\\b" + verb + "\\b").test(haystack),
        false,
        command.id + " contains the action verb '" + verb + "'",
      );
    }
  }
});

test("every command id is unique and every route is distinct enough to be found", () => {
  assert.equal(new Set(HOME_COMMANDS.map((command) => command.id)).size, HOME_COMMANDS.length);
  for (const command of HOME_COMMANDS) {
    assert.ok(command.label.length > 0, command.id);
    assert.ok(command.group.length > 0, command.id);
  }
});

test("every wave-7 surface is reachable from the palette", () => {
  const hrefs = new Set(HOME_COMMANDS.map((command) => command.href));
  for (const href of ["/app/brief", "/app/alerts", "/app/coverage", "/app/operations"]) {
    assert.ok(hrefs.has(href), href + " must be in the palette");
  }
});

test("an empty query returns the index in its declared order", () => {
  const results = searchCommands(HOME_COMMANDS, "");
  assert.deepEqual(results.map((entry) => entry.id), HOME_COMMANDS.map((entry) => entry.id));
});

test("ranking is exact id, then label prefix, then label substring, then keyword", () => {
  const index = [
    { id: "zzz", label: "Zebra keyword match", href: "/app/zzz", keywords: ["brief"], group: "G" },
    { id: "sub", label: "The brief in the middle", href: "/app/sub", keywords: [], group: "G" },
    { id: "pre", label: "Brief prefix", href: "/app/pre", keywords: [], group: "G" },
    { id: "brief", label: "Something else entirely", href: "/app/brief", keywords: [], group: "G" },
  ];
  assert.deepEqual(searchCommands(index, "brief").map((entry) => entry.id), ["brief", "pre", "sub", "zzz"]);
});

test("ranking is deterministic: the same query and index give the same order twice", () => {
  const once = searchCommands(HOME_COMMANDS, "port").map((entry) => entry.id);
  const twice = searchCommands(HOME_COMMANDS, "port").map((entry) => entry.id);
  assert.deepEqual(once, twice);
});

test("ties break on the declared index order, not on insertion luck", () => {
  const index = [
    { id: "b", label: "Alpha b", href: "/app/b", keywords: [], group: "G" },
    { id: "a", label: "Alpha a", href: "/app/a", keywords: [], group: "G" },
  ];
  assert.deepEqual(searchCommands(index, "alpha").map((entry) => entry.id), ["b", "a"]);
});

test("search is case and whitespace insensitive", () => {
  assert.deepEqual(
    searchCommands(HOME_COMMANDS, "  PORTFOLIO ").map((entry) => entry.id),
    searchCommands(HOME_COMMANDS, "portfolio").map((entry) => entry.id),
  );
});

test("a query nothing matches returns nothing rather than the whole index", () => {
  assert.deepEqual(searchCommands(HOME_COMMANDS, "qwertyuiop"), []);
});

test("without a session only the routes that work anonymously are offered", () => {
  const anonymous = commandsFor({ hasSession: false });
  assert.ok(anonymous.length > 0);
  assert.equal(anonymous.some((command) => command.needsSession), false);
  const signedIn = commandsFor({ hasSession: true });
  assert.ok(signedIn.length > anonymous.length);
});

test("the index is frozen so a caller cannot add an action to it", () => {
  assert.equal(Object.isFrozen(HOME_COMMANDS), true);
  assert.throws(() => { HOME_COMMANDS.push({ id: "x" }); });
});

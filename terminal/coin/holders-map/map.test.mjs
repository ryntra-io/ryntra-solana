import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GROUP_TONES, SOURCE_SIZE, groupedShare, layoutMap, linksOf, radiusOf, shareText, toneOf } from "./map-view.ts";
import { HOLDER_MAP } from "./words.ts";

/*
 * The holders' links on the screen: the engine's answer read in its shape, the map laid out the same way
 * every time — groups together around the wallet they share, nothing overlapping, the holders not linked apart — and
 * the words in both languages.
 */

const H = ["FMUEmtxhU46GzhKF4FW9MLJdQWiLgjiXP9TYRWSrqTpV", "6TcyBfPdBt1kjsvDZLzmBFnuMaLWiTaAt4RjUr9VA5YD", "4MfyR4G3NWfVRDWo6iNAHDBZqWMgwZX6FNtMqEW3a9JT", "6c5fX1cKYGRNNbozjDdUr2s5vfUuS1XTistmZeG2kZY6", "4Mz4Y6iXdBdAbPMv874YWPgH2oy6QKARovMt2pNurh6e", "7nLFtY5yiR4CZnkB6bYMth3bbAns9DnFhtgjHGqcCiRn"];
const S = "5WcE8o73vmsSZXeeWTLm3ty3fAJKCnBWRF6VuKUme5nu";
const F = "6JhaGdekBjU2RfiYWSjYdQAibx4LfSfTNFEeMUHnUVz7";

/* The answer the engine gives for the recorded links (`lib/spot/holder-links.test.mjs`). */
const ANSWER = {
  nodes: [
    { owner: H[0], sharePct: 12, group: 1, creator: false },
    { owner: H[1], sharePct: 9, group: 1, creator: false },
    { owner: H[2], sharePct: 6, group: 2, creator: false },
    { owner: H[3], sharePct: 5, group: 2, creator: false },
    { owner: H[4], sharePct: 4, group: null, creator: false },
    { owner: H[5], sharePct: 3, group: 1, creator: false },
  ],
  sources: [
    { wallet: S, kinds: ["coin"], holders: [H[0], H[1]], creator: false },
    { wallet: F, kinds: ["sol"], holders: [H[2], H[3]], creator: false },
  ],
  edges: [
    { from: H[0], to: H[5], kind: "between" },
    { from: S, to: H[0], kind: "coin" },
    { from: S, to: H[1], kind: "coin" },
    { from: F, to: H[2], kind: "sol" },
    { from: F, to: H[3], kind: "sol" },
  ],
  groups: [
    { id: 1, wallets: [H[0], H[1], H[5]], sharePct: 24, ties: ["coin", "between"], sources: [S], creator: false },
    { id: 2, wallets: [H[2], H[3]], sharePct: 11, ties: ["sol"], sources: [F], creator: false },
  ],
  checked: 6,
  of: 6,
  whole: true,
  observedAt: "2026-11-20T12:00:00.000Z",
  stale: false,
};

test("the answer is read only in the engine's shape", () => {
  const read = linksOf(ANSWER);
  assert.deepEqual(read, ANSWER);
  const odd = linksOf({ ...ANSWER, nodes: [...ANSWER.nodes, { owner: "nope" }], edges: [...ANSWER.edges, { from: H[0], to: H[1], kind: "rumour" }] });
  assert.equal(odd.nodes.length, 6);
  assert.equal(odd.edges.length, 5, "a link of a kind the engine does not say is not drawn");
  assert.equal(linksOf({ none: { code: "CLOSED" } }), null);
  assert.equal(groupedShare(read), 35);
  assert.equal(groupedShare({ groups: [] }), null);
});

test("the map is laid out the same every time: each group around its shared wallet, nothing overlapping, the box fits all", () => {
  const one = layoutMap(ANSWER);
  assert.deepEqual(layoutMap(ANSWER), one, "stable: the same answer is the same picture");
  assert.equal(one.nodes.length, 6);
  assert.equal(one.sources.length, 2);
  assert.equal(one.lines.length, 5);
  const marks = [...one.nodes.map((node) => ({ ...node, key: node.owner })), ...one.sources.map((source) => ({ ...source, key: source.wallet, r: SOURCE_SIZE }))];
  for (let i = 0; i < marks.length; i += 1) {
    for (let j = i + 1; j < marks.length; j += 1) {
      const a = marks[i];
      const b = marks[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r, `${a.key} and ${b.key} overlap`);
    }
    const mark = marks[i];
    assert.ok(mark.x - mark.r >= one.box.x && mark.x + mark.r <= one.box.x + one.box.width && mark.y - mark.r >= one.box.y && mark.y + mark.r <= one.box.y + one.box.height, `${mark.key} stands in the box`);
  }
  const x = (owner) => one.nodes.find((node) => node.owner === owner).x;
  const groupOne = [H[0], H[1], H[5]].map(x);
  const groupTwo = [H[2], H[3]].map(x);
  assert.ok(Math.max(...groupOne) < Math.min(...groupTwo), "the largest group stands first, left of the next");
  assert.ok(Math.max(...groupTwo) < x(H[4]), "the holder not linked stands last");
  const source = one.sources.find((item) => item.wallet === S);
  assert.equal(source.group, 1);
  assert.ok(Math.abs(source.x - groupOne.reduce((sum, v) => sum + v, 0) / 3) < 60, "the shared wallet stands among its group");
  assert.equal(one.lines.find((line) => line.kind === "between").group, 1);
});

test("a bubble's size is its share, within bounds; groups past the palette take its colours again", () => {
  assert.equal(radiusOf(0), 8);
  assert.equal(radiusOf(null), 8);
  assert.equal(radiusOf(25), 38);
  assert.equal(radiusOf(90), 40);
  assert.ok(radiusOf(4) > radiusOf(1));
  assert.equal(toneOf(1), 1);
  assert.equal(toneOf(GROUP_TONES), GROUP_TONES);
  assert.equal(toneOf(GROUP_TONES + 1), 1);
  assert.equal(shareText(24), "24%");
  assert.equal(shareText(4.56), "4.6%");
  assert.equal(shareText(null), "—");
  const empty = layoutMap({ nodes: [], sources: [], edges: [], groups: [] });
  assert.deepEqual(empty.nodes, []);
  assert.ok(empty.box.width > 0 && empty.box.height > 0);
});

test("the words count in both languages", () => {
  assert.equal(HOLDER_MAP.en.groups(1, "12%"), "1 group holds 12%");
  assert.equal(HOLDER_MAP.en.groups(3, "34%"), "3 groups hold 34%");
  assert.equal(HOLDER_MAP.uk.groups(1, "12%"), "1 група тримає 12%");
  assert.equal(HOLDER_MAP.uk.groups(3, "34%"), "3 групи тримають 34%");
  assert.equal(HOLDER_MAP.uk.groups(5, "34%"), "5 груп тримають 34%");
  assert.equal(HOLDER_MAP.uk.wallets(2), "2 гаманці");
  assert.equal(HOLDER_MAP.uk.wallets(12), "12 гаманців");
});

test("the map's colours are brand tokens, never the action's amber, the rise's mint or the danger's flare", () => {
  const css = readFileSync(new URL("./map.module.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /--amber|--mint|--flare/);
  for (let tone = 1; tone <= GROUP_TONES; tone += 1) assert.match(css, new RegExp(`\\[data-tone='${tone}'\\]`));
});

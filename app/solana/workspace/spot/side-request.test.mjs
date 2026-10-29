// Run from repo root: node --test app/solana/workspace/spot/side-request.test.mjs
/**
 * B16: the phone's pinned «Купити | Продати» opens the ticket on its side — by the side buttons' own rules — and the
 * workplace's first screen holds the strip, the chart, the bottom panel and the ticket.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { takeSideRequest } from "./side-request.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const free = { side: "BUY", busy: false, review: false, bound: false };

test("a press switches the side and starts from an empty amount; the same side keeps the amount typed", () => {
  assert.equal(takeSideRequest("SELL", free), "switch");
  assert.equal(takeSideRequest("BUY", free), "keep");
  assert.equal(takeSideRequest("BUY", { ...free, side: "SELL" }), "switch");
});

test("nothing moves while an order is on its way or on its Review", () => {
  assert.equal(takeSideRequest("SELL", { ...free, busy: true }), "ignore");
  assert.equal(takeSideRequest("SELL", { ...free, review: true }), "ignore");
  assert.equal(takeSideRequest("BUY", { ...free, side: "SELL", review: true }), "ignore");
});

test("under a plan or a rule's reminder a sale is never set; a purchase is", () => {
  assert.equal(takeSideRequest("SELL", { ...free, bound: true }), "ignore");
  assert.equal(takeSideRequest("BUY", { ...free, bound: true }), "keep");
});

test("the ticket takes each press once, as the market order, through the same rule", () => {
  const ticket = read("./spot-ticket.tsx");
  assert.match(ticket, /handledSideRequest\.current === sideRequest\.at/);
  assert.match(ticket, /takeSideRequest\(sideRequest\.side, \{ side, busy: busy \|\| limitBusy, review: stage === "review", bound \}\)/);
  assert.match(ticket, /setDraft\(\(current\) => \(\{ \.\.\.current, type: "market"/);
});

test("the workplace: one strip with the presets, the core's terminal on a desk, the phone's pinned pair", () => {
  const workspace = read("./spot-workspace.tsx");
  const terminal = read("./spot-terminal.tsx");
  const layout = read("./spot-layout.ts");
  const css = read("./spot.module.css");
  /* A desk: the core's terminal with the page's panels, «Щільно» as a trader reads it. */
  assert.match(workspace, /<SpotTerminal panels=\{deskPanels\}/);
  assert.match(terminal, /from "@ryntra\/core\/terminal"/);
  assert.match(terminal, /<Terminal page=\{SPOT_LAYOUT_PAGE\}/);
  assert.match(layout, /group: "g-market", views: \["trades", "holders", "pools", "risk", "analytics"\]/);
  assert.match(layout, /group: "g-ticket", views: \["ticket", "about"\]/);
  assert.match(layout, /group: "g-account", views: \["orders", "position", "history"\]/);
  assert.match(workspace, /<TokenAbout /);
  /* A phone: the strip, the chart, the segment and the pinned «Купити | Продати» — the core's buttons. */
  assert.match(workspace, /data-trade-bar/);
  assert.match(workspace, /openTrade\("BUY", event\.currentTarget\)/);
  assert.match(workspace, /openTrade\("SELL", event\.currentTarget\)/);
  /* The pinned pair sits above the frame's bottom bar, never under it. */
  assert.match(css, /\.tradeBar \{[^}]*var\(--sol-phonebar-h, 64px\)/);
  /* «Аналітика» is a tab of the panel, not a card between the chart and the tabs. */
  assert.match(workspace, /const analytics = <EvidenceCard /);
  assert.match(workspace, /analytics: \{ title: text\("Analytics"\), children: analytics \}/);
});

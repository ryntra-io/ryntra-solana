import assert from "node:assert/strict";
import test from "node:test";

import { startNotifySources } from "./sources.ts";
import { useBeacons } from "../beacon/store.ts";
import { useFeed } from "../feed/store.ts";
import { useSpot } from "../trade/spot-store.ts";

/* CITY-87: what the city already knows is said through the centre — only what changed after the page opened. */

const feedEvent = (id, kind = "gainers") => ({ id, key: `k${id}`, kind, tone: "up", title: `T${id}`, line: `L${id}`, image: null, at: Date.now(), source: "Jupiter", detail: null, spark: null, target: { tower: `M${id}` } });

test("the feed: the visit's first events are known; a later one is said, once", () => {
  const said = [];
  useFeed.setState({ memory: { ...useFeed.getState().memory, events: [feedEvent(1), feedEvent(2)] } });
  const stop = startNotifySources((note) => said.push(note));
  useFeed.setState({ memory: { ...useFeed.getState().memory, events: [feedEvent(3, "coins"), feedEvent(2), feedEvent(1)] } });
  useFeed.setState({ memory: { ...useFeed.getState().memory, events: [feedEvent(3, "coins"), feedEvent(2), feedEvent(1)] } });
  stop();
  assert.deepEqual(said.map((n) => [n.kind, n.title, n.tower]), [["coins", "T3", "M3"]]);
});

test("the beacons: one that fired after the page opened is said once; a firing read again from the server is not news", () => {
  const said = [];
  const rule = { id: "b1", mint: "MINTB", symbol: "BONK", on: true, version: 1, notify: false };
  const stop = startNotifySources((note) => said.push(note));
  const old = Date.now() - 60 * 60_000;
  useBeacons.setState({ rules: [rule], states: { b1: { version: 1, spent: false, state: { armed: false, since: null, firedAt: old, seen: false } } }, glow: new Map([["MINTB", "lit"]]) });
  const now = Date.now() + 5;
  useBeacons.setState({ states: { b1: { version: 1, spent: false, state: { armed: false, since: null, firedAt: now, seen: false } } }, glow: new Map([["MINTB", "lit"]]) });
  useBeacons.setState({ states: { b1: { version: 1, spent: false, state: { armed: false, since: null, firedAt: now, seen: true } } } });
  stop();
  assert.deepEqual(said.map((n) => [n.kind, n.tower]), [["beacons", "MINTB"]]);
  assert.match(said[0].title, /BONK/);
});

test("the stops: a stop turning reached is said; another wallet's list arriving is its first read, not news", () => {
  const said = [];
  const stop = (id, owner, state) => ({ id, owner, side: "sell", base: { mint: "MINTS", symbol: "WIF", decimals: 6, name: "dogwifhat" }, quote: { mint: "USDC", symbol: "USDC", decimals: 6 }, amountRaw: "1", price: "1", thresholdRaw: "1", createdAt: 0, expiresAt: null, state, reachedAt: null });
  useSpot.setState({ stops: [] });
  const off = startNotifySources((note) => said.push(note));
  useSpot.setState({ stops: [stop("s0", "OTHER", "reached")] });
  useSpot.setState({ stops: [stop("s1", "OTHER", "watching")] });
  useSpot.setState({ stops: [stop("s1", "OTHER", "reached")] });
  off();
  assert.deepEqual(said.map((n) => [n.kind, n.tower]), [["stops", "MINTS"]]);
});

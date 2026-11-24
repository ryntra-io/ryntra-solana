import assert from "node:assert/strict";
import test from "node:test";

import { BAND_ACTIONS, BAND_PARTS, VIEWERS, bandOf, isBandAction } from "./exposure.ts";

/* The band «what others see»: four cells — who, to whom, what, how much — before every private signature,
   from the facts of the devnet probe (docs/research/ryntra-private-2026-11-18/PROBE.md) and Helius's own documents;
   never more hidden than they show. */

const four = (band) => Object.fromEntries(band.cells.map(({ part, shown }) => [part, shown]));
const row = (band, viewer) => Object.fromEntries(band.rows.find((r) => r.viewer === viewer).cells.map(({ part, shown }) => [part, shown]));
const SEEN = { who: "seen", to: "seen", what: "seen", amount: "seen" };
const INSIDE = { who: "seen", to: "seen", what: "hidden", amount: "hidden" };

test("the band has four cells in reading order for each of the seven actions", () => {
  assert.deepEqual([...BAND_PARTS], ["who", "to", "what", "amount"]);
  assert.deepEqual([...BAND_ACTIONS], ["hide", "return", "send", "payout", "invoice", "swap", "routeSwap"]);
  for (const action of BAND_ACTIONS) {
    for (const mode of ["private", "open"]) {
      const band = bandOf(action, mode);
      assert.deepEqual(band.cells.map((c) => c.part), [...BAND_PARTS], `${action} ${mode}`);
      for (const { shown } of band.cells) assert.ok(shown === "seen" || shown === "hidden", `${action}: a cell says seen or hidden`);
      assert.equal(band.rows[0].viewer, "everyone", "everyone first");
      assert.deepEqual(band.rows[0].cells, band.cells, "the band is what everyone sees");
    }
  }
});

test("the ring's edge is seen whole: Hide and Return show who, to whom, what and how much", () => {
  assert.deepEqual(four(bandOf("hide")), SEEN, "the depositor pays the vault in the open");
  assert.deepEqual(four(bandOf("return")), SEEN, "the vault pays the wallet in the open");
  assert.ok(bandOf("hide").allSeen && bandOf("return").allSeen);
  assert.deepEqual(four(bandOf("hide", "open")), SEEN, "the edge has no open twin");
  assert.equal(bandOf("return", "open").mode, "private", "the mode does not change the edge");
});

test("inside the ring the coin and the amount are hidden, the parties are not", () => {
  for (const action of ["send", "payout", "invoice", "swap"]) {
    const band = bandOf(action);
    assert.deepEqual(four(band), INSIDE, action);
    assert.equal(band.allSeen, false, action);
  }
});

test("the recipient of a transfer is never promised hidden: the default ring keeps the parties public", () => {
  for (const action of BAND_ACTIONS) for (const mode of ["private", "open"]) assert.equal(four(bandOf(action, mode)).to, "seen", `${action} ${mode}`);
  for (const action of BAND_ACTIONS) assert.equal(four(bandOf(action)).who, "seen", `${action}: the signer is seen`);
});

test("those you gave a view and the proof server see all four; the open mode has neither", () => {
  for (const action of BAND_ACTIONS) {
    const band = bandOf(action);
    assert.deepEqual(band.rows.map((r) => r.viewer), [...VIEWERS], action);
    assert.deepEqual(row(band, "viewers"), SEEN, `${action}: a view reads the whole history`);
    assert.deepEqual(row(band, "prover"), SEEN, `${action}: the prover gets the whole transfer`);
  }
  for (const action of ["send", "payout", "invoice", "swap"]) {
    const open = bandOf(action, "open");
    assert.equal(open.mode, "open");
    assert.deepEqual(four(open), SEEN, `${action}: ordinary Solana shows everything`);
    assert.deepEqual(open.rows.map((r) => r.viewer), ["everyone"], `${action}: nothing to view, nothing to prove`);
    assert.equal(open.checked, "chain");
  }
});

test("a swap by a market route says the truth: the trade is seen whole, in any mode", () => {
  for (const mode of ["private", "open"]) {
    const band = bandOf("routeSwap", mode);
    assert.deepEqual(four(band), SEEN, `${mode}: who, the coins and the amounts of the trade are on chain`);
    assert.equal(band.mode, "private", "the edge has no open twin");
    assert.equal(band.allSeen, true);
    assert.equal(band.checked, "local", "an offline run of the SDK, not yet devnet");
  }
});

test("each fact says where it was confirmed: the desk's swap is a local run, the rest devnet", () => {
  for (const action of ["hide", "return", "send", "payout", "invoice"]) assert.equal(bandOf(action).checked, "devnet", action);
  assert.equal(bandOf("swap").checked, "local");
});

test("the band's mode defaults to private, and only the seven actions are bands", () => {
  assert.equal(bandOf("send").mode, "private");
  for (const action of BAND_ACTIONS) assert.ok(isBandAction(action));
  for (const other of ["link", "enable", "claimWallet", "", null, 3, "SEND"]) assert.equal(isBandAction(other), false, String(other));
});

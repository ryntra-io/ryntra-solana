import assert from "node:assert/strict";
import test from "node:test";

import { createLatestAccountRequestGate } from "./latest-account-request.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("latest account request wins when an older response resolves last", async () => {
  const walletA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const walletB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const gate = createLatestAccountRequestGate();
  const committed = [];

  const oldResponse = deferred();
  const oldTicket = gate.begin(walletA);
  const oldCommit = oldResponse.promise.then((value) => {
    if (gate.accepts(oldTicket, walletB)) committed.push(value);
  });

  const newResponse = deferred();
  const newTicket = gate.begin(walletB.toUpperCase());
  const newCommit = newResponse.promise.then((value) => {
    if (gate.accepts(newTicket, walletB)) committed.push(value);
  });

  assert.equal(oldTicket.signal.aborted, true);
  newResponse.resolve("wallet-b");
  oldResponse.resolve("wallet-a");
  await Promise.all([oldCommit, newCommit]);
  assert.deepEqual(committed, ["wallet-b"]);
});

test("the current ticket cannot commit under a different current address", () => {
  const walletA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const walletB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const gate = createLatestAccountRequestGate();
  const ticket = gate.begin(`  ${walletA.toUpperCase()}  `);

  assert.equal(gate.accepts(ticket, walletA), true, "address comparison is normalized");
  assert.equal(gate.accepts(ticket, walletB), false, "a route/address change invalidates the commit");
});

test("cancel invalidates the active request without canceling a newer ticket by mistake", () => {
  const walletA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const walletB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const gate = createLatestAccountRequestGate();
  const oldTicket = gate.begin(walletA);
  const newTicket = gate.begin(walletB);

  gate.cancel(oldTicket);
  assert.equal(gate.accepts(newTicket, walletB), true);
  gate.cancel(newTicket);
  assert.equal(newTicket.signal.aborted, true);
  assert.equal(gate.accepts(newTicket, walletB), false);
});

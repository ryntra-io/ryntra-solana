// Run from repo root: node --test app/shell/connection.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONNECTION_CAPABILITIES,
  CONNECTION_ERROR_KINDS,
  CONNECTION_STATES,
  can,
  connectionState,
  isAttached,
  showsError,
} from "./connection.ts";
import { needsDevelopmentRepository } from "../../lib/development-repository.mjs";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const CONTROL = read("app/shell/connection-control.tsx");
/* Comments explain what was removed and name it; only shipped code is scanned. */
const CONTROL_CODE = CONTROL.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const A = "0x1111111111111111111111111111111111111111";

/** A snapshot with everything false, so each case states only what it changes. */
const base = (over) => ({
  available: false,
  connecting: false,
  address: null,
  onExpectedNetwork: false,
  capabilities: [],
  error: null,
  ...over,
});

test("the derivation is exhaustive over the inputs that decide it", () => {
  /*
   * The truth table one hub's wallet machine was proven against, carried across
   * whole rather than re-derived. Its five trigger states were the only
   * wallet behaviour in this product exercised against a real chain with real
   * signatures, and the standard names it the behavioural seed — so the generic
   * contract has to agree with it on every row, not merely resemble it.
   *
   * Two rows are the ones a rewrite gets wrong. A page with no connector but a
   * stale `connecting` flag answers UNAVAILABLE, because the fact a person
   * needs is the missing wallet. And a connected wallet that refused something
   * stays CONNECTED — the refusal is additive, asserted separately below.
   */
  const cases = [
    // available, connecting, address, onExpectedNetwork, expected
    [false, false, null, false, "UNAVAILABLE"],
    [false, false, null, true, "UNAVAILABLE"],
    [false, false, A, false, "UNAVAILABLE"],
    [false, false, A, true, "UNAVAILABLE"],
    [false, true, null, false, "UNAVAILABLE"],
    [false, true, null, true, "UNAVAILABLE"],
    [false, true, A, false, "UNAVAILABLE"],
    [false, true, A, true, "UNAVAILABLE"],
    [true, true, null, false, "CONNECTING"],
    [true, true, null, true, "CONNECTING"],
    [true, true, A, false, "CONNECTING"],
    [true, true, A, true, "CONNECTING"],
    [true, false, null, false, "DISCONNECTED"],
    [true, false, null, true, "DISCONNECTED"],
    [true, false, A, false, "WRONG_NETWORK"],
    [true, false, A, true, "CONNECTED"],
  ];

  for (const [available, connecting, address, onExpectedNetwork, expected] of cases) {
    assert.equal(
      connectionState(base({ available, connecting, address, onExpectedNetwork })),
      expected,
      JSON.stringify({ available, connecting, address, onExpectedNetwork }),
    );
  }
});

test("an error replaces a state only when there is no connection left to describe", () => {
  const refusal = "User rejected the request.";

  /* Nothing connected: the refusal is the whole story. */
  assert.equal(
    connectionState(base({ available: true, error: refusal })),
    "ERROR",
  );

  /* Connected, and something went wrong afterwards — a rejected network switch
     is the everyday case. The trigger must keep the address; replacing it with
     a warning triangle would lose the one thing on screen that identifies what
     would sign. */
  for (const [over, expected] of [
    [{ available: true, address: A, onExpectedNetwork: true }, "CONNECTED"],
    [{ available: true, address: A, onExpectedNetwork: false }, "WRONG_NETWORK"],
    [
      { available: true, address: A, onExpectedNetwork: true, actionPending: true },
      "ACTION_PENDING",
    ],
  ]) {
    const snapshot = base({ ...over, error: refusal });
    assert.equal(connectionState(snapshot), expected, JSON.stringify(over));
    assert.equal(showsError(snapshot), true, "the refusal must still be shown");
  }

  assert.equal(showsError(base({ available: true, address: A })), false);
});

test("an action awaiting authorization never outranks the wrong network", () => {
  /* Authorizing on the wrong network is not possible, so `Waiting…` over it
     would be the chrome promising a signature the next step refuses. */
  assert.equal(
    connectionState(
      base({ available: true, address: A, onExpectedNetwork: false, actionPending: true }),
    ),
    "WRONG_NETWORK",
  );
});

test("a capability is offered only when it is proven and the state can exercise it", () => {
  const connected = base({
    available: true,
    address: A,
    onExpectedNetwork: true,
    capabilities: ["READ", "SIGN_TX", "SWITCH_NETWORK"],
  });

  assert.equal(can(connected, "SIGN_TX"), true);
  /* Absent means absent — never inferred from the workspace, its environment
     chip, or the fact that another route in the same product can do it. */
  assert.equal(can(connected, "SIGN_MESSAGE"), false);

  const wrongNetwork = { ...connected, onExpectedNetwork: false };
  assert.equal(
    can(wrongNetwork, "SIGN_TX"),
    false,
    "a wallet on the wrong network cannot sign here, however capable it is",
  );
  assert.equal(
    can(wrongNetwork, "SWITCH_NETWORK"),
    true,
    "the one capability whose purpose is to be used from the wrong network",
  );

  /* Disconnected can do nothing, even if an adapter over-reports. */
  const disconnected = base({ available: true, capabilities: [...CONNECTION_CAPABILITIES] });
  for (const capability of CONNECTION_CAPABILITIES) {
    assert.equal(can(disconnected, capability), false, capability);
  }

  assert.equal(isAttached(connected), true);
  assert.equal(isAttached(disconnected), false);
});

test("every state the contract declares is one the control actually renders", () => {
  /* A contract the markup ignores is a list, not a contract. Each state has to
     appear in the component, and the copy has to name every one of them — the
     `states` record is keyed by `ConnectionState`, so a missing entry is a
     compile error rather than a blank accessible name. */
  assert.equal(CONNECTION_STATES.length, 7);
  assert.equal(CONNECTION_CAPABILITIES.length, 5);

  for (const state of CONNECTION_STATES) {
    assert.match(CONTROL, new RegExp(`"${state}"`), `the control never renders "${state}"`);
  }

  /* Reached through the derivation, not by re-deciding it here. */
  assert.match(CONTROL, /connectionState\(snapshot\)/);
  assert.match(CONTROL, /showsError\(snapshot\)/);
  assert.match(CONTROL, /can\(snapshot, "SWITCH_NETWORK"\)/);
});

test("the trigger is an address, and it is never an avatar", () => {
  /*
   * The rule that survives every future edit to this component. A profile
   * picture is an identity and a wallet is an authority; Ryntra Home showed one
   * while meaning the other, which teaches people that being signed in is the
   * same as being able to spend.
   */
  assert.match(CONTROL, /adapter\.truncate\(address\)/);
  assert.match(CONTROL, /data-mono=\{address \? "true" : undefined\}/);

  /* Scoped to the trigger, which is what the rule was always about. It used to
     scan the whole file, and the day the panel gained a wallet-choice list the
     ban on `<img>` fired on the wallets' own marks — markup that is not the
     trigger, cannot be the trigger, and is the opposite of an avatar standing
     in for an authority. A boundary sentence that outlives its boundary is
     worse than none, so the boundary moved rather than the rule.
     `avatar`, `photoUrl` and `profilePicture` stay banned file-wide: no part
     of a connection control has any business with a person's face. */
  const TRIGGER = CONTROL_CODE.slice(0, CONTROL_CODE.indexOf("{(close) =>"));
  const TRIGGER_ICON = CONTROL_CODE.slice(CONTROL_CODE.indexOf("function TriggerIcon")).split(/\n(?=function )/)[0];
  /* A slice that silently came back empty would pass every check below without
     reading a line of the thing it guards. */
  assert.ok(TRIGGER.includes("ShellMenu"), "The trigger slice missed the ShellMenu props; this gate is scanning nothing.");
  assert.ok(TRIGGER_ICON.includes("WalletIcon"), "The TriggerIcon slice missed the icon; this gate is scanning nothing.");

  for (const region of [TRIGGER, TRIGGER_ICON]) {
    assert.doesNotMatch(region, /<img/, "the connection trigger must render no image");
  }
  for (const banned of [/avatar/i, /photoUrl/, /profilePicture/]) {
    assert.doesNotMatch(CONTROL_CODE, banned, `the connection control must not use ${banned}`);
  }
});

/**
 * A failure nobody classified is not a refusal.
 *
 * This is the defect a person hit on `ryntra.io`. MetaMask held a
 * `wallet_requestPermissions` it had already been asked for, threw `-32002`,
 * and the panel titled it "The wallet refused" over a retry that could never
 * clear it — the request was open inside the extension and nothing on the page
 * could reach it. Nobody had refused anything, and the one instruction that
 * would have ended it was on no surface.
 */
test("an unclassified failure is never reported as a refusal", () => {
  assert.equal(CONNECTION_ERROR_KINDS.length, 3);
  /* Named, not quoted: `REFUSED` reaches the control as a catalog key and the
     other two as comparisons, and demanding one spelling would have this gate
     enforce a syntax rather than a vocabulary. */
  for (const kind of CONNECTION_ERROR_KINDS) {
    assert.match(CONTROL_CODE, new RegExp(`\\b${kind}\\b`), `the control never names the ${kind} failure`);
  }

  /* The floor is `FAILED`, reached by omission rather than by guessing. */
  assert.match(CONTROL, /snapshot\.errorKind \?\? "FAILED"/);

  const catalog = CONTROL.slice(CONTROL.indexOf("export const DEFAULT_COPY"));
  assert.ok(catalog.length > 0, "DEFAULT_COPY is gone; this gate is scanning nothing.");
  const floor = /errorTitle: "([^"]+)"/.exec(catalog)?.[1];
  assert.ok(floor, "DEFAULT_COPY lost its floor error title.");
  assert.doesNotMatch(
    floor,
    /refus/i,
    "The title for a failure nobody classified calls it a refusal again.",
  );
  /* And the word is still available where a refusal was actually reported. */
  assert.match(/REFUSED: "([^"]+)"/.exec(catalog)?.[1] ?? "", /refus/i);

  /* The one failure a person cannot answer from this panel is the one that
     carries the instruction naming where they can. */
  assert.match(CONTROL, /kind === "PENDING"/);
  assert.match(CONTROL, /copy\.pendingInWalletBody/);
});

/**
 * More than one wallet, and the person picks.
 *
 * Solana's adapter registered Phantom, MetaMask, OKX Wallet and SquadsX in one
 * browser, ranked them, and connected `wallets[0]`. The score ties whenever no
 * wallet has yet exposed a Solana account — a locked Phantom does exactly that
 * — and the tiebreak is `localeCompare`, so `Connect` reached past the Phantom
 * in the toolbar for the MetaMask that sorts first. There was no list anywhere
 * on the surface to say so, or to correct it.
 */
test("a page with more than one connector offers the choice", () => {
  assert.match(CONTROL, /adapter\.choices/);
  assert.match(CONTROL, /adapter\.connect\?\.\(choice\.id\)/);
  /* The id, never the index: a list re-ranked between paint and tap would
     otherwise connect a wallet other than the one under the finger. */
  assert.doesNotMatch(CONTROL_CODE, /connect\?\.\(index\)/);

  /* Reachable from a failure too. A list offered only before the first attempt
     strands whoever the ranking already sent to the wrong wallet — which is
     the exact person this list exists for. */
  /* Bounded at the component's end, and this gate caught itself: an unbounded
     slice ran to the bottom of the file, where `function ConnectAction` is
     declared, so it passed over a failure section that had been emptied out.
     A check that reads its own subject's definition is measuring nothing. */
  const failure = CONTROL.slice(CONTROL.indexOf("showsError(snapshot)")).split(/\n(?=function )/)[0];
  assert.ok(failure.includes("copy.retry"), "The failure slice missed the section; this gate is scanning nothing.");
  assert.ok(failure.includes("ConnectAction"), "The failure section offers no way back to the wallet list.");
});

test("every record states the counts the contract actually produces", { skip: needsDevelopmentRepository("the development records it reads") }, () => {
  /* Positive, derived from the code. A guard that blacklists one false spelling
     can be satisfied by saying something else false or by saying nothing; this
     demands the true sentence, and the numbers in it come from the arrays — so
     growing the contract to eight states fails every document still claiming
     seven. */
  const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const contract = `Connection contract: ${WORDS[CONNECTION_STATES.length]} states; ${WORDS[CONNECTION_CAPABILITIES.length]} capabilities.`;

  for (const doc of ["docs/STATE.md", "docs/tasks/active/RYN-SHELL-V2-001.md"]) {
    const lines = read(doc)
      .split(/\r?\n/)
      .map((line) => line.replaceAll("*", "").trim());
    assert.equal(
      lines.filter((line) => line === contract).length,
      1,
      `${doc} must contain exactly one standalone canonical line: ${contract}`,
    );
  }
});

test("a connection made from the open panel closes it, and a browser with no wallet is shown the way on", () => {
  /* A beginner's walk on a phone stopped under
     the panel after connecting, and a phone's browser with no wallet read a
     sentence about the Wallet Standard with no way on. */
  assert.match(CONTROL_CODE, /<CloseOnConnect address=\{address\} close=\{close\} \/>/);
  assert.match(CONTROL_CODE, /if \(atOpen\.current === null && address !== null\) close\(\);/, "only a connection made while the panel was open closes it");
  const unavailable = CONTROL_CODE.slice(CONTROL_CODE.indexOf('state === "UNAVAILABLE"')).split("</section>")[0];
  assert.ok(unavailable.includes("{unavailable}"), "the no-wallet section renders the way on");
  const solana = read("app/solana/workspace/connection.tsx").replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.doesNotMatch(solana, /Wallet Standard this page reads/, "the panel explains no protocol to a beginner");
  assert.match(solana, /phantomBrowseUrl\(window\.location\.href, window\.location\.origin\)/, "a phone is offered this page inside Phantom");
  assert.match(solana, /PHANTOM_DOWNLOAD_URL/, "a computer is told where to get a wallet");
});

// Shared fixtures for the Hack sandbox's tests and the recorded scenario (CITY-224). Not a test file itself (no
// `.test.mjs`), so the runner never executes it. It loads the Hack library's fixtures first (they register the world's
// TypeScript hooks), then the sandbox and the made-up engine.
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { addr, hack, makeFinding, makeGrant, makeOrder, verify, AT, PROGRAM, PROTOCOL, OWNER_A, WINDOW } from "../fixtures.mjs";

export const sb = await import("./index.ts");
export const toy = await import("./toy.ts");
export const judgeLib = await import("../../../../../lib/ring/judge/index.ts");

export { addr, hack, makeFinding, makeGrant, makeOrder, verify, AT, PROGRAM, PROTOCOL, OWNER_A, WINDOW };

// The copy: the made-up «tally» program at the order's program address, one vault, the protocol's own balance.
export const VAULT = addr(10);
export const PROTOCOL_BAL = addr(11);
// The attacker's own key and the two balances it opens in the copy.
export const ATTACKER = addr(20);
export const BAL_A = addr(21);
export const BAL_B = addr(22);

export const SLOT = 250_000_000;
export const RECORDED_AT = "2026-11-08T12:00:00.000Z";
export const UNIX = Date.parse(RECORDED_AT) / 1_000;
export const TARGET = { kind: "fork", program: PROGRAM, slot: SLOT };
export const CLAIM = { invariant: "conserved", version: "1" };
export const CHECK = toy.conservedCheck(VAULT);

export function makeSnapshot(over = {}) {
  return {
    format: sb.SNAPSHOT_FORMAT,
    source: { kind: "recorded", label: "CITY-224 stand: the made-up tally program", recordedAt: RECORDED_AT },
    slot: SLOT,
    unixTimestamp: UNIX,
    programs: [{ address: PROGRAM, bytes: Buffer.from(toy.TALLY_BYTES).toString("base64") }],
    accounts: [
      { address: VAULT, owner: PROGRAM, lamports: "1000000000", data: toy.toyData({ t: "vault", supply: 1_000_000, accounts: [PROTOCOL_BAL] }), executable: false },
      { address: PROTOCOL_BAL, owner: PROGRAM, lamports: String(toy.TOY_RENT), data: toy.toyData({ t: "bal", vault: VAULT, owner: PROTOCOL, amount: 1_000_000 }), executable: false },
    ],
    ...over,
  };
}

const ix = (op, args) => ({ program: PROGRAM, op, args });
/** One transaction of the attacker's, as the agent hands it in. */
export const tx = (...ixs) => ({ tx: toy.toyTx(ATTACKER, ixs) });

/** Open two balances and put 1000 into the first. */
export const SETUP = [tx(ix("open", { vault: VAULT, account: BAL_A }), ix("open", { vault: VAULT, account: BAL_B })), tx(ix("deposit", { account: BAL_A, amount: 1_000 }))];
/** The finding reproduces: `split` pays 1000 in three instalments and credits 3000. */
export const REPRODUCES = [...SETUP, tx(ix("split", { from: BAL_A, to: BAL_B, amount: 1_000, parts: 3 }))];
/** The finding does not reproduce: the protocol's balance cannot be moved without its key; an honest move conserves. */
export const NOT_REPRODUCED = [...SETUP, tx(ix("move", { from: PROTOCOL_BAL, to: BAL_B, amount: 500_000 })), tx(ix("move", { from: BAL_A, to: BAL_B, amount: 1_000 }))];

/** A store of recorded states: the one a pin names, or `null`. A lookup, never a fetch. */
export const recorded =
  (...snapshots) =>
  (pin) =>
    snapshots.find((s) => sb.snapshotMatches(s, pin)) ?? null;

export const pinFor = (snapshot = makeSnapshot(), target = TARGET) => sb.pinOf(snapshot, target, toy.TOY_ENGINE);

/** A sandbox over the made-up engine; the wall clock is a counter the test moves. */
export function makeSandbox({ snapshots = [makeSnapshot()], engine = toy.createToyEngine, invariants = [CHECK], clock = { t: 1_000 } } = {}) {
  return sb.createHackSandbox({ engine, snapshot: recorded(...snapshots), invariants, now: () => clock.t });
}

export function attempt(over = {}) {
  return { runId: "run-1", pin: pinFor(), target: TARGET, claim: CLAIM, actors: [ATTACKER], inputs: REPRODUCES, ...over };
}

// The harness's stamp key: fresh for each test process, never in the repository.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
export const stamp = judgeLib.createStamper(privateKey);
export const verifyStamp = judgeLib.stampVerifier([judgeLib.signerOf(publicKey)]);
export const proveContext = (over = {}) => ({ stamp, verifyStamp, at: AT, window: WINDOW, ...over });

/** An open order whose scope is the made-up program's split and move, with the protocol's grant. */
export function orderFor() {
  const order = makeOrder({ status: "open", target: TARGET, scope: { programs: [PROGRAM], instructions: ["split", "move"] } });
  return { order, grant: makeGrant(order) };
}

/** The attacker's finding on the order, tied to a run by its log hash. */
export const findingFor = (order, logHash, over = {}) =>
  makeFinding(order, { target: { program: PROGRAM, instruction: "split" }, vulnClass: "accounting", title: "Split credits every instalment in full", logHash, ...over });

/** The recorded scenario of the stand (`fixtures/scenario.json`), with the log hashes it was recorded with. */
export const SCENARIO_PATH = new URL("./fixtures/scenario.json", import.meta.url);
export const readScenario = () => JSON.parse(readFileSync(SCENARIO_PATH, "utf8"));

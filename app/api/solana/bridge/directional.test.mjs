import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The property this row exists to establish: **nothing works out which way a
 * transfer goes.**
 *
 * Before it, the lane had a direction in one registry file and an assumption
 * in every route. `plan` asked Circle for `SOLANA_TO_BASE`, `attestation`
 * hard-coded destination domain 6, `mint` only knew how to build a Base call,
 * and `receipt` named Solana as the source in its schema. Each of those read
 * like shared code. Building a second direction on top of them would have
 * produced the worst defect a money product can have — a screen that says one
 * thing while a hidden half of the system does another — so this file pins the
 * rule rather than the current wording of any one route.
 *
 * Every route that acts on a transfer already under way takes the direction
 * from the **durable claim**, which was written when the burn was claimed. A
 * request cannot choose it, a route name cannot imply it, and the shape of an
 * address cannot be asked to stand in for it.
 */

const read = (path) => readFileSync(path, "utf8");

const BASE = "app/api/solana/bridge";
const PLAN = `${BASE}/plan/route.ts`;
const BURN = `${BASE}/burn/route.ts`;
const BASE_BURN = `${BASE}/base-burn/route.ts`;
const ATTESTATION = `${BASE}/attestation/route.ts`;
const MINT = `${BASE}/mint/route.ts`;
const RECEIVE = `${BASE}/receive/route.ts`;
const OBSERVE = `${BASE}/observe/route.ts`;
const RECEIPT = `${BASE}/receipt/route.ts`;
const RECOVER = `${BASE}/recover/route.ts`;
const BALANCES = `${BASE}/balances/route.ts`;
const LOOKUP = `${BASE}/lookup-table/route.ts`;

/** Every route that continues a transfer somebody already started. */
const IN_FLIGHT = [ATTESTATION, MINT, RECEIVE, OBSERVE, RECEIPT, RECOVER];

test("the direction of a transfer already under way is read from its claim, never from the request", () => {
  for (const path of IN_FLIGHT) {
    const source = read(path);
    assert.match(source, /readCctpBurnClaim\(/, `${path} does not read the durable claim.`);
    assert.match(
      source,
      /(?:claim\.record|record)\.direction/,
      `${path} never reads the direction the transfer was claimed under.`,
    );
  }
});

test("no route infers a direction from an address shape or from its own name", () => {
  for (const path of [PLAN, BURN, BASE_BURN, ...IN_FLIGHT]) {
    const source = read(path);
    /* A route that decided the lane by testing whether something looked like a
       `0x` address would be right until somebody typed a Solana address into
       the wrong field, and then it would be confidently wrong about where the
       money was going. Address patterns validate; they never decide. */
    assert.doesNotMatch(
      source,
      /direction\s*=\s*[^;\n]*(?:test\(|startsWith\(|includes\(")/,
      `${path} works out the direction from the shape of a string.`,
    );
    assert.doesNotMatch(
      source,
      /direction\s*=\s*[^;\n]*request\.url/,
      `${path} works out the direction from its own route.`,
    );
  }
});

/**
 * Since 2026-09-05 a route serves one *kind* of lane rather than one lane: the
 * Solana burn serves every Solana-source direction, the EVM burn every
 * EVM-source direction, and each says so by asking the direction module rather
 * than by naming Base. What must never happen is the thing the literals used
 * to guard against — a Solana burn accepting an EVM-source plan or the
 * reverse — and that is still asserted, in the form it now takes.
 */
test("each submitting route serves exactly one kind of lane and says so before it acts", () => {
  const forward = read(BURN);
  assert.match(forward, /!isSolanaSourceDirection\(plan\.direction\)/, "The Solana burn accepts an EVM-source plan.");
  assert.match(forward, /PLAN_UNSUPPORTED/);
  assert.doesNotMatch(forward, /isEvmSourceDirection\(plan\.direction\)\s*\)/, "The Solana burn must not serve EVM-source plans.");

  const reverse = read(BASE_BURN);
  assert.match(reverse, /!isEvmSourceDirection\(plan\.direction\)/, "The EVM burn accepts a Solana-source plan.");
  assert.match(reverse, /!isEvmSourceDirection\(claim\.record\.direction\)/, "The EVM burn records against the wrong kind of lane.");
  /* The chain each phase reads is the plan's or the claim's, asked for by
     name — never a handle made before the direction is known. */
  assert.match(reverse, /handleFor\(lane\.evmChain\)/);
  assert.doesNotMatch(reverse, /createBaseRpcHandle\(/, "The EVM burn still makes a Base handle before it knows the chain.");

  const receive = read(RECEIVE);
  assert.match(
    receive,
    /claim\.record\.direction !== "BASE_TO_SOLANA" && claim\.record\.direction !== "ETHEREUM_TO_SOLANA"/,
    "The Solana receive accepts a transfer that does not arrive on Solana.",
  );
  assert.match(receive, /direction: claim\.record\.direction/, "The Solana receive asks Circle for a lane it did not read from the claim.");
});

/**
 * The reverse lane's boundary, which is inverted for a reason and must stay
 * inverted for that reason.
 *
 * An EVM wallet signs and broadcasts in one call, so there is no moment
 * between a person approving and the money leaving for a server to hold a
 * claim in. The claim is therefore taken *before* the wallet opens.
 */
test("the Base burn is claimed before the wallet opens, and released only on chain evidence", () => {
  const source = read(BASE_BURN);
  const arm = source.slice(source.indexOf("async function arm("), source.indexOf("async function record("));
  assert.ok(arm.length > 0, "The arming phase is missing.");

  /* The claim and the crossing both happen before any calldata is returned. */
  const claimed = arm.indexOf("claimCctpBurn(");
  const crossed = arm.indexOf("markCctpSourceArmed(");
  const returned = arm.indexOf("Response.json(");
  assert.ok(claimed !== -1 && crossed !== -1 && returned !== -1, "The arming phase lost one of its three steps.");
  assert.ok(claimed < crossed, "The boundary is crossed before the intent is claimed.");
  assert.ok(crossed < returned, "The calldata is handed out before the boundary is crossed.");

  /* And the count that will later prove nothing was sent is read first. */
  assert.ok(
    arm.indexOf("eth_getTransactionCount") < claimed,
    "The source account's position is read after the claim, so a release could not be proved.",
  );

  const abandon = source.slice(source.indexOf("async function abandon("));
  assert.match(abandon, /eth_getTransactionCount/, "A release is granted without asking the chain.");
  assert.match(abandon, /markCctpBurnNeverBroadcast\(/);
  /* The client's account of what happened decides nothing. */
  assert.doesNotMatch(abandon, /input\.(?:sent|declined|refused)/, "The release trusts something the caller said.");
});

test("the receiving route trusts Circle's own message and not the one it was handed", () => {
  const source = read(RECEIVE);
  const fetched = source.indexOf("fetchCctpAttestation(");
  const checked = source.indexOf("checkCctpSignedReceive(");
  const submitted = source.indexOf("sendTransactionOnce(");
  assert.ok(fetched !== -1 && checked !== -1 && submitted !== -1, "The receiving route lost one of its three steps.");
  assert.ok(fetched < checked, "The signature is checked against a message the caller supplied.");
  assert.ok(checked < submitted, "Bytes are submitted before they are checked.");
  /* The message the check compares against comes from the attestation, so a
     caller cannot both produce the signature and choose what it is measured
     against. */
  assert.match(source, /messageHex: attestation\.attested\.messageHex/);
  assert.match(source, /attestationHex: attestation\.attested\.attestationHex/);
  /* Submitted once, with no loop and no retry around it. */
  assert.equal((source.match(/sendTransactionOnce\(/g) ?? []).length, 1);
});

test("the destination step is built for the chain the transfer is arriving on", () => {
  const source = read(MINT);
  assert.match(source, /planBaseCctpMint\(/, "The Base destination step is missing.");
  assert.match(source, /planSolanaCctpReceive\(/, "The Solana destination step is missing.");
  /* On a Solana destination the recipient is read out of the signed message
     rather than taken from the request: the replay credits the account the
     message names, and a request that could nominate another one would be a
     request to send somebody else's money somewhere else. */
  assert.match(source, /decodeCctpV2Message\(/);
  assert.match(source, /RECIPIENT_MISMATCH/);
});

test("both destinations are observed, and neither reports an unread chain as an absence", () => {
  const source = read(OBSERVE);
  assert.match(source, /observeBaseCctpMint\(/);
  assert.match(source, /observeSolanaCctpArrival\(/);
  assert.match(source, /reconcileBaseMint\(/);
  assert.match(source, /reconcileSolanaArrival\(/);
});

test("the receipt describes whichever lane the transfer actually took", () => {
  const source = read(RECEIPT);
  assert.match(source, /solanaToEvmFacts\(/);
  assert.match(source, /evmToSolanaFacts\(/);
  /* The builder is chosen by which kind of chain the money left, and the EVM
     chain inside it comes from the claim — never Base by habit. */
  assert.match(source, /isSolanaSourceDirection\(record\.direction\)/);
  assert.match(source, /createEvmRpcHandle\(lane\.evmChain/);
  assert.doesNotMatch(source, /chainRef: "eip155:8453"/, "The receipt still writes Base's chain reference by hand.");
  /* And it refuses a bundle whose plan disagrees with the recorded transfer,
     which is the one way a receipt could describe a lane nobody used. */
  assert.match(source, /DIRECTION_MISMATCH/);
});

test("the read that fills MAX and the limits is a read, on the read budget", () => {
  const source = read(BALANCES);
  assert.match(source, /consumeSolanaReadRequest\(/, "A balance read must not spend the action budget.");
  for (const forbidden of ["claimCctpBurn", "sendTransactionOnce", "sendBaseTransaction", "markCctp"]) {
    assert.ok(!source.includes(forbidden), `The balances route can reach ${forbidden}.`);
  }
  /* The limits are derived from what was just read, never written down. */
  assert.match(source, /cctpProtocolFeeRaw\(/, "The minimum is not derived from Circle's own fee.");
  assert.match(source, /maximumRaw: source\.usdcRaw/, "The maximum is not the sender's own balance.");
});

/**
 * The size of the transaction a person is asked to sign.
 *
 * The first real Base to Solana transfer compiled to 1,226 bytes of Solana's
 * 1,232-byte limit and Phantom blocked it in red. That was not a reputation
 * verdict: Phantom's developer documentation names a transaction at the edge of
 * the packet size as the cause, because a wallet cannot safely simulate one.
 * Six bytes of headroom is a defect on its own terms too — one more attester
 * signature is sixty-five bytes, and the transfer would stop being
 * constructible after the money had already burned on the far side.
 */
test("the receiving step compresses through a lookup table and reports its own size", () => {
  const plan = readFileSync("lib/solana/cctp-receive-plan.ts", "utf8");
  assert.match(plan, /compressTransactionMessageUsingAddressLookupTables/, "The receive never uses a lookup table.");
  assert.match(plan, /readCctpLookupTable\(/);
  assert.match(plan, /wireBytes/, "The plan does not report how large it is.");
  assert.match(plan, /limitBytes: 1232/, "The plan does not know what the limit is.");
});

test("nothing is offered to a wallet before the network has run it", () => {
  const plan = readFileSync("lib/solana/cctp-receive-plan.ts", "utf8");
  /* Phantom's fourth published condition, and the right order regardless of
     which wallet is asked: a person should never approve bytes nobody ran. */
  const simulated = plan.indexOf("simulateTransaction");
  const ready = plan.indexOf('state: "READY"');
  assert.ok(simulated !== -1, "The receive plan never simulates.");
  assert.ok(simulated < ready, "The plan reaches READY before it has simulated.");
  assert.match(plan, /sigVerify: false/);
  assert.match(plan, /!simulation\.succeeded/, "A failing simulation still reaches READY.");
});

/**
 * The lookup table is deployment setup and must stay that.
 *
 * It is signed by a wallet, which makes it the one operator step on this lane
 * that opens a wallet at all — so it has to be impossible for it to touch a
 * transfer while it is there.
 */
test("the lookup-table route cannot reach a transfer, a claim or a burn", () => {
  const source = readFileSync(LOOKUP, "utf8");
  for (const forbidden of [
    "readCctpBurnClaim",
    "claimCctpBurn",
    "markCctp",
    "withCctpBurnBoundary",
    "buildCctpReceiveInstruction",
    "fetchCctpAttestation",
  ]) {
    assert.ok(!source.includes(forbidden), `The lookup-table route can reach ${forbidden}.`);
  }
  /* It holds no key: the authority is the wallet that signs. */
  assert.match(source, /authority: z\.string\(\)/);
  /* And it simulates before it hands anything to a wallet. */
  const simulated = source.indexOf("simulateTransaction");
  const offered = source.indexOf("unsignedWireBase64,");
  assert.ok(simulated !== -1 && simulated < offered, "Setup bytes are offered for signing before being run.");
});

/**
 * The rule the History screen broke, pinned at both ends.
 *
 * Read from production on 2026-09-04: both settled Base → Solana transfers were
 * in the ledger with `destination`, `out`, `in` and `signature` all null, so
 * History called them "Moved to Base" with no amount and no way to open them.
 * Three visible defects, one cause — and the cause was not the display. The
 * terminal write, the one that always happens on a settled transfer and knows
 * the direction it has just proved, recorded none of it, while the forward lane
 * escaped only because its burn route happens to record those fields earlier.
 *
 * A direction the system has established and then discards is the same class of
 * defect this whole file exists to prevent, one step further along: not a route
 * that guesses the direction, but a route that knows it and throws it away.
 */
test("the terminal receipt write records the direction it has just proved", () => {
  const source = read(RECEIPT);
  const at = source.indexOf("recordSolanaAction(store, {");
  assert.ok(at !== -1, "The receipt route no longer writes the person's History row.");
  const call = source.slice(at, source.indexOf("});", at));
  assert.match(call, /destination: historyDestination/, "The settled History row is written without a direction.");
  /* And the direction comes from the signed facts, not from the route it is in
     — the same rule every in-flight route above is held to. Since 2026-09-05
     it resolves to any of the three chains a row can name. */
  const opens = source.lastIndexOf("if (built.historyWallet)", at);
  assert.ok(opens !== -1, "The History write is no longer guarded by the wallet it is written against.");
  const block = source.slice(opens, at);
  assert.match(block, /minted\.facts\.direction/, "The settled row's direction is not read from the signed facts.");
  for (const chain of ['"SOLANA"', '"BASE"', '"ETHEREUM"']) {
    assert.ok(block.includes(chain), `The settled History row cannot resolve to ${chain}.`);
  }
  /* An amount too: a row with a direction and no amount is still unreadable. */
  assert.match(block, /amounts\.(mintedRaw|burnedRaw)/, "The settled row is written without an amount.");
});

/**
 * And the screen that reads those rows must be able to represent both.
 *
 * Its `Action` type said `"BASE" | null`, so the one type the History screen
 * reasons about could not hold a transfer arriving on Solana. That is why no
 * compiler caught the hard-coded label sitting one level below it.
 */
test("the History screen can represent a transfer arriving on Solana", () => {
  const card = read("app/solana/workspace/history/history-card.tsx");
  assert.match(card, /import type \{ SolanaWalletAction \} from "@\/lib\/solana\/action-ledger"/, "History must use the shared direction-aware action contract.");
  /* A row's words live in `history-lines.ts` since B2b, shared with Home's «Останні операції». */
  assert.match(card, /describeAction\(action, text\)/);
  const source = read("app/solana/workspace/history/history-lines.ts");
  assert.match(read("lib/solana/action-ledger.ts"), /destination[^;]*"BASE"[^;]*"SOLANA"/);
  const at = source.indexOf('action.lane === "BRIDGE"');
  assert.ok(at !== -1, "History no longer describes the bridge lane.");
  const branch = source.slice(at, at + 1400);
  assert.match(branch, /action\.destination/, "The bridge row's wording ignores the recorded direction.");
  assert.ok(branch.includes('text("to Solana")'), "The bridge row can never say a transfer arrived on Solana.");
});

/**
 * And the reverse lane must be able to write the row at all.
 *
 * Its in-flight write passed the Base transaction hash as the Solana signature,
 * so every one of them was rejected by the row's own schema and swallowed by a
 * helper that promises never to throw. Money moving from Base was invisible in
 * History for the whole time it was in motion.
 */
test("the reverse lane does not put a Base hash where a Solana signature goes", () => {
  const source = read(BASE_BURN);
  const at = source.indexOf("recordSolanaAction(store, {");
  assert.ok(at !== -1, "The reverse lane no longer records the transfer in History.");
  const call = source.slice(at, source.indexOf("});", at));
  assert.ok(
    !/signature:\s*transactionHash/.test(call),
    "The reverse lane's in-flight row carries a Base hash as its Solana signature, so it cannot be written.",
  );
  /* The row still has to exist, and still has to name the direction. */
  assert.match(call, /destination:\s*"SOLANA"/, "The in-flight row no longer says which way the money is going.");
  assert.match(call, /outcome:.*IN_FLIGHT/s, "Money in motion is no longer recorded as in motion.");
});

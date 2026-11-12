// Writes the recorded scenario of the Hack sandbox's stand (CITY-224): `scenario.json` beside this file — the copy
// (snapshot), the order's target and check, and two attempts with what they were recorded to give: «the finding
// reproduces» and «the finding does not reproduce». The tests (`../stand.test.mjs`) and the stand
// (`docs/research/city-224-hack-sandbox/stand.mjs`) replay it and compare the log hashes on any machine.
//
//   node city/lib/arena/hack/sandbox/fixtures/record.mjs
//
// Offline, deterministic: running it twice writes the same bytes.
import { writeFileSync } from "node:fs";
import * as f from "../fixtures.mjs";

const sandbox = f.makeSandbox();
const snapshot = f.makeSnapshot();
const pin = f.pinFor(snapshot);
const attempts = [
  { name: "reproduces", runId: "stand-reproduces", inputs: f.REPRODUCES, finding: "split credits every instalment in full" },
  { name: "does-not-reproduce", runId: "stand-not-reproduced", inputs: f.NOT_REPRODUCED, finding: "the protocol's balance moves without its key" },
].map(({ name, runId, inputs, finding }) => {
  const run = sandbox.run({ runId, pin, target: f.TARGET, claim: f.CLAIM, actors: [f.ATTACKER], inputs });
  if (!run.ok) throw new Error(`${name}: ${run.refusal} ${run.detail}`);
  const { judgement } = sandbox.prove(run, f.proveContext());
  return { name, runId, finding, inputs, expect: { reproduced: run.reproduced, logHash: run.logHash, steps: run.usage.steps, cu: run.usage.cu, verdict: judgement.verdict, reason: judgement.reason } };
});

const scenario = {
  format: "ryntra-hack-scenario/1",
  note: "CITY-224 stand: a made-up program on the toy engine; one finding that reproduces and one that does not.",
  target: f.TARGET,
  pin,
  check: { ...f.CLAIM, vault: f.VAULT },
  actors: [f.ATTACKER],
  snapshot,
  attempts,
};
writeFileSync(f.SCENARIO_PATH, `${JSON.stringify(scenario, null, 2)}\n`);
console.log(attempts.map((a) => `${a.name}: ${a.expect.verdict} ${a.expect.logHash}`).join("\n"));

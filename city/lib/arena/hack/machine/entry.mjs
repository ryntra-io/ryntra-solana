// CITY-238 · what the machine with no network runs. One job per process:
//
//   node entry.mjs <job.json> <answer.json> [rig.mjs]
//
// It reads the job, plays it and writes one answer (`protocol.ts`). Before anything else it tries to reach out: a
// machine that can reach a network refuses to play — the wall is the way the machine is made (a firewall that denies
// everything, a network namespace with no interface), and this is the check that it is really there, on every job.
//
// The copy and the checks are the machine's own: the ranges that came with its image (`../ranges/catalogue.ts`). A job
// names a pin; a pin the machine does not hold is a run refused (`NO_SNAPSHOT`), so a job can never bring its own state
// or its own checks. The engine is LiteSVM from the image. No key is here: a `prove` job carries a stamp — a signature
// the server made — and the public signer to check it against.
//
// The process imports only what the image carries: this folder, the sandbox, the ranges and the Ring's judge, as plain
// TypeScript that node strips itself (node 22.18+). A rig (third argument) swaps the engine and the ranges — for the
// library's own tests, which have no LiteSVM.
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { pathToFileURL } from "node:url";

const PROTOCOL = 1;
const [jobPath, answerPath, rigPath] = process.argv.slice(2);

function answer(body) {
  writeFileSync(answerPath, JSON.stringify({ v: PROTOCOL, ...body }));
}
const fault = (code, detail) => answer({ ok: false, fault: code, detail: String(detail).slice(0, 300) });

/** Public addresses a machine with a network would reach. A stand names its own (`RYNTRA_HACK_PROBE=host:port,…`). */
const PROBE_DEFAULT = "1.1.1.1:443,8.8.8.8:53,208.67.222.222:443";
const PROBE_MS = 700;

/** Resolves `true` when a TCP connection opens: the machine has a way out. */
function reaches(target) {
  const at = target.lastIndexOf(":");
  const host = target.slice(0, at);
  const port = Number(target.slice(at + 1));
  return new Promise((resolve) => {
    if (!host || !Number.isSafeInteger(port)) return resolve(false);
    const socket = net.connect({ host, port });
    const end = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(PROBE_MS, () => end(false));
    socket.once("connect", () => end(true));
    socket.once("error", () => end(false));
  });
}

async function networkReachable() {
  const targets = (process.env.RYNTRA_HACK_PROBE?.trim() || PROBE_DEFAULT).split(",").map((t) => t.trim()).filter(Boolean);
  const open = await Promise.all(targets.map(reaches));
  return targets.filter((_target, i) => open[i]);
}

async function play() {
  if (!jobPath || !answerPath) throw new Error("usage: node entry.mjs <job.json> <answer.json> [rig.mjs]");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 18)) return fault("PROTOCOL", `node ${process.versions.node}: the sandbox loads on 22.18 or newer`);

  // The wall first: nothing is read, loaded or played on a machine that has a way out.
  const reached = await networkReachable();
  if (reached.length > 0) return fault("NETWORK_REACHABLE", `this machine reached ${reached.join(", ")}: it does not play`);

  let job;
  try {
    job = JSON.parse(readFileSync(jobPath, "utf8"));
  } catch {
    return fault("BAD_JOB", "the job is not JSON");
  }
  if (job === null || typeof job !== "object" || job.v !== PROTOCOL) return fault("PROTOCOL", `the job speaks protocol ${String(job?.v)}, this machine ${PROTOCOL}`);
  if (job.phase !== "run" && job.phase !== "prove") return fault("BAD_JOB", "phase is run or prove");

  let rig;
  let sb;
  let judgeLib;
  try {
    sb = await import("../sandbox/index.ts");
    judgeLib = await import("../../../../../lib/ring/judge/index.ts");
    const rigModule = await import(rigPath ? pathToFileURL(rigPath).href : "./rig.mjs");
    rig = await rigModule.default(sb);
  } catch (error) {
    return fault("BROKEN", error instanceof Error ? error.message : "the machine's image did not load");
  }

  const sandbox = (pinOf) =>
    sb.createHackSandbox({
      engine: rig.engine,
      // A lookup in what the image carries — never the job's own state, never a fetch.
      snapshot: (pin) => rig.forPin(pin)?.snapshot ?? null,
      invariants: rig.forPin(pinOf)?.invariants ?? [],
      now: () => Date.now(),
    });

  if (job.phase === "run") {
    const attempt = job.attempt;
    if (attempt === null || typeof attempt !== "object") return fault("BAD_JOB", "a run job carries an attempt");
    const probe = rig.engine();
    return answer({ ok: true, phase: "run", run: sandbox(attempt.pin).run(attempt), engine: { id: probe.id, version: probe.version } });
  }

  const run = job.run;
  if (run === null || typeof run !== "object" || run.ok !== true || typeof job.signer !== "string" || job.stamp === null || typeof job.stamp !== "object") {
    return fault("BAD_JOB", "a prove job carries the run, the stamp and the signer");
  }
  const content = judgeLib.canonicalJson(run.log);
  const hash = judgeLib.sha256Hex(content);
  const context = {
    // The server's stamp, for exactly this log at exactly this time — anything else is not stamped at all.
    stamp: (stamped, at) => {
      if (stamped.matchId !== run.runId || stamped.hash !== hash || at !== job.at) throw new Error("the stamp is for another log");
      return job.stamp;
    },
    verifyStamp: judgeLib.stampVerifier([job.signer]),
    at: job.at,
    window: job.window,
    costMicroUsd: job.costMicroUsd,
  };
  return answer({ ok: true, phase: "prove", proof: sandbox(run.config?.pin).prove(run, context) });
}

play().then(
  () => process.exit(0),
  (error) => {
    try {
      fault("BROKEN", error instanceof Error ? error.message : String(error));
    } catch {
      /* no answer file to write to: the driver reads the exit code */
    }
    process.exit(1);
  },
);

// CITY-238 · one real run of each training range on a real machine with no network — for whoever opens the door and
// wants to see the machine work before people do, and for the stand (`docs/research/city-238-hack-open/stand.mjs`).
// The check itself is `selftest.ts`; the deployed server plays the same one on its own machine
// (`GET /api/arena/hack/machine`).
//
//   node city/lib/arena/hack/machine/check.mjs --vercel --project <id> [--team <id>] --snapshot <id>
//       Vercel Sandbox through the `vercel` CLI's own sign-in. With RYNTRA_HACK_SANDBOX_TOKEN set, through `fetch`
//       with that token instead — the way the server calls it.
//   node city/lib/arena/hack/machine/check.mjs --netns --image <folder>          (Linux; `image.mjs --dir`)
//       a process in a network namespace with no interface.
//   … --out <file>   also writes the result as JSON.
//
// The stamp key is made here for this one check. Nothing is filed anywhere.
import "../../../../../lib/world/testing/hooks.mjs";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

const { createProcessDriver, netnsWrap } = await import("./drivers/process.ts");
const { createVercelDriver, vercelTransport } = await import("./drivers/vercel.ts");
const { runSelftest } = await import("./selftest.ts");
const { catalogue } = await import("../ranges/catalogue.ts");
const judgeLib = await import("../../../../../lib/ring/judge/index.ts");

const argOf = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
};

async function driverFromArgs() {
  if (process.argv.includes("--vercel")) {
    const projectId = argOf("--project");
    const snapshotId = argOf("--snapshot");
    if (!projectId || !snapshotId) throw new Error("--vercel needs --project <id> and --snapshot <id>");
    const teamId = argOf("--team") ?? undefined;
    const token = process.env.RYNTRA_HACK_SANDBOX_TOKEN?.trim();
    if (token) return { driver: createVercelDriver({ transport: vercelTransport({ token: () => token }), snapshotId, projectId, teamId }) };
    // Through the CLI every call starts a process, so a job takes far longer to hand over than to play: the machine
    // lives longer and the backend waits longer for the CLI itself. The wall that stops a run is the machine's own
    // either way.
    const { vercelCliTransport } = await import("./drivers/vercel-cli.mjs");
    return { driver: createVercelDriver({ transport: vercelCliTransport({ timeoutMs: 600_000 }), snapshotId, projectId, teamId, lifeMs: 2_400_000 }), driverSlackMs: 900_000 };
  }
  if (process.argv.includes("--netns")) {
    const image = argOf("--image");
    if (!image) throw new Error("--netns needs --image <folder> (image.mjs --dir, then npm install in it)");
    return { driver: createProcessDriver({ entry: path.join(path.resolve(image), "app/city/lib/arena/hack/machine/entry.mjs"), wrap: netnsWrap(), isolated: true }) };
  }
  throw new Error("usage: check.mjs --vercel --project <id> [--team <id>] --snapshot <id> | --netns --image <folder>  [--out <file>]");
}

const { driver, driverSlackMs } = await driverFromArgs();
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const result = await runSelftest({ driver, ranges: catalogue(), stamp: { stamp: judgeLib.createStamper(privateKey), signer: judgeLib.signerOf(publicKey) }, driverSlackMs });
console.log(JSON.stringify(result, null, 2));
const out = argOf("--out");
if (out) writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok ? 0 : 1);

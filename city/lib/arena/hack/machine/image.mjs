// CITY-238 · the machine's image: everything the machine with no network needs to play a run, and nothing else.
//
//   app/…            the files `entry.mjs` loads, at their paths in the repository — this folder, the sandbox, the
//                    ranges, the Ring's judge — found by following its imports (`closure`)
//   app/package.json `{ "type": "module" }`
//   package.json     LiteSVM, pinned to the ranges' engine version; the image installs it once, while it still may
//
//   node city/lib/arena/hack/machine/image.mjs --list                 the files, one a line
//   node city/lib/arena/hack/machine/image.mjs --dir <folder>         the image as a folder (a stand: then
//                                                                     `npm install` in it, on Linux)
//   node city/lib/arena/hack/machine/image.mjs --vercel --project <id> [--team <id>] [--keep]
//                                                                     a Vercel Sandbox snapshot; prints its id
//
// `--vercel` goes through the `vercel` CLI (the developer's own sign-in; no token is read here): it starts a builder
// machine that may reach the network, writes the image, installs LiteSVM, runs the entry's own self-check, takes a
// snapshot and stops the builder. Runs then start from the snapshot with every way out denied (`drivers/vercel.ts`).
// A snapshot lasts 7 days unless `--keep`; an image is rebuilt whenever a file of the list changes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../../../..");
const rel = (file) => path.relative(ROOT, file).replace(/\\/g, "/");

/** The engine's package, pinned to the ranges' engine (`../ranges/range.ts`, `RANGE_ENGINE`). */
export const SVM_PACKAGE = { name: "litesvm", version: "1.6.2" };

const SPECIFIER = /(?:\bimport\s*\(\s*|\bfrom\s+|\bimport\s+)(["'])([^"'\n]+)\1/g;

/** Every repository file the entry loads, by following relative imports. A bare import that is not node's own is refused. */
export function closure(entries = [path.join(HERE, "entry.mjs"), path.join(HERE, "rig.mjs"), path.join(HERE, "selfcheck.mjs")]) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[2];
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) throw new Error(`${rel(file)} imports ${specifier}: the machine's image carries only the repository's own files and node`);
      if (!/\.(ts|mjs)$/.test(specifier)) throw new Error(`${rel(file)} imports ${specifier} without an extension: node on the machine resolves nothing by itself`);
      queue.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return [...seen].map(rel).sort();
}

/** The image's files: `{ name, data }`, names relative to the image's root. */
export function imageFiles() {
  const files = closure().map((name) => ({ name: `app/${name}`, data: readFileSync(path.join(ROOT, name)) }));
  files.push({ name: "app/package.json", data: `${JSON.stringify({ private: true, type: "module" })}\n` });
  files.push({ name: "package.json", data: `${JSON.stringify({ private: true, dependencies: { [SVM_PACKAGE.name]: SVM_PACKAGE.version } }, null, 2)}\n` });
  return files;
}

const argOf = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
};

async function toDir(out) {
  for (const file of imageFiles()) {
    const target = path.join(out, file.name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.data);
  }
  console.log(`image written to ${out} (${imageFiles().length} files). On Linux: cd ${out} && npm install`);
}

async function toVercel() {
  const projectId = argOf("--project");
  const teamId = argOf("--team");
  if (!projectId) throw new Error("--project <id>: the Vercel project the machines belong to");
  await import(pathToFileURL(path.join(ROOT, "lib/world/testing/hooks.mjs")).href);
  const { vercelCliTransport } = await import("./drivers/vercel-cli.mjs");
  const { tarGz } = await import("./tar.ts");
  const { VERCEL_ROOT, ENTRY_IN_IMAGE } = await import("./drivers/vercel.ts");
  const transport = vercelCliTransport();
  const query = teamId ? { teamId } : {};
  const text = (response) => Buffer.from(response.body).toString("utf8");
  const call = async (what, request) => {
    const response = await transport({ ...request, query: { ...query, ...(request.query ?? {}) } });
    if (response.status < 200 || response.status >= 300) throw new Error(`${what}: ${response.status} ${text(response).slice(0, 300)}`);
    return response;
  };
  const name = `ryntra-hack-image-${Date.now().toString(36)}`;
  console.log(`builder ${name}: starting…`);
  const created = JSON.parse(text(await call("start the builder", { method: "POST", path: "/v4/sandboxes", json: { name, projectId, persistent: false, timeout: 600_000, resources: { vcpus: 2, memory: 4_096 }, tags: { app: "ryntra-hack-image" } } })));
  const session = created.session?.id;
  if (!session) throw new Error("the builder started without a session");
  const base = `/v2/sandboxes/sessions/${session}`;
  const run = async (what, command, args, timeout = 240_000) => {
    const response = await call(what, { method: "POST", path: `${base}/cmd`, json: { command, args, cwd: VERCEL_ROOT, wait: true, timeout } });
    const last = text(response).trim().split("\n").map((line) => JSON.parse(line)).filter((line) => line.command).pop();
    if (last?.command?.exitCode !== 0) {
      const logs = await transport({ method: "GET", path: `${base}/cmd/${last?.command?.id}/logs`, query });
      throw new Error(`${what}: exit ${last?.command?.exitCode}\n${text(logs).slice(-1_500)}`);
    }
    return last.command;
  };
  try {
    await call("make the image's folder", { method: "POST", path: `${base}/fs/mkdir`, json: { path: VERCEL_ROOT } }).catch(() => undefined);
    await call("write the image", { method: "POST", path: `${base}/fs/write`, headers: { "content-type": "application/gzip", "x-cwd": VERCEL_ROOT }, bytes: tarGz(imageFiles()) });
    console.log("image written; installing the engine…");
    await run("install the engine", "npm", ["install", "--omit=dev", "--no-audit", "--no-fund"]);
    console.log("engine installed; self-check…");
    await run("the image's self-check", "node", [`${VERCEL_ROOT}/app/city/lib/arena/hack/machine/selfcheck.mjs`]);
    const keep = process.argv.includes("--keep");
    const snapshot = JSON.parse(text(await call("take the snapshot", { method: "POST", path: `/v3/sandboxes/sessions/${session}/snapshot`, json: keep ? { expiration: 0 } : {} })));
    const id = snapshot.snapshot?.id;
    if (!id) throw new Error("the snapshot has no id");
    console.log(`snapshot ${id}${keep ? " (kept until deleted)" : " (lasts 7 days; --keep to keep it)"}`);
    console.log(`entry in the image: ${VERCEL_ROOT}/${ENTRY_IN_IMAGE}`);
    console.log(`RYNTRA_HACK_SANDBOX_SNAPSHOT=${id}`);
  } finally {
    await transport({ method: "POST", path: `${base}/stop`, json: {}, query }).catch(() => undefined);
    await transport({ method: "DELETE", path: `/v2/sandboxes/${name}`, query: { ...query, projectId } }).catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--list")) console.log(closure().join("\n"));
  else if (argOf("--dir")) await toDir(path.resolve(argOf("--dir")));
  else if (process.argv.includes("--vercel")) await toVercel();
  else console.log("usage: image.mjs --list | --dir <folder> | --vercel --project <id> [--team <id>] [--keep]");
}

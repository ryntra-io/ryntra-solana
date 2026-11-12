// CITY-238 · Vercel's API through the `vercel` CLI — a developer's stand and the image builder only, never the server.
// The CLI holds the developer's own sign-in, so no token is read, kept or passed by anything here: each call is
// `vercel api <path> -X <method> …` and the answer is what the CLI prints. The server's own transport is `fetch` with
// the deployment's token (`vercel.ts`, `vercelTransport`).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** One word of a command line as the shell takes it whole: quoted, on Windows and elsewhere. */
function quoted(word) {
  const text = String(word);
  if (process.platform === "win32") return `"${text.replaceAll('"', '\\"')}"`;
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

const WRITE = "/fs/write";
/** Unpacks a tarball handed over as base64 into a folder: what `fs/write` does with the bytes themselves. */
const UNPACK = 'mkdir -p "$1" && printf %s "$2" | base64 -d | tar -xz -C "$1"';

/**
 * A `VercelTransport` (`vercel.ts`) over the CLI. `cli` — the command, `vercel` by default.
 *
 * The CLI sends a body as text, so bytes do not survive it: a file write (`fs/write`, a tarball) is done here as a
 * command inside the machine that unpacks the same tarball from base64 — the same files in the same folder. The
 * server's own transport sends the bytes as they are.
 */
export function vercelCliTransport({ cli = "vercel", timeoutMs = 180_000 } = {}) {
  return async function transport(request) {
    if (request.bytes !== undefined && request.path.endsWith(WRITE)) {
      const folder = request.headers?.["x-cwd"] ?? ".";
      const ran = await transport({
        method: "POST",
        path: `${request.path.slice(0, -WRITE.length)}/cmd`,
        query: request.query,
        json: { command: "bash", args: ["-c", UNPACK, "unpack", folder, Buffer.from(request.bytes).toString("base64")], wait: true, timeout: 60_000 },
      });
      if (ran.status < 200 || ran.status >= 300) return ran;
      const unpacked = Buffer.from(ran.body).toString("utf8").includes('"exitCode":0');
      return unpacked ? { status: 200, body: new Uint8Array(Buffer.from("{}")) } : { status: 400, body: ran.body };
    }

    const query = new URLSearchParams(request.query ?? {}).toString();
    const args = ["api", `${request.path}${query ? `?${query}` : ""}`, "-X", request.method, "--raw", "-i"];
    for (const [key, value] of Object.entries(request.headers ?? {})) args.push("-H", `${key}:${value}`);
    const dir = mkdtempSync(path.join(tmpdir(), "ryntra-hack-cli-"));
    try {
      if (request.json !== undefined) {
        writeFileSync(path.join(dir, "body.json"), JSON.stringify(request.json));
        args.push("-H", "content-type:application/json", "--input", path.join(dir, "body.json"));
      }
      if (request.method === "DELETE") args.push("--dangerously-skip-permissions");
      const { code, stdout, stderr } = await new Promise((resolve, reject) => {
        // The CLI is a `.cmd` shim on Windows, so it starts through the shell — every word quoted, a query's `&` included.
        const child = spawn([cli, ...args.map(quoted)].join(" "), { shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1", MSYS_NO_PATHCONV: "1" } });
        const out = [];
        const err = [];
        const timer = setTimeout(() => child.kill(), timeoutMs);
        child.stdout.on("data", (chunk) => out.push(chunk));
        child.stderr.on("data", (chunk) => err.push(chunk));
        child.once("error", reject);
        child.once("close", (exit) => {
          clearTimeout(timer);
          resolve({ code: exit, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") });
        });
      });
      if (code !== 0) {
        const status = Number(/\((\d{3})\)\s*$/m.exec(stderr)?.[1] ?? 599);
        return { status, body: new Uint8Array(Buffer.from(stderr.trim().slice(0, 500), "utf8")) };
      }
      // `HTTP <status> <text>`, the headers, an empty line, the body.
      const head = stdout.indexOf("\n\n");
      const first = stdout.subarray(0, Math.max(0, stdout.indexOf("\n"))).toString("utf8");
      const status = Number(/^HTTP\S*\s+(\d{3})/.exec(first)?.[1] ?? 200);
      const body = head === -1 ? stdout : stdout.subarray(head + 2);
      return { status, body: new Uint8Array(body) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

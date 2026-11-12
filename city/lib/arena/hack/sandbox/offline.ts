/**
 * No network inside a run (CITY-224, spec «How the sandbox works» → «Never»: «a way out to the network from the
 * sandbox»). The copy is loaded from a recorded snapshot and nothing in a run may reach outside: not the engine, not a
 * program, not a protocol's check.
 *
 * Two walls. The first is the machine: a run of an agent's work belongs on a machine with no network and no secrets
 * (Vercel Sandbox or the like — the deployment's part, CITY-225/226). This is the second, inside the process: while a
 * run executes, every way out Node offers — `fetch`, `WebSocket`, `net`, `tls`, `http(s)`, `http2`, `dns`, `dgram`,
 * child processes and worker threads — throws `NetworkRefused`. A run is synchronous (the engine is), so nothing else
 * in the process runs while the wall is up, and it comes down the moment the run returns.
 *
 * An attempt is remembered even if the code that made it catches the error: `offline` throws `NetworkRefused` at the
 * end anyway, so a run that tried to reach out is never handed back as clean.
 */

import { createRequire, syncBuiltinESMExports } from "node:module";

export class NetworkRefused extends Error {
  override name = "NetworkRefused";
  /** The way out that was tried, e.g. `fetch` or `net.connect`. */
  readonly via: string;
  constructor(via: string) {
    super(`the sandbox has no network: ${via} refused`);
    this.via = via;
  }
}

const require = createRequire(import.meta.url);

/** Module exports that open a way out, by builtin module. */
const MODULES: Readonly<Record<string, readonly string[]>> = {
  net: ["connect", "createConnection"],
  tls: ["connect"],
  http: ["request", "get"],
  https: ["request", "get"],
  http2: ["connect"],
  dns: ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveTxt", "reverse"],
  dgram: ["createSocket"],
  child_process: ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"],
};

/** Globals that open a way out. */
const GLOBALS = ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"] as const;

type Patch = { target: Record<string, unknown>; key: string; value: unknown };

let depth = 0;
let tripped: string | null = null;

function refuse(via: string): never {
  tripped ??= via;
  throw new NetworkRefused(via);
}

function install(): Patch[] {
  const patches: Patch[] = [];
  const swap = (target: Record<string, unknown>, key: string, via: string) => {
    if (typeof target[key] !== "function") return;
    patches.push({ target, key, value: target[key] });
    target[key] = function refused() {
      return refuse(via);
    };
  };
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of GLOBALS) swap(g, key, key);
  for (const [name, keys] of Object.entries(MODULES)) {
    const mod = require(`node:${name}`) as Record<string, unknown>;
    for (const key of keys) swap(mod, key, `${name}.${key}`);
  }
  const net = require("node:net") as { Socket: { prototype: Record<string, unknown> } };
  swap(net.Socket.prototype, "connect", "net.Socket.connect");
  const workers = require("node:worker_threads") as Record<string, unknown>;
  swap(workers, "Worker", "worker_threads.Worker");
  // ESM named imports of builtins (`import { connect } from "node:net"`) follow the patched exports.
  syncBuiltinESMExports();
  return patches;
}

function uninstall(patches: Patch[]): void {
  for (const { target, key, value } of patches.reverse()) target[key] = value;
  syncBuiltinESMExports();
}

/** True while a run executes inside `offline`. */
export const isOffline = (): boolean => depth > 0;

/**
 * Runs `fn` with every way out to the network refused. Synchronous only: a promise would outlive the wall, so a
 * function that returns one is refused too. Nested calls share one wall. Throws `NetworkRefused` when anything inside
 * tried to reach out — even if it caught the error itself.
 */
export function offline<T>(fn: () => T): T {
  if (depth > 0) {
    const value = fn();
    if (tripped !== null) throw new NetworkRefused(tripped);
    return value;
  }
  tripped = null;
  const patches = install();
  depth = 1;
  let value: T | undefined;
  let failure: { error: unknown } | null = null;
  try {
    value = fn();
  } catch (error) {
    failure = { error };
  } finally {
    depth = 0;
    uninstall(patches);
  }
  const attempt = tripped as string | null;
  tripped = null;
  // A way out tried is the verdict on the run, whatever else went wrong after it.
  if (attempt !== null) throw new NetworkRefused(attempt);
  if (failure !== null) throw failure.error;
  if (value !== null && typeof value === "object" && typeof (value as { then?: unknown }).then === "function") {
    throw new TypeError("a sandbox run is synchronous: a promise would outlive the offline wall");
  }
  return value as T;
}

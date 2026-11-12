/**
 * A machine as a process on this computer (CITY-238) — for the stand and the tests, never production. Each job is one
 * `node entry.mjs job answer` in a fresh process, killed past the wall.
 *
 * On its own a process shares this computer's network, so it is **not** a machine with no network: `isolated` is what
 * the caller's `wrap` makes true. The stand wraps it in a Linux network namespace that has no interface
 * (`unshare -rn`, `netnsWrap`), where no address is reachable at all — the same wall by construction a firewall gives,
 * small enough for a laptop. From Windows the same runs inside WSL (`wslWrap`).
 *
 * Refuses to be built in production: there the machine is Vercel Sandbox (`vercel.ts`).
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { MachineFailed, MachineTimeout, type MachineAnswer, type MachineDriver, type MachineJob } from "../protocol.ts";

export type ProcessDriverConfig = {
  /** The node that runs the entry, as the machine sees it. Default: this process's own. */
  readonly node?: string;
  /** `entry.mjs`, as the machine sees it. */
  readonly entry: string;
  /** A rig module for the entry, as the machine sees it (tests). */
  readonly rig?: string;
  /** Put in front of `node …`: the wall. E.g. `netnsWrap()` or `wslWrap(...)`. */
  readonly wrap?: readonly string[];
  /** `true` only when `wrap` takes the network away by construction. */
  readonly isolated: boolean;
  /** Environment for the entry (`RYNTRA_HACK_SVM`, `RYNTRA_HACK_PROBE`). Given as `env K=V` words, so it crosses a wrapper too. */
  readonly env?: Readonly<Record<string, string>>;
  /** Where job and answer files go on this computer; default a fresh folder in the temp dir. */
  readonly dir?: string;
  /** This computer's path as the machine sees it (WSL: `C:\x` → `/mnt/c/x`). */
  readonly toMachinePath?: (hostPath: string) => string;
  readonly name?: string;
};

/** A Linux network namespace with no interface: nothing is reachable in it, not even this computer. */
export const netnsWrap = (): string[] => ["unshare", "-rn"];

/** The same inside WSL, from Windows. */
export const wslWrap = (distro?: string): string[] => ["wsl.exe", ...(distro ? ["-d", distro] : []), "-e", ...netnsWrap()];

/** A Windows path as WSL mounts it: `D:\work\x` is `/mnt/d/work/x`. */
export function toWslPath(hostPath: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(hostPath);
  return match ? `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replace(/\\/g, "/")}` : hostPath.replace(/\\/g, "/");
}

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export function createProcessDriver(config: ProcessDriverConfig): MachineDriver {
  if (process.env.NODE_ENV === "production") throw new Error("the process machine is a stand's: production runs on Vercel Sandbox");
  const see = config.toMachinePath ?? ((p: string) => p);
  const envWords = Object.entries(config.env ?? {}).map(([key, value]) => {
    if (!ENV_NAME.test(key) || /[\0\n]/.test(value)) throw new TypeError(`env ${key}: not a plain setting`);
    return `${key}=${value}`;
  });

  return {
    name: config.name ?? (config.isolated ? "process-netns" : "process"),
    isolated: config.isolated,
    async open() {
      const dir = config.dir ?? mkdtempSync(path.join(tmpdir(), "ryntra-hack-machine-"));
      mkdirSync(dir, { recursive: true });
      let jobs = 0;
      let open = true;
      return {
        play(job: MachineJob, wallMs: number): Promise<MachineAnswer> {
          if (!open) return Promise.reject(new MachineFailed("UNREACHABLE", "the machine is stopped"));
          jobs += 1;
          const jobFile = path.join(dir, `job-${jobs}.json`);
          const answerFile = path.join(dir, `answer-${jobs}.json`);
          writeFileSync(jobFile, JSON.stringify(job));
          // Behind a wrapper the settings cross as `env K=V` words; a bare process gets them as its environment.
          const wrapped = (config.wrap?.length ?? 0) > 0;
          const words = [...(config.wrap ?? []), ...(wrapped && envWords.length > 0 ? ["env", ...envWords] : []), config.node ?? process.execPath, config.entry, see(jobFile), see(answerFile), ...(config.rig ? [config.rig] : [])];
          // The machine holds no secret: of this computer's environment it gets only what a process needs to start.
          const bare: Record<string, string | undefined> = {};
          for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "HOME", "TEMP", "TMP", "WSLENV"]) if (process.env[key] !== undefined) bare[key] = process.env[key];
          const env = (wrapped ? bare : { ...bare, ...(config.env ?? {}) }) as NodeJS.ProcessEnv;
          return new Promise<MachineAnswer>((resolve, reject) => {
            const child = spawn(words[0]!, words.slice(1), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, env });
            let stderr = "";
            let done = false;
            const finish = (fn: () => void) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              fn();
            };
            // The hard wall: a process that will not come back is killed, and the run is the seat's loss.
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
              finish(() => reject(new MachineTimeout(`the machine's process was killed after ${wallMs} ms`)));
            }, wallMs);
            child.stderr?.on("data", (chunk: Buffer) => {
              if (stderr.length < 2_000) stderr += chunk.toString("utf8");
            });
            child.once("error", (error) => finish(() => reject(new MachineFailed("UNREACHABLE", error.message))));
            child.once("exit", (code) =>
              finish(() => {
                try {
                  resolve(JSON.parse(readFileSync(answerFile, "utf8")) as MachineAnswer);
                } catch {
                  reject(new MachineFailed("UNREACHABLE", `the machine left no answer (exit ${String(code)}): ${stderr.trim().slice(0, 200)}`));
                }
              }),
            );
          });
        },
        async close() {
          if (!open) return;
          open = false;
          if (!config.dir) rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  };
}

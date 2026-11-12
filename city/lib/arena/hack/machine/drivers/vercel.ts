/**
 * A machine as a Vercel Sandbox (CITY-238): a Firecracker microVM of the deployment's own account, started from the
 * image's snapshot (`../image.mjs`) with a network policy that denies everything from its first moment. The wall is the
 * machine's own firewall, outside the guest: nothing the run's process does can take it down, and the entry still
 * checks it is there before it plays (`../entry.mjs`).
 *
 *   open   POST /v4/sandboxes                              — from the snapshot, `networkPolicy: deny-all`, not kept
 *   play   POST /v2/sandboxes/sessions/{id}/fs/write       — the job, as a small tarball
 *          POST /v2/sandboxes/sessions/{id}/cmd            — `node entry.mjs job answer`, killed past the wall
 *          POST /v2/sandboxes/sessions/{id}/fs/read        — the answer
 *   close  POST /v2/sandboxes/sessions/{id}/stop, DELETE /v2/sandboxes/{name}
 *
 * A machine whose policy does not read back as `deny-all` is stopped and never played on. The transport is handed in:
 * on the server it is `fetch` to Vercel's API with the deployment's own token (`vercelTransport`); on a developer's
 * stand it is the `vercel` CLI, which holds the developer's sign-in itself (`../image.mjs`).
 */

import { MachineFailed, MachineTimeout, type MachineAnswer, type MachineDriver, type MachineJob } from "../protocol.ts";
import { tarGz } from "../tar.ts";

/** One call to Vercel's API. `json` is sent as JSON, `bytes` as they are. Never throws for a status: the driver reads it. */
export type VercelRequest = {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly json?: unknown;
  readonly bytes?: Uint8Array;
  /** How long the call may take, ms: a command that waits for its end names its own; anything else is short. */
  readonly timeoutMs?: number;
};
export type VercelResponse = { readonly status: number; readonly body: Uint8Array };
export type VercelTransport = (request: VercelRequest) => Promise<VercelResponse>;

export type VercelDriverConfig = {
  readonly transport: VercelTransport;
  /** The image: a snapshot with node, LiteSVM, the sandbox and the ranges (`../image.mjs` prints its id). */
  readonly snapshotId: string;
  /** The project the machines are billed and listed under. */
  readonly projectId: string;
  readonly teamId?: string;
  /** How long one machine may live, ms: one agent's run. Default 5 minutes. */
  readonly lifeMs?: number;
  /** The image's root inside the machine. Default `/vercel/sandbox/hack`. */
  readonly root?: string;
  readonly region?: string;
  /** A name for each machine; default random. */
  readonly newName?: () => string;
};

export const VERCEL_ROOT = "/vercel/sandbox/hack";
/** The entry inside the image, under its root. */
export const ENTRY_IN_IMAGE = "app/city/lib/arena/hack/machine/entry.mjs";

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf8");

function jsonOf(response: VercelResponse): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text(response.body));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The last command status in an ND-JSON stream (`wait: true`), or the one in a plain JSON answer. */
function commandOf(response: VercelResponse): { exitCode: number | null } | null {
  const lines = text(response.body).split("\n").map((line) => line.trim()).filter(Boolean);
  let found: { exitCode: number | null } | null = null;
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as { command?: { exitCode?: unknown } };
      if (value?.command && typeof value.command === "object") found = { exitCode: typeof value.command.exitCode === "number" ? value.command.exitCode : null };
    } catch {
      /* not a status line */
    }
  }
  return found;
}

export function createVercelDriver(config: VercelDriverConfig): MachineDriver {
  const root = config.root ?? VERCEL_ROOT;
  const query = config.teamId ? { teamId: config.teamId } : undefined;
  const call = async (request: VercelRequest): Promise<VercelResponse> => {
    try {
      return await config.transport({ ...request, query: { ...(query ?? {}), ...(request.query ?? {}) } });
    } catch (error) {
      throw new MachineFailed("UNREACHABLE", error instanceof Error ? error.message : "Vercel's API did not answer");
    }
  };
  const need = (response: VercelResponse, what: string): VercelResponse => {
    if (response.status >= 200 && response.status < 300) return response;
    throw new MachineFailed("UNREACHABLE", `${what}: ${response.status} ${text(response.body).slice(0, 160)}`);
  };

  return {
    name: "vercel-sandbox",
    isolated: true,
    async open() {
      const name = config.newName?.() ?? `ryntra-hack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const created = need(
        await call({
          method: "POST",
          path: "/v4/sandboxes",
          json: {
            name,
            projectId: config.projectId,
            source: { type: "snapshot", snapshotId: config.snapshotId },
            // No way out, from the first moment: the firewall is the machine's, not the guest's.
            networkPolicy: { mode: "deny-all" },
            persistent: false,
            timeout: config.lifeMs ?? 300_000,
            resources: { vcpus: 2, memory: 4_096 },
            ...(config.region ? { region: config.region } : {}),
            tags: { app: "ryntra-hack" },
          },
        }),
        "the machine did not start",
      );
      const body = jsonOf(created);
      const session = body?.session as { id?: unknown; networkPolicy?: { mode?: unknown } } | undefined;
      const sessionId = typeof session?.id === "string" ? session.id : null;
      let open = true;
      const stop = async (): Promise<void> => {
        if (!open) return;
        open = false;
        if (sessionId) await call({ method: "POST", path: `/v2/sandboxes/sessions/${sessionId}/stop`, json: {} }).catch(() => undefined);
        await call({ method: "DELETE", path: `/v2/sandboxes/${name}`, query: { projectId: config.projectId } }).catch(() => undefined);
      };
      if (!sessionId) {
        await stop();
        throw new MachineFailed("UNREACHABLE", "the machine started without a session");
      }
      // By construction, and read back: a machine that is not denied everything is never played on.
      if (session?.networkPolicy?.mode !== "deny-all") {
        await stop();
        throw new MachineFailed("NETWORK_REACHABLE", `the machine's network policy is ${String(session?.networkPolicy?.mode)}, not deny-all`);
      }

      let jobs = 0;
      const base = `/v2/sandboxes/sessions/${sessionId}`;
      return {
        async play(job: MachineJob, wallMs: number): Promise<MachineAnswer> {
          if (!open) throw new MachineFailed("UNREACHABLE", "the machine is stopped");
          jobs += 1;
          const jobName = `jobs/job-${jobs}.json`;
          const answerName = `jobs/answer-${jobs}.json`;
          need(
            await call({ method: "POST", path: `${base}/fs/write`, headers: { "content-type": "application/gzip", "x-cwd": root }, bytes: tarGz([{ name: jobName, data: JSON.stringify(job) }]) }),
            "the job was not written",
          );
          const ran = need(
            await call({
              method: "POST",
              path: `${base}/cmd`,
              json: { command: "node", args: [`${root}/${ENTRY_IN_IMAGE}`, `${root}/${jobName}`, `${root}/${answerName}`], cwd: root, wait: true, timeout: Math.max(1_000, Math.trunc(wallMs)) },
              // The machine kills the process at the wall; the call that waits for it gets a little longer.
              timeoutMs: Math.max(1_000, Math.trunc(wallMs)) + 8_000,
            }),
            "the job did not run",
          );
          const command = commandOf(ran);
          const read = await call({ method: "POST", path: `${base}/fs/read`, json: { path: `${root}/${answerName}` } });
          if (read.status < 200 || read.status >= 300) {
            // No answer file: the process was killed at the wall, or never ran.
            if (command === null || command.exitCode === null || command.exitCode === 137) throw new MachineTimeout(`the machine's process was killed at ${wallMs} ms`);
            throw new MachineFailed("UNREACHABLE", `the machine left no answer (exit ${command.exitCode})`);
          }
          try {
            return JSON.parse(text(read.body)) as MachineAnswer;
          } catch {
            throw new MachineFailed("UNREACHABLE", "the machine's answer is not JSON");
          }
        },
        close: stop,
      };
    },
  };
}

/**
 * The transport on the deployed server: `fetch` to Vercel's API as the deployment itself. `token` is read on every
 * call — the function's own short-lived OIDC token, or an access token the owner set for the machines.
 */
export function vercelTransport(input: { token: () => string | null | Promise<string | null>; fetch?: typeof fetch; base?: string; timeoutMs?: number }): VercelTransport {
  const send = input.fetch ?? fetch;
  const patience = input.timeoutMs ?? 30_000;
  const origin = input.base ?? "https://api.vercel.com";
  return async (request) => {
    const token = await input.token();
    if (!token) throw new Error("no token for Vercel's API");
    const url = new URL(request.path, origin);
    for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...(request.headers ?? {}) };
    let body: BodyInit | undefined;
    if (request.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(request.json);
    } else if (request.bytes !== undefined) {
      body = new Uint8Array(request.bytes);
    }
    // Vercel's API that does not answer is a fault of the machine, never a call that hangs.
    const response = await send(url, { method: request.method, headers, body, cache: "no-store", signal: AbortSignal.timeout(request.timeoutMs ?? patience) });
    return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
  };
}

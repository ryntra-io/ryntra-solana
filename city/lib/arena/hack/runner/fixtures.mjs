// Shared fixtures for the Hack step runner's tests (CITY-225). Not a test file (no `.test.mjs`), so the runner never
// executes it. It reuses the sandbox's fixtures (the made-up world, the stamp key) and adds a session, backends and a
// scripted model gateway so the loop is walked with no network and no key.
import { fileURLToPath } from "node:url";
import * as f from "../sandbox/fixtures.mjs";

export const runner = await import("./index.ts");
export const backendLib = await import("./backend.ts");
export { f };

export const ENGINE_PATH = fileURLToPath(new URL("./testing/toy-engine.mjs", import.meta.url));
export const CHECKS_PATH = fileURLToPath(new URL("./testing/toy-checks.mjs", import.meta.url));
export const HANG_PATH = fileURLToPath(new URL("./testing/hang-engine.mjs", import.meta.url));
export const NET_PATH = fileURLToPath(new URL("./testing/net-engine.mjs", import.meta.url));

/** The in-process backend over the made-up engine, with the stamp for `prove`. */
export const inProc = (over = {}) =>
  backendLib.inProcessBackend({
    engine: f.toy.createToyEngine,
    snapshot: f.recorded(f.makeSnapshot()),
    invariants: [f.CHECK],
    now: () => 1_000,
    stamp: { stamp: f.stamp, verifyStamp: f.verifyStamp },
    ...over,
  });

/** A backend that records the last execute args, around another backend. */
export function capturing(inner) {
  const calls = [];
  return {
    calls,
    async execute(args) {
      calls.push(args);
      return inner.execute(args);
    },
    close: () => inner.close(),
  };
}

/** A session over a backend, with the made-up order's copy. */
export function session(backend, over = {}) {
  const order = over.order ?? f.orderFor().order;
  return runner.createHackSession(
    {
      order,
      pin: over.pin ?? f.pinFor(),
      claim: f.CLAIM,
      actors: over.actors ?? [f.ATTACKER],
      limits: over.limits ?? f.sb.DEFAULT_LIMITS,
      snapshot: over.snapshot ?? f.makeSnapshot(),
      hunter: "agent-7",
      hunterOwner: f.OWNER_A,
      seat: over.seat ?? "attacker",
      runPrefix: "order-1",
    },
    { backend, now: over.now ?? (() => f.AT) },
  );
}

/** The view the brain starts from, for the made-up order. */
export function view(over = {}) {
  const order = over.order ?? f.orderFor().order;
  return {
    seat: over.seat ?? "attacker",
    orderId: order.id,
    orderTitle: order.title,
    target: order.target,
    scope: order.scope,
    claim: f.CLAIM,
    limits: over.limits ?? f.sb.DEFAULT_LIMITS,
    history: [],
  };
}

/** The exploit that reproduces, and the honest run that does not. */
export const EXPLOIT = f.REPRODUCES;
export const HONEST = f.NOT_REPRODUCED;

/** The finding the stub submits. */
export const FINDING_META = { target: { program: f.PROGRAM, instruction: "split" }, vulnClass: "accounting", severity: "high", title: "Split credits every instalment in full" };

/** The plan the stub brain plays: read the vault, run the exploit, submit. */
export const stubPlan = (over = {}) => ({ inspect: f.VAULT, exploit: EXPLOIT, finding: FINDING_META, ...over });

/** A model tool call as the gateway returns it. */
export const toolCall = (name, args) => ({ id: "call-1", name, arguments: JSON.stringify(args) });

/** A gateway that replays a script of steps; each step is a reply, a tool call or a failure. */
export function scriptGateway(steps) {
  let i = 0;
  const reply = (step) => {
    if (step.error) return { ok: false, error: step.error, usage: step.usage ?? null, costMicroUsd: step.costMicroUsd ?? null, answered: null, generationId: null, latencyMs: 1 };
    return {
      ok: true,
      text: step.text ?? null,
      json: null,
      toolCalls: step.toolCalls ?? [],
      reasoning: step.reasoning ?? null,
      finishReason: "stop",
      usage: { input: 1, cached: 0, output: 1, reasoning: 0, total: 2 },
      costMicroUsd: step.costMicroUsd ?? 100,
      answered: { model: null, provider: null, pinned: null },
      generationId: null,
      latencyMs: 1,
    };
  };
  return {
    calls: [],
    async preflight() {
      return { ok: true, model: {}, endpoints: [], stale: false };
    },
    async call(request) {
      this.calls.push(request);
      const step = steps[Math.min(i, steps.length - 1)] ?? { toolCalls: [] };
      i += 1;
      return reply(step);
    },
  };
}

/**
 * The intent pipeline — one order of steps for every value-moving intent.
 *
 *     quote → build → guard → sign → submit → settle → receipt → fee → rewards
 *
 * A line (a swap today; a launch, a perp order, a pool position later) is a
 * list of steps, each tagged with the stage it belongs to. `definePipeline`
 * holds the order when the line is defined: whatever a venue answered is
 * guarded before the wallet sees it, and signed bytes are guarded before
 * their one send. That is how the safety chain (the transaction check, the
 * effect firewall, the review and the owner lock) is a step of the pipeline
 * rather than a copy in each line. The check is on the stages a line's steps
 * carry; that a line's guard steps are the shared chain itself, and not steps
 * merely labelled `guard`, is pinned by that line's own tests.
 *
 * The signature is the person's: the `sign` stage happens in their wallet,
 * between two requests, so a pipeline that runs on a server is two runs — up
 * to the review the wallet signs (`prepare`), and from the signed bytes on
 * (`settle`). Each run stops at the first step that says stop, and what the
 * step stopped with is the answer: a refusal before anything was sent, or a
 * state after it. The runner never retries a step, never skips one and never
 * turns a stop into a success.
 */

export const INTENT_STAGES = ["quote", "build", "guard", "sign", "submit", "settle", "receipt", "fee", "rewards"] as const;
export type IntentStage = (typeof INTENT_STAGES)[number];

/** What a step returns: go on, or stop with this answer. */
export type StepResult<Stop> = Readonly<{ next: true }> | Readonly<{ stop: Stop }>;

export const NEXT: StepResult<never> = Object.freeze({ next: true });

/**
 * What a step reads from an earlier step. Absent means the line put its steps
 * out of order — a fault of the code, never of the person's request — so it
 * fails loudly with the name of what was missing instead of reading null.
 */
export function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`A pipeline step ran before its ${what} was ready: the line's steps are out of order.`);
  return value;
}

export type PipelineStep<Context, Stop> = Readonly<{
  stage: IntentStage;
  /** A stable name, for the trace and the tests. */
  name: string;
  run(context: Context): Promise<StepResult<Stop>> | StepResult<Stop>;
}>;

export type PipelineDefinition<Context, Stop> = Readonly<{
  /** The line this pipeline serves, e.g. `solana-swap`. */
  line: string;
  /** Which half of the intent this run covers. */
  part: "prepare" | "settle";
  steps: readonly PipelineStep<Context, Stop>[];
}>;

/** How long one step took, in milliseconds — what a route's `Server-Timing` names (SOL-S1). */
export type StepTiming = Readonly<{ name: string; ms: number }>;

export type PipelineRun<Stop> =
  | Readonly<{ completed: true; trace: readonly string[]; timings: readonly StepTiming[] }>
  | Readonly<{ completed: false; stop: Stop; stoppedAt: string; trace: readonly string[]; timings: readonly StepTiming[] }>;

const stageIndex = (stage: IntentStage): number => INTENT_STAGES.indexOf(stage);

/**
 * Checks a pipeline's shape once, when it is defined, so a line that breaks
 * the order cannot be loaded at all.
 *
 * - Step names are unique, and no step is the signature: that is the wallet's.
 * - `prepare` holds only steps before the signature — quote, build, guard —
 *   with quote never after build. Guard steps may stand anywhere in it: a
 *   wallet already holding an open review is refused before any venue is
 *   asked, and the bytes are checked after they are built. What is required
 *   is a guard after the last quote or build — a venue's bytes never reach the
 *   wallet unguarded, whichever answer carried them.
 * - `settle` holds only steps after it, and exactly one submit. Every guard
 *   comes before it and there is at least one; settle, receipt, fee and rewards come
 *   after the submit. Receipt, fee and rewards are not ordered among
 *   themselves: a reward is written after the history row, and the last
 *   projection of the receipt may close after both, so a slow projection
 *   never withholds what the operation earned.
 */
export function definePipeline<Context, Stop>(definition: PipelineDefinition<Context, Stop>): PipelineDefinition<Context, Stop> {
  const { line, part, steps } = definition;
  const where = `${line}/${part}`;
  if (steps.length === 0) throw new Error(`${where}: a pipeline has at least one step.`);
  const names = new Set<string>();
  for (const step of steps) {
    if (names.has(step.name)) throw new Error(`${where}: the step ${step.name} is defined twice.`);
    names.add(step.name);
    if (stageIndex(step.stage) < 0) throw new Error(`${where}: ${step.name} names no stage.`);
    if (step.stage === "sign") throw new Error(`${where}: the signature is the person's wallet, never a server step.`);
    const beforeSignature = stageIndex(step.stage) < stageIndex("sign");
    if (part === "prepare" && !beforeSignature) throw new Error(`${where}: ${step.name} (${step.stage}) belongs after the signature.`);
    if (part === "settle" && beforeSignature && step.stage !== "guard") {
      throw new Error(`${where}: ${step.name} (${step.stage}) belongs before the signature.`);
    }
  }
  const positions = (stage: IntentStage) => steps.flatMap((step, index) => (step.stage === stage ? [index] : []));
  if (part === "prepare") {
    const builds = positions("build");
    const quotes = positions("quote");
    if (builds.length > 0 && quotes.some((index) => index > builds[0])) {
      throw new Error(`${where}: a quote step runs after the bytes were built.`);
    }
    /* A venue may hand back bytes with its price, so a quote is guarded like a build: the last step that talks to a venue has a guard after it. */
    const venueSteps = [...quotes, ...builds];
    if (venueSteps.length > 0 && !positions("guard").some((index) => index > Math.max(...venueSteps))) {
      throw new Error(`${where}: a venue answered and nothing guards its bytes before the wallet.`);
    }
  } else {
    /* A settle run exists to send signed bytes once: exactly one submit, guarded first. */
    const submits = positions("submit");
    const guards = positions("guard");
    if (submits.length !== 1) throw new Error(`${where}: a settle run sends the signed bytes exactly once; found ${submits.length} submit steps.`);
    if (guards.length === 0) throw new Error(`${where}: signed bytes are submitted and nothing guards them first.`);
    if (guards.some((index) => index > submits[0])) throw new Error(`${where}: a guard runs after the bytes were submitted.`);
    for (const stage of ["settle", "receipt", "fee", "rewards"] as const) {
      if (positions(stage).some((index) => index < submits[0])) throw new Error(`${where}: a ${stage} step runs before the submit.`);
    }
  }
  return Object.freeze({ line, part, steps: Object.freeze([...steps]) });
}

/** Runs the steps in order until one stops. The trace names every step that ran, and the timings how long each took. */
export async function runPipeline<Context, Stop>(
  pipeline: PipelineDefinition<Context, Stop>,
  context: Context,
): Promise<PipelineRun<Stop>> {
  const trace: string[] = [];
  const timings: StepTiming[] = [];
  for (const step of pipeline.steps) {
    trace.push(step.name);
    const started = performance.now();
    const result = await step.run(context);
    timings.push({ name: step.name, ms: performance.now() - started });
    if ("stop" in result) return { completed: false, stop: result.stop, stoppedAt: step.name, trace, timings };
  }
  return { completed: true, trace, timings };
}

/**
 * A `Server-Timing` header value: each step, then any extra spans. Step names
 * become tokens (`owner-lock-free` → `owner-lock-free`), durations one decimal.
 * Names only — never an address, an amount or a key.
 */
export function serverTimingOf(timings: readonly StepTiming[], extra: readonly StepTiming[] = []): string {
  return [...timings, ...extra]
    .map(({ name, ms }) => `${name.replace(/[^A-Za-z0-9_-]/g, "-")};dur=${Math.max(0, ms).toFixed(1)}`)
    .join(", ");
}

/** The stage of each step, in order — what a reader of a line checks first. */
export function pipelineStages<Context, Stop>(pipeline: PipelineDefinition<Context, Stop>): readonly IntentStage[] {
  return pipeline.steps.map((step) => step.stage);
}

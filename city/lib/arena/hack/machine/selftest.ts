/**
 * One real run of each training range on a machine with no network (CITY-238): what `check.mjs` plays from a
 * developer's computer and what the deployed server plays on its own machine when the operator asks
 * (`GET /api/arena/hack/machine`, `../store/server.ts`) — before the door opens to people.
 *
 * It plays the ranges' known moves (`../ranges/practice.ts`) with a fixed payer and fixed run ids, so the logs are the
 * same bytes on every machine that runs the ranges' engine:
 *   • open-multisig — the practice vault's check breaks → reproduced, the judge says PASS;
 *   • usdc-mint     — the token program refuses → not reproduced, the judge says FAIL;
 *   • council-review — the claimed check already fails in the copy → undecided, the judge says NEEDS_REVIEW.
 * A machine that plays both this way has the image, the engine, the ranges and the judge right — and, since the entry
 * plays nothing on a machine that can reach a network, no way out. Nothing is filed; no order, no store, no money.
 */

import { createHash } from "node:crypto";

import type { Stamper } from "../../../../../lib/ring/judge/index.ts";
import { practiceMoves } from "../ranges/practice.ts";
import { RANGE_ENGINE, type RangeStore } from "../ranges/range.ts";
import { createCopyActors } from "../runner/assemble.ts";
import type { HackAttempt, LastStep } from "../sandbox/index.ts";
import { createMachineBackend } from "./backend.ts";
import type { MachineDriver } from "./protocol.ts";

/** How each range must come out. */
export const SELFTEST_EXPECTED: Readonly<Record<string, { readonly reproduced: boolean | null; readonly verdict: string }>> = {
  "open-multisig": { reproduced: true, verdict: "PASS" },
  "usdc-mint": { reproduced: false, verdict: "FAIL" },
  "council-review": { reproduced: null, verdict: "NEEDS_REVIEW" },
};

export type SelftestRow = {
  readonly range: string;
  readonly ok: boolean;
  readonly refusal: string | null;
  readonly reproduced: boolean | null;
  readonly lastStep: { readonly ok: boolean | null; readonly err: string | null; readonly units: number | null } | null;
  readonly logHash: string | null;
  readonly verdict: string | null;
  readonly deterministic: boolean | null;
  readonly ms: number;
};

export type SelftestResult = {
  readonly machine: string;
  readonly isolated: boolean;
  readonly engine: { readonly id: string; readonly version: string };
  /** Every range came out as it must. */
  readonly ok: boolean;
  readonly ms: number;
  readonly rows: readonly SelftestRow[];
};

/** The check's own payer in the copy: a key from a label, the same everywhere — it exists nowhere but in a copy. */
const payers = () => createCopyActors(1, [createHash("sha256").update("ryntra hack machine check: payer").digest()]);

/** The attempts, one per range with known moves, with fixed run ids. */
export function selftestAttempts(ranges: RangeStore): { id: string; attempt: HackAttempt }[] {
  const actors = payers();
  const out: { id: string; attempt: HackAttempt }[] = [];
  for (const range of ranges.list()) {
    const moves = practiceMoves(range, actors.addresses[0]!);
    if (!moves || !(range.id in SELFTEST_EXPECTED)) continue;
    const inputs = moves.exploit.map((input) => {
      const built = actors.assemble(input.instructions);
      if (!built.ok) throw new Error(`${range.id}: ${built.detail}`);
      return built.input;
    });
    out.push({ id: range.id, attempt: { runId: `check:${range.id}`, pin: range.pin, target: range.target, claim: range.claim, actors: [...actors.addresses], inputs } });
  }
  return out;
}

export type SelftestOptions = {
  readonly driver: MachineDriver;
  readonly ranges: RangeStore;
  /** The harness's stamp for this one check. */
  readonly stamp: { readonly stamp: Stamper; readonly signer: string };
  readonly now?: () => number;
  /** How long past the wall the backend waits for the driver itself (a slow transport on a stand). */
  readonly driverSlackMs?: number;
};

/** Plays the check on one machine of the driver. Never throws: a machine's fault is a row that is not ok. */
export async function runSelftest(options: SelftestOptions): Promise<SelftestResult> {
  const now = options.now ?? Date.now;
  const backend = createMachineBackend({ driver: options.driver, stamp: options.stamp, engine: RANGE_ENGINE, ...(options.driverSlackMs ? { driverSlackMs: options.driverSlackMs } : {}) });
  const started = now();
  const rows: SelftestRow[] = [];
  try {
    const at = now();
    for (const { id, attempt } of selftestAttempts(options.ranges)) {
      const before = now();
      try {
        const out = await backend.execute({ attempt, prove: { at, window: { opensAt: at - 60_000, closesAt: at + 3_600_000 }, costMicroUsd: 0 } });
        const last = out.run.ok ? ((out.run.log.entries.at(-1)?.derived as { last?: LastStep | null } | undefined)?.last ?? null) : null;
        rows.push({
          range: id,
          ok: out.run.ok,
          refusal: out.run.ok ? null : `${out.run.refusal}: ${out.run.detail}`,
          reproduced: out.run.ok ? out.run.reproduced : null,
          lastStep: last && last.kind === "tx" ? { ok: last.ok, err: last.err, units: last.units } : null,
          logHash: out.run.ok ? out.run.logHash : null,
          verdict: out.proof?.judgement?.verdict ?? null,
          deterministic: out.proof?.proof?.deterministic ?? null,
          ms: now() - before,
        });
      } catch (error) {
        rows.push({ range: id, ok: false, refusal: error instanceof Error ? error.message.slice(0, 300) : "the machine failed", reproduced: null, lastStep: null, logHash: null, verdict: null, deterministic: null, ms: now() - before });
      }
    }
  } finally {
    await backend.close().catch(() => undefined);
  }
  const ok = rows.length > 0 && rows.every((row) => row.ok && row.reproduced === SELFTEST_EXPECTED[row.range]?.reproduced && row.verdict === SELFTEST_EXPECTED[row.range]?.verdict && row.deterministic === true);
  return { machine: options.driver.name, isolated: options.driver.isolated, engine: RANGE_ENGINE, ok, ms: now() - started, rows };
}

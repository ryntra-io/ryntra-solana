/**
 * The target and the scope of a Hack order (CITY-223, spec `docs/research/city-hack-2026-11-08/SPEC.md`). A protocol
 * brings its own contract and the audit runs on a **copy**, never on a live mainnet address: the target is either a
 * mainnet fork pinned at a slot (deterministic — a LiteSVM fork, CITY-70/204/D3) or a fresh devnet deploy. The type
 * cannot even name a mainnet target, so no order can point an agent at live money.
 *
 * The scope is a closed allowlist: the programs (and, if given, the instructions and accounts) an agent may touch in
 * the copy. Anything the scope does not name is out of bounds — a finding against it does not count (`rules.ts`).
 *
 * Pure: no store, no clock, no network, no money.
 */

/** A Solana program or account address: base58, 32–44 characters (no 0, O, I, l). */
export const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isAddress = (value: unknown): value is string => typeof value === "string" && ADDRESS.test(value);

/** A short human id (an instruction or vulnerability-class name): 1–64 of A-Z a-z 0-9 . _ : - */
export const NAME = /^[A-Za-z0-9._:-]{1,64}$/;
export const isName = (value: unknown): value is string => typeof value === "string" && NAME.test(value);

/**
 * The copy an order runs on — always a copy, never live mainnet:
 *   fork   — a mainnet fork pinned at a slot, deterministic; `slot` goes into the run config, the rules and the memo.
 *   devnet — a fresh devnet deploy of the protocol's contract.
 */
export type TargetRef =
  | { readonly kind: "fork"; readonly program: string; readonly slot: number }
  | { readonly kind: "devnet"; readonly program: string };

/** The closed allowlist of what an agent may touch in the copy. */
export type Scope = {
  /** The programs in scope — their addresses in the copy. At least one. */
  readonly programs: readonly string[];
  /** When non-empty, only these instruction names are in scope; empty or absent means every instruction of the programs. */
  readonly instructions?: readonly string[];
  /** When non-empty, only these accounts are in scope. */
  readonly accounts?: readonly string[];
  /** For the window's «Details» — what is explicitly out of bounds, said in words. Never read as a rule here. */
  readonly excluded?: readonly string[];
};

/** Where a finding points inside the copy: a program and, optionally, the instruction or account it abuses. */
export type FindingTarget = { readonly program: string; readonly instruction?: string; readonly account?: string };

export type ScopeIssueCode = "BAD_TARGET" | "BAD_SCOPE";
export type ScopeIssue = { readonly code: ScopeIssueCode; readonly detail: string };

const isSlot = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** True for a copy target with a well-formed address (and, for a fork, a pinned slot). Never true for live mainnet. */
export function checkTarget(target: unknown): ScopeIssue | null {
  if (target === null || typeof target !== "object") return { code: "BAD_TARGET", detail: "target is not an object" };
  const t = target as Record<string, unknown>;
  if (t.kind === "fork") {
    if (!isAddress(t.program) || !isSlot(t.slot)) return { code: "BAD_TARGET", detail: "a fork needs a program address and a pinned slot" };
    return null;
  }
  if (t.kind === "devnet") {
    if (!isAddress(t.program)) return { code: "BAD_TARGET", detail: "a devnet target needs a program address" };
    return null;
  }
  return { code: "BAD_TARGET", detail: "target must be a copy: a mainnet fork at a pinned slot or a devnet deploy" };
}

/** The program an order's target runs — the one address the scope must name. */
export const targetProgram = (target: TargetRef): string => target.program;

/** What is wrong with a scope; `null` when it may be used. */
export function checkScope(scope: unknown, target?: TargetRef): ScopeIssue | null {
  if (scope === null || typeof scope !== "object") return { code: "BAD_SCOPE", detail: "scope is not an object" };
  const s = scope as Record<string, unknown>;
  if (!Array.isArray(s.programs) || s.programs.length === 0 || !s.programs.every(isAddress)) {
    return { code: "BAD_SCOPE", detail: "scope needs at least one program address" };
  }
  if (new Set(s.programs as string[]).size !== s.programs.length) return { code: "BAD_SCOPE", detail: "a program is listed twice in scope" };
  for (const key of ["instructions", "accounts", "excluded"] as const) {
    const list = s[key];
    if (list !== undefined && (!Array.isArray(list) || !list.every((v) => typeof v === "string" && v.length > 0))) {
      return { code: "BAD_SCOPE", detail: `scope.${key} must be a list of non-empty strings` };
    }
  }
  if ((s.instructions as unknown[] | undefined)?.some((v) => !isName(v))) return { code: "BAD_SCOPE", detail: "an instruction name is malformed" };
  if ((s.accounts as unknown[] | undefined)?.some((v) => !isAddress(v))) return { code: "BAD_SCOPE", detail: "an account address is malformed" };
  // The target's program must be one the scope opens: an order cannot run on a copy it does not name.
  if (target && !(s.programs as string[]).includes(target.program)) return { code: "BAD_SCOPE", detail: "scope does not name the target's program" };
  return null;
}

/** True when a finding's target is inside the scope: the program is named, and so are the instruction and account it names. */
export function inScope(scope: Scope, target: FindingTarget): boolean {
  if (!scope.programs.includes(target.program)) return false;
  if (scope.instructions && scope.instructions.length > 0 && target.instruction !== undefined && !scope.instructions.includes(target.instruction)) return false;
  if (scope.accounts && scope.accounts.length > 0 && target.account !== undefined && !scope.accounts.includes(target.account)) return false;
  return true;
}

/** True when a finding target is well-formed (a program address, and well-formed instruction/account when present). */
export function isFindingTarget(target: unknown): target is FindingTarget {
  if (target === null || typeof target !== "object") return false;
  const t = target as Record<string, unknown>;
  if (!isAddress(t.program)) return false;
  if (t.instruction !== undefined && !isName(t.instruction)) return false;
  if (t.account !== undefined && !isAddress(t.account)) return false;
  return true;
}

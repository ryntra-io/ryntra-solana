/**
 * What the Ryn workbench is allowed to do with a model, written as a type.
 *
 * The rule: **AI stays Explain / Formalize / Compare / Review and never
 * governs or signs.** That sentence has been a product rule since Home v2,
 * and until this file existed it was a sentence — something a reviewer had
 * to remember while reading a surface. Here it is a closed union with no
 * widening path: `rynOperation` throws on anything else, so a fifth verb
 * cannot be added by a caller, only by editing this list and the test that
 * pins it.
 *
 * **The six forbidden acts are attached to every operation rather than stated
 * once.** They are the same six for all four, and repeating them per operation
 * is deliberate: a surface renders one operation at a time, and a boundary that
 * only exists in a paragraph above the list is a boundary a screen can omit.
 *
 * **Two of the four call no model at all, and the field says so.** Explain and
 * Compare read compiled objects this product already computes — a risk
 * calculation with its formula version, a conflict carrying both disagreeing
 * readings. There is no language generation in that, and describing it as AI
 * would inflate a deterministic read into a capability claim. Formalize and
 * Review *do* need a model, the Strategy Lab already has one behind an
 * anchor/injection/claim guard, and this workbench links to it rather than
 * building a second client with a second prompt version and a second budget.
 */

export const RYN_OPERATIONS = ["EXPLAIN", "FORMALIZE", "COMPARE", "REVIEW"] as const;

export type RynOperation = (typeof RYN_OPERATIONS)[number];

/** The workbench issues no advice, so it holds no advice authority. */
export const RYN_AI_AUTHORITY = "NONE" as const;

/**
 * What no operation may do, in a fixed order.
 *
 * `SUPPLY_MISSING_FACT` and `MATERIAL_ARITHMETIC` are the two that get lost:
 * a model that fills a gap reads as helpful, and a model that adds two numbers
 * reads as convenient. Both turn an evidence surface into a source, which is
 * the failure the whole Evidence Kernel exists to prevent.
 */
export const RYN_FORBIDDEN_ACTS = [
  "GOVERN",
  "AUTHORIZE",
  "SIGN",
  "EXECUTE",
  "SUPPLY_MISSING_FACT",
  "MATERIAL_ARITHMETIC",
] as const;

export type RynForbiddenAct = (typeof RYN_FORBIDDEN_ACTS)[number];

export type RynOperationState = Readonly<{
  operation: RynOperation;
  label: string;
  /** What answers this operation today. */
  servedBy: "DETERMINISTIC" | "GUARDED_STRATEGY_LAB";
  /** Whether a model is called at all. Deterministic operations call none. */
  modelCalled: boolean;
  /** Where the guarded path lives, when the operation has one. */
  href: string | null;
  reason: string;
  aiAuthority: typeof RYN_AI_AUTHORITY;
  forbidden: readonly RynForbiddenAct[];
}>;

export function isRynOperation(value: unknown): value is RynOperation {
  return typeof value === "string" && (RYN_OPERATIONS as readonly string[]).includes(value);
}

/** The only way to obtain an operation. Anything outside the union throws. */
export function rynOperation(value: unknown): RynOperation {
  if (!isRynOperation(value)) {
    throw new Error("Not a permitted assistant operation: " + String(value));
  }
  return value;
}

const STATES: readonly RynOperationState[] = [
  {
    operation: "EXPLAIN",
    label: "Explain",
    servedBy: "DETERMINISTIC",
    modelCalled: false,
    href: null,
    reason:
      "Explaining a compiled object means reading the calculation, its inputs and its version back. No model is called for it.",
    aiAuthority: RYN_AI_AUTHORITY,
    forbidden: RYN_FORBIDDEN_ACTS,
  },
  {
    operation: "FORMALIZE",
    label: "Formalize",
    servedBy: "GUARDED_STRATEGY_LAB",
    modelCalled: true,
    href: "/app/strategy-lab",
    reason:
      "Turning your own words into a typed draft is the one place a model is used, and it already exists behind the Strategy Lab's anchor, injection and claim guards.",
    aiAuthority: RYN_AI_AUTHORITY,
    forbidden: RYN_FORBIDDEN_ACTS,
  },
  {
    operation: "COMPARE",
    label: "Compare",
    servedBy: "DETERMINISTIC",
    modelCalled: false,
    href: null,
    reason:
      "Comparing evidence means showing every source's own reading beside the others. Averaging them, or picking one, would be the product deciding instead of you.",
    aiAuthority: RYN_AI_AUTHORITY,
    forbidden: RYN_FORBIDDEN_ACTS,
  },
  {
    operation: "REVIEW",
    label: "Review",
    servedBy: "GUARDED_STRATEGY_LAB",
    modelCalled: true,
    href: "/app/strategy-lab",
    reason:
      "Reviewing a draft against its evidence runs through the same guarded path, which refuses a change it cannot tie to a named evidence reference.",
    aiAuthority: RYN_AI_AUTHORITY,
    forbidden: RYN_FORBIDDEN_ACTS,
  },
];

export function rynOperations(): readonly RynOperationState[] {
  return STATES;
}

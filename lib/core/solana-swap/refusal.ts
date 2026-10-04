/**
 * What a swap pipeline step stops with.
 *
 * `status`, `code` and `message` are the API contract: the route renders them
 * as `{ error: { code, message, ...extra } }` with that HTTP status, exactly
 * as it did when the steps were written inline. `beforeSubmit` marks a refusal
 * the network never saw (`submitBoundary: "NOT_CROSSED"`), so a browser that
 * wrote its attempt down may let it go.
 */
export type SwapRefusal = Readonly<{
  status: number;
  code: string;
  message: string;
  extra?: object;
  beforeSubmit?: true;
}>;

/**
 * A settled answer that is not an error envelope: a `202` that names the
 * state and the way to recover, or the final `200`. The route sends the body
 * as it stands.
 */
export type SwapStateAnswer = Readonly<{ status: number; body: Record<string, unknown> }>;

export type SwapSettleStop = Readonly<{ kind: "refusal"; refusal: SwapRefusal }> | Readonly<{ kind: "answer"; answer: SwapStateAnswer }>;

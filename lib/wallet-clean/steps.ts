/** What each transaction of a clean is: a close (with a burn where litter stands), a swap into SOL, the close after the swaps. */
export const STEP_KINDS = ["close", "swap", "after"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

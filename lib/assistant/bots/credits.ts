/**
 * Whether Ryntra's bot tools spend assistant credits (AI-04) — an OPEN
 * QUESTION of the bots spec («Відкрите питання: чи коштує це кредитів
 * помічника»), left to the owner. Nothing is decided here.
 *
 * What stands today, by the code as it is: credits are held and taken by the
 * assistant's service alone, for a model call (`lib/assistant/credits/**`).
 * These tools call no model — they compose their answers from the engine's
 * figures — and they import nothing of the credits' ledger (a test checks
 * it), so as built they neither reserve nor take a credit. Should the owner
 * price them, the price becomes a new action in `CREDIT_ACTIONS` with the
 * owner's figure — never a figure set in this file.
 */

export const BOTS_TOOLS_CREDITS = {
  question: "AI-04",
  decided: false,
  /** As built: no model call, no reservation, no charge. */
  charged: false,
} as const;

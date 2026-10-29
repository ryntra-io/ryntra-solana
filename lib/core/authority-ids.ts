/**
 * The authority-matrix rows a client surface draws, apart from the matrix itself (`./authority-matrix.ts`) so a
 * browser bundle takes the ids and never the rows or the switches they read (EXE-1).
 */

/** The bots «Боти» draws, in its order: the grid, the recurring buy, the trade plan. */
export const BOTS_AUTHORITY_IDS = ["meteora-dlmm.grid", "ryntra.recurring-buy", "ryntra.trade-plan"] as const;
export type BotsAuthorityId = (typeof BOTS_AUTHORITY_IDS)[number];

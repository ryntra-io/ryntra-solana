import { HONEST_STATE_WORDS, type AuthorityLocale } from "@/lib/core/authority-words";
import type { HonestState } from "@/lib/core/authority-matrix";

import { StatusChip } from "./status-chip";

/**
 * One of the seven honest states of spec §13.4, said as a word (EXE-1). LIVE, PAPER and PREVIEW are maturities; a
 * switched-off, missing, unread or recovering row is a neutral descriptor — never a colour that reads as a verdict,
 * and never a colour alone: the word is the state.
 */
export function HonestStateChip({ state, locale }: { state: HonestState; locale: AuthorityLocale }) {
  const words = HONEST_STATE_WORDS[state];
  const family = state === "LIVE" || state === "PAPER" || state === "PREVIEW" ? "maturity" : "descriptor";
  return (
    <span data-honest-state={state}>
      <StatusChip family={family} title={words.means[locale]}>
        {words.chip[locale]}
      </StatusChip>
    </span>
  );
}

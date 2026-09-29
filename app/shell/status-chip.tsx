import type { ReactNode } from "react";

import "./status-chip.css";

/**
 * One chip, five families, and a family cannot borrow another's colour.
 *
 * The audit counted sixty-three chip class families across the product and
 * thirteen renderers over six vocabularies — on Agent Control's Mission Control
 * alone: `SOURCE BOUNDED`, `BOUNDARIES`, `AVAILABLE NOW`, `NOT AVAILABLE`,
 * `REQUEST DRIVEN`, `READ ONLY`, `DEMO ONLY`, `NOT OBSERVED` and `H0`, in four
 * tints, saying nine different kinds of thing in one visual language. A reader
 * cannot learn that language because it is not one.
 *
 * The five families are the frozen UX System's own, and so are their tokens:
 *
 *   risk         what a check says. `Verified` is checks-passed, never "safe".
 *                A risk LEVEL is never green — Low is a neutral chip, Moderate
 *                is amber, High is red (law 06).
 *   maturity     how finished a capability is: LIVE · TESTNET · PAPER ·
 *                PREVIEW · BUILDING. It is not a risk and takes no risk colour.
 *   environment  where it runs: TESTNET · DEVNET · MAINNET. An environment is
 *                neither maturity nor risk (law 07) — `TESTNET`, never
 *                `Testnet Verified`.
 *   context      a network, venue or scope. Neutral by construction.
 *   descriptor   a fact about the object — `READ ONLY`, `SOURCE BOUNDED`.
 *                Neutral, because a fact is not a verdict.
 *
 * **The constraint is the point.** `tone` exists only on `risk`, so no other
 * family can be given one; a maturity chip cannot be painted amber to imply
 * concern, and a descriptor cannot be painted green to imply approval. That is
 * the rule the product broke most often, and a type is the only place it can be
 * kept without asking every author to remember it.
 */

export type RiskTone = "verified" | "caution" | "high" | "unknown";

type Common = { children: ReactNode; title?: string };

export type StatusChipProps = Common &
  (
    | { family: "risk"; tone: RiskTone }
    | { family: "maturity" | "environment" | "context" | "descriptor" }
  );

export function StatusChip(props: StatusChipProps) {
  const { family, children, title } = props;
  const tone = family === "risk" ? props.tone : undefined;
  return (
    <span className="rs-status" data-family={family} data-tone={tone} title={title}>
      {children}
    </span>
  );
}

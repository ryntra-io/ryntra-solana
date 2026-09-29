"use client";

import { resolveDepth } from "./layout-store";
import { useShell } from "./shell-state";

/**
 * `Simple | Pro`, once.
 *
 * There were five of these. One hub's `.hub-mode-switch` at 30px with its own
 * locale strings, the shell's `.sh-mode` at 36px, Agent Control's `.acw-mode`
 * at 28px reading **Guided**, and copies in Solana, Stellar and Robinhood
 * Chain — all of them calling the same `setMode` on the same stored
 * preference. One control, five heights, two vocabularies, and four separate
 * copies of the `standard → guided` migration effect.
 *
 * Two things that look cosmetic and are not.
 *
 * **The word.** Shell v2 §18 fixes the user-facing vocabulary at `Simple | Pro`
 * and names the migration `guided → Simple, standard → Simple, pro → Pro`. The
 * stored value stays `guided` — it keys layout preferences people already have,
 * and renaming an id is a migration while renaming a label is copy. Agent
 * Control was the last surface still saying Guided out loud.
 *
 * **No normalisation here any more.** `standard` is the cabinet's old middle
 * depth and this control has no middle. It used to be pushed to Pro from
 * here — through `setMode`, which also marks the depth as *chosen*, so a
 * browser that had never touched the switch was locked into «Профі» for
 * good. Since canon v5.0 (§0.0 rule 9, 2026-09-23) an un-chosen depth of any
 * kind opens «Простий», and that one-time clean-up lives in `shell-state`,
 * where it leaves `depthChosen` alone. This control only records a press.
 */
export function DepthSwitch({
  labels,
}: {
  /** A workspace with its own catalog — one has three locales — passes strings. */
  labels?: Readonly<{ group: string; simple: string; pro: string }>;
}) {
  const { prefs, setMode } = useShell();
  const active = resolveDepth(prefs.mode);

  return (
    <div className="sh-mode" role="group" aria-label={labels?.group ?? "Navigation depth"}>
      {(["guided", "pro"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={active === value}
          onClick={() => setMode(value)}
        >
          {value === "guided" ? (labels?.simple ?? "Simple") : (labels?.pro ?? "Pro")}
        </button>
      ))}
    </div>
  );
}

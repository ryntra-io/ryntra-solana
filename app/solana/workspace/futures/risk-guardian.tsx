"use client";

import { useId, useState } from "react";

import { Button, Icon } from "@ryntra/core/ui";

import type { PhoenixMarginWire } from "@/lib/phoenix/collateral-model";
import { guardianView, type GuardianAction, type GuardianState } from "@/lib/phoenix/risk-guardian";

import type { FuturesWordKey } from "./futures-words";

import styles from "./futures.module.css";

type Word = (key: FuturesWordKey, fill?: Readonly<Record<string, string>>) => string;

/** Each state's own sentence under «Що це означає?». */
const WHAT: Readonly<Record<GuardianState, FuturesWordKey>> = Object.freeze({
  healthy: "guard.whatHealthy",
  raised: "guard.whatRaised",
  critical: "guard.whatCritical",
  stale: "guard.whatStale",
  liquidation: "guard.whatLiquidation",
});

/** A state the person should not be able to miss carries the warning sign, so the word never rests on colour alone. */
const MARKED: ReadonlySet<GuardianState> = new Set(["raised", "critical", "liquidation"]);

/**
 * Risk Guardian (PERP-7; spec §12): the account's state as one compact scale — «Здоровий · Підвищений ризик ·
 * Критичний · Дані застаріли · Ліквідація» — with Phoenix's own grade and the room left as the reason, «Що це
 * означає?» beside it, and the actions the state calls for. In the critical state and under a liquidation
 * «Зменшити» and «Закрити» stand first, before anything that could add risk.
 *
 * Every figure is Phoenix's, read through the Rise SDK; the scale names what the protocol says and adds no verdict of
 * its own. In Pro, «Що це означає?» also opens what Phoenix's risk grades, its liquidations and its ADL actually do.
 */
export function RiskGuardian({
  margins,
  stale,
  hasPositions,
  hasOrders,
  partial,
  pro,
  lang,
  intl,
  w,
  onAct,
}: {
  margins: readonly PhoenixMarginWire[];
  stale: boolean;
  hasPositions: boolean;
  hasOrders: boolean;
  partial: boolean;
  /** Pro opens the protocol's own risk mechanics beside the sentence; Simple keeps the sentence. */
  pro: boolean;
  lang: "en" | "uk";
  intl: string;
  w: Word;
  onAct?: (action: GuardianAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const view = guardianView({ margins, stale, hasPositions, hasOrders, partial });
  /* Phoenix named no grade and the reads are current: there is nothing to report, and «Здоровий» would be a verdict
     of Ryntra's own. The scale stays away until the protocol says something — or until the reads stop. */
  if (view.tier === null && !view.stale) return null;
  const down = view.state === "critical" || view.state === "liquidation";
  /* Rounded down, as every distance to liquidation on this page: the room is never shown larger than it is. */
  const room = view.room === null ? null : Math.floor(view.room * (view.room < 10 ? 10 : 1)) / (view.room < 10 ? 10 : 1);

  return (
    <section className={styles.guardian} data-futures-guardian={view.state} aria-label={w("guard.title")}>
      <p className={styles.risk} data-tone={down ? "down" : undefined}>
        {MARKED.has(view.state) ? <Icon name="triangle-alert" size={16} /> : null}
        <span className={styles.riskLabel}>{w("guard.title")}:</span> <strong>{w(`guard.${view.state}` as FuturesWordKey)}</strong>
        {view.tier === null ? null : <span className={styles.riskLabel}>{` · ${w("guard.tier", { x: w(`risk.${view.tier}` as FuturesWordKey) })}`}</span>}
        {room === null ? null : <span>{` · ${w("riskRoom", { x: new Intl.NumberFormat(intl, { style: "percent", maximumFractionDigits: room < 10 ? 1 : 0 }).format(room / 100) })}`}</span>}
        {/* The figures are old whatever word stands above them: a worse last read is never softened into «дані застаріли». */}
        {view.stale && view.state !== "stale" ? <span className={styles.riskLabel}>{` · ${w("guard.lastRead")}`}</span> : null}
        {/* A subaccount with a position that was not read could be the riskiest: the line says it stands for the rest. */}
        {view.partial ? <span className={styles.riskLabel}>{` · ${w("riskPartial")}`}</span> : null}
      </p>
      {view.actions.length > 0 && onAct ? (
        <div className={styles.guardianActions}>
          {view.actions.map((action, at) => (
            <Button
              key={action}
              /* One orange per screen (the core's rule): in a state that has to be acted on, it is the first action. */
              variant={down && at === 0 ? "primary" : "secondary"}
              lang={lang}
              onClick={() => onAct(action)}
              data-futures-guardian-act={action}
            >
              {w(`guard.${action}` as FuturesWordKey)}
            </Button>
          ))}
        </div>
      ) : null}
      <button type="button" className={styles.guardianWhat} aria-expanded={open} aria-controls={panel} onClick={() => setOpen((shown) => !shown)} data-futures-guardian-what>
        {w("guard.what")}
      </button>
      {open ? (
        <div id={panel} className={styles.guardianText}>
          <p className={styles.muted}>{w(WHAT[view.state])}</p>
          {pro ? (
            <>
              <h4 className={styles.guardianHelpTitle}>{w("guard.help")}</h4>
              <p className={styles.muted}>{w("guard.helpTiers")}</p>
              <p className={styles.muted}>{w("guard.helpLiquidation")}</p>
              <p className={styles.muted}>{w("guard.helpAdl")}</p>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

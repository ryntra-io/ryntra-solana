"use client";

import Link from "next/link";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { CollectView } from "@/lib/predictions/settle-run";
import type { SettlePhase, SettleRow } from "@/lib/predictions/settle";

import { dateShort, timeLeft, usd } from "./format";
import styles from "./predictions.module.css";
import { usePredictionsPaths } from "./surface";
import type { SettlementData } from "./use-settlement";
import { wordsFor, type PredictionWord } from "./words";

/** The phase in the person's words; the provider's own status never reaches the page. */
const PHASE_WORD: Readonly<Record<SettlePhase, PredictionWord>> = {
  trading: "pTrading",
  due_soon: "pDueSoon",
  awaiting: "pAwaiting",
  late: "pLate",
  disputed: "pDisputed",
  payable: "pPayable",
  collecting: "pCollecting",
  paid: "pPaid",
  venue_pays: "pVenuePays",
  lost: "pLost",
  unknown: "pUnknown",
};

function phaseTone(phase: SettlePhase): "good" | "wait" | "bad" | undefined {
  if (phase === "paid" || phase === "venue_pays" || phase === "payable") return "good";
  if (phase === "late" || phase === "disputed" || phase === "unknown") return "bad";
  if (phase === "due_soon" || phase === "collecting" || phase === "awaiting") return "wait";
  return undefined;
}

const COLLECT_WORD: Readonly<Record<CollectView["phase"], PredictionWord>> = { asking: "cAsking", collecting: "cCollecting", collected: "cCollected", unknown: "cUnknown", refused: "cRefused" };

function collectTone(phase: CollectView["phase"]): "good" | "wait" | "bad" | undefined {
  if (phase === "collected") return "good";
  if (phase === "unknown" || phase === "refused") return "bad";
  return "wait";
}

/**
 * Settlement, in one card: the winnings on their way in with the receipt of
 * every step, and the calendar of when each open market of the person is
 * decided — with what is due within the day, what is overdue and what is
 * disputed kept apart, because they mean different things.
 *
 * It never collects by itself from here: the money arrives on its own, and
 * the one button asks the server to run the same pass now.
 */
export function SettlementCard({ settlement, busy, collect, locale }: { settlement: SettlementData | null; busy: boolean; collect: () => Promise<void>; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  if (!settlement) return null;
  const { calendar, collects } = settlement;
  const open = collects.filter((c) => c.phase !== "collected" && c.phase !== "refused");
  const done = collects.filter((c) => c.phase === "collected" || c.phase === "refused");
  const payable = calendar.collecting.filter((r) => r.phase === "payable");

  return (
    <section className={styles.card} aria-labelledby="pred-settle">
      <div className={`${styles.cardHead} ${styles.cardHeadWrap}`}>
        <h2 id="pred-settle" className={styles.cardTitle}>
          {word("settleTitle")}
        </h2>
        {settlement.mode === "paper" ? <span className={styles.paperBadge}>{word("paperBadge")}</span> : null}
      </div>
      <div className={styles.cardBody}>
        <p className={styles.note}>{settlement.mode === "live" ? word("settleAuto") : word("settlePaperNote")}</p>
        {settlement.providerFailure ? (
          <p className={styles.notice} data-tone="caution">
            {word("unavailable")}
          </p>
        ) : null}
      </div>

      {open.length > 0 || done.length > 0 ? (
        <>
          <div className={styles.cardHead} style={{ borderTop: "1px solid var(--ry-border)" }}>
            <h3 className={styles.sectionTitle}>{word("settleIncoming")}</h3>
          </div>
          <div>
            {[...open, ...done].slice(0, 12).map((row) => (
              <div key={row.requestId} className={styles.positionRow}>
                <p className={styles.positionTitle}>{row.question}</p>
                <div className={styles.positionFigures}>
                  <span className={styles.stateChip} data-tone={collectTone(row.phase)}>
                    {word(COLLECT_WORD[row.phase])}
                  </span>
                  <b>{usd(row.amountUsd)}</b>
                  {row.confirmedAt ? <span>{dateShort(row.confirmedAt, locale)}</span> : null}
                </div>
                {row.phase === "unknown" || row.aged ? (
                  <p className={styles.notice} data-tone="caution">
                    {row.aged ? word("cAgedText") : word("cUnknownText")}
                  </p>
                ) : null}
                {row.phase === "refused" ? <p className={styles.hint}>{word("cRefusedText")}</p> : null}
                {row.legs.length > 0 ? (
                  <details className={styles.disclosure}>
                    <summary>{word("receipts")}</summary>
                    <div className={styles.disclosureBody}>
                      {row.legs.map((leg) => (
                        <p key={`${leg.outcomeId}:${leg.status}`} className={styles.mono}>
                          {leg.outcomeId} · {leg.status}
                          {leg.txHash ? ` · ${leg.txHash.slice(0, 10)}…` : ""}
                        </p>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {settlement.mode === "live" && payable.length > 0 ? (
        <div className={styles.formActions}>
          <button type="button" className="rw-btn" disabled={busy} onClick={() => void collect()}>
            {busy ? word("collecting2") : `${word("collectNow")} · ${usd(payable.reduce((sum, r) => sum + r.valueUsd, 0))}`}
          </button>
        </div>
      ) : null}

      <div className={styles.cardHead} style={{ borderTop: "1px solid var(--ry-border)" }}>
        <h3 className={styles.sectionTitle}>{word("settleCalendar")}</h3>
      </div>
      {calendar.rows.length === 0 ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
          {word("settleEmpty")}
        </p>
      ) : (
        <>
          <Group rows={calendar.late} title={word("settleLateGroup")} text={word("settleLateText")} locale={locale} />
          <Group rows={calendar.disputed} title={word("settleDisputedGroup")} text={word("settleDisputedText")} locale={locale} />
          <Group rows={calendar.dueSoon} title={word("settleDueSoonGroup")} text={null} locale={locale} />
          <Rest rows={calendar.rows.filter((r) => r.phase !== "late" && r.phase !== "disputed" && r.phase !== "due_soon")} locale={locale} />
        </>
      )}
    </section>
  );
}

function Group({ rows, title, text, locale }: { rows: readonly SettleRow[]; title: string; text: string | null; locale: WorkspaceLocale }) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.cardBody}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      {text ? <p className={styles.hint}>{text}</p> : null}
      <CalendarTable rows={rows} locale={locale} />
    </div>
  );
}

function Rest({ rows, locale }: { rows: readonly SettleRow[]; locale: WorkspaceLocale }) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.cardBody}>
      <CalendarTable rows={rows} locale={locale} />
    </div>
  );
}

function CalendarTable({ rows, locale }: { rows: readonly SettleRow[]; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const paths = usePredictionsPaths();
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{word("settleWhere")}</th>
            <th>{word("settleResolves")}</th>
            <th>{word("settleState")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 40).map((row) => (
            <tr key={`${row.venueEventId}:${row.question}`}>
              <th scope="row">
                {row.eventId ? (
                  <Link href={paths.event(row.eventId)} prefetch={false} style={{ color: "inherit", textDecoration: "none" }}>
                    {row.question}
                  </Link>
                ) : (
                  row.question
                )}
                {row.valueUsd > 0 ? (
                  <>
                    <br />
                    <small style={{ color: "var(--ry-muted)", fontWeight: 500 }}>{usd(row.valueUsd)}</small>
                  </>
                ) : null}
              </th>
              <td>
                {row.resolutionDate ? (
                  <>
                    {dateShort(row.resolutionDate, locale)}
                    <br />
                    <small style={{ color: "var(--ry-muted)", fontWeight: 500 }}>{timeLeft(row.resolutionDate, locale)}</small>
                  </>
                ) : (
                  word("settleNoDate")
                )}
              </td>
              <td>
                <span className={styles.stateChip} data-tone={phaseTone(row.phase)}>
                  {word(PHASE_WORD[row.phase])}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import { X } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { parseDecimalInput } from "@/lib/plans/decimal-input";
import type { PredictionEvent, PredictionMarket } from "@/lib/predictions/model";
import { normalizeRule, ruleComplete, thresholdShape, WATCH_RULE_KINDS, WATCH_RULE_SHAPES, type WatchDirection, type WatchRuleInput, type WatchRuleKind, type WatchSubject } from "@/lib/predictions/watch/rules";
import { periodWords, ruleSentence, type WatchLocale } from "@/lib/predictions/watch/words";

import styles from "../predictions.module.css";
import { usePredictionsWallet } from "../surface";
import { useWatch } from "../use-watch";
import { wordsFor, type PredictionWord } from "../words";

const KIND_WORD: Readonly<Record<WatchRuleKind, PredictionWord>> = {
  price: "watchKindPrice",
  probability_move: "watchKindProbabilityMove",
  volume_spike: "watchKindVolumeSpike",
  liquidity: "watchKindLiquidity",
  news: "watchKindNews",
  resolution: "watchKindResolution",
  position_value: "watchKindPositionValue",
  venue_spread: "watchKindVenueSpread",
  related_move: "watchKindRelatedMove",
};

const DIRECTION_WORD: Readonly<Record<WatchDirection, PredictionWord>> = { above: "watchDirAbove", below: "watchDirBelow", any: "watchDirAny" };

/** The periods the form offers; a person who wants another writes it as minutes in the field. */
const PERIODS = [60, 360, 1_440, 4_320, 10_080] as const;

/** What the figure field holds here: a probability and points are typed as a percentage, the rest as they are. */
const asPercent = (kind: WatchRuleKind, direction: WatchDirection) => {
  const unit = thresholdShape(kind, direction)?.unit;
  return unit === "probability" || unit === "points";
};

function fieldValue(kind: WatchRuleKind, direction: WatchDirection, threshold: number | null): string {
  if (threshold === null) return "";
  return asPercent(kind, direction) ? String(Math.round(threshold * 1000) / 10) : String(threshold);
}

function fieldToThreshold(kind: WatchRuleKind, direction: WatchDirection, text: string): number | null {
  const value = parseDecimalInput(text);
  if (value === null) return null;
  return asPercent(kind, direction) ? value / 100 : value;
}

/** The unit beside the figure's label, from what that direction's figure means. */
function unitMark(kind: WatchRuleKind, direction: WatchDirection): string {
  const unit = thresholdShape(kind, direction)?.unit;
  return unit === "usd" ? " $" : unit === "times" ? " ×" : unit === undefined ? "" : " %";
}

/**
 * Setting a watch on this market — by hand, or by saying it in words.
 *
 * The words are read into a rule by a parser on the server, not by a model:
 * the same sentence always gives the same rule, and the rule is shown as a
 * sentence of its own before anything is watched. Nothing is watched until
 * the person presses *Turn the watch on*, and a watch never buys.
 */
function WatchSheet({
  subject,
  market,
  locale,
  onClose,
  onSet,
  readWords,
  busy,
}: {
  subject: WatchSubject;
  market: PredictionMarket;
  locale: WorkspaceLocale;
  onClose: () => void;
  onSet: (rule: WatchRuleInput) => Promise<unknown>;
  readWords: (words: string, subject: WatchSubject) => Promise<(Readonly<{ rule: WatchRuleInput; confidence: "named" | "assumed"; complete: boolean }>) | null>;
  busy: boolean;
}) {
  const word = wordsFor(locale);
  const say: WatchLocale = locale === "uk" ? "uk" : "en";
  const [kind, setKind] = useState<WatchRuleKind>("price");
  const shape = WATCH_RULE_SHAPES[kind];
  const [direction, setDirection] = useState<WatchDirection>(shape.directions[0]!);
  const [threshold, setThreshold] = useState<string>(fieldValue("price", "above", WATCH_RULE_SHAPES.price.threshold!.default));
  const [windowMinutes, setWindowMinutes] = useState<number>(1_440);
  const [note, setNote] = useState("");
  const [words, setWords] = useState("");
  const [heard, setHeard] = useState<"idle" | "nothing" | "assumed" | "named">("idle");

  const rule = useMemo<WatchRuleInput>(
    () => normalizeRule({ kind, subject, direction, threshold: fieldToThreshold(kind, direction, threshold), windowMinutes: shape.window === null ? null : windowMinutes, note: note.trim() || null }),
    [kind, subject, direction, threshold, windowMinutes, note, shape.window],
  );
  const complete = ruleComplete(rule);

  const pickKind = useCallback((next: WatchRuleKind) => {
    setKind(next);
    const nextShape = WATCH_RULE_SHAPES[next];
    const nextDirection = nextShape.directions[0]!;
    setDirection(nextDirection);
    setThreshold(fieldValue(next, nextDirection, thresholdShape(next, nextDirection)?.default ?? null));
    if (nextShape.window) setWindowMinutes(nextShape.window.default);
  }, []);

  const dictate = useCallback(async () => {
    const draft = await readWords(words, subject);
    if (!draft) {
      setHeard("nothing");
      return;
    }
    pickKind(draft.rule.kind);
    setDirection(draft.rule.direction);
    setThreshold(fieldValue(draft.rule.kind, draft.rule.direction, draft.rule.threshold));
    if (draft.rule.windowMinutes !== null) setWindowMinutes(draft.rule.windowMinutes);
    setHeard(draft.confidence);
  }, [readWords, words, subject, pickKind]);

  return (
    <div className={styles.overlay} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="pred-watch-title">
        <div className={styles.sheetHead}>
          <h2 id="pred-watch-title">{word("watchTitle")}</h2>
          <button type="button" className={styles.iconButton} aria-label={word("close")} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className={styles.cardBody}>
          <p className={styles.muted}>{market.question}</p>
          <p className={styles.hint}>{word("watchBuysNothing")}</p>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="watch-words">
              {word("watchAsk")}
            </label>
            <div className={styles.moneyAmountRow}>
              <input id="watch-words" className={styles.input} style={{ fontFamily: "var(--ry-font-sans)" }} value={words} placeholder={word("watchAskPlaceholder")} maxLength={400} onChange={(event) => setWords(event.target.value)} />
              <button type="button" className="rw-btn" disabled={busy || words.trim().length === 0} onClick={() => void dictate()}>
                {word("watchAskRead")}
              </button>
            </div>
            {heard === "nothing" ? <p className={styles.error}>{word("watchAskNothing")}</p> : null}
          </div>

          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="watch-kind">
                {word("watchKind")}
              </label>
              <select id="watch-kind" className={styles.selectInput} value={kind} onChange={(event) => pickKind(event.target.value as WatchRuleKind)}>
                {WATCH_RULE_KINDS.map((id) => (
                  <option key={id} value={id}>
                    {word(KIND_WORD[id])}
                  </option>
                ))}
              </select>
            </div>
            {shape.directions.length > 1 ? (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="watch-direction">
                  {word("watchDirection")}
                </label>
                <select
                  id="watch-direction"
                  className={styles.selectInput}
                  value={direction}
                  onChange={(event) => {
                    const next = event.target.value as WatchDirection;
                    setDirection(next);
                    /* The figure can mean something else in another direction: it is reset to that direction's own default rather than reread on the wrong scale. */
                    setThreshold(fieldValue(kind, next, thresholdShape(kind, next)?.default ?? null));
                  }}
                >
                  {shape.directions.map((id) => (
                    <option key={id} value={id}>
                      {word(DIRECTION_WORD[id])}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {thresholdShape(kind, direction) ? (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="watch-threshold">
                  {`${word("watchThreshold")}${unitMark(kind, direction)}`}
                </label>
                <input id="watch-threshold" className={styles.input} inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
              </div>
            ) : null}
            {shape.window ? (
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="watch-window">
                  {word("watchWindow")}
                </label>
                <select id="watch-window" className={styles.selectInput} value={windowMinutes} onChange={(event) => setWindowMinutes(Number(event.target.value))}>
                  {PERIODS.filter((minutes) => minutes >= shape.window!.min && minutes <= shape.window!.max).map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {periodWords(minutes, say)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="watch-note">
              {word("watchNote")}
            </label>
            <input id="watch-note" className={styles.input} style={{ fontFamily: "var(--ry-font-sans)" }} value={note} placeholder={word("watchNotePlaceholder")} maxLength={240} onChange={(event) => setNote(event.target.value)} />
          </div>

          <div className={styles.draftCard}>
            <h3 className={styles.sectionTitle}>{word("watchDraftTitle")}</h3>
            <p>{ruleSentence(rule.kind, rule.direction, rule.threshold, rule.windowMinutes, say)}</p>
            {heard === "assumed" ? <p className={styles.hint}>{word("watchDraftAssumed")}</p> : null}
            {!complete ? <p className={styles.hint}>{word("watchDraftNeedsSide")}</p> : null}
          </div>

          <div className={styles.formActions}>
            <button type="button" className="rw-btn" onClick={onClose}>
              {word("watchDraftDiscard")}
            </button>
            <button
              type="button"
              className="rw-btn rw-btn--primary"
              disabled={busy || !complete}
              onClick={() => {
                void onSet(rule).then(() => onClose());
              }}
            >
              {busy ? word("watchSaving") : word("watchOn")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The watch on this market, where the market's own terms are read.
 *
 * It lists what is already being watched here and opens the form that sets a
 * new one. The signals themselves are read in the portfolio, where every
 * watch of the account stands together — this panel is about this market.
 */
export function WatchMarketPanel({ event, market, outcomeId, outcomeLabel, locale }: { event: PredictionEvent; market: PredictionMarket; outcomeId: string; outcomeLabel: string; locale: WorkspaceLocale }) {
  const word = wordsFor(locale);
  const say: WatchLocale = locale === "uk" ? "uk" : "en";
  const wallet = usePredictionsWallet();
  const proven = wallet.proven ? wallet.address : null;
  const { watch, busy, setRule, readWords, pause, remove } = useWatch(proven, proven !== null);
  const [open, setOpen] = useState(false);

  const subject = useMemo<WatchSubject>(
    () => ({ eventId: event.id, eventTitle: event.title.slice(0, 300), venueMarketId: market.id, question: market.question.slice(0, 300), outcomeId, outcomeLabel: outcomeLabel.slice(0, 64) }),
    [event.id, event.title, market.id, market.question, outcomeId, outcomeLabel],
  );
  const here = (watch?.rules ?? []).filter((row) => row.rule.subject.venueMarketId === market.id);

  return (
    <section className={styles.card} aria-labelledby="pred-watch-market">
      <div className={`${styles.cardHead} ${styles.cardHeadWrap}`}>
        <h2 id="pred-watch-market" className={styles.cardTitle}>
          {word("watchTitle")}
        </h2>
        {proven ? (
          <button type="button" className="rw-btn" onClick={() => setOpen(true)}>
            {word("watchAdd")}
          </button>
        ) : null}
      </div>
      <div className={styles.cardBody}>
        <p className={styles.note}>{word("watchIntro")}</p>
        {proven === null ? <p className={styles.hint}>{word("watchGuest")}</p> : null}
      </div>
      {proven !== null && here.length === 0 ? (
        <p className={styles.muted} style={{ padding: "var(--ry-s3) var(--ry-s4)" }}>
          {word("watchNoRulesHere")}
        </p>
      ) : null}
      {here.map((row) => (
        <div key={row.id} className={styles.positionRow}>
          <p className={styles.positionTitle}>{ruleSentence(row.rule.kind, row.rule.direction, row.rule.threshold, row.rule.windowMinutes, say)}</p>
          {row.rule.note ? <p className={styles.hint}>{row.rule.note}</p> : null}
          <div className={styles.positionFigures}>
            <span className={styles.stateChip}>{row.on ? word("watchWatching") : word("watchPaused")}</span>
            {row.rule.subject.outcomeLabel ? <span>{row.rule.subject.outcomeLabel}</span> : null}
          </div>
          <div className={styles.actions}>
            <button type="button" className="rw-btn" disabled={busy} onClick={() => pause(row.id, !row.on)}>
              {row.on ? word("watchOff") : word("watchResume")}
            </button>
            <button type="button" className="rw-btn" disabled={busy} onClick={() => remove(row.id)}>
              {word("watchRemove")}
            </button>
          </div>
        </div>
      ))}
      {open ? <WatchSheet subject={subject} market={market} locale={locale} busy={busy} onClose={() => setOpen(false)} onSet={setRule} readWords={readWords} /> : null}
    </section>
  );
}

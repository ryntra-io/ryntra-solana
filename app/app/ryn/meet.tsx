"use client";

import { ArrowLeft, Bell } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

import type { AssistantProfile, AssistantProfileResponse, AssistantProfileUpdate } from "@/lib/api/v1/contract";

import type { RynWord } from "./ryn-words";
import styles from "./meet.module.css";

type Word = (w: RynWord) => string;
const HEADERS = { "content-type": "application/json", "X-Ryntra-API": "1" } as const;

type Goal = NonNullable<AssistantProfile["goal"]>;
type Experience = NonNullable<AssistantProfile["experience"]>;
type Horizon = NonNullable<AssistantProfile["horizon"]>;
type Risk = NonNullable<AssistantProfile["riskPct"]>;

const GOALS: readonly (readonly [Goal, RynWord])[] = [
  ["learn", "obGoalLearn"],
  ["trade", "obGoalTrade"],
  ["hold", "obGoalHold"],
];
const EXPERIENCE: readonly (readonly [Experience, RynWord])[] = [
  ["new", "obExpNew"],
  ["some", "obExpSome"],
  ["pro", "obExpPro"],
];
const HORIZONS: readonly (readonly [Horizon, RynWord])[] = [
  ["hours", "obHorHours"],
  ["days", "obHorDays"],
  ["weeks", "obHorWeeks"],
];
const RISKS: readonly Risk[] = [0.5, 1, 2];

/** The person's own clock for the quiet hours; Kyiv where the browser does not say. */
function ownZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Kyiv";
  } catch {
    return "Europe/Kyiv";
  }
}

const pctText = (value: number, locale: "en" | "uk") => (locale === "uk" ? String(value).replace(".", ",") : String(value));

/** The answers in one line — «новачок · дні · 1 % на угоду» — for «Що бачить Ryntra». */
export function profileSummary(profile: AssistantProfile | null, word: Word, locale: "en" | "uk"): string | null {
  if (profile === null || profile.skipped || profile.goal === null || profile.experience === null || profile.horizon === null || profile.riskPct === null) return null;
  const pick = (key: RynWord, index: number) => word(key).split("|")[index] ?? "";
  return [
    pick("obSummaryGoal", GOALS.findIndex(([id]) => id === profile.goal)),
    pick("obSummaryExp", EXPERIENCE.findIndex(([id]) => id === profile.experience)),
    pick("obSummaryHorizon", HORIZONS.findIndex(([id]) => id === profile.horizon)),
    word("obSummaryRisk").replace("{n}", pctText(profile.riskPct, locale)),
  ].join(" · ");
}

/**
 * «Знайомство» (AI-06): five questions in a minute, one press each — the
 * goal, the experience, the risk per trade (1 % unless picked), the horizon,
 * and where Ryntra writes with quiet hours 23:00–08:00 by the person's own
 * clock. Asked once; «Пропустити» is an answer too. The answers shape only how
 * Ryntra words an answer; they are never a reason for a buy or a sell.
 */
export function Meet({ word, locale, read, onSaved, onFirstWatch, onClose, onCancel, compact = false }: { word: Word; locale: "en" | "uk"; read: AssistantProfileResponse; onSaved: (next: AssistantProfileResponse) => void; onFirstWatch: () => void; /** After «Готово»: the card leaves the conversation. */ onClose: () => void; /** «Змінити» from «Що бачить Ryntra»: the answers stay as they were. */ onCancel?: () => void; compact?: boolean }) {
  const heading = useId();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<Goal | null>(read.profile?.goal ?? null);
  const [experience, setExperience] = useState<Experience | null>(read.profile?.experience ?? null);
  const [risk, setRisk] = useState<Risk>(read.profile?.riskPct ?? 1);
  const [horizon, setHorizon] = useState<Horizon | null>(read.profile?.horizon ?? null);
  const [telegram, setTelegram] = useState(read.delivery.telegram);
  const [push, setPush] = useState(read.delivery.push);
  const [quiet, setQuiet] = useState(read.delivery.quietHours !== null || read.profile === null || read.profile.skipped);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const stepRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const moved = useRef(false);

  /* Each answer moves the focus to the next question, so a keyboard follows the press — the chosen answer, else the first. */
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    const here = stepRef.current;
    (here?.querySelector<HTMLElement>("[aria-checked='true']") ?? here?.querySelector<HTMLElement>("button, input"))?.focus({ preventScroll: true });
  }, [step]);

  /* «Змінити» from beside the field: the card stands at the top of the conversation — bring it into view and the focus to its heading. */
  useEffect(() => {
    if (!onCancel) return;
    cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    cardRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the card opens for a change
  }, []);

  const save = async (body: AssistantProfileUpdate) => {
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch("/api/v1/assistant/profile", { method: "PUT", headers: HEADERS, credentials: "same-origin", body: JSON.stringify(body) });
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as AssistantProfileResponse;
      /* The first answers end on «Готово» with the first watch offered; a change ends as it began — back to the conversation. */
      if ("goal" in body && !onCancel) setDone(true);
      onSaved(next);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <section className={styles.card} data-compact={compact || undefined} aria-live="polite">
        <p className={styles.doneLine}>{word("obDone")}</p>
        <div className={styles.foot}>
          <button type="button" className="rw-btn rw-btn--primary" onClick={onFirstWatch}>
            <Bell size={14} weight="bold" aria-hidden="true" />
            <span>{word("obFirstWatch")}</span>
          </button>
          <button type="button" className={styles.skip} onClick={onClose}>
            {word("obClose")}
          </button>
        </div>
      </section>
    );
  }

  const choose = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setStep((at) => Math.min(4, at + 1));
  };
  /* The window kept where the person already has one in Нагляд; 23:00–08:00 by their own clock otherwise. */
  const quietWindow = read.delivery.quietHours ?? { start: "23:00", end: "08:00", timezone: ownZone() };
  const finish = () => {
    if (!goal || !experience || !horizon) return;
    const quietHours = quiet ? quietWindow : null;
    void save({ goal, experience, riskPct: risk, horizon, delivery: { telegram, push, quietHours } });
  };

  const questions: readonly (readonly [RynWord, RynWord | null])[] = [
    ["obGoal", null],
    ["obExperience", null],
    ["obRisk", "obRiskNote"],
    ["obHorizon", null],
    ["obWhere", null],
  ];
  const [question, note] = questions[step];
  /* A question already answered (the 1 % suggested, or the answers being changed) goes on with «Далі» as well as with its own press. */
  const answered = [goal, experience, risk, horizon][step] ?? null;
  return (
    <section ref={cardRef} className={styles.card} data-compact={compact || undefined} aria-labelledby={heading}>
      <div className={styles.head}>
        <h2 id={heading} className={styles.title} tabIndex={-1}>
          {word("obTitle")}
        </h2>
        <span className={styles.step}>{word("obStep").replace("{n}", String(step + 1))}</span>
      </div>
      {step === 0 ? <p className={styles.lead}>{word("obLead")}</p> : null}
      <div className={styles.progress} aria-hidden="true">
        {questions.map((_, index) => (
          <span key={index} data-on={index <= step || undefined} />
        ))}
      </div>
      <div ref={stepRef} className={styles.question}>
        <p className={styles.ask} id={`${heading}-q`} aria-live="polite">
          {word(question)}
        </p>
        {note ? <p className={styles.note}>{word(note)}</p> : null}
        {step === 0 ? <Choices value={goal} options={GOALS} word={word} label={`${heading}-q`} onPick={choose(setGoal)} /> : null}
        {step === 1 ? <Choices value={experience} options={EXPERIENCE} word={word} label={`${heading}-q`} onPick={choose(setExperience)} /> : null}
        {step === 2 ? (
          <Choices value={String(risk)} options={RISKS.map((value) => [String(value), `${pctText(value, locale)} %`] as const)} word={null} label={`${heading}-q`} onPick={(value) => choose(setRisk)(Number(value) as Risk)} />
        ) : null}
        {step === 3 ? <Choices value={horizon} options={HORIZONS} word={word} label={`${heading}-q`} onPick={choose(setHorizon)} /> : null}
        {step === 4 ? (
          <div className={styles.where}>
            <span className={styles.fixed}>{word("obInbox")}</span>
            <label className={styles.check}>
              <input type="checkbox" checked={telegram} onChange={(event) => setTelegram(event.target.checked)} /> Telegram
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={push} onChange={(event) => setPush(event.target.checked)} /> Push
            </label>
            <label className={styles.check} data-wide="">
              <input type="checkbox" checked={quiet} onChange={(event) => setQuiet(event.target.checked)} /> {word("obQuiet").replace("{start}", quietWindow.start).replace("{end}", quietWindow.end)}
            </label>
          </div>
        ) : null}
      </div>
      {failed ? (
        <p className={styles.error} role="alert">
          {word("obFailed")}
        </p>
      ) : null}
      <div className={styles.foot}>
        {step > 0 ? (
          <button type="button" className={styles.back} onClick={() => setStep((at) => at - 1)} disabled={saving}>
            <ArrowLeft size={14} weight="bold" aria-hidden="true" />
            <span>{word("obBack")}</span>
          </button>
        ) : null}
        <span className={styles.spacer} />
        {onCancel ? (
          <button type="button" className={styles.skip} onClick={onCancel} disabled={saving}>
            {word("obCancel")}
          </button>
        ) : (
          <button type="button" className={styles.skip} onClick={() => void save({ skipped: true })} disabled={saving}>
            {word("obSkip")}
          </button>
        )}
        {step < 4 && answered !== null ? (
          <button type="button" className="rw-btn" onClick={() => setStep((at) => at + 1)}>
            {word("obNext")}
          </button>
        ) : null}
        {step === 4 ? (
          <button type="button" className="rw-btn rw-btn--primary" onClick={finish} disabled={saving || !goal || !experience || !horizon}>
            {saving ? word("obSaving") : word("obSave")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One press an answer, the radio pattern for a keyboard: one stop in the group (the chosen answer, else the first),
 * the arrows move between answers without answering; Enter or Space answers.
 */
function Choices<T extends string>({ value, options, word, label, onPick }: { value: T | null; options: readonly (readonly [T, string])[]; word: Word | null; label: string; onPick: (value: T) => void }) {
  const stop = options.some(([id]) => id === value) ? value : options[0]?.[0];
  return (
    <div
      className={styles.choices}
      role="radiogroup"
      aria-labelledby={label}
      onKeyDown={(event) => {
        if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")];
        const at = buttons.indexOf(document.activeElement as HTMLElement);
        const next = (at + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} tabIndex={id === stop ? 0 : -1} className={styles.choice} onClick={() => onPick(id)}>
          {word ? word(text as RynWord) : text}
        </button>
      ))}
    </div>
  );
}

"use client";

import Link from "next/link";
import { ArrowRight, Bell, CalendarBlank, Coins, TrendDown, Wallet } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { LandingCopy, LandingLocale, RuleKindKey } from "./landing-copy";
import { Shot } from "./shot";
import styles from "./blocks.module.css";

const KIND_ICONS: Readonly<Record<RuleKindKey, typeof CalendarBlank>> = { schedule: CalendarBlank, dip: TrendDown, payments: Coins };
const KIND_SHOTS = { schedule: "autoinvest", dip: "dip", payments: "payments" } as const;
/** How long one kind of rule stays in front before the next one takes its place. */
const CYCLE_MS = 5200;

/**
 * «Автоінвест» on the landing — interactive, with light, something moving.
 * The three kinds of rule the product has (regularly, if it falls, from
 * payments), each with the product's own screen of its sheet from
 * `ryntra.io` in the phone beside it.
 * While the block is on screen the kinds take turns on their own, a line under
 * the shown one filling as its turn runs; a press, a pointer over the switch
 * or the keyboard's focus stops the turns, and the kind chosen stays. Under
 * `prefers-reduced-motion` nothing turns by itself.
 *
 * The reminder beside the phone is the product's own words for it («Час твоєї
 * покупки … → Купити»): Ryntra reminds, the person signs.
 */
export function AutoinvestBlock({ copy, locale, reminder }: { copy: LandingCopy["autoinvest"]; locale: LandingLocale; reminder: Readonly<{ head: string; text: string; action: string }> }) {
  const root = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(0);
  const [cycling, setCycling] = useState(false);
  const [turn, setTurn] = useState(0);
  const held = useRef(false);
  const count = copy.kinds.length;

  useEffect(() => {
    const block = root.current;
    if (!block) return;
    block.dataset.js = "";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      block.dataset.seen = "";
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.intersectionRatio >= 0.2) block.dataset.seen = "";
        if (entry.isIntersecting) block.dataset.active = "";
        else delete block.dataset.active;
        setCycling(entry.isIntersecting && !held.current);
      }
    }, { threshold: [0, 0.2] });
    observer.observe(block);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!cycling) return;
    const timer = window.setTimeout(() => {
      setActive((current) => (current + 1) % count);
      setTurn((value) => value + 1);
    }, CYCLE_MS);
    return () => window.clearTimeout(timer);
  }, [cycling, active, count]);

  const hold = () => {
    held.current = true;
    setCycling(false);
  };
  const choose = (index: number) => {
    hold();
    setActive(index);
    setTurn((value) => value + 1);
  };

  const shown = copy.kinds[active];

  return (
    <section ref={root} id="autoinvest" className={styles.block} aria-labelledby="autoinvest-title">
      <div className={`${styles.wrap} ${styles.split}`}>
        <div>
          <div className={styles.head}>
            <p className={`${styles.eyebrow} ${styles.rise}`}>{copy.eyebrow}</p>
            <h2 id="autoinvest-title" className={`${styles.title} ${styles.rise}`} style={{ "--d": 1 } as CSSProperties}>
              <span>{copy.titleLines[0]}</span>{" "}
              <span className={styles.accent}>{copy.titleLines[1]}</span>
            </h2>
            <p className={`${styles.lead} ${styles.rise}`} style={{ "--d": 2 } as CSSProperties}>{copy.lead}</p>
          </div>

          <div
            className={`${styles.kindSwitch} ${styles.rise}${cycling ? ` ${styles.cycling}` : ""}`}
            style={{ "--d": 3, "--cycle": `${CYCLE_MS}ms` } as CSSProperties}
            role="group"
            aria-label={copy.eyebrow}
            onPointerEnter={hold}
            onFocus={hold}
          >
            {copy.kinds.map((kind, index) => {
              const Icon = KIND_ICONS[kind.key];
              return (
                <button key={kind.key} type="button" className={styles.kind} aria-pressed={index === active} onClick={() => choose(index)}>
                  <Icon size={20} weight="bold" aria-hidden />
                  {kind.title}
                  <span className={styles.kindTimer} aria-hidden="true" />
                </button>
              );
            })}
          </div>

          <div key={turn} className={styles.kindPanel} data-turn="" aria-live="polite">
            <p className={styles.kindBody}>{shown.body}</p>
            <p className={styles.example}>{shown.example}</p>
          </div>

          <dl className={`${styles.extras} ${styles.rise}`} style={{ "--d": 4 } as CSSProperties}>
            {copy.extras.map((extra) => (
              <div key={extra.title} className={styles.extra}>
                <dt>{extra.title}</dt>
                <dd>{extra.body}</dd>
              </div>
            ))}
          </dl>
          <p className={`${styles.promise} ${styles.rise}`} style={{ "--d": 5 } as CSSProperties}>
            <Wallet size={20} weight="bold" aria-hidden />
            {copy.promise}
          </p>
          <Link className={`${styles.link} ${styles.rise}`} style={{ "--d": 6 } as CSSProperties} href="/app/autoinvest" prefetch={false}>
            {copy.open}
            <ArrowRight size={18} weight="bold" aria-hidden />
          </Link>
        </div>

        <div className={styles.stage}>
          <span className={styles.bloom} aria-hidden="true" />
          <div className={styles.stagePhones}>
            {copy.kinds.map((kind, index) => (
              <div key={kind.key} data-shown={index === active ? "true" : "false"} aria-hidden={index === active ? undefined : true}>
                <Shot name={KIND_SHOTS[kind.key]} locale={locale} alt={kind.shotAlt} />
              </div>
            ))}
            <div className={styles.reminder} aria-hidden="true">
              <span className={styles.reminderHead}>
                <Bell size={14} weight="fill" />
                Ryntra
              </span>
              <p className={styles.reminderText}>{reminder.head}: {reminder.text}</p>
              <span className={styles.reminderAction}>{reminder.action}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

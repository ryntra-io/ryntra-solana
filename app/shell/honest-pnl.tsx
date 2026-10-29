import type { ReactNode } from "react";

import { HONEST_PNL_METHOD, HONEST_PNL_VERDICT_WORDS, PNL_PERIOD_DAYS, VERDICT_MIN_COMPLETENESS_PCT, type HonestPnl, type HonestPnlWindow } from "@/lib/core/pnl/honest";

import styles from "./honest-pnl.module.css";

/**
 * «Чесний результат» (DSC-2) — one way of showing a result by the honest standard, the same wherever Ryntra shows one:
 * the result after fees (or «Невідомо» — never 0, never a plus), realized and unrealized apart, the fees inside it, the
 * completeness of the data, the drawdown, 7 · 30 · 90 days, and the method one disclosure down. No hooks: it renders
 * on the server (the Journal) and in the browser («Гаманці») alike. Publishes nothing.
 */

type Lang = "en" | "uk";
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const HONEST_PNL_WORDS = {
  title: bi("Honest result", "Чесний результат"),
  result: bi("Result after fees", "Результат після комісій"),
  unknown: bi("Not known", "Невідомо"),
  knownPart: bi("Known part {value} — from {pct} of the data; below {min} % no result is given.", "Відома частина {value} — з {pct} даних; нижче {min} % результату не даємо."),
  realized: bi("Realized", "Реалізовано"),
  unrealized: bi("Unrealized, at the exit price", "Нереалізоване — за ціною виходу"),
  fees: bi("Fees, counted", "Комісії — враховано"),
  completeness: bi("Data completeness", "Повнота даних"),
  drawdown: bi("Drawdown", "Просадка"),
  nothing: bi("—", "—"),
  notKnown: bi("not known", "невідомо"),
  period: bi("Period", "Період"),
  days: bi("{days} days", "{days} днів"),
  whole: bi("All read", "Усе прочитане"),
  trades: bi("Trades", "Угод"),
  method: bi("How it is counted", "Як рахуємо"),
} as const;

export type HonestPnlWord = keyof typeof HONEST_PNL_WORDS;

function say(lang: Lang, key: HonestPnlWord, values?: Readonly<Record<string, string | number>>): string {
  let text: string = HONEST_PNL_WORDS[key][lang];
  if (values) for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

const percent = (value: number, locale: string) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} %`;

/** A result's tone: only a known result has one — an unknown is never green. */
function tone(window: HonestPnlWindow): "up" | "down" | undefined {
  return window.verdict === "PLUS" ? "up" : window.verdict === "MINUS" ? "down" : undefined;
}

export function HonestPnlPanel({
  pnl,
  lang,
  numberLocale,
  format,
  notes = [],
  aside,
  head = true,
}: Readonly<{
  pnl: HonestPnl;
  lang: Lang;
  numberLocale: string;
  /** A figure in the result's unit, with its unit — «+1,25 SOL», «−$12.40». */
  format: (value: number, signed: boolean) => string;
  /** What the surface adds to the method: an estimate it made, a window it read. */
  notes?: readonly string[];
  aside?: ReactNode;
  /** False where the surface already shows the result as its own hero number. */
  head?: boolean;
}>) {
  const whole = pnl.whole;
  const figure = (value: number | null, signed = true) => (value === null ? say(lang, "notKnown") : format(value, signed));
  const resultText = (window: HonestPnlWindow) => (window.verdict === "EMPTY" ? say(lang, "nothing") : window.result === null ? say(lang, "unknown") : format(window.result, true));
  const rows: readonly { key: string; label: string; window: HonestPnlWindow }[] = [
    ...PNL_PERIOD_DAYS.map((days) => ({ key: String(days), label: say(lang, "days", { days }), window: pnl.periods[days] })),
    { key: "whole", label: say(lang, "whole"), window: whole },
  ];

  return (
    <section className={styles.panel} aria-label={say(lang, "title")}>
      {head ? (
      <div className={styles.head}>
        <div className={styles.headline}>
          <span className={styles.label}>{say(lang, "result")}</span>
          <span className={styles.value} data-tone={tone(whole)}>
            {resultText(whole)}
            {whole.pct !== null ? <span className={styles.pct}> ({whole.pct > 0 ? "+" : whole.pct < 0 ? "−" : ""}{percent(Math.abs(whole.pct), numberLocale)})</span> : null}
          </span>
          <span className={styles.verdict} data-verdict={whole.verdict}>{HONEST_PNL_VERDICT_WORDS[whole.verdict][lang]}</span>
        </div>
        {aside}
      </div>
      ) : null}
      {whole.result === null && whole.known !== null && whole.completenessPct !== null ? (
        <p className={styles.known}>{say(lang, "knownPart", { value: format(whole.known, true), pct: percent(whole.completenessPct, numberLocale), min: VERDICT_MIN_COMPLETENESS_PCT })}</p>
      ) : null}
      <dl className={styles.facts}>
        <div>
          <dt>{say(lang, "realized")}</dt>
          <dd>{figure(whole.realized)}</dd>
        </div>
        <div>
          <dt>{say(lang, "unrealized")}</dt>
          <dd>{figure(whole.unrealized)}</dd>
        </div>
        <div>
          <dt>{say(lang, "fees")}</dt>
          <dd>{format(whole.fees, false)}</dd>
        </div>
        <div>
          <dt>{say(lang, "completeness")}</dt>
          <dd data-low={whole.completenessPct !== null && whole.completenessPct < VERDICT_MIN_COMPLETENESS_PCT ? "" : undefined}>{whole.completenessPct === null ? say(lang, "nothing") : percent(whole.completenessPct, numberLocale)}</dd>
        </div>
        <div>
          <dt>{say(lang, "drawdown")}</dt>
          <dd>{whole.drawdown === null ? say(lang, "nothing") : `${whole.drawdown.value > 0 ? "−" : ""}${format(whole.drawdown.value, false)}${whole.drawdown.pct !== null && whole.drawdown.value > 0 ? ` (−${percent(whole.drawdown.pct, numberLocale)})` : ""}`}</dd>
        </div>
      </dl>
      <table className={styles.periods}>
        <thead>
          <tr>
            <th scope="col">{say(lang, "period")}</th>
            <th scope="col">{say(lang, "result")}</th>
            <th scope="col">{say(lang, "completeness")}</th>
            <th scope="col">{say(lang, "trades")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td data-tone={tone(row.window)}>{resultText(row.window)}</td>
              <td>{row.window.completenessPct === null ? say(lang, "nothing") : percent(row.window.completenessPct, numberLocale)}</td>
              <td>{row.window.trades}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className={styles.method}>
        <summary>{say(lang, "method")}</summary>
        <ul>
          {HONEST_PNL_METHOD.map((line) => (
            <li key={line.en}>{line[lang]}</li>
          ))}
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

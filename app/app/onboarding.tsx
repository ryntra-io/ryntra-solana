"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { CheckMark } from "@/app/components/mark";

const LS_KEY = "ryntra-cb-onboarding-dismissed";

const COPY = {
  en: {
    title: "Get started",
    steps: [
      { label: "Plan your first paper trade", hint: "Stop-loss and a written reason are required — discipline starts before the entry.", cta: "Open terminal" },
      { label: "Close a trade and review the journal", hint: "Every closed trade lands there. Tag the mistake, save the lesson.", cta: "Open journal" },
      { label: "Connect your wallet address", hint: "Public address only — unlocks the read-only live view and Telegram fill alerts. Never keys.", cta: "Open settings" },
    ],
  },
  uk: {
    title: "Перші кроки",
    steps: [
      { label: "Сплануй першу paper-угоду", hint: "Стоп-лосс і письмова причина обов'язкові — дисципліна починається до входу.", cta: "Відкрити термінал" },
      { label: "Закрий угоду й переглянь журнал", hint: "Кожна закрита угода потрапляє туди. Тегни помилку, збережи урок.", cta: "Відкрити журнал" },
      { label: "Підключи wallet-адресу", hint: "Лише публічна адреса — розблокує read-only live-режим і Telegram-алерти. Жодних ключів.", cta: "Відкрити налаштування" },
    ],
  },
  ru: {
    title: "Первые шаги",
    steps: [
      { label: "Спланируй первую paper-сделку", hint: "Стоп-лосс и письменная причина обязательны — дисциплина начинается до входа.", cta: "Открыть терминал" },
      { label: "Закрой сделку и просмотри журнал", hint: "Каждая закрытая сделка попадает туда. Тегни ошибку, сохрани урок.", cta: "Открыть журнал" },
      { label: "Подключи wallet-адрес", hint: "Только публичный адрес — разблокирует read-only live-режим и Telegram-алерты. Никаких ключей.", cta: "Открыть настройки" },
    ],
  },
} as const;

/** First-visit checklist. Steps complete themselves from real product state;
    the card disappears once everything is done or when dismissed (localStorage). */
export function Onboarding({ tradesCount, journalCount, hasWallet, lang = "en" }: { tradesCount: number; journalCount: number; hasWallet: boolean; lang?: "en" | "uk" | "ru" }) {
  const [visible, setVisible] = useState(false);
  const t = COPY[lang] ?? COPY.en;

  const done = [tradesCount > 0, journalCount > 0, hasWallet];
  const hrefs = ["/robinhood/workspace/terminal", "/app/journal", "/app/settings"];
  const steps = t.steps.map((s, i) => ({ ...s, done: done[i], href: hrefs[i] }));
  const allDone = steps.every((s) => s.done);

  useEffect(() => {
    if (!allDone && window.localStorage.getItem(LS_KEY) !== "1") setVisible(true);
  }, [allDone]);

  if (!visible || allDone) return null;

  const dismiss = () => {
    window.localStorage.setItem(LS_KEY, "1");
    setVisible(false);
  };
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="cb-card cb-span2 cb-onboard">
      <div className="cb-card-head">
        <h2>{t.title} · {doneCount}/3</h2>
        <button className="cb-onboard-x" onClick={dismiss} aria-label="Dismiss onboarding"><X size={14} weight="bold" /></button>
      </div>
      <ol className="cb-onboard-steps">
        {steps.map((s, i) => (
          <li key={i} className={s.done ? "done" : ""}>
            <span className="cb-onboard-mark" aria-hidden>{s.done ? <CheckMark size={12} /> : i + 1}</span>
            <div>
              <b>{s.label}</b>
              <p>{s.hint}</p>
            </div>
            {!s.done ? <a className="btn btn-ghost btn-sm" href={s.href}>{s.cta}</a> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

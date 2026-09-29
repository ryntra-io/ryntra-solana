"use client";

import { useEffect, useState } from "react";
import { clampRiskRules } from "@/lib/risk";
import { loadRiskRules, saveRiskRules } from "@/lib/risk-settings";
import type { WorkspaceLocale } from "@/app/shell/locale";

type SettingsFormCopy = {
  accountTitle: string;
  langLabel: string;
  walletLabel: string;
  walletHint: string;
  nothingToSave: string;
  saved: string;
  failed: string;
  saving: string;
  save: string;
  riskTitle: string;
  riskPerTrade: string;
  dailyLimit: string;
  lossStreak: string;
  riskHint: string;
  securityTitle: string;
  securityList: readonly string[];
  logout: string;
};

/* The card copy, in the workspace UI locale the page threads in. "Bot & alerts
   language" stays a separate per-account setting — only its label localizes,
   and the option names keep naming each language in itself. EN stays
   byte-identical. */
const COPY = {
  en: {
    accountTitle: "Account",
    langLabel: "Bot & alerts language",
    walletLabel: "Arcus wallet address (public, read-only — never keys)",
    walletHint:
      "The address powers the live account view, real-trade journal and Telegram fill alerts. Changing it re-links your Arcus Submitted step.",
    nothingToSave: "Nothing to save.",
    saved: "Saved",
    failed: "Failed",
    saving: "Saving…",
    save: "Save",
    riskTitle: "Risk Rules",
    riskPerTrade: "Max risk per trade (%)",
    dailyLimit: "Daily loss limit (%)",
    lossStreak: "Loss streak cooldown (trades)",
    riskHint:
      "Stop-loss: always required · Trade plan: always required. Applies to the paper terminal on this device (stored locally).",
    securityTitle: "Security",
    securityList: [
      "Ryntra never asks for seed phrases or private keys.",
      "No deposits to Ryntra — funds stay on Arcus.",
      "Live account view is read-only public data.",
      "Paper trading is fully simulated.",
    ],
    logout: "Log out on this device",
  },
  uk: {
    accountTitle: "Акаунт",
    langLabel: "Мова бота та сповіщень",
    walletLabel: "Адреса гаманця Arcus (публічна, лише читання — ніколи не ключі)",
    walletHint:
      "Адреса вмикає перегляд рахунку наживо, журнал реальних угод і Telegram-сповіщення про виконання. Зміна адреси повторно привʼязує ваш крок «Arcus Submitted».",
    nothingToSave: "Немає чого зберігати.",
    saved: "Збережено",
    failed: "Не вдалося",
    saving: "Збереження…",
    save: "Зберегти",
    riskTitle: "Правила ризику",
    riskPerTrade: "Максимальний ризик на угоду (%)",
    dailyLimit: "Денний ліміт збитку (%)",
    lossStreak: "Пауза після серії збитків (угод)",
    riskHint:
      "Stop-loss: завжди обовʼязковий · План угоди: завжди обовʼязковий. Діє для paper-терміналу на цьому пристрої (зберігається локально).",
    securityTitle: "Безпека",
    securityList: [
      "Ryntra ніколи не просить seed phrase чи приватні ключі.",
      "Жодних депозитів у Ryntra — кошти залишаються на Arcus.",
      "Перегляд рахунку наживо — публічні дані лише для читання.",
      "Paper-трейдинг — повністю симуляція.",
    ],
    logout: "Вийти на цьому пристрої",
  },
} as const satisfies Record<WorkspaceLocale, SettingsFormCopy>;

export function SettingsForm({
  language,
  wallet,
  uiLang = "en",
}: {
  language: string;
  wallet: string | null;
  /** Workspace UI locale (the `ryntra_hub_locale` cookie), threaded in by the
      server page. Distinct from `language`, the per-account bot setting. */
  uiLang?: WorkspaceLocale;
}) {
  const copy = COPY[uiLang] ?? COPY.en;
  const [lang, setLang] = useState(language);
  const [walletIn, setWalletIn] = useState(wallet ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [msgOk, setMsgOk] = useState(false);
  const [saving, setSaving] = useState(false);
  // Risk Rules — string-typed so number inputs don't fight partial entries like "0."
  const [riskPct, setRiskPct] = useState("1");
  const [dailyPct, setDailyPct] = useState("5");
  const [streak, setStreak] = useState("3");
  const [riskMsg, setRiskMsg] = useState<string | null>(null);

  useEffect(() => {
    const r = loadRiskRules();
    setRiskPct(String(r.maxRiskPctWarn));
    setDailyPct(String(r.dailyLossLimitPct));
    setStreak(String(r.lossStreak));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const body: Record<string, string> = {};
    if (lang !== language) body.language = lang;
    if (walletIn && walletIn !== (wallet ?? "")) body.wallet = walletIn.trim();
    if (Object.keys(body).length === 0) { setMsg(copy.nothingToSave); setMsgOk(true); setSaving(false); return; }
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json()) as { error?: string };
    setMsg(r.ok ? copy.saved : j.error ?? copy.failed);
    setMsgOk(r.ok);
    setSaving(false);
    if (r.ok) window.location.reload();
  };

  const saveRisk = () => {
    const clamped = clampRiskRules({
      maxRiskPctWarn: Number(riskPct),
      dailyLossLimitPct: Number(dailyPct),
      lossStreak: Number(streak),
    });
    saveRiskRules(clamped);
    // Echo the clamped values back — the inputs always show what was actually saved.
    setRiskPct(String(clamped.maxRiskPctWarn));
    setDailyPct(String(clamped.dailyLossLimitPct));
    setStreak(String(clamped.lossStreak));
    setRiskMsg(copy.saved);
  };

  return (
    <>
      <section className="cb-card">
        <div className="cb-card-head"><h2>{copy.accountTitle}</h2></div>
        <label className="cb-field">
          <span>{copy.langLabel}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="en">English</option>
            <option value="uk">Українська</option>
            <option value="ru">Русский</option>
          </select>
        </label>
        <label className="cb-field">
          <span>{copy.walletLabel}</span>
          <input value={walletIn} onChange={(e) => setWalletIn(e.target.value)} placeholder="0x…" spellCheck={false} />
        </label>
        <p className="cb-hint">{copy.walletHint}</p>
        {msg ? <p className={msgOk ? "cb-ok" : "dm-err"}>{msg}</p> : null}
        <button className="btn btn-primary btn-sm cb-card-cta" disabled={saving} onClick={() => void save()}>{saving ? copy.saving : copy.save}</button>
      </section>

      <section className="cb-card">
        <div className="cb-card-head"><h2>{copy.riskTitle}</h2></div>
        <label className="cb-field">
          <span>{copy.riskPerTrade}</span>
          <input type="number" min={0.25} max={5} step={0.25} value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
        </label>
        <label className="cb-field">
          <span>{copy.dailyLimit}</span>
          <input type="number" min={1} max={20} step={0.5} value={dailyPct} onChange={(e) => setDailyPct(e.target.value)} />
        </label>
        <label className="cb-field">
          <span>{copy.lossStreak}</span>
          <input type="number" min={2} max={10} step={1} value={streak} onChange={(e) => setStreak(e.target.value)} />
        </label>
        <p className="cb-hint">{copy.riskHint}</p>
        {riskMsg ? <p className="cb-ok">{riskMsg}</p> : null}
        <button className="btn btn-primary btn-sm cb-card-cta" onClick={saveRisk}>{copy.save}</button>
      </section>

      <section className="cb-card">
        <div className="cb-card-head"><h2>{copy.securityTitle}</h2></div>
        <ul className="cb-sec-list">
          {copy.securityList.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {/* Logout is an API endpoint that clears the cookie and redirects: it needs a
            full document navigation, so next/link would be wrong here. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="cb-logout" href="/api/session?logout=1">{copy.logout}</a>
      </section>
    </>
  );
}

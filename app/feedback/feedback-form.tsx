"use client";

import { useState } from "react";

import styles from "./feedback-form.module.css";

const CATEGORIES = [
  { id: "bug", label: "Помилка" },
  { id: "idea", label: "Ідея" },
  { id: "security", label: "Безпека" },
  { id: "other", label: "Інше" },
] as const;

export function FeedbackForm({ source }: { source: "site" | "app" }) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["id"]>("bug");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setStatus(null);
    const r = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        category,
        body,
        locale: document.documentElement.lang || "uk",
        route: window.location.pathname,
      }),
    });
    const json = (await r.json()) as { ref?: string; error?: string };
    setBusy(false);
    if (r.ok && json.ref) {
      setStatus(`Прийнято. Референс ${json.ref}.`);
      setBody("");
      return;
    }
    setStatus(r.status === 503 ? "Інбокс ще не підключений." : "Не вдалося надіслати. Спробуй ще раз.");
  };

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label>
        Категорія
        <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          {CATEGORIES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>
      <label>
        Що сталося
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} minLength={10} required />
      </label>
      <button type="submit" disabled={busy || body.trim().length < 10}>
        {busy ? "Надсилаю…" : "Надіслати"}
      </button>
      {status ? <p role="status">{status}</p> : null}
    </form>
  );
}

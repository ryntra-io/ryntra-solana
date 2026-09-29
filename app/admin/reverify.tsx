"use client";

import { useEffect, useState, type FormEvent } from "react";

import styles from "./admin.module.css";

/**
 * A fresh second factor for a sensitive action.
 *
 * A sensitive admin mutation answers `403 {error:"reverify"}` when the
 * privileged session's last verification is older than the freshness window.
 * `adminPost` catches exactly that answer, asks the host for a code through
 * one window event, sends it to the auth route and retries the original
 * request once. The transitional bot session never answers `reverify`, so
 * nothing here runs for it.
 */
const EVENT = "ryntra:admin-reverify";

type Request = { resolve: (ok: boolean) => void };

export async function adminPost(url: string, body: Record<string, unknown>): Promise<Response> {
  const send = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const first = await send();
  if (first.status !== 403) return first;
  const cloned = first.clone();
  const reason = ((await cloned.json().catch(() => ({}))) as { error?: string }).error;
  if (reason !== "reverify") return first;
  const ok = await new Promise<boolean>((resolve) => window.dispatchEvent(new CustomEvent<Request>(EVENT, { detail: { resolve } })));
  return ok ? send() : first;
}

export function ReverifyHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<Request>).detail;
      setRequest((current) => {
        if (current) current.resolve(false);
        return detail;
      });
      setCode("");
      setProblem(null);
    };
    window.addEventListener(EVENT, onRequest);
    return () => window.removeEventListener(EVENT, onRequest);
  }, []);

  if (!request) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const r = await fetch("/api/admin/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reverify", code }) });
    setBusy(false);
    if (r.ok) {
      request.resolve(true);
      setRequest(null);
      return;
    }
    setProblem(r.status === 422 ? "Код не підійшов. Спробуйте наступний." : "Підтвердження недоступне.");
  };

  const cancel = () => {
    request.resolve(false);
    setRequest(null);
  };

  return (
    <div className={styles.reverifyBackdrop} role="presentation">
      <form className={`${styles.card} ${styles.reverify}`} role="dialog" aria-modal="true" aria-labelledby="reverify-title" onSubmit={(event) => void submit(event)}>
        <h2 id="reverify-title" className={styles.cardTitle}>Підтвердьте другий фактор</h2>
        <p className={styles.pageLead}>Ця дія потребує свіжого коду з застосунку-автентифікатора.</p>
        <label className={styles.field}>
          <span>Код</span>
          <input inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} autoFocus required />
        </label>
        {problem ? <p className={styles.laterCopy} role="alert">{problem}</p> : null}
        <div className={styles.actions}>
          <button type="submit" className={styles.btn} disabled={busy || code.length !== 6}>Підтвердити</button>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={cancel} disabled={busy}>Скасувати</button>
        </div>
      </form>
    </div>
  );
}

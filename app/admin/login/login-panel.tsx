"use client";

import Link from "next/link";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import type { AccountMethods } from "@/lib/account/config";

import styles from "../admin.module.css";

/**
 * Admin login, Ukrainian like the rest of the admin.
 *
 * Steps as the server reports them: sign in to the account (through the
 * product's own sheet — email or Google), then the second factor. The first
 * time, the owner enrols an authenticator: the QR and the secret are shown on
 * this screen and nowhere else; the product does not keep them. Then a
 * six-digit code opens the privileged session.
 */
type Status = "loading" | "signed_out" | "no_account" | "not_operator" | "enrol" | "verify" | "ready" | "unavailable" | "enrolling" | "opened";

type Enrolment = { factorId: string; qr: string; secret: string; uri: string };

/** What the server is about to bind, shown before the owner confirms it. */
type AttachOffer = { intent: string; accountId: string; provider: string; email: string | null };

export function AdminLoginPanel({
  signedIn,
  accountName,
  legacyAdmin,
  recordedAdmin,
  methods,
}: {
  signedIn: boolean;
  accountName: string | null;
  legacyAdmin: boolean;
  recordedAdmin: boolean;
  methods: AccountMethods;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [factorCount, setFactorCount] = useState(0);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [pendingAttach, setPendingAttach] = useState<AttachOffer | null>(null);
  const [code, setCode] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch("/api/admin/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await call({ action: "status" });
    const next = String(data.status ?? "unavailable") as Status;
    /* The factor id comes with the status. A browser that has never enrolled
       anything holds none of its own, and asking it to verify without one was
       how «вже налаштований TOTP у новому браузері» turned into a dead end. */
    setFactorId(typeof data.factorId === "string" ? data.factorId : null);
    setFactorCount(typeof data.factors === "number" ? data.factors : 0);
    setStatus(next);
  }, [call]);

  useEffect(() => {
    if (!methods.email) {
      setStatus("unavailable");
      return;
    }
    void refresh();
  }, [methods.email, refresh]);

  const enroll = async () => {
    setBusy(true);
    setLine(null);
    const { ok, data } = await call({ action: "enroll" });
    if (ok && data.status === "enrolling") {
      setEnrolment({ factorId: String(data.factorId), qr: String(data.qr), secret: String(data.secret), uri: String(data.uri) });
      setFactorId(String(data.factorId));
      setStatus("enrolling");
    } else {
      setLine("Не вдалося почати налаштування другого фактора.");
    }
    setBusy(false);
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLine(null);
    const id = factorId ?? (typeof (await call({ action: "status" })).data.factorId === "string" ? String((await call({ action: "status" })).data.factorId) : null);
    if (!id) {
      setLine("Другий фактор ще не налаштовано в цьому обліковому записі.");
      setBusy(false);
      void refresh();
      return;
    }
    const { ok, data } = await call({ action: "verify", factorId: id, code });
    if (!ok) {
      setLine(data.status === "invalid" ? "Код не підійшов. Спробуйте наступний." : "Перевірка недоступна.");
      setBusy(false);
      return;
    }
    const opened = await call({ action: "open" });
    if (opened.ok && opened.data.status === "opened") {
      setStatus("opened");
      window.location.assign(String(opened.data.next ?? "/admin"));
      return;
    }
    setLine("Другий фактор підтверджено, але сесію адміністратора відкрити не вдалося.");
    setBusy(false);
  };

  const open = async () => {
    setBusy(true);
    const opened = await call({ action: "open" });
    if (opened.ok && opened.data.status === "opened") {
      window.location.assign(String(opened.data.next ?? "/admin"));
      return;
    }
    setLine("Сесію адміністратора відкрити не вдалося.");
    setBusy(false);
  };

  /* Two steps on purpose: the server states exactly which account and which
     identity it is about to join, the owner reads that and confirms. A stale
     or replayed confirmation names a context that no longer exists and is
     refused rather than applied to whatever is current. */
  const proposeAttach = async () => {
    setBusy(true);
    setLine(null);
    const { ok, data } = await call({ action: "attach_intent" });
    if (ok && data.status === "intent") {
      setPendingAttach({
        intent: String(data.intent),
        accountId: String(data.accountId),
        provider: String(data.provider ?? "unknown"),
        email: typeof data.email === "string" ? data.email : null,
      });
    } else {
      setLine(data.status === "signed_out" ? "Спочатку увійдіть у продукт через email або Google, потім поверніться сюди." : "Привʼязування зараз недоступне.");
    }
    setBusy(false);
  };

  const confirmAttach = async () => {
    if (!pendingAttach) return;
    setBusy(true);
    setLine(null);
    const { ok, data } = await call({ action: "attach", intent: pendingAttach.intent, accountId: pendingAttach.accountId });
    setLine(
      ok
        ? "Спосіб входу привʼязано до облікового запису оператора."
        : data.status === "context_changed"
          ? "Контекст змінився: підтвердження застаріло. Почніть привʼязування заново."
          : `Не привʼязано: ${String(data.status)}`,
    );
    setPendingAttach(null);
    setBusy(false);
    void refresh();
  };

  return (
    <main className={styles.loginWrap}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Admin</p>
        <h1 className={styles.pageTitle}>Вхід для оператора</h1>
        <p className={styles.pageLead}>
          Щоденний вхід: обліковий запис (email або Google) і код з застосунку-автентифікатора.
          Посилання з бота лишається перехідним шляхом.
        </p>

        {recordedAdmin ? <p className={styles.pageLead}>Сесію адміністратора вже відкрито. <Link href="/admin">Перейти в адмінку</Link></p> : null}

        {status === "loading" ? <p className={styles.pageLead}>Перевіряю…</p> : null}

        {status === "unavailable" ? (
          <p className={styles.pageLead}>Вхід через обліковий запис ще не ввімкнено. Використайте посилання з бота: надішліть /admin боту @RyntraBeta_bot.</p>
        ) : null}

        {status === "signed_out" || status === "no_account" ? (
          <div className={styles.actions}>
            <p className={styles.pageLead}>{signedIn ? "Обліковий запис є, але сесія провайдера завершилась. Увійдіть ще раз." : "Спочатку увійдіть у продукт."}</p>
            <Link className={styles.btn} href="/app?login=1&reason=generic">Увійти через продукт</Link>
            {legacyAdmin && !pendingAttach ? (
              <button type="button" className={styles.btn} onClick={() => void proposeAttach()} disabled={busy}>
                Привʼязати цей спосіб входу до оператора
              </button>
            ) : null}
          </div>
        ) : null}

        {pendingAttach ? (
          <div className={styles.actions}>
            <p className={styles.pageLead}>
              Привʼязати вхід {pendingAttach.provider}
              {pendingAttach.email ? ` (${pendingAttach.email})` : ""} до облікового запису оператора{" "}
              <code className={styles.mono}>{pendingAttach.accountId.slice(0, 8)}</code>? Після цього цей спосіб входу
              відкриватиме адмінку.
            </p>
            <button type="button" className={styles.btn} onClick={() => void confirmAttach()} disabled={busy}>Підтвердити привʼязку</button>
            <button type="button" className={styles.btn} onClick={() => setPendingAttach(null)} disabled={busy}>Скасувати</button>
          </div>
        ) : null}

        {status === "not_operator" ? (
          <p className={styles.pageLead}>{accountName ?? "Цей обліковий запис"} не є оператором. Якщо це помилка, привʼяжіть спосіб входу з перехідної сесії бота.</p>
        ) : null}

        {status === "enrol" ? (
          <div className={styles.actions}>
            <p className={styles.pageLead}>Другий фактор ще не налаштовано. Додайте застосунок-автентифікатор. Потім додайте другий, на іншому пристрої: це і є резервний доступ, бо одноразових кодів відновлення тут не існує.</p>
            <button type="button" className={styles.btn} onClick={() => void enroll()} disabled={busy}>Налаштувати другий фактор</button>
          </div>
        ) : null}

        {status === "enrolling" && enrolment ? (
          <form className={styles.actions} onSubmit={(event) => void verify(event)}>
            <p className={styles.pageLead}>Відскануйте код у застосунку-автентифікаторі або введіть секрет вручну. Ryntra його не зберігає.</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the verifier, shown once */}
            <img src={enrolment.qr} alt="QR-код для застосунку-автентифікатора" width={180} height={180} />
            <code className={styles.mono}>{enrolment.secret}</code>
            <label className={styles.field}>
              <span>Код із застосунку</span>
              <input inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required />
            </label>
            <button type="submit" className={styles.btn} disabled={busy || code.length !== 6}>Підтвердити і відкрити адмінку</button>
          </form>
        ) : null}

        {status === "verify" ? (
          <form className={styles.actions} onSubmit={(event) => void verify(event)}>
            <label className={styles.field}>
              <span>Код із застосунку-автентифікатора</span>
              <input inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required autoFocus />
            </label>
            <button type="submit" className={styles.btn} disabled={busy || code.length !== 6}>Відкрити адмінку</button>
          </form>
        ) : null}

        {status === "ready" ? (
          <div className={styles.actions}>
            <p className={styles.pageLead}>Другий фактор підтверджено.</p>
            <button type="button" className={styles.btn} onClick={() => void open()} disabled={busy}>Відкрити адмінку</button>
            {factorCount < 2 ? (
              <button type="button" className={styles.btn} onClick={() => void enroll()} disabled={busy}>
                Додати резервний автентифікатор
              </button>
            ) : null}
          </div>
        ) : null}

        {line ? <p className={styles.laterCopy} role="status">{line}</p> : null}

        <p className={styles.laterCopy}>Перехідний шлях: надішліть /admin боту @RyntraBeta_bot і відкрийте одноразове посилання.</p>
      </section>
    </main>
  );
}

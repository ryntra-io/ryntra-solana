"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Warning } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";

import styles from "../../admin.module.css";
import ext from "../../panels.module.css";
import { formatDateTime } from "../../format";
import { adminPost } from "../../reverify";
import own from "./payouts.module.css";

/**
 * Partner payouts, for the owner: closed until the canary's receipt, then automatic, as cashback's are. The canary
 * — $1–2 to a voluntary test wallet, with a reason — is started here, once. Every receipt below, newest first, each
 * line with its pool, rules version and claim transaction, and the payout's own transaction.
 */

type Receipt = Readonly<{
  claimId: string;
  kind: "PARTNER" | "CANARY";
  wallet: string;
  usdMicros: string;
  paidAt: string;
  signature: string;
  basis: string | null;
  requestedBy: string | null;
  lines: readonly Readonly<{ network: string; pool: string; rulesVersion: string; claim: Readonly<{ tx: string; index: string; source: string }>; usdMicros: string }>[];
}>;

type State = Readonly<{
  open: boolean;
  gate: Readonly<{ paidAt: string; signature: string; wallet: string }> | null;
  pause: Readonly<{ paused: boolean; note: string | null; at: string | null }>;
  deciding: readonly Readonly<{ wallet: string; usdMicros: string; state: string; signature: string | null; openedAt: string }>[];
  canary: Readonly<{ state: string; wallet: string; usdMicros: string; basis: string | null; signature: string | null; openedAt: string; note: string | null }> | null;
  limits: Readonly<{ minUsdMicros: string; maxUsdMicros: string }>;
  treasury: Readonly<{ configured: true; address: string; canSign: boolean; state: string; usdMicros: string; freeUsdMicros: string }> | Readonly<{ configured: false }>;
  receipts: readonly Receipt[];
}>;

const usd = (micros: string) => {
  const value = BigInt(micros);
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? "−" : ""}$${(Number(abs) / 1_000_000).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
};
const short = (value: string) => (value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value);
const tx = (signature: string) => `https://solscan.io/tx/${signature}`;

const STATE_TEXT: Record<string, string> = {
  PAID: "Виплачено",
  CLAIMING: "Готується",
  SUBMITTED_UNKNOWN: "Перевіряємо в мережі — не починайте другу",
  FAILED: "Не пройшла — гроші не пішли, можна ще раз",
  INVALID: "Перевірте гаманець, суму ($1–2) і причину",
  ALREADY_OPEN: "Канарку вже виплачено — виплати відкриті",
  RESERVE_SHORT: "У казні бракує вільних USDC",
  RESERVE_UNAVAILABLE: "Казну не вдалося прочитати",
  ALREADY_RUNNING: "Канарка вже йде",
  ON_REVIEW: "Адресу позначено в санкційному списку — канарку не надіслано",
};

/** Stop or resume partner payouts alone, with a reason. Cashback keeps paying. */
function Pause({ state, onDone }: { state: State; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (!state.open) return null;
  const toggle = async () => {
    const note = window.prompt(state.pause.paused ? "Чому відновити виплати партнерам?" : "Чому зупинити виплати партнерам? Кешбек не зупиняється.")?.trim();
    if (!note) return;
    setBusy(true);
    setFailed(null);
    try {
      const response = await adminPost("/api/admin/growth/payouts", { action: state.pause.paused ? "resume" : "pause", note });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setFailed(body.error === "reverify" ? "Потрібен свіжий код другого фактора — нічого не змінено." : `Не вдалося (${body.error ?? response.status}) — нічого не змінено.`);
      }
      await onDone();
    } catch {
      setFailed("Немає зв'язку із сервером — нічого не змінено.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.btnRow}>
      <button type="button" className={`${styles.btn} ${state.pause.paused ? styles.btnGhost : styles.btnDanger}`} onClick={() => void toggle()} disabled={busy}>
        {state.pause.paused ? "Відновити виплати партнерам" : "Зупинити виплати партнерам"}
      </button>
      {state.pause.paused && state.pause.note ? <span className={ext.subtle}>Зупинено: {state.pause.note}</span> : null}
      {failed ? <span className={`${ext.chip} ${ext.chipRisk}`} role="alert">{failed}</span> : null}
    </div>
  );
}

function Canary({ state, onDone }: { state: State; onDone: () => Promise<void> }) {
  const [wallet, setWallet] = useState("");
  const [amount, setAmount] = useState("1.50");
  const [basis, setBasis] = useState("Канарка GR-09: добровільний тестовий рахунок");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!window.confirm(`Надіслати ${amount} USDC з казни винагород на ${wallet}?`)) return;
    setBusy(true);
    setAnswer(null);
    try {
      const response = await adminPost("/api/admin/growth/payouts", { wallet, usd: amount, basis });
      const body = (await response.json().catch(() => ({}))) as { state?: string; error?: string };
      setAnswer(STATE_TEXT[body.state ?? ""] ?? (body.error === "reverify" ? "Потрібен свіжий код другого фактора." : `Не вдалося (${body.error ?? response.status}).`));
      await onDone();
    } finally {
      setBusy(false);
    }
  };
  if (state.open) return null;
  const running = state.canary && (state.canary.state === "CLAIMING" || state.canary.state === "SUBMITTED_UNKNOWN");
  return (
    <form className={own.form} onSubmit={(event) => void submit(event)}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Гаманець Solana тестового рахунку</span>
        <input className={styles.input} value={wallet} onChange={(event) => setWallet(event.target.value.trim())} autoComplete="off" spellCheck={false} required />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Сума, USDC (від 1 до 2)</span>
        <input className={styles.input} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Підстава</span>
        <input className={styles.input} value={basis} onChange={(event) => setBasis(event.target.value)} maxLength={200} required />
      </label>
      <div className={styles.btnRow}>
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || Boolean(running) || !wallet || !state.treasury.configured}>
          Надіслати канарку
        </button>
        {running ? (
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => void onDone()}>
            Перевірити
          </button>
        ) : null}
      </div>
      {answer ? <p className={ext.subtle} role="status">{answer}</p> : null}
    </form>
  );
}

export function PayoutsPanel() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/growth/payouts", { cache: "no-store" });
      if (!response.ok) {
        setError(response.status === 401 ? "Сесія адміністратора закінчилась." : `Виплати недоступні (код ${response.status}).`);
        return;
      }
      setState((await response.json()) as State);
      setError(null);
    } catch {
      setError("Немає зв'язку із сервером.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const treasury = state?.treasury;
  return (
    <>
      <section className={styles.card} aria-labelledby="growth-payouts-title">
        <div className={styles.cardHead}>
          <h2 id="growth-payouts-title" className={styles.cardTitle}>Виплати партнерам</h2>
          <InfoControl label="Як це працює">
            <p>
              Партнер отримує USDC на свій гаманець тим самим шляхом, що кешбек: з казни винагород, мінімум $1, лише з пулів, які можуть
              платити (творець активований, перевірка нічого не тримає). Автоматичний claim відкривається лише після канарки — однієї виплати
              $1–2 на добровільний тестовий рахунок. Її квитанція відкриває виплати назавжди; другої канарки немає. Підписує казна сервера, як
              у кешбеку; ви поповнюєте казну й натискаєте.
            </p>
          </InfoControl>
          <span className={styles.cardSpacer} />
          {state ? (
            <span className={`${ext.chip} ${state.open && !state.pause.paused ? ext.chipOk : ext.chipWarn}`}>
              {!state.open ? "чекають канарки" : state.pause.paused ? "виплати зупинено" : "виплати відкриті"}
            </span>
          ) : null}
        </div>
        {error ? (
          <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
            <Warning size={17} weight="bold" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
        {state ? (
          <>
            <dl className={ext.kv}>
              <div>
                <dt>Казна винагород</dt>
                <dd className={ext.kvMono}>{treasury?.configured ? short(treasury.address) : "не задано"}</dd>
              </div>
              <div>
                <dt>Підпис</dt>
                <dd>{treasury?.configured ? (treasury.canSign ? "ключ задано" : "ключ не задано") : "—"}</dd>
              </div>
              <div>
                <dt>USDC у казні · вільно</dt>
                <dd>{treasury?.configured ? `${usd(treasury.usdMicros)} · ${usd(treasury.freeUsdMicros)}` : "—"}</dd>
              </div>
              <div>
                <dt>Канарка</dt>
                <dd>
                  {state.gate ? (
                    <a href={tx(state.gate.signature)} target="_blank" rel="noreferrer">
                      виплачено {formatDateTime(state.gate.paidAt)}
                    </a>
                  ) : state.canary ? (
                    STATE_TEXT[state.canary.state] ?? state.canary.state
                  ) : (
                    "ще не було"
                  )}
                </dd>
              </div>
            </dl>
            {!treasury?.configured ? <p className={ext.subtle}>У цьому середовищі казну винагород не задано — канарку й виплати тут не надіслати.</p> : null}
            <Canary state={state} onDone={load} />
            <Pause state={state} onDone={load} />
            {state.deciding.length ? (
              <div className={ext.subtle} role="status">
                Ще вирішуються в мережі: {state.deciding.map((row) => `${short(row.wallet)} · ${usd(row.usdMicros)} · з ${formatDateTime(row.openedAt)}`).join("; ")}. Їх перечитує кожен запит партнера; повторно не надсилаються.
              </div>
            ) : null}
          </>
        ) : !error ? (
          <div className={styles.skeleton} aria-hidden="true" />
        ) : null}
      </section>

      <section className={styles.card} aria-labelledby="growth-receipts-title">
        <div className={styles.cardHead}>
          <h2 id="growth-receipts-title" className={styles.cardTitle}>Квитанції</h2>
        </div>
        {state && state.receipts.length === 0 ? <p className={ext.emptyLine}>Виплат ще не було.</p> : null}
        {state && state.receipts.length ? (
          <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Квитанції">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Коли</th>
                  <th scope="col">Кому</th>
                  <th scope="col" className={styles.cellNum}>Сума</th>
                  <th scope="col">Рядки: пул · правила · claim · сума</th>
                  <th scope="col">Виплата</th>
                </tr>
              </thead>
              <tbody>
                {state.receipts.map((receipt) => (
                  <tr key={receipt.claimId}>
                    <td>{formatDateTime(receipt.paidAt)}</td>
                    <td className={styles.cellMono}>
                      {short(receipt.wallet)}
                      {receipt.kind === "CANARY" ? <span className={`${ext.chip} ${ext.chipMuted}`}>канарка</span> : null}
                    </td>
                    <td className={styles.cellNum}>{usd(receipt.usdMicros)}</td>
                    <td>
                      {receipt.kind === "CANARY"
                        ? `${receipt.basis ?? ""} · ${receipt.requestedBy ?? ""}`
                        : receipt.lines.map((line) => (
                            <div key={`${line.pool}:${line.claim.tx}:${line.claim.index}`} className={ext.subtle}>
                              <span className={styles.mono}>{short(line.pool)}</span> · {line.rulesVersion} ·{" "}
                              <a href={tx(line.claim.tx)} target="_blank" rel="noreferrer">
                                {short(line.claim.tx)}
                              </a>{" "}
                              · {usd(line.usdMicros)}
                            </div>
                          ))}
                    </td>
                    <td className={styles.cellMono}>
                      <a href={tx(receipt.signature)} target="_blank" rel="noreferrer">
                        {short(receipt.signature)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}

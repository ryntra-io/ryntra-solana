"use client";

import { useCallback, useEffect, useState } from "react";
import { Warning } from "@phosphor-icons/react";
import { VersionedTransaction } from "@solana/web3.js";

import { InfoControl } from "@/app/shell/info-control";

import styles from "../../admin.module.css";
import ext from "../../panels.module.css";
import { formatDateTime } from "../../format";
import { adminPost } from "../../reverify";

/**
 * The partners' weekly payout (CITY-128), for the operator: each closed week's statement — partners paid, the USDC it
 * pays, what is carried — and the one Squads proposal that pays it, signed here in the operator's own wallet. The server
 * prepares the week and builds the bytes; the wallet signs; the treasury's submit sends. Then the members vote and the
 * Owner executes, each in the wallet.
 */

type Line = Readonly<{ partner: string; people: number; accruedMicros: string; carriedInMicros: string; payMicros: string; carriedOutMicros: string; held: string | null }>;
type Statement = Readonly<{
  week: string;
  preparedAt: string;
  state: "PREPARED" | "PROPOSED" | "PAID" | "VOID";
  lines: readonly Line[];
  totals: Readonly<{ feeMicros: string; accruedMicros: string; payMicros: string; carriedMicros: string; partners: number; paid: number }>;
  proposal: Readonly<{ multisig: string; index: string; executedAt: string | null }> | null;
  rolledInto: string | null;
}>;
type State = Readonly<{ ok: true; on: boolean; network?: string; multisig?: string | null; statements: readonly Statement[] }>;
type Build = Readonly<{ buildId: string; unsignedWireBase64: readonly string[] }>;

type Provider = Readonly<{
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signAllTransactions(transactions: VersionedTransaction[]): Promise<VersionedTransaction[]>;
}>;

const STATE_TEXT: Record<Statement["state"], string> = { PREPARED: "чекає підпису", PROPOSED: "пропозиція в казні", PAID: "виплачено", VOID: "відхилено — перенесено" };
const HELD_TEXT: Record<string, string> = { MINIMUM: "менше $5 — переноситься", SANCTIONS: "у санкційному списку — тримається", OVERFLOW: "понад 40 у тижні — наступного тижня" };

const usd = (micros: string) => `$${(Number(BigInt(micros)) / 1_000_000).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (value: string) => (value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value);

function provider(): Provider | null {
  const scope = window as unknown as { phantom?: { solana?: Provider }; solana?: Provider };
  return scope.phantom?.solana ?? scope.solana ?? null;
}

/**
 * The wallet signs the built bytes; the payout's own route sends them by the treasury's submit, on the payout's network
 * — the treasury page's routes stay off with its switch (CITY-128b). Returns the error to show, or null.
 */
async function signAndSend(build: Build, wallet: string, signer: Provider): Promise<string | null> {
  const unsigned = build.unsignedWireBase64.map((wire) => VersionedTransaction.deserialize(Uint8Array.from(atob(wire), (c) => c.charCodeAt(0))));
  const signed = await signer.signAllTransactions(unsigned);
  const signedWireBase64 = signed.map((tx) => btoa(String.fromCharCode(...tx.serialize())));
  const response = await adminPost("/api/admin/partner-payouts", { act: "submit", buildId: build.buildId, wallet, signedWireBase64 });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; submit?: { state: string }; message?: string };
  if (!response.ok || body.submit?.state === "PARTIAL") return body.message ?? `Не пройшло (код ${response.status}).`;
  return null;
}

export function WeeklyPanel() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/partner-payouts", { cache: "no-store" });
      if (!response.ok) {
        setError(response.status === 401 ? "Сесія адміністратора закінчилась." : `Тижневі виплати недоступні (код ${response.status}).`);
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

  /** One act in the wallet: the week's proposal, a vote «for» or the execution. */
  const act = async (statement: Statement, kind: "propose" | "approve" | "execute") => {
    const signer = provider();
    if (!signer) {
      setNote("Відкрийте сторінку в браузері з гаманцем Solana (Phantom).");
      return;
    }
    setBusy(`${statement.week}:${kind}`);
    setNote(null);
    try {
      const wallet = (signer.publicKey ?? (await signer.connect()).publicKey).toBase58();
      const response = await adminPost("/api/admin/partner-payouts", { act: kind, week: statement.week, wallet });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; build?: Build; message?: string };
      if (!response.ok || !body.build) {
        setNote(body.message ?? `Не зібрано (код ${response.status}).`);
        return;
      }
      setNote(await signAndSend(body.build, wallet, signer));
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "Гаманець не підписав.");
    } finally {
      setBusy(null);
      await load();
    }
  };

  return (
    <section className={styles.card} aria-labelledby="growth-weekly-title">
      <div className={styles.cardHead}>
        <h2 id="growth-weekly-title" className={styles.cardTitle}>Партнерам щотижня</h2>
        <InfoControl label="Як це працює">
          <p>
            Рішення 93: партнер отримує 40 % комісії Ryntra з угод і запусків людей, яких привів, перші 90 днів кожної людини, далі 30 %.
            Щопонеділка закритий тиждень рахується один раз; хто набрав $5 — у виплату, менше переноситься. Одна пропозиція в казні Squads
            на тиждень, USDC усім партнерам; ви підписуєте її у своєму гаманці, сервер нічого не підписує. Повторна пропозиція того самого
            тижня неможлива.
          </p>
        </InfoControl>
        <span className={styles.cardSpacer} />
        {state ? <span className={`${ext.chip} ${state.on ? ext.chipOk : ext.chipWarn}`}>{state.on ? `увімкнено · ${state.network}` : "вимкнено"}</span> : null}
      </div>
      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <Warning size={17} weight="bold" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {note ? (
        <p className={ext.subtle} role="status">
          {note}
        </p>
      ) : null}
      {state && state.statements.length === 0 ? <p className={ext.emptyLine}>Закритих тижнів ще немає.</p> : null}
      {state && state.statements.length ? (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Тижні">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Тиждень</th>
                <th scope="col" className={styles.cellNum}>Нараховано</th>
                <th scope="col" className={styles.cellNum}>До виплати</th>
                <th scope="col" className={styles.cellNum}>Перенесено</th>
                <th scope="col">Партнери</th>
                <th scope="col">Стан</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {state.statements.map((statement) => (
                <tr key={statement.week}>
                  <td>
                    {statement.week}
                    <div className={ext.subtle}>{formatDateTime(statement.preparedAt)}</div>
                  </td>
                  <td className={styles.cellNum}>{usd(statement.totals.accruedMicros)}</td>
                  <td className={styles.cellNum}>{usd(statement.totals.payMicros)}</td>
                  <td className={styles.cellNum}>{usd(statement.totals.carriedMicros)}</td>
                  <td>
                    {statement.lines.map((line) => (
                      <div key={line.partner} className={ext.subtle}>
                        <span className={styles.mono}>{short(line.partner)}</span> · {line.people} · {usd(line.payMicros)}
                        {line.held ? ` · ${HELD_TEXT[line.held] ?? line.held}` : ""}
                      </div>
                    ))}
                  </td>
                  <td>
                    {STATE_TEXT[statement.state]}
                    {statement.proposal ? <div className={ext.subtle}>№ {statement.proposal.index}</div> : null}
                  </td>
                  <td>
                    <div className={styles.btnRow}>
                      {statement.state === "PREPARED" && statement.totals.paid > 0 ? (
                        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy !== null || !state.on} onClick={() => void act(statement, "propose")}>
                          Підписати
                        </button>
                      ) : null}
                      {statement.state === "PROPOSED" ? (
                        <>
                          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={busy !== null} onClick={() => void act(statement, "approve")}>
                            За
                          </button>
                          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy !== null} onClick={() => void act(statement, "execute")}>
                            Виконати
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!state && !error ? <div className={styles.skeleton} aria-hidden="true" /> : null}
    </section>
  );
}

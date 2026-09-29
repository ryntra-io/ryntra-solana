"use client";

import { useCallback, useEffect, useState } from "react";
import { Warning } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import type { SeenWalletRow, SeenWalletsModel } from "@/lib/admin/seen-wallets";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import biz from "./analytics.module.css";
import { formatAgo, formatDate, formatInt } from "../format";

/**
 * The owner's wallets — one card, at the top, with a switch on every wallet
 * the product has seen and a field for one it has not.
 *
 * Marking a wallet *mine* is what keeps the owner's own test trades out of
 * the customer figures: the business dashboard, the funnel and the Points
 * rank read the same list. Nothing is deleted by it — history, receipts and
 * rewards stay; the wallet is simply not a customer any more, and shows
 * tagged under *all activity*.
 */

const LANE_LABEL: Record<string, string> = {
  SWAP: "swap",
  CROSS_SWAP: "bridge",
  BRIDGE: "cctp",
  SEND: "send",
  RECEIVE: "receive",
};

function lanesText(lanes: SeenWalletRow["lanes"]): string {
  const parts = Object.entries(lanes).map(([lane, count]) => `${count} ${LANE_LABEL[lane] ?? lane.toLowerCase()}`);
  return parts.length === 0 ? "" : parts.join(" · ");
}

export function OwnerWalletsPanel({ onChanged }: { onChanged: () => void }) {
  const [model, setModel] = useState<SeenWalletsModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/analytics/wallets");
      if (!response.ok) {
        setError(response.status === 401 ? "Сесія адміністратора закінчилась." : `Список гаманців недоступний (код ${response.status}).`);
        return;
      }
      const json = (await response.json()) as { wallets: SeenWalletsModel };
      setModel(json.wallets);
      setError(null);
    } catch {
      setError("Немає зв'язку із сервером.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mark = useCallback(
    async (wallet: string, mine: boolean, ownLabel?: string) => {
      setBusy(wallet);
      setNote(null);
      try {
        const response = await fetch("/api/admin/analytics/internal-wallets", {
          method: mine ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mine ? { wallet, label: ownLabel && ownLabel.trim() ? ownLabel.trim() : "мій гаманець" } : { wallet }),
        });
        if (!response.ok) {
          setNote(response.status === 400 ? "Це не схоже на адресу Solana або EVM." : "Сховище не відповіло — спробуйте ще раз.");
          return false;
        }
        await load();
        onChanged();
        return true;
      } finally {
        setBusy(null);
      }
    },
    [load, onChanged],
  );

  const add = async () => {
    const wallet = address.trim();
    if (await mark(wallet, true, label)) {
      setAddress("");
      setLabel("");
    }
  };

  const seen = model?.rows ?? [];
  const mine = seen.filter((row) => row.internal);
  const others = seen.filter((row) => !row.internal);

  return (
    <section className={`${styles.card} ${biz.feedCard}`} aria-labelledby="owner-wallets-title">
      <div className={styles.cardHead}>
        <h2 id="owner-wallets-title" className={styles.cardTitle}>Мої гаманці</h2>
        <InfoControl label="Навіщо це">
          <p>
            Позначте свої й тестові гаманці як «мій» — вони перестануть рахуватися як клієнти в усіх зовнішніх
            показниках, воронці та рангу Points, але їхня історія, квитанції й винагороди лишаються. У режимі
            «Уся активність» такі гаманці видно з тегом internal. Показники ключуються Solana-гаманцем; EVM-адреса
            зберігається як ваша примітка про другий бік мостів.
          </p>
        </InfoControl>
        <span className={styles.cardSpacer} />
        {model ? (
          <span className={`${ext.chip} ${model.internalCount > 0 ? ext.chipOk : ext.chipWarn}`}>
            {model.internalCount > 0 ? `моїх: ${model.internalCount}` : "жодного не позначено — усе рахується як клієнти"}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <Warning size={17} weight="bold" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {model ? (
        <>
          {seen.length === 0 ? (
            <p className={ext.emptyLine}>Продукт ще не бачив жодного гаманця.</p>
          ) : (
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Гаманці, які бачив продукт">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Гаманець</th>
                    <th scope="col">Статус</th>
                    <th scope="col" className={styles.cellNum}>Операцій</th>
                    <th scope="col">Що робив</th>
                    <th scope="col" className={styles.cellNum}>Сесій</th>
                    <th scope="col">Вперше</th>
                    <th scope="col">Востаннє</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...mine, ...others].map((row) => (
                    <tr key={row.wallet}>
                      <td>
                        <code className={styles.mono} title={row.wallet}>{row.masked}</code>
                        <span className={ext.subtle}> · {row.kind === "evm" ? "EVM" : "Solana"}</span>
                        {row.invitedBy ? <span className={ext.subtle} title="Запрошений за реферальним лінком"> · від {row.invitedBy}</span> : null}
                      </td>
                      <td>
                        {row.internal ? (
                          <span className={`${ext.chip} ${ext.chipOk}`} title={row.label ?? undefined}>
                            мій{row.label && row.label !== "мій гаманець" ? ` · ${row.label}` : ""}{row.fromEnv ? " · з конфігурації" : ""}
                          </span>
                        ) : (
                          <span className={`${ext.chip} ${ext.chipMuted}`}>клієнт</span>
                        )}
                      </td>
                      <td className={styles.cellNum}>
                        {formatInt(row.operations)}
                        {row.open > 0 ? <span className={ext.statSuffix}> +{row.open} у дорозі</span> : null}
                      </td>
                      <td>{lanesText(row.lanes) || <span className={styles.cellMuted}>—</span>}</td>
                      <td className={styles.cellNum}>{row.sessions > 0 ? formatInt(row.sessions) : <span className={styles.cellMuted}>—</span>}</td>
                      <td title={row.firstSeenAt ?? undefined}>{formatDate(row.firstSeenAt)}</td>
                      <td title={row.lastActiveAt ?? undefined}>{row.lastActiveAt ? formatAgo(row.lastActiveAt) : "—"}</td>
                      <td>
                        {row.fromEnv ? null : (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`}
                            disabled={busy === row.wallet}
                            onClick={() => void mark(row.wallet, !row.internal)}
                          >
                            {busy === row.wallet ? "…" : row.internal ? "Не мій" : "Це мій"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className={biz.walletForm}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Адреса Solana або EVM</span>
              <input
                className={styles.input}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="base58 або 0x…"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Підпис</span>
              <input className={styles.input} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="напр. Phantom, EVM-міст" maxLength={60} />
            </label>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy !== null || address.trim().length < 32} onClick={() => void add()}>
              Додати як мій
            </button>
          </div>
          {note ? <p className={`${styles.hint} ${styles.hintWarn}`} role="status">{note}</p> : null}
        </>
      ) : error ? null : (
        <div className={styles.skeleton} aria-busy="true" aria-label="Читаю гаманці">
          <div className={styles.skeletonRow} />
        </div>
      )}
    </section>
  );
}

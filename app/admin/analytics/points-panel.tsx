"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, Warning } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import type { BusinessScope } from "@/lib/admin/business";
import type { PointsLedgerRow, PointsSort, PointsTableModel, PointsTableRow } from "@/lib/admin/points";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import biz from "./analytics.module.css";
import { formatAgo, formatDate, formatDateTime, formatInt, formatUsd } from "../format";

/**
 * Ryntra Points, for the owner: every wallet's figures, the four sorts, and
 * the ledger behind any row one disclosure down. The same rows and the same
 * rank the person sees on their Rewards page; internal wallets out unless
 * the scope says otherwise.
 */

const SORTS: readonly { id: PointsSort; label: string }[] = [
  { id: "points", label: "Найбільше балів" },
  { id: "volume", label: "Найбільший обсяг" },
  { id: "active", label: "Найактивніші" },
  { id: "newest", label: "Найновіші" },
];

const SCOPES: readonly { id: BusinessScope; label: string }[] = [
  { id: "external", label: "Зовнішні гаманці" },
  { id: "all", label: "Уся активність" },
];

const REASON_LABEL: Record<PointsLedgerRow["reason"], string> = {
  TRADE_VOLUME: "Обсяг угоди",
  ACTIVE_DAY: "Активний день",
  QUALIFIED_REFERRAL: "Кваліфікований реферал",
  STRATEGY_COMPLETED: "Завершена стратегія",
  ADJUSTMENT: "Коригування",
};

const SURFACE_LABEL: Record<string, string> = { SWAP: "Swap", SPOT: "Spot", BRIDGE: "Bridge" };

const VALUATION_LABEL: Record<string, string> = {
  STABLECOIN_PAR: "стейблкоїн за паритетом",
  PROVIDER_STATED_USD: "оцінка провайдера",
  UNVALUED: "без оцінки",
};

function formatPointsText(points: string): string {
  return points.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function Segment<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className={biz.segment} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" className={biz.segmentButton} aria-pressed={option.id === value} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Ledger({ wallet }: { wallet: string }) {
  const [rows, setRows] = useState<readonly PointsLedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(`/api/admin/analytics/points?wallet=${encodeURIComponent(wallet)}`);
        if (!response.ok) throw new Error(String(response.status));
        const json = (await response.json()) as { ledger: readonly PointsLedgerRow[] };
        if (alive) setRows(json.ledger);
      } catch {
        if (alive) setError("Реєстр цього гаманця зараз не читається.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [wallet]);
  if (error) return <p className={ext.emptyLine}>{error}</p>;
  if (rows === null) return <p className={ext.emptyLine}>Читаю реєстр…</p>;
  if (rows.length === 0) return <p className={ext.emptyLine}>Записів немає.</p>;
  return (
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={`Реєстр балів ${wallet}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Коли</th>
            <th scope="col">Причина</th>
            <th scope="col" className={styles.cellNum}>Бали</th>
            <th scope="col">Операція</th>
            <th scope="col" className={styles.cellNum}>Обсяг</th>
            <th scope="col">Оцінка</th>
            <th scope="col">Подія</th>
            <th scope="col">Політика</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.eventId}>
              <td title={row.createdAt}>{formatDateTime(row.createdAt)}</td>
              <td>{REASON_LABEL[row.reason]}</td>
              <td className={styles.cellNum}>{formatPointsText(row.points)}</td>
              <td>
                {row.surface ? SURFACE_LABEL[row.surface] ?? row.surface : "—"}
                {row.operationRef ? (
                  <>
                    {" · "}
                    {/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(row.operationRef) ? (
                      <a href={`https://solscan.io/tx/${row.operationRef}`} target="_blank" rel="noreferrer" className={styles.mono} title={row.operationRef}>
                        {row.operationRef.slice(0, 8)}…
                      </a>
                    ) : (
                      <code className={styles.mono} title={row.operationRef}>{row.operationRef.slice(0, 10)}…</code>
                    )}
                  </>
                ) : null}
                {row.trader && row.reason === "QUALIFIED_REFERRAL" ? (
                  <span className={ext.subtle} title={row.trader}> · {row.trader.slice(0, 4)}…{row.trader.slice(-4)}</span>
                ) : null}
              </td>
              <td className={styles.cellNum}>
                {row.volumeUsd === null ? <span className={styles.cellMuted}>—</span> : formatUsd(row.volumeUsd)}
                {row.dayVolumeBeforeUsd !== null && row.reason === "TRADE_VOLUME" ? (
                  <span className={ext.statSuffix} title="Обсяг дня до цієї операції"> · день до: {formatUsd(row.dayVolumeBeforeUsd)}</span>
                ) : null}
              </td>
              <td>{VALUATION_LABEL[row.valuation] ?? row.valuation}</td>
              <td><code className={styles.mono} title={row.eventId}>{row.eventId.length > 28 ? `${row.eventId.slice(0, 28)}…` : row.eventId}</code></td>
              <td><code className={styles.mono}>{row.policyVersion}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row, onMarkInternal }: { row: PointsTableRow; onMarkInternal: (wallet: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td className={styles.cellNum}>{row.rank === null ? <span className={styles.cellMuted}>—</span> : row.rank}</td>
        <td>
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost} ${styles.mono}`} aria-expanded={open} onClick={() => setOpen((value) => !value)} title={row.walletFull}>
            {row.wallet}
          </button>
          {row.internal ? <> <span className={biz.internalTag}>internal</span></> : null}
        </td>
        <td className={styles.cellNum}>{formatPointsText(row.points)}</td>
        <td className={styles.cellNum}>{row.level}</td>
        <td className={styles.cellNum}>{formatUsd(row.lifetimeVolumeUsd)}</td>
        <td className={styles.cellNum}>{formatUsd(row.volume30dUsd)}</td>
        <td className={styles.cellNum}>{formatInt(row.trades)}</td>
        <td className={styles.cellNum}>{formatInt(row.activeDays)}</td>
        <td className={styles.cellNum}>{formatInt(row.referrals)}</td>
        <td title={row.firstSeenAt ?? undefined}>{formatDate(row.firstSeenAt)}</td>
        <td title={row.lastActiveAt ?? undefined}>{formatAgo(row.lastActiveAt)}</td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={11}>
            <div className={biz.feedDetail}>
              <div className={biz.feedDetailRow}>
                <span className={biz.feedDetailKey}>Гаманець</span>
                <code className={styles.mono}>{row.walletFull}</code>
                {!row.internal ? (
                  <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => onMarkInternal(row.walletFull)}>
                    Позначити внутрішнім
                  </button>
                ) : null}
              </div>
              <Ledger wallet={row.walletFull} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function PointsPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [sort, setSort] = useState<PointsSort>("points");
  const [scope, setScope] = useState<BusinessScope>("external");
  const [model, setModel] = useState<PointsTableModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/analytics/points?sort=${sort}&scope=${scope}`);
      if (!response.ok) {
        setError(response.status === 401 ? "Сесія адміністратора закінчилась." : `Points недоступні (код ${response.status}).`);
        return;
      }
      const json = (await response.json()) as { points: PointsTableModel };
      setModel(json.points);
      setError(null);
    } catch {
      setError("Немає зв'язку із сервером.");
    } finally {
      setLoading(false);
    }
  }, [sort, scope]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const markInternal = useCallback(
    async (wallet: string) => {
      const response = await fetch("/api/admin/analytics/internal-wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, label: "позначено з Points" }),
      });
      if (response.ok) void load();
    },
    [load],
  );

  return (
    <section className={`${styles.card} ${biz.feedCard}`} aria-labelledby="points-title">
      <div className={styles.cardHead}>
        <h2 id="points-title" className={styles.cardTitle}>Ryntra Points</h2>
        <InfoControl label="Що тут рахується">
          <p>
            Бали — реєстр записів, а не одне число: кожен запис має гаманець, подію, причину, операцію, версію
            політики та час. Нараховуються лише за завершені угоди (Swap, Spot, Bridge): перші $1,000 за день — 1 бал
            за долар, далі ставка спадає на $1,000 / $5,000 / $25,000, стеля 10 000 балів на день; +10 за активний
            день від $10; +100 запрошувачу за перший активний день запрошеного. Внутрішні гаманці не нараховують і не
            ранжуються. Місце — те саме, що бачить людина на своїй сторінці Rewards. Публічного лідерборду немає.
          </p>
        </InfoControl>
        <span className={styles.cardSpacer} />
        {model ? <span className={biz.stamp}>політика {model.policyVersion} · станом на {formatDateTime(model.generatedAt)}</span> : null}
      </div>

      <div className={biz.toolbar}>
        <Segment value={sort} options={SORTS} onChange={setSort} label="Сортування" />
        <Segment value={scope} options={SCOPES} onChange={setScope} label="Режим" />
        <span className={biz.toolbarSpacer} />
        {model && model.internalWallets > 0 && scope === "external" ? (
          <span className={`${ext.chip} ${ext.chipMuted}`}>без {model.internalWallets} внутр.</span>
        ) : null}
        <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => void load()} disabled={loading} aria-label="Оновити">
          <ArrowsClockwise size={15} weight="bold" aria-hidden="true" /> {loading ? "Оновлюю…" : "Оновити"}
        </button>
      </div>

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <Warning size={17} weight="bold" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {model ? (
        <>
          <p className={biz.kpiNote}>
            {formatInt(model.ranked)} гаманців із балами · разом {formatPointsText(model.totals.points)} балів ·{" "}
            {formatUsd(model.totals.lifetimeVolumeUsd)} зарахованого обсягу · {formatInt(model.totals.trades)} угод
          </p>
          {model.rows.length === 0 ? (
            <p className={ext.emptyLine}>Балів ще ніхто не заробив — перша завершена угода після релізу відкриє перший рядок.</p>
          ) : (
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Ryntra Points">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.cellNum}>#</th>
                    <th scope="col">Гаманець</th>
                    <th scope="col" className={styles.cellNum}>Бали</th>
                    <th scope="col" className={styles.cellNum}>Рівень</th>
                    <th scope="col" className={styles.cellNum}>Обсяг за весь час</th>
                    <th scope="col" className={styles.cellNum}>Обсяг 30 дн</th>
                    <th scope="col" className={styles.cellNum}>Угод</th>
                    <th scope="col" className={styles.cellNum}>Активних днів</th>
                    <th scope="col" className={styles.cellNum}>Рефералів</th>
                    <th scope="col">Вперше</th>
                    <th scope="col">Востаннє</th>
                  </tr>
                </thead>
                <tbody>
                  {model.rows.map((row) => (
                    <Row key={row.walletFull} row={row} onMarkInternal={(wallet) => void markInternal(wallet)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

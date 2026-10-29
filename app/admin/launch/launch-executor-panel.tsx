"use client";

import { ArrowClockwise, ArrowSquareOut, Pause, Play } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { InfoControl } from "@/app/shell/info-control";
import { launchWords, type LaunchWordKey } from "@/app/app/launch/launch-words";
import type { ExecutorStatus } from "@/lib/launch/executor-admin.server";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import { formatDateTime } from "../format";
import { adminPost } from "../reverify";

const word = launchWords("uk");
const LAMPORTS_PER_SOL = 1_000_000_000;
/** A raw USDC amount (six decimals) in dollars and cents. */
const usdc = (raw: string) => (Number(raw) / 1_000_000).toFixed(2);

/** What the operator is about to flip, waiting for its second press. */
type Pending = Readonly<{ token: string | null; action: "stop" | "resume" | "people-open" | "people-close" }>;

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const solscan = (network: string, kind: "account" | "token", address: string) =>
  `https://solscan.io/${kind}/${address}${network === "solana:devnet" ? "?cluster=devnet" : ""}`;

function since(at: string | null): string {
  if (!at) return "ще не було";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 1000));
  if (seconds < 60) return "щойно";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} хв тому`;
  return formatDateTime(at);
}

/**
 * The executor of Ryntra Launch for the operator: whether it runs here, its SOL, its last pass — and the switch, for one
 * market or for every market. A flip takes two presses; each one that changes what holds is a mark in the markets'
 * flight logs, which anyone reads on the token's page.
 */
export function LaunchExecutorPanel() {
  const [status, setStatus] = useState<ExecutorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<Readonly<{ tone: "ok" | "error"; text: string }> | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/launch-executor", { cache: "no-store" });
      if (!response.ok) {
        setError(response.status === 401 ? "Сесія адміністратора закінчилась." : `Стан не прочитано (код ${response.status}).`);
        return;
      }
      setStatus((await response.json()) as ExecutorStatus);
      setError(null);
    } catch {
      setError("Запит не дійшов до сервера.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const flip = async (next: Pending) => {
    setBusy(true);
    try {
      const response = await adminPost("/api/admin/launch-executor", { action: next.action, token: next.token });
      const json = (await response.json().catch(() => ({}))) as { changed?: boolean; marked?: string[]; status?: ExecutorStatus; error?: string };
      if (!response.ok) {
        setMsg({ tone: "error", text: json.error === "reverify" ? "Потрібен свіжий код автентифікатора." : `Не вдалося: ${json.error ?? response.status}.` });
        return;
      }
      if (json.status) setStatus(json.status);
      const where = next.token ? "на цьому ринку" : "на всіх ринках";
      const done =
        next.action === "people-open"
          ? "Бюджет і драбину на ринках людей увімкнено: з наступного проходу виконавець збирає їхні бюджети."
          : next.action === "people-close"
            ? "Бюджет і драбину на ринках людей вимкнено: нічого нового там не підписується, бюджети чекають у пулах."
            : `${next.action === "stop" ? "Виконавця зупинено" : "Виконавця відновлено"} ${where}. Записів у журналі: ${json.marked?.length ?? 0}.`;
      setMsg(json.changed ? { tone: "ok", text: done } : { tone: "ok", text: "Нічого не змінилось: так уже було." });
    } catch {
      setMsg({ tone: "error", text: "Запит не дійшов до сервера." });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  /** A switch: the first press asks, the second flips. */
  const Switch = ({ token, stopped, label }: { token: string | null; stopped: boolean; label: string }) => {
    const action = stopped ? "resume" : "stop";
    const asking = pending !== null && pending.token === token && pending.action === action;
    if (asking) {
      return (
        <span className={ext.inlineActions}>
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${action === "stop" ? styles.btnDanger : styles.btnPrimary}`} disabled={busy} onClick={() => void flip({ token, action })}>
            {busy ? "Зачекай…" : action === "stop" ? "Так, зупинити" : "Так, відновити"}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} disabled={busy} onClick={() => setPending(null)}>
            Скасувати
          </button>
        </span>
      );
    }
    return (
      <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={busy} onClick={() => setPending({ token, action })} aria-label={label}>
        {stopped ? <Play size={14} weight="bold" aria-hidden /> : <Pause size={14} weight="bold" aria-hidden />}
        {stopped ? "Відновити" : "Зупинити"}
      </button>
    );
  };

  /** The budget and the ladder on people's Micro markets: the first press asks, the second flips — the money is Ryntra's. */
  const PeopleSwitch = ({ open }: { open: boolean }) => {
    const action = open ? "people-close" : "people-open";
    const asking = pending !== null && pending.token === null && pending.action === action;
    if (asking) {
      return (
        <span className={ext.inlineActions}>
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${open ? styles.btnDanger : styles.btnPrimary}`} disabled={busy} onClick={() => void flip({ token: null, action })}>
            {busy ? "Зачекай…" : open ? "Так, вимкнути" : "Так, увімкнути — гроші Ryntra"}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} disabled={busy} onClick={() => setPending(null)}>
            Скасувати
          </button>
        </span>
      );
    }
    return (
      <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={busy} onClick={() => setPending({ token: null, action })}>
        {open ? <Pause size={14} weight="bold" aria-hidden /> : <Play size={14} weight="bold" aria-hidden />}
        {open ? "Вимкнути" : "Увімкнути"}
      </button>
    );
  };

  const runs = status ? status.keyHere && status.laneOpen && !status.all.stopped && status.lastPassAt !== null && Date.now() - Date.parse(status.lastPassAt) < 15 * 60_000 : false;

  return (
    <div>
      <div className={styles.cardHead}>
        <h1 className={styles.pageTitle}>Виконавець лаунчу</h1>
        <InfoControl label="Що тут робиться">
          <p>
            Виконавець проходить по всіх ринках, запущених на Ryntra, щохвилини: надсилає вихід на DEX, щойно крива набрала
            поріг, і повторює невдалий вихід сам. Бюджет і драбина з комісій — на ринках, які запустила сама Ryntra, а на
            ринках людей на Micro — лише поки ввімкнено вимикач «Ринки людей». Вимикач зупиняє виконавця на одному ринку чи на всіх: поки зупинено, він нічого там не
            підписує. Кожна зупинка й кожне відновлення — запис у бортовому журналі ринку, який бачить кожен.
          </p>
        </InfoControl>
      </div>

      {msg ? (
        <p className={`${styles.banner} ${msg.tone === "error" ? styles.bannerError : styles.bannerOk}`} role="status">
          {msg.text}
        </p>
      ) : null}
      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          {error}
          <button type="button" className={styles.btn} onClick={() => void load()}>
            Спробувати ще раз
          </button>
        </div>
      ) : null}

      <section className={styles.card} aria-labelledby="executor-state">
        <div className={styles.cardHead}>
          <h2 id="executor-state" className={styles.cardTitle}>
            Стан
          </h2>
          {status ? (
            <span className={`${ext.chip} ${status.all.stopped ? ext.chipWarn : runs ? ext.chipOk : ext.chipMuted}`}>
              <i className={ext.chipDot} aria-hidden />
              {status.all.stopped ? "зупинено на всіх ринках" : runs ? "працює" : "не працює"}
            </span>
          ) : null}
          <span className={styles.cardSpacer} />
          <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={loading} onClick={() => void load()}>
            <ArrowClockwise size={14} weight="bold" aria-hidden />
            {loading ? "Читаю…" : "Оновити"}
          </button>
        </div>
        {loading && !status ? (
          <div className={styles.skeleton} aria-busy="true" aria-label="Стан виконавця">
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} />
          </div>
        ) : null}
        {status ? (
          <>
            <dl className={ext.kv}>
              <div>
                <dt>Гаманець</dt>
                <dd className={ext.kvMono}>
                  {status.executor ? (
                    <a href={solscan(status.network, "account", status.executor)} target="_blank" rel="noreferrer noopener">
                      {short(status.executor)} <ArrowSquareOut size={12} aria-hidden />
                    </a>
                  ) : (
                    "немає"
                  )}
                </dd>
              </div>
              <div>
                <dt>Ключ на сервері</dt>
                <dd>{status.keyHere ? "так — цієї адреси" : "ні"}</dd>
              </div>
              <div>
                <dt>SOL</dt>
                <dd className={ext.kvMono}>{status.lamports === null ? "не прочитано" : (Number(status.lamports) / LAMPORTS_PER_SOL).toFixed(4)}</dd>
              </div>
              <div>
                <dt>Останній прохід</dt>
                <dd>{since(status.lastPassAt)}</dd>
              </div>
              <div>
                <dt>Лаунч</dt>
                <dd>{status.laneOpen ? "відкрито" : "зупинено"}</dd>
              </div>
              <div>
                <dt>Драбина</dt>
                <dd>{status.ladderOpen ? "відкрито" : "закрито"}</dd>
              </div>
              <div>
                <dt>Дохід Ryntra на гаманці</dt>
                <dd className={ext.kvMono}>{status.revenue ? `${usdc(status.revenue.onWalletRaw)} USDC` : "ще немає"}</dd>
              </div>
              {status.revenue ? (
                <div>
                  <dt>Бюджети ринків</dt>
                  <dd className={ext.kvMono}>{usdc(status.revenue.reservesRaw)} USDC</dd>
                </div>
              ) : null}
            </dl>
            {status.revenue && BigInt(status.revenue.onWalletRaw) > 100_000_000n ? (
              <p className={ext.subtle}>
                Дохід понад 100 USDC — перекажи його на мультисиг своїм підписом; бюджети ринків лишаються на гаманці.
                {status.revenue.alertedAt ? ` Сповіщення ${status.revenue.delivered ? "надіслано" : "не дійшло в Telegram"} ${since(status.revenue.alertedAt)}.` : ""}
              </p>
            ) : null}
            <div className={styles.btnRow}>
              <Switch token={null} stopped={status.all.stopped} label={status.all.stopped ? "Відновити виконавця на всіх ринках" : "Зупинити виконавця на всіх ринках"} />
              <span className={ext.subtle}>
                {status.all.stopped ? `На всіх ринках — зупинено ${since(status.all.at)}` : "На всіх ринках"}
              </span>
            </div>
          </>
        ) : null}
      </section>

      {status ? (
        <section className={styles.card} aria-labelledby="executor-engine">
          <div className={styles.cardHead}>
            <h2 id="executor-engine" className={styles.cardTitle}>
              Двигун ринків
            </h2>
            <span className={`${ext.chip} ${status.engine.holding.length ? ext.chipWarn : ext.chipOk}`}>
              <i className={ext.chipDot} aria-hidden />
              {status.engine.holding.length ? `збоїв: ${status.engine.holding.length}` : "без збоїв"}
            </span>
            <InfoControl label="Як двигун проходить сотні ринків">
              <p>
                Криві всіх ринків читаються пачками по сто. Бюджети й драбини йдуть чергою: спершу ті, чия черга давно
                настала; чого прохід не встиг — першим у наступному. Ринок з помилкою чекає дедалі довше, інші не стоять.
                Основний вузол не відповідає — читання йдуть через другий. Збої виконавець надсилає в Telegram.
              </p>
            </InfoControl>
          </div>
          {status.engine.stats ? (
            <dl className={ext.kv}>
              <div>
                <dt>Прохід</dt>
                <dd className={ext.kvMono}>{(status.engine.stats.ms / 1000).toFixed(1).replace(".", ",")} с · ринків {status.engine.stats.markets}</dd>
              </div>
              <div>
                <dt>Бюджети в черзі</dt>
                <dd className={ext.kvMono}>
                  {status.engine.stats.budget.visited} з {status.engine.stats.budget.due}
                  {status.engine.stats.budget.left ? ` · на наступний: ${status.engine.stats.budget.left}` : ""}
                </dd>
              </div>
              <div>
                <dt>Драбини в черзі</dt>
                <dd className={ext.kvMono}>
                  {status.engine.stats.floor.visited} з {status.engine.stats.floor.due}
                  {status.engine.stats.floor.left ? ` · на наступний: ${status.engine.stats.floor.left}` : ""}
                </dd>
              </div>
              <div>
                <dt>Найдовше чекав</dt>
                <dd className={ext.kvMono}>{Math.max(status.engine.stats.budget.lagSeconds, status.engine.stats.floor.lagSeconds)} с</dd>
              </div>
              <div>
                <dt>Ринків з помилкою</dt>
                <dd className={ext.kvMono}>{status.engine.stats.failing}</dd>
              </div>
            </dl>
          ) : (
            <p className={ext.emptyLine}>Прохід з лічильниками ще не записано.</p>
          )}
          <div className={styles.btnRow}>
            <PeopleSwitch open={status.people.open} />
            <span className={ext.subtle}>
              {status.people.unread
                ? "Ринки людей на Micro: вимикач не прочитано — закрито."
                : status.people.open
                  ? `Ринки людей на Micro: бюджет і драбина — як на ринках Ryntra${status.people.at ? `, увімкнено ${since(status.people.at)}` : ""}.`
                  : `Ринки людей на Micro: бюджет чекає в пулі Meteora${status.people.at ? `, вимкнено ${since(status.people.at)}` : ""}.`}
            </span>
          </div>
        </section>
      ) : null}

      {status ? (
        <section className={styles.card} aria-labelledby="executor-markets">
          <div className={styles.cardHead}>
            <h2 id="executor-markets" className={styles.cardTitle}>
              Ринки
            </h2>
            <span className={styles.cardNote}>{status.markets.length}</span>
          </div>
          {status.markets.length === 0 ? (
            <p className={ext.emptyLine}>На цій мережі ще немає ринків, запущених на Ryntra.</p>
          ) : (
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Ринки виконавця">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Токен</th>
                    <th scope="col">Стан</th>
                    <th scope="col">Виконавець</th>
                    <th scope="col">Вимикач</th>
                  </tr>
                </thead>
                <tbody>
                  {status.markets.map((market) => (
                    <tr key={market.token}>
                      <td>
                        <a href={`/app/launch/${market.token}`} target="_blank" rel="noreferrer noopener">
                          ${market.symbol}
                        </a>{" "}
                        <span className={styles.cellMuted}>{market.name}</span>
                      </td>
                      <td>{market.state ? word(`state_${market.state}` as LaunchWordKey) : <span className={styles.cellMuted}>на кривій</span>}</td>
                      <td>
                        {market.stopped === "all"
                          ? "зупинено на всіх"
                          : market.stopped === "market"
                            ? "зупинено тут"
                            : market.watchedAt
                              ? `стежить з ${formatDateTime(market.watchedAt)}`
                              : "ще не проходив"}
                        {market.failures > 0 ? <span className={styles.cellMuted}> · невдалих виходів: {market.failures}</span> : null}
                      </td>
                      <td>
                        <Switch token={market.token} stopped={market.ownStop} label={`${market.ownStop ? "Відновити" : "Зупинити"} виконавця на $${market.symbol}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

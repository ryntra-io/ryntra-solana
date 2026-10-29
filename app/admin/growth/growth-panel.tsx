"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsClockwise, Copy, DownloadSimple, Warning } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import type { PanelFunnelStep, PanelModel, PanelRange, PanelSourceRow } from "@/lib/growth/panel";
import type { PostKind, PostNetwork } from "@/lib/growth/touch-store";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import biz from "../analytics/analytics.module.css";
import { formatDate, formatInt, formatPercent, formatUsd } from "../format";
import own from "./growth.module.css";

/**
 * The growth panel: where people come from and where they drop off — external wallets only. Ворота етапу and the
 * path of tagged traffic first, then every source, the post codes for the media session, friends, and the money of
 * growth. Every figure is the server's projection (`lib/growth/panel.ts`); a source that did not read says so.
 */

const RANGES: readonly { id: PanelRange; label: string }[] = [
  { id: "7d", label: "7 дн" },
  { id: "30d", label: "30 дн" },
  { id: "all", label: "Увесь час" },
];

const FUNNEL_LABEL: Record<PanelFunnelStep["id"], string> = {
  visits: "Візити з мітками",
  wallets: "Нові гаманці",
  purchased: "Перша купівля",
  returned7: "Повернулись за 7 днів",
  returned30: "Повернулись за 30 днів",
};

const CHANNEL_LABEL: Record<PanelSourceRow["channel"], string> = {
  post: "Пост",
  contest: "Конкурс",
  friend: "Друг",
  utm: "UTM",
  direct: "—",
  total: "",
};

const NETWORKS: readonly { id: PostNetwork; label: string }[] = [
  { id: "x", label: "X" },
  { id: "telegram", label: "Telegram" },
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "other", label: "Інше" },
];

const LANDINGS = ["/", "/uk", "/app", "/app/swap", "/app/rewards", "/stats"] as const;

const rate = (value: number | null, of: number | null) => (value !== null && of && of > 0 ? formatPercent(value / of) : "—");
const count = (value: number | null) => (value === null ? "—" : formatInt(value));
/** «x з y» for a return; a dash while nobody is old enough to judge, or when the ledger did not read. */
const outOf = (value: number | null, of: number | null) => (value === null || of === null || of === 0 ? "—" : `${formatInt(value)} з ${formatInt(of)}`);

const SOURCE_NAME: Record<string, string> = {
  actions: "реєстр операцій",
  presence: "присутність гаманців",
  rewards: "винагороди й граф друзів",
  touches: "джерела гаманців",
  visits: "візити",
  posts: "коди постів",
  budget: "журнал бюджету",
  internal: "список внутрішніх гаманців (виключено лише гаманці зі змінної середовища)",
};

/** Mondays (UTC) of the current week and the eight before it, newest first. */
function recentWeeks(now: Date): readonly string[] {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monday = midnight - ((now.getUTCDay() + 6) % 7) * 86_400_000;
  return Array.from({ length: 9 }, (_, index) => new Date(monday - index * 7 * 86_400_000).toISOString().slice(0, 10));
}

function Segment({ value, onChange }: { value: PanelRange; onChange: (next: PanelRange) => void }) {
  return (
    <div className={biz.segment} role="group" aria-label="Вікно">
      {RANGES.map((option) => (
        <button key={option.id} type="button" className={biz.segmentButton} aria-pressed={option.id === value} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function AimCard({ model }: { model: PanelModel }) {
  const { aim } = model;
  const progress = aim.value === null || !aim.next ? 1 : Math.min(1, (aim.value - aim.stage.from) / (aim.next.from - aim.stage.from));
  return (
    <section className={styles.card} aria-labelledby="growth-aim">
      <div className={styles.cardHead}>
        <h2 id="growth-aim" className={styles.cardTitle}>Активні інвестори місяця</h2>
        <InfoControl label="Як рахуємо АІМ">
          <p>Зовнішні гаманці, що за останні 30 днів зробили хоча б одну завершену купівлю: обмін, Spot, Автоінвест чи обмін між мережами. Гаманці власника й тестові не рахуються. Ворота етапів: 100, 300 і 5 000.</p>
        </InfoControl>
      </div>
      <b className={`${own.aimValue} ${aim.value === null ? styles.statUnknown : ""}`}>{aim.value === null ? "недоступно" : formatInt(aim.value)}</b>
      <p className={own.aimLine}>
        Етап {aim.stage.stage} «{aim.stage.name}»
        {aim.next && aim.toNext !== null ? ` · до етапу ${aim.next.stage} «${aim.next.name}» ще ${formatInt(aim.toNext)}` : ""}
      </p>
      <div className={own.gateTrack} aria-hidden>
        <div className={own.gateFill} style={{ width: `${Math.max(1, Math.round(progress * 100))}%` }} />
      </div>
    </section>
  );
}

function FunnelCard({ model }: { model: PanelModel }) {
  const top = Math.max(1, ...model.funnel.map((step) => step.value ?? 0));
  return (
    <section className={styles.card} aria-labelledby="growth-funnel">
      <div className={styles.cardHead}>
        <h2 id="growth-funnel" className={styles.cardTitle}>Шлях трафіку з мітками</h2>
        <span className={styles.cardNote}>{RANGES.find((option) => option.id === model.range)?.label}</span>
        <InfoControl label="Як рахуємо воронку">
          <p>
            Лише люди, що прийшли за посиланням Ryntra: код поста чи конкурсу, посилання друга, UTM. Візит — перший
            прихід за міткою в браузері за день. Новий гаманець — гаманець, що вперше з&apos;явився в Ryntra у вікні після
            мітки. Перша купівля — завершена операція. Повернення — ще одна купівля іншого дня за 7 / 30 днів після
            першої; рахуються лише ті, чия перша купівля старша за 7 / 30 днів.
          </p>
        </InfoControl>
      </div>
      <div className={biz.funnel}>
        {model.funnel.map((step) => (
          <div key={step.id} className={biz.funnelRow}>
            <span className={biz.funnelName}>{FUNNEL_LABEL[step.id]}</span>
            <div className={biz.funnelTrack} aria-hidden>
              <div className={`${biz.funnelFill} ${step.value === null ? biz.funnelFillMuted : ""}`} style={{ width: `${step.value === null ? 100 : Math.max(1, Math.round((step.value / top) * 100))}%` }} />
            </div>
            <span className={`${biz.funnelValue} ${step.value === null ? biz.funnelValueMuted : ""}`}>
              {step.value === null ? "недоступно" : step.id.startsWith("returned") ? outOf(step.value, step.of) : formatInt(step.value)}
              {step.value !== null && step.of !== null && !step.id.startsWith("returned") ? <span className={own.funnelRate}>{rate(step.value, step.of)}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SourceRowView({ row, total }: { row: PanelSourceRow; total?: boolean }) {
  return (
    <tr className={total ? own.rowTotal : undefined}>
      <td>
        <span className={own.sourceName}>
          <span>{row.label}</span>
          {row.detail ? <span className={own.sourceDetail}>{row.detail}</span> : null}
        </span>
      </td>
      <td>{CHANNEL_LABEL[row.channel]}</td>
      <td className={styles.cellNum}>{count(row.visits)}</td>
      <td className={styles.cellNum}>
        {count(row.wallets)}
        {row.visits !== null && row.wallets !== null ? <span className={own.rate}>{rate(row.wallets, row.visits)}</span> : null}
      </td>
      <td className={styles.cellNum}>
        {count(row.purchased)}
        {row.purchased !== null ? <span className={own.rate}>{rate(row.purchased, row.wallets)}</span> : null}
      </td>
      <td className={styles.cellNum}>{outOf(row.returned7, row.mature7)}</td>
      <td className={styles.cellNum}>{outOf(row.returned30, row.mature30)}</td>
      <td className={styles.cellNum}>{count(row.known)}</td>
    </tr>
  );
}

function SourcesCard({ model }: { model: PanelModel }) {
  return (
    <section className={styles.card} aria-labelledby="growth-sources">
      <div className={styles.cardHead}>
        <h2 id="growth-sources" className={styles.cardTitle}>Джерела</h2>
        <span className={styles.cardNote}>{model.coverage.visitsSince ? `мітки з ${formatDate(model.coverage.visitsSince)}` : "міток ще не було"}</span>
        <InfoControl label="Що в таблиці">
          <p>
            Рядок — пост, конкурс, UTM-джерело чи друзі. Нові гаманці — ті, що прийшли з цієї мітки; «знайомі» — гаманці,
            які Ryntra знала раніше і які ця мітка привела знову. Гаманець без мітки — «Без мітки», візитів без мітки ми не
            рахуємо. Друг — посилання друга або друг у графі запрошень.
          </p>
        </InfoControl>
      </div>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Джерела трафіку">
        <table className={`${styles.table} ${styles.tableWide}`}>
          <thead>
            <tr>
              <th scope="col">Джерело</th>
              <th scope="col">Тип</th>
              <th scope="col">Візити</th>
              <th scope="col">Нові гаманці</th>
              <th scope="col">Купили</th>
              <th scope="col">Повернення 7</th>
              <th scope="col">Повернення 30</th>
              <th scope="col">Знайомі</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.cellMuted}>Жоден гаманець ще не прийшов за міткою. Створіть код поста нижче.</td>
              </tr>
            ) : (
              model.rows.map((row) => <SourceRowView key={row.key} row={row} />)
            )}
            <SourceRowView row={model.totals.tagged} total />
            <SourceRowView row={model.totals.direct} />
            <SourceRowView row={model.totals.all} total />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PostCodesCard({ model, onIssued }: { model: PanelModel; onIssued: () => void }) {
  const [kind, setKind] = useState<PostKind>("post");
  const [network, setNetwork] = useState<PostNetwork>("x");
  const [title, setTitle] = useState("");
  const [landing, setLanding] = useState("/");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "https://ryntra.io" : window.location.origin;
  const linkOf = (code: string) => `${origin}/r/p/${code}`;

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/growth/codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, network, title, landing }),
      });
      const json = (await response.json().catch(() => ({}))) as { post?: { code: string }; error?: string };
      if (!response.ok || !json.post) {
        setError(json.error === "title" ? "Назва поста — від 1 до 80 символів." : json.error === "landing" ? "Сторінка — лише сторінка Ryntra: /, /uk, /app…, /stats, /docs…, /promo/…" : "Код не створено. Спробуйте ще раз.");
        return;
      }
      setIssued(json.post.code);
      setTitle("");
      onIssued();
    } catch {
      setError("Немає зв'язку із сервером.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(linkOf(code));
      setCopied(code);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="growth-codes">
      <div className={styles.cardHead}>
        <h2 id="growth-codes" className={styles.cardTitle}>Коди постів</h2>
        <InfoControl label="Як працює код">
          <p>
            Посилання з кодом запам&apos;ятовує пост у браузері людини на 30 днів і рахує візит. Коли в цьому браузері
            вперше з&apos;являється гаманець, код зберігається за ним, і його перша купівля рахується цьому посту. Людині
            нічого не показуємо й нічого не питаємо.
          </p>
        </InfoControl>
      </div>
      <form
        className={own.form}
        onSubmit={(event) => {
          event.preventDefault();
          void issue();
        }}
      >
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Тип</span>
          <select className={styles.select} value={kind} onChange={(event) => setKind(event.target.value as PostKind)}>
            <option value="post">Пост</option>
            <option value="contest">Конкурс</option>
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Мережа</span>
          <select className={styles.select} value={network} onChange={(event) => setNetwork(event.target.value as PostNetwork)}>
            {NETWORKS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className={`${styles.field} ${own.formWide}`}>
          <span className={styles.fieldLabel}>Пост</span>
          <input className={styles.input} value={title} maxLength={80} placeholder="Тред: чому Solana" onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Сторінка</span>
          <input className={styles.input} value={landing} list="growth-landings" onChange={(event) => setLanding(event.target.value)} />
          <datalist id="growth-landings">
            {LANDINGS.map((path) => <option key={path} value={path} />)}
          </datalist>
        </label>
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || title.trim().length === 0}>
          {busy ? "Створюю…" : "Створити код"}
        </button>
      </form>
      {error ? <p className={`${styles.hint} ${styles.hintWarn}`} role="alert">{error}</p> : null}
      {issued ? (
        <div className={own.issued} role="status">
          <span className={own.link}>{linkOf(issued)}</span>
          <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={() => void copy(issued)}>
            <Copy size={14} weight="bold" aria-hidden="true" /> {copied === issued ? "Скопійовано" : "Копіювати"}
          </button>
        </div>
      ) : null}
      {model.posts.length > 0 ? (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Видані коди">
          <table className={`${styles.table} ${styles.tableWide}`}>
            <thead>
              <tr>
                <th scope="col">Пост</th>
                <th scope="col">Посилання</th>
                <th scope="col">Візити</th>
                <th scope="col">Гаманці</th>
                <th scope="col">Купили</th>
                <th scope="col">Створено</th>
              </tr>
            </thead>
            <tbody>
              {model.posts.map((post) => (
                <tr key={post.code}>
                  <td>
                    <span className={own.sourceName}>
                      <span>{post.title}</span>
                      <span className={own.sourceDetail}>{post.kind === "contest" ? "Конкурс" : "Пост"} · {NETWORKS.find((option) => option.id === post.network)?.label} · {post.landing}</span>
                    </span>
                  </td>
                  <td>
                    <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => void copy(post.code)} title={linkOf(post.code)}>
                      <Copy size={14} weight="bold" aria-hidden="true" /> {copied === post.code ? "Скопійовано" : `/r/p/${post.code}`}
                    </button>
                  </td>
                  <td className={styles.cellNum}>{count(post.visits)}</td>
                  <td className={styles.cellNum}>{count(post.wallets)}</td>
                  <td className={styles.cellNum}>{count(post.purchased)}</td>
                  <td className={styles.cellMuted}>{formatDate(post.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : model.sources.posts !== "measured" ? (
        <p className={`${styles.hint} ${styles.hintWarn}`}>Видані коди не прочиталися — спробуйте оновити.</p>
      ) : null}
    </section>
  );
}

function FriendsCard({ model }: { model: PanelModel }) {
  const { friends } = model;
  const steps = [
    { label: "Прийшли за посиланням друга", value: friends.arrivals },
    { label: "Приєдналися", value: friends.joined },
    { label: "Перша купівля", value: friends.purchased },
    { label: "Активні", value: friends.active },
  ];
  return (
    <section className={styles.card} aria-labelledby="growth-friends">
      <div className={styles.cardHead}>
        <h2 id="growth-friends" className={styles.cardTitle}>Друзі й віхи</h2>
        <InfoControl label="Як рахуємо друзів">
          <p>
            Прийшли — візити за посиланнями друзів. Приєдналися — друг став під запрошувачем у вікні. Активні — друг,
            чия перша купівля старша за тиждень і хто купував за останні 30 днів.
          </p>
        </InfoControl>
      </div>
      <div className={styles.stats}>
        {steps.map((step) => (
          <div key={step.label} className={styles.stat}>
            <b className={`${styles.statValue} ${step.value === null ? styles.statUnknown : ""}`}>{count(step.value)}</b>
            <span className={styles.statLabel}>{step.label}</span>
          </div>
        ))}
        <div className={styles.stat}>
          <b className={`${styles.statValue} ${friends.shareOfNew === null ? styles.statUnknown : ""}`}>{friends.shareOfNew === null ? "—" : formatPercent(friends.shareOfNew)}</b>
          <span className={styles.statLabel}>частка друзів серед нових</span>
        </div>
      </div>
      {friends.inviters.length > 0 ? (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Хто запрошує">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Запрошувач</th>
                <th scope="col">Приєдналися</th>
                <th scope="col">Купили</th>
              </tr>
            </thead>
            <tbody>
              {friends.inviters.map((inviter) => (
                <tr key={inviter.wallet}>
                  <td className={styles.cellMono}>{inviter.wallet}</td>
                  <td className={styles.cellNum}>{formatInt(inviter.joined)}</td>
                  <td className={styles.cellNum}>{formatInt(inviter.purchased)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function MoneyCard({ model }: { model: PanelModel }) {
  const { budget, money } = model;
  const usd = (value: number | null) => (value === null ? "недоступно" : formatUsd(value));
  return (
    <section className={styles.card} aria-labelledby="growth-money">
      <div className={styles.cardHead}>
        <h2 id="growth-money" className={styles.cardTitle}>Гроші росту</h2>
        <InfoControl label="Як рахуємо гроші">
          <p>
            Бюджет росту — журнал місяця (правила 2.1.0): лише призи сезонів і робота амбасадорів. Ціна винагород —
            усе, що нараховано людям у вікні (кешбек, друзі, «Перші $10» тощо), до чистої комісії Ryntra після частки
            провайдера — ті самі цифри, що в «Аналітиці».
          </p>
        </InfoControl>
      </div>
      {budget ? (
        <>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <b className={styles.statValue}>{formatUsd(budget.spentUsd)}</b>
              <span className={styles.statLabel}>витрачено · {budget.month}</span>
            </div>
            <div className={styles.stat}>
              <b className={styles.statValue}>{formatUsd(budget.leftUsd)}</b>
              <span className={styles.statLabel}>лишилось з {formatUsd(budget.limitUsd)}</span>
            </div>
            <div className={styles.stat}>
              <b className={`${styles.statValue} ${model.budgetPerActivatedUsd === null ? styles.statUnknown : ""}`}>{model.budgetPerActivatedUsd === null ? "—" : formatUsd(model.budgetPerActivatedUsd)}</b>
              <span className={styles.statLabel}>бюджету на одного нового покупця місяця</span>
            </div>
          </div>
          <div className={own.moneyBar} aria-hidden>
            <span className={own.moneySpent} style={{ width: `${budget.limitUsd > 0 ? Math.min(100, Math.round((budget.spentUsd / budget.limitUsd) * 100)) : 0}%` }} />
          </div>
          {!budget.reconciled ? (
            <p className={`${styles.hint} ${styles.hintWarn}`}>Сума місяця не збігається з рядками журналу — перевірте журнал бюджету.</p>
          ) : null}
        </>
      ) : (
        <p className={styles.hint}>Журнал бюджету не відповів.</p>
      )}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <b className={`${styles.statValue} ${money.costRatio === null ? styles.statUnknown : ""}`}>{money.costRatio === null ? "—" : formatPercent(money.costRatio)}</b>
          <span className={styles.statLabel}>ціна винагород / чиста комісія</span>
        </div>
        <div className={styles.stat}>
          <b className={styles.statValue}>{usd(money.rewardsUsd)}</b>
          <span className={styles.statLabel}>нараховано винагород</span>
        </div>
        <div className={styles.stat}>
          <b className={styles.statValue}>{usd(money.netFeeUsd)}</b>
          <span className={styles.statLabel}>чиста комісія Ryntra</span>
        </div>
        <div className={styles.stat}>
          <b className={styles.statValue}>{usd(money.retainedUsd)}</b>
          <span className={styles.statLabel}>лишається після винагород</span>
        </div>
      </div>
    </section>
  );
}

export function GrowthPanel() {
  const [range, setRange] = useState<PanelRange>("30d");
  const [model, setModel] = useState<PanelModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const weeks = useMemo(() => recentWeeks(new Date()), []);
  const [week, setWeek] = useState(weeks[1]!);

  /* Only the latest ask may draw: a slow answer for a window already left behind is dropped. */
  const latest = useRef(0);
  const load = useCallback(async (which: PanelRange) => {
    const ask = ++latest.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/growth/panel?range=${which}`);
      if (ask !== latest.current) return;
      if (!response.ok) {
        setError(response.status === 401 ? "Сесія адміністратора закінчилась." : `Панель росту недоступна (код ${response.status}).`);
        return;
      }
      const json = (await response.json()) as { panel: PanelModel };
      if (ask !== latest.current) return;
      setModel(json.panel);
      setError(null);
    } catch {
      if (ask === latest.current) setError("Немає зв'язку із сервером.");
    } finally {
      if (ask === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  const shown = model && model.range === range ? model : null;

  return (
    <section aria-labelledby="growth-title">
      <div className={styles.cardHead}>
        <h1 id="growth-title" className={styles.pageTitle}>Панель росту</h1>
        <InfoControl label="Що тут рахується">
          <p>
            Звідки приходять люди й де вони відпадають. Лише зовнішні гаманці: гаманці власника й тестові не рахуються
            ніде. Купівля — завершена операція, як в «Аналітиці» й на /stats. Нуль тут — виміряний нуль; джерело, що не
            відповіло, каже «недоступно».
          </p>
        </InfoControl>
      </div>

      <div className={biz.toolbar}>
        <Segment value={range} onChange={setRange} />
        <span className={biz.toolbarSpacer} />
        {shown && shown.internalWallets > 0 ? <span className={`${ext.chip} ${ext.chipMuted}`}>без {shown.internalWallets} внутр.</span> : null}
        <span className={own.csv}>
          <select className={styles.select} value={week} onChange={(event) => setWeek(event.target.value)} aria-label="Тиждень для CSV">
            {weeks.map((monday, index) => (
              <option key={monday} value={monday}>{index === 0 ? `цей тиждень · ${monday}` : `тиждень з ${monday}`}</option>
            ))}
          </select>
          <a className={`${styles.btn} ${styles.btnSm}`} href={`/api/admin/growth/panel?format=csv&week=${week}`} download>
            <DownloadSimple size={15} weight="bold" aria-hidden="true" /> CSV тижня
          </a>
        </span>
        <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => void load(range)} disabled={loading} aria-label="Оновити">
          <ArrowsClockwise size={15} weight="bold" aria-hidden="true" /> {loading ? "Оновлюю…" : "Оновити"}
        </button>
      </div>

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <Warning size={17} weight="bold" aria-hidden="true" />
          <span>{error}</span>
          <button type="button" className={styles.btn} onClick={() => void load(range)}>Спробувати ще раз</button>
        </div>
      ) : null}

      {shown && !shown.touchSigning ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <Warning size={17} weight="bold" aria-hidden="true" />
          <span>Мітки не зберігаються: у середовищі не задано секрет BETA_TOKEN_SECRET. Візити рахуються, гаманці з джерелом — ні.</span>
        </div>
      ) : null}

      {shown && Object.entries(shown.sources).some(([, status]) => status !== "measured") ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <Warning size={17} weight="bold" aria-hidden="true" />
          <span>
            Не відповіли: {Object.entries(shown.sources).filter(([, status]) => status !== "measured").map(([name]) => SOURCE_NAME[name] ?? name).join(", ")}. Цифри, що від них залежать, показано як «—», не нулем.
          </span>
        </div>
      ) : null}

      {!shown && !error ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Завантаження панелі росту">
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
        </div>
      ) : null}

      {shown ? (
        <div className={own.sections}>
          <div className={own.top}>
            <AimCard model={shown} />
            <FunnelCard model={shown} />
          </div>
          <SourcesCard model={shown} />
          <PostCodesCard model={shown} onIssued={() => void load(range)} />
          <div className={own.pair}>
            <FriendsCard model={shown} />
            <MoneyCard model={shown} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

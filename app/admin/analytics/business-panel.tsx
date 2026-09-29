"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, Warning } from "@phosphor-icons/react";

import { InfoControl } from "@/app/shell/info-control";
import type { BusinessFeedItem, BusinessFeedKind, BusinessModel, BusinessRange, BusinessScope } from "@/lib/admin/business";

import styles from "../admin.module.css";
import ext from "../panels.module.css";
import biz from "./analytics.module.css";
import { formatAgo, formatDate, formatDateTime, formatInt, formatUsd } from "../format";
import { OwnerWalletsPanel } from "./owner-wallets-panel";
import { PointsPanel } from "./points-panel";
import { MetricDefinitions, Stat } from "../stat";

/**
 * The owner's dashboard: are people coming, connecting, trading, coming back —
 * and what is Ryntra making. Every figure is a projection of the product's own
 * ledgers, external wallets by default, with the owner's test wallets one
 * switch away.
 */

const RANGES: readonly { id: BusinessRange; label: string }[] = [
  { id: "24h", label: "24 год" },
  { id: "7d", label: "7 дн" },
  { id: "30d", label: "30 дн" },
  { id: "all", label: "Увесь час" },
];

const SCOPES: readonly { id: BusinessScope; label: string }[] = [
  { id: "external", label: "Зовнішні гаманці" },
  { id: "all", label: "Уся активність" },
];

const KIND_LABEL: Record<BusinessFeedKind, string> = {
  SWAP: "Swap",
  SPOT_BUY: "Spot Buy",
  SPOT_SELL: "Spot Sell",
  CROSS_SWAP: "Bridge",
  BRIDGE: "CCTP-переказ",
  SEND: "Надіслано",
  RECEIVE: "Отримано",
  WALLET_VERIFIED: "Доказ гаманця",
  REFERRAL: "Реферал",
  REWARD: "Reward нараховано",
  CLAIM: "Claim виплачено",
};

const STATUS_LABEL: Record<BusinessFeedItem["status"], string | null> = {
  DONE: "Успішно",
  FAILED: "Не вдалося",
  IN_FLIGHT: "У процесі",
  NEEDS_YOU: "Потрібна дія",
  INFO: null,
};

const STATUS_TONE: Record<BusinessFeedItem["status"], string> = {
  DONE: ext.chipOk,
  FAILED: ext.chipRisk,
  IN_FLIGHT: ext.chipWarn,
  NEEDS_YOU: ext.chipWarn,
  INFO: ext.chipMuted,
};

const PROVIDER_LABEL: Record<NonNullable<BusinessFeedItem["provider"]>, string> = {
  JUPITER: "Jupiter",
  RELAY: "Relay",
  MAYAN: "Mayan",
  CCTP: "CCTP",
};

const FUNNEL_LABEL: Record<BusinessModel["funnel"][number]["id"], string> = {
  visited: "Відвідали",
  connected: "Підключили гаманець",
  verified: "Підтвердили гаманець",
  first_trade: "Уклали угоду",
  repeat_trade: "Повторна угода",
};

type Loaded = { key: string; model: BusinessModel; at: number };

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
        <button
          key={option.id}
          type="button"
          className={biz.segmentButton}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Pulse({ label, at, wallet, internal, notCollected }: { label: string; at: string | null; wallet: string | null; internal?: boolean; notCollected?: boolean }) {
  const fresh = at !== null && Date.now() - Date.parse(at) < 24 * 3_600_000;
  return (
    <div className={biz.pulseItem}>
      <span className={biz.pulseLabel}>{label}</span>
      {notCollected ? (
        <span className={`${biz.pulseValue} ${biz.pulseValueMuted}`}>не збирається</span>
      ) : at === null ? (
        <span className={`${biz.pulseValue} ${biz.pulseValueMuted}`}>ще не було</span>
      ) : (
        <span className={biz.pulseValue} title={formatDateTime(at)}>
          <span className={fresh ? biz.pulseLive : undefined}>{formatAgo(at)}</span>
          {wallet ? <span className={biz.pulseWallet}>{wallet}</span> : null}
          {internal ? <span className={biz.internalTag}>internal</span> : null}
        </span>
      )}
    </div>
  );
}

function Bars({
  buckets,
  primary,
  secondary,
  format,
  label,
  money,
}: {
  buckets: BusinessModel["buckets"];
  primary: (bucket: BusinessModel["buckets"][number]) => number;
  secondary?: (bucket: BusinessModel["buckets"][number]) => number;
  format: (value: number) => string;
  label: string;
  money?: boolean;
}) {
  const peak = Math.max(0, ...buckets.map((bucket) => Math.max(primary(bucket), secondary ? secondary(bucket) : 0)));
  const scale = peak > 0 ? peak : 1;
  const fillClass = money ? biz.barFillMoney : biz.barFill;
  return (
    <div className={biz.chart}>
      <div className={biz.bars} role="img" aria-label={label}>
        {buckets.map((bucket) => {
          const one = primary(bucket);
          const two = secondary ? secondary(bucket) : null;
          const title = two === null ? `${bucket.label}: ${format(one)}` : `${bucket.label}: ${format(one)} · ${format(two)}`;
          return (
            <div key={bucket.key} className={biz.bar} title={title}>
              {two === null ? (
                <span className={`${fillClass} ${one === 0 ? biz.barEmpty : ""}`} style={{ height: `${Math.max(2, Math.round((one / scale) * 100))}%` }} />
              ) : (
                <div className={biz.barPair}>
                  <span className={`${biz.barFill} ${one === 0 ? biz.barEmpty : ""}`} style={{ height: `${Math.max(2, Math.round((one / scale) * 100))}%` }} />
                  <span className={`${biz.barFillSecondary} ${two === 0 ? biz.barEmpty : ""}`} style={{ height: `${Math.max(2, Math.round((two / scale) * 100))}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className={biz.axis}>
        <span>{buckets[0]?.label}</span>
        <span className={biz.chartPeak}>{peak > 0 ? `пік ${format(peak)}` : "поки нуль"}</span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function Funnel({ steps }: { steps: BusinessModel["funnel"] }) {
  const measured = steps.map((step) => (step.wallets.status === "measured" && typeof step.wallets.value === "number" ? step.wallets.value : null));
  const top = Math.max(1, ...measured.map((value) => value ?? 0));
  return (
    <div className={biz.funnel}>
      {steps.map((step, index) => {
        const value = measured[index];
        return (
          <div key={step.id} className={biz.funnelRow}>
            <span className={biz.funnelName}>{FUNNEL_LABEL[step.id]}</span>
            <div className={biz.funnelTrack} aria-hidden>
              <div className={`${biz.funnelFill} ${value === null ? biz.funnelFillMuted : ""}`} style={{ width: `${value === null ? 100 : Math.max(1, Math.round((value / top) * 100))}%` }} />
            </div>
            <span className={`${biz.funnelValue} ${value === null ? biz.funnelValueMuted : ""}`}>
              {value === null ? (step.wallets.status === "not_collected" ? "не збирається" : "недоступно") : formatInt(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FeedRow({ item, onMarkInternal }: { item: BusinessFeedItem; onMarkInternal: (wallet: string) => void }) {
  const status = STATUS_LABEL[item.status];
  const solanaSignature = item.reference && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(item.reference) ? item.reference : null;
  return (
    <li className={biz.feedRow}>
      <details>
        <summary className={biz.feedSummary}>
          <span className={biz.feedAt} title={formatDateTime(item.at)}>{formatAgo(item.at)}</span>
          <span className={biz.feedKind}>
            {KIND_LABEL[item.kind]}
            {item.internal ? <> <span className={biz.internalTag}>internal</span></> : null}
          </span>
          <span className={biz.feedWallet}>{item.wallet}</span>
          <span className={biz.feedRoute}>{item.route ? item.route.replace(/^Level (\d)$/, "Рівень $1") : ""}</span>
          <span className={biz.feedValue}>{item.valueUsd === null ? "" : formatUsd(item.valueUsd)}</span>
          <span className={biz.feedProvider}>{item.provider ? PROVIDER_LABEL[item.provider] : ""}</span>
          <span className={biz.feedStatus}>
            {status ? <span className={`${ext.chip} ${STATUS_TONE[item.status]}`}>{status}</span> : null}
          </span>
        </summary>
        <div className={biz.feedDetail}>
          <div className={biz.feedDetailRow}>
            <span className={biz.feedDetailKey}>Гаманець</span>
            <code className={styles.mono}>{item.walletFull}</code>
          </div>
          {item.reference ? (
            <div className={biz.feedDetailRow}>
              <span className={biz.feedDetailKey}>Транзакція</span>
              {solanaSignature ? (
                <a href={`https://solscan.io/tx/${solanaSignature}`} target="_blank" rel="noreferrer" className={styles.mono}>{solanaSignature}</a>
              ) : (
                <code className={styles.mono}>{item.reference}</code>
              )}
            </div>
          ) : null}
          <div className={biz.feedDetailRow}>
            <span className={biz.feedDetailKey}>Коли</span>
            <span>{formatDateTime(item.at)}</span>
          </div>
          {!item.internal ? (
            <div className={biz.feedDetailRow}>
              <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={() => onMarkInternal(item.walletFull)}>
                Позначити внутрішнім
              </button>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function coverageChip(model: BusinessModel): { className: string; text: string } {
  if (model.sources.actions === "unavailable") return { className: ext.chipRisk, text: "сховище операцій не відповіло" };
  const since = model.coverage.actionsSince ? formatDate(model.coverage.actionsSince) : null;
  return { className: ext.chipOk, text: since ? `операції з ${since}` : "операцій ще не було" };
}

export function BusinessPanel() {
  const [range, setRange] = useState<BusinessRange>("24h");
  const [scope, setScope] = useState<BusinessScope>("external");
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /* Bumped whenever the owner's wallet list changes, so the Points table
     re-reads its rank without a click. */
  const [walletsVersion, setWalletsVersion] = useState(0);
  const key = `${range}:${scope}`;
  const current = loaded[key]?.model ?? null;

  const load = useCallback(async (which: string, quiet = false) => {
    if (!quiet) setLoading(true);
    const [r, s] = which.split(":");
    try {
      const response = await fetch(`/api/admin/analytics/business?range=${r}&scope=${s}`);
      if (!response.ok) {
        setError(response.status === 401 ? "Сесія адміністратора закінчилась." : `Дані бізнес-аналітики недоступні (код ${response.status}).`);
        return;
      }
      const json = (await response.json()) as { business: BusinessModel };
      setLoaded((previous) => ({ ...previous, [which]: { key: which, model: json.business, at: Date.now() } }));
      setError(null);
    } catch {
      setError("Немає зв'язку із сервером.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(key);
  }, [key, load]);

  /* The feed is alive: the open window is re-read every minute while the tab
     is visible, quietly, so a swap made in the last sixty seconds shows up
     without a click. */
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(key, true);
    }, 60_000);
    return () => clearInterval(timer);
  }, [key, load]);

  /* Re-read the open window without dropping what is on screen: the figures
     stay put while the new ones arrive, and the other windows are forgotten
     so they are read fresh when opened. */
  const refreshAll = useCallback(() => {
    setLoaded((previous) => (previous[key] ? { [key]: previous[key] } : {}));
    setWalletsVersion((version) => version + 1);
    void load(key, true);
  }, [key, load]);

  const markInternal = useCallback(
    async (wallet: string) => {
      const response = await fetch("/api/admin/analytics/internal-wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, label: "позначено зі стрічки" }),
      });
      if (response.ok) refreshAll();
    },
    [refreshAll],
  );

  const coverage = useMemo(() => (current ? coverageChip(current) : null), [current]);
  const model = current;

  return (
    <section aria-labelledby="biz-title">
      <div className={styles.cardHead}>
        <h1 id="biz-title" className={styles.pageTitle}>Аналітика</h1>
        <InfoControl label="Що тут рахується">
          <p>
            Бізнес-показники з власних реєстрів продукту: угода — лише завершена операція, обсяг — виконана сума за
            паритетом стейблкоїна, виручка — комісія, яку провайдер підтвердив зібраною. Нуль тут — виміряний нуль;
            коли джерела немає, показник каже «не збирається».
          </p>
        </InfoControl>
      </div>

      <div className={biz.toolbar}>
        <Segment value={range} options={RANGES} onChange={setRange} label="Вікно" />
        <Segment value={scope} options={SCOPES} onChange={setScope} label="Режим" />
        <span className={biz.toolbarSpacer} />
        {coverage ? <span className={`${ext.chip} ${coverage.className}`}>{coverage.text}</span> : null}
        {model && model.internalWallets > 0 && scope === "external" ? (
          <span className={`${ext.chip} ${ext.chipMuted}`}>без {model.internalWallets} внутр.</span>
        ) : null}
        <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnGhost}`} onClick={refreshAll} disabled={loading} aria-label="Оновити">
          <ArrowsClockwise size={15} weight="bold" aria-hidden="true" /> {loading ? "Оновлюю…" : "Оновити"}
        </button>
      </div>

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          <Warning size={17} weight="bold" aria-hidden="true" />
          <span>{error}</span>
          <button type="button" className={styles.btn} onClick={() => void load(key)}>Спробувати ще раз</button>
        </div>
      ) : null}

      {!model && !error ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Завантаження аналітики">
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
          <div className={styles.skeletonRow} />
        </div>
      ) : null}

      {model ? (
        <>
          <div className={biz.pulse} aria-label="Останні події">
            <Pulse label="Останній відвідувач" at={null} wallet={null} notCollected />
            <Pulse label="Гаманець у кабінеті" at={model.lastSeen.connected.at} wallet={model.lastSeen.connected.wallet} internal={model.lastSeen.connected.internal} />
            <Pulse label="Останній доказ" at={model.lastSeen.verified.at} wallet={model.lastSeen.verified.wallet} internal={model.lastSeen.verified.internal} />
            <Pulse label="Остання угода" at={model.lastSeen.trade.at} wallet={model.lastSeen.trade.wallet} internal={model.lastSeen.trade.internal} />
            <Pulse label="Останній реферал" at={model.lastSeen.referral.at} wallet={model.lastSeen.referral.wallet} internal={model.lastSeen.referral.internal} />
          </div>

          <div className={biz.kpiGrid}>
            {/* First, because it decides what every figure below counts: the
                owner's own wallets, marked here, are not customers anywhere. */}
            <OwnerWalletsPanel onChanged={refreshAll} />

            <section className={`${styles.card} ${biz.kpiLead}`} aria-labelledby="biz-core">
              <div className={styles.cardHead}>
                <h2 id="biz-core" className={styles.cardTitle}>Чи починається бізнес</h2>
                <span className={styles.cardNote}>{RANGES.find((option) => option.id === range)?.label}</span>
              </div>
              <div className={biz.headline}>
                <Stat cell={model.trading.traders} label="унікальних трейдерів" metric="biz_traders" />
                <Stat cell={model.trading.volumeUsd} label="обсяг торгів" format="usd" metric="biz_volume_usd" />
                <Stat cell={model.trading.returningTraders} label="повторних трейдерів" metric="biz_traders_returning" />
                <Stat cell={model.revenue.retainedUsd} label="залишається Ryntra" format="usd" metric="biz_retained_usd" />
              </div>
              {model.trading.unvalued > 0 ? (
                <p className={biz.kpiNote}>{formatInt(model.trading.unvalued)} угод без стейблкоїна — рахуються як угоди, у доларах не оцінені.</p>
              ) : null}
            </section>

            <section className={`${styles.card} ${biz.kpiCard}`} aria-labelledby="biz-audience">
              <div className={styles.cardHead}>
                <h2 id="biz-audience" className={styles.cardTitle}>Аудиторія</h2>
                <span className={styles.cardNote}>
                  {model.coverage.presenceSince ? `присутність з ${formatDate(model.coverage.presenceSince)}` : "присутність збирається з релізу"}
                </span>
              </div>
              <div className={styles.stats}>
                <Stat cell={model.audience.visitors} label="відвідувачі" metric="biz_visitors" />
                <Stat cell={model.audience.connected} label="гаманців підключено" metric="biz_wallets_connected" />
                <Stat cell={model.audience.verified} label="гаманців підтверджено" metric="biz_wallets_verified" />
                <Stat cell={model.audience.newWallets} label="нових гаманців" metric="biz_wallets_new" />
                <Stat cell={model.audience.active} label="активних гаманців" metric="biz_wallets_active" />
              </div>
              <MetricDefinitions ids={["biz_visitors", "biz_wallets_connected", "biz_wallets_verified", "biz_wallets_new", "biz_wallets_active"]} />
            </section>

            <section className={`${styles.card} ${biz.kpiCard}`} aria-labelledby="biz-trading">
              <div className={styles.cardHead}>
                <h2 id="biz-trading" className={styles.cardTitle}>Торгівля</h2>
                {model.trading.unvalued > 0 ? <span className={styles.cardNote}>{model.trading.unvalued} без USD</span> : null}
              </div>
              <div className={styles.stats}>
                <Stat cell={model.trading.trades} label="завершених угод" metric="biz_trades" />
                <Stat cell={model.trading.failed} label="невдалих" metric="biz_trades_failed" />
                <Stat cell={model.trading.newTraders} label="нових трейдерів" metric="biz_traders_new" />
                <Stat cell={model.trading.repeatRate} label="частка повторних" format="percent" metric="biz_repeat_rate" />
                <Stat cell={model.trading.spotTrades} label="Spot-угод" metric="biz_spot_trades" />
                <Stat cell={model.trading.spotVolumeUsd} label="Spot-обсяг" format="usd" metric="biz_spot_volume_usd" />
              </div>
              <MetricDefinitions ids={["biz_traders", "biz_trades", "biz_volume_usd", "biz_spot_trades", "biz_spot_volume_usd", "biz_trades_failed", "biz_traders_new", "biz_traders_returning", "biz_repeat_rate"]} />
            </section>

            <section className={`${styles.card} ${biz.kpiCard}`} aria-labelledby="biz-revenue">
              <div className={styles.cardHead}>
                <h2 id="biz-revenue" className={styles.cardTitle}>Виручка</h2>
                {model.revenue.feesNotRecorded > 0 || model.revenue.unvaluedFees > 0 ? (
                  <span className={styles.cardNote}>
                    {[
                      model.revenue.feesNotRecorded > 0 ? `${model.revenue.feesNotRecorded} без запису комісії` : null,
                      model.revenue.unvaluedFees > 0 ? `${model.revenue.unvaluedFees} без USD` : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </div>
              <div className={styles.stats}>
                <Stat cell={model.revenue.grossUsd} label="комісія gross" format="usd" metric="biz_fees_gross_usd" />
                <Stat cell={model.revenue.providerUsd} label="частка провайдера" format="usd" metric="biz_fees_provider_usd" />
                <Stat cell={model.revenue.netBeforeRewardsUsd} label="Ryntra до Rewards" format="usd" metric="biz_net_before_rewards_usd" />
                <Stat cell={model.revenue.cashbackUsd} label="cashback" format="usd" metric="biz_rewards_cashback_usd" />
                <Stat cell={model.revenue.referralL1Usd} label="referral L1" format="usd" metric="biz_rewards_referral_l1_usd" />
                <Stat cell={model.revenue.referralL2Usd} label="referral L2" format="usd" metric="biz_rewards_referral_l2_usd" />
              </div>
              <MetricDefinitions ids={["biz_fees_gross_usd", "biz_fees_provider_usd", "biz_net_before_rewards_usd", "biz_rewards_cashback_usd", "biz_rewards_referral_l1_usd", "biz_rewards_referral_l2_usd", "biz_retained_usd"]} />
            </section>

            <section className={`${styles.card} ${biz.kpiCard}`} aria-labelledby="biz-rewards">
              <div className={styles.cardHead}>
                <h2 id="biz-rewards" className={styles.cardTitle}>Rewards і реферали</h2>
                <span className={styles.cardNote}>
                  {model.coverage.rewardsSince ? `з ${formatDate(model.coverage.rewardsSince)}` : "Rewards не активовано"}
                </span>
              </div>
              <div className={styles.stats}>
                <Stat cell={model.rewards.accruedUsd} label="нараховано" format="usd" metric="biz_rewards_accrued_usd" />
                <Stat cell={model.rewards.claimedUsd} label="виплачено" format="usd" metric="biz_rewards_claimed_usd" />
                <Stat cell={model.rewards.outstandingUsd} label="до виплати, усього" format="usd" metric="biz_rewards_outstanding_usd" />
                <Stat cell={model.referrals.level1} label="прямих рефералів" metric="biz_referrals_l1" />
                <Stat cell={model.referrals.level2} label="рефералів L2" metric="biz_referrals_l2" />
              </div>
              <MetricDefinitions ids={["biz_rewards_accrued_usd", "biz_rewards_claimed_usd", "biz_rewards_outstanding_usd", "biz_referrals_l1", "biz_referrals_l2"]} />
            </section>

            <section className={`${styles.card} ${biz.chartCard}`} aria-labelledby="biz-chart-wallets">
              <div className={styles.cardHead}>
                <h2 id="biz-chart-wallets" className={styles.cardTitle}>Активні гаманці · трейдери</h2>
                <span className={styles.cardNote}>{range === "24h" ? "по годинах" : "по днях"}, UTC</span>
              </div>
              <Bars buckets={model.buckets} primary={(bucket) => bucket.activeWallets} secondary={(bucket) => bucket.traders} format={formatInt} label="Активні гаманці й трейдери" />
              <div className={ext.sparkLegend}>
                <span><i className={`${ext.sparkSwatch} ${ext.sparkPrimary}`} />активні гаманці</span>
                <span><i className={`${ext.sparkSwatch} ${ext.sparkSecondary}`} />трейдери</span>
              </div>
            </section>

            <section className={`${styles.card} ${biz.chartCard}`} aria-labelledby="biz-chart-volume">
              <div className={styles.cardHead}>
                <h2 id="biz-chart-volume" className={styles.cardTitle}>Обсяг торгів</h2>
                <span className={styles.cardNote}>USD, за паритетом</span>
              </div>
              <Bars buckets={model.buckets} primary={(bucket) => bucket.volumeUsd} format={formatUsd} label="Обсяг торгів" />
            </section>

            <section className={`${styles.card} ${biz.chartCard}`} aria-labelledby="biz-chart-revenue">
              <div className={styles.cardHead}>
                <h2 id="biz-chart-revenue" className={styles.cardTitle}>Виручка Ryntra</h2>
                <span className={styles.cardNote}>до Rewards</span>
              </div>
              <Bars buckets={model.buckets} primary={(bucket) => bucket.revenueUsd} format={formatUsd} label="Виручка Ryntra" money />
            </section>

            <section className={`${styles.card} ${styles.cardHalf}`} aria-labelledby="biz-providers">
              <div className={styles.cardHead}>
                <h2 id="biz-providers" className={styles.cardTitle}>Провайдери</h2>
              </div>
              <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Провайдери">
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Провайдер</th>
                      <th scope="col" className={styles.cellNum}>Операцій</th>
                      <th scope="col" className={styles.cellNum}>Обсяг</th>
                      <th scope="col" className={styles.cellNum}>Комісія gross</th>
                      <th scope="col" className={styles.cellNum}>Ryntra net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.providers.map((row) => (
                      <tr key={row.id}>
                        <td>
                          {row.label}
                          {row.feeNote ? <span className={`${ext.subtle}`} title={row.feeNote}> · {row.feeNote.split(" — ")[0]}</span> : null}
                        </td>
                        <td className={styles.cellNum}>{formatInt(row.operations)}</td>
                        <td className={styles.cellNum}>
                          {formatUsd(row.volumeUsd)}
                          {row.unvalued > 0 ? <span className={ext.statSuffix}> +{row.unvalued} без USD</span> : null}
                        </td>
                        <td className={styles.cellNum}>{row.feeNote ? <span className={styles.cellMuted}>$0</span> : formatUsd(row.grossUsd)}</td>
                        <td className={styles.cellNum}>{row.feeNote ? <span className={styles.cellMuted}>$0</span> : formatUsd(row.ryntraNetUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={`${styles.card} ${styles.cardHalf}`} aria-labelledby="biz-funnel">
              <div className={styles.cardHead}>
                <h2 id="biz-funnel" className={styles.cardTitle}>Воронка</h2>
                <span className={styles.cardNote}>унікальні гаманці</span>
              </div>
              <Funnel steps={model.funnel} />
              <p className={biz.kpiNote}>Відвідувачі не вимірюються — воронка починається з підключеного гаманця.</p>
            </section>

            <section className={`${styles.card} ${biz.feedCard}`} aria-labelledby="biz-fees">
              <div className={styles.cardHead}>
                <h2 id="biz-fees" className={styles.cardTitle}>Комісії</h2>
                <InfoControl label="Що тут рахується">
                  <p>
                    Кожна операція з комісією у вибраному вікні: що взяв провайдер (gross у власному активі й у доларах),
                    частка провайдера, кешбек і реферальні частки з реєстру Rewards, і те, що лишається Ryntra. Зібрано —
                    провайдер підтвердив, що комісію взято; інакше комісія читається як нуль, а не як оцінка.
                  </p>
                </InfoControl>
                <span className={styles.cardNote}>{scope === "external" ? "зовнішні гаманці" : "усі гаманці"}</span>
              </div>
              {model.fees.length === 0 ? (
                <p className={ext.emptyLine}>У цьому вікні не було операцій із записаною комісією.</p>
              ) : (
                <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Комісії по операціях">
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Коли</th>
                        <th scope="col">Гаманець</th>
                        <th scope="col">Операція</th>
                        <th scope="col" className={styles.cellNum}>Обсяг</th>
                        <th scope="col">Комісія</th>
                        <th scope="col" className={styles.cellNum}>Gross</th>
                        <th scope="col" className={styles.cellNum}>Провайдер</th>
                        <th scope="col" className={styles.cellNum}>Кешбек</th>
                        <th scope="col" className={styles.cellNum}>Реферали</th>
                        <th scope="col" className={styles.cellNum}>Ryntra net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.fees.slice(0, 50).map((row) => (
                        <tr key={`${row.walletFull}:${row.at}:${row.reference ?? ""}`}>
                          <td title={formatDateTime(row.at)}>{formatAgo(row.at)}</td>
                          <td>
                            <code className={styles.mono} title={row.walletFull}>{row.wallet}</code>
                            {row.internal ? <> <span className={biz.internalTag}>internal</span></> : null}
                          </td>
                          <td>
                            {KIND_LABEL[row.kind]}
                            {row.route ? <span className={ext.subtle}> · {row.route}</span> : null}
                            {row.provider ? <span className={ext.subtle}> · {PROVIDER_LABEL[row.provider]}</span> : null}
                          </td>
                          <td className={styles.cellNum}>{row.volumeUsd === null ? <span className={styles.cellMuted}>без USD</span> : formatUsd(row.volumeUsd)}</td>
                          <td>
                            {row.collected ? (
                              <>
                                {row.feeText ?? "—"}
                                {row.basisPoints !== null ? <span className={ext.subtle}> · {(row.basisPoints / 100).toFixed(2)}%</span> : null}
                              </>
                            ) : (
                              <span className={`${ext.chip} ${ext.chipMuted}`}>не зібрано</span>
                            )}
                          </td>
                          <td className={styles.cellNum}>{row.grossUsd === null ? <span className={styles.cellMuted}>—</span> : formatUsd(row.grossUsd)}</td>
                          <td className={styles.cellNum}>{row.providerUsd === null ? <span className={styles.cellMuted}>—</span> : formatUsd(row.providerUsd)}</td>
                          <td className={styles.cellNum}>{formatUsd(row.cashbackUsd)}</td>
                          <td className={styles.cellNum}>{formatUsd(row.referralUsd)}</td>
                          <td className={styles.cellNum}>{row.ryntraNetUsd === null ? <span className={styles.cellMuted}>—</span> : formatUsd(row.ryntraNetUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={`${styles.card} ${biz.feedCard}`} aria-labelledby="biz-feed">
              <div className={styles.cardHead}>
                <h2 id="biz-feed" className={styles.cardTitle}>Останні події в продукті</h2>
                <span className={styles.cardNote}>{scope === "external" ? "зовнішні гаманці" : "усі гаманці"}</span>
                <span className={styles.cardSpacer} />
                <span className={biz.stamp}>станом на {formatDateTime(model.generatedAt)}</span>
              </div>
              {model.recent.length === 0 ? (
                <p className={ext.emptyLine}>Подій ще не було.</p>
              ) : (
                <ul className={biz.feed}>
                  {model.recent.map((item) => (
                    <FeedRow key={`${item.kind}:${item.walletFull}:${item.at}:${item.reference ?? ""}`} item={item} onMarkInternal={(wallet) => void markInternal(wallet)} />
                  ))}
                </ul>
              )}
            </section>

            {/* Points under the feed: the same ledger the customer reads, every
                wallet's row, the ledger itself one disclosure down. */}
            <PointsPanel refreshKey={walletsVersion} />
          </div>
        </>
      ) : null}
    </section>
  );
}

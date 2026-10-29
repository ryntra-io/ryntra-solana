import type { Metadata } from "next";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { readPlatformHonestMetric } from "@/lib/admin/honest-pnl.server";
import type { PlatformHonestMetric } from "@/lib/admin/honest-pnl";
import { HONEST_PNL_METHOD, VERDICT_MIN_COMPLETENESS_PCT } from "@/lib/core/pnl/honest";
import { getAdminSession } from "@/lib/session";

import styles from "../admin.module.css";
import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";

export const metadata: Metadata = { title: "Чесний PnL — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * «Чесний PnL» (DSC-2) in the admin: of the wallets that traded through Ryntra in a month, the share in the plus after
 * fees, month by month, by the one standard (`lib/core/pnl`). A wallet whose result is not known counts among the
 * month's wallets and never among those in the plus. Admin only; read only. Publishing it is not done here.
 */

const pct = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("uk-UA", { maximumFractionDigits: 1 })} %`);

export default async function AdminHonestPnlPage() {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Чесний PnL" />;
  let metric: PlatformHonestMetric | null = null;
  try {
    metric = await readPlatformHonestMetric(getGuardRuntime().store, process.env, Date.now());
  } catch {
    metric = null;
  }
  return (
    <AdminShellV2 active="pnl">
      <h1 className={styles.pageTitle}>Чесний PnL — частка гаманців у плюсі після комісій</h1>
      <p className={styles.pageLead}>
        Гаманці, що торгували через Ryntra в місяці, — за одним стандартом: комісії враховано, непродане — за ціною виходу
        з урахуванням ліквідності, невідомий результат — не плюс. Лише для адмінки: публікація назовні — словом власника.
      </p>
      {metric === null || metric.source === "unavailable" ? (
        <p className={styles.hintWarn}>Реєстр угод Ryntra зараз не прочитано — жодна цифра не є фактом.</p>
      ) : (
        <section className={styles.card} aria-labelledby="pnl-months">
          <div className={styles.cardHead}>
            <h2 id="pnl-months" className={styles.cardTitle}>По місяцях</h2>
          </div>
          <div className={styles.tableWrap} tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Місяць</th>
                  <th scope="col" className={styles.cellNum}>Гаманців</th>
                  <th scope="col" className={styles.cellNum}>У плюсі</th>
                  <th scope="col" className={styles.cellNum}>У мінусі</th>
                  <th scope="col" className={styles.cellNum}>Нуль</th>
                  <th scope="col" className={styles.cellNum}>Невідомо</th>
                  <th scope="col" className={styles.cellNum}>Частка в плюсі</th>
                  <th scope="col" className={styles.cellNum}>З відомих</th>
                  <th scope="col" className={styles.cellNum}>Повнота</th>
                </tr>
              </thead>
              <tbody>
                {[...metric.months].reverse().map((month) => (
                  <tr key={month.month}>
                    <td className={styles.cellMono}>{month.month}</td>
                    <td className={styles.cellNum}>{month.wallets}</td>
                    <td className={styles.cellNum}>{month.plus}</td>
                    <td className={styles.cellNum}>{month.minus}</td>
                    <td className={styles.cellNum}>{month.flat}</td>
                    <td className={styles.cellNum}>{month.unknown}</td>
                    <td className={styles.cellNum}>{pct(month.sharePlusPct)}</td>
                    <td className={styles.cellNum}>{pct(month.sharePlusOfKnownPct)}</td>
                    <td className={styles.cellNum}>{pct(month.completenessPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.cardNote}>
            «Частка в плюсі» — з усіх гаманців місяця, невідомі в знаменнику; «З відомих» — лише серед гаманців з повнотою
            від {VERDICT_MIN_COMPLETENESS_PCT} %. Гаманців за весь час: {metric.wallets}; гаманці власника й тестові не
            враховано ({metric.excluded}). Ціну виходу прочитано для {metric.marked} з {metric.positions} токенів; комісія
            мережі — оцінка 0,000105 SOL за угоду{metric.solUsd === null ? " (ціну SOL не прочитано — комісії невідомі)" : ` за ціною SOL $${metric.solUsd.toFixed(2)}`}.
            Непродане кожного місяця — за ціною виходу зараз. Прочитано {new Date(metric.readAt).toLocaleString("uk-UA", { timeZone: "UTC" })} UTC.
          </p>
        </section>
      )}
      <section className={styles.card} aria-labelledby="pnl-method">
        <div className={styles.cardHead}>
          <h2 id="pnl-method" className={styles.cardTitle}>Як рахуємо</h2>
        </div>
        <ul className={styles.cardNote}>
          {HONEST_PNL_METHOD.map((line) => (
            <li key={line.en}>{line.uk}</li>
          ))}
          <li>Долар і SOL — гроші: угода за них — купівля чи продаж токена; комісія Ryntra — уже в сумах угоди.</li>
          <li>Лише угоди через Ryntra: токен, що прийшов звідкілясь, — без відомої ціни купівлі (невідома частина).</li>
        </ul>
      </section>
    </AdminShellV2>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { FUNNEL_SCOPE_LABEL, FUNNEL_SCOPES, funnelDays, funnelTable, isFunnelScope, readAgentFunnel, type FunnelRead } from "@/lib/admin/funnel";
import { getAdminSession } from "@/lib/session";

import styles from "../admin.module.css";
import { AdminUnauthorized } from "../gate";
import { AdminShellV2 } from "../shell/admin-shell";

export const metadata: Metadata = { title: "Воронка — Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const DAYS = 14;

/**
 * «Воронка»: where a visit stops on the way from the city's first screen to money — the agent's budget
 * signed or a trade landed — by day, on the web and in the Ryntra app apart. Visits, not people; robots left out. Admin
 * only; read only.
 */
export default async function AdminFunnelPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const admin = await getAdminSession();
  if (!admin) return <AdminUnauthorized surface="Воронка" />;
  const asked = (await searchParams).v;
  const scope = isFunnelScope(asked) ? asked : "all";
  let read: FunnelRead;
  try {
    read = await readAgentFunnel(DAYS);
  } catch {
    read = { status: "unavailable" };
  }
  const days = funnelDays(new Date().toISOString().slice(0, 10), DAYS);
  const measured = read.status === "measured" ? read : null;
  const table = measured ? funnelTable(measured.rows, days, scope) : null;
  const pct = (share: number | null) => (share === null ? "—" : `${(share * 100).toLocaleString("uk-UA", { maximumFractionDigits: 1 })} %`);
  return (
    <AdminShellV2 active="funnel">
      <h1 className={styles.pageTitle}>Воронка — від першого екрана до грошей</h1>
      <p className={styles.pageLead}>
        Скільки відвідин дійшли до кожного кроку, по днях (UTC), за {DAYS} днів. Кожен крок рахується раз за відвідини; без
        гаманців і сум. Наші автоматичні проходи не рахуються.
      </p>
      <div className={styles.btnRow} role="tablist" aria-label="Пристрій">
        {FUNNEL_SCOPES.map((id) => (
          <Link key={id} href={id === "all" ? "/admin/funnel" : `/admin/funnel?v=${id}`} role="tab" aria-selected={id === scope} className={`${styles.btn} ${styles.btnSm} ${id === scope ? styles.btnPrimary : styles.btnGhost}`}>
            {FUNNEL_SCOPE_LABEL[id]}
          </Link>
        ))}
      </div>
      {read.status === "not_collected" ? (
        <p className={styles.hintWarn}>Лічильник воронки в базі ще не ввімкнено — цифр поки немає.</p>
      ) : !measured || !table ? (
        <p className={styles.hintWarn}>База зараз не відповідає — жодна цифра не є фактом.</p>
      ) : (
        <section className={styles.card} aria-labelledby="funnel-days">
          <div className={styles.cardHead}>
            <h2 id="funnel-days" className={styles.cardTitle}>{FUNNEL_SCOPE_LABEL[scope]} · по днях</h2>
          </div>
          <div className={styles.tableWrap} tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Крок</th>
                  <th scope="col" className={styles.cellNum}>Разом</th>
                  <th scope="col" className={styles.cellNum}>Від екрана</th>
                  {[...table.days].reverse().map((day) => (
                    <th key={day} scope="col" className={`${styles.cellNum} ${styles.cellMono}`}>{day.slice(5)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.name}>
                    <th scope="row">{row.label}</th>
                    <td className={styles.cellNum}><b>{row.total}</b></td>
                    <td className={`${styles.cellNum} ${styles.cellMuted}`}>{pct(row.ofHome)}</td>
                    {[...row.counts].reverse().map((n, i) => (
                      <td key={i} className={`${styles.cellNum} ${n === 0 ? styles.cellMuted : ""}`}>{n}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.cardNote}>
            «Веб» — стіл і телефон у браузері; «Застосунок» — Ryntra на Seeker. «Від екрана» — частка відвідин першого екрана
            за весь період. Автоматичних проходів за період: {measured.bots}.{measured.since ? ` Лічильник іде з ${measured.since.slice(0, 10)}.` : ""}
          </p>
        </section>
      )}
    </AdminShellV2>
  );
}

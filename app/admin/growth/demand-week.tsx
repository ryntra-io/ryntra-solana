"use client";

import { useCallback, useEffect, useState } from "react";

import { InfoControl } from "@/app/shell/info-control";
import { cohortText, NOT_READ, usdText, type Cohort, type DemandWeek } from "@/lib/growth/demand-week";

import styles from "../admin.module.css";
import own from "./growth.module.css";

/**
 * CITY-197 — the owner's week of demand: the one metric (external net revenue) and the four figures behind it, for a
 * closed week. Every figure is the server's (`lib/growth/demand-week.ts`); one that did not read says «не прочитано».
 */

type Answer = Readonly<{ demand: DemandWeek; weeks: readonly string[] }>;

const dayText = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const span = (week: DemandWeek) => `${dayText(week.from)}–${dayText(new Date(Date.parse(week.to) - 86_400_000).toISOString())}`;
const int = (value: number | null) => (value === null ? NOT_READ : new Intl.NumberFormat("uk-UA").format(value));
const sol = (value: number | null) => (value === null ? NOT_READ : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: value >= 1 ? 2 : 4 }).format(value)} SOL`);

function Figure({ label, value, unread, note }: { label: string; value: string; unread: boolean; note?: string | null }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <b className={`${styles.statValue} ${unread ? styles.statUnknown : ""}`}>{value}</b>
      {note ? <span className={own.demandNote}>{note}</span> : null}
    </div>
  );
}

const cohortUnread = (value: Cohort | null) => value === null;

export function DemandWeekCard() {
  const [week, setWeek] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (asked: string | null) => {
    setFailed(false);
    try {
      const response = await fetch(`/api/admin/growth/demand${asked ? `?week=${asked}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      setAnswer((await response.json()) as Answer);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load(week);
  }, [load, week]);

  const demand = answer && (week === null || answer.demand.week === week) ? answer.demand : null;
  const revenue = demand?.revenue ?? null;

  return (
    <section className={`${styles.card} ${own.demand}`} aria-labelledby="demand-week" data-demand-week="">
      <div className={styles.cardHead}>
        <h2 id="demand-week" className={styles.cardTitle}>Тиждень попиту</h2>
        {demand ? <span className={styles.cardNote}>{span(demand)}</span> : null}
        <span className={styles.cardSpacer} />
        {answer ? (
          <select className={`${styles.select} ${own.demandPick}`} value={week ?? answer.demand.week} onChange={(event) => setWeek(event.target.value)} aria-label="Тиждень">
            {answer.weeks.map((monday) => (
              <option key={monday} value={monday}>
                тиждень з {monday}
              </option>
            ))}
          </select>
        ) : null}
        <InfoControl label="Як рахуємо тиждень попиту">
          <p>
            Закритий тиждень, понеділок–неділя UTC. Лише люди: гаманці Ryntra — список власника, підписанти запуску, команда
            й агент — не рахуються ніде.
          </p>
          <p>
            Чистий дохід — комісії Ryntra з обмінів і торгів запусків людей після частки провайдера, кешбеку й винагород
            друзям, плюс комісії агентів людей (SOL за ціною зараз), мінус частка партнерів за тиждень.
          </p>
          <p>
            Агенти — агенти з бюджетом, що зробили угоду за тиждень; обіг — покупки й продажі в SOL. Повернення D7 / D30 — з
            людей, що вперше прийшли за 7 / 30 днів до тижня, скільки зробили щось знову іншого дня впродовж 7 / 30 днів.
            Від партнерів — нові гаманці тижня за посиланням партнера чи через запуск партнера.
          </p>
          <p>Цифра, яку не вдалося прочитати, — «не прочитано», не нуль.</p>
        </InfoControl>
      </div>

      {failed ? <p className={own.demandLine}>Зріз не прочитано. Оновіть сторінку.</p> : null}

      {demand && revenue ? (
        <>
          <div className={own.demandHero}>
            <span className={styles.statLabel}>Зовнішній чистий дохід</span>
            <b className={`${own.aimValue} ${revenue.netUsd === null ? styles.statUnknown : ""}`} data-demand-net="">
              {usdText(revenue.netUsd)}
            </b>
            <span className={own.demandLine}>
              обміни {usdText(revenue.swapsUsd)} · агенти {usdText(revenue.agentsUsd)} · партнерам {usdText(revenue.partnersUsd)}
            </span>
          </div>
          <div className={styles.stats}>
            <Figure label="Запуски людей" value={int(demand.launches.coins)} unread={demand.launches.coins === null} note={demand.launches.people !== null && demand.launches.coins ? `${int(demand.launches.people)} творців` : null} />
            <Figure label="Агенти" value={int(demand.agents.active)} unread={demand.agents.active === null} note={`обіг ${sol(demand.agents.turnoverSol)}`} />
            <Figure label="Повернення D7" value={cohortText(demand.returns.d7)} unread={cohortUnread(demand.returns.d7)} />
            <Figure label="Повернення D30" value={cohortText(demand.returns.d30)} unread={cohortUnread(demand.returns.d30)} />
            <Figure label="Від партнерів" value={int(demand.partners.people)} unread={demand.partners.people === null} />
          </div>
        </>
      ) : !failed ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Завантаження тижня попиту">
          <div className={styles.skeletonRow} />
        </div>
      ) : null}
    </section>
  );
}

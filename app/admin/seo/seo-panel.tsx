"use client";

import { useCallback, useEffect, useState } from "react";

import { InfoControl } from "@/app/shell/info-control";
import type { SeoInventory } from "@/lib/admin/insights";

import styles from "../admin.module.css";
import { PlainStat as Stat } from "../stat";

export function SeoPanel() {
  const [model, setModel] = useState<SeoInventory | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/seo");
    if (!r.ok) {
      setModel(null);
      setError(r.status === 401 ? "Сесія адміністратора закінчилась." : `Код ${r.status}`);
      return;
    }
    const json = (await r.json()) as { seo: SeoInventory };
    setModel(json.seo);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className={styles.cardHead}>
        <h1 className={styles.pageTitle}>SEO і ріст</h1>
        <InfoControl label="Що це за інвентар">
          <p>
            Це факти з нашого sitemap і robots, не оцінка Google. Адмінка не
            індексується.
          </p>
        </InfoControl>
      </div>

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`} role="alert">
          {error}
          <button type="button" className={styles.btn} onClick={() => void load()}>Спробувати ще раз</button>
        </div>
      ) : null}

      {model ? (
        <section className={styles.card}>
          <div className={styles.stats}>
            <Stat value={model.sitemapUrlCount} label="URL у sitemap" />
          </div>
          <p className={styles.laterCopy}>
            lastmod, які ми реально віддаємо: {model.lastmodDates.join(", ") || "немає даних"}.
            Адмінка в індексі: ні. robots disallow /admin: {model.robotsDisallowAdmin ? "так" : "ні"}.
            priority/changefreq не є ranking truth.
          </p>
        </section>
      ) : null}
    </div>
  );
}

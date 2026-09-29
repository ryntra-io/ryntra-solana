"use client";

import Link from "next/link";

import { InfoControl } from "@/app/shell/info-control";

import styles from "../admin.module.css";

export function SettingsPanel() {
  return (
    <div>
      <div className={styles.cardHead}>
        <h1 className={styles.pageTitle}>Налаштування</h1>
        <InfoControl label="Що тут вирішено">
          <p>
            Сповіщення користувачів живуть у боті /settings. Кампанія x_* і
            реферал ref_* — різні речі і ніколи не змішуються.
          </p>
        </InfoControl>
      </div>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Сповіщення</h2>
        <p className={styles.pageLead}>
          product_updates можна вимкнути. service_security вимкнути не можна.
          Поки рядок не збережено, розсилка продукту лишається дозволеною.
        </p>
      </section>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Вхід і другий фактор</h2>
        <p className={styles.pageLead}>
          Щоденний вхід оператора — через обліковий запис (email або Google) і код з
          застосунку-автентифікатора на <Link href="/admin/login">/admin/login</Link>. Посилання з бота
          лишається перехідним шляхом; з нього ж привʼязується перший спосіб входу. Секрет
          автентифікатора зберігає власник, не Ryntra. Одноразових кодів відновлення тут немає:
          резервний доступ — це другий підтверджений автентифікатор на іншому пристрої.
        </p>
      </section>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Атрибуція</h2>
        <p className={styles.pageLead}>
          x_v1_* — кампанія. ref_* — спадковий реферал, без винагороди й без
          доступу. Це не одна метрика.
        </p>
      </section>
    </div>
  );
}

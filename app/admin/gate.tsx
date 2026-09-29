import Link from "next/link";

import styles from "./admin.module.css";

export function AdminUnauthorized({ surface }: { surface: string }) {
  return (
    <main className="bg-wrap">
      <section className="bg-hero">
        <p className="bg-eyebrow">Admin</p>
        <h1 className="bg-status-name">401</h1>
        <p className="bg-hint">
          {surface}. <Link href="/admin/login">Увійти як оператор</Link> або надішли /admin боту @RyntraBeta_bot, щоб отримати свіже посилання.
        </p>
      </section>
    </main>
  );
}

export function AdminLater({ title }: { title: string }) {
  return (
    <section>
      <h1 className={styles.pageTitle}>{title}</h1>
      <p className={styles.laterCopy}>Спроєктовано. Не ця хвиля.</p>
    </section>
  );
}


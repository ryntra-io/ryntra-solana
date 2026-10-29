import Link from "next/link";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import styles from "./not-found.module.css";

const WORDS = {
  title: { en: "This page is not here", uk: "Такої сторінки немає" },
  body: {
    en: "The address may be old or mistyped. Search finds a token by its name, ticker or contract address — or go to one of these.",
    uk: "Можливо, адреса стара або з помилкою. Пошук угорі знайде токен за назвою, тікером чи адресою контракту — або перейди сюди.",
  },
  home: { en: "Home", uk: "Головна" },
  markets: { en: "Markets", uk: "Ринки" },
  trade: { en: "Terminal", uk: "Термінал" },
  portfolio: { en: "Portfolio", uk: "Портфель" },
} as const;

/**
 * The cabinet's «not found» (the menu v6.2): inside the
 * shell, so the menu, the search and the wallet are around it, with the ways
 * a person most likely meant. Never the framework's bare page.
 */
export default async function CabinetNotFound() {
  const locale = await solanaServerLocale();
  const word = (key: keyof typeof WORDS) => WORDS[key][locale];
  return (
    <section className={styles.page} aria-labelledby="missing-title" data-not-found="cabinet">
      <div className={styles.card} role="status">
        <p className={styles.code}>404</p>
        <h1 id="missing-title" className={styles.title}>{word("title")}</h1>
        <p className={styles.body}>{word("body")}</p>
        <div className={styles.actions}>
          <Link className="rw-btn rw-btn--primary" href="/app/markets" prefetch={false}>
            {word("markets")}
          </Link>
          <Link className="rw-btn" href="/app/home" prefetch={false}>
            {word("home")}
          </Link>
          <Link className="rw-btn" href="/app/spot" prefetch={false}>
            {word("trade")}
          </Link>
          <Link className="rw-btn" href="/app/portfolio" prefetch={false}>
            {word("portfolio")}
          </Link>
        </div>
      </div>
    </section>
  );
}

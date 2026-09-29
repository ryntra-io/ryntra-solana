"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ExternalMark } from "@/app/components/mark";
import { CONTACTS, GITHUB_ORGANIZATION_URL } from "@/lib/site/contacts";
import { siteFooter } from "@/lib/site/homepage-copy";
import { landingHref, readPublicLocaleClient, type PublicLocale } from "@/lib/site/locale";
import { localizedPath } from "@/lib/site/localized";
import { publicCopy } from "@/lib/site/public-copy";

import styles from "./chrome.module.css";

/**
 * The one public footer (Owner, 2026-09-14: *«як нижні меню, так і верхні
 * меню»* — one and the same on every page): the wordmark, the five ways into
 * the product and the docs, the two places the company speaks, the legal
 * pair and the year, in the reader's language, from the same list the
 * header's menu reads. On the landing it is folded into the last block's
 * ground rather than a band of its own; everywhere else it stands on the
 * site's ground under a hairline. The destinations of the company's
 * accounts stay in `lib/site/contacts.ts`, the one place that knows them.
 */
export function PublicFooter({ locale: localeProp, landing = false }: { locale?: PublicLocale; landing?: boolean }) {
  const [locale, setLocale] = useState<PublicLocale>(localeProp ?? "en");

  useEffect(() => {
    setLocale(localeProp ?? readPublicLocaleClient());
    const update = (event: Event) => setLocale((event as CustomEvent<PublicLocale>).detail);
    window.addEventListener("ryntra:public-locale", update);
    return () => window.removeEventListener("ryntra:public-locale", update);
  }, [localeProp]);

  const copy = publicCopy(locale);
  const footer = siteFooter(locale);

  return (
    <footer className={landing ? `${styles.footer} ${styles.footerLanding}` : styles.footer}>
      <div className={`${styles.wrap} ${styles.landingInner}`}>
        <Link href={landingHref(locale)} className={styles.footerLogoLink} aria-label={copy.brandHome}>
          {/* The Owner's wordmark, one file per theme: silver lettering on the
              dark ground, graphite lettering on the light one. */}
          <img src="/brand/ryntra-wordmark-dark.svg" alt="" width={118} height={30} className={`${styles.landingLogo} ${styles.logoDark}`} />
          <img src="/brand/ryntra-wordmark-light.svg" alt="" width={118} height={30} className={`${styles.landingLogo} ${styles.logoLight}`} />
        </Link>
        <nav className={styles.landingNav} aria-label={footer.nav}>
          <ul className={styles.landingList}>
            {footer.links.map((item) => (
              <li key={item.href}>
                <Link className={styles.footerLink} href={localizedPath(item.href, locale)} prefetch={false}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <ul className={styles.landingSocial} aria-label={footer.social}>
          <li>
            <a className={styles.footerLink} href={CONTACTS.companyX} target="_blank" rel="noopener noreferrer">
              {footer.x}
              <ExternalMark size={12} />
            </a>
          </li>
          <li>
            <a className={styles.footerLink} href={GITHUB_ORGANIZATION_URL} target="_blank" rel="noopener noreferrer">
              {footer.github}
              <ExternalMark size={12} />
            </a>
          </li>
        </ul>
      </div>
      <div className={`${styles.wrap} ${styles.landingLegal}`}>
        <span>{footer.copyright}</span>
        {footer.legal.map((item) => (
          <Link key={item.href} className={styles.landingLegalLink} href={localizedPath(item.href, locale)} prefetch={false}>{item.label}</Link>
        ))}
      </div>
    </footer>
  );
}

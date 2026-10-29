"use client";

import { ArrowLeft, ArrowRight, CaretDown, Check, Copy, DownloadSimple } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { WalletGate } from "../wallet-gate.tsx";
import launchEn from "./kit/launch-en.png";
import launchUk from "./kit/launch-uk.png";
import rulesEn from "./kit/rules-en.png";
import reviewEn from "./kit/review-en.png";
import reviewUk from "./kit/review-uk.png";
import rulesUk from "./kit/rules-uk.png";
import { partnerCopy } from "./partner-copy.ts";
import { SignInGate } from "./sign-in-gate.tsx";
import { shownLink, usePartnerPage } from "./partner-view.tsx";
import styles from "./partners.module.css";

/**
 * The media kit of «Creator partners»: the partner's own link, real screens
 * of the live product in both languages, the brand, and what a creator should
 * know — the fees of a launch, the locked liquidity, where a partner's share
 * comes from — each behind its own disclosure, and words to post that stay
 * true. The screens are shots of ryntra.io as anybody sees it, without a
 * wallet; the marks are the brand's own files, never redrawn here.
 */

const SCREENS = {
  en: { launch: launchEn, rules: rulesEn, review: reviewEn },
  uk: { launch: launchUk, rules: rulesUk, review: reviewUk },
} as const;

const MARKS = [
  { id: "mark", file: "/brand/mark/mark.svg", ground: "dark" },
  { id: "heat", file: "/brand/mark/mark-heat.svg", ground: "dark" },
  { id: "navy", file: "/brand/mark/mark-navy.svg", ground: "light" },
  { id: "sand", file: "/brand/mark/mark-sand.svg", ground: "dark" },
] as const;

function CopyText({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className={styles.quiet} onClick={() => void copy()} aria-live="polite">
      {copied ? <Check size={14} weight="bold" aria-hidden="true" /> : <Copy size={14} weight="bold" aria-hidden="true" />}
      <span className={styles.gapLeft}>{copied ? copiedLabel : label}</span>
    </button>
  );
}

function Disclosure({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <section className={styles.panel}>
      <details className={styles.details}>
        <summary>
          {title}
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </summary>
        <ul className={styles.rules}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function KitView() {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const { page, failed, proven, wallet } = usePartnerPage();
  const screens = SCREENS[locale === "uk" ? "uk" : "en"];
  const link = page?.referral?.link ?? null;
  const postLink = link ?? "ryntra.io/r/…";

  return (
    <div className={styles.page}>
      <p className={styles.promise}>{words.kitLead}</p>

      <section className={styles.panel} aria-labelledby="kit-link">
        <h2 className={styles.title} id="kit-link">{words.kitLinkTitle}</h2>
        {page?.referral ? (
          <div className={styles.linkBlock} data-ready="true">
            <div className={styles.linkText}>
              <span className={styles.linkValue} translate="no">{shownLink(page.referral.link)}</span>
              <span className={styles.codeLine}>
                {words.code} <strong translate="no">{page.referral.code}</strong>
              </span>
            </div>
            <CopyLinkButton link={page.referral.link} />
          </div>
        ) : wallet.gate === "connect" ? (
          <WalletGate title={words.kitLinkGate} />
        ) : !proven ? (
          <SignInGate wallet={wallet} lead="kit" inside />
        ) : (
          <p className={styles.muted} aria-live="polite">{failed ? words.unavailable : words.kitLinkLoading}</p>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="kit-screens">
        <div className={styles.headRow}>
          <h2 className={styles.title} id="kit-screens">{words.screensTitle}</h2>
          <span className={styles.muted}>{words.screensLead}</span>
        </div>
        <ul className={styles.screens}>
          {(["launch", "rules", "review"] as const).map((id) => (
            <li key={id} className={styles.screen}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a download, shown at its own pixels */}
              <img src={screens[id].src} width={screens[id].width} height={screens[id].height} alt={words.screen[id]} loading="lazy" className={styles.shot} />
              <div className={styles.screenFoot}>
                <span className={styles.screenName}>{words.screen[id]}</span>
                <a className={styles.link} href={screens[id].src} download={`ryntra-${id}-${locale === "uk" ? "uk" : "en"}.png`}>
                  <DownloadSimple size={14} weight="bold" aria-hidden="true" />
                  {words.download}
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.panel} aria-labelledby="kit-brand">
        <h2 className={styles.title} id="kit-brand">{words.brandTitle}</h2>
        <ul className={styles.marks}>
          {MARKS.map((mark) => (
            <li key={mark.id} className={styles.markTile} data-ground={mark.ground}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the brand's own file, shown as it downloads */}
              <img src={mark.file} width={56} height={56} alt={words.marks[mark.id]} />
              <a className={styles.link} href={mark.file} download>
                <DownloadSimple size={14} weight="bold" aria-hidden="true" />
                {words.marks[mark.id]}
              </a>
            </li>
          ))}
        </ul>
        <dl className={styles.swatches}>
          <div>
            <dt>{words.colors.orange}</dt>
            <dd>
              <span className={styles.swatch} data-swatch="orange" aria-hidden="true" />
              <span translate="no">#FF681C</span>
            </dd>
          </div>
          <div>
            <dt>{words.colors.graphite}</dt>
            <dd>
              <span className={styles.swatch} data-swatch="graphite" aria-hidden="true" />
              <span translate="no">#080D13</span>
            </dd>
          </div>
          <div>
            <dt>{words.colors.font}</dt>
            <dd translate="no">Geist</dd>
          </div>
        </dl>
        <ul className={styles.rules}>
          {words.brandRules.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <Disclosure title={words.feesTitle} lines={words.fees} />
      <Disclosure title={words.lockedTitle} lines={words.locked} />
      <Disclosure title={words.shareTitle} lines={words.shareLines} />

      <section className={styles.panel} aria-labelledby="kit-posts">
        <div className={styles.headRow}>
          <h2 className={styles.title} id="kit-posts">{words.postsTitle}</h2>
          <span className={styles.muted}>{words.postsLead}</span>
        </div>
        <ul className={styles.posts}>
          {words.posts.map((post, index) => {
            const text = post(postLink);
            return (
              <li key={index} className={styles.post}>
                <p>{text}</p>
                {link ? <CopyText text={text} label={words.copy} copiedLabel={words.copied} /> : null}
              </li>
            );
          })}
        </ul>
        <p className={styles.muted}>{words.adLabel}</p>
      </section>

      <div className={styles.links}>
        <Link className={styles.link} href="/app/rewards/partners">
          <ArrowLeft size={14} aria-hidden="true" />
          {words.back}
        </Link>
        <Link className={styles.link} href="/promo/partners/terms">
          {words.terms}
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function CopyLinkButton({ link }: { link: string }) {
  const { locale } = useSolanaI18n();
  const words = partnerCopy(locale);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className={styles.primary} onClick={() => void copy()} aria-live="polite">
      {copied ? <Check size={16} weight="bold" aria-hidden="true" /> : <Copy size={16} weight="bold" aria-hidden="true" />}
      {copied ? words.copied : words.copy}
    </button>
  );
}

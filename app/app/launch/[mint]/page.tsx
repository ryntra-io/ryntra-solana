import { ArrowSquareOut, CaretDown, CheckCircle, Globe, ImageSquare, Lock, TelegramLogo, XLogo } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import type { LaunchTokenResponse } from "@/lib/api/v1/contract";
import { BASE58 } from "@/lib/api/v1/contract";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { launchConnection, launchNetwork, launchPoolPayer } from "@/lib/launch/config.server";
import { readLaunchView } from "@/lib/launch/view.server";
import { launchPreset } from "@/lib/core/venues/meteora-dbc/presets";

import { explorerUrl, formatBps, formatDate, formatRaw, shortAddress } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";
import { ShareLink } from "../share-link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function view(mint: string): Promise<LaunchTokenResponse | null> {
  const network = launchNetwork();
  const payer = launchPoolPayer();
  if (!network || !payer || !BASE58.test(mint)) return null;
  return readLaunchView(
    { network, connection: launchConnection(network), store: getGuardRuntime().store, poolPayer: payer.publicKey.toBase58(), origin: network.origin, now: () => new Date() },
    mint,
  );
}

export async function generateMetadata({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  if (!launchNetwork()) return {};
  const token = await view(mint).catch(() => null);
  return { title: token ? `${token.name} ($${token.symbol})` : undefined, robots: { index: false, follow: false } };
}

/**
 * A launched token's page — its picture, name and ticker, the curve's way to
 * the DEX, the «Чесний лаунч» marks each with the account where anyone can see
 * it, the creator's lock when it holds, and the link the creator shares.
 * Trading on it, the chart and the holders come with the launch page of the
 * next subtask. Served only where Launch runs.
 */
export default async function LaunchTokenPage({ params }: { params: Promise<{ mint: string }> }) {
  if (!launchNetwork()) notFound();
  const [{ mint }, locale] = await Promise.all([params, solanaServerLocale()]);
  const token = await view(mint);
  if (!token) notFound();
  const network = launchNetwork();
  return <TokenView token={token} locale={locale} pairSymbol={network?.pairs[token.preset].symbol ?? ""} />;
}

function TokenView({ token, locale, pairSymbol }: { token: LaunchTokenResponse; locale: WorkspaceLocale; pairSymbol: string }) {
  const word = launchWords(locale);
  const receipt = token.receipt;
  const marks = receipt?.marks ?? [];
  const lockMark = marks.find((mark) => mark.code === "CREATOR_BUY_LOCKED") ?? null;
  const progress = token.progressBps;
  const links = [
    { href: token.links.website, label: word("website"), icon: <Globe size={16} aria-hidden /> },
    { href: token.links.x, label: word("x"), icon: <XLogo size={16} aria-hidden /> },
    { href: token.links.telegram, label: word("telegram"), icon: <TelegramLogo size={16} aria-hidden /> },
  ].filter((link): link is { href: string; label: string; icon: React.JSX.Element } => Boolean(link.href));
  const presetName = launchPreset(token.preset)?.name[locale] ?? token.preset;
  return (
    <div className={styles.page}>
      <header className={styles.tokenHead}>
        <span className={styles.tokenPicture}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the token's own picture, served by its immutable address */}
          {token.image ? <img src={token.image} alt="" /> : <ImageSquare size={28} aria-hidden />}
        </span>
        <div className={styles.tokenTitle}>
          <h1 className={styles.tokenName}>{token.name}</h1>
          <div className={styles.tokenMeta}>
            <span className={styles.tokenSymbol}>${token.symbol}</span>
            <span className={styles.chip}>{presetName}</span>
            {token.network === "solana:devnet" ? <span className={styles.netChip}>{word("devnet")}</span> : null}
            <a className={styles.markLink} href={explorerUrl(token.network, "account", token.creator)} target="_blank" rel="noreferrer noopener">
              {word("tokenBy", { creator: shortAddress(token.creator) })}
            </a>
          </div>
        </div>
      </header>

      <div className={styles.tokenGrid}>
        <div className={styles.form}>
          <section className={styles.card} aria-labelledby="launch-progress">
            <div className={styles.progressHead}>
              <h2 id="launch-progress" className={styles.cardTitle}>
                {token.migrated ? word("graduated") : word("progress")}
              </h2>
              <span className={styles.progressValue} data-unknown={progress === null ? "" : undefined}>{progress === null ? word("progressUnknown") : formatBps(progress, locale)}</span>
            </div>
            {progress !== null ? (
              <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress / 100)}>
                <span className={styles.barFill} style={{ width: `${Math.max(progress / 100, 1)}%` }} />
              </div>
            ) : null}
          </section>

          <section className={styles.card} aria-labelledby="launch-marks">
            <h2 id="launch-marks" className={styles.cardTitle}>
              {word("marks")}
            </h2>
            {receipt ? (
              <ul className={styles.marks}>
                {lockMark ? (
                  <li className={`${styles.mark} ${styles.markLocked}`}>
                    <Lock size={18} weight="fill" aria-hidden />
                    <span className={styles.markText}>
                      <span>{word("mark_CREATOR_BUY_LOCKED")}</span>
                      {receipt.creatorLock ? (
                        <span className={styles.markSub}>
                          {Date.parse(receipt.creatorLock.cliffAt) > Date.parse(receipt.observedAt)
                            ? word("lockedUntil", { date: formatDate(receipt.creatorLock.cliffAt, locale) })
                            : word("lockedVesting", { date: formatDate(receipt.creatorLock.endsAt, locale) })}
                        </span>
                      ) : null}
                    </span>
                    <a className={styles.markLink} href={explorerUrl(token.network, "account", lockMark.account)} target="_blank" rel="noreferrer noopener">
                      {word("view")} <ArrowSquareOut size={14} aria-hidden />
                    </a>
                  </li>
                ) : null}
                {marks
                  .filter((mark) => mark.code !== "CREATOR_BUY_LOCKED")
                  .map((mark) => (
                    <li key={`${mark.code}:${mark.account}`} className={styles.mark}>
                      <CheckCircle size={18} weight="fill" aria-hidden />
                      <span className={styles.markText}>{word(`mark_${mark.code}` as LaunchWordKey)}</span>
                      <a className={styles.markLink} href={explorerUrl(token.network, "account", mark.account)} target="_blank" rel="noreferrer noopener">
                        {word("view")} <ArrowSquareOut size={14} aria-hidden />
                      </a>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className={styles.unread}>{word("marksUnread")}</p>
            )}
          </section>

          {token.description || links.length ? (
            <section className={styles.card} aria-labelledby="launch-about">
              <h2 id="launch-about" className={styles.cardTitle}>
                {word("about")}
              </h2>
              {token.description ? <p className={styles.description}>{token.description}</p> : null}
              {links.length ? (
                <>
                  <div className={styles.linkList}>
                    {links.map((link) => (
                      <a key={link.label} className="rw-btn" href={link.href} target="_blank" rel="noreferrer noopener nofollow ugc">
                        {link.icon}
                        {link.label}
                      </a>
                    ))}
                  </div>
                  <p className={styles.hint}>{word("linksByCreator")}</p>
                </>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className={styles.asideSticky}>
          <section className={styles.card}>
            <ShareLink link={token.shareLink} symbol={token.symbol} locale={locale} />
          </section>
          <section className={styles.card}>
            <details className={styles.details} open={false}>
              <summary className={styles.summary}>
                {word("receipt")} <CaretDown size={14} aria-hidden className={styles.caret} />
              </summary>
              <dl className={styles.rows}>
                <Row label={word("receiptCreated")} value={<Explorer network={token.network} kind="tx" id={token.signature} />} />
                {receipt ? <Row label={word("receiptConfig")} value={<Explorer network={token.network} kind="account" id={receipt.config} />} /> : null}
                {receipt ? <Row label={word("receiptCurve")} value={<Explorer network={token.network} kind="account" id={receipt.pool} />} /> : null}
                <Row
                  label={word("receiptFirstBuy")}
                  value={
                    receipt?.creatorFirstBuy
                      ? word("receiptFirstBuyValue", {
                          tokens: formatRaw(receipt.creatorFirstBuy.tokensOutRaw, 6, locale, 0),
                          amount: formatRaw(receipt.creatorFirstBuy.quoteInRaw, 6, locale, 2),
                          symbol: pairSymbol,
                          cap: formatRaw(receipt.creatorFirstBuy.capRaw, 6, locale, 0),
                          pct: formatBps(launchPreset(token.preset)?.creatorFirstBuyCapBps ?? 0, locale),
                        })
                      : word("receiptNone")
                  }
                />
                <Row label={word("receiptLock")} value={receipt?.creatorLock ? <Explorer network={token.network} kind="account" id={receipt.creatorLock.escrow} /> : word("receiptNone")} />
              </dl>
            </details>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Explorer({ network, kind, id }: { network: LaunchTokenResponse["network"]; kind: "tx" | "account"; id: string }) {
  return (
    <a className={`${styles.markLink} ${styles.addr}`} href={explorerUrl(network, kind, id)} target="_blank" rel="noreferrer noopener">
      {shortAddress(id)} <ArrowSquareOut size={12} aria-hidden />
    </a>
  );
}

import { ArrowSquareOut, CaretDown, CheckCircle, Globe, ImageSquare, Lock, TelegramLogo, XLogo } from "@phosphor-icons/react/dist/ssr";
import { notFound } from "next/navigation";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import type { LaunchTokenResponse } from "@/lib/api/v1/contract";
import { BASE58 } from "@/lib/api/v1/contract";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { launchConnection, launchNetwork, launchPoolPayerAddress } from "@/lib/launch/config.server";
import { launchTrading } from "@/lib/launch/runtime.server";
import { readLaunchView } from "@/lib/launch/view.server";
import { launchPreset } from "@/lib/core/venues/meteora-dbc/presets";

import { explorerUrl, formatBps, formatDate, formatRaw, shortAddress } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";
import { ShareLink } from "../share-link";
import { TokenMarket } from "./token-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function view(mint: string): Promise<LaunchTokenResponse | null> {
  const network = launchNetwork();
  const payer = network ? launchPoolPayerAddress(network) : null;
  if (!network || !payer || !BASE58.test(mint)) return null;
  return readLaunchView({ network, connection: launchConnection(network), store: getGuardRuntime().store, poolPayer: payer, origin: network.origin, now: () => new Date() }, mint);
}

export async function generateMetadata({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  if (!launchNetwork()) return {};
  const token = await view(mint).catch(() => null);
  return { title: token ? `${token.name} ($${token.symbol})` : undefined, robots: { index: false, follow: false } };
}

/**
 * A launched token's page — its market from the chain (the price and market
 * cap, the chart, buying and selling on the curve and after it in the pool,
 * the trades, the holders with their labels, the facts of risk, the creator's
 * other launches), the «Чесний лаунч» marks each with the account or
 * transaction where anyone can see it, the creator's words and links, the link
 * the creator shares, and the launch receipt. Served only where Launch runs.
 */
export default async function LaunchTokenPage({ params }: { params: Promise<{ mint: string }> }) {
  if (!launchNetwork()) notFound();
  const [{ mint }, locale] = await Promise.all([params, solanaServerLocale()]);
  /* The page shows the token at once; its market — every trade and holder read from the chain — comes after it, in the page. */
  const token = await view(mint);
  if (!token) notFound();
  const network = launchNetwork();
  const pairSymbol = network?.pairs[token.preset]?.symbol ?? "";
  return (
    <div className={styles.page} data-wide="">
      <TokenMarket
        initial={null}
        paused={!launchTrading()}
        token={token.token}
        symbol={token.symbol}
        locale={locale}
        slots={{
          head: <TokenHead token={token} locale={locale} />,
          marks: <Marks token={token} locale={locale} />,
          about: <About token={token} locale={locale} />,
          share: (
            <section className={styles.card} id="launch-share">
              <ShareLink link={token.shareLink} symbol={token.symbol} locale={locale} />
            </section>
          ),
          receipt: <Receipt token={token} locale={locale} pairSymbol={pairSymbol} />,
        }}
      />
    </div>
  );
}

function TokenHead({ token, locale }: { token: LaunchTokenResponse; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const presetName = launchPreset(token.preset)?.name[locale] ?? token.preset;
  return (
    <header className={styles.tokenHead}>
      <span className={styles.tokenPicture}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the token's own picture, served by its immutable address */}
        {token.image ? <img src={token.image} alt="" /> : <ImageSquare size={28} aria-hidden />}
      </span>
      <div className={styles.tokenTitle}>
        <h1 className={styles.tokenName}>{token.name}</h1>
        <div className={styles.tokenMeta}>
          <span className={styles.tokenSymbol}>${token.symbol}</span>
          <span className={styles.chip}>{word("presetChip", { name: presetName })}</span>
          {token.network === "solana:devnet" ? <span className={styles.netChip}>{word("devnet")}</span> : null}
          <a className={styles.markLink} href={explorerUrl(token.network, "account", token.creator)} target="_blank" rel="noreferrer noopener">
            {word("tokenBy", { creator: shortAddress(token.creator) })}
          </a>
        </div>
      </div>
    </header>
  );
}

function Marks({ token, locale }: { token: LaunchTokenResponse; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const receipt = token.receipt;
  const marks = receipt?.marks ?? [];
  const lockMark = marks.find((mark) => mark.code === "CREATOR_BUY_LOCKED") ?? null;
  return (
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
                <span className={styles.markText}>{word(markWord(mark, receipt))}</span>
                <a className={styles.markLink} href={explorerUrl(token.network, "account", mark.account)} target="_blank" rel="noreferrer noopener">
                  {word("view")} <ArrowSquareOut size={14} aria-hidden />
                </a>
              </li>
            ))}
        </ul>
      ) : (
        <p className={styles.unread}>{word("marksUnread")}</p>
      )}
      {receipt ? (
        <p className={styles.marksChecked}>
          {word("marksChecked", { ago: checkedAgo(word, receipt.observedAt) })}
        </p>
      ) : null}
    </section>
  );
}

/** How long ago the chain was read for these marks — a person's own clock is not the server's, so never a time of day. */
function checkedAgo(word: ReturnType<typeof launchWords>, observedAt: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(observedAt)) / 60_000);
  return minutes < 1 ? word("justNow") : word("ago", { time: word("min", { n: minutes }) });
}

/** A locked position of the graduated pool is named by its owner: the creator's, or Ryntra's as the config's partner. */
function markWord(mark: { code: string; account: string }, receipt: NonNullable<LaunchTokenResponse["receipt"]>): LaunchWordKey {
  if (mark.code !== "LP_LOCKED_FOREVER") return `mark_${mark.code}` as LaunchWordKey;
  const owner = receipt.graduated?.positions.find((position) => position.position === mark.account)?.owner;
  return owner === undefined ? "mark_LP_LOCKED_FOREVER" : owner === receipt.creator ? "mark_LP_LOCKED_FOREVER_creator" : "mark_LP_LOCKED_FOREVER_partner";
}

function About({ token, locale }: { token: LaunchTokenResponse; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const links = [
    { href: token.links.website, label: word("website"), icon: <Globe size={16} aria-hidden /> },
    { href: token.links.x, label: word("x"), icon: <XLogo size={16} aria-hidden /> },
    { href: token.links.telegram, label: word("telegram"), icon: <TelegramLogo size={16} aria-hidden /> },
  ].filter((link): link is { href: string; label: string; icon: React.JSX.Element } => Boolean(link.href));
  if (!token.description && !links.length) return null;
  return (
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
  );
}

function Receipt({ token, locale, pairSymbol }: { token: LaunchTokenResponse; locale: WorkspaceLocale; pairSymbol: string }) {
  const word = launchWords(locale);
  const receipt = token.receipt;
  return (
    <section className={styles.card} id="launch-receipt">
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
          {receipt?.feeSharing ? (
            <>
              <Row label={word("feeShareTitle")} value={<Explorer network={token.network} kind="account" id={receipt.feeSharing.vault} />} />
              {receipt.feeSharing.shares.map((share) => (
                <Row
                  key={share.address}
                  label={share.address === receipt.creator ? `${word("label_creator")} · ${shortAddress(share.address)}` : shortAddress(share.address)}
                  value={formatBps(share.bps, locale)}
                />
              ))}
            </>
          ) : null}
        </dl>
        {receipt?.feeSharing ? <p className={styles.hint}>{word("feeShareLine")}</p> : null}
      </details>
    </section>
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

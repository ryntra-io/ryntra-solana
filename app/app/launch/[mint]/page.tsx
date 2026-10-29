import { ArrowLeft, ArrowSquareOut, CaretDown, CheckCircle, Globe, ImageSquare, Lock, TelegramLogo, XLogo } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Suspense, type ComponentProps } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { withinMetadataBudget } from "@/app/app/metadata-budget";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { ShareTrade } from "@/app/solana/workspace/rewards/share-trade";
import type { LaunchEarlyAccessViewResponse, LaunchTokenResponse } from "@/lib/api/v1/contract";
import { earlyAccessView } from "@/lib/launch/early-access.server";
import { earlyAccessReadDeps } from "@/lib/launch/early-access-runtime.server";
import { BASE58 } from "@/lib/api/v1/contract";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { launchConnection, launchExecutorAddress, launchNetwork, launchPoolPayerAddress } from "@/lib/launch/config.server";
import type { ProofInput } from "@/lib/core/launch/proof";
import { readLaunchMarketAnswer, readLaunchMarketFacts } from "@/lib/launch/market.server";
import { launchMarketDeps, launchTrading } from "@/lib/launch/runtime.server";
import { readLaunchView } from "@/lib/launch/view.server";
import { readBoostCampaign, settledBoostCampaign } from "@/lib/launch/boost.server";
import { pageSplitView, readCreatorSplit } from "@/lib/launch/creator-split.server";
import { LAUNCH_SHORT_PATH } from "@/lib/launch/share-link";
import { launchPreset } from "@/lib/core/venues/meteora-dbc/presets";
import { RECEIPT_EXIT_UNREAD, RECEIPT_LOCK_UNREAD, receiptRefusedByRules } from "@/lib/core/venues/meteora-dbc/receipt";

import { LinkButton } from "../launch-blocks";
import { TransferFeePanel } from "../transfer-fee-panel";
import { Block, Page } from "../launch-core";
import { explorerUrl, formatBps, formatDate, formatRaw, shortAddress } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import { curveRuleNames } from "../market-view";
import styles from "../launch.module.css";
import { ShareLink } from "../share-link";
import { EarlyAccessToken } from "./early-access";
import { MarketConstitutionBlock } from "./constitution";
import { AdvancedTerms, BoostOffer } from "./formats";
import { DistributionPanel } from "./distribution-panel";
import { SplitOffer } from "./split-offer";
import { PairWatchNote } from "./pair-watch";
import { ProofRows } from "./proof-rows";
import { ReportToken } from "./report-token";
import { TokenMarket } from "./token-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * How long the page's HTML waits for the token's market (SOL-P1). Within it the market streams in with the page itself —
 * no wait for the scripts and a second request; past it the browser reads the market on its own, as before.
 */
const PAGE_MARKET_MS = 2_500;

async function view(mint: string): Promise<LaunchTokenResponse | null> {
  const network = launchNetwork();
  const payer = network ? launchPoolPayerAddress(network) : null;
  if (!network || !payer || !BASE58.test(mint)) return null;
  return readLaunchView({ network, connection: launchConnection(network), store: getGuardRuntime().store, poolPayer: payer, origin: network.origin, now: () => new Date() }, mint);
}

/** An early-access launch's view (SOL-L5), within the page's budget; null when this token has none. */
async function earlyView(mint: string): Promise<LaunchEarlyAccessViewResponse | null> {
  const deps = BASE58.test(mint) ? earlyAccessReadDeps() : null;
  if (!deps) return null;
  const read = await withinMetadataBudget(earlyAccessView(deps, mint).catch(() => null), null, PAGE_MARKET_MS);
  if (!read) return null;
  return {
    network: deps.network.chain,
    ...read,
    rules: { ...read.rules },
    lines: { uk: [...read.lines.uk], en: [...read.lines.en] },
    creation: { state: read.creation.state, steps: { MINT: { ...read.creation.steps.MINT }, POOL: { ...read.creation.steps.POOL }, VAULT: { ...read.creation.steps.VAULT } } },
    chainProblems: [...read.chainProblems],
  };
}

export async function generateMetadata({ params }: { params: Promise<{ mint: string }> }): Promise<Metadata> {
  const { mint } = await params;
  if (!launchNetwork()) return {};
  /* The card at the network's own address (ryntra.io; a devnet stand's), never the site's default on another one. */
  const origin = launchNetwork()?.origin ?? "";
  if (!BASE58.test(mint)) return { robots: { index: false, follow: false } };
  /* Within the metadata's budget: the token's name titles the tab when the chain answers at once, never at the cost of the skeleton. */
  const token = await withinMetadataBudget(view(mint), null);
  const locale = await solanaServerLocale();
  const word = launchWords(locale);
  /* SOL-L1e: the token's own card, never the site's — a link to this page already shared (Telegram reads it; X stops at
     robots.txt, so the creator shares the short address) previews the token, not the stocks. */
  const title = token ? word("cardTitle", { name: token.name, symbol: token.symbol }) : undefined;
  const image = { url: `${origin}${LAUNCH_SHORT_PATH}/${mint}/image?v=${Math.floor(Date.now() / 600_000)}${locale === "uk" ? "&l=uk" : ""}`, width: 1200, height: 630 };
  const description = `${word("cardLeadPlain")} ${word("cardNoAdvice")} ${word("noGuarantee")}`;
  return {
    title: token ? `${token.name} ($${token.symbol})` : undefined,
    robots: { index: false, follow: false },
    openGraph: { type: "website", siteName: "Ryntra", title, description, images: [image], locale: locale === "uk" ? "uk_UA" : "en_US" },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
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
  /* The market's read starts beside the token's (SOL-P1), within the page's budget for it: it streams in after the token. */
  const deps = BASE58.test(mint) ? launchMarketDeps() : null;
  const market = deps ? withinMetadataBudget(readLaunchMarketAnswer(deps, mint), null, PAGE_MARKET_MS) : Promise.resolve(null);
  /* The page shows the token at once; its market — every trade and holder read from the chain — comes after it, in the page. */
  const token = await view(mint);
  if (!token) {
    /* A token launched with early access (SOL-L5) has no curve: its own page is its vault and its pool. */
    const early = await earlyView(mint);
    if (!early) notFound();
    return (
      <div className={styles.page}>
        <Link className={styles.backLink} href="/app/launch/markets" prefetch={false}>
          <ArrowLeft size={14} aria-hidden /> {launchWords(locale)("marketsAll")}
        </Link>
        <Page kind="overview" className={styles.corePage} title={early.name || early.symbol} lead={<span className={styles.tokenSymbol}>${early.symbol}</span>}>
          <EarlyAccessToken initial={early} locale={locale} paused={!launchTrading()} />
        </Page>
      </div>
    );
  }
  const network = launchNetwork();
  /* The pair as the token's own read names it («Спільнота»: its community token); «Розширений» is USDC's (SOL-L5). */
  const pair = token.pair ?? (network?.pairs[token.preset] ?? (token.preset === "advanced" ? network?.pairs.protected : null)) ?? null;
  const pairSymbol = pair?.symbol ?? "";
  /* Launch Boost's rules, read before a purchase: the campaign's own record, no read of the chain on the page. */
  const [stored, splitStored] = network
    ? await Promise.all([readBoostCampaign(getGuardRuntime().store, network.cluster, token.token).catch(() => null), readCreatorSplit(getGuardRuntime().store, network.cluster, token.token).catch(() => null)])
    : [null, null];
  /*
   * Both within the page's one budget, side by side: a Boost commitment the page has not seen land is settled from its
   * escrow; SOL-L2b — the creator's division of their own share, what it owes and what was done (a rule on its way
   * settled from the chain), read at most once a short while per token; past the budget the split's own record says the
   * rule alone.
   */
  const [campaign, splitView] = await Promise.all([
    stored && network ? withinMetadataBudget(settledBoostCampaign({ store: getGuardRuntime().store, connection: launchConnection(network), second: null }, stored), stored, PAGE_MARKET_MS) : Promise.resolve(stored),
    splitStored && deps ? withinMetadataBudget(pageSplitView({ ...deps, env: process.env }, token.token).catch(() => null), null, PAGE_MARKET_MS) : Promise.resolve(null),
  ]);
  const pairDollar = Boolean(pair && "dollar" in pair && pair.dollar);
  return (
    <div className={styles.page}>
      {/* Every market launched on Ryntra, one press back — the list a judge or a buyer came from. */}
      <Link className={styles.backLink} href="/app/launch/markets" prefetch={false}>
        <ArrowLeft size={14} aria-hidden /> {launchWords(locale)("marketsAll")}
      </Link>
      <Page kind="overview" className={styles.corePage} title={<TokenTitle token={token} />} lead={<TokenMeta token={token} locale={locale} />}>
      <MarketStream
        market={market}
        mint={mint}
        paused={!launchTrading()}
        marksShown={(token.receipt?.marks ?? []).map((mark) => mark.code)}
        creation={token.signature}
        token={token.token}
        symbol={token.symbol}
        locale={locale}
        slots={{
          /* SOL-L12: a pair whose issuer changed its rules is said before anything else on the page. */
          head: token.pairWatch?.state === "CHANGED" ? <PairWatchNote watch={token.pairWatch} locale={locale} /> : null,
          marks: <Marks token={token} locale={locale} partners={partnersOf(network)} pair={pair} />,
          about: (
            <>
              {token.advanced ? <AdvancedTerms advanced={token.advanced} locale={locale} /> : null}
              <About token={token} locale={locale} />
            </>
          ),
          offer: (
            <>
              <BoostOffer campaign={campaign} network={token.network} locale={locale} units={{ symbol: token.symbol, decimals: token.receipt?.token2022.decimals ?? 6, pairSymbol, pairDecimals: pair?.decimals ?? 6, dollar: pairDollar }} />
              <SplitOffer view={splitView} stored={splitStored} network={token.network} locale={locale} />
              {/* DROP-2: what a distribution campaign owes this wallet, what it has taken and what is left — its own claim. */}
              <DistributionPanel mint={token.token} network={token.network} locale={locale} />
            </>
          ),
          share: (
            <Block title={launchWords(locale)("share")} titleAs="h2" lang={locale === "uk" ? "uk" : "en"} id="launch-share" className={styles.shareCard}>
              <ShareLink link={token.shareLink} symbol={token.symbol} locale={locale} bare />
              {/* «Поділитися угодою»: a card of this wallet's own trade of this token, with its link — drawn only for a wallet
                  that proved itself and traded here. */}
              <ShareTrade mint={token.token} />
              <ReportToken mint={token.token} symbol={token.symbol} locale={locale} />
            </Block>
          ),
          receipt: <Receipt token={token} locale={locale} pairSymbol={pairSymbol} />,
          /* MOS-1: every rule of the market with who keeps it and where to check it, and the document's SHA-256. */
          constitution: <MarketConstitutionBlock mint={token.token} network={token.network} locale={locale} units={{ symbol: token.symbol, decimals: token.receipt?.token2022.decimals ?? 6, pairSymbol, pairDecimals: pair?.decimals ?? 6 }} />,
        }}
      />
      </Page>
    </div>
  );
}

type MarketProps = Omit<ComponentProps<typeof TokenMarket>, "initial" | "initialFirst" | "renderedAt">;
type MarketAnswer = Awaited<ReturnType<typeof readLaunchMarketAnswer>> | null;

/**
 * The token's market, streamed with the page (SOL-P1): the page's frame and the token come at once, the market's
 * skeleton in the market's own shape holds its place, and the market itself follows in the same response as soon as
 * the server has read it — the full read, or its first answer — never later than `PAGE_MARKET_MS` from the request.
 */
function MarketStream({ market, mint, ...props }: MarketProps & { market: Promise<MarketAnswer>; mint: string }) {
  return (
    <Suspense fallback={<TokenMarket {...props} initial={null} />}>
      <MarketRead market={market} mint={mint} {...props} />
    </Suspense>
  );
}

async function MarketRead({ market, mint, ...props }: MarketProps & { market: Promise<MarketAnswer>; mint: string }) {
  const answer = await market;
  /* A first answer: the full read goes on after the page, the function kept alive for it, so the page's next ask finds it. */
  const deps = answer?.behind ? launchMarketDeps() : null;
  if (deps) after(() => readLaunchMarketFacts(deps, mint).then(() => undefined, () => undefined));
  return <TokenMarket {...props} initial={answer?.facts?.response ?? null} initialFirst={answer?.first ?? false} renderedAt={Date.now()} />;
}

/** The page's heading: the token's own picture and its name. */
function TokenTitle({ token }: { token: LaunchTokenResponse }) {
  return (
    <span className={styles.tokenTitleLine}>
      <span className={styles.tokenPicture}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the token's own picture, served by its immutable address */}
        {token.image ? <img src={token.image} alt="" /> : <ImageSquare size={28} aria-hidden />}
      </span>
      <span className={styles.tokenName}>{token.name}</span>
    </span>
  );
}

/** Under the heading, one line: the ticker, the preset, the network when it is a test one, and who launched it. */
function TokenMeta({ token, locale }: { token: LaunchTokenResponse; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const presetName = launchPreset(token.preset)?.name[locale] ?? token.preset;
  return (
    <span className={styles.tokenMeta}>
      <span className={styles.tokenSymbol}>${token.symbol}</span>
      <span className={styles.chip}>{word("presetChip", { name: presetName })}</span>
      {token.network === "solana:devnet" ? <span className={styles.netChip}>{word("devnet")}</span> : null}
      <a className={styles.markLink} href={explorerUrl(token.network, "account", token.creator)} target="_blank" rel="noreferrer noopener">
        {word("tokenBy", { creator: shortAddress(token.creator) })}
      </a>
    </span>
  );
}

/** Ryntra's side of a launch's exit: the config's partner (its fee claimer) and, on Micro and the demo market, the executor. */
function partnersOf(network: ReturnType<typeof launchNetwork>): ReadonlySet<string> {
  if (!network) return new Set();
  return new Set([network.referralOwner, launchExecutorAddress(network)].filter((address): address is string => Boolean(address)));
}

/**
 * «Доказ запуску» (SOL-L3): the program rules the launch receipt read — each mark with its account —, then every other
 * statement about the token — its supply, who holds it, what the creator did, its fees, its move to the DEX — each with
 * the transaction or the account it is read at (`ProofRows`, from the market the page reads). No mark is a verdict.
 */
function Marks({ token, locale, partners, pair }: { token: LaunchTokenResponse; locale: WorkspaceLocale; partners: ReadonlySet<string>; pair: Readonly<{ symbol: string; decimals: number }> | null }) {
  const word = launchWords(locale);
  const receipt = token.receipt;
  const marks = receipt?.marks ?? [];
  const lockMark = marks.find((mark) => mark.code === "CREATOR_BUY_LOCKED") ?? null;
  /* Three states, three sentences: the marks read now; the chain not read now; the chain read and its facts refusing. */
  const lockUnread = token.receiptProblems.includes(RECEIPT_LOCK_UNREAD);
  const exitUnread = token.receiptProblems.includes(RECEIPT_EXIT_UNREAD);
  const partial = receipt !== null && token.receiptProblems.some((problem) => problem !== RECEIPT_LOCK_UNREAD && problem !== RECEIPT_EXIT_UNREAD);
  return (
    <Block title={word("marks")} titleAs="h2" lang={locale === "uk" ? "uk" : "en"} id="launch-marks">
      <div className={styles.blockBar}>{/* Every mark here is a program's rule — said once, in words, as «Здоров'я ринку» marks its rules and policies. */}
        {receipt ? (
          <span className={styles.enforceChip} data-enforcement="rule" title={word("marksRulesHint")}>
            {word("marksRules")}
          </span>
        ) : null}</div>
      <p className={styles.cellSub}>{word("proofLede")}</p>
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
                <span className={styles.markText}>{word(markWord(mark, receipt, partners), markValues(mark, receipt, locale))}</span>
                <a className={styles.markLink} href={explorerUrl(token.network, "account", mark.account)} target="_blank" rel="noreferrer noopener">
                  {word("view")} <ArrowSquareOut size={14} aria-hidden />
                </a>
              </li>
            ))}
        </ul>
      ) : (
        <p className={styles.unread}>{word(receiptRefusedByRules(token.receiptProblems) ? "marksRefused" : "marksUnread")}</p>
      )}
      {receipt && lockUnread ? <p className={styles.unread}>{word("marksLockUnread")}</p> : null}
      {receipt && exitUnread && !marks.some((mark) => mark.code === "LP_LOCKED_FOREVER") ? <p className={styles.unread}>{word("marksExitUnread")}</p> : null}
      {partial ? <p className={styles.unread}>{word("marksImmutableOnly")}</p> : null}
      <ProofRows
        network={token.network}
        token={token.token}
        creator={token.creator}
        creation={token.signature}
        preset={token.preset}
        pair={pair ? { symbol: pair.symbol, decimals: pair.decimals } : null}
        receipt={proofReceipt(receipt, partners)}
        lockUnread={lockUnread}
        exitUnread={exitUnread}
        locale={locale}
        advanced={token.advanced?.terms ?? null}
      />
      {/* «Комісія за переказ» (SOL-L10): the withheld cycle and the RevokeZeroFee timeline, read from the chain. */}
      {receipt?.transferFee ? <TransferFeePanel token={token.token} symbol={token.symbol} locale={locale} network={token.network} /> : null}
      {receipt ? (
        <p className={styles.marksChecked}>
          {word("marksChecked", { ago: checkedAgo(word, receipt.observedAt) })}
        </p>
      ) : null}
    </Block>
  );
}

/** The launch receipt as the proof reads it: its accounts, its marks, the creator's buy and lock, the curve and the DEX pool's positions by whose share. */
function proofReceipt(receipt: LaunchTokenResponse["receipt"], partners: ReadonlySet<string>): ProofInput["receipt"] {
  if (!receipt) return null;
  return {
    config: receipt.config,
    curve: receipt.pool,
    supplyRaw: receipt.token2022.supplyRaw,
    decimals: receipt.token2022.decimals,
    marks: receipt.marks,
    transferFeeBps: receipt.transferFee?.bps ?? null,
    curveRules: receipt.curveRules ?? null,
    creatorFirstBuy: receipt.creatorFirstBuy ? { quoteInRaw: receipt.creatorFirstBuy.quoteInRaw, tokensOutRaw: receipt.creatorFirstBuy.tokensOutRaw } : null,
    creatorLock: receipt.creatorLock ? { escrow: receipt.creatorLock.escrow, cliffAt: receipt.creatorLock.cliffAt, endsAt: receipt.creatorLock.endsAt } : null,
    migrated: receipt.curve.migrated,
    progressBps: receipt.curve.progressBps,
    thresholdRaw: receipt.curve.migrationQuoteThresholdRaw,
    graduated: receipt.graduated
      ? {
          pool: receipt.graduated.pool,
          positions: receipt.graduated.positions.map((position) => {
            const word = markWord({ code: "LP_LOCKED_FOREVER", account: position.position }, receipt, partners);
            return { position: position.position, owner: word === "mark_LP_LOCKED_FOREVER_creator" ? ("creator" as const) : word === "mark_LP_LOCKED_FOREVER_partner" ? ("partner" as const) : ("other" as const) };
          }),
        }
      : null,
  };
}

/** How long ago the chain was read for these marks — a person's own clock is not the server's, so never a time of day. */
function checkedAgo(word: ReturnType<typeof launchWords>, observedAt: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(observedAt)) / 60_000);
  return minutes < 1 ? word("justNow") : word("ago", { time: word("min", { n: minutes }) });
}

/** A locked position of the graduated pool is named by its owner: the creator's, or Ryntra's as the config's partner. */
/** The figures a mark's sentence puts in: the transfer fee's rate, the rules a token's hook keeps. */
function markValues(mark: { code: string }, receipt: NonNullable<LaunchTokenResponse["receipt"]>, locale: WorkspaceLocale): Record<string, string> | undefined {
  if (mark.code === "TRANSFER_FEE_UNTIL_DEX") return { pct: formatBps(receipt.transferFee?.bps ?? 0, locale) };
  if (mark.code === "CURVE_RULES_UNTIL_DEX") return { rules: curveRuleNames((receipt.curveRules?.rules ?? []).join(","), launchWords(locale)) };
  return undefined;
}

function markWord(mark: { code: string; account: string }, receipt: NonNullable<LaunchTokenResponse["receipt"]>, partners: ReadonlySet<string>): LaunchWordKey {
  if (mark.code !== "LP_LOCKED_FOREVER") return `mark_${mark.code}` as LaunchWordKey;
  const owner = receipt.graduated?.positions.find((position) => position.position === mark.account)?.owner;
  /* With «Спільнота» the creator's exit position is the vault's that shares their fees: still the creator's share. */
  const creatorRoles = new Set([receipt.creator, ...(receipt.feeSharing ? [receipt.feeSharing.vault] : [])]);
  /* An exit NFT someone else holds now is neither's share by name: the liquidity is still locked for ever, said plainly. */
  if (owner === undefined) return "mark_LP_LOCKED_FOREVER";
  return creatorRoles.has(owner) ? "mark_LP_LOCKED_FOREVER_creator" : partners.has(owner) ? "mark_LP_LOCKED_FOREVER_partner" : "mark_LP_LOCKED_FOREVER";
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
    <Block title={word("about")} titleAs="h2" lang={locale === "uk" ? "uk" : "en"} id="launch-about">
      {token.description ? <p className={styles.description}>{token.description}</p> : null}
      {links.length ? (
        <>
          <div className={styles.linkList}>
            {links.map((link) => (
              <LinkButton key={link.label} href={link.href} external>
                {link.icon}
                {link.label}
              </LinkButton>
            ))}
          </div>
          <p className={styles.hint}>{word("linksByCreator")}</p>
        </>
      ) : null}
    </Block>
  );
}

function Receipt({ token, locale, pairSymbol }: { token: LaunchTokenResponse; locale: WorkspaceLocale; pairSymbol: string }) {
  const word = launchWords(locale);
  const receipt = token.receipt;
  return (
    <Block title={word("receipt")} titleAs="h2" icon="receipt" lang={locale === "uk" ? "uk" : "en"} id="launch-receipt">
      <details className={styles.details} open={false}>
        <summary className={styles.summary}>
          {word("receiptOpen")} <CaretDown size={14} aria-hidden className={styles.caret} />
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
                    /* «Розширений»: the cap its own terms named, of its own supply — the amount and the share say one thing. */
                    cap: formatRaw(token.advanced ? ((BigInt(token.advanced.terms.supply) * 1_000_000n * BigInt(token.advanced.terms.firstBuyCapBps)) / 10_000n).toString() : receipt.creatorFirstBuy.capRaw, 6, locale, 0),
                    pct: formatBps(token.advanced?.terms.firstBuyCapBps ?? launchPreset(token.preset)?.creatorFirstBuyCapBps ?? 0, locale),
                  })
                : receipt
                  ? word("receiptNone")
                  : word("receiptUnread")
            }
          />
          {/* «None» only from a receipt read: a chain not read now is said as such, never as a fact of absence (UX-404). */}
          <Row label={word("receiptLock")} value={receipt?.creatorLock ? <Explorer network={token.network} kind="account" id={receipt.creatorLock.escrow} /> : receipt && !token.receiptProblems.includes(RECEIPT_LOCK_UNREAD) ? word("receiptNone") : word("receiptUnread")} />
          {token.storage ? <Row label={word("receiptMetadata")} value={<Stored file={token.storage.metadata} kind="metadata" locale={locale} />} /> : null}
          {token.storage?.image ? <Row label={word("receiptImage")} value={<Stored file={token.storage.image} kind="image" locale={locale} />} /> : null}
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
        {token.storage ? <p className={styles.hint}>{word("storageHint")}</p> : null}
      </details>
    </Block>
  );
}

/**
 * A file Ryntra keeps for the launch (SOL-L3): its IPFS copy once pinned, and always Ryntra's copy by the sha256 the
 * mint names — the same bytes' IPFS address, so any copy can be checked against it.
 */
function Stored({ file, kind, locale }: { file: NonNullable<LaunchTokenResponse["storage"]>["metadata"]; kind: "metadata" | "image"; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  return (
    <span className={styles.storedFile}>
      {file.ipfs ? (
        <a className={`${styles.markLink} ${styles.addr}`} href={file.ipfs.url} target="_blank" rel="noreferrer noopener" title={file.cid}>
          {word("storageIpfs")} · {file.cid.slice(0, 10)}… <ArrowSquareOut size={12} aria-hidden />
        </a>
      ) : (
        <span className={styles.cellSub}>{word("storageNotPinned")}</span>
      )}
      <a className={`${styles.markLink} ${styles.addr}`} href={`/api/launch/${kind}/${file.sha256}`} target="_blank" rel="noreferrer noopener" title={file.sha256}>
        {word("storageRyntra")} · sha256 {file.sha256.slice(0, 8)}… <ArrowSquareOut size={12} aria-hidden />
      </a>
    </span>
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

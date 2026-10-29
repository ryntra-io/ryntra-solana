import { ArrowSquareOut, Gift, Warning } from "@phosphor-icons/react/dist/ssr";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchTokenResponse } from "@/lib/api/v1/contract";
import { advancedPrices, SNIPER_FEES } from "@/lib/core/launch/advanced";
import { boostRuleLines } from "@/lib/core/launch/boost";
import type { BoostCampaign } from "@/lib/launch/boost.server";

import { Block } from "../launch-core";
import { explorerUrl, formatBps, formatNumber, formatPrice } from "../launch-format";
import { launchWords, type LaunchWordKey } from "../launch-words";
import styles from "../launch.module.css";

/**
 * The formats of «Розширені параметри» on a token's page (SOL-L5): the creator's bonus for buyers (Launch Boost), read
 * before a purchase — its rules as the creator set them and where its budget is locked —, and «Розширений»'s own numbers
 * with what makes its tokenomics unusual. Both from the launch's own records; the chain's word is a link away.
 */

/** Launch Boost above the action: the rules, the budget's escrow, and the campaign's state. Nothing when there is no campaign. */
export function BoostOffer({
  campaign,
  network,
  locale,
  units,
}: {
  campaign: BoostCampaign | null;
  network: LaunchTokenResponse["network"];
  locale: WorkspaceLocale;
  units: Readonly<{ symbol: string; decimals: number; pairSymbol: string; pairDecimals: number; dollar: boolean }>;
}) {
  if (!campaign) return null;
  const word = launchWords(locale);
  const state = campaign.commitment.state;
  /* Purchases count from when the rules were first shown — the campaign's own start, never earlier. */
  const lines = boostRuleLines({ ...campaign.rules, startsAt: campaign.countsFrom }, units, locale);
  const paid = new Set(campaign.payouts.filter((tx) => tx.state === "CONFIRMED").flatMap((tx) => tx.wallets)).size;
  return (
    <Block title={word("boostTitle")} titleAs="h2" lang={locale === "uk" ? "uk" : "en"} id="launch-boost" className={styles.boostCard}>
      <div className={styles.blockBar}>
        <span className={styles.chip} data-state={state}>
          {state === "FAILED" ? <Warning size={14} aria-hidden /> : <Gift size={14} aria-hidden />} {word(`boostState_${state}` as LaunchWordKey)}
        </span>
      </div>
      {state === "FAILED" ? (
        <p className={styles.unread}>{word("boostNotSigned")}</p>
      ) : state === "PENDING" ? (
        /* The budget not seen on the chain yet: no rule is said as if it were locked. */
        <p className={styles.unread}>{word("boostState_PENDING")}</p>
      ) : (
        <>
          {/* The block names itself «Бонус від творця»: the rules' first line starts after that name. */}
          <p className={styles.boostLead}>{lines[0]?.replace(/^(Бонус від творця|Creator's bonus): /, "")}</p>
          <ul className={styles.boostLines}>
            {lines.slice(1).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className={styles.hint}>{word("boostCashbackApart")}</p>
          <a className={styles.markLink} href={explorerUrl(network, "account", campaign.escrow)} target="_blank" rel="noreferrer noopener">
            {word("boostEscrow")} <ArrowSquareOut size={14} aria-hidden />
          </a>
          {paid > 0 ? <p className={styles.cellSub}>{word("boostPaid", { n: paid })}</p> : null}
        </>
      )}
    </Block>
  );
}

/** «Розширений»'s numbers — the creator's, fixed in the token's own config — and «Незвична токеноміка» with each reason. */
export function AdvancedTerms({ advanced, locale }: { advanced: NonNullable<LaunchTokenResponse["advanced"]>; locale: WorkspaceLocale }) {
  const word = launchWords(locale);
  const { terms, unusual } = advanced;
  const prices = advancedPrices(terms);
  const money = (usd: number) => `$${formatNumber(usd, locale)}`;
  return (
    <Block title={word("advancedBlock")} titleAs="h2" lang={locale === "uk" ? "uk" : "en"} id="launch-advanced">
      <p className={styles.cellSub}>{word("advancedBlockLede")}</p>
      {unusual.length ? (
        <div className={styles.unusual} role="note">
          <p className={styles.unusualTitle}>
            <Warning size={16} weight="fill" aria-hidden /> {word("unusualTitle")}
          </p>
          <ul>
            {unusual.map((reason) => (
              <li key={reason}>{word(`unusual_${reason}` as LaunchWordKey)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className={styles.rows}>
        <Row label={word("advancedRowSupply")} value={formatNumber(terms.supply, locale)} />
        <Row
          label={word("advancedRowCurve")}
          value={`${money(terms.startMarketCapUsd)} → ${money(terms.graduationMarketCapUsd)} · ${word("advancedPrices", { start: `$${formatPrice(prices.startPriceUsd, locale).text}`, dex: `$${formatPrice(prices.graduationPriceUsd, locale).text}`, multiple: formatNumber(prices.multiple, locale, 1) })}`}
        />
        <Row label={word("advancedRowShare")} value={formatBps(terms.creatorTradingFeePct * 100, locale)} />
        <Row label={word("advancedRowSniper")} value={word(`advancedSniper_${terms.sniper}`, { start: formatBps(SNIPER_FEES[terms.sniper].startBps, locale) })} />
        <Row label={word("advancedRowPool")} value={`${formatBps(terms.poolStartFeeBps, locale)} → ${formatBps(terms.poolEndFeeBps, locale)}`} />
        <Row label={word("advancedRowGraduation")} value={word("advancedGraduationValue", { pct: formatBps(Math.round(terms.graduationFee.pct * 100), locale), creator: formatBps(terms.graduationFee.creatorPct * 100, locale) })} />
        <Row label={word("advancedRowCap")} value={word("presetFirstBuyValue", { pct: formatBps(terms.firstBuyCapBps, locale) })} />
      </dl>
    </Block>
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

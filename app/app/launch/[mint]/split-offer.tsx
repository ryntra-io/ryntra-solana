import { ArrowSquareOut, UsersThree } from "@phosphor-icons/react/dist/ssr";

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchSplitView, LaunchTokenResponse } from "@/lib/api/v1/contract";
import { SPLIT_GIVEN, splitShareLine } from "@/lib/core/launch/creator-split";
import { inForce, splitOfferLines, type CreatorSplitRecord } from "@/lib/launch/creator-split.server";

import { Block } from "../launch-core";
import { explorerUrl } from "../launch-format";
import { exact } from "../mine/cabinet-figures";
import styles from "../launch.module.css";
import { splitWords } from "../mine/split-words";

/**
 * «Частка творця» above the action on a token's page (SOL-L2b): the creator's division of their own share, read before a
 * purchase — the rule in force and what each given part does, what it owes and what the creator has done, with the
 * creator's signed rule a link away. `view` is the split read within the page's budget (a rule on its way settled from
 * the chain); when that read did not come in time, `stored` — the split's own record — gives the rule without figures.
 * Nothing when the creator has not divided their share.
 */
export function SplitOffer({ view, stored, network, locale }: { view: LaunchSplitView | null; stored: CreatorSplitRecord | null; network: LaunchTokenResponse["network"]; locale: WorkspaceLocale }) {
  const word = splitWords(locale);
  const rule = view ? view.rule : (inForce(stored ?? { segments: [] }).at(-1)?.rule ?? null);
  const lines = view ? view.lines[locale] : splitOfferLines(stored, locale);
  const pending = view ? view.pendingRule !== null : Boolean(stored?.segments.some((segment) => segment.state === "PENDING"));
  if (!rule && !pending) return null;
  const signed = view ? (view.segments.at(-1)?.signature ?? null) : (inForce(stored ?? { segments: [] }).at(-1)?.signature ?? null);
  const pair = view?.pair ?? (stored ? { mint: stored.pair.mint, decimals: stored.pair.decimals, symbol: stored.pair.symbol, dollar: stored.pair.dollar } : null);
  const money = (raw: string) => (pair ? exact(raw, pair, locale) : raw);
  const ledger = view?.ledger ?? null;
  return (
    <Block title={word("offerTitle")} titleAs="h2" lang={locale === "uk" ? "uk" : "en"} id="launch-split" className={styles.boostCard}>
      {rule ? (
        <>
          <p className={styles.boostLead}>
            <UsersThree size={14} aria-hidden /> {splitShareLine(rule, locale)}
          </p>
          <ul className={styles.boostLines}>
            {lines.slice(1).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <dl className={styles.rows}>
            {SPLIT_GIVEN.filter((bucket) => rule.shares[bucket] > 0).map((bucket) => (
              <div key={bucket} className={styles.row}>
                <dt>{word(`bucket_${bucket}`)}</dt>
                <dd>
                  {ledger ? (
                    <>
                      {word("ledgerDone", { done: money(ledger.done[bucket]) })}
                      <span className={styles.mineLeft}>{word("ledgerOwedLeft", { due: money(ledger.due[bucket]), left: money(ledger.owed[bucket]) })}</span>
                    </>
                  ) : (
                    <span className={styles.statUnread}>{word("ledgerUnread")}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {(ledger?.warnings ?? []).map((warning) => (
            <p key={warning} className={styles.unread}>
              {word(`warn_${warning}`)}
            </p>
          ))}
          {signed ? (
            <a className={styles.markLink} href={explorerUrl(network, "tx", signed)} target="_blank" rel="noreferrer noopener">
              {word("ruleTx")} <ArrowSquareOut size={14} aria-hidden />
            </a>
          ) : null}
        </>
      ) : null}
      {pending ? <p className={styles.unread}>{word("offerPending")}</p> : null}
    </Block>
  );
}

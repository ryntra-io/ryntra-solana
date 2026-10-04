import Link from "next/link";

import { ArrowMark } from "@/app/components/mark";
import { environmentChip } from "../hub/environment.ts";
import { localizedSolanaMapGroups, localizedSolanaModules } from "../hub/modules.ts";
import { PageHead } from "../hub/parts.tsx";
import { solanaServerText } from "../i18n/server.ts";
import styles from "./map.module.css";

export const metadata = { title: "Hub Map" };

/**
 * The Solana Hub Map.
 *
 * The whole registered architecture, with each module's real state and the
 * exact condition it waits on. This is where unbuilt capability lives so the
 * rail can stay honest: a routed entry exists, a gate-named entry names its
 * gate, and everything else is described here — never rendered as a feature
 * someone forgot to finish.
 *
 * ## What changed, and what deliberately did not
 *
 * Every sentence the registry holds is still on this page. What moved is
 * *when* a reader meets it. The page used to print, at rest, a purpose line, a
 * detail paragraph and a four-row Exists / Missing / Gate / Last verified table
 * for each of sixteen modules, then two legends defining nine more words —
 * around eleven paragraphs of registry prose before anything could be scanned.
 * That is an architecture document rendered as a product screen: a wall of
 * text, where a reader came for a map.
 *
 * So the resting page is a map: group, name, state, and the way in. The prose
 * is one disclosure deep, which is where PRODUCT.md has always put proof —
 * *"the homepage and product pages carry no hash walls, no internal registry
 * keys, no repeated disclaimer paragraphs. Full evidence lives on dedicated
 * pages — always reachable, never shouted."* Reachability is the honesty
 * requirement; printing it all at once was never the same thing.
 *
 * The legend collapsed with it. The previous note here argued a legend a reader
 * must open is a legend that does not work — true of a legend for symbols, and
 * false for this one, whose terms are `Available`, `Preview`, `Planned` and
 * `Gated`. Those are ordinary English words doing ordinary work; the legend
 * adds precision for a reader who wants it, and costs nine paragraphs to
 * everyone who does not.
 *
 * It still flows down the page as a document rather than living inside a
 * fixed-height panel; an earlier hub once rendered 6,118px of map into a 672px
 * scroller and that defect is not worth repeating.
 *
 * These are Solana's own styles rather than the shared `sh-map-*` chrome,
 * because Stellar still renders the older card and rebuilding its
 * screens is not this task.
 */
export default async function SolanaHubMapPage() {
  const { locale, text } = await solanaServerText();
  const modules = localizedSolanaModules(locale);
  const groups = localizedSolanaMapGroups(locale);
  const built = modules.filter((entry) => entry.route !== null).length;
  const lead =
    locale === "uk"
      ? `${modules.length} модулів · ${built} можна відкрити.`
      : `${modules.length} modules · ${built} you can open.`;
  /* The registry keeps `OWNER_CANARY_VERIFIED` — it is the only maturity word
     in this repository backed by a signed mainnet transaction, and deleting it
     would make the product prove less. But a canary is an internal instrument,
     and a person opening this page is not reading about our test programme;
     they are asking whether the thing works. So the evidence word stays in the
     data and in the receipts, and the screen says what a reader actually needs:
     it is available. */
  const maturityLabel = (value: string) => {
    const shown = value === "OWNER_CANARY_VERIFIED" ? "AVAILABLE" : value;
    const english = shown.replace(/_/g, " ").toLowerCase().replace(/^./, (first) => first.toUpperCase());
    return locale === "uk" ? text(english) : english;
  };

  return (
    <>
      <PageHead title="Solana Hub Map" lead={<p className={styles.lead}>{lead}</p>} />

      {groups.map((zone) => {
        const rows = modules.filter((entry) => entry.group === zone.group);
        if (rows.length === 0) return null;
        return (
          <section className={styles.group} key={zone.group}>
            <h2 className={styles.title}>{zone.title}</h2>
            <ul className={styles.list}>
              {rows.map((entry) => (
                <li className={styles.tile} key={entry.id}>
                  <span className={styles.head}>
                    <span className={styles.name}>{entry.label}</span>
                    <span className="so-mat" data-maturity={entry.maturity}>
                      {/* Every underscore, not the first: `OWNER_CANARY_VERIFIED`
                          rendered as "OWNER CANARY_VERIFIED" while a single
                          replace was enough for every word the registry had
                          when it was written. */}
                      {maturityLabel(entry.maturity)}
                    </span>
                  </span>

                  {entry.route ? (
                    <Link className={styles.open} href={entry.route}>
                      {text("Open")}
                      <ArrowMark size={12} />
                    </Link>
                  ) : null}

                  <details className={styles.more}>
                    <summary className={styles.summary}>{text("Details")}</summary>
                    <div className={styles.body}>
                      <span className="sh-map-env" data-env={entry.environment} data-mode={entry.mode}>
                        {text(environmentChip(entry.environment, entry.mode))}
                      </span>
                      <p className={styles.purpose}>{entry.purpose}</p>
                      <p className={styles.detail}>{entry.detail}</p>
                      <dl className={styles.facts}>
                        <div className={styles.fact}>
                          <dt>{text("Exists")}</dt>
                          <dd>{entry.exists}</dd>
                        </div>
                        <div className={styles.fact}>
                          <dt>{text("Missing")}</dt>
                          <dd>{entry.missing}</dd>
                        </div>
                        <div className={styles.fact}>
                          <dt>{text("Gate")}</dt>
                          <dd>{entry.gate}</dd>
                        </div>
                        <div className={styles.fact}>
                          <dt>{text("Last verified")}</dt>
                          <dd>
                            {entry.lastVerifiedAt === null ? (
                              text("Never — nothing to verify yet.")
                            ) : (
                              <span translate="no">{entry.lastVerifiedAt}</span>
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className={styles.group}>
        <details className={styles.more}>
          <summary className={styles.summary}>{text("What the words on this page mean")}</summary>
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>{text("Available")}</dt>
              <dd>{text("A real, working thing today. Some of these only read; others move money, and always with your own wallet — the line beside the name says which.")}</dd>
            </div>
            <div className={styles.fact}>
              <dt>{text("Preview")}</dt>
              <dd>{text("Built enough to open, not proven against a live source.")}</dd>
            </div>
            <div className={styles.fact}>
              <dt>{text("In build")}</dt>
              <dd>{text("Active work with a registered task.")}</dd>
            </div>
            <div className={styles.fact}>
              <dt>{text("Planned")}</dt>
              <dd>{text("An accepted direction with no active work.")}</dd>
            </div>
            <div className={styles.fact}>
              <dt>{text("Gated")}</dt>
              <dd>{text("Blocked on a named condition, stated on the card.")}</dd>
            </div>
            <div className={styles.fact}>
              <dt>{text("Mainnet · read only")}</dt>
              <dd>{text("Real mints and ledger state. Moves nothing and needs no wallet.")}</dd>
            </div>
            <div className={styles.fact}>
              <dt>{text("Mainnet · user-signed")}</dt>
              <dd>
                {text("Prepares an action the owner signs in their own wallet. It says what the surface is for, never that anything has been signed — the state word beside it carries that.")}
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>{text("Workspace")}</dt>
              <dd>{text("Touches no network — preferences, documentation, this map.")}</dd>
            </div>
          </dl>
        </details>
      </section>
    </>
  );
}

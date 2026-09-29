import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FrozenFooter, FrozenHeader } from "@/app/site/frozen/chrome";
import { sitePageMetadata } from "@/app/site/seo";
import { fetchRawMintAccount } from "@/lib/solana/mint";
import { buildPassport } from "@/lib/solana/passport";
import { createSolanaRpcHandle } from "@/lib/solana/rpc";
import { publicServerLocale } from "@/lib/site/server-locale";
import { passportCopy } from "@/lib/site/passport-copy";

import { SharePassport } from "./share";

import styles from "@/app/product/product.module.css";

export const revalidate = 300;

const MINT_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * `/assets/:mint` — the shareable Asset Passport, at the address it should
 * always have had.
 *
 * The Passport has been readable since `RYN-SOL-A1`, and only ever from inside
 * a workspace at `/solana/workspace/assets?mint=…` — a URL that says which
 * *application* you are in to a person who was sent a link about a *token*.
 * The owner's decision of 2026-09-04 gives it the canonical address, and that
 * URL is now what the metadata, the share control and every card on the public
 * site point at.
 *
 * The in-product page is untouched and keeps working: it is reached from a
 * Portfolio row and from the Markets table, where being inside the product is
 * the point. Both emit the same canonical, so a crawler and a person who pastes
 * either one end up describing the same page.
 *
 * ## What it will not do
 *
 * Ask for anything. No account, no wallet, no connection. Every fact here is a
 * public byte from a mint account, decoded on this visit, and the page states
 * the provenance of each one rather than presenting a verdict. There is no
 * score, and the word `safe` appears nowhere: an extension that can freeze a
 * balance is reported as an extension that can freeze a balance.
 */
async function readPassport(mint: string) {
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 8_000, retries: 1 });
  const raw = await fetchRawMintAccount(handle, mint);
  if ("ok" in raw) return null;
  const built = buildPassport(raw);
  return built.ok ? built.passport : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mint: string }>;
}): Promise<Metadata> {
  const { mint } = await params;
  if (!MINT_SHAPE.test(mint)) return sitePageMetadata({
    path: "/assets",
    title: "Asset Passport — Ryntra",
    description: "Read any Solana mainnet mint: identity, issuer powers, transfer rules and what is not known.",
  });

  const short = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  return sitePageMetadata({
    path: `/assets/${mint}`,
    title: `${short} — Asset Passport | Ryntra`,
    description:
      "Identity, issuer powers and transfer rules for this Solana mint, read from the chain on the visit. No account, no wallet.",
  });
}

export default async function PublicAssetPassportPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  if (!MINT_SHAPE.test(mint)) notFound();

  const locale = await publicServerLocale();
  const copy = passportCopy(locale);
  const passport = await readPassport(mint);
  const short = `${mint.slice(0, 4)}…${mint.slice(-4)}`;

  return (
    <>
      <FrozenHeader mainId="main-content" />

      <main id="main-content" className={styles.page} tabIndex={-1}>
        <section className={styles.band}>
          <div className={styles.wrap}>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h1 className={styles.title}>
              <span translate="no">{short}</span>
            </h1>
            <p className={styles.lead}>{copy.lead}</p>
            <p className={styles.shotCaption} translate="no">
              {mint}
            </p>
            <div className={styles.actions}>
              <Link className={styles.primary} href={`/solana/workspace/assets?mint=${mint}`}>
                {copy.openInProduct}
              </Link>
              <SharePassport
                url={`https://ryntra.io/assets/${mint}`}
                label={copy.share}
                copied={copy.shareCopied}
              />
              <Link className={styles.ghost} href="/product">
                {copy.aboutProduct}
              </Link>
            </div>
          </div>
        </section>

        {passport === null ? (
          <section className={`${styles.band} ${styles.bandAlt}`}>
            <div className={styles.wrap}>
              <h2 className={styles.bandTitle}>{copy.unreadTitle}</h2>
              <p className={styles.bandLead}>{copy.unreadBody}</p>
            </div>
          </section>
        ) : (
          <>
            <section className={`${styles.band} ${styles.bandAlt}`}>
              <div className={styles.wrap}>
                <h2 className={styles.bandTitle}>{copy.powersTitle}</h2>
                <p className={styles.bandLead}>{copy.powersLead}</p>
                <div className={styles.features}>
                  <div className={styles.feature}>
                    <h3 className={styles.featureName}>{copy.canMint}</h3>
                    <p className={styles.featureBody}>
                      {passport.identity.mintAuthority.value === null ? copy.no : copy.yes}
                    </p>
                    <p className={styles.cardBody}>{passport.identity.mintAuthority.meaning}</p>
                  </div>
                  <div className={styles.feature}>
                    <h3 className={styles.featureName}>{copy.canFreeze}</h3>
                    <p className={styles.featureBody}>
                      {passport.identity.freezeAuthority.value === null ? copy.no : copy.yes}
                    </p>
                    <p className={styles.cardBody}>{passport.identity.freezeAuthority.meaning}</p>
                  </div>
                  <div className={styles.feature}>
                    <h3 className={styles.featureName}>{copy.program}</h3>
                    <p className={styles.featureBody} translate="no">
                      {passport.identity.programKind === "TOKEN_2022" ? "Token-2022" : "SPL Token"}
                    </p>
                    <p className={styles.cardBody}>
                      {copy.decimals}: <span translate="no">{passport.identity.decimals.value}</span>
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className={styles.band}>
              <div className={styles.wrap}>
                <h2 className={styles.bandTitle}>{copy.rulesTitle}</h2>
                <p className={styles.bandLead}>
                  {passport.extensions.length === 0 ? copy.rulesNone : copy.rulesLead}
                </p>
                {passport.extensions.length > 0 ? (
                  <div className={styles.cards}>
                    {passport.extensions.map((extension) => (
                      <div className={styles.card} key={extension.kind}>
                        <div className={styles.cardHead}>
                          <h3 className={styles.cardName} translate="no">
                            {extension.kind}
                          </h3>
                          {extension.affectsTransfers ? (
                            <span className={styles.chip} data-label="LIMITED">
                              {copy.affectsTransfers}
                            </span>
                          ) : null}
                        </div>
                        <p className={styles.cardBody}>{extension.meaning}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>

            <section className={`${styles.band} ${styles.bandAlt}`}>
              <div className={styles.wrap}>
                <h2 className={styles.bandTitle}>{copy.knowingTitle}</h2>
                <p className={styles.bandLead}>{copy.knowingLead}</p>
                <div className={styles.facts}>
                  <span className={styles.fact} translate="no">
                    {copy.readAt}: {passport.observedAt.slice(0, 19).replace("T", " ")} UTC
                  </span>
                  <span className={styles.fact}>{copy.network}</span>
                  {passport.unsupportedKinds.length > 0 ? (
                    <span className={styles.fact}>
                      {copy.undecodable}: <span translate="no">{passport.unsupportedKinds.length}</span>
                    </span>
                  ) : null}
                </div>
                <div className={styles.actions}>
                  <Link className={styles.primary} href="/solana/workspace/markets">
                    {copy.seeMarkets}
                  </Link>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      <FrozenFooter />
    </>
  );
}

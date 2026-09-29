import Link from "next/link";
import { redirect } from "next/navigation";

import { AlertStrip, Panel, PanelGrid } from "@/app/shell/panel";
import { InfoControl } from "@/app/shell/info-control";
import { parseAsset } from "@/lib/stellar/asset";
import { PageHead } from "../hub/parts.tsx";
import { FEATURED_ASSETS, assetHref } from "./featured.ts";

export const metadata = { title: "Assets & RWA" };

/**
 * Find an asset by its exact identity.
 *
 * A server-side form rather than a client component: there is no state to hold
 * and nothing to do while typing, so shipping JavaScript for it would buy
 * nothing. It also means the search works before hydration and with scripting
 * off, which is the correct default for a page whose only job is to route.
 *
 * **A code alone is refused, deliberately.** Many different assets share a code
 * on Stellar, so resolving `USDC` would mean choosing one for the reader — the
 * single most damaging thing this surface could do quietly.
 *
 * The empty submission is handled before the parser rather than by it. It used
 * to fall through to `parseAsset`, whose `Empty asset identifier.` is an
 * accurate sentence written for a caller and a poor one for a person: the field
 * is called Asset identity on screen, nothing on the page uses the word
 * identifier, and a parser's vocabulary leaking into the interface is how a
 * product starts sounding like its own stack trace.
 */
async function findAsset(formData: FormData) {
  "use server";
  const raw = String(formData.get("asset") ?? "").trim();
  const fail = (message: string) =>
    redirect(`/stellar/workspace/assets?error=${encodeURIComponent(message)}`);

  if (!raw) fail("Enter an asset before opening a passport.");

  const parsed = parseAsset(raw);
  if (!parsed.ok) fail(parsed.reason);
  if (parsed.ok && (parsed.asset.native || !parsed.asset.issuer)) {
    fail("Enter an issued asset as CODE:ISSUER — a code on its own matches many different assets.");
  }
  if (parsed.ok && parsed.asset.issuer) {
    redirect(assetHref(`${parsed.asset.code}:${parsed.asset.issuer}`));
  }
}

export default async function StellarAssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <PageHead
        title="Assets & RWA"
        module="assets"
        lead="An asset on Stellar is a code together with its issuer. Enter both, or start from one below — a code on its own matches many different assets, so this surface refuses it rather than choosing one for you."
      />

      <PanelGrid label="Assets & RWA">
        <Panel
          id="stellar-find"
          title="Find an asset"
          w={12}
          h={2}
          essential
          headerExtra={
            <InfoControl label="What counts as an identity">
              <p>
                An identity is <code>CODE:ISSUER</code> — the four-to-twelve character code together with the
                56-character <code>G…</code> account that issued it. A contract <code>C…</code> address also resolves.
                Nothing here reads a wallet or moves value.
              </p>
            </InfoControl>
          }
        >
          <form className="st-find" action={findAsset}>
            <div className="rw-field">
              <label htmlFor="asset-input">Asset identity</label>
              {/* `.rw-input` is the wrapper, not the control — the shared system
                  puts the border and the focus ring on it and leaves the input
                  itself bare, which is also what gives the field its 44px target
                  on a phone. Styling the input with it instead looks almost
                  right and silently loses both. */}
              <div className="rw-input">
                <input
                  id="asset-input"
                  name="asset"
                  placeholder="USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
                  aria-describedby={error ? "asset-error" : undefined}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
            </div>
            <button className="rw-btn rw-btn--primary" type="submit">
              Open passport
            </button>
          </form>
          {error ? (
            <div id="asset-error">
              <AlertStrip tone="warn">{error}</AlertStrip>
            </div>
          ) : null}
        </Panel>

        <Panel
          id="stellar-start"
          title="Real mainnet assets to start from"
          w={12}
          h={4}
          scroll
          badge="Not a ranking"
          tone="muted"
          headerExtra={
            <InfoControl label="How this list was chosen">
              <p>
                It exists because the only other way into a passport is to already know a 56-character issuer address.
                Every entry was resolved against Horizon on 13 August 2026, and each line states what the asset{" "}
                <strong>is</strong> — never whether it is good. A list that editorialises becomes a recommendation, and
                this product does not make those.
              </p>
            </InfoControl>
          }
        >
          <div className="rw-tablewrap">
            <table className="rw-table">
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col">What it is</th>
                  <th scope="col">Issuer</th>
                </tr>
              </thead>
              <tbody>
                {FEATURED_ASSETS.map((asset) => (
                  <tr key={asset.id}>
                    <th scope="row">
                      <Link className="st-asset" href={assetHref(asset.id)}>
                        <span className="st-code" translate="no">
                          {asset.code}
                        </span>
                      </Link>
                    </th>
                    <td>
                      <span className="st-note">{asset.note}</span>
                    </td>
                    <td>
                      <span className="st-domain" translate="no">
                        {asset.issuer}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </PanelGrid>
    </>
  );
}

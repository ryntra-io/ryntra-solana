import { PanelGrid } from "@/app/shell/panel";
import { PageHead } from "./hub/parts.tsx";
import { HomeSurface } from "./home-surface.tsx";
import { solanaServerText } from "./i18n/server.ts";

export const metadata = { title: "Home" };

/**
 * Home — the default start of Ryntra.
 *
 * This route used to be the Solana market overview, and that page has not been
 * deleted: it is `/app/markets`, where the Markets domain opens. The move
 * states one rule — the product's root is where a person's own money is, not
 * where a catalogue of mints is. Anyone who had bookmarked the root lands on
 * Home, which is the page they would have wanted from a product that has one.
 *
 * The composition is a client island because every fact on it is wallet-scoped
 * and read from the browser: holdings and activity are POSTs keyed by the
 * connected address, and neither endpoint reads a cookie. There is nothing to
 * render on the server that would not be a guess about whose wallet this is.
 */
export default async function SolanaHomePage() {
  /* The grid's label is an accessible name a screen reader speaks, so it is
     translated here on the server. The page title below is not: `PageHead` is a
     client component that translates its own title, and handing it a translated
     one made the fail-closed translator raise on its own output. */
  const { text } = await solanaServerText();

  return (
    <>
      {/* The English literal, not a translated one: `PageHead` is a client
          component and translates the title itself, so handing it Ukrainian
          made the fail-closed translator raise on its own output. */}
      <PageHead title="Home" />
      {/* Not `fill`: that stretches panels to the canvas and is for a page
          that is one panel. Home is three, and stretching them left a
          third of each panel as empty navy under its own content. */}
      <PanelGrid label={text("Home")}>
        <HomeSurface />
      </PanelGrid>
    </>
  );
}

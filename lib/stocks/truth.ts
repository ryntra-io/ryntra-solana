/**
 * The one line of truth about what a company's token is — said on the
 * company's page, before a purchase or a sale, and in «Перевірка»'s «Що це».
 * Pure and client-safe: the page and the server's «Перевірка» (`check.ts`,
 * contract 1.20.0) say it from the same function, so the web and the phone
 * read the same words.
 */

import type { StockIssuerId } from "./representations.ts";

type Lang = "en" | "uk";

/**
 * One line, from the issuer's documents, about what the person actually
 * buys (the help topics carry the long form). A listed company's token tracks
 * the share's price; a private company's token is not a share at all, and its
 * line leads with that — it stands before the figures on the page and in the
 * purchase. A PreStocks token's line says three things: not a share, the
 * issuer's fee on every transfer — the figure the chain states for the mint,
 * in `feeBps` — and that the issuer can freeze or take the token.
 */
export function truthLine(issuer: StockIssuerId, company: string, lang: Lang, feeBps: number | null = null): string {
  const uk = lang === "uk";
  switch (issuer) {
    case "xstocks":
      return uk ? `Токен, що відстежує ціну ${company} · забезпечений 1:1 · без голосу` : `A token that tracks the price of ${company} · backed 1:1 · no vote`;
    case "backpack":
      return uk ? `Токен, що відстежує ціну ${company} · обмін на акцію через Backpack · голосу поки немає` : `A token that tracks the price of ${company} · exchangeable for the share at Backpack · no vote yet`;
    case "ondo":
      return uk ? `Токен, що відстежує ціну й дивіденди ${company} · забезпечений · це не акція` : `A token that tracks the price and dividends of ${company} · backed · not a share`;
    case "prestocks": {
      const fee = feeBps !== null && Number.isFinite(feeBps) && feeBps > 0 ? `${new Intl.NumberFormat(uk ? "uk-UA" : "en-US", { maximumFractionDigits: 2 }).format(feeBps / 100)}%` : null;
      return uk
        ? `Це не акція ${company} · комісія емітента ${fee ? `${fee} ` : ""}на кожен переказ · емітент може заморозити чи забрати токен`
        : `Not a share in ${company} · ${fee ? `a ${fee} ` : "an "}issuer fee on every transfer · the issuer can freeze or take away the token`;
    }
  }
}

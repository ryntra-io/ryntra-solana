import { p, section, type DocPage } from "./model.ts";

/**
 * Команди, агенти й розробники — one short page, as the operator said on 24.10 («Команди, агенти й розробники — коротко
 * «скоро», без обіцянок»): the products for teams, agents and developers are set aside for now (registry §0.17,
 * «Відкладено словом власника 24.10»), so the documentation names them and promises nothing — no date, no feature.
 * The one page of the documentation allowed the word «soon»; `docs.test.mjs` holds every other page to what is built.
 */

export const SOON: DocPage = {
  slug: "soon",
  group: "developers",
  title: { en: "Teams, agents and developers", uk: "Команди, агенти й розробники" },
  summary: {
    en: "Ryntra for teams, for autonomous agents and for developers — soon. Today Ryntra is for people, with their own wallet.",
    uk: "Ryntra для команд, для автономних агентів і для розробників — скоро. Сьогодні Ryntra — для людей, з власним гаманцем.",
  },
  sections: [
    section("soon", "Soon", "Скоро", [
      p(
        "Teams, agents and developers — soon. Today everything this documentation describes is for a person with their own Solana wallet, and this page names no date and no feature ahead of time.",
        "Команди, агенти й розробники — скоро. Сьогодні все, що описує ця документація, — для людини з власним гаманцем Solana, і ця сторінка не називає наперед ні дат, ні функцій.",
      ),
    ]),
  ],
};

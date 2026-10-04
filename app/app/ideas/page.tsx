import { NotYet } from "../not-yet";

export const metadata = { title: "Ideas" };

/**
 * Ideas — where an analysis starts.
 *
 * The audit of 2026-09-08 found a research surface written and unreachable, and
 * reading it found the reason it should stay that way for now: its sources are
 * Arcus and Robinhood Chain, not Solana, and its records are scoped to an
 * account rather than to the connected wallet. Wiring it in would put another
 * venue's data inside a Solana-first product and file it under the wrong
 * person. So this page is the structure with the work still to do behind it,
 * and it says so.
 *
 * Ideas owns the stages **Research → Critic → Risk → strategy proposal**. They
 * are stages inside an idea — internal tools that never become rows of the
 * rail — and the proposal is what crosses into My strategies.
 */
export default function IdeasPage() {
  return (
    <NotYet
      page="ideas"
      en={{
        title: "Ideas",
        tagline: "Research → Critic → Risk → strategy proposal",
        purpose:
          "Keep what made you look — a note, a link, a piece of news, an asset — and put it through an analysis that ends in a decision.",
        holds: [
          "Your ideas with their source, asset, time and where each one stands",
          "Research: what was found about the asset, the market and the moment",
          "Critic: what was doubted, what does not hold, what is still unknown",
          "Risk: what the idea could cost, and the limits it must fit inside",
          "A proposal that becomes a linked strategy in My strategies — or a watch, a rejection, a request for data",
        ],
        instead: {
          hint: "Every asset already opens its own detail — issuer, authorities, what could still change your balance.",
          label: "Open Trends",
          href: "/app/trends",
        },
      }}
      uk={{
        title: "Ідеї",
        tagline: "Дослідження → Критика → Ризик → пропозиція стратегії",
        purpose:
          "Зберегти те, що змусило придивитися — нотатку, посилання, новину, актив — і провести це через аналіз, що закінчується рішенням.",
        holds: [
          "Твої ідеї з джерелом, активом, часом і станом кожної",
          "Дослідження: що знайдено про актив, ринок і момент",
          "Критика: що поставлено під сумнів, що не тримається, що досі невідоме",
          "Ризик: скільки ідея може коштувати і в які межі має вкластися",
          "Пропозиція стає пов'язаною стратегією в Моїх стратегіях — або спостереженням, відмовою чи запитом даних",
        ],
        instead: {
          hint: "Кожен актив уже відкриває власні деталі — емітент, повноваження, що ще може змінити твій баланс.",
          label: "Відкрити Тренди",
          href: "/app/trends",
        },
      }}
    />
  );
}

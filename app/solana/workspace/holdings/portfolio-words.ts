import type { WorkspaceLocale } from "../../../shell/locale.ts";

/** Portfolio's words for its pools, receipts and Rewards blocks (B5), in both languages. */
export type PortfolioWords = Readonly<{
  poolsTitle: string;
  phoenixTitle: string;
  phoenixOpen: string;
  receiptsTitle: string;
  receiptsAll: string;
  receiptsNone: string;
  receiptsUnread: string;
  receiptsPartly: string;
  what: string;
  when: string;
  rewardsTitle: string;
  rewardsOpen: string;
  rewardsReading: string;
  /** The rank and the window the points are counted over, in Rewards' own words: «Срібло · 30 днів». */
  rewardsRank: (rank: string, window: string) => string;
  retry: string;
  receiptsCaption: string;
  rewardsGathered: (dollars: string) => string;
  rewardsProof: string;
  rewardsUnread: string;
  rewardsPointsUnread: string;
}>;

const EN: PortfolioWords = {
  poolsTitle: "In pools",
  phoenixTitle: "On Phoenix",
  phoenixOpen: "Open Perps",
  receiptsTitle: "Receipts",
  receiptsAll: "View history",
  receiptsNone: "Receipts of your operations through Ryntra appear here.",
  receiptsUnread: "Your receipts could not be read just now.",
  receiptsPartly: "Not all of your history answered: some receipts may be missing.",
  what: "What",
  when: "When",
  rewardsTitle: "Rewards",
  rewardsOpen: "Open Rewards",
  rewardsReading: "Reading your points…",
  rewardsRank: (rank, window) => `${rank} · ${window}`,
  retry: "Try again",
  receiptsCaption: "Newest finished operations",
  rewardsGathered: (dollars) => `${dollars} gathered`,
  rewardsProof: "Sign in with wallet to see your rewards here.",
  rewardsUnread: "Rewards did not answer just now.",
  rewardsPointsUnread: "Your points are unavailable right now.",
};

const UK: PortfolioWords = {
  poolsTitle: "У пулах",
  phoenixTitle: "На Phoenix",
  phoenixOpen: "Відкрити Perps",
  receiptsTitle: "Квитанції",
  receiptsAll: "Уся історія",
  receiptsNone: "Тут з'являться квитанції твоїх операцій через Ryntra.",
  receiptsUnread: "Квитанції зараз не вдалося прочитати.",
  receiptsPartly: "Історія відповіла не вся: частини квитанцій може не бути.",
  what: "Що",
  when: "Коли",
  rewardsTitle: "Винагороди",
  rewardsOpen: "Відкрити Винагороди",
  rewardsReading: "Читаю твої очки…",
  rewardsRank: (rank, window) => `${rank} · ${window}`,
  retry: "Спробувати знову",
  receiptsCaption: "Останні завершені операції",
  rewardsGathered: (dollars) => `Зібрано ${dollars}`,
  rewardsProof: "Увійди гаманцем — і тут з'являться твої винагороди.",
  rewardsUnread: "Винагороди зараз не відповіли.",
  rewardsPointsUnread: "Очки зараз недоступні.",
};

export function portfolioWords(locale: WorkspaceLocale): PortfolioWords {
  return locale === "uk" ? UK : EN;
}

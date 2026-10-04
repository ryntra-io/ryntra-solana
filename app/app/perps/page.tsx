import { NotYet } from "../not-yet";

export const metadata = { title: "Perps" };

/**
 * Perps — leveraged positions.
 *
 * A separate page because a collateralised position is not a held token, which
 * is the whole reason it is not folded into Spot. Nothing is built: Jupiter
 * Perps is a direction to verify, and naming it is not proof of an
 * integration, so no leverage ceiling, funding rate or liquidation figure is
 * promised here. The nearest thing that works is holding the asset itself.
 */
export default function PerpsPage() {
  return (
    <NotYet
      page="perps"
      en={{
        title: "Perps",
        purpose:
          "Open, watch and close a leveraged position, and always see where your collateral is.",
        holds: [
          "Market, side, collateral, leverage and the full size of the position",
          "Entry price, the liquidation estimate and what holding it costs",
          "Take-profit, stop-loss, partial close and full close",
          "One venue and one complete position cycle before a second is added",
        ],
        instead: {
          hint: "Holding the asset outright works today, and Portfolio shows where every part of your money sits.",
          label: "Open Portfolio",
          href: "/app/portfolio",
        },
      }}
      uk={{
        title: "Безстрокові",
        purpose:
          "Відкрити, контролювати й закрити позицію з плечем, завжди бачачи, де твоє забезпечення.",
        holds: [
          "Ринок, напрям, забезпечення, плече та повний розмір позиції",
          "Ціна входу, оцінка ліквідації та вартість утримання",
          "Take-profit, stop-loss, часткове й повне закриття",
          "Один майданчик і один повний цикл позиції, перш ніж з'явиться другий",
        ],
        instead: {
          hint: "Тримати актив напряму можна вже зараз, а Портфель показує, де саме лежить кожна частина коштів.",
          label: "Відкрити Портфель",
          href: "/app/portfolio",
        },
      }}
    />
  );
}

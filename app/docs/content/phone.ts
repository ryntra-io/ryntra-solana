import { facts, list, note, p, section, steps, type DocPage } from "./model.ts";

/**
 * Телефон — Ryntra for Android in the Solana dApp Store (line B, `apps/mobile`). Documented as the published release
 * holds it (1.15.1, approved 20.10; 1.16.0 is signed and not submitted — ST-9): the bar Home · Trading · Money ·
 * Portfolio · Menu, the menu's rows the phone has doors for, the wallet through Mobile Wallet Adapter. No version
 * number is written here, so the page stays true when the next release lands; what the phone does not have is said
 * plainly, without a date.
 */

export const PHONE: DocPage = {
  slug: "phone",
  group: "phone",
  title: { en: "Ryntra on the phone", uk: "Ryntra в телефоні" },
  seoTitle: { en: "Ryntra for Android and Seeker — Ryntra Docs", uk: "Ryntra для Android і Seeker — Документація Ryntra" },
  summary: {
    en: "Ryntra for Android in the Solana dApp Store — on Seeker and other Android phones — with your wallet through Mobile Wallet Adapter, and what it holds.",
    uk: "Ryntra для Android у Solana dApp Store — на Seeker та інших телефонах Android — з твоїм гаманцем через Mobile Wallet Adapter, і що в ньому є.",
  },
  sections: [
    section("get", "Getting the app", "Як встановити", [
      steps(
        [
          "Open the Solana dApp Store on your phone — it is built into Seeker — and find Ryntra.",
          "Install it and open it. Connect your wallet: the app asks it through Mobile Wallet Adapter, and the wallet shows the request.",
          "Sign in with your wallet when the app asks — a message signature that moves nothing — and your rules, rewards and notes follow you from the web.",
        ],
        [
          "Відкрий на телефоні Solana dApp Store — у Seeker він вбудований — і знайди Ryntra.",
          "Встанови й відкрий. Підключи гаманець: застосунок звертається до нього через Mobile Wallet Adapter, і гаманець показує запит.",
          "Увійди гаманцем, коли застосунок попросить, — підпис повідомлення, що нічого не рухає, — і твої правила, винагороди й нотатки підуть за тобою з вебу.",
        ],
      ),
      facts(
        [
          ["Platform", "Android 7.0 or later; Seeker and other Android phones"],
          ["Where", "The Solana dApp Store"],
          ["Wallet", "Through Mobile Wallet Adapter; the keys stay in your wallet"],
          ["Network", "Solana Mainnet only"],
        ],
        [
          ["Платформа", "Android 7.0 і новіші; Seeker та інші телефони Android"],
          ["Де", "Solana dApp Store"],
          ["Гаманець", "Через Mobile Wallet Adapter; ключі лишаються в гаманці"],
          ["Мережа", "Лише Solana Mainnet"],
        ],
      ),
    ]),
    section("inside", "What is inside", "Що всередині", [
      p(
        "The bar at the bottom holds Home, Trading, Money, Portfolio and Menu; Menu opens the same menu as the web, with the rows the phone has: Swap, Markets with each asset's page and its orders, Launch with «My launches», Bots, the Ryntra assistant, Rewards, Portfolio, Add funds, Send, Receive and History. Between networks opens the web page.",
        "Бар унизу — Головна, Торгівля, Гроші, Портфель і Меню; «Меню» відкриває те саме меню, що й у вебі, з рядками, які є в телефоні: Обмін, Ринки зі сторінкою кожного активу та його ордерами, Лаунч із «Моїми лаунчами», Боти, Помічник Ryntra, Винагороди, Портфель, Поповнити, Надіслати, Отримати й Історія. «Між мережами» відкриває вебсторінку.",
      ),
      list(
        [
          "Every action goes through the same Review as on the web, and your wallet signs it on the phone.",
          "Perps, Predictions and Pools are on ryntra.io, not in the app — open ryntra.io in the phone's browser or your wallet's browser for them.",
          "The app holds no keys and no seed phrase, and never asks for them.",
        ],
        [
          "Кожна дія проходить ту саму «Перевірку», що й у вебі, і підписує її твій гаманець у телефоні.",
          "Perps, Прогнози й Пули — на ryntra.io, у застосунку їх немає: для них відкрий ryntra.io в браузері телефона чи в браузері свого гаманця.",
          "Застосунок не тримає ключів і сід-фрази й ніколи їх не просить.",
        ],
      ),
      note(
        "On the web on a phone, «Open in Phantom» or «Open in Solflare» reopens ryntra.io inside the wallet's own browser, so the wallet can connect.",
        "У вебі на телефоні «Відкрити в Phantom» чи «Відкрити в Solflare» відкриває ryntra.io у вбудованому браузері гаманця, щоб гаманець міг підключитися.",
      ),
    ]),
  ],
  related: ["start/wallet", "start/getting-started", "ryntra"],
};

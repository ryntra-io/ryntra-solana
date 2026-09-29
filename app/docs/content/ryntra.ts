import { list, note, p, section, type DocPage } from "./model.ts";

/**
 * Ryntra, the AI assistant — the menu's «Ryntra · ШІ-помічник» (canon v5.4
 * В30), documented once, in the words the canon holds it to (§5, B.1, B.12):
 * it explains and prepares; published rules compute and check; the person
 * decides and signs. What reaches the model's provider is stated plainly —
 * the question and the facts it needs, never the wallet's address, the
 * request not stored by the provider — and nothing it cannot do is dressed as
 * a feature. The name is Ryntra wherever a person reads: no «Ryn».
 */

export const ASSISTANT: DocPage = {
  slug: "ryntra",
  group: "ryntra",
  destination: "agent",
  title: { en: "Ryntra, the AI assistant", uk: "Ryntra — ШІ-помічник" },
  seoTitle: { en: "Ryntra, the AI assistant — Ryntra Docs", uk: "ШІ-помічник Ryntra — Документація Ryntra" },
  summary: {
    en: "Ask about a company, a price move or your portfolio. Ryntra answers with its sources and prepares a draft — it never buys, sells or signs for you.",
    uk: "Спитай про компанію, рух ціни чи свій портфель. Ryntra відповідає з джерелами й готує чернетку — але ніколи не купує, не продає й не підписує за тебе.",
  },
  sections: [
    section("ask", "What you can ask", "Що можна спитати", [
      list(
        [
          "Why a company's price is moving today — with the figures and where they come from.",
          "What a token actually is, and what its issuer can do with it.",
          "How your portfolio stands, and what happened with one of your plans.",
          "To prepare a draft — a plan, a rule or a purchase — that you change, sign or leave.",
        ],
        [
          "Чому ціна компанії рухається сьогодні — з цифрами і звідки вони.",
          "Що насправді таке токен і що з ним може зробити емітент.",
          "Як стоїть твій портфель і що сталося з одним із твоїх планів.",
          "Підготувати чернетку — план, правило чи купівлю, — яку ти змінюєш, підписуєш або лишаєш.",
        ],
      ),
      p(
        "Ryntra is in the menu as Ryntra, the AI assistant, and «Ask Ryntra» is a quiet button on Home; on a company's page and on a plan it also gives the Brief — what changed and what to check — and the Critic — the case against your idea.",
        "Ryntra — у меню як «Ryntra — ШІ-помічник», а «Спитати Ryntra» — тиха кнопка на Головній; на сторінці компанії й у плані він ще дає Brief — що змінилося й що перевірити — і Critic — аргументи проти твоєї ідеї.",
      ),
    ]),
    section("answers", "How it answers", "Як він відповідає", [
      p(
        "A serious answer goes the same way every time: what is observed, what it means, the case against, the risks and what is unknown, what to check, and the possible next steps — every figure with its source and its time. When the data is not there, it says so. «Nothing to do today» is a full answer.",
        "Серйозна відповідь щоразу йде однаково: що спостерігається, що це означає, аргументи проти, ризики й невідоме, що перевірити і можливі наступні кроки — кожна цифра з джерелом і часом. Коли даних немає, він так і каже. «Сьогодні нічого робити не треба» — повноцінна відповідь.",
      ),
    ]),
    section("never", "What it never does", "Чого він ніколи не робить", [
      list(
        [
          "It never buys, sells, sends or signs — it has no tool that could. A draft goes to the same Review and your signature as anything else.",
          "It never tells you what to buy: Ryntra gives no personal investment advice.",
          "It never supplies a missing fact or a price it did not read; the sizes and limits on a draft are computed by published rules, not by the model.",
          "It is not an adviser: the decision and the signature are yours.",
        ],
        [
          "Він ніколи не купує, не продає, не надсилає й не підписує — у нього немає такого інструмента. Чернетка йде в ту саму «Перевірку» й на твій підпис, як і все інше.",
          "Він ніколи не каже, що тобі купити: Ryntra не дає персональних інвестиційних порад.",
          "Він ніколи не вигадує відсутнього факту чи ціни, якої не прочитав; суми й межі в чернетці рахують опубліковані правила, а не модель.",
          "Він не радник: рішення й підпис — твої.",
        ],
      ),
    ]),
    section("data", "What reaches the model", "Що отримує модель", [
      p(
        "To answer, Ryntra's server sends the model's provider your question and the facts it needs — for example your holdings as company and amount — but not your wallet's address, and asks the provider not to keep the request. Your conversations are kept with your account. Questions that reach the model have a daily limit per wallet.",
        "Щоб відповісти, сервер Ryntra надсилає постачальнику моделі твоє запитання й потрібні для нього факти — наприклад, твої позиції як компанію й кількість, — але не адресу гаманця, і просить постачальника не зберігати запит. Твої розмови зберігаються з твоїм акаунтом. Запитання, що доходять до моделі, мають денну межу на гаманець.",
      ),
      note(
        "Never paste a seed phrase, a private key or a password into a question. Ryntra never asks for one.",
        "Ніколи не вставляй у запитання сід-фразу, приватний ключ чи пароль. Ryntra ніколи їх не просить.",
        "caution",
      ),
    ]),
  ],
  related: ["invest/company-page", "strategies/my-strategies", "reference/review"],
};

export const RYNTRA_PAGES: readonly DocPage[] = [ASSISTANT];

import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * Ryn's words on the web surface — two languages, one
 * table, no internal vocabulary: a person reads what the agent read, what it
 * means, what could be wrong, what to check and where to act, in their own
 * words. The answer's own sentences come from the server in the reader's
 * language; these are the chrome around them.
 */
const WORDS = {
  /* The assistant is Ryntra wherever a person reads, labelled as an AI where it speaks. */
  title: ["Ryntra · AI assistant", "Ryntra · ШІ-помічник"],
  who: ["Ryntra", "Ryntra"],
  lead: ["Ryntra is an AI: it researches and prepares; you decide and sign.", "Ryntra — ШІ: досліджує й готує, а рішення й підпис — твої."],
  contextAsset: ["About", "Про"],
  contextPlan: ["Your plan", "Твій план"],
  contextPortfolio: ["Your portfolio", "Твій портфель"],
  contextNote: ["A monitoring note", "Нотатка Нагляду"],
  contextPage: ["From the page", "Зі сторінки"],
  contextNone: ["Anything Ryntra reads", "Усе, що читає Ryntra"],
  connectToAsk: ["Connect a wallet to ask Ryntra: your holdings, plans and notes are yours alone.", "Під'єднай гаманець, щоб питати Ryntra: твої активи, плани й нотатки — лише твої."],
  confirmToAsk: ["Confirm the wallet with one signature so Ryntra reads what is yours and nothing else. A signature proves the address; it moves nothing.", "Підтверди гаманець одним підписом, щоб Ryntra читала твоє і нічого іншого. Підпис доводить адресу; нічого не переказує."],
  confirmWallet: ["Confirm wallet", "Підтвердити гаманець"],
  confirming: ["Confirming…", "Підтверджуємо…"],
  opening: ["Opening the conversation…", "Відкриваємо розмову…"],
  openFailed: ["The conversation could not be opened right now.", "Розмову зараз не відкрити."],
  retry: ["Try again", "Спробувати ще"],
  placeholder: ["Ask in your own words — e.g. what changed in my portfolio, why is SOL moving, prepare a SOL plan with $50 max risk", "Питай своїми словами — напр. що змінилось у моєму портфелі, чому SOL рухається, підготуй план на SOL з максимальним ризиком $50"],
  send: ["Ask", "Спитати"],
  sending: ["Ryntra is reading…", "Ryntra читає…"],
  suggested: ["Try asking", "Спробуй спитати"],
  observation: ["What is known now", "Що відомо зараз"],
  meaning: ["What it means", "Що це означає"],
  counter: ["What could make this wrong", "Що може це спростувати"],
  risks: ["Risks and unknowns", "Ризики й невідоме"],
  checks: ["Worth checking", "Варто перевірити"],
  actions: ["Possible next steps", "Можливі наступні кроки"],
  more: ["Counter-argument, risks, what to check", "Контраргумент, ризики, що перевірити"],
  sources: ["Sources", "Джерела"],
  insufficient: ["Not enough data to judge this.", "Даних недостатньо, щоб це оцінити."],
  refusedExecute: ["Ryntra does not execute — the Review, your confirmation and your signature do.", "Ryntra не виконує — виконують Review, твоє підтвердження і твій підпис."],
  refusedSecret: ["Ryntra does not share keys, secrets, sessions or another wallet's data.", "Ryntra не розкриває ключі, секрети, сесії чи дані іншого гаманця."],
  composedModel: ["Words by the model, every figure checked against the reads", "Слова від моделі, кожна цифра звірена з читаннями"],
  composedDeterministic: ["Composed from the reads", "Складено з читань"],
  budgetAbsent: ["No model is switched on here: every answer is composed from the reads.", "Модель тут не ввімкнена: кожна відповідь складається з читань."],
  budgetLine: ["model calls today", "звернень до моделі сьогодні"],
  budgetExhausted: ["The model's allowance is spent for today; answers are composed from the reads.", "Ліміт моделі на сьогодні вичерпано; відповіді складаються з читань."],
  busy: ["Ryntra is still answering your last question.", "Ryntra ще відповідає на попереднє запитання."],
  failed: ["Ryntra could not answer right now.", "Ryntra зараз не змогла відповісти."],
  stateCurrent: ["current", "актуально"],
  stateStale: ["stale", "застаріло"],
  stateUnavailable: ["unavailable", "недоступно"],
  stateUnknown: ["unknown", "невідомо"],
  draftPlan: ["Plan draft", "Чернетка плану"],
  draftMonitoring: ["Monitoring rule draft", "Чернетка правила Нагляду"],
  draftTrade: ["Trade draft", "Чернетка угоди"],
  draftAssumptions: ["What was assumed", "Що припущено"],
  draftIssues: ["What the builder will ask", "Що запитає конструктор"],
  cardHoldings: ["Holdings", "Активи"],
  cardPlan: ["Plan", "План"],
  cardNote: ["Note", "Нотатка"],
  cardEvidence: ["Evidence", "Докази"],
  cardComparison: ["Comparison", "Порівняння"],
  reviewFailed: ["Did not pass", "Не пройшло"],
  unpriced: ["unpriced", "без ціни"],
  tokenRead: ["read", "читання"],
  perUnit: ["per unit", "за одиницю"],
  amount: ["amount", "кількість"],
  boundary: ["Ryntra saved nothing and signed nothing.", "Ryntra нічого не зберегла й не підписала."],
  you: ["You", "Ти"],
  newConversation: ["New conversation", "Нова розмова"],
  observed: ["observed", "спостережено"],
} as const;

export type RynWord = keyof typeof WORDS;

export function rynWordsFor(locale: WorkspaceLocale): (word: RynWord) => string {
  return (word) => WORDS[word][locale === "uk" ? 1 : 0];
}

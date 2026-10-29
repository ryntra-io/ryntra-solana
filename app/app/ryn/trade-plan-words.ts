import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * «План угоди й критик» (AI-11) in the assistant's words — English and
 * Ukrainian, each line one block of at most two lines on a phone. The plan
 * is the person's: these words say what was planned, what the critic found
 * and what a press does — never what to trade.
 */
const WORDS = {
  /* AI-20: in «Боти», the plans Ryntra composed that are not yet the person's own; the plan page's critic column. */
  waitingTitle: ["Composed with Ryntra — waiting for your word", "Складено з Ryntra — чекають твого слова"],
  reviewLabel: ["Fees and the critic", "Комісії й критик"],
  withRyntra: ["Plans with Ryntra", "Плани з Ryntra"],
  withRyntraLine: ["Ryntra's critic and «Plan against reality»:", "Критик Ryntra і «План проти реальності»:"],
  withRyntraMore: ["{n} more", "ще {n}"],
  planTitle: ["Trade plan", "План угоди"],
  more: ["Assumptions, sources, versions", "Припущення, джерела, версії"],
  compose: ["Compose with Ryntra", "Скласти з Ryntra"],
  composeLead: ["Your idea and your loss limit. Ryntra writes the plan, a critic looks for holes.", "Твоя ідея й ліміт збитку. Ryntra складе план, критик шукатиме діри."],
  token: ["Token", "Токен"],
  tokenMint: ["Or a mint address", "Або адреса mint"],
  idea: ["Your idea", "Твоя ідея"],
  ideaHint: ["What must happen for it to work — in your words.", "Що має статися, щоб спрацювало, — своїми словами."],
  risk: ["Most you will lose, $", "Скільки готовий втратити, $"],
  budget: ["Budget, $ (optional)", "Бюджет, $ (не обов'язково)"],
  levels: ["Levels you already know", "Рівні, які вже знаєш"],
  entry: ["Entry, $", "Вхід, $"],
  invalidation: ["Invalidation, $", "Інвалідація, $"],
  targets: ["Targets, $ (space between)", "Цілі, $ (через пробіл)"],
  days: ["Days", "Днів"],
  composeButton: ["Compose the plan · {price}", "Скласти план · {price}"],
  free: ["free", "безкоштовно"],
  freeLine: ["Free on this deployment: the plan engine composes it from your figures.", "Тут безкоштовно: план складе рушій планів з твоїх цифр."],
  composing: ["Ryntra is writing the plan and the critic is reading it…", "Ryntra пише план, критик його читає…"],
  priceLine: ["{price} for the plan and its critic, taken only if a plan comes back.", "{price} за план і критика — лише якщо план вийде."],
  noBuy: ["Ryntra never opens a trade: the plan is yours, the Review and the signature too.", "Ryntra не відкриває угод: план твій, Перевірка і підпис — теж."],
  needIdea: ["Write the idea and the loss limit.", "Напиши ідею й ліміт збитку."],
  credits: ["{n} credits", "{n} кредитів"],
  topUp: ["Add funds", "Поповнити"],
  /* the plan */
  version: ["v{n}", "в.{n}"],
  thesis: ["Thesis", "Теза"],
  whyNow: ["Why now", "Чому зараз"],
  entryLine: ["Entry", "Вхід"],
  upTo: ["up to {max}", "до {max}"],
  invalidationLine: ["Wrong below", "Хибна нижче"],
  targetLine: ["Target", "Ціль"],
  lossLimit: ["Loss limit", "Ліміт збитку"],
  size: ["Size", "Розмір"],
  byRyntra: ["Ryntra's proposal", "пропозиція Ryntra"],
  byRules: ["example", "приклад"],
  fees: ["Fees and costs to the first target {total} · loss at the invalidation {loss} · reward {reward}", "Комісії й витрати до першої цілі {total} · збиток на інвалідації {loss} · винагорода {reward}"],
  ratio: ["{r} to 1", "{r} до 1"],
  critic: ["Critic", "Критик"],
  criticModel: ["Strong critic", "Сильний критик"],
  criticRules: ["Plan engine's checks", "Перевірки рушія планів"],
  criticCount: ["{major} serious · {minor} to fix · {note} to know", "{major} серйозних · {minor} виправити · {note} знати"],
  criticNone: ["Nothing serious found — which is not approval.", "Серйозного не знайдено — це ще не схвалення."],
  major: ["Serious", "Серйозне"],
  minor: ["Fix", "Виправити"],
  note: ["Know", "Знати"],
  gaps: ["Not checked", "Не перевірено"],
  details: ["Details", "Детально"],
  assumptions: ["Assumptions", "Припущення"],
  sources: ["Sources", "Джерела"],
  versions: ["Versions", "Версії"],
  journal: ["What happened", "Що відбувалось"],
  byPerson: ["you", "ти"],
  byPlanPage: ["the plan's page", "сторінка плану"],
  byRyntraWho: ["Ryntra", "Ryntra"],
  byMarket: ["the market", "ринок"],
  byRulesWho: ["the rule", "правило"],
  /* actions */
  approve: ["Approve", "Схвалити"],
  approveWatch: ["Approve and watch", "Схвалити й стежити"],
  watch: ["Watch", "Стежити"],
  edit: ["Change", "Змінити"],
  save: ["Save as a new version", "Зберегти новою версією"],
  cancelEdit: ["Back", "Назад"],
  recheck: ["Check again · {price}", "Перевірити ще раз · {price}"],
  cancel: ["Cancel the plan", "Скасувати план"],
  openPlan: ["Open the plan and the Review", "Відкрити план і Перевірку"],
  approvedNote: ["Your plan is saved. Any trade goes through the Review on its page and your signature — Ryntra signs nothing.", "Твій план збережено. Будь-яка угода — лише через Перевірку на його сторінці й твій підпис; Ryntra нічого не підписує."],
  watchLine: ["Alerts: {line}", "Сповіщення: {line}"],
  watching: ["Alerts watch the entry, the invalidation and the target.", "Сповіщення стежать за входом, інвалідацією й ціллю."],
  /* reality */
  reality: ["Plan against reality", "План проти реальності"],
  realityNone: ["No trade under this plan yet.", "Під цим планом угод ще немає."],
  receipt: ["Receipt", "Квитанція"],
  riskNow: ["Risk now", "Ризик зараз"],
  /* states */
  state_draft: ["Draft", "Чернетка"],
  state_checked: ["Checked", "Перевірено"],
  state_approved: ["Approved", "Схвалено"],
  state_watching: ["Watched", "Під наглядом"],
  state_done: ["Done", "Виконано"],
  state_cancelled: ["Cancelled", "Скасовано"],
  state_broken: ["Broken", "Зламано"],
  brokenLine: ["The price reached the invalidation: the idea is wrong as written.", "Ціна дійшла до інвалідації: ідея в такому вигляді хибна."],
  expiredLine: ["The entry window passed without a trade.", "Вікно входу минуло без угоди."],
  doneLine: ["The position this plan opened is closed.", "Позицію, яку відкрив план, закрито."],
  /* the journal */
  ev_created: ["composed", "складено"],
  ev_edited: ["changed", "змінено"],
  ev_checked: ["checked by the critic", "перевірено критиком"],
  ev_approved: ["approved", "схвалено"],
  ev_watching: ["watched by Alerts", "стежать Сповіщення"],
  ev_synced: ["changed on the plan's page", "змінено на сторінці плану"],
  ev_broken: ["broken", "зламано"],
  ev_done: ["done", "виконано"],
  ev_cancelled: ["cancelled", "скасовано"],
  /* failures */
  failed: ["Ryntra could not do that right now.", "Ryntra зараз не змогла цього зробити."],
  loadFailed: ["The plans could not be read right now.", "Плани зараз не прочитати."],
  budgetOut: ["Not enough credits for this: {reason}", "Кредитів на це не вистачає: {reason}"],
  conflict: ["The plan changed meanwhile — here it is as it stands.", "План тим часом змінився — ось він зараз."],
  invalid: ["The figures do not make a plan: {issues}", "Цифри не складають план: {issues}"],
  busy: ["Ryntra is answering another question of yours — a moment.", "Ryntra відповідає на інше твоє питання — хвилинку."],
  spent: ["{n} credits spent.", "Витрачено {n} кредитів."],
  spentPart: ["The critic did not answer: {n} credits for the plan alone.", "Критик не відповів: {n} кредитів лише за план."],
  back: ["All plans", "Усі плани"],
} as const;

export type TradePlanWord = keyof typeof WORDS;

/* One function per language, made once: a component that names it in an effect's dependencies does not re-run on every render. */
const EN = (key: TradePlanWord): string => WORDS[key][0];
const UK = (key: TradePlanWord): string => WORDS[key][1];

export function tradePlanWordsFor(locale: WorkspaceLocale): (key: TradePlanWord) => string {
  return locale === "uk" ? UK : EN;
}

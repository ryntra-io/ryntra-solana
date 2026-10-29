import type { WorkspaceLocale } from "@/app/shell/locale";
import type { AllowanceIssueCode, AllowanceStatus, BlockedBy } from "@/lib/solana/allowances/model";

/**
 * The spending limits' words (SOL-7), in both languages. Short: a word or a number where there is one; what was not
 * read is said so, never as a zero; what a cancelled subscription still lets a merchant take is said with its amount.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const ALLOWANCE_WORDS = {
  title: bi("Spending limits", "Ліміти витрат"),
  help: bi(
    "Let an agent, an app or a merchant take USDC from your wallet up to a limit you set, until a date you set. The Subscriptions program of the Solana Foundation keeps the count; you see who may take what and revoke in one tap. Ryntra holds no role and takes no fee.",
    "Дозволь агенту, застосунку чи мерчанту брати USDC з твого гаманця в межах ліміту й до дати, які ти задаєш. Лік веде програма Subscriptions від Solana Foundation; ти бачиш, кому що дозволено, і відкликаєш одним дотиком. Ryntra не має ролі й не бере комісії.",
  ),
  devnet: bi("Devnet", "Devnet"),
  devnetHint: bi("Test network: test USDC, no real money.", "Тестова мережа: тестові USDC, без справжніх грошей."),
  connectLine: bi("Connect a Solana wallet to see and give spending limits.", "Підключи гаманець Solana, щоб бачити й давати ліміти витрат."),
  connect: bi("Connect wallet", "Підключити гаманець"),

  /* The wallet's USDC */
  usdcTitle: bi("Your USDC", "Твої USDC"),
  balance: bi("Balance", "Баланс"),
  approval: bi("Approval", "Дозвіл"),
  approvalOpen: bi("Given to Subscriptions", "Дано Subscriptions"),
  approvalNone: bi("Not given yet", "Ще не дано"),
  approvalClosedOnly: bi(
    "The program's authority is closed, so no limit can take anything; the approval on your account stays until the account can be changed (once it is unfrozen)",
    "Повноваження програми закрито, тож жоден ліміт нічого не візьме; дозвіл на рахунку лишається, доки рахунок можна буде змінити (коли його розморозять)",
  ),
  approvalPaused: bi("Revoked: your limits cannot be used until you approve again", "Відкликано: ліміти не діють, доки не даси дозвіл знову"),
  approvalOther: bi("Taken by another app: your limits cannot be used until you approve again", "Перехоплено іншим застосунком: ліміти не діють, доки не даси дозвіл знову"),
  approvalUsed: bi("Used up: your limits cannot be used until you approve again", "Вичерпано: ліміти не діють, доки не даси дозвіл знову"),
  approvalFrozen: bi("Your USDC account is frozen: no limit can take anything", "Рахунок USDC заморожено: жоден ліміт нічого не візьме"),
  noAccount: bi("This wallet has no USDC account yet.", "У цього гаманця ще немає рахунку USDC."),
  notRead: bi("Not read", "Не прочитано"),
  stopAll: bi("Stop all on USDC", "Зупинити все на USDC"),

  /* Starting */
  giveFixed: bi("One-off limit", "Разовий ліміт"),
  giveRecurring: bi("Every period", "Щоперіоду"),
  subscribe: bi("Merchant plan", "План мерчанта"),
  fixedTitle: bi("A one-off limit", "Разовий ліміт"),
  fixedLine: bi("They may take up to this amount in total, until the end date.", "Можна взяти до цієї суми загалом, до дати завершення."),
  recurringTitle: bi("A limit every period", "Ліміт щоперіоду"),
  recurringLine: bi("They may take up to this amount each period, until the end date. What is not taken does not carry over.", "Можна брати до цієї суми щоперіоду, до дати завершення. Невзяте не переноситься."),
  subscribeTitle: bi("Subscribe to a merchant's plan", "Підписка на план мерчанта"),
  subscribeLine: bi("Paste the plan's address: its price and period are read from the chain and shown before you sign.", "Встав адресу плану: ціну й період прочитаємо з мережі й покажемо до підпису."),
  delegatee: bi("Who may take", "Хто може брати"),
  delegateeHint: bi("A Solana address: an agent's key, an app's or a person's wallet.", "Адреса Solana: ключ агента, гаманець застосунку чи людини."),
  amount: bi("Amount, USDC", "Сума, USDC"),
  perPeriod: bi("Per period, USDC", "За період, USDC"),
  period: bi("Period", "Період"),
  period_day: bi("Every day", "Щодня"),
  period_week: bi("Every week", "Щотижня"),
  period_month: bi("Every 30 days", "Кожні 30 днів"),
  term: bi("Ends in", "Завершується через"),
  term_d: bi("{n} d", "{n} дн."),
  planAddress: bi("Plan address", "Адреса плану"),
  review: bi("Review", "Переглянути"),
  cancel: bi("Cancel", "Скасувати"),

  /* Lists */
  given: bi("Limits you gave", "Ліміти, які ти дав"),
  givenEmpty: bi("No limits yet. Give one above.", "Лімітів ще немає. Дай перший вище."),
  givenUnread: bi("The network did not list your limits now: not read, not «none». Try again.", "Мережа зараз не віддала список: не прочитано, а не «немає». Спробуй ще раз."),
  received: bi("Limits given to this wallet", "Ліміти, дані цьому гаманцю"),
  receivedEmpty: bi("No one has given this wallet a limit.", "Цьому гаманцю ліміту ще не дали."),
  receivedUnread: bi("The network did not list them now: not read, not «none».", "Мережа зараз не віддала список: не прочитано, а не «немає»."),
  reload: bi("Read again", "Прочитати знову"),
  who: bi("Who may take", "Хто може брати"),
  from: bi("From", "Від кого"),
  what: bi("Limit", "Ліміт"),
  spent: bi("Taken", "Взято"),
  available: bi("Can take now", "Можна взяти зараз"),
  until: bi("Until", "До"),
  status: bi("Status", "Стан"),
  actions: bi("Actions", "Дії"),
  kind_fixed: bi("{amount} in total", "{amount} загалом"),
  kind_fixedLeft: bi("{amount} left", "лишилось {amount}"),
  kind_recurring: bi("{amount} {period}", "{amount} {period}"),
  kind_subscription: bi("{amount} {period} · plan", "{amount} {period} · план"),
  every_s: bi("every {n}", "кожні {n}"),
  thisPeriod: bi("{amount} this period", "{amount} за цей період"),
  noEnd: bi("No end date", "Без дати завершення"),
  unknownAmount: bi("Not read", "Не прочитано"),
  revoke: bi("Revoke", "Відкликати"),
  cancelSub: bi("Cancel", "Скасувати"),
  close: bi("Close", "Закрити"),
  spend: bi("Take", "Взяти"),
  merchantUnknown: bi("Merchant not read", "Мерчанта не прочитано"),

  status_active: bi("Active", "Діє"),
  status_scheduled: bi("Starts later", "Почнеться пізніше"),
  status_spent: bi("Used up", "Вичерпано"),
  status_expired: bi("Ended", "Завершився"),
  status_cancelled: bi("Cancelled · ends {date}", "Скасовано · діє до {date}"),
  status_ended: bi("Over", "Закінчилась"),
  status_stopped: bi("Stopped", "Зупинено"),
  status_blocked: bi("Not usable", "Не діє"),
  blocked_frozen: bi("Not usable: the USDC account is frozen", "Не діє: рахунок USDC заморожено"),
  blocked_noAccount: bi("Not usable: the USDC account is closed", "Не діє: рахунку USDC немає"),
  blocked_approvalOther: bi("Not usable: approval taken by another app", "Не діє: дозвіл перехоплено"),
  blocked_approvalRevoked: bi("Not usable: approval revoked", "Не діє: дозвіл відкликано"),
  blocked_approvalUsed: bi("Not usable: approval used up", "Не діє: дозвіл вичерпано"),
  status_unknown: bi("Unknown: not read", "Невідомо: не прочитано"),

  /* Spend */
  spendTitle: bi("Take from a limit", "Взяти з ліміту"),
  to: bi("To", "Куди"),
  toHint: bi("Your own wallet by default.", "За замовчуванням — твій гаманець."),

  /* Review */
  reviewFixed: bi("Give a one-off limit", "Дати разовий ліміт"),
  reviewRecurring: bi("Give a limit every period", "Дати ліміт щоперіоду"),
  reviewSubscribe: bi("Subscribe to a plan", "Підписатися на план"),
  reviewRevoke: bi("Revoke the limit", "Відкликати ліміт"),
  reviewCancel: bi("Cancel the subscription", "Скасувати підписку"),
  reviewClose: bi("Close and get the deposit back", "Закрити й повернути заставу"),
  reviewStopAll: bi("Stop every limit on USDC", "Зупинити всі ліміти на USDC"),
  reviewSpend: bi("Take from the limit", "Взяти з ліміту"),
  payNothing: bi("Nothing leaves your wallet now", "Зараз із гаманця нічого не йде"),
  payUpTo: bi("Up to {amount} may leave your wallet", "З гаманця можна буде взяти до {amount}"),
  paySpend: bi("{amount} from {from}", "{amount} від {from}"),
  getLimit: bi("{who} may take it until {date}", "{who} може брати до {date}"),
  getLimitNoEnd: bi("{who} may take it until you cancel", "{who} може брати, доки не скасуєш"),
  getRevoke: bi("Nothing more can be taken", "Більше нічого взяти не можна"),
  getCancel: bi("No charge after this period", "Після цього періоду списань не буде"),
  getClose: bi("The account closes; its deposit comes back", "Рахунок закривається; застава повертається"),
  getStopAll: bi("{n} limits stop at once", "Одразу зупиняються ліміти: {n}"),
  getStopAllUnknown: bi("Every limit on USDC stops at once", "Одразу зупиняються всі ліміти на USDC"),
  getSpend: bi("{amount} to {to}", "{amount} на {to}"),
  costNetwork: bi("Network fee", "Комісія мережі"),
  costRent: bi("Deposit for the account (comes back on close)", "Застава за рахунок (повертається при закритті)"),
  costRefund: bi("Deposit back", "Повернення застави"),
  costRyntra: bi("Ryntra", "Ryntra"),
  rowApprovesFirst: bi(
    "Your USDC account gives the Subscriptions program an approval with no amount cap, once: what can be taken is bounded only by the program's limit accounts, each one listed on this page. «Stop all on USDC» takes the approval back (on a frozen account it closes the program's authority, so nothing can be taken).",
    "Рахунок USDC один раз дає програмі Subscriptions дозвіл без обмеження суми: скільки можна взяти, обмежують лише рахунки лімітів програми — кожен є на цій сторінці. «Зупинити все на USDC» забирає дозвіл (на замороженому рахунку — закриває повноваження програми, тож нічого не взяти).",
  ),
  rowApprovesAgain: bi(
    "The approval with no amount cap is given again: your other open limits on USDC work again too; each is bounded only by its limit account.",
    "Дозвіл без обмеження суми дається знову: інші відкриті ліміти на USDC теж знову діють; кожен обмежує лише його рахунок ліміту.",
  ),
  rowEndDrift: bi("Ends {date}; if the signature waits, up to {n} min later", "Завершується {date}; якщо підпис затягнеться — до {n} хв пізніше"),
  rowReplaces: bi("This replaces the approval held by {who}: what it allowed stops working", "Це замінює дозвіл, який мав {who}: те, що він дозволяв, перестане діяти"),
  rowGrace: bi("The merchant can still take up to {amount} of this period until {date}. To stop it now, use «Stop all on USDC».", "Мерчант ще може взяти до {amount} за цей період до {date}. Щоб зупинити зараз — «Зупинити все на USDC»."),
  rowPlanTo: bi("Pays to", "Платить на"),
  rowPlanAnywhere: bi("Any address the merchant chooses", "Будь-яка адреса на вибір мерчанта"),
  rowPlanToFixed: bi("set by the plan; the merchant cannot change it", "задано планом; мерчант не може це змінити"),
  rowPullers: bi("Collects", "Списує"),
  rowPullersMay: bi("the merchant may change who collects and end the plan sooner; the price and the period stay as signed", "мерчант може змінити, хто списує, і завершити план раніше; ціна й період лишаються як підписано"),
  rowGraceUnknown: bi("What the merchant may still take this period could not be read now.", "Скільки мерчант ще може взяти за цей період, зараз прочитати не вдалося."),
  rowClosesOnly: bi("Your USDC account is frozen or gone: the program's authority is closed, so no limit can take anything; the approval on the account stays until it can be changed.", "Рахунок USDC заморожено або його немає: повноваження програми закриваються, тож жоден ліміт нічого не візьме; дозвіл на рахунку лишається, доки його можна буде змінити."),
  rowRemains: bi("The approval held by {who} is not the program's and stays: revoke it in your wallet.", "Дозвіл, який має {who}, — не програми, тож лишається: відклич його у своєму гаманці."),
  rowOpens: bi("Opens the recipient's USDC account", "Відкриває рахунок USDC отримувача"),
  whatFixed: bi("A fixed limit on the Subscriptions program; revoke it any time.", "Фіксований ліміт на програмі Subscriptions; відкликати можна будь-коли."),
  whatRecurring: bi("A limit that renews each period on the Subscriptions program; revoke it any time.", "Ліміт, що поновлюється щоперіоду, на програмі Subscriptions; відкликати можна будь-коли."),
  whatSubscribe: bi("A subscription on the Subscriptions program: the merchant takes the plan's price each period; cancel any time.", "Підписка на програмі Subscriptions: мерчант бере ціну плану щоперіоду; скасувати можна будь-коли."),
  whatRevoke: bi("The limit's account is closed on the chain: not replaced by another.", "Рахунок ліміту закривається в мережі, а не замінюється іншим."),
  whatCancel: bi("The subscription is cancelled on the chain; after the period it can be closed and its deposit returned.", "Підписка скасовується в мережі; після періоду її можна закрити й повернути заставу."),
  whatClose: bi("The account of a limit that is over is closed; its deposit comes back.", "Рахунок завершеного ліміту закривається; застава повертається."),
  whatStopAll: bi("The program's approval on your USDC is revoked and its authority closed: no limit here can take anything.", "Дозвіл програми на твої USDC відкликається, а повноваження закриваються: жоден ліміт тут нічого не візьме."),
  whatSpend: bi("A transfer the program counts against the limit; over it the program refuses.", "Переказ, який програма зараховує в ліміт; понад ліміт програма відмовляє."),
  detailProgram: bi("Program", "Програма"),
  detailAccount: bi("Account", "Рахунок"),
  detailNetwork: bi("Network", "Мережа"),
  detailPlan: bi("Plan", "План"),
  detailWho: bi("Who may take", "Хто може брати"),
  detailMerchant: bi("Merchant", "Мерчант"),
  detailFrom: bi("Limit of", "Ліміт від"),
  detailTo: bi("To", "Куди"),
  risk: bi("Whoever holds the delegate's key can take up to the limit: give it only to whom you trust.", "Той, хто має ключ отримувача, може взяти до ліміту: давай лише тим, кому довіряєш."),
  riskSubscribe: bi("The merchant takes the plan's price every period until you cancel or the plan ends.", "Мерчант списує ціну плану щоперіоду, доки не скасуєш або план не завершиться."),
  riskSubscribeNoEnd: bi("This plan has no end date: the merchant takes its price every period until you cancel.", "У цього плану немає дати завершення: мерчант списує ціну щоперіоду, доки не скасуєш."),
  signing: bi("Confirm in your wallet…", "Підтверди в гаманці…"),
  sending: bi("Sending…", "Надсилаємо…"),
  preparing: bi("Preparing…", "Готуємо…"),

  /* Receipt */
  receiptTitle_fixed: bi("Limit given", "Ліміт дано"),
  receiptTitle_recurring: bi("Limit given", "Ліміт дано"),
  receiptTitle_subscribe: bi("Subscribed", "Підписано"),
  receiptTitle_revoke: bi("Done", "Готово"),
  receiptTitle_stopAll: bi("All stopped", "Усе зупинено"),
  receiptTitle_spend: bi("Taken", "Взято"),
  receiptTitle_pending: bi("Sent, not confirmed yet", "Надіслано, ще не підтверджено"),
  followWatching: bi("Reading the network again until its word is final. Do not prepare it again meanwhile.", "Перечитуємо мережу, доки її слово не стане остаточним. Тим часом не готуй це вдруге."),
  followTimeout: bi(
    "The network has not given its final word yet. Check the list before trying again: a new limit is not prepared while this one is not final.",
    "Мережа ще не дала остаточного слова. Перевір список перед повтором: новий ліміт не готується, доки цей не остаточний.",
  ),
  followFailed: bi("What you sent earlier was refused by the network on chain; nothing changed but the network fee.", "Надіслане раніше мережа відхилила; нічого не змінено, крім комісії мережі."),
  followNotLanded: bi("What you sent earlier did not reach the network and no longer can; nothing changed.", "Надіслане раніше не потрапило в мережу й уже не потрапить; нічого не змінено."),
  followWaitStart: bi("Waiting for the network's word on what was sent.", "Чекаємо слова мережі про надіслане."),
  done: bi("Done", "Готово"),
  refused: bi("The wallet declined; nothing was sent.", "Гаманець відхилив; нічого не надіслано."),
  failed: bi("Not done: {reason}", "Не виконано: {reason}"),

  unit_s: bi("{n} s", "{n} с"),
  unit_min: bi("{n} min", "{n} хв"),
  unit_h: bi("{n} h", "{n} год"),
  unit_d: bi("{n} d", "{n} дн."),
} as const;

type AllowanceWordKey = keyof typeof ALLOWANCE_WORDS;

export function allowanceWords(locale: WorkspaceLocale) {
  return (key: AllowanceWordKey, values: Readonly<Record<string, string | number>> = {}) =>
    ALLOWANCE_WORDS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** A refusal of the server, by its code, in the page's language; a code not named here falls back to the server's words. */
export const FAILURE_WORDS: Readonly<Record<string, Readonly<{ en: string; uk: string }>>> = {
  WALLET_CHANGED: bi("The wallet changed; prepare it again.", "Гаманець змінився; підготуй ще раз."),
  WALLET_MISMATCH: bi("It was prepared for another wallet.", "Це підготовлено для іншого гаманця."),
  ALLOWANCE_NO_TOKEN_ACCOUNT: bi("This wallet has no USDC account yet; receive USDC first.", "У гаманця ще немає рахунку USDC; спершу отримай USDC."),
  ALLOWANCE_TOKEN_FROZEN: bi("This wallet's USDC account is frozen.", "Рахунок USDC цього гаманця заморожено."),
  ALLOWANCE_NOT_FOUND: bi("No such limit on this network.", "Такого ліміту в цій мережі немає."),
  ALLOWANCE_NOT_YOURS: bi("This limit was not given by this wallet.", "Цей ліміт дав не цей гаманець."),
  ALLOWANCE_NOT_DELEGATEE: bi("This limit was not given to this wallet.", "Цей ліміт дано не цьому гаманцю."),
  ALLOWANCE_NOT_ACTIVE: bi("Nothing can be taken from this limit now.", "З цього ліміту зараз нічого взяти не можна."),
  ALLOWANCE_LIMIT_EXCEEDED: bi("More than the limit allows now.", "Більше, ніж ліміт дозволяє зараз."),
  ALLOWANCE_BALANCE_SHORT: bi("The giver's USDC balance holds less than this now.", "На балансі USDC того, хто дав ліміт, зараз менше."),
  ALLOWANCE_ALREADY_CANCELLED: bi("Already cancelled; it can be closed once its period ends.", "Уже скасовано; закрити можна, щойно мине період."),
  ALLOWANCE_PLAN_NOT_FOUND: bi("No Subscriptions plan at this address on this network.", "За цією адресою в цій мережі немає плану Subscriptions."),
  ALLOWANCE_PLAN_ASSET: bi("This plan is not paid in USDC.", "Цей план оплачується не в USDC."),
  ALLOWANCE_PLAN_SUNSET: bi("This plan takes no new subscribers.", "Цей план не приймає нових підписників."),
  ALLOWANCE_PLAN_ENDED: bi("This plan has ended.", "Цей план закінчився."),
  ALLOWANCE_PLAN_OWN: bi("This is your own plan.", "Це твій власний план."),
  ALLOWANCE_ALREADY_SUBSCRIBED: bi("You already have a subscription to this plan.", "У тебе вже є підписка на цей план."),
  ALLOWANCE_NOTHING_TO_STOP: bi("No limit on USDC is open.", "Відкритих лімітів на USDC немає."),
  ALLOWANCE_TERMS_CHANGED: bi("What is being signed changed on the network; read the new Review before signing.", "Те, що підписується, змінилося в мережі; прочитай нову Перевірку перед підписом."),
  ALLOWANCE_RECIPIENT: bi("Not an address USDC can be sent to safely: give a wallet or a USDC account.", "На цю адресу USDC безпечно не надіслати: вкажи гаманець або рахунок USDC."),
  ALLOWANCE_BUILD_EXPIRED: bi("It waited too long for the signature; prepare it again.", "Підпису чекали задовго; підготуй ще раз."),
  ALLOWANCE_BUILD_USED: bi("This was already sent.", "Це вже надіслано."),
  ALLOWANCE_SIGNED_OTHER_BYTES: bi("The wallet signed something other than what was reviewed; nothing was sent.", "Гаманець підписав не те, що переглянуто; нічого не надіслано."),
  RATE_LIMITED: bi("Too many requests; try again in a minute.", "Забагато запитів; спробуй за хвилину."),
  UNAVAILABLE: bi("The network could not be read now; nothing was sent.", "Мережу зараз не вдалося прочитати; нічого не надіслано."),
  /* After the signature: an answer lost on its way back is never «nothing was sent» — the bytes may be on chain. */
  ALLOWANCE_SEND_UNKNOWN: bi("Not known whether it was sent: check the list before trying again.", "Невідомо, чи надіслано — переглянь список перед повтором."),
  ALLOWANCE_SEND_PENDING: bi(
    "A limit you sent is not final on the network yet; check the list in a minute before giving another.",
    "Надісланий ліміт ще не остаточний у мережі; перевір список за хвилину, перш ніж давати інший.",
  ),
  ALLOWANCE_SPEND_PENDING: bi(
    "A take you sent is not final on the network yet; check the list in a minute before taking again.",
    "Надіслане списання ще не остаточне в мережі; перевір список за хвилину, перш ніж брати знову.",
  ),
  ALLOWANCE_NOT_LANDED: bi("It did not reach the network and no longer can; nothing changed. You can prepare it again.", "Не потрапило в мережу й уже не потрапить; нічого не змінено. Можна підготувати знову."),
  ALLOWANCE_FAILED_ON_CHAIN: bi("The network refused it on chain; nothing changed but the network fee.", "Мережа відмовила в транзакції; нічого не змінено, крім комісії мережі."),
};

/** One line under a field for each rule it breaks. */
export const ISSUE_WORDS: Readonly<Record<AllowanceIssueCode, Readonly<{ en: string; uk: string }>>> = {
  AMOUNT: bi("Enter an amount.", "Введи суму."),
  DELEGATEE_ADDRESS: bi("Not a Solana address.", "Це не адреса Solana."),
  DELEGATEE_IS_SELF: bi("That is your own wallet.", "Це твій власний гаманець."),
  TERM_RANGE: bi("An hour to a year.", "Від години до року."),
  PERIOD: bi("Choose a period.", "Обери період."),
  PERIOD_LONGER_THAN_TERM: bi("The period is longer than the limit lives.", "Період довший, ніж живе ліміт."),
  PLAN_ADDRESS: bi("Not a Solana address.", "Це не адреса Solana."),
  RECIPIENT_ADDRESS: bi("Not a Solana address.", "Це не адреса Solana."),
};

export function issueWord(locale: WorkspaceLocale, code: AllowanceIssueCode): string {
  return ISSUE_WORDS[code][locale];
}

export function statusWord(locale: WorkspaceLocale, status: AllowanceStatus, date: string, blocked: BlockedBy | null = null): string {
  if (status === "blocked" && blocked) return allowanceWords(locale)(`blocked_${blocked}`);
  return allowanceWords(locale)(`status_${status}`, { date });
}

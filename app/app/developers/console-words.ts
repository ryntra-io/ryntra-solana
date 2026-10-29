import type { WorkspaceLocale } from "@/app/shell/locale";
import type { DevAction, DevCredentialKind, DevEnvironment, DevKeyState, DevQuotaWindow, DevScope, DevWebhookEvent } from "@/lib/core/developer/console";

/**
 * «Консоль розробника» (DEV-2) — the console's words, in both languages. A secret is spoken of as what it is: shown
 * once, kept as a hash, and gone from this screen the moment the page is left.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const CONSOLE_WORDS = {
  title: bi("Developer console", "Консоль розробника"),
  help: bi(
    "Projects, API keys, signed webhooks and what each project has spent. Every right here belongs to the project's team and is checked by Ryntra's server on every request. A secret key is a server's: it is shown once when it is made, kept only as a hash, and refused outright on any request a browser sends.",
    "Проєкти, ключі API, підписані вебхуки й витрачене кожним проєктом. Кожне право тут — це право команди проєкту, і сервер Ryntra перевіряє його на кожному запиті. Секретний ключ — для сервера: його показують один раз при створенні, зберігають лише як хеш і відмовляють на будь-якому запиті з браузера.",
  ),
  connectLine: bi("Connect a Solana wallet to open your projects.", "Підключи гаманець Solana, щоб відкрити свої проєкти."),
  proveLine: bi("Sign in with the wallet once: a project is read for the wallet that proves itself.", "Увійди гаманцем один раз: проєкт читається для гаманця, який себе підтвердив."),
  prove: bi("Sign in with wallet", "Увійти гаманцем"),
  team: bi("Team", "Команда"),
  teamHint: bi("A project belongs to a team. Paste the team's id from «Команда» in «Казна».", "Проєкт належить команді. Встав ідентифікатор команди зі сторінки «Команда» в «Казні»."),
  teamOpen: bi("Open «Команда»", "Відкрити «Команду»"),
  projects: bi("Projects", "Проєкти"),
  projectsEmpty: bi("No project in this team yet.", "У цій команді ще немає проєктів."),
  create: bi("Create a project", "Створити проєкт"),
  createTitle: bi("New project", "Новий проєкт"),
  name: bi("Name", "Назва"),
  open: bi("Open", "Відкрити"),
  back: bi("All projects", "Усі проєкти"),
  cancel: bi("Cancel", "Скасувати"),
  save: bi("Save", "Зберегти"),

  keys: bi("Keys", "Ключі"),
  keysEmpty: bi("No key yet.", "Ключів ще немає."),
  keyIssue: bi("Issue a key", "Створити ключ"),
  keyIssueTitle: bi("New key", "Новий ключ"),
  kind: bi("Kind", "Вид"),
  environment: bi("Environment", "Середовище"),
  scopes: bi("Scopes", "Межі"),
  origins: bi("Origins", "Origin"),
  originsHint: bi("One origin per line, as a browser sends it: https://app.example.com — no path, no wildcard.", "По одному origin на рядок, як надсилає браузер: https://app.example.com — без шляху й без зірочки."),
  originsNone: bi("A secret key answers no browser, so it holds no origins.", "Секретний ключ не відповідає браузеру, тож origin у нього немає."),
  state: bi("State", "Стан"),
  lastUsed: bi("Last used", "Востаннє"),
  never: bi("never", "ніколи"),
  rotate: bi("Rotate", "Ротація"),
  rotateHint: bi("A rotation makes a new key and leaves the old one answering for the hours you give it — 0 ends it at once.", "Ротація створює новий ключ і лишає старий чинним на задані години — 0 завершує його одразу."),
  graceHours: bi("Hours the old key still answers", "Годин, доки старий ключ ще відповідає"),
  revoke: bi("Revoke", "Відкликати"),
  revokeHint: bi("A revoked key stops answering from the next request on. Nothing is cached.", "Відкликаний ключ перестає відповідати з наступного запиту. Нічого не кешується."),
  shown: bi("Copy it now — it is shown once", "Скопіюй зараз — показуємо один раз"),
  shownHint: bi(
    "Ryntra keeps only a hash of this key. There is no route that shows it again and no field on a key that could carry it. Lost means rotated.",
    "Ryntra зберігає лише хеш цього ключа. Жоден маршрут не покаже його вдруге, і в ключа немає поля, де він міг би лежати. Загубив — роби ротацію.",
  ),
  dismiss: bi("I have copied it", "Скопіював"),
  publicNoSecret: bi("A public key has no secret: its id is the whole credential, and what bounds it is the origins it names.", "У публічного ключа немає секрету: ідентифікатор — це й є весь ключ, а межі йому задають названі origin."),

  endpoints: bi("Webhook endpoints", "Вебхуки"),
  endpointsEmpty: bi("No endpoint yet.", "Вебхуків ще немає."),
  endpointAdd: bi("Add an endpoint", "Додати вебхук"),
  endpointAddTitle: bi("New endpoint", "Новий вебхук"),
  url: bi("Address", "Адреса"),
  urlHint: bi("An https address on a public host. A delivery is signed with this endpoint's own secret.", "Адреса https на публічному хості. Кожну доставку підписуємо власним секретом цього вебхука."),
  events: bi("Events", "Події"),
  eventsOnlyPing: bi("ping is the only event today — the console's own test delivery. Product events join it with the tasks that produce them.", "Сьогодні єдина подія — ping, тестова доставка з консолі. Продуктові події з'являться разом із задачами, які їх породжують."),
  enabled: bi("On", "Увімкнено"),
  disabled: bi("Off", "Вимкнено"),
  enable: bi("Turn on", "Увімкнути"),
  disable: bi("Turn off", "Вимкнути"),
  madeOff: bi("An endpoint is made off: nothing is delivered to an address until somebody turns it on.", "Вебхук створюється вимкненим: доки його не ввімкнуть, на адресу нічого не йде."),
  rotateSecret: bi("New signing secret", "Новий секрет підпису"),
  rotateSecretHint: bi("The old secret signs beside the new one for five minutes, so a receiver mid-deploy keeps verifying.", "Старий секрет підписує поруч із новим ще п'ять хвилин, щоб приймач під час викладки далі перевіряв підпис."),
  sendTest: bi("Send a test", "Надіслати тест"),
  remove: bi("Remove", "Прибрати"),
  signing: bi("How a delivery is signed", "Як підписано доставку"),
  signingBody: bi(
    "Three headers and an HMAC-SHA256 over the delivery's id, its second and the body. A receiver that checks only the signature is not protected: the same bytes verify for ever. Refuse a timestamp outside the window, and refuse an id you have already taken.",
    "Три заголовки й HMAC-SHA256 над ідентифікатором доставки, її секундою й тілом. Приймач, який перевіряє лише підпис, не захищений: ті самі байти перевіряються завжди. Відхиляй мітку часу поза вікном і відхиляй ідентифікатор, який уже брав.",
  ),
  deliveries: bi("Deliveries", "Доставки"),
  deliveriesEmpty: bi("Nothing sent yet.", "Ще нічого не надсилали."),
  delivered: bi("Delivered", "Доставлено"),
  failedState: bi("Failed", "Не доставлено"),
  attempts: bi("Attempts", "Спроб"),
  answer: bi("Answer", "Відповідь"),
  when: bi("When", "Коли"),

  usage: bi("Usage", "Використання"),
  window: bi("Window", "Вікно"),
  used: bi("Spent", "Витрачено"),
  left: bi("Left", "Лишилось"),
  resets: bi("Starts again", "Починається знову"),
  noLimit: bi("no number set", "число не задано"),
  quotaHint: bi(
    "Calls are counted whether or not a number is set for the window. Where none is set nothing is refused on a guess — the figures are put in place outside this build.",
    "Виклики рахуємо незалежно від того, чи задано число для вікна. Де не задано, нічого не відмовляємо навмання — числа задають поза цією збіркою.",
  ),
  pricing: bi("Tariffs", "Тарифи"),
  pricingBody: bi(
    "The fields a tariff has are here; the numbers are not. A price, an included call count and a ceiling are set outside this build, so nothing here states one.",
    "Поля тарифу тут є, чисел немає. Ціну, включені виклики й стелю задають поза цією збіркою, тож тут жодного числа немає.",
  ),

  rights: bi("What your role allows here", "Що дозволяє твоя роль"),
  rightsHint: bi("Each line is the server's own answer for your wallet, asked before the page drew the button.", "Кожен рядок — відповідь самого сервера для твого гаманця, запитана ще до того, як сторінка намалювала кнопку."),
  yes: bi("Yes", "Так"),
  no: bi("No", "Ні"),
  failed: bi("Not done: {why}", "Не зроблено: {why}"),
  unavailable: bi("The console could not be read now. Try again in a moment.", "Консоль зараз не прочитано. Спробуй за хвилину."),
} as const;

export type ConsoleWordKey = keyof typeof CONSOLE_WORDS;

export function consoleWords(locale: WorkspaceLocale) {
  return (key: ConsoleWordKey, values: Readonly<Record<string, string | number>> = {}) =>
    CONSOLE_WORDS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

export const ENVIRONMENT_WORDS: Readonly<Record<DevEnvironment, Readonly<{ en: string; uk: string }>>> = {
  test: bi("Test", "Тест"),
  live: bi("Live", "Робоче"),
};

export const KIND_WORDS: Readonly<Record<DevCredentialKind, Readonly<{ en: string; uk: string }>>> = {
  SECRET: bi("Secret — a server's, never a browser's", "Секретний — для сервера, ніколи не для браузера"),
  PUBLIC: bi("Public — a browser's, bound to its origins", "Публічний — для браузера, прив'язаний до своїх origin"),
};

export const KEY_STATE_WORDS: Readonly<Record<DevKeyState, Readonly<{ en: string; uk: string }>>> = {
  ACTIVE: bi("Active", "Чинний"),
  ROTATING: bi("Rotating — answers until its hour", "Ротація — відповідає до своєї години"),
  REVOKED: bi("Revoked", "Відкликано"),
};

export const SCOPE_WORDS: Readonly<Record<DevScope, Readonly<{ en: string; uk: string }>>> = {
  "read:key": bi("Read the key itself and its quota", "Читати сам ключ і його квоту"),
  "read:usage": bi("Read the project's usage", "Читати використання проєкту"),
  "read:events": bi("Read the delivery log", "Читати журнал доставок"),
};

export const EVENT_WORDS: Readonly<Record<DevWebhookEvent, Readonly<{ en: string; uk: string }>>> = {
  ping: bi("ping — the console's test delivery", "ping — тестова доставка з консолі"),
};

export const WINDOW_WORDS: Readonly<Record<DevQuotaWindow, Readonly<{ en: string; uk: string }>>> = {
  minute: bi("A minute", "Хвилина"),
  day: bi("A day", "Доба"),
  month: bi("A month", "Місяць"),
};

export const ACTION_WORDS: Readonly<Record<DevAction, Readonly<{ en: string; uk: string }>>> = {
  readProject: bi("Read the project", "Читати проєкт"),
  createProject: bi("Make a project", "Створювати проєкт"),
  draftEndpoint: bi("Draft an endpoint", "Готувати вебхук"),
  issueKey: bi("Issue a key", "Створювати ключ"),
  rotateKey: bi("Rotate a key", "Робити ротацію ключа"),
  revokeKey: bi("Revoke a key", "Відкликати ключ"),
  changeKey: bi("Change a key's bounds", "Змінювати межі ключа"),
  changeEndpoint: bi("Change an endpoint", "Змінювати вебхук"),
  sendTest: bi("Send a test delivery", "Надсилати тестову доставку"),
  readDeliveries: bi("Read the delivery log", "Читати журнал доставок"),
};

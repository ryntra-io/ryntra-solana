import type { MonitorStatus } from '../../lib/api.ts'
import type { Copy } from '../../lib/i18n.ts'

/**
 * The words of the monitoring surfaces — the inbox, the note, the
 * preferences, the resolver — in both languages. Where the web's monitoring
 * page has the same word, it is the same word here, so a note read on
 * ryntra.io reads the same on the phone. A note's own title and reason are
 * the server's words and are never rewritten.
 */
const EN = {
  title: 'Monitoring',
  inboxTitle: 'Inbox',
  attention: 'Needs attention',
  watching: 'Watching',
  recent: 'Recent',
  unread: (n: number) => (n === 1 ? '1 unread' : `${n} unread`),
  allRead: 'All read',
  emptyAttention: 'Nothing needs you right now.',
  emptyRecent: 'No notes yet.',
  noPlansTitle: 'Nothing to watch yet',
  noPlansDetail:
    'When you activate a plan, Ryntra watches its rules and writes you one note when something material changes.',
  openPlans: 'Bots',
  couldNotLoad: 'Inbox could not be read right now.',
  loading: 'Reading your plans',
  lastChecked: 'Last checked',
  checked: 'checked',
  notChecked: 'Not checked yet',
  status: {
    watching: 'Watching',
    needs_attention: 'Needs attention',
    paused: 'Paused',
    unavailable: 'Data unavailable',
  } satisfies Record<Exclude<MonitorStatus, string & {}>, string>,
  paper: 'Paper',
  markRead: 'Mark as read',
  markAllRead: 'Mark all as read',
  markedRead: 'Read',
  noteLanguage: (language: string) => `Written in ${language}`,
  languageName: { en: 'English', uk: 'Ukrainian' },
  openPlan: 'Open plan',
  reviewPlan: 'Review plan',
  openOnWeb: 'Open on ryntra.io',
  attentionBanner: 'Something in this plan changed. Review it on today’s figures — a note is not permission to trade.',
  // the resolver
  resolving: 'Opening your plan',
  choosePlanTitle: (symbol: string) => `Which ${symbol} plan?`,
  choosePlanDetail:
    'The note names the stock, not the plan, and more than one of your plans is on it. Pick the one to open.',
  goneTitle: 'This plan is no longer among your plans',
  goneDetail: 'The note stays here; the plan it spoke of was removed or belongs to another wallet.',
  unknownTitle: 'This note is not in your inbox',
  unknownDetail: 'It may belong to another wallet, or it was written before this sign-in.',
  webTitle: 'This opens on ryntra.io',
  webDetail: 'The phone has no screen for it yet. Ryntra opens it in your browser.',
  backToInbox: 'Back to Inbox',
  // the preferences
  settings: 'Notification settings',
  where: 'Where notes go',
  inApp: 'In Ryntra',
  telegram: 'Telegram',
  telegramConnect: 'Connect Telegram',
  telegramOff: 'Not connected',
  telegramOn: (username: string | null) => (username ? `Connected · @${username}` : 'Connected'),
  telegramWaiting: 'Press Start in Telegram',
  telegramOpen: 'Open Telegram',
  telegramExpired: 'The link expired — connect again',
  telegramDisconnect: 'Disconnect',
  telegramDisconnectAsk: 'Notes will stop reaching Telegram.',
  telegramKeep: 'Keep',
  telegramFailed: 'Telegram could not be reached — try again.',
  thisPhone: 'This phone',
  phoneOn: 'Notes reach this phone.',
  phoneRegistered: (at: string) => `Registered ${at}`,
  phoneOff: 'Notes do not reach this phone.',
  phoneNoPermission: 'Android blocks notifications from Ryntra — allow them in the system settings.',
  phoneNoConfig: 'Notes stay in the inbox for now.',
  phoneWebOff: 'Turned off on ryntra.io',
  openSystemSettings: 'Open system settings',
  turnOn: 'Turn on',
  quiet: 'Quiet hours',
  quietOff: 'No quiet hours',
  quietFrom: 'From',
  quietUntil: 'Until',
  quietTimezone: 'Timezone',
  quietNow: 'Quiet now',
  clockNeeded: 'A time on a 24-hour clock, like 22:00',
  save: 'Save',
  saved: 'Saved',
  saveFailed: 'The change was not saved. Try again.',
  presets: 'Presets',
  off: 'Off',
  on: 'On',
  // the inbox's soft prompt
  promptTitle: 'Get notes on this phone',
} as const

export type MonitoringCopy = {
  readonly [K in keyof typeof EN]: (typeof EN)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof EN)[K] extends string
      ? string
      : (typeof EN)[K] extends Readonly<Record<string, string>>
        ? Readonly<Record<keyof (typeof EN)[K], string>>
        : (typeof EN)[K]
}

const UK: MonitoringCopy = {
  title: 'Моніторинг',
  inboxTitle: 'Вхідні',
  attention: 'Потребує уваги',
  watching: 'Стежимо',
  recent: 'Нещодавні',
  unread: (n: number) => {
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 === 1 && mod100 !== 11) return `${n} непрочитана`
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} непрочитані`
    return `${n} непрочитаних`
  },
  allRead: 'Усе прочитано',
  emptyAttention: 'Зараз нічого не потребує тебе.',
  emptyRecent: 'Нотаток ще немає.',
  noPlansTitle: 'Поки нема за чим стежити',
  noPlansDetail:
    'Коли активуєш план, Ryntra стежитиме за його правилами й напише одну нотатку, коли зміниться щось суттєве.',
  openPlans: 'Боти',
  couldNotLoad: 'Вхідні зараз не вдалося прочитати.',
  loading: 'Читаємо твої плани',
  lastChecked: 'Остання перевірка',
  checked: 'перевірено',
  notChecked: 'Ще не перевірено',
  status: {
    watching: 'Стежимо',
    needs_attention: 'Потребує уваги',
    paused: 'Пауза',
    unavailable: 'Немає даних',
  },
  paper: 'Папір',
  markRead: 'Позначити прочитаним',
  markAllRead: 'Позначити все прочитаним',
  markedRead: 'Прочитано',
  noteLanguage: (language: string) => `Написано ${language}`,
  languageName: { en: 'англійською', uk: 'українською' },
  openPlan: 'Відкрити план',
  reviewPlan: 'Переглянути план',
  openOnWeb: 'Відкрити на ryntra.io',
  attentionBanner:
    'У цьому плані щось змінилось. Переглянь його на сьогоднішніх цифрах — нотатка не є дозволом торгувати.',
  resolving: 'Відкриваємо твій план',
  choosePlanTitle: (symbol: string) => `Який план на ${symbol}?`,
  choosePlanDetail: 'Нотатка називає акцію, а не план, і на ній більше ніж один твій план. Обери, який відкрити.',
  goneTitle: 'Цього плану вже нема серед твоїх',
  goneDetail: 'Нотатка лишається тут; план, про який вона говорила, видалено або він належить іншому гаманцю.',
  unknownTitle: 'Цієї нотатки нема у твоїй скриньці',
  unknownDetail: 'Вона може належати іншому гаманцю або бути написана до цього входу.',
  webTitle: 'Це відкривається на ryntra.io',
  webDetail: 'На телефоні для цього ще немає екрана. Ryntra відкриє його у браузері.',
  backToInbox: 'До Вхідних',
  settings: 'Налаштування сповіщень',
  where: 'Куди йдуть нотатки',
  inApp: 'У Ryntra',
  telegram: 'Telegram',
  telegramConnect: 'Підключити Telegram',
  telegramOff: 'Не підключено',
  telegramOn: (username) => (username ? `Підключено · @${username}` : 'Підключено'),
  telegramWaiting: 'Натисни Start у Telegram',
  telegramOpen: 'Відкрити Telegram',
  telegramExpired: 'Посилання застаріло — підключи ще раз',
  telegramDisconnect: 'Відключити',
  telegramDisconnectAsk: 'Нотатки перестануть приходити в Telegram.',
  telegramKeep: 'Залишити',
  telegramFailed: 'Telegram зараз не відповідає — спробуй ще раз.',
  thisPhone: 'Цей телефон',
  phoneOn: 'Нотатки доходять на цей телефон.',
  phoneRegistered: (at: string) => `Зареєстровано ${at}`,
  phoneOff: 'Нотатки не доходять на цей телефон.',
  phoneNoPermission: 'Android блокує сповіщення від Ryntra — дозволь їх у системних налаштуваннях.',
  phoneNoConfig: 'Поки нотатки лишаються у Вхідних.',
  phoneWebOff: 'Вимкнено на ryntra.io',
  openSystemSettings: 'Відкрити системні налаштування',
  turnOn: 'Увімкнути',
  quiet: 'Тихі години',
  quietOff: 'Без тихих годин',
  quietFrom: 'З',
  quietUntil: 'До',
  quietTimezone: 'Часовий пояс',
  quietNow: 'Зараз тихо',
  clockNeeded: 'Час на 24-годинному циферблаті, як-от 22:00',
  save: 'Зберегти',
  saved: 'Збережено',
  saveFailed: 'Зміну не збережено. Спробуй ще раз.',
  presets: 'Швидкий вибір',
  off: 'Вимк.',
  on: 'Увімк.',
  promptTitle: 'Отримуй нотатки на цей телефон',
}

export const MONITORING_COPY: Copy<MonitoringCopy> = { en: EN, uk: UK }

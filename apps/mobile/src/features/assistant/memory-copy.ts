import type { Copy } from '../../lib/i18n.ts'

/**
 * The words of «Знайомство» (1.58.0) and «Що Ryntra знає про тебе» (1.59.0) in both languages — the web's words
 * (`app/app/ryn/ryn-words.ts`: ob*, mem*), shortened where a phone line is narrower. The assistant is Ryntra; it is an
 * AI, and what the person says shapes only how it explains — never a buy or a sell.
 */
const EN = {
  // «Знайомство»
  meetTitle: 'Five questions, one minute',
  meetLead: 'So Ryntra speaks your language. You can skip and change it later.',
  meetStep: (n: number) => `${n} of 5`,
  meetSkip: 'Skip',
  meetBack: 'Back',
  meetCancel: 'Cancel',
  meetClose: 'Close',
  meetNext: 'Next',
  meetSave: 'Done',
  meetFailed: 'Could not save — try again.',
  meetGoal: 'What do you want from Ryntra?',
  meetGoalLearn: 'Understand the market',
  meetGoalTrade: 'Trade on my own',
  meetGoalHold: 'Hold and keep an eye',
  meetExperience: 'How much have you traded?',
  meetExpNew: 'Just starting',
  meetExpSome: 'A little',
  meetExpPro: 'Plenty',
  meetRisk: 'How much of your money may one trade lose?',
  meetRiskNote: 'Of what you trade with. 1 % is a common start.',
  meetHorizon: 'How long do you usually hold?',
  meetHorHours: 'Hours',
  meetHorDays: 'Days',
  meetHorWeeks: 'Weeks and longer',
  meetWhere: 'Where should Ryntra write?',
  meetInbox: 'Inbox — always',
  meetQuiet: (start: string, end: string) => `Quiet ${start}–${end}`,
  meetQuietHint: 'Telegram and push wait till morning',
  meetDone: 'Done. Ryntra will word its answers for you.',
  meetFirstWatch: 'Watch a first token',
  // the answers in one line
  summaryYou: (parts: string) => `You: ${parts}`,
  summaryGoal: { learn: 'learning', trade: 'trading', hold: 'holding' },
  summaryExp: { new: 'new', some: 'some experience', pro: 'experienced' },
  summaryHorizon: { hours: 'hours', days: 'days', weeks: 'weeks' },
  summaryRisk: (pct: string) => `risk ${pct} %`,
  // «Що Ryntra знає про тебе»
  memTitle: 'What Ryntra knows about you',
  memLead: 'Your own words only. They change how Ryntra explains — never what is true or what to do.',
  memProfile: 'Your answers',
  memProfileNone: 'Not answered yet',
  memProfileSkipped: 'Skipped',
  memChange: 'Change',
  memAbout: 'About me',
  memAboutPlaceholder: 'E.g. I trade memecoins on Solana for a few days at a time, no leverage.',
  memSave: 'Save',
  memNotes: 'What Ryntra remembered',
  memNoticing: 'Notice',
  memNoticingHint: 'Ryntra keeps what you say about yourself',
  memNoNotes: 'Nothing yet. Say «remember: …» in the conversation.',
  memSource: { said: 'from the conversation', asked: 'at your ask', typed: 'added by hand' },
  memForget: 'Forget',
  memAddLabel: 'Add a line about yourself',
  memAddPlaceholder: 'One line about you',
  memAdd: 'Add',
  memWallet: (what: string) => `Your wallet now: ${what}`,
  memWalletHolds: (tokens: string, largest: string) => `${tokens} · the largest ${largest}`,
  memTokens: (n: number) => `${n} ${n === 1 ? 'token' : 'tokens'}`,
  memForgetAll: 'Forget everything',
  memForgetAllAsk: '«About me» and every note will be gone.',
  memForgetAllYes: 'Forget',
  memForgetAllNo: 'Keep',
  memFailed: 'The memory could not be read or written right now.',
  memSecret: 'That looks like a key, a password or a recovery phrase — Ryntra never keeps those.',
  memRemembered: 'Remembered:',
} as const

export type MemoryCopy = {
  readonly [K in keyof typeof EN]: (typeof EN)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof EN)[K] extends string
      ? string
      : Readonly<Record<keyof (typeof EN)[K], string>>
}

const UK: MemoryCopy = {
  meetTitle: 'П’ять питань — за хвилину',
  meetLead: 'Щоб Ryntra говорила твоєю мовою. Можна пропустити й змінити потім.',
  meetStep: (n) => `${n} з 5`,
  meetSkip: 'Пропустити',
  meetBack: 'Назад',
  meetCancel: 'Скасувати',
  meetClose: 'Закрити',
  meetNext: 'Далі',
  meetSave: 'Готово',
  meetFailed: 'Не вдалося зберегти — спробуй ще.',
  meetGoal: 'Чого хочеш від Ryntra?',
  meetGoalLearn: 'Розуміти ринок',
  meetGoalTrade: 'Торгувати самостійно',
  meetGoalHold: 'Тримати й стежити',
  meetExperience: 'Який у тебе досвід угод?',
  meetExpNew: 'Лише починаю',
  meetExpSome: 'Трохи',
  meetExpPro: 'Багато',
  meetRisk: 'Яку частку можна втратити на одній угоді?',
  meetRiskNote: 'Від суми, якою торгуєш. 1 % — звичний початок.',
  meetHorizon: 'Скільки зазвичай тримаєш?',
  meetHorHours: 'Години',
  meetHorDays: 'Дні',
  meetHorWeeks: 'Тижні й довше',
  meetWhere: 'Куди писати?',
  meetInbox: 'Вхідні — завжди',
  meetQuiet: (start, end) => `Тихо ${start}–${end}`,
  meetQuietHint: 'Telegram і push чекають ранку',
  meetDone: 'Готово. Ryntra говоритиме під тебе.',
  meetFirstWatch: 'Стежити за першим токеном',
  summaryYou: (parts) => `Ти: ${parts}`,
  summaryGoal: { learn: 'вчуся', trade: 'торгую', hold: 'тримаю' },
  summaryExp: { new: 'новачок', some: 'трохи досвіду', pro: 'досвідчений' },
  summaryHorizon: { hours: 'години', days: 'дні', weeks: 'тижні' },
  summaryRisk: (pct) => `ризик ${pct} %`,
  memTitle: 'Що Ryntra знає про тебе',
  memLead: 'Лише твої слова. Вони змінюють, як Ryntra пояснює, — ніколи не що правда й що робити.',
  memProfile: 'Твої відповіді',
  memProfileNone: 'Ще без відповідей',
  memProfileSkipped: 'Пропущено',
  memChange: 'Змінити',
  memAbout: 'Про мене',
  memAboutPlaceholder: 'Напр. торгую мемкоїнами на Solana по кілька днів, плече не люблю.',
  memSave: 'Зберегти',
  memNotes: 'Що Ryntra запам’ятала',
  memNoticing: 'Помічати',
  memNoticingHint: 'Ryntra запам’ятовує, що ти кажеш про себе',
  memNoNotes: 'Поки нічого. Скажи в розмові «запам’ятай: …».',
  memSource: { said: 'з розмови', asked: 'на твоє прохання', typed: 'додано вручну' },
  memForget: 'Забути',
  memAddLabel: 'Додати рядок про себе',
  memAddPlaceholder: 'Один рядок про тебе',
  memAdd: 'Додати',
  memWallet: (what) => `Твій гаманець зараз: ${what}`,
  memWalletHolds: (tokens, largest) => `${tokens} · найбільші ${largest}`,
  memTokens: (n) => {
    const ten = n % 10
    const hundred = n % 100
    if (ten === 1 && hundred !== 11) return `${n} токен`
    if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return `${n} токени`
    return `${n} токенів`
  },
  memForgetAll: 'Забути все',
  memForgetAllAsk: '«Про мене» і всі рядки зникнуть.',
  memForgetAllYes: 'Забути',
  memForgetAllNo: 'Залишити',
  memFailed: 'Пам’ять зараз не прочитати й не записати.',
  memSecret: 'Схоже на ключ, пароль чи фразу відновлення — такого Ryntra не зберігає.',
  memRemembered: 'Запам’ятала:',
}

export const MEMORY_COPY: Copy<MemoryCopy> = { en: EN, uk: UK }

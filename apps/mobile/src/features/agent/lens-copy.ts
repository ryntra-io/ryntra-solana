import type { AgentCriticKind, AgentState } from '../../lib/api/v1/types.ts'
import type { Copy, Locale } from '../../lib/i18n.ts'
import { creditsText } from '../assistant/credits-model.ts'
import { formatCount } from '../../utils/format.ts'
import type { CriticOffer } from './lens-model.ts'

/**
 * The Lens — the brief and the critic on a subject — in both languages: the web's words (`app/app/lens/lens-words.ts`)
 * for the chrome around the server's sentences, which arrive already in the reader's language. Nothing here is an
 * instruction: Ryntra researches and challenges; the Review, the confirmation and the signature are the person's.
 */
const EN = {
  brief: 'Brief',
  critic: 'Critic',
  changed: 'What changed',
  matters: 'What matters here',
  supports: 'What the data says',
  unknown: 'What is unknown',
  checks: 'What to check next',
  more: 'The data, the gaps and what to check',
  challenge: (price: string | null) => (price ? `Challenge this · ${price}` : 'Challenge this'),
  challenging: 'Reading against it…',
  againBrief: 'Back to the brief',
  reading: 'Reading…',
  insufficient: 'Insufficient data — nothing here could be read, so nothing is claimed.',
  criticInsufficient: 'Insufficient data — there is nothing to argue against yet.',
  gaps: 'What could not be challenged',
  notChallenged: 'Silence here is not agreement.',
  sources: (count: number) => `Sources · ${count}`,
  guestLine: 'The brief reads your own plans, holdings and record — sign in with your wallet once.',
  chat: 'Chat with Ryntra',
  composedDeterministic: 'Composed from the reads',
  composedModel: 'Worded by the model, verified against the reads',
  observed: (when: string) => `Read ${when}`,
  noTime: 'no time stated',
  boundary:
    'Ryntra researches and challenges. It never buys, sells or signs — the Review, your confirmation and your signature do.',
  // the critic's price, before the press
  paidFree: 'Today’s free credits pay for it',
  paidBalance: (rest: string, balance: string) => `${rest} from the balance (${balance})`,
  short: 'Not enough credits',
  dayCap: 'The day’s credit limit is reached',
  fromReads: 'The critic is then composed from the reads, without the model — nothing is taken.',
  topUp: 'Top up',
  // failures
  failed: 'This could not be read right now.',
  criticFailed: 'The critic could not be read right now. The brief stays as it was.',
  busy: 'One question of this wallet is already being answered.',
  network: 'No connection.',
  budget: 'The assistant’s allowance for today is spent.',
  signIn: 'The wallet’s session has ended — sign in again.',
  state: { current: 'current', stale: 'stale', unavailable: 'unavailable', unknown: 'unknown' } satisfies Record<
    AgentState,
    string
  >,
  kind: {
    'assumption-conflict': 'Assumption',
    'risk-not-established': 'Risk not established',
    'plan-condition-unmet': 'Plan condition',
    'previous-result': 'Your own record',
    'evidence-missing': 'Evidence',
    'asset-structure': 'Asset structure',
    'thesis-weakness': 'Thesis',
  } satisfies Record<AgentCriticKind, string>,
}

export type LensCopy = {
  readonly [K in keyof typeof EN]: (typeof EN)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof EN)[K]
}

const UK: LensCopy = {
  brief: 'Стисло',
  critic: 'Критик',
  changed: 'Що змінилося',
  matters: 'Що тут важливо',
  supports: 'Що кажуть дані',
  unknown: 'Що невідомо',
  checks: 'Що перевірити далі',
  more: 'Дані, прогалини і що перевірити',
  challenge: (price) => (price ? `Оскаржити це · ${price}` : 'Оскаржити це'),
  challenging: 'Читаю проти…',
  againBrief: 'Назад до стислого',
  reading: 'Читаю…',
  insufficient: 'Даних недостатньо — тут нічого не вдалося прочитати, тож нічого й не стверджується.',
  criticInsufficient: 'Даних недостатньо — поки що нема з чим сперечатися.',
  gaps: 'Що не вдалося оскаржити',
  notChallenged: 'Мовчання тут не є згодою.',
  sources: (count) => `Джерела · ${count}`,
  guestLine: 'Стислий огляд читає твої власні плани, активи й запис — увійди гаманцем один раз.',
  chat: 'Розмова з Ryntra',
  composedDeterministic: 'Складено з читань',
  composedModel: 'Слова моделі, звірені з читаннями',
  observed: (when) => `Прочитано ${when}`,
  noTime: 'час не вказано',
  boundary:
    'Ryntra досліджує й оскаржує. Вона ніколи не купує, не продає і не підписує — це роблять Review, твоє підтвердження і твій підпис.',
  paidFree: 'Оплатять безкоштовні кредити дня',
  paidBalance: (rest, balance) => `${rest} з балансу (${balance})`,
  short: 'Бракує кредитів',
  dayCap: 'Денний ліміт кредитів досягнуто',
  fromReads: 'Тоді критик складеться з читань, без моделі — нічого не списується.',
  topUp: 'Поповнити',
  failed: 'Це зараз не вдалося прочитати.',
  criticFailed: 'Критика зараз не вдалося прочитати. Стисле лишається, як було.',
  busy: 'На одне питання цього гаманця вже відповідають.',
  network: 'Немає з’єднання.',
  budget: 'Ліміт помічника на сьогодні вичерпано.',
  signIn: 'Сесія гаманця скінчилася — увійди знову.',
  state: { current: 'актуально', stale: 'застаріло', unavailable: 'недоступно', unknown: 'невідомо' },
  kind: {
    'assumption-conflict': 'Припущення',
    'risk-not-established': 'Ризик не встановлено',
    'plan-condition-unmet': 'Умова плану',
    'previous-result': 'Твій власний запис',
    'evidence-missing': 'Докази',
    'asset-structure': 'Структура активу',
    'thesis-weakness': 'Теза',
  },
}

export const LENS_COPY: Copy<LensCopy> = { en: EN, uk: UK }

/** The short label a finding wears, so a reader learns the seven kinds once (the web's `criticKindLabel`). */
export function criticKindLabel(kind: AgentCriticKind, copy: LensCopy): string {
  return copy.kind[kind] ?? kind
}

/**
 * The critic's press as the screen says it: the button's words with the price on it when it is paid now, the line
 * beside it — what pays it, or that the credits are short — and whether the door «Поповнити» stands beside it.
 */
export type CriticWords = Readonly<{ button: string; paid: string | null; note: string | null; topUp: boolean }>

export function criticWords(offer: CriticOffer, copy: LensCopy, locale: Locale): CriticWords {
  if (offer.kind === 'none') return { button: copy.challenge(null), paid: null, note: null, topUp: false }
  const { paid, price } = offer
  switch (paid.kind) {
    case 'free':
      return {
        button: copy.challenge(price > 0 ? creditsText(price, locale) : null),
        paid: price > 0 ? copy.paidFree : null,
        note: null,
        topUp: false,
      }
    case 'balance':
      return {
        button: copy.challenge(creditsText(price, locale)),
        paid: copy.paidBalance(creditsText(paid.rest, locale), formatCount(offer.balance, locale)),
        note: null,
        topUp: false,
      }
    case 'short':
      return { button: copy.challenge(null), paid: copy.short, note: copy.fromReads, topUp: true }
    case 'dayCap':
      return { button: copy.challenge(null), paid: copy.dayCap, note: copy.fromReads, topUp: false }
  }
}

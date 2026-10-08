import type { Copy, Locale } from '../../lib/i18n.ts'

/**
 * What a person actually buys, one label per issuer from the issuer's own
 * documents — the web's `?` beside «Що ти купуєш» (`help-topics.ts`,
 * the truth topics), word for word: the label, its one line, what it is, a
 * simple example and the one limitation a person must know. No asset here is
 * «a real share». The issuer's fee on a private company's token is the one the
 * chain states, filled in where the line names it — never a rate typed here.
 */

export type TruthTopicId = 'truthXStocks' | 'truthOndo' | 'truthBackpack' | 'truthPreStocks'

export type TruthTopic = Readonly<{
  title: string
  /** One line, under the label. */
  short: string
  /** What it is, one or two sentences. */
  what: string
  example: readonly string[]
  /** The one limitation a person must know. */
  important: string
}>

type TruthTopics = Readonly<Record<TruthTopicId, TruthTopic>>

const EN: TruthTopics = {
  truthXStocks: {
    title: 'Backed tracker',
    short: 'Tracks the share price. A custodian holds the share. No voting.',
    what: 'By the issuer’s documents an xStocks token is a tracker certificate from Backed Assets (Jersey), backed one to one by the share a custodian holds. It is not direct ownership of the company.',
    example: ['You buy SPYx: its price follows the SPY share, and the token stays in your wallet.'],
    important: 'No vote at the company’s meetings. Not for U.S. persons; availability depends on your country.',
  },
  truthOndo: {
    title: 'Backed tracker',
    short: 'Tracks the price and the dividends. It is not a share.',
    what: 'By the issuer’s documents an Ondo token is a fully backed total-return tracker: it follows the share with its dividends, and it is not itself a stock, an ETF or an ADR.',
    example: ['You hold the token, not the share; there is no dividend payout to your wallet.'],
    important: 'No vote and no claim on the share itself. Not for U.S. persons.',
  },
  truthBackpack: {
    title: 'Tracker · exchangeable for the share',
    short: 'Can be exchanged for the share through a Backpack account with KYC. No voting yet.',
    what: 'By the issuer’s documents the token in your wallet is a claim on a vehicle that holds the share. Inside a Backpack account with KYC it can be exchanged one to one for the share itself.',
    example: ['In your wallet: the token. In a verified Backpack account: the share, one for one.'],
    important: 'Voting and cash dividends are not available yet. Not for the U.S., the UK, the UAE or Japan.',
  },
  truthPreStocks: {
    title: 'Economic exposure · private',
    // The issuer's fee and its power to freeze stand under the company's name and in the facts below.
    short: 'No ownership, no vote, no dividends. Selling may not be possible.',
    what: 'By the issuer’s documents the token gives only economic exposure to a private company through a holding entity — no ownership, voting, dividend or information rights. The mint itself withholds a fee on every transfer, and its settings let the issuer freeze the token, pause transfers, and move or burn it from any wallet.',
    example: ['The company is not listed: the token’s price is what the pool pays, not a stock-exchange price.'],
    important: 'A full loss is possible and liquidity is not guaranteed. Not for U.S. persons.',
  },
}

const UK: TruthTopics = {
  truthXStocks: {
    title: 'Трекер із забезпеченням',
    short: 'Відстежує ціну акції. Акцію тримає кастодіан. Голосу немає.',
    what: 'За документами емітента токен xStocks — сертифікат-трекер від Backed Assets (Джерсі), забезпечений один до одного акцією, яку тримає кастодіан. Це не пряма власність у компанії.',
    example: ['Купуєш SPYx: його ціна йде за акцією SPY, а токен лежить у твоєму гаманці.'],
    important: 'Голосу на зборах компанії немає. Не для осіб із США; доступність залежить від країни.',
  },
  truthOndo: {
    title: 'Трекер із забезпеченням',
    short: 'Відстежує ціну й дивіденди. Це не акція.',
    what: 'За документами емітента токен Ondo — повністю забезпечений трекер повної дохідності: іде за акцією разом із її дивідендами і сам не є ні акцією, ні ETF, ні ADR.',
    example: ['У тебе токен, а не акція; виплати дивідендів на гаманець немає.'],
    important: 'Голосу й права на саму акцію немає. Не для осіб із США.',
  },
  truthBackpack: {
    title: 'Трекер · обмін на акцію',
    short: 'Можна обміняти на акцію через акаунт Backpack із KYC. Голосу поки немає.',
    what: 'За документами емітента токен у гаманці — вимога до структури, що тримає акцію. В акаунті Backpack із KYC його можна обміняти на саму акцію один до одного.',
    example: ['У гаманці — токен. В акаунті Backpack із перевіркою — акція, один до одного.'],
    important: 'Голос і грошові дивіденди поки недоступні. Не для США, Великої Британії, ОАЕ та Японії.',
  },
  truthPreStocks: {
    title: 'Економічна експозиція · приватна',
    short: 'Ні власності, ні голосу, ні дивідендів. Продати може не вийти.',
    what: 'За документами емітента токен дає лише економічну експозицію до приватної компанії через холдингову структуру — без прав власності, голосу, дивідендів чи інформації. Сам mint утримує комісію з кожного переказу, а його налаштування дають емітентові змогу заморозити токен, зупинити перекази, перемістити чи спалити його з будь-якого гаманця.',
    example: ['Компанія не на біржі: ціна токена — те, що платить пул, а не біржова ціна.'],
    important: 'Можлива повна втрата, ліквідність не гарантована. Не для осіб із США.',
  },
}

export const TRUTH_TOPICS: Copy<TruthTopics> = { en: EN, uk: UK }

/** `{fee}` in a topic's text: « (1,0%)» where the chain states a fee, nothing where it does not — the web's own rule. */
function fill(text: string, fee: string | null): string {
  if (!text.includes('{fee}')) return text
  const stated = fee?.trim()
  return text.split('{fee}').join(stated ? ` (${stated})` : '')
}

/** The topic in the reader's language, the fee the chain states filled in. */
export function truthTopicText(id: TruthTopicId, locale: Locale, fee: string | null = null): TruthTopic {
  const topic = TRUTH_TOPICS[locale][id]
  return {
    title: topic.title,
    short: fill(topic.short, fee),
    what: fill(topic.what, fee),
    example: topic.example.map((line) => fill(line, fee)),
    important: fill(topic.important, fee),
  }
}

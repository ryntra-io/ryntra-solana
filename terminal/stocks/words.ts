import { words } from '../../city/lib/i18n/dict.ts';

/**
 * The words of a stock's facts on a pool page: the exchange's state with the time it next changes, the
 * guard around a dividend or a split, and the issuer's terms behind «i».
 */
export const STOCK_FACTS = words(
  {
    label: 'Stock',
    open: 'Exchange open',
    openUntil: (time: string) => `Exchange open · closes ${time}`,
    closed: 'Exchange closed',
    closedUntil: (time: string) => `Exchange closed · opens ${time}`,
    pre: 'Pre-market',
    preUntil: (time: string) => `Pre-market · opens ${time}`,
    post: 'After hours',
    postUntil: (time: string) => `After hours · until ${time}`,
    dividendFrom: (time: string) => `Dividend guard from ${time}`,
    dividendUntil: (time: string) => `Dividend guard · new deposits wait until ${time}`,
    splitFrom: (time: string) => `Split guard from ${time}`,
    splitUntil: (time: string) => `Split guard · new deposits wait until ${time}`,
    stepFrom: (time: string) => `Issuer step guard from ${time}`,
    stepUntil: (time: string) => `Issuer step guard · new deposits wait until ${time}`,
    terms: 'Issuer terms',
    issuedBy: (issuer: string) => `Issued by ${issuer}`,
    read: 'Read the terms',
  },
  {
    label: 'Акція',
    open: 'Біржа відкрита',
    openUntil: (time: string) => `Біржа відкрита · закриється о ${time}`,
    closed: 'Біржа закрита',
    closedUntil: (time: string) => `Біржа закрита · відкриється о ${time}`,
    pre: 'До відкриття біржі',
    preUntil: (time: string) => `До відкриття · відкриється о ${time}`,
    post: 'Після закриття біржі',
    postUntil: (time: string) => `Після закриття · до ${time}`,
    dividendFrom: (time: string) => `Захист дивідендів з ${time}`,
    dividendUntil: (time: string) => `Захист дивідендів · нові внески чекають до ${time}`,
    splitFrom: (time: string) => `Захист спліту з ${time}`,
    splitUntil: (time: string) => `Захист спліту · нові внески чекають до ${time}`,
    stepFrom: (time: string) => `Захист кроку емітента з ${time}`,
    stepUntil: (time: string) => `Захист кроку емітента · нові внески чекають до ${time}`,
    terms: 'Умови емітента',
    issuedBy: (issuer: string) => `Емітент — ${issuer}`,
    read: 'Читати умови',
  },
);

/** The stand's own page for the eyes (`/terminal/kit/stock-facts`, a stand only): its title and the coins it shows. */
export const STOCK_FACTS_STAND = words(
  {
    title: 'Stock facts',
    pool: (coin: string) => `${coin} · USDC`,
    position: (coin: string) => `${coin} · SOL · DLMM Pro`,
    action: 'Add liquidity',
    live: 'Live read',
  },
  {
    title: 'Факти акції',
    pool: (coin: string) => `${coin} · USDC`,
    position: (coin: string) => `${coin} · SOL · DLMM Pro`,
    action: 'Додати ліквідність',
    live: 'Живе читання',
  },
);

/**
 * The one line said before the signature of a position in a pool of a stock, and what stands behind its
 * «i»: the issuer's rights over its token, the exchange's hours, where the issuer does not offer it, and who looks after
 * the position. The words are a person's, never the token program's.
 */
export const STOCK_POSITION = words(
  {
    label: 'Stock in this pool',
    line: 'The issuer can pause this token and take it back, even from the pool.',
    issuerWhy: (issuer: string) =>
      `${issuer} issues this token. It can pause every transfer of it — while it is paused nothing goes into the pool or comes out of it — and it can move or burn the token in any wallet, the pool included.`,
    hoursWhy: 'On Solana the token trades around the clock; the company’s shares trade only while the exchange is open.',
    notOffered: (list: string) => `The issuer does not offer it in: ${list}.`,
    limited: (list: string) => `Only on the issuer’s conditions in: ${list}.`,
    careWhy: 'No agent looks after a position here: you take the fees and leave yourself, whenever you want.',
  },
  {
    label: 'Акція в цьому пулі',
    line: 'Емітент може зупинити цей токен і забрати його — навіть із пулу.',
    issuerWhy: (issuer: string) =>
      `${issuer} випускає цей токен. Він може зупинити всі його перекази — поки діє пауза, у пул і з пулу нічого не рухається, — і може переміщати чи спалювати токен у будь-якому гаманці, зокрема в пулі.`,
    hoursWhy: 'На Solana токен торгується цілодобово, а акції компанії — лише поки біржа відкрита.',
    notOffered: (list: string) => `Емітент не пропонує його: ${list}.`,
    limited: (list: string) => `Лише на умовах емітента: ${list}.`,
    careWhy: 'Агент не доглядає позицію тут: комісії забираєш і виходиш ти сам — коли захочеш.',
  },
);

import type { Copy } from '../../lib/i18n.ts'

/**
 * The words of a sale from a position, in both languages — the web's own for
 * the same sheet, so the phone and ryntra.io say the same thing. The sum, the
 * Review's rows and the wallet's steps share the purchase's words.
 */
export type SaleCopy = Readonly<{
  sell: string
  sellTitle: (company: string) => string
  yourPosition: string
  /** The quick choices' group: shares of the position. */
  quickShares: string
  shareLabel: Readonly<Record<25 | 50 | 75 | 100, string>>
  overPosition: string
  /** «Продати на $10», or «Продати все · $12,50» for the whole position. */
  sellFor: (sum: string, whole: boolean) => string
  /** «У тебе 0,0787 частки Apple ≈ $10,00». */
  heldLine: (units: string, usd: string | null) => string
  rowSell: string
  saleMayFail: string
  nothingToSell: string
  saleUnavailable: string
  companyUnread: string
  reading: string
  sold: string
  nothingSold: string
  saleRejected: string
  saleUnknownTx: string
}>

export const SALE_COPY: Copy<SaleCopy> = {
  en: {
    sell: 'Sell',
    sellTitle: (company) => `Sell ${company}`,
    yourPosition: 'Your position',
    quickShares: 'A share of your position',
    shareLabel: { 25: '25%', 50: '50%', 75: '75%', 100: '100%' },
    overPosition: 'More than your position',
    sellFor: (sum, whole) => (whole ? `Sell all · ${sum}` : `Sell ${sum}`),
    heldLine: (units, usd) => (usd ? `You hold ${units} ≈ ${usd}` : `You hold ${units}`),
    rowSell: 'You sell',
    saleMayFail: 'Selling may not be possible: the issuer promises no liquidity.',
    nothingToSell: 'There is none of this company in your wallet now.',
    saleUnavailable: 'Selling is not available right now.',
    companyUnread: 'This company could not be read right now. Try again in a moment.',
    reading: 'Reading…',
    sold: 'Sold',
    nothingSold: 'Nothing happened — your position did not change. You can try again.',
    saleRejected: 'The network rejected the sale. Only the network fee was spent.',
    saleUnknownTx: 'The outcome is not known yet. Do not sell again until it is.',
  },
  uk: {
    sell: 'Продати',
    sellTitle: (company) => `Продати ${company}`,
    yourPosition: 'Твоя позиція',
    quickShares: 'Частка твоєї позиції',
    shareLabel: { 25: '25%', 50: '50%', 75: '75%', 100: '100%' },
    overPosition: 'Більше, ніж твоя позиція',
    sellFor: (sum, whole) => (whole ? `Продати все · ${sum}` : `Продати на ${sum}`),
    heldLine: (units, usd) => (usd ? `У тебе ${units} ≈ ${usd}` : `У тебе ${units}`),
    rowSell: 'Спишеться',
    saleMayFail: 'Продати може не вийти: емітент ліквідності не обіцяє.',
    nothingToSell: 'Цієї компанії зараз немає в гаманці.',
    saleUnavailable: 'Продаж зараз недоступний.',
    companyUnread: 'Компанію зараз не вдалося прочитати. Спробуй за мить.',
    reading: 'Читаємо…',
    sold: 'Продано',
    nothingSold: 'Нічого не сталося — позиція не змінилась. Можна спробувати ще раз.',
    saleRejected: 'Мережа відхилила продаж. Списано лише плату мережі.',
    saleUnknownTx: 'Результат ще невідомий. Не продавай ще раз, доки він не з’ясується.',
  },
}

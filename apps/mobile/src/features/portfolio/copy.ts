import type { Copy } from '../../lib/i18n.ts'
import type { PortfolioGroup } from './portfolio-model.ts'

const EN = {
  title: 'Portfolio',
  wallet: 'Wallet',
  totalValue: 'Total value',
  today: 'today',
  priced: (priced: number, of: number) => `Priced ${priced} of ${of}`,
  withoutPrice: (count: number) => `${count} without a price`,
  notInTotal: 'not in the total',
  groups: {
    stock: 'Tokenized stocks',
    crypto: 'Crypto',
    meme: 'Memes',
    cash: 'Cash',
    other: 'Other',
  } satisfies Record<PortfolioGroup, string>,
  dust: (count: number) => `Small and unnamed balances · ${count}`,
  hideDust: 'Hide small balances',
  partlyRead: 'Balances partly read',
  notRead: 'Balances could not be read',
  heldBack: (at: string) => `Refresh could not read the balances · showing ${at}`,
  emptyTitle: 'Nothing here yet',
  emptyDetail: 'Your first piece — in Markets.',
  history: 'History',
  rewards: 'Rewards',
  markets: 'Markets',
  didNotLoad: 'Holdings did not load',
  loading: 'Loading holdings',
  // the holding sheet
  amount: 'Amount',
  spendable: 'Available to spend',
  value: 'Value',
  price: 'Price',
  change24h: '24h',
  group: 'Group',
  asset: 'Asset',
  buy: 'Buy',
  sell: 'Sell',
  trade: 'Trade',
  assetHistory: 'History',
  verified: 'Verified',
  flagged: 'Flagged',
  unverified: 'Unverified',
  notListed: 'Not listed by the venue',
  unpriced: 'No price from the venue',
  createPlan: 'Create plan',
} as const

export type PortfolioCopy = {
  readonly [K in keyof typeof EN]: (typeof EN)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof EN)[K] extends Record<string, string>
      ? Readonly<Record<keyof (typeof EN)[K], string>>
      : string
}

const UK: PortfolioCopy = {
  title: 'Портфель',
  wallet: 'Гаманець',
  totalValue: 'Загальна вартість',
  today: 'сьогодні',
  priced: (priced, of) => `Оцінено ${priced} з ${of}`,
  withoutPrice: (count) => `${count} без ціни`,
  notInTotal: 'не в сумі',
  groups: {
    stock: 'Токенізовані акції',
    crypto: 'Крипто',
    meme: 'Меми',
    cash: 'Готівка',
    other: 'Інше',
  },
  dust: (count) => `Дрібні й безіменні залишки · ${count}`,
  hideDust: 'Сховати дрібні залишки',
  partlyRead: 'Баланси прочитано частково',
  notRead: 'Баланси не вдалося прочитати',
  heldBack: (at) => `Оновлення не прочитало баланси · показано ${at}`,
  emptyTitle: 'Поки що порожньо',
  emptyDetail: 'Перша частинка — у Ринках.',
  history: 'Історія',
  rewards: 'Винагороди',
  markets: 'Ринки',
  didNotLoad: 'Активи не завантажились',
  loading: 'Завантаження активів',
  amount: 'Кількість',
  spendable: 'Доступно до витрати',
  value: 'Вартість',
  price: 'Ціна',
  change24h: '24 год',
  group: 'Група',
  asset: 'Актив',
  buy: 'Купити',
  sell: 'Продати',
  trade: 'Торгувати',
  assetHistory: 'Історія',
  verified: 'Перевірений',
  flagged: 'Позначений',
  unverified: 'Неперевірений',
  notListed: 'Майданчик його не лістить',
  unpriced: 'Майданчик не дає ціни',
  createPlan: 'Створити план',
}

export const PORTFOLIO_COPY: Copy<PortfolioCopy> = { en: EN, uk: UK }

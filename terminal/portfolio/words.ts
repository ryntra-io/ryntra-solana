import { words } from '../../city/lib/i18n/dict.ts';

/**
 * The Portfolio screen's words for the wallet's own money and its coins, in English and Ukrainian: the name, the
 * figure, the action. «Everything in Solana» — the total, the groups, the three actions — speaks through `./all-words.ts`,
 * the wallet's clean through `./clean-words.ts`. Nothing here promises a result.
 */
export const PORTFOLIO = words(
  {
    topUp: 'Top up',
    send: 'Send',
    receive: 'Receive',
    actions: 'Money actions',
    // The coins.
    coin: 'Coin',
    amount: 'Amount',
    price: 'Price',
    change: '24h',
    value: 'Value',
    buy: 'Buy',
    sell: 'Sell',
    buyCoin: (coin: string) => `Buy ${coin}`,
    sellCoin: (coin: string) => `Sell ${coin}`,
    noPrice: 'No price',
    // The agents.
    agent: 'Agent',
    budgetDay: 'Budget a day',
    held: 'With the agent',
    result: 'Result',
    // An empty wallet.
    emptyLine: 'Your wallet is empty — top it up to start.',
    // The private balance.
    privateTitle: 'Private balance',
    soon: 'Soon',
    hidden: 'Amounts hidden',
    hide: 'Hide funds',
    privateInfo: 'How the private balance works',
    privateText: 'A second, encrypted balance inside the Solflare wallet: it hides the coin and the amount. Ryntra will move money into it once that path works; only the wallet shows or spends it.',
    hiddenFigure: 'Amount hidden',
    // The recent actions and the panels.
    recent: 'Recent activity',
    close: 'Close',
    receiveTitle: 'Receive',
    receiveFrom: 'Send SOL or any Solana coin to this address — from another wallet or an exchange.',
  },
  {
    topUp: 'Поповнити',
    send: 'Надіслати',
    receive: 'Отримати',
    actions: 'Дії з грошима',
    coin: 'Монета',
    amount: 'Кількість',
    price: 'Ціна',
    change: '24 год',
    value: 'Вартість',
    buy: 'Купити',
    sell: 'Продати',
    buyCoin: (coin: string) => `Купити ${coin}`,
    sellCoin: (coin: string) => `Продати ${coin}`,
    noPrice: 'Без ціни',
    agent: 'Агент',
    budgetDay: 'Бюджет на день',
    held: 'В агента',
    result: 'Результат',
    emptyLine: 'Гаманець порожній — поповни, щоб почати.',
    privateTitle: 'Приватний баланс',
    soon: 'Скоро',
    hidden: 'Суми сховано',
    hide: 'Сховати кошти',
    privateInfo: 'Як працює приватний баланс',
    privateText: 'Другий, зашифрований баланс у гаманці Solflare: ховає монету й суму. Ryntra зможе класти туди гроші, щойно цей шлях запрацює; показує й витрачає його лише гаманець.',
    hiddenFigure: 'Суму сховано',
    recent: 'Останні дії',
    close: 'Закрити',
    receiveTitle: 'Отримати',
    receiveFrom: 'Надішли SOL чи будь-яку монету Solana на цю адресу — з іншого гаманця чи з біржі.',
  },
);

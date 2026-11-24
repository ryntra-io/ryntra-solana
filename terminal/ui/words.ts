import { pl, words } from '../../city/lib/i18n/dict.ts';

/**
 * The kit's private parts: the toggle «Public ⇄ Private», the band «others see» and the ring's counter
 * behind its «i». «Private», never «anonymous»: on the current ring the parties are seen, and so are the way in and the
 * way out. Nothing here promises more than the band's facts (`lib/privacy/exposure.ts`).
 */
export const PRIVATE_KIT = words(
  {
    open: 'Public',
    private: 'Private',
    modeName: 'Private mode',
    band: 'Others see',
    who: 'Who',
    to: 'To',
    what: 'What',
    amount: 'Amount',
    seen: 'seen',
    hidden: 'hidden',
    whoElse: 'Who sees what',
    everyone: 'Everyone',
    viewers: 'Those with your view',
    prover: 'The proof server',
    infoLabel: 'How private this is',
    countTitle: 'In the ring now',
    countSol: (sol: string) => `${sol} SOL`,
    countPeople: (n: number) => `${n} private ${n === 1 ? 'balance' : 'balances'}`,
    countNone: '—',
    countTest: 'Test network',
    countHonest: 'The fewer people in the ring, the easier it is to guess whose money it is.',
    countEdge: 'Money going in and coming out is seen.',
    countProof: 'The proof is computed by a Helius server in a protected environment.',
  },
  {
    open: 'Відкрито',
    private: 'Приватно',
    modeName: 'Приватний режим',
    band: 'Інші бачать',
    who: 'Хто',
    to: 'Кому',
    what: 'Що',
    amount: 'Скільки',
    seen: 'видно',
    hidden: 'сховано',
    whoElse: 'Хто що бачить',
    everyone: 'Усі',
    viewers: 'Кому даєш перегляд',
    prover: 'Сервер доказу',
    infoLabel: 'Наскільки це приватно',
    countTitle: 'У кільці зараз',
    countSol: (sol: string) => `${sol} SOL`,
    countPeople: (n: number) => `${n} ${pl(n, 'приватний баланс', 'приватні баланси', 'приватних балансів')}`,
    countNone: '—',
    countTest: 'Тестова мережа',
    countHonest: 'Що менше людей у кільці, то легше вгадати, чиї це гроші.',
    countEdge: 'Вхід у кільце й вихід із нього видно.',
    countProof: 'Доказ рахує сервер Helius у захищеному середовищі.',
  },
);

/** The private kit's own stand (`/terminal/kit/private`, a stand only): its title and the names of what it shows. */
export const PRIVATE_KIT_STAND = words(
  {
    title: 'Private mode',
    toggle: 'Toggle',
    off: 'Public',
    on: 'Private',
    live: 'Remembered',
    band: 'Before a signature',
    hide: 'Hide',
    return: 'Return',
    send: 'Send',
    payout: 'Payout',
    invoice: 'Invoice',
    swap: 'Swap',
    routeSwap: 'Swap · by market route',
    publicSend: 'Send · public',
    count: 'Counter',
    countReading: 'Reading',
    countLive: 'Live read',
    countRead: 'Read',
    countEmpty: 'Not read',
    action: 'Send privately',
    page: 'Money',
  },
  {
    title: 'Приватний режим',
    toggle: 'Перемикач',
    off: 'Відкрито',
    on: 'Приватно',
    live: 'Запам’ятовує',
    band: 'Перед підписом',
    hide: 'Сховати',
    return: 'Повернути',
    send: 'Переказ',
    payout: 'Виплата',
    invoice: 'Рахунок',
    swap: 'Обмін',
    routeSwap: 'Обмін · маршрутом ринку',
    publicSend: 'Переказ · відкрито',
    count: 'Лічильник',
    countReading: 'Читаємо',
    countLive: 'Живе читання',
    countRead: 'Прочитано',
    countEmpty: 'Не прочитано',
    action: 'Надіслати приватно',
    page: 'Гроші',
  },
);

/**
 * Ryntra's fee in one phrasing on every screen before a signature: the swap, a coin's ticket
 * and its quick buy, a limit, the agent's and the bots' cards, the portfolio's exit and clean-up. The rate is always the
 * engine's — the quote's own basis points, or its fee policy (`lib/core/fee-policy.ts`, `lib/mandate/fee-rates.ts`) —
 * and «No Ryntra fee» stands only where the quote or the engine's rule says zero: for a big pair the engine weighs a
 * route with its 0.1 % against one without, and the line then says what this quote takes, in the same calm words.
 */
export const FEE = words(
  {
    ryntra: (rate: string) => `Ryntra fee ${rate}`,
    none: 'No Ryntra fee',
    perTrade: (low: string, high: string) => `Ryntra fee ${low}–${high}% a trade`,
  },
  {
    ryntra: (rate: string) => `Комісія Ryntra ${rate}`,
    none: 'Без комісії Ryntra',
    perTrade: (low: string, high: string) => `Комісія Ryntra ${low}–${high}% з угоди`,
  },
);

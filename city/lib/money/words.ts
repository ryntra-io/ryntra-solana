import { pl, words } from '../i18n/dict.ts';

/** The Money window's tab names, by tab (CITY-79). */
export const TAB_WORDS = words(
  {
    topup: 'Top up',
    send: 'Send',
    paylink: 'Pay link',
    activity: 'Activity',
    portfolio: 'Portfolio',
  },
  {
    topup: 'Поповнити',
    send: 'Надіслати',
    paylink: 'Посилання',
    activity: 'Історія',
    portfolio: 'Портфель',
  },
);

/** «How much» on Send and Bridge, and why an amount is not taken. */
export const AMOUNT_WORDS = words(
  {
    empty: 'Enter an amount.',
    noBalance: 'Your balance is still being read.',
    notANumber: 'Enter a plain number.',
    tooPrecise: (symbol: string, decimals: number) => `${symbol} has ${decimals} decimal place${decimals === 1 ? '' : 's'}. Shorten the amount.`,
    zero: 'Enter more than zero.',
    overBalance: (amount: string, symbol: string) => `More than you can send: ${amount} ${symbol}.`,
  },
  {
    empty: 'Введи суму.',
    noBalance: 'Баланс ще завантажується.',
    notANumber: 'Введи звичайне число.',
    tooPrecise: (symbol: string, decimals: number) => `У ${symbol} лише ${decimals} ${pl(decimals, 'знак', 'знаки', 'знаків')} після коми. Скороти суму.`,
    zero: 'Введи більше за нуль.',
    overBalance: (amount: string, symbol: string) => `Більше, ніж можна надіслати: ${amount} ${symbol}.`,
  },
);

/** What was typed in «To» and is not a Solana address the engine pays, by problem. */
export const RECIPIENT_PROBLEM_WORDS = words(
  {
    NOT_AN_ADDRESS: 'That is not a Solana address.',
    MISREAD_CHARACTER: 'It has 0, O, I or l, which Solana addresses never use. Copy the address instead of retyping it.',
    WRONG_LENGTH: 'A Solana address is 32 to 44 characters. Check the whole address was pasted.',
    BAD_NAME: 'A .skr name is letters, digits, - and _ before .skr.',
    SOL_NAME: 'Ryntra reads .skr names. For a .sol name, paste the address it points to.',
    OTHER_NETWORK: 'That is an address on another network. Send there from Bridge.',
    SELF: 'That is your own wallet.',
  },
  {
    NOT_AN_ADDRESS: 'Це не адреса Solana.',
    MISREAD_CHARACTER: 'Тут є 0, O, I чи l — в адресах Solana їх не буває. Скопіюй адресу, а не передруковуй.',
    WRONG_LENGTH: 'Адреса Solana має від 32 до 44 символів. Перевір, що вставлено всю адресу.',
    BAD_NAME: 'Ім’я .skr — це літери, цифри, - і _ перед .skr.',
    SOL_NAME: 'Ryntra читає імена .skr. Для імені .sol встав адресу, на яку воно вказує.',
    OTHER_NETWORK: 'Це адреса в іншій мережі. Надсилай туди через Міст.',
    SELF: 'Це твій власний гаманець.',
  },
);

/** The engine's recipient check, as the city says its answers, by the contract's code. */
export const RECIPIENT_CHECK_WORDS = words(
  {
    EMPTY: 'Enter who gets it.',
    REQUEST_INVALID: 'That payment request cannot be read.',
    REQUEST_UNSUPPORTED: 'That payment request asks for something Ryntra does not pay from here.',
    REFERENCE_UNSUPPORTED: 'That payment request carries a reference Ryntra does not pay from here.',
    LINK_INVALID: 'That is not a Ryntra payment link.',
    LINK_NOT_FOUND: 'That payment link does not exist.',
    LINK_PAID: 'That payment link is already paid.',
    LINK_EXPIRED: 'That payment link has expired.',
    LINK_MISMATCH: 'That request does not match its payment link.',
    LINK_UNCONFIRMED: 'That payment link could not be checked right now. It may already be paid.',
    MINT_UNREADABLE: 'The coin could not be read right now. Try again in a moment.',
    UNSAFE_SOL_RECIPIENT: 'This address cannot safely receive SOL.',
    RECIPIENT_MINT_MISMATCH: 'That account holds a different coin.',
    RECIPIENT_PROGRAM_MISMATCH: 'That account belongs to another token program.',
    RECIPIENT_ACCOUNT_MALFORMED: 'That account cannot receive this coin.',
    OFF_CURVE_OWNER_UNSUPPORTED: 'That address is a program account, not a wallet.',
    RECIPIENT_FROZEN: 'That account is frozen and cannot receive.',
    RECIPIENT_UNREADABLE: 'The address could not be checked right now. Try again in a moment.',
    fallback: 'That recipient cannot be paid from here.',
    sanctioned: 'This address is on a sanctions list.',
    evidence: 'Risk reports on this address. Check before you send.',
  },
  {
    EMPTY: 'Вкажи, хто отримає.',
    REQUEST_INVALID: 'Цей платіжний запит не вдається прочитати.',
    REQUEST_UNSUPPORTED: 'Цей платіжний запит просить те, чого Ryntra звідси не оплачує.',
    REFERENCE_UNSUPPORTED: 'У цьому платіжному запиті є позначка, яку Ryntra звідси не оплачує.',
    LINK_INVALID: 'Це не платіжне посилання Ryntra.',
    LINK_NOT_FOUND: 'Такого платіжного посилання немає.',
    LINK_PAID: 'Це платіжне посилання вже оплачено.',
    LINK_EXPIRED: 'Термін цього платіжного посилання минув.',
    LINK_MISMATCH: 'Запит не збігається зі своїм платіжним посиланням.',
    LINK_UNCONFIRMED: 'Платіжне посилання зараз не вдалося перевірити. Можливо, його вже оплачено.',
    MINT_UNREADABLE: 'Монету зараз не вдалося прочитати. Спробуй за мить.',
    UNSAFE_SOL_RECIPIENT: 'Ця адреса не може безпечно отримати SOL.',
    RECIPIENT_MINT_MISMATCH: 'Цей рахунок тримає іншу монету.',
    RECIPIENT_PROGRAM_MISMATCH: 'Цей рахунок належить іншій програмі токенів.',
    RECIPIENT_ACCOUNT_MALFORMED: 'Цей рахунок не може отримати цю монету.',
    OFF_CURVE_OWNER_UNSUPPORTED: 'Це рахунок програми, а не гаманець.',
    RECIPIENT_FROZEN: 'Цей рахунок заморожено, він не може отримувати.',
    RECIPIENT_UNREADABLE: 'Адресу зараз не вдалося перевірити. Спробуй за мить.',
    fallback: 'Цьому отримувачу звідси не заплатити.',
    sanctioned: 'Ця адреса в санкційному списку.',
    evidence: 'На цю адресу є скарги на ризик. Перевір, перш ніж надсилати.',
  },
);

/** The Send tab's one action and the lines under «To», as the form's ladder says them. */
export const GATE_WORDS = words(
  {
    connectWallet: 'Connect wallet',
    preparing: 'Preparing transfer…',
    checkingAgain: 'Checking it again…',
    checkWallet: 'Check your wallet…',
    sending: 'Sending…',
    waitingEarlier: 'Waiting for an earlier transfer',
    balancesUnavailable: 'Balances unavailable',
    readingBalances: 'Reading your balances…',
    chooseCoin: 'Choose a coin',
    finding: (name: string) => `Finding ${name}…`,
    noSuchName: (name: string) => `No such name: ${name}.`,
    nameUnchecked: 'The name could not be checked right now.',
    payLink: 'This is a Ryntra payment link. Open it to pay.',
    enterWho: 'Enter who gets it',
    useBridge: 'Use Bridge',
    checkRecipient: 'Check the recipient',
    findingName: 'Finding the name…',
    checkName: 'Check the name',
    readingRequest: 'Reading the request…',
    checkingRecipient: 'Checking the recipient…',
    checkWhole: 'Check the whole address',
    checkNew: 'Check the new address',
    notEnough: (symbol: string) => `Not enough ${symbol}`,
    enterAmount: 'Enter an amount',
    confirmInWallet: 'Confirm in wallet',
    cannotSend: 'Cannot be sent',
    reviewTransfer: 'Review transfer',
  },
  {
    connectWallet: 'Підключити гаманець',
    preparing: 'Готуємо переказ…',
    checkingAgain: 'Перевіряємо ще раз…',
    checkWallet: 'Перевір гаманець…',
    sending: 'Надсилаємо…',
    waitingEarlier: 'Чекаємо на попередній переказ',
    balancesUnavailable: 'Баланси недоступні',
    readingBalances: 'Читаємо баланси…',
    chooseCoin: 'Обери монету',
    finding: (name: string) => `Шукаємо ${name}…`,
    noSuchName: (name: string) => `Імені ${name} немає.`,
    nameUnchecked: 'Ім’я зараз не вдалося перевірити.',
    payLink: 'Це платіжне посилання Ryntra. Відкрий його, щоб заплатити.',
    enterWho: 'Вкажи, хто отримає',
    useBridge: 'Скористайся Мостом',
    checkRecipient: 'Перевір отримувача',
    findingName: 'Шукаємо ім’я…',
    checkName: 'Перевір ім’я',
    readingRequest: 'Читаємо запит…',
    checkingRecipient: 'Перевіряємо отримувача…',
    checkWhole: 'Звір усю адресу',
    checkNew: 'Звір нову адресу',
    notEnough: (symbol: string) => `Недостатньо ${symbol}`,
    enterAmount: 'Введи суму',
    confirmInWallet: 'Підтверди в гаманці',
    cannotSend: 'Не можна надіслати',
    reviewTransfer: 'Перевірити переказ',
  },
);

/** The Send flow's own lines, beside the engine's. */
export const SEND_WORDS = words(
  {
    cannotBeSent: 'This transfer cannot be sent.',
    changed: 'Something changed since you reviewed this transfer. Check it again.',
    noAnswer: 'No answer from Ryntra yet. Reading what happened — do not send it again.',
  },
  {
    cannotBeSent: 'Цей переказ не можна надіслати.',
    changed: 'Щось змінилося, відколи ти переглянув переказ. Перевір його ще раз.',
    noAnswer: 'Ryntra ще не відповіла. З’ясовуємо, що сталося, — не надсилай удруге.',
  },
);

/**
 * The sentences Ryntra's shared transfer copy writes in English (`sendFailureCopy`, `walletFailureCopy`,
 * `sendOutcomeCopy`), said in the city's language. A sentence missing here stays as the engine wrote it.
 */
export const SEND_COPY_WORDS = words(
  {
    skrChanged: 'The name now points to another address. Check it and review again.',
    skrGone: 'No such .skr name',
    skrUnchecked: 'The name could not be checked right now.',
    skrUnread: 'The name could not be checked again before signing. Nothing was sent.',
    rateLimited: 'Too many requests. Try again in a moment.',
    amount: 'That amount is unavailable.',
    recipient: 'Check the recipient address.',
    expired: 'The transfer window closed. Review it again.',
    cancelled: 'Wallet approval was cancelled.',
    bytes: 'Your wallet returned a different transaction. Nothing was sent.',
    recovery: 'An earlier transfer is still being confirmed. Do not send it again.',
    off: 'Sending is turned off right now.',
    unavailable: 'Sending is unavailable right now. Try again later.',
    stopped: 'The transfer could not continue. Try again.',
    notApproved: 'Your wallet did not approve this transfer.',
    neverReached: 'This transfer never reached the network. Nothing moved.',
    rejected: 'The network rejected this transfer. Nothing moved.',
    unconfirmed: 'This transfer is not confirmed yet. Open it on the explorer before sending again.',
  },
  {
    skrChanged: 'Ім’я тепер вказує на іншу адресу. Перевір її й переглянь переказ ще раз.',
    skrGone: 'Такого імені .skr немає',
    skrUnchecked: 'Ім’я зараз не вдалося перевірити.',
    skrUnread: 'Ім’я не вдалося перевірити ще раз перед підписом. Нічого не надіслано.',
    rateLimited: 'Забагато запитів. Спробуй за мить.',
    amount: 'Ця сума недоступна.',
    recipient: 'Перевір адресу отримувача.',
    expired: 'Час на переказ минув. Переглянь його ще раз.',
    cancelled: 'Підтвердження в гаманці скасовано.',
    bytes: 'Гаманець повернув іншу транзакцію. Нічого не надіслано.',
    recovery: 'Попередній переказ ще підтверджується. Не надсилай його вдруге.',
    off: 'Надсилання зараз вимкнено.',
    unavailable: 'Надсилання зараз недоступне. Спробуй пізніше.',
    stopped: 'Переказ не вдалося продовжити. Спробуй ще раз.',
    notApproved: 'Гаманець не підтвердив цей переказ.',
    neverReached: 'Переказ так і не дійшов до мережі. Нічого не переказано.',
    rejected: 'Мережа відхилила цей переказ. Нічого не переказано.',
    unconfirmed: 'Переказ ще не підтверджено. Глянь його в оглядачі, перш ніж надсилати знову.',
  },
);

/** The words Ryntra's shared History lines write in English (`describeAction`, `actionStateWord`), in the city's language. */
export const HISTORY_WORDS = words(
  {
    toSolana: 'to Solana',
    toBase: 'to Base',
    toEthereum: 'to Ethereum',
    toRobinhood: 'to Robinhood Chain',
    moved: 'Moved',
    between: 'Between networks',
    swapped: 'Swapped',
    bought: 'Bought',
    sold: 'Sold',
    recurring: 'Recurring buy',
    spot: 'Spot',
    forWord: 'for',
    receivedWord: 'received',
    launch: 'Launch',
    swap: 'Swap',
    received: 'Received',
    receive: 'Receive',
    sent: 'Sent',
    send: 'Send',
    arrived: 'Arrived',
    didNotHappen: 'Did not happen',
    needsYou: 'Needs you',
    onItsWay: 'On its way',
  },
  {
    toSolana: 'до Solana',
    toBase: 'до Base',
    toEthereum: 'до Ethereum',
    toRobinhood: 'до Robinhood Chain',
    moved: 'Переказано',
    between: 'Між мережами',
    swapped: 'Обміняно',
    bought: 'Куплено',
    sold: 'Продано',
    recurring: 'Регулярна купівля',
    spot: 'Спот',
    forWord: 'за',
    receivedWord: 'отримано',
    launch: 'Лаунч',
    swap: 'Обмін',
    received: 'Отримано',
    receive: 'Отримання',
    sent: 'Надіслано',
    send: 'Надсилання',
    arrived: 'Дійшло',
    didNotHappen: 'Не відбулося',
    needsYou: 'Потрібна твоя дія',
    onItsWay: 'У дорозі',
  },
);

/** Activity's own words beside History's. */
export const ACTIVITY_WORDS = words({ explorer: 'Explorer' }, { explorer: 'Оглядач' });

/** How old a read is. */
export const AGE_WORDS = words(
  {
    justNow: 'just now',
    seconds: (n: number) => `${n}s ago`,
    minutes: (n: number) => `${n} min ago`,
    at: (time: string) => `at ${time}`,
  },
  {
    justNow: 'щойно',
    seconds: (n: number) => `${n} с тому`,
    minutes: (n: number) => `${n} хв тому`,
    at: (time: string) => `о ${time}`,
  },
);

/** Top up from another network: what Relay says of a deposit, and its fee. */
export const DEPOSIT_WORDS = words(
  {
    ON_THE_WAY: 'A deposit is on its way.',
    ARRIVED: 'Arrived in your wallet.',
    REFUNDED: 'The deposit was refunded.',
    FAILED: 'The deposit could not be filled. Relay support can recover it.',
    feeUnknown: 'The fee is set when the deposit is filled.',
    feeAbout: (fee: string, reference: string) => `About ${fee} on ${reference}, taken from the deposit.`,
    feeShort: (fee: string) => `fee ≈ ${fee}`,
  },
  {
    ON_THE_WAY: 'Поповнення вже в дорозі.',
    ARRIVED: 'Надійшло на твій гаманець.',
    REFUNDED: 'Поповнення повернуто.',
    FAILED: 'Поповнення не вдалося зарахувати. Підтримка Relay може його повернути.',
    feeUnknown: 'Комісію визначать, коли поповнення зарахують.',
    feeAbout: (fee: string, reference: string) => `Близько ${fee} з ${reference}, утримується з поповнення.`,
    feeShort: (fee: string) => `комісія ≈ ${fee}`,
  },
);

/** Bridge out of Solana: the address there, the time, and the lane's refusals by code. */
export const BRIDGE_WORDS = words(
  {
    destEmpty: 'Enter the address that gets it.',
    destSolana: 'That is a Solana address. Use Send for it.',
    destNotEvm: 'An address there starts with 0x and has 40 more characters.',
    none: 'None',
    etaMinute: 'about a minute',
    etaSeconds: (n: number) => `about ${n} s`,
    etaMinutes: (n: number) => `about ${n} min`,
    QUOTE_CHANGED: 'The price moved. Check the new figures.',
    IMPACT_NOT_ACKNOWLEDGED: 'The price moved too far from the market. Try a smaller amount.',
    CROSS_SWAP_ALREADY_STARTED: 'An earlier transfer between networks is still open.',
    RATE_LIMITED: 'Too many requests. Try again in a moment.',
    QUOTE_RATE_LIMITED: 'Too many requests. Try again in a moment.',
    TIMEOUT: 'No answer from Ryntra. Try again.',
    NETWORK: 'No connection. Try again.',
    paused: 'Moving money between networks is paused right now.',
    pausedHere: 'Moving money to this network is paused right now.',
    amountBad: 'That amount cannot be moved. Check it and try again.',
    addressBad: 'Check the address that gets it.',
    stopped: 'This transfer could not continue. Nothing was sent.',
    builtAgo: 'The transfer was built a while ago. Check the fresh figures.',
    cancelled: 'Wallet approval was cancelled.',
    notApproved: 'Your wallet did not approve this transfer.',
    tooLong: 'The wallet took longer than the transfer lives. Nothing was sent — check the fresh figures.',
  },
  {
    destEmpty: 'Введи адресу отримувача.',
    destSolana: 'Це адреса Solana. Для неї — «Надіслати».',
    destNotEvm: 'Адреса там починається з 0x і має ще 40 символів.',
    none: 'Немає',
    etaMinute: 'близько хвилини',
    etaSeconds: (n: number) => `близько ${n} с`,
    etaMinutes: (n: number) => `близько ${n} хв`,
    QUOTE_CHANGED: 'Ціна змінилася. Перевір нові цифри.',
    IMPACT_NOT_ACKNOWLEDGED: 'Ціна надто відійшла від ринку. Спробуй меншу суму.',
    CROSS_SWAP_ALREADY_STARTED: 'Попередній переказ між мережами ще не завершено.',
    RATE_LIMITED: 'Забагато запитів. Спробуй за мить.',
    QUOTE_RATE_LIMITED: 'Забагато запитів. Спробуй за мить.',
    TIMEOUT: 'Ryntra не відповіла. Спробуй ще раз.',
    NETWORK: 'Немає з’єднання. Спробуй ще раз.',
    paused: 'Перекази між мережами зараз призупинено.',
    pausedHere: 'Перекази в цю мережу зараз призупинено.',
    amountBad: 'Цю суму не вийде переказати. Перевір і спробуй ще раз.',
    addressBad: 'Перевір адресу отримувача.',
    stopped: 'Переказ не вдалося продовжити. Нічого не надіслано.',
    builtAgo: 'Переказ зібрано давно. Перевір свіжі цифри.',
    cancelled: 'Підтвердження в гаманці скасовано.',
    notApproved: 'Гаманець не підтвердив цей переказ.',
    tooLong: 'Гаманець думав довше, ніж живе переказ. Нічого не надіслано — перевір свіжі цифри.',
  },
);

/** Where an order out of Solana stands: its one word, and the line under it where it changes what the person does. */
export const ORDER_WORDS = words(
  {
    moving: 'On its way',
    done: 'Arrived',
    refunded: 'Came back',
    failed: 'Not sent',
    recovery: 'Checking',
    refundedLine: 'Back in your Solana wallet.',
    failedLine: 'Nothing left your wallet.',
    recoveryLine: 'Do not send it again.',
  },
  {
    moving: 'У дорозі',
    done: 'Дійшло',
    refunded: 'Повернулося',
    failed: 'Не надіслано',
    recovery: 'Перевіряємо',
    refundedLine: 'Знову у твоєму гаманці Solana.',
    failedLine: 'З гаманця нічого не пішло.',
    recoveryLine: 'Не надсилай його вдруге.',
  },
);

/** The Money store's own lines. */
export const STORE_WORDS = words(
  { receiptFailed: 'The receipt could not be issued right now. Try again in a moment.' },
  { receiptFailed: 'Квитанцію зараз не вдалося видати. Спробуй за мить.' },
);

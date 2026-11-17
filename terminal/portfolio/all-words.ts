import { pl, words } from '../../city/lib/i18n/dict.ts';

const en = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const uk = (n: number, one: string, few: string, many: string) => `${n} ${pl(n, one, few, many)}`;

type Why = Readonly<{ pct?: number; epoch?: number | null; date?: string | null }>;

/**
 * «Everything in Solana» on the Portfolio, in English and Ukrainian: the name, the figure, the action. How the total
 * is counted, why a position cannot leave in one step and how an exit works stand behind the «i» or in one short line
 * beside the row. Nothing here promises a result: every figure is what the wallet holds, said with «≈» until it is
 * signed.
 */
export const ALL = words(
  {
    // A wallet by its address.
    lookTitle: 'Everything in Solana',
    lookLine: 'Everything a wallet holds across Solana',
    addressField: 'Paste a wallet address',
    show: 'Show',
    badAddress: 'That is not a wallet address',
    or: 'or',
    connect: 'Connect wallet',
    viewOnly: 'View only',
    closeWatch: 'Close this wallet',
    preview: 'What you will see',
    // The total.
    total: 'Total',
    totalSoFar: 'Total so far',
    today: (figure: string) => `${figure} today`,
    toCollect: 'Fees to collect',
    where: (parts: string) => `Where it is: ${parts}`,
    totalInfo: 'How the total is counted',
    totalText:
      'Coins at today’s price; pools with their fees to collect; staking and deposits as their protocols state them; loans subtracted. «Today» counts the coins the market moved today. A coin nobody prices is listed, not counted. Other platforms are shown apart and are not in the total.',
    notAll: 'Not everything was read',
    unread: 'Not read now',
    again: 'Read again',
    reading: 'Reading…',
    emptyLine: 'This wallet holds nothing yet.',
    // The parts and the groups.
    pools: 'Pools',
    staking: 'Staking',
    lendingGroup: 'Deposits and loans',
    coins: 'Coins',
    dust: 'Dust',
    agents: 'Agents',
    other: 'Other platforms',
    otherInfo: 'About other platforms',
    otherText: 'Seen through Jupiter Portfolio, not read from the protocol itself: shown for the whole picture, not counted in the total, and closed in the protocol’s own app.',
    dustInfo: 'What counts as dust',
    dustText: 'Coins worth up to $5 and coins with no price. «Clean wallet» swaps them into SOL and gives back the rent of empty accounts.',
    fold: (group: string) => `Hide ${group}`,
    unfold: (group: string) => `Show ${group}`,
    // The columns.
    position: 'Position',
    range: 'Range',
    now: 'Now',
    earned: 'To collect',
    interest: 'Earned',
    state: 'State',
    platform: 'Platform',
    inRange: 'In range',
    outOfRange: 'Out of range',
    // The rows.
    stake: 'Staked SOL',
    stakeActive: 'Earning',
    stakeCooling: 'Cooling down',
    stakeFree: 'Ready to withdraw',
    stakeHeld: 'Locked',
    deposit: 'Deposit',
    loan: 'Loan',
    loanShare: (pct: string) => `${pct}% of the deposit`,
    asOf: (time: string) => `as of ${time}`,
    sourceUnread: (name: string) => `${name}: not read now`,
    wallet: 'Wallet',
    emptyAccounts: 'Empty accounts',
    // The row's actions.
    collect: 'Collect',
    closeRow: 'Close',
    exitRow: 'Exit',
    collectFrom: (name: string) => `Collect fees from ${name}`,
    closeOf: (name: string) => `Close ${name}`,
    exitOf: (name: string) => `Exit ${name}`,
    why: (name: string) => `Why ${name} cannot leave in one step`,
    // The three actions.
    actions: 'What you can do',
    collectTitle: 'Collect fees',
    collectFact: (usd: string, n: number) => `${usd} in ${en(n, 'pool', 'pools')}`,
    exitTitle: 'Exit everything',
    exitFact: (n: number) => `${en(n, 'position', 'positions')} → SOL, USDC or 50/50`,
    cleanFact: (sol: string, coins: number, accounts: number) => [`≈ ${sol} SOL`, coins ? en(coins, 'coin', 'coins') : null, accounts ? en(accounts, 'account', 'accounts') : null].filter(Boolean).join(' · '),
    soon: 'Soon',
    // The panels.
    into: 'Coin to exit into',
    half: '50/50',
    youGet: 'You get',
    youCollect: 'You collect',
    rentBack: (sol: string) => `rent back ${sol} SOL`,
    fee: (fee: string) => `fee ${fee}`,
    noFee: 'no fee',
    others: (n: number) => `${n === 1 ? '1 more coin comes' : `${n} more coins come`} as ${n === 1 ? 'it is' : 'they are'}`,
    afterBuild: 'Rent and fee show once it is prepared',
    include: (name: string) => `Include ${name}`,
    exitNow: 'Exit',
    collectNow: 'Collect',
    building: 'Preparing…',
    approve: 'Approve in wallet',
    exiting: 'Exiting…',
    collecting: 'Collecting…',
    declined: 'Not signed. Nothing moved.',
    notSent: 'Not sent. Nothing moved — press again.',
    changed: 'The figures moved — check them and press again.',
    failed: 'Could not prepare it now.',
    nothing: 'Nothing to do here right now.',
    exitDone: (figure: string) => `Received ≈ ${figure}`,
    collectDone: (figure: string) => `Collected ≈ ${figure}`,
    donePlain: 'Done.',
    part: 'Part of it went through. The rest is where it was.',
    none: 'Nothing went through. Everything is where it was.',
    unsure: 'Sent — not confirmed yet. Reading your wallet again.',
    retry: 'Try again',
    closePanel: 'Close',
    exitInfo: 'How exit works',
    exitText:
      'Each position is closed, its fees collected, and what comes out is swapped into the coin you pick at the Swap screen’s price and fee. The rent of closed accounts comes back. Your coins stay; dust is «Clean wallet». One approval in your wallet.',
    collectInfo: 'How collecting works',
    collectText: 'Fees and rewards of every pool you pick come to your wallet; the positions stay as they are. One approval in your wallet.',
    reason: (code: string | null, why: Why = {}): string => {
      switch (code) {
        case 'LOCKED':
          return why.pct ? `The pool holds a part: ${why.pct}% leaves now` : 'Locked by the pool';
        case 'LIQUIDITY':
          return why.pct ? `The market gives back ${why.pct}% now` : 'The market cannot give it back now';
        case 'DEBT':
          return 'Repay the loan first';
        case 'REPAY':
          return 'A loan: repaid in the coin it was borrowed in';
        case 'STAKE_ACTIVE':
          return 'Stops first — yours to take when the epoch ends';
        case 'STAKE_COOLING':
          return why.epoch ? `Stopping — yours to take from epoch ${why.epoch}` : 'Stopping — yours to take when the epoch ends';
        case 'STAKE_LOCKUP':
          return why.date ? `Locked until ${why.date}` : 'Locked for now';
        case 'NOT_WITHDRAWER':
          return 'This wallet cannot withdraw it';
        case 'NO_ROUTE':
          return 'Exit from here is coming — close it in its own app for now';
        case 'PROJECTION':
          return 'Only its worth is seen — close it in its own app';
        case 'NOT_READ':
          return 'Not read now';
        case 'CLOSED_HERE':
          return 'Closed here for now';
        case 'SIMULATION':
        case 'SIMULATION_FAILED':
          return 'The network refused it now — try later';
        case 'NO_ROOM':
          return 'Did not fit one approval — run it again';
        case 'NOTHING_TO_DO':
          return 'Nothing to take here';
        case 'NO_PRICE':
          return 'No price for this coin — not swapped blind';
        case 'TOO_SMALL':
          return 'Too small to swap';
        case 'PAUSED':
          return 'Swapping is paused';
        case 'REFUSED':
          return 'Did not pass the check — left untouched';
        case 'UNAVAILABLE':
          return 'The network did not answer';
        case 'UNVERIFIED':
          return 'An unverified coin stays in your wallet';
        default:
          return 'Stays as it is for now';
      }
    },
  },
  {
    lookTitle: 'Усе в Solana',
    lookLine: 'Усе, що гаманець тримає в Solana',
    addressField: 'Встав адресу гаманця',
    show: 'Показати',
    badAddress: 'Це не адреса гаманця',
    or: 'або',
    connect: 'Підключити гаманець',
    viewOnly: 'Лише перегляд',
    closeWatch: 'Закрити цей гаманець',
    preview: 'Що ти побачиш',
    total: 'Разом',
    totalSoFar: 'Разом поки що',
    today: (figure: string) => `${figure} сьогодні`,
    toCollect: 'Незібрані комісії',
    where: (parts: string) => `Де гроші: ${parts}`,
    totalInfo: 'Як рахуємо разом',
    totalText:
      'Монети — за сьогоднішньою ціною; пули — разом із незібраними комісіями; стейкінг і депозити — як їх рахують самі протоколи; позики віднімаємо. «Сьогодні» рахує монети, які ринок зрушив за день. Монета без ціни є у списку, але не в сумі. Інші платформи показані окремо й у «Разом» не входять.',
    notAll: 'Не все прочитано',
    unread: 'Зараз не прочитано',
    again: 'Ще раз',
    reading: 'Читаю…',
    emptyLine: 'У цьому гаманці поки нічого немає.',
    pools: 'Пули',
    staking: 'Стейкінг',
    lendingGroup: 'Депозити й позики',
    coins: 'Монети',
    dust: 'Дріб’язок',
    agents: 'Агенти',
    other: 'Інші платформи',
    otherInfo: 'Про інші платформи',
    otherText: 'Бачимо через Jupiter Portfolio, а не з самого протоколу: показано для повної картини, у «Разом» не входить, а закривається в застосунку самого протоколу.',
    dustInfo: 'Що таке дріб’язок',
    dustText: 'Монети до $5 і монети без ціни. «Очистити гаманець» обміняє їх на SOL і поверне ренту порожніх рахунків.',
    fold: (group: string) => `Згорнути: ${group}`,
    unfold: (group: string) => `Розгорнути: ${group}`,
    position: 'Позиція',
    range: 'Діапазон',
    now: 'Зараз',
    earned: 'До збору',
    interest: 'Зароблено',
    state: 'Стан',
    platform: 'Платформа',
    inRange: 'У діапазоні',
    outOfRange: 'Поза діапазоном',
    stake: 'Стейк SOL',
    stakeActive: 'Працює',
    stakeCooling: 'Зупиняється',
    stakeFree: 'Можна забрати',
    stakeHeld: 'Заблоковано',
    deposit: 'Депозит',
    loan: 'Позика',
    loanShare: (pct: string) => `${pct}% від депозиту`,
    asOf: (time: string) => `станом на ${time}`,
    sourceUnread: (name: string) => `${name}: зараз не прочитано`,
    wallet: 'Гаманець',
    emptyAccounts: 'Порожні рахунки',
    collect: 'Зібрати',
    closeRow: 'Закрити',
    exitRow: 'Вийти',
    collectFrom: (name: string) => `Зібрати комісії з ${name}`,
    closeOf: (name: string) => `Закрити ${name}`,
    exitOf: (name: string) => `Вийти з ${name}`,
    why: (name: string) => `Чому ${name} не виходить одним кроком`,
    actions: 'Що можна зробити',
    collectTitle: 'Зібрати комісії',
    collectFact: (usd: string, n: number) => `${usd} у ${uk(n, 'пулі', 'пулах', 'пулах')}`,
    exitTitle: 'Вийти з усього',
    exitFact: (n: number) => `${uk(n, 'позиція', 'позиції', 'позицій')} → SOL, USDC або 50/50`,
    cleanFact: (sol: string, coins: number, accounts: number) => [`≈ ${sol} SOL`, coins ? uk(coins, 'монета', 'монети', 'монет') : null, accounts ? uk(accounts, 'рахунок', 'рахунки', 'рахунків') : null].filter(Boolean).join(' · '),
    soon: 'Скоро',
    into: 'У яку монету вийти',
    half: '50/50',
    youGet: 'Отримаєш',
    youCollect: 'Збереш',
    rentBack: (sol: string) => `повернеться ренти ${sol} SOL`,
    fee: (fee: string) => `комісія ${fee}`,
    noFee: 'без комісії',
    others: (n: number) => `ще ${n} ${pl(n, 'монета прийде', 'монети прийдуть', 'монет прийде')} як є`,
    afterBuild: 'Ренту й комісію покажемо, щойно підготуємо',
    include: (name: string) => `Додати ${name}`,
    exitNow: 'Вийти',
    collectNow: 'Зібрати',
    building: 'Готуємо…',
    approve: 'Схвали в гаманці',
    exiting: 'Виходимо…',
    collecting: 'Збираємо…',
    declined: 'Не підписано. Нічого не змінилось.',
    notSent: 'Не надіслано. Нічого не змінилось — натисни ще раз.',
    changed: 'Числа змінились — перевір і натисни ще раз.',
    failed: 'Зараз не вдалося підготувати.',
    nothing: 'Зараз тут нічого робити.',
    exitDone: (figure: string) => `Отримано ≈ ${figure}`,
    collectDone: (figure: string) => `Зібрано ≈ ${figure}`,
    donePlain: 'Готово.',
    part: 'Частина пройшла. Решта там, де й була.',
    none: 'Нічого не пройшло. Усе там, де й було.',
    unsure: 'Надіслано — ще не підтверджено. Перечитуємо гаманець.',
    retry: 'Ще раз',
    closePanel: 'Закрити',
    exitInfo: 'Як працює вихід',
    exitText:
      'Кожна позиція закривається, її комісії збираються, а те, що вийшло, обмінюється на вибрану монету за ціною й комісією «Обміну». Рента закритих рахунків повертається. Монети лишаються; дріб’язок — це «Очистити гаманець». Одне схвалення в гаманці.',
    collectInfo: 'Як працює збір',
    collectText: 'Комісії й винагороди з кожного вибраного пулу приходять у гаманець; самі позиції лишаються як є. Одне схвалення в гаманці.',
    reason: (code: string | null, why: Why = {}): string => {
      switch (code) {
        case 'LOCKED':
          return why.pct ? `Частину тримає пул: зараз вийде ${why.pct}%` : 'Заблоковано пулом';
        case 'LIQUIDITY':
          return why.pct ? `Ринок зараз віддасть ${why.pct}%` : 'Ринок зараз не може це віддати';
        case 'DEBT':
          return 'Спершу поверни позику';
        case 'REPAY':
          return 'Позика: повертається в тій монеті, в якій взята';
        case 'STAKE_ACTIVE':
          return 'Спершу зупиняється — забрати можна після кінця епохи';
        case 'STAKE_COOLING':
          return why.epoch ? `Зупиняється — забрати можна з епохи ${why.epoch}` : 'Зупиняється — забрати можна після кінця епохи';
        case 'STAKE_LOCKUP':
          return why.date ? `Заблоковано до ${why.date}` : 'Поки заблоковано';
        case 'NOT_WITHDRAWER':
          return 'Цей гаманець не може його забрати';
        case 'NO_ROUTE':
          return 'Вихід звідси скоро — поки закрий у самому застосунку';
        case 'PROJECTION':
          return 'Бачимо лише вартість — закрий у самому застосунку';
        case 'NOT_READ':
          return 'Зараз не прочитано';
        case 'CLOSED_HERE':
          return 'Тут поки закрито';
        case 'SIMULATION':
        case 'SIMULATION_FAILED':
          return 'Мережа зараз відмовила — спробуй пізніше';
        case 'NO_ROOM':
          return 'Не вмістилось в одне схвалення — повтори ще раз';
        case 'NOTHING_TO_DO':
          return 'Тут нема чого забирати';
        case 'NO_PRICE':
          return 'Монета без ціни — не обмінюємо наосліп';
        case 'TOO_SMALL':
          return 'Замало для обміну';
        case 'PAUSED':
          return 'Обмін на паузі';
        case 'REFUSED':
          return 'Не пройшло перевірку — не чіпаємо';
        case 'UNAVAILABLE':
          return 'Мережа не відповіла';
        case 'UNVERIFIED':
          return 'Неперевірена монета лишиться в гаманці';
        default:
          return 'Поки лишається як є';
      }
    },
  },
);

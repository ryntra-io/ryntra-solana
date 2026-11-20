import { pl, words } from '../../city/lib/i18n/dict.ts';

const en = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const uk = (n: number, one: string, few: string, many: string) => `${n} ${pl(n, one, few, many)}`;

/**
 * «Clean the wallet» and the risk marks, in English and Ukrainian: the name, the figure, the one action. Why a coin is
 * marked and how a clean works stand behind the «i». Nothing here promises a result: the figure is what the wallet
 * gets back, said with «≈» until the wallet signs.
 */
export const CLEAN = words(
  {
    title: 'Clean wallet',
    clean: 'Clean',
    cleanNow: 'Clean wallet',
    youGet: 'You get',
    lineFee: (fee: string) => `Swaps ${fee} fee · rent back free`,
    lineFree: 'Free: rent back only',
    unwrap: (amount: string) => `Unwraps ${amount} wSOL into SOL`,
    unwrapNext: (amount: string) => `${amount} wSOL unwraps with the next clean`,
    small: 'Into SOL',
    empty: 'Empty accounts',
    litter: 'Burn',
    noPrice: 'No price',
    emptyWord: 'Empty',
    dontTouch: 'Don’t touch',
    why: (coin: string) => `Don’t touch — why ${coin} is marked`,
    include: (coin: string) => `Include ${coin}`,
    building: 'Preparing…',
    approve: 'Approve in wallet',
    sending: 'Cleaning…',
    done: (sol: string) => `Got back ≈ ${sol} SOL`,
    part: 'Part of it went through. The rest stays for next time.',
    none: 'Nothing went through. Your coins are where they were.',
    declined: 'Not signed. Nothing moved.',
    failed: 'Could not prepare it now.',
    tryAgain: 'Try again',
    skipped: (n: number) => `${en(n, 'coin', 'coins')} can’t be swapped now`,
    left: (n: number) => `${n} more next time`,
    nothing: 'Nothing to clean right now.',
    howInfo: 'How cleaning works',
    howText:
      'Coins worth up to $5 are swapped into SOL at the Swap screen’s price and fee. Empty coin accounts are closed and their rent — about 0.002 SOL each — comes back for free. Coins with no price are burnt and their accounts closed. wSOL becomes your SOL only when you switch it on. Marked coins stay unless you switch them on. One approval in your wallet.',
    close: 'Close',
    reason: (code: string): string => (({ unverified: 'Not verified by Jupiter', mint: 'Its creator can still mint more', freeze: 'Its creator can freeze it in your wallet', delegate: 'Someone else can move it from any wallet', thin: 'Thin market: a sale moves the price', score: 'Little real trading', fee: 'A fee on every transfer', hook: 'Extra code runs on every transfer' }) as Readonly<Record<string, string>>)[code] ?? '',
  },
  {
    title: 'Очистити гаманець',
    clean: 'Очистити',
    cleanNow: 'Очистити гаманець',
    youGet: 'Отримаєш',
    lineFee: (fee: string) => `Обміни — комісія ${fee} · рента — безкоштовно`,
    lineFree: 'Безкоштовно: лише рента',
    unwrap: (amount: string) => `Розгорне ${amount} wSOL у SOL`,
    unwrapNext: (amount: string) => `${amount} wSOL розгорнеться наступним очищенням`,
    small: 'У SOL',
    empty: 'Порожні рахунки',
    litter: 'Спалити',
    noPrice: 'Без ціни',
    emptyWord: 'Порожній',
    dontTouch: 'Не чіпати',
    why: (coin: string) => `Не чіпати — чому ${coin} позначено`,
    include: (coin: string) => `Додати ${coin}`,
    building: 'Готуємо…',
    approve: 'Схвали в гаманці',
    sending: 'Очищаємо…',
    done: (sol: string) => `Повернуто ≈ ${sol} SOL`,
    part: 'Частина пройшла. Решта лишиться до наступного разу.',
    none: 'Нічого не пройшло. Монети там, де й були.',
    declined: 'Не підписано. Нічого не змінилось.',
    failed: 'Зараз не вдалося підготувати.',
    tryAgain: 'Ще раз',
    skipped: (n: number) => `${uk(n, 'монету', 'монети', 'монет')} зараз не обміняти`,
    left: (n: number) => `Ще ${n} — наступного разу`,
    nothing: 'Зараз нічого чистити.',
    howInfo: 'Як працює очищення',
    howText:
      'Монети до $5 обмінюються на SOL за ціною й комісією «Обміну». Порожні рахунки монет закриваються, і їхня рента — близько 0,002 SOL кожен — повертається безкоштовно. Монети без ціни спалюються, а їхні рахунки закриваються. wSOL розгортається у твій SOL, лише коли ти його ввімкнеш. Позначені монети лишаються, доки ти їх не ввімкнеш. Одне схвалення в гаманці.',
    close: 'Закрити',
    reason: (code: string): string => (({ unverified: 'Jupiter не перевірив', mint: 'Творець ще може випускати нові', freeze: 'Творець може заморозити її у твоєму гаманці', delegate: 'Хтось інший може забрати її з будь-якого гаманця', thin: 'Тонкий ринок: продаж зрушить ціну', score: 'Мало справжніх угод', fee: 'Комісія з кожного переказу', hook: 'На кожен переказ спрацьовує сторонній код' }) as Readonly<Record<string, string>>)[code] ?? '',
  },
);

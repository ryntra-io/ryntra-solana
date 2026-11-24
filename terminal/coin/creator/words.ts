import { words } from '../../../city/lib/i18n/dict.ts';

/** Ukrainian plural: one, a few, many. */
const pl = (n: number, one: string, few: string, many: string): string => {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return one;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return few;
  return many;
};

/**
 * The words of the creator's tab under the coin's chart: who launched it, the other coins that wallet
 * launched and how each went, and what it did with this one. English and Ukrainian with the same keys.
 */
export const CREATOR = words(
  {
    tab: 'Creator',
    table: 'Coins of this creator',
    creator: 'Creator',
    openCreator: (who: string) => `Open the creator’s wallet ${who}`,
    launched: (n: number) => `Launched ${n} ${n === 1 ? 'coin' : 'coins'}`,
    listed: (n: number) => `${n} reached a pool`,
    // what the creator did with this coin
    didHolds: 'Holds',
    didSoldSome: 'Sold part',
    didSoldAll: 'Sold everything',
    didMoved: 'Moved to other wallets',
    didNever: 'Never held it',
    holdsShare: (share: string) => `${share} of supply now`,
    soldShare: (share: string) => `sold ${share}`,
    movedShare: (share: string, n: number) => `${share} to ${n} ${n === 1 ? 'wallet' : 'wallets'}`,
    nothingLeft: 'nothing left',
    didUnknown: 'What the creator did with this coin is not read now',
    didHow: 'How it is counted',
    didWhy: 'From the creator’s wallet on the chain since the coin’s launch: what it bought and got, what it sold, what it moved to other wallets without anything coming back, and what it holds now.',
    didPart: 'Only the latest moves were read: the oldest may be missing.',
    // the table
    colCoin: 'Coin',
    colLaunched: 'Launched',
    colPeak: 'Highest cap',
    colNow: 'Now',
    colPool: 'Pool',
    thisCoin: 'This coin',
    onPool: 'Yes',
    onCurve: 'On curve',
    openCoin: (name: string) => `Open ${name}`,
    agoM: (n: string) => `${n}m ago`,
    agoH: (n: string) => `${n}h ago`,
    agoD: (n: string) => `${n}d ago`,
    newest: (shown: string, of: string) => `The newest ${shown} of ${of}`,
    coinsWhy: 'The coins are the launches this wallet signed on the curves of pump.fun, Meteora and LaunchLab. The highest cap is the highest daily price times the supply; «Now» is today’s. A dash — not known.',
    // states
    none: 'No creator is named for this coin',
    quiet: 'The source is quiet — back in a moment',
    again: 'Try again',
    reading: 'Reading the creator',
  },
  {
    tab: 'Творець',
    table: 'Монети цього творця',
    creator: 'Творець',
    openCreator: (who: string) => `Відкрити гаманець творця ${who}`,
    launched: (n: number) => `Запустив ${n} ${pl(n, 'монету', 'монети', 'монет')}`,
    listed: (n: number) => `${n} ${pl(n, 'вийшла', 'вийшли', 'вийшли')} на пул`,
    didHolds: 'Тримає',
    didSoldSome: 'Продав частину',
    didSoldAll: 'Продав усе',
    didMoved: 'Переказав на інші гаманці',
    didNever: 'Не тримав',
    holdsShare: (share: string) => `${share} пропозиції зараз`,
    soldShare: (share: string) => `продав ${share}`,
    movedShare: (share: string, n: number) => `${share} на ${n} ${pl(n, 'гаманець', 'гаманці', 'гаманців')}`,
    nothingLeft: 'нічого не лишилось',
    didUnknown: 'Що творець зробив з монетою, зараз не прочитано',
    didHow: 'Як пораховано',
    didWhy: 'З гаманця творця в ланцюгу від запуску монети: що купив і отримав, що продав, що переказав на інші гаманці без нічого натомість і що тримає зараз.',
    didPart: 'Прочитано лише останні рухи: найстаріших може бракувати.',
    colCoin: 'Монета',
    colLaunched: 'Запуск',
    colPeak: 'Найбільша кап.',
    colNow: 'Зараз',
    colPool: 'Пул',
    thisCoin: 'Ця монета',
    onPool: 'Так',
    onCurve: 'На кривій',
    openCoin: (name: string) => `Відкрити ${name}`,
    agoM: (n: string) => `${n} хв тому`,
    agoH: (n: string) => `${n} год тому`,
    agoD: (n: string) => `${n} дн тому`,
    newest: (shown: string, of: string) => `${shown} найновіших із ${of}`,
    coinsWhy: 'Монети — запуски, які цей гаманець підписав на кривих pump.fun, Meteora й LaunchLab. Найбільша капіталізація — найвища денна ціна, помножена на пропозицію; «Зараз» — сьогоднішня. Риска — невідомо.',
    none: 'Для цієї монети творця не названо',
    quiet: 'Джерело мовчить — повернемося за мить',
    again: 'Ще раз',
    reading: 'Читаємо творця',
  },
);

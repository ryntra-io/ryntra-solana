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
 * The words of the largest holders' links under the coin's chart: the groups the chain ties, their share,
 * what ties them. English and Ukrainian with the same keys.
 */
export const HOLDER_MAP = words(
  {
    tab: 'Links',
    map: 'Map of the largest holders',
    list: 'Groups of linked holders',
    groups: (n: number, share: string) => `${n} ${n === 1 ? 'group holds' : 'groups hold'} ${share}`,
    noGroups: 'No links among the largest holders',
    checked: (n: string, of: string) => `${n} of ${of} largest holders checked`,
    group: (n: string) => `Group ${n}`,
    wallets: (n: number) => `${n} ${n === 1 ? 'wallet' : 'wallets'}`,
    tieCoin: 'Coin from one wallet',
    tieSol: 'SOL from one wallet',
    tieBetween: 'Passed between them',
    creator: 'Creator',
    source: 'source',
    openWallet: (who: string, share: string) => `Open wallet ${who}, ${share}`,
    openSource: (who: string) => `Open wallet ${who}, the one they share`,
    showGroup: (n: string) => `Show group ${n} on the map`,
    how: 'How it is counted',
    why: 'Wallets the chain ties: in their own trades of this coin they got the coin or SOL from one wallet, or passed the coin between them. A pool, a curve or an app that pays fees is never a link. A group is wallets tied on the chain — not proof of one owner.',
    partial: 'A busy wallet is checked on its latest moves of the coin.',
    quiet: 'The source is quiet — back in a moment',
    again: 'Try again',
    reading: 'Reading the links',
  },
  {
    tab: 'Зв’язки',
    map: 'Карта найбільших власників',
    list: 'Групи пов’язаних власників',
    groups: (n: number, share: string) => `${n} ${pl(n, 'група тримає', 'групи тримають', 'груп тримають')} ${share}`,
    noGroups: 'Між найбільшими власниками зв’язків немає',
    checked: (n: string, of: string) => `Перевірено ${n} із ${of} найбільших власників`,
    group: (n: string) => `Група ${n}`,
    wallets: (n: number) => `${n} ${pl(n, 'гаманець', 'гаманці', 'гаманців')}`,
    tieCoin: 'Монети з одного гаманця',
    tieSol: 'SOL з одного гаманця',
    tieBetween: 'Перекази між ними',
    creator: 'Творець',
    source: 'джерело',
    openWallet: (who: string, share: string) => `Відкрити гаманець ${who}, ${share}`,
    openSource: (who: string) => `Відкрити гаманець ${who}, спільний для них`,
    showGroup: (n: string) => `Показати групу ${n} на карті`,
    how: 'Як пораховано',
    why: 'Гаманці, які пов’язує ланцюг: у власних угодах цією монетою вони отримали монети чи SOL з одного гаманця або переказували монету між собою. Пул, крива чи застосунок, що платить комісію, — ніколи не зв’язок. Група — гаманці, пов’язані в ланцюгу, а не доказ одного власника.',
    partial: 'Зайнятий гаманець перевірено за його останніми рухами монети.',
    quiet: 'Джерело мовчить — повернемося за мить',
    again: 'Ще раз',
    reading: 'Читаємо зв’язки',
  },
);

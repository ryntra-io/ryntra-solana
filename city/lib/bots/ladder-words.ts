import type { Lang } from './format.ts';
import type { LadderNetwork } from '../../../lib/bots/ladder/network.ts';
import type { Words } from './words.ts';

/**
 * The ladder's words by network (CITY-219). On devnet the window says what CITY-135 said — «Place on devnet», the
 * Devnet chip; on mainnet the ladder is real: «Place ladder», the fee said as it is (Ryntra takes none on a ladder; the
 * network's fees and the order's rent, back on cancel), the sum, what every step gives and each step's price shown
 * before the signature, and the cap while it stands.
 *
 * CITY-233: the sheet says its network in one word before the signature — «Real SOL» on mainnet, «Test SOL» on devnet;
 * a cancellation that took back only part says so in its own words, with «Cancel the rest»; a ladder this wallet already
 * has on the chain, placed from somewhere else, turns «Place» into «View».
 */

export type LadderNote = 'placed' | 'cancelled' | 'partly' | 'costsChanged' | 'walletNo' | 'refused' | 'unreachable' | 'overCap' | 'checking' | 'rest' | 'elsewhere';

export type LadderWords = Readonly<{
  /** The network's chip beside a placed ladder in «My bots»; null — none (mainnet is the real thing). */
  chip: string | null;
  /** The network in one word, on the sheet and first in the line before the signature: real SOL or test SOL. */
  net: string;
  place: string;
  /** The one action in place of «Place» while this wallet's ladder from elsewhere stands in the pool. */
  view: string;
  /** A bot's action once part of it was taken back: the rest, in one more prompt. */
  cancelRest: string;
  liveTitle: string;
  note: Readonly<Record<LadderNote, string>>;
  cost: (network: string, rent: string, kept: string | null, reserve: string) => string;
  /** The sum's and the outcome's labels over their figures. */
  putIn: string;
  getsAll: string;
  stepsLabel: (n: number) => string;
  overCap: (max: string) => string;
}>;

const ukSteps = (n: number) => {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return `${n} сходинок`;
  if (ones === 1) return `${n} сходинка`;
  if (ones >= 2 && ones <= 4) return `${n} сходинки`;
  return `${n} сходинок`;
};

/** The words both networks share: the rest of a cancellation, a ladder from elsewhere. */
const SHARED: Readonly<Record<Lang, Pick<LadderWords, 'view' | 'cancelRest'> & { note: Pick<Record<LadderNote, string>, 'rest' | 'elsewhere'> }>> = {
  en: { view: 'View', cancelRest: 'Cancel the rest', note: { rest: 'Part taken back — cancel the rest', elsewhere: 'This wallet already has a ladder here' } },
  uk: { view: 'Переглянути', cancelRest: 'Скасувати решту', note: { rest: 'Частину забрано — скасуй решту', elsewhere: 'У цього гаманця тут уже є драбина' } },
};

const MAINNET: Readonly<Record<Lang, Omit<LadderWords, 'note' | 'view' | 'cancelRest'> & { note: Partial<Record<LadderNote, string>> }>> = {
  en: {
    chip: null,
    net: 'Real SOL',
    place: 'Place ladder',
    liveTitle: 'Ladders',
    note: { placed: 'Ladder placed', unreachable: 'The network didn’t answer — try again', overCap: 'Over the limit for now — lower the amount' },
    cost: (network, rent, kept, reserve) =>
      `Ryntra fee 0 · ≈ ${network} SOL network · ${rent} SOL rent, back on cancel${kept ? ` · ${kept} SOL kept by the pool` : ''} · keep ${reserve} SOL`,
    putIn: 'Amount',
    getsAll: 'If every step fills',
    stepsLabel: (n) => `${n} steps`,
    overCap: (max) => `Up to ${max} per ladder for now`,
  },
  uk: {
    chip: null,
    net: 'Справжні SOL',
    place: 'Поставити драбину',
    liveTitle: 'Драбини',
    note: { placed: 'Драбину поставлено', unreachable: 'Мережа не відповіла — спробуй ще', overCap: 'Поки понад межу — зменш суму' },
    cost: (network, rent, kept, reserve) =>
      `Комісія Ryntra 0 · ≈ ${network} SOL мережа · ${rent} SOL рента повернеться${kept ? ` · ${kept} SOL лишиться пулу` : ''} · лишити ${reserve} SOL`,
    putIn: 'Сума',
    getsAll: 'Якщо спрацюють усі',
    stepsLabel: ukSteps,
    overCap: (max) => `Поки до ${max} на драбину`,
  },
};

/** Test money on devnet, said as plainly as the real thing is on mainnet. */
const TEST_SOL: Readonly<Record<Lang, string>> = { en: 'Test SOL', uk: 'Тестові SOL' };

/** The ladder's words for a network, on top of the window's own (devnet keeps CITY-135's). */
export function ladderWords(lang: Lang, network: LadderNetwork, w: Words): LadderWords {
  const shared = SHARED[lang];
  const devnet: LadderWords = {
    chip: w.devnet,
    net: TEST_SOL[lang],
    place: w.place,
    view: shared.view,
    cancelRest: shared.cancelRest,
    liveTitle: w.liveTitle,
    note: { ...w.ladderNote, overCap: MAINNET[lang].note.overCap!, ...shared.note },
    cost: w.liveCost,
    putIn: MAINNET[lang].putIn,
    getsAll: MAINNET[lang].getsAll,
    stepsLabel: MAINNET[lang].stepsLabel,
    overCap: MAINNET[lang].overCap,
  };
  if (network === 'devnet') return devnet;
  const main = MAINNET[lang];
  return { ...main, view: shared.view, cancelRest: shared.cancelRest, note: { ...devnet.note, ...main.note } };
}

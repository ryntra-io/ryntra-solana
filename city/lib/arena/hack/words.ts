import { pl, words } from '../../i18n/dict.ts';

/**
 * The words of Hack as the city will write them (CITY-223, spec `docs/research/city-hack-2026-11-08/SPEC.md`). Only
 * words here — the windows that use them are CITY-227. Both halves (English and Ukrainian) carry the same keys; the
 * i18n test (`city/lib/i18n/i18n.test.mjs`) checks every dictionary again.
 *
 * Technical words never reach a person: «fork», «LiteSVM», program ids, RPC — those live behind «Details», not in this
 * dictionary. The honest line before a signature is one short sentence: the target is a copy, there is a reward, and
 * Ryntra takes a fee.
 */
export const HACK = words(
  {
    // The door and its state.
    hack: 'Hack',
    kicker: 'Break the copy. Harden the real thing.',
    soon: 'Coming soon',
    ordersOpen: (n: number) => (n === 1 ? '1 order open' : `${n} orders open`),
    totalReward: 'Total reward',

    // The main actions, one to a window.
    openOrder: 'Open an order',
    takeOrder: 'Take the order',
    sendAgent: 'Send an agent',
    watch: 'Watch',
    stop: 'Stop',
    confirm: 'Confirm',
    hireBest: 'Hire the best',
    details: 'Details',

    // An order card.
    reward: 'Reward',
    deadline: 'Deadline',
    scope: 'Scope',
    permission: "Owner's permission",

    // The roles.
    protocol: 'Protocol',
    attacker: 'Attacker',
    defender: 'Defender',
    spectator: 'Spectator',

    // A live run.
    stepOf: (n: number, max: number) => `Step ${n} of ${max}`,
    running: 'Running',
    done: 'Done',

    // A finding card: its level and where it stands.
    finding: 'Finding',
    severityCritical: 'Critical',
    severityHigh: 'High',
    severityMedium: 'Medium',
    severityLow: 'Low',
    severityInfo: 'Info',
    statusOnReview: 'On review',
    statusConfirmed: 'Confirmed',
    statusDuplicate: 'Duplicate',
    statusNotReproduced: 'Not reproduced',
    statusBlocked: 'Blocked',

    // The board.
    leaderboard: 'Leaderboard',
    rating: 'Rating',
    findingsCount: (n: number) => (n === 1 ? '1 finding' : `${n} findings`),

    // The one honest line before a signature.
    targetIsCopy: 'The target is a copy — never the live network.',
    feeLine: 'Ryntra takes a fee from a confirmed reward.',
  },
  {
    hack: 'Злам',
    kicker: 'Ламай копію. Зміцнюй справжнє.',
    soon: 'Незабаром',
    ordersOpen: (n: number) => `${n} ${pl(n, 'замовлення відкрито', 'замовлення відкрито', 'замовлень відкрито')}`,
    totalReward: 'Сумарна винагорода',

    openOrder: 'Відкрити замовлення',
    takeOrder: 'Взяти замовлення',
    sendAgent: 'Надіслати агента',
    watch: 'Дивитися',
    stop: 'Зупинити',
    confirm: 'Підтвердити',
    hireBest: 'Найняти найкращого',
    details: 'Деталі',

    reward: 'Винагорода',
    deadline: 'Дедлайн',
    scope: 'Межі',
    permission: 'Дозвіл власника',

    protocol: 'Протокол',
    attacker: 'Атакер',
    defender: 'Захисник',
    spectator: 'Глядач',

    stepOf: (n: number, max: number) => `Крок ${n} з ${max}`,
    running: 'Триває',
    done: 'Готово',

    finding: 'Знахідка',
    severityCritical: 'Критичний',
    severityHigh: 'Високий',
    severityMedium: 'Середній',
    severityLow: 'Низький',
    severityInfo: 'Інформаційний',
    statusOnReview: 'На перевірці',
    statusConfirmed: 'Підтверджено',
    statusDuplicate: 'Дублікат',
    statusNotReproduced: 'Не відтворено',
    statusBlocked: 'Заблоковано',

    leaderboard: 'Табло',
    rating: 'Рейтинг',
    findingsCount: (n: number) => `${n} ${pl(n, 'знахідка', 'знахідки', 'знахідок')}`,

    targetIsCopy: 'Ціль — копія, не жива мережа.',
    feeLine: 'Ryntra бере комісію з підтвердженої винагороди.',
  },
);

import type { Copy } from '../../lib/i18n.ts'
import type { RewardEntryKind, RewardSourceId } from './rewards-model.ts'

const EN = {
  title: 'Rewards',
  available: 'Available',
  pending: 'Pending',
  lifetime: 'Earned in total',
  sources: 'Where it came from',
  source: {
    cashback: 'Cashback',
    referralL1: 'Referrals · level 1',
    referralL2: 'Referrals · level 2',
  } satisfies Record<RewardSourceId, string>,
  claimOnWeb: 'Claiming is done on ryntra.io',
  notStarted: 'Rewards are not accruing yet.',
  points: 'Ryntra Points',
  pointsUnavailable: 'Points are unavailable right now',
  level: (level: number) => `Level ${level}`,
  nextLevelAt: (at: string) => `Next level at ${at} points`,
  readAt: (at: string) => `Read ${at}`,
  topLevel: 'top level',
  rank: (rank: number, of: number) => `#${rank} of ${of}`,
  notRanked: 'Not ranked yet',
  volume: 'Traded volume',
  trades: 'Trades',
  activeDays: 'Active days',
  referral: 'Invite a friend',
  yourCode: 'Your code',
  share: 'Share link',
  invited: (level1: number, level2: number) => `${level1} invited · ${level2} at the second level`,
  invitedBy: (who: string) => `Invited by ${who}`,
  noReferral: 'Your invite link appears after your first trade.',
  recent: 'Recent',
  noEntries: 'Nothing earned yet',
  noEntriesDetail: 'Cashback and referral rewards appear here after a trade.',
  entry: {
    cashback: 'Cashback',
    referralL1: 'Referral · level 1',
    referralL2: 'Referral · level 2',
    claim: 'Paid out',
    other: 'Reward',
  } satisfies Record<RewardEntryKind, string>,
  didNotLoad: 'Rewards did not load',
  loading: 'Loading rewards',
  shareInvite: (link: string) => `Launch tokens, trade and automate on Solana with Ryntra: ${link}`,
  shareSubject: 'Ryntra',
} as const

export type RewardsCopy = {
  readonly [K in keyof typeof EN]: (typeof EN)[K] extends (...args: infer A) => string
    ? (...args: A) => string
    : (typeof EN)[K] extends Record<string, string>
      ? Readonly<Record<keyof (typeof EN)[K], string>>
      : string
}

const UK: RewardsCopy = {
  title: 'Винагороди',
  available: 'Доступно',
  pending: 'Очікує',
  lifetime: 'Зароблено всього',
  sources: 'Звідки',
  source: {
    cashback: 'Кешбек',
    referralL1: 'Реферали · рівень 1',
    referralL2: 'Реферали · рівень 2',
  },
  claimOnWeb: 'Виплата — на ryntra.io',
  notStarted: 'Винагороди ще не нараховуються.',
  points: 'Бали Ryntra',
  pointsUnavailable: 'Бали зараз недоступні',
  level: (level) => `Рівень ${level}`,
  nextLevelAt: (at) => `Наступний рівень — від ${at} балів`,
  readAt: (at) => `Прочитано ${at}`,
  topLevel: 'найвищий рівень',
  rank: (rank, of) => `№${rank} з ${of}`,
  notRanked: 'Ще без рангу',
  volume: 'Обсяг торгів',
  trades: 'Угод',
  activeDays: 'Активних днів',
  referral: 'Запроси друга',
  yourCode: 'Твій код',
  share: 'Поділитися посиланням',
  invited: (level1, level2) => `Запрошено ${level1} · ${level2} на другому рівні`,
  invitedBy: (who) => `Запросив ${who}`,
  noReferral: 'Посилання для запрошення з’явиться після першої угоди.',
  recent: 'Останні',
  noEntries: 'Ще нічого не зароблено',
  noEntriesDetail: 'Кешбек і реферальні винагороди з’являються тут після угоди.',
  entry: {
    cashback: 'Кешбек',
    referralL1: 'Реферал · рівень 1',
    referralL2: 'Реферал · рівень 2',
    claim: 'Виплачено',
    other: 'Винагорода',
  },
  didNotLoad: 'Винагороди не завантажились',
  loading: 'Завантаження винагород',
  shareInvite: (link) => `Запускай токени, торгуй і автоматизуй на Solana з Ryntra: ${link}`,
  shareSubject: 'Ryntra',
}

export const REWARDS_COPY: Copy<RewardsCopy> = { en: EN, uk: UK }

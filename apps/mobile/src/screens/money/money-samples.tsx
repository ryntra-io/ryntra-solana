import { View } from 'react-native'

import { Card } from '@/components/card'
import type { PendingSend } from '@/features/money/money-model'
import type { PayLink, TransferCheck } from '@/lib/api'

import { LinkCard } from './link-card'
import { PayLinkPanel } from './pay-link-panel'
import { SendCheckStep, SendDoneStep } from './send'
import { SendDoneCard, SendPendingCard, SendReview } from './send-parts'

/*
 * «Гроші» in the development gallery: the states a funded wallet and another
 * person's link reach, drawn from sample answers in the contract's shapes, so
 * each is seen in both themes and both languages without moving money.
 */

const ME = '4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n'
const THEM = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SIG = '4Rj7nqXH1o8sS4mWfZtFj1o2hX6Qk1GfJb3Ue9yVJ3cQfHk2t7Wn8ZPaxLmYd5r6e9TqUu2iVb3NcKsRgAp1xYz'
const AT = '2026-10-05T10:24:00.000Z'
/* A `.skr` name THEM's transfer was sent to (M41.2) — a sample only. */
const NAME = 'alice.skr'
/* A recent address THEM imitates: the same first and last four characters, another middle — a sample only. */
const LOOKALIKE_OF = `${THEM.slice(0, 4)}${'1'.repeat(THEM.length - 8)}${THEM.slice(-4)}`

const CHECK: TransferCheck = {
  asset: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  from: ME,
  to: { address: THEM, kind: 'wallet', owner: THEM, account: THEM, opensAccount: true },
  send: { raw: '1000000', amount: '1' },
  issuerFee: null,
  receive: { raw: '1000000', amount: '1', less: false },
  networkFee: { lamports: '15000', sol: '0.000015' },
  setup: { lamports: '2039280', sol: '0.00203928' },
  minimum: null,
  signable: true,
  blocked: null,
  warnings: [],
}

const BLOCKED: TransferCheck = {
  ...CHECK,
  to: { ...CHECK.to, opensAccount: false },
  setup: null,
  issuerFee: { raw: '10000', amount: '0.01', basisPoints: 100 },
  receive: { raw: '990000', amount: '0.99', less: true },
  signable: false,
  blocked: {
    en: 'This transfer would fail on the network right now.',
    uk: 'Цей переказ зараз не пройде в мережі.',
    code: 'SIMULATION_FAILED',
  },
  warnings: [
    {
      en: 'The issuer keeps a fee out of every transfer of this token.',
      uk: 'Емітент утримує комісію з кожного переказу цього токена.',
      code: 'TRANSFER_FEE',
      stops: false,
    },
    {
      en: 'The issuer has paused transfers of this token.',
      uk: 'Емітент призупинив перекази цього токена.',
      code: 'PAUSED',
      stops: true,
    },
  ],
}

const LINK: PayLink = {
  id: 'sample-link',
  url: 'https://ryntra.io/pay/sample-link',
  payUrl: `solana:${THEM}?amount=1`,
  status: 'AWAITING',
  note: null,
  token: { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  amount: { raw: '1000000', display: '1' },
  description: 'Coffee',
  recipient: { abbreviated: '7xKX…sgAsU', address: THEM },
  reference: 'Ref1111111111111111111111111111111111111111',
  createdAt: AT,
  expiresAt: '2026-10-12T10:24:00.000Z',
  paid: null,
}

const PAID: PayLink = {
  ...LINK,
  id: 'sample-paid',
  url: 'https://ryntra.io/pay/sample-paid',
  status: 'PAID',
  recipient: { abbreviated: '4MS4…xfQ1n', address: ME },
  paid: { signature: SIG, creditedRaw: '1000000', credited: '1', paidAt: AT },
}

const PENDING: PendingSend = {
  schema: 'ryntra.mobile.send-pending',
  wallet: ME,
  signature: SIG,
  network: 'mainnet',
  signedAt: AT,
  summary: { amount: '1', symbol: 'USDC', to: THEM },
}

/** The new look's send (M44.4): «Перевірка» to a new address, and «Готово» — on the same sample answers. */
export function SendStepSamples() {
  const none = () => undefined
  return (
    <View className="gap-3">
      {/* The new look's steps (M44.4): «Перевірка» to a new address, and «Готово». */}
      <Card level="elevated">
        <SendCheckStep
          check={CHECK}
          symbol="USDC"
          fresh
          phase="review"
          failure={null}
          blocked={false}
          onConfirm={none}
          onCancel={none}
        />
      </Card>
      {/* M41.2: sent to a `.skr` name — the name, then the whole address it points to now. */}
      <Card level="elevated">
        <SendCheckStep
          check={CHECK}
          symbol="USDC"
          name={NAME}
          fresh
          phase="review"
          failure={null}
          blocked={false}
          onConfirm={none}
          onCancel={none}
        />
      </Card>
      <Card level="elevated">
        <SendCheckStep
          check={CHECK}
          symbol="USDC"
          fresh
          lookalikeOf={LOOKALIKE_OF}
          phase="review"
          failure={null}
          blocked={false}
          onConfirm={none}
          onCancel={none}
        />
      </Card>
      <Card level="elevated">
        <SendDoneStep
          done={{ outcome: 'sent', result: null, signature: SIG, amount: '1', symbol: 'USDC', to: THEM, toName: NAME, at: AT }}
          onReceipt={none}
        />
      </Card>
    </View>
  )
}

export function MoneySamples() {
  const none = () => undefined
  return (
    <View className="gap-3">
      <Card level="elevated">
        <SendReview
          check={CHECK}
          symbol="USDC"
          phase="review"
          failure={null}
          blocked={false}
          onConfirm={none}
          onCancel={none}
        />
      </Card>
      <Card level="elevated">
        <SendReview
          check={BLOCKED}
          symbol="PYUSD"
          phase="review"
          failure={null}
          blocked={false}
          onConfirm={none}
          onCancel={none}
        />
      </Card>
      <SendDoneCard
        done={{ outcome: 'sent', result: null, signature: SIG, amount: '1', symbol: 'USDC', to: THEM, toName: NAME, at: AT }}
        onAgain={none}
      />
      <SendDoneCard
        done={{ outcome: 'open', result: null, signature: SIG, amount: '1', symbol: 'USDC', to: THEM, toName: null, at: AT }}
        onAgain={none}
      />
      <SendPendingCard pending={PENDING} show="UNKNOWN" signedIn={false} signingIn={false} onSignIn={none} />
      <PayLinkPanel link={LINK} />
      <LinkCard link={PAID} />
    </View>
  )
}

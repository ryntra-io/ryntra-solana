/** The words of a receipt's two views (NEW-LOOK §5): Просто · Детально, the technical data folded a tap deeper. */

import type { Copy } from '../../lib/i18n.ts'

export type ReceiptMode = 'glance' | 'full'

export const RECEIPT_MODES: readonly ReceiptMode[] = ['glance', 'full']

export type ModesCopy = Readonly<{
  modes: Readonly<Record<ReceiptMode, string>>
  modesA11y: string
  technical: string
  hideTechnical: string
}>

export const MODES_COPY: Copy<ModesCopy> = {
  en: {
    modes: { glance: 'Summary', full: 'Details' },
    modesA11y: 'Receipt view',
    technical: 'Technical data (JSON)',
    hideTechnical: 'Hide the technical data',
  },
  uk: {
    modes: { glance: 'Просто', full: 'Детально' },
    modesA11y: 'Вигляд квитанції',
    technical: 'Технічні дані (JSON)',
    hideTechnical: 'Сховати технічні дані',
  },
}

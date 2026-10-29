import type { Copy } from '../../lib/i18n.ts'

/** The words of arranging Home's blocks — a sheet's title, a row's two moves, the way back to the start. */
export type BlocksCopy = Readonly<{
  title: string
  shown: (on: number, total: number) => string
  moveUp: (block: string) => string
  moveDown: (block: string) => string
  reset: string
  done: string
}>

export const BLOCKS_COPY: Copy<BlocksCopy> = {
  en: {
    title: 'Home blocks',
    shown: (on, total) => `${on} of ${total}`,
    moveUp: (block) => `Move ${block} up`,
    moveDown: (block) => `Move ${block} down`,
    reset: 'Reset',
    done: 'Done',
  },
  uk: {
    title: 'Блоки Головної',
    shown: (on, total) => `${on} з ${total}`,
    moveUp: (block) => `Перемістити «${block}» вище`,
    moveDown: (block) => `Перемістити «${block}» нижче`,
    reset: 'Скинути',
    done: 'Готово',
  },
}

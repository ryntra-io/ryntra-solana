import { pl, words } from '../../../city/lib/i18n/dict.ts';

/**
 * The words of the reward for a pool's liquidity on the Launch screen, in English and Ukrainian: its name,
 * its two choices, the one line before the signature — how much, for how long, how much of each day Ryntra's locked
 * part earns until others add liquidity, and that it does not come back — and, behind its «i», how it works.
 */
export const PRO_REWARDS = words(
  {
    name: 'Reward liquidity providers',
    info: 'How the reward works',
    share: 'Share of the coins',
    shareChoice: 'How much of the supply goes to the reward',
    term: 'For',
    termChoice: 'How long the reward runs',
    days: (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`,
    line: (amount: string, term: string, ryntraDay: string | null) =>
      ryntraDay === null ? `${amount} over ${term} · until others add liquidity, it comes back to your locked part · cannot be taken back` : `${amount} over ${term} · until others add liquidity: ${ryntraDay} a day to Ryntra’s locked part · cannot be taken back`,
    how: (share: string, mine: string, ryntra: string, mineDay: string, ryntraDay: string) =>
      `${share} of the supply goes into the pool with the supply’s signature and flows second by second from the opening, for the days you pick, to every position that holds the price, by its size. The pool cannot leave a position out: until others add liquidity there, the launch’s locked liquidity earns all of it — ${mine} yours (${mineDay} a day, you collect it), ${ryntra} Ryntra’s (${ryntraDay} a day). The more others add, the more goes to them. It cannot be stopped or taken back; only what flows while no liquidity stands at the price comes back to you when the days are over.`,
    poolHow: (locked: string, reward: string) => `Straight to a pool: no curve and no move — the coin trades in its own Meteora pool from the time you pick. ${locked} of the supply goes in as liquidity nobody can take out; ${reward} pays liquidity providers. Three approvals: the coin, the pool, the supply.`,
    poolHowLadder: (locked: string, yours: string, reward: string) => `Straight to a pool: no curve and no move — the coin trades in its own Meteora pool from the time you pick. ${locked} of the supply goes in as liquidity nobody can take out; ${yours} stays yours on the ladder; ${reward} pays liquidity providers. Three approvals: the coin, the pool, the supply.`,
  },
  {
    name: 'Нагорода вкладникам',
    info: 'Як працює нагорода',
    share: 'Частка монет',
    shareChoice: 'Скільки пропозиції йде на нагороду',
    term: 'Строк',
    termChoice: 'Скільки триває нагорода',
    days: (n: number) => `${n} ${pl(n, 'день', 'дні', 'днів')}`,
    line: (amount: string, term: string, ryntraDay: string | null) =>
      ryntraDay === null ? `${amount} на ${term} · доки інших вкладників немає, вона повертається твоїй замкненій частці · назад не забрати` : `${amount} на ${term} · доки інших вкладників немає: ${ryntraDay} на день — замкненій частці Ryntra · назад не забрати`,
    how: (share: string, mine: string, ryntra: string, mineDay: string, ryntraDay: string) =>
      `${share} пропозиції заходять у пул із підписом пропозиції й щосекунди йдуть від відкриття торгів стільки днів, скільки ти обереш, кожній позиції, що тримає ціну, за її розміром. Пул не може оминути позицію: доки інші не додадуть ліквідності біля ціни, усю нагороду заробляє замкнена ліквідність запуску — ${mine} тобі (${mineDay} на день, забираєш сам), ${ryntra} Ryntra (${ryntraDay} на день). Що більше додадуть інші, то більше йде їм. Її не зупинити й не забрати; повертається тобі лише те, що припало на час без ліквідності біля ціни, — коли дні скінчаться.`,
    poolHow: (locked: string, reward: string) => `Одразу в пул: без кривої й без переїзду — монета торгується у власному пулі Meteora з часу, який ти обереш. ${locked} пропозиції заходять ліквідністю, яку не забере ніхто; ${reward} — нагорода вкладникам. Три підписи: монета, пул, пропозиція.`,
    poolHowLadder: (locked: string, yours: string, reward: string) => `Одразу в пул: без кривої й без переїзду — монета торгується у власному пулі Meteora з часу, який ти обереш. ${locked} пропозиції заходять ліквідністю, яку не забере ніхто; ${yours} лишаються твоїми на драбині; ${reward} — нагорода вкладникам. Три підписи: монета, пул, пропозиція.`,
  },
);

/**
 * The words of the new look's Home, its blocks and the profile sheet. Neutral to gender,
 * «ти» in Ukrainian; one name for one thing.
 */

import type { Copy } from '../../lib/i18n.ts'
import type { KeepFor } from '../session/keep-connected.ts'

export type HomeAction = 'buy' | 'swap' | 'send' | 'receive'

export type PlaceHomeCopy = Readonly<{
  total: string
  updated: (at: string) => string
  actions: Readonly<Record<HomeAction, string>>
  search: string
  inbox: string
  inboxCount: (count: number) => string
  profile: string
  favourites: string
  allMarkets: string
  /** The Favourites block's door — it opens «Ринки · Обране», so it names Обране, not every market. */
  allFavourites: string
  favouritesEmpty: string
  myMarkets: string
  myLaunches: string
  /** A launch on its way to trading, with how far it has come; then trading. */
  feesToClaim: string
  recent: string
  allHistory: string
  /** «Що купити» — Home's «Купити». */
  pickTitle: string
  coins: string
  pricesAt: (at: string) => string
  /** The profile sheet. */
  signedIn: string
  connected: string
  copyAddress: string
  copied: string
  wallet: string
  switchWallet: string
  settings: string
  signIn: string
  disconnect: string
  connect: string
  /** «Тримати під’єднаним» (ST-2): the row, its four choices, what it means behind «?», the end said once. */
  keepConnected: string
  keepChoices: Readonly<Record<KeepFor, string>>
  keepWhat: string
  keepHelp: string
  /**
   * How the sign-in lives, in plain words — the one text behind «?» in the profile sheet and in Settings (ST-5): the
   * server's day is never shown as a second end; the phone renews it while Ryntra is opened online.
   */
  renewHelp: string
  /** Settings' line while «поки не вийду» is chosen: no clock, since the sign-in renews itself. */
  signedInRenews: string
  /** Settings' line while a time is chosen: the one end the person chose, the same the profile sheet shows. */
  signedInUntil: (at: string) => string
  keepTimed: string
  /** The chosen end, as a line says a time: «о 14:32», «завтра о 09:00». */
  keepEndsAt: (at: string) => string
  keepUntil: (clock: string) => string
  keepEnded: string
}>

export const PLACE_HOME_COPY: Copy<PlaceHomeCopy> = {
  en: {
    total: 'Total',
    updated: (at) => `updated ${at}`,
    actions: { buy: 'Buy', swap: 'Swap', send: 'Send', receive: 'Receive' },
    search: 'Search',
    inbox: 'Inbox',
    inboxCount: (count) => `Inbox, ${count} unread`,
    profile: 'Profile',
    favourites: 'Favourites',
    allMarkets: 'All markets',
    allFavourites: 'All favourites',
    favouritesEmpty: 'Add from Markets',
    myMarkets: 'My markets',
    myLaunches: 'My launches',
    feesToClaim: 'Fees to claim',
    recent: 'Recent',
    allHistory: 'All history',
    pickTitle: 'What to buy',
    coins: 'Coins',
    pricesAt: (at) => `Prices ${at}`,
    signedIn: 'Signed in',
    connected: 'Connected, not signed in',
    copyAddress: 'Copy address',
    copied: 'Address copied',
    wallet: 'Wallet',
    switchWallet: 'Switch',
    settings: 'Settings',
    signIn: 'Sign in with your wallet',
    disconnect: 'Disconnect wallet',
    connect: 'Connect wallet',
    keepConnected: 'Keep connected',
    keepChoices: { hour: '1 h', twoHours: '2 h', day: 'a day', untilSignOut: 'until I sign out' },
    keepWhat: 'What this means',
    keepHelp: 'Stays connected after a restart, offline and with the wallet app closed.',
    renewHelp:
      'The sign-in renews by itself while you open Ryntra online. Only if Ryntra stays closed for about a day does the wallet ask for one signature again — it stays connected.',
    signedInRenews: 'Signed in · renews by itself',
    signedInUntil: (at) => `Signed in until ${at}`,
    keepTimed:
      'When the time is up, the wallet disconnects — at once, or the next time you open Ryntra. Connecting again starts the chosen time over.',
    keepEndsAt: (at) => `Disconnects ${at}`,
    keepUntil: (clock) => `until ${clock}`,
    keepEnded: 'Wallet disconnected — the time you chose is up',
  },
  uk: {
    total: 'Усього',
    updated: (at) => `оновлено ${at}`,
    actions: { buy: 'Купити', swap: 'Обмін', send: 'Надіслати', receive: 'Отримати' },
    search: 'Пошук',
    inbox: 'Вхідні',
    inboxCount: (count) => `Вхідні, непрочитаних: ${count}`,
    profile: 'Профіль',
    favourites: 'Обране',
    allMarkets: 'Усі ринки',
    allFavourites: 'Усе обране',
    favouritesEmpty: 'Додати з Ринків',
    myMarkets: 'Мої ринки',
    myLaunches: 'Мої лаунчі',
    feesToClaim: 'Є комісії до збору',
    recent: 'Останнє',
    allHistory: 'Уся історія',
    pickTitle: 'Що купити',
    coins: 'Монети',
    pricesAt: (at) => `Ціни ${at}`,
    signedIn: 'Вхід виконано',
    connected: 'Під’єднано, вхід не виконано',
    copyAddress: 'Скопіювати адресу',
    copied: 'Адресу скопійовано',
    wallet: 'Гаманець',
    switchWallet: 'Змінити',
    settings: 'Налаштування',
    signIn: 'Увійти гаманцем',
    disconnect: 'Відключити гаманець',
    connect: 'Під’єднати гаманець',
    keepConnected: 'Тримати під’єднаним',
    keepChoices: { hour: '1 год', twoHours: '2 год', day: 'доба', untilSignOut: 'поки не вийду' },
    keepWhat: 'Що це означає',
    keepHelp: 'Лишається під’єднаним після перезапуску, без мережі й коли застосунок гаманця закрито.',
    renewHelp:
      'Вхід оновлюється сам, поки відкриваєш Ryntra з мережею. Лише якщо Ryntra не відкривати близько доби, гаманець попросить один підпис знову — під’єднаним він лишається.',
    signedInRenews: 'Вхід виконано · оновлюється сам',
    signedInUntil: (at) => `Вхід до ${at}`,
    keepTimed:
      'Коли час мине, гаманець відключиться — одразу або коли наступного разу відкриєш Ryntra. Нове під’єднання починає обраний час спочатку.',
    keepEndsAt: (at) => `Відключиться ${at}`,
    keepUntil: (clock) => `до ${clock}`,
    keepEnded: 'Гаманець відключено — минув обраний час',
  },
}

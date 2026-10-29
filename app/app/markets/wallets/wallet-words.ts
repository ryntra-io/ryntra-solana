import type { WorkspaceLocale } from "@/app/shell/locale";

/**
 * «Стеження за гаманцями» (SOL-R4) in both languages: «Ринки» → «Гаманці» — the wallets a person follows, each one's
 * trades and result read from the chain, the labels it earned, and what Ryntra tells them of. On «ти»; no advice.
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const WALLET_WORDS = {
  title: bi("Wallets", "Гаманці"),
  lookup: bi("Wallet or token address", "Адреса гаманця або токена"),
  lookupHint: bi("A token's address opens its creator's wallet.", "Адреса токена відкриє гаманець його творця."),
  show: bi("Show", "Показати"),
  notAddress: bi("That is not a Solana address.", "Це не адреса Solana."),
  following: bi("Following", "Стежу"),
  followingCount: bi("{count} of {limit}", "{count} з {limit}"),
  emptyFollows: bi("You follow no wallet yet. Paste an address above.", "Ти ще не стежиш за жодним гаманцем. Встав адресу вище."),
  connectToFollow: bi("Connect a wallet to follow wallets and get alerts.", "Підключи гаманець, щоб стежити за гаманцями й отримувати сповіщення."),
  proveToFollow: bi("Confirm your wallet to see the wallets you follow.", "Підтверди гаманець, щоб побачити, за ким стежиш."),
  prove: bi("Confirm wallet", "Підтвердити гаманець"),
  follow: bi("Follow", "Стежити"),
  unfollow: bi("Stop following", "Не стежити"),
  alerts: bi("Alerts", "Сповіщення"),
  alertsAll: bi("Every trade", "Кожна угода"),
  alertsSells: bi("Sales only", "Лише продажі"),
  alertsOff: bi("Off", "Вимкнено"),
  alertsWhere: bi("To your inbox, Telegram and push — as set in “Notifications”.", "У Вхідні, Telegram і push — як налаштовано в «Сповіщеннях»."),
  name: bi("Name", "Назва"),
  namePlaceholder: bi("e.g. Whale 1", "напр. Кит 1"),
  save: bi("Save", "Зберегти"),
  limit: bi("You follow 20 wallets — stop following one first.", "Ти стежиш за 20 гаманцями — спершу прибери один."),
  noCreator: bi("Jupiter names no creator for {symbol}.", "Jupiter не називає творця {symbol}."),
  failed: bi("That did not go through. Try again.", "Не вдалося. Спробуй ще раз."),
  rateLimited: bi("Too many reads in a minute. Wait a moment.", "Забагато читань за хвилину. Зачекай трохи."),
  chainDown: bi("The chain could not be read just now.", "Мережу зараз не вдалося прочитати."),
  reload: bi("Try again", "Спробувати ще"),
  creatorOf: bi("Creator of {symbol}", "Творець {symbol}"),
  result: bi("Result", "Результат"),
  realized: bi("Realized {value}", "Реалізовано {value}"),
  open: bi("in positions {value}", "у позиціях {value}"),
  noResult: bi("No trade with a price yet", "Ще немає угоди з ціною"),
  unknownResult: bi("Not known", "Невідомо"),
  afterFees: bi("After fees · data completeness {pct} %", "Після комісій · повнота даних {pct} %"),
  honest: bi("Honest result", "Чесний результат"),
  honestExit: bi(
    "Exit price: the pool's depth is half the token's liquidity (Jupiter); Ryntra's fee by fee policy v2 and the network's fee come off.",
    "Ціна виходу: глибина пулу — половина ліквідності токена (Jupiter); віднято комісію Ryntra за політикою комісій v2 і комісію мережі.",
  ),
  honestFollower: bi("What a follower would have kept of it — below, «If you had copied this wallet».", "Що лишилося б послідовнику — нижче, «Якби ти копіював цей гаманець»."),
  feesEstimated: bi("Some trades were read before fees were kept: their network fee is estimated at 0.000105 SOL.", "Частину угод прочитано до того, як ми зберігали комісії: комісія мережі для них — оцінка 0,000105 SOL."),
  winLoss: bi("{wins} in profit · {losses} at a loss", "{wins} у плюсі · {losses} у мінусі"),
  window: bi("From {count} transactions since {date}", "За {count} транзакціями з {date}"),
  windowAll: bi("From all {count} transactions", "За всіма {count} транзакціями"),
  readAt: bi("Solana chain, read {time}", "Ланцюг Solana, прочитано {time}"),
  partial: bi("Some sales have no known cost — left out.", "Частина продажів без відомої ціни купівлі — не враховано."),
  approx: bi("Dollar trades in SOL at today's price.", "Угоди в доларах — у SOL за ціною зараз."),
  skipped: bi("{count} transactions between reads were not read.", "{count} транзакцій між читаннями не прочитано."),
  gap: bi("More came between reads than one read holds — some were not read.", "Між читаннями було більше, ніж вміщує одне читання, — частину не прочитано."),
  tokens: bi("Tokens", "Токени"),
  trades: bi("Trades", "Угоди"),
  colToken: bi("Token", "Токен"),
  colTrades: bi("Buys / sells", "Купівлі / продажі"),
  colResult: bi("Result, SOL", "Результат, SOL"),
  colHeld: bi("Holds now", "Тримає зараз"),
  colTime: bi("Time", "Час"),
  colSide: bi("Trade", "Угода"),
  colAmount: bi("Amount", "Кількість"),
  colPaid: bi("For", "Сума"),
  buy: bi("Bought", "Купив"),
  sell: bi("Sold", "Продав"),
  got: bi("Got", "Отримав"),
  paidBy: bi("paid by {who}", "заплатив {who}"),
  tx: bi("Transaction", "Транзакція"),
  noTrades: bi("No trade in the transactions read.", "У прочитаних транзакціях угод немає."),
  creator: bi("Creator", "Творець"),
  sniper: bi("Sniper", "Снайпер"),
  bundle: bi("Bundle", "Бандл"),
  creatorNote: bi("The token's creator, as Jupiter names it.", "Творець токена, як його називає Jupiter."),
  sniperNote: bi("Bought within two minutes of the token's creation.", "Купив у перші дві хвилини після створення токена."),
  bundleNote: bi("Bought in the creation's own block, or got tokens the creator paid for.", "Купив у блоці створення або отримав токени, за які заплатив творець."),
  watchLiquidity: bi("Alert: liquidity −30%", "Сповістити: ліквідність −30 %"),
  watchLiquidityShort: bi("Liquidity −30% alert", "Ліквідність −30 %"),
  watchLiquidityNote: bi("Ryntra's token watch: liquidity −30% in an hour. Three are free.", "Стеження помічника: ліквідність −30 % за годину. Три — безкоштовно."),
  watching: bi("Watching", "Стежу"),
  watchFull: bi("Your three free watches are in use.", "Три безкоштовні стеження вже зайняті."),
  explorer: bi("Explorer", "Оглядач"),
  readOnly: bi("Read-only: following a wallet buys and sells nothing.", "Лише читання: стеження нічого не купує й не продає."),
  copy: bi("Copy address", "Скопіювати адресу"),
  copied: bi("Copied", "Скопійовано"),
  back: bi("All wallets", "Усі гаманці"),
  lastTrade: bi("{side} {symbol} · {ago}", "{side} {symbol} · {ago}"),
  noTradeYet: bi("No trade read yet", "Угод ще не прочитано"),
} as const;

export type WalletWord = keyof typeof WALLET_WORDS;

export function walletWords(locale: WorkspaceLocale) {
  const lang = locale === "uk" ? "uk" : "en";
  return (key: WalletWord, values?: Readonly<Record<string, string | number>>) => {
    let text: string = WALLET_WORDS[key][lang];
    if (values) for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}

import { langNow } from '../i18n/lang.ts';
import type { EarnTab, ProductId } from './flag.ts';
import type { PierGoal, PierStyle } from './pier.ts';
import type { ClosePlan, StepKind } from './stock-pier-hours.ts';

/**
 * Earn's words in English and Ukrainian, in one small object until the city's dictionaries (CITY-79,
 * `city/lib/i18n/**`) land — then these move there as they are. The language follows the browser's: Ukrainian for a
 * Ukrainian browser, English otherwise.
 */

export type Lang = 'en' | 'uk';

type ProductWords = Readonly<{ name: string; line: string; action: string; context: string }>;

/** The Dollar Saver's card (CITY-192). */
export type DollarWords = Readonly<{
  deposit: string;
  withdraw: string;
  amount: string;
  max: string;
  rate: string;
  yearAtRate: string;
  inSaver: string;
  earnedSoFar: string;
  canLeave: string;
  noFee: string;
  minimum: string;
  risk: string;
  riskWhat: string;
  rateFloats: string;
  partialFine: string;
  provider: string;
  unavailable: string;
  building: string;
  wallet: string;
  sending: string;
  checking: string;
  put: string;
  take: string;
  doneIn: string;
  doneOut: string;
  doneLine: string;
  again: string;
  explorer: string;
  problem: Readonly<Record<'zero' | 'minimum' | 'balance' | 'position' | 'liquidity' | 'canary', string>>;
  refusals: Readonly<Record<string, string>> & Readonly<{ fallback: string }>;
}>;

export type Words = Readonly<{
  title: string;
  tabs: Readonly<Record<EarnTab, string>>;
  earned: string;
  vsHold: string;
  inSol: string;
  notMeasured: string;
  products: Readonly<Record<ProductId, ProductWords>>;
  perYear: string;
  riskLabel: (dots: number) => string;
  notify: string;
  notifyOn: string;
  notifyDetails: string;
  back: string;
  open: string;
  details: string;
  connect: string;
  tryAgain: string;
  unavailable: string;
  saver: Readonly<{
    lsts: string;
    cancelled: string;
    amount: string;
    max: string;
    youGet: string;
    worth: string;
    yearAtRate: string;
    fee: string;
    noFee: string;
    minimum: string;
    network: string;
    networkRent: string;
    rent: string;
    lstFee: string;
    exitSpread: string;
    entryCost: string;
    route: string;
    risk: string;
    riskWhat: string;
    method: string;
    methodChain: string;
    methodSanctum: string;
    source: string;
    review: string;
    building: string;
    sign: string;
    wallet: string;
    sending: string;
    checking: string;
    done: string;
    doneLine: string;
    failed: string;
    failedLine: string;
    unknown: string;
    again: string;
    explorer: string;
    fine: string;
    problem: Readonly<Record<'format' | 'zero' | 'decimals' | 'balance', string>>;
  }>;
  piers: Readonly<{ fees24h: string; liquidity: string; add: string; read: string; empty: string; fine: string }>;
  pier: Readonly<{
    boats: string;
    piers: string;
    inRange: string;
    outOfRange: string;
    fees24h: string;
    depth: string;
    tradeFee: string;
    styles: Readonly<Record<PierStyle, string>>;
    style: string;
    goals: Readonly<Record<PierGoal, string>>;
    goal: string;
    amount: string;
    max: string;
    goesIn: string;
    range: string;
    past: string;
    inRangeShare: string;
    vsHold: string;
    beforeFees: string;
    noFee: string;
    minimum: string;
    risk: string;
    rent: string;
    rentBack: string;
    network: string;
    /** One approval of the wallet, however many transactions it signs (CITY-198). */
    approval: (n: number) => string;
    dayFees: string;
    venue: string;
    bins: string;
    slippage: string;
    pastFine: string;
    fine: string;
    review: string;
    add: string;
    building: string;
    wallet: string;
    sending: string;
    checking: string;
    done: string;
    doneLine: string;
    partial: string;
    failed: string;
    unknown: string;
    again: string;
    toPiers: string;
    explorer: string;
    take: string;
    leave: string;
    youTake: string;
    youGetBack: string;
    holds: string;
    closes: string;
    stays: string;
    nothingToTake: string;
    feesElsewhere: string;
    stopped: string;
    get: (symbol: string) => string;
    fresh: string;
    /** The Zap (CITY-198): SOL in, one approval. */
    put: string;
    swapFee: (pct: string) => string;
    swap: string;
    swapGets: string;
    viaJupiter: (labels: string) => string;
    viaPool: string;
    ryntraFee: string;
    poolNoFee: string;
    checked: string;
    zapFine: string;
    partialZap: (symbol: string) => string;
    takeRest: string;
    restBack: (sol: string) => string;
    restDone: string;
    restLine: string;
    problem: Readonly<Record<'format' | 'min' | 'ceiling' | 'sol', (figure: string) => string>>;
    failures: Readonly<Record<'PIER_CLOSED' | 'PIER_STOPPED' | 'PIER_CEILING' | 'PIER_UNPRICED' | 'PIER_PAIR' | 'PIER_VENUE' | 'ZAP_PRICE' | 'ZAP_UNPRICED' | 'ZAP_NO_ROUTE' | 'NOTHING_TO_WITHDRAW', string>>;
  }>;
  captain: Readonly<{
    strategies: string;
    vsHold: string;
    fall: string;
    copies: string;
    days: (n: number) => string;
    copy: string;
    fees: string;
    price: string;
    style: string;
    live: string;
    noneTitle: string;
    noneLine: string;
    fine: string;
    copied: string;
    copiedLine: string;
  }>;
  dollar: DollarWords;
  mine: Readonly<{
    dollars: string;
    lsts: string;
    piers: string;
    stocks: string;
    inRange: string;
    outOfRange: string;
    filled: string;
    dividends: string;
    dividendsNone: string;
    split: string;
    unmeasured: string;
    emptyTitle: string;
    emptyLine: string;
    start: string;
    connectTitle: string;
    connectLine: string;
    dividendFine: string;
    vsHoldFine: string;
  }>;
  stock: Readonly<{
    pick: string;
    volume7d: string;
    price: string;
    newPier: string;
    standing: (fee: string) => string;
    depth: string;
    amount: string;
    max: string;
    atClose: string;
    plans: Readonly<Record<ClosePlan, string>>;
    planLine: Readonly<Record<ClosePlan, string>>;
    hours: Readonly<{ open: (at: string) => string; closing: (at: string) => string; closed: (at: string) => string; openNow: string; closedNow: string }>;
    units: Readonly<{ h: string; min: string; d: string }>;
    step: Readonly<{ ahead: Readonly<Record<StepKind, (when: string) => string>>; hold: Readonly<Record<StepKind, (when: string) => string>> }>;
    build: string;
    moor: string;
    noFee: string;
    minimum: string;
    risk: string;
    venue: string;
    venueValue: string;
    tradeFee: string;
    tradeFeeValue: (fee: string) => string;
    feesIn: string;
    priceAt: string;
    poolRent: string;
    poolRentStays: string;
    positionRent: string;
    templateFine: string;
    closeFine: string;
    dividendFine: string;
    issuerFine: string;
    hoursFine: string;
    fine: string;
    built: string;
    builtLine: (quote: string) => string;
    moored: string;
    mooredLine: string;
    taken: string;
    left: string;
    boats: string;
    stepOut: string;
    stepOutLine: string;
    empty: string;
    stopped: string;
    problem: Readonly<{ format: (unit: string) => string; min: (figure: string) => string; ceiling: (figure: string) => string; quote: (unit: string) => string; stock: (symbol: string) => string; dividend: string }>;
    failures: Readonly<Record<'STOCK_PIER_CLOSED' | 'STOCK_PIER_STOPPED' | 'STOCK_PIER_PAIR' | 'STOCK_PIER_DIVIDEND' | 'STOCK_PIER_UNPRICED' | 'STOCK_PIER_CEILING' | 'STOCK_PIER_PRICE', string>>;
  }>;
}>;

const EN: Words = {
  title: 'Earn',
  tabs: { shelf: 'Shelf', piers: 'Piers', mine: 'Mine' },
  earned: 'Earned',
  vsHold: 'Vs holding',
  inSol: 'SOL',
  notMeasured: 'Not measured',
  products: {
    saver: { name: 'SOL Saver', line: 'SOL → staked SOL, one signature', action: 'Start', context: 'Last epoch, a year' },
    pier: { name: 'SOL Pier', line: 'Fees in SOL from a SOL pool', action: 'Add liquidity', context: 'Top pier, fees 24H' },
    dollar: { name: 'Dollar Saver', line: 'Lend USDC or SOL at a floating rate', action: 'Put to work', context: 'USDC lending now' },
    sell: { name: 'Sell Higher', line: 'Your price, set and left', action: 'Open', context: 'SOL now' },
    stockpier: { name: 'Stock Pier', line: 'Your own pool of a stock, fees in SOL', action: 'Build a pier', context: '7D volume' },
    stocks: { name: 'Dollars for Stocks', line: 'Borrow USDC against your stocks', action: 'Open', context: 'Stock price now' },
    captain: { name: 'Like the Captain', line: 'Copy a strategy with a proven record', action: 'Copy', context: 'Best record · vs holding' },
  },
  perYear: 'a year',
  riskLabel: (dots) => `Risk ${dots} of 3`,
  notify: 'Tell me when it opens',
  notifyOn: 'We’ll tell you here',
  notifyDetails: 'Kept on this device: the city tells you here when it opens. Phone and Telegram alerts come with Ryntra’s alerts.',
  back: 'Back',
  open: 'Open',
  details: 'Details',
  connect: 'Connect wallet',
  tryAgain: 'Try again',
  unavailable: 'Not available right now.',
  saver: {
    lsts: 'Staked SOL',
    cancelled: 'Cancelled in your wallet. Nothing was sent.',
    amount: 'Amount',
    max: 'Max',
    youGet: 'You get',
    worth: 'Worth',
    yearAtRate: 'A year at this rate',
    fee: 'Fee',
    noFee: 'No Ryntra fee',
    minimum: 'Min',
    network: 'Network',
    networkRent: 'Network + rent',
    rent: 'Account deposit',
    lstFee: 'Pool’s share of rewards',
    exitSpread: 'Swap back now',
    entryCost: 'Cost on the way in',
    route: 'Route',
    risk: 'Risk: may trade below SOL',
    riskWhat: 'An LST can trade below its worth in SOL when its market thins. Its worth in SOL comes from staking and does not fall with SOL’s price in dollars.',
    method: 'Rate',
    methodChain: 'The token’s worth in SOL this epoch against the last, from the stake pool on chain, compounded over a year’s epochs.',
    methodSanctum: 'Sanctum’s latest-epoch rate for this token.',
    source: 'Read',
    review: 'Review',
    building: 'Checking…',
    sign: 'Sign in wallet',
    wallet: 'Confirm in your wallet',
    sending: 'Sending…',
    checking: 'Checking the network…',
    done: 'Done',
    doneLine: 'Now earning in SOL.',
    failed: 'Failed',
    failedLine: 'Only the network fee moved.',
    unknown: 'Not known yet',
    again: 'Again',
    explorer: 'Explorer',
    fine: 'The rate is the last epoch’s and moves every epoch; it is no promise. Your wallet signs; Ryntra holds no keys.',
    problem: { format: 'Type an amount of SOL.', zero: 'Type more than zero.', decimals: 'SOL has 9 decimals.', balance: 'More than the wallet can spend.' },
  },
  piers: {
    fees24h: 'Fees 24H',
    liquidity: 'Liquidity',
    add: 'Add liquidity',
    read: 'Meteora’s figures',
    empty: 'No pier deep enough right now.',
    fine: 'A day’s fees are no promise of the next. If the price leaves the range you keep your tokens and stop earning.',
  },
  pier: {
    boats: 'Your boats',
    piers: 'SOL piers',
    inRange: 'Earning',
    outOfRange: 'Out of range',
    fees24h: 'Fees 24H',
    depth: 'Depth',
    tradeFee: 'Trade fee',
    styles: { calm: 'Calm', balanced: 'Balanced', dense: 'Dense' },
    style: 'Style',
    goals: { even: 'Even', near: 'Near price', edges: 'Catch moves' },
    goal: 'Goal',
    amount: 'You put in',
    max: 'Max',
    goesIn: 'Goes in',
    range: 'Earns between',
    past: 'Past 30 days',
    inRangeShare: 'In range',
    vsHold: 'Vs holding',
    beforeFees: 'before fees',
    noFee: 'Fee 0',
    minimum: 'Min',
    risk: 'Out of range — stops earning',
    rent: 'Account deposit',
    rentBack: 'back on exit',
    network: 'Network',
    approval: (n) => (n > 1 ? `${n} transactions, one approval` : 'One approval'),
    dayFees: 'The day gone, this amount’s share of fees',
    venue: 'Meteora DLMM · even spread',
    bins: 'Bins each side',
    slippage: 'Price may move',
    pastFine: 'Had this style opened 30 days ago: how much of the time the price stayed inside it, and where it ended against just holding the same coins — before fees, which Meteora states for the last day only. The past, not a promise.',
    fine: 'Fees accrue in both coins and are counted here in SOL at today’s price. If the price leaves the range you keep your coins and stop earning until it returns. Your wallet signs every step; Ryntra holds no keys and adds no fee to a position.',
    review: 'Review',
    add: 'Add liquidity',
    building: 'Getting exact figures…',
    wallet: 'Confirm in your wallet',
    sending: 'Reading the network…',
    checking: 'Check again',
    done: 'Moored',
    doneLine: 'Your boat is at the pier. It earns while the price stays in range.',
    partial: 'Part of it landed. The rest needs a fresh Review — see your boats.',
    failed: 'It did not go through. Only the network fee was spent.',
    unknown: 'Sent; the network has not answered yet. Nothing will be sent again.',
    again: 'Again',
    toPiers: 'Piers',
    explorer: 'Explorer',
    take: 'Take fees',
    leave: 'Leave',
    youTake: 'You take',
    youGetBack: 'You get back',
    holds: 'Holds',
    closes: 'the position closes',
    stays: 'the position stays',
    nothingToTake: 'Nothing to take yet',
    feesElsewhere: 'Fees of this position go to another address.',
    stopped: 'New deposits are paused. Taking fees and leaving still work.',
    get: (symbol) => `Get ${symbol}`,
    fresh: 'Prices moved — the figures are fresh. Check them and confirm again.',
    put: 'Put in',
    swapFee: (pct) => `Fee ${pct} on the swap`,
    swap: 'Swap',
    swapGets: 'Swap brings at least',
    viaJupiter: (labels) => `Jupiter${labels ? ` · ${labels}` : ''}`,
    viaPool: 'The pool itself',
    ryntraFee: 'Ryntra fee',
    poolNoFee: 'none — the pool’s own swap',
    checked: 'Checked against the market price',
    zapFine: 'Part of your SOL is swapped for the other coin and both go in, in one approval. The swap goes through Jupiter or the pool itself, whichever brings more; through Jupiter, Ryntra takes its swap fee — in the pool, none. Your wallet signs; you can leave any time.',
    partialZap: (symbol) => `The swap went through, the deposit did not. Your SOL and ${symbol} are in your wallet.`,
    takeRest: 'Take back as SOL',
    restBack: (sol) => `≈ ${sol} SOL back to your wallet`,
    restDone: 'Back in your wallet',
    restLine: 'What the Zap left is SOL again.',
    problem: {
      format: () => 'Type an amount of SOL.',
      min: (figure) => `At least ${figure} SOL.`,
      ceiling: (figure) => `Up to ${figure} SOL for now.`,
      sol: () => 'Not enough SOL, with the deposit for the account.',
    },
    failures: {
      PIER_CLOSED: 'The Harbor is not open to this wallet yet.',
      PIER_STOPPED: 'New deposits are paused right now.',
      PIER_CEILING: 'More than the Harbor takes in one go for now.',
      PIER_UNPRICED: 'Meteora gives no price for this pool right now.',
      PIER_PAIR: 'Only SOL piers open from here.',
      PIER_VENUE: 'Only SOL piers open from here.',
      ZAP_PRICE: 'The swap would bring less than the coins are worth now. Nothing was sent.',
      ZAP_UNPRICED: 'No market price to check the swap against right now.',
      ZAP_NO_ROUTE: 'No swap for this amount right now. Try a little later.',
      NOTHING_TO_WITHDRAW: 'Nothing of it is left in your wallet.',
    },
  },
  captain: {
    strategies: 'Proven strategies',
    vsHold: 'Vs holding',
    fall: 'Deepest fall',
    copies: 'Copies',
    days: (n) => `${n} days`,
    copy: 'Copy',
    fees: 'Fees',
    price: 'Price move',
    style: 'Style',
    live: 'Copies earning now',
    noneTitle: 'No strategy has a record yet',
    noneLine: 'A strategy shows here after 30 days and 5 copies.',
    fine: 'The record of people’s own copies, measured from the chain once a day since each opened: fees, and the price’s move, against keeping the same coins. A strategy shows only after 30 days of record and copies from 5 wallets; its deepest fall always stands beside it. The past — not a promise.',
    copied: 'Copied',
    copiedLine: 'Your boat sails the captain’s course. It earns while the price stays in range.',
  },
  dollar: {
    deposit: 'Put in',
    withdraw: 'Take back',
    amount: 'Amount',
    max: 'Max',
    rate: 'a year now',
    yearAtRate: 'A year at today’s rate',
    inSaver: 'In the Saver',
    earnedSoFar: 'Earned',
    canLeave: 'Can leave today',
    noFee: 'Ryntra 0%',
    minimum: 'min',
    risk: 'Risk: the lending market',
    riskWhat: 'Your coins are lent through Jupiter Lend. The rate floats with borrowers’ demand. The main risk is the lending market itself: a smart-contract fault, or a day when borrowers hold so much that a withdrawal waits for liquidity.',
    rateFloats: 'The rate is the market’s own and moves with it; a year at today’s rate is a reading, never a promise. Jupiter Lend charges no deposit or withdrawal fee, and Ryntra takes nothing. The network’s fee is paid by your wallet.',
    partialFine: 'When the market cannot pay all of it today, the part it can pay is taken back and the rest stays in, still earning.',
    provider: 'Jupiter Lend',
    unavailable: 'The rate is not read right now',
    building: 'Preparing…',
    wallet: 'Confirm in your wallet',
    sending: 'Sending…',
    checking: 'Checking…',
    put: 'Put in',
    take: 'Take back',
    doneIn: 'Working',
    doneOut: 'Back in your wallet',
    doneLine: 'Your position and what it earns are in Mine.',
    again: 'Again',
    explorer: 'Open in explorer',
    problem: {
      zero: 'Enter an amount',
      minimum: 'Below the minimum',
      balance: 'More than the wallet holds',
      position: 'More than is in the Saver',
      liquidity: 'The market cannot pay out right now',
      canary: 'Smaller amounts for now',
    },
    refusals: {
      fallback: 'Not sent. Try again.',
      CANCELLED: 'Cancelled in the wallet. Nothing moved.',
      UNKNOWN: 'Sent — the network has not confirmed yet. Your balance will show it.',
      FAILED: 'The network did not take it. Nothing moved.',
      RATE_MOVED: 'The rate moved. Nothing moved — try again.',
      NO_LIQUIDITY: 'The market cannot pay this today. Nothing moved.',
      TICKET_EXPIRED: 'That took too long. Nothing moved — try again.',
      BELOW_MINIMUM: 'Below the minimum.',
      OVER_WALLET: 'More than the wallet holds.',
      OVER_POSITION: 'More than is in the Saver.',
      NOTHING_IN_POSITION: 'Nothing in the Saver yet.',
      CANARY_LIMIT: 'Smaller amounts for now.',
      ACTIONS_CLOSED: 'Not open yet.',
      NO_KEY: 'Jupiter Lend is not reachable right now.',
      PROVIDER_DOWN: 'Jupiter Lend is not reachable right now.',
      RATE_LIMITED: 'Too many tries. Wait a moment.',
    },
  },
  mine: {
    dollars: 'Dollar Saver',
    lsts: 'Staked SOL',
    piers: 'Piers',
    stocks: 'Stocks',
    inRange: 'In range',
    outOfRange: 'Out of range',
    filled: 'Filled',
    dividends: 'Dividends this year',
    dividendsNone: 'No dividend seen yet',
    split: 'Split — not income',
    unmeasured: 'Some positions have no figure here',
    emptyTitle: 'Nothing earning yet',
    emptyLine: 'Start with SOL: stake it in one signature.',
    start: 'SOL Saver',
    connectTitle: 'Your earnings in SOL',
    connectLine: 'Connect to see what you hold and how it stands against holding.',
    dividendFine: 'xStocks reinvest dividends by raising the token’s multiplier. Counted on the balance you hold now; a split changes the units, not the worth, and is never counted.',
    vsHoldFine: 'Earned: what the products paid, net of costs on the way in. Vs holding: against keeping the same coins. Pier dollars turned into SOL at today’s price. Different assets are never added together.',
  },
  stock: {
    pick: 'Stock',
    volume7d: '7D volume',
    price: 'Price',
    newPier: 'No pier yet — you build it',
    standing: (fee) => `Pier stands · fee ${fee}`,
    depth: 'Depth',
    amount: 'You put in',
    max: 'Max',
    atClose: 'At the close',
    plans: { stay: 'Stay', leave: 'Step out' },
    planLine: { stay: 'Earns through the gap', leave: 'Out before the close' },
    hours: {
      open: (at) => `Market open · closes ${at}`,
      closing: (at) => `Closes at ${at}`,
      closed: (at) => `Market closed · opens ${at}`,
      openNow: 'Market open',
      closedNow: 'Market closed',
    },
    units: { h: 'h', min: 'min', d: 'd' },
    step: {
      ahead: { dividend: (when) => `Dividend in ${when}`, split: (when) => `Split in ${when}`, units: (when) => `Units change in ${when}` },
      hold: { dividend: (when) => `Dividend — new liquidity waits ${when}`, split: (when) => `Split — new liquidity waits ${when}`, units: (when) => `Units change — new liquidity waits ${when}` },
    },
    build: 'Build pier',
    moor: 'Moor',
    noFee: 'Fee 0',
    minimum: 'Min',
    risk: 'Weekend gap',
    venue: 'Pool',
    venueValue: 'Meteora DAMM v2 · whole curve',
    tradeFee: 'Trade fee',
    tradeFeeValue: (fee) => `${fee} + volatility part`,
    feesIn: 'Fees paid in',
    priceAt: 'Pool opens at',
    poolRent: 'Pool accounts',
    poolRentStays: 'stay the pool’s',
    positionRent: 'Position deposit',
    templateFine: 'Exchange hours: the pool covers the whole price curve, so a gap over a close never leaves its range. Its fee is set once, when it is built — 0.30 % plus a part that rises when the price jumps, as it does at the open — and it is paid in the quote coin only.',
    closeFine: 'Stay keeps earning through the close. Step out reminds you here before the exchange closes, with one tap to leave; you moor again after the open. Nothing moves without your signature.',
    dividendFine: 'An xStock pays its dividend by raising the token’s multiplier at a set time, while the share price drops at the open. Between the two the pool’s price can lag the market, so new liquidity waits from a day before the step until a quarter of an hour after. The stock in the pool still takes its dividend.',
    issuerFine: 'The issuer of an xStock can pause or move the token, the pool’s share included. The price is set from the live market when the pool is built.',
    hoursFine: 'The hours are the issuer’s own trading period for the reference exchange.',
    fine: 'Only stocks the issuer and Jupiter name, that Meteora takes as they are, and that traded in the last 7 days. Your wallet signs; Ryntra holds no keys and adds no fee to a pool.',
    built: 'Pier built',
    builtLine: (quote) => `Your pier stands and earns its fees in ${quote}.`,
    moored: 'Moored',
    mooredLine: 'Your boat is at the pier, earning fees.',
    taken: 'Fees taken',
    left: 'Out of the pier',
    boats: 'Your stock piers',
    stepOut: 'Step out',
    stepOutLine: 'Your plan: out before the close.',
    empty: 'No stock is busy enough for a pier right now.',
    stopped: 'New piers are paused. Taking fees and leaving still work.',
    problem: {
      format: (unit) => `Type an amount of ${unit}.`,
      min: (figure) => `At least ${figure}.`,
      ceiling: (figure) => `Up to ${figure} for now.`,
      quote: (unit) => (unit === 'SOL' ? 'Not enough SOL, with the deposit for the accounts.' : `Not enough ${unit}, or SOL for the accounts.`),
      stock: (symbol) => `Not enough ${symbol} for the other half.`,
      dividend: 'New liquidity waits for the corporate step to pass.',
    },
    failures: {
      STOCK_PIER_CLOSED: 'The Stock Pier is not open to this wallet yet.',
      STOCK_PIER_STOPPED: 'New piers are paused right now.',
      STOCK_PIER_PAIR: 'This stock is not offered right now.',
      STOCK_PIER_DIVIDEND: 'New liquidity waits for the corporate step to pass.',
      STOCK_PIER_UNPRICED: 'There is no live price to open the pool at right now.',
      STOCK_PIER_CEILING: 'More than the Stock Pier takes in one go for now.',
      STOCK_PIER_PRICE: 'This pier’s price is off the market right now. Nothing was built.',
    },
  },
};

const UK: Words = {
  title: 'Заробіток',
  tabs: { shelf: 'Полиця', piers: 'Причали', mine: 'Моє' },
  earned: 'Зароблено',
  vsHold: 'Проти тримання',
  inSol: 'SOL',
  notMeasured: 'Не виміряно',
  products: {
    saver: { name: 'SOL-скарбничка', line: 'SOL → застейканий SOL одним підписом', action: 'Почати', context: 'Остання епоха, на рік' },
    pier: { name: 'SOL-причал', line: 'Комісії в SOL з пулу SOL', action: 'Додати ліквідність', context: 'Найкращий причал, комісії 24 год' },
    dollar: { name: 'Доларова скарбничка', line: 'Позичити USDC чи SOL під змінний відсоток', action: 'Покласти працювати', context: 'Позика USDC зараз' },
    sell: { name: 'Продам дорожче', line: 'Своя ціна — поставив і забув', action: 'Відкрити', context: 'SOL зараз' },
    stockpier: { name: 'Причал акцій', line: 'Свій пул акції, комісії в SOL', action: 'Збудувати причал', context: 'Обсяг 7 дн' },
    stocks: { name: 'Долари під акції', line: 'Взяти USDC під свої акції', action: 'Відкрити', context: 'Ціна акції зараз' },
    captain: { name: 'Як у капітана', line: 'Скопіювати стратегію з доведеним результатом', action: 'Копіювати', context: 'Найкращий результат · проти тримання' },
  },
  perYear: 'на рік',
  riskLabel: (dots) => `Ризик ${dots} з 3`,
  notify: 'Повідомити, коли відкриється',
  notifyOn: 'Повідомимо тут',
  notifyDetails: 'Зберігається на цьому пристрої: місто скаже тут, щойно відкриється. Сповіщення на телефон і в Telegram — разом зі сповіщеннями Ryntra.',
  back: 'Назад',
  open: 'Відкрити',
  details: 'Деталі',
  connect: 'Підключити',
  tryAgain: 'Ще раз',
  unavailable: 'Зараз недоступно.',
  saver: {
    lsts: 'Застейканий SOL',
    cancelled: 'Скасовано в гаманці. Нічого не надіслано.',
    amount: 'Сума',
    max: 'Усе',
    youGet: 'Отримаєте',
    worth: 'Вартість',
    yearAtRate: 'За рік за цією ставкою',
    fee: 'Комісія',
    noFee: 'Без комісії Ryntra',
    minimum: 'Мін.',
    network: 'Мережа',
    networkRent: 'Мережа й рента',
    rent: 'Депозит рахунку',
    lstFee: 'Частка пулу з нагород',
    exitSpread: 'Обмін назад зараз',
    entryCost: 'Втрата на вході',
    route: 'Маршрут',
    risk: 'Ризик: ціна LST може бути нижчою за SOL',
    riskWhat: 'LST може торгуватися нижче своєї вартості в SOL, коли ринок рідшає. Вартість у SOL росте від стейкінгу й не падає разом із ціною SOL у доларах.',
    method: 'Ставка',
    methodChain: 'Вартість токена в SOL цієї епохи проти минулої — з пулу стейкінгу в мережі, складена за епохи року.',
    methodSanctum: 'Ставка Sanctum за останню епоху для цього токена.',
    source: 'Прочитано',
    review: 'Перевірити',
    building: 'Перевіряємо…',
    sign: 'Підписати в гаманці',
    wallet: 'Підтвердьте в гаманці',
    sending: 'Надсилаємо…',
    checking: 'Перевіряємо мережу…',
    done: 'Готово',
    doneLine: 'Тепер заробляє в SOL.',
    failed: 'Не вдалося',
    failedLine: 'Пішла лише комісія мережі.',
    unknown: 'Ще невідомо',
    again: 'Ще раз',
    explorer: 'Оглядач',
    fine: 'Ставка — за останню епоху й змінюється щоепохи; це не обіцянка. Підписує твій гаманець; ключів Ryntra не тримає.',
    problem: { format: 'Введи суму в SOL.', zero: 'Більше за нуль.', decimals: 'У SOL 9 знаків після коми.', balance: 'Більше, ніж можна витратити з гаманця.' },
  },
  piers: {
    fees24h: 'Комісії 24 год',
    liquidity: 'Ліквідність',
    add: 'Додати ліквідність',
    read: 'Дані Meteora',
    empty: 'Зараз немає достатньо глибокого причалу.',
    fine: 'Комісії за день не обіцяють наступного. Якщо ціна вийде з діапазону, токени лишаються твоїми, але заробіток зупиняється.',
  },
  pier: {
    boats: 'Твої човни',
    piers: 'SOL-причали',
    inRange: 'Заробляє',
    outOfRange: 'Поза діапазоном',
    fees24h: 'Комісії 24 год',
    depth: 'Глибина',
    tradeFee: 'Комісія обміну',
    styles: { calm: 'Спокійно', balanced: 'Збалансовано', dense: 'Щільно' },
    goals: { even: 'Рівно', near: 'Біля ціни', edges: 'Ловити рухи' },
    goal: 'Мета',
    style: 'Стиль',
    amount: 'Ви вкладаєте',
    max: 'Макс',
    goesIn: 'Піде в пул',
    range: 'Заробляє між',
    past: 'Останні 30 днів',
    inRangeShare: 'У діапазоні',
    vsHold: 'Проти тримання',
    beforeFees: 'без комісій',
    noFee: 'Комісія 0',
    minimum: 'Мін.',
    risk: 'Поза діапазоном — не заробляє',
    rent: 'Депозит рахунку',
    rentBack: 'повернеться при виході',
    network: 'Мережа',
    approval: (n) => (n > 1 ? `${n} транзакції, одне схвалення` : 'Одне схвалення'),
    dayFees: 'Минулої доби частка комісій на цю суму',
    venue: 'Meteora DLMM · рівномірно',
    bins: 'Кошиків з кожного боку',
    slippage: 'Ціна може зрушити',
    pastFine: 'Якби цей стиль відкрили 30 днів тому: скільки часу ціна була всередині й де позиція опинилась проти простого тримання тих самих монет — без комісій, бо Meteora дає їх лише за останню добу. Це минуле, а не обіцянка.',
    fine: 'Комісії нараховуються в обох монетах і рахуються тут у SOL за сьогоднішньою ціною. Якщо ціна вийде з діапазону, монети лишаються твоїми, а заробіток зупиняється, доки вона не повернеться. Кожен крок підписує твій гаманець; ключів Ryntra не тримає й комісії до позиції не додає.',
    review: 'Перевірити',
    add: 'Додати ліквідність',
    building: 'Рахуємо точні цифри…',
    wallet: 'Підтверди в гаманці',
    sending: 'Читаємо мережу…',
    checking: 'Перевірити ще раз',
    done: 'Пришвартовано',
    doneLine: 'Твій човен біля причалу. Він заробляє, доки ціна в діапазоні.',
    partial: 'Частина пройшла. Решті потрібна нова перевірка — дивіться свої човни.',
    failed: 'Не пройшло. Витрачено лише комісію мережі.',
    unknown: 'Надіслано; мережа ще не відповіла. Повторно нічого не надсилаємо.',
    again: 'Ще раз',
    toPiers: 'Причали',
    explorer: 'Оглядач',
    take: 'Забрати комісії',
    leave: 'Вийти',
    youTake: 'Ви забираєте',
    youGetBack: 'Повернеться',
    holds: 'Тримає',
    closes: 'позиція закриється',
    stays: 'позиція лишається',
    nothingToTake: 'Поки нічого забирати',
    feesElsewhere: 'Комісії цієї позиції йдуть на іншу адресу.',
    stopped: 'Нові внески призупинено. Забрати комісії й вийти можна.',
    get: (symbol) => `Отримати ${symbol}`,
    fresh: 'Ціни зрушили — цифри оновлено. Переглянь і підтверди ще раз.',
    put: 'Покласти',
    swapFee: (pct) => `Комісія ${pct} на обмін`,
    swap: 'Обмін',
    swapGets: 'Обмін дасть щонайменше',
    viaJupiter: (labels) => `Jupiter${labels ? ` · ${labels}` : ''}`,
    viaPool: 'Сам пул',
    ryntraFee: 'Комісія Ryntra',
    poolNoFee: 'немає — обмін у самому пулі',
    checked: 'Звірено з ринковою ціною',
    zapFine: 'Частина твого SOL обмінюється на другу монету, і обидві йдуть у пул — одним схваленням. Обмін іде через Jupiter або сам пул — де вигідніше; через Jupiter Ryntra бере комісію обміну, у пулі — ні. Підписує твій гаманець; вийти можна будь-коли.',
    partialZap: (symbol) => `Обмін пройшов, внесок — ні. Твої SOL і ${symbol} у гаманці.`,
    takeRest: 'Забрати як SOL',
    restBack: (sol) => `≈ ${sol} SOL повернеться в гаманець`,
    restDone: 'Повернуто в гаманець',
    restLine: 'Те, що лишилось від Zap, знову в SOL.',
    problem: {
      format: () => 'Введи суму в SOL.',
      min: (figure) => `Щонайменше ${figure} SOL.`,
      ceiling: (figure) => `Поки до ${figure} SOL.`,
      sol: () => 'Бракує SOL разом із депозитом рахунку.',
    },
    failures: {
      PIER_CLOSED: 'Гавань для цього гаманця ще не відкрита.',
      PIER_STOPPED: 'Нові внески зараз призупинено.',
      PIER_CEILING: 'Більше, ніж Гавань поки приймає за раз.',
      PIER_UNPRICED: 'Meteora зараз не дає ціни цього пулу.',
      PIER_PAIR: 'Звідси відкриваються лише SOL-причали.',
      PIER_VENUE: 'Звідси відкриваються лише SOL-причали.',
      ZAP_PRICE: 'Обмін дав би менше, ніж монети варті зараз. Нічого не надіслано.',
      ZAP_UNPRICED: 'Зараз немає ринкової ціни, щоб звірити обмін.',
      ZAP_NO_ROUTE: 'Зараз немає обміну на цю суму. Спробуй трохи пізніше.',
      NOTHING_TO_WITHDRAW: 'У гаманці нічого з цього не лишилось.',
    },
  },
  captain: {
    strategies: 'Стратегії з результатом',
    vsHold: 'Проти тримання',
    fall: 'Просідання',
    copies: 'Копій',
    days: (n) => `${n} ${ukDays(n)}`,
    copy: 'Копіювати',
    fees: 'Комісії',
    price: 'Рух ціни',
    style: 'Стиль',
    live: 'Копій заробляє зараз',
    noneTitle: 'Ще жодна стратегія не має результату',
    noneLine: 'Стратегія з’явиться тут після 30 днів і 5 копій.',
    fine: 'Результат власних копій людей, виміряний із мережі щодня від відкриття кожної: комісії й рух ціни проти тих самих монет у гаманці. Стратегія з’являється лише після 30 днів результату й копій із 5 гаманців; її найглибше просідання завжди поруч. Це минуле — не обіцянка.',
    copied: 'Скопійовано',
    copiedLine: 'Твій човен іде курсом капітана. Він заробляє, поки ціна в діапазоні.',
  },
  dollar: {
    deposit: 'Покласти',
    withdraw: 'Забрати',
    amount: 'Сума',
    max: 'Усе',
    rate: 'на рік зараз',
    yearAtRate: 'За рік за сьогоднішньою ставкою',
    inSaver: 'У скарбничці',
    earnedSoFar: 'Нараховано',
    canLeave: 'Можна забрати сьогодні',
    noFee: 'Ryntra 0%',
    minimum: 'мін.',
    risk: 'Ризик: ринок позик',
    riskWhat: 'Твої монети позичаються через Jupiter Lend. Ставка змінюється з попитом позичальників. Головний ризик — сам ринок позик: збій смарт-контракту або день, коли позичальники забрали стільки, що виведення чекає ліквідності.',
    rateFloats: 'Ставка — ринкова й рухається з ринком; «за рік за сьогоднішньою ставкою» — орієнтир, не обіцянка. Jupiter Lend не бере плати за внесок і виведення, Ryntra не бере нічого. Мережеву плату сплачує твій гаманець.',
    partialFine: 'Якщо ринок сьогодні не може виплатити все, забирається те, що він може, а решта лишається й далі заробляє.',
    provider: 'Jupiter Lend',
    unavailable: 'Ставку зараз не прочитано',
    building: 'Готуємо…',
    wallet: 'Підтверди в гаманці',
    sending: 'Надсилаємо…',
    checking: 'Перевіряємо…',
    put: 'Покласти',
    take: 'Забрати',
    doneIn: 'Працює',
    doneOut: 'Знову в гаманці',
    doneLine: 'Позиція й нараховане — у вкладці «Моє».',
    again: 'Ще раз',
    explorer: 'Відкрити в експлорері',
    problem: {
      zero: 'Введи суму',
      minimum: 'Менше за мінімум',
      balance: 'Більше, ніж у гаманці',
      position: 'Більше, ніж у скарбничці',
      liquidity: 'Ринок зараз не може виплатити',
      canary: 'Поки що менші суми',
    },
    refusals: {
      fallback: 'Не надіслано. Спробуй ще раз.',
      CANCELLED: 'Скасовано в гаманці. Нічого не змінилося.',
      UNKNOWN: 'Надіслано — мережа ще не підтвердила. Баланс покаже.',
      FAILED: 'Мережа не прийняла. Нічого не змінилося.',
      RATE_MOVED: 'Ставка змінилася. Нічого не змінилося — спробуй ще раз.',
      NO_LIQUIDITY: 'Ринок сьогодні не може виплатити цю суму. Нічого не змінилося.',
      TICKET_EXPIRED: 'Задовго. Нічого не змінилося — спробуй ще раз.',
      BELOW_MINIMUM: 'Менше за мінімум.',
      OVER_WALLET: 'Більше, ніж у гаманці.',
      OVER_POSITION: 'Більше, ніж у скарбничці.',
      NOTHING_IN_POSITION: 'У скарбничці поки нічого.',
      CANARY_LIMIT: 'Поки що менші суми.',
      ACTIONS_CLOSED: 'Ще не відкрито.',
      NO_KEY: 'Jupiter Lend зараз недоступний.',
      PROVIDER_DOWN: 'Jupiter Lend зараз недоступний.',
      RATE_LIMITED: 'Забагато спроб. Зачекай хвилинку.',
    },
  },
  mine: {
    dollars: 'Доларова скарбничка',
    lsts: 'Застейканий SOL',
    piers: 'Причали',
    stocks: 'Акції',
    inRange: 'У діапазоні',
    outOfRange: 'Поза діапазоном',
    filled: 'Виконано',
    dividends: 'Дивіденди цього року',
    dividendsNone: 'Дивідендів ще не було',
    split: 'Спліт — не дохід',
    unmeasured: 'Частина позицій без цифри',
    emptyTitle: 'Ще нічого не заробляє',
    emptyLine: 'Почни з SOL: застейкай одним підписом.',
    start: 'SOL-скарбничка',
    connectTitle: 'Твій заробіток у SOL',
    connectLine: 'Підключи гаманець, щоб бачити позиції й результат проти тримання.',
    dividendFine: 'xStocks реінвестують дивіденди, піднімаючи множник токена. Рахуємо на кількість, що є зараз; спліт змінює кількість, а не вартість, і ніколи не рахується.',
    vsHoldFine: 'Зароблено — що заплатили продукти, за вирахуванням витрат на вході. Проти тримання — порівняно з тими самими монетами в гаманці. Долари причалів — у SOL за сьогоднішньою ціною. Різні активи не складаємо.',
  },
  stock: {
    pick: 'Акція',
    volume7d: 'Обсяг 7 дн',
    price: 'Ціна',
    newPier: 'Причалу ще немає — збудуєте ви',
    standing: (fee) => `Причал стоїть · комісія ${fee}`,
    depth: 'Глибина',
    amount: 'Ви вкладаєте',
    max: 'Макс',
    atClose: 'На закриття біржі',
    plans: { stay: 'Лишитися', leave: 'Вийти' },
    planLine: { stay: 'Заробляє і через геп', leave: 'Виходить до закриття' },
    hours: {
      open: (at) => `Біржа відкрита · закриття о ${at}`,
      closing: (at) => `Закриття о ${at}`,
      closed: (at) => `Біржа закрита · відкриття ${at}`,
      openNow: 'Біржа відкрита',
      closedNow: 'Біржа закрита',
    },
    units: { h: 'год', min: 'хв', d: 'дн' },
    step: {
      ahead: { dividend: (when) => `Дивіденд через ${when}`, split: (when) => `Спліт через ${when}`, units: (when) => `Зміна одиниць через ${when}` },
      hold: { dividend: (when) => `Дивіденд — нова ліквідність чекає ${when}`, split: (when) => `Спліт — нова ліквідність чекає ${when}`, units: (when) => `Зміна одиниць — нова ліквідність чекає ${when}` },
    },
    build: 'Збудувати причал',
    moor: 'Пришвартуватися',
    noFee: 'Комісія 0',
    minimum: 'Мін.',
    risk: 'геп на вихідних',
    venue: 'Пул',
    venueValue: 'Meteora DAMM v2 · уся крива',
    tradeFee: 'Комісія обміну',
    tradeFeeValue: (fee) => `${fee} + частина за волатильність`,
    feesIn: 'Комісії в',
    priceAt: 'Пул відкриється за',
    poolRent: 'Рахунки пулу',
    poolRentStays: 'лишаються пулу',
    positionRent: 'Депозит позиції',
    templateFine: 'Години біржі: пул покриває всю криву ціни, тож геп через закриття не виводить його з діапазону. Комісію задано раз, при будівництві, — 0,30 % плюс частина, що росте, коли ціна стрибає, як на відкритті, — і платиться лише в монеті пари.',
    closeFine: '«Лишитися» — заробляє і через закриття. «Вийти» — нагадаємо тут до закриття біржі, вийти одним дотиком; після відкриття пришвартуєшся знову. Без твого підпису нічого не рухається.',
    dividendFine: 'xStock платить дивіденд, піднімаючи множник токена в заданий час, а ціна акції падає на відкритті. Поміж цим ціна пулу може відставати від ринку, тож нова ліквідність чекає від доби до кроку й до чверті години після. Акція в пулі свій дивіденд отримує.',
    issuerFine: 'Емітент xStock може призупинити чи перемістити токен, зокрема частку пулу. Ціну задаємо з живого ринку в момент будівництва.',
    hoursFine: 'Години — власний торговий період емітента для біржі-орієнтира.',
    fine: 'Лише акції, які називають емітент і Jupiter, які Meteora приймає як є і якими торгували за 7 днів. Підписує твій гаманець; ключів Ryntra не тримає й комісії до пулу не додає.',
    built: 'Причал збудовано',
    builtLine: (quote) => `Твій причал стоїть і заробляє комісії в ${quote}.`,
    moored: 'Пришвартовано',
    mooredLine: 'Твій човен біля причалу й заробляє комісії.',
    taken: 'Комісії забрано',
    left: 'Ви вийшли з причалу',
    boats: 'Твої причали акцій',
    stepOut: 'Вийти',
    stepOutLine: 'Твій план: вийти до закриття.',
    empty: 'Зараз жодна акція не має достатнього обігу для причалу.',
    stopped: 'Нові причали призупинено. Забрати комісії й вийти можна.',
    problem: {
      format: (unit) => `Введи суму в ${unit}.`,
      min: (figure) => `Щонайменше ${figure}.`,
      ceiling: (figure) => `Поки до ${figure}.`,
      quote: (unit) => (unit === 'SOL' ? 'Бракує SOL разом із депозитом рахунків.' : `Бракує ${unit} або SOL на рахунки.`),
      stock: (symbol) => `Бракує ${symbol} на другу половину.`,
      dividend: 'Нова ліквідність чекає, доки мине корпоративний крок.',
    },
    failures: {
      STOCK_PIER_CLOSED: 'Причал акцій для цього гаманця ще не відкритий.',
      STOCK_PIER_STOPPED: 'Нові причали зараз призупинено.',
      STOCK_PIER_PAIR: 'Ця акція зараз не пропонується.',
      STOCK_PIER_DIVIDEND: 'Нова ліквідність чекає, доки мине корпоративний крок.',
      STOCK_PIER_UNPRICED: 'Зараз немає живої ціни, щоб відкрити пул.',
      STOCK_PIER_CEILING: 'Більше, ніж Причал акцій поки приймає за раз.',
      STOCK_PIER_PRICE: 'Ціна цього причалу зараз не ринкова. Нічого не зібрано.',
    },
  },
};

export const WORDS: Readonly<Record<Lang, Words>> = { en: EN, uk: UK };

/** «день», «дні», «днів» — as Ukrainian counts days. */
export function ukDays(n: number): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return 'день';
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'дні';
  return 'днів';
}

/** The browser's language: Ukrainian when it leads with it, English otherwise (the city's own choice comes first). */
export function langOf(languages: readonly string[] | undefined): Lang {
  return (languages ?? []).some((l, i) => i === 0 && /^uk\b/i.test(l)) ? 'uk' : 'en';
}

/** Earn's words in the city's language (CITY-79): the menu's switch, a `?lang=` link, else the browser's. */
export function earnWords(lang: Lang = langNow()): Words {
  return WORDS[lang] ?? EN;
}

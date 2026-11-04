import { DISCOUNT_ON } from '../../partners/discount.ts';
import { termsRows } from '../../partners/terms.ts';
import { cards, list, p, part, qa, row, rows, steps, sub, type Sections } from './shape.ts';

const WHAT = 'What it is';
const HOW = 'How to do it';
const COST = 'What it costs';
const WRONG = 'What can go wrong';

/** The documentation in English (CITY-180). The product's facts come; every figure comes from `facts.ts`. */
export const EN: Sections = {
  start: ({ f, say }) => ({
    lead: 'Ryntra is your AI agent on Solana, and the whole market is a live 3D city. In a few minutes you can connect a wallet and make your first trade.',
    related: ['city', 'trade', 'money'],
    action: { label: 'Enter the city', href: '/' },
    parts: [
      part(
        'what',
        WHAT,
        p('The idea fits in one line: **say it, and your agent does the rest.** Today the agent explains the market and prepares a plan, and you act on it in one tap. Each next step gives it more to do for you; [[agent|Your agent]] shows what works now and what is coming.'),
        { kind: 'figure', shot: 'city', alt: "The Ryntra city with its towers, the top bar and the menu", caption: "The city as it opens: the market above, seven places below, your wallet at the top." },
        p('The market is a city. Every Solana coin is a tower: tap one to see it, buy it or sell it. There is nothing to sign up for. Your wallet is your account.'),
        p('Your money and your keys stay in your wallet. Nothing moves without your signature, and Ryntra earns a small fee on trades and launches that you see before you sign.'),
        sub('need', 'What you need', false, list('A Solana wallet: **Phantom**, **Solflare** or **Backpack**, or the wallet built into a **Seeker** phone.', 'Some SOL or USDC. Keep a little SOL in any case: the network takes its fee in SOL.', 'A computer or a phone. The city runs in the browser.')),
      ),
      part(
        'how',
        'Your first five minutes',
        steps(
          'Open [[/|the city]]. It loads as a live 3D skyline of the market.',
          'No wallet yet? Install Phantom, Solflare or Backpack, then write its recovery phrase on paper. It is the only copy, and nobody needs to see it, Ryntra included.',
          'Tap **Connect wallet** and approve it in your wallet. No money moves and nothing is charged.',
          'Add money. Open **Money**, then **Top up**, copy your Solana address and send SOL or USDC to it. From an exchange, choose the Solana network when you withdraw. See [[money|Money]].',
          'Tap any tower. In its window choose **Buy**, then an amount, and read the fee.',
          'Confirm in your wallet. The coins land in your wallet and your tower glows in your colour.',
        ),
        sub(
          'phone',
          'On a phone',
          false,
          p('Open ryntra.io in the browser built into your wallet app: Phantom, Solflare and Backpack all have one. In an ordinary phone browser, **Open in Phantom** takes you there.'),
        ),
      ),
      part(
        'cost',
        COST,
        rows(
          row('Looking around, connecting a wallet', 'Free'),
          row('A trade', `${say.pct(f.fees.stable)} to ${say.pct(f.fees.meme)}`, 'Depends on the coin. [[fees|All fees]]'),
          row('The Solana network', 'A few cents', 'Paid in SOL, to the network'),
          row('A coin you hold for the first time', 'A small deposit', 'In SOL, once, for its account in your wallet'),
        ),
      ),
      part(
        'wrong',
        WRONG,
        cards(
          ['“No Solana wallet in this browser”', 'Install a wallet, or open ryntra.io inside your wallet app.'],
          ['You cannot pay the network fee', 'Your wallet needs a little SOL even when you trade USDC. Top up some SOL first.'],
          ['Money sent on the wrong network', 'Your address takes Solana only. Always pick the Solana network on an exchange; a transfer on another network may not arrive.'],
          ['Someone asks for your recovery phrase', 'Refuse. Ryntra will never ask for it. More in [[security|Security]].'],
        ),
      ),
    ],
  }),

  city: ({ say, f }) => ({
    lead: 'The whole Solana market, as one skyline you can read at a glance. Size is what a coin is worth, light is what is moving right now.',
    related: ['trade', 'launch', 'agent'],
    action: { label: 'Enter the city', href: '/' },
    parts: [
      part(
        'what',
        WHAT,
        cards(
          ['Height', 'A taller tower is a coin with a bigger market cap, on a scale that lets small coins still stand out. A coin with little liquidity behind it cannot stand taller than that liquidity can carry.'],
          ['Light', 'Towers that move light up. A sharp rise and a sharp fall each flash over the tower, and the bell at the top lists what just moved.'],
          ['Your colour', 'A coin you hold glows in your colour, so you find your own towers in the crowd.'],
          ['Districts', 'Sol Core stands in the middle, with DeFi Heights, Meme Strip, Stock Avenue and the Launch Docks around it. New launches rise in the docks.'],
        ),
        p('Height is size, not quality. A tall tower is no recommendation, and a new tower is no promise.'),
        sub('menu', 'The menu', false, p('The menu at the bottom holds the seven places of the city: **Launch**, **Exchange**, **Earn**, **Agents**, **Arena**, **Guard** and **Money**. A place that has not opened yet says **Soon**. Everything else, including these documents, is under ☰.')),
      ),
      part(
        'how',
        'How to get around',
        steps(
          'Drag to turn the city, and pinch or scroll to come closer.',
          'Use the bar at the top to show one part of the market: **All**, **Crypto**, **Memes**, **Stocks**, **New** or **Mine**.',
          'Tap the search at the top and type a ticker, a name or a coin’s address. The city flies you there.',
          'Tap a tower to open its window: the price, a live chart and the trade card. **Details** holds its market cap, liquidity and traders in the last hour.',
          'Say it instead of tapping: press ⌘K or Ctrl+K, or the spark on a phone, and type what you want, such as “buy SOL for 50”.',
        ),
        sub('share', 'Sharing a tower', false, p('Every tower has its own link. **Share** makes a card to post, and whoever opens the link lands on that tower.')),
      ),
      part('cost', COST, rows(row('Looking, searching, charts, sharing', 'Free'), row('Trading', `From ${say.pct(f.fees.stable)}`, 'See [[fees|All fees]]'))),
      part(
        'wrong',
        WRONG,
        cards(
          ['A coin pretending to be another', 'Names can be copied. Check the **Verified** mark and the address. Verified means Jupiter lists the coin as the project’s own; it is not a safety rating.'],
          ['An unnamed tower', 'A pool that opened in the last hours and is not verified shows without a name. Most launches fade fast: treat it with care.'],
          ['Prices look stale', 'The top bar says **Live**, **Delayed** or **Snapshot**. On anything but Live, the card’s price is refreshed before you sign.'],
          ['The city runs slowly', 'It is real 3D. Close other tabs, or try a newer browser.'],
        ),
      ),
    ],
  }),

  trade: ({ f, say }) => ({
    lead: 'Every coin is a tower. Tap it, choose Buy or Sell, sign once in your wallet. The whole cost shows before you sign.',
    related: ['orders', 'fees', 'help'],
    action: { label: 'Open a trade', href: '/?open=trade' },
    parts: [
      part(
        'what',
        WHAT,
        { kind: 'figure', shot: 'tower', alt: "A tower open with its price, chart and trade card", caption: "Tap a tower: the price, a live chart and the trade card, with the fee above the button." },
        p('A trade in Ryntra is a swap from your own wallet. Ryntra finds the best path through Jupiter, which looks across Solana’s markets, builds the transaction, and hands it to your wallet to sign. Your coins never pass through Ryntra.'),
        p('You can swap any coin for any other, right from a tower or from **Exchange**, then **Swap**.'),
      ),
      part(
        'how',
        HOW,
        steps(
          'Tap a tower, or search for the coin. Its window opens with the trade card.',
          'Choose **Buy** or **Sell**, and pick an amount or type your own.',
          'Read the line above the button: the fee, the route and how far the trade moves the price. **i** opens the rest: the least you will receive, the network fee and the risk check.',
          'Tap the button and confirm in your wallet.',
          'Wait a moment. Ryntra reads the result back from the network and shows what you got.',
        ),
        sub('other', 'Pay with another coin', false, p('**Pay with another coin** and **Get another coin** let you choose any pair; the arrows swap the two sides.')),
        sub('share', 'After the trade', false, p('You can share a card of the trade with one tap and check the transaction on the network. Your tower now glows in your colour.')),
      ),
      part(
        'cost',
        COST,
        rows(
          row('Memes and new coins', say.pct(f.fees.meme)),
          row('Trending coins', say.pct(f.fees.trending), `Verified by Jupiter, first pool at least ${f.trendingDays} days old`),
          row('Stocks', say.pct(f.fees.stock)),
          row('Large coins', say.pct(f.fees.major), 'SOL, BTC, ETH, JUP and liquid-staked SOL'),
          row('Between two dollars', say.pct(f.fees.stable), 'USDC, USDT and other stablecoins'),
          row('The network', 'A few cents', 'In SOL, to the network'),
        ),
        p('The fee is taken inside the trade, and it is already counted in what you see. Every other case is in [[fees|All fees]].'),
      ),
      part(
        'wrong',
        WRONG,
        cards(
          ['“Didn’t go through”', 'The trade reached the network and failed. Your coins stayed; only the network fee was spent. Try again, perhaps with a smaller amount.'],
          ['“Still checking”', 'The outcome is not known yet. **Do not send it again.** Tap **Check again**; a lost answer is not a lost trade.'],
          ['You got less than the quote', 'Prices move. You will never get less than the **You get at least** line under **i**: below it, the trade fails instead.'],
          ['The coin falls after you buy', 'That is the market. Most new coins lose value. Ryntra does not promise a profit, and a trade cannot be reversed. Read [[security#risks|the risks]].'],
          ['“Needs care” or “Blocked”', 'The risk check found something about this coin or this trade. Read the line above the button and **i** before you go on.'],
        ),
      ),
    ],
  }),

  orders: ({ f, s, say }) => ({
    lead: 'Tell Ryntra your price, or how much to buy each week. It watches the market so you do not have to, and your wallet stays the only thing that signs.',
    related: ['trade', 'agent', 'fees'],
    action: { label: 'Open a trade', href: '/?open=trade' },
    parts: [
      part(
        'what',
        WHAT,
        cards(
          ['Limit', 'Buy or sell at the price you set. One signature, then Jupiter fills it when the market gets there, even with the city closed.'],
          ['Stop', 'A watch on the price. When it is reached you are told, and you sign the sale or the purchase at the market price. **It does not trade by itself.**'],
          ['Regular purchase', 'A set amount of a coin every day, week or month. You are reminded on the day and sign each purchase.'],
        ),
        { kind: 'figure', shot: 'limit', alt: "The trade card with the Limit tab open", caption: "Limit and Stop stand beside Market on the trade card." },
      ),
      part(
        'how',
        HOW,
        sub(
          'limit',
          'Set a limit',
          !s.limits,
          steps(
            'Open **Exchange**, then **Spot**, or open a tower’s trade card.',
            'Choose **Limit**, then **Buy** or **Sell**.',
            'Set your price and the amount. Tap the market price to start from it.',
            'Tap **Review order** and read the fill price and the fee. Then place the order and confirm in your wallet.',
            'Your order waits in **My orders** until it fills or you cancel it.',
          ),
        ),
        sub(
          'stop',
          'Set a stop',
          !s.limits,
          steps(
            'On the same card, choose **Stop**.',
            'Set the price to sell at if it falls, or to buy at if it rises, and how long to watch for. When that time is up, the stop expires.',
            'Tap **Set stop**. No money moves; your wallet may sign a short message to prove it is yours.',
            'When the price gets there, Ryntra tells you. Open the prompt and sign the trade at the market price.',
          ),
          p(s.stopsAlways ? 'Ryntra watches your stops even with the city closed. It tells you under the bell, and on Telegram or by push if you turned them on in the settings. Quiet hours hold the message until morning.' : 'For now a stop is watched while Ryntra is open on your device. Keep it open, and turn on notifications, if you rely on one.'),
        ),
        sub(
          'recurring',
          'Set a regular purchase',
          !s.oneSentence,
          steps(
            `Tell your agent in one sentence: “buy ${say.usd(20)} of SOL every week”. Press ⌘K or Ctrl+K, or the spark on a phone.`,
            'Read the card: what it will buy, how often, the fee on each purchase.',
            'Tap **Sign**. This proves the wallet is yours and moves no money.',
            'On each date you get a reminder: a note under the bell, and on Telegram or by push if you turned them on. Open it and sign that purchase.',
          ),
          p(s.stopsAlways ? 'The same sentence sets limits and stops: “sell half my JUP when it rises 20 percent”, “stop loss on all my WIF”. What you set stands in **My instructions** on this device, where you can cancel it.' : 'The same sentence sets limits: “sell half my JUP when it rises 20 percent”. What you set stands in **My instructions** on this device, where you can cancel it.'),
        ),
      ),
      part(
        'cost',
        COST,
        rows(
          row('Limit: Ryntra fee', `${say.pct(f.fees.major)} to ${say.pct(f.fees.meme)}`, 'By the pair, taken only when it fills, on top of the price you set'),
          row('Limit: smallest order', say.usd(f.limitMinUsd)),
          row('Limit: account deposit', 'Small', 'In SOL, and it comes back when the order closes'),
          row('Stop: to set', 'Free', 'When you sign the trade, the usual trade fee applies'),
          row('Regular purchase: each buy', 'The trade fee', 'See [[fees#trades|the trade fees]]'),
          row('Regular purchase: amount', `${say.usd(f.recurringMinUsd)} to ${say.usd(f.recurringMaxUsd)}`, 'Per purchase'),
        ),
      ),
      part(
        'wrong',
        WRONG,
        cards(
          ['A stop can miss your price', 'You still have to sign, and the price can run past your level before you do. The trade happens at the market price of that moment.'],
          ['A limit does not fill', 'The market never reached your price, or not by enough to cover the fee on top. Move it or cancel it in **My orders**.'],
          ['“At or above the market”', 'A buy limit must stand below the market and a sell limit above it. Otherwise use **Market**.'],
          ['Your coins are in the order', 'While a limit waits, its coins sit in an order account that only your signature opens. Cancel it to get them back.'],
          ['You missed a reminder', 'Nothing was bought. A regular purchase never buys without your signature. Turn on Telegram or push in the settings if the bell is not enough.'],
        ),
      ),
    ],
  }),

  launch: ({ f, s, say }) => {
    const l = f.launch;
    const shield = l.bots.protected;
    const plain = l.bots.classic;
    return {
      lead: 'A name, a ticker, a picture and one signature. Your coin starts on a Meteora curve, its tower rises in the docks, and you earn from every trade.',
      related: ['fees', 'agent', 'security'],
      action: { label: 'Open Launch', href: '/?open=launch' },
      parts: [
        part(
          'what',
          WHAT,
          p('A launch creates a new coin on Solana with you as its creator. Nobody gets coins before the curve opens, and no one can ever mint more.'),
          cards(
            ['The curve', `The coin opens on a price curve at about ${say.usdShort(l.startCapUsd)} of market cap. Every buy pushes the price up, every sell brings it down, and anyone can trade it.`],
            ['The move to a pool', `Near ${say.usdShort(l.graduationCapUsd)} of market cap the coin moves into a Meteora pool by itself. Its liquidity is locked for ever, and the tower joins the skyline.`],
            ['What is fixed for ever', `The name, ticker and picture can never change, and the supply stays at ${say.count(l.supply)} coins.`],
          ),
        ),
        part(
          'how',
          HOW,
          steps(
            'Open **Launch**.',
            'Add a picture, a name and a ticker. The picture becomes the face of your tower.',
            'Tap **Review** and read the one line before the signature: the fee, who receives it, the move to a pool, the risk.',
            `Leave the **Bot shield** on, or turn it off. With it, bots buying first pay ${say.pct(shield.startBps)} falling to ${say.pct(shield.endBps)} over ${shield.minutes} minutes; without it, ${say.pct(plain.startBps)} over ${plain.minutes} minutes.`,
            'Tap **Launch** and confirm in your wallet. One transaction makes your coin and its curve.',
            'Your tower rises as soon as it lands. Share it, and collect what it earns in **My berth**.',
          ),
          sub('agent', 'Let your agent do it', !s.budget, p('Say “launch me a coin”, and the agent prepares all of it. You still sign once, in your own wallet.')),
        ),
        part(
          'earn',
          'What the creator gets',
          rows(
            row('From every trade on the curve', `${say.pct(l.split.creator)} of the fee`, 'From the first trade'),
            row('At the move to the pool', `${say.pct(l.graduationCreatorBps)} of its fee`, `That fee is ${say.pct(l.graduationFeeBps)} of what the curve raised`),
            row('The locked position in the pool', `${say.whole(l.liquidityCreatorPct)} of the liquidity`, `Earns up to ${say.pct(l.poolCreatorBps)} of the pool’s fees, for as long as the pool trades`),
          ),
          p('What you have earned stands in **My berth**, and **Claim** takes it in one tap. A coin nobody trades earns nothing: there is no promise of income.'),
        ),
        part(
          'cost',
          COST,
          rows(
            row('Launching', l.creationFree ? 'No launch fee' : 'A launch fee', 'Only Solana’s rent and network fee, in SOL. Your wallet shows the exact amount before you sign'),
            row('Each trade on the curve', say.pct(l.feeBps), 'More in the first minutes and when the price swings'),
            row('Split of that fee', `You ${say.pct(l.split.creator)} · Ryntra ${say.pct(l.split.ryntra)} · Meteora ${say.pct(l.split.meteora)}`, `For a trade through Ryntra: Ryntra ${say.pct(l.splitThroughRyntra.ryntra)}, Meteora ${say.pct(l.splitThroughRyntra.meteora)}`),
            row('Each trade in the pool', `${say.pct(l.poolStartFeeBps)} falling to ${say.pct(l.poolEndFeeBps)}`, `As the price grows ${l.poolPriceMultiple} times, or after ${l.poolDays} days`),
          ),
        ),
        part(
          'wrong',
          WRONG,
          cards(
            ['Most new coins lose value', 'Most launches never reach the pool. Launching does not bring buyers by itself, and neither Ryntra nor anyone else can promise them.'],
            ['“Reads as a known name”', 'A name or ticker that imitates a known project is refused. Choose your own.'],
            ['“The first signature aged”', 'A Solana transaction expires quickly. Sign once more when asked; nothing was charged.'],
            ['A mistake in the name', 'It cannot be fixed afterwards. Read the review carefully; a new launch is a new coin.'],
            ['A coin gets reported', 'Anyone can report a coin that scams or pretends to be someone. Ryntra can hide it in the city; the network keeps it, since nobody can delete a coin.'],
          ),
        ),
      ],
    };
  },

  earn: ({ f, s, say }) => ({
    lead: 'Put coins to work: SOL staking and Meteora pools. The position stays in your wallet, the pool’s fees go to you, and results are shown beside simply holding.',
    related: ['fees', 'money', 'security'],
    action: { label: 'Open Earn', href: '/?open=harbor' },
    parts: [
      part(
        'what',
        WHAT,
        cards(
          ['SOL Saver', 'Staking made simple: SOL turns into a liquid staked SOL such as JupSOL or JitoSOL, which grows against SOL and can be swapped back at any time.'],
          ['Piers', 'Pools of SOL with another coin. You add both sides; traders pay fees to the pool; your position, a boat at the pier, earns its share while the price stays in your range.'],
          ['Sell Higher', 'An order that sits in a pool and fills only at your price or better, then stays filled.'],
          ['Mine', 'Everything you have working, in one tab: what it earned, in SOL, and how that compares to just holding.'],
        ),
        { kind: 'figure', shot: 'earn', alt: "The Earn window with its shelf of products", caption: "Earn: the Shelf, the Piers and Mine. The numbers are read live and change every day." },
        p('Nothing leaves your wallet’s control: Ryntra builds the transaction, you sign it, and only your signature takes the money out again.'),
      ),
      part(
        'how',
        HOW,
        sub(
          'saver',
          'Stake SOL',
          !s.saver,
          steps(
            'Open **Earn**, then the **SOL Saver** on the shelf.',
            'Type an amount of SOL and read the line: the fee, the least that arrives, the main risk.',
            'Tap **Review** and confirm in your wallet.',
            'Follow it in **Mine**. To leave, swap it back to SOL on a trade card.',
          ),
        ),
        sub(
          'piers',
          'Add to a pool',
          !s.pools,
          steps(
            'Open **Earn**, then **Piers**, and pick a pool: you see its fees for the last day and its depth.',
            'Type an amount in SOL and choose a style. **Calm** covers a wide range and earns less; **Dense** covers a narrow one and earns more while the price stays there.',
            'Check the past month: how long the style stayed in range, and how it ended against holding.',
            'Tap **Add liquidity** and confirm in your wallet. Half goes in as SOL and half as the other coin, so if you are short of it, the card offers to get it first.',
            'Your boat appears at the pier. **Take fees** collects what it earned, **Leave** takes everything back.',
          ),
        ),
        sub(
          'limits',
          'Sell higher or buy lower',
          !s.poolLimits,
          steps('On the shelf, open **Sell Higher**.', 'Set your price and the amount, and read the line.', 'Confirm in your wallet. The order sits in the pool until the price reaches it, and you can cancel it at any time.'),
        ),
      ),
      part(
        'cost',
        COST,
        rows(
          row('Pools and pool orders: Ryntra fee', say.pct(0), 'On purpose'),
          row('SOL Saver: Ryntra fee', say.pct(f.fees.major), 'It is a trade of a large coin. The staked coin’s own pool also keeps a share of its rewards'),
          row('Smallest add to a pool', `${say.decimal(f.earn.pierMinSol)} SOL`, 'Higher if the costs that never return would be too large a share'),
          row('Largest single add', say.usd(f.earn.pierCeilingUsd)),
          row('Pool orders: largest order', say.usd(f.earn.limitCeilingUsd), `You earn ${say.whole(f.earn.makerSharePct)} of the swap fees in the bin when it fills`),
          row('Opening a position', 'A deposit in SOL', 'Most comes back when you leave; the pool’s shared part may not. Shown before you sign'),
        ),
      ),
      part(
        'wrong',
        WRONG,
        cards(
          ['The price leaves your range', 'Your boat goes dark and stops earning until the price returns. Nothing is lost by that alone, but you are left holding more of the falling coin.'],
          ['You can end below holding', 'When prices move, a pool position can be worth less than if you had just held the two coins. Fees may not cover the difference. **Mine** shows the comparison wherever it can be measured.'],
          ['Leaving staked SOL costs a spread', 'Swapping back to SOL is a trade, and the price can sit slightly below the value. The card shows it before you sign.'],
          ['No yield is promised', 'Rates and fees are read from the market as they are and change every day. A past month is the past, not a forecast.'],
          ['The pool’s own risk', 'Pools and staking run on other teams’ programs: Meteora’s, Jupiter’s, Jito’s. A fault there can lose money, and Ryntra cannot reverse it.'],
        ),
      ),
    ],
  }),

  agent: ({ f, s, say }) => ({
    lead: 'You say what you want, in your own words. Today the agent explains and prepares, and you act in one tap; each next step does more for you, inside limits you set.',
    related: ['orders', 'guard', 'security'],
    action: { label: 'Ask Ryntra', href: '/?open=assistant' },
    parts: [
      part(
        'what',
        WHAT,
        { kind: 'figure', shot: 'ask', alt: "The Ask Ryntra panel beside the city", caption: "Ask Ryntra, at the top of the city." },
        p('The agent grows by steps, and each step opens only when it is ready:'),
        rows(
          row('Today', 'Explains and plans', 'It reads the market, answers in your language and points at the towers. You do the trade'),
          row('Next', s.oneSentence ? 'Open' : 'Soon', 'From one sentence it sets regular purchases, limits and stops. You sign once'),
          row('Then', s.budget ? 'Open' : 'Soon', 'You give it a budget with one signature, and it trades alone inside the limits the blockchain holds'),
        ),
      ),
      part(
        'how',
        HOW,
        sub(
          'ask',
          'Ask Ryntra',
          false,
          steps('Tap **Ask Ryntra** at the top of the city, or the spark on a phone.', 'Ask anything: “what is rising and why?”, “is this coin worth a look?”.', 'Read the answer, with why, what could be wrong and its sources. The towers it names light up.', 'Tap a tower to trade it yourself. Ryntra advises; it never trades, signs or holds keys.'),
          p('You can also ask from an AI chat, where it reads the market for you and never signs: see [[/connector|Ryntra in AI chats]].'),
        ),
        sub(
          'sentence',
          'Say it in one sentence',
          !s.oneSentence,
          steps(
            'Press ⌘K or Ctrl+K, or the spark on a phone, and say it.',
            'Anything missing comes as one question with tap answers, such as how much or how often.',
            'Read the card: what the agent will do, the fee, and how it runs.',
            'Tap **Sign**. Follow and cancel it in **My instructions**.',
          ),
          rows(
            row('“Buy some SOL every week”', 'A regular purchase', `Reminds you, and you sign each buy. From ${say.usd(f.recurringMinUsd)}`),
            row('“Buy JUP if it drops to 0.7”', 'A limit', 'Fills by itself at your price'),
            row('“Sell half my BONK if it falls 10 percent”', 'A stop', s.stopsAlways ? 'Tells you, and you sign the sale' : 'Comes with stops watched around the clock'),
          ),
        ),
        sub(
          'scouts',
          'Scouts and bots',
          !s.bots,
          p('A **scout** flies over the city with your rule and hangs over a tower that fits; you read why and sign the buy yourself. **Bots** run a plan you choose, such as a grid or a buy ladder, on paper for now: they sign nothing and move no money.'),
          steps('Open **Agents**, then **Bots**.', 'Choose what you want: earn on swings, buy little by little, lock in profit.', 'Set the coin and the numbers.', 'Start the practice bot, and watch it in **My bots**.'),
        ),
        sub(
          'budget',
          'Give it a budget',
          !s.budget,
          steps(
            'Open **Agents**, then **Bots**. **Your agent** stands at the top.',
            'Choose a budget. The line under it shows the limit for a trade, for a day, and how many days it runs. New agents start small.',
            'Tap **Sign**, once, in your wallet. The agent starts on its own.',
            'Watch what is left of the budget. **Stop** takes one more signature, and the rest returns to your wallet.',
          ),
        ),
      ),
      part(
        'limits',
        'How the budget protects you',
        p('You never hand over your keys. The budget sits in your own smart account on the blockchain, and you sign it once.'),
        sub(
          'chain',
          'What the blockchain holds',
          !s.budget,
          cards(
            ['Limits a day and a trade', 'It can spend no more than you allowed, per trade and per day. You raise them by hand.'],
            ['Only allowed venues', 'It trades on Jupiter and Meteora only. Whatever it buys lands in your account alone.'],
            ['Money reaches you, or no trade', 'Each transaction carries a rule: if the money does not come to you, it fails.'],
            ['One signature stops it', 'The agent never sees your key, and its access has an end date.'],
          ),
        ),
        sub(
          'service',
          'What the agent does by itself',
          !s.budget,
          cards(
            ['It stops when it should', 'When the budget is spent, when its time is up, or after a run of failed trades.'],
            ['Words are not orders', 'Coin names, descriptions and messages are never taken as commands, however they are written.'],
          ),
        ),
      ),
      part(
        'cost',
        COST,
        rows(
          row('Asking Ryntra', 'Free', 'A daily allowance of answers, shown in the panel. Past it, you get the city’s own read of the market'),
          row('What the agent does', 'The usual fee', 'The same as if you traded yourself: [[fees|All fees]]'),
          row('Hiring it', 'No subscription'),
        ),
      ),
      part(
        'wrong',
        WRONG,
        cards(
          ['An answer can be wrong', 'It reads real data and says what could be wrong, but it is advice. The decision and the signature are yours.'],
          ['An agent can lose money', 'Inside its limits it can still lose all of the budget you gave it. Start small. It does not promise a profit, and neither does Ryntra.'],
          ['You want it to stop', 'Stop it with one signature in your wallet. It needs nothing else from you, and nobody can talk you out of it.'],
          ['A sentence is not understood', 'If it is a question, a refusal or two coins at once, the line reads it as an ordinary request and sets nothing. Say it again more simply.'],
        ),
      ),
    ],
  }),

  guard: () => ({
    lead: 'Before you sign something you do not fully trust, paste it here. In one line you read what it would do to your wallet.',
    related: ['security', 'agent', 'trade'],
    action: { label: 'Enter the city', href: '/' },
    parts: [
      part(
        'what',
        WHAT,
        { kind: 'figure', shot: 'guard', alt: "The Check window with a field for a transaction or a link", caption: "Guard opens one window: paste it, tap Check." },
        p('Guard reads a Solana transaction or link as your wallet would sign it, and tells you what would happen. It only reads: it holds no key, signs nothing and keeps nothing.'),
        rows(
          row('Nothing found', 'Every check was read', 'Nothing known stands against it. That is not a promise that it is safe'),
          row('Look first', 'Something deserves a look', 'A brand-new address, a token its issuer can freeze, a part that could not be read'),
          row('Stop', 'Do not sign', 'It empties several balances, hands your wallet to a program, or pays a known drainer'),
        ),
        p('The same kind of check already stands behind every trade in the city: see **Risk check** on the trade card.'),
      ),
      part(
        'how',
        HOW,
        steps(
          'Open **Guard** from the menu.',
          'Paste the transaction or the link, and tap **Check**.',
          'Read the one word and the line. **Details** opens what moves, where to, and each reason.',
          'If an agent or a person told you what it does, write that in **What the agent said**, and Guard compares the two.',
        ),
      ),
      part('cost', COST, rows(row('A check', 'Free', 'It moves nothing, so there is no network fee either'))),
      part(
        'wrong',
        WRONG,
        cards(
          ['“Nothing found” is not “safe”', 'It means nothing known stands against it today. A new trick can be unknown; if the deal looks too good, it probably is.'],
          ['“Checks not read”', 'Part of it could not be read. Treat it as unread, not as clean.'],
          ['“This is not a Solana transaction or link”', 'Guard reads Solana only. Paste the transaction itself; a website address is not one.'],
          ['“Too many checks right now”', 'Wait a minute and try again.'],
        ),
      ),
    ],
  }),

  money: ({ f, s, say }) => ({
    lead: 'Your wallet, in a quiet window: top up, send, ask for a payment, move USDC to another network, and see everything you did. Your wallet signs every transfer.',
    related: ['start', 'fees', 'help'],
    action: { label: 'Open Money', href: '/?open=money' },
    parts: [
      part(
        'what',
        WHAT,
        cards(
          ['Top up', 'Your own Solana address, with a QR code, for SOL, USDC or any Solana coin. Or an address on another network that arrives here as USDC.'],
          ['Send', 'To a Solana address or a .skr name, or to another network.'],
          ['Pay link', 'Ask for a payment: an amount, a coin, a link and a QR code to send anyone.'],
          ['Activity and Portfolio', 'What you did, and what you hold now with its worth.'],
        ),
        { kind: 'figure', shot: 'money', alt: "The Money window with its five tabs", caption: "Money, with its five tabs. Without a wallet it first asks you to connect one." },
      ),
      part(
        'how',
        HOW,
        sub(
          'topup',
          'Top up from Solana or an exchange',
          false,
          steps('Open **Money**, then **Top up**, then **From Solana**.', 'Copy your address or show its QR code.', 'Send SOL or USDC to it. On an exchange, choose the **Solana** network when you withdraw.', 'It shows up in a few seconds.'),
        ),
        sub(
          'deposit',
          'Top up from another network',
          !s.moneyPaths,
          steps('On **Top up**, choose **From another network** and the network.', 'Copy the address you get, and note the smallest amount.', 'Send **USDC only**, on that network, to that address.', 'It arrives as USDC on Solana, usually within minutes.'),
        ),
        sub(
          'send',
          'Send',
          !s.moneyPaths,
          steps('Open **Money**, then **Send**, and choose the coin.', 'Paste a Solana address or a .skr name, and the amount.', 'Tap **Review** and read what they get, the fee, and what leaves your wallet.', 'Confirm in your wallet, and watch it until it lands.'),
          p('To another network: choose **To another network**, then the network and the address there. The card shows the least they get, the costs and how long it takes.'),
        ),
        sub('paylink', 'Ask for a payment', false, steps('Open **Money**, then **Pay link**.', 'Set the amount and the coin, and tap **Create link**. Your wallet signs a message to prove it is yours; no money moves.', 'Copy the link or show the QR code. **Your links** shows when it is paid.')),
      ),
      part(
        'cost',
        COST,
        rows(
          row('Top up, receive', say.pct(0), 'Ryntra takes nothing'),
          row('Send on Solana', say.pct(0), 'Only the network fee, a few cents in SOL'),
          row('A new address', 'A small deposit', 'In SOL, if their account for that coin has to be opened'),
          row('Send to another network: Ryntra', say.pct(f.bridgeBps), 'Inside the amount. Moving it costs extra, shown before you sign'),
          row('Top up from another network', 'A fee of the transfer service', 'Taken from the deposit, shown beside the address'),
          row('Pay link', say.pct(0), 'For the one who asks; whoever pays covers the network fee'),
        ),
      ),
      part(
        'wrong',
        WRONG,
        cards(
          ['A wrong address', 'A transfer on the network cannot be reversed. Ryntra warns you when an address looks like yours or a recent one but is not, and when it is brand new. Check it with whoever gave it.'],
          ['The wrong coin to a top-up address', 'An address on another network takes USDC on that network only. Anything else is not filled, and may not come back.'],
          ['“Still being confirmed”', 'Do not send it again. Wait, then look in **Activity**: what is confirmed shows there.'],
          ['They got less than you sent', 'Some coins take a fee of their own on every move. Review shows it as what the issuer keeps.'],
          ['A pay link expired', 'Links have an end. Make a new one, and check its status in **Your links**.'],
        ),
      ),
    ],
  }),

  partners: ({ f, say }) => {
    const { rows: terms, note } = termsRows('en', f.partners);
    const discount = DISCOUNT_ON ? f.partners.refereeDiscountBps : null;
    const share = f.partners.share;
    return {
      lead: 'Bring people to Ryntra with your link, and earn a share of Ryntra’s own fee on what they do. Nobody pays more because you brought them.',
      related: ['fees', 'launch', 'help'],
      action: { label: 'Get my link', href: '/partners' },
      parts: [
        part(
          'what',
          WHAT,
          p('This is Ryntra’s referral programme. Your link connects the people you bring to you. When they trade or launch, a share of the fee Ryntra receives is yours, and it never comes out of their money.'),
          ...(share ? [p(`You get **${say.pct(share.firstBps)}** of Ryntra’s fee for each person’s first ${share.firstDays} days, then **${say.pct(share.afterBps)}** for as long as they use Ryntra.`)] : []),
          p('[[/partners|The partner page]] has your link and a calculator for what it could bring. This page explains how the programme works.'),
        ),
        part(
          'how',
          HOW,
          sub('link', 'Get your link', false, steps('Open [[/partners|the partner page]].', 'Tap **Connect wallet**, then **Copy my link**. Your wallet makes it yours; no money moves.', 'Share it where your people are: X, Telegram, a stream, a group.')),
          sub('friend', 'What happens when someone opens it', false, steps('They open your link and the city greets them with your invitation.', 'They connect a wallet. From their first wallet on, they are yours.', 'They trade and launch as usual, and your share of the fee Ryntra receives starts to count.')),
          sub('follow', 'See what you bring', false, p('The city’s **Partners** window shows **My district**: how many wallets you brought, and what you have accrued and been paid. Only you see it.')),
        ),
        part('cost', 'The terms', rows(...terms.map((t) => row(t.label, t.value))), p('Joining costs nothing, and there is nothing to buy.')),
        part(
          'payouts',
          'Payouts',
          p(note),
          p(discount !== null ? `The discount works: a person you bring pays **${say.pct(discount)}** less of Ryntra’s fee, in the trade itself, and sees it before signing. For now, shares are counted and not paid.` : 'The discount in the terms is not taken off trades yet either; for now, shares are counted and not paid.'),
          list('What you earn is counted from each person’s trades and launches.', 'Below the smallest payout, your share waits for the next one.', 'Every payout comes from one revenue ledger, and together they never exceed what Ryntra received.'),
        ),
        part(
          'rules',
          'The rules',
          cards(
            ['Ryntra’s fee, not your friend’s money', 'Your share comes from the fee Ryntra receives. Nobody pays more because you brought them.'],
                        ['One level', 'You earn from the people you bring yourself, not from the people they bring.'],
            ['Apps, bots and communities', 'Bringing people through a product of your own? [[/support|Write to us]].'],
          ),
        ),
        part(
          'wrong',
          WRONG,
          cards(
            ['A person is not counted', 'They opened your link on another device or browser, or someone else’s link came first. The first link in the browser they connect from counts.'],
            ['A payout has not arrived', 'Below the smallest payout, your share waits for the next one. Before payouts start, your share is recorded and not paid yet.'],
            ['Promising too much', 'Tell people what Ryntra does, not what it will earn them. Nobody here promises a profit, and you should not either. The calculator is a model on your guesses.'],
          ),
        ),
      ],
    };
  },

  fees: ({ f, say }) => {
    const l = f.launch;
    return {
      lead: 'Every fee Ryntra takes, in one place. You see the one that applies before you sign, in your own trade.',
      related: ['trade', 'launch', 'money'],
      action: { label: 'Enter the city', href: '/' },
      parts: [
        part('what', WHAT, p('Ryntra earns a fee on trades and launches. There is no subscription, and nothing to pay for browsing or for holding coins. Network costs, price movement and other teams’ fees are not Ryntra’s; they are shown apart before you sign.')),
        part(
          'how',
          'How to read a fee',
          steps('Open a trade, a launch or a transfer.', 'Read the line above the button. It already names the fee.', 'Tap **i** for the rest: what the network takes, any deposit, the route.', 'Your wallet shows the exact transaction. Only then do you sign.'),
        ),
        part(
          'trades',
          'Trades',
          rows(
            row('Memes and new coins', say.pct(f.fees.meme)),
            row('Trending coins', say.pct(f.fees.trending), `Verified by Jupiter, first pool at least ${f.trendingDays} days old`),
            row('Stocks', say.pct(f.fees.stock)),
            row('Stock tokens traded on request', say.pct(f.fees.otherStock)),
            row('Large coins', say.pct(f.fees.major), 'SOL, BTC, ETH, JUP and liquid-staked SOL'),
            row('Between two dollars', say.pct(f.fees.stable), 'USDC, USDT, PYUSD, USDS, USDG'),
            row('A coin whose details cannot be read', say.pct(f.fees.unread), 'When its facts cannot be read at that moment'),
          ),
          p('A pair is charged by the side that is not money: a stock decides first, then the riskier of two coins. A limit order pays the same rates, only when it fills.'),
        ),
        part(
          'launches',
          'Launches',
          rows(
            row('Starting a launch', l.creationFree ? say.pct(0) : 'A launch fee', 'Only Solana’s rent and fee, in SOL'),
            row('Each trade on the curve', say.pct(l.feeBps), `Bots buying first pay more for a few minutes; a swing in price adds a little`),
            row('Who gets that fee', `Creator ${say.pct(l.split.creator)} · Ryntra ${say.pct(l.split.ryntra)} · Meteora ${say.pct(l.split.meteora)}`, `Through Ryntra: Ryntra ${say.pct(l.splitThroughRyntra.ryntra)}, Meteora ${say.pct(l.splitThroughRyntra.meteora)}`),
            row('The move to a pool', say.pct(l.graduationFeeBps), `Once, of what the curve raised: creator ${say.pct(l.graduationCreatorBps)}, Ryntra ${say.pct(l.graduationRyntraBps)}`),
            row('Each trade in the pool', `${say.pct(l.poolStartFeeBps)} falling to ${say.pct(l.poolEndFeeBps)}`, 'It goes to Meteora, back into the pool, and to the locked positions'),
          ),
        ),
        part(
          'earn',
          'Earn',
          rows(row('Pools, pool orders', say.pct(0), 'Ryntra takes nothing; the pool’s fees go to you'), row('SOL Saver', say.pct(f.fees.major), 'It is a trade of a large coin')),
        ),
        part(
          'money',
          'Money',
          rows(
            row('Top up, receive, send on Solana, pay links', say.pct(0)),
            row('Send to another network', say.pct(f.bridgeBps), 'Inside the amount'),
          ),
        ),
        part(
          'others',
          'Not Ryntra’s, but you pay them',
          rows(
            row('The Solana network', 'A few cents', 'In SOL, on every transaction'),
            row('A token account', 'A small deposit', 'In SOL, once per coin. Closing the account returns it'),
            row('Price impact and slippage', 'In the market', 'Shown as the least you will get'),
            row('A coin’s own transfer fee', 'Set by its issuer', 'Shown when a coin has one'),
          ),
        ),
        part(
          'wrong',
          WRONG,
          cards(
            ['The card and the wallet disagree', 'Your wallet may show the fee as a separate line. Trust what you sign: if it looks wrong, reject it, and nothing moves.'],
            ['A fee on a trade that failed', 'A failed trade pays no Ryntra fee. Only the network fee is spent.'],
            ['You have seen other numbers', 'The figures on this page are read from the same table the product charges by, so they cannot differ from your trade.'],
          ),
        ),
      ],
    };
  },

  security: () => ({
    lead: 'Your money stays in your wallet and your keys stay with you. Here is what Ryntra can and cannot do, and what is still your own to watch.',
    related: ['guard', 'agent', 'help'],
    action: { label: 'Enter the city', href: '/' },
    parts: [
      part(
        'what',
        'How it works',
        p('Ryntra is self-custodial: it builds transactions, and only your wallet can sign them. Your wallet is your account, so Ryntra has no password or balance of yours to hold.'),
        sub(
          'cannot',
          'What Ryntra cannot do',
          false,
          list(
            'Move your money, sign for you, or trade without your signature.',
            'See your recovery phrase or your private key: they stay in your wallet.',
            'Reverse a transaction once the network has it.',
            'Freeze your coins or your wallet.',
          ),
        ),
        sub(
          'does',
          'What it does for you',
          false,
          list(
            'Shows the fee and the least you will get before you sign.',
            'Reads each trade before you sign it, and warns about what it finds.',
            'Cleans coin names and signs of hidden characters and commands.',
            'Warns you about look-alike and brand-new addresses when you send.',
          ),
        ),
      ),
      part(
        'how',
        'How to keep your money safe',
        steps(
          'Write your recovery phrase on paper, and never type it into any site or chat. **Ryntra will never ask for it.**',
          'Check that you are on **ryntra.io** before you connect a wallet. Scam sites copy the look.',
          'Read what your wallet shows before you sign, not only what the page says.',
          'Use a separate wallet with a small balance for new coins, and keep savings elsewhere.',
          'Paste anything you doubt into [[guard|Guard]] first.',
          'Do not act on a message that hurries you, whoever it seems to come from.',
        ),
      ),
      part(
        'risks',
        'The risks that remain',
        cards(
          ['The market', 'Crypto prices can fall quickly and far. Most new coins lose value. Trade only what you can lose.'],
          ['No undo', 'A signed transaction is final, and there is no support line that can reverse it.'],
          ['Other teams’ programs', 'Trades, pools and staking run on Jupiter, Meteora and others. A fault in them can lose money.'],
          ['Your device', 'Malware or a stolen phrase takes your wallet, and Ryntra cannot help get it back.'],
          ['An agent with a budget', 'Inside its limits it can lose the budget you gave it. Start small and watch what it reports.'],
        ),
        p('Nothing on Ryntra is financial advice, and nothing here promises a profit. The full terms are in [[/legal/terms|the Terms of Use]].'),
      ),
      part('cost', COST, rows(row('Using these protections', 'Free'))),
      part(
        'wrong',
        WRONG,
        cards(
          ['You signed something suspicious', 'Move what is left to a new wallet right away, from a clean device. Then revoke approvals in your wallet app.'],
          ['You typed your phrase into a site', 'Treat the wallet as lost. Make a new wallet and move your money at once.'],
          ['You found a security problem', 'Tell us through [[/support|Help]], under the security topic: it is read first. Responsible reports are welcome.'],
          ['Someone claims to be Ryntra', 'We do not message first, ask for phrases, or offer to “recover” funds. The only channels are on [[/about|About]].'],
        ),
      ),
    ],
  }),

  help: () => ({
    lead: 'What usually goes wrong and what to do about it. Most of it comes down to one rule: do not send a thing twice before you know how the first went.',
    related: ['trade', 'money', 'security'],
    action: { label: 'Write to us', href: '/support' },
    parts: [
      part('what', WHAT, p('Short answers, in the order people ask. If yours is not here, write to us through [[/support|Help]]: you get a reference to quote, and security reports are read first.')),
      part(
        'how',
        'When something looks wrong',
        steps(
          'Do not repeat the action yet.',
          'Open **Money**, then **Activity**. What the network confirmed is there.',
          'Open the transaction on the network, through the link beside it. The network is the final word.',
          'Still unclear? Write to [[/support|Help]] with the transaction link, and never your recovery phrase.',
        ),
      ),
      part('cost', COST, rows(row('A failed trade', 'The network fee', 'A few cents. The Ryntra fee is not taken'), row('Writing to us', 'Free'))),
      part(
        'trading',
        'Trading',
        qa(
          ['The trade says “Didn’t go through”. Where are my coins?', 'Still in your wallet. The trade failed on the network, and only the network fee was spent. Try again; if it keeps failing, try a smaller amount.'],
          ['It says “Still checking”.', 'The answer is late, not lost. Do not send another. Tap **Check again**, and look in **Activity** after a minute.'],
          ['My wallet says “transaction expired”.', 'A signature on Solana is good only for a short while. Start again; nothing was charged.'],
          ['Why did I get less than I expected?', 'The price moved between the quote and the trade. You never get less than the **You get at least** line under **i**.'],
          ['I bought a coin and cannot sell it.', 'Open its tower and read the risk check. Some coins let their issuer freeze or block them. Nobody can undo that for you.'],
        ),
      ),
      part(
        'balance',
        'Balances and transfers',
        qa(
          ['My balance looks wrong or empty.', 'Check you connected the same wallet, then tap refresh in **Money**. Coins without a price are left out of the total.'],
          ['I sent money to my address and do not see it.', 'Check the transaction was on the Solana network. From another network it does not arrive here unless you used the address **From another network** gave you.'],
          ['What is this small deposit in SOL?', 'Solana charges rent for each coin’s account in your wallet. It is yours and it comes back if the account is closed.'],
          ['I sent to the wrong address.', 'A transfer cannot be reversed. If you know the owner, ask them to send it back.'],
        ),
      ),
      part(
        'wallets',
        'Wallets',
        qa(
          ['The site does not see my wallet.', 'Open ryntra.io in your wallet app’s browser, or check that its extension is on. Refresh the page.'],
          ['I lost my phone or my computer.', 'Restore the wallet from its recovery phrase on a new device. Your Ryntra comes back with it.'],
          ['I lost my recovery phrase.', 'If the wallet still opens, move your money to a new wallet now. If it does not, nobody can restore it, Ryntra included.'],
          ['Do I need to sign up?', 'No. Your wallet is your account.'],
        ),
      ),
      part(
        'orders',
        'Orders, launches and the agent',
        qa(
          ['How do I cancel a limit?', 'In **My orders**. The coins come back with the account’s deposit.'],
          ['My stop did not sell.', 'A stop tells you and waits for your signature; it does not trade by itself. See [[orders#stop|how a stop works]].'],
          ['Can I change my coin’s name or picture?', 'No. They are fixed for ever when you launch.'],
          ['Where is what my coin earned?', 'In **My berth**, in the Launch window. **Claim** takes it to your wallet.'],
          ['How do I stop my agent?', 'One signature in your wallet stops it. See [[agent#limits|how the budget protects you]].'],
          ['A place of the menu says “Soon”.', 'It has not opened yet. These documents mark the same places, and [[/roadmap|the roadmap]] shows what comes next.'],
        ),
      ),
      part(
        'wrong',
        'If it goes further',
        cards(
          ['You think you were scammed', 'Move what is left to a new wallet, then tell us through [[/support|Help]]. We cannot reverse it, but we can hide a scam coin from the city.'],
          ['Help did not answer', 'Quote your reference when you write again, or reach us through the channels on [[/about|About]].'],
        ),
      ),
    ],
  }),
};

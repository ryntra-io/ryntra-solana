import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  hasUkAddress,
  linkOfNotificationData,
  localizedSitePath,
  mapDeepLink,
  pathOfLink,
  redirectSystemPath,
  siteHrefOf,
  webHrefOf,
} from './deep-link.ts'

const NOTE = 'inb_0123456789abcdef01234567'
const MONITOR = 'mon_0123456789abcdef01234567'
const PLAN = 'plan_0123456789abcdef0123456789abcdef'

test('the site, the scheme and a bare path all yield the same path', () => {
  assert.equal(pathOfLink(`https://ryntra.io/app/alerts/open?n=${NOTE}`), `/app/alerts/open?n=${NOTE}`)
  assert.equal(pathOfLink(`https://www.ryntra.io/app/alerts`), `/app/alerts`)
  assert.equal(pathOfLink('https://ryntra.io'), '/')
  assert.equal(pathOfLink(`ryntra://app/alerts/open?n=${NOTE}`), `/app/alerts/open?n=${NOTE}`)
  assert.equal(pathOfLink(`ryntra:///monitoring/open?n=${NOTE}`), `/monitoring/open?n=${NOTE}`)
  // The development build's own scheme (io.ryntra.app.dev) reads the same; no other scheme does.
  assert.equal(pathOfLink(`ryntra-dev://app/alerts/open?n=${NOTE}`), `/app/alerts/open?n=${NOTE}`)
  assert.equal(pathOfLink('ryntrax://app/alerts'), null)
  assert.equal(pathOfLink(`/plans/${PLAN}?from=monitoring#x`), `/plans/${PLAN}?from=monitoring`)
  assert.equal(pathOfLink('https://evil.example/app/alerts/open?n=inb_x'), null)
  assert.equal(pathOfLink('mailto:someone@example.com'), null)
})

test('a push link and the web deep link open the resolver with the note', () => {
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/alerts/open?n=${NOTE}`), {
    path: `/monitoring/open?n=${NOTE}`,
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink(`ryntra://app/alerts/open?n=${MONITOR}&from=telegram`), {
    path: `/monitoring/open?n=${MONITOR}`,
    kind: 'native',
  })
  // A note id that is not one leads to the inbox, never to a route it cannot resolve.
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/alerts/open?n=inb_zz'), { path: '/monitoring', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/alerts'), { path: '/monitoring', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/alerts/'), { path: '/monitoring', kind: 'native' })
})

test('the web plan page opens the native plan, with the monitoring context kept', () => {
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/strategies/plans/${PLAN}?from=monitoring`), {
    path: `/plans/${PLAN}?from=monitoring`,
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/strategies/plans/${PLAN}`), {
    path: `/plans/${PLAN}`,
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/strategies/plans/not-a-plan'), { path: '/bots', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/strategies'), { path: '/bots', kind: 'native' })
})

test('a page the phone does not own goes to the resolver as a web page; nothing else goes anywhere but home', () => {
  const settings = '/app/settings?from=monitoring'
  assert.deepEqual(mapDeepLink(`https://ryntra.io${settings}`), {
    path: `/monitoring/open?href=${encodeURIComponent(settings)}`,
    kind: 'web',
  })
  assert.deepEqual(mapDeepLink('https://ryntra.io/docs'), { path: '/', kind: 'unknown' })
  assert.deepEqual(mapDeepLink('https://elsewhere.example/app/alerts'), { path: '/', kind: 'unknown' })
  assert.deepEqual(mapDeepLink('ryntra://'), { path: '/', kind: 'native' })
})

test("the app's own routes and the development client's link pass through untouched", () => {
  for (const own of [
    `/plans/${PLAN}`,
    '/monitoring',
    `/monitoring/open?n=${NOTE}`,
    '/asset/So111',
    '/history?mint=x',
    '/',
    // Trade as a stack screen, and the target shell's tab paths.
    '/trade?mint=So111&side=sell',
    '/trade',
    '/(tabs)/markets',
    '/(tabs)/portfolio',
  ]) {
    assert.deepEqual(mapDeepLink(`ryntra://${own.slice(1)}`), { path: own, kind: 'native' })
  }
  const dev = 'ryntra://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081'
  // Whole, not as a path: Expo Router reads the bundle address out of the link itself.
  assert.equal(redirectSystemPath({ path: dev, initial: true }), dev)
  assert.equal(
    mapDeepLink('ryntra://expo-development-client?url=http%3A%2F%2Flocalhost%3A8081').path,
    'ryntra://expo-development-client?url=http%3A%2F%2Flocalhost%3A8081',
  )
  assert.equal(
    redirectSystemPath({ path: `https://ryntra.io/app/alerts/open?n=${NOTE}`, initial: false }),
    `/monitoring/open?n=${NOTE}`,
  )
})

test("the older shells' Trade, Strategies and Agent tab paths open where they belong now, the query kept (M10, M34)", () => {
  assert.deepEqual(mapDeepLink('ryntra:///(tabs)/trade?mint=So111&side=sell'), {
    path: '/trade?mint=So111&side=sell',
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('ryntra:///(tabs)/trade'), { path: '/trade', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/(tabs)/strategies'), { path: '/bots', kind: 'native' })
  assert.equal(redirectSystemPath({ path: 'ryntra:///(tabs)/strategies/', initial: false }), '/bots')
  // The Agent was a place in the bar until the menu v6.2: its link opens Ryntra, the question kept for the composer.
  assert.deepEqual(mapDeepLink('ryntra:///(tabs)/agent'), { path: '/ryn', kind: 'native' })
  assert.deepEqual(mapDeepLink('ryntra:///(tabs)/agent?q=hi'), { path: '/ryn?q=hi', kind: 'native' })
  assert.deepEqual(mapDeepLink('ryntra:///(tabs)/create'), { path: '/launch', kind: 'native' })
})

test("a push's data carries one link, and only the site's own", () => {
  assert.equal(
    linkOfNotificationData({ link: `https://ryntra.io/app/alerts/open?n=${NOTE}` }),
    `https://ryntra.io/app/alerts/open?n=${NOTE}`,
  )
  assert.equal(linkOfNotificationData({ link: 'https://evil.example/x' }), null)
  assert.equal(linkOfNotificationData({ link: 42 }), null)
  assert.equal(linkOfNotificationData(null), null)
  assert.equal(linkOfNotificationData('https://ryntra.io/app/alerts'), null)
})

test('the resolver may open only ryntra.io/app pages', () => {
  assert.equal(
    webHrefOf('/app/predictions/evt_1?from=monitoring'),
    'https://ryntra.io/app/predictions/evt_1?from=monitoring',
  )
  assert.equal(webHrefOf('https://ryntra.io/app/settings'), 'https://ryntra.io/app/settings')
  assert.equal(webHrefOf('/docs'), null)
  assert.equal(webHrefOf('https://evil.example/app/x'), null)
  assert.equal(webHrefOf(undefined), null)
})

test('a web door opens in the phone’s language where the page has a Ukrainian address — the web’s own rule', () => {
  // The pages in both languages answer at `/uk` and the same path (the web's `lib/site/localized.ts`).
  assert.equal(webHrefOf('/app/home', 'uk'), 'https://ryntra.io/uk/app/home')
  assert.equal(webHrefOf('/app/markets?tab=all', 'uk'), 'https://ryntra.io/uk/app/markets?tab=all')
  assert.equal(webHrefOf('/app/stocks/NVDAx', 'uk'), 'https://ryntra.io/uk/app/stocks/NVDAx')
  assert.equal(webHrefOf('/app/home', 'en'), 'https://ryntra.io/app/home')
  assert.equal(webHrefOf('/app/home'), 'https://ryntra.io/app/home', 'English unless asked')
  // A page with one address keeps it: its language is the browser's cookie, which the phone cannot set.
  assert.equal(webHrefOf('/app/bridge', 'uk'), 'https://ryntra.io/app/bridge')
  assert.equal(webHrefOf('/app/stocks/screener', 'uk'), 'https://ryntra.io/app/stocks/screener')
  assert.equal(
    webHrefOf('/app/predictions/evt_1?from=monitoring', 'uk'),
    'https://ryntra.io/app/predictions/evt_1?from=monitoring',
  )
  assert.equal(hasUkAddress('/app/bridge'), false)
  assert.equal(hasUkAddress('/docs/money/bridge'), true)
  assert.equal(hasUkAddress('/docs/nothing-here'), false)
  assert.equal(hasUkAddress('/legal/terms'), false, 'the legal texts are English until a lawyer gives them Ukrainian')
  // Never twice, and the query and the fragment ride along.
  assert.equal(localizedSitePath('/uk/docs', 'uk'), '/uk/docs')
  assert.equal(localizedSitePath('/docs/invest/buy#fees', 'uk'), '/uk/docs/invest/buy#fees')
  assert.equal(localizedSitePath('/', 'uk'), '/uk')
})

test('the site’s own doors (Help, ryntra.io) open in the phone’s language; any other address as it is', () => {
  assert.equal(siteHrefOf('https://ryntra.io/docs', 'uk'), 'https://ryntra.io/uk/docs')
  assert.equal(siteHrefOf('https://ryntra.io/docs', 'en'), 'https://ryntra.io/docs')
  assert.equal(siteHrefOf('https://ryntra.io', 'uk'), 'https://ryntra.io/uk')
  assert.equal(
    siteHrefOf('https://ryntra.io/docs/money/bridge#how', 'uk'),
    'https://ryntra.io/uk/docs/money/bridge#how',
  )
  assert.equal(siteHrefOf('https://ryntra.io/legal/terms', 'uk'), 'https://ryntra.io/legal/terms')
  assert.equal(siteHrefOf('https://predict.ryntra.io', 'uk'), 'https://predict.ryntra.io')
  assert.equal(siteHrefOf('https://evil.example/docs', 'uk'), 'https://evil.example/docs')
})

const SOL = 'So11111111111111111111111111111111111111112'
const DRAFT = 'agd_0123456789abcdef01234567'

test("Ryntra's own page opens the conversation for its context; a question only fills the composer (M11)", () => {
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/ryn?context=asset:${SOL}:SOL`), {
    path: `/ryn?context=asset%3A${SOL}%3ASOL`,
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/ryn?context=plan:${PLAN}&q=Why%20not%3F`), {
    path: `/ryn?context=plan%3A${PLAN}&q=Why+not%3F`,
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn?context=portfolio'), {
    path: '/ryn?context=portfolio',
    kind: 'native',
  })
  // No context, or one that is not a context: the general conversation.
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn'), { path: '/ryn', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/ryn?context=asset:nope&q=hi'), {
    path: '/ryn?q=hi',
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('ryntra:///ryn?context=portfolio'), { path: '/ryn?context=portfolio', kind: 'native' })
})

test("Ryntra's trade handoff opens Trade's own ticket; a sum rides only a Buy and only from Ryntra", () => {
  const buy = `/app/spot?view=crypto&mint=${SOL}&side=buy&amount=25`
  assert.deepEqual(mapDeepLink(buy, { carrySums: true }), {
    path: `/trade?mint=${SOL}&side=buy&amount=25`,
    kind: 'native',
  })
  // The same link from outside opens the same ticket without a figure nobody typed.
  assert.deepEqual(mapDeepLink(`https://ryntra.io${buy}`), { path: `/trade?mint=${SOL}&side=buy`, kind: 'native' })
  // A Sell's amount is the asset's own units, never a dollar figure.
  assert.deepEqual(mapDeepLink(`/app/spot?view=crypto&mint=${SOL}&side=sell&amount=25`, { carrySums: true }), {
    path: `/trade?mint=${SOL}&side=sell`,
    kind: 'native',
  })
  // Under an active plan: the binding goes with the Buy, the Review judges it on a fresh quote.
  assert.deepEqual(
    mapDeepLink(`/app/spot?view=stock&mint=${SOL}&side=buy&amount=100&plan=${PLAN}&v=2`, { carrySums: true }),
    { path: `/trade?mint=${SOL}&side=buy&amount=100&plan=${PLAN}&v=2`, kind: 'native' },
  )
  // A monitoring note's "Review under this plan" names the plan and no side.
  assert.deepEqual(mapDeepLink(`/app/spot?view=stock&mint=${SOL}&plan=${PLAN}&v=3`), {
    path: `/trade?mint=${SOL}&side=buy&plan=${PLAN}&v=3`,
    kind: 'native',
  })
  // A malformed sum or binding is simply not carried.
  assert.deepEqual(mapDeepLink(`/app/spot?mint=${SOL}&side=buy&amount=1e9&plan=plan_x&v=0`, { carrySums: true }), {
    path: `/trade?mint=${SOL}&side=buy`,
    kind: 'native',
  })
})

test('a market, an asset passport and a stock open the asset or the list; Portfolio, History and Results their screens', () => {
  assert.deepEqual(mapDeepLink(`/app/spot?view=crypto&mint=${SOL}`), { path: `/asset/${SOL}`, kind: 'native' })
  assert.deepEqual(mapDeepLink(`/app/assets/${SOL}`), { path: `/asset/${SOL}`, kind: 'native' })
  assert.deepEqual(mapDeepLink('/app/assets/not-a-mint'), { path: '/(tabs)/markets', kind: 'native' })
  // Spot without a market is Trade, where one is picked; a stock by its symbol is found in the screener's «Акції».
  assert.deepEqual(mapDeepLink('/app/spot'), { path: '/trade', kind: 'native' })
  assert.deepEqual(mapDeepLink('/app/stocks/NVDAx'), { path: '/(tabs)/markets?tab=stocks', kind: 'native' })
  assert.deepEqual(mapDeepLink('/app/portfolio'), { path: '/(tabs)/portfolio', kind: 'native' })
  assert.deepEqual(mapDeepLink('/app/activity'), { path: '/(tabs)/portfolio?open=history', kind: 'native' })
  // Results are the phone's own screen.
  assert.deepEqual(mapDeepLink('/app/results'), { path: '/results', kind: 'native' })
  assert.deepEqual(mapDeepLink('ryntra://results?plan=abc'), { path: '/results?plan=abc', kind: 'native' })
})

test("the builder handoffs carry Ryntra's draft, a market rule and — from Ryntra only — a budget", () => {
  assert.deepEqual(mapDeepLink(`/app/strategies/new?mint=${SOL}&draft=${DRAFT}`), {
    path: `/plans/new?mint=${SOL}&draft=${DRAFT}`,
    kind: 'native',
  })
  assert.deepEqual(
    mapDeepLink(`/app/strategies/new?plan=${PLAN}&evidence=${encodeURIComponent('dex_volume_usd:24h:lt:1000000')}`),
    {
      path: `/plans/new?plan=${PLAN}&evidence=dex_volume_usd%3A24h%3Alt%3A1000000`,
      kind: 'native',
    },
  )
  assert.deepEqual(mapDeepLink(`/app/strategies/new?mint=${SOL}&budget=50`, { carrySums: true }), {
    path: `/plans/new?mint=${SOL}&budget=50`,
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/strategies/new?mint=${SOL}&budget=50`), {
    path: `/plans/new?mint=${SOL}`,
    kind: 'native',
  })
  // Anything malformed is dropped; with neither a plan nor an asset, the picker.
  assert.deepEqual(mapDeepLink(`/app/strategies/new?mint=${SOL}&draft=agd_x&evidence=rm%20-rf`), {
    path: `/plans/new?mint=${SOL}`,
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('/app/strategies/new'), { path: '/plans/pick', kind: 'native' })
})

test('a reminder’s own link (its Telegram button) opens the resolver, which reads the rule — the link buys nothing (M16)', () => {
  const rule = 'rule_5e1f0c2a9b8d4e7f6a3c1b0d9e8f7a6b'
  const due = '2026-09-24T16:00:00.000Z'
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/stocks/NVDAx?rule=${rule}&due=${encodeURIComponent(due)}`), {
    path: `/monitoring/open?rule=${rule}&due=${encodeURIComponent(due)}&symbol=NVDAx`,
    kind: 'native',
  })
  // A due instant that is not one is dropped; the rule is still read.
  assert.equal(
    mapDeepLink(`https://ryntra.io/app/stocks/NVDAx?rule=${rule}&due=soon`).path,
    `/monitoring/open?rule=${rule}&symbol=NVDAx`,
  )
  // Without a rule, or with an id that is not one, a stock by its symbol is found in the list, as before.
  assert.equal(mapDeepLink('https://ryntra.io/app/stocks/NVDAx').path, '/(tabs)/markets?tab=stocks')
  assert.equal(
    mapDeepLink('https://ryntra.io/app/stocks/NVDAx?rule=rule_x&due=2026').path,
    '/(tabs)/markets?tab=stocks',
  )
})

test('the month’s budget link (its note’s Telegram button) opens Home with the budget’s sheet; Home alone is Home (1.13.0)', () => {
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/home?budget=edit'), {
    path: '/(tabs)/home?budget=edit',
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('ryntra://app/home?budget=edit&from=telegram'), {
    path: '/(tabs)/home?budget=edit',
    kind: 'native',
  })
  // Anything else on the link opens Home with nothing over it.
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/home'), { path: '/(tabs)/home', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/home?budget=delete'), { path: '/(tabs)/home', kind: 'native' })
})

test('one version: every address «Профі» owned opens its place a tap deeper, and the new screens pass through (M20)', () => {
  // The web's places and pages onto the phone's own (the menu v6.2).
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/markets'), { path: '/(tabs)/markets', kind: 'native' })
  // «Обмін» is a segment of «Торгівля» since M44.3.
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/swap'), { path: '/(tabs)/markets?seg=swap', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/rewards'), { path: '/rewards', kind: 'native' })
  // «Гроші» are the phone's own: Receive and Send open their screens.
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/receive'), { path: '/money/receive', kind: 'native' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/send'), { path: '/money/send', kind: 'native' })
  // The phone's own screens pass through.
  for (const own of ['/changes', '/money/send', '/money/receive?tab=link', '/bots', '/bots?tab=catalog', '/settings']) {
    assert.deepEqual(mapDeepLink(`ryntra://${own.slice(1)}`), { path: own, kind: 'native' })
  }
  // A page only the web has built still goes to the resolver, which opens ryntra.io and says so.
  // «Прогнози» are the phone's own (M12) in a build that shows them: the hub, an event, the portfolio's money.
  const shown = { predictions: true }
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/predictions', shown), {
    path: '/(tabs)/markets?seg=predictions',
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/predictions/fyrrixriwtsijm2avdec2goq', shown), {
    path: '/predictions/fyrrixriwtsijm2avdec2goq',
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/predictions/portfolio', shown), {
    path: '/predictions/money',
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/predictions/bad%20id', shown), {
    path: '/(tabs)/markets?seg=predictions',
    kind: 'native',
  })
  assert.deepEqual(mapDeepLink('ryntra://predictions/fyrrixriwtsijm2avdec2goq', shown), {
    path: '/predictions/fyrrixriwtsijm2avdec2goq',
    kind: 'native',
  })
  // 1.17.0 does not show them (the second release brings them): every link to them opens on the web, the phone's
  // own addresses as the web names them — never a screen the build does not draw.
  const hidden = { predictions: false }
  const onWeb = (href) => ({ path: `/monitoring/open?href=${encodeURIComponent(href)}`, kind: 'web' })
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/predictions', hidden), onWeb('/app/predictions'))
  assert.deepEqual(
    mapDeepLink('https://ryntra.io/app/predictions/fyrrixriwtsijm2avdec2goq?from=monitoring', hidden),
    onWeb('/app/predictions/fyrrixriwtsijm2avdec2goq?from=monitoring'),
  )
  assert.deepEqual(
    mapDeepLink('https://ryntra.io/app/predictions/portfolio', hidden),
    onWeb('/app/predictions/portfolio'),
  )
  assert.deepEqual(
    mapDeepLink('ryntra://predictions/fyrrixriwtsijm2avdec2goq?from=monitoring', hidden),
    onWeb('/app/predictions/fyrrixriwtsijm2avdec2goq?from=monitoring'),
  )
  assert.deepEqual(mapDeepLink('ryntra://predictions/money', hidden), onWeb('/app/predictions/portfolio'))
  assert.deepEqual(mapDeepLink('ryntra://predictions/bad%20id', hidden), onWeb('/app/predictions'))
  assert.deepEqual(mapDeepLink('/(tabs)/markets?seg=predictions', hidden), onWeb('/app/predictions'))
  assert.deepEqual(mapDeepLink('/(tabs)/trade?seg=predictions', hidden), onWeb('/app/predictions'))
  assert.deepEqual(mapDeepLink('/(tabs)/markets?seg=futures', hidden), {
    path: '/(tabs)/markets?seg=futures',
    kind: 'native',
  })
  // `seg` on another place is not a link to Прогнози: the swap stays the swap.
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/swap?seg=predictions', hidden), {
    path: '/(tabs)/markets?seg=swap',
    kind: 'native',
  })
  for (const web of ['/app/bridge']) {
    assert.deepEqual(mapDeepLink(`https://ryntra.io${web}`), {
      path: `/monitoring/open?href=${encodeURIComponent(web)}`,
      kind: 'web',
    })
  }
})

test('an issuer event’s own link opens the resolver on the token’s swap or sale — the link itself swaps nothing', () => {
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/stocks/SPACEX?convert=1&from=monitoring'), {
    path: '/monitoring/open?stock=SPACEX&open=convert',
    kind: 'native',
  })
  assert.equal(mapDeepLink('/app/stocks/SPACEX?sell=1').path, '/monitoring/open?stock=SPACEX&open=sell')
  assert.equal(mapDeepLink('ryntra://app/stocks/SPACEX?convert=1').path, '/monitoring/open?stock=SPACEX&open=convert')
  // Anything else on a stock's path is the Stocks list, as before; a symbol that is not one never reaches the resolver.
  assert.equal(mapDeepLink('https://ryntra.io/app/stocks/SPACEX?convert=yes').path, '/(tabs)/markets?tab=stocks')
  assert.equal(mapDeepLink('https://ryntra.io/app/stocks/%3Cscript%3E?convert=1').path, '/(tabs)/markets?tab=stocks')
})

test('a Launch link opens the phone’s own Launch: the form, «Мої лаунчі» and a token’s page (M33)', () => {
  const mint = 'So11111111111111111111111111111111111111112'
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/launch/new'), { path: '/launch', kind: 'native' })
  assert.deepEqual(mapDeepLink('/app/launch'), { path: '/launch', kind: 'native' })
  assert.deepEqual(mapDeepLink('/app/launch/mine'), { path: '/launch/mine', kind: 'native' })
  // «Лаунчі на Ryntra» — the web's page of every market launched on Ryntra, never read as a token's address.
  assert.deepEqual(mapDeepLink('https://ryntra.io/app/launch/markets'), { path: '/launch/markets', kind: 'native' })
  assert.deepEqual(mapDeepLink('/launch/markets'), { path: '/launch/markets', kind: 'native' })
  assert.deepEqual(mapDeepLink(`https://ryntra.io/app/launch/${mint}`), { path: `/launch/${mint}`, kind: 'native' })
  assert.deepEqual(mapDeepLink('/app/launch/not-a-mint!'), { path: '/launch', kind: 'native' })
  assert.deepEqual(mapDeepLink(`/launch/${mint}`), { path: `/launch/${mint}`, kind: 'native' })
  assert.deepEqual(mapDeepLink('/launch/mine'), { path: '/launch/mine', kind: 'native' })
})

test('the menu v6.2: every old address leads to its new place on the phone, as on the web (M34)', () => {
  const to = (url) => mapDeepLink(url).path
  // «Ринки» — one screener: the stock screener, Trends and the older lists open it on the same assets.
  assert.equal(to('https://ryntra.io/app/stocks'), '/(tabs)/markets?tab=stocks')
  assert.equal(to('https://ryntra.io/app/stocks/screener'), '/(tabs)/markets?tab=stocks')
  assert.equal(to('https://ryntra.io/app/stocks/screener?kind=preipo'), '/(tabs)/markets?tab=private')
  assert.equal(to('https://ryntra.io/app/trends'), '/(tabs)/markets')
  assert.equal(to('https://ryntra.io/app/trends?mode=meme'), '/(tabs)/markets?tab=memes')
  assert.equal(to('https://ryntra.io/app/markets?tab=private'), '/(tabs)/markets?tab=private')
  assert.equal(to('https://ryntra.io/app/markets?tab=watchlist'), '/(tabs)/markets?tab=watchlist')
  assert.equal(to('ryntra:///lists?tab=stock'), '/(tabs)/markets?tab=stocks')
  assert.equal(to('ryntra:///lists?tab=meme'), '/(tabs)/markets?tab=memes')
  assert.equal(to('ryntra:///lists?tab=crypto'), '/(tabs)/markets?tab=crypto')
  assert.equal(to('ryntra:///lists?tab=watchlist'), '/(tabs)/markets?tab=watchlist')
  assert.equal(to('ryntra:///lists'), '/(tabs)/markets')
  assert.equal(to('ryntra:///(tabs)/markets?tab=stock'), '/(tabs)/markets?tab=stocks')
  assert.equal(to('ryntra:///(tabs)/markets?tab=memes'), '/(tabs)/markets?tab=memes')
  assert.equal(to('ryntra:///(tabs)/markets?tab=nothing'), '/(tabs)/markets')
  // «Боти → Мої боти» — the plans, the recurring buy and the journal; the catalog its own tab.
  for (const old of [
    '/app/bots',
    '/app/autoinvest',
    '/app/plans',
    '/app/journal',
    '/app/strategies',
    '/app/strategies/plans',
  ]) {
    assert.equal(to(`https://ryntra.io${old}`), '/bots', old)
  }
  assert.equal(to('https://ryntra.io/app/bots/catalog'), '/bots?tab=catalog')
  assert.equal(to('ryntra:///plans'), '/bots')
  assert.equal(to(`ryntra:///plans/${PLAN}`), `/plans/${PLAN}`)
  // The results stay the phone's own screen, a tap inside «Боти».
  assert.equal(to('https://ryntra.io/app/results'), '/results')
  // A token by its contract address — the web's search result — finds its page on the phone.
  assert.equal(to(`https://ryntra.io/app/token/${SOL}`), `/token/${SOL}`)
  assert.equal(to('https://ryntra.io/app/token/not-an-address'), '/(tabs)/markets')
  assert.equal(to(`ryntra:///token/${SOL}`), `/token/${SOL}`)
  // «Платежі → Поповнити» opens the top-up at once.
  assert.equal(to('https://ryntra.io/app/top-up'), '/(tabs)/payments?open=top-up')
  // The launch: the form, whichever address names it.
  assert.equal(to('https://ryntra.io/app/launch'), '/launch')
  assert.equal(to('https://ryntra.io/app/launch/new'), '/launch')
})

test('the new look: every address of a place it moved opens the new place — from a link, a receipt or a push (M44.2)', () => {
  const to = (url) => mapDeepLink(url).path
  for (const scheme of ['ryntra://', 'ryntra:///']) {
    // «Термінал» is «Торгівля» on Ринки; its sale opens the ticket on Sell with the link's own asset.
    assert.equal(to(`${scheme}terminal`), '/(tabs)/markets')
    assert.equal(to(`${scheme}(tabs)/terminal`), '/(tabs)/markets')
    assert.equal(to(`${scheme}(tabs)/terminal?side=buy`), '/(tabs)/markets')
    assert.equal(to(`${scheme}terminal?side=sell&mint=So111`), '/trade?side=sell&mint=So111')
    // «Ринки» is «Торгівля · Ринки», on the tab the link names.
    assert.equal(to(`${scheme}markets`), '/(tabs)/markets')
    assert.equal(to(`${scheme}markets?tab=stock`), '/(tabs)/markets?tab=stocks')
    // «Гроші» is «Платежі»; its own screens stay where they were.
    assert.equal(to(`${scheme}money`), '/(tabs)/payments')
    assert.equal(to(`${scheme}money?open=top-up`), '/(tabs)/payments?open=top-up')
    assert.equal(to(`${scheme}money?open=elsewhere`), '/(tabs)/payments')
    assert.equal(to(`${scheme}money/send`), '/money/send')
    assert.equal(to(`${scheme}money/receive?tab=link`), '/money/receive?tab=link')
    // «Мої ордери» open over «Портфель», the order a note named carried, anything else dropped.
    assert.equal(to(`${scheme}orders`), '/(tabs)/portfolio?open=orders')
    assert.equal(to(`${scheme}orders?order=lim_abc123`), '/(tabs)/portfolio?open=orders&order=lim_abc123')
    assert.equal(to(`${scheme}orders?order=%3Cscript%3E`), '/(tabs)/portfolio?open=orders')
  }
  // The site's own addresses of the places, and the bar's new places, pass as they are.
  assert.equal(to('https://ryntra.io/app/markets'), '/(tabs)/markets')
  assert.equal(to('ryntra:///(tabs)/payments'), '/(tabs)/payments')
  assert.equal(to('ryntra:///(tabs)/portfolio'), '/(tabs)/portfolio')
  // A push's link opens the resolver, which lands a limit's note on «Портфель · Ордери» (screens/monitoring/open.tsx).
  assert.equal(to(`https://ryntra.io/app/alerts/open?n=${NOTE}`), `/monitoring/open?n=${NOTE}`)
})

test('a swap with no asset opens «Торгівля · Обмін»; a ticket with an asset stays the sheet (M44.3)', () => {
  const to = (url) => mapDeepLink(url).path
  assert.equal(to('ryntra:///trade?mode=swap'), '/(tabs)/markets?seg=swap')
  assert.equal(to('https://ryntra.io/app/swap'), '/(tabs)/markets?seg=swap')
  assert.equal(to('ryntra:///trade?mint=So111&side=sell'), '/trade?mint=So111&side=sell')
  assert.equal(to('ryntra:///trade?mode=swap&mint=So111'), '/trade?mode=swap&mint=So111')
  assert.equal(to('ryntra:///(tabs)/markets?seg=futures'), '/(tabs)/markets?seg=futures')
})

test('the web’s «Ф’ючерси» open the phone’s: the segment, or a Phoenix market’s own page by `?market=` (C4)', () => {
  const to = (url) => mapDeepLink(url).path
  assert.equal(to('https://ryntra.io/app/futures'), '/(tabs)/markets?seg=futures')
  assert.equal(to('https://ryntra.io/app/futures?market=SOL'), '/futures/SOL')
  assert.equal(to('https://ryntra.io/app/perps?market=kBONK'), '/futures/kBONK')
  assert.equal(to('https://ryntra.io/app/futures?market=..%2Fsettings'), '/(tabs)/markets?seg=futures')
  assert.equal(to('ryntra:///futures/BTC'), '/futures/BTC')
  // Only a symbol follows `/futures/`: a deeper path is not the phone's own.
  assert.equal(mapDeepLink('ryntra:///futures/BTC/x').kind === 'native', false)
})

import * as SplashScreen from 'expo-splash-screen'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, Linking, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { userAgentNameOf } from '@/features/city/bridge'
import { CITY_GROUND } from '@/features/city/city-look'
import {
  cityCoverOf,
  cityUrlOf,
  loadDecisionOf,
  PAGE_BACK_SCRIPT,
  PAGE_GO_BACK,
  pageBackOf,
  pageSpeaks,
} from '@/features/city/city-page'
import { CITY_COPY } from '@/features/city/copy'
import { useCityHost } from '@/features/city/use-city-host'
import { CLIENT_IDENTITY } from '@/lib/client-identity'
import { useCopy } from '@/lib/i18n'
import { useOffline } from '@/lib/network'

import { CityCover } from './cover'

/** The launch screen goes at the latest after this, even if the app's own mark is slow to draw. */
const SPLASH_AT_MOST_MS = 1500
/** The waits before a failed load is tried again by itself, one per try, before В«did not openВ» is said. */
const QUIET_RETRIES_AT_START: readonly number[] = [3000]
/** After the network returns the phone may take a quarter of a minute to reach a site: waits that grow, ~1 min in all. */
const QUIET_RETRIES_AFTER_NETWORK: readonly number[] = [2000, 4000, 8000, 15000, 30000]

/**
 * Ryntra City (decision 75): `https://ryntra.io` in a WebView, the whole screen вЂ” the app is the city and nothing else.
 * The page signs nothing itself: it asks the app over the bridge (`features/city/bridge.ts`, `docs/city/APP-BRIDGE.md`),
 * and the app's own wallet signs in its own window. The page knows it is in the app by `RyntraApp/<version>` in the
 * user agent and by `app.ready`.
 *
 * The page stands inside the system bars on the city's night. While it cannot show, the launch screen's own night and mark cover it
 * (`./cover`): opening, no connection, or a page that did not open вЂ” with one way to try again. Android's Back walks
 * the page's own history first; at its start, Back leaves the app. `at` is the site's address a link named (`/c/<mint>`,
 * `/?open=agent`, `/?early=<mint>`): the city opens there, and a later link moves it there.
 */
export function CityScreen({ at, onAtSeen }: { at: string | null; onAtSeen: () => void }) {
  const words = useCopy(CITY_COPY)
  const insets = useSafeAreaInsets()
  const offline = useOffline()
  const view = useRef<WebView>(null)

  /* One WebView instance per target: its number is its key; a link from outside, or В«РЎРїСЂРѕР±СѓРІР°С‚Рё С‰РµВ», opens a new one. */
  const [target, setTarget] = useState(() => ({ url: cityUrlOf(at), instance: 0 }))
  const [loadedFor, setLoadedFor] = useState<number | null>(null)
  const [failedFor, setFailedFor] = useState<number | null>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  /** The page's own word on a step back (`PAGE_BACK_SCRIPT`): null until it speaks, or where it cannot. */
  const pageBack = useRef<boolean | null>(null)
  const instance = target.instance
  const loaded = loadedFor === instance
  const failed = failedFor === instance
  /** The live city is on screen: its load ended, and not on an error (Android ends a failed load too). */
  const showing = loaded && !failed

  const post = useCallback((text: string) => view.current?.postMessage(text), [])
  const host = useCityHost(post)

  // The launch screen gives way to the same night and mark drawn by the app, never to an empty frame.
  const splashGone = useRef(false)
  const hideSplash = useCallback(() => {
    if (splashGone.current) return
    splashGone.current = true
    SplashScreen.hideAsync().catch(() => undefined)
  }, [])
  useEffect(() => {
    const timer = setTimeout(hideSplash, SPLASH_AT_MOST_MS)
    return () => clearTimeout(timer)
  }, [hideSplash])

  // A new WebView is a new page: what the old one was owed is dropped.
  const openAt = useCallback(
    (url: string) => {
      host.detach()
      setCanGoBack(false)
      pageBack.current = null
      setTarget((current) => ({ url, instance: current.instance + 1 }))
    },
    [host],
  )

  // The link the app was opened with is the first target already; a later one moves the city there.
  const seen = useRef(at)
  useEffect(() => {
    if (!at) {
      seen.current = null
      return
    }
    if (at !== seen.current) {
      seen.current = at
      openAt(cityUrlOf(at))
    }
    onAtSeen()
  }, [at, onAtSeen, openAt])

  // A failed load is tried again quietly a few times вЂ” once at the start, more right after the network comes back,
  // when the phone says В«onlineВ» a moment before a page can load вЂ” and only then is В«did not openВ» said.
  const quietRetries = useRef(QUIET_RETRIES_AT_START)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Android may say a failed load more than once (and В«loadedВ» for its error page after): one failure per WebView.
  const erroredFor = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current)
    },
    [],
  )

  // The network came back while the city could not show: it opens again by itself.
  const wasOffline = useRef(offline)
  useEffect(() => {
    if (wasOffline.current && !offline && !showing) {
      quietRetries.current = QUIET_RETRIES_AFTER_NETWORK
      openAt(target.url)
    }
    wasOffline.current = offline
  }, [offline, showing, openAt, target.url])

  // Back walks the page's history; at its start, Back does what it always does — it leaves the app. The page's own
  // word comes first: the WebView does not count a step a link's window added before the person touched the page.
  const backRef = useRef<() => boolean>(() => false)
  useEffect(() => {
    backRef.current = () => {
      if (!loaded) return false
      if (pageBack.current === true) {
        view.current?.injectJavaScript(PAGE_GO_BACK)
        return true
      }
      if (!canGoBack) return false
      view.current?.goBack()
      return true
    }
  })
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => backRef.current())
    return () => sub.remove()
  }, [])

  const onMessage = (event: WebViewMessageEvent) => {
    // Only the city's own site speaks over the bridge: a frame or a page from anywhere else is not read.
    if (!pageSpeaks(event.nativeEvent.url)) return
    const back = pageBackOf(event.nativeEvent.data)
    if (back !== null) {
      pageBack.current = back
      return
    }
    void host.receive(event.nativeEvent.data)
  }

  const fail = () => {
    if (erroredFor.current === instance) return
    erroredFor.current = instance
    host.detach()
    const [wait, ...rest] = quietRetries.current
    if (!offline && wait !== undefined) {
      quietRetries.current = rest
      const url = target.url
      if (retryTimer.current) clearTimeout(retryTimer.current)
      retryTimer.current = setTimeout(() => openAt(url), wait)
      return
    }
    setFailedFor(instance)
  }

  const cover = cityCoverOf({ offline, failed, loaded })

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.page,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        <WebView
          key={instance}
          ref={view}
          source={{ uri: target.url }}
          applicationNameForUserAgent={userAgentNameOf(CLIENT_IDENTITY.appVersion)}
          // Every address comes to `loadDecisionOf`: the site loads here, another https page opens in the browser.
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(request) => {
            const decision = loadDecisionOf(request)
            if (decision === 'external') void Linking.openURL(request.url).catch(() => undefined)
            return decision === 'load'
          }}
          // No detach on `onLoadStart`: Android raises it for every move of the page's address, `replaceState`
          // included, with no load after it. The page's own `page.ready` and the load's end both bring `app.ready`.
          onLoad={(event) => {
            if (erroredFor.current === instance) return
            setLoadedFor(instance)
            if (pageSpeaks(event.nativeEvent.url)) host.ready()
          }}
          onError={fail}
          // The site itself answered with a fault (5xx): said in the app's words, not the server's page.
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 500) fail()
          }}
          onRenderProcessGone={fail}
          onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
          onMessage={onMessage}
          injectedJavaScript={PAGE_BACK_SCRIPT}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          setSupportMultipleWindows={false}
          geolocationEnabled={false}
          allowsLinkPreview={false}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          overScrollMode="never"
          textZoom={100}
          webviewDebuggingEnabled={__DEV__}
          style={styles.web}
          containerStyle={styles.web}
          accessibilityLabel={words.label}
        />
      </View>
      <CityCover
        kind={cover}
        title={cover === 'offline' ? words.noConnection : words.notOpened}
        action={words.tryAgain}
        loadingLabel={words.loading}
        onRetry={() => {
          quietRetries.current = QUIET_RETRIES_AT_START
          openAt(target.url)
        }}
        onShown={hideSplash}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CITY_GROUND },
  page: { flex: 1 },
  web: { flex: 1, backgroundColor: CITY_GROUND },
})

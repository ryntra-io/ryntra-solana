import { useEffect, useRef } from 'react'
import { AppState, ToastAndroid } from 'react-native'

import { PLACE_HOME_COPY } from '@/features/home/place-copy'
import { useCopy } from '@/lib/i18n'

import { walletQuietAt } from '@/features/wallet/wallet-away'

import { keepEnded, keepUntil, timerDelay } from './keep-connected'
import { useKeep } from './keep-store'
import { useAccount } from './use-account'

/**
 * Ends the connection at the one moment the person chose (ST-2): when the
 * time picked in «Тримати під’єднаним» runs out — checked at launch, on every
 * return to the app and by a timer while it stays open. The session ends as
 * a sign-out does, the wallet is forgotten on this phone without raising its
 * sheet, and the end is said once, quietly. «Поки не вийду» has no end here.
 */
export function KeepConnectedBinder() {
  const account = useAccount()
  const keep = useKeep()
  const words = useCopy(PLACE_HOME_COPY)
  // Not before the session store is read: an end that ran first would leave the stored session to come back after it.
  const connected = account.address !== null && account.ready
  const end = useRef(account.endChosenTime)
  const ending = useRef(false)

  useEffect(() => {
    end.current = account.endChosenTime
  }, [account.endChosenTime])

  useEffect(() => {
    if (!connected) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const stopTimer = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    const check = () => {
      stopTimer()
      const now = Date.now()
      if (keepEnded(keep, now)) {
        // A signature on its way finishes first: the end waits for the wallet to be quiet, a minute at most after it answered.
        const quietAt = walletQuietAt(now)
        if (quietAt > now) {
          timer = setTimeout(check, timerDelay(quietAt, now))
          return
        }
        if (ending.current) return
        ending.current = true
        void end
          .current()
          // Said once, and only when it happened.
          .then(() => ToastAndroid.show(words.keepEnded, ToastAndroid.LONG))
          .catch(() => undefined)
          .finally(() => {
            ending.current = false
          })
        return
      }
      const until = keepUntil(keep)
      if (until !== null && AppState.currentState === 'active') timer = setTimeout(check, timerDelay(until, now))
    }
    check()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check()
      else stopTimer()
    })
    return () => {
      stopTimer()
      subscription.remove()
    }
  }, [connected, keep, words])

  return null
}

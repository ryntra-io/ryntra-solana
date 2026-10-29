import { useNavigationContainerRef, useRouter, useSegments } from 'expo-router'
import { useCallback, useEffect } from 'react'

import { holdPlaces } from './place-hold'
import { barBeneathOf, placeMove, type NavigationShape } from './shell'

/** Holds the places of the bar while `busy` is true (`place-hold.ts`): a note's tap or a quick action waits for it. */
export function usePlaceHold(busy: boolean) {
  useEffect(() => (busy ? holdPlaces() : undefined), [busy])
}

/**
 * Opens a place of the bar from wherever the person stands (NEW-LOOK §2), on the segment the path names:
 * - inside the bar (a place, or a sheet over one) — the bar's own switch;
 * - on a screen over the bar (a purchase's «Готово», a send's last step, an asset's page, a note) — the screens above
 *   the bar close and the place opens;
 * - on a screen opened from a link with no bar beneath it — the screens close and the bar takes their place.
 * Where the bar stands is read from the app's own stack at the moment of the tap. Never a second copy of the bar
 * stacked over the first, so «Назад» after it leads where it did before.
 */
export function useOpenPlace(): (path: string) => void {
  const router = useRouter()
  const segments = useSegments()
  const container = useNavigationContainerRef()
  const inBar = segments[0] === '(tabs)'
  return useCallback(
    (path: string) => {
      const barBeneath = barBeneathOf(container?.getRootState?.() as NavigationShape | undefined)
      const move = placeMove({ inBar, barBeneath })
      if (move === 'navigate') {
        router.navigate(path as never)
      } else if (move === 'dismissTo') {
        router.dismissTo(path as never)
      } else {
        if (router.canDismiss()) router.dismissAll()
        router.replace(path as never)
      }
    },
    [router, container, inBar],
  )
}

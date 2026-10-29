import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { Dimensions, Keyboard, ScrollView, View, type ScrollViewProps } from 'react-native'

import { boardOf, freshAim, liftAim, type Board } from '@/features/launch/lift-geometry'
import { useSpace } from '@/theme'
import { cn } from '@/utils/cn'

/** What must stay seen while a field is typed in: the field (`top`) and, under it, the fee and the button (`bottom`). */
export type LiftTarget = Readonly<{ top: RefObject<View | null>; bottom: RefObject<View | null> }>

type Lift = Readonly<{
  /** The keyboard is up. */
  open: boolean
  /**
   * While a field is typed in, keeps `bottom` above the keyboard without
   * moving `top` out of sight above — again whenever the keyboard's height,
   * the page or the target's own layout changes; `null` lets go.
   */
  follow: (target: LiftTarget | null) => void
  /** The target's layout moved (the quote grew under the field): it is kept in sight again. */
  relayout: () => void
}>

const LiftContext = createContext<Lift | null>(null)

/** The page's keyboard lift; null outside a `KeyboardLiftScroll` (a sample drawn without a page). */
export function useKeyboardLift(): Lift | null {
  return useContext(LiftContext)
}

/** A last look once the keyboard's own animation and a late layout (a suggestion strip, a quote) have settled. */
const SETTLE_MS = 250

/**
 * A screen's scrolling body that keeps what is typed and what it costs above
 * the keyboard. Android draws edge to edge, so the window is never resized
 * for the keyboard: the page itself gains the keyboard's room at its end
 * while it is up, and the part that follows is scrolled into the room left —
 * measured in the page's own coordinates, so neither a scroll under way nor
 * a keyboard that grows a suggestion strip after it opened leaves it short.
 */
export function KeyboardLiftScroll({
  children,
  refreshControl,
}: {
  children: ReactNode
  refreshControl?: ScrollViewProps['refreshControl']
}) {
  const space = useSpace()
  const scroll = useRef<ScrollView>(null)
  const frame = useRef<View>(null)
  const inner = useRef<View>(null)
  const offset = useRef(0)
  const target = useRef<LiftTarget | null>(null)
  const board = useRef<Board | null>(null)
  // The place the page was last sent to; forgotten when the page, the keyboard, the target or the person moves it.
  const sent = useRef<number | null>(null)
  const frameId = useRef<number | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [room, setRoom] = useState(0)

  const reveal = useCallback(() => {
    const node = scroll.current
    const box = frame.current
    const content = inner.current
    const edge = board.current
    const aimAt = target.current
    const top = aimAt?.top.current
    const bottom = aimAt?.bottom.current
    // Not ready yet — the keyboard's frame not known, the field not drawn: the target stays pending, and the keyboard's
    // show (or the field's own layout) looks again.
    if (!node || !box || !content || !edge || !top || !bottom) return
    box.measureInWindow((_fx, frameTop) => {
      top.measureLayout(content, (_tx, topY) => {
        bottom.measureLayout(content, (_bx, bottomY, _bw, bottomHeight) => {
          const aim = freshAim(
            liftAim({ offset: offset.current, frameTop, keyboardTop: edge.top, topY, bottomY, bottomHeight }),
            sent.current,
          )
          if (aim === null) return
          /* The offset itself is never written ahead of the scroll: a scroll the page cannot finish yet (its end not yet
             grown by the keyboard's room) sends no scroll event, and an offset written as if it had would take every
             later look for done — the field stayed under the keys on a first focus (ST-5 r7). */
          sent.current = aim
          node.scrollTo({ y: aim, animated: true })
        })
      })
    })
  }, [])

  /* Every reason to look again comes here: a look on the next frame and one on the frame after (the keyboard's room laid
     out by then), and a last one once things settle. */
  const schedule = useCallback(() => {
    if (!board.current || !target.current) return
    if (frameId.current !== null) cancelAnimationFrame(frameId.current)
    frameId.current = requestAnimationFrame(() => {
      reveal()
      frameId.current = requestAnimationFrame(() => {
        frameId.current = null
        reveal()
      })
    })
    if (settle.current) clearTimeout(settle.current)
    settle.current = setTimeout(() => {
      settle.current = null
      reveal()
    }, SETTLE_MS)
  }, [reveal])

  useEffect(() => {
    // `keyboardDidShow` comes again when the keyboard's height changes while it stays up (a suggestion strip, emoji).
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const { screenY, height } = event.endCoordinates
      const next = boardOf(screenY, height, Dimensions.get('screen').height)
      board.current = next
      sent.current = null
      setRoom(next.room)
      // A target that registered before the keyboard's frame was known is still pending: it is looked at now.
      schedule()
    })
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      board.current = null
      sent.current = null
      setRoom(0)
    })
    return () => {
      shown.remove()
      hidden.remove()
      if (frameId.current !== null) cancelAnimationFrame(frameId.current)
      if (settle.current) clearTimeout(settle.current)
    }
  }, [schedule])

  const follow = useCallback(
    (next: LiftTarget | null) => {
      target.current = next
      sent.current = null
      if (!next) return
      // The keyboard already up before this page listened (its show event gone by): its frame is read from it now.
      if (!board.current && Keyboard.isVisible()) {
        const metrics = Keyboard.metrics()
        if (metrics) {
          const known = boardOf(metrics.screenY, metrics.height, Dimensions.get('screen').height)
          board.current = known
          setRoom(known.room)
        }
      }
      schedule()
    },
    [schedule],
  )
  // The page grew (the keyboard's room added, the quote under the field): a scroll it stopped short of is sent again.
  const grown = useCallback(() => {
    sent.current = null
    schedule()
  }, [schedule])
  const lift = useMemo(() => ({ open: room > 0, follow, relayout: grown }), [room, follow, grown])
  return (
    <LiftContext.Provider value={lift}>
      <View ref={frame} collapsable={false} className="flex-1" onLayout={schedule}>
        <ScrollView
          ref={scroll}
          innerViewRef={inner as RefObject<View>}
          className="flex-1"
          contentContainerClassName={cn(space.rhythm.stack, 'px-4')}
          contentContainerStyle={{ paddingBottom: 24 + room }}
          refreshControl={refreshControl}
          // A tap on a button under the field is the button's; the keyboard stays for it.
          keyboardShouldPersistTaps="handled"
          // The room was added or the quote grew: only now is there somewhere to scroll to.
          onContentSizeChange={grown}
          // The person's own scroll: the next look may bring the field back, as before.
          onScrollBeginDrag={() => {
            sent.current = null
          }}
          onScroll={(event) => {
            offset.current = event.nativeEvent.contentOffset.y
          }}
          scrollEventThrottle={32}
        >
          {children}
        </ScrollView>
      </View>
    </LiftContext.Provider>
  )
}

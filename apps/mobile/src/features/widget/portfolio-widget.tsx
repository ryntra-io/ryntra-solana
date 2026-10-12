'use no memo'
// The widget library draws plain functions; the React Compiler's memoization breaks its tree.

import { FlexWidget, TextWidget } from 'react-native-android-widget'

import { themes, type ThemeName } from '@/theme/tokens'

import type { WidgetFace } from './widget-model'

/** The name the widget library registers the widget under (`app.json`). */
export const PORTFOLIO_WIDGET = 'Portfolio'

/** The widget's fonts, copied into the build by the widget plugin (`app.json`), named by their files. */
const SANS = 'Geist_400Regular'
const SANS_MEDIUM = 'Geist_500Medium'
const SANS_SEMIBOLD = 'Geist_600SemiBold'

type Hex = `#${string}`

/**
 * Home's portfolio card, as a widget on the home screen: «Портфель» and the
 * brand's name quiet beside it, the value right under them in Home's own
 * display face — larger on a tall widget — the day's move in its colour where
 * there is room for it, and under them the time of the read with a warning
 * word when it is not fresh — one block, centred in the room under the title.
 * A wallet not connected is one line. The whole widget opens Ryntra on
 * Portfolio. Drawn in the app's tokens, dark or light.
 */
export function PortfolioWidget({
  face,
  theme,
  uri,
  large,
  roomy,
}: {
  face: WidgetFace
  theme: ThemeName
  /** The app's own link to Portfolio. */
  uri: string
  /** A widget two rows tall or more: the value is drawn larger. */
  large: boolean
  /** Room for the day's move between the value and the time; a low widget keeps the value and its time. */
  roomy: boolean
}) {
  const colors = themes[theme]
  const fg = colors.fg as Hex
  const faint = colors.fgMuted as Hex
  const moveColor = (move: 'up' | 'down' | 'flat') =>
    (move === 'up' ? colors.successInk : move === 'down' ? colors.dangerInk : colors.fgMuted) as Hex
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      accessibilityLabel={face.label}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        backgroundColor: colors.surface as Hex,
        borderColor: colors.line as Hex,
        borderWidth: 1,
        borderRadius: 24,
        paddingHorizontal: 18,
        paddingVertical: 14,
      }}
    >
      <FlexWidget
        style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <TextWidget
          text={face.title.toUpperCase()}
          style={{ fontFamily: SANS_SEMIBOLD, fontSize: 11, letterSpacing: 0.06, color: faint }}
        />
        <TextWidget text="Ryntra" style={{ fontFamily: SANS_SEMIBOLD, fontSize: 12, color: faint }} />
      </FlexWidget>

      {/* The figure, its move and its time as one block, centred in the room under the title — a tall widget has no empty half. */}
      <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'column', justifyContent: 'center' }}>
        {face.kind === 'connect' ? (
          <TextWidget
            text={face.line}
            maxLines={2}
            style={{ fontFamily: SANS_MEDIUM, fontSize: 15, color: fg, lineHeight: 20 }}
          />
        ) : (
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
            <TextWidget
              text={face.value}
              maxLines={1}
              truncate="END"
              style={{
                fontFamily: SANS_SEMIBOLD,
                fontSize: large ? 36 : roomy ? 30 : 26,
                letterSpacing: -0.025,
                color: face.known ? fg : faint,
              }}
            />
            {face.change && roomy ? (
              <TextWidget
                text={face.change.text}
                maxLines={1}
                truncate="END"
                style={{ fontFamily: SANS_MEDIUM, fontSize: 14, color: moveColor(face.change.move), marginTop: 2 }}
              />
            ) : null}
            <FlexWidget style={{ marginTop: roomy ? 8 : 2 }}>
              <TimeLine time={face.time} note={face.note} faint={faint} warning={colors.warningInk as Hex} />
            </FlexWidget>
          </FlexWidget>
        )}
      </FlexWidget>
    </FlexWidget>
  )
}

/** The read's time, and the warning word beside it when it is not fresh. */
function TimeLine({ time, note, faint, warning }: { time: string; note: string | null; faint: Hex; warning: Hex }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
      <TextWidget text={time} style={{ fontFamily: SANS, fontSize: 12, color: faint }} />
      {note ? (
        <TextWidget
          text={` · ${note}`}
          maxLines={1}
          truncate="END"
          style={{ fontFamily: SANS_MEDIUM, fontSize: 12, color: warning }}
        />
      ) : null}
    </FlexWidget>
  )
}

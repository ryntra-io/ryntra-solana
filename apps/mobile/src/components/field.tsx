import { Pressable, Switch, TextInput, View, type TextInputProps } from 'react-native'

import { Txt } from '@/components/txt'
import { type, useTheme } from '@/theme'
import { cn } from '@/utils/cn'

export type FieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label: string
  /** One line under the field: what the figure means, or where it came from. */
  hint?: string | null
  /** What the field still needs, said instead of the hint. */
  error?: string | null
  /** A unit after the figure: "$", "%", "s". */
  suffix?: string | null
  /** Figures are mono; words are not. */
  mono?: boolean
  multiline?: boolean
}

/**
 * One labelled input. The label above, the figure or the words inside, the
 * hint or the need under it — a field that is wrong says so in a sentence,
 * never in red alone.
 */
export function Field({ label, hint, error, suffix, mono = true, multiline, className, ...input }: FieldProps) {
  const { colors } = useTheme()
  return (
    <View className={cn('gap-1.5', className)}>
      <Txt variant="labelSm" tone="faint" caps>
        {label}
      </Txt>
      <View
        className={cn(
          'flex-row items-center gap-2 rounded-btn border bg-surface px-3',
          error ? 'border-danger' : 'border-line',
          multiline ? 'items-start py-2' : 'h-11',
        )}
        style={multiline ? { minHeight: 96 } : undefined}
      >
        <TextInput
          {...input}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          placeholderTextColor={colors.fgMuted}
          selectionColor={colors.brand}
          cursorColor={colors.brand}
          accessibilityLabel={input.accessibilityLabel ?? label}
          className="flex-1 text-fg"
          style={[
            mono ? type.data : type.body,
            { paddingVertical: 0, fontSize: 15 },
            multiline ? { minHeight: 80 } : null,
          ]}
        />
        {suffix ? (
          <Txt variant="data" tone="faint">
            {suffix}
          </Txt>
        ) : null}
      </View>
      {error ? (
        <Txt variant="labelSm" tone="danger">
          {error}
        </Txt>
      ) : hint ? (
        <Txt variant="labelSm" tone="faint">
          {hint}
        </Txt>
      ) : null}
    </View>
  )
}

export type ToggleRowProps = {
  label: string
  hint?: string | null
  value: boolean
  onChange: (value: boolean) => void
  last?: boolean
}

/** A rule that is on or off, with its meaning beside the switch. */
export function ToggleRow({ label, hint, value, onChange, last }: ToggleRowProps) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      className={cn('flex-row items-center gap-3 py-3', last ? '' : 'border-b border-line')}
    >
      <View className="flex-1 gap-0.5">
        <Txt variant="ui">{label}</Txt>
        {hint ? (
          <Txt variant="labelSm" tone="faint">
            {hint}
          </Txt>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.track, true: colors.brandLine }}
        thumbColor={value ? colors.brand : colors.muted}
      />
    </Pressable>
  )
}

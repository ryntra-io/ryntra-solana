import { useRouter } from 'expo-router'
import { Pressable, ToastAndroid, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips } from '@/components/choice-chips'
import { DoorRow } from '@/components/door-row'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { PLACE_HOME_COPY, type PlaceHomeCopy } from '@/features/home/place-copy'
import { SEEKER_COPY } from '@/features/seeker/copy'
import { useSeekerMark, useSkrName } from '@/features/seeker/use-seeker'
import { KEEP_CHOICES, keepUntil } from '@/features/session/keep-connected'
import { chooseKeep, useKeep } from '@/features/session/keep-store'
import { useAccount } from '@/features/session/use-account'
import { SETTINGS_PATH } from '@/features/shell/places'
import { useNow } from '@/hooks/use-now'
import { canCopy, copyText } from '@/lib/clipboard'
import { feel } from '@/lib/haptics'
import { failureLine, signInFailureLine } from '@/features/wallet/signing-copy'
import { useCopy, useLocale } from '@/lib/i18n'
import { useSpace } from '@/theme'
import { formatAt, formatMoment, shortAddress } from '@/utils/format'

/** The round mark of the account: the wallet's glyph — a person's own name and picture come with request 54. */
export function AccountMark({ size = 40 }: { size?: number }) {
  return (
    <View
      className="items-center justify-center rounded-pill border border-line-strong bg-elevated"
      style={{ width: size, height: size }}
    >
      <Icon name="wallet-outline" size={Math.round(size * 0.45)} color="fg" />
    </View>
  )
}

/**
 * «Тримати під’єднаним» (ST-2): one row — 1 год · 2 год · доба · поки не вийду
 * — with what it means and when the wallet disconnects one tap deep, behind «?».
 */
function KeepRow({ words }: { words: PlaceHomeCopy }) {
  const keep = useKeep()
  const locale = useLocale()
  const now = useNow(30_000)
  const space = useSpace()
  const until = keepUntil(keep)
  return (
    <View className={`gap-2 border-b border-line px-4 ${space.door}`}>
      <View className="min-h-8 flex-row items-center gap-3">
        <Icon name="time-outline" size={20} />
        <Txt variant="ui" className="flex-1">
          {words.keepConnected}
        </Txt>
        {/* When the chosen time ends is a status: said beside the row, not only behind «?» (ST-4) — with its day, as
            Settings says «Вхід до завтра 00:00»: «до завтра 01:00», never a bare «до 01:00» that reads as now. */}
        {until !== null ? (
          <Txt variant="ui" tone="faint" tabular>
            {words.keepUntil(formatMoment(new Date(until).toISOString(), now, locale))}
          </Txt>
        ) : null}
        {/* What staying connected means and how the sign-in renews: the same words as Settings' «?» (ST-5). */}
        <HelpDot
          title={words.keepConnected}
          body={
            until !== null
              ? [words.keepHelp, words.renewHelp, words.keepTimed]
              : [words.keepHelp, words.renewHelp]
          }
        >
          {until !== null ? (
            <Txt variant="body" tone="fg" tabular>
              {words.keepEndsAt(formatAt(new Date(until).toISOString(), now, locale))}
            </Txt>
          ) : null}
        </HelpDot>
      </View>
      <ChoiceChips
        choices={KEEP_CHOICES.map((value) => ({
          value,
          label: words.keepChoices[value],
          accessibilityLabel: `${words.keepConnected}: ${words.keepChoices[value]}`,
        }))}
        value={keep.keep}
        onChange={chooseKeep}
        size="sm"
        quiet
        tall
        className="pl-8"
      />
    </View>
  )
}

/**
 * «Профіль» (NEW-LOOK §3): the account — its address with a copy, whether
 * the wallet is signed in — and the wallet («Змінити»), how long it stays
 * connected («Тримати під’єднаним», ST-2), the settings and «Відключити гаманець». The wallet's `.skr` name is the
 * account's name when it has one, else the address; a signed-in wallet holding a Seeker Genesis Token reads
 * «Перевірено Seeker» beside «Вхід виконано» (M41.2) — a mark, never a permission.
 */
export function ProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter()
  const words = useCopy(PLACE_HOME_COPY)
  const locale = useLocale()
  const account = useAccount()
  const address = account.address
  const seeker = useCopy(SEEKER_COPY)
  const name = useSkrName(address, account.session)
  const mark = useSeekerMark(account.session)
  const copy = () => {
    if (!address || !copyText(address)) return
    feel('review')
    ToastAndroid.show(words.copied, ToastAndroid.SHORT)
  }
  const settings = () => {
    onClose()
    router.push(SETTINGS_PATH as never)
  }
  return (
    <Sheet visible={visible && address !== null} title={words.profile} onClose={onClose} scroll>
      {address ? (
        <View className="gap-4 pb-2">
          <View className="items-center gap-2 pt-1">
            <AccountMark size={64} />
            {/* The name — the `.skr` one, else the address — once, with the address's copy beside it (ST-4: not twice). */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${words.copyAddress}: ${address}`}
              disabled={!canCopy}
              onPress={copy}
              hitSlop={6}
              className="min-h-10 flex-row items-center gap-2 rounded-btn px-2 active:bg-hover"
            >
              <Txt variant="title" tabular={!name}>
                {name ?? shortAddress(address)}
              </Txt>
              {canCopy ? <Icon name="copy-outline" size={18} color="muted" /> : null}
            </Pressable>
            {/* Under a name, the address it stands for — short, quiet; the copy above copies it whole. */}
            {name ? (
              <Txt variant="data" tone="muted" tabular>
                {shortAddress(address)}
              </Txt>
            ) : null}
            <View className="flex-row flex-wrap items-center justify-center gap-2">
              <Chip
                label={account.session ? words.signedIn : words.connected}
                tone={account.session ? 'success' : 'neutral'}
                caps={false}
              />
              {account.session && mark === 'verified' ? (
                <View className="flex-row items-center">
                  <Chip label={seeker.verified} tone="success" caps={false} />
                  <HelpDot title={seeker.verified} body={seeker.verifiedHelp} />
                </View>
              ) : null}
            </View>
          </View>
          {!account.session ? (
            <Button title={words.signIn} size="lg" loading={account.signingIn} onPress={() => void account.signIn()} />
          ) : null}
          {/* A sign-in the wallet did not sign, or any other answer, said once in one line (M45). */}
          {!account.session && (account.signInFailure || account.failure) ? (
            <Txt variant="ui" tone="danger" className="text-center" accessibilityLiveRegion="polite">
              {account.signInFailure
                ? signInFailureLine(account.signInFailure, locale)
                : failureLine(account.failure!.message, locale)}
            </Txt>
          ) : null}
          <Card padded={false}>
            <DoorRow
              icon="wallet-outline"
              label={words.wallet}
              value={words.switchWallet}
              onPress={() => {
                onClose()
                void account.switchWallet()
              }}
            />
            <KeepRow words={words} />
            <DoorRow icon="settings-outline" label={words.settings} onPress={settings} />
            <DoorRow
              icon="log-out-outline"
              label={words.disconnect}
              onPress={() => {
                onClose()
                void account.disconnect()
              }}
              last
            />
          </Card>
        </View>
      ) : null}
    </Sheet>
  )
}

import * as Sharing from 'expo-sharing'
import { useRef, useState } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import { captureRef } from 'react-native-view-shot'

import { Button } from '@/components/button'
import { ToggleRow } from '@/components/field'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import { shareFace, type ReceiptDoc } from '@/features/receipts/receipt-doc'
import { useCopy, useLocale } from '@/lib/i18n'
import { cn } from '@/utils/cn'

import { PICTURE_WIDTH, ReceiptPicture } from './receipt-picture'

type Props = {
  doc: ReceiptDoc
  /** A journal entry's mark in the launch's words. */
  markWords?: Readonly<Record<string, string>>
}

/**
 * «Поділитися картинкою»: the receipt drawn as a picture, the amounts off
 * until the person turns them on, then Android's own share sheet. The
 * picture is made on the phone from the document; nothing is sent anywhere
 * but where the person shares it.
 */
export function ShareReceiptSheet({
  doc,
  markWords,
  visible,
  onClose,
}: Props & { visible: boolean; onClose: () => void }) {
  const copy = useCopy(RECEIPTS_COPY)
  const locale = useLocale()
  const { width } = useWindowDimensions()
  const picture = useRef<View>(null)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const face = shareFace(doc, show, locale)

  const share = async () => {
    if (busy || !picture.current) return
    setBusy(true)
    setFailure(null)
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setFailure(copy.shareUnavailable)
        return
      }
      const uri = await captureRef(picture, { format: 'png', quality: 1, result: 'tmpfile' })
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: copy.shareTitle })
    } catch {
      setFailure(copy.shareFailed)
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setShow(false)
    setFailure(null)
    onClose()
  }

  return (
    <Sheet
      visible={visible}
      title={doc.kind === 'journal' ? copy.shareEntry : copy.shareTitle}
      subtitle={doc.title}
      onClose={close}
      scroll
    >
      <View className="gap-3 pb-2">
        <View className="items-center">
          <ReceiptPicture
            ref={picture}
            face={face}
            copy={copy}
            markWords={markWords}
            width={Math.min(PICTURE_WIDTH, width - 32)}
          />
        </View>
        {face.hasAmounts ? <ToggleRow label={copy.showAmounts} value={show} onChange={setShow} last /> : null}
        {failure ? (
          <Txt variant="ui" tone="danger" accessibilityLiveRegion="polite">
            {failure}
          </Txt>
        ) : null}
        <Button title={copy.shareAction} loading={busy} onPress={() => void share()} />
      </View>
    </Sheet>
  )
}

/**
 * The door on a receipt — «Поділитися картинкою» — and its sheet: a row
 * among a sheet's rows, or a quiet button among a flow's buttons.
 */
export function ShareReceiptButton({
  doc,
  markWords,
  className,
  variant = 'row',
}: Props & { className?: string; variant?: 'row' | 'button' }) {
  const copy = useCopy(RECEIPTS_COPY)
  const [open, setOpen] = useState(false)
  return (
    <>
      {variant === 'button' ? (
        <View className={cn('w-full', className)}>
          <Button title={copy.share} variant="ghost" size="lg" onPress={() => setOpen(true)} />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.share}
          onPress={() => setOpen(true)}
          className={cn('min-h-11 flex-row items-center gap-3 py-3 active:bg-hover', className)}
        >
          <Icon name="share-social-outline" size={18} />
          <Txt variant="ui" className="flex-1">
            {copy.share}
          </Txt>
          <Icon name="chevron-forward" size={16} color="fgMuted" />
        </Pressable>
      )}
      {open ? <ShareReceiptSheet doc={doc} markWords={markWords} visible onClose={() => setOpen(false)} /> : null}
    </>
  )
}

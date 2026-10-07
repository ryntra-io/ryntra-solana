import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { useEffect, useRef } from 'react'
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { MONEY_COPY } from '@/features/money/copy'
import { feel } from '@/lib/haptics'
import { useCopy, useSharedCopy } from '@/lib/i18n'
import { brand, themes } from '@/theme/tokens'

/** The camera's own ground, the close button's scrim and the frame — the dark theme's ground and shadow, the brand's white. */
const CAMERA_GROUND = themes.dark.ground
const SCRIM = themes.dark.shadowMd
const FRAME = brand.onBrand

export type ScannerProps = {
  visible: boolean
  onClose: () => void
  /** What the code carries, read once — an address, a `solana:` request or a Ryntra link; the server judges it. */
  onScan: (text: string) => void
}

/**
 * The camera over the whole screen, reading QR codes only, and handing the
 * first one it reads to «Кому» — the recipient check says what it is. Nothing
 * is recorded or kept. Without the camera's permission the screen says so and
 * offers the one step that gives it.
 */
export function Scanner({ visible, onClose, onScan }: ScannerProps) {
  const words = useCopy(MONEY_COPY)
  const shared = useSharedCopy()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const read = useRef(false)
  const asked = useRef(false)
  // Each opening reads one code; the camera is asked for at most once per opening, by the system's own prompt.
  useEffect(() => {
    if (!visible) {
      asked.current = false
      return
    }
    read.current = false
    if (asked.current || !permission || permission.granted || !permission.canAskAgain) return
    asked.current = true
    void requestPermission()
  }, [visible, permission, requestPermission])
  const close = () => onClose()
  const scanned = (result: BarcodeScanningResult) => {
    const text = result.data?.trim()
    if (read.current || !text) return
    read.current = true
    feel('review')
    onScan(text)
    close()
  }
  const granted = permission?.granted === true
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View className="flex-1" style={{ backgroundColor: CAMERA_GROUND }}>
        {visible && granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned}
          />
        ) : null}
        <View className="flex-row items-center justify-between px-4" style={{ paddingTop: insets.top + 8 }}>
          <Txt variant="title" tone="onBrand">
            {words.scanTitle}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shared.close}
            onPress={close}
            hitSlop={10}
            className="h-11 w-11 items-center justify-center rounded-pill"
            style={{ backgroundColor: SCRIM }}
          >
            <Icon name="close" size={24} color="onBrand" />
          </Pressable>
        </View>
        {granted ? (
          <View className="flex-1 items-center justify-center">
            <View
              accessible={false}
              style={{
                width: 248,
                height: 248,
                borderRadius: 20,
                borderWidth: 2,
                borderColor: FRAME,
              }}
            />
            <Txt variant="ui" className="mt-6 px-8 text-center" tone="onBrand">
              {words.scanHint}
            </Txt>
          </View>
        ) : permission ? (
          <View className="flex-1 items-center justify-center gap-4 px-8">
            <Icon name="camera-outline" size={32} color="onBrand" />
            <Txt variant="body" className="text-center" tone="onBrand">
              {words.cameraNeeded}
            </Txt>
            {permission.canAskAgain ? (
              <Button title={words.allowCamera} size="lg" onPress={() => void requestPermission()} />
            ) : (
              <Button title={words.openSettings} size="lg" onPress={() => void Linking.openSettings()} />
            )}
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

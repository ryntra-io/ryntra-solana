/**
 * A token's picture from the phone — a photo taken now or one from the
 * gallery — made the way the web makes it: a square from the centre, 512 px a
 * side, WebP (JPEG where WebP does not fit) under the 256 KB the server takes.
 * The bytes are checked by what they are, not by what the picker says.
 */

import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

import { IMAGE_MAX_BYTES } from './form'
import { base64Bytes, imageTypeOfBase64 } from './picture-bytes'

export type Picture = Readonly<{ uri: string; base64: string; bytes: number }>

export type PictureResult =
  | Readonly<{ kind: 'picked'; picture: Picture }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'camera-off' }>
  | Readonly<{ kind: 'bad' }>

const SIDE = 512
const ATTEMPTS: readonly Readonly<{ format: ImageManipulator.SaveFormat; compress: number }>[] = [
  { format: ImageManipulator.SaveFormat.WEBP, compress: 0.9 },
  { format: ImageManipulator.SaveFormat.WEBP, compress: 0.75 },
  { format: ImageManipulator.SaveFormat.JPEG, compress: 0.85 },
  { format: ImageManipulator.SaveFormat.JPEG, compress: 0.6 },
]

/** The picked image as a 512 px square under the server's size, or null when it cannot be one. */
async function shrink(asset: ImagePicker.ImagePickerAsset): Promise<Picture | null> {
  const side = Math.min(asset.width, asset.height)
  if (!side) return null
  const crop = {
    originX: Math.floor((asset.width - side) / 2),
    originY: Math.floor((asset.height - side) / 2),
    width: side,
    height: side,
  }
  for (const attempt of ATTEMPTS) {
    const result = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ crop }, { resize: { width: SIDE, height: SIDE } }],
      { format: attempt.format, compress: attempt.compress, base64: true },
    )
    const base64 = result.base64 ?? ''
    const bytes = base64Bytes(base64)
    if (!base64 || bytes > IMAGE_MAX_BYTES || !imageTypeOfBase64(base64)) continue
    return { uri: result.uri, base64, bytes }
  }
  return null
}

const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 1,
}

/** A photo taken now — the camera asked for once; refused, it says so and the gallery stays. */
export async function takePicture(): Promise<PictureResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) return { kind: 'camera-off' }
    return await finish(await ImagePicker.launchCameraAsync(OPTIONS))
  } catch {
    // Android 7–9 asks storage of the camera, and the app declares none: said as the camera being off, the gallery stays.
    return { kind: 'camera-off' }
  }
}

/** A picture from the gallery — Android's own picker, no storage permission. */
export async function choosePicture(): Promise<PictureResult> {
  try {
    return await finish(await ImagePicker.launchImageLibraryAsync(OPTIONS))
  } catch {
    return { kind: 'bad' }
  }
}

async function finish(result: ImagePicker.ImagePickerResult): Promise<PictureResult> {
  const asset = result.canceled ? null : (result.assets[0] ?? null)
  if (!asset) return { kind: 'cancelled' }
  try {
    const picture = await shrink(asset)
    return picture ? { kind: 'picked', picture } : { kind: 'bad' }
  } catch {
    return { kind: 'bad' }
  }
}

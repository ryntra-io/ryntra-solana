import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

import { shareFileName, type ShareFile } from './bridge'

/** The cache folder the city's shared files are written to; emptied before each share, so one file is kept at most. */
const FOLDER = 'city-share'

/**
 * `share.file` (CITY-6c): the page's file written to the app's cache and handed to Android's own share sheet. False
 * when this phone has no share sheet. The file stays until the next share — the app the person picked may still be
 * reading it after the sheet closes. The sheet takes no text beside a file; the page's `text` is the sheet's title.
 */
export async function shareCityFile(file: ShareFile): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false
  const folder = new Directory(Paths.cache, FOLDER)
  if (folder.exists) folder.delete()
  folder.create({ intermediates: true })
  const out = new File(folder, shareFileName(file))
  out.write(file.data, { encoding: 'base64' })
  await Sharing.shareAsync(out.uri, { mimeType: file.mime, dialogTitle: file.text ?? undefined })
  return true
}

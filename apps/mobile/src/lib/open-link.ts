import { Linking } from 'react-native'

/** Opens a link in the phone's browser or app; a phone that cannot open it leaves the screen as it was. */
export function openLink(url: string): void {
  Linking.openURL(url).catch(() => undefined)
}

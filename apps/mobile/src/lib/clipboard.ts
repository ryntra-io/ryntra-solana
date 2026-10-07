import { TurboModuleRegistry, type TurboModule } from 'react-native'

/**
 * The system clipboard through React Native's own native module — the one the
 * development build already carries (`Clipboard`), so copying an address needs
 * no new native code. It is reached through the public module registry: the
 * package's `Clipboard` getter only adds a deprecation notice, and a deep
 * import of its file is deprecated in turn. Should a future React Native drop
 * the module, `canCopy` is false and the screen offers the share sheet alone.
 */
interface ClipboardModule extends TurboModule {
  setString: (content: string) => void
  getString: () => Promise<string>
}

const clipboard = TurboModuleRegistry.get<ClipboardModule>('Clipboard')

export const canCopy = clipboard !== null

/** Put text on the clipboard — an address the person chose to copy, nothing else. False when there is no clipboard to write to. */
export function copyText(text: string): boolean {
  if (!clipboard) return false
  clipboard.setString(text)
  return true
}

/** What the clipboard holds, read only when the person pressed «Вставити»; null when it is empty or cannot be read. */
export async function pasteText(): Promise<string | null> {
  if (!clipboard) return null
  try {
    const text = (await clipboard.getString()).trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

import { revokeDevice, type Session } from '@/lib/api'

import { clearDeviceRecord, readDeviceRecord } from './device-store'

/**
 * Forget this wallet's registration on the phone, and tell the server
 * while its bearer still stands — the step before a sign-out or a switch.
 * Best effort: the record is dropped either way, and the next sign-in of
 * the same wallet registers the phone again under the same token.
 */
export async function revokeThisDevice(session: Session | null): Promise<void> {
  if (!session) return
  const record = readDeviceRecord(session.address)
  if (!record) return
  try {
    await revokeDevice(session, record.deviceId)
  } catch {
    // The server may be unreachable or the bearer already dead; the phone forgets the device regardless.
  } finally {
    clearDeviceRecord(session.address)
  }
}

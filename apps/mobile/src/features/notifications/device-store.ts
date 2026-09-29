import { createMMKV } from 'react-native-mmkv'
import { useSyncExternalStore } from 'react'

import { recordFor, type DeviceRecord } from './device-registry'

/**
 * The phone's registration record, one per wallet, on the device. The
 * token inside it is the push provider's address for this phone — sent to
 * the server on registration, never logged, never shown, dropped with the
 * wallet's other private caches when the wallet signs out.
 */
const storage = createMMKV({ id: 'ryntra.notifications' })
const listeners = new Set<() => void>()
const cache = new Map<string, DeviceRecord | null>()

function key(address: string): string {
  return `device:${address}`
}

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function readDeviceRecord(address: string | null): DeviceRecord | null {
  if (!address) return null
  if (cache.has(address)) return recordFor(cache.get(address) ?? null, address)
  let record: DeviceRecord | null = null
  try {
    const stored = storage.getString(key(address))
    if (stored) {
      const parsed = JSON.parse(stored) as DeviceRecord
      record = parsed && typeof parsed.deviceId === 'string' && typeof parsed.token === 'string' ? parsed : null
    }
  } catch {
    record = null
  }
  cache.set(address, record)
  return recordFor(record, address)
}

export function writeDeviceRecord(record: DeviceRecord): void {
  cache.set(record.address, record)
  storage.set(key(record.address), JSON.stringify(record))
  notify()
}

export function clearDeviceRecord(address: string | null): void {
  if (!address) return
  cache.set(address, null)
  storage.remove(key(address))
  notify()
}

/** The live record of one wallet for the screens; null for another wallet or none. */
export function useDeviceRecord(address: string | null): DeviceRecord | null {
  const read = () => readDeviceRecord(address)
  return useSyncExternalStore(subscribe, read, read)
}

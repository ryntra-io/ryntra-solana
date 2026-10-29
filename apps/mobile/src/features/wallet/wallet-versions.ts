/**
 * Whether the connected wallet signs v1 transactions (SIMD-0385) — what its
 * own `get_capabilities` answers in `supported_transaction_versions`. Asked
 * only where a v1 transaction is the one way (a first purchase and its lock on
 * Micro, contract 1.71.0), kept for the app's run, forgotten with the wallet.
 * Unknown until asked: null, never «no».
 */

import { useSyncExternalStore } from 'react'

let known: boolean | null = null
const listeners = new Set<() => void>()

function set(next: boolean | null): void {
  if (known === next) return
  known = next
  for (const listener of listeners) listener()
}

/** The wallet's answer read: v1 only when it names version 1 among the versions it signs. */
export function signsV1Of(capabilities: unknown): boolean {
  const versions = (capabilities as Readonly<{ supported_transaction_versions?: unknown }> | null)
    ?.supported_transaction_versions
  return Array.isArray(versions) && versions.some((version) => version === 1 || version === '1')
}

export function rememberSignsV1(signsV1: boolean): void {
  set(signsV1)
}

/** Another wallet, or none: what the last one said no longer stands. */
export function forgetSignsV1(): void {
  set(null)
}

export function signsV1Known(): boolean | null {
  return known
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = () => known

export function useSignsV1(): boolean | null {
  return useSyncExternalStore(subscribe, snapshot)
}

import { planLayout as checkLayout, type Layout, type LayoutRefusalReason, type LayoutSaveRequest, type Piece } from '../../../../../lib/world/layout.ts';
import { mockWorld, world as worldClient, type WorldClient } from '../../client.ts';
import { randomId } from '../../ids.ts';
import { browserStorage, type StorageLike } from '../../mock.ts';
import type { ClientErrorCode } from '../../types.ts';

/**
 * How the city reads and saves a quarter's free layout: `/api/world/layout` on the server, or this device's storage
 * when the city runs on the device's world (`client.ts`). Every save carries an Idempotency-Key; the store retries
 * once with the same one.
 */
export interface LayoutClient {
  /** My layout of a quarter, my signs' words included; version 0 with nothing saved. */
  mine(quarterId: string): Promise<Layout>;
  /** The whole layout at the version I saw. A 409 carries the layout as it is now. */
  save(input: LayoutSaveRequest, key?: string): Promise<Layout>;
}

/** A refused or failed read or save. `current` is the layout as the world has it after a version conflict. */
export class LayoutError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly reason: LayoutRefusalReason | null;
  readonly current: Layout | null;

  constructor(status: number, code: ClientErrorCode, more: { reason?: LayoutRefusalReason | null; current?: Layout | null } = {}) {
    super(`layout ${status} ${code}${more.reason ? ` (${more.reason})` : ''}`);
    this.name = 'LayoutError';
    this.status = status;
    this.code = code;
    this.reason = more.reason ?? null;
    this.current = more.current ?? null;
  }
}

export const isLayoutError = (e: unknown): e is LayoutError => e instanceof LayoutError;

const isLayout = (l: unknown): l is Layout =>
  !!l && typeof (l as Layout).quarterId === 'string' && typeof (l as Layout).version === 'number' && Array.isArray((l as Layout).pieces);

export function createHttpLayout(options: { base?: string; fetch?: typeof fetch; newKey?: () => string } = {}): LayoutClient {
  const base = options.base ?? '/api/world/layout';
  const newKey = options.newKey ?? randomId;

  async function call(method: 'GET' | 'POST', query: string, body?: unknown, key?: string): Promise<Layout> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      headers['idempotency-key'] = key ?? newKey();
    }
    let res: Response;
    try {
      res = await (options.fetch ?? fetch)(`${base}${query}`, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    } catch {
      throw new LayoutError(0, 'OFFLINE');
    }
    const data = (await res.json().catch(() => null)) as { layout?: unknown; error?: { code?: unknown; reason?: unknown } } | null;
    if (!res.ok) {
      const code = (typeof data?.error?.code === 'string' ? data.error.code : res.status === 409 ? 'VERSION_CONFLICT' : 'UNAVAILABLE') as ClientErrorCode;
      const reason = typeof data?.error?.reason === 'string' ? (data.error.reason as LayoutRefusalReason) : null;
      throw new LayoutError(res.status, code, { reason, current: isLayout(data?.layout) ? data.layout : null });
    }
    if (!isLayout(data?.layout)) throw new LayoutError(502, 'BAD_ANSWER');
    return data.layout;
  }

  return {
    mine: (quarterId) => call('GET', `?quarterId=${encodeURIComponent(quarterId)}`),
    save: (input, key) => call('POST', '', input, key),
  };
}

/**
 * The layout on this device, with the server's own rules (`planLayout` against the quarter as the device's world has
 * it), for development and the city that runs on the device's world.
 */
export function createDeviceLayout(options: { world: WorldClient; storage?: StorageLike | null; now?: () => Date }): LayoutClient {
  const memory = new Map<string, string>();
  const storage = options.storage ?? null;
  const now = options.now ?? (() => new Date());
  const keyOf = (quarterId: string) => `ryntra.city.layout.v1.${quarterId}`;
  const read = (quarterId: string): Layout => {
    const raw = storage ? storage.getItem(keyOf(quarterId)) : (memory.get(quarterId) ?? null);
    try {
      const saved = raw ? (JSON.parse(raw) as unknown) : null;
      if (isLayout(saved) && saved.quarterId === quarterId) return saved;
    } catch {
      // A broken record reads as nothing saved.
    }
    return { quarterId, pieces: [], version: 0, updatedAt: null };
  };
  const write = (layout: Layout) => {
    const text = JSON.stringify(layout);
    if (storage) storage.setItem(keyOf(layout.quarterId), text);
    else memory.set(layout.quarterId, text);
  };
  return {
    async mine(quarterId) {
      return read(quarterId);
    },
    async save(input) {
      const current = read(input.quarterId);
      if (current.version !== input.version) throw new LayoutError(409, 'VERSION_CONFLICT', { current });
      const state = await options.world.quarter(input.quarterId);
      const planned = checkLayout({ quarter: state.quarter, buildings: state.buildings, pieces: input.pieces });
      if (!planned.ok) throw new LayoutError(planned.refusal.reason === 'shape' ? 400 : 422, planned.refusal.reason === 'shape' ? 'BAD_REQUEST' : 'LOCKED', { reason: planned.refusal.reason });
      const next: Layout = { quarterId: input.quarterId, pieces: planned.pieces as Piece[], version: current.version + 1, updatedAt: now().toISOString() };
      write(next);
      return next;
    },
  };
}

const httpLayout = createHttpLayout();
let deviceLayout: LayoutClient | null = null;

/** The layout client that goes with the world the city uses: the server's, or this device's. */
export function layoutClient(): LayoutClient {
  if (worldClient() !== mockWorld) return httpLayout;
  deviceLayout ??= createDeviceLayout({ world: mockWorld, storage: browserStorage() });
  return deviceLayout;
}

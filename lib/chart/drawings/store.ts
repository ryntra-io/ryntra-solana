/* Per-scope drawing persistence over localStorage. Debounced writes, versioned
   envelope, unknown/newer entries preserved in a `foreign` bucket. SSR-safe. */

import { DRAWINGS_STORAGE_PREFIX, MAX_DRAWINGS_PER_SCOPE } from "./types";
import type { DrawingsFile, IDrawingStore, StoredDrawing, ToolType } from "./types";

const SAVE_DEBOUNCE_MS = 400;

/* Record keyed by ToolType so tsc flags this table when the union changes. */
const TOOL_TYPES: Record<ToolType, true> = {
  trend: true,
  ray: true,
  hline: true,
  vline: true,
  rect: true,
  fib: true,
  text: true,
  ruler: true,
  position: true,
};

function isKnownToolType(v: unknown): v is ToolType {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(TOOL_TYPES, v);
}

function isValidDrawing(e: unknown): e is StoredDrawing {
  if (typeof e !== "object" || e === null) return false;
  const d = e as Record<string, unknown>;
  if (typeof d.id !== "string" || d.id.length === 0) return false;
  if (!isKnownToolType(d.type)) return false;
  if (!Array.isArray(d.points)) return false;
  for (const p of d.points) {
    if (typeof p !== "object" || p === null) return false;
    const pt = p as Record<string, unknown>;
    if (typeof pt.time !== "number" || typeof pt.price !== "number") return false;
  }
  if (typeof d.style !== "object" || d.style === null) return false;
  return true;
}

function isQuotaError(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    return (
      err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22
    );
  }
  return false;
}

export class DrawingStore implements IDrawingStore {
  private scope: string;
  private readonly map = new Map<string, StoredDrawing>();
  private selectedId: string | null = null;
  private visible = true;
  private readonly listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  /** Entries from newer schema versions / unknown types — re-serialized, never destroyed. */
  private foreign: unknown[] = [];
  private listCache: StoredDrawing[] | null = null;
  private readonly hasWindow = typeof window !== "undefined";

  private readonly onBeforeUnload = (): void => {
    this.flush();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.flush();
  };

  constructor(scope: string) {
    this.scope = scope;
    this.load();
    if (this.hasWindow) {
      window.addEventListener("beforeunload", this.onBeforeUnload);
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  list(): readonly StoredDrawing[] {
    if (this.listCache === null) this.listCache = [...this.map.values()];
    return this.listCache;
  }

  get(id: string): StoredDrawing | undefined {
    return this.map.get(id);
  }

  add(d: StoredDrawing): void {
    this.map.set(d.id, d);
    this.evictBeyondCap();
    this.listCache = null;
    this.scheduleSave();
    this.notify();
  }

  update(d: StoredDrawing): void {
    if (!this.map.has(d.id)) return;
    this.map.set(d.id, d);
    this.listCache = null;
    this.scheduleSave();
    this.notify();
  }

  remove(id: string): void {
    if (!this.map.delete(id)) return;
    if (this.selectedId === id) this.selectedId = null;
    this.listCache = null;
    this.scheduleSave();
    this.notify();
  }

  clearAll(): void {
    if (this.map.size === 0 && this.selectedId === null) return;
    this.map.clear();
    this.selectedId = null;
    this.listCache = null;
    this.scheduleSave();
    this.notify();
  }

  getSelected(): string | null {
    return this.selectedId;
  }

  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.notify();
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  setScope(scope: string): void {
    if (scope === this.scope) return;
    this.flush();
    this.scope = scope;
    this.selectedId = null;
    this.load();
    this.notify();
  }

  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) this.write();
  }

  destroy(): void {
    this.flush();
    this.listeners.clear();
    if (this.hasWindow) {
      window.removeEventListener("beforeunload", this.onBeforeUnload);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  /* ---- internals ---- */

  private storageKey(): string {
    return DRAWINGS_STORAGE_PREFIX + this.scope;
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (!this.hasWindow) return;
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.write();
    }, SAVE_DEBOUNCE_MS);
  }

  private serialize(): string {
    const file: DrawingsFile = {
      v: 1,
      drawings: [...this.map.values(), ...(this.foreign as StoredDrawing[])],
    };
    return JSON.stringify(file);
  }

  private write(): void {
    this.dirty = false;
    if (!this.hasWindow) return;
    try {
      window.localStorage.setItem(this.storageKey(), this.serialize());
    } catch (err) {
      if (!isQuotaError(err)) return;
      const evicted = this.evictBeyondCap();
      try {
        window.localStorage.setItem(this.storageKey(), this.serialize());
      } catch {
        /* storage stays stale; drawings live in memory until next attempt */
      }
      if (evicted > 0) this.notify();
    }
  }

  /** Evict oldest (by createdAt) beyond MAX_DRAWINGS_PER_SCOPE. Returns eviction count. */
  private evictBeyondCap(): number {
    const excess = this.map.size - MAX_DRAWINGS_PER_SCOPE;
    if (excess <= 0) return 0;
    const oldest = [...this.map.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 0; i < excess; i++) {
      const victim = oldest[i];
      this.map.delete(victim.id);
      if (this.selectedId === victim.id) this.selectedId = null;
    }
    this.listCache = null;
    return excess;
  }

  private load(): void {
    this.map.clear();
    this.foreign = [];
    this.listCache = null;
    this.dirty = false;
    if (!this.hasWindow) return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(this.storageKey());
    } catch {
      return;
    }
    if (raw === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const env = parsed as { v?: unknown; drawings?: unknown };
    if (!Array.isArray(env.drawings)) return;
    if (env.v !== 1) {
      // Newer/unknown schema: preserve entries untouched, expose nothing.
      this.foreign = env.drawings.slice();
      return;
    }
    for (const entry of env.drawings) {
      if (isValidDrawing(entry)) {
        if (typeof entry.createdAt !== "number") entry.createdAt = 0;
        this.map.set(entry.id, entry);
      } else {
        this.foreign.push(entry);
      }
    }
  }
}

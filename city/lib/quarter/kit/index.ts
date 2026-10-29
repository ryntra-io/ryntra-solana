import { createElement, type ReactElement } from 'react';
import { KitBuilding } from '../../../components/quarter/kit/Kit.tsx';
import type { BuildOptions } from './blueprint.ts';
import type { BuildingKind, Level } from './catalog.ts';

/**
 * The quarter's building kit for the city's R3F scene.
 *
 *   <KitWorld>
 *     {buildings.map((b) => (
 *       <group key={b.id} position={[x, 0, z]}>{renderBuilding(b.kind, b.level, b.modules, { seed })}</group>
 *     ))}
 *   </KitWorld>
 *
 * A building stands on its lot (LOT × LOT, centred on its group, front toward +z). Everything under one KitWorld
 * shares one instanced draw call per shape; a building rendered outside one brings its own. Modules are the world
 * server's ids (`lib/world/catalog.ts`); the server checks them, the kit draws whatever reaches it.
 */
export function renderBuilding(kind: BuildingKind, level: Level, modules: readonly string[] = [], options: BuildOptions = {}): ReactElement {
  return createElement(KitBuilding, { kind, level, modules, ...options });
}

export { KitBuilding, KitPlan, KitWorld } from '../../../components/quarter/kit/Kit.tsx';
export { LOT, STOREY, planBuilding, type BuildOptions, type Signal } from './blueprint.ts';
export {
  BUILDING_KINDS,
  KIND_NAMES,
  LEVELS,
  MAX_FLOORS,
  MODULES,
  MODULE_SLOTS,
  defaultModules,
  floorsFor,
  isKind,
  isLevel,
  moduleDef,
  moduleList,
  modulesFor,
  normalizeModules,
  quarterLevelFor,
  type BuildingKind,
  type Level,
  type ModuleDef,
  type ModuleId,
  type ModuleSet,
  type ModuleSlot,
} from './catalog.ts';
export { chooseLod, projectedPixels, type Lod } from './lod.ts';
export type { BuildingPlan, Part } from './parts.ts';

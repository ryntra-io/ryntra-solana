// CITY-238 · the machine's own rig: LiteSVM and the ranges that came with the image. `entry.mjs` loads it unless a test
// names another.
//
// LiteSVM is found the way node finds any package from here — the image installs it in a folder above this one
// (`image.mjs`) — or in the folder a stand names (`RYNTRA_HACK_SVM`, as `CITY224_SVM` on the CITY-224 stand).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { liteSvmEngines } from "./litesvm.mjs";

function svmDir() {
  const named = process.env.RYNTRA_HACK_SVM?.trim() || process.env.CITY224_SVM?.trim();
  if (named) return named;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, "node_modules/litesvm/package.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export default async function rig(sb) {
  const { catalogue } = await import("../ranges/catalogue.ts");
  const ranges = catalogue();
  return { engine: liteSvmEngines(svmDir(), sb.accountsHash), forPin: (pin) => ranges.forPin(pin) };
}

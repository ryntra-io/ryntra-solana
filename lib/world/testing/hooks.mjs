/*
 * Lets node's own test runner load the world's TypeScript as Next does:
 * `@/…` from the repository root and relative imports without an extension.
 * Import this first, then load `.ts` modules with `await import(…)`.
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const EXTENSIONS = [".ts", ".tsx", ".js", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = resolvePath(root, specifier.slice(2));
      for (const ext of ["", ...EXTENSIONS]) if (existsSync(base + ext) && !existsSync(base + ext + "/")) return nextResolve(pathToFileURL(base + ext).href, context);
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && context.parentURL) {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        for (const ext of EXTENSIONS) if (existsSync(base + ext)) return nextResolve(pathToFileURL(base + ext).href, context);
      }
      throw error;
    }
  },
});

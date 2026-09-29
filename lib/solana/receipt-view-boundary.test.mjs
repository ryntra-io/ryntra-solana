import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("receipt display loads without adapter, validation, or RPC modules", () => {
  const target = new URL("./receipt-view.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      if (/\\/agent-control\\/adapters\\/|\\/solana\\/rpc\\.ts$|\\/node_modules\\/(?:zod|@solana)\\//.test(resolved.url)) {
        throw new Error("Heavy dependency reached receipt display: " + resolved.url);
      }
      return resolved;
    }});
    const view = await import(${JSON.stringify(target)});
    if (typeof view.receiptExplorerLinks !== "function") throw new Error("Receipt display API missing");
  `], { encoding: "utf8", timeout: 20_000 });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
});

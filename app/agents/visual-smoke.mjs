// Run against a local Ryntra server:
// RYNTRA_VISUAL_BASE_URL=http://localhost:3017 node app/agents/visual-smoke.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.RYNTRA_VISUAL_BASE_URL ?? "http://localhost:3017";
const outputDir = process.env.RYNTRA_VISUAL_OUTPUT;
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];
const routeFilter = process.env.RYNTRA_VISUAL_ROUTE;
const routes = [
  { name: "products", path: "/" },
  { name: "workspace-switcher", path: "/app" },
  { name: "mission-control", path: "/agents/workspace" },
  { name: "action-passport-lab", path: "/agents/workspace/lab" },
  /* The three public Agent Control routes were the only surfaces this sweep
     skipped — including the strongest live one. The two workspace mounts of
     the same components are separate entries because they render in different
     chrome, and a defect in either chrome is invisible from the other. */
  { name: "agents-landing", path: "/agents" },
  { name: "agent-passport-public", path: "/agents/passport" },
  { name: "preview-verifier-public", path: "/agents/verify" },
  { name: "agent-passport-workspace", path: "/agents/workspace/passport" },
  { name: "preview-verifier-workspace", path: "/agents/workspace/verify" },
].filter((route) => !routeFilter || route.name === routeFilter);

assert.ok(routes.length > 0, `Unknown RYNTRA_VISUAL_ROUTE: ${routeFilter}`);

if (outputDir) await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const viewport of viewports) {
    for (const route of routes) {
      const page = await browser.newPage({ viewport });
      const consoleErrors = [];
      const pageErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));

      const response = await page.goto(new URL(route.path, baseUrl).href, {
        waitUntil: "domcontentloaded",
      });
      assert.equal(response?.status(), 200, `${viewport.name} ${route.path} must return 200`);
      await page.locator("main").waitFor({ state: "visible" });

      if (route.name === "products") {
        if (viewport.name === "desktop") {
          await page.getByRole("button", { name: "Products" }).click();
          await page.locator("#rx-products-popover").waitFor({ state: "visible" });
        } else {
          await page.getByRole("button", { name: "Open menu" }).click();
          await page.locator("#rx-sheet").waitFor({ state: "visible" });
        }
        for (const label of ["Ryntra Workspace", "Stellar", "Agent Control", "Solana"]) {
          assert.ok(await page.getByText(label, { exact: true }).first().isVisible(), `${label} must be visible`);
        }
      }

      if (route.name === "workspace-switcher") {
        await page.waitForTimeout(1_000);
        await page.getByRole("button", { name: /Switch workspace/ }).click();
        await page
          .getByRole("menu", { name: "Workspaces" })
          .getByText("Agent Control", { exact: true })
          .waitFor({ state: "visible" });
      }

      if (route.name === "mission-control") {
        assert.equal(await page.locator(".rx-header").count(), 0, "workspace must not render public chrome");
        assert.equal(await page.getByRole("heading", { name: "Mission Control", level: 1 }).count(), 1);
        await page
          .getByText("INTERACTIVE DEMO · SAMPLE DATA · NO FUNDS MOVE", { exact: true })
          .waitFor({ state: "visible" });
        const stale = page.getByRole("button", { name: /1 · Stale proposal/ });
        await stale.waitFor({ state: "visible" });
        await page.waitForFunction(() =>
          [...document.querySelectorAll("button")].some((button) =>
            button.textContent?.includes("Stale proposal") && button.getAttribute("aria-pressed") === "true",
          ),
        );
        assert.equal(await stale.getAttribute("aria-pressed"), "true");
        await page.getByText("Deterministic decision", { exact: true }).waitFor({ state: "visible" });
        assert.equal(
          await page.getByRole("list", { name: "Five-phase lifecycle summary" }).count(),
          1,
          "Simple must render the five-phase projection",
        );
        const authorizePhase = page
          .getByRole("list", { name: "Five-phase lifecycle summary" })
          .locator("li")
          .filter({ hasText: "Authorize" });
        assert.match(await authorizePhase.innerText(), /unavailable · External wallet/i);
        assert.doesNotMatch(await authorizePhase.innerText(), /\bYou\b/);
        assert.equal(
          await page.getByRole("heading", { name: "One Action Case through eight stages" }).count(),
          0,
          "Simple must not leak the Pro projection",
        );
        const controlGeometry = await page.locator(".acw-rwa-controls button").evaluateAll((buttons) =>
          buttons.map((button) => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          }),
        );
        assert.ok(
          controlGeometry.every(({ width, height }) => width >= 44 && height >= 44),
          `${viewport.name} sample controls must be at least 44px: ${JSON.stringify(controlGeometry)}`,
        );

        if (outputDir) {
          await page.screenshot({
            fullPage: true,
            path: path.join(outputDir, `mission-control-simple-${viewport.name}.png`),
          });
        }

        await page.getByRole("button", { name: /2 · Corrected action/ }).click();
        await page.getByRole("button", { name: /3 · Local review/ }).click();
        const selectedBeforeDepthSwitch = await page.evaluate(() =>
          window.sessionStorage.getItem("ryntra.agent-control.cases.v2"),
        );
        assert.ok(selectedBeforeDepthSwitch, "the reviewed Action Case must exist in the tab-local store");
        if (viewport.name === "mobile") {
          await page.getByRole("button", { name: "Open navigation" }).click();
        }
        await page.waitForTimeout(1_000);
        const proMode = page.getByRole("button", { name: "Pro", exact: true });
        await proMode.click();
        await page.waitForTimeout(300);
        assert.equal(
          await proMode.getAttribute("aria-pressed"),
          "true",
          `${viewport.name} must switch to Pro navigation`,
        );
        await page
          .getByRole("heading", { name: "One Action Case through eight stages" })
          .waitFor({ state: "visible" });
        const stageGeometry = await page.locator(".acw-stage").evaluateAll((stages) =>
          stages.map((stage) => ({ clientWidth: stage.clientWidth, scrollWidth: stage.scrollWidth })),
        );
        assert.ok(
          stageGeometry.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 1),
          `${viewport.name} lifecycle cells must not collide or overflow: ${JSON.stringify(stageGeometry)}`,
        );
        assert.equal(
          await page.getByRole("list", { name: "Five-phase lifecycle summary" }).count(),
          0,
          "Pro must replace rather than decorate the Simple projection",
        );
        assert.equal(
          await page.evaluate(() => window.sessionStorage.getItem("ryntra.agent-control.cases.v2")),
          selectedBeforeDepthSwitch,
          "Simple and Pro must preserve the exact selected Action Case",
        );
        if (viewport.name === "mobile") {
          await page.locator(".rs-navtoggle").click();
        }
      }

      if (route.name === "action-passport-lab") {
        assert.equal(await page.locator(".rx-header").count(), 0, "lab must stay inside workspace chrome");
        await page
          .getByRole("heading", { name: "Inspect the action boundary.", level: 1 })
          .waitFor({ state: "visible" });
        /* The hand-rolled eyebrow header was replaced by the shared
           WorkspacePageHeader: no eyebrow line, three boundary chips in the
           badge slot, and the "NO WALLET" chip retired for "NO SIGNER". */
        assert.equal(await page.getByText("Agent Control / Action Passport Lab", { exact: true }).count(), 0);
        assert.equal(await page.locator(".rs-page .ag-boundary-stack .ag-status").count(), 3);
        assert.equal(await page.getByText("NO WALLET", { exact: true }).count(), 0);
      }

      const geometry = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      assert.ok(
        geometry.scrollWidth <= geometry.clientWidth + 1,
        `${viewport.name} ${route.path} overflows: ${JSON.stringify(geometry)}`,
      );
      assert.deepEqual(consoleErrors, [], `${viewport.name} ${route.path} console errors`);
      assert.deepEqual(pageErrors, [], `${viewport.name} ${route.path} page errors`);

      if (outputDir) {
        await page.screenshot({
          fullPage: true,
          path: path.join(outputDir, `${route.name}-${viewport.name}.png`),
        });
      }

      results.push({ route: route.path, viewport: viewport.name, geometry });
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));

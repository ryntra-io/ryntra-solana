// Run against a local Ryntra server:
// RYNTRA_VISUAL_BASE_URL=http://localhost:3015 node app/developers/agent-control/visual-smoke.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.RYNTRA_VISUAL_BASE_URL ?? "http://localhost:3015";
const outputDir = process.env.RYNTRA_VISUAL_OUTPUT;
const route = new URL("/developers/agent-control", baseUrl);
const expectedOrigin = route.origin;
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

if (outputDir) await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    const pageErrors = [];
    const externalRequests = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      const requestUrl = new URL(request.url());
      if (requestUrl.protocol.startsWith("http") && requestUrl.origin !== expectedOrigin) {
        externalRequests.push(request.url());
      }
    });

    const response = await page.goto(route.href, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200, `${viewport.name} route must return HTTP 200`);
    await page.locator("h1").waitFor({ state: "visible" });

    const geometry = await page.evaluate(() => {
      const root = document.documentElement;
      const offenders = [...document.querySelectorAll("body *")]
        .filter((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          const intentionallyScrollable = ["auto", "scroll"].includes(style.overflowX);
          return !intentionallyScrollable && element.scrollWidth > element.clientWidth + 1;
        })
        .slice(0, 10)
        .map((element) => ({
          className: element.className,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          tag: element.tagName,
        }));

      return {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        offenders,
      };
    });

    assert.ok(
      geometry.scrollWidth <= geometry.clientWidth + 1,
      `${viewport.name} document overflows horizontally: ${JSON.stringify(geometry)}`,
    );
    assert.deepEqual(consoleErrors, [], `${viewport.name} console errors`);
    assert.deepEqual(pageErrors, [], `${viewport.name} page errors`);
    assert.deepEqual(externalRequests, [], `${viewport.name} page must not auto-request external origins`);

    const accessibility = await page.evaluate(() => {
      const links = [...document.querySelectorAll("a[href]")];
      const buttons = [...document.querySelectorAll("button")];
      return {
        mainCount: document.querySelectorAll("main").length,
        h1Count: document.querySelectorAll("h1").length,
        unnamedLinks: links.filter((link) => !(
          link.getAttribute("aria-label") ?? link.textContent ?? ""
        ).trim()).length,
        unnamedButtons: buttons.filter((button) => !(
          button.getAttribute("aria-label") ?? button.textContent ?? ""
        ).trim()).length,
        capabilityRegion: document.querySelectorAll('[role="region"][aria-label="Agent Control capability matrix"]').length,
        stateText: document.body.innerText,
      };
    });
    assert.equal(accessibility.mainCount, 1, `${viewport.name} must have one main landmark`);
    assert.equal(accessibility.h1Count, 1, `${viewport.name} must have one h1`);
    assert.equal(accessibility.unnamedLinks, 0, `${viewport.name} links need accessible text`);
    assert.equal(accessibility.unnamedButtons, 0, `${viewport.name} buttons need accessible names`);
    assert.equal(accessibility.capabilityRegion, 1, `${viewport.name} matrix needs a labelled region`);
    for (const state of ["ZERO_STATE", "NOT_FOUND", "stale or unavailable", "UPSTREAM_FAILURE"]) {
      assert.match(accessibility.stateText, new RegExp(state), `${viewport.name} must expose ${state}`);
    }

    await page.keyboard.press("Tab");
    const keyboardFocus = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return null;
      const style = getComputedStyle(active);
      return {
        tag: active.tagName,
        name: (active.getAttribute("aria-label") ?? active.textContent ?? "").trim(),
        visible: active.getBoundingClientRect().width > 0 && active.getBoundingClientRect().height > 0,
        focusIndicator: style.outlineStyle !== "none" || style.boxShadow !== "none",
      };
    });
    assert.ok(keyboardFocus, `${viewport.name} must expose keyboard focus`);
    assert.ok(["A", "BUTTON"].includes(keyboardFocus.tag), `${viewport.name} first focus target must be operable`);
    assert.ok(keyboardFocus.name.length > 0, `${viewport.name} focus target needs a name`);
    assert.equal(keyboardFocus.visible, true, `${viewport.name} focus target must be visible`);
    assert.equal(keyboardFocus.focusIndicator, true, `${viewport.name} focus indicator must be visible`);

    if (outputDir) {
      await page.screenshot({
        fullPage: true,
        path: path.join(outputDir, `agent-control-${viewport.name}.png`),
      });
    }

    results.push({
      viewport,
      geometry,
      consoleErrors,
      pageErrors,
      externalRequests,
      accessibility,
      keyboardFocus,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));

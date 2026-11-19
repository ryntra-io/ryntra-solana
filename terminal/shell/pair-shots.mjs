// Two screens side by side in one picture.
//
//   node terminal/shell/pair-shots.mjs <dir> <left.jpg> <right.jpg> <out.jpg>
//
// Reads two shots of the same size from <dir> and writes them next to each other, a thin line between, into <dir>/<out>.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [dir, left, right, out] = process.argv.slice(2);
if (!out) throw new Error("usage: pair-shots.mjs <dir> <left.jpg> <right.jpg> <out.jpg>");
const data = (name) => `data:image/jpeg;base64,${readFileSync(path.join(dir, name)).toString("base64")}`;

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.setContent(`<!doctype html><body style="margin:0;background:#2a1640;display:flex;gap:6px;width:max-content"><img id="a" style="flex:none" src="${data(left)}"><img id="b" style="flex:none" src="${data(right)}"></body>`);
await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
const size = await page.evaluate(() => ({ width: [...document.images].reduce((sum, img) => sum + img.naturalWidth, 6), height: Math.max(...[...document.images].map((img) => img.naturalHeight)) }));
await page.setViewportSize(size);
await page.screenshot({ path: path.join(dir, out), type: "jpeg", quality: 80, fullPage: true });
await browser.close();
console.log(out, size);

// CITY-149 — the reached stop's note as it reaches people, for review: the Telegram message (the phone's way today —
// the 1.18 app is the city in a WebView, with no push of its own) and the browser's notification on a computer, at
// 390×844 and 1440×900 → <out>/note-<kind>-<size>-<lang>.jpg
//   node lib/stops/note-shots.mjs [out]
// The words are the engine's own — `stopNoteText`, the Telegram text and button `deliverOutbox` sends — rendered on a
// plain stand-in of each surface; nothing is sent anywhere.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { stopNoteText, stopTelegramText } from "./notes.ts";

const out = path.resolve(process.argv[2] ?? "out/stop-note-shots");
mkdirSync(out, { recursive: true });

const stop = { id: "stp_7f3a9c0e5b1d2a4c6e8f", side: "sell", base: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, name: "Solana" }, quote: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 }, price: "171.40" };
const esc = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const page = (body, width) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;font-family:Inter,"Segoe UI",Roboto,system-ui,sans-serif;background:#0b0f14;color:#e9eef3;width:${width}px}
  .tg{background:#0e1621;min-height:100vh;padding:20px 12px}
  .tg .bar{display:flex;align-items:center;gap:10px;padding:8px 6px 18px;border-bottom:1px solid #1c2733;margin-bottom:18px}
  .tg .ava{width:38px;height:38px;border-radius:50%;background:#FF681C;color:#0b0f14;font-weight:700;display:grid;place-items:center}
  .tg .name{font-weight:600}.tg .sub{font-size:12px;color:#7d8b99}
  .msg{background:#182533;border-radius:14px 14px 14px 4px;padding:10px 12px 8px;max-width:340px;white-space:pre-wrap;line-height:1.38;font-size:15px}
  .msg a{color:#6ab2f2;text-decoration:none;word-break:break-all}.msg .t{font-size:11px;color:#6d7f8f;text-align:right;margin-top:4px}
  .btn{max-width:340px;margin-top:4px;background:#1f2f3f;border-radius:8px;text-align:center;padding:10px;font-size:14px;color:#e9eef3}
  .desk{background:radial-gradient(1200px 700px at 30% 20%,#1a2230,#07090c);height:100vh;position:relative}
  .toast{position:absolute;right:18px;bottom:60px;width:364px;background:#202327;border:1px solid #2d3136;border-radius:10px;padding:14px;box-shadow:0 10px 40px rgba(0,0,0,.5);display:flex;gap:12px}
  .toast .ic{width:40px;height:40px;border-radius:8px;background:#FF681C;flex:none;display:grid;place-items:center;color:#0b0f14;font-weight:800}
  .toast .app{font-size:12px;color:#9aa3ad;margin-bottom:4px}.toast .ti{font-weight:600;font-size:14px;margin-bottom:3px}.toast .bo{font-size:13px;color:#c9d0d7;line-height:1.35}
</style></head><body>${body}</body></html>`;

const telegram = (lang) => {
  const w = stopNoteText(stop, lang);
  const text = esc(stopTelegramText({ title: w.title, reason: w.reason }));
  return `<div class="tg"><div class="bar"><div class="ava">R</div><div><div class="name">Ryntra</div><div class="sub">bot</div></div></div>
    <div class="msg">${text}<div class="t">14:02</div></div><div class="btn">${esc(w.cta)}</div></div>`;
};
const desk = (lang) => {
  const w = stopNoteText(stop, lang);
  return `<div class="desk"><div class="toast"><div class="ic">R</div><div><div class="app">ryntra.io</div><div class="ti">${esc(w.title)}</div><div class="bo">${esc(w.reason)}</div></div></div></div>`;
};

const browser = await chromium.launch({ executablePath: process.env.PRESS_CHROME || undefined });
for (const lang of ["uk", "en"]) {
  for (const size of [{ name: "phone", width: 390, height: 844, scale: 2, html: telegram, kind: "telegram" }, { name: "laptop", width: 1440, height: 900, scale: 1, html: desk, kind: "browser" }, { name: "laptop", width: 1440, height: 900, scale: 1, html: telegram, kind: "telegram" }]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale });
    const tab = await context.newPage();
    await tab.setContent(page(size.html(lang), size.width));
    const file = path.join(out, `note-${size.kind}-${size.name}-${lang}.jpg`);
    await tab.screenshot({ path: file, type: "jpeg", quality: 85 });
    console.log(`  ${path.basename(file)}`);
    await context.close();
  }
}
await browser.close();

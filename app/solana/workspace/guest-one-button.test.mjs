// B14 «Гість без гаманця — одна кнопка» (the B13 review's items 1 and 11): a guest meets one working action on every
// page — «Підключити гаманець», which opens the header's wallet panel, or «Відкрити в Phantom» on a phone with no
// wallet — and the app's Ukrainian speaks with one verb and «ти». The click itself is proven in a browser without a
// wallet extension by `docs/shots/b14/capture.mjs`; these tests hold the code to it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

/* The money forms and the gate. Each reaches a wallet only through the one hook or the one button. */
const FORMS = [
  "app/solana/workspace/trade/swap-card.tsx",
  "app/solana/workspace/send/send-card.tsx",
  "app/solana/workspace/bridge/bridge-surface.tsx",
  "app/solana/workspace/bridge/cross-swap-engine.tsx",
  "app/solana/workspace/spot/spot-ticket.tsx",
];

test("no form picks a wallet itself or calls connect with nothing to connect", () => {
  for (const path of FORMS) {
    const source = read(path);
    assert.doesNotMatch(source, /\bconnect\((wallets|undefined|\))/, `${path}: connect() with no choice made`);
    assert.doesNotMatch(source, /wallets\[0\]\?\.name/, `${path}: the detector's first wallet taken as a decision`);
    assert.doesNotMatch(source, /<WalletConnectRow\b/, `${path}: the old in-form wallet tiles`);
    assert.match(source, /useWalletReach\(\)|<ConnectWalletButton\b/, `${path}: the one way to a wallet`);
  }
});

test("the one button opens the header's panel, or this page inside Phantom on a phone with no wallet", () => {
  const reach = read("app/solana/workspace/wallet-reach.ts");
  assert.match(reach, /openInWallet = phone && settled && !connection && wallets\.length === 0/);
  assert.match(reach, /phantomBrowseUrl\(window\.location\.href, window\.location\.origin\)/);
  assert.match(reach, /openSolanaConnection\(\)/);
  assert.doesNotMatch(reach, /\bconnect\(/, "the hook never connects by itself: the panel does, on the person's choice");

  const gate = read("app/solana/workspace/wallet-gate.tsx");
  assert.match(gate, /import \{ Button, EmptyState \} from "@ryntra\/core\/ui"/, "the core's EmptyState and Button");
  assert.match(gate, /onClick=\{\(\) => reachAfter\(before, reach\)\}/);
  assert.match(gate, /openInWallet \? text\("Open in Phantom"\) : text\("Connect wallet"\)/);
  assert.match(gate, /<EmptyState icon="wallet" text=\{title\} action=\{<ConnectWalletButton \/>\}/, "one sentence, one button");

  /* The old re-export keeps every caller on the same hook. */
  assert.match(read("app/app/invest/use-wallet-reach.ts"), /export \{ useWalletReach \} from "@\/app\/solana\/workspace\/wallet-reach"/);
});

test("the phone's ticket sheet steps aside before the header's panel opens, so the press is never hidden under it", () => {
  const reach = read("app/solana/workspace/wallet-reach.ts");
  assert.match(reach, /before\(\);\s*window\.requestAnimationFrame\(\(\) => window\.requestAnimationFrame\(reach\)\)/);
  const ticket = read("app/solana/workspace/spot/spot-ticket.tsx");
  assert.match(ticket, /onConnect=\{\(\) => reachAfter\(onBeforeConnect, reach\)\}/);
  assert.match(ticket, /<ConnectWalletButton block before=\{onBeforeConnect\} \/>/);
  const workspace = read("app/solana/workspace/spot/spot-workspace.tsx");
  assert.match(workspace, /onBeforeConnect=\{\(\) => \{\s*tradeOpener\.current = null;\s*setTradeOpen\(false\);/);
});

test("the header's panel without a wallet: three wallets and the way back on a computer, a wallet's browser on a phone", () => {
  const source = read("app/solana/workspace/connection.tsx");
  for (const words of ['text("Install Phantom")', 'text("Install Solflare")', 'text("Install Backpack")', 'text("Installed already? Reload the page")', 'text("Open in Phantom")', 'text("Open in Solflare")']) {
    assert.ok(source.includes(words), words);
  }
  assert.match(source, /window\.location\.reload\(\)/);
});

test("the button's words are one verb in Ukrainian", async () => {
  const { SOLANA_UK_TEXT } = await import("./i18n/catalog.ts");
  assert.equal(SOLANA_UK_TEXT["Connect wallet"], "Підключити гаманець");
  assert.equal(SOLANA_UK_TEXT["Open in Phantom"], "Відкрити в Phantom");
  for (const key of ["Connect a wallet — your assets and positions will be here.", "Connect a wallet — your transfers will be here, and where each one is.", "Connect a wallet — the receipts of your transfers will be here.", "Connect a wallet — your address and requests for an exact amount will be here."]) {
    assert.match(SOLANA_UK_TEXT[key], /^Підключи гаманець — тут будуть /, key);
  }
});

/* Line A's own copy: the Solana workspace, the app's pages and the site (other lines' paths stay theirs). */
const ROOTS = ["app/solana/workspace", "app/app", "app/shell", "lib/solana", "lib/site", "app/docs", "app/security", "app/seo.ts"];
const OTHER_LINES = /app[\\/]solana[\\/]workspace[\\/]rewards|app[\\/]app[\\/](rewards|ryn|lens|predictions)[\\/]/;
/* The formal «Ви» and its verbs, and every other wording of the connect act. */
const FORMAL = /(?<![\p{L}'’])(Ви|Вас|Вам|Вами|Ваш\p{L}*|ви|вас|вам|вами|ваш\p{L}*)(?![\p{L}'’])|\p{L}+(іть|йте|ьте)(?![\p{L}])|\p{L}+(єте|ете|ите|їте)(?![\p{L}])|Під['’]єдна\p{L}*|Підключіть/gu;
/* Words that only look like a formal verb, and two short Russian lines the alphabet test cannot tell from Ukrainian
   («доступ к бете», «Повторите импорт»). */
const NOT_FORMAL = new Set(["навіть", "відкрите", "покрите", "Відкрите", "Покрите", "бете", "Повторите"]);
const LITERAL = /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g;

function files(path) {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = join(full, entry.name);
    if (entry.isDirectory()) return files(relative(ROOT, child));
    return /\.(ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

test("the app's Ukrainian says «ти» and one connect verb — no «Ви», «Ваш», «-іть / -йте», «Під'єднати», «Підключіть»", () => {
  const found = [];
  for (const root of ROOTS) {
    for (const file of files(root)) {
      if (OTHER_LINES.test(file)) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const literal of line.match(LITERAL) ?? []) {
          /* Ukrainian only: Russian copy keeps its own grammar. A Russian line has ы, э, ъ or ё, or — a long one — none of
             і, ї, є, ґ and the apostrophe. */
          if (!/[а-яіїєґ]/i.test(literal) || /[ыэъё]/i.test(literal)) continue;
          if (!/[іїєґ'’ʼ]/i.test(literal) && literal.trim().split(/\s+/).length > 4) continue;
          for (const match of literal.matchAll(FORMAL)) {
            if (NOT_FORMAL.has(match[0])) continue;
            found.push(`${relative(ROOT, file)}:${index + 1} «${match[0]}»`);
          }
        }
      });
    }
  }
  assert.deepEqual(found, [], `formal or stray connect wording:\n${found.slice(0, 40).join("\n")}`);
});

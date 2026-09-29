import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const SURFACES = [
  "app/solana/workspace/page.tsx",
  "app/solana/workspace/assets/page.tsx",
  "app/solana/workspace/swap/page.tsx",
  "app/solana/workspace/trade/swap-card.tsx",
  "app/solana/workspace/bridge/bridge-card.tsx",
  "app/solana/workspace/send/page.tsx",
  "app/solana/workspace/send/send-card.tsx",
  "app/solana/workspace/connection.tsx",
  "app/solana/workspace/receipts/page.tsx",
  "app/solana/workspace/receipts/local-receipts.tsx",
  "app/solana/workspace/settings/page.tsx",
  "app/solana/workspace/developers/page.tsx",
  "app/solana/workspace/map/page.tsx",
  "app/solana/workspace/hub/shell.tsx",
  "app/solana/workspace/hub/parts.tsx",
];

const VISIBLE_ATTRIBUTES = new Set(["aria-label", "badge", "label", "placeholder", "title"]);

function isTranslateNo(node) {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (!ts.isJsxElement(cursor)) continue;
    const found = cursor.openingElement.attributes.properties.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText() === "translate" &&
        attribute.initializer?.getText() === '"no"',
    );
    if (found) return true;
  }
  return false;
}

function normalized(value) {
  return value.replace(/\s+/g, " ").trim();
}

function isTechnical(value) {
  const text = normalized(value);
  if (!/[A-Za-z]/.test(text)) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return true;
  return /^(?:bps|bps ·|bps\) ·|lamports|slot|ms|Z|explorer\.solana\.com|SOL|USDC|USD|SPL|Token-2022|JSON-RPC|Solana mainnet JSON-RPC ·|· native USDC|0 USDC|20 USD ·|RYN-SOL-[A-Z0-9-]+(?: ·)?|M0[A-G]|M[1-9]|ryntra-io\/ryntra-solana-evidence)$/i.test(text);
}

function isPageHeadTitle(node) {
  if (!ts.isJsxAttribute(node) || node.name.getText() !== "title") return false;
  const opening = node.parent?.parent;
  return (ts.isJsxOpeningElement(opening) || ts.isJsxSelfClosingElement(opening)) && opening.tagName.getText() === "PageHead";
}

function visibleExpressionStrings(expression) {
  if (!expression) return [];
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) {
    return visibleExpressionStrings(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return [...visibleExpressionStrings(expression.whenTrue), ...visibleExpressionStrings(expression.whenFalse)];
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.PlusToken || operator === ts.SyntaxKind.AmpersandAmpersandToken || operator === ts.SyntaxKind.BarBarToken) {
      return [...visibleExpressionStrings(expression.left), ...visibleExpressionStrings(expression.right)];
    }
  }
  if (ts.isTemplateExpression(expression)) {
    return [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)];
  }
  return [];
}

function unlocalized(path) {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const failures = [];

  function record(node, value, kind) {
    const text = normalized(value);
    if (!text || isTechnical(text) || isTranslateNo(node) || isPageHeadTitle(node)) return;
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    failures.push(`${path}:${line} ${kind}: ${JSON.stringify(text)}`);
  }

  function visit(node) {
    if (ts.isJsxText(node)) record(node, node.text, "text");
    if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.getText()) && ts.isStringLiteral(node.initializer)) {
      record(node, node.initializer.text, node.name.getText());
    }
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) {
      for (const value of visibleExpressionStrings(node.expression)) record(node, value, "expression");
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return failures;
}

test("every M0-touched Solana surface routes user copy through the EN/UA boundary", () => {
  const failures = SURFACES.flatMap(unlocalized);
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("locale helpers are fail-closed and cover bounded dynamic validation", async () => {
  const source = readFileSync("app/solana/workspace/i18n/catalog.ts", "utf8");
  assert.match(source, /Missing Ukrainian Solana translation/);
  assert.match(source, /translateSolanaMeaning/);
  assert.match(source, /translateSolanaRuntime/);
  assert.match(source, /32 to 44 base58 characters/);
  assert.match(source, /rounding silently would change the amount/);
});

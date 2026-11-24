// The Portfolio — «Everything in Solana» — for the eyes, at 1440×900, 1920×1080 and 390×844, in English and Ukrainian
//   → <out>/<state>-<size>-<lang>.jpg
//   node terminal/portfolio/shots.mjs [out] [baseUrl] [source]
// A stand built with the terminal open and the money, Earn and agent switches as production has them (next build, then
// next start). The system Chrome draws the page (PRESS_CHROME may point at another). SIZES=desk,wide,phone, LANGS=en,uk
// and ONLY=<shot,shot> narrow a run.
//
// The market, its prices and the coins' logos are the engine's own, read from `source` (ryntra.io by default). What only
// a wallet has answers from fixtures shaped like the engine's routes, priced at the market's live prices: the portfolio
// (`/api/v1/portfolio`, the model of `lib/portfolio/model.ts`), the pool positions' ranges (`/api/liquidity/positions`),
// what a clean takes (`/api/v1/wallet/clean`), the agents, the history. The exit's door and its Review answer in the
// form the screen reads (`./exit-view.ts`): the Review carries real unsigned version-0 transactions built here for the
// stand's wallet. The stand wallet connects and never signs: its request to sign is recorded, compared with the Review's
// bytes, and left waiting. A submit asked for would be counted, and is answered 503.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createBurnInstruction, createCloseAccountInstruction } from "@solana/spl-token";

const out = path.resolve(process.argv[2] ?? "docs/shots/city-272");
const base = process.argv[3] ?? "http://localhost:3172";
const source = process.argv[4] ?? "https://ryntra.io";
mkdirSync(out, { recursive: true });

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const JITO = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const MSOL = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const POPCAT = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const RAY = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";
/** The stand's own wallet, and the one it looks at by its address. */
const OWNER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const seeded = (n) => Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey.toBase58();
const WATCHED = seeded(90);
const MEOW = seeded(41);
const LITTER = seeded(42);
const GIGA = seeded(48);
const RENT = 2_039_280;

const chrome = process.env.PRESS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: chrome, args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"] });
const SIZES = [
  { name: "desk", width: 1440, height: 900, mobile: false },
  { name: "wide", width: 1920, height: 1080, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
].filter((size) => !process.env.SIZES || process.env.SIZES.split(",").includes(size.name));
const LANGS = (process.env.LANGS ?? "en,uk").split(",");
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const report = [];
const corners = [];
/** The shapes one form allows: square, the cut, 4 px on what is pressed, circles («pill» — a logo, a dot, a switch). */
const FORM = new Set(["square", "cut", "r4", "pill"]);

/** Every visible box with a frame or a fill, and its shape — as the wave's live measure takes it. Runs in the page. */
function measure() {
  const boxes = [];
  const clear = /rgba\(0, 0, 0, 0\)|transparent/;
  for (const el of document.querySelectorAll("main *, [role='dialog'] *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 22) continue;
    if (r.bottom < 0 || r.top > innerHeight * 3 || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const sides = ["Top", "Right", "Bottom", "Left"].filter((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none" && !clear.test(cs[`border${s}Color`]));
    const framed = sides.length >= 3;
    const filled = !clear.test(cs.backgroundColor) || cs.backgroundImage !== "none";
    if (!framed && !filled) continue;
    const px = parseFloat(cs.borderTopLeftRadius) || 0;
    const half = Math.min(r.width, r.height) / 2;
    const cut = cs.clipPath && cs.clipPath !== "none";
    const shape = cut ? "cut" : px === 0 ? "square" : px >= half - 0.5 ? "pill" : `r${Math.round(px)}`;
    const cls = String(el.className?.baseVal ?? el.className ?? "").split(" ")[0].replace(/__[A-Za-z0-9_-]{4,}$/, "").slice(0, 36);
    boxes.push({ shape, cls, w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 28) });
  }
  return boxes;
}

/* ── the live market: the prices everything is worth today ── */
const market = await fetch(`${source}/api/city`).then((res) => res.json()).catch(() => null);
const towers = market?.towers ?? [];
const tower = (mint) => towers.find((entry) => entry.id === mint) ?? null;
const priceOf = (mint, fallback) => tower(mint)?.price ?? fallback;
const solUsd = priceOf(SOL, 150);
report.push(`market read: ${towers.length} coins; SOL $${solUsd}`);

/* ── the portfolio, as `GET /api/v1/portfolio` answers ── */
const NO_REFS = { program: null, pool: null, position: null, nftMint: null, market: null, account: null };
const whole = (how) => ({ oneStep: true, how, reason: null, partBps: 10_000, untilEpoch: null, untilTime: null });
const blocked = (how, reason, extra = {}) => ({ oneStep: false, how, reason, partBps: 0, untilEpoch: null, untilTime: null, ...extra });
const usd4 = (value) => Math.round(value * 10_000) / 10_000;
const sol9 = (usd) => Math.round((usd / solUsd) * 1e9) / 1e9;
const raw = (units, decimals) => String(Math.round(units * 10 ** decimals));
const token = (mint, symbol, decimals, units, price, role = "held") => ({ mint, symbol, decimals, amountRaw: raw(units, decimals), usd: price === null ? null : usd4(units * price), role });
const row = (over, at) => ({ platform: null, state: "read", origin: "chain", label: null, earned: null, inRange: null, refs: NO_REFS, readAt: at, ...over });
const worth = (tokens) => tokens.reduce((sum, t) => sum + (t.role === "held" || t.role === "supplied" ? (t.usd ?? 0) : t.role === "borrowed" ? -(t.usd ?? 0) : (t.usd ?? 0)), 0);
const fees = (tokens) => tokens.filter((t) => t.role === "fee" || t.role === "reward").reduce((sum, t) => sum + (t.usd ?? 0), 0);
const value = (usd) => ({ usd: usd4(usd), sol: sol9(usd) });

const POS = { solUsdc: seeded(60), jupSol: seeded(61), bonkSol: seeded(62), stakeA: seeded(63), stakeB: seeded(64), kamino: seeded(65) };
/** A wallet's long tail of dust (QA 19.11, eyes 26): sixteen coins of a few cents, so the opened group shows «N more». */
const TINY = Array.from({ length: 16 }, (_, at) => ({ mint: seeded(120 + at), symbol: `DUST${at + 1}`, usd: Math.round((0.04 + at * 0.11) * 100) / 100 }));
const jupUsd = priceOf(JUP, 0.27);
const bonkUsd = priceOf(BONK, 0.0000094);
const jitoUsd = priceOf(JITO, solUsd * 1.24);

function portfolio(owner) {
  const at = new Date().toISOString();
  const pool = (id, protocol, label, tokens, inRange, exit, position) => row({ id: `${protocol}:${id}`, protocol, kind: "pool", label, value: value(worth(tokens)), earned: fees(tokens) > 0 ? value(fees(tokens)) : null, tokens, inRange, exit, refs: { ...NO_REFS, program: seeded(70), pool: seeded(71 + position), position: id } }, at);
  const coin = (mint, symbol, decimals, units, price, over = {}) => {
    const tokens = [token(mint, symbol, decimals, units, price)];
    return row({ id: `wallet:${mint}`, protocol: "wallet", kind: "coin", label: symbol, value: price === null ? { usd: null, sol: null } : value(units * price), tokens, exit: whole("swap"), refs: { ...NO_REFS, program: TOKEN, account: seeded(80) }, ...over }, at);
  };
  const positions = [
    pool(POS.solUsdc, "meteora-dlmm", "SOL–USDC", [token(SOL, "SOL", 9, 41.2, solUsd), token(USDC, "USDC", 6, 6_120, 1), token(SOL, "SOL", 9, 0.52, solUsd, "fee"), token(USDC, "USDC", 6, 46.3, 1, "fee")], true, whole("pool-withdraw"), 0),
    pool(POS.jupSol, "meteora-dlmm", "JUP–SOL", [token(JUP, "JUP", 6, 9_400, jupUsd), token(SOL, "SOL", 9, 0, solUsd), token(JUP, "JUP", 6, 31, jupUsd, "fee")], false, whole("pool-withdraw"), 1),
    pool(POS.bonkSol, "meteora-damm-v2", "BONK–SOL", [token(BONK, "BONK", 5, 61_000_000, bonkUsd), token(SOL, "SOL", 9, 3.9, solUsd), token(SOL, "SOL", 9, 0.011, solUsd, "fee")], true, blocked("pool-withdraw", "LOCKED", { partBps: 6_000 }), 2),
    coin(JITO, "JitoSOL", 9, 10.4, jitoUsd, { kind: "lst" }),
    row({ id: `native-stake:${POS.stakeA}`, protocol: "native-stake", kind: "stake", label: "SOL", value: value(5 * solUsd), tokens: [token(SOL, "SOL", 9, 5, solUsd)], exit: blocked("stake-deactivate", "STAKE_ACTIVE", { untilEpoch: 913 }), refs: { ...NO_REFS, position: POS.stakeA } }, at),
    row({ id: `native-stake:${POS.stakeB}`, protocol: "native-stake", kind: "stake", label: "SOL", value: value(1.25 * solUsd), tokens: [token(SOL, "SOL", 9, 1.25, solUsd)], exit: blocked("stake-withdraw", "STAKE_COOLING", { untilEpoch: 913 }), refs: { ...NO_REFS, position: POS.stakeB } }, at),
    row({ id: `jupiter-lend:${USDC}`, protocol: "jupiter-lend", kind: "deposit", label: "USDC", value: value(2_012.4), earned: value(12.4), tokens: [token(USDC, "USDC", 6, 2_012.4, 1, "supplied")], exit: whole("lend-withdraw"), refs: { ...NO_REFS, market: USDC } }, at),
    row({ id: `kamino:${POS.kamino}:deposit`, protocol: "kamino", origin: "provider", kind: "deposit", label: "SOL", value: value(20 * solUsd), tokens: [{ mint: SOL, symbol: "SOL", decimals: null, amountRaw: null, usd: usd4(20 * solUsd), role: "supplied" }], exit: blocked("lend-withdraw", "DEBT"), refs: { ...NO_REFS, position: POS.kamino } }, at),
    row({ id: `kamino:${POS.kamino}:borrow`, protocol: "kamino", origin: "provider", kind: "borrow", label: "USDC", value: { usd: -1_200, sol: -sol9(1_200) }, tokens: [{ mint: USDC, symbol: "USDC", decimals: null, amountRaw: null, usd: 1_200, role: "borrowed" }], exit: blocked("repay", "REPAY"), refs: { ...NO_REFS, position: POS.kamino } }, at),
    row({ id: "other:orca:1", protocol: "other", platform: "orca-whirlpools", origin: "projection", kind: "pool", label: "SOL–mSOL", value: { usd: 412.6, sol: null }, tokens: [{ mint: SOL, symbol: "SOL", decimals: null, amountRaw: null, usd: 206.3, role: "held" }, { mint: MSOL, symbol: "mSOL", decimals: null, amountRaw: null, usd: 206.3, role: "held" }], exit: blocked("none", "PROJECTION") }, at),
    row({ id: "wallet:sol", protocol: "wallet", kind: "coin", label: "SOL", value: value(1.5 * solUsd), tokens: [token(SOL, "SOL", 9, 1.5, solUsd)], exit: whole("swap"), refs: { ...NO_REFS, program: "11111111111111111111111111111111" } }, at),
    coin(USDC, "USDC", 6, 250, 1),
    coin(JUP, "JUP", 6, 135.6, jupUsd),
    coin(GIGA, "GIGAX", 6, 52_000, 0.00035),
    coin(WIF, "WIF", 6, 2.1 / priceOf(WIF, 0.8), priceOf(WIF, 0.8)),
    coin(POPCAT, "POPCAT", 9, 0.85 / priceOf(POPCAT, 0.2), priceOf(POPCAT, 0.2)),
    coin(MEOW, "MEOWX", 6, 4_200, 0.0000952),
    coin(LITTER, "FREE-SOL", 6, 1_000_000, null),
    ...TINY.map((tiny) => coin(tiny.mint, tiny.symbol, 6, 1_000, tiny.usd / 1_000)),
  ];
  const own = positions.filter((p) => p.origin !== "projection");
  const usd = own.reduce((sum, p) => sum + (p.value.usd ?? 0), 0);
  const earnedUsd = own.reduce((sum, p) => sum + (p.earned?.usd ?? 0), 0);
  const source_ = (name, n) => ({ source: name, state: "read", reason: null, readAt: at, positions: n });
  return {
    network: "solana:mainnet",
    owner,
    at,
    solUsd,
    totals: { usd: usd4(usd), sol: sol9(usd), earnedUsd: usd4(earnedUsd), projectedUsd: 412.6, complete: false },
    positions: [...positions].sort((a, b) => Math.abs(b.value.usd ?? -1) - Math.abs(a.value.usd ?? -1)),
    sources: [source_("wallet", 9), source_("native-stake", 2), source_("meteora-dlmm", 2), source_("meteora-damm-v2", 1), { source: "meteora-dlmm-pro", state: "off", reason: "CLOSED", readAt: null, positions: 0 }, source_("jupiter-lend", 1), source_("kamino", 2), source_("jupiter-portfolio", 1)],
  };
}

/** The pool positions as the Earn screen's read states them: the range's bounds, by the position's address. */
const liquidity = (owner) => {
  const view = (address, name, lower, upper, price, state) => ({ kind: "dlmm", address, pool: seeded(71), name, x: { mint: SOL, symbol: "SOL", amount: 0, unclaimed: 0, priceUsd: solUsd }, y: { mint: USDC, symbol: "USDC", amount: 0, unclaimed: 0, priceUsd: 1 }, rangeState: state, lower, upper, price, valueUsd: null, unclaimedUsd: null, lockedBps: 0, feesElsewhere: false, hasRewards: false, slot: 1, at: Date.now(), pricesAt: null });
  return { owner, positions: [view(POS.solUsdc, "SOL-USDC", solUsd * 0.94, solUsd * 1.06, solUsd, "in_range"), view(POS.jupSol, "JUP-SOL", (jupUsd / solUsd) * 1.08, (jupUsd / solUsd) * 1.3, jupUsd / solUsd, "out_of_range")], venues: { dlmm: { ok: true }, "damm-v2": { ok: true } }, at: Date.now() };
};

/* ── the engine's read of what a clean takes ── */
const item = (over) => ({ program: TOKEN, name: null, icon: null, decimals: 6, lamports: RENT, risk: [], picked: true, ...over });
const EMPTY_MINTS = [BONK, RAY, seeded(43), seeded(44), seeded(45), seeded(46)];
const cleanRead = (owner, canClean = true) => ({
  owner,
  items: [
    item({ account: seeded(1), mint: SOL, kind: "wrapped", symbol: "SOL", icon: `/api/icon/${SOL}`, amountRaw: "12000000", decimals: 9, valueUsd: null, lamports: RENT + 12_000_000 }),
    item({ account: seeded(2), mint: WIF, kind: "small", symbol: "WIF", name: "dogwifhat", icon: `/api/icon/${WIF}`, amountRaw: "2600000", valueUsd: 2.1 }),
    item({ account: seeded(3), mint: POPCAT, kind: "small", symbol: "POPCAT", name: "Popcat", icon: `/api/icon/${POPCAT}`, amountRaw: "4200000000", decimals: 9, valueUsd: 0.85 }),
    item({ account: seeded(4), mint: MEOW, kind: "small", symbol: "MEOWX", name: "Meow X", amountRaw: "4200000000", valueUsd: 0.4, risk: ["unverified", "freeze", "thin"], picked: false }),
    item({ account: seeded(5), mint: LITTER, kind: "litter", symbol: "FREE-SOL", amountRaw: "1000000000000", valueUsd: null, risk: ["unverified", "mint"], picked: false }),
    ...EMPTY_MINTS.map((mint, at) => item({ account: seeded(10 + at), mint, kind: "empty", symbol: ["BONK", "RAY", "GIGA", "MOODENG", "CHILLGUY", "PNUT"][at], icon: at < 2 ? `/api/icon/${mint}` : null, amountRaw: "0", valueUsd: 0 })),
    ...TINY.map((tiny, at) => item({ account: seeded(140 + at), mint: tiny.mint, kind: "small", symbol: tiny.symbol, amountRaw: "1000000000", valueUsd: tiny.usd })),
  ],
  risky: [
    { mint: MEOW, risk: ["unverified", "freeze", "thin"] },
    { mint: LITTER, risk: ["unverified", "mint"] },
    { mint: GIGA, risk: ["unverified", "thin"] },
  ],
  backLamports: RENT * 9 + 12_000_000,
  smallUsd: 2.95,
  solUsd,
  priced: true,
  canClean,
  at: new Date().toISOString(),
});

/* ── real unsigned version-0 transactions for the stand's wallet ── */
const owner = new PublicKey(OWNER);
const blockhash = Keypair.generate().publicKey.toBase58();
const wire = (instructions) => Buffer.from(new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }), ...instructions] }).compileToV0Message()).serialize()).toString("base64");
const close = (account) => createCloseAccountInstruction(new PublicKey(account), owner, owner, [], new PublicKey(TOKEN));
const burn = (n) => createBurnInstruction(new PublicKey(seeded(20 + n)), new PublicKey(WIF), owner, 1n, [], new PublicKey(TOKEN));

function cleanReview(add) {
  const withMeow = add.includes(seeded(4));
  const swaps = withMeow ? 3 : 2;
  const swapLamports = Math.round(((2.1 + 0.85 + (withMeow ? 0.4 : 0)) / solUsd) * 0.99 * 1e9);
  const rent = RENT * (7 + swaps) + 12_000_000;
  return {
    owner: OWNER,
    ticket: `stand.${"x".repeat(60)}`,
    transactions: [wire([close(seeded(1)), ...EMPTY_MINTS.map((_, at) => close(seeded(10 + at)))]), ...Array.from({ length: swaps }, (_, at) => wire([burn(at)])), wire([close(seeded(2)), close(seeded(3))])],
    kinds: ["close", ...Array(swaps).fill("swap"), "after"],
    expiresAt: new Date(Date.now() + 55_000).toISOString(),
    summary: { receiveLamports: String(rent + swapLamports), rentLamports: String(rent), swapLamports: String(swapLamports), swaps, closes: 7 + swaps, burns: 0, feeBps: 100, skipped: [], left: 0 },
  };
}

/** The exit's Review for what the screen asked, in the engine's own form: what comes in the target's coins, the rent, the fee, what only starts. */
function exitReview(body, book) {
  const picked = book.positions.filter((p) => body.positions.includes(p.id));
  const collect = body.mode === "collect";
  const later = collect ? [] : picked.filter((p) => p.exit.reason === "STAKE_ACTIVE");
  const usd = picked.reduce((sum, p) => sum + (collect ? (p.earned?.usd ?? 0) : later.includes(p) ? 0 : (p.value.usd ?? 0) * (p.exit.reason === "LOCKED" ? p.exit.partBps / 10_000 : 1)), 0) * (collect ? 1 : 0.9975);
  const target = collect ? null : body.target;
  const solPart = collect ? 0.45 : target === "SOL" ? 1 : target === "USDC" ? 0 : 0.5;
  const usdcPart = collect ? 0.5 : target === "USDC" ? 1 : target === "SOL" ? 0 : 0.5;
  const pools = picked.filter((p) => p.kind === "pool").length;
  const count = Math.max(1, Math.min(4, Math.ceil(picked.length / 2)));
  return {
    network: "solana:mainnet",
    owner: OWNER,
    mode: body.mode,
    target,
    ticket: `stand.${"y".repeat(60)}`,
    transactions: Array.from({ length: count }, (_, at) => wire([burn(at), close(seeded(30 + at))])),
    kinds: Array(count).fill(collect ? "collect" : "leave"),
    refs: picked.slice(0, count).map((p) => p.id),
    expiresAt: new Date(Date.now() + 55_000).toISOString(),
    signableMs: 20_000,
    summary: {
      receive: { lamports: raw((usd * solPart) / solUsd, 9), usdcRaw: raw(usd * usdcPart, 6) },
      rentLamports: collect ? "0" : String(pools * 57_000_000 + 4 * RENT),
      feeBps: collect ? null : 25,
      transactions: count,
      done: picked.filter((p) => !later.includes(p)).map((p) => ({ id: p.id, action: collect ? "collect" : "leave", partBps: p.exit.reason === "LOCKED" ? p.exit.partBps : 10_000 })),
      later: later.map((p) => ({ id: p.id, untilEpoch: 913 })),
      skipped: [],
      others: collect ? [{ mint: JUP, decimals: 6, amountRaw: "31000000", reason: null }] : [],
      held: [],
    },
  };
}

/* ── the agents and the history, as the engine's routes write them ── */
const now = Date.now();
const key = (n) => seeded(100 + n);
const RECORD = { owner: OWNER, settings: key(1), vault: key(2), policy: key(3), budget: key(4), perTrade: "20000000", perDay: "100000000", expiresAt: String(Math.floor(now / 1000) + 27 * 86_400 + 60) };
const DAY = { since: now - 86_400_000, until: now, trades: 3, spentRaw: "40000000", boughtRaw: "1200000000", worthRaw: "95000000", earnedRaw: "55000000", netRaw: "54000000", holdRaw: "21000000" };
const VIEW = { status: "working", strategy: "steady", receiveMint: BONK, symbol: "BONK", everyMs: 4 * 3_600_000, result: { trades: 3, spentRaw: "40000000", boughtRaw: "1200000000", worthRaw: "95000000", earnedRaw: "55000000", multiple: 2.3 }, last: [], mission: { state: "waiting", reason: null, nextAt: now + 3_600_000 }, books: { state: "exact", budgetRaw: "100000000", spentRaw: "40000000", leftRaw: "60000000", pendingRaw: "0", gapRaw: "0" }, updatedAt: now, day: DAY, net: { trades: 3, spentRaw: "40000000", netRaw: "54000000", holdRaw: "21000000", feesRaw: "300000" } };
const AGENTS = { owner: OWNER, networks: { mainnet: { read: true, mandates: [{ record: RECORD, status: "working", budgetLamports: "60000000", live: true, active: true, trades: 3, pilot: false, frozen: false, createdAt: now - 3 * 86_400_000 }], pilot: null, cares: [] }, devnet: { read: true, mandates: [], pilot: null, cares: [] } } };
function history(at) {
  const when = (ms) => new Date(at - ms).toISOString();
  const line = (id, lane, startedAt, spent, got) => ({ schema: "ryntra.solana.wallet-action", schemaVersion: "1.0.0", version: 1, network: "mainnet", wallet: OWNER, actionId: `stand-${id}-0000000000`, lane, outcome: "DONE", out: spent, in: got, destination: null, signature: null, receiptHash: null, sourceTx: null, destinationTx: null, fee: null, origin: null, providerRef: null, statedUsd: null, startedAt, updatedAt: startedAt });
  const usdc = (amount) => ({ mint: USDC, amountRaw: amount, decimals: 6, symbol: "USDC" });
  return [line("a", "SWAP", when(40_000), usdc("100000000"), { mint: null, amountRaw: raw(100 / solUsd, 9), decimals: 9, symbol: "SOL" }), line("b", "SWAP", when(3_600_000), { mint: null, amountRaw: "100000000", decimals: 9, symbol: "SOL" }, { mint: JUP, amountRaw: "27100000", decimals: 6, symbol: "JUP" }), line("c", "SEND", when(3 * 3_600_000), usdc("25000000"), null), line("d", "RECEIVE", when(26 * 3_600_000), null, usdc("250000000"))];
}
/** The wallet's coins as the money logic reads them, for the ticket and the transfer. */
const HOLDINGS = [
  { kind: "NATIVE_SOL", mint: null, amountRaw: "1500000000", spendableRaw: "1490000000", decimals: 9, symbol: "SOL", catalog: { usdPrice: String(solUsd), dayChangePct: tower(SOL)?.change24h ?? null } },
  { kind: "TOKEN", mint: USDC, amountRaw: "250000000", spendableRaw: "250000000", decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", isVerified: true, usdPrice: "1", icon: `/api/icon/${USDC}`, dayChangePct: 0 } },
  { kind: "TOKEN", mint: JUP, amountRaw: "135600000", spendableRaw: "135600000", decimals: 6, symbol: "JUP", catalog: { symbol: "JUP", name: "Jupiter", isVerified: true, usdPrice: String(jupUsd), icon: `/api/icon/${JUP}`, dayChangePct: tower(JUP)?.change24h ?? null } },
];

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
async function fromSource(route) {
  const url = new URL(route.request().url());
  try {
    const answer = await fetch(`${source}${url.pathname}${url.search}`, { headers: { accept: route.request().headers().accept ?? "*/*" } });
    return route.fulfill({ status: answer.status, contentType: answer.headers.get("content-type") ?? "application/json", body: Buffer.from(await answer.arrayBuffer()) });
  } catch {
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  }
}

for (const size of SIZES) {
  for (const lang of LANGS) {
    const uk = lang === "uk";
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile, locale: uk ? "uk-UA" : "en-US" });
    const asked = { portfolio: [], reviews: [], submits: 0, signs: [] };
    const state = { door: true, noRoute: false };
    let lastReview = null;
    const ownerOf = (route) => new URL(route.request().url()).searchParams.get("owner") ?? OWNER;
    await context.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    for (const pattern of ["**/api/city", "**/api/icon/**", "**/api/city/earn", "**/api/city/earn/piers"]) await context.route(pattern, fromSource);
    await context.route("**/api/v1/portfolio?*", (route) => {
      asked.portfolio.push(ownerOf(route));
      return json(route, portfolio(ownerOf(route)));
    });
    await context.route("**/api/liquidity/positions?*", (route) => json(route, liquidity(ownerOf(route))));
    await context.route("**/api/v1/wallet/clean?*", (route) => json(route, cleanRead(ownerOf(route))));
    await context.route("**/api/v1/wallet/clean/review", (route) => json(route, cleanReview(route.request().postDataJSON().add ?? [])));
    await context.route("**/api/v1/wallet/clean/submit", (route) => ((asked.submits += 1), json(route, {}, 503)));
    // With `noRoute`, the overview says Jupiter carries no route for JitoSOL now — held with NO_ROUTE, as the engine answers it.
    const unrouted = () => (state.noRoute ? [{ id: `wallet:${JITO}`, protocol: "wallet", kind: "lst", label: "JitoSOL", reason: "NO_ROUTE", usd: usd4(10.4 * jitoUsd), untilEpoch: null, untilTime: null }] : []);
    await context.route("**/api/v1/portfolio/exit?*", (route) => json(route, { network: "solana:mainnet", owner: ownerOf(route), mode: "exit", target: "SOL", canExit: state.door, items: [], held: unrouted(), estimate: { usd: null, lamports: null, usdcRaw: null }, solUsd, complete: true, at: new Date().toISOString() }));
    await context.route("**/api/v1/portfolio/exit/review", (route) => {
      const body = route.request().postDataJSON();
      asked.reviews.push(body);
      // A shut door answers as the engine does.
      if (!state.door) return json(route, { error: { code: "CAPABILITY_UNAVAILABLE", message: "Not open here." } }, 404);
      lastReview = exitReview(body, portfolio(OWNER));
      return json(route, lastReview);
    });
    await context.route("**/api/v1/portfolio/exit/submit", (route) => ((asked.submits += 1), json(route, {}, 503)));
    await context.route("**/api/solana/holdings*", (route) => json(route, { data: { tokenRead: "COMPLETE", holdings: HOLDINGS } }));
    await context.route("**/api/solana/activity", (route) => json(route, { data: { actions: history(Date.now()), complete: true } }));
    await context.route("**/api/auth/solana/session*", (route) => json(route, { signedIn: false, walletAddress: null, proof: null, at: Date.now() }));
    await context.route("**/api/bots/agents", (route) => json(route, AGENTS));
    await context.route("**/api/bots/mandate/agent*", (route) => json(route, VIEW));
    await context.route("**/api/bots/mandate/status*", (route) => json(route, { active: true, budgetLamports: "60000000" }));
    await context.route("**/api/city/earn/care", (route) => json(route, { ok: true, network: "mainnet", cares: [] }));
    await context.route("**/api/bots/pilot*", (route) => json(route, { error: { code: "NO_PILOT", message: "No autopilot for this wallet." } }, 404));

    const page = await context.newPage();
    // A dev stand's own overlay (Next's «Issues» badge) is never part of a shot; a built stand has none.
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.head.append(Object.assign(document.createElement("style"), { textContent: "nextjs-portal { display: none !important; }" }))));
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    // What the page itself says is wrong — not the stand's own 503s for what it does not serve.
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource|503|404/.test(message.text())) errors.push(message.text());
    });
    await page.exposeFunction("__recordSign", (wires) => asked.signs.push(wires));
    // A stub wallet in the Wallet Standard registry: it connects and never signs.
    await page.addInitScript(({ address }) => {
      const icon = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="7" fill="#AB9FF2"/></svg>')}`;
      const account = { address, publicKey: new Uint8Array(32), chains: ["solana:mainnet"], features: ["solana:signTransaction", "solana:signMessage"], label: "Phantom" };
      const wallet = {
        version: "1.0.0",
        name: "Phantom",
        icon,
        chains: ["solana:mainnet"],
        accounts: [],
        features: {
          "standard:connect": { version: "1.0.0", connect: async () => ((wallet.accounts = [account]), { accounts: [account] }) },
          "standard:disconnect": { version: "1.0.0", disconnect: async () => void (wallet.accounts = []) },
          "standard:events": { version: "1.0.0", on: () => () => {} },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: (...inputs) => {
              window.__recordSign(inputs.map(({ transaction }) => btoa(String.fromCharCode(...transaction))));
              return new Promise(() => {});
            },
          },
          "solana:signMessage": { version: "1.0.0", signMessage: () => new Promise(() => {}) },
        },
      };
      window.addEventListener("wallet-standard:app-ready", (event) => event.detail.register(wallet));
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
    }, { address: OWNER });

    const file = (shotName) => path.join(out, `${shotName}-${size.name}-${lang}.jpg`);
    const shot = async (shotName, { block = null, full = false } = {}) => {
      if (ONLY && !ONLY.has(shotName)) return;
      // A whole page: walked to its foot and back first, so the logos below the fold are brought.
      if (full) {
        await page.evaluate(async () => {
          for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
            window.scrollTo(0, y);
            await new Promise((done) => setTimeout(done, 120));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 15_000 }).catch(() => {});
      }
      if (block) await block.evaluate((node, mobile) => node.scrollIntoView({ block: mobile ? "start" : "nearest" }), size.mobile).catch(() => {});
      if (size.mobile && block) await page.evaluate(() => window.scrollBy(0, -84));
      await page.waitForTimeout(700);
      await page.screenshot({ path: file(shotName), quality: 86, type: "jpeg", fullPage: full });
      // The form of every framed or filled box on screen: one form — square, the cut, 4 px on what is pressed, circles.
      const boxes = await page.evaluate(measure);
      const tally = {};
      for (const box of boxes) tally[box.shape] = (tally[box.shape] ?? 0) + 1;
      const odd = boxes.filter((box) => !FORM.has(box.shape));
      corners.push({ shot: `${shotName}-${size.name}-${lang}`, tally, odd });
      if (odd.length) report.push(`${size.name}/${lang} ${shotName}: ${odd.length} box(es) outside the form — ${JSON.stringify(odd.slice(0, 4))}`);
    };
    const settle = async () => {
      await page.waitForFunction(() => document.fonts.status === "loaded" && !document.documentElement.classList.contains("city-lang-wait"), null, { timeout: 60_000 });
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1500);
    };
    const tap = (locator) => (size.mobile ? locator.tap() : locator.click());
    const open = async ({ wallet, query = "" }) => {
      await page.goto(`${base}/portfolio?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 180_000 }).catch(() => {});
      await page.evaluate((on) => {
        try {
          if (on) localStorage.setItem("ryntra.solana.wallet-hint.v1", "Phantom");
          else localStorage.removeItem("ryntra.solana.wallet-hint.v1");
        } catch {}
      }, wallet);
      await page.goto(`${base}/portfolio?lang=${lang}${query}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForSelector("main h1", { timeout: 120_000 });
      await settle();
      await page.waitForTimeout(wallet ? 4500 : 1500);
    };
    const act = () => (size.mobile ? page.locator("[role='dialog']") : page.locator("#portfolio-act"));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const ambers = () => page.evaluate(() => [...document.querySelectorAll("main button, main a")].filter((el) => el.offsetParent !== null && /ui_act__|ui-module__.*__act\b/.test(el.className)).map((el) => el.textContent.trim()));
    const note = async (what) => report.push(`${size.name}/${lang}: ${what}; amber: ${JSON.stringify(await ambers())}; overflow ${await overflow()}px`);
    const words = uk
      ? { field: "Встав адресу гаманця", show: "Показати", exit: "Вийти з усього", collect: "Зібрати комісії", clean: "Очистити гаманець", exitNow: "Вийти", why: /чому GIGAX позначено/, buy: "Купити JUP", dust: /Розгорнути: Дріб/ }
      : { field: "Paste a wallet address", show: "Show", exit: "Exit everything", collect: "Collect fees", clean: "Clean wallet", exitNow: "Exit", why: /why GIGAX is marked/, buy: "Buy JUP", dust: /Show Dust/ };
    const bar = (name) => page.getByRole("button", { name, exact: true }).locator("visible=true").first();

    const noRoute = async () => {
      state.noRoute = true;
      await open({ wallet: true });
      await tap(bar(words.exit));
      await page.waitForTimeout(3000);
      const line = act().getByRole("note").filter({ hasText: "Jupiter" }).first();
      if (size.mobile) await line.scrollIntoViewIfNeeded().catch(() => {});
      await shot("exit-noroute", { block: size.mobile ? null : act() });
      const said = await line.innerText().catch(() => "—");
      const asked_ = asked.reviews.at(-1)?.positions ?? [];
      report.push(`${size.name}/${lang}: no route — the panel says «${said.trim()}»; JitoSOL asked to be built: ${asked_.includes(`wallet:${JITO}`)}`);
      state.noRoute = false;
    };
    // NO_ROUTE_ONLY=1 — just this state, for a task that changes nothing else of the screen.
    if (process.env.NO_ROUTE_ONLY) {
      await noRoute();
      if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
      await context.close();
      continue;
    }

    // ── no wallet: the address field, the wallet's door, the screen's own form under them ──
    await open({ wallet: false });
    await shot("no-wallet");
    await note("no wallet");

    // ── a wallet by its address: everything it holds, read only ──
    await page.getByLabel(words.field).first().fill(WATCHED);
    await tap(page.getByRole("button", { name: words.show, exact: true }).first());
    await page.waitForSelector(`section[aria-label="${uk ? "Разом" : "Total"}"]`, { timeout: 30_000 });
    await settle();
    await shot("address");
    await shot("address-full", { full: true });
    await note(`an address — asked ${JSON.stringify(asked.portfolio.at(-1) === WATCHED)}, link ${new URL(page.url()).searchParams.get("owner") === WATCHED}`);

    // ── the stand's own wallet ──
    await open({ wallet: true });
    await shot("wallet");
    await shot("wallet-full", { full: true });
    await note("the wallet's own");
    // The dust stands folded on a desk too (QA 19.11, eyes 26); opened, its first rows and «N more».
    const dustPanel = page.locator(`section[aria-label="${uk ? "Дріб’язок" : "Dust"}"]`);
    report.push(`${size.name}/${lang}: the dust starts folded — ${(await dustPanel.locator("[aria-expanded='false']").count()) > 0}; page ${await page.evaluate(() => document.documentElement.scrollHeight)}px`);
    await tap(page.getByRole("button", { name: words.dust }).first());
    await page.waitForTimeout(800);
    await shot("dust-open", { block: dustPanel });
    if (!size.mobile) {
      await tap(page.getByRole("button", { name: words.why }).first());
      await shot("risk-why", { block: page.getByRole("button", { name: words.why }).first() });
      await tap(page.getByRole("button", { name: words.why }).first());
    } else {
      // The coins as a phone lists them, the marked one among them: its row brought under the head.
      await shot("coins", { block: page.locator("main li").filter({ hasText: "GIGAX" }).first() });
    }

    // ── «Exit everything»: the coin to leave into, every position with its switch, one line of what comes ──
    await tap(bar(words.exit));
    await page.waitForTimeout(2500);
    await shot("exit", { block: size.mobile ? null : act() });
    await note(`exit — the first Review asked ${JSON.stringify({ mode: asked.reviews[0]?.mode, target: asked.reviews[0]?.target, positions: asked.reviews[0]?.positions?.length })}`);
    await tap(act().getByRole("radio", { name: "50/50" }));
    await page.waitForTimeout(2000);
    await shot("exit-half", { block: size.mobile ? null : act() });
    const signsFrom = asked.signs.length;
    await tap(act().getByRole("button", { name: words.exitNow, exact: true }));
    await page.waitForTimeout(2500);
    await shot("exit-sign", { block: size.mobile ? null : act() });
    const signed = asked.signs.slice(signsFrom);
    const same = signed.length === 1 && lastReview && JSON.stringify(signed[0]) === JSON.stringify(lastReview.transactions);
    report.push(`${size.name}/${lang}: Exit — the wallet was asked ${signed.length} time(s) for ${signed[0]?.length ?? 0} transaction(s); the bytes are the Review's own — ${same}; target ${asked.reviews.at(-1)?.target}; submits ${asked.submits}`);

    await noRoute();

    // ── «Collect fees» and «Clean wallet» ──
    await open({ wallet: true });
    await tap(bar(words.collect));
    await page.waitForTimeout(2500);
    await shot("collect", { block: size.mobile ? null : act() });
    await note(`collect — asked ${JSON.stringify({ mode: asked.reviews.at(-1)?.mode, positions: asked.reviews.at(-1)?.positions?.length })}`);
    await open({ wallet: true });
    await tap(bar(words.clean));
    await page.waitForTimeout(2500);
    await shot("clean", { block: size.mobile ? null : act() });
    await note("clean");

    // ── the ticket on a coin still opens from its row ──
    if (!size.mobile) {
      await open({ wallet: true });
      await tap(page.getByRole("button", { name: words.buy }).first());
      await page.waitForTimeout(2500);
      await shot("ticket", { block: act() });
    }

    // ── the engine's door shut, as production has it until the owner opens it: «Soon», nothing to press ──
    state.door = false;
    await open({ wallet: true });
    await shot("door-shut");
    await note("the exit's door shut");
    state.door = true;

    if (errors.length) report.push(`${size.name}/${lang}: page errors — ${errors.join(" | ").slice(0, 600)}`);
    await context.close();
  }
}

await browser.close();
const total = {};
for (const entry of corners) for (const [shape, n] of Object.entries(entry.tally)) total[shape] = (total[shape] ?? 0) + n;
report.push(`form: ${JSON.stringify(total)} over ${corners.length} shots; outside the form: ${corners.reduce((n, entry) => n + entry.odd.length, 0)}`);
writeFileSync(path.join(out, "corners.json"), JSON.stringify(corners, null, 1));
writeFileSync(path.join(out, "report.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));

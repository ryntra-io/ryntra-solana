import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { inDevelopmentRepository, needsDevelopmentRepository } from "../../lib/development-repository.mjs";

const repoRoot = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repoRoot), "utf8");

const page = read("app/admin/page.tsx");
const gate = read("app/admin/gate.tsx");
const panel = read("app/admin/panel.tsx");
const shell = read("app/admin/shell/admin-shell.tsx");
const frame = read("app/admin/shell/admin-shell-frame.tsx");
const shellCss = read("app/admin/shell/admin-shell.module.css");
const api = read("app/api/admin/route.ts");
const overview = read("app/admin/overview-panel.tsx");
const users = read("app/admin/users/users-panel.tsx");
const feedback = read("app/admin/feedback/feedback-panel.tsx");
const stat = read("app/admin/stat.tsx");
const academy = inDevelopmentRepository ? read("app/admin/academy/academy-workspace.tsx") : "";
const academyPage = inDevelopmentRepository ? read("app/admin/academy/page.tsx") : "";

test("огляд і 401 лишаються fail-closed", () => {
  assert.match(page, /getAdminSession/);
  assert.match(page, /if \(!admin\)/);
  assert.match(gate, /401/);
  assert.match(page, /AdminUnauthorized/);
  assert.match(page, /AdminShellV2/);
  assert.doesNotMatch(page, /process\.env/);
  for (const surface of ["users", "feedback", "broadcasts", "analytics", "finance", "seo", "operations", "audit", "settings"]) {
    const source = read(`app/admin/${surface}/page.tsx`);
    assert.match(source, /getAdminSession/, surface);
    assert.match(source, /AdminUnauthorized/, surface);
  }
  for (const route of ["overview", "users", "operations", "analytics", "finance", "feedback", "audit", "seo", "broadcasts", "analytics/business", "analytics/internal-wallets"]) {
    const source = read(`app/api/admin/${route}/route.ts`);
    assert.match(source, /getAdminSession\(\)/, route);
    assert.match(source, /status: 401/, route);
  }
});

test("бізнес-аналітика: вікно і режим угорі, гаманці замасковані в рядку, внутрішні гаманці — на сервері", () => {
  const panel = read("app/admin/analytics/business-panel.tsx");
  const business = read("app/api/admin/analytics/business/route.ts");
  const internal = read("app/api/admin/analytics/internal-wallets/route.ts");
  assert.match(panel, /useState<BusinessRange>\("24h"\)/, "24h is the default window");
  assert.match(panel, /useState<BusinessScope>\("external"\)/, "external wallets are the default scope");
  for (const label of ["24 год", "7 дн", "30 дн", "Увесь час", "Зовнішні гаманці", "Уся активність"]) assert.ok(panel.includes(label), label);
  assert.match(panel, /\{item\.wallet\}/, "the row shows the masked address");
  assert.doesNotMatch(panel.match(/<summary className=\{biz\.feedSummary\}>[\s\S]*?<\/summary>/)[0], /walletFull/, "the full address is one disclosure down, never in the row");
  assert.match(panel, /Позначити внутрішнім/);
  assert.match(panel, /\/api\/admin\/analytics\/internal-wallets/);
  assert.doesNotMatch(panel, /RYNTRA_INTERNAL_WALLETS|process\.env/, "no client-side wallet list");
  assert.match(internal, /internalWalletsFromEnv\(process\.env\)/);
  assert.match(business, /isBusinessRange\(range\)/);
  assert.match(business, /scope=all|isBusinessScope\(scope\)/);
  assert.match(panel, /не збирається/, "an unmeasured source is named, not zeroed");
  assert.match(panel, /Відвідувачі не вимірюються/);
  assert.match(panel, /solscan\.io\/tx\//);
  assert.doesNotMatch(panel, /P&L|pnl|wallet_address/i);
});

test("Control Center і Академія — одна сім'я на AdminShellV2", { skip: needsDevelopmentRepository("app/admin/academy/") }, () => {
  assert.match(page, /AdminShellV2/);
  assert.match(shell, /AdminShellV2/);
  /* The Academy joins the admin family — the same gate, the same 401 screen
     and the same shell as every sibling. The old AdminChrome header is gone
     with its only consumer. */
  assert.match(academyPage, /getAdminSession/);
  assert.match(academyPage, /AdminUnauthorized surface="Академія"/);
  assert.match(academyPage, /<AdminShellV2 active="academy">/);
  assert.doesNotMatch(academy, /AdminChrome|admin-chrome/);
  assert.equal(existsSync(new URL("app/admin/admin-chrome.tsx", repoRoot)), false);
  assert.doesNotMatch(shellCss, /backdrop-filter/);
});

test("на телефоні навігація — це шухляда за кнопкою меню, а не стос над сторінкою", () => {
  assert.match(frame, /"use client"/);
  assert.match(frame, /aria-expanded=\{open\}/);
  assert.match(frame, /aria-controls="admin-nav"/);
  assert.match(frame, /id="admin-nav"/);
  assert.match(frame, /event\.key === "Escape"/);
  assert.match(frame, /rel="noreferrer"/);
  assert.match(shellCss, /\.menuButton \{[^}]*display: none/s, "the menu button exists only on the phone");
  assert.match(shellCss, /@media \(max-width: 900px\) \{[\s\S]*\.menuButton \{[^}]*display: inline-flex/);
  assert.match(shellCss, /@media \(max-width: 900px\) \{[\s\S]*\.sidebar \{[^}]*position: fixed/);
  assert.match(shellCss, /transform: translateX\(-104%\)/);
  assert.match(shellCss, /\.rootOpen \.sidebar \{[^}]*transform: none/);
  assert.match(shellCss, /width: 44px;\s*height: 44px/, "the menu button is a 44px target");
  assert.doesNotMatch(shellCss, /grid-template-rows: 56px auto minmax/, "the stacked-navigation row is gone");
});

test("черга кампаній вимагає тест собі і не малює прочитання", () => {
  const src = read("app/admin/broadcasts/broadcasts-panel.tsx");
  assert.match(src, /\/api\/admin\/broadcasts/);
  assert.match(src, /Тест собі/);
  assert.match(src, /if \(!armed\) \{ setArmed\(true\); return; \}/);
  assert.doesNotMatch(src, /прочитано|open_rate|read_count/i);
  assert.match(src, /status === 503/);
  assert.match(src, /BroadcastPanel/);
});

test("розсилка лишається дводіапазонною і б'є в той самий API", () => {
  const urls = [...panel.matchAll(/fetch\(\s*[`"']([^`"']*)/g)].map((m) => m[1]);
  assert.ok(urls.every((url) => url.startsWith("/api/admin")));
  assert.match(panel, /if \(!bArmed\)\s*\{\s*setBArmed\(true\);\s*return;\s*\}/);
  assert.match(panel, /Підтвердити відправку/);
  assert.match(panel, /Другий клік надішле повідомлення/);
  assert.match(panel, /реальним людям/);
  const sent = new Set([...panel.matchAll(/action:\s*"([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(sent.has("broadcast"));
  const uiCap = panel.match(/BROADCAST_CAP\s*=\s*(\d+)/);
  const apiCap = api.match(/unique\.slice\(0,\s*(\d+)\)/);
  assert.equal(uiCap[1], apiCap[1]);
});

test("огляд не малює нуль замість відсутніх даних і веде до відфільтрованого списку", () => {
  assert.match(overview, /немає даних/);
  assert.doesNotMatch(overview, /\?\?\s*0\b/);
  assert.match(stat, /typeof cell\.value === "number"/);
  assert.match(stat, /not_collected: "не збирається"/);
  assert.match(stat, /unavailable: "джерело недоступне"/);
  assert.match(stat, /insufficient: "замало даних"/);
  assert.match(overview, /model\.attention\.map/);
  assert.match(overview, /Нічого термінового/);
  assert.match(overview, /\/admin\/feedback\?status=OPEN/);
  assert.match(overview, /\/admin\/users\?filter=errors_7d/);
  assert.match(overview, /MetricDefinitions/);
  assert.doesNotMatch(overview, /P&L|pnl|wallet_address/i);
});

test("таблиця користувачів розрізняє реєстрацію, вхід і дію, без адреси гаманця", () => {
  assert.doesNotMatch(users, /wallet_address/);
  assert.doesNotMatch(users, /0x\$\{/);
  assert.doesNotMatch(users, /P&L|pnl|portfolio/i);
  assert.match(users, /walletLinked/);
  assert.match(users, /ACCESS_LABEL/);
  assert.match(users, /Зареєстровано/);
  assert.match(users, /Перший вхід/);
  assert.match(users, /Останній вхід/);
  assert.match(users, /Остання дія/);
  assert.match(users, /не збирається/);
  assert.match(users, /useSearchParams/, "filters, sort and page live in the URL");
  assert.match(users, /parseUsersQuery/);
  assert.match(users, /\?detail=\$\{encodeURIComponent\(selectedKey\)\}/, "the drawer reads the account timeline by its stable key");
  assert.match(users, /reason\.trim\(\)\.length < 3/, "access actions need a reason for the audit");
  assert.match(feedback, /status=OPEN|searchParams\.get\("status"\)/);
  assert.match(feedback, /Прочитання не фіксується/);
});

test("навігація Control Center містить огляд, людей, аудит і академію", () => {
  const nav = read("app/admin/shell/nav.ts");
  assert.match(nav, /href: "\/admin"/);
  assert.match(nav, /href: "\/admin\/users"/);
  assert.match(nav, /href: "\/admin\/audit"/);
  assert.match(nav, /href: "\/admin\/feedback"/);
  assert.match(nav, /href: "\/admin\/academy"/);
  assert.doesNotMatch(nav, /id: "feedback"[^}]*later: true/);
  assert.doesNotMatch(nav, /id: "analytics"[^}]*later: true/);
  assert.doesNotMatch(nav, /id: "seo"[^}]*later: true/);
  assert.doesNotMatch(nav, /id: "operations"[^}]*later: true/);
  assert.doesNotMatch(nav, /id: "settings"[^}]*later: true/);
  assert.match(nav, /href: "\/admin\/analytics"/);
  assert.match(nav, /href: "\/admin\/seo"/);
  assert.match(nav, /href: "\/admin\/operations"/);
  assert.match(nav, /href: "\/admin\/settings"/);
});

test("адмінка не протікає в публічну поверхню", () => {
  assert.match(read("app/robots.ts"), /"\/admin"/);
  assert.doesNotMatch(read("app/sitemap.ts"), /admin/i);
  assert.match(page, /robots:\s*\{\s*index:\s*false/);
  for (const surface of ["app/components/site-chrome.tsx", "app/home-client.tsx"]) {
    assert.doesNotMatch(read(surface), /\/admin/, `${surface} посилається на адмінку`);
  }
});

test("операції не показують токен бота, налаштування більше не later", () => {
  const ops = read("app/admin/operations/operations-panel.tsx");
  const settings = read("app/admin/settings/page.tsx");
  assert.match(ops, /Bot Operations/);
  assert.doesNotMatch(ops, /TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(ops, /process\.env/);
  assert.match(ops, /PROVIDER_STATE_LABEL/);
  assert.match(ops, /"activity_store" \? "coverage"/, "the coverage row is the deep-link target");
  assert.doesNotMatch(settings, /AdminLaterPage/);
});

test("аналітика не зливає три джерела і SEO не має оцінки", () => {
  const analytics = read("app/admin/analytics/analytics-panel.tsx");
  const seo = read("app/admin/seo/seo-panel.tsx");
  assert.match(analytics, /firstParty/);
  assert.match(analytics, /ga4/);
  assert.match(analytics, /searchConsole/);
  assert.doesNotMatch(analytics, /combined|total visitors|всього відвідувачів/i);
  assert.match(analytics, /не нуль відвідувачів/);
  assert.match(analytics, /події, не люди/);
  assert.doesNotMatch(seo, /SEO score|оцінка 100/i);
  assert.match(seo, /Адмінка в індексі: ні/);
});

test("Академія не тримає власної шапки й не виходить за межі кабінету адміна", { skip: needsDevelopmentRepository("app/admin/academy/") }, () => {
  for (const dead of ["styles.topLink", "styles.brandMark", "styles.chrome", "styles.navLink"]) {
    assert.ok(!academy.includes(dead), `Академія все ще використовує ${dead}`);
  }
  /* The academy's own top row is a title, a level and the language switch —
     never a second brand, a second nav or a second logout. */
  assert.doesNotMatch(academy, /logout|Вийти|href="\/admin"/);
});


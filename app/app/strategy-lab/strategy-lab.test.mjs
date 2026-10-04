import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENABLED_LOCALE_CODES, localeDir } from "../../i18n/locales.ts";
import { LAB_EN, getLabCopy } from "./copy.ts";

test("Strategy Lab exposes complete non-empty copy contracts for every enabled locale", () => {
  const keys = Object.keys(LAB_EN);
  for (const locale of ENABLED_LOCALE_CODES) {
    const copy = getLabCopy(locale);
    assert.deepEqual(Object.keys(copy), keys, `${locale} must keep the full copy contract`);
    assert.equal(copy.stages.length, 8, `${locale} must expose every workflow stage`);
    for (const [key, value] of Object.entries(copy)) {
      if (Array.isArray(value)) {
        assert.ok(value.every((item) => typeof item === "string" && item.trim().length > 0), `${locale}.${key} contains an empty label`);
      } else {
        assert.ok(typeof value === "string" && value.trim().length > 0, `${locale}.${key} is empty`);
      }
    }
  }
  assert.equal(localeDir("ar"), "rtl");
});

function readWorkspaceSource() {
  return readFileSync(new URL('./strategy-lab-workspace.tsx', import.meta.url), 'utf8');
}

test('human approval exposes the complete canonical strategy contract', () => {
  const component = readWorkspaceSource();

  for (const field of [
    'brief.assetClass',
    'assetClass: brief.assetClass',
    'strategy.universe.provider',
    'strategy.universe.assetClass',
    'strategy.filters.map',
    'strategy.assumptions.map',
    'strategy.riskPolicy.maxOpenPositions',
    'strategy.riskPolicy.allowShort',
    'strategy.costModel.spreadBps',
    'strategy.costModel.fundingBpsPerDay',
  ]) {
    assert.ok(component.includes(field), `approval surface must expose ${field}`);
  }
});

test('guided V1 controls cannot create values outside the canonical contract', () => {
  const component = readWorkspaceSource();

  assert.ok(component.includes('brief.thesis.trim().slice(0, 500)'));
  assert.ok(!component.includes('brief.thesis.trim().slice(0, 1_500)'));
  assert.match(component, /maxOpenPositions[\s\S]{0,180}min='1'[\s\S]{0,80}max='1'[\s\S]{0,80}disabled/);
  assert.match(component, /max='1000'[\s\S]{0,180}indicator\.length/);
});

test('editing an approved strategy preserves the full parent artifact before invalidation', () => {
  const component = readWorkspaceSource();
  const start = component.indexOf('const startDraft');
  const end = component.indexOf('const mutateSpec', start);
  const draftTransition = component.slice(start, end);
  const clearStart = component.indexOf('const clearAfterSpec');
  const clearEnd = component.indexOf('const invalidateExperimentBinding', clearStart);
  const clear = component.slice(clearStart, clearEnd);

  assert.ok(draftTransition.includes('if (approval) setParentApproval(approval)'));
  assert.ok(draftTransition.includes('clearAfterSpec()'));
  assert.ok(clear.includes('setApproval(null)'));
  assert.ok(!component.includes('setVersionId('));
});

test('strategy and compile binding changes clear stale import files and notices', () => {
  const component = readWorkspaceSource();
  const sections = [
    component.slice(component.indexOf('const clearAfterSpec'), component.indexOf('const invalidateExperimentBinding')),
    component.slice(component.indexOf('const invalidateExperimentBinding'), component.indexOf('const startDraft')),
  ];

  for (const section of sections) {
    for (const reset of [
      'invalidatePendingRequests()',
      'setTradesFile(null)',
      'setPerformanceFile(null)',
      'setRun(null)',
      'setReview(null)',
      "setFlash('')",
      'setError("")',
    ]) {
      assert.ok(section.includes(reset), 'binding invalidation must call ' + reset);
    }
  }
});

test('async artifact requests discard stale responses before committing state', () => {
  const component = readWorkspaceSource();
  const cases = [
    ['const formalize', 'const useTemplate', 'startDraft(data.strategy', 'formalize'],
    ['const compile', 'const copyPine', 'setCompiled(data)', 'compile'],
    ['const importBacktest', 'const requestReview', 'setRun(data)', 'import'],
    ['const requestReview', 'const createVersionDraft', 'setReview(data.proposal)', 'review'],
  ];

  for (const [startMarker, endMarker, commitMarker, action] of cases) {
    const section = component.slice(component.indexOf(startMarker), component.indexOf(endMarker));
    const capture = section.indexOf('const requestGeneration = captureRequestGeneration()');
    const guard = section.lastIndexOf('if (!isCurrentRequest(requestGeneration)) return;');
    const commit = section.indexOf(commitMarker);
    assert.ok(capture >= 0, startMarker + ' must capture the request generation');
    assert.ok(guard > capture && guard < commit, startMarker + ' must guard the final state commit');
    assert.ok(section.includes(`if (isCurrentRequest(requestGeneration)) setRecoverableError("${action}", c.networkError);`));
  }
});

test('every artifact-defining UI mutation invalidates pending requests', () => {
  const component = readWorkspaceSource();
  /* `changeLocale` left this list: the locale is no longer a page-local
     mutation — it arrives from the server as a prop, and the shell's language
     toggle refreshes the route. There is nothing left for it to invalidate. */
  for (const handler of [
    'const clearAfterSpec',
    'const invalidateExperimentBinding',
    'const updateBrief',
    'const changeApproval',
    'const replaceImportFile',
    'const changeEvidenceBinding',
    'const createVersionDraft',
  ]) {
    const start = component.indexOf(handler);
    const end = component.indexOf('\n  const ', start + handler.length);
    const section = component.slice(start, end);
    assert.ok(start >= 0, handler + ' must exist');
    const invalidates = section.includes('invalidatePendingRequests()') || section.includes('clearAfterSpec(');
    assert.ok(invalidates, handler + ' must invalidate pending requests directly or through clearAfterSpec');
  }
});

test('CSV selection is bound to the current approved compile', () => {
  const component = readWorkspaceSource();
  const compileSection = component.slice(component.indexOf('const compile'), component.indexOf('const copyPine'));
  const importSection = component.slice(component.indexOf('const importBacktest'), component.indexOf('const requestReview'));

  assert.ok(compileSection.includes('setTradesFile(null)'));
  assert.ok(compileSection.includes('setPerformanceFile(null)'));
  assert.ok(compileSection.includes('setFileInputResetKey((value) => value + 1)'));
  assert.ok(importSection.includes('!approval || !compiled || !tradesFile || !performanceFile'));
  assert.equal(component.split('disabled={!compiled || busy !== null}').length - 1, 2);
});

test('replacing either import file clears stale evidence and notices', () => {
  const component = readWorkspaceSource();
  const start = component.indexOf('const replaceImportFile');
  const end = component.indexOf('const importBacktest', start);
  const replacement = component.slice(start, end);

  assert.ok(start >= 0);
  for (const reset of ['setRun(null)', 'setReview(null)', 'setFlash(\'\')', 'setError(\'\')']) {
    assert.ok(replacement.includes(reset), `file replacement must call ${reset}`);
  }
});

test('evidence presentation discloses preview scope and exact dimension maxima', () => {
  const component = readWorkspaceSource();

  assert.ok(component.includes('EVIDENCE_DIMENSION_MAX'));
  assert.ok(!component.includes('(value / 14)'));
  assert.ok(component.includes('run.tradesPreview.length'));
  assert.ok(component.includes('run.tradeCount'));
  assert.ok(component.includes('c.previewCount'));
  assert.ok(component.includes('c.closedTradeDrawdown'));
  assert.ok(component.includes('run.tradesPreview.length, Math.min(run.tradesPreview.length, 12), run.tradeCount'));
});

test('workspace controls retain local direction and keyboard-readable semantics', () => {
  const component = readWorkspaceSource();
  const css = readFileSync(new URL('../../globals.css', import.meta.url), 'utf8');

  /* `aria-pressed` lived on the page's own beginner|pro segmented toggle,
     since removed: editor depth now follows the shared top-bar DepthSwitch,
     which carries its own pressed semantics and its own tests. The lab must
     not grow a second depth control back. */
  assert.ok(!component.includes('sl-segmented'));
  assert.ok(!component.includes('sl-locale'));
  assert.ok(component.includes('aria-current'));
  assert.ok(component.includes('<title>'));
  assert.ok(component.includes('<caption'));
  assert.ok(component.includes(`scope='col'`));
  assert.ok(!component.includes('document.documentElement'));
  assert.ok(css.includes('.sl-files label:focus-within'));
  assert.ok(component.includes("!compiled || busy !== null ? 'disabled' : ''"));
  assert.ok(css.includes('.sl-files label.disabled'));
  assert.ok(css.includes('cursor: not-allowed'));
});

test('critical Strategy Lab copy is localized in Ukrainian, Russian, and Arabic', () => {
  const keys = [
    'assetClass',
    'provider',
    'filters',
    'maxDrawdownPolicy',
    'maxOpenPositions',
    'allowShort',
    'spread',
    'funding',
    'previewCount',
    'closedTradeDrawdown',
    'clipboardFailed',
    'networkError',
  ];

  for (const locale of ['uk', 'ru', 'ar']) {
    const localized = getLabCopy(locale);
    for (const key of keys) {
      assert.notEqual(localized[key], LAB_EN[key], `${locale}.${key} must not fall back to English`);
    }
  }
});

test('local preview import copy does not claim disabled persistence', () => {
  const expected = {
    en: /persists neither source files nor normalized evidence/i,
    uk: /не зберігає ані вихідні файли, ані нормалізовані докази/i,
    ru: /не сохраняет ни исходные файлы, ни нормализованные доказательства/i,
    ar: /لا تحفظ هذه المعاينة المحلية الملفات المصدرية ولا الأدلة الموحّدة/,
  };

  for (const [locale, pattern] of Object.entries(expected)) {
    assert.match(getLabCopy(locale).importBody, pattern, locale + '.importBody must match the disabled persistence gate');
  }
  assert.ok(!LAB_EN.importBody.includes('Ryntra stores'));
});

test('API and clipboard errors are actionable without leaking raw error codes', () => {
  const component = readWorkspaceSource();

  assert.ok(component.includes('data.issues'));
  assert.ok(component.includes('getLabApiError'));
  assert.ok(component.includes('c.clipboardFailed'));
  assert.match(component, /const copyPine = async[\s\S]*?try[\s\S]*?catch/);
});

test('approval and import retries retain canonical request identities', () => {
  const component = readWorkspaceSource();
  const approve = component.slice(component.indexOf('const approveStrategy'), component.indexOf('const compile', component.indexOf('const approveStrategy')));
  const importRun = component.slice(component.indexOf('const importBacktest'), component.indexOf('const requestReview'));

  assert.ok(component.includes('requestId: crypto.randomUUID()'));
  assert.ok(component.includes('const approveAttemptRef = useRef<AiRequestAttempt | null>(null)'));
  assert.ok(approve.includes('requestIdFor(approveAttemptRef, payload)'));
  assert.ok(approve.includes('body: JSON.stringify({ ...payload, requestId })'));
  assert.ok(approve.includes('approveAttemptRef.current = null'));

  assert.ok(component.includes('const importAttemptRef = useRef<AiRequestAttempt | null>(null)'));
  assert.ok(importRun.includes('requestIdFor(importAttemptRef'));
  assert.ok(importRun.includes('persistedVersion?.versionId === approval.versionId'));
  assert.ok(importRun.includes('{ persistence: { requestId, lineage: experimentLineage } }'));
});

test('workspace models exact persistence identities without presenting a saved-state claim', () => {
  const component = readWorkspaceSource();

  assert.match(component, /type ApprovalResult = \{[\s\S]*?persistedVersion\?: PersistedVersion \| null;[\s\S]*?replay\?: boolean;/);
  assert.match(component, /type PersistedRun = \{[\s\S]*?evidenceReportId: string;[\s\S]*?evidenceHash: string;[\s\S]*?replay: boolean;[\s\S]*?iterationNumber: number;/);
  assert.match(component, /type ImportResult = \{[\s\S]*?persistence: PersistenceStatus;[\s\S]*?persistedRun: PersistedRun \| null;[\s\S]*?evidenceIdentity: EvidenceIdentity;/);
  assert.match(component, /type ReviewResult = \{[\s\S]*?persistence\?: PersistenceStatus;[\s\S]*?persistedProposal\?: PersistedProposal \| null;/);

  const presentation = component.slice(component.indexOf('const evidence = run?.evidence'));
  for (const internalIdentity of ['persistedVersion', 'persistedRun', 'evidenceIdentity', 'data.persistence']) {
    assert.ok(!presentation.includes(internalIdentity), `${internalIdentity} must not appear as a visible saved-state claim`);
  }
  assert.ok(!component.includes('setFlash("Saved'));
  assert.ok(!component.includes('setFlash("Stored'));
});

test('persisted evidence binds review proposals and the next experiment lineage', () => {
  const component = readWorkspaceSource();
  const root = component.slice(component.indexOf('function rootExperimentLineage'), component.indexOf('const INITIAL_BRIEF'));
  const edits = component.slice(component.indexOf('const mutateSpec'), component.indexOf('const setRecoverableError'));
  const confirmation = component.slice(component.indexOf('const changeApprovalConfirmation'), component.indexOf('const changeEvidenceBinding'));
  const review = component.slice(component.indexOf('const requestReview'), component.indexOf('const createVersionDraft'));
  const nextDraft = component.slice(component.indexOf('const createVersionDraft'), component.indexOf('const retryLastAction'));

  for (const rootField of [
    'parentRunId: null',
    'hypothesis: ""',
    'changedFields: []',
    'userAttestedTestWindowSeenBeforeChange: false',
    'iterationNumber: 1',
  ]) {
    assert.ok(root.includes(rootField), `root lineage must include ${rootField}`);
  }

  assert.ok(review.includes('run.evidenceIdentity.experimentId === run.persistedRun.experimentId'));
  assert.ok(review.includes('experimentId: run.persistedRun.experimentId'));
  assert.ok(review.includes('evidenceReportId: run.persistedRun.evidenceReportId'));
  assert.ok(review.includes('...(persistedEvidence ? { persistence: persistedEvidence } : {})'));
  assert.ok(review.includes('persistedProposal'));

  assert.ok(nextDraft.includes('parentRunId: persistedParentRun.experimentId'));
  assert.ok(nextDraft.includes('hypothesis: review.nextHypothesis.statement'));
  assert.ok(nextDraft.includes('changedStrategySpecTopLevelFields(strategy, applied.strategy)'));
  assert.ok(nextDraft.includes('userAttestedTestWindowSeenBeforeChange: true'));
  assert.ok(nextDraft.includes('iterationNumber: persistedParentRun.iterationNumber + 1'));
  assert.ok(edits.includes('approval === null && experimentLineage.parentRunId !== null && parentApproval'));
  assert.ok(edits.includes('changedStrategySpecTopLevelFields(parentApproval.spec, next)'));
  assert.ok(edits.includes('clearAfterSpec(nextLineage)'));
  assert.match(confirmation, /if \(!next && approval\) \{[\s\S]*?setParentApproval\(approval\);[\s\S]*?setExperimentLineage\(rootExperimentLineage\(\)\);[\s\S]*?\}/);
  assert.equal((confirmation.match(/setExperimentLineage\(rootExperimentLineage\(\)\)/g) ?? []).length, 1);
});
test('persisted approved versions cannot be edited into a root experiment lineage', () => {
  const component = readWorkspaceSource();
  const startDraft = component.slice(component.indexOf('const startDraft'), component.indexOf('const mutateSpec'));
  const edits = component.slice(component.indexOf('const mutateSpec'), component.indexOf('const setRecoverableError'));

  assert.ok(component.includes('const immutableApprovedVersion = approved && persistedVersion !== null;'));
  for (const section of [startDraft, edits]) {
    const guard = section.indexOf('if (immutableApprovedVersion)');
    const mutation = section.indexOf('clearAfterSpec(');
    assert.ok(guard >= 0 && mutation > guard, 'persisted-version edit paths must fail closed before lineage reset');
    assert.ok(section.includes('setError(c.immutableApprovedVersionNotice)'));
  }
  assert.ok(component.includes('disabled={immutableApprovedVersion}'));
  assert.ok(component.includes('disabled={mode !== "pro" || immutableApprovedVersion}'));
  assert.ok(component.includes('disabled={disabled || rules.length <= 1}'));
});


test("Strategy Lab remains direct-preview only and is absent from cabinet navigation", () => {
  const nav = readFileSync(new URL("../nav.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const component = readFileSync(new URL("./strategy-lab-workspace.tsx", import.meta.url), "utf8");

  assert.ok(!nav.includes("/app/strategy-lab"));
  assert.ok(page.includes("strategyLabPreviewEnabled()"));
  assert.ok(page.includes("paidAiAvailable={strategyLabPaidAiEnabled()}"));
  assert.ok(!page.includes("FLAGS.strategyLab.preview"));
  assert.ok(component.includes("dir={localeDir(locale)}"));
  assert.ok(component.includes("root.dir = localeDir(locale)"));
  assert.ok(component.includes("confirmAdversarialReview: true"));
  assert.ok(component.includes("paidAiAvailable: boolean"));
  assert.ok(component.includes("!paidAiAvailable || busy !== null || !formalizePaidConfirmed"));
  assert.ok(component.includes("paidAiAvailable ? c.aiNote : c.aiUnavailable"));
  assert.ok(component.includes("applyReviewChanges"));
});

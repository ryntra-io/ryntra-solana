import { LEGAL_RELEASE_FACTS } from "./release-facts.ts";

export type LegalSignoff = {
  name: string | null;
  role: string | null;
  organization: string | null;
  signedAt: string | null;
  version: string | null;
  contentDigest: string | null;
  evidenceReference: string | null;
};

export const LEGAL_PACKAGE = {
  ...LEGAL_RELEASE_FACTS,
  contentDigest: "sha256:7406041118274517c4826b1506889ee09abc24350862336154684a8aab149c2c",
  founderSignoff: {
    name: null,
    role: null,
    organization: null,
    signedAt: null,
    version: null,
    contentDigest: null,
    evidenceReference: null,
  } satisfies LegalSignoff,
  counselSignoff: {
    name: null,
    role: null,
    organization: null,
    signedAt: null,
    version: null,
    contentDigest: null,
    evidenceReference: null,
  } satisfies LegalSignoff,
} as const;

function contentDigestValid(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

function signoffComplete(
  signoff: LegalSignoff,
  version: string,
  contentDigest: string,
): boolean {
  return Boolean(
    signoff.name
    && signoff.role
    && signoff.organization
    && signoff.signedAt
    && signoff.version === version
    && signoff.contentDigest === contentDigest
    && signoff.evidenceReference
  );
}

export function legalPackageReady(pkg = LEGAL_PACKAGE): boolean {
  return pkg.status === "effective"
    && contentDigestValid(pkg.contentDigest)
    && Boolean(
      pkg.operator.legalName
      && pkg.operator.legalForm
      && pkg.operator.registrationNumber
      && pkg.operator.country
      && pkg.operator.address
      && pkg.controller.legalName
      && pkg.controller.establishment
      && pkg.controller.euRepresentativeDecisionApproved
      && pkg.controller.dpoDecisionApproved
      && pkg.contract.governingLaw
      && pkg.contract.forumOrAdr
      && pkg.contract.targetMarkets.length > 0
      && pkg.contract.acceptanceMechanismApproved
      && pkg.contract.languagePlanApproved
      && pkg.contract.noticeMechanismApproved
      && pkg.privacy.lawfulBasesApproved
      && pkg.privacy.controllerProcessorRolesApproved
      && pkg.privacy.transferMechanism
      && pkg.privacy.serverRetentionScheduleApproved
      && pkg.privacy.backupDeletionScheduleApproved
      && pkg.privacy.processorInventoryApproved
      && pkg.privacy.cookieStorageAssessmentApproved
      && pkg.privacy.dataSubjectRightsWorkflowApproved
      && pkg.privacy.incidentResponseApproved
      && pkg.privacy.dpiaRopaDecisionApproved
      && pkg.issuer.counselReviewed
      && pkg.ai.counselReviewed
      && signoffComplete(pkg.founderSignoff, pkg.id, pkg.contentDigest)
      && signoffComplete(pkg.counselSignoff, pkg.id, pkg.contentDigest)
    );
}
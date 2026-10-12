export type LegalPackageStatus = "review-candidate" | "effective";

/**
 * The facts a legal release is signed against: the candidate of `/legal/review/*` rewritten for the product
 * that exists, English and Ukrainian, with the Android app's privacy. What
 * only the operator and counsel can supply stays `null` or `false`, and
 * `legalPackageReady` refuses the package until it is supplied and signed.
 *
 * The candidate of 2026-07-15 described a venue, an issuer and a referral path
 * the product no longer has.
 */
export const LEGAL_RELEASE_FACTS = {
  /* Public: the version appears on the candidate pages, so it names a date, never an internal id. */
  id: "2026-09-26-rc1",
  status: "review-candidate" as LegalPackageStatus,
  verifiedThrough: "2026-09-26",
  operator: {
    legalName: null as string | null,
    legalForm: null as string | null,
    registrationNumber: null as string | null,
    taxNumber: null as string | null,
    country: null as string | null,
    address: null as string | null,
  },
  controller: {
    legalName: null as string | null,
    establishment: null as string | null,
    euRepresentative: null as string | null,
    dpoContact: null as string | null,
    euRepresentativeDecisionApproved: false,
    dpoDecisionApproved: false,
  },
  contract: {
    governingLaw: null as string | null,
    forumOrAdr: null as string | null,
    targetMarkets: [] as string[],
    acceptanceMechanismApproved: false,
    languagePlanApproved: false,
    noticeMechanismApproved: false,
  },
  privacy: {
    lawfulBasesApproved: false,
    controllerProcessorRolesApproved: false,
    transferMechanism: null as string | null,
    serverRetentionScheduleApproved: false,
    backupDeletionScheduleApproved: false,
    processorInventoryApproved: false,
    cookieStorageAssessmentApproved: false,
    dataSubjectRightsWorkflowApproved: false,
    incidentResponseApproved: false,
    dpiaRopaDecisionApproved: false,
  },
  issuer: {
    /* Each issuer's own documents decide who may hold its token. */
    documents: ["xStocks", "Backpack", "Ondo", "PreStocks"] as string[],
    /* Whether a person in Ukraine may hold each token has not been verified. */
    ukraineVerified: false,
    /* Standing policy: Ryntra adds no country list of its own on top of the issuers'. */
    ryntraIssuerCountryDenylistEnabled: false,
    counselReviewed: false,
  },
  ai: {
    /* The assistant's requests carry `store: false` (`lib/agent/model.ts`); the provider's own retention is its terms'. */
    providerStoreDisabled: true,
    /* Every screen where the assistant speaks says it is AI. */
    transparencyLabelShown: true,
    counselReviewed: false,
  },
  android: {
    /* The app is not released; its privacy is written ahead of the store package. */
    released: false,
    pushProviderConfigured: false,
  },
} as const;

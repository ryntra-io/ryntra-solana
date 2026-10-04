/**
 * Compile-time proof that the consumed routes' schemas (contract 1.11.0)
 * agree with the types the routes build their answers from — in both
 * directions, so a field added to a route's answer without its schema, or to
 * a schema without the route, fails `tsc`, which the repository's typecheck
 * runs. The routes' tests parse the answers themselves; this file holds the
 * types to the same shapes. No runtime.
 */

import type { z } from "zod";

import type { SlimStockRow } from "../../../app/app/stocks/stock-model.ts";
import type { NormalizedCandle } from "../../chart/types.ts";
import type { TokenCatalogEntry } from "../../solana/catalog.ts";
import type { SpotCandlesRead, SpotPool } from "../../spot/candles.ts";
import type { SpotMarket, SpotMarketListRow } from "../../spot/markets.ts";
import type { SpotMarketsRead } from "../../spot/markets.server.ts";
import type { OnchainMint, StockAsset } from "../../stocks/asset.server.ts";
import type { StockQuote } from "../../stocks/quote.server.ts";
import type { SwapCheck } from "../../stocks/check.ts";
import type { PopularCard } from "../../stocks/popular.ts";
import type { PositionView } from "../../monitoring/positions.ts";
import type { PortfolioRisk, RiskFinding } from "../../monitoring/portfolio-risk.ts";
import type { StockRow, StockUniverse } from "../../stocks/universe.server.ts";
import type { ActionFeeState, SolanaActionFee, SolanaActionLane, SolanaActionMovement, SolanaActionOutcome, SolanaWalletAction } from "../../solana/action-ledger.ts";
import type { SolanaActionDestination } from "../../solana/action-lanes.ts";
import type { ArchivedReceipt, walletReceiptsPut } from "../../account/rpc.ts";
import type { RewardRow, RewardRowKind, RewardsView } from "../../rewards/view.ts";
import type { RewardBalance, RewardPendingReason } from "../../rewards/balance.ts";
import type { RewardClaim, RewardClaimState } from "../../rewards/claim.ts";
import type { ReferralRefusalCode } from "../../rewards/referral.ts";
import type { PointsView } from "../../points/view.ts";
import type { MonitoringSurface, SurfaceCard } from "../../monitoring/service.server.ts";
import type { InboxFinding, InboxRecord, InboxRuleState, InboxSubject, InboxSubjectKind, MonitorSubject, MonitorSubjectKind, PreferencesRecord } from "../../monitoring/store.ts";
import type { RuleSchedule } from "../../autoinvest/schedule.ts";
import type { projectBudget } from "../../autoinvest/service.ts";
import type { AutoinvestRuleRecord, StoredDip, StoredOccurrence, StoredPayments } from "../../autoinvest/store.ts";
import type { projectPayments } from "../../autoinvest/model.ts";
import type { ConditionKind, FindingFacts, FindingOutcome, MonitorStatus } from "../../monitoring/engine.ts";
import type { QuietHours } from "../../monitoring/quiet-hours.ts";
import type { OutcomeReceiptArtifact } from "../../agent-control/artifacts.ts";
import type { SolanaActionOrigin, SolanaActionOriginRequest } from "../../solana/action-origin.ts";
import type { SolanaAssetPassportSchema, SolanaPolicyVerdict, SplTransferPreflight } from "../../solana/contracts.ts";
import type { JupiterExecutableOrder, JupiterExecutableOrderFailure, JupiterExecuteFailure, JupiterExecuteReport, JupiterOrderFailure, JupiterOrderQuote } from "../../solana/quotes.ts";
import type { ReserveSendAttemptResult, SendAttemptState } from "../../solana/send-attempt.ts";
import type { SwapAdoptionRefusalCode } from "../../solana/swap-adoption.ts";
import type { SwapCarrier } from "../../solana/swap-carrier.ts";
import type { SwapClientReviewAssessment } from "../../solana/swap-client-safety.ts";
import type { SwapEffectRefusalCode, SwapOwnerEffectProof } from "../../solana/swap-effect-firewall.ts";
import type { SwapExecutionBundle, SwapExecutionBundleSchema, SwapExecutionInspectionSchema, SwapExecutionProof, SwapExecutionSimulationSchema } from "../../solana/swap-execution-review.ts";
import type { SwapObservationFailure, SwapObservationResult } from "../../solana/swap-observe.ts";
import type { readSwapOwnerLock, SwapOwnerLockState } from "../../solana/swap-owner-lock.ts";
import type { SwapPolicyIntent, SwapPolicyVerdict } from "../../solana/swap-policy.ts";
import type { SWAP_POLICY_RULES } from "../../solana/swap-policy-rules.ts";
import type { SwapReceiptFacts } from "../../solana/swap-receipt.ts";
import type { recoverUnrecordedSwap, SwapRecoveryResult } from "../../solana/swap-recovery.ts";
import type { SwapQuoteReview } from "../../solana/swap-review.ts";
import type { SwapTransactionRefusal } from "../../solana/swap-transaction-check.ts";
import type { SolanaAssetPassport } from "../../solana/types.ts";
/* 1.22.0 — the consumed transfer routes; the lib types their answers are built from. */
import type { NATIVE_SOL_TRANSFER_ACTION_REF, SendTransferInputSchema, SPL_TRANSFER_ACTION_REF, SplTransferObservation } from "../../agent-control/adapters/solana-token-2022.ts";
import type { Reconciliation } from "../../agent-control/reconcile.ts";
import type { ArtifactVerification } from "../../agent-control/verify.ts";
import type { CanaryFlowDecision } from "../../solana/canary-runtime.ts";
import type { SOLANA_CANARY_DECISIONS, SOLANA_CANARY_FAMILIES, SOLANA_CANARY_RULES, SolanaCanaryIntent, SolanaCanaryVerdict } from "../../solana/canary-policy.ts";
import type { MintReadFailure } from "../../solana/mint.ts";
import type { ObserveResult, TransferObservation as ObservedTransfer } from "../../solana/observe.ts";
import type { ReceiptMintFailure } from "../../solana/outcome.ts";
import type { PreflightFailure } from "../../solana/preflight.ts";
import type { EffectReadback, RecoveryFactsWithStatusRead, SignatureStatusRpcRead } from "../../solana/recover.ts";
import type { SendReviewBundle, SendReviewProof } from "../../solana/review-proof.ts";
import type { ReadSendAttemptResult, SendAttemptRecord } from "../../solana/send-attempt.ts";
import type { SEND_ACTION_KINDS } from "../../solana/send-kinds.ts";
import type { SendState } from "../../solana/send-lifecycle.ts";
import type { SolanaSendReceiptFacts } from "../../solana/send-receipt.ts";
import type { SEND_SAFETY_DECISIONS, SendSafetyVerdict } from "../../solana/send-safety.ts";
import type { SEND_SUPPORT_DECISIONS, SendSupportVerdict } from "../../solana/send-support.ts";
import type { SettlementRequest, SettlementRequestSchema, SettlementResult, SettlementValidationFailure, TransferPlanSchema as SettlementPlanSchema } from "../../solana/settlement.ts";
import type { SubmitFailure } from "../../solana/submit.ts";
import type { TransferBuildFailure, TransferPlan as BuiltTransferPlan } from "../../solana/transaction.ts";
import type { WalletAdoptionResult } from "../../solana/wallet-adoption.ts";
import type {
  TRANSFER_ACTION_KINDS_V1,
  TRANSFER_ADOPT_ERROR_CODES_V1,
  TRANSFER_BUILD_ERROR_CODES_V1,
  TRANSFER_CANARY_DECISIONS_V1,
  TRANSFER_CANARY_FAMILIES_V1,
  TRANSFER_CANARY_RULES_V1,
  TRANSFER_MINT_ERROR_CODES_V1,
  TRANSFER_NATIVE_SOL_ACTION_REF,
  TRANSFER_PLAN_ERROR_CODES_V1,
  TRANSFER_RECOVER_ERROR_CODES_V1,
  TRANSFER_SAFETY_DECISIONS_V1,
  TRANSFER_SETTLE_ERROR_CODES_V1,
  TRANSFER_SETTLE_STATES_V1,
  TRANSFER_SPL_ACTION_REF,
  TRANSFER_SUPPORT_DECISIONS_V1,
  TransferAdoptedReviewSchema,
  TransferCanaryIntentSchema,
  TransferCanaryVerdictSchema,
  TransferInputSchema,
  TransferObservationSchema,
  TransferPlanRequestSchema,
  TransferPlanSchema,
  TransferPolicyVerdictSchema,
  TransferPreflightSchema,
  TransferProviderSchema,
  TransferReceiptFactsSchema,
  TransferReceiptSchema,
  TransferReconciliationSchema,
  TransferRecoverySchema,
  TransferReviewProofSchema,
  TransferReviewSchema,
  TransferSafetySchema,
  TransferSettledSchema,
  TransferSettleRecoverySchema,
  TransferSettleRequestSchema,
  TransferSettleResultSchema,
  TransferSignedReviewProofSchema,
  TransferStatusReadSchema,
  TransferSupportSchema,
  TransferVerificationSchema,
} from "./contract.ts";
import type { PayLink as PayLinkView } from "../../pay/link.ts";
import type { PaymentExpiration, PublicPaymentStatus, PublicPaymentStatusView } from "../../pay/model.ts";
import type { PublicPaymentView } from "../../pay/public.ts";
import type { PaymentSubmitFailure, PaymentTransactionFailure, PaymentTransactionSuccess } from "../../pay/transaction.ts";
import type { BytesCheckVerdict } from "../../solana/fingerprint.client.ts";
import type { RecipientCheck, RecipientProblem } from "../../solana/recipient-check.server.ts";
import type { SendCheck } from "../../solana/send-check.ts";
import type { ReturnedAnswer } from "../../solana/send-returned.ts";
import type {
  PAY_SUBMIT_ERROR_CODES_V1,
  PAY_TRANSACTION_ERROR_CODES_V1,
  PayPublicViewSchema,
  PaySubmitResponseSchema,
  PayTransactionResponseSchema,
  PAY_LINK_EXPIRATIONS,
  PAY_LINK_NOTES,
  PAY_LINK_STATUSES,
  PayLinkCreateRequestSchema,
  PayLinkSchema,
  RECIPIENT_PROBLEMS,
  RecipientCheckResponseSchema,
  SEND_RETURNED_VERDICTS,
  SendReturnedResponseSchema,
  TransferCheckSchema,
} from "./contract.ts";
import type { LifecycleEvent } from "../../stocks/instrument.ts";
import type { RyntraServiceFee, ServiceFeeSchema } from "../../swap/service-fee.ts";
import type { PredictionFailure, PredictionFailureCode } from "../../predictions/failure.ts";
import type { LinkChallenge, verifyLink } from "../../predictions/link.ts";
import type { PaperBalance, PaperExecution, PaperOrder, PaperPosition, PredictionBook, PredictionBookLevel, PredictionCategory, PredictionChart, PredictionEngineState, PredictionEvent, PredictionEventSummary, PredictionMarket, PredictionMarketPrices, PredictionNews, PredictionOutcome, PredictionRelatedMarket, PredictionRipple, PredictionRoute, PredictionSettlement, PredictionSignals, PredictionVenueBook, PredictionVenueMarket, PredictionVenuePrice } from "../../predictions/model.ts";
import type { PaperAccountView, PaperReview, PredictionOrderRecord, QuoteInput, QuoteResult, ReviewCheck, placePaper } from "../../predictions/paper.ts";
import type { PredictionMonitorCondition, PredictionPlan, PredictionPlanCreateSchema, PredictionPlanJournalEntry, PredictionPlanRules, PredictionPlanSizing, PredictionPlanStatusSchema, PredictionPlanUpdateSchema, PredictionPlanVersion } from "../../predictions/plan-model.ts";
import type { DiscoverPage, DiscoverQuery } from "../../predictions/provider.ts";
import type { LinkStatus } from "../../predictions/session.ts";
import type { WatchEntry } from "../../predictions/watchlist.ts";
import type {
  ACTIVITY_DESTINATIONS_V1,
  ACTIVITY_FEE_STATES_V1,
  ACTIVITY_LANES_V1,
  ACTIVITY_OUTCOMES_V1,
  ActivityActionSchema,
  ActivityResponseSchema,
  HoldingsCatalogEntrySchema,
  MONITOR_CONDITION_KINDS_V1,
  MONITOR_FINDING_OUTCOMES_V1,
  MONITOR_STATUSES_V1,
  MONITOR_SUBJECT_KINDS_V1,
  MONITOR_NOTE_SUBJECT_KINDS_V1,
  MonitoringCardSchema,
  MonitoringNoteSchema,
  AutoinvestRuleSchema,
  RuleBindingSchema,
  RuleBudgetSchema,
  RuleOccurrenceSchema,
  RuleScheduleSchema,
  MonitoringPreferencesRequestSchema,
  MonitoringPreferencesSchema,
  MonitoringSurfaceResponseSchema,
  PredictionBookLevelSchema,
  PredictionBookSchema,
  PredictionCategorySchema,
  PredictionChartSchema,
  PredictionEngineStateSchema,
  PredictionEventSchema,
  PredictionEventSummarySchema,
  PredictionFailureValueSchema,
  PredictionLinkChallengeSchema,
  PredictionLinkStatusSchema,
  PredictionMarketPricesSchema,
  PredictionMarketSchema,
  PredictionMonitorConditionSchema,
  PredictionNewsSchema,
  PredictionOrderRecordSchema,
  PredictionOutcomeSchema,
  PredictionPaperBalanceSchema,
  PredictionPaperExecutionSchema,
  PredictionPaperOrderSchema,
  PredictionPaperPositionSchema,
  PredictionPaperReviewSchema,
  PredictionPlanJournalSchema,
  PredictionPlanRulesSchema,
  PredictionPlanSchema,
  PredictionPlanSizingSchema,
  PredictionPlanVersionSchema,
  PredictionRelatedMarketSchema,
  PredictionReviewCheckSchema,
  PredictionRippleSchema,
  PredictionRouteSchema,
  PredictionsAccountResponseSchema,
  PredictionsBookResponseSchema,
  PredictionsChartResponseSchema,
  PredictionsDiscoverResponseSchema,
  PredictionsEngineResponseSchema,
  PredictionSettlementSchema,
  PredictionsEventResponseSchema,
  PredictionsEventsResponseSchema,
  PredictionsFailureSchema,
  PredictionSignalsSchema,
  PredictionsLinkResponseSchema,
  PredictionsLinkStartResponseSchema,
  PredictionsLinkVerifyRequestSchema,
  PredictionsOrderPlacedResponseSchema,
  PredictionsOrderResponseSchema,
  PredictionsOrdersRequestSchema,
  PredictionsOrdersResponseSchema,
  PredictionsPlanRequestSchema,
  PredictionsPlanResponseSchema,
  PredictionsPlansRequestSchema,
  PredictionsPlansResponseSchema,
  PredictionsPlanStatusRequestSchema,
  PredictionsPricesResponseSchema,
  PredictionsQuoteRequestSchema,
  PredictionsQuoteResponseSchema,
  PredictionsResearchResponseSchema,
  PredictionsWatchlistRequestSchema,
  PredictionsWatchlistResponseSchema,
  PredictionVenueBookSchema,
  PredictionVenueMarketSchema,
  PredictionVenuePriceSchema,
  PredictionWatchEntrySchema,
  RECEIPT_KINDS_V1,
  ReceiptsArchivePutRequestSchema,
  ReceiptsArchiveRowSchema,
  REFERRAL_REFUSALS_V1,
  REWARD_CLAIM_STATES_V1,
  REWARD_PENDING_REASONS_V1,
  REWARD_ROW_KINDS_V1,
  RewardsPointsSchema,
  RewardsResponseSchema,
  RewardsRowSchema,
  SpotCandleSchema,
  SpotCandlesResponseSchema,
  SpotMarketListRowSchema,
  SpotMarketSchema,
  SpotMarketsResponseSchema,
  SpotPoolSchema,
  StockAssetResponseSchema,
  StockOnchainMintSchema,
  StockQuoteResponseSchema,
  StockRowSchema,
  StockSlimRowSchema,
  StockUniverseResponseSchema,
  SWAP_CARRIER_ERROR_CODES_V1,
  SWAP_EXECUTE_ERROR_CODES_V1,
  SWAP_ORDER_ERROR_CODES_V1,
  SWAP_OWNER_LOCK_ERROR_CODES_V1,
  SWAP_OWNER_LOCK_STATES_V1,
  SWAP_POLICY_RULES_V1,
  SWAP_QUOTE_ERROR_CODES_V1,
  SwapAssetVerdictSchema,
  SwapBundleRequestSchema,
  SwapBundleSchema,
  SwapExecuteErrorSchema,
  SwapExecuteReportSchema,
  SwapExecuteResponseSchema,
  SwapFactsSchema,
  SwapInspectionSchema,
  SwapIntentSchema,
  SwapJupiterOrderSchema,
  SwapJupiterQuoteSchema,
  SwapObservationSchema,
  SwapOrderErrorSchema,
  SwapOriginRequestSchema,
  SwapOriginSchema,
  SwapOwnerEffectsSchema,
  SwapPassportSchema,
  SwapPreSignSchema,
  SwapProofSchema,
  SwapQuoteErrorSchema,
  SwapQuoteResponseSchema,
  SwapReceiptSchema,
  SwapRecoverResponseSchema,
  SwapReviewSchema,
  SwapServiceFeeSchema,
  SwapSignedProofSchema,
  SwapSimulationSchema,
  SwapVerdictSchema,
  PopularCompanySchema,
  SwapCheckSchema,
  PositionWatchViewSchema,
  PortfolioRiskFindingSchema,
  PortfolioRiskSchema,
} from "./contract.ts";

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
type DeepMutable<T> = T extends readonly (infer U)[] ? DeepMutable<U>[] : T extends object ? { -readonly [K in keyof T]: DeepMutable<T[K]> } : T;
type Same<A, B> = Mutual<DeepMutable<A>, DeepMutable<B>>;

/** One way only: every value of A is a B — for an answer the lib types more loosely than the route serves it. */
type Within<A, B> = [DeepMutable<A>] extends [DeepMutable<B>] ? true : never;

/**
 * `POST /api/solana/transfer/plan` builds its answer inline: these are the
 * types of what it puts in each key. `check` (1.22.0) is left out here: it is
 * `TransferCheckSchema`, proven against `SendCheck` where that schema is.
 */
type TransferReviewServed = {
  passport: SolanaAssetPassport | null;
  preflight: SplTransferPreflight;
  verdict: SolanaPolicyVerdict;
  plan: BuiltTransferPlan;
  provider: SendReviewBundle["provider"];
  canaryIntent: SolanaCanaryIntent;
  canaryVerdict: SolanaCanaryVerdict;
  support: SendSupportVerdict;
  safety: SendSafetyVerdict;
  reviewProof: SendReviewProof;
};

/**
 * 1.14.0: the stock schemas keep the disconnected pre-IPO issuer's values —
 * its issuer id, its mark's source, its rights, its catalogue's key — so a
 * record written before still parses, and no route builds them any more.
 * `Current<>` takes exactly those values out of a schema's output, so the
 * equality in both directions still holds for everything a route builds
 * today: a field added on one side alone fails as before, and a historical
 * value can never come back into a route's type.
 */
type Historical = "tessera" | "issuer-tessera" | "loan-participation";
type Current<T> = T extends Historical ? never : T extends readonly (infer U)[] ? Current<U>[] : T extends object ? { [K in keyof T as K extends Historical ? never : K]: Current<T[K]> } : T;

/* A candle's time is the chart library's branded Unix-seconds number; on the wire it is a plain number. */
type WireCandle = Omit<NormalizedCandle, "time"> & { time: number };

/** `POST /api/solana/activity` builds its answer inline: the ledger's rows (the lane re-read and the symbol overlay keep the type), the view's rows or null. */
type ActivityServed = { data: { actions: SolanaWalletAction[]; rewards: RewardRow[] | null; complete: boolean; coverage: "RYNTRA_ACTIONS" } };

/**
 * `GET /api/rewards` builds its answer inline from `RewardsView`, the balance and
 * the points view: `bySource`'s bigints become decimal strings, `referral` is
 * never null on this route, `claim.state` is `RewardClaim`'s own state (the view
 * widens it to `string`; `RewardClaim` is its only producer), and `points`
 * carries `excluded` beside the view.
 */
type RewardsServed = {
  ok: true;
  address: string;
  available: RewardsView["available"];
  pending: RewardsView["pending"];
  lifetime: RewardsView["lifetime"];
  cashback: RewardsView["cashback"];
  referralL1: RewardsView["referralL1"];
  referralL2: RewardsView["referralL2"];
  sourceAmounts: { [K in keyof RewardBalance["bySource"]]: string };
  claimable: RewardBalance["claimable"];
  claimBlockedReason: RewardBalance["claimBlockedReason"];
  pendingReasons: RewardBalance["pendingReasons"];
  referrals: RewardsView["referrals"];
  rows: RewardsView["rows"];
  referral: NonNullable<RewardsView["referral"]>;
  claim: (Omit<NonNullable<RewardsView["claim"]>, "state"> & { state: RewardClaim["state"] }) | null;
  invitedBy: string | null;
  points: (PointsView & { excluded: boolean }) | null;
  started: boolean;
};

/** What a preferences write can set: the three fields of the record, each left out to keep its value. */
type MonitoringPreferencesWrite = Partial<Pick<PreferencesRecord, "telegram" | "push" | "quietHours">>;

/* predictions — for lib/api/v1/route-types.test.ts */

/* 1. imports (paths relative to lib/api/v1/; `import type` only) */

/* The research route's own `Part<T>` (local to its file), restated: a part's answer, or the code it failed with. */
type PredictionResearchPart<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: PredictionFailureCode }>;

export type RouteChecks = [
  /* holdings: the catalogue entry each row carries (the rows themselves are parsed in the route's own test) */
  Same<z.output<typeof HoldingsCatalogEntrySchema>, TokenCatalogEntry>,
  /* markets */
  Same<z.output<typeof SpotMarketListRowSchema>, SpotMarketListRow>,
  Same<z.output<typeof SpotMarketSchema>, SpotMarket>,
  Same<z.output<typeof SpotMarketsResponseSchema>["source"], SpotMarketsRead["source"] | undefined>,
  Same<z.output<typeof SpotPoolSchema>, SpotPool>,
  Same<z.output<typeof SpotCandleSchema>, WireCandle>,
  Same<z.output<typeof SpotCandlesResponseSchema>, Omit<SpotCandlesRead, "ok" | "candles"> & { candles: WireCandle[]; limit?: number; available?: number }>,
  /* stocks — 1.14.0: without the values kept for old records (`Current<>`) */
  Same<Current<z.output<typeof StockRowSchema>>, StockRow>,
  Same<Current<z.output<typeof StockUniverseResponseSchema>>, StockUniverse>,
  Same<Current<z.output<typeof StockSlimRowSchema>>, SlimStockRow>,
  Same<z.output<typeof StockOnchainMintSchema>, OnchainMint>,
  Same<Current<z.output<typeof StockAssetResponseSchema>>, StockAsset>,
  Same<Current<z.output<typeof StockQuoteResponseSchema>>, StockQuote>,
  /* 1.20.0 — «Популярне» and «Перевірка»: the server's own types, both ways */
  Same<z.output<typeof PopularCompanySchema>, PopularCard>,
  Same<z.output<typeof SwapCheckSchema>, SwapCheck>,
  /* 1.21.0 — Нагляд over positions: the position the server composes, both ways */
  Same<z.output<typeof PositionWatchViewSchema>, PositionView>,
  /* activity, receipts, rewards, monitoring */
  Same<z.output<typeof ActivityActionSchema>, SolanaWalletAction>,
  Same<NonNullable<z.output<typeof ActivityActionSchema>["out"]>, SolanaActionMovement>,
  Same<NonNullable<z.output<typeof ActivityActionSchema>["fee"]>, SolanaActionFee>,
  Same<NonNullable<z.output<typeof ActivityActionSchema>["origin"]>, SolanaActionOrigin>,
  Same<(typeof ACTIVITY_LANES_V1)[number], SolanaActionLane>,
  Same<(typeof ACTIVITY_OUTCOMES_V1)[number], SolanaActionOutcome>,
  Same<(typeof ACTIVITY_DESTINATIONS_V1)[number], SolanaActionDestination>,
  Same<(typeof ACTIVITY_FEE_STATES_V1)[number], ActionFeeState>,
  Same<z.output<typeof ActivityResponseSchema>, ActivityServed>,
  /* receipts archive */
  Same<z.output<typeof ReceiptsArchiveRowSchema>, ArchivedReceipt>,
  Same<(typeof RECEIPT_KINDS_V1)[number], ArchivedReceipt["kind"]>,
  /* the PUT row is the row the store function takes */
  Same<z.output<typeof ReceiptsArchivePutRequestSchema>["rows"][number], Parameters<typeof walletReceiptsPut>[2][number]>,
  /* rewards */
  Same<z.output<typeof RewardsRowSchema>, RewardRow>,
  Same<(typeof REWARD_ROW_KINDS_V1)[number], RewardRowKind>,
  Same<(typeof REWARD_PENDING_REASONS_V1)[number], RewardPendingReason>,
  Same<(typeof REWARD_CLAIM_STATES_V1)[number], RewardClaimState>,
  Same<z.output<typeof RewardsPointsSchema>, PointsView & { excluded: boolean }>,
  Same<z.output<typeof RewardsResponseSchema>, RewardsServed>,
  Same<(typeof REFERRAL_REFUSALS_V1)[number], ReferralRefusalCode>,
  /* monitoring */
  Same<z.output<typeof MonitoringCardSchema>, SurfaceCard>,
  Same<z.output<typeof MonitoringNoteSchema>, InboxRecord>,
  Same<Omit<z.output<typeof MonitoringSurfaceResponseSchema>, "preferences">, MonitoringSurface>,
  Same<z.output<typeof MonitoringPreferencesSchema>, Pick<PreferencesRecord, "telegram" | "push" | "quietHours">>,
  Same<NonNullable<z.output<typeof MonitoringPreferencesSchema>["quietHours"]>, QuietHours>,
  Same<z.output<typeof MonitoringCardSchema>["subject"], MonitorSubject>,
  /* 1.12.0: a note may be an autoinvest rule's reminder; a card never is */
  Same<NonNullable<z.output<typeof MonitoringNoteSchema>["subject"]>, InboxSubject>,
  Same<(typeof MONITOR_NOTE_SUBJECT_KINDS_V1)[number], InboxSubjectKind>,
  Same<NonNullable<z.output<typeof MonitoringCardSchema>["finding"]>, InboxFinding>,
  Same<NonNullable<z.output<typeof MonitoringCardSchema>["finding"]>["facts"], FindingFacts>,
  Same<(typeof MONITOR_STATUSES_V1)[number], MonitorStatus>,
  Same<(typeof MONITOR_SUBJECT_KINDS_V1)[number], MonitorSubjectKind>,
  Same<(typeof MONITOR_CONDITION_KINDS_V1)[number], ConditionKind>,
  Same<(typeof MONITOR_FINDING_OUTCOMES_V1)[number], FindingOutcome>,
  /* the preferences write is exactly what the record lets a write set */
  Same<z.output<typeof MonitoringPreferencesRequestSchema>, MonitoringPreferencesWrite>,
  /* mutual assignability cannot see a missing optional key: the key sets of the shapes with optional keys, compared outright */
  Same<keyof z.output<typeof MonitoringNoteSchema>, keyof InboxRecord>,
  Same<keyof NonNullable<z.output<typeof MonitoringCardSchema>["finding"]>["facts"], keyof FindingFacts>,
  Same<keyof NonNullable<z.output<typeof ActivityActionSchema>["origin"]>, keyof SolanaActionOrigin>,
  Same<keyof z.output<typeof ReceiptsArchivePutRequestSchema>["rows"][number], keyof Parameters<typeof walletReceiptsPut>[2][number]>,
  Same<keyof z.output<typeof MonitoringPreferencesRequestSchema>, keyof MonitoringPreferencesWrite>,
  /* the swap routes */
  Same<z.output<typeof SwapServiceFeeSchema>, RyntraServiceFee>,
  Same<z.output<typeof SwapServiceFeeSchema>, z.output<typeof ServiceFeeSchema>>,
  Same<z.output<typeof SwapJupiterQuoteSchema>, JupiterOrderQuote>,
  Same<z.output<typeof SwapJupiterOrderSchema>, JupiterExecutableOrder>,
  Same<z.output<typeof SwapReviewSchema>, SwapQuoteReview>,
  /* the asset */
  Same<z.output<typeof SwapPassportSchema>, SolanaAssetPassport>,
  Same<z.output<typeof SwapPassportSchema>, z.output<typeof SolanaAssetPassportSchema>>,
  Same<z.output<typeof SwapAssetVerdictSchema>, SolanaPolicyVerdict>,
  /* the route serves three of the preflight's six transfer-fee fields */
  Same<z.output<typeof SwapQuoteResponseSchema>["outputFee"], Pick<SplTransferPreflight["transferFee"], "basisPoints" | "feeRaw" | "capApplied">>,
  /* the exact bytes, the policy, the bundle, the proof */
  Same<z.output<typeof SwapInspectionSchema>, z.output<typeof SwapExecutionInspectionSchema>>,
  Same<z.output<typeof SwapOwnerEffectsSchema>, SwapOwnerEffectProof>,
  Same<z.output<typeof SwapSimulationSchema>, z.output<typeof SwapExecutionSimulationSchema>>,
  Same<z.output<typeof SwapIntentSchema>, SwapPolicyIntent>,
  Same<z.output<typeof SwapVerdictSchema>, SwapPolicyVerdict>,
  /* the rule list in its order, not only as a set */
  Mutual<typeof SWAP_POLICY_RULES_V1, typeof SWAP_POLICY_RULES>,
  Same<z.output<typeof SwapOriginSchema>, SolanaActionOrigin>,
  Same<z.output<typeof SwapOriginRequestSchema>, SolanaActionOriginRequest>,
  /* 1.12.0 — the rule a purchase was made under travels unchanged from the order onto the History row */
  Same<z.output<typeof RuleBindingSchema>, NonNullable<SolanaActionOrigin["rule"]>>,
  /* 1.12.0 — «Автоінвест»: the wire's schedule is the schedule the tick counts with; the stored rule is the wire's rule plus its language and revision, an occurrence the wire's without `pending` (read from History, never stored) */
  Same<z.output<typeof RuleScheduleSchema>, RuleSchedule>,
  Same<Omit<z.output<typeof AutoinvestRuleSchema>, "occurrences" | "dip" | "payments">, Omit<AutoinvestRuleRecord, "schema" | "schemaVersion" | "locale" | "version" | "occurrences" | "dip" | "payments">>,
  /* 1.19.0: a «З кожної оплати» rule's terms on the wire are the stored ones, and its whole state is what the projection says. */
  Same<Pick<NonNullable<z.output<typeof AutoinvestRuleSchema>["payments"]>, "mode" | "roundToUsd" | "fixedUsd" | "percent" | "timeZone" | "since" | "gatheredCount">, Pick<StoredPayments, "mode" | "roundToUsd" | "fixedUsd" | "percent" | "timeZone" | "since" | "gatheredCount">>,
  Same<NonNullable<z.output<typeof AutoinvestRuleSchema>["payments"]>, ReturnType<typeof projectPayments>>,
  Same<Omit<z.output<typeof RuleOccurrenceSchema>, "state">, Omit<StoredOccurrence, "state">>,
  Same<Exclude<z.output<typeof RuleOccurrenceSchema>["state"], "pending">, StoredOccurrence["state"]>,
  /* 1.13.0 — «Якщо впаде»: the wire's `dip` is the stored one plus the trigger it computes; the month's budget is what the service projects; a reminder's state on the surface is the rule's occurrence state */
  Same<Omit<NonNullable<z.output<typeof AutoinvestRuleSchema>["dip"]>, "triggerUsd">, StoredDip>,
  Same<z.output<typeof RuleBudgetSchema>, ReturnType<typeof projectBudget>>,
  Same<NonNullable<z.output<typeof MonitoringNoteSchema>["ruleState"]>, InboxRuleState>,
  Same<NonNullable<z.output<typeof MonitoringNoteSchema>["ruleState"]>, z.output<typeof RuleOccurrenceSchema>["state"]>,
  Same<z.output<typeof SwapBundleSchema>, SwapExecutionBundle>,
  Same<z.output<typeof SwapBundleRequestSchema>, z.output<typeof SwapExecutionBundleSchema>>,
  Same<z.output<typeof SwapProofSchema>, SwapExecutionProof>,
  /* `/order` serves only the signed proof and only the ready pre-sign verdict (a refusal is the 409) */
  Same<z.output<typeof SwapSignedProofSchema>, Extract<SwapExecutionProof, { status: "SIGNED" }>>,
  Same<z.output<typeof SwapPreSignSchema>, Extract<SwapClientReviewAssessment, { ready: true }>>,
  Same<NonNullable<z.output<typeof SwapOrderErrorSchema>["error"]["preSign"]>, Extract<SwapClientReviewAssessment, { ready: false }>>,
  /* execute and recover */
  Same<z.output<typeof SwapExecuteReportSchema>, JupiterExecuteReport>,
  Same<z.output<typeof SwapObservationSchema>, Extract<SwapObservationResult, { ok: true }>["observation"]>,
  Same<z.output<typeof SwapFactsSchema>, SwapReceiptFacts>,
  Same<z.output<typeof SwapReceiptSchema>, OutcomeReceiptArtifact>,
  /* the recover answer is the recovery result without REFUSED (the route turns that into its 409) or the unrecorded result */
  Same<z.output<typeof SwapRecoverResponseSchema>, Exclude<SwapRecoveryResult, { state: "REFUSED" }> | Awaited<ReturnType<typeof recoverUnrecordedSwap>>>,
  Same<Extract<z.output<typeof SwapExecuteResponseSchema>, { state: "SUBMITTED_UNKNOWN" }>["providerFailure"]["code"], JupiterExecuteFailure["code"] | "BROADCAST_UNANSWERED">,
  /* LANDED_FAILED is answered as a 409, never as a pending read */
  Same<Extract<z.output<typeof SwapExecuteResponseSchema>, { observationFailure: unknown }>["observationFailure"]["code"], Exclude<SwapObservationFailure["code"], "LANDED_FAILED">>,
  /* every composed or borrowed code family equals the lib's own union */
  Same<Extract<(typeof SWAP_QUOTE_ERROR_CODES_V1)[number], `QUOTE_${string}`>, `QUOTE_${JupiterOrderFailure["code"]}`>,
  Same<Extract<(typeof SWAP_ORDER_ERROR_CODES_V1)[number], `ORDER_${string}`>, `ORDER_${JupiterExecutableOrderFailure["code"]}`>,
  Same<Extract<(typeof SWAP_ORDER_ERROR_CODES_V1)[number], `TRANSACTION_${string}`>, `TRANSACTION_${SwapTransactionRefusal["code"]}`>,
  Same<Extract<(typeof SWAP_ORDER_ERROR_CODES_V1)[number], `SIMULATION_EFFECT_${string}`>, `SIMULATION_EFFECT_${SwapEffectRefusalCode}`>,
  Same<Extract<(typeof SWAP_EXECUTE_ERROR_CODES_V1)[number], `SIGNED_${string}`>, `SIGNED_${SwapTransactionRefusal["code"]}`>,
  Same<Extract<(typeof SWAP_EXECUTE_ERROR_CODES_V1)[number], `ADOPTED_EFFECT_${string}`>, `ADOPTED_EFFECT_${SwapEffectRefusalCode}`>,
  Same<Extract<(typeof SWAP_EXECUTE_ERROR_CODES_V1)[number], SwapAdoptionRefusalCode>, SwapAdoptionRefusalCode>,
  Same<Extract<(typeof SWAP_EXECUTE_ERROR_CODES_V1)[number], `SEND_ATTEMPT_${string}`>, Extract<ReserveSendAttemptResult, { ok: false }>["code"]>,
  Same<(typeof SWAP_CARRIER_ERROR_CODES_V1)[number], Extract<SwapCarrier, { ok: false }>["code"]>,
  Same<(typeof SWAP_OWNER_LOCK_ERROR_CODES_V1)[number], Extract<Awaited<ReturnType<typeof readSwapOwnerLock>>, { ok: false }>["code"]>,
  Same<(typeof SWAP_OWNER_LOCK_STATES_V1)[number], SwapOwnerLockState>,
  Same<NonNullable<NonNullable<z.output<typeof SwapOrderErrorSchema>["error"]["ownerLock"]>>["state"], SwapOwnerLockState>,
  Same<NonNullable<z.output<typeof SwapExecuteErrorSchema>["error"]["durableState"]>, SendAttemptState | "UNKNOWN">,
  /* the quote route answers ASSET_NOT_OFFERED for every lifecycle state but the open conversion window */
  Same<NonNullable<z.output<typeof SwapQuoteErrorSchema>["error"]["lifecycle"]>["state"], Exclude<LifecycleEvent["state"], "conversion-open">>,
  /* Ryntra Predictions (paper) */
  Same<z.output<typeof PredictionFailureValueSchema>, PredictionFailure>,
  Same<z.output<typeof PredictionCategorySchema>, PredictionCategory>,
  Same<z.output<typeof PredictionOutcomeSchema>, PredictionOutcome>,
  Same<z.output<typeof PredictionVenueMarketSchema>, PredictionVenueMarket>,
  Same<z.output<typeof PredictionMarketSchema>, PredictionMarket>,
  Same<z.output<typeof PredictionSettlementSchema>, PredictionSettlement>,
  Same<z.output<typeof PredictionEventSummarySchema>, PredictionEventSummary>,
  Same<z.output<typeof PredictionEventSchema>, PredictionEvent>,
  Same<z.output<typeof PredictionBookLevelSchema>, PredictionBookLevel>,
  Same<z.output<typeof PredictionVenueBookSchema>, PredictionVenueBook>,
  Same<z.output<typeof PredictionBookSchema>, PredictionBook>,
  Same<z.output<typeof PredictionChartSchema>, PredictionChart>,
  Same<z.output<typeof PredictionVenuePriceSchema>, PredictionVenuePrice>,
  Same<z.output<typeof PredictionMarketPricesSchema>, PredictionMarketPrices>,
  Same<z.output<typeof PredictionSignalsSchema>, PredictionSignals>,
  Same<z.output<typeof PredictionRelatedMarketSchema>, PredictionRelatedMarket>,
  Same<z.output<typeof PredictionRippleSchema>, PredictionRipple>,
  Same<z.output<typeof PredictionNewsSchema>, PredictionNews>,
  Same<z.output<typeof PredictionEngineStateSchema>, PredictionEngineState>,
  Same<z.output<typeof PredictionMonitorConditionSchema>, PredictionMonitorCondition>,
  Same<z.output<typeof PredictionPlanRulesSchema>, PredictionPlanRules>,
  Same<z.output<typeof PredictionPlanSizingSchema>, PredictionPlanSizing>,
  Same<z.output<typeof PredictionPlanVersionSchema>, PredictionPlanVersion>,
  Same<z.output<typeof PredictionPlanJournalSchema>, PredictionPlanJournalEntry>,
  Same<z.output<typeof PredictionPlanSchema>, PredictionPlan>,
  Same<z.output<typeof PredictionPaperBalanceSchema>, PaperBalance>,
  Same<z.output<typeof PredictionPaperPositionSchema>, PaperPosition>,
  Same<z.output<typeof PredictionPaperOrderSchema>, PaperOrder>,
  Same<z.output<typeof PredictionPaperExecutionSchema>, PaperExecution>,
  Same<z.output<typeof PredictionRouteSchema>, PredictionRoute>,
  Same<z.output<typeof PredictionReviewCheckSchema>, ReviewCheck>,
  Same<z.output<typeof PredictionPaperReviewSchema>, PaperReview>,
  Same<z.output<typeof PredictionOrderRecordSchema>, PredictionOrderRecord>,
  Same<z.output<typeof PredictionLinkStatusSchema>, LinkStatus>,
  Same<z.output<typeof PredictionLinkChallengeSchema>, LinkChallenge>,
  Same<z.output<typeof PredictionWatchEntrySchema>, WatchEntry>,
  /* predictions — the request bodies against what the handlers pass on */
  Same<z.output<typeof PredictionsQuoteRequestSchema>, QuoteInput>,
  Same<z.output<typeof PredictionsOrdersRequestSchema>["quoteId"], Parameters<typeof placePaper>[3]>,
  /* `encoding` is consumed by the route (a base64 signature is re-encoded to base58) before `verifyLink`. */
  Same<Omit<z.output<typeof PredictionsLinkVerifyRequestSchema>, "encoding">, Parameters<typeof verifyLink>[3]>,
  /* `watched` picks set or unset; the other fields default to null and become the entry `setWatch` stamps. */
  Same<Required<Omit<z.output<typeof PredictionsWatchlistRequestSchema>, "watched">>, Omit<WatchEntry, "watchedAt">>,
  Same<z.input<typeof PredictionsPlansRequestSchema>, z.input<typeof PredictionPlanCreateSchema>>,
  Same<z.output<typeof PredictionsPlansRequestSchema>, z.output<typeof PredictionPlanCreateSchema>>,
  Same<z.output<typeof PredictionsPlanRequestSchema>, z.output<typeof PredictionPlanUpdateSchema>>,
  Same<z.output<typeof PredictionsPlanStatusRequestSchema>, z.output<typeof PredictionPlanStatusSchema>>,
  /* predictions — the answers, as each handler's object literal assembles them */
  Same<z.output<typeof PredictionsFailureSchema>, { error: Pick<PredictionFailure, "code" | "message" | "issues"> }>,
  Same<
  z.output<typeof PredictionsDiscoverResponseSchema>,
  {
  categories: readonly PredictionCategory[];
  categoriesUnavailable: boolean;
  query: { q: string | null; category: string | null; sort: NonNullable<DiscoverQuery["sort"]>; limit: number };
  events: DiscoverPage["events"];
  nextCursor: DiscoverPage["nextCursor"];
  readAt: DiscoverPage["readAt"];
  watched: WatchEntry["eventId"][];
  wallet: string | null;
  }
  >,
  Same<z.output<typeof PredictionsEngineResponseSchema>, { engine: PredictionEngineState; readAt: string }>,
  Same<z.output<typeof PredictionsEventsResponseSchema>, { events: readonly PredictionEventSummary[]; readAt: string }>,
  Same<z.output<typeof PredictionsEventResponseSchema>, { event: PredictionEvent; watch: WatchEntry | null; wallet: string | null; readAt: string }>,
  Same<z.output<typeof PredictionsBookResponseSchema>, { book: PredictionBook }>,
  Same<z.output<typeof PredictionsPricesResponseSchema>, { prices: readonly PredictionMarketPrices[]; readAt: string }>,
  Same<
  z.output<typeof PredictionsResearchResponseSchema>,
  {
  signals: PredictionResearchPart<PredictionSignals | null>;
  expand: PredictionResearchPart<PredictionRipple>;
  hedge: PredictionResearchPart<PredictionRipple>;
  news: PredictionResearchPart<PredictionNews>;
  related: PredictionResearchPart<readonly PredictionRelatedMarket[]>;
  readAt: string;
  }
  >,
  Same<z.output<typeof PredictionsChartResponseSchema>, { chart: PredictionChart; readAt: string }>,
  Same<z.output<typeof PredictionsLinkStartResponseSchema>, LinkChallenge>,
  Same<z.output<typeof PredictionsLinkResponseSchema>, { wallet: string; link: LinkStatus }>,
  Same<z.output<typeof PredictionsAccountResponseSchema>, { wallet: string } & PaperAccountView & { watchlist: readonly WatchEntry[]; plans: readonly PredictionPlan[] }>,
  Same<z.output<typeof PredictionsQuoteResponseSchema>, { wallet: string; review: QuoteResult["review"]; link: QuoteResult["link"]; order: QuoteResult["record"] }>,
  Same<z.output<typeof PredictionsOrdersResponseSchema>, { wallet: string; orders: readonly PredictionOrderRecord[] }>,
  Same<z.output<typeof PredictionsOrderPlacedResponseSchema>, { wallet: string; order: PredictionOrderRecord }>,
  Same<z.output<typeof PredictionsOrderResponseSchema>, { wallet: string; order: PredictionOrderRecord; sync?: Pick<PredictionFailure, "code" | "message"> }>,
  Same<z.output<typeof PredictionsPlansResponseSchema>, { wallet: string; plans: readonly PredictionPlan[] }>,
  Same<z.output<typeof PredictionsPlanResponseSchema>, { wallet: string; plan: PredictionPlan }>,
  Same<z.output<typeof PredictionsWatchlistResponseSchema>, { wallet: string; entries: readonly WatchEntry[] }>,
];

/* Every entry must be `true`; a `never` anywhere fails this assignment. */
export const routeChecks: RouteChecks = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];

/**
 * 1.22.0 — «Гроші»: the v1 money shapes equal the types their routes build from
 * — «Перевірка» of a transfer, the payment link, the recipient check, the
 * reading of what the wallet returned — and their word lists equal the
 * engine's, so a code added on one side alone fails `tsc`.
 */
type MoneyChecks = [
  Same<z.output<typeof TransferCheckSchema>, SendCheck>,
  Same<z.output<typeof PayLinkSchema>, PayLinkView>,
  Same<z.output<typeof RecipientCheckResponseSchema>, RecipientCheck>,
  Same<z.output<typeof SendReturnedResponseSchema>, ReturnedAnswer>,
  Same<(typeof PAY_LINK_EXPIRATIONS)[number], PaymentExpiration>,
  Same<(typeof PAY_LINK_STATUSES)[number], PublicPaymentStatus>,
  Same<(typeof PAY_LINK_NOTES)[number], NonNullable<PublicPaymentStatusView["note"]>>,
  Same<(typeof RECIPIENT_PROBLEMS)[number], RecipientProblem>,
  Same<(typeof SEND_RETURNED_VERDICTS)[number], BytesCheckVerdict>,
  Same<NonNullable<z.output<typeof PayLinkCreateRequestSchema>["expiration"]>, PaymentExpiration>,
  /* The payer routes the page runs, described for a phone that pays a Ryntra link. */
  Same<z.output<typeof PayPublicViewSchema>, PublicPaymentView>,
  Same<z.output<typeof PayTransactionResponseSchema>["data"], PaymentTransactionSuccess>,
  Same<z.output<typeof PaySubmitResponseSchema>["data"]["view"], PublicPaymentView | null>,
  /* Every refusal the builders can give is listed. */
  Same<Extract<(typeof PAY_TRANSACTION_ERROR_CODES_V1)[number], PaymentTransactionFailure["code"]>, PaymentTransactionFailure["code"]>,
  Same<Extract<(typeof PAY_SUBMIT_ERROR_CODES_V1)[number], PaymentSubmitFailure["code"]>, PaymentSubmitFailure["code"]>,
];

/* Every entry must be `true`. */
export const moneyChecks: MoneyChecks = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];

/**
 * 1.22.0 — the consumed transfer routes: the schemas that travel back into
 * adopt and settle equal the settlement validator's, the served shapes equal
 * the types the routes build them from, and where the lib types an answer
 * more loosely than the route serves it (`SettlementResult`), the four exact
 * forms are proven within it. A field or a code added on one side alone fails
 * `tsc`.
 */
type TransferRouteChecks = [
  /* 1.22.0 — the consumed transfer routes: the plan request is the route's own validator, both ways */
  Same<z.output<typeof TransferPlanRequestSchema>["input"], z.output<typeof SendTransferInputSchema>>,
  Same<z.input<typeof TransferInputSchema>, z.input<typeof SendTransferInputSchema>>,
  Same<typeof TRANSFER_SPL_ACTION_REF, typeof SPL_TRANSFER_ACTION_REF>,
  Same<typeof TRANSFER_NATIVE_SOL_ACTION_REF, typeof NATIVE_SOL_TRANSFER_ACTION_REF>,
  /* the parts adopt and settle take back equal the settlement validator's, part by part and whole */
  Same<z.output<typeof TransferPlanSchema>, BuiltTransferPlan>,
  Same<z.output<typeof TransferPlanSchema>, z.output<typeof SettlementPlanSchema>>,
  Same<keyof z.output<typeof TransferPlanSchema>, keyof BuiltTransferPlan>,
  Same<z.output<typeof TransferPreflightSchema>, SplTransferPreflight>,
  Same<z.output<typeof TransferPolicyVerdictSchema>, SolanaPolicyVerdict>,
  Same<z.output<typeof TransferProviderSchema>, SettlementRequest["provider"]>,
  Same<z.output<typeof TransferProviderSchema>, SendReviewBundle["provider"]>,
  Same<z.output<typeof TransferCanaryIntentSchema>, SolanaCanaryIntent>,
  Same<z.output<typeof TransferCanaryVerdictSchema>, SolanaCanaryVerdict>,
  Same<z.output<typeof TransferReviewProofSchema>, SendReviewProof>,
  Same<z.output<typeof TransferSignedReviewProofSchema>, Extract<SendReviewProof, { status: "SIGNED" }>>,
  Same<z.output<typeof TransferSettleRequestSchema>, z.output<typeof SettlementRequestSchema>>,
  Same<z.input<typeof TransferSettleRequestSchema>, z.input<typeof SettlementRequestSchema>>,
  Same<z.output<typeof TransferSettleRequestSchema>, SettlementRequest>,
  /* the restated lists, in their order */
  Mutual<typeof TRANSFER_ACTION_KINDS_V1, typeof SEND_ACTION_KINDS>,
  Mutual<typeof TRANSFER_SUPPORT_DECISIONS_V1, typeof SEND_SUPPORT_DECISIONS>,
  Mutual<typeof TRANSFER_SAFETY_DECISIONS_V1, typeof SEND_SAFETY_DECISIONS>,
  Mutual<typeof TRANSFER_CANARY_FAMILIES_V1, typeof SOLANA_CANARY_FAMILIES>,
  Mutual<typeof TRANSFER_CANARY_DECISIONS_V1, typeof SOLANA_CANARY_DECISIONS>,
  Mutual<typeof TRANSFER_CANARY_RULES_V1, typeof SOLANA_CANARY_RULES>,
  /* the verdicts served beside the plan (the passport is `SwapPassportSchema`, proven equal to `SolanaAssetPassport` above) */
  Same<z.output<typeof TransferSupportSchema>, SendSupportVerdict>,
  Same<z.output<typeof TransferSafetySchema>, SendSafetyVerdict>,
  /* the plan answer is what the handler assembles; the adopt answer serves within it (passport always null, the proof always signed) */
  Same<Omit<z.output<typeof TransferReviewSchema>, "check">, TransferReviewServed>,
  Within<Omit<z.output<typeof TransferAdoptedReviewSchema>, "check">, TransferReviewServed>,
  /* settle: the parts of the receipted answer equal the lib's types */
  Same<z.output<typeof TransferObservationSchema>, SplTransferObservation>,
  Same<z.output<typeof TransferSettledSchema>["observedEffects"], ObservedTransfer["observedEffects"]>,
  Same<z.output<typeof TransferReconciliationSchema>, Reconciliation>,
  Same<z.output<typeof TransferReceiptFactsSchema>, SolanaSendReceiptFacts>,
  Same<z.output<typeof TransferReceiptSchema>, OutcomeReceiptArtifact>,
  Same<z.output<typeof TransferVerificationSchema>, ArtifactVerification>,
  Same<z.output<typeof TransferSettledSchema>["confirmation"], NonNullable<Extract<SettlementResult, { ok: true }>["confirmation"]>>,
  Same<z.output<typeof TransferSettledSchema>["landingState"], NonNullable<Extract<SettlementResult, { ok: true }>["landingState"]>>,
  /* the recovery form carries what the route's `recoverSend` returns — with `statusRead`, which `SettlementResult` types away as `RecoveryFacts` — and never NOT_REQUESTED: the route always asks for the effects */
  Same<z.output<typeof TransferSettleRecoverySchema>["recovery"], RecoveryFactsWithStatusRead>,
  Same<z.output<typeof TransferSettleRecoverySchema>["effectReadback"], Exclude<EffectReadback<ObserveResult>, { state: "NOT_REQUESTED" }>>,
  Same<z.output<typeof TransferStatusReadSchema>, SignatureStatusRpcRead>,
  /* `SettlementResult` types success as one object of optional keys with `unknown` receipt and facts: the four exact forms are each within it, and their states are the published list */
  Within<z.output<typeof TransferSettleResultSchema>, Extract<SettlementResult, { ok: true }>>,
  Same<(typeof TRANSFER_SETTLE_STATES_V1)[number], z.output<typeof TransferSettleResultSchema>["state"]>,
  Within<(typeof TRANSFER_SETTLE_STATES_V1)[number], SendState>,
  /* recover: the attempt is the record's four public fields; each operator's read is `readSignatureStatus`'s */
  Same<z.output<typeof TransferRecoverySchema>["attempt"], Pick<SendAttemptRecord, "state" | "reservedAt" | "updatedAt" | "receiptHash"> | null>,
  Same<z.output<typeof TransferRecoverySchema>["primary"], SignatureStatusRpcRead>,
  /* every composed or borrowed code family equals the lib's own union */
  Same<(typeof TRANSFER_BUILD_ERROR_CODES_V1)[number], TransferBuildFailure["code"]>,
  Same<(typeof TRANSFER_MINT_ERROR_CODES_V1)[number], MintReadFailure["code"]>,
  Same<Extract<(typeof TRANSFER_PLAN_ERROR_CODES_V1)[number], PreflightFailure["code"]>, PreflightFailure["code"]>,
  Same<Extract<(typeof TRANSFER_ADOPT_ERROR_CODES_V1)[number], Extract<WalletAdoptionResult, { ok: false }>["code"]>, Extract<WalletAdoptionResult, { ok: false }>["code"]>,
  Same<Extract<(typeof TRANSFER_SETTLE_ERROR_CODES_V1)[number], Extract<CanaryFlowDecision, { ok: false }>["code"]>, Extract<CanaryFlowDecision, { ok: false }>["code"]>,
  Same<Extract<(typeof TRANSFER_SETTLE_ERROR_CODES_V1)[number], SettlementValidationFailure["code"]>, SettlementValidationFailure["code"]>,
  Same<Extract<(typeof TRANSFER_SETTLE_ERROR_CODES_V1)[number], `SEND_ATTEMPT_${string}`>, Extract<ReserveSendAttemptResult, { ok: false }>["code"]>,
  /* a submit refusal that carries its signature is recovered, never answered as an error */
  Same<Extract<(typeof TRANSFER_SETTLE_ERROR_CODES_V1)[number], SubmitFailure["code"]>, Exclude<SubmitFailure["code"], "AMBIGUOUS" | "SIGNATURE_MISMATCH" | "NOT_CONFIRMED">>,
  Same<Extract<(typeof TRANSFER_SETTLE_ERROR_CODES_V1)[number], ReceiptMintFailure["code"]>, ReceiptMintFailure["code"]>,
  Same<Extract<(typeof TRANSFER_RECOVER_ERROR_CODES_V1)[number], Extract<SwapCarrier, { ok: false }>["code"]>, Extract<SwapCarrier, { ok: false }>["code"]>,
  /* a signature the ledger never recorded is an answer (`attempt: null`), not an error */
  Same<Extract<(typeof TRANSFER_RECOVER_ERROR_CODES_V1)[number], `SEND_ATTEMPT_${string}`>, Exclude<Extract<ReadSendAttemptResult, { ok: false }>["code"], "SEND_ATTEMPT_ABSENT">>,
];

/* Every entry must be `true`. */
export const transferRouteChecks: TransferRouteChecks = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];

/* 1.23.0 — «Ризик портфеля»: the verdict the server judges is the one the route serves, both ways. */
export type RiskRouteChecks = [Same<z.output<typeof PortfolioRiskSchema>, PortfolioRisk>, Same<z.output<typeof PortfolioRiskFindingSchema>, RiskFinding>];

export const riskRouteChecks: RiskRouteChecks = [true, true];

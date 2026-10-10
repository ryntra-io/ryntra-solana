import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compareCanonicalStrings } from "./canonical.ts";

/**
 * Guard prototype persistence port.
 *
 * The kernel does not care where its objects live, but it must never be able to
 * pretend they survive when they do not. Every adapter therefore declares its
 * own durability, and the runtime refuses state-changing calls when the declared
 * durability is weaker than the deployment requires. That refusal is the point
 * of this file: an ephemeral store is legitimate for a local demo and is a
 * correctness bug in a multi-instance deployment, and only the adapter itself
 * can honestly say which one it is.
 *
 * The port is asynchronous because a store that is safe for concurrent writers
 * lives across a network, and a synchronous `Map`-shaped surface can never
 * reach one. That was not a style choice — the previous surface made a
 * multi-writer adapter unrepresentable, which is why a multi-instance
 * deployment had to refuse every state change outright.
 */
export type GuardStoreDurability =
  /** Per-process memory. Lost on cold start; never shared between instances. */
  | "EPHEMERAL_SINGLE_INSTANCE"
  /** Survives cold start on one writer. Not safe for concurrent instances. */
  | "DURABLE_SINGLE_WRITER"
  /** Survives cold start and concurrent writers. */
  | "DURABLE_MULTI_WRITER";

export const GUARD_COLLECTIONS = [
  "intents",
  "evaluations",
  "authorizations",
  "executions",
  "receipts",
  "idempotency",
  "transactionIndex",
  /* Treasury payout collections. Appended rather than folded into the existing
     names: a payout is a business facade over one `SEND` intent, and mixing the
     two in one collection would make a tenant scan over intents return records
     that are not intents. */
  "payouts",
  "payoutBeneficiaries",
  "payoutPolicies",
  "payoutApprovals",
  "payoutReservations",
  "payoutReceipts",
  /* Payout markers must never share the legacy Guard idempotency namespace:
     legacy keys are delimiter-concatenated and cannot be made collision-free by
     changing only the payout key encoding. */
  "payoutIdempotency",
  /* Agent Control lifecycle collections. Appended for the same reason the
     payout ones were: an agent intent is not a Guard SEND intent, and folding
     them together would make a scan over one return records of the other. The
     audit collection is written only through insertIfAbsent, which is what
     makes append-only a property of the store rather than of the caller. */
  "agentIntents",
  "agentArtifacts",
  "agentAuthorizations",
  "agentObservations",
  "agentReconciliations",
  "agentPolicies",
  "agentIdempotency",
  "agentAudit",
  /* Release D external-adoption collections. Appended for the third time on
     the same reasoning: an API key is not an agent intent, and a quota window
     is not either. They add no DDL — the Postgres adapter is one table keyed
     by (collection, key), so a new collection name is a new value in a column
     that already exists rather than a migration. */
  "agentTenants",
  "agentApiKeys",
  "agentQuotas",
  "agentOauthClients",
  "agentOauthGrants",
  "agentOauthTokens",
  "agentMcpReceipts",
  /* Solana owner-canary policy state. These are values in the existing generic
     Guard collection table, not new database tables: the ledger needs atomic
     multi-writer CAS and the intent claim must survive a warm-instance change
     before any mainnet submit path can open. */
  "solanaCanaryLedger",
  "solanaCanaryIntents",
  /* General Send submit-once state, keyed by network and transaction
     signature. Separate from the canary intents above because it is not about
     a budget: it records only that these exact bytes crossed the broadcast
     boundary, which is what makes "submitted once" true across instances and
     cold starts. Same generic table, one more value in an existing column. */
  "solanaSendAttempts",
  /* One durable owner-wide lock for the single M2 canary. It stores the
     issuer-bound Review/recovery artifact in the same generic CAS table, so a
     new browser tab cannot create a second requestId while one attempt exists. */
  "solanaSwapOwnerLocks",
  /* The CCTP duplicate-burn boundary, keyed by the burn *intent* rather than by
     a signature. `solanaSendAttempts` above proves that exact bytes were
     broadcast once and is blind to a second, freshly built burn of the same
     intent — new blockhash, new ephemeral account, new signature, same money
     leaving twice. A cross-chain burn cannot be undone from this side, so the
     thing that must be unique is the intent, not the bytes. */
  "solanaCctpBurns",
  /* The wallet's own history. Every collection above is a *boundary* — it
     answers "may this happen again", and each is keyed by whatever makes that
     question decidable: the exact bytes for Send, the owner slot for Swap, the
     burn intent for Bridge. None of them can answer the different question a
     person asks, which is "what did I do", because none of them leads with the
     wallet and `valuesWithPrefix` is the only scan this port has.

     So this one is additive and leads with the wallet:
     `solana:<network>:<wallet>:<action>`. It is an index, never a boundary —
     nothing compare-and-sets on it to decide whether money may move, and the
     three collections above keep deciding that exactly as they did. */
  "solanaWalletActions",
  /* Cross-chain swap orders through Mayan (Unified
     Swap V1). Keyed by the order *intent*, like `solanaCctpBurns`, and for the
     same reason: a swap that leaves one chain cannot be undone from this side,
     so the thing that must be unique is the intent, not the bytes. Same
     generic table, one more value in an existing column. */
  "solanaCrossSwapOrders",
  /* The controlled-operation ledger of the cross-swap lane. Exactly one row
     ever, holding whether the single permitted canary has been planned,
     attempted or resolved. It is separate from the order collection on
     purpose: an order record is per-intent and a rebuilt plan is a new intent,
     so an order can never answer "has this lane already had its one submit".
     That question needs a row that outlives every intent. */
  "solanaCrossSwapCanary",
  /* Public payment requests. Three records on purpose, because these are three
     kinds of data that must not be one row: the public request a payer page
     shows (`paymentRequests`, keyed by the opaque public id), the private
     creator association that lists a wallet's own requests behind proof of
     ownership (`paymentRequestOwners`, keyed wallet-first like the action
     ledger), and the settlement observation that alone may turn a request into
     `Paid` (`paymentRequestSettlements`). The reference index makes one Solana
     Pay reference key answer to one request, and `paymentIntents` remembers
     the exact unsigned bytes a payer was handed so the submit boundary can
     refuse anything else. Same generic table. */
  "paymentRequests",
  "paymentRequestOwners",
  "paymentRequestSettlements",
  "paymentRequestReferences",
  "paymentIntents",
  /* Rewards. Four records, and the split is the same one the payment request
     made: what a person is owed, who they are in the referral graph, which
     code answers to them, and the one claim that may be in flight.

     `rewardEntries` leads with the wallet like `solanaWalletActions`, because
     the question is "what am I owed" and `valuesWithPrefix` is the only scan
     this port has. Unlike that one it *is* a boundary: the key carries the
     provider and the operation reference, and `insertIfAbsent` on it is what
     makes a reload, a webhook retry or a second status read the same income
     rather than new income.

     `rewardCodes` is keyed by the opaque code rather than by the wallet, which
     is the whole reason it is a second collection: a link resolves code to
     owner, and a scan by wallet cannot answer that.

     `rewardClaims` holds at most one row per wallet and is compare-and-set on
     purpose. It is the durable answer to two tabs claiming at once, in the
     same shape `solanaSwapOwnerLocks` uses for two tabs swapping at once. */
  "rewardEntries",
  /* Frozen recipients and retriable valuation for one confirmed provider fee. */
  "rewardAccruals",
  /* Retryable bookkeeping only. These jobs cannot authorize a payout. */
  "benefitJobs",
  "rewardAccounts",
  "rewardCodes",
  "rewardClaims",
  /* The shared payout pot, and the only collection here that is about more
     than one person at a time. `rewardClaims` stops one wallet claiming
     twice; it cannot stop two wallets being promised the same dollar,
     because it is keyed by wallet and knows about no other. This is one row
     holding every open hold, and `compareAndSet` on it is what serializes
     claims from different people against one treasury balance. */
  "rewardReserve",
  /* Who invited whom, one row per edge, keyed referrer-first so a scan by
     prefix answers "how many chose me".

     It exists because a counter alone cannot be trusted. The first version
     incremented a number on the referrer at bind time, which is correct and
     unrecoverable: every attribution written before that code existed — the
     silent ones the old read-path made — counted nothing, and there was no
     way to find them again, because nothing indexed the graph by referrer.

     An edge inserted with `insertIfAbsent` is idempotent by construction, so
     it can be written on bind *and* re-asserted on every read: a binding the
     counter missed repairs itself the first time either party opens Rewards,
     and one it already has stays exactly as it is. */
  "rewardReferralEdges",
  /* Ranks (the Growth line, rules 2.0.0). `rewardRules` holds the moment each
     rules version came into force, written once with `insertIfAbsent`;
     `rankEvents` are points earned without a fee — a launch that reached a
     DEX — keyed `wallet:kind:ref`, append-only. Values in the same column; no
     DDL. */
  "rewardRules",
  "rankEvents",
  /* Leaderboards and seasons (the Growth line). `growthBoards` caches each
     week's computed figures and each season's counts so a board is not
     recomputed from every ledger on every read; `growthSeasons` holds when the
     first season began, written once; `growthPrefs` is one row per wallet
     that chose to be hidden from the boards. No money, no DDL. */
  "growthBoards",
  "growthSeasons",
  "growthPrefs",
  /* Trade cards (the Growth line): one row per card a wallet made of its own
     trade — the figures, rank and code frozen at that moment — written once
     with `insertIfAbsent`, read by the card's public page and picture. No
     money, no DDL. */
  "growthCards",
  /* Admin business analytics. Two records, neither a boundary: nothing
     compare-and-sets on them to decide whether money may move.

     `walletPresence` leads with the wallet, one row per address, and answers
     the two questions the action ledger cannot — *did a wallet open the
     cabinet* and *did it prove it was its owner's* — because both happen
     before any money moves and the ledger only begins when money does.

     `adminInternalWallets` is the owner's own list of test wallets, kept
     server-side so the business figures can exclude them without a client
     ever carrying the list. Same generic table, two more values in a column
     that already exists. */
  "walletPresence",
  "adminInternalWallets",
  /* Spot watchlist, one row per proven wallet. A value in the same column, for
     the same reason as the two above. */
  "spotWatchlists",
  /* Ryntra Points. One append-only ledger keyed `wallet:day:reason:ref` and
     written only through `insertIfAbsent`, beside `rewardEntries` and for the
     same reason: a settlement read twice writes the same key. Not a boundary —
     nothing compare-and-sets on it to decide whether money may move. A value
     in the same column; no DDL. */
  "pointsEntries",
  /* Transaction fences and operation/qualification identities for Points.
     Values in the existing Guard table; no new database schema. */
  "pointsAccruals",
  /* Feedback context: who wrote a thread, in the terms the inbox table does
     not hold — topic, wallet, contact, page — keyed by the thread id. A value
     in the same column; no DDL. */
  "feedbackContext",
  /* Telegram as a notification channel: one row per account — the chat the bot
     may write to — compare-and-set so a second Start from another chat
     replaces the first rather than racing it. Not a way in; nothing signs in
     through it. No DDL. */
  "notificationChannels",
  /* Trading plans: one row per plan, keyed `solana:mainnet:<wallet>:<planId>`
     so a wallet's plans are one prefix scan and never another wallet's;
     compare-and-set on the plan's own version number, so an edit made from the
     phone and one from the web cannot both become "version 3" — the loser
     re-reads and decides again. A value in the same column; no DDL. */
  "tradingPlans",
  /* The evidence layer: the per-provider credit ledger — one versioned record
     per (provider, day) and one per provider for the whole packet, advanced by
     compare-and-set so two instances reserving the same credit produce one
     reservation, never two — and the snapshot cache keyed
     `<provider>:<network>:<mint>:<window>`, a copy that lives no longer than
     the provider's documented cache and is shared between instances so the
     second reader of an asset costs nothing. Values in the same column; no
     DDL. */
  "evidenceLedger",
  "evidenceSnapshots",
  /* The recipient check: the address cache keyed
     `<provider>:<network>:address:<address>` — what the security provider said
     about one plain address, held an hour and shared between instances so ten
     people sending to one deposit address cost one read. A value in the same
     column; no DDL. */
  "evidenceAddresses",
  /* Predictions: the provider session behind a wallet's paper account — one
     versioned record per proven wallet, the tokens encrypted at rest
     (`lib/predictions/vault.ts`), compare-and-set so a refresh from two
     instances keeps one pair; the person's watchlist of events, one row per
     wallet; the paper orders as Ryntra records them (quote → Review →
     submitted → the provider's terminal state), keyed `<wallet>:<quoteId>` and
     reconciled against the provider's own ledger on every read; and the
     Prediction Plans, keyed `<wallet>:<planId>` like the trading plans and
     versioned the same way. Values in the same column; no DDL. */
  "predictionLinks",
  "predictionWatchlists",
  "predictionOrders",
  "predictionPlans",
  /* Monitoring: one condition engine for plans, evidence and paper
     predictions — monitors keyed by wallet, the inbox, durable trigger
     identities (insertIfAbsent so a retry is not a second alert), the outbox,
     push devices and quiet-hour preferences. Values in the same column; no
     DDL. */
  "monitoringMonitors",
  "monitoringInbox",
  "monitoringTriggers",
  "monitoringOutbox",
  "monitoringDevices",
  "monitoringPreferences",
  /* The IPO and conversion watch: one row per wallet and watched token, keyed
     `solana:mainnet:<wallet>:<mint>` — when the wallet's balance of the token
     was last read from the chain, what it was, and which reminders of the
     issuer's deadline were sent (each stage once; the note itself is claimed
     in `monitoringTriggers`); and one row per UTC day of the daily read of the
     issuer's product pages against the registry of events, for a person to
     verify what drifted. Values in the same column; no DDL. */
  "monitoringIssuerWatch",
  "issuerNoticeChecks",
  /* Ryn, the agent: the durable conversation keyed by the proven wallet —
     structured turns, never a raw chat log as the source of any state; the
     drafts a turn prepared (a plan's rules, a condition, a trade intention),
     keyed by wallet and read back by the builder and the ticket for a bounded
     time; the budget meter — one versioned counter per (wallet, day), per
     (wallet, month), per (deployment, day) and the wallet's in-flight lease,
     advanced by compare-and-set so two instances answering one wallet count
     one call each, never a lost one; and the usage receipts the admin reads
     (model, tokens, latency, outcome — never the words). Values in the same
     column; no DDL. */
  "agentSessions",
  "agentDrafts",
  "agentBudget",
  "agentReceipts",
  /* «Автоінвест»: one row per rule, keyed `solana:mainnet:<wallet>:<ruleId>`
     so a wallet's rules are one prefix scan and never another wallet's;
     compare-and-set on the row's own revision, so the tick writing a reminder
     and the person pausing the rule from the phone cannot both win. A rule
     schedules a reminder and nothing more — it is never a boundary money moves
     through; the purchase is the wallet's signature on the swap path, and
     History is where it is read from. A value in the same column; no DDL. */
  "autoinvestRules",
  /* «Бюджет місяця»: one row per wallet, keyed `solana:mainnet:<wallet>` — the
     person's own ceiling for every rule's purchases in a month and the clock
     the month is counted on. Only the person writes it; the spend is never
     stored, History says it at every read. A value in the same column; no
     DDL. */
  "autoinvestBudgets",
  /* «З кожної оплати»: one row per wallet, keyed `solana:mainnet:<wallet>` —
     the watch over the wallet's USDC account: the cursor and the balance the
     next read continues from, the payments and incoming transfers numbered
     once, and the accounts the person named as their own. The tick writes it;
     the person writes only the own accounts. It moves nothing. A value in the
     same column; no DDL. */
  "autoinvestPaymentWatch",
  /* «Ryntra попередить» on a position: one row per wallet and token, keyed
     `solana:mainnet:<wallet>:<mint>` — the preset the person chose and the
     loss limit and target the server counted from the price then; Нагляд warns
     at them, the sale stays the person's signature. Closed, never deleted,
     when a complete read finds the token sold. It moves and holds nothing. A
     value in the same column; no DDL. */
  "positionWatches",
  /* Ryntra Launch: a token's picture and its metadata, each keyed by the
     sha256 of its own bytes — the address a mint names for ever cannot be
     made to serve anything else. Written once, never changed. A value in the
     same column; no DDL. */
  "launchImages",
  "launchMetadata",
  /* Ryntra Launch: a launch built and waiting for the creator's signature,
     keyed by its id — the hash of the exact message the server will co-sign,
     nothing else; it lives minutes. And a launch the chain confirmed, keyed
     `solana:<cluster>:<mint>` and, for the creator's own list and limit,
     `solana:<cluster>:<creator>:<mint>`. A value in the same column; no DDL. */
  "launchBuilds",
  "launches",
  "launchesByCreator",
  /* Ryntra Launch: every send of a launch, keyed `solana:<cluster>:<creator>:<build>` — the creator's day and the
     network's hour are counted from it, the sends the chain refused included. */
  "launchAttempts",
  /* Ryntra Launch: a buy or a sale built for a wallet, keyed `<cluster>:<build>` — the unsigned bytes the signed ones
     are compared with; it lives minutes. And each build that was sent, under the same key, so a build is sent once. */
  "launchTradeBuilds",
  "launchTradeSends",
  /* Ryntra Launch: a trade that was sent, keyed `<cluster>:<signature>` — what the wallet reviewed, where its settlement
     stands, and its Outcome Receipt once the chain answered. Kept: it is the receipt History reads. */
  "launchTradeRecords",
  /* Ryntra Launch: a trade's Outcome Receipt, keyed `<cluster>:<signature>` — minted once, the first settlement's; every
     later settlement reads it. */
  "launchTradeReceipts",
  "launchFeeShares",
  "launchClaims",
  "launchClaimBuilds",
  "launchClaimSends",
  /* Ryntra Launch: a launch's transactions as decoded from the chain, keyed `<cluster>:<token>:<fee wallet>:<signature>` —
     a confirmed transaction's trades never change, so every instance reads them here and asks the node only for what is
     new. Written once each, never changed. A value in the same column; no DDL. */
  "launchTradeIndex",
  /* Ryntra Launch: the routes' write windows shared by every instance, keyed `<route>:<address>:<window start>`, a
     version-checked count; an address's older windows are removed as it writes. A value in the same column; no DDL. */
  "launchLimits",
  /* Ryntra Launch's executor: each action it sent and the chain confirmed — a graduation, Ryntra's liquidity placed,
     moved or added to — keyed `solana:<cluster>:<token>:<signature>`, with the facts read from the confirmed
     transaction; and a graduation sent by anyone else, found from the graduated pool's first transaction. Written once
     each, never changed. A value in the same column; no DDL. */
  "launchAutopilot",
  /* Ryntra Launch's executor: Ryntra's liquidity on each graduated token — its pool, its position, its steps, what was
     placed, the prices the executor read — keyed `solana:<cluster>:<token>`, a version-checked record. And the lease an
     instance takes on a token while it acts on it, so two never act at once. A value in the same column; no DDL. */
  "launchFloors",
  "launchAutopilotLeases",
  /* Ryntra Launch's executor: when it last finished a pass on a network, keyed `solana:<cluster>` — what a market's
     health reads to say whether the executor acts there now. Rewritten each pass. A value in the same column; no DDL. */
  "launchAutopilotPasses",
  /* Ryntra Launch's executor, its switch and its own notes: the operator's stop for every market (`solana:<cluster>:*`)
     and for one (`solana:<cluster>:<token>`), a version-checked record each; what the executor keeps per market — its
     first pass, the state it last wrote down, a graduation in flight and its failures — keyed `solana:<cluster>:<token>`,
     version-checked; and the flight log's marks that rest on no transaction of their own — a state, a watch, a stop, a
     resume, a failed graduation — keyed `solana:<cluster>:<token>:<time>:<id>`, written once, never changed. A value in
     the same column; no DDL. */
  "launchExecutorStops",
  "launchExecutorMarkets",
  "launchJournalMarks",
  /* Ryntra Launch, a holder's position in a graduated pool: the entry and the permission as built, kept to compare the
     signed bytes with, keyed `<cluster>:<build id>`, and the mark that a build was sent once; the positions entered through
     Ryntra, keyed `<cluster>:<wallet>:<position>` (PENDING before the send, OPEN once the chain confirms); and each claim
     Ryntra's collector made for a position's owner, keyed `<cluster>:<position>:<signature>`, written once. A value in the
     same column; no DDL. */
  "launchHolderBuilds",
  "launchHolderSends",
  "launchHolderPositions",
  "launchHolderClaims",
  /* Ryntra Launch, a market's budget (1.39.0): the executor's ledger of its claims on a market whose fee claimer it is,
     the risk limits it read last and the steps' top-ups of the day, keyed `solana:<cluster>:<token>` (versioned); and
     Ryntra's revenue on the executor's wallet with the operator's last word about it, keyed `solana:<cluster>`. A value in
     the same column; no DDL. */
  "launchBudgets",
  "launchRevenue",
] as const;

export type GuardCollectionName = (typeof GUARD_COLLECTIONS)[number];

/**
 * Deliberately the smallest surface the kernel actually uses.
 *
 * `insertIfAbsent` is the one operation that cannot be composed from the
 * others. Read-then-write is a race: two instances both see a free idempotency
 * key, a free intent id or an unrecorded transaction hash, and both write. On a
 * single writer that window does not exist, which is exactly why the shape has
 * to carry the guarantee rather than the caller — the caller cannot tell which
 * adapter it is talking to.
 */
export type GuardCollection<T> = {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
  /**
   * Atomically claim a key. Resolves `true` when this caller stored the value
   * and `false` when the key already existed — never overwriting the winner.
   */
  insertIfAbsent(key: string, value: T): Promise<boolean>;
  /**
   * Atomically claim every key in one collection. Either all entries are
   * inserted or none are. Sorting is handled by the adapter so concurrent
   * writers acquire overlapping keys in one deterministic order.
   */
  insertAllIfAbsent(entries: readonly { key: string; value: T }[]): Promise<boolean>;
  /**
   * Remove a key. Used to release a claim whose operation failed — a burnt
   * idempotency key would make a corrected retry impossible forever.
   */
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  /**
   * Every stored value whose key starts with `keyPrefix`.
   *
   * Keys are `${tenantId}:${objectId}`, so the prefix is what keeps a tenant
   * scan from reading another tenant's rows — on a shared table that is a
   * tenancy boundary, not an optimization.
   */
  valuesWithPrefix(keyPrefix: string): Promise<readonly T[]>;
};

/**
 * A record whose updates are serialized by an explicit version counter.
 *
 * `insertIfAbsent` decides who *creates* a key. It cannot decide who *updates*
 * one, and a daily-outflow reservation is updated several times across its
 * life — reserved, then committed or released. Read-modify-write on that record
 * is the same race the insert helper exists to close, one step later: two
 * writers read version 3, both write version 4, and one transition disappears.
 */
export type GuardVersionedRecord = { readonly version: number };

export type GuardAtomicVersionedWrite = {
  readonly collection: GuardCollectionName;
  readonly key: string;
  readonly expectedVersion: number | null;
  readonly next: GuardVersionedRecord;
};

export type GuardVersionedCollection<T extends GuardVersionedRecord> = GuardCollection<T> & {
  /**
   * Atomically write `next` only if the stored record is still at
   * `expectedVersion`.
   *
   * - `expectedVersion === null` means "create": the write succeeds only if the
   *   key is absent, so a create cannot silently clobber a concurrent one.
   * - Otherwise the write succeeds only if the stored `version` matches exactly.
   *
   * Resolves `true` when this caller wrote and `false` when it lost the race.
   * A loser is expected to re-read and decide again — see
   * {@link withBoundedCasRetry} — never to retry blindly forever.
   */
  compareAndSet(key: string, expectedVersion: number | null, next: T): Promise<boolean>;
};

export type GuardStore = {
  readonly durability: GuardStoreDurability;
  /** Human-readable adapter identity for `/health`, status limitations and docs. */
  readonly description: string;
  collection<T>(name: GuardCollectionName): GuardCollection<T>;
  /**
   * The same collection, with compare-and-set.
   *
   * Every adapter implements the identical semantic contract; only the
   * mechanism differs — a synchronous check in one process, a whole-file
   * replace on one writer, a conditional `UPDATE` in the database. An adapter
   * that could not offer it would be an adapter on which a daily limit is not
   * a limit.
   */
  versioned<T extends GuardVersionedRecord>(name: GuardCollectionName): GuardVersionedCollection<T>;
  /**
   * Atomically apply version-checked writes across Guard collections.
   *
   * This is intentionally a store-level primitive rather than a service-level
   * compensation loop. A payout authorization and its outflow reservation, or
   * a transaction-hash claim and the payout record that consumes it, are one
   * correctness boundary: a process interruption may expose both or neither,
   * never only one side.
   */
  compareAndSetMany(writes: readonly GuardAtomicVersionedWrite[]): Promise<boolean>;
  /** Release adapter resources. Adapters that hold none resolve immediately. */
  close?(): Promise<void>;
};

/** How many times a lost compare-and-set is re-attempted before giving up. */
export const GUARD_CAS_MAX_ATTEMPTS = 5;

export class GuardCasExhaustedError extends Error {
  constructor(attempts: number) {
    super(`Contended record did not settle within ${attempts} attempts.`);
    this.name = "GuardCasExhaustedError";
  }
}

/**
 * Run a read-decide-write cycle until it wins or the attempt budget runs out.
 *
 * The budget is the point. An unbounded retry under sustained contention is a
 * request that never returns and a connection that is never released; failing
 * after a stated number of attempts turns that into an honest, retryable error
 * the caller can surface.
 *
 * `attempt` returns `false` to mean "I lost the race, re-read and try again"
 * and any value to mean "done". It must re-read state itself: a closure that
 * captures the version it read the first time will lose every subsequent round.
 */
export async function withBoundedCasRetry<T>(
  attempt: () => Promise<T | false>,
  attempts: number = GUARD_CAS_MAX_ATTEMPTS,
): Promise<T> {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError("A compare-and-set budget must be at least one attempt.");
  }
  for (let round = 0; round < attempts; round += 1) {
    const result = await attempt();
    if (result !== false) return result;
  }
  throw new GuardCasExhaustedError(attempts);
}

export function storeSurvivesColdStart(store: GuardStore): boolean {
  return store.durability !== "EPHEMERAL_SINGLE_INSTANCE";
}

export function storeSupportsConcurrentInstances(store: GuardStore): boolean {
  return store.durability === "DURABLE_MULTI_WRITER";
}

/** The exact limitation strings the API reports for a given adapter. */
export function guardStoreLimitations(store: GuardStore): readonly string[] {
  if (!storeSurvivesColdStart(store)) return ["EPHEMERAL_SINGLE_INSTANCE_STORE"];
  if (!storeSupportsConcurrentInstances(store)) return ["DURABLE_SINGLE_WRITER_STORE"];
  return ["DURABLE_MULTI_WRITER_STORE"];
}

export function createMemoryGuardStore(): GuardStore {
  const maps = new Map<GuardCollectionName, Map<string, unknown>>();

  function mapFor(name: GuardCollectionName): Map<string, unknown> {
    let map = maps.get(name);
    if (!map) {
      map = new Map<string, unknown>();
      maps.set(name, map);
    }
    return map;
  }

  function collection<T>(name: GuardCollectionName): GuardCollection<T> {
    return {
        async get(key) {
          return mapFor(name).get(key) as T | undefined;
        },
        async set(key, value) {
          mapFor(name).set(key, value);
        },
        async insertIfAbsent(key, value) {
          /* A single JavaScript process runs this to completion with no await
             in between, so the check and the write cannot interleave. */
          const map = mapFor(name);
          if (map.has(key)) return false;
          map.set(key, value);
          return true;
        },
        async insertAllIfAbsent(entries) {
          const ordered = [...entries].sort((left, right) =>
            compareCanonicalStrings(left.key, right.key),
          );
          const keys = new Set(ordered.map((entry) => entry.key));
          if (keys.size !== ordered.length) {
            throw new TypeError("Guard batch claims require unique keys.");
          }
          const map = mapFor(name);
          if (ordered.some((entry) => map.has(entry.key))) return false;
          for (const entry of ordered) map.set(entry.key, entry.value);
          return true;
        },
        async delete(key) {
          mapFor(name).delete(key);
        },
        async has(key) {
          return mapFor(name).has(key);
        },
        async valuesWithPrefix(keyPrefix) {
          const out: T[] = [];
          for (const [key, value] of mapFor(name)) {
            if (key.startsWith(keyPrefix)) out.push(value as T);
          }
          return out;
        },
    };
  }

  return {
    durability: "EPHEMERAL_SINGLE_INSTANCE",
    description: "in-process memory (demo only; lost on cold start)",
    collection,
    versioned<T extends GuardVersionedRecord>(name: GuardCollectionName): GuardVersionedCollection<T> {
      return {
        ...collection<T>(name),
        async compareAndSet(key, expectedVersion, next) {
          /* Same guarantee as `insertIfAbsent` and for the same reason: this
             body runs to completion with no await inside it, so no other task
             can observe or write between the check and the write. */
          const map = mapFor(name);
          const current = map.get(key) as T | undefined;
          if (expectedVersion === null) {
            if (current !== undefined) return false;
          } else if (current === undefined || current.version !== expectedVersion) {
            return false;
          }
          map.set(key, next);
          return true;
        },
      };
    },
    async compareAndSetMany(writes) {
      const ordered = normalizeAtomicWrites(writes);
      for (const write of ordered) {
        const current = mapFor(write.collection).get(write.key) as GuardVersionedRecord | undefined;
        if (!atomicExpectationMatches(current, write.expectedVersion)) return false;
      }
      /* No await occurs between validation and mutation, so another task in
         this process cannot observe a partial batch. */
      for (const write of ordered) mapFor(write.collection).set(write.key, write.next);
      return true;
    },
  };
}

function normalizeAtomicWrites(
  writes: readonly GuardAtomicVersionedWrite[],
): readonly GuardAtomicVersionedWrite[] {
  if (writes.length === 0) throw new TypeError("An atomic Guard write batch cannot be empty.");
  const ordered = [...writes].sort((left, right) =>
    compareCanonicalStrings(`${left.collection}:${left.key}`, `${right.collection}:${right.key}`),
  );
  const identities = new Set(ordered.map((write) => `${write.collection}\u0000${write.key}`));
  if (identities.size !== ordered.length) {
    throw new TypeError("An atomic Guard write batch cannot target the same record twice.");
  }
  return ordered;
}

function atomicExpectationMatches(
  current: GuardVersionedRecord | undefined,
  expectedVersion: number | null,
): boolean {
  return expectedVersion === null
    ? current === undefined
    : current !== undefined && current.version === expectedVersion;
}

function readCollectionFile(file: string): Map<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError(`Invalid Guard collection state in ${file}.`);
    }
    return new Map(Object.entries(parsed as Record<string, unknown>));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw new Error(`Guard collection is corrupt or unreadable: ${file}.`, { cause: error });
  }
}

function writeCollectionFile(directory: string, file: string, map: Map<string, unknown>): void {
  /* The directory is created at construction, but a long-lived process can
     outlive it: a cleanup, a container restart with an unmounted volume, or an
     operator clearing state by hand. Without this, every later write throws
     ENOENT and the lifecycle fails permanently behind a generic 503 with no
     hint of the cause. Re-asserting the directory is cheap and idempotent. */
  mkdirSync(directory, { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(Object.fromEntries(map), null, 0), "utf8");
  renameSync(temporary, file);
}

/**
 * JSON-file adapter for a local or single-writer deployment.
 *
 * Every write is a whole-collection atomic replace (temp file + rename), which
 * is correct at prototype volume and keeps a torn file from ever being read.
 * It is explicitly NOT multi-writer safe: two instances writing the same
 * directory would clobber each other, which is why it declares
 * `DURABLE_SINGLE_WRITER` and the runtime blocks it on multi-instance targets.
 */
export function createFileGuardStore(options: { directory: string }): GuardStore {
  mkdirSync(options.directory, { recursive: true });
  const loaded = new Map<GuardCollectionName, Map<string, unknown>>();
  const transactionFile = join(options.directory, ".guard-atomic-transaction.json");

  function recoverAtomicTransaction(): void {
    if (!existsSync(transactionFile)) return;
    const parsed: unknown = JSON.parse(readFileSync(transactionFile, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError(`Invalid Guard atomic transaction state in ${transactionFile}.`);
    }
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!GUARD_COLLECTIONS.includes(name as GuardCollectionName)) {
        throw new TypeError(`Unknown Guard collection in ${transactionFile}.`);
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`Invalid Guard collection snapshot in ${transactionFile}.`);
      }
      const collectionName = name as GuardCollectionName;
      const next = new Map(Object.entries(value as Record<string, unknown>));
      writeCollectionFile(options.directory, join(options.directory, `${collectionName}.json`), next);
      loaded.set(collectionName, next);
    }
    unlinkSync(transactionFile);
  }

  recoverAtomicTransaction();

  function snapshot(name: GuardCollectionName): Map<string, unknown> {
    recoverAtomicTransaction();
    let map = loaded.get(name);
    if (!map) {
      map = readCollectionFile(join(options.directory, `${name}.json`));
      loaded.set(name, map);
    }
    return map;
  }

  function collection<T>(name: GuardCollectionName): GuardCollection<T> {
    const file = join(options.directory, `${name}.json`);
    return {
        async get(key) {
          return snapshot(name).get(key) as T | undefined;
        },
        async set(key, value) {
          const next = new Map(snapshot(name));
          next.set(key, value);
          writeCollectionFile(options.directory, file, next);
          loaded.set(name, next);
        },
        async insertIfAbsent(key, value) {
          /* Atomic against this process only, which is precisely what
             DURABLE_SINGLE_WRITER promises and no more. */
          const current = snapshot(name);
          if (current.has(key)) return false;
          const next = new Map(current);
          next.set(key, value);
          writeCollectionFile(options.directory, file, next);
          loaded.set(name, next);
          return true;
        },
        async insertAllIfAbsent(entries) {
          const ordered = [...entries].sort((left, right) =>
            compareCanonicalStrings(left.key, right.key),
          );
          const keys = new Set(ordered.map((entry) => entry.key));
          if (keys.size !== ordered.length) {
            throw new TypeError("Guard batch claims require unique keys.");
          }
          const current = snapshot(name);
          if (ordered.some((entry) => current.has(entry.key))) return false;
          const next = new Map(current);
          for (const entry of ordered) next.set(entry.key, entry.value);
          /* One collection map becomes one temp-file rename, so no caller or
             cold-start reader can observe only half of this batch. */
          writeCollectionFile(options.directory, file, next);
          loaded.set(name, next);
          return true;
        },
        async delete(key) {
          const current = snapshot(name);
          if (!current.has(key)) return;
          const next = new Map(current);
          next.delete(key);
          writeCollectionFile(options.directory, file, next);
          loaded.set(name, next);
        },
        async has(key) {
          return snapshot(name).has(key);
        },
        async valuesWithPrefix(keyPrefix) {
          const out: T[] = [];
          for (const [entryKey, value] of snapshot(name)) {
            if (entryKey.startsWith(keyPrefix)) out.push(value as T);
          }
          return out;
        },
    };
  }

  return {
    durability: "DURABLE_SINGLE_WRITER",
    description: `JSON files under ${options.directory} (single writer)`,
    collection,
    versioned<T extends GuardVersionedRecord>(name: GuardCollectionName): GuardVersionedCollection<T> {
      const file = join(options.directory, `${name}.json`);
      return {
        ...collection<T>(name),
        async compareAndSet(key, expectedVersion, next) {
          const current = snapshot(name);
          const stored = current.get(key) as T | undefined;
          if (expectedVersion === null) {
            if (stored !== undefined) return false;
          } else if (stored === undefined || stored.version !== expectedVersion) {
            return false;
          }
          const updated = new Map(current);
          updated.set(key, next);
          /* One temp-file rename, so a cold-start reader never sees a
             half-applied transition — the same guarantee the other writes make,
             and the reason a reservation's history survives a restart. */
          writeCollectionFile(options.directory, file, updated);
          loaded.set(name, updated);
          return true;
        },
      };
    },
    async compareAndSetMany(writes) {
      const ordered = normalizeAtomicWrites(writes);
      for (const write of ordered) {
        const current = snapshot(write.collection).get(write.key) as GuardVersionedRecord | undefined;
        if (!atomicExpectationMatches(current, write.expectedVersion)) return false;
      }

      const nextByCollection = new Map<GuardCollectionName, Map<string, unknown>>();
      for (const write of ordered) {
        let next = nextByCollection.get(write.collection);
        if (!next) {
          next = new Map(snapshot(write.collection));
          nextByCollection.set(write.collection, next);
        }
        next.set(write.key, write.next);
      }

      /* The journal is the crash-recovery commit record. A cold start that
         encounters it deterministically replays every collection snapshot
         before serving a read, so a process exit between file renames cannot
         expose half of an authorization boundary. */
      writeFileSync(
        `${transactionFile}.tmp`,
        JSON.stringify(Object.fromEntries(
          [...nextByCollection].map(([name, map]) => [name, Object.fromEntries(map)]),
        )),
        "utf8",
      );
      renameSync(`${transactionFile}.tmp`, transactionFile);
      recoverAtomicTransaction();
      return true;
    },
  };
}

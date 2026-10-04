/**
 * What a company behind a private-company token has said about tokens like
 * it — the risk line the asset carries, dated and sourced, with no estimate
 * of Ryntra's own.
 *
 * Kept by hand and versioned, like the issuer events of `lifecycle-events.ts`:
 * an entry is written from the company's statement as the press reported it,
 * never from a price move. The line is shown on the company's page beside the
 * truth about the token, and its sources one press deeper, under «Деталі».
 */

type Bi = Readonly<{ en: string; uk: string }>;

export type CompanyNotice = Readonly<{
  /** The company, as `companyKeyOf` normalizes it. */
  companyKey: string;
  /** The day of the statement, ISO. */
  date: string;
  /** The line a person reads. */
  line: Bi;
  /** Where it was reported, and when Ryntra read it. */
  sources: readonly Readonly<{ label: string; url: string }>[];
  readOn: string;
}>;

export const COMPANY_NOTICES_VERSION = "2026-09-25.1";

/**
 * Read on 2026-09-25. On 13 May 2026 Anthropic said any transfer of its
 * shares to a special purpose vehicle is void under its transfer
 * restrictions, and OpenAI warned that unauthorized transfers of its equity,
 * SPVs and tokenized instruments included, may be void and carry no economic
 * value for buyers; the PreStocks tokens on both fell sharply that week
 * (CoinDesk, The Block). PreStocks states its tokens are backed by SPV
 * exposure to the company's shares.
 */
const REPORTS = [
  { label: "CoinDesk", url: "https://www.coindesk.com/markets/2026/05/13/anthropic-openai-tokens-plunge-nearly-40-as-ai-firms-warn-spv-transfers-are-invalid" },
  { label: "The Block", url: "https://www.theblock.co/post/401088/anthropic-openai-tokenized-prestocks-plunge" },
] as const;

export const COMPANY_NOTICES: readonly CompanyNotice[] = [
  {
    companyKey: "openai",
    date: "2026-05-13",
    line: {
      en: "On 13 May 2026 OpenAI warned that transfers of its shares without its approval, through SPVs and tokens too, may be void and worth nothing to buyers — this token stands on an SPV.",
      uk: "13.05.2026 OpenAI попередила: передача її акцій без її згоди, зокрема через SPV і токени, може бути недійсною й нічого не вартувати для покупців — цей токен стоїть на SPV.",
    },
    sources: REPORTS,
    readOn: "2026-09-25",
  },
  {
    companyKey: "anthropic",
    date: "2026-05-13",
    line: {
      en: "On 13 May 2026 Anthropic said any transfer of its shares to an SPV is void under its transfer rules — this token stands on an SPV.",
      uk: "13.05.2026 Anthropic заявила: будь-яка передача її акцій у SPV недійсна за її правилами — цей токен стоїть на SPV.",
    },
    sources: REPORTS,
    readOn: "2026-09-25",
  },
];

const byCompany = new Map(COMPANY_NOTICES.map((notice) => [notice.companyKey, notice]));

/** The notice for a company, or null — the only way the registry is read. */
export function companyNoticeFor(companyKey: string | null | undefined): CompanyNotice | null {
  return companyKey ? (byCompany.get(companyKey) ?? null) : null;
}

/**
 * The issuer's reserve reports, as the same reporting found them: PreStocks
 * says third-party attestation reports are published periodically or on
 * request; CoinDesk reported on 13 May 2026 that the reports promised at
 * launch had not been published. Shown with its date and source, never as
 * Ryntra's finding.
 */
export const RESERVE_REPORTS_NOTE: Readonly<{ line: Bi; source: Readonly<{ label: string; url: string }>; date: string }> = {
  line: {
    en: "PreStocks says third-party attestation reports are published periodically or on request; on 13 May 2026 CoinDesk reported that the reports promised at launch had not been published.",
    uk: "PreStocks зазначає, що звіти незалежних аудиторів про резерви публікуються періодично або на запит; 13.05.2026 CoinDesk писав, що обіцяних на старті звітів не опубліковано.",
  },
  source: REPORTS[0],
  date: "2026-05-13",
};

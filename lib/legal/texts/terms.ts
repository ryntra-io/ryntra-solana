import { CONTACTS, contactMailto } from "../../site/contacts.ts";
import { LEGAL_FEES as FEES, LEGAL_REWARDS as REWARDS } from "./figures.ts";
import { LAUNCH_SECTION_ID, launchTerms } from "./launch.ts";
import { link, list, p, strong, type LegalDocument, type LegalLang } from "./model.ts";

/**
 * The Terms of Use, word for word as published at `/legal/terms` (effective 7 October 2026). The Terms are English
 * until a lawyer gives them Ukrainian; their section on the tokens a person launches is written in both and follows
 * the reader's language (`launch.ts`). The figures — the service fees, the Rewards split, the claim floor — are read
 * from the policy the product charges and accrues with (`figures.ts`).
 */
export function termsOfUse(lang: LegalLang = "en"): LegalDocument {
  const launch = launchTerms(lang);
  const mail = () => link(CONTACTS.email, contactMailto());
  return {
    id: "terms",
    path: "/legal/terms",
    title: "Terms of Use",
    effective: "Effective date: October 7, 2026",
    intro: [
      p(
        "These Terms of Use (“Terms”) govern your access to and use of the Ryntra website at ",
        link("ryntra.io", "https://ryntra.io"),
        ", the Ryntra cabinet, the Ryntra app for Android, the Ryntra Telegram bot and related services (together, the “Service”). By using the Service you agree to these Terms. If you do not agree, do not use the Service.",
      ),
      ...(launch.pointer ? [{ ...p(`${launch.pointer.text} `, link(launch.pointer.link, `#${LAUNCH_SECTION_ID}`), "."), lang: "uk" as const }] : []),
    ],
    sections: [
      {
        id: "what-ryntra-is",
        heading: "1. What Ryntra is",
        lang: "en",
        blocks: [
          p(
            "Ryntra is an independent, non-custodial trading and strategy platform for the Solana network. Today the Service lets you exchange assets on Solana (Swap and Spot, including tokenized stocks and other tokenized assets issued by third parties), move value between Solana and other networks (Bridge), send and receive assets, launch a token of your own (Launch), see what a wallet holds (Portfolio), keep a record of your operations (Activity and receipts), and take part in the Rewards and Points programme. Strategy features are in development and are marked as such in the Service. Ryntra is not an exchange, a broker, a custodian or an investment adviser, and it is not affiliated with, endorsed by, or operated by any wallet provider, liquidity or bridging provider, blockchain network or token issuer whose services or assets appear in the Service.",
          ),
        ],
      },
      {
        id: "non-custodial",
        heading: "2. Non-custodial. No deposits. No wallet keys.",
        lang: "en",
        blocks: [
          list(
            ["Ryntra never accepts, holds, or transmits your funds. There is no way to deposit money with Ryntra, and we will never ask you to."],
            ["Ryntra never asks for, stores, or has access to your wallet seed phrase, wallet private keys or wallet password. Anyone asking for them in Ryntra’s name is a scammer."],
            ["Every financial action — a swap, a trade, a bridge, a transfer, a rewards claim — is executed by your own wallet: Ryntra prepares a transaction, shows you exactly what it does, and your wallet signs it. Ryntra cannot sign, cannot change a transaction after you reviewed it, and holds no standing permission over your wallet."],
            ["Balances and market data shown in the Service are read from public blockchain data and third-party market data for the wallet address you connect."],
          ),
        ],
      },
      {
        id: "beta",
        heading: "3. Beta program",
        lang: "en",
        blocks: [
          p(
            "The Service is provided as a beta on Solana Mainnet. It moves real assets and it is still being built: features may change, be added or be removed, and pages that are not yet available are marked as in development or planned. Use of the beta is free of subscription charges. ",
            strong("Ryntra makes no promises of tokens, airdrops, or monetary rewards"),
            " beyond the Rewards programme described in Section 5. We may change, suspend, or end the beta program at any time.",
          ),
        ],
      },
      {
        id: "eligibility",
        heading: "4. Eligibility and geographic restrictions",
        lang: "en",
        blocks: [
          list(
            ["You must be at least 18 years old (or the age of majority in your jurisdiction) to use the Service."],
            ["Tokenized stocks and other tokenized assets are issued by third parties under their own terms, which restrict who may hold them by jurisdiction and otherwise. The Service shows the issuer of each such asset; you are responsible for checking that you are eligible under the issuer’s terms before acquiring one."],
            ["You are solely responsible for ensuring that your use of the Service complies with the laws of your jurisdiction, including any restriction on trading digital or tokenized assets. Do not use the Service to circumvent geographic or regulatory restrictions."],
          ),
        ],
      },
      {
        id: "rewards",
        heading: "5. Rewards, referrals and Points",
        lang: "en",
        blocks: [
          p(
            `When Ryntra receives its service fee on an eligible operation, a share of the fee it received — after any provider’s own share — is credited under the Rewards programme: ${REWARDS.cashbackPercent}% to the wallet that made the operation, ${REWARDS.referralL1Percent}% to the wallet that invited it, by that wallet’s rank when the operation settled, and ${REWARDS.referralL2Percent}% to the wallet that invited that one. Only a fee actually received by Ryntra is eligible; an operation on a route that carries no Ryntra fee, or a quoted fee that was not collected, earns nothing. Rewards are paid in USDC on Solana to the wallet you are signed in with, from a minimum of $${REWARDS.claimFloorUsd.toFixed(2)} USDC per claim, and are credited only after the operation has settled and its fee is confirmed. An inviter, once confirmed, cannot be changed; self-referral and circular referrals are refused. A wallet’s rank is set by its rank points over the last ${REWARDS.rankWindowDays} days — one for each dollar of fee Ryntra received on the wallet’s own operations and on those of wallets it invited; rank points, like Points, have no cash value and cannot be transferred. Points record activity on the Service, have no cash value, cannot be transferred, and carry no promise of any token, airdrop or conversion. We may change, suspend or end the Rewards and Points programme; a change applies to operations made after it takes effect.`,
          ),
        ],
      },
      {
        id: "fees",
        heading: "6. Fees",
        lang: "en",
        blocks: [
          p(
            `Ryntra charges a service fee of ${FEES.swap} of the amount on Swap and Spot operations and ${FEES.bridge} on Bridge operations. The fee is shown before you sign and is included in the quoted figures. Network fees, token account reserves, provider costs, price impact and slippage are not Ryntra’s fees; they are shown separately before you sign and are paid to the network, kept by your own account, or borne in the market. Ryntra charges nothing for Send, Receive or rewards claims beyond the network’s own fee, and nothing for browsing the Service.`,
          ),
        ],
      },
      {
        id: "not-advice",
        heading: "7. Not financial advice",
        lang: "en",
        blocks: [
          p(
            "Nothing in the Service is investment, financial, legal, or tax advice, and nothing in the Service is an offer or solicitation to buy or sell any asset. All content — including charts, market figures, analytics, research, risk figures and any generated explanation — is provided for informational purposes only. You alone are responsible for your trading decisions.",
          ),
        ],
      },
      {
        id: "risk",
        heading: "8. Risk disclosure",
        lang: "en",
        blocks: [
          p(
            "Digital assets are volatile and can lose all of their value. Meme tokens can move violently and can become illiquid without warning. A tokenized stock is a token issued by a third party that tracks a share’s price under the issuer’s terms; it is not the share itself, its price can differ from the reference — especially outside the reference exchange’s hours — and it is subject to the issuer’s solvency, terms and powers over the token. Bridges cross networks and providers and can be delayed. Blockchain transactions are final and cannot be reversed by Ryntra. Past performance does not indicate future results.",
          ),
        ],
      },
      {
        id: "acceptable-use",
        heading: "9. Acceptable use",
        lang: "en",
        blocks: [
          list(
            ["Do not use the Service for unlawful purposes, market manipulation, or wash trading."],
            ["Do not attempt to gain unauthorized access to the Service, other users’ data, or underlying infrastructure."],
            ["Do not abuse, overload, scrape at scale, or resell the Service without our written permission."],
            ["Do not abuse the Rewards programme, including through self-referral, circular referrals or artificial volume."],
            ["Do not impersonate Ryntra or misrepresent your affiliation with us."],
          ),
        ],
      },
      {
        id: LAUNCH_SECTION_ID,
        heading: launch.heading,
        lang,
        blocks: [
          p(launch.intro),
          list(...launch.forbidden.map((line) => [line])),
          ...launch.after.map((line) => p(line)),
          p(`${launch.report.before} `, mail(), ` ${launch.report.after}`),
        ],
      },
      {
        id: "third-parties",
        heading: "11. Third-party services",
        lang: "en",
        blocks: [
          p(
            "The Service interoperates with third parties — wallet software, the Solana network and the other networks a bridge crosses, liquidity, routing and bridging providers, market data sources, token issuers and Telegram — each governed by its own terms and policies. Ryntra does not control these services and is not responsible for them, including their availability, data accuracy, order execution, or the terms under which a token is issued.",
          ),
        ],
      },
      {
        id: "ip",
        heading: "12. Intellectual property",
        lang: "en",
        blocks: [
          p(
            "The Service, including its design, code, and content (excluding third-party materials and your own content), is owned by Ryntra and protected by applicable intellectual-property laws. We grant you a limited, non-exclusive, non-transferable, revocable license to use the Service for personal, non-commercial purposes. The notes, plans and other content you create in the Service remain yours.",
          ),
        ],
      },
      {
        id: "liability",
        heading: "13. Disclaimers and limitation of liability",
        lang: "en",
        blocks: [
          p(
            "The Service is beta software provided ",
            strong("“as is” and “as available”"),
            ", without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, accuracy, or uninterrupted operation. Market data may be delayed, incomplete, or incorrect. To the maximum extent permitted by law, Ryntra and its contributors will not be liable for any indirect, incidental, special, consequential, or exemplary damages, or for any loss of profits, funds, data, or goodwill, arising from or related to your use of the Service — including trading losses, losses caused by a third-party provider, network or token issuer, and losses caused by a compromised device or wallet.",
          ),
        ],
      },
      {
        id: "termination",
        heading: "14. Termination",
        lang: "en",
        blocks: [
          p(
            "We may suspend or terminate your access to the Service at any time, including for violation of these Terms or abuse of the beta or Rewards programme. You may stop using the Service at any time and may request deletion of your data as described in the ",
            link("Privacy Policy", "/legal/privacy"),
            ". Assets in your wallet are unaffected by any suspension, because Ryntra never holds them.",
          ),
        ],
      },
      {
        id: "changes",
        heading: "15. Changes to these Terms",
        lang: "en",
        blocks: [
          p(
            "We may update these Terms from time to time. The effective date above reflects the latest revision. Material changes will be announced in the Service. Continued use of the Service after changes take effect constitutes acceptance.",
          ),
        ],
      },
      {
        id: "contact",
        heading: "16. Contact",
        lang: "en",
        blocks: [p("Ryntra — ", mail())],
      },
    ],
  };
}

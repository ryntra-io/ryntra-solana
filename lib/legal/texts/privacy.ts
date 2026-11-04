import { CONTACTS, contactMailto } from "../../site/contacts.ts";
import { ANDROID_SECTION_ID, androidPrivacy } from "./android.ts";
import { link, list, p, strong, type LegalDocument, type LegalLang } from "./model.ts";

/**
 * The Privacy Policy, word for word as published at `/legal/privacy` (effective 7 October 2026). The policy is English
 * until a lawyer gives it Ukrainian; its section on the Android app is written in both and follows the reader's
 * language (`android.ts`) — the store listing and Help link to it by its anchor, `#android`.
 */
export function privacyPolicy(lang: LegalLang = "en"): LegalDocument {
  const android = androidPrivacy(lang);
  const mail = () => link(CONTACTS.email, contactMailto());
  return {
    id: "privacy",
    path: "/legal/privacy",
    title: "Privacy Policy",
    effective: "Effective date: October 7, 2026",
    intro: [
      p(
        "This Privacy Policy explains what data Ryntra (“we”, “us”) collects through ",
        link("ryntra.io", "https://ryntra.io"),
        ", the Ryntra cabinet, the Ryntra app for Android and the Ryntra Telegram bot, how we use it, and the choices you have. Our approach is data minimalism: we collect only what the product needs to work, and the product needs remarkably little — your account is your wallet.",
      ),
      ...(android.pointer ? [{ ...p(`${android.pointer.text} `, link(android.pointer.link, `#${ANDROID_SECTION_ID}`), "."), lang: "uk" as const }] : []),
    ],
    sections: [
      {
        id: "collect",
        heading: "1. Data we collect",
        lang: "en",
        blocks: [
          list(
            [
              strong("Wallet address (public)"),
              " — when you connect a wallet. A wallet address is public blockchain information; it lets us show what the wallet holds, prepare transactions for it and keep the record of the operations you make through Ryntra. We never ask for seed phrases, private keys or wallet passwords.",
            ],
            [
              strong("Sign-in signature and sessions"),
              " — when you sign in with your wallet. Signing in is a message your wallet signs; we keep the signature’s proof, the account it created for that address, and server-side session records (issue and expiry times, last activity, revocation state) so that sessions can be managed, and ended on one device or on all of them. There is no email, password or social sign-in for customers.",
            ],
            [
              strong("Operations and receipts"),
              " — the swaps, trades, bridges, transfers and rewards claims you make through Ryntra: what you reviewed, what the network did, the transaction signatures and their status. This is the Activity history and the receipts you can open there.",
            ],
            [
              strong("Rewards, Points and referrals"),
              " — the ledgers that record cashback and referral shares accrued to your wallet, your Points and level, your referral code, the wallet that invited you and the wallets you invited, and the claims you made.",
            ],
            [
              strong("Preferences kept on the account"),
              " — your Spot watchlist. Language, theme and the Simple/Pro depth are kept in your browser only and are not sent to us.",
            ],
            [
              strong("Telegram channel data (optional)"),
              " — if you connect Telegram as a notification channel from Settings, or interact with the bot: your Telegram identifier and the basic profile data Telegram supplies, such as your username, name and interface language, and the messages you send the bot. Telegram is a notification channel, not a way to sign in.",
            ],
            [
              strong("Correspondence and feedback"),
              " — if you email us or use the feedback form, we process your message and any details you include in order to answer you or act on it, and we keep the thread while it is needed for that. We do not operate an email waitlist.",
            ],
            [
              strong("First-party cookies"),
              " — a session cookie for the signed-in account, short-lived sign-in state, a wallet-proof cookie when you request proof of ownership, and a preference cookie for the public site’s language. We do not use advertising or cross-site tracking cookies.",
            ],
            [
              strong("Usage events"),
              " — we record page and call-to-action events in our own database to understand how the product is used. Each event may include the event name, the placement and locale, the page path, and the referring URL (truncated). We also use Vercel Analytics for aggregate traffic. None of this is used to build individual advertising profiles or sold.",
            ],
          ),
        ],
      },
      {
        id: ANDROID_SECTION_ID,
        heading: android.heading,
        lang,
        blocks: [p(android.intro), list(...android.items.map((item) => [strong(item.lead), ` — ${item.body}`]))],
      },
      {
        id: "never",
        heading: "3. Data we never collect",
        lang: "en",
        blocks: [
          list(
            ["Seed phrases, wallet private keys, wallet passwords, or any credential that controls funds."],
            ["Deposits or funds of any kind — Ryntra is non-custodial by design."],
            ["Payment or card data — there is nothing to pay Ryntra; its service fee is part of the on-chain transaction your wallet signs."],
            ["An email address or password for a customer account — the wallet is the account."],
          ),
        ],
      },
      {
        id: "use",
        heading: "4. How we use data",
        lang: "en",
        blocks: [
          list(
            ["To provide the cabinet: read what your wallet holds, prepare and simulate the transactions you ask for, and record their results as Activity and receipts."],
            ["To run the Rewards and Points programme: accrue cashback and referral shares on collected fees, count Points, and pay claims to the wallet you are signed in with."],
            ["To send the notifications you asked for through the Telegram channel you connected, or to your phone if you turn phone notifications on."],
            ["To respond to you, prevent abuse, and keep the Service secure (including rate limiting and session management)."],
            ["To understand aggregate product usage and improve the Service."],
          ),
          p("We do not sell your data, and we do not share it with advertisers."),
        ],
      },
      {
        id: "processed",
        heading: "5. Where data is processed",
        lang: "en",
        blocks: [
          p("Your data is processed by the infrastructure and service providers we rely on to run the Service:"),
          list(
            [strong("Supabase"), " — database hosting for accounts and proven wallets, session records, operations and receipts, the Rewards, Points and referral ledgers, watchlists, notification channels, feedback and usage events."],
            [strong("Vercel"), " — website hosting and privacy-friendly aggregate analytics."],
            [strong("Telegram"), " — bot messaging for the notification channel you connect; your interaction is also subject to Telegram’s own privacy policy."],
            [strong("Google Firebase Cloud Messaging"), " — delivers the phone notifications you turn on in the Ryntra app for Android; it receives the phone’s push token and the note."],
            [
              strong("Blockchain and market providers"),
              " — a Solana RPC provider and the liquidity, routing, bridging and market-data providers that price and execute your operations receive what the operation needs: your public wallet address and the transaction your wallet will sign. A transaction you sign is public on the blockchain by nature.",
            ],
          ),
          p("These providers process data on our behalf and under their own security and compliance programs. We do not transfer your data to anyone else, except where required by law."),
        ],
      },
      {
        id: "retention",
        heading: "6. Retention and deletion",
        lang: "en",
        blocks: [
          p(
            "We keep your data while your account is in use. You can request deletion of your account data at any time — email ",
            mail(),
            " from a way we can link to your account (for example, by mentioning the wallet address you sign in with; we may ask you to prove ownership with a signature). We will delete your account data within 30 days of a verified request. Transactions recorded on a public blockchain cannot be deleted by anyone, including us. Residual copies may persist in encrypted backups for a limited period before being purged.",
          ),
        ],
      },
      {
        id: "rights",
        heading: "7. Your rights",
        lang: "en",
        blocks: [
          p(
            "Depending on your jurisdiction, you may have rights to access, correct, export, or delete your personal data, and to object to or restrict certain processing. To exercise any of these rights, contact us at ",
            mail(),
            ". We will respond within a reasonable time and in accordance with applicable law.",
          ),
        ],
      },
      {
        id: "children",
        heading: "8. Children",
        lang: "en",
        blocks: [p("The Service is not directed to persons under 18, and we do not knowingly collect data from them. If you believe a minor has provided us data, contact us and we will delete it.")],
      },
      {
        id: "changes",
        heading: "9. Changes to this policy",
        lang: "en",
        blocks: [p("We may update this Privacy Policy from time to time. The effective date above reflects the latest revision. Material changes will be announced in the Service.")],
      },
      {
        id: "contact",
        heading: "10. Contact",
        lang: "en",
        blocks: [p("Ryntra — ", mail())],
      },
    ],
  };
}

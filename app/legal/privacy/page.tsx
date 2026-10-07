import type { Metadata } from "next";
import { CONTACTS, contactMailto } from "@/lib/site/contacts";
import { publicServerLocale } from "@/lib/site/server-locale";

import { ANDROID_SECTION_ID, androidPrivacy } from "./android";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for Ryntra on the web, in the Android app and in the Telegram bot — what data we collect for a wallet, what the phone keeps, what we never collect, who processes it, and how to delete it.",
  alternates: { canonical: "https://ryntra.io/legal/privacy" },
};

export default async function PrivacyPage() {
  /* The policy is English until a lawyer gives it Ukrainian; its section on
     the Android app is written in both, and follows the reader's language. */
  const locale = await publicServerLocale();
  const android = androidPrivacy(locale);
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Effective date: October 7, 2026</p>

      <p>
        This Privacy Policy explains what data Ryntra (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects through{" "}
        <a href="https://ryntra.io">ryntra.io</a>, the Ryntra cabinet, the Ryntra app for Android and the Ryntra
        Telegram bot, how we use it, and the choices you have. Our approach is data minimalism: we collect only
        what the product needs to work, and the product needs remarkably little — your account is your wallet.
      </p>
      {android.pointer ? (
        <p lang="uk">
          {android.pointer.text} <a href={`#${ANDROID_SECTION_ID}`}>{android.pointer.link}</a>.
        </p>
      ) : null}

      <h2>1. Data we collect</h2>
      <ul>
        <li>
          <strong>Wallet address (public)</strong> — when you connect a wallet. A wallet address is public
          blockchain information; it lets us show what the wallet holds, prepare transactions for it and
          keep the record of the operations you make through Ryntra. We never ask for seed phrases,
          private keys or wallet passwords.
        </li>
        <li>
          <strong>Sign-in signature and sessions</strong> — when you sign in with your wallet. Signing in is
          a message your wallet signs; we keep the signature&rsquo;s proof, the account it created for that
          address, and server-side session records (issue and expiry times, last activity, revocation
          state) so that sessions can be managed, and ended on one device or on all of them. There is no
          email, password or social sign-in for customers.
        </li>
        <li>
          <strong>Operations and receipts</strong> — the swaps, trades, bridges, transfers and rewards claims
          you make through Ryntra: what you reviewed, what the network did, the transaction signatures and
          their status. This is the Activity history and the receipts you can open there.
        </li>
        <li>
          <strong>Rewards, Points and referrals</strong> — the ledgers that record cashback and referral
          shares accrued to your wallet, your Points and level, your referral code, the wallet that invited
          you and the wallets you invited, and the claims you made.
        </li>
        <li>
          <strong>Preferences kept on the account</strong> — your Spot watchlist. Language, theme and the
          Simple/Pro depth are kept in your browser only and are not sent to us.
        </li>
        <li>
          <strong>Telegram channel data (optional)</strong> — if you connect Telegram as a notification
          channel from Settings, or interact with the bot: your Telegram identifier and the basic profile data
          Telegram supplies, such as your username, name and interface language, and the messages you send
          the bot. Telegram is a notification channel, not a way to sign in.
        </li>
        <li>
          <strong>Correspondence and feedback</strong> — if you email us or use the feedback form, we process
          your message and any details you include in order to answer you or act on it, and we keep the
          thread while it is needed for that. We do not operate an email waitlist.
        </li>
        <li>
          <strong>First-party cookies</strong> — a session cookie for the signed-in account, short-lived
          sign-in state, a wallet-proof cookie when you request proof of ownership, and a preference cookie
          for the public site&rsquo;s language. We do not use advertising or cross-site tracking cookies.
        </li>
        <li>
          <strong>Usage events</strong> — we record page and call-to-action events in our own database to
          understand how the product is used. Each event may include the event name, the placement and
          locale, the page path, and the referring URL (truncated). We also use Vercel Analytics for
          aggregate traffic. None of this is used to build individual advertising profiles or sold.
        </li>
      </ul>

      <h2 id={ANDROID_SECTION_ID} lang={locale}>{android.heading}</h2>
      <p lang={locale}>{android.intro}</p>
      <ul lang={locale}>
        {android.items.map((item) => (
          <li key={item.lead}>
            <strong>{item.lead}</strong> — {item.body}
          </li>
        ))}
      </ul>

      <h2>3. Data we never collect</h2>
      <ul>
        <li>Seed phrases, wallet private keys, wallet passwords, or any credential that controls funds.</li>
        <li>Deposits or funds of any kind — Ryntra is non-custodial by design.</li>
        <li>Payment or card data — there is nothing to pay Ryntra; its service fee is part of the on-chain transaction your wallet signs.</li>
        <li>An email address or password for a customer account — the wallet is the account.</li>
      </ul>

      <h2>4. How we use data</h2>
      <ul>
        <li>To provide the cabinet: read what your wallet holds, prepare and simulate the transactions you ask for, and record their results as Activity and receipts.</li>
        <li>To run the Rewards and Points programme: accrue cashback and referral shares on collected fees, count Points, and pay claims to the wallet you are signed in with.</li>
        <li>To send the notifications you asked for through the Telegram channel you connected, or to your phone if you turn phone notifications on.</li>
        <li>To respond to you, prevent abuse, and keep the Service secure (including rate limiting and session management).</li>
        <li>To understand aggregate product usage and improve the Service.</li>
      </ul>
      <p>We do not sell your data, and we do not share it with advertisers.</p>

      <h2>5. Where data is processed</h2>
      <p>Your data is processed by the infrastructure and service providers we rely on to run the Service:</p>
      <ul>
        <li><strong>Supabase</strong> — database hosting for accounts and proven wallets, session records, operations and receipts, the Rewards, Points and referral ledgers, watchlists, notification channels, feedback and usage events.</li>
        <li><strong>Vercel</strong> — website hosting and privacy-friendly aggregate analytics.</li>
        <li><strong>Telegram</strong> — bot messaging for the notification channel you connect; your interaction is also subject to Telegram&rsquo;s own privacy policy.</li>
        <li><strong>Google Firebase Cloud Messaging</strong> — delivers the phone notifications you turn on in the Ryntra app for Android; it receives the phone&rsquo;s push token and the note.</li>
        <li>
          <strong>Blockchain and market providers</strong> — a Solana RPC provider and the liquidity, routing,
          bridging and market-data providers that price and execute your operations receive what the
          operation needs: your public wallet address and the transaction your wallet will sign. A
          transaction you sign is public on the blockchain by nature.
        </li>
      </ul>
      <p>
        These providers process data on our behalf and under their own security and compliance
        programs. We do not transfer your data to anyone else, except where required by law.
      </p>

      <h2>6. Retention and deletion</h2>
      <p>
        We keep your data while your account is in use. You can request deletion of your account data at
        any time — email <a href={contactMailto()}>{CONTACTS.email}</a> from a way we can link to your
        account (for example, by mentioning the wallet address you sign in with; we may ask you to prove
        ownership with a signature). We will delete your account data within 30 days of a verified request.
        Transactions recorded on a public blockchain cannot be deleted by anyone, including us. Residual
        copies may persist in encrypted backups for a limited period before being purged.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Depending on your jurisdiction, you may have rights to access, correct, export, or delete your
        personal data, and to object to or restrict certain processing. To exercise any of these
        rights, contact us at <a href={contactMailto()}>{CONTACTS.email}</a>. We will respond
        within a reasonable time and in accordance with applicable law.
      </p>

      <h2>8. Children</h2>
      <p>
        The Service is not directed to persons under 18, and we do not knowingly collect data from
        them. If you believe a minor has provided us data, contact us and we will delete it.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. The effective date above reflects the
        latest revision. Material changes will be announced in the Service.
      </p>

      <h2>10. Contact</h2>
      <p>
        Ryntra — <a href={contactMailto()}>{CONTACTS.email}</a>
      </p>
    </>
  );
}

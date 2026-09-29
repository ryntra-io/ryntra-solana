import Link from "next/link";
import { ArrowLeft, ArrowUpRight, TelegramLogo } from "@phosphor-icons/react/dist/ssr";
import { ProductProof } from "../components/product-proof";
import "../landing/landing.css";

const TELEGRAM_BOT = "https://t.me/RyntraBeta_bot";

export function PublicDemoTour() {
  return (
    <div className="lp-root public-demo">
      <header className="public-demo-header">
        <div className="container">
          <Link href="/" className="lp-logo-link">
            <span className="logo" aria-label="Ryntra">RYN<em>TRA</em></span>
          </Link>
          <Link href="/" className="btn btn-ghost btn-sm">
            <ArrowLeft size={16} weight="bold" aria-hidden />
            Back to home
          </Link>
        </div>
      </header>

      <main className="public-demo-main">
        <div className="container">
          <div className="public-demo-intro">
            <div>
              <span className="lp-eyebrow">
                <span aria-hidden />
                PUBLIC · READ-ONLY · DETERMINISTIC
              </span>
              <h1>Inspect the decision structure before beta.</h1>
            </div>
            <div>
              <p>
                This sample keeps one risk state, plan constraints, evidence and a
                decision journal in the same view. Arcus appears only as scoped adapter
                evidence, not as Ryntra’s identity.
              </p>
              <p className="public-demo-note">
                Sample values only. No wallet connection, signature, receipt, order or
                ReviewRecord is created. The complete canonical loop remains planned.
              </p>
            </div>
          </div>

          <ProductProof idPrefix="public-demo-ledger" />

          <ol className="public-demo-next" aria-label="How beta access works">
            <li><span className="mono">01</span><strong>Open the Ryntra Telegram bot</strong></li>
            <li><span className="mono">02</span><strong>Verify beta access</strong></li>
            <li><span className="mono">03</span><strong>Inspect the supported workspace scope</strong></li>
          </ol>

          <div className="public-demo-actions">
            <a href={TELEGRAM_BOT} target="_blank" rel="noreferrer" className="btn btn-primary">
              <TelegramLogo size={18} weight="fill" aria-hidden />
              Start in Telegram
              <ArrowUpRight size={16} weight="bold" aria-hidden />
            </a>
            <Link href="/docs/core-principles" className="btn btn-ghost">Read the methodology</Link>
          </div>
        </div>
      </main>
    </div>
  );
}

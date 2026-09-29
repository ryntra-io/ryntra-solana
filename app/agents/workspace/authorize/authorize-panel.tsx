"use client";

import { CheckCircle, ShieldWarning, Wallet } from "@phosphor-icons/react";
import { useState } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import {
  AGENT_AUTHORIZATION_PRIMARY_TYPE,
  AGENT_AUTHORIZATION_TYPES,
  buildAgentAuthorizationChallenge,
} from "@/lib/agent-control/authorization";

import { useAgentI18n } from "../i18n/provider";

const BNB_TESTNET_CHAIN_ID = 97;
const BNB_TESTNET_CHAIN_ID_HEX = "0x61";

type PanelCopy = {
  noWallet: string;
  notConnected: string;
  wrongNetwork: string;
  buildFailed: string;
  declined: string;
  checkFailedHttp: (status: number) => string;
  checkFailed: string;
  kicker: string;
  heading: string;
  hashLabel: string;
  connect: string;
  waiting: string;
  sign: string;
  note: string;
  notAuthorized: string;
  valid: string;
  refused: string;
  recovers: string;
  didNotDo: string;
};

const COPY = {
  en: {
    noWallet: "No browser wallet was found. Install one, then reload this page.",
    notConnected: "The wallet did not connect.",
    wrongNetwork: "The wallet is not on BNB Testnet.",
    buildFailed: "The authorization could not be built.",
    declined: "The signature was declined.",
    checkFailedHttp: (status: number) => `The check failed with HTTP ${status}.`,
    checkFailed: "The authorization could not be checked.",
    kicker: "Human authorization",
    heading: "Sign one artifact in your own wallet",
    hashLabel: "Artifact content hash",
    connect: "Connect wallet",
    waiting: "Waiting for your wallet…",
    sign: "Sign authorization",
    note:
      "Your wallet will show four readable fields, not a hex blob: the artifact hash, your address, a one-time nonce and an expiry fifteen minutes out. Ryntra never holds a key and cannot produce this signature.",
    notAuthorized: "NOT AUTHORIZED",
    valid: "AUTHORIZATION VALID",
    refused: "AUTHORIZATION REFUSED",
    recovers: "The signature recovers to this address over this exact artifact.",
    didNotDo: "What this did not do",
  },
  uk: {
    noWallet: "Браузерний гаманець не знайдено. Встановіть його й перезавантажте цю сторінку.",
    notConnected: "Гаманець не підключився.",
    wrongNetwork: "Гаманець не в мережі BNB Testnet.",
    buildFailed: "Не вдалося сформувати авторизацію.",
    declined: "Підпис відхилено.",
    checkFailedHttp: (status: number) => `Перевірка не вдалася: HTTP ${status}.`,
    checkFailed: "Не вдалося перевірити авторизацію.",
    kicker: "Авторизація людиною",
    heading: "Підпишіть один артефакт у власному гаманці",
    hashLabel: "Хеш вмісту артефакту",
    connect: "Підключити гаманець",
    waiting: "Очікуємо на ваш гаманець…",
    sign: "Підписати авторизацію",
    note:
      "Гаманець покаже чотири читабельні поля, а не hex-блоб: хеш артефакту, вашу адресу, одноразовий nonce і строк дії за пʼятнадцять хвилин. Ryntra ніколи не тримає ключа й не може створити цей підпис.",
    notAuthorized: "НЕ АВТОРИЗОВАНО",
    valid: "АВТОРИЗАЦІЯ ДІЙСНА",
    refused: "АВТОРИЗАЦІЮ ВІДХИЛЕНО",
    recovers: "Підпис відновлюється до цієї адреси саме над цим артефактом.",
    didNotDo: "Чого це не зробило",
  },
} as const satisfies Record<WorkspaceLocale, PanelCopy>;

type Verdict =
  | { authorized: true; subject: string; limitations: readonly string[] }
  | { authorized: false; reasonCode: string; detail: string; limitations: readonly string[] };

type Ethereum = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

function ethereum(): Ethereum | null {
  const injected = (globalThis as unknown as { ethereum?: Ethereum }).ethereum;
  return injected ?? null;
}

/** Wallets report an unknown chain as 4902, and it is the expected answer here. */
function errorCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : null;
}

function describe(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

/**
 * Put the wallet on BNB Testnet, adding the network if it does not have it.
 *
 * The chain is part of the signed EIP-712 domain, so a signature made on the
 * wrong network verifies against nothing. Most wallets ship without BSC
 * Testnet, and asking them to switch to a chain they have never heard of
 * returns 4902 rather than a prompt - which is why the switch alone was never
 * going to be enough.
 */
async function ensureBnbTestnet(provider: Ethereum): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BNB_TESTNET_CHAIN_ID_HEX }],
    });
    return;
  } catch (error: unknown) {
    if (errorCode(error) !== 4902) throw error;
  }
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [{
      chainId: BNB_TESTNET_CHAIN_ID_HEX,
      chainName: "BNB Smart Chain Testnet",
      nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
      rpcUrls: ["https://bsc-testnet-dataseed.bnbchain.org"],
      blockExplorerUrls: ["https://testnet.bscscan.com"],
    }],
  });
}

function randomNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `n-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function AgentAuthorizePanel() {
  const { locale } = useAgentI18n();
  const copy = COPY[locale];

  const [contentHash, setContentHash] = useState("");
  const [account, setAccount] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "connecting" | "signing" | "checking">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const hashLooksRight = /^0x[0-9a-f]{64}$/.test(contentHash.trim());

  async function connect() {
    const provider = ethereum();
    if (!provider) {
      setProblem(copy.noWallet);
      return;
    }
    setProblem(null);
    setPhase("connecting");
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      /* Set the account first and keep it. Connection and network are two
         separate things, and the first version wrapped both in one try - so a
         wallet that connected fine but could not switch reported "did not
         connect" and threw the working connection away with the error. */
      setAccount(accounts[0] ?? null);
      await ensureBnbTestnet(provider);
    } catch (error: unknown) {
      setProblem(describe(error, copy.notConnected));
    } finally {
      setPhase("idle");
    }
  }

  async function authorize() {
    const provider = ethereum();
    if (!provider || !account) return;
    setProblem(null);
    setVerdict(null);

    /* Re-checked at signing time, not only at connection: a wallet can be
       switched away between the two, and the resulting signature would carry a
       domain nothing verifies against. */
    try {
      await ensureBnbTestnet(provider);
    } catch (error: unknown) {
      setProblem(describe(error, copy.wrongNetwork));
      return;
    }

    const hash = contentHash.trim();
    const nonce = randomNonce();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    let challenge;
    try {
      challenge = buildAgentAuthorizationChallenge({
        contentHash: hash,
        subject: account,
        nonce,
        expiresAt,
        chainId: BNB_TESTNET_CHAIN_ID,
      });
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : copy.buildFailed);
      return;
    }

    setPhase("signing");
    let signature: string;
    try {
      signature = (await provider.request({
        method: "eth_signTypedData_v4",
        params: [
          account,
          JSON.stringify({
            domain: challenge.domain,
            primaryType: AGENT_AUTHORIZATION_PRIMARY_TYPE,
            types: {
              EIP712Domain: [
                { name: "name", type: "string" },
                { name: "version", type: "string" },
                { name: "chainId", type: "uint256" },
              ],
              ...AGENT_AUTHORIZATION_TYPES,
            },
            message: {
              contentHash: challenge.message.contentHash,
              subject: challenge.message.subject,
              nonce: challenge.message.nonce,
              expiresAt: challenge.message.expiresAt.toString(),
            },
          }),
        ],
      })) as string;
    } catch (error: unknown) {
      setProblem(describe(error, copy.declined));
      setPhase("idle");
      return;
    }

    setPhase("checking");
    try {
      const response = await fetch("/api/agents/authorize", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentHash: hash,
          proof: { subjectRef: account, contentHash: hash, nonce, expiresAt: expiresAt.toISOString(), signature },
        }),
      });
      const body = (await response.json()) as { data?: Verdict; error?: { message?: string } };
      if (!response.ok || !body.data) {
        setProblem(body.error?.message ?? copy.checkFailedHttp(response.status));
        return;
      }
      setVerdict(body.data);
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : copy.checkFailed);
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";

  return (
    <div className="ag-verifier-grid">
      <section className="ag-verifier-input" aria-labelledby="authorize-title">
        <header className="ag-panel-head">
          <div>
            <span>{copy.kicker}</span>
            <h2 id="authorize-title">{copy.heading}</h2>
          </div>
          <Wallet size={21} weight="regular" aria-hidden />
        </header>

        <label className="ag-json-field">
          <span>{copy.hashLabel}</span>
          <textarea
            value={contentHash}
            onChange={(event) => setContentHash(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>

        <div className="ag-verifier-actions">
          <button className="ag-btn" type="button" onClick={connect} disabled={busy || account !== null}>
            {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : copy.connect}
          </button>
          <button
            className="ag-btn ag-btn--primary"
            type="button"
            onClick={authorize}
            disabled={busy || !account || !hashLooksRight}
          >
            {phase === "signing" ? copy.waiting : copy.sign}
          </button>
        </div>

        <p className="ag-note">{copy.note}</p>
      </section>

      <section className="ag-verifier-result" aria-live="polite">
        {problem ? (
          <div className="ag-integrity-banner" data-tone="danger">
            <ShieldWarning size={22} weight="bold" aria-hidden />
            <div>
              <span>{copy.notAuthorized}</span>
              <p>{problem}</p>
            </div>
          </div>
        ) : null}

        {verdict ? (
          <div className="ag-integrity-banner" data-tone={verdict.authorized ? "evidence" : "danger"}>
            {verdict.authorized ? (
              <CheckCircle size={22} weight="bold" aria-hidden />
            ) : (
              <ShieldWarning size={22} weight="bold" aria-hidden />
            )}
            <div>
              <span>{verdict.authorized ? copy.valid : copy.refused}</span>
              <b>{verdict.authorized ? verdict.subject : verdict.reasonCode}</b>
              <p>{verdict.authorized ? copy.recovers : verdict.detail}</p>
            </div>
          </div>
        ) : null}

        {verdict ? (
          <div className="ag-issue-list">
            <span>{copy.didNotDo}</span>
            <ul>
              {verdict.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

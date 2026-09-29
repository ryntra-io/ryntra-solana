# @ryntra/solana-evidence-sdk

Three read-only calls over Solana: read what a mint structurally is, preview an
exact SPL transfer against a policy you declare, and check an Outcome Receipt
without asking the party that issued it.

```ts
import {
  inspectSolanaMint,
  preflightSolanaAction,
  verifySolanaReceipt,
  EXAMPLE_CAUTIOUS_POLICY,
  SPL_TRANSFER_ACTION_REF,
} from "@ryntra/solana-evidence-sdk";
```

## `inspectSolanaMint(mint, connection?)`

One mint → an Asset Passport: identity, issuer authorities, supply, decimals,
and every Token Extension with its provenance and one sentence a holder can
read.

```ts
const result = await inspectSolanaMint("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo");
if (!result.ok) throw new Error(`${result.code}: ${result.reason}`);

for (const extension of result.passport.extensions) {
  if (extension.affectsTransfers) console.log(extension.kind, "—", extension.meaning);
}
```

Nothing throws. A mint that does not exist, an account owned by neither token
program, and bytes that do not decode each come back as a value with a code and
a reason, because "no answer" and "this answer" are different facts and only one
of them should look like a passport.

The passport is a function of the account bytes and nothing else, so an
independent re-read is a check rather than a second opinion.

**A sentence describes the setting, not the slot.** A mint carrying
`TransferHook` with the all-zero program id has no hook program installed, and
the passport says exactly that — plus who can install one. Same for a
`TransferFeeConfig` sitting at zero basis points.

## `preflightSolanaAction({ input, policy, epoch?, now?, connection? })`

The exact preview, then the judgement, kept apart:

- **preflight** — what will happen: fee math from the mint's own configuration,
  what the recipient actually receives, the resolved transfer-hook program,
  structural blockers, and two honest nulls (network fee and compute budget) that
  name why they are empty instead of guessing;
- **verdict** — what *your* policy makes of that, as thirteen rules each
  producing one finding, aggregated by a written precedence:
  `BLOCKED > INCOMPLETE > REVIEW_REQUIRED > NO_KNOWN_BLOCKER`.

```ts
const result = await preflightSolanaAction({
  input: {
    schemaVersion: "1.0.0",
    actionRef: SPL_TRANSFER_ACTION_REF,
    network: "mainnet",
    mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    sender: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    recipient: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
    amountRaw: "1000000",           // base units. Never a float.
  },
  policy: { ...EXAMPLE_CAUTIOUS_POLICY, acceptPermanentDelegate: false },
});
```

`NO_KNOWN_BLOCKER` is the bottom of the ladder and the best answer there is. It
reports the absence of known blockers under the policy you declared. It is not a
safety judgement, and the vocabulary has no word for one — a test greps for it.

The evidence is read on the network the *proposal* names, not on whatever the
connection defaulted to: a preview against the wrong chain would be exact about
the wrong thing.

## `verifySolanaReceipt(receipt, { trustedPublicKeys? })`

Four axes, reported separately and never merged into one word:

| Axis | Question |
|---|---|
| `schema` | Is this the shape of an Outcome Receipt at all |
| `integrity` | Do both hashes recompute over these exact bytes |
| `issuer` | Is the Ed25519 signature sound — and separately, is the key one *you* trust |
| `binding` | Does the receipt's registry pin name the Solana adapter |

Entirely local. No network call, and nothing is asked of Ryntra.

```ts
const check = verifySolanaReceipt(JSON.parse(receiptJson), {
  trustedPublicKeys: [/* the key you decided to trust */],
});
// integrity.valid === true and issuer.verdict === "SIGNATURE_VALID"
```

Without `trustedPublicKeys` the issuer axis reports whether the signature is
cryptographically sound, and says so in its detail. "Signed by someone" is not
"signed by Ryntra", and collapsing the two is the mistake this axis exists to
prevent. A valid receipt for another chain reports `NOT_SOLANA` — it is a valid
receipt and it is not this kit's.

## Connection

```ts
await inspectSolanaMint(mint, { network: "devnet", timeoutMs: 8_000, retries: 1 });
```

Public endpoints are the default so the kit works from a clean clone with no
account anywhere. A provider URL enters through the environment:

```bash
RYNTRA_SOLANA_RPC_MAINNET=https://your-provider.example/...
RYNTRA_SOLANA_RPC_DEVNET=https://your-provider.example/...
```

Retries cover the transport and never the answer: a response that parses is
returned as-is even when it says "no account", because re-asking does not change
a fact. Evidence source labels name the host, never the full URL, so a key in a
provider path cannot end up on a receipt.

## What this kit cannot do

`SOLANA_EVIDENCE_KIT_LIMITATIONS` carries these as data, so a surface built on
the kit renders the boundary instead of retyping it:

- **No key is held, read, derived or requested.** There is no signing path.
- **No transaction is built or submitted.** The only RPC method the kit calls is
  `getAccountInfo`, and a test enumerates every RPC call in the shipped sources
  to keep that true.
- **A verdict is not a safety judgement.**

`boundaries.test.mjs` asserts all of it by reading the shipped files listed in
the extraction manifest — so a file added to the kit is scanned from its first
run, and a file that is not in the manifest never ships.

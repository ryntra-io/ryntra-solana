# @ryntra/solana-evidence-mcp

A local stdio MCP server exposing the read-only Ryntra Solana evidence tools to
an agent or an IDE. It reads public Solana RPC and verifies receipts; it holds
no key, builds no transaction, and calls no state-changing RPC method.

## Tools

| Tool | What it does | Reaches the network |
|---|---|---|
| `inspect_solana_mint` | One mint → Asset Passport: identity, issuer authorities, every Token Extension with provenance and holder-language meaning | yes, read-only RPC |
| `preflight_solana_action` | Exact SPL transfer preview + owner-policy verdict | yes, read-only RPC |
| `verify_solana_receipt` | Recompute a receipt's hashes, check its Ed25519 signature, read its Solana binding | no — entirely local |
| `read_example_owner_policy` | The cautious example policy, as an editable shape | no |

Every result carries the kit's limitations alongside the data, so a caller that
renders the answer cannot lose the boundary on the way.

## Run it

```bash
node packages/solana-evidence-mcp/src/stdio.ts
```

Register that command as a local stdio MCP server in your client. It speaks the
protocol on stdin/stdout and logs nothing else there.

## The endpoint is the operator's choice, never the caller's

No tool accepts a URL. A tool argument that names an endpoint would let the
model pick what this process connects to, which is request forgery wearing a
convenience costume. The network is chosen from two names — `mainnet` or
`devnet` — and the endpoint behind each name comes from the environment:

```bash
RYNTRA_SOLANA_RPC_MAINNET=https://your-provider.example/...
RYNTRA_SOLANA_RPC_DEVNET=https://your-provider.example/...
```

Unset, both fall back to public endpoints that need no account. A test asserts
that no tool's JSON Schema contains an endpoint or URL field.

## What it will not do

- No key is read, held, derived or requested. There is no signing path.
- No transaction is built, simulated for submission, or sent.
- A policy verdict's best value is `NO_KNOWN_BLOCKER`. The word "safe" is not in
  this server's vocabulary, and a test greps for it.
- Results are byte-bounded, and a failure returns a fixed code without echoing
  the input that caused it.

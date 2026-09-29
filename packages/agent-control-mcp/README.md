# Ryntra Action Evidence MCP

Local stdio server for the bounded Agent Control developer surface, published as
`@ryntra/action-evidence-mcp`.

**Seven tools read.** Inspection, strict intent drafting, deterministic
preflight, preview-integrity verification and one exact known-reference BNB APEX
observation. Each is annotated read-only and non-destructive.

**Five tools write, and every one of them writes the same thing.** A proposal,
at `PROPOSE`, in this process, waiting for a person: `propose_action`,
`attach_proposal_evidence`, `request_human_review`, `retract_proposal` and
`ingest_a2a_task`. Each names an allowlisted registry reference that must
resolve and hash-match; none accepts an endpoint, and a request carrying an
authority-shaped field is refused before anything else looks at it.

A generic signing tool is not on a blocklist here — it is unrepresentable. The
effect vocabulary every write is typed against has exactly one member, so there
is no value such a tool could carry. That matters because the MCP specification
says a client *"MUST consider tool annotations to be untrusted"* and makes every
human-in-the-loop control a client `SHOULD` while every hard control is a server
`MUST`: a boundary that depends on the caller behaving is not a boundary. The
annotations this server publishes are honest and decide nothing.

The server has no wallet, signer, account, funding, provider-submission,
settlement, tokenization, launch or trading tool. A valid Action Passport
preview is not a finalized receipt and does not prove an observed outcome. The
proposal ledger lives in this process: stopping the server loses it, and there
is no durable queue behind it.

The write path imports the Agent Control kernel and is therefore **not part of
the published Apache-2.0 package**, which is the seven read tools. `PUBLIC-FILES.json`
lists exactly what ships, and the boundary test reads that list rather than
trusting this sentence.

Run it against Ryntra production from the repository root:

```powershell
$env:RYNTRA_AGENT_CONTROL_ORIGIN = "https://ryntra.io"
node packages/agent-control-mcp/src/stdio.ts
```

For local development, `http://127.0.0.1:3000` is also accepted. Only a
credential-free HTTPS origin is accepted outside localhost. MCP JSON-RPC uses
`stdout`; bounded redacted diagnostics use `stderr`.

---

## This package is **not published**

`@ryntra/action-evidence-mcp` is withheld from npm deliberately, and the reason
is structural rather than a matter of polish.

Its entry point imports the Agent Control kernel through `../../../lib/…` and
the client through a sibling directory path, and it depends on that client by a
`file:` local path. All three resolve inside this repository and none of them
resolves from `node_modules`, so a registry install would throw
`MODULE_NOT_FOUND` on first import. A package whose only export cannot be
imported is publishable-shaped, not publishable.

That is the same fact the extraction manifest has recorded since the write path
landed: `publicationState` reads `LOCALLY_AHEAD_OF_PUBLICATION`, and the public
repository remains the seven read tools at tag `v0.1.2`.

`@ryntra/action-evidence-sdk` **is** publishable — it has no dependencies, no
imports that leave its own directory, and ships one source file and this
package's sibling README.

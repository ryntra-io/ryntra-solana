# Security

Ryntra moves real money on Solana mainnet, so a report that helps us keep it right is welcome.

## Reporting a vulnerability

Please report it privately through
[GitHub Security Advisories](https://github.com/ryntra-io/ryntra-solana/security/advisories/new) or by email to
[hello@ryntra.io](mailto:hello@ryntra.io). Do not open a public issue with an exploit, a credential, a private
endpoint, user data or wallet material.

Tell us the affected commit, the smallest reproduction you have and what an attacker could do with it. We read every
report and answer it.

## What matters most

- anything that could make a transaction move funds anywhere but the person's own wallet;
- anything that lets an agent act outside the budget, the limits or the time its owner signed for;
- a way for text from outside — a coin's name, a description, a message — to steer an agent;
- a server path that signs, sends or reveals what it should not;
- a way to read or change another person's account, positions or history.

## Never send

A seed phrase, a private key, a signing request or funds. We never need them to reproduce an issue, and nobody from
Ryntra will ever ask for them.

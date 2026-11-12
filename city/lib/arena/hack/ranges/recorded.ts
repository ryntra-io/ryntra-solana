/**
 * The training ranges' recorded states (CITY-238). WRITTEN BY `record.mjs` — do not edit by hand: a changed byte is a
 * new pin. What each range is, in words — `record.mjs` and `README.md`.
 */

import type { RangeRecord } from "./range.ts";

export const RECORDED: readonly RangeRecord[] = [
  {
    "id": "usdc-mint",
    "title": "USDC mint authorities",
    "target": {
      "kind": "fork",
      "program": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "slot": 457726301
    },
    "watch": [
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    ],
    "snapshot": {
      "format": "ryntra-hack-snapshot/1",
      "source": {
        "kind": "recorded",
        "label": "CITY-198 tape: Meteora DLMM SOL-USDC, mainnet",
        "recordedAt": "2026-10-16T17:47:44.476Z"
      },
      "slot": 457726301,
      "unixTimestamp": 1792172864,
      "programs": [],
      "accounts": [
        {
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          "lamports": "549850180167",
          "data": "AQAAAJj+huiNm+Lqi8HMpIeLKYjCQPUrhCS/tA7Rot3LXhmbVScZ2kggHAAGAQEAAABicKqKWcWUBbRShshncubNEm6bil06OFNtN/e0FOi2Zw==",
          "executable": false
        }
      ]
    },
    "checks": [
      {
        "kind": "bytes-equal",
        "id": "mint-authority",
        "version": "1",
        "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "offset": 0,
        "hex": "0100000098fe86e88d9be2ea8bc1cca4878b2988c240f52b8424bfb40ed1a2ddcb5e199b"
      },
      {
        "kind": "bytes-equal",
        "id": "freeze-authority",
        "version": "1",
        "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "offset": 46,
        "hex": "010000006270aa8a59c59405b45286c86772e6cd126e9b8a5d3a38536d37f7b414e8b667"
      }
    ]
  },
  {
    "id": "open-multisig",
    "title": "Practice vault under a council",
    "target": {
      "kind": "fork",
      "program": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "slot": 457800000
    },
    "watch": [
      "AmhF3wPkNE9C45KrHagYCgP578oVrSyAsoCndn5ACKvT",
      "jjFyn4CEdQqDp9wwRzeBS2NjZcAZsFuPebVCfNEbhdu",
      "DnNnZhMkBR4vjCUHFVtmcpTAhN3MgAkV6X8ftJYmKCQK"
    ],
    "snapshot": {
      "format": "ryntra-hack-snapshot/1",
      "source": {
        "kind": "recorded",
        "label": "Ryntra practice range, made for training and not recorded from mainnet: a token vault under a council multisig",
        "recordedAt": "2026-11-10T00:00:00.000Z"
      },
      "slot": 457800000,
      "unixTimestamp": 1794268800,
      "programs": [],
      "accounts": [
        {
          "address": "DnNnZhMkBR4vjCUHFVtmcpTAhN3MgAkV6X8ftJYmKCQK",
          "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          "lamports": "1461600",
          "data": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABCl1OgAAAAGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
          "executable": false
        },
        {
          "address": "jjFyn4CEdQqDp9wwRzeBS2NjZcAZsFuPebVCfNEbhdu",
          "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          "lamports": "3361680",
          "data": "AAIBX7Rp1PEntOjTVT5aMKo2UIUDR406K/p3/yh+uj89Z1L7YOsHe2vTdJvVNbedYkxgjvo9+UjRbt7BTnhNc6xwoQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
          "executable": false
        },
        {
          "address": "AmhF3wPkNE9C45KrHagYCgP578oVrSyAsoCndn5ACKvT",
          "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          "lamports": "2039280",
          "data": "vewDNyI4fYrsAMhTwvs3XNxoS+1s+7bitHejfDfrh4QK8izwgFxrDiMqtLJRpNYKkebHqQqMmSlmaBipMHv0PAAQpdToAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          "executable": false
        }
      ]
    },
    "checks": [
      {
        "kind": "u64-at-least",
        "id": "vault-holds",
        "version": "1",
        "address": "AmhF3wPkNE9C45KrHagYCgP578oVrSyAsoCndn5ACKvT",
        "offset": 64,
        "min": "1000000000000"
      }
    ]
  },
  {
    "id": "council-review",
    "title": "Practice vault: a check a person decides",
    "target": {
      "kind": "fork",
      "program": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "slot": 457800001
    },
    "watch": [
      "4QeGZvSYXfAZg6yjY9yrkdkKiXs2b44ogEtAbSRwxTkG",
      "9pShKwRB6dMnFeobD2KLLYuwTEXRRxBDyr9mGZrqG9R7",
      "6rJFFiuHcbQ2A2419Ud6FbmUtwGT9fQZSd8i6rnAB7Zf"
    ],
    "snapshot": {
      "format": "ryntra-hack-snapshot/1",
      "source": {
        "kind": "recorded",
        "label": "Ryntra practice range, made for training and not recorded from mainnet: a token vault under a council multisig",
        "recordedAt": "2026-11-10T00:00:00.000Z"
      },
      "slot": 457800001,
      "unixTimestamp": 1794268800,
      "programs": [],
      "accounts": [
        {
          "address": "6rJFFiuHcbQ2A2419Ud6FbmUtwGT9fQZSd8i6rnAB7Zf",
          "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          "lamports": "1461600",
          "data": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABCl1OgAAAAGAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
          "executable": false
        },
        {
          "address": "9pShKwRB6dMnFeobD2KLLYuwTEXRRxBDyr9mGZrqG9R7",
          "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          "lamports": "3361680",
          "data": "AAIB7XBjFSmgOzL/9EA7lvBU9g4SUFzN2HMTxaZ51XYFCqN+JVQWqFKtlKnwArTXqaCnmb2MEoO4b0axFuUmKijP+QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
          "executable": false
        },
        {
          "address": "4QeGZvSYXfAZg6yjY9yrkdkKiXs2b44ogEtAbSRwxTkG",
          "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          "lamports": "2039280",
          "data": "Vutk5LLaPNKgbdZc9SPNfiVv5OWpe2Ek4Kteq0kDPD6DBNjhWTlxOHa+BjS02dkLjQP2wNvRAkCpnch72uTzDgAQpdToAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          "executable": false
        }
      ]
    },
    "checks": [
      {
        "kind": "bytes-equal",
        "id": "council-threshold",
        "version": "1",
        "address": "9pShKwRB6dMnFeobD2KLLYuwTEXRRxBDyr9mGZrqG9R7",
        "offset": 0,
        "hex": "02"
      }
    ]
  }
];

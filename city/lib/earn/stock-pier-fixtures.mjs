// Stock Pier fixtures (CITY-98) for the tests and the review screens. Written by hand, not recorded: the mints are the
// city's own avenue towers, the figures are shaped like the server's list. Nothing here is a live price.

export const TSLAX = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
export const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
export const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
export const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const spot = (address, built = false, feeBps = null, depthUsd = null, stockIsA = true) => ({ address, built, stockIsA, feeBps, depthUsd });

/** One pair as the list carries it; every field may be set. */
export function pair(over = {}) {
  return {
    mint: TSLAX,
    symbol: "TSLAx",
    name: "Tesla xStock",
    decimals: 8,
    program: TOKEN_2022,
    priceUsd: 431.2,
    multiplier: 1,
    volume7dUsd: 2_412_000,
    session: null,
    step: null,
    issuerMoves: true,
    piers: {
      sol: spot("GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB"),
      usdc: spot("oapfTk8FG2np1vSoGANkbijWiQApHZMFAytSdCoass9"),
    },
    ...over,
  };
}

/** The list the window reads, at a moment the exchange is open and closes in a few hours. */
export function list(now = Date.now()) {
  const open = {
    open: true,
    nextChangeAt: new Date(now + 3.2 * 3_600_000).toISOString(),
  };
  return {
    pairs: [
      pair({ session: open }),
      pair({
        mint: NVDAX,
        symbol: "NVDAx",
        name: "NVIDIA xStock",
        priceUsd: 183.4,
        multiplier: 1.0004,
        volume7dUsd: 1_380_000,
        session: open,
        piers: {
          sol: spot("FMUEmtxhU46GzhKF4FW9MLJdQWiLgjiXP9TYRWSrqTpV", true, 30, 48_200),
          usdc: spot("D7mwwu67f3zqNNULx7kE8WDCZ7iRtrY2NcPAb9Ehj3HH"),
        },
      }),
      pair({
        mint: SPYX,
        symbol: "SPYx",
        name: "SP500 xStock",
        priceUsd: 684.9,
        multiplier: 1.0071,
        volume7dUsd: 912_000,
        session: open,
        step: {
          at: new Date(now + 9 * 3_600_000).toISOString(),
          from: 1.0071,
          to: 1.0102,
        },
        piers: {
          sol: spot("8sbwsw9cnbGTy8L4CN8guhQ4fU3T8D4Qiq71f72ECbKe"),
          usdc: spot("2iXtA8oeZqUU5pofxK971TCEvFGfems2AcDRaZHKD2pQ"),
        },
      }),
      pair({
        mint: AAPLX,
        symbol: "AAPLx",
        name: "Apple xStock",
        priceUsd: 262.7,
        multiplier: 1.0021,
        volume7dUsd: 418_000,
        session: open,
        piers: {
          sol: spot("5rArie7XKukPCaEwq5XGQJnM9Fc5aZE3M9HAPVfMU2xC"),
          usdc: spot("8zvEZXMTHrhQze7z6uEG2Y8YmJRk25DYvfAYUHKjKpJq"),
        },
      }),
    ],
    quoteUsd: { sol: 184.2, usdc: 1 },
    at: new Date(now).toISOString(),
  };
}

export const LIST = list(Date.UTC(2026, 9, 30, 17));

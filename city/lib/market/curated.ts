import type { District } from './types.ts';

/**
 * The verified mints the city always shows, by district. Picked from Jupiter's verified list on
 * 2026-10-26: majors and liquid staking in the core, DeFi on the heights, the most liquid memes on the
 * strip, tokenized stocks and gold on the avenue. Trending tokens and new launches join at runtime.
 * Political, celebrity and personal-name coins are not hand-picked (they still appear if they trend).
 */
export const CURATED: ReadonlyArray<readonly [mint: string, district: District]> = [
  ['So11111111111111111111111111111111111111112', 'core'], // SOL
  ['3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', 'core'], // WBTC
  ['7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', 'core'], // ETH
  ['CtzPWv73Sn1dMGVU3ZtLv9yWSyUAanBni19YWDaznnkn', 'core'], // xBTC
  ['2Wu1g2ft7qZHfTpfzP3wLdfPeV1is4EwQ3CXBfRYAciD', 'strip'], // GOHOME
  ['2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', 'strip'], // PENGU
  ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'strip'], // Bonk
  ['EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 'strip'], // $WIF
  ['Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk', 'strip'], // USELESS
  ['9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', 'strip'], // Fartcoin
  ['9PR7nCP9DpcUotnDPVLUBUZKu5WAYkwrCUx9wDnSpump', 'strip'], // Ban
  ['FeR8VBqNRSUD5NtXAj2n3j1dAHkZHfyDktKuLXD4pump', 'strip'], // jellyjelly
  ['ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', 'strip'], // BOME
  ['7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', 'strip'], // POPCAT
  ['2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', 'strip'], // Pnut
  ['MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', 'strip'], // MEW
  ['ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', 'strip'], // MOODENG
  ['J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr', 'strip'], // SPX
  ['5UUH9RTDiSpq6HKS6bp4NdU9PNJpXRXuiw6ShBTBhgH2', 'strip'], // TROLL
  ['Ce2gx9KGXJ6C9Mp5b5x1sn9Mg87JwEbrQby4Zqo3pump', 'strip'], // neet
  ['8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn', 'strip'], // ZEREBRO
  ['G7vQWurMkMMm2dU3iZpXYFTHT9Biio4F4gZCrwFpKNwG', 'strip'], // BIRB
  ['63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9', 'strip'], // GIGA
  ['y1AZt42vceCmStjW4zetK3VoNarC1VxJ5iDjpiupump', 'strip'], // FARTBOY
  ['XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', 'avenue'], // TSLAx
  ['Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8', 'avenue'], // SPCXx
  ['XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', 'avenue'], // MSTRx
  ['XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', 'avenue'], // SPYx
  ['XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', 'avenue'], // CRCLx
  ['Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', 'avenue'], // NVDAx
  ['Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', 'avenue'], // QQQx
  ['XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg', 'avenue'], // HOODx
  ['XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', 'avenue'], // MSFTx
  ['XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', 'avenue'], // AAPLx
  ['XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', 'avenue'], // GOOGLx
  ['Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH', 'avenue'], // STRCx
  ['Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu', 'avenue'], // METAx
  ['Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', 'avenue'], // AMZNx
  ['Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re', 'avenue'], // GLDx
  ['XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4', 'avenue'], // PLTRx
  ['Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu', 'avenue'], // COINx
  ['Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc', 'avenue'], // GMEx
  ['XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2', 'avenue'], // MCDx
  ['AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P', 'avenue'], // XAUt0
  ['GoLDppdjB1vDTPSGxyMJFqdnj134yH6Prg9eqsGDiw6A', 'avenue'], // GOLD
  ['pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn', 'heights'], // PUMP
  ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 'heights'], // JUP
  ['27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4', 'heights'], // JLP
  ['HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', 'heights'], // PYTH
  ['4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', 'heights'], // RAY
  ['CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp', 'heights'], // CARDS
  ['KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS', 'heights'], // KMNO
  ['BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy', 'heights'], // BP
  ['jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', 'heights'], // JTO
  ['METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL', 'heights'], // MET
  ['METAwkXcqyXKy1AtsSgJ8JiUHwGCafnZL38n3vYmeta', 'heights'], // META
  ['DBRiDgJAMsM95moTzJs7M9LnkGErpbv9v6CUR1DXnUu5', 'heights'], // DBR
  ['BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85', 'core'], // BNSOL
  ['J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', 'core'], // JitoSOL
  ['jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', 'core'], // JupSOL
  ['Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ', 'core'], // dSOL
];

const BY_MINT = new Map<string, District>(CURATED.map(([mint, district]) => [mint, district]));

export const districtOf = (mint: string): District | undefined => BY_MINT.get(mint);

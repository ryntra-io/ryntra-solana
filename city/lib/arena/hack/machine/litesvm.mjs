// The Hack sandbox's real copy: a `ForkEngine` (`../sandbox/engine.ts`) over LiteSVM (CITY-224; here since CITY-238, where
// the machine with no network runs it — `entry.mjs`, `README.md`).
//
// LiteSVM is not a dependency of the repository (it is a native binary for Linux): the machine's image installs it
// (`image.mjs`), and a developer installs it outside the repository and names the folder:
//
//   mkdir -p ~/city-238 && cd ~/city-238 && npm init -y && npm install litesvm@1.6.2
//
// What the engine keeps of the sandbox's promises:
//   • a copy only — accounts and programs come from the snapshot; an address it does not hold does not exist;
//   • signatures checked (sigverify on): a finding is the program's fault, never a forged signature;
//   • a compute budget per transaction (LiteSVM's own, set from the run's `cuPerStep`);
//   • deterministic — the blockhash check is off, so a transaction does not depend on the harness's blockhash; the
//     transaction history is on, so the same bytes twice are refused the same way every time;
//   • synchronous — every call returns before anything else in the process runs.
// Not yet: address lookup tables (a transaction with one is refused deterministically).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * A fresh LiteSVM engine per call. `svmDir` holds node_modules/litesvm; `accountsHash` is the sandbox library's own
 * (`city/lib/arena/hack/sandbox/pin.ts`), so the engine and the pin hash the copy the same way.
 */
export function liteSvmEngines(svmDir, accountsHash) {
  if (!svmDir) throw new Error("the engine needs the folder that holds node_modules/litesvm (the machine image, or RYNTRA_HACK_SVM / CITY224_SVM on a stand)");
  if (typeof accountsHash !== "function") throw new Error("the engine needs the library's accountsHash");
  const svmRequire = createRequire(path.join(svmDir, "node_modules/litesvm/package.json"));
  const { LiteSVM, Clock, ComputeBudget, FailedTransactionMetadata } = svmRequire("litesvm");
  const kit = svmRequire("@solana/kit");
  const version = JSON.parse(readFileSync(path.join(svmDir, "node_modules/litesvm/package.json"), "utf8")).version;
  const decodeTx = kit.getTransactionDecoder();
  const decodeMessage = kit.getCompiledTransactionMessageDecoder();
  const SYSTEM = "11111111111111111111111111111111";

  return () => {
    let svm = null;
    let budget = null;
    const tracked = new Set();

    const read = (address) => {
      const account = svm.getAccount(kit.address(address));
      if (!account.exists || account.lamports === 0n) return null;
      return { address, owner: String(account.programAddress), lamports: BigInt(account.lamports), data: new Uint8Array(account.data), executable: Boolean(account.executable) };
    };
    const put = (address, { owner, lamports, data, executable }) => {
      tracked.add(address);
      svm.setAccount({ address: kit.address(address), data, executable, lamports: kit.lamports(lamports), programAddress: kit.address(owner), space: BigInt(data.length) });
    };
    const setTime = (slot, unixTimestamp) => {
      const clock = svm.getClock();
      svm.warpToSlot(BigInt(slot));
      svm.setClock(new Clock(BigInt(slot), clock.epochStartTimestamp, clock.epoch, clock.leaderScheduleEpoch, BigInt(unixTimestamp)));
    };

    return {
      id: "litesvm",
      version,
      load(snapshot) {
        svm = new LiteSVM().withSigverify(true).withBlockhashCheck(false).withLogBytesLimit(100_000n);
        budget = null;
        tracked.clear();
        for (const program of snapshot.programs) svm.addProgram(kit.address(program.address), new Uint8Array(Buffer.from(program.bytes, "base64")));
        for (const account of snapshot.accounts) {
          put(account.address, { owner: account.owner, lamports: BigInt(account.lamports), data: new Uint8Array(Buffer.from(account.data, "base64")), executable: account.executable });
        }
        setTime(snapshot.slot, snapshot.unixTimestamp);
      },
      execute(bytes, cuLimit) {
        let tx;
        let message;
        try {
          tx = decodeTx.decode(bytes);
          message = decodeMessage.decode(tx.messageBytes);
        } catch {
          return { ok: false, err: "malformed transaction", units: 0, logs: [] };
        }
        if ((message.addressTableLookups ?? []).length > 0) return { ok: false, err: "address lookup tables are not supported in the sandbox yet", units: 0, logs: [] };
        for (const key of message.staticAccounts) tracked.add(String(key));
        if (budget !== cuLimit) {
          const compute = new ComputeBudget();
          compute.computeUnitLimit = BigInt(cuLimit);
          svm = svm.withComputeBudget(compute);
          budget = cuLimit;
        }
        const result = svm.sendTransaction(tx);
        const failed = result instanceof FailedTransactionMetadata;
        const meta = failed ? result.meta() : result;
        return { ok: !failed, err: failed ? errorOf(result) : null, units: Number(meta.computeUnitsConsumed()), logs: meta.logs() };
      },
      warp(slots) {
        const clock = svm.getClock();
        setTime(Number(clock.slot) + slots, Number(clock.unixTimestamp) + Math.floor((slots * 2) / 5));
      },
      clock() {
        const clock = svm.getClock();
        return { slot: Number(clock.slot), unixTimestamp: Number(clock.unixTimestamp) };
      },
      read,
      fund(address, lamports) {
        const now = read(address);
        put(address, { owner: now?.owner ?? SYSTEM, lamports: (now?.lamports ?? 0n) + lamports, data: now?.data ?? new Uint8Array(), executable: false });
      },
      stateHash() {
        return accountsHash([...tracked].map(read).filter(Boolean));
      },
    };
  };
}

/** The transaction error alone, e.g. `InstructionError(0, Custom(4))` — without the signature and the metadata around it. */
function errorOf(failed) {
  const text = String(failed.toString());
  const match = /\berr: (.*?), meta: /.exec(text);
  return (match ? match[1] : text).slice(0, 200);
}

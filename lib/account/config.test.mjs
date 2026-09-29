import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { accountMethods, customerDoorsEnabled, customerMethods } from "./config.ts";

/*
 * RYN-ACCESS-WALLET-ONLY-001 — the customer doors are a separate switch.
 *
 * `accountMethods()` is the operator's set: it keeps `/admin/login` working
 * on email + password + second factor. `customerMethods()` is what a person
 * in the cabinet may use, and it is shut by default: the wallet is the way in.
 */
const KEYS = ["RYNTRA_ACCOUNT_LOGIN", "RYNTRA_AUTH_GOOGLE", "RYNTRA_AUTH_TELEGRAM_OIDC", "RYNTRA_CUSTOMER_DOORS", "SUPABASE_URL", "SUPABASE_ANON_KEY"];

describe("customer doors", () => {
  const saved = {};
  beforeEach(() => {
    for (const key of KEYS) saved[key] = process.env[key];
    process.env.RYNTRA_ACCOUNT_LOGIN = "on";
    process.env.RYNTRA_AUTH_GOOGLE = "on";
    process.env.RYNTRA_AUTH_TELEGRAM_OIDC = "on";
    process.env.SUPABASE_URL = "https://stand.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon";
    delete process.env.RYNTRA_CUSTOMER_DOORS;
  });
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("are shut by default while the operator's doors stay open", () => {
    assert.equal(customerDoorsEnabled(), false);
    assert.deepEqual(accountMethods(), { email: true, google: true, telegram: true });
    assert.deepEqual(customerMethods(), { email: false, google: false, telegram: false });
  });

  it("open only on the explicit switch, and never wider than the operator's set", () => {
    process.env.RYNTRA_CUSTOMER_DOORS = "on";
    assert.equal(customerDoorsEnabled(), true);
    assert.deepEqual(customerMethods(), { email: true, google: true, telegram: true });
    process.env.RYNTRA_AUTH_GOOGLE = "off";
    assert.deepEqual(customerMethods(), { email: true, google: false, telegram: true });
    process.env.RYNTRA_ACCOUNT_LOGIN = "off";
    assert.deepEqual(customerMethods(), { email: false, google: false, telegram: false });
  });

  it("treat anything but `on` as shut", () => {
    for (const value of ["", "true", "1", "ON ", "yes"]) {
      process.env.RYNTRA_CUSTOMER_DOORS = value;
      assert.equal(customerDoorsEnabled(), value.trim().toLowerCase() === "on", JSON.stringify(value));
    }
  });
});

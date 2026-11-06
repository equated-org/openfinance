import { describe, it, expect } from "vitest";
import { needsUserAction, shouldStopPolling } from "./disconnect-codes";

describe("sync error code policy", () => {
  const RELINK = [
    "ITEM_LOGIN_REQUIRED",
    "ITEM_LOCKED",
    "INVALID_CREDENTIALS",
    "INVALID_MFA",
    "ACCESS_NOT_GRANTED",
    "PASSWORD_RESET_REQUIRED",
    "USER_SETUP_REQUIRED",
    "USER_PERMISSION_REVOKED",
    "NO_ACCOUNTS",
    "ITEM_NOT_SUPPORTED",
    "ITEM_NOT_FOUND",
    "INVALID_ACCESS_TOKEN",
    "INSTITUTION_NO_LONGER_SUPPORTED",
    "CONNECTION_EXPIRED",
  ];

  it("prompts and parks the connection for codes only a re-link can fix", () => {
    for (const code of RELINK) {
      expect(needsUserAction(code), code).toBe(true);
      expect(shouldStopPolling(code), code).toBe(true);
    }
  });

  // The pair that motivated splitting one list into two: the user is emailed
  // about stale data, so the prompt has to appear, but the institution can
  // recover on its own and parking the connection would hide that.
  it("prompts for STALE_DATA but keeps polling it", () => {
    expect(needsUserAction("STALE_DATA")).toBe(true);
    expect(shouldStopPolling("STALE_DATA")).toBe(false);
  });

  // Re-linking cannot fix a bank that is not answering, so asking the user to
  // try is a pointless errand — INSTITUTION_NOT_RESPONDING is what Plaid
  // returns for Items whose institution is temporarily unreachable.
  it("neither prompts nor parks on transient failures", () => {
    for (const code of [
      "INSTITUTION_NOT_RESPONDING",
      "INSTITUTION_DOWN",
      "RATE_LIMIT_EXCEEDED",
      "TRANSACTIONS_SYNC_LIMIT",
      "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
      "INTERNAL_SERVER_ERROR",
      "UPSTREAM_NOT_READY",
      "SYNC_ERROR",
    ]) {
      expect(needsUserAction(code), code).toBe(false);
      expect(shouldStopPolling(code), code).toBe(false);
    }
  });

  it("treats a missing code as transient", () => {
    for (const code of [null, undefined, ""]) {
      expect(needsUserAction(code)).toBe(false);
      expect(shouldStopPolling(code)).toBe(false);
    }
  });
});

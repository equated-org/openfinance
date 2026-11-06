/**
 * Policy for sync error codes: what we tell the user, and whether we keep
 * polling. Those are two different questions and a single list cannot answer
 * both — STALE_DATA needs the user's attention but must stay in the poll
 * rotation, because the bank may start responding again on its own.
 *
 * Lives outside the provider clients because two of the three consumers are
 * not Plaid, and importing plaid.client would drag in the Plaid SDK and its
 * env vars for a string list.
 */

/** Why a sync failed. With no code, it's simply retried on the next poll. */
export class SyncFailure extends Error {
  constructor(
    message: string,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "SyncFailure";
  }
}

/** By shape, not class: DBOS replays a recorded step error as a plain Error. */
export function readFailure(err: unknown): {
  errorCode?: string;
  message: string;
} {
  return {
    errorCode: (err as { errorCode?: string } | null)?.errorCode,
    message: err instanceof Error ? err.message : "Unknown sync error",
  };
}

/**
 * Plaid codes that won't clear until the user acts: signing in again through
 * Link's update mode, finishing something on the bank's own site, or linking
 * the bank afresh. Every other code is retried on the next poll.
 */
const PLAID_RELINK_CODES = [
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
];

/** Synthesized by the Quiltt sync workflow from an ERROR_REPAIRABLE status. */
const QUILTT_RELINK_CODES = ["CONNECTION_EXPIRED"];

const RELINK_CODES = [...PLAID_RELINK_CODES, ...QUILTT_RELINK_CODES];

/**
 * Ours, not a provider's: Plaid's own updates have been failing for over a day.
 * Re-linking often fixes it, and we already email the user saying so, so it has
 * to raise the prompt too — an email pointing at a button that isn't there is
 * worse than saying nothing.
 */
const STALE_DATA_CODE = "STALE_DATA";

/**
 * Drives the "Reconnect" prompt, the reconnect task, and the disconnect email.
 * A transient failure (INSTITUTION_NOT_RESPONDING, INSTITUTION_DOWN, a rate
 * limit, an upstream pull still in progress) must never land here: re-linking
 * cannot fix a bank that is not answering, so asking the user to try is a
 * pointless errand.
 */
export function needsUserAction(code: string | null | undefined): boolean {
  return !!code && (RELINK_CODES.includes(code) || code === STALE_DATA_CODE);
}

/**
 * Drives the poller's skip list — only for states that cannot recover without
 * the user acting. STALE_DATA is deliberately absent: it can clear itself once
 * the institution recovers, and parking it would mean never finding out.
 */
export function shouldStopPolling(code: string | null | undefined): boolean {
  return !!code && RELINK_CODES.includes(code);
}

/** Providers whose reconnect flow can run from a public reconnect link. */
export type ReconnectProvider = "plaid" | "quiltt";

/** Returned by POST /api/accounts/:id/reconnect-link. */
export interface CreatedReconnectLink {
  /** Public page that reconnects the account without signing in. */
  url: string;
  expiresAt: string;
  accountId: number;
  institutionName: string;
  provider: ReconnectProvider;
}

/**
 * - `ready`: the link hasn't been used yet; the page offers to reconnect.
 * - `syncing`: the account was reconnected and its sync is still running.
 * - `synced`: the sync after the reconnect finished.
 * - `failed`: the bank still needs attention after the reconnect.
 */
export type ReconnectLinkState = "ready" | "syncing" | "synced" | "failed";

/** Returned by the public reconnect-link endpoints. */
export interface ReconnectLinkStatus {
  provider: ReconnectProvider;
  institutionName: string;
  institutionUrl: string | null;
  accountName: string;
  accountMask: string | null;
  expiresAt: string;
  state: ReconnectLinkState;
  /** Why the sync failed, or a note about a sync that is still catching up. */
  message: string | null;
}

/** What the public page needs to open the provider's reconnect flow. */
export type ReconnectSession =
  | { provider: "plaid"; linkToken: string }
  | {
      provider: "quiltt";
      sessionToken: string;
      connectorId: string;
      connectionId: string;
    };

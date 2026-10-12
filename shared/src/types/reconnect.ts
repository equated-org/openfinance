/** Providers whose reconnect flow can run from a public reconnect link. */
export type ReconnectProvider = "plaid" | "quiltt";

/** Returned by POST /api/accounts/:id/reconnect-link. */
export interface CreatedReconnectLink {
  /** Public page that reconnects the account without signing in. */
  url: string;
  expiresAt: string;
  accountId: number;
  institutionName: string | null;
  provider: ReconnectProvider;
}

/**
 * The account's connection right now, the same signal GET /api/accounts
 * reports:
 * - `ready`: the bank needs the owner to sign in again.
 * - `syncing`: a sync is running, for example right after a reconnect.
 * - `synced`: the connection is healthy.
 */
export type ReconnectLinkState = "ready" | "syncing" | "synced";

/** Returned by the public reconnect-link endpoints. */
export interface ReconnectLinkStatus {
  provider: ReconnectProvider;
  institutionName: string | null;
  institutionUrl: string | null;
  institutionLogoUrl: string | null;
  accountName: string;
  accountMask: string | null;
  expiresAt: string;
  state: ReconnectLinkState;
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

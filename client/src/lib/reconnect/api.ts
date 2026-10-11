import { apiFetch } from "$lib/api-client";
import type {
  ReconnectLinkStatus,
  ReconnectSession,
} from "@openfinance/shared";

// Public endpoints: the link's token is the credential, sent as a bearer token
// so it never appears in a URL the server logs.

function withToken(token: string, init?: RequestInit): RequestInit {
  return { ...init, headers: { Authorization: `Bearer ${token}` } };
}

export function getReconnectLink(token: string) {
  return apiFetch<ReconnectLinkStatus>(
    "/api/reconnect-link",
    withToken(token),
  );
}

export function startReconnectSession(token: string) {
  return apiFetch<ReconnectSession>(
    "/api/reconnect-link/session",
    withToken(token, { method: "POST" }),
  );
}

/** `connectionId` is the one Quiltt reports, which can be new. */
export function completeReconnect(token: string, connectionId?: string) {
  return apiFetch<ReconnectLinkStatus>(
    "/api/reconnect-link/complete",
    withToken(token, {
      method: "POST",
      body: JSON.stringify({ connectionId }),
    }),
  );
}

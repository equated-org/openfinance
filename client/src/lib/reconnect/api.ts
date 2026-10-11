import { apiFetch } from "$lib/api-client";
import type {
  ReconnectLinkStatus,
  ReconnectSession,
} from "@openfinance/shared";

// Public endpoints: the token in the path is the credential, so these work
// without a session.

function linkPath(token: string) {
  return `/api/reconnect-links/${encodeURIComponent(token)}`;
}

export function getReconnectLink(token: string) {
  return apiFetch<ReconnectLinkStatus>(linkPath(token));
}

export function startReconnectSession(token: string) {
  return apiFetch<ReconnectSession>(`${linkPath(token)}/session`, {
    method: "POST",
  });
}

export function completeReconnect(token: string) {
  return apiFetch<ReconnectLinkStatus>(`${linkPath(token)}/complete`, {
    method: "POST",
  });
}

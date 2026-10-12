import { apiFetch } from "$lib/api-client";
import type { SearchInstitutionsResponse } from "@openfinance/shared";

export interface ApiKey {
  id: number;
  key: string | null;
  prefix: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreatedApiKey {
  id: number;
  key: string;
  prefix: string;
  name: string | null;
  createdAt: string;
}

export function createPlaidLinkToken() {
  return apiFetch<{ link_token: string }>("/api/plaid/create_link_token", {
    method: "POST",
  });
}

export function createPlaidLinkTokenForUpdate(accountId: number) {
  return apiFetch<{ link_token: string }>(
    "/api/plaid/create_link_token_for_update",
    {
      method: "POST",
      body: JSON.stringify({ account_id: accountId }),
    },
  );
}

export function exchangePlaidPublicToken(
  publicToken: string,
  institutionId?: string,
) {
  return apiFetch<{ message: string }>("/api/plaid/exchange_public_token", {
    method: "POST",
    body: JSON.stringify({
      public_token: publicToken,
      institution_id: institutionId,
    }),
  });
}

export function getApiKey() {
  return apiFetch<{ key: ApiKey | null }>("/api/keys");
}

export function resetApiKey() {
  return apiFetch<CreatedApiKey>("/api/keys/reset", { method: "POST" });
}

// MX API functions

export function createMxWidgetUrl(params?: { institutionCode?: string }) {
  return apiFetch<{ widget_url: string; user_guid: string }>(
    "/api/mx/create_widget_url",
    {
      method: "POST",
      body: JSON.stringify({
        institution_code: params?.institutionCode,
      }),
    },
  );
}

export function connectMxMember(
  memberGuid: string,
  userGuid: string,
  institutionCode?: string,
) {
  return apiFetch<{ message: string }>("/api/mx/connect_member", {
    method: "POST",
    body: JSON.stringify({
      member_guid: memberGuid,
      user_guid: userGuid,
      institution_code: institutionCode,
    }),
  });
}

export function createMxWidgetUrlForUpdate(accountId: number) {
  return apiFetch<{
    widget_url: string;
    user_guid: string;
    member_guid: string;
  }>("/api/mx/create_widget_url_for_update", {
    method: "POST",
    body: JSON.stringify({ account_id: accountId }),
  });
}

/** An empty query lists the top banks. */
export function searchInstitutions(query: string) {
  return apiFetch<SearchInstitutionsResponse>(
    `/api/institutions/search?${new URLSearchParams({ query })}`,
  );
}

export function getMxMemberStatus(memberGuid: string) {
  return apiFetch<{
    connection_status: string;
    is_being_aggregated: boolean;
    successfully_aggregated_at: string | null;
  }>(`/api/mx/member_status?member_guid=${encodeURIComponent(memberGuid)}`);
}

// Quiltt API functions

export function createQuilttSession() {
  return apiFetch<{
    token: string;
    profileId: string;
    connectorId: string;
    expiresAt: string;
  }>("/api/quiltt/session", { method: "POST" });
}

export function quilttCallback(connectionId: string, profileId: string) {
  return apiFetch<{ message: string }>("/api/quiltt/callback", {
    method: "POST",
    body: JSON.stringify({ connectionId, profileId }),
  });
}

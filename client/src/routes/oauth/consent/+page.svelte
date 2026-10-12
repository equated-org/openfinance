<!--
  Consent screen for MCP connectors (Claude, ChatGPT, Codex…). better-auth
  sends every authorize request here with a consent_code; Allow and Decline
  post it to /api/auth/oauth2/consent, which answers with the connector's
  redirect (carrying a code, or access_denied) for us to follow.
-->
<script lang="ts">
  import { page } from "$app/state";
  import { authClient } from "$lib/auth-client";
  import { apiFetch } from "$lib/api-client";
  import ConsentView, {
    type ConsentClient,
    type ConsentViewState,
  } from "$lib/oauth/ConsentView.svelte";

  const session = authClient.useSession();

  const consentCode = $derived(page.url.searchParams.get("consent_code"));
  const clientId = $derived(page.url.searchParams.get("client_id"));

  let client = $state<ConsentClient | null>(null);
  let submitting = $state<"allow" | "deny" | null>(null);
  let error = $state<string | null>(null);

  const viewState = $derived.by((): ConsentViewState => {
    if (!consentCode) return "invalid";
    if ($session.isPending) return "loading";
    return $session.data ? "ready" : "signedOut";
  });

  $effect(() => {
    if (!clientId || !$session.data) return;
    apiFetch<ConsentClient>(`/api/oauth/clients/${encodeURIComponent(clientId)}`)
      .then((info) => (client = info))
      .catch(() => {
        // The page still works without the name; it just says "An app".
      });
  });

  async function decide(accept: boolean) {
    if (submitting || !consentCode) return;
    submitting = accept ? "allow" : "deny";
    error = null;
    try {
      const { redirectURI } = await apiFetch<{ redirectURI: string }>(
        "/api/auth/oauth2/consent",
        {
          method: "POST",
          body: JSON.stringify({ accept, consent_code: consentCode }),
        },
      );
      window.location.href = redirectURI;
    } catch {
      submitting = null;
      error =
        "This request has expired. Start again from the app you're connecting.";
    }
  }
</script>

<ConsentView
  state={viewState}
  {client}
  email={$session.data?.user.email ?? null}
  {submitting}
  {error}
  onDecide={decide}
/>

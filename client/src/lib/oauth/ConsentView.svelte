<script lang="ts" module>
  export type ConsentViewState = "loading" | "invalid" | "signedOut" | "ready";

  /** The connector asking for access, as registered with OpenFinance. */
  export type ConsentClient = { name: string | null; redirectHosts: string[] };
</script>

<script lang="ts">
  import { ArrowLeftRight } from "lucide-svelte";
  import { Button } from "$lib/components/ui/button";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";

  interface Props {
    state: ConsentViewState;
    client?: ConsentClient | null;
    /** The signed-in user's email. */
    email?: string | null;
    submitting?: "allow" | "deny" | null;
    error?: string | null;
    onDecide?: (accept: boolean) => void;
  }

  let {
    state,
    client = null,
    email = null,
    submitting = null,
    error = null,
    onDecide,
  }: Props = $props();

  // What a connector can do, kept in sync with the tools in server/src/mcp.
  const PERMISSIONS = [
    "See your accounts and balances",
    "Search and analyze your transactions",
    "Create links that reconnect a disconnected bank",
  ];

  // CLI connectors redirect to localhost, so their logo comes from their name.
  const KNOWN_CLIENTS = [
    { match: "claude", domain: "claude.ai" },
    { match: "anthropic", domain: "claude.ai" },
    { match: "chatgpt", domain: "openai.com" },
    { match: "codex", domain: "openai.com" },
    { match: "openai", domain: "openai.com" },
    { match: "cursor", domain: "cursor.com" },
  ];

  const appName = $derived(client?.name?.trim() || "An app");
  const redirectHost = $derived(client?.redirectHosts[0] ?? null);

  // Prefer the real redirect host, so a made-up name can't borrow a trusted
  // app's logo.
  const logoDomain = $derived.by(() => {
    const host = client?.redirectHosts.find(
      (h) => !h.startsWith("localhost") && !h.startsWith("127.0.0.1"),
    );
    if (host) return host.split(":")[0];
    const name = (client?.name ?? "").toLowerCase();
    return KNOWN_CLIENTS.find((k) => name.includes(k.match))?.domain ?? null;
  });
</script>

<main
  class="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-muted)] px-4"
>
  <div
    class="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--card)] p-6"
  >
    {#if state === "invalid"}
      <h1 class="text-center text-base font-semibold text-[var(--text)]">
        Link expired
      </h1>
      <p class="mt-2 text-center text-sm text-[var(--text-muted)]">
        This sign-in link is missing or has expired. Start again from the app
        you're connecting.
      </p>
    {:else if state === "loading"}
      <div class="flex justify-center py-6">
        <div
          class="h-5 w-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text)]"
        ></div>
      </div>
    {:else if state === "signedOut"}
      <h1 class="text-center text-base font-semibold text-[var(--text)]">
        Sign in to continue
      </h1>
      <p class="mt-2 text-center text-sm text-[var(--text-muted)]">
        Sign in to OpenFinance, then start again from the app you're
        connecting.
      </p>
      <a href="/login" class="mt-4 flex justify-center">
        <Button>Sign in</Button>
      </a>
    {:else}
      <div class="flex items-center justify-center gap-3">
        <img src="/favicon.svg" alt="OpenFinance" class="h-10 w-10" />
        <ArrowLeftRight class="h-4 w-4 text-[var(--text-muted)]" />
        <InstitutionLogo
          institutionUrl={logoDomain ? `https://${logoDomain}` : null}
          institutionName={appName}
          size="lg"
        />
      </div>

      <h1 class="mt-5 text-center text-base font-semibold text-[var(--text)]">
        {appName} wants to connect to your OpenFinance account
      </h1>
      {#if redirectHost}
        <p class="mt-1 text-center text-xs text-[var(--text-muted)]">
          {redirectHost}
        </p>
      {/if}

      <div class="mt-5 border-t border-[var(--border)] pt-4">
        <p class="mb-2 text-xs text-[var(--text-muted)]">It will be able to</p>
        <ul class="space-y-1">
          {#each PERMISSIONS as permission}
            <li class="text-sm text-[var(--text)]">{permission}</li>
          {/each}
        </ul>
        <p class="mt-3 text-xs text-[var(--text-muted)]">
          It can't move money or change your accounts.
        </p>
      </div>

      {#if error}
        <p class="mt-4 text-sm text-red-600">{error}</p>
      {/if}

      <div class="mt-6 flex gap-3">
        <Button
          variant="outline"
          class="flex-1"
          disabled={submitting !== null}
          onclick={() => onDecide?.(false)}
        >
          {submitting === "deny" ? "Declining…" : "Decline"}
        </Button>
        <Button
          class="flex-1"
          disabled={submitting !== null}
          onclick={() => onDecide?.(true)}
        >
          {submitting === "allow" ? "Allowing…" : "Allow"}
        </Button>
      </div>

      {#if email}
        <p class="mt-4 text-center text-xs text-[var(--text-muted)]">
          Signed in as {email}
        </p>
      {/if}
    {/if}
  </div>
</main>

<script lang="ts">
  import "../app.css";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { ModeWatcher } from "mode-watcher";
  import { authClient } from "$lib/auth-client";
  import { isConnectorSignIn } from "$lib/oauth/connector";
  import Toaster from "$lib/components/ui/sonner/sonner.svelte";

  let { children } = $props();

  const session = authClient.useSession();

  // Reconnect links and the connector consent screen can be opened by people
  // who aren't signed in to the app.
  const isPublicPage = $derived(
    $page.url.pathname.startsWith("/reconnect") ||
      $page.url.pathname.startsWith("/oauth"),
  );

  $effect(() => {
    if ($session.isPending || isPublicPage) return;

    const isLoginPage = $page.url.pathname.startsWith("/login");

    if (!$session.data && !isLoginPage) {
      goto("/login");
    } else if ($session.data && isLoginPage && !isConnectorSignIn($page.url)) {
      // The login page finishes a connector's sign-in itself.
      goto("/");
    }
  });
</script>

<ModeWatcher modeStorageKey="openfinance-app-mode" />

{#if $session.isPending && !isPublicPage}
  <div class="flex min-h-screen items-center justify-center">
    <div
      class="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border)] border-t-[var(--text)]"
    ></div>
  </div>
{:else}
  {@render children()}
{/if}

<Toaster />

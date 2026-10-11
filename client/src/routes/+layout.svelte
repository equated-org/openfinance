<script lang="ts">
  import "../app.css";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { ModeWatcher } from "mode-watcher";
  import { authClient } from "$lib/auth-client";
  import Toaster from "$lib/components/ui/sonner/sonner.svelte";

  let { children } = $props();

  const session = authClient.useSession();

  // Reconnect links are opened by people who aren't signed in.
  const isPublicPage = $derived($page.url.pathname.startsWith("/reconnect/"));

  $effect(() => {
    if ($session.isPending || isPublicPage) return;

    const isLoginPage = $page.url.pathname.startsWith("/login");

    if (!$session.data && !isLoginPage) {
      goto("/login");
    } else if ($session.data && isLoginPage) {
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

<script lang="ts">
  import type { ApiNotification } from "@openfinance/shared";
  import { fetchNotifications } from "$lib/notifications/api";
  import { markAllRead } from "$lib/notifications/state";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";
  import { Spinner } from "$lib/components/ui/spinner";
  import EmptyNotificationsState from "$lib/notifications/EmptyNotificationsState.svelte";

  const PAGE_SIZE = 30;

  let notifications = $state<ApiNotification[]>([]);
  let loading = $state(true);
  let loadingMore = $state(false);
  let hasMore = $state(false);
  let cursor = $state<string | undefined>(undefined);
  let sentinel = $state<HTMLDivElement | null>(null);

  // Mark all as read on mount
  $effect(() => {
    markAllRead();
  });

  // Initial load
  $effect(() => {
    loadPage(undefined);
  });

  async function loadPage(pageCursor: string | undefined) {
    const isFirstPage = !pageCursor;
    if (!isFirstPage) loadingMore = true;

    try {
      const data = await fetchNotifications({
        limit: PAGE_SIZE + 1,
        cursor: pageCursor,
      });
      const items = data.notifications;

      if (items.length > PAGE_SIZE) {
        hasMore = true;
        items.pop();
      } else {
        hasMore = false;
      }

      const last = items[items.length - 1];
      if (last) {
        cursor = `${last.sentAt}:${last.id}`;
      }

      if (isFirstPage) {
        notifications = items;
      } else {
        notifications = [...notifications, ...items];
      }
    } catch {
      if (isFirstPage) notifications = [];
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  // IntersectionObserver for infinite scroll
  $effect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore && !loading) {
          loadPage(cursor);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  function getDescription(n: ApiNotification): string {
    const meta = n.metadata;
    if (meta.type === "account_disconnected") {
      return meta.errorMessage || "Your account connection needs attention.";
    }
    if (meta.type === "transaction_sync") {
      const parts: string[] = [];
      if (meta.added) parts.push(`${meta.added} added`);
      if (meta.modified) parts.push(`${meta.modified} modified`);
      if (meta.removed) parts.push(`${meta.removed} removed`);
      return parts.join(", ") || "Transactions synced.";
    }
    return "";
  }

  function getInstitutionUrl(n: ApiNotification): string | null {
    const meta = n.metadata;
    return "institutionUrl" in meta ? meta.institutionUrl : null;
  }

  function getInstitutionLogoUrl(n: ApiNotification): string | null {
    return n.metadata.institutionLogoUrl ?? null;
  }

  function getInstitutionName(n: ApiNotification): string {
    return n.metadata.institutionName;
  }

  function formatRelativeTime(isoDate: string): string {
    const now = Date.now();
    const then = new Date(isoDate).getTime();
    const diff = now - then;

    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;

    return new Date(isoDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }
</script>

<div class="max-w-4xl mx-auto md:px-8 pt-2">
  <h2 class="text-base font-semibold text-[var(--text)] mb-6">Notifications</h2>

  {#if loading}
    <div class="flex justify-center py-12">
      <Spinner class="size-6 text-[var(--text-muted)]" />
    </div>
  {:else if notifications.length === 0}
    <EmptyNotificationsState />
  {:else}
    <div class="space-y-0.5">
      {#each notifications as n}
        <div class="flex items-center gap-3 py-3 px-1">
          <InstitutionLogo
            institutionUrl={getInstitutionUrl(n)}
            institutionLogoUrl={getInstitutionLogoUrl(n)}
            institutionName={getInstitutionName(n)}
            size="md"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-[var(--text)]">{n.title}</p>
            <p class="text-sm text-[var(--text-muted)] mt-0.5">{getDescription(n)}</p>
          </div>
          <span
            class="text-xs text-[var(--text-muted)] whitespace-nowrap flex-shrink-0 pt-0.5"
          >
            {formatRelativeTime(n.sentAt)}
          </span>
        </div>
      {/each}
    </div>

    {#if loadingMore}
      <div class="flex justify-center py-6">
        <Spinner class="size-5 text-[var(--text-muted)]" />
      </div>
    {/if}

    <div bind:this={sentinel} class="h-1"></div>
  {/if}
</div>

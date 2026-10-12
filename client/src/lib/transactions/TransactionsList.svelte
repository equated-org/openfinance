<script lang="ts">
  import type {
    ApiTransaction,
    ConnectedAccount,
    TransactionFilter,
  } from "@openfinance/shared";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";
  import EmptyAccountsState from "$lib/accounts/EmptyAccountsState.svelte";
  import { fetchTransactions } from "./api";
  import { Spinner } from "$lib/components/ui/spinner";
  import { cn } from "$lib/utils";

  const PAGE_SIZE = 40;

  interface Props {
    searchText?: string;
    accountId?: number;
    accounts?: ConnectedAccount[];
    onAccountClick?: (accountId: number) => void;
    onAddAccount?: () => void;
  }

  let {
    searchText = "",
    accountId,
    accounts = [],
    onAccountClick,
    onAddAccount,
  }: Props = $props();

  let transactions = $state<ApiTransaction[]>([]);
  let loading = $state(true);
  let loadingMore = $state(false);
  let hasMore = $state(false);
  let cursor = $state<string | undefined>(undefined);
  let sentinel = $state<HTMLDivElement | null>(null);
  let debouncedSearch = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Debounce search text
  $effect(() => {
    const text = searchText;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedSearch = text;
    }, 300);
    return () => clearTimeout(debounceTimer);
  });

  // Reset and reload when filters change
  $effect(() => {
    const _search = debouncedSearch;
    const _account = accountId;
    transactions = [];
    cursor = undefined;
    hasMore = false;
    loading = true;
    loadPage(_search, _account, undefined);
  });

  async function loadPage(
    search: string | undefined,
    account: number | undefined,
    pageCursor: string | undefined,
  ) {
    const isFirstPage = !pageCursor;
    if (!isFirstPage) loadingMore = true;

    try {
      const params: TransactionFilter = { limit: PAGE_SIZE + 1 };
      if (search) params.searchText = search;
      if (account !== undefined) params.accountId = account;
      if (pageCursor) params.cursor = pageCursor;

      const data = await fetchTransactions(params);
      const items = data.transactions;

      if (items.length > PAGE_SIZE) {
        hasMore = true;
        items.pop();
      } else {
        hasMore = false;
      }

      const last = items[items.length - 1];
      if (last) {
        cursor = `${last.date}:${last.id}`;
      }

      if (isFirstPage) {
        transactions = items;
      } else {
        transactions = [...transactions, ...items];
      }
    } catch {
      if (isFirstPage) transactions = [];
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
          loadPage(debouncedSearch, accountId, cursor);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  // Group transactions by date
  let grouped = $derived.by(() => {
    const groups: { date: string; label: string; items: ApiTransaction[] }[] =
      [];
    let currentDate = "";
    for (const tx of transactions) {
      if (tx.date !== currentDate) {
        currentDate = tx.date;
        groups.push({
          date: tx.date,
          label: formatDateHeading(tx.date),
          items: [],
        });
      }
      groups[groups.length - 1].items.push(tx);
    }
    return groups;
  });

  function formatDateHeading(dateStr: string) {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function formatAmount(amount: number, currency: string | null) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  }
</script>

{#if loading}
  <div class="flex justify-center py-12">
    <Spinner class="size-6 text-[var(--text-muted)]" />
  </div>
{:else if transactions.length === 0 && accounts.length === 0 && !debouncedSearch && accountId === undefined}
  <EmptyAccountsState {onAddAccount} />
{:else if transactions.length === 0}
  <p class="text-[var(--text-muted)] text-sm py-8 text-center">No transactions found.</p>
{:else}
  <div class="space-y-6">
    {#each grouped as group}
      <div>
        <h3
          class="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2 px-1"
        >
          {group.label}
        </h3>
        <div class="space-y-0.5">
          {#each group.items as tx}
            {@const account = accounts.find((a) => a.id === tx.accountId)}
            <div class="flex items-center justify-between py-2.5 px-1 gap-2">
              <div class="min-w-0 flex items-center gap-2 flex-1">
                <div class="min-w-0">
                  <p
                    class="text-sm text-[var(--text)] truncate {tx.pending
                      ? 'italic'
                      : ''}"
                  >
                    {tx.merchantName || tx.name}
                  </p>
                </div>
                {#if account && onAccountClick}
                  <div
                    class="flex items-center gap-1.5 min-w-0 ml-2 cursor-pointer hover:bg-[var(--bg-muted)] rounded-md px-1.5 py-0.5"
                    role="button"
                    tabindex="0"
                    onclick={(e) => {
                      e.stopPropagation();
                      onAccountClick(tx.accountId);
                    }}
                    onkeydown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onAccountClick(tx.accountId);
                      }
                    }}
                  >
                    <InstitutionLogo
                      institutionUrl={account.institutionUrl}
                      institutionLogoUrl={account.institutionLogoUrl}
                      institutionName={account.institutionName}
                    />
                    <span class="text-xs text-[var(--text-muted)] truncate">
                      {account.name}
                    </span>
                  </div>
                {/if}
              </div>
              <span
                class={cn(
                  "text-sm font-medium ml-4 whitespace-nowrap flex-shrink-0",
                  tx.amount < 0 ? "text-green-600" : "text-[var(--text)]",
                )}
              >
                {formatAmount(tx.amount, tx.isoCurrencyCode)}
              </span>
            </div>
          {/each}
        </div>
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

<script lang="ts">
  import type { ConnectedAccount } from "@openfinance/shared";
  import { fetchAccounts } from "$lib/accounts/api";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";
  import TransactionsList from "$lib/transactions/TransactionsList.svelte";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Search, ChevronDown } from "lucide-svelte";
  import { page } from "$app/state";
  import { getLinkContext } from "$lib/sync/link-context";

  const { openSearch } = getLinkContext();

  let searchText = $state("");
  let accounts = $state<ConnectedAccount[]>([]);
  let accountsLoaded = $state(false);
  let selectedAccountId = $state<number | undefined>(undefined);

  $effect(() => {
    fetchAccounts()
      .then((data) => {
        accounts = data.accounts;
      })
      .finally(() => {
        accountsLoaded = true;
      });
  });

  // Read accountId from URL once after accounts load (for deep-linking)
  $effect(() => {
    if (!accountsLoaded) return;
    const raw = page.url.searchParams.get("accountId");
    if (raw) {
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isNaN(parsed) && accounts.some((a) => a.id === parsed)) {
        selectedAccountId = parsed;
      }
    }
  });

  function setSelectedAccount(accountId: number | undefined) {
    selectedAccountId = accountId;
  }

  let selectedAccount = $derived(
    selectedAccountId !== undefined
      ? (accounts.find((a) => a.id === selectedAccountId) ?? null)
      : null,
  );

  let selectedAccountLabel = $derived(
    selectedAccount ? selectedAccount.name : "All accounts",
  );
</script>

<div class="max-w-4xl mx-auto md:px-8 pt-2">
  <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
    <h2 class="text-base font-semibold text-[var(--text)]">Transactions</h2>

    <div class="flex w-full items-center gap-3 sm:w-auto">
      <div class="relative min-w-0 flex-1 sm:flex-none">
        <Search
          class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] pointer-events-none"
        />
        <!-- No text-sm override: the Input's 16px mobile size stops iOS zooming on focus. -->
        <Input
          type="text"
          placeholder="Search transactions..."
          bind:value={searchText}
          class="pl-9 w-full sm:w-56 h-8"
        />
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              variant="outline"
              size="sm"
              class="h-8 max-w-40 sm:max-w-none text-sm gap-1.5 whitespace-nowrap"
              {...props}
            >
              {#if selectedAccount}
                <InstitutionLogo
                  institutionUrl={selectedAccount.institutionUrl}
                  institutionName={selectedAccount.institutionName}
                />
              {/if}
              <span class="truncate">{selectedAccountLabel}</span>
              <ChevronDown class="ml-0.5 h-3.5 w-3.5 text-[var(--text-muted)]" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item onclick={() => setSelectedAccount(undefined)}>
            All accounts
          </DropdownMenu.Item>
          {#if accounts.length > 0}
            <DropdownMenu.Separator />
            {#each accounts as account}
              <DropdownMenu.Item
                onclick={() => setSelectedAccount(account.id)}
                class="flex items-center gap-2"
              >
                <InstitutionLogo
                  institutionUrl={account.institutionUrl}
                  institutionName={account.institutionName}
                />
                <span>{account.name}</span>
                {#if account.mask}
                  <span class="text-[var(--text-muted)] ml-1">...{account.mask}</span>
                {/if}
              </DropdownMenu.Item>
            {/each}
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>

  <TransactionsList
    {searchText}
    accountId={selectedAccountId}
    {accounts}
    onAccountClick={setSelectedAccount}
    onAddAccount={openSearch}
  />
</div>

<script lang="ts">
  import { AccountList } from "$lib/accounts";
  import EmptyAccountsState from "$lib/accounts/EmptyAccountsState.svelte";
  import { Button } from "$lib/components/ui/button";
  import { accountsState, refreshAccountsState } from "$lib/accounts/state";
  import { getLinkContext } from "$lib/sync/link-context";
  import { Plus } from "lucide-svelte";
  import { goto } from "$app/navigation";

  const { openSearch, triggerReauth, onAccountLinked } = getLinkContext();

  $effect(() => {
    onAccountLinked(() => refreshAccountsState());
  });

  let accounts = $derived($accountsState?.accounts ?? []);

  function handleAccountClick(accountId: number) {
    goto(`/transactions?accountId=${accountId}`);
  }
</script>

<div class="max-w-4xl mx-auto md:px-8 pt-2">
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-base font-semibold text-[var(--text)]">Accounts</h2>
    <Button variant="linkBlue" size="link" onclick={openSearch}>
      <Plus class="h-3.5 w-3.5" />
      add account
    </Button>
  </div>

  {#if $accountsState && accounts.length === 0}
    <EmptyAccountsState onAddAccount={openSearch} />
  {:else}
    <AccountList
      {accounts}
      onReauth={triggerReauth}
      onAccountClick={handleAccountClick}
    />
  {/if}
</div>

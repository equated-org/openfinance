<script lang="ts">
  import { AccountsOverview } from "$lib/accounts";
  import EmptyAccountsState from "$lib/accounts/EmptyAccountsState.svelte";
  import { dismissOnboarding } from "$lib/accounts/api";
  import { accountsState, refreshAccountsState } from "$lib/accounts/state";

  import RecentTransactions from "$lib/transactions/RecentTransactions.svelte";
  import { getLinkContext } from "$lib/sync/link-context";
  import { syncStatus } from "$lib/sync/sync-status";
  import GettingStarted from "$lib/components/GettingStarted.svelte";
  import Tasks from "$lib/tasks/Tasks.svelte";
  import { fetchTasks, type Task } from "$lib/tasks/api";
  import { authClient } from "$lib/auth-client";
  import { goto } from "$app/navigation";

  const session = authClient.useSession();
  const { openSearch, onAccountLinked, triggerReauth } = getLinkContext();

  let tasks = $state<Task[]>([]);
  let tasksLoading = $state(true);

  $effect(() => {
    if ($session.data) {
      fetchTasks()
        .then((data) => (tasks = data))
        .catch(() => (tasks = []))
        .finally(() => (tasksLoading = false));
    }
  });

  $effect(() => {
    if ($syncStatus.completed) {
      fetchTasks()
        .then((data) => (tasks = data))
        .catch(() => (tasks = []));
    }
  });

  $effect(() => {
    onAccountLinked(() => refreshAccountsState());
  });

  let accounts = $derived($accountsState?.accounts ?? []);
  let onboarding = $derived(
    $accountsState?.onboarding ?? {
      accountConnected: false,
      mcpLinked: false,
      dismissed: false,
    },
  );

  async function handleDismissOnboarding() {
    accountsState.update((s) =>
      s ? { ...s, onboarding: { ...s.onboarding, dismissed: true } } : s,
    );
    await dismissOnboarding();
  }

  function handleReconnect(accountId: number) {
    const account = accounts.find((a) => a.id === accountId);
    if (account) triggerReauth(account);
  }

  function handleAccountClick(accountId: number) {
    goto(`/transactions?accountId=${accountId}`);
  }
</script>

<div class="max-w-4xl mx-auto md:px-8 pt-2 space-y-8">
  {#if $accountsState}
    {#if !onboarding.dismissed}
      <GettingStarted
        onConnectAccount={openSearch}
        accountConnected={onboarding.accountConnected}
        mcpLinked={onboarding.mcpLinked}
        onDismiss={handleDismissOnboarding}
      />
    {/if}

    {#if accounts.length === 0}
      <EmptyAccountsState onAddAccount={openSearch} />
    {:else}
      <AccountsOverview
        {accounts}
        onAddAccount={openSearch}
        onReauth={triggerReauth}
        onAccountClick={handleAccountClick}
      />

      <Tasks {tasks} onReconnect={handleReconnect} />

      <RecentTransactions />
    {/if}
  {/if}
</div>

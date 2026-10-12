<script lang="ts">
  import type { ConnectedAccount } from "@openfinance/shared";
  import { fetchAllAccounts, updateAccountStatus } from "$lib/accounts/api";
  import { deleteAccount } from "$lib/accounts/api";
  import { refreshAccountsState } from "$lib/accounts/state";
  import { formatAccountType } from "$lib/accounts/utils";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";
  import { Switch } from "$lib/components/ui/switch";
  import { Button } from "$lib/components/ui/button";
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
  } from "$lib/components/ui/dialog";
  import { toast } from "svelte-sonner";
  import ChevronRight from "lucide-svelte/icons/chevron-right";
  import ArrowLeft from "lucide-svelte/icons/arrow-left";

  interface InstitutionGroup {
    connectionId: number;
    institutionName: string;
    institutionUrl: string | null;
    institutionLogoUrl: string | null;
    accounts: ConnectedAccount[];
  }

  let accounts = $state<ConnectedAccount[]>([]);
  let loading = $state(true);
  let selectedGroup = $state<InstitutionGroup | null>(null);
  let unlinkDialogOpen = $state(false);
  let unlinking = $state(false);
  let togglingId = $state<number | null>(null);

  const groups = $derived.by(() => {
    const map = new Map<number, InstitutionGroup>();
    for (const account of accounts) {
      let group = map.get(account.connectionId);
      if (!group) {
        group = {
          connectionId: account.connectionId,
          institutionName: account.institutionName,
          institutionUrl: account.institutionUrl,
          institutionLogoUrl: account.institutionLogoUrl,
          accounts: [],
        };
        map.set(account.connectionId, group);
      }
      group.accounts.push(account);
    }
    return [...map.values()];
  });

  function formatBalance(balance: string | null, currency: string | null) {
    if (!balance) return "--";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(parseFloat(balance));
  }

  async function loadAccounts() {
    loading = true;
    try {
      const data = await fetchAllAccounts();
      accounts = data.accounts;
    } catch {
      toast.error("Failed to load accounts");
    } finally {
      loading = false;
    }
  }

  async function handleToggle(account: ConnectedAccount, checked: boolean) {
    const newStatus = checked ? "active" : "hidden";
    togglingId = account.id;
    try {
      await updateAccountStatus(account.id, newStatus);
      account.status = newStatus;
      refreshAccountsState();
      toast.success(
        newStatus === "hidden"
          ? `${account.name} hidden`
          : `${account.name} visible`,
      );
    } catch {
      toast.error("Failed to update account");
    } finally {
      togglingId = null;
    }
  }

  async function handleUnlink() {
    if (!selectedGroup) return;
    unlinking = true;
    try {
      for (const account of selectedGroup.accounts) {
        await deleteAccount(account.id);
      }
      toast.success(`${selectedGroup.institutionName} unlinked`);
      selectedGroup = null;
      await loadAccounts();
      refreshAccountsState();
    } catch {
      toast.error("Failed to unlink institution");
    } finally {
      unlinking = false;
      unlinkDialogOpen = false;
    }
  }

  $effect(() => {
    loadAccounts();
  });
</script>

{#if loading}
  <div class="flex items-center justify-center py-12">
    <div
      class="h-5 w-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-gray-900"
    ></div>
  </div>
{:else if selectedGroup}
  <!-- Account Detail View -->
  <div class="space-y-4">
    <button
      class="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
      onclick={() => (selectedGroup = null)}
    >
      <ArrowLeft size={14} />
      Back
    </button>

    <div class="flex items-center gap-3">
      <InstitutionLogo
        institutionUrl={selectedGroup.institutionUrl}
        institutionLogoUrl={selectedGroup.institutionLogoUrl}
        institutionName={selectedGroup.institutionName}
        size="md"
      />
      <h3 class="text-sm font-semibold text-[var(--text)]">
        {selectedGroup.institutionName}
      </h3>
    </div>

    <div class="space-y-1">
      {#each selectedGroup.accounts as account (account.id)}
        {@const isActive = account.status === "active"}
        <div
          class="flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-[var(--bg-muted)] transition-colors"
        >
          <div class="flex-1 min-w-0">
            <p
              class="text-sm font-medium truncate {isActive
                ? 'text-[var(--text)]'
                : 'text-[var(--text-muted)]'}"
            >
              {account.name}
              {#if account.mask}
                <span class={isActive ? "text-[var(--text-muted)]" : "text-[var(--text-muted)]"}
                  >····{account.mask}</span
                >
              {/if}
            </p>
            <p
              class="text-xs truncate {isActive
                ? 'text-[var(--text-muted)]'
                : 'text-[var(--text-muted)]'}"
            >
              {formatAccountType(account.type, account.subtype)}
            </p>
          </div>
          <span
            class="text-sm font-medium {isActive
              ? 'text-[var(--text)]'
              : 'text-[var(--text-muted)]'}"
          >
            {formatBalance(account.currentBalance, account.isoCurrencyCode)}
          </span>
          <Switch
            checked={isActive}
            disabled={togglingId === account.id}
            onCheckedChange={(checked) => handleToggle(account, checked)}
          />
        </div>
      {/each}
    </div>

    <div class="pt-4 border-t border-[var(--border)]">
      <Button
        variant="outlineRed"
        size="sm"
        onclick={() => (unlinkDialogOpen = true)}
      >
        Unlink {selectedGroup.institutionName}
      </Button>
    </div>
  </div>

  <Dialog bind:open={unlinkDialogOpen}>
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Unlink {selectedGroup.institutionName}</DialogTitle>
        <DialogDescription>
          This will remove all accounts from {selectedGroup.institutionName} and
          their transaction history. This action cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="ghost"
          disabled={unlinking}
          onclick={() => (unlinkDialogOpen = false)}
        >
          Cancel
        </Button>
        <Button
          variant="outline"
          class="border-red-300 text-red-600 hover:bg-red-50"
          onclick={handleUnlink}
          disabled={unlinking}
        >
          {unlinking ? "Unlinking..." : "Unlink"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
{:else if groups.length === 0}
  <div class="text-center py-12">
    <p class="text-sm text-[var(--text-muted)]">No connected institutions</p>
  </div>
{:else}
  <!-- Institution List View -->
  <div class="space-y-4">
    <div>
      <h3 class="text-sm font-medium text-[var(--text)]">Connected Institutions</h3>
      <p class="mt-1 text-sm text-[var(--text-muted)]">
        Manage your linked accounts. Hidden accounts continue syncing but are
        excluded from the dashboard and MCP.
      </p>
    </div>

    <div class="space-y-1">
      {#each groups as group (group.connectionId)}
        {@const activeCount = group.accounts.filter(
          (a) => a.status === "active",
        ).length}
        <button
          class="w-full flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-[var(--bg-muted)] transition-colors text-left"
          onclick={() => (selectedGroup = group)}
        >
          <InstitutionLogo
            institutionUrl={group.institutionUrl}
            institutionLogoUrl={group.institutionLogoUrl}
            institutionName={group.institutionName}
            size="lg"
          />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-[var(--text)] truncate">
              {group.institutionName}
            </p>
            <p class="text-xs text-[var(--text-muted)]">
              {activeCount}/{group.accounts.length} accounts visible
            </p>
          </div>
          <ChevronRight size={16} class="text-[var(--text-muted)] flex-shrink-0" />
        </button>
      {/each}
    </div>
  </div>
{/if}

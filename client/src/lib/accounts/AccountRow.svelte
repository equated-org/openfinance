<script lang="ts">
  import type { ConnectedAccount } from "@openfinance/shared";
  import { isLiabilityGroup } from "./utils";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";
  import Loader2Icon from "@lucide/svelte/icons/loader-2";
  import AlertTriangleIcon from "@lucide/svelte/icons/alert-triangle";

  export interface Props {
    account: ConnectedAccount;
    groupKey: string;
    onReauth?: (account: ConnectedAccount) => void;
    isConnectorLoading?: boolean;
    onClick?: (accountId: number) => void;
  }

  let {
    account,
    groupKey,
    onReauth = undefined,
    isConnectorLoading = false,
    onClick = undefined,
  }: Props = $props();

  const isLiability = $derived(isLiabilityGroup(groupKey));

  const displayBalance = $derived.by(() => {
    if (!account.currentBalance) return "--";
    const num = parseFloat(account.currentBalance);
    const value = isLiability ? -Math.abs(num) : num;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: account.isoCurrencyCode || "USD",
    }).format(value);
  });
</script>

{#snippet syncErrorReconnect()}
  <button
    class="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
    onclick={(e) => {
      e.stopPropagation();
      if (!isConnectorLoading) onReauth?.(account);
    }}
    disabled={isConnectorLoading}
  >
    {#if isConnectorLoading}
      <Loader2Icon class="w-3.5 h-3.5 animate-spin" />
    {:else}
      <AlertTriangleIcon class="w-3.5 h-3.5" />
    {/if}
    Reconnect
  </button>
{/snippet}

<div
  class="group flex items-center gap-3 py-2.5 px-1 rounded-lg {account.syncError
    ? 'bg-red-50 dark:bg-[#1a0c0c]'
    : ''} cursor-pointer"
  role="button"
  tabindex="0"
  onclick={() => onClick?.(account.id)}
  onkeydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.(account.id);
    }
  }}
>
  <div class="relative flex-shrink-0">
    <InstitutionLogo
      institutionUrl={account.institutionUrl}
      institutionLogoUrl={account.institutionLogoUrl}
      institutionName={account.institutionName}
      size="lg"
    />
    {#if account.isSyncing}
      <div
        class="absolute inset-0 flex items-center justify-center bg-[var(--bg)]/70 rounded-lg"
      >
        <Loader2Icon class="w-4 h-4 text-[var(--text-muted)] animate-spin" />
      </div>
    {/if}
  </div>
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-[var(--text)] truncate">
      {account.name}
      {#if account.mask}
        <span class="text-[var(--text-muted)] font-normal">····{account.mask}</span>
      {/if}
    </p>
    <p class="text-xs text-[var(--text-muted)] truncate">{account.institutionName}</p>
  </div>
  <div class="flex-shrink-0 text-sm font-medium text-[var(--text)]">
    {displayBalance}
  </div>
  {#if account.syncError}
    {@render syncErrorReconnect()}
  {/if}
</div>

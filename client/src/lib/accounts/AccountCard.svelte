<script lang="ts">
  import type { ConnectedAccount } from "@openfinance/shared";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";
  import AlertTriangleIcon from "@lucide/svelte/icons/alert-triangle";

  interface Props {
    account: ConnectedAccount;
    onReauth?: (account: ConnectedAccount) => void;
    onClick?: (accountId: number) => void;
  }

  let { account, onReauth = undefined, onClick = undefined }: Props = $props();

  function formatBalance(
    balance: string | null,
    currency: string | null,
    type: string,
  ): string {
    if (!balance) return "--";
    const num = parseFloat(balance);
    const isLiability = type === "credit" || type === "loan";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(isLiability ? -num : num);
  }

  const shortName = $derived(() => {
    const sub =
      account.subtype && account.subtype.toUpperCase() !== "NONE"
        ? account.subtype
        : account.type;
    const label = sub.charAt(0).toUpperCase() + sub.slice(1).replace(/_/g, " ");
    return account.mask ? `${label} ····${account.mask}` : label;
  });
</script>

<div
  class="rounded-2xl p-5 w-[200px] flex flex-col justify-between h-[140px] {account.syncError
    ? 'bg-red-50 dark:bg-[#1a0c0c]'
    : 'bg-[var(--bg-muted)]'} cursor-pointer"
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
  <div class="flex items-center gap-2.5">
    <InstitutionLogo
      institutionUrl={account.institutionUrl}
      institutionLogoUrl={account.institutionLogoUrl}
      institutionName={account.institutionName}
      size="md"
      class="rounded-full bg-[var(--bg)]"
    />
    <p class="text-sm font-medium text-[var(--text)] truncate">{account.name}</p>
  </div>
  <div>
    <p class="text-xs text-[var(--text-muted)] mb-0.5">{shortName()}</p>
    {#if account.syncError}
      <button
        class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
        onclick={(e) => {
          e.stopPropagation();
          onReauth?.(account);
        }}
      >
        <AlertTriangleIcon class="w-3.5 h-3.5" />
        Reconnect
      </button>
    {:else}
      <p class="text-base font-semibold text-[var(--text)]">
        {formatBalance(
          account.currentBalance,
          account.isoCurrencyCode,
          account.type,
        )}
      </p>
    {/if}
  </div>
</div>

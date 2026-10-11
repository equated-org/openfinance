<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import {
    createCheckoutSession,
    changePlan,
    createPortalSession,
  } from "$lib/billing/api";
  import { billingState, refreshBillingState } from "$lib/billing/state";
  import { accountsState } from "$lib/accounts/state";
  import { PLAN_LIMITS, PLAN_PRICES, type PlanType } from "@openfinance/shared";
  import type { ConnectedAccount } from "@openfinance/shared";
  import DowngradeModal from "./DowngradeModal.svelte";
  import CreditCard from "lucide-svelte/icons/credit-card";
  import { toast } from "svelte-sonner";

  let upgradeLoading = $state<PlanType | null>(null);
  let portalLoading = $state(false);
  let downgradeTarget = $state<PlanType | null>(null);
  let connections = $state<ConnectedAccount[]>([]);

  const billing = $derived($billingState);
  const currentPlan = $derived(billing?.planType ?? "free");
  const isPaid = $derived(currentPlan !== "free");

  const planOrder: PlanType[] = ["free", "plus", "pro"];

  const plans = [
    {
      type: "free" as PlanType,
      name: "Free",
      price: "$0",
      period: "",
      accountLimit: `${PLAN_LIMITS.free} account`,
    },
    {
      type: "plus" as PlanType,
      name: "Plus",
      price: `$${PLAN_PRICES.plus}`,
      period: "/mo",
      accountLimit: `Up to ${PLAN_LIMITS.plus} accounts`,
    },
    {
      type: "pro" as PlanType,
      name: "Pro",
      price: `$${PLAN_PRICES.pro}`,
      period: "/mo",
      accountLimit: `Up to ${PLAN_LIMITS.pro} accounts`,
    },
  ];

  function planIndex(plan: PlanType): number {
    return planOrder.indexOf(plan);
  }

  async function handleUpgrade(plan: Exclude<PlanType, "free">) {
    upgradeLoading = plan;
    try {
      if (isPaid) {
        await changePlan(plan);
        await refreshBillingState();
        toast.success(`Plan upgraded to ${plan}`);
      } else {
        const { url } = await createCheckoutSession(plan);
        window.location.href = url;
      }
    } catch {
      // errors handled by API layer
    } finally {
      upgradeLoading = null;
    }
  }

  async function handleDowngradeClick(plan: PlanType) {
    connections = $accountsState?.accounts ?? [];
    downgradeTarget = plan;
  }

  async function handleManageSubscription() {
    portalLoading = true;
    try {
      const { url } = await createPortalSession();
      window.location.href = url;
    } catch {
      // errors handled by API layer
    } finally {
      portalLoading = false;
    }
  }
</script>

<div class="space-y-6">
  <!-- Current plan summary -->
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-medium text-[var(--text)]">Current Plan</h3>
        <Badge variant="pill">
          {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
        </Badge>
      </div>
      {#if billing}
        <p class="mt-1 text-sm text-[var(--text-muted)]">
          Using {billing.connectionCount} of {billing.maxConnections} connection{billing.maxConnections ===
          1
            ? ""
            : "s"}
        </p>
      {/if}
    </div>
    {#if isPaid}
      <Button
        variant="outline"
        size="sm"
        onclick={handleManageSubscription}
        disabled={portalLoading}
      >
        <CreditCard class="h-4 w-4 mr-1.5" />
        {portalLoading ? "Loading..." : "Manage Subscription"}
      </Button>
    {/if}
  </div>

  <!-- Plans table -->
  <div class="border border-[var(--border)] rounded-lg overflow-hidden">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-[var(--border)]">
          <th
            class="text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]"
            >Plan</th
          >
          <th
            class="hidden sm:table-cell text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]"
            >Price</th
          >
          <th
            class="hidden sm:table-cell text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]"
            >Accounts</th
          >
          <th class="px-4 py-2.5"></th>
        </tr>
      </thead>
      <tbody>
        {#each plans as plan, i}
          {@const isCurrent = plan.type === currentPlan}
          {@const isHigher = planIndex(plan.type) > planIndex(currentPlan)}
          {@const isLower = planIndex(plan.type) < planIndex(currentPlan)}

          <tr class={i < plans.length - 1 ? "border-b border-[var(--border)]" : ""}>
            <td class="px-4 py-3">
              <span class="font-semibold text-[var(--text)]">{plan.name}</span>
              {#if isCurrent}
                <Badge variant="pill" class="ml-2">Current</Badge>
              {/if}
              <!-- Narrow screens fold the Price and Accounts columns in here. -->
              <p class="sm:hidden mt-0.5 text-xs text-[var(--text-muted)]">
                {plan.price}{plan.period} · {plan.accountLimit}
              </p>
            </td>
            <td class="hidden sm:table-cell px-4 py-3 text-[var(--text)]">
              {plan.price}{plan.period}
            </td>
            <td class="hidden sm:table-cell px-4 py-3 text-[var(--text-muted)]">
              {plan.accountLimit}
            </td>
            <td class="px-4 py-3 text-right">
              {#if isCurrent}
                <Button variant="outline" size="sm" disabled>Current</Button>
              {:else if isHigher}
                <Button
                  variant="default"
                  size="sm"
                  onclick={() =>
                    handleUpgrade(plan.type as Exclude<PlanType, "free">)}
                  disabled={upgradeLoading !== null}
                >
                  {upgradeLoading === plan.type ? "Upgrading..." : "Upgrade"}
                </Button>
              {:else if isLower}
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => handleDowngradeClick(plan.type)}
                >
                  Downgrade
                </Button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

{#if downgradeTarget}
  <DowngradeModal
    isOpen={true}
    targetPlan={downgradeTarget}
    {currentPlan}
    {connections}
    onClose={() => (downgradeTarget = null)}
    onComplete={() => (downgradeTarget = null)}
  />
{/if}

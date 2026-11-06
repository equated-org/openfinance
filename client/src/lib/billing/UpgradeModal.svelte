<script lang="ts">
  import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogHeader,
  } from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { createCheckoutSession, changePlan } from "./api";
  import { refreshBillingState } from "./state";
  import { PLAN_LIMITS, PLAN_PRICES, type PlanType } from "@openfinance/shared";
  import { toast } from "svelte-sonner";

  interface Props {
    isOpen?: boolean;
    requiredPlan?: Exclude<PlanType, "free">;
    hasExistingSubscription?: boolean;
    onClose?: () => void;
  }

  let {
    isOpen = $bindable(false),
    requiredPlan = "plus",
    hasExistingSubscription = false,
    onClose = () => {},
  }: Props = $props();

  let loading = $state(false);
  let error = $state<string | null>(null);

  function handleOpenChange(open: boolean) {
    if (!open && isOpen) {
      isOpen = false;
      onClose();
    }
  }

  async function handleUpgrade() {
    loading = true;
    error = null;

    try {
      if (hasExistingSubscription) {
        await changePlan(requiredPlan);
        await refreshBillingState();
        toast.success(`Plan upgraded to ${requiredPlan}`);
        isOpen = false;
        onClose();
      } else {
        const { url } = await createCheckoutSession(requiredPlan);
        window.location.href = url;
      }
    } catch (err) {
      error = "Something went wrong. Please try again.";
      console.error("Upgrade error:", err);
    } finally {
      loading = false;
    }
  }
</script>

<Dialog bind:open={isOpen} onOpenChange={handleOpenChange}>
  <DialogContent class="sm:max-w-md">
    <DialogHeader>
      <DialogTitle
        >Upgrade to {requiredPlan.charAt(0).toUpperCase() +
          requiredPlan.slice(1)}</DialogTitle
      >
      <DialogDescription>
        You've reached the connection limit on your current plan. Upgrade to
        connect more accounts.
      </DialogDescription>
    </DialogHeader>

    <div class="py-4">
      <p class="text-sm text-[var(--text-muted)]">
        Up to {PLAN_LIMITS[requiredPlan]} connected institutions
      </p>

      <p class="mt-3">
        <span class="text-3xl font-bold">${PLAN_PRICES[requiredPlan]}</span>
        <span class="text-sm text-[var(--text-muted)]">/ month</span>
      </p>

      {#if error}
        <p class="mt-3 text-sm text-red-600">{error}</p>
      {/if}

      <Button
        onclick={handleUpgrade}
        size="lg"
        class="mt-6 w-full"
        disabled={loading}
      >
        {#if loading}
          Upgrading...
        {:else if hasExistingSubscription}
          Change Plan
        {:else}
          Get {requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1)} plan
        {/if}
      </Button>
    </div>
  </DialogContent>
</Dialog>

<script lang="ts">
  import Sidebar from "$lib/components/Sidebar.svelte";
  import ProfileDropdown from "$lib/components/ProfileDropdown.svelte";
  import { authClient } from "$lib/auth-client";
  import PlaidLink from "$lib/sync/PlaidLink.svelte";
  import MXLink from "$lib/sync/MXLink.svelte";
  import QuilttLink from "$lib/sync/QuilttLink.svelte";
  import SyncBanner from "$lib/sync/SyncBanner.svelte";
  import InstitutionSearchContainer from "$lib/sync/InstitutionSearchContainer.svelte";
  import UpgradeModal from "$lib/billing/UpgradeModal.svelte";
  import { checkCanConnect, confirmCheckout } from "$lib/billing/api";
  import { triggerPoll } from "$lib/sync/sync-status";
  import { setLinkContext } from "$lib/sync/link-context";
  import {
    billingState,
    loadBillingState,
    refreshBillingState,
  } from "$lib/billing/state";
  import { loadAccountsState, refreshAccountsState } from "$lib/accounts/state";
  import { unreadCount, loadUnreadCount } from "$lib/notifications/state";
  import Bell from "lucide-svelte/icons/bell";
  import Menu from "lucide-svelte/icons/menu";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { Badge } from "$lib/components/ui/badge";
  import {
    Dialog,
    DialogContent,
    DialogTitle,
  } from "$lib/components/ui/dialog";
  import type {
    CatalogProvider,
    ConnectedAccount,
    InstitutionType,
    PlanType,
  } from "@openfinance/shared";

  let { children } = $props();

  const session = authClient.useSession();

  let searchOpen = $state(false);
  // Below md the sidebar collapses into a drawer opened from the header.
  let navOpen = $state(false);
  let plaidLink: PlaidLink;
  let mxLink: MXLink;
  let quilttLink: QuilttLink;

  let accountLinkedCallback: (() => void) | undefined;

  // Billing state
  let upgradeModalOpen = $state(false);
  let upgradeRequiredPlan = $state<Exclude<PlanType, "free">>("plus");
  let hasExistingSubscription = $state(false);

  // Load user state (billing/plan, accounts) once session is available
  $effect(() => {
    if ($session.data) {
      loadBillingState();
      loadAccountsState();
      loadUnreadCount();
    }
  });

  // Handle checkout return from Stripe. `?checkout=success` only means Stripe
  // redirected us — it says nothing about whether the plan was actually
  // applied, so confirm the session server-side before claiming success.
  async function finalizeCheckout(sessionId: string | null) {
    if (!sessionId) {
      await refreshBillingState();
      toast("Payment received — activating your subscription…");
      return;
    }

    try {
      const result = await confirmCheckout(sessionId);
      billingState.set(result.status);

      // `confirmed` covers the normal path; a non-free plan covers the case
      // where the webhook already applied it before we got here.
      if (result.confirmed || result.status.planType !== "free") {
        toast.success(
          "Subscription activated! You can now connect more accounts.",
        );
      } else {
        toast("Payment received — activating your subscription…");
      }
    } catch {
      await refreshBillingState();
      toast("Payment received — activating your subscription…");
    }
  }

  $effect(() => {
    const checkoutParam = page.url.searchParams.get("checkout");
    if (checkoutParam === "success") {
      void finalizeCheckout(page.url.searchParams.get("session_id"));
    } else if (checkoutParam === "cancel") {
      toast("Checkout cancelled.");
    }
    if (checkoutParam) {
      const url = new URL(page.url);
      url.searchParams.delete("checkout");
      url.searchParams.delete("session_id");
      replaceState(url, {});
    }
  });

  function handleProviderSelect(
    institution: InstitutionType,
    provider: CatalogProvider,
  ) {
    searchOpen = false;
    launchProvider(institution, provider);
  }

  function launchProvider(
    institution: InstitutionType,
    provider: CatalogProvider,
  ) {
    if (provider === "plaid") {
      plaidLink.initiatePlaidLink(institution.plaidData?.institutionId);
    } else if (provider === "mx") {
      mxLink.initiateMXLink(institution.mxData?.institutionCode);
    }
  }

  // Banks outside the Plaid and MX catalogs are found in Quiltt's own search.
  function handleSearchAll() {
    searchOpen = false;
    quilttLink.initiateQuilttLink();
  }

  function handleAccountLinked() {
    refreshAccountsState();
    accountLinkedCallback?.();
  }

  function handleSyncStarted() {
    triggerPoll();
  }

  function triggerReauth(account: ConnectedAccount) {
    if (account.provider === "mx") {
      mxLink.initiateReauthentication(account.id);
    } else if (account.provider === "plaid") {
      plaidLink.initiateReauthentication(account.id);
    } else if (account.provider === "quiltt" && account.quilttConnectionId) {
      quilttLink.initiateReauthentication(account.quilttConnectionId);
    }
  }

  setLinkContext({
    openSearch: async () => {
      try {
        const result = await checkCanConnect();
        if (!result.allowed) {
          upgradeRequiredPlan = (result.requiredPlan ?? "plus") as Exclude<
            PlanType,
            "free"
          >;
          hasExistingSubscription = result.currentPlan !== "free";
          upgradeModalOpen = true;
          return;
        }
      } catch {
        // If billing check fails, let them through (server will enforce)
      }
      searchOpen = true;
    },
    triggerReauth,
    onAccountLinked: (cb: () => void) => {
      accountLinkedCallback = cb;
    },
  });
</script>

{#if $session.data}
  <PlaidLink
    bind:this={plaidLink}
    onAccountLinked={handleAccountLinked}
    onSyncStarted={handleSyncStarted}
  />

  <MXLink
    bind:this={mxLink}
    onAccountLinked={handleAccountLinked}
    onSyncStarted={handleSyncStarted}
  />

  <QuilttLink
    bind:this={quilttLink}
    onAccountLinked={handleAccountLinked}
    onSyncStarted={handleSyncStarted}
  />

  <SyncBanner />

  <UpgradeModal
    bind:isOpen={upgradeModalOpen}
    requiredPlan={upgradeRequiredPlan}
    {hasExistingSubscription}
    onClose={() => {}}
  />

  <InstitutionSearchContainer
    bind:isOpen={searchOpen}
    onProviderSelect={handleProviderSelect}
    onSearchAll={handleSearchAll}
  />

  {#snippet brand()}
    <span class="text-base font-semibold tracking-tight text-[var(--text)]"
      >OpenFinance</span
    >{#if $billingState && $billingState.planType !== "free"}<Badge
        variant="pill"
        class="ml-1.5">{$billingState.planType}</Badge
      >{/if}
  {/snippet}

  <Dialog bind:open={navOpen}>
    <DialogContent
      class="left-0 top-0 h-dvh w-64 max-w-[80vw] translate-x-0 translate-y-0 content-start gap-2 rounded-none border-0 border-r p-4 sm:max-w-[80vw]"
      overlayClass="bg-black/20 backdrop-blur-sm"
    >
      <DialogTitle class="inline-flex h-9 items-center px-4">
        {@render brand()}
      </DialogTitle>
      <Sidebar onNavigate={() => (navOpen = false)} />
    </DialogContent>
  </Dialog>

  <div class="h-dvh overflow-y-auto bg-[var(--bg)]">
    <div class="sticky top-0 z-10 bg-[var(--bg-translucent)] backdrop-blur">
      <div class="max-w-6xl mx-auto px-4 md:px-8">
        <header class="flex items-center py-3 md:py-6">
          <button
            type="button"
            class="md:hidden -ml-1.5 mr-1.5 p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            aria-label="Open navigation"
            onclick={() => (navOpen = true)}
          >
            <Menu class="h-5 w-5" />
          </button>
          <div
            class="md:w-48 shrink-0 text-center inline-flex items-center justify-center"
          >
            {@render brand()}
          </div>
          <div class="flex-1 flex items-center justify-end gap-3">
            <a
              href="/notifications"
              class="relative p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              aria-label="Notifications"
            >
              <Bell class="h-5 w-5" />
              {#if $unreadCount > 0}
                <span
                  class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-medium px-1"
                >
                  {$unreadCount > 99 ? "99+" : $unreadCount}
                </span>
              {/if}
            </a>
            <ProfileDropdown />
          </div>
        </header>
      </div>
    </div>
    <div class="max-w-6xl mx-auto px-4 md:px-8">
      <div class="flex gap-12">
        <div class="hidden md:block w-48 shrink-0 self-start sticky top-[84px]">
          <Sidebar />
        </div>
        <!-- Bottom padding keeps the last rows clear of mobile browser toolbars. -->
        <main class="flex-1 min-w-0 pb-16 md:pb-0">
          {@render children()}
        </main>
      </div>
    </div>
  </div>
{/if}

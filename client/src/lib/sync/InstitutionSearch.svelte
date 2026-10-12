<script lang="ts">
  import {
    Search,
    X,
    Lock,
    HelpCircle,
    Landmark,
    ChevronRight,
  } from "lucide-svelte";
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
  } from "$lib/components/ui/tooltip";
  import BackButton from "$lib/components/ui/BackButton.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import InstitutionLogo from "$lib/components/InstitutionLogo.svelte";
  import type { InstitutionType, CatalogProvider } from "@openfinance/shared";
  import { extractBaseDomain } from "$lib/url";

  const PROVIDERS: Record<CatalogProvider, { name: string; url: string }> = {
    plaid: { name: "Plaid", url: "plaid.com" },
    mx: { name: "MX", url: "mx.com" },
  };

  // Connection health thresholds
  const PLAID_DISABLE_THRESHOLD = 0.8;
  const PLAID_WARNING_THRESHOLD = 0.95;

  // === PROPS ===
  interface Props {
    isOpen?: boolean;
    institutions: InstitutionType[];
    isSearching: boolean;
    searchQuery: string;
    onSearchInput: (query: string) => void;
    onProviderSelect: (
      institution: InstitutionType,
      provider: CatalogProvider,
    ) => void;
    /** Opens Quiltt's own search, for banks this list doesn't carry. */
    onSearchAll: () => void;
    onClose: () => void;
  }

  let {
    isOpen = $bindable(false),
    institutions,
    isSearching,
    searchQuery,
    onSearchInput,
    onProviderSelect,
    onSearchAll,
    onClose,
  }: Props = $props();

  // === LOCAL STATE ===
  let showProviderSelection = $state(false);
  let selectedInstitution = $state<InstitutionType | null>(null);

  // === HELPERS ===

  function providerTooltip({ name, providers }: InstitutionType) {
    return providers.length > 1
      ? `You can connect to ${name} through more than one secure provider. You'll choose your preferred method on the next step.`
      : `This bank connects securely using ${PROVIDERS[providers[0]].name}.`;
  }

  /**
   * The chooser's options, best first. It only opens for a bank both catalogs
   * carry, and MX leads once Plaid's success rates for the bank slip.
   */
  function getProviderList(institution: InstitutionType) {
    const health = institution.plaidData?.connectionHealth;
    const plaidSuccess = Math.min(
      health?.item_logins?.breakdown?.success ?? 1,
      health?.transactions_updates?.breakdown?.success ?? 1,
    );
    const plaidHasIssues = plaidSuccess < PLAID_DISABLE_THRESHOLD;
    const plaidDegraded = plaidSuccess < PLAID_WARNING_THRESHOLD;

    let plaidDescription =
      "2 years of transaction history. Single authentication.";
    if (plaidHasIssues) {
      plaidDescription =
        "Some users experience connection issues. May be slower to connect.";
    } else if (plaidDegraded) {
      plaidDescription =
        "Generally reliable, but some issues have been reported.";
    }

    const plaid = {
      type: "plaid" as const,
      ...PROVIDERS.plaid,
      hasIssues: plaidHasIssues,
      hasWarning: plaidDegraded,
      description: plaidDescription,
    };
    const mx = {
      type: "mx" as const,
      ...PROVIDERS.mx,
      hasIssues: false,
      hasWarning: false,
      description: plaidDegraded
        ? "Most stable connection available"
        : "Requires 2FA twice but very reliable",
    };
    return plaidDegraded ? [mx, plaid] : [plaid, mx];
  }

  // === ACTIONS ===

  function handleInstitutionClick(institution: InstitutionType) {
    if (institution.providers.length > 1) {
      selectedInstitution = institution;
      showProviderSelection = true;
    } else {
      onProviderSelect(institution, institution.providers[0]);
    }
  }

  function handleProviderSelection(provider: CatalogProvider) {
    if (selectedInstitution) {
      showProviderSelection = false;
      onProviderSelect(selectedInstitution, provider);
      selectedInstitution = null;
    }
  }

  function goBackToSearch() {
    showProviderSelection = false;
    selectedInstitution = null;
  }

  function handleSearchInputEvent(event: Event) {
    const target = event.target as HTMLInputElement;
    onSearchInput(target.value);
  }

  function clearSearch() {
    onSearchInput("");
  }

  function closeModal() {
    showProviderSelection = false;
    selectedInstitution = null;
    isOpen = false;
    onClose();
  }
</script>

<Dialog bind:open={isOpen} onOpenChange={closeModal}>
  <!-- Capped at the viewport so the results scroll and the footer stays put. -->
  <DialogContent
    class="sm:max-w-3xl max-w-full max-h-[calc(100dvh-2rem)] flex flex-col"
  >
    <DialogHeader class="pb-4 shrink-0">
      <DialogTitle>
        {#if showProviderSelection}
          <div class="flex items-center gap-2">
            <BackButton onclick={goBackToSearch} position="relative" />
            Choose a provider
          </div>
        {:else}
          <span>Add Account</span>
        {/if}
      </DialogTitle>
    </DialogHeader>

    {#if showProviderSelection && selectedInstitution}
      {@const providers = getProviderList(selectedInstitution)}
      <div class="space-y-3">
        <!-- Provider Selection View -->
        <div class="flex items-center gap-3 p-3 bg-[var(--bg-muted)] rounded-lg">
          <InstitutionLogo institution={selectedInstitution} size="lg" />
          <div>
            <div class="font-medium text-[var(--text)]">
              {selectedInstitution.name}
            </div>
            <div class="text-sm text-[var(--text-muted)]">Select how to connect</div>
          </div>
        </div>

        <div class="space-y-3">
          {#each providers as provider}
            <button
              onclick={() => handleProviderSelection(provider.type)}
              class="w-full flex items-center justify-between p-4 border rounded-lg transition-colors group {provider.hasIssues
                ? 'border-amber-200 bg-amber-50 hover:bg-amber-100 hover:border-amber-300'
                : 'border-[var(--border)] hover:border-[var(--border)] hover:bg-[var(--bg-muted)]'}"
            >
              <div class="flex items-center gap-3">
                <InstitutionLogo
                  institutionUrl={provider.url}
                  institutionName={provider.name}
                  size="md"
                />
                <div class="text-left">
                  <div
                    class="font-medium text-[var(--text)] flex items-center gap-2"
                  >
                    {provider.name}
                    {#if provider.hasWarning}
                      <Badge variant="amber">
                        {provider.hasIssues
                          ? "Lower Success Rate"
                          : "Some Issues"}
                      </Badge>
                    {/if}
                  </div>
                  <div class="text-sm text-[var(--text-muted)]">
                    {provider.description}
                  </div>
                </div>
              </div>
              {#if !provider.hasIssues}
                <ChevronRight
                  size={16}
                  class="flex-shrink-0 text-[var(--text-muted)]"
                />
              {/if}
            </button>
          {/each}
        </div>

        <div class="border-t border-[var(--border)] pt-4 mt-4 px-4 sm:px-8">
          <p
            class="text-xs text-[var(--text-muted)] text-center flex items-center justify-center gap-1"
          >
            <Lock size={12} class="inline" />
            We never store your banking credentials. All connections are read-only.
          </p>
        </div>
      </div>
    {:else}
      <div class="flex min-h-0 flex-col gap-3">
        <!-- Search View -->
        <!-- Search Input -->
        <div class="relative shrink-0">
          <Search
            size={16}
            class="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--text-muted)]"
          />
          <Input
            placeholder="Search for your bank or financial institution..."
            value={searchQuery}
            oninput={handleSearchInputEvent}
            class="pl-10 pr-10"
          />
          {#if searchQuery}
            <button
              onclick={clearSearch}
              class="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-muted)] transition-colors"
              type="button"
            >
              <X size={16} />
            </button>
          {/if}
        </div>

        <!-- Content Area: shrinks on short screens so the footer stays visible -->
        <div class="h-80 sm:h-[400px] min-h-0 overflow-y-auto">
          {#if isSearching && institutions.length === 0}
            <div class="flex items-center justify-center py-4">
              <div class="text-sm text-[var(--text-muted)]">Searching...</div>
            </div>
          {/if}

          {#if institutions.length > 0}
            <div class="space-y-1 w-full">
              <TooltipProvider>
                {#each institutions as institution}
                  <div
                    class="flex items-start gap-2 p-2 rounded-lg transition-colors w-full hover:bg-[var(--bg-muted)] cursor-pointer"
                    onclick={() => handleInstitutionClick(institution)}
                    role="button"
                    tabindex={0}
                    onkeydown={(e) =>
                      e.key === "Enter" && handleInstitutionClick(institution)}
                  >
                    <InstitutionLogo {institution} size="md" />

                    <div class="flex-1 min-w-0 overflow-hidden">
                      <div
                        class="text-sm font-medium text-[var(--text)] break-words leading-tight"
                      >
                        {institution.name}
                      </div>
                      {#if institution.url}
                        <div
                          class="text-xs text-[var(--text-muted)] truncate mt-1 max-w-full"
                        >
                          {extractBaseDomain(institution.url)}
                        </div>
                      {/if}
                    </div>

                    <div class="flex gap-1 flex-shrink-0 items-center">
                      <Tooltip>
                        <TooltipTrigger>
                          {#if institution.providers.length > 1}
                            <span class="text-xs text-[var(--text-muted)]">
                              Multiple options
                            </span>
                          {:else}
                            <div class="text-[var(--text-muted)]">
                              <HelpCircle size={14} />
                            </div>
                          {/if}
                        </TooltipTrigger>
                        <TooltipContent
                          class="bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] shadow-md p-2"
                        >
                          <p class="max-w-xs text-xs">
                            {providerTooltip(institution)}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                {/each}
              </TooltipProvider>
            </div>
          {:else if searchQuery.trim() && !isSearching}
            <div class="text-center py-4 text-sm text-[var(--text-muted)]">
              No matches for "{searchQuery.trim()}". Try another name, or search
              all institutions below.
            </div>
          {:else if !searchQuery.trim() && !isSearching && institutions.length === 0}
            <div class="text-center py-4 text-sm text-[var(--text-muted)]">
              Start typing to search for your bank or financial institution.
            </div>
          {/if}
        </div>

        <div class="shrink-0 space-y-3 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onclick={onSearchAll}
            class="w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors hover:bg-[var(--bg-muted)]"
          >
            <span
              class="w-8 h-8 rounded-lg bg-[var(--bg-muted)] flex flex-shrink-0 items-center justify-center text-[var(--text-muted)]"
            >
              <Landmark size={16} />
            </span>
            <span class="flex-1 min-w-0">
              <span
                class="block text-sm font-medium text-[var(--text)] leading-tight"
              >
                Search all institutions
              </span>
              <span class="block text-xs text-[var(--text-muted)] mt-1">
                Includes smaller banks and credit unions
              </span>
            </span>
            <ChevronRight
              size={16}
              class="flex-shrink-0 text-[var(--text-muted)]"
            />
          </button>
          <p
            class="text-xs text-[var(--text-muted)] text-center flex items-center justify-center gap-1"
          >
            <Lock size={12} class="inline" />
            We never store your banking credentials. All connections are read-only.
          </p>
        </div>
      </div>
    {/if}
  </DialogContent>
</Dialog>

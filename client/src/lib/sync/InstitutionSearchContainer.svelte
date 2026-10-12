<script lang="ts">
  import InstitutionSearch from "./InstitutionSearch.svelte";
  import type { InstitutionType, CatalogProvider } from "@openfinance/shared";
  import { searchInstitutions, getTopInstitutions } from "./api";

  // === PROPS ===
  interface Props {
    isOpen?: boolean;
    onClose?: () => void;
    onProviderSelect?: (
      institution: InstitutionType,
      provider: CatalogProvider,
    ) => void;
    /** Opens Quiltt's own search, for banks our catalogs don't carry. */
    onSearchAll?: () => void;
    connectedInstitutionIds?: Set<string>;
  }

  let {
    isOpen = $bindable(false),
    onClose = () => {},
    onProviderSelect = () => {},
    onSearchAll = () => {},
    connectedInstitutionIds = new Set<string>(),
  }: Props = $props();

  // === STATE ===
  let searchQuery = $state("");
  let institutions = $state<InstitutionType[]>([]);
  let isSearching = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let countryCache: string | null = null;

  // === EFFECTS ===
  $effect(() => {
    if (isOpen && !searchQuery.trim()) {
      loadTopInstitutions();
    }
  });

  // === API FUNCTIONS ===

  async function getCurrentCountry(): Promise<string> {
    if (countryCache) return countryCache;
    // Default to US; container can be enhanced with geolocation later
    countryCache = "US";
    return countryCache;
  }

  async function loadTopInstitutions() {
    try {
      isSearching = true;
      const country = await getCurrentCountry();
      const response = await getTopInstitutions(country, 20, "all");
      institutions = response.institutions;
    } catch {
      institutions = [];
    } finally {
      isSearching = false;
    }
  }

  // === HANDLERS ===

  function handleSearchInput(query: string) {
    searchQuery = query;

    if (searchTimeout) clearTimeout(searchTimeout);

    if (!query.trim()) {
      loadTopInstitutions();
      return;
    }

    searchTimeout = setTimeout(async () => {
      try {
        isSearching = true;
        const response = await searchInstitutions(
          query.trim(),
          20,
          "all",
          "all",
        );
        institutions = response.institutions;
      } catch {
        institutions = [];
      } finally {
        isSearching = false;
      }
    }, 300);
  }

  function handleClose() {
    searchQuery = "";
    institutions = [];
    isOpen = false;
    onClose();
  }
</script>

<InstitutionSearch
  bind:isOpen
  {institutions}
  {isSearching}
  {searchQuery}
  {connectedInstitutionIds}
  onSearchInput={handleSearchInput}
  {onProviderSelect}
  {onSearchAll}
  onClose={handleClose}
/>

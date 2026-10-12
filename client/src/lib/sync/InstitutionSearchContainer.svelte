<script lang="ts">
  import InstitutionSearch from "./InstitutionSearch.svelte";
  import type { InstitutionType, CatalogProvider } from "@openfinance/shared";
  import { searchInstitutions } from "./api";

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
  }

  let {
    isOpen = $bindable(false),
    onClose = () => {},
    onProviderSelect = () => {},
    onSearchAll = () => {},
  }: Props = $props();

  // === STATE ===
  let searchQuery = $state("");
  let institutions = $state<InstitutionType[]>([]);
  let isSearching = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | null = null;

  // === EFFECTS ===
  // With no query, list the top banks.
  $effect(() => {
    if (isOpen && !searchQuery.trim()) {
      search("");
    }
  });

  // === API FUNCTIONS ===

  async function search(query: string) {
    try {
      isSearching = true;
      const response = await searchInstitutions(query);
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

    if (query.trim()) {
      searchTimeout = setTimeout(() => search(query.trim()), 300);
    }
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
  onSearchInput={handleSearchInput}
  {onProviderSelect}
  {onSearchAll}
  onClose={handleClose}
/>

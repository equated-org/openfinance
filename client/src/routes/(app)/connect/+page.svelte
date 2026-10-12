<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { getApiKey, resetApiKey, type ApiKey } from "$lib/sync/api";
  import { API_BASE } from "$lib/api-client";
  import ConnectGuide from "$lib/connect/ConnectGuide.svelte";
  import { Copy, Eye, EyeOff, RefreshCw } from "lucide-svelte";

  let existingKey = $state<ApiKey | null>(null);
  let fullKey = $state<string | null>(null);
  let keyRevealed = $state(false);
  let resetting = $state(false);
  let keyError = $state<string | null>(null);
  let keyCopied = $state(false);
  let keyLoaded = $state(false);
  let claudeDownloading = $state(false);
  let claudeDownloadError = $state<string | null>(null);

  // The hosted MCP server lives on the API, so dev and self-hosted instances
  // show their own URLs.
  const serverUrl = API_BASE || "https://api.openfinance.sh";

  // Load existing key on mount
  $effect(() => {
    loadKey();
  });

  async function loadKey() {
    try {
      const { key } = await getApiKey();
      existingKey = key;
      if (key?.key) {
        fullKey = key.key;
      }
    } catch {
      // ignore
    } finally {
      keyLoaded = true;
    }
  }

  const displayKey = $derived.by(() => {
    if (fullKey) {
      if (keyRevealed) return fullKey;
      return fullKey.slice(0, 5) + "..." + fullKey.slice(-6);
    }
    if (existingKey) {
      return existingKey.prefix + "...";
    }
    return null;
  });

  async function handleReset() {
    resetting = true;
    keyError = null;
    keyCopied = false;
    try {
      const created = await resetApiKey();
      fullKey = created.key;
      existingKey = {
        id: created.id,
        key: null,
        prefix: created.prefix,
        name: created.name,
        createdAt: created.createdAt,
        lastUsedAt: null,
      };
      keyRevealed = true;
    } catch {
      keyError = "Failed to reset key. Please try again.";
    } finally {
      resetting = false;
    }
  }

  async function handleCopyKey() {
    if (!fullKey) return;
    await navigator.clipboard.writeText(fullKey);
    keyCopied = true;
    setTimeout(() => (keyCopied = false), 2000);
  }

  async function handleDownloadClaude() {
    if (claudeDownloading) return;

    claudeDownloading = true;
    claudeDownloadError = null;

    try {
      const response = await fetch(`${API_BASE}/api/mcp-bundle`);
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "openfinance.mcpb";
      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(objectUrl);
    } catch {
      claudeDownloadError = "Download failed. Please try again.";
    } finally {
      claudeDownloading = false;
    }
  }
</script>

<div class="max-w-4xl mx-auto md:px-8 pt-8">
  <section class="p-2">
    <ConnectGuide
      {serverUrl}
      apiKey={fullKey}
      downloadingBundle={claudeDownloading}
      downloadError={claudeDownloadError}
      onDownloadBundle={handleDownloadClaude}
    />

    <!-- API Key Section -->
    <div class="mt-6">
      <h3 class="text-sm font-semibold text-[var(--text)]">API Key</h3>
      <p class="text-xs text-[var(--text-muted)] mt-1">
        For apps that can't sign in to OpenFinance. It can read your accounts and
        transactions, so keep it secret.
      </p>

      {#if keyError}
        <p class="mt-3 text-sm text-red-600">{keyError}</p>
      {/if}

      {#if displayKey}
        <div class="mt-3 flex items-center gap-2">
          <div
            class="flex flex-1 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2"
          >
            <code class="flex-1 text-sm text-[var(--text)] break-all"
              >{displayKey}</code
            >
            {#if fullKey}
              <button
                type="button"
                class="text-[var(--text-muted)] hover:text-[var(--text-muted)] transition-colors"
                onclick={() => (keyRevealed = !keyRevealed)}
              >
                {#if keyRevealed}
                  <EyeOff class="h-4 w-4" />
                {:else}
                  <Eye class="h-4 w-4" />
                {/if}
              </button>
            {/if}
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!fullKey}
            onclick={handleCopyKey}
          >
            <Copy class="h-3.5 w-3.5 mr-1" />
            {keyCopied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={resetting}
            onclick={handleReset}
          >
            <RefreshCw
              class="h-3.5 w-3.5 mr-1 {resetting ? 'animate-spin' : ''}"
            />
            Reset
          </Button>
        </div>
      {:else if keyLoaded}
        <div class="mt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={resetting}
            onclick={handleReset}
          >
            <RefreshCw
              class="h-3.5 w-3.5 mr-1 {resetting ? 'animate-spin' : ''}"
            />
            Generate Key
          </Button>
        </div>
      {:else}
        <div class="mt-3">
          <p class="text-xs text-[var(--text-muted)]">Loading...</p>
        </div>
      {/if}
    </div>
  </section>
</div>
